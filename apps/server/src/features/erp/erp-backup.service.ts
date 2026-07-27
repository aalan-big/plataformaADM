/**
 * ============================================================================
 * NOME DO ARQUIVO: erp-backup.service.ts
 * MÓDULO: ERP
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Regras do backup em nuvem do ERP local. Decide QUEM pode subir, QUANTO pode
 * subir por dia e ONDE o arquivo é gravado — o ERP não escolhe nada disso.
 *
 * Modelo de arquivo: cada licença tem UM banco.zip e UM imagens.zip na nuvem.
 * O backup de hoje sobrescreve o de ontem. Não há versões nem ring de dias.
 *
 * O QUE ELE CONTÉM:
 * - Gate de plano (trial e inadimplente não sobem nem baixam).
 * - Limite diário por licença (proteção de custo).
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
  contarBackfillDoDia,
  findUltimoBackupConfirmado,
  findPedacosDeOsConfirmados,
  findBackupsRecentes,
  periodoAtual,
  type TipoBackupDb,
} from '@startbig/database'
import {
  urlUploadBackupSchema,
  confirmarBackupSchema,
  urlDownloadBackupSchema,
  BACKUP_TAMANHO_MAX_BYTES,
} from '@startbig/schemas'
import { StorageService } from '../../common/storage/storage.service'

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

/// Os dois tipos têm a MESMA cota, e por um motivo específico: com 1/dia em
/// imagens, o automático zerava a cota e o botão de backup manual nascia
/// quebrado — no único dia em que ele importa, que é aquele em que o usuário
/// mexeu nas fotos e quis forçar o envio. Um botão que responde 429 é pior que
/// não ter botão. O custo extra é limitado: o segundo envio de imagens só
/// acontece se o conteúdo mudou de verdade, senão o dedupe responde PULAR sem
/// gastar vaga nem banda.
const LIMITE_DIARIO: Record<TipoBackupDb, number> = {
  BANCO:   limiteDeEnv('BACKUP_LIMITE_DIARIO_BANCO',   2),
  IMAGENS: limiteDeEnv('BACKUP_LIMITE_DIARIO_IMAGENS', 2),
  /// Em OS a cota vale POR MÊS, não pelo tipo inteiro — senão o mês corrente
  /// competiria por vaga com o backfill dos meses antigos.
  OS:      limiteDeEnv('BACKUP_LIMITE_DIARIO_OS',      2),
}

/// Cota separada para primeiro envio de pedaço de mês JÁ FECHADO — o backfill.
///
/// Um cliente que instala hoje com dois anos de ordens de serviço tem 24 pedaços
/// para subir, cada um uma vez na vida. Contra a cota normal de 2/dia isso
/// levaria 12 dias com o acervo desprotegido, justamente na janela em que ele
/// ainda não tem backup nenhum.
///
/// A folga é segura porque o caso é limitado por construção: o que a cota diária
/// protege é upload REPETIDO, e pedaço fechado que já subiu bate o checksum e
/// volta PULAR sem consumir vaga. O número de pedaços novos possíveis é o número
/// de meses de histórico — finito, e só diminui.
const LIMITE_BACKFILL_DIARIO = limiteDeEnv('BACKUP_LIMITE_BACKFILL_DIARIO', 12)

/// Se o backup de hoje vier com menos da metade do último confirmado, algo está
/// errado (banco truncado, ransomware, export pela metade). Com arquivo único e
/// sem versionamento, aceitar isso é sobrescrever a única cópia boa com lixo —
/// e não existe de onde voltar. Recusa e deixa o de ontem em paz.
const QUEDA_SUSPEITA = 0.5

/// Teto de dias que um pacote MUTÁVEL pode ficar sem subir por causa do
/// checksum. Ver a explicação no ponto onde é usado — é a rede de proteção
/// contra checksum errado congelar o backup em silêncio.
///
/// Não se aplica a pedaço de mês fechado: ali o conteúdo é imutável de verdade,
/// então checksum igual significa mesmo "nada mudou", e forçar reenvio semanal
/// destruiria exatamente a economia que a partição existe para obter.
const DIAS_FORCA_ESPELHO = 7

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
  private montarChave(
    clienteId: string,
    licencaId: string,
    tipo:      TipoBackupDb,
    periodo:   string | null,
  ): string {
    const arquivo =
      tipo === 'BANCO'   ? 'banco.zip'   :
      tipo === 'IMAGENS' ? 'imagens.zip' :
      `os-${periodo}.zip`
    return `clientes/${clienteId}/${licencaId}/${arquivo}`
  }

  private paraTipoDb(tipo: 'banco' | 'imagens' | 'os'): TipoBackupDb {
    return tipo === 'banco' ? 'BANCO' : tipo === 'imagens' ? 'IMAGENS' : 'OS'
  }

  /// Pedaço de mês que já acabou. É a única coisa neste sistema que pode ser
  /// tratada como imutável, e é disso que sai tanto a cota de backfill quanto a
  /// dispensa do reenvio forçado semanal.
  private ehPedacoFechado(tipo: TipoBackupDb, periodo: string | null): boolean {
    return tipo === 'OS' && periodo !== null && periodo < periodoAtual()
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

    const periodo = dados.periodo ?? null

    // Mês que ainda não começou não tem conteúdo para empacotar. Aceitar seria
    // gravar um pedaço que depois precisaria ser reenviado, ocupando a chave
    // definitiva daquele mês com dados pela metade.
    if (tipo === 'OS' && periodo && periodo > periodoAtual())
      throw this.erro(
        HttpStatus.BAD_REQUEST,
        'BACKUP_PERIODO_FUTURO',
        `Período ${periodo} ainda não terminou de existir. Envie no máximo até o mês corrente.`,
      )

    // Sem checksum não dá para deduplicar, e sem dedupe a mesma pasta de fotos
    // sobe todo dia sem nada ter mudado. É o maior desperdício possível — e em
    // OS é o mecanismo inteiro: é o checksum que faz o pedaço fechado responder
    // PULAR para sempre depois do primeiro envio.
    if (tipo !== 'BANCO' && !dados.checksumSha256)
      throw this.erro(
        HttpStatus.BAD_REQUEST,
        'BACKUP_CHECKSUM_OBRIGATORIO',
        `checksumSha256 é obrigatório para backup de ${dados.tipo}.`,
      )

    // Escopo do "último": em OS é o último DAQUELE MÊS. Comparar com o mês
    // anterior não faz sentido nenhum — são acervos diferentes, e a checagem de
    // queda suspeita acusaria todo mês mais fraco que o anterior.
    const ultimo = await findUltimoBackupConfirmado(licencaId, tipo, tipo === 'OS' ? periodo : undefined)

    // Espelho de imagens: nada mudou, nada sobe. Resposta é sucesso, não erro —
    // o ERP deve tratar como "backup em dia".
    //
    // Só que o checksum vem do ERP. Se ele calcular sobre a coisa errada e o
    // valor nunca mudar, o primeiro upload passa e TODOS os seguintes pulam —
    // para sempre. O cliente veria "backup em dia" por meses com as imagens
    // congeladas no primeiro dia, e só descobriria na hora de restaurar. Por
    // isso o pulo tem prazo: passado o limite, sobe inteiro de novo mesmo que o
    // checksum bata. Custa um upload por semana e elimina a falha silenciosa.
    if (tipo !== 'BANCO' && ultimo?.checksumSha256 && ultimo.checksumSha256 === dados.checksumSha256) {
      const referencia = ultimo.confirmadoEm ?? ultimo.emitidoEm
      const diasDesde  = (Date.now() - referencia.getTime()) / (24 * 60 * 60 * 1000)

      // Pedaço de mês fechado não recebe a rede de proteção, e é de propósito: o
      // conteúdo dele é imutável de verdade, então checksum igual significa mesmo
      // "nada mudou". Forçar reenvio semanal aqui reintroduziria exatamente o
      // custo que a partição existe para eliminar — anos de fotos subindo de novo
      // toda semana, para sempre.
      if (this.ehPedacoFechado(tipo, periodo) || diasDesde < DIAS_FORCA_ESPELHO) {
        return {
          acao:     'PULAR',
          motivo:   tipo === 'OS'
            ? `O pedaço de ${periodo} já está na nuvem e não mudou.`
            : 'Nenhuma imagem mudou desde o último backup.',
          chave:    ultimo.chaveS3,
          ultimoEm: referencia,
        }
      }

      this.logger.log(
        `[backup] ${tipo} sem mudança há ${Math.floor(diasDesde)} dias na licença ${licencaId} — ` +
        `forçando envio completo para não depender do checksum indefinidamente.`,
      )
    }

    // A trava vale para o backup AUTOMÁTICO, que roda sem ninguém olhando — é ali
    // que um banco truncado sobrescreve a única cópia boa em silêncio. No envio
    // manual existe uma pessoa que clicou sabendo do que se trata, e a redução
    // pode ser legítima (limpeza de histórico, exclusão de filial). Recusar os
    // dois deixaria o cliente sem nenhuma forma de subir um banco menor.
    if (
      dados.origem !== 'MANUAL' &&
      ultimo?.tamanhoRealBytes &&
      dados.tamanhoBytes < ultimo.tamanhoRealBytes * QUEDA_SUSPEITA
    )
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_TAMANHO_SUSPEITO',
        `Backup de ${this.tamanho(dados.tamanhoBytes)} é muito menor que o último enviado ` +
        `(${this.tamanho(ultimo.tamanhoRealBytes)}). Envio automático recusado para não ` +
        `sobrescrever a cópia boa. Se a redução é esperada, refaça pelo botão de backup manual.`,
      )

    // Duas cotas, porque são dois usos diferentes. Backfill (pedaço de mês
    // fechado que ainda não subiu) tem folga maior e conta num balde próprio;
    // tudo o mais — banco, imagens, mês corrente — usa a cota diária normal.
    if (this.ehPedacoFechado(tipo, periodo)) {
      const backfillHoje = await contarBackfillDoDia(licencaId, periodoAtual())
      if (backfillHoje >= LIMITE_BACKFILL_DIARIO)
        throw this.erro(
          HttpStatus.TOO_MANY_REQUESTS,
          'BACKUP_LIMITE_BACKFILL',
          `Limite de ${LIMITE_BACKFILL_DIARIO} pedaços de meses anteriores por dia já atingido. ` +
          `O backfill continua amanhã de onde parou — nenhum mês é perdido.`,
        )
    } else {
      // Em OS a cota é por mês: o mês corrente tem as 2 vagas dele, sem disputar
      // com backfill nem com outros meses.
      const enviadosHoje = await contarBackupsDoDia(licencaId, tipo, tipo === 'OS' ? periodo : undefined)
      if (enviadosHoje >= LIMITE_DIARIO[tipo])
        throw this.erro(
          HttpStatus.TOO_MANY_REQUESTS,
          'BACKUP_LIMITE_DIARIO',
          `Limite de ${LIMITE_DIARIO[tipo]} backup(s) de ${dados.tipo}` +
          `${tipo === 'OS' ? ` (${periodo})` : ''} por dia já atingido. Tente amanhã.`,
        )
    }

    const chave = this.montarChave(licenca.clienteId, licencaId, tipo, periodo)

    // Assina ANTES de gravar a linha. A linha é o que conta cota diária, então se
    // a assinatura falhar (bucket mal configurado, credencial vencida) o cliente
    // não pode sair com 2 de 2 backups "usados" num dia em que nada foi enviado.
    const { url, expiraEm } = await this.storage.gerarUrlUpload({
      chave,
      tamanhoBytes:   dados.tamanhoBytes,
      checksumSha256: dados.checksumSha256,
    })

    const registro = await criarBackup({
      clienteId:      licenca.clienteId,
      licencaId,
      hwid:           dados.hwid,
      tipo,
      periodo,
      chaveS3:        chave,
      origem:         dados.origem,
      tamanhoBytes:   dados.tamanhoBytes,
      checksumSha256: dados.checksumSha256 ?? null,
    })

    return {
      acao:     'ENVIAR',
      uploadId: registro.id,
      url,
      chave,
      periodo,
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

    const mesAtual = periodoAtual()

    const [ultimoBanco, ultimoImagens, pedacosOs, recentes] = await Promise.all([
      findUltimoBackupConfirmado(licencaId, 'BANCO'),
      findUltimoBackupConfirmado(licencaId, 'IMAGENS'),
      findPedacosDeOsConfirmados(licencaId),
      findBackupsRecentes(licencaId, 30),
    ])

    const enviadosHoje = {
      banco:   await contarBackupsDoDia(licencaId, 'BANCO'),
      imagens: await contarBackupsDoDia(licencaId, 'IMAGENS'),
      // Só o mês corrente: é contra esta cota que o ciclo diário compete.
      os:      await contarBackupsDoDia(licencaId, 'OS', mesAtual),
      backfill: await contarBackfillDoDia(licencaId, mesAtual),
    }

    return {
      planoPermiteBackup: motivo === null,
      /// Texto pronto para exibir. Para RAMIFICAR use o codigoBloqueio — este
      /// campo muda quando a redação melhorar.
      motivoBloqueio:     motivo?.mensagem ?? null,
      codigoBloqueio:     motivo?.codigo   ?? null,
      limiteDiario: {
        banco:    LIMITE_DIARIO.BANCO,
        imagens:  LIMITE_DIARIO.IMAGENS,
        os:       LIMITE_DIARIO.OS,
        backfill: LIMITE_BACKFILL_DIARIO,
      },
      enviadosHoje,
      tamanhoMaximoBytes: BACKUP_TAMANHO_MAX_BYTES,
      /// Mês que o ERP deve tratar como pedaço aberto. Vem do servidor porque o
      /// corte é no fuso de São Paulo pelo relógio DELE — se o ERP calcular
      /// sozinho, uma máquina com data errada fecharia o mês na hora errada.
      periodoCorrente: mesAtual,

      // Cópias que EXISTEM na nuvem hoje. Uma de banco, uma de imagens, e um
      // pedaço por mês de OS. O histórico abaixo é registro de eventos, não lista
      // de arquivos restauráveis — a tela precisa deixar isso claro para não
      // prometer restauração que não existe.
      copiaAtual: {
        banco:   ultimoBanco   ? this.resumo(ultimoBanco)   : null,
        imagens: ultimoImagens ? this.resumo(ultimoImagens) : null,
        os:      pedacosOs.map(p => ({ periodo: p.periodo, ...this.resumo(p) })),
      },

      historicoEventos: recentes.map(r => ({
        tipo:         r.tipo,
        periodo:      r.periodo,
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

    const tipo = this.paraTipoDb(dados.tipo)

    // Espelho tem uma cópia; OS tem uma por mês, e restaurar é baixar todas —
    // meio acervo restaurado é pior que nenhum, porque parece completo.
    const registros = tipo === 'OS'
      ? await findPedacosDeOsConfirmados(licencaId)
      : [await findUltimoBackupConfirmado(licencaId, tipo)].filter(r => r !== null)

    if (registros.length === 0)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'BACKUP_INEXISTENTE',
        `Nenhum backup de ${dados.tipo} confirmado para esta licença.`,
      )

    // Confere antes de assinar: link para objeto apagado pela retenção viraria
    // um 404 no meio do download, sem explicação para o cliente.
    const conferidos = await Promise.all(
      registros.map(async r => ({ registro: r, objeto: await this.storage.conferirObjeto(r.chaveS3) })),
    )

    const presentes = conferidos.filter(c => c.objeto !== null)

    // Pedaço registrado que sumiu do bucket é informado, nunca omitido em
    // silêncio: uma restauração com buracos que se apresenta como completa é o
    // pior resultado possível aqui.
    const indisponiveis = conferidos
      .filter(c => c.objeto === null)
      .map(c => c.registro.periodo ?? dados.tipo)

    if (presentes.length === 0)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'BACKUP_INEXISTENTE',
        'O backup registrado não está mais disponível na nuvem.',
      )

    const assinados = await Promise.all(
      presentes.map(async ({ registro, objeto }) => {
        const { url, expiraEm } = await this.storage.gerarUrlDownload(registro.chaveS3)
        return {
          expiraEm,
          arquivo: {
            periodo:      registro.periodo,
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
        `[backup] restauração incompleta — licenca=${licencaId} tipo=${tipo} ` +
        `pedaços ausentes na nuvem: ${indisponiveis.join(', ')}`,
      )

    this.logger.log(
      `[backup] download emitido — licenca=${licencaId} tipo=${tipo} ` +
      `arquivos=${arquivos.length} hwid=${dados.hwid}`,
    )

    return {
      tipo:     dados.tipo,
      arquivos,
      /// Pedaços que constam no registro mas não estão mais na nuvem. Lista vazia
      /// é o caso normal; qualquer item aqui significa restauração parcial, e a
      /// tela do ERP tem que dizer isso ao usuário antes de restaurar.
      indisponiveis,
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
    checksumSha256?:   string | null
  }) {
    return {
      tamanhoBytes:   r.tamanhoRealBytes ?? r.tamanhoBytes,
      geradoEm:       r.confirmadoEm ?? r.emitidoEm,
      hwid:           r.hwid ?? null,
      chave:          r.chaveS3 ?? null,
      checksumSha256: r.checksumSha256 ?? null,
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
