import { Injectable, NotFoundException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common'
import { ZodError } from 'zod'
import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import {
  findLicencaById,
  findLicencasByClienteId,
  findAllLicencas,
  criarLicenca,
  renovarLicencaComHistorico,
  findHistoricoByLicenca,
  findAllPlanos,
  updateLicenca,
  findLicencaByChave,
  incrementarConexao,
  decrementarConexao,
  resetarConexoes,
  batchAtualizarHeartbeat,
  resetarSessoesInativas,
} from '@startbig/database'
import {
  renovarLicencaSchema,
  criarLicencaSchema,
  conectarSchema,
  desconectarSchema,
  heartbeatSchema,
  validarSchema,
} from '@startbig/schemas'
import { EmailService } from '../../core/email/email.service'

const HEARTBEAT_TIMEOUT_MS = 5  * 60 * 1000
const CLEANUP_INTERVAL_MS  = 3  * 60 * 1000
const FLUSH_INTERVAL_MS    = 30 * 1000
const GRACE_PERIOD_DIAS    = 7

@Injectable()
export class DispositivoService implements OnModuleInit {
  private readonly logger   = new Logger(DispositivoService.name)
  private readonly hbBuffer = new Set<string>()

  constructor(private readonly emailService: EmailService) {}

  onModuleInit() {
    setInterval(() => this.flushHeartbeats(),       FLUSH_INTERVAL_MS)
    setInterval(() => this.limparSessoesInativas(), CLEANUP_INTERVAL_MS)
    this.logger.log('Sistema de heartbeat iniciado (flush: 30s | cleanup: 3min)')
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }
  }

  private assinarToken(params: {
    licencaId:      string
    hwid:           string | null
    plano?:         string | null
    limite:         number
    dataVencimento?: Date | null
  }): { token: string; ultimaSincronizacao: Date; gracePeriodDias: number } {
    const agora  = new Date()
    const secret = process.env.LICENCA_JWT_SECRET ?? process.env.JWT_SECRET ?? 'chave-secreta-de-desenvolvimento'
    const token  = jwt.sign(
      {
        licencaId:           params.licencaId,
        hwid:                params.hwid,
        plano:               params.plano,
        limite:              params.limite,
        dataVencimento:      params.dataVencimento?.toISOString(),
        ultimaSincronizacao: agora.toISOString(),
        gracePeriodDias:     GRACE_PERIOD_DIAS,
      },
      secret,
      { expiresIn: `${GRACE_PERIOD_DIAS}d` },
    )
    return { token, ultimaSincronizacao: agora, gracePeriodDias: GRACE_PERIOD_DIAS }
  }

  // ── Intervals ─────────────────────────────────────────────────────────────

  private async flushHeartbeats() {
    if (this.hbBuffer.size === 0) return
    const ids = [...this.hbBuffer]
    this.hbBuffer.clear()
    await batchAtualizarHeartbeat(ids)
    this.logger.debug(`Heartbeat flush: ${ids.length} sessões`)
  }

  private async limparSessoesInativas() {
    const antes  = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS)
    const result = await resetarSessoesInativas(antes)
    if (result.count > 0)
      this.logger.log(`Sessões inativas resetadas: ${result.count}`)
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async listarPlanos() {
    return findAllPlanos()
  }

  async listarTodas(filtro: { status?: string; isTrial?: string; q?: string }) {
    return findAllLicencas({
      status:  filtro.status  || undefined,
      isTrial: filtro.isTrial !== undefined ? filtro.isTrial === 'true' : undefined,
      q:       filtro.q       || undefined,
    })
  }

  async buscarPorId(id: string) {
    const licenca = await findLicencaById(id)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    const historico = await findHistoricoByLicenca(id)
    return { ...licenca, historico }
  }

  async buscarPorCliente(clienteId: string) {
    return findLicencasByClienteId(clienteId)
  }

  // ── Ações admin ───────────────────────────────────────────────────────────

  async criarLicenca(body: unknown) {
    const dados   = this.parseBody(criarLicencaSchema, body)
    const licenca = await criarLicenca({
      clienteId:       dados.clienteId,
      planoId:         dados.planoId,
      nomeDispositivo: dados.nomeDispositivo,
      dias:            dados.dias,
    })
    return { msg: 'Licença trial criada com sucesso', data: licenca }
  }

  async bloquear(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await updateLicenca(licencaId, { status: 'BLOQUEADA' })
    return { msg: 'Licença bloqueada com sucesso.' }
  }

  async reativar(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await updateLicenca(licencaId, { status: 'ATIVA' })
    return { msg: 'Licença reativada com sucesso.' }
  }

  async resetarSessoes(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await resetarConexoes(licencaId)
    return { msg: 'Sessões resetadas com sucesso.' }
  }

  async trocarDispositivo(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await resetarConexoes(licencaId)
    return { msg: 'Dispositivo desvinculado. O cliente pode conectar de uma nova máquina.' }
  }

  async renovar(licencaId: string, body: unknown) {
    const { meses } = this.parseBody(renovarLicencaSchema, body ?? {})
    const licenca   = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const nomeCliente = licenca.cliente.tipo === 'PF'
      ? (licenca.cliente.pf?.nomeCompleto ?? licenca.cliente.email)
      : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

    const base = licenca.dataVencimento && licenca.dataVencimento > new Date()
      ? new Date(licenca.dataVencimento) : new Date()

    const dataVencimento = new Date(base)
    dataVencimento.setMonth(dataVencimento.getMonth() + meses)

    const chaveAtivacao = `START-${randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase()}`
    await renovarLicencaComHistorico(licencaId, { chaveAtivacao, dataVencimento, meses, ultimoPagamento: new Date() })

    let emailEnviado = false
    try {
      await this.emailService.enviarChaveAtivacao({
        email:           licenca.cliente.email,
        nomeCliente,
        chave:           chaveAtivacao,
        dataVencimento,
        nomeDispositivo: licenca.nomeDispositivo ?? 'Dispositivo',
      })
      emailEnviado = true
    } catch (err) {
      console.warn('[email] falha ao enviar chave — SMTP não configurado?', err instanceof Error ? err.message : err)
    }

    return {
      msg: emailEnviado
        ? 'Licença renovada e chave enviada por e-mail'
        : 'Licença renovada — e-mail não enviado (SMTP não configurado)',
      data: {
        id:              licencaId,
        chaveAtivacao,
        dataVencimento,
        ultimoPagamento: new Date(),
        emailEnviado:    emailEnviado ? licenca.cliente.email : null,
      },
    }
  }

  // ── Endpoints do ERP (públicos) ───────────────────────────────────────────

  async conectar(body: unknown) {
    const dados   = this.parseBody(conectarSchema, body)
    const licenca = await findLicencaByChave(dados.chave)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    if (licenca.status !== 'ATIVA')
      throw new BadRequestException(`Licença ${licenca.status.toLowerCase()}. Acesso negado.`)

    if (licenca.dataVencimento && licenca.dataVencimento < new Date()) {
      await updateLicenca(licenca.id, { status: 'VENCIDA' })
      throw new BadRequestException('Licença vencida.')
    }

    const limite = licenca.plano?.limiteUsuario ?? 1

    if ((licenca.totalUsuarios ?? 0) >= limite)
      throw new BadRequestException(
        `Limite de ${limite} usuário${limite > 1 ? 's' : ''} simultâneo${limite > 1 ? 's' : ''} atingido. Desconecte outro dispositivo e tente novamente.`
      )

    await incrementarConexao(licenca.id)
    const assinado = this.assinarToken({
      licencaId:     licenca.id,
      hwid:          dados.hwid,
      plano:         licenca.plano?.nome,
      limite,
      dataVencimento: licenca.dataVencimento,
    })

    return { msg: 'Conexão autorizada.', licencaId: licenca.id, limite, dataVencimento: licenca.dataVencimento, ...assinado }
  }

  async desconectar(body: unknown) {
    const dados   = this.parseBody(desconectarSchema, body)
    const licenca = await findLicencaByChave(dados.chave)
    if (!licenca) return { msg: 'OK' }
    await decrementarConexao(licenca.id)
    return { msg: 'Desconectado.' }
  }

  async heartbeat(body: unknown) {
    const dados = this.parseBody(heartbeatSchema, body)
    this.hbBuffer.add(dados.licencaId)
    return { ok: true }
  }

  async validar(body: unknown) {
    const dados   = this.parseBody(validarSchema, body)
    const licenca = await findLicencaByChave(dados.chave)
    if (!licenca) return { valida: false, motivo: 'Licença não encontrada.' }

    if (licenca.status === 'BLOQUEADA')
      return { valida: false, motivo: 'Licença bloqueada.', status: 'BLOQUEADA' }

    const vencida = licenca.status === 'VENCIDA' || (licenca.dataVencimento && licenca.dataVencimento < new Date())
    if (vencida) {
      await updateLicenca(licenca.id, { status: 'VENCIDA' })
      return { valida: false, motivo: 'Licença vencida.', status: 'VENCIDA', dataVencimento: licenca.dataVencimento }
    }

    const limite = licenca.plano?.limiteUsuario ?? 1

    await updateLicenca(licenca.id, { ultimaSincronizacao: new Date() })
    const assinado = this.assinarToken({
      licencaId:     licenca.id,
      hwid:          dados.hwid ?? null,
      plano:         licenca.plano?.nome,
      limite,
      dataVencimento: licenca.dataVencimento,
    })

    return { valida: true, status: licenca.status, dataVencimento: licenca.dataVencimento, ...assinado }
  }
}
