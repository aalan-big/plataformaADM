/**
 * ============================================================================
 * NOME DO ARQUIVO: erp-backup.service.ts
 * MÓDULO: ERP
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Regras do backup em nuvem do ERP local. Decide QUEM pode subir, QUANTO pode
 * subir por dia e ONDE o arquivo é gravado — o ERP não escolhe nada disso.
 *
 * Modelo: a semana é um CICLO, aberto na segunda-feira. O primeiro login do
 * ciclo sobe um FULL (acervo inteiro); os demais sobem FRAGMENTOS (só o que
 * mudou). Quando o full do ciclo novo confirma, a rotação apaga o ciclo
 * anterior — só se pode destruir a cópia velha porque a nova contém tudo.
 *
 * O gatilho é o LOGIN do usuário, não um horário: o PC do cliente pode estar
 * desligado à noite.
 *
 * O QUE ELE CONTÉM:
 * - Gate de plano (trial e inadimplente não sobem nem baixam).
 * - Limite diário por licença (proteção de custo).
 * - Lock entre as máquinas da loja.
 * - Emissão e confirmação de URL assinada.
 * ============================================================================
 */
import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ZodError } from 'zod'
import {
  findLicencaById,
  criarBackup,
  findBackupById,
  marcarBackupConfirmado,
  marcarBackupFalhou,
  contarBackupsDoDia,
  findUltimoBackupConfirmado,
  findUltimoFullConfirmado,
  findFullConfirmadoDoCiclo,
  findCorrenteDoCiclo,
  findEnvioPendente,
  proximaSequencia,
  findBackupsRecentes,
  cicloAtual,
  type TipoBackupDb,
} from '@startbig/database'
import {
  urlUploadBackupSchema,
  confirmarBackupSchema,
  urlDownloadBackupSchema,
  BACKUP_TAMANHO_MAX_BYTES,
} from '@startbig/schemas'
import { StorageService, TTL_UPLOAD_SEGUNDOS } from '../../common/storage/storage.service'

/// Cobre o backup automático + um manual do usuário no mesmo dia. Mais que isso
/// não é uso legítimo, é loop com bug — e loop com bug na nuvem é fatura.
///
/// Sobrescrevível por env porque testar o fluxo ponta a ponta estoura 2 uploads
/// em minutos. Em produção deixe sem definir: o padrão é o valor que protege a
/// conta. Valor inválido ou vazio cai no padrão em vez de virar 0, que
/// bloquearia todo mundo silenciosamente.
function limiteDeEnv(chave: string, padrao: number): number {
  const n = Number(process.env[chave])
  return Number.isInteger(n) && n > 0 ? n : padrao
}

/// Cota diária POR LICENÇA, não por tipo: com o gatilho no login, "tipo" deixou
/// de ser um eixo de cota — num dia normal sobe um pacote só.
///
/// A folga de 4 cobre o caso legítimo: o envio do dia, um manual do usuário, e
/// uma retentativa depois de uma queda de internet. Mais que isso não é uso
/// legítimo, é loop com bug — e loop com bug na nuvem é fatura.
///
/// O lock entre terminais já impede o caso mais provável de estouro (três
/// estações logando às 8h), então esta cota volta a ser o que sempre foi: teto
/// contra bug, não regra de negócio.
const LIMITE_DIARIO = limiteDeEnv('BACKUP_LIMITE_DIARIO', 4)

/// Se o FULL de hoje vier com menos da metade do FULL anterior, algo está errado
/// (banco truncado, export pela metade, pasta de fotos que sumiu). Aceitar isso
/// é deixar a rotação apagar o ciclo bom logo em seguida, com base num full que
/// não contém o que ele deveria conter.
///
/// ⚠ Só se compara FULL com FULL. Fragmento é, por desenho, muito menor que o
/// full — comparar os dois faria a trava disparar em todo primeiro fragmento da
/// semana, todas as semanas.
const QUEDA_SUSPEITA = 0.5

