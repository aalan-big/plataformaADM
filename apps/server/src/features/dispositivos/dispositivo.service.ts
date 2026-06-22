/**
 * ============================================================================
 * NOME DO ARQUIVO: dispositivo.service.ts
 * MÓDULO: DISPOSITIVOS
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de DISPOSITIVOS. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 * 
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, NotFoundException, BadRequestException, OnModuleInit, Logger } from '@nestjs/common'
import { generateKeyPairSync }                                                        from 'crypto'
import { ZodError }                                                                   from 'zod'
import { randomUUID }                                                                 from 'crypto'
import jwt                                                                            from 'jsonwebtoken'
import {
  findLicencaById,
  findLicencasByClienteId,
  findAllLicencas,
  findLicencasExpirandoOuVencidas,
  criarLicenca,
  renovarLicencaComHistorico,
  registrarEventoLicenca,
  findHistoricoByLicenca,
  findAllPlanos,
  updateLicenca,
  findLicencaByChave,
  resetarConexoes,
  batchAtualizarHeartbeat,
  resetarSessoesInativas,
  deletarLicenca as deletarLicencaRepo,
  upsertLicencaSessao,
  countSessoesAtivas,
  deletarSessao,
  deletarTodasSessoesDaLicenca
} from '@startbig/database'
import {
  renovarLicencaSchema,
  criarLicencaSchema,
  conectarSchema,
  desconectarSchema,
  heartbeatSchema,
  validarSchema,
  validarCpf,
  validarCnpj
} from '@startbig/schemas'
import { EmailService } from '../../core/email/email.service'
import { z } from 'zod'

export const autoCadastroSchema = z.object({
  documento: z.string().transform(s => s.replace(/\D/g, '')),
  nomeOuRazao: z.string().min(2),
  email: z.string().email(),
  hwid: z.string().optional(),
  
  // Campos extras PF
  rg: z.string().optional(),
  dataNascimento: z.string().optional(),

  // Campos extras PJ
  nomeFantasia: z.string().optional(),
  inscricaoEstadual: z.string().optional(),
  inscricaoMunicipal: z.string().optional(),
  regimeTributario: z.string().optional(),
  telefone: z.string().optional(),
  celular: z.string().optional(),
  setorAtividade: z.string().optional(),
  logo: z.string().optional(),
  responsavel: z.string().optional(),

  // Endereço
  endereco: z.object({
    cep: z.string(),
    logradouro: z.string(),
    numero: z.string(),
    complemento: z.string().optional(),
    bairro: z.string(),
    cidade: z.string(),
    estado: z.string()
  }).optional()
})

const HEARTBEAT_TIMEOUT_MS = 35 * 60 * 1000   // sessão morta se sem heartbeat por 35 min
const CLEANUP_INTERVAL_MS  = 10 * 60 * 1000   // verifica sessões inativas a cada 10 min
const FLUSH_INTERVAL_MS    = 30 * 1000         // flush do buffer no banco a cada 30s
const GRACE_PERIOD_DIAS    = 7

// ── Carrega ou gera par de chaves RSA ────────────────────────────────────────
function carregarChaves(): { privateKey: string; publicKey: string } {
  const envPriv = process.env.LICENCA_PRIVATE_KEY
  const envPub  = process.env.LICENCA_PUBLIC_KEY

  if (envPriv && envPub) {
    return {
      privateKey: Buffer.from(envPriv, 'base64').toString('utf8'),
      publicKey:  Buffer.from(envPub,  'base64').toString('utf8'),
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength:      2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  console.warn('\n[LICENÇA] Chaves RS256 não configuradas — par temporário gerado para desenvolvimento.')
  console.warn('[LICENÇA] Adicione ao apps/server/.env para persistir entre reinicializações:\n')
  console.warn(`LICENCA_PRIVATE_KEY="${Buffer.from(privateKey).toString('base64')}"`)
  console.warn(`LICENCA_PUBLIC_KEY="${Buffer.from(publicKey).toString('base64')}"\n`)

  return { privateKey, publicKey }
}

const { privateKey: RSA_PRIVATE_KEY, publicKey: RSA_PUBLIC_KEY } = carregarChaves()

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class DispositivoService {
  private readonly logger   = new Logger(DispositivoService.name)

  constructor(private readonly emailService: EmailService) {}

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
    licencaId:       string
    hwid:            string | null
    plano?:          string | null
    limite:          number
    dataVencimento?: Date | null
  }): { token: string; ultimaSincronizacao: Date; gracePeriodDias: number; proximaValidacaoEm: Date } {
    const agora = new Date()

    // expiresIn = min(7 dias, segundos restantes até vencimento)
    const maxExpS = GRACE_PERIOD_DIAS * 24 * 60 * 60
    let expiresIn = maxExpS
    if (params.dataVencimento) {
      const restantesS = Math.floor((params.dataVencimento.getTime() - agora.getTime()) / 1000)
      expiresIn = Math.min(maxExpS, Math.max(60, restantesS))
    }

    // ERP deve revalidar em: min(24h, 1h antes do vencimento da licença)
    // Isso garante que o JWT nunca expira enquanto o ERP está rodando
    let proximaValidacaoEm = new Date(agora.getTime() + 24 * 60 * 60 * 1000)
    if (params.dataVencimento) {
      const umHoraAntes = new Date(params.dataVencimento.getTime() - 60 * 60 * 1000)
      if (umHoraAntes < proximaValidacaoEm) proximaValidacaoEm = umHoraAntes
    }
    if (proximaValidacaoEm <= agora) proximaValidacaoEm = new Date(agora.getTime() + 60_000)

    const token = jwt.sign(
      {
        licencaId:           params.licencaId,
        hwid:                params.hwid,
        plano:               params.plano,
        limite:              params.limite,
        dataVencimento:      params.dataVencimento?.toISOString(),
        ultimaSincronizacao: agora.toISOString(),
        gracePeriodDias:     GRACE_PERIOD_DIAS,
        proximaValidacaoEm:  proximaValidacaoEm.toISOString(),
      },
      RSA_PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn },
    )

    return { token, ultimaSincronizacao: agora, gracePeriodDias: GRACE_PERIOD_DIAS, proximaValidacaoEm }
  }

  getPublicKey(): string {
    return RSA_PUBLIC_KEY
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

    // Envia chave de ativação trial por email
    const licencaCompleta = await findLicencaById(licenca.id)
    if (licencaCompleta) {
      const nomeCliente = licencaCompleta.cliente.pf
        ? (licencaCompleta.cliente.pf.nomeCompleto ?? licencaCompleta.cliente.email)
        : (licencaCompleta.cliente.pj?.razaoSocial  ?? licencaCompleta.cliente.email)

      try {
        await this.emailService.enviarChaveAtivacao({
          email:           licencaCompleta.cliente.email,
          nomeCliente,
          chave:           licenca.chaveAtivacao,
          dataVencimento:  licenca.dataVencimento!,
          nomeDispositivo: licenca.nomeDispositivo ?? 'Seu dispositivo',
        })
      } catch (err) {
        this.logger.warn(`[email] Falha ao enviar trial para ${licencaCompleta.cliente.email}: ${err instanceof Error ? err.message : err}`)
      }
    }

    return { msg: 'Licença trial criada com sucesso', data: licenca }
  }

  async bloquear(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await deletarTodasSessoesDaLicenca(licencaId)
    await updateLicenca(licencaId, { status: 'BLOQUEADA', totalUsuarios: 0 })
    await registrarEventoLicenca(licencaId, { tipo: 'BLOQUEIO', chaveAtivacao: licenca.chaveAtivacao, observacao: 'Bloqueado pelo administrador' })
    return { msg: 'Licença bloqueada com sucesso.' }
  }

  async suspender(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await deletarTodasSessoesDaLicenca(licencaId)
    await updateLicenca(licencaId, { status: 'SUSPENSA', totalUsuarios: 0 })
    await registrarEventoLicenca(licencaId, { tipo: 'SUSPENSAO', chaveAtivacao: licenca.chaveAtivacao, observacao: 'Suspenso pelo administrador' })
    return { msg: 'Licença suspensa com sucesso.' }
  }

  async revogar(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await deletarTodasSessoesDaLicenca(licencaId)
    await updateLicenca(licencaId, { status: 'REVOGADA', totalUsuarios: 0 })
    await registrarEventoLicenca(licencaId, { tipo: 'REVOGACAO', chaveAtivacao: licenca.chaveAtivacao, observacao: 'Revogado pelo administrador' })
    return { msg: 'Licença revogada com sucesso.' }
  }

  async reativar(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await updateLicenca(licencaId, { status: 'ATIVA' })
    await registrarEventoLicenca(licencaId, { tipo: 'REATIVACAO', chaveAtivacao: licenca.chaveAtivacao, observacao: 'Reativado pelo administrador' })
    return { msg: 'Licença reativada com sucesso.' }
  }

  async resetarContadorUsuarios(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await deletarTodasSessoesDaLicenca(licencaId)
    await resetarConexoes(licencaId)
    return { msg: 'Contador de usuários zerado com sucesso.' }
  }

  async adicionarUsuarioExtra(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    const novoExtra = (licenca.usuariosExtras ?? 0) + 1
    await updateLicenca(licencaId, { usuariosExtras: novoExtra })
    return { msg: 'Usuário extra adicionado.', usuariosExtras: novoExtra }
  }

  async removerUsuarioExtra(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    if ((licenca.usuariosExtras ?? 0) <= 0)
      throw new BadRequestException('Não há usuários extras para remover.')
    const novoExtra = (licenca.usuariosExtras ?? 0) - 1
    await updateLicenca(licencaId, { usuariosExtras: novoExtra })
    return { msg: 'Usuário extra removido.', usuariosExtras: novoExtra }
  }

  async trocarDispositivo(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await deletarTodasSessoesDaLicenca(licencaId)
    await resetarConexoes(licencaId)
    return { msg: 'Sessões encerradas. O cliente pode conectar de uma nova máquina.' }
  }

  async deletarLicenca(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    await deletarTodasSessoesDaLicenca(licencaId)
    try {
      await deletarLicencaRepo(licencaId)
    } catch (e) {
      if (e instanceof Error && e.message === 'TEM_PAGAMENTOS')
        throw new BadRequestException('Esta licença possui histórico de pagamentos e não pode ser excluída. Use "Revogar" para desativá-la permanentemente.')
      throw e
    }
    return { msg: 'Licença excluída com sucesso.' }
  }

  async listarAlertasVencimento(diasAlerta = 30) {
    return findLicencasExpirandoOuVencidas(diasAlerta)
  }

  async renovar(licencaId: string, body: unknown) {
    const { meses } = this.parseBody(renovarLicencaSchema, body ?? {})
    const licenca   = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const nomeCliente = licenca.cliente.pf
      ? (licenca.cliente.pf.nomeCompleto ?? licenca.cliente.email)
      : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

    const base = licenca.dataVencimento && licenca.dataVencimento > new Date()
      ? new Date(licenca.dataVencimento) : new Date()

    const dataVencimento = new Date(base)
    dataVencimento.setMonth(dataVencimento.getMonth() + meses)

    // Reutiliza a chave de ativação atual (Automatização sem atrito para o cliente)
    const chaveAtivacao = licenca.chaveAtivacao
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

    const limite    = (licenca.plano?.limiteUsuario ?? 1) + (licenca.usuariosExtras ?? 0)
    const countSessoes = await countSessoesAtivas(licenca.id)
    
    // Se HWID fornecido e já estava conectado -> reconexão (não consome novo slot)
    const hwidKey   = dados.hwid ?? `anon-${randomUUID()}`
    
    // Verifica se este dispositivo específico já tem sessão
    let reconexao = false
    try {
        const { prisma } = require('@startbig/database')
        const sessao = await prisma.licencaSessao.findUnique({
            where: { licencaId_hwid: { licencaId: licenca.id, hwid: hwidKey } }
        })
        reconexao = !!sessao
    } catch(e) {}

    if (!reconexao && countSessoes >= limite) {
      throw new BadRequestException(
        `Limite de ${limite} dispositivo(s) simultâneo(s) atingido. Encerre outra sessão e tente novamente.`
      )
    }

    await upsertLicencaSessao(licenca.id, hwidKey)
    const novoTotalSessoes = reconexao ? countSessoes : countSessoes + 1
    await updateLicenca(licenca.id, { totalUsuarios: novoTotalSessoes, ultimoHeartbeat: new Date() })

    const assinado = this.assinarToken({
      licencaId:      licenca.id,
      hwid:           dados.hwid ?? null,
      plano:          licenca.plano?.nome,
      limite,
      dataVencimento: licenca.dataVencimento,
    })

    return {
      msg:            reconexao ? 'Reconexão autorizada.' : 'Conexão autorizada.',
      licencaId:      licenca.id,
      sessionKey:     hwidKey,   // ERP usa como hwid em /desconectar e /heartbeat
      limite,
      dataVencimento: licenca.dataVencimento,
      ...assinado,
    }
  }

  async desconectar(body: unknown) {
    const dados   = this.parseBody(desconectarSchema, body)
    const licenca = await findLicencaByChave(dados.chave)
    if (!licenca) return { msg: 'OK' }

    if (dados.hwid) {
      await deletarSessao(licenca.id, dados.hwid)
      const restantes = await countSessoesAtivas(licenca.id)
      await updateLicenca(licenca.id, { totalUsuarios: restantes }).catch(() => {})
    }

    return { msg: 'Desconectado.' }
  }

  async heartbeat(body: unknown) {
    const dados   = this.parseBody(heartbeatSchema, body)
    
    // Validação em Tempo Real: checa se a licença mãe foi bloqueada/suspensa
    const licenca = await findLicencaById(dados.licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')
    if (licenca.status !== 'ATIVA') {
      throw new BadRequestException(`Licença ${licenca.status.toLowerCase()}. Conexão encerrada pelo servidor.`)
    }

    if (dados.hwid) {
      await upsertLicencaSessao(dados.licencaId, dados.hwid)
    }
    
    // Atualiza a mãe de forma leve para saber que há atividade
    await updateLicenca(dados.licencaId, { ultimoHeartbeat: new Date() })

    return { ok: true }
  }

  async validar(body: unknown) {
    const dados   = this.parseBody(validarSchema, body)
    const licenca = await findLicencaByChave(dados.chave)
    if (!licenca) return { valida: false, motivo: 'Licença não encontrada.' }

    // Rejeição imediata — sem grace period
    const MOTIVOS_REJEICAO: Partial<Record<string, string>> = {
      BLOQUEADA: 'Licença bloqueada. Contate o suporte.',
      SUSPENSA:  'Licença suspensa. Contate o suporte.',
      REVOGADA:  'Licença revogada.',
    }
    const motivoRejeicao = MOTIVOS_REJEICAO[licenca.status as string]
    if (motivoRejeicao) return { valida: false, motivo: motivoRejeicao, status: licenca.status as string }

    // Verificar vencimento
    const vencida = licenca.status === 'VENCIDA' || (licenca.dataVencimento && licenca.dataVencimento < new Date())
    if (vencida) {
      if (licenca.status !== 'VENCIDA') await updateLicenca(licenca.id, { status: 'VENCIDA' })
      return { valida: false, motivo: 'Licença vencida.', status: 'VENCIDA', dataVencimento: licenca.dataVencimento }
    }

    // Primeira ativação: AGUARDANDO → ATIVA
    const agora = new Date()
    if (licenca.status === 'AGUARDANDO') {
      await updateLicenca(licenca.id, { status: 'ATIVA', dataAtivacao: agora })
    }

    const statusFinal = licenca.status === 'AGUARDANDO' ? 'ATIVA' : licenca.status
    const limite      = (licenca.plano?.limiteUsuario ?? 1) + (licenca.usuariosExtras ?? 0)

    await updateLicenca(licenca.id, { ultimaSincronizacao: agora })
    const assinado = this.assinarToken({
      licencaId:      licenca.id,
      hwid:           dados.hwid ?? null,
      plano:          licenca.plano?.nome,
      limite,
      dataVencimento: licenca.dataVencimento,
    })

    return {
      valida:         true,
      licencaId:      licenca.id,
      status:         statusFinal,
      dataVencimento: licenca.dataVencimento,
      ...assinado,
    }
  }

  async autoCadastro(body: unknown) {
    const dados = this.parseBody(autoCadastroSchema, body)

    // Deduz o tipo pelo tamanho do documento: 11 = CPF (PF), 14 = CNPJ (PJ)
    const isPF = dados.documento.length === 11

    // 1. Validação matemática
    if (isPF) {
      if (!validarCpf(dados.documento)) throw new BadRequestException('CPF inválido matematicamente.')
    } else {
      if (!validarCnpj(dados.documento)) throw new BadRequestException('CNPJ inválido matematicamente.')

      // 2. Validação BrasilAPI para CNPJ
      try {
        const receitaRes = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${dados.documento}`)
        if (receitaRes.status === 404) {
          throw new BadRequestException('CNPJ não encontrado na Receita Federal. Verifique o número informado.')
        }
        if (!receitaRes.ok) {
          this.logger.warn(`[BrasilAPI] Status ${receitaRes.status} ao consultar CNPJ ${dados.documento} — prosseguindo sem validação online.`)
        } else {
          const receita = await receitaRes.json() as any
          if (receita.situacao_cadastral !== 2) {
            throw new BadRequestException(`Cadastro negado. CNPJ encontra-se: ${receita.descricao_situacao_cadastral || 'INATIVO'}`)
          }
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        this.logger.warn(`[BrasilAPI] Falha de rede ao consultar CNPJ ${dados.documento} — prosseguindo sem validação online.`)
      }
    }

    const { prisma } = require('@startbig/database')

    // 3. Pegar um usuário ADMIN padrão para ser o "dono" do cliente
    const admin = await prisma.usuario.findFirst({ where: { tipoUsuario: 'ADMIN' } })
    if (!admin) throw new BadRequestException('Sistema não configurado para auto-cadastro (Sem administrador master).')

    // 4. Pegar o plano base ou criar um Trial
    let plano = await prisma.plano.findFirst({ where: { precoMensal: 0 } })
    if (!plano) plano = await prisma.plano.findFirst()
    if (!plano) throw new BadRequestException('Nenhum plano cadastrado no sistema para vincular a licença.')

    // 5. Verificar se cliente já existe
    const existeEmail = await prisma.cliente.findFirst({ where: { email: dados.email } })
    if (existeEmail) throw new BadRequestException('E-mail já cadastrado no sistema.')

    if (isPF) {
      const existeCPF = await prisma.clientePF.findFirst({ where: { cpf: dados.documento } })
      if (existeCPF) throw new BadRequestException('CPF já cadastrado.')
    } else {
      const existeCNPJ = await prisma.clientePJ.findFirst({ where: { cnpj: dados.documento } })
      if (existeCNPJ) throw new BadRequestException('CNPJ já cadastrado.')
    }

    // 6. Criar Cliente
    let clienteId = ''
    
    // Preparar bloco de endereço se houver
    const enderecoData = dados.endereco ? {
      enderecos: {
        create: {
          tipo: 'PRINCIPAL',
          cep: dados.endereco.cep,
          logradouro: dados.endereco.logradouro,
          numero: dados.endereco.numero,
          complemento: dados.endereco.complemento,
          bairro: dados.endereco.bairro,
          cidade: dados.endereco.cidade,
          estado: dados.endereco.estado
        }
      }
    } : {}

    if (isPF) {
      const c = await prisma.cliente.create({
        data: {
          email: dados.email, usuarioId: admin.id,
          pf: { create: {
            nomeCompleto: dados.nomeOuRazao,
            cpf: dados.documento,
            rg: dados.rg,
            dataNascimento: dados.dataNascimento ? new Date(dados.dataNascimento) : undefined
          } },
          ...enderecoData
        }
      })
      clienteId = c.id
    } else {
      const c = await prisma.cliente.create({
        data: {
          email: dados.email, usuarioId: admin.id,
          pj: { create: {
            razaoSocial: dados.nomeOuRazao,
            cnpj: dados.documento,
            nomeFantasia: dados.nomeFantasia,
            inscricaoEstadual: dados.inscricaoEstadual,
            inscricaoMunicipal: dados.inscricaoMunicipal,
            regimeTributario: dados.regimeTributario,
            telefone: dados.telefone,
            celular: dados.celular,
            setorAtividade: dados.setorAtividade,
            logo: dados.logo,
            responsavel: dados.responsavel
          } },
          ...enderecoData
        }
      })
      clienteId = c.id
    }

    // 7. Criar Licença
    const agora = new Date()
    const vencimento = new Date(agora.getTime() + 14 * 24 * 60 * 60 * 1000) // 14 dias de trial
    const hwidKey = dados.hwid ?? `anon-${randomUUID()}`

    const licenca = await criarLicenca({
       clienteId,
       planoId: plano.id,
       nomeDispositivo: 'Auto-Cadastro ERP',
       dias: 14
    })
    
    // Atualiza status para ATIVA, isTrial para true e registra a sessão
    await updateLicenca(licenca.id, { 
      status: 'ATIVA', 
      isTrial: true, 
      dataVencimento: vencimento,
      dataAtivacao: agora,
      ultimaSincronizacao: agora,
      totalUsuarios: 1
    })

    await upsertLicencaSessao(licenca.id, hwidKey)

    // 8. Assinar Token
    const assinado = this.assinarToken({
      licencaId:      licenca.id,
      hwid:           hwidKey,
      plano:          plano.nome,
      limite:         plano.limiteUsuario,
      dataVencimento: vencimento,
    })

    // 9. Enviar e-mail de boas-vindas com a chave de ativação
    try {
      await this.emailService.enviarChaveAtivacao({
        email:           dados.email,
        nomeCliente:     dados.nomeOuRazao,
        chave:           licenca.chaveAtivacao,
        dataVencimento:  vencimento,
        nomeDispositivo: 'Auto-Cadastro ERP',
      })
    } catch (err) {
      this.logger.warn(`[email] Falha ao enviar boas-vindas para ${dados.email}: ${err instanceof Error ? err.message : err}`)
    }

    return {
      msg: 'Auto-cadastro concluído com sucesso. Licença Trial de 14 dias gerada.',
      clienteId,
      licencaId: licenca.id,
      chaveAtivacao: licenca.chaveAtivacao,
      sessionKey: hwidKey,
      limite: plano.limiteUsuario,
      dataVencimento: vencimento,
      ...assinado
    }
  }
}
