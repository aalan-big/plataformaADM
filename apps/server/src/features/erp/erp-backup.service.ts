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
  findUltimoBackupConfirmado,
  findBackupsRecentes,
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

const LIMITE_DIARIO: Record<TipoBackupDb, number> = {
  BANCO:   limiteDeEnv('BACKUP_LIMITE_DIARIO_BANCO',   2),
  IMAGENS: limiteDeEnv('BACKUP_LIMITE_DIARIO_IMAGENS', 1),
}

/// Se o backup de hoje vier com menos da metade do último confirmado, algo está
/// errado (banco truncado, ransomware, export pela metade). Com arquivo único e
/// sem versionamento, aceitar isso é sobrescrever a única cópia boa com lixo —
/// e não existe de onde voltar. Recusa e deixa o de ontem em paz.
const QUEDA_SUSPEITA = 0.5

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
      throw this.erro(HttpStatus.FORBIDDEN, 'BACKUP_PLANO_INATIVO', motivo)

    return licenca
  }

  /**
   * Regra única de "esta licença tem direito a backup", usada tanto pelo gate
   * quanto pelo /status (que precisa responder sem estourar exceção).
   *
   * Vale para upload E download: a decisão foi tratar backup como recurso do
   * plano ativo. Quem vence não perde o arquivo na hora — ele fica na nuvem pelo
   * período de retenção, e voltando a pagar dentro da janela recupera o acesso.
   */
  private motivoDeBloqueio(licenca: {
    status: string
    isTrial: boolean
    dataVencimento: Date | null
  }): string | null {
    if (licenca.isTrial)
      return 'Backup em nuvem não está disponível durante o período de teste.'

    if (licenca.status !== 'ATIVA')
      return `Licença ${licenca.status.toLowerCase()} — backup em nuvem indisponível.`

    if (licenca.dataVencimento && licenca.dataVencimento < new Date())
      return 'Licença vencida — backup em nuvem indisponível até a renovação.'

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
  private montarChave(clienteId: string, licencaId: string, tipo: TipoBackupDb): string {
    const arquivo = tipo === 'BANCO' ? 'banco.zip' : 'imagens.zip'
    return `clientes/${clienteId}/${licencaId}/${arquivo}`
  }

  private paraTipoDb(tipo: 'banco' | 'imagens'): TipoBackupDb {
    return tipo === 'banco' ? 'BANCO' : 'IMAGENS'
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

    // Imagens sem checksum não dá para deduplicar, e sem dedupe a mesma pasta de
    // 150 MB sobe todo dia sem nada ter mudado. É o maior desperdício possível.
    if (tipo === 'IMAGENS' && !dados.checksumSha256)
      throw this.erro(
        HttpStatus.BAD_REQUEST,
        'BACKUP_CHECKSUM_OBRIGATORIO',
        'checksumSha256 é obrigatório para backup de imagens.',
      )

    const ultimo = await findUltimoBackupConfirmado(licencaId, tipo)

    // Espelho de imagens: nada mudou, nada sobe. Resposta é sucesso, não erro —
    // o ERP deve tratar como "backup em dia".
    if (tipo === 'IMAGENS' && ultimo?.checksumSha256 && ultimo.checksumSha256 === dados.checksumSha256) {
      return {
        acao:      'PULAR',
        motivo:    'Nenhuma imagem mudou desde o último backup.',
        chave:     ultimo.chaveS3,
        ultimoEm:  ultimo.confirmadoEm ?? ultimo.emitidoEm,
      }
    }

    if (ultimo?.tamanhoRealBytes && dados.tamanhoBytes < ultimo.tamanhoRealBytes * QUEDA_SUSPEITA)
      throw this.erro(
        HttpStatus.CONFLICT,
        'BACKUP_TAMANHO_SUSPEITO',
        `Backup de ${this.mb(dados.tamanhoBytes)} é muito menor que o último enviado ` +
        `(${this.mb(ultimo.tamanhoRealBytes)}). Envio recusado para não sobrescrever a cópia boa. ` +
        `Se a redução é esperada, use o envio manual.`,
      )

    const enviadosHoje = await contarBackupsDoDia(licencaId, tipo)
    if (enviadosHoje >= LIMITE_DIARIO[tipo])
      throw this.erro(
        HttpStatus.TOO_MANY_REQUESTS,
        'BACKUP_LIMITE_DIARIO',
        `Limite de ${LIMITE_DIARIO[tipo]} backup(s) de ${dados.tipo} por dia já atingido. Tente amanhã.`,
      )

    const chave = this.montarChave(licenca.clienteId, licencaId, tipo)

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

    const [ultimoBanco, ultimoImagens, recentes] = await Promise.all([
      findUltimoBackupConfirmado(licencaId, 'BANCO'),
      findUltimoBackupConfirmado(licencaId, 'IMAGENS'),
      findBackupsRecentes(licencaId, 30),
    ])

    const enviadosHoje = {
      banco:   await contarBackupsDoDia(licencaId, 'BANCO'),
      imagens: await contarBackupsDoDia(licencaId, 'IMAGENS'),
    }

    return {
      planoPermiteBackup: motivo === null,
      motivoBloqueio:     motivo,
      limiteDiario:       { banco: LIMITE_DIARIO.BANCO, imagens: LIMITE_DIARIO.IMAGENS },
      enviadosHoje,
      tamanhoMaximoBytes: BACKUP_TAMANHO_MAX_BYTES,

      // Cópias que EXISTEM na nuvem hoje: no máximo uma de cada tipo. O histórico
      // abaixo é registro de eventos, não lista de arquivos restauráveis — a tela
      // precisa deixar isso claro para não prometer restauração que não existe.
      copiaAtual: {
        banco:   ultimoBanco   ? this.resumo(ultimoBanco)   : null,
        imagens: ultimoImagens ? this.resumo(ultimoImagens) : null,
      },

      historicoEventos: recentes.map(r => ({
        tipo:         r.tipo,
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

    const tipo   = this.paraTipoDb(dados.tipo)
    const ultimo = await findUltimoBackupConfirmado(licencaId, tipo)

    if (!ultimo)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'BACKUP_INEXISTENTE',
        `Nenhum backup de ${dados.tipo} confirmado para esta licença.`,
      )

    // Confere antes de assinar: link para objeto apagado pela retenção viraria
    // um 404 no meio do download, sem explicação para o cliente.
    const objeto = await this.storage.conferirObjeto(ultimo.chaveS3)
    if (!objeto)
      throw this.erro(
        HttpStatus.NOT_FOUND,
        'BACKUP_INEXISTENTE',
        'O backup registrado não está mais disponível na nuvem.',
      )

    const { url, expiraEm } = await this.storage.gerarUrlDownload(ultimo.chaveS3)

    this.logger.log(`[backup] download emitido — licenca=${licencaId} tipo=${tipo} hwid=${dados.hwid}`)

    return {
      url,
      chave:        ultimo.chaveS3,
      tamanhoBytes: objeto.tamanhoBytes,
      geradoEm:     ultimo.confirmadoEm ?? ultimo.emitidoEm,
      expiraEm:     expiraEm.toISOString(),
    }
  }

  // ── Formatação ────────────────────────────────────────────────────────────

  private resumo(r: {
    tamanhoRealBytes: number | null
    tamanhoBytes:     number
    confirmadoEm:     Date | null
    emitidoEm:        Date
    hwid:             string | null
    chaveS3:          string
  }) {
    return {
      tamanhoBytes: r.tamanhoRealBytes ?? r.tamanhoBytes,
      geradoEm:     r.confirmadoEm ?? r.emitidoEm,
      hwid:         r.hwid,
      chave:        r.chaveS3,
    }
  }

  private mb(bytes: number): string {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
}