/// Janela do lock entre as máquinas da loja. Acompanha o TTL da URL assinada por
/// invariante: passado ele a URL não vale mais e o upload não tem como concluir,
/// então segurar o lock além disso deixaria a loja inteira sem backup por causa
/// de uma máquina que travou.
const MINUTOS_LOCK = Math.ceil(TTL_UPLOAD_SEGUNDOS / 60)

@Injectable()
export class ErpBackupService {
  private readonly logger = new Logger(ErpBackupService.name)

  constructor(private readonly storage: StorageService) {}

  // ── Helpers privados ──────────────────────────────────────────────────────

  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new HttpException(
          { codigo: 'BACKUP_DADOS_INVALIDOS', message: 'Dados inválidos', detalhes: e.issues },
          HttpStatus.BAD_REQUEST,
        )
      throw e
    }
  }

  private erro(status: HttpStatus, codigo: string, message: string): HttpException {
    return new HttpException({ codigo, message }, status)
  }

  /**
   * Carrega a licença e aplica o gate. Esta é a trava REAL do backup — a
   * checagem no ERP só desabilita o botão, e botão desabilitado se reabilita
   * com um F12. Quem decide é aqui.
   */
  private async carregarLicencaLiberada(licencaId: string) {
    const licenca = await findLicencaById(licencaId)

    if (!licenca)
      throw this.erro(HttpStatus.NOT_FOUND, 'BACKUP_LICENCA_NAO_ENCONTRADA', 'Licença não encontrada.')

    const motivo = this.motivoDeBloqueio(licenca)
    if (motivo)
      throw this.erro(HttpStatus.FORBIDDEN, 'BACKUP_PLANO_INATIVO', motivo.mensagem)

    return licenca
  }

  /**
   * Regra única de "esta licença tem direito a backup", usada tanto pelo gate
   * quanto pelo /status (que precisa responder sem estourar exceção).
   *
   * Vale para upload E download: a decisão foi tratar backup como recurso do
   * plano ativo. Quem vence não perde o arquivo na hora — ele fica na nuvem pelo
   * período de retenção, e voltando a pagar dentro da janela recupera o acesso.
   *
   * Devolve código E mensagem. A mensagem é escrita para o usuário final e pode
   * mudar a qualquer momento; o código é contrato, e é nele que o ERP ramifica.
   * Sem o código o /status era a única resposta da API que obrigava o cliente a
   * comparar string — exatamente o que o resto do contrato proíbe.
   */
  private motivoDeBloqueio(licenca: {
    status: string
    isTrial: boolean
    dataVencimento: Date | null
  }): { codigo: string; mensagem: string } | null {
    if (licenca.isTrial)
      return {
        codigo:   'TRIAL',
        mensagem: 'Backup em nuvem não está disponível durante o período de teste.',
      }

    // O código carrega o nome do enum (LICENCA_SUSPENSA, LICENCA_REVOGADA, ...)
    // porque "por que estou bloqueado" e "qual o estado da licença" são a mesma
    // pergunta aqui, e achatar tudo em um código só faria o ERP voltar a ler a
    // mensagem para saber o que dizer ao cliente.
    if (licenca.status !== 'ATIVA')
      return {
        codigo:   `LICENCA_${licenca.status}`,
        mensagem: `Licença ${licenca.status.toLowerCase()} — backup em nuvem indisponível.`,
      }

    // Mesmo código do status VENCIDA acima, de propósito: para quem consome, é a
    // mesma situação. A diferença é só se o cron já passou marcando ou não.
    if (licenca.dataVencimento && licenca.dataVencimento < new Date())
      return {
        codigo:   'LICENCA_VENCIDA',
        mensagem: 'Licença vencida — backup em nuvem indisponível até a renovação.',
      }

    return null
  }

  /**
   * A chave é montada AQUI, a partir do token. Nunca se aceita caminho (nem
   * clienteId) do corpo da requisição: seria o cliente A pedindo URL para o
   * prefixo do cliente B.
   *
   * O licencaId entra no caminho porque um cliente pode ter várias licenças, cada
   * uma com seu banco local. Sem ele, duas lojas do mesmo dono escreveriam no
   * mesmo objeto e a segunda apagaria o backup da primeira.
   */
  /// Tudo que é apagável fica sob `ciclos/`. Não é organização: é o que torna a
  /// rotação ESTRUTURALMENTE incapaz de alcançar qualquer coisa que não seja um
  /// ciclo — mesmo espírito da chave montada no servidor, que elimina o path
  /// traversal em vez de tentar validá-lo.
  private montarChave(
    clienteId: string,
    licencaId: string,
    tipo:      TipoBackupDb,
    ciclo:     string,
    sequencia: number,
  ): string {
    const arquivo = tipo === 'FULL'
      ? 'full.zip'
      : `frag-${String(sequencia).padStart(3, '0')}.zip`

    return `clientes/${clienteId}/${licencaId}/ciclos/${ciclo}/${arquivo}`
  }

  private paraTipoDb(tipo: 'full' | 'fragmento'): TipoBackupDb {
    return tipo === 'full' ? 'FULL' : 'FRAGMENTO'
  }

  // ── Endpoints ─────────────────────────────────────────────────────────────

  async urlUpload(licencaId: string, hwidToken: string | null, body: unknown) {
    const dados   = this.parseBody(urlUploadBackupSchema, body)
    const licenca = await this.carregarLicencaLiberada(licencaId)
    const tipo    = this.paraTipoDb(dados.tipo)

    if (hwidToken && dados.hwid !== hwidToken)
      throw this.erro(
        HttpStatus.FORBIDDEN,
        'BACKUP_HWID_DIVERGENTE',
        'HWID informado não corresponde ao da sessão autenticada.',
      )

    const ciclo = cicloAtual()

    // O ERP LÊ o ciclo do /status, não calcula. Divergência é máquina com data
    // errada ou tela velha — e gravar no ciclo errado embaralha a ordem de
    // restauração de um jeito que só aparece no dia do desastre.
    if (dados.ciclo !== ciclo)
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_CICLO_DIVERGENTE',
        `O ciclo corrente é ${ciclo}, não ${dados.ciclo}. Releia o /status antes de enviar.`,
      )

    // ── Lock entre as máquinas da loja ────────────────────────────────────────
    // O ERP dispara no login, então três estações abrindo às 8h tentariam três
    // backups da mesma licença. Isto NÃO é erro: é a resposta normal para o
    // segundo terminal, não consome cota e não deve virar retentativa em laço.
    const pendente = await findEnvioPendente(licencaId, MINUTOS_LOCK)

    if (pendente)
      return {
        acao:   'AGUARDANDO_OUTRO_TERMINAL',
        desde:  pendente.emitidoEm.toISOString(),
        hwid:   pendente.hwid,
        motivo: 'Outro terminal já está enviando o backup de hoje.',
      }

    // ── Nada mudou ────────────────────────────────────────────────────────────
    // O `codigoConteudo` é um token do estado do conteúdo da INSTALAÇÃO, não um
    // hash daquele pacote: ele avança quando entra coisa nova e fica parado
    // quando não entra. Por isso a comparação é direta, sem olhar o tipo.
    //
    // A referência é o último envio CONFIRMADO, nunca uma linha ainda emitida. Se
    // o código fosse promovido na autorização, um upload que morresse no meio
    // faria o envio seguinte bater com ele e receber "nada novo" — o conteúdo
    // nunca subiria, e nenhum erro apareceria em lugar nenhum.
    const ultimo = await findUltimoBackupConfirmado(licencaId)

    if (ultimo?.codigoConteudo && ultimo.codigoConteudo === dados.codigoConteudo)
      return {
        acao:     'PULAR',
        motivo:   'Nada mudou desde o último envio confirmado.',
        chave:    ultimo.chaveS3,
        ultimoEm: ultimo.confirmadoEm ?? ultimo.emitidoEm,
      }

    // ── O tipo tem que fechar com o estado do ciclo ───────────────────────────
    const fullDoCiclo = await findFullConfirmadoDoCiclo(licencaId, ciclo)

    // Fragmento sem full é elo solto: ocupa espaço na nuvem e não restaura nada,
    // porque não existe base sobre a qual aplicá-lo.
    if (!fullDoCiclo && tipo !== 'FULL')
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_FULL_OBRIGATORIO',
        `O ciclo ${ciclo} ainda não tem full confirmado. O próximo envio precisa ser full.`,
      )

    // Um full por ciclo, sempre na sequência 0. Dois fulls na mesma corrente
    // deixam "qual é a base?" em aberto, e a escolha errada restaura um acervo
    // incompleto sem parecer que falhou.
    if (fullDoCiclo && tipo === 'FULL')
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_FULL_JA_EXISTE',
        `O ciclo ${ciclo} já tem full confirmado. Envie fragmento até a próxima segunda.`,
      )

    // ── Queda suspeita: FULL contra FULL, nunca contra fragmento ──────────────
    // A trava vale para o envio AUTOMÁTICO, que roda sem ninguém olhando. No
    // manual existe uma pessoa que clicou sabendo do que se trata, e a redução
    // pode ser legítima (limpeza de histórico, exclusão de filial).
    //
    // Aqui ela pesa mais do que pesava no espelho: é o full confirmado que
    // autoriza a rotação a apagar o ciclo anterior. Aceitar um full pela metade é
    // destruir a cópia boa logo em seguida.
    if (tipo === 'FULL' && dados.origem !== 'MANUAL') {
      const ultimoFull = await findUltimoFullConfirmado(licencaId)

      if (ultimoFull?.tamanhoRealBytes && dados.tamanhoBytes < ultimoFull.tamanhoRealBytes * QUEDA_SUSPEITA)
        throw this.erro(
          HttpStatus.CONFLICT,
          'BACKUP_TAMANHO_SUSPEITO',
          `Full de ${this.tamanho(dados.tamanhoBytes)} é muito menor que o anterior ` +
          `(${this.tamanho(ultimoFull.tamanhoRealBytes)}). Envio automático recusado para não ` +
          `autorizar a limpeza do ciclo antigo. Se a redução é esperada, refaça pelo botão manual.`,
        )
    }

    const enviadosHoje = await contarBackupsDoDia(licencaId)

    if (enviadosHoje >= LIMITE_DIARIO)
      throw this.erro(
        HttpStatus.TOO_MANY_REQUESTS,
        'BACKUP_LIMITE_DIARIO',
        `Limite de ${LIMITE_DIARIO} envios por dia já atingido nesta licença. Tente amanhã.`,
      )

    // O full sempre abre a corrente; o fragmento pega a próxima vaga livre.
    const sequencia = tipo === 'FULL' ? 0 : await proximaSequencia(licencaId, ciclo)
    const chave     = this.montarChave(licenca.clienteId, licencaId, tipo, ciclo, sequencia)

    // Assina ANTES de gravar a linha. A linha conta cota E segura o lock, então
    // se a assinatura falhar (bucket mal configurado, credencial vencida) o
    // cliente não pode sair com uma vaga gasta e a loja inteira travada num dia
    // em que nada foi enviado.
    const { url, expiraEm } = await this.storage.gerarUrlUpload({
      chave,
      tamanhoBytes: dados.tamanhoBytes,
    })

    const registro = await criarBackup({
      clienteId:      licenca.clienteId,
      licencaId,
      hwid:           dados.hwid,
      tipo,
      ciclo,
      sequencia,
      chaveS3:        chave,
      origem:         dados.origem,
      tamanhoBytes:   dados.tamanhoBytes,
      codigoConteudo: dados.codigoConteudo,
    })

    return {
      acao:     'ENVIAR',
      uploadId: registro.id,
      url,
      chave,
      ciclo,
      sequencia,
      metodo:   'PUT',
      // O ERP precisa mandar exatamente estes headers — o Content-Length está
      // dentro da assinatura, então divergir de um byte invalida a URL.
      headers: {
        'Content-Type':   'application/zip',
        'Content-Length': String(dados.tamanhoBytes),
      },
      expiraEm: expiraEm.toISOString(),
    }
  }

  async confirmar(licencaId: string, body: unknown) {
    const dados    = this.parseBody(confirmarBackupSchema, body)
    const registro = await findBackupById(dados.uploadId)

    if (!registro || registro.licencaId !== licencaId)
      throw this.erro(HttpStatus.NOT_FOUND, 'BACKUP_NAO_ENCONTRADO', 'Upload não encontrado para esta licença.')

    if (!dados.ok) {
      await marcarBackupFalhou(registro.id, dados.erro ?? 'Falha reportada pelo ERP.')
      return { confirmado: false, motivo: 'Falha registrada.' }
    }

    // Não se confia no "ok" do cliente: confere no bucket. Um ERP com bug pode
    // reportar sucesso de um upload que morreu no meio, e aí o painel mostraria
    // backup em dia para arquivo inexistente.
    const objeto = await this.storage.conferirObjeto(registro.chaveS3)

    if (!objeto) {
      await marcarBackupFalhou(registro.id, 'Arquivo não encontrado na nuvem após o upload.')
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_ARQUIVO_AUSENTE',
        'O arquivo não foi encontrado na nuvem. Refaça o envio.',
      )
    }

    if (objeto.tamanhoBytes !== registro.tamanhoBytes) {
      await marcarBackupFalhou(
        registro.id,
        `Tamanho divergente: reservado ${registro.tamanhoBytes}, encontrado ${objeto.tamanhoBytes}.`,
      )
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_TAMANHO_DIVERGENTE',
        'O arquivo na nuvem tem tamanho diferente do informado. Refaça o envio.',
      )
    }

    await marcarBackupConfirmado(registro.id, objeto.tamanhoBytes)

    return {
      confirmado:   true,
      uploadId:     registro.id,
      tamanhoBytes: objeto.tamanhoBytes,
      confirmadoEm: new Date().toISOString(),
    }
  }

  async status(licencaId: string) {
    const licenca = await findLicencaById(licencaId)

    if (!licenca)
      throw this.erro(HttpStatus.NOT_FOUND, 'BACKUP_LICENCA_NAO_ENCONTRADA', 'Licença não encontrada.')

    const motivo = this.motivoDeBloqueio(licenca)

    const ciclo = cicloAtual()

    const [fullDoCiclo, corrente, pendente, enviadosHoje, recentes] = await Promise.all([
      findFullConfirmadoDoCiclo(licencaId, ciclo),
      findCorrenteDoCiclo(licencaId, ciclo),
      findEnvioPendente(licencaId, MINUTOS_LOCK),
      contarBackupsDoDia(licencaId),
      findBackupsRecentes(licencaId, 30),
    ])

    return {
      planoPermiteBackup: motivo === null,
      /// Texto pronto para exibir. Para RAMIFICAR use o codigoBloqueio — este
      /// campo muda quando a redação melhorar.
      motivoBloqueio:     motivo?.mensagem ?? null,
      codigoBloqueio:     motivo?.codigo   ?? null,
      limiteDiario:       LIMITE_DIARIO,
      enviadosHoje,
      tamanhoMaximoBytes: BACKUP_TAMANHO_MAX_BYTES,

      /// Ciclo que o ERP deve informar no url-upload. Vem do servidor porque o
      /// corte é no fuso de São Paulo pelo relógio DELE — se o ERP calculasse
      /// sozinho, uma máquina com a data errada faria o full no dia errado, ou
      /// nunca faria.
      cicloCorrente: ciclo,

      /// `false` significa "o próximo envio é FULL", em qualquer dia da semana.
      /// É isto que faz a terça assumir quando a oficina não abre na segunda, e é
      /// o que torna o primeiro backup de uma instalação nova um full sem regra
      /// extra nenhuma.
      fullDoCicloConfirmado: Boolean(fullDoCiclo),

      /// Outro terminal segurando o lock. Não é erro: é para a tela dizer
      /// "backup sendo feito em outra máquina" em vez de tentar de novo.
      envioEmAndamento: pendente
        ? { hwid: pendente.hwid, desde: pendente.emitidoEm }
        : null,

      /// A corrente que EXISTE na nuvem hoje, na ordem em que seria extraída. O
      /// histórico abaixo é registro de eventos, não lista de arquivos
      /// restauráveis — a tela precisa deixar isso claro para não prometer
      /// restauração que não existe.
      corrente: corrente.map(r => ({
        tipo:      r.tipo,
        sequencia: r.sequencia,
        ...this.resumo(r),
      })),

      historicoEventos: recentes.map(r => ({
        tipo:         r.tipo,
        ciclo:        r.ciclo,
        sequencia:    r.sequencia,
        status:       r.status,
        origem:       r.origem,
        tamanhoBytes: r.tamanhoRealBytes ?? r.tamanhoBytes,
        hwid:         r.hwid,
        emitidoEm:    r.emitidoEm,
        confirmadoEm: r.confirmadoEm,
        erro:         r.erroMensagem,
      })),
    }
  }

  async urlDownload(licencaId: string, hwidToken: string | null, body: unknown) {
    const dados = this.parseBody(urlDownloadBackupSchema, body)
    await this.carregarLicencaLiberada(licencaId)

    if (hwidToken && dados.hwid !== hwidToken)
      throw this.erro(
        HttpStatus.FORBIDDEN,
        'BACKUP_HWID_DIVERGENTE',
        'HWID informado não corresponde ao da sessão autenticada.',
      )

    const ciclo = dados.ciclo ?? cicloAtual()

    // Restaurar é baixar a CORRENTE inteira, na ordem: o full e depois cada
    // fragmento. Meia restauração é pior que nenhuma, porque parece completa.
    const registros = await findCorrenteDoCiclo(licencaId, ciclo)

    if (registros.length === 0)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'BACKUP_INEXISTENTE',
        `Nenhum backup confirmado no ciclo ${ciclo} para esta licença.`,
      )

    // Corrente sem full não restaura: fragmento é diferença, e não existe base
    // sobre a qual aplicá-lo. Falhar aqui, alto, é melhor que entregar links que
    // reconstroem um acervo pela metade.
    if (registros[0].tipo !== 'FULL' || registros[0].sequencia !== 0)
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_CORRENTE_SEM_FULL',
        `O ciclo ${ciclo} não tem full confirmado — os fragmentos sozinhos não restauram nada.`,
      )

    // Confere antes de assinar: link para objeto apagado pela retenção viraria
    // um 404 no meio do download, sem explicação para o cliente.
    const conferidos = await Promise.all(
      registros.map(async r => ({ registro: r, objeto: await this.storage.conferirObjeto(r.chaveS3) })),
    )

    // Elo registrado que sumiu do bucket é informado, nunca omitido em silêncio.
    const indisponiveis = conferidos
      .filter(c => c.objeto === null)
      .map(c => c.registro.sequencia)

    // Numa CORRENTE um buraco não deixa a restauração parcial — ele invalida
    // tudo que vem depois, porque fragmento é diferença aplicada sobre o estado
    // anterior. Então a corrente é cortada no primeiro elo ausente, e o que
    // sobra é honestamente utilizável.
    const primeiroBuraco = conferidos.findIndex(c => c.objeto === null)
    const utilizaveis    = primeiroBuraco === -1 ? conferidos : conferidos.slice(0, primeiroBuraco)

    if (utilizaveis.length === 0)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'BACKUP_INEXISTENTE',
        'O backup registrado não está mais disponível na nuvem.',
      )

    const assinados = await Promise.all(
      utilizaveis.map(async ({ registro, objeto }) => {
        const { url, expiraEm } = await this.storage.gerarUrlDownload(registro.chaveS3)
        return {
          expiraEm,
          arquivo: {
            tipo:         registro.tipo,
            sequencia:    registro.sequencia,
            url,
            chave:        registro.chaveS3,
            tamanhoBytes: objeto!.tamanhoBytes,
            geradoEm:     registro.confirmadoEm ?? registro.emitidoEm,
          },
        }
      }),
    )

    const arquivos = assinados.map(a => a.arquivo)
    // A mais curta manda: é a primeira que expira, e o ERP precisa de UM prazo
    // para decidir quando pedir a lista de novo.
    const expiraEm = new Date(Math.min(...assinados.map(a => a.expiraEm.getTime())))

    if (indisponiveis.length > 0)
      this.logger.warn(
        `[backup] corrente com buraco — licenca=${licencaId} ciclo=${ciclo} ` +
        `elos ausentes na nuvem: ${indisponiveis.join(', ')}`,
      )

    this.logger.log(
      `[backup] download emitido — licenca=${licencaId} ciclo=${ciclo} ` +
      `arquivos=${arquivos.length} hwid=${dados.hwid}`,
    )

    return {
      ciclo,
      arquivos,
      /// Elos que constam no registro mas não estão mais na nuvem. Lista vazia é
      /// o caso normal.
      indisponiveis,
      /// Até onde a corrente reconstrói de verdade. Se for menor que a última
      /// sequência registrada, o acervo volta ao estado daquele dia e NÃO ao de
      /// hoje — a tela do ERP tem que dizer isso antes de restaurar.
      cadeiaCompleta: indisponiveis.length === 0,
      restauraAte:    arquivos[arquivos.length - 1]?.geradoEm ?? null,
      totalBytes: arquivos.reduce((s, a) => s + a.tamanhoBytes, 0),
      /// Quando a primeira URL desta lista expira.
      ///
      /// Para restaurar OS com muitos meses o prazo não dá, e é de propósito: em
      /// vez de esticar a validade de um link que entrega o banco inteiro do
      /// cliente, o ERP baixa o que conseguir e CHAMA DE NOVO para o que faltar.
      /// `url-download` é leitura pura e não tem cota diária — repetir é barato.
      expiraEm: expiraEm.toISOString(),
    }
  }

  // ── Formatação ────────────────────────────────────────────────────────────

  /// O checksum vai junto para o ERP poder decidir ANTES de trabalhar: se o que
  /// ele tem em disco bate com o que já está na nuvem, não precisa zipar 300 MB
  /// de fotos só para ouvir PULAR no fim. Zipar é a parte cara do ciclo, e é a
  /// única que o servidor não tinha como ajudar a evitar.
  private resumo(r: {
    tamanhoRealBytes:  number | null
    tamanhoBytes:      number
    confirmadoEm:      Date | null
    emitidoEm:         Date
    hwid?:             string | null
    chaveS3?:          string
    codigoConteudo?:   string | null
  }) {
    return {
      tamanhoBytes:   r.tamanhoRealBytes ?? r.tamanhoBytes,
      geradoEm:       r.confirmadoEm ?? r.emitidoEm,
      hwid:           r.hwid ?? null,
      chave:          r.chaveS3 ?? null,
      codigoConteudo: r.codigoConteudo ?? null,
    }
  }

  /// Esta mensagem chega ao usuário final do ERP. Forçar MB transformava
  /// "1 KB é menor que 64 KB" em "0.0 MB é muito menor que 0.1 MB", que não
  /// explica nada e ainda parece defeito do sistema.
  private tamanho(bytes: number): string {
    if (bytes < 1024)        return `${bytes} bytes`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
}
