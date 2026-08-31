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
import bcrypt                                                                         from 'bcryptjs'
import {
  findLicencaById,
  findLicencasByClienteId,
  findAllLicencas,
  findLicencasExpirandoOuVencidas,
  criarLicenca,
  renovarLicencaComHistorico,
  darCortesiaEmDias,
  registrarEventoLicenca,
  findHistoricoByLicenca,
  findAllPlanos,
  findPlanoById,
  updateLicenca,
  findLicencaByChave,
  resetarConexoes,
  batchAtualizarHeartbeat,
  resetarSessoesInativas,
  deletarLicenca as deletarLicencaRepo,
  upsertLicencaSessao,
  countSessoesAtivas,
  deletarSessao,
  deletarTodasSessoesDaLicenca,
  modulosDaLicenca
} from '@startbig/database'
import {
  renovarLicencaSchema,
  cortesiaLicencaSchema,
  criarLicencaSchema,
  conectarSchema,
  desconectarSchema,
  heartbeatSchema,
  validarSchema,
  validarCpf,
  validarCnpj
} from '@startbig/schemas'
import { EmailService } from '../../core/email/email.service'
import { StripeService } from '../../common/stripe/stripe.service'
import { dominioDeEmailExiste } from '../../core/validators/email-dominio.validator'
import { z } from 'zod'

export const autoCadastroSchema = z.object({
  documento: z.string().transform(s => s.replace(/\D/g, '')),
  nomeOuRazao: z.string().min(2),
  email: z.string().email(),
  senha: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres.'),
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

/**
 * Módulos do plano, no formato que `modulosDaLicenca` espera.
 *
 * Só o auto-cadastro precisa disto: ali a licença acaba de nascer e o plano vem
 * de uma busca própria, fora do `findLicencaByChave` que já traz tudo incluído.
 */
const INCLUDE_MODULOS_DO_PLANO = {
  modulos: { select: { cotaMensal: true, modulo: { select: { identificador: true, ativo: true } } } },
} as const

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

  constructor(
    private readonly emailService:  EmailService,
    private readonly stripeService: StripeService,
  ) {}

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

  /**
   * A licença venceu, mas o cartão está em retentativa e o acesso continua?
   *
   * `carenciaAte` só é preenchido quando o Stripe avisa que a cobrança falhou.
   * Quem paga por PIX nunca tem esse campo — PIX não falha sozinho, então
   * trava no vencimento. A janela é escrita uma única vez por falha e some na
   * renovação ou no cancelamento da assinatura.
   */
  private carenciaVigente(licenca: { carenciaAte?: Date | null }): boolean {
    return !!licenca.carenciaAte && licenca.carenciaAte > new Date()
  }

  private assinarToken(params: {
    licencaId:       string
    hwid:            string | null
    plano?:          string | null
    limite:          number
    dataVencimento?: Date | null
    carenciaAte?:    Date | null
    /**
     * Módulos liberados. Chega pronto porque este método é síncrono e precisa
     * continuar sendo: torná-lo async por causa de uma consulta espalharia
     * `await` pelos três chamadores sem ganho nenhum — quem chama já tem a
     * licença carregada com os módulos dentro.
     */
    modulos?:        string[]
  }): {
    token: string
    ultimaSincronizacao: Date
    gracePeriodDias: number
    proximaValidacaoEm: Date
    emCarencia: boolean
    dataLimiteCarencia: Date | null
    diasRestantesCarencia: number | null
    diasRestantes: number | null
  } {
    const agora = new Date()

    const emCarencia = !!params.carenciaAte && params.carenciaAte > agora

    /**
     * Até quando este token pode valer.
     *
     * Na carência é ela que manda, e não o vencimento — que já passou. Sem esta
     * troca o cálculo abaixo cairia no piso de 60 segundos (restantes negativos)
     * e o ERP revalidaria de minuto em minuto durante a semana inteira,
     * martelando a API justamente no cliente com problema de pagamento.
     */
    const horizonte = emCarencia ? params.carenciaAte! : (params.dataVencimento ?? null)

    // expiresIn = min(7 dias, segundos restantes até o horizonte)
    const maxExpS = GRACE_PERIOD_DIAS * 24 * 60 * 60
    let expiresIn = maxExpS
    if (horizonte) {
      const restantesS = Math.floor((horizonte.getTime() - agora.getTime()) / 1000)
      expiresIn = Math.min(maxExpS, Math.max(60, restantesS))
    }

    // ERP deve revalidar em: min(24h, 1h antes do horizonte)
    // Isso garante que o JWT nunca expira enquanto o ERP está rodando
    let proximaValidacaoEm = new Date(agora.getTime() + 24 * 60 * 60 * 1000)
    if (horizonte) {
      const umHoraAntes = new Date(horizonte.getTime() - 60 * 60 * 1000)
      if (umHoraAntes < proximaValidacaoEm) proximaValidacaoEm = umHoraAntes
    }
    if (proximaValidacaoEm <= agora) proximaValidacaoEm = new Date(agora.getTime() + 60_000)

    const diasRestantesCarencia = emCarencia
      ? Math.max(0, Math.ceil((params.carenciaAte!.getTime() - agora.getTime()) / 86_400_000))
      : null

    /**
     * Dias até o vencimento, para o ERP exibir a contagem em QUALQUER licença —
     * não só nas de teste.
     *
     * O ERP já podia derivar isto do `dataVencimento` que sempre mandamos, mas
     * calculado NA MÁQUINA DO CLIENTE ele depende do relógio dela: um PC com a
     * data errada mostraria ao lojista um número que não é o que o servidor
     * considera. É a mesma razão pela qual o ciclo de backup é calculado aqui e
     * lido de lá, nunca o contrário.
     *
     * Fica FORA do token assinado de propósito: o JWT vive até 7 dias, e um
     * número de dias congelado dentro dele mostraria "faltam 30" na semana
     * inteira. Este campo vai no corpo, recalculado a cada validação.
     *
     * Nulo quando a licença não tem vencimento. Zero significa vencida hoje —
     * o que não é o mesmo que bloqueada, que continua sendo o `status`.
     */
    const diasRestantes = params.dataVencimento
      ? Math.max(0, Math.ceil((params.dataVencimento.getTime() - agora.getTime()) / 86_400_000))
      : null

    const token = jwt.sign(
      {
        licencaId:           params.licencaId,
        hwid:                params.hwid,
        plano:               params.plano,
        limite:              params.limite,
        // O vencimento REAL continua aqui, não o limite da carência: o cliente
        // precisa saber desde quando está devendo, e o ERP não pode confundir
        // "tolerado até" com "pago até".
        dataVencimento:      params.dataVencimento?.toISOString(),
        ultimaSincronizacao: agora.toISOString(),
        gracePeriodDias:     GRACE_PERIOD_DIAS,
        proximaValidacaoEm:  proximaValidacaoEm.toISOString(),
        // Dentro do token assinado, e não só no corpo da resposta: é um campo
        // que LIBERA acesso, e todo campo que libera acesso viaja assinado —
        // senão ele seria o único elo da corrente que dá para forjar no caminho.
        emCarencia,
        dataLimiteCarencia:  emCarencia ? params.carenciaAte!.toISOString() : null,
        /**
         * Módulos liberados, dentro do token assinado pelo mesmo motivo do
         * `emCarencia`: é campo que LIBERA acesso, e campo que libera acesso
         * viaja assinado — senão seria o elo da corrente que dá para forjar no
         * caminho entre a API e o ERP.
         *
         * Claim ADITIVA: ERP que não a conhece ignora e continua funcionando
         * igual. É o que permite subir isto sem nenhuma coordenação com o ERP
         * em campo, e é o que torna a trava da próxima fase segura — quando ela
         * ligar, todo token no ar já vai carregar a lista.
         */
        modulos:             params.modulos ?? [],
      },
      RSA_PRIVATE_KEY,
      { algorithm: 'RS256', expiresIn },
    )

    return {
      token,
      diasRestantes,
      ultimaSincronizacao: agora,
      gracePeriodDias:     GRACE_PERIOD_DIAS,
      proximaValidacaoEm,
      emCarencia,
      dataLimiteCarencia:  emCarencia ? params.carenciaAte! : null,
      diasRestantesCarencia,
    }
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

  // Troca de plano no padrão SaaS: upgrade vale na hora (cobrança proporcional),
  // downgrade só no fim do ciclo já pago. Usa a assinatura existente (cartão salvo),
  // sem gerar assinatura nova — o que também elimina a duplicidade na raiz.
  //
  // Esta rota NÃO move licença de graça. Ela existe para o cliente que já tem
  // assinatura ativa: o Stripe cobra a diferença e a licença acompanha. Sem
  // assinatura não há cartão para cobrar aqui, e o caminho passa a ser o link de
  // pagamento — o checkout carrega o plano de destino e o webhook move a licença
  // depois que o dinheiro entra. Os dois caminhos juntos cobrem a base inteira,
  // e em nenhum deles o plano muda antes do pagamento.
  async trocarPlano(licencaId: string, body: unknown) {
    const planoId = (body as { planoId?: string })?.planoId
    if (!planoId || typeof planoId !== 'string')
      throw new BadRequestException('planoId é obrigatório.')

    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const planoNovo = await findPlanoById(planoId)
    if (!planoNovo || planoNovo.status !== 'ATIVO')
      throw new NotFoundException('Plano não encontrado ou inativo.')
    if (planoNovo.id === licenca.planoId)
      throw new BadRequestException('A licença já está neste plano.')

    // A licença pode carregar um stripeSubscriptionId que não existe mais nesta
    // conta/modo — típico depois da virada de test para live, onde a assinatura
    // antiga é de outro catálogo. `assinaturaAtiva` trata esse caso como "não
    // tem assinatura"; falha de comunicação com o Stripe, essa sim, estoura.
    const subId = licenca.stripeSubscriptionId && await this.stripeService.assinaturaAtiva(licenca.stripeSubscriptionId)
      ? licenca.stripeSubscriptionId
      : null

    // Sem assinatura recorrente ativa (trial / pagamento manual / assinatura
    // cancelada): não existe cartão para cobrar a diferença, e mover a licença
    // aqui seria entregar o plano novo de graça. Manda para o fluxo pago.
    if (!subId)
      throw new BadRequestException(
        `Esta licença não tem assinatura ativa no Stripe, então não há como cobrar a troca por aqui. ` +
        `Gere o link de pagamento com "${planoNovo.nome}" selecionado: a licença passa para o plano novo sozinha assim que o pagamento cair.`,
      )

    // Com assinatura: mantém o mesmo período de cobrança e usa o Price equivalente do novo plano.
    const periodo = await this.stripeService.periodoDaSubscription(subId)
    const priceDoPeriodo = (p: any): string | null =>
      periodo === 'anual'        ? p.stripePriceIdAnual
      : periodo === 'trimestral' ? p.stripePriceIdTrimestral
      :                            p.stripePriceIdMensal
    const precoDoPeriodo = (p: any): number =>
      periodo === 'anual'        ? Number(p.precoAnual      ?? p.precoMensal)
      : periodo === 'trimestral' ? Number(p.precoTrimestral ?? p.precoMensal)
      :                            Number(p.precoMensal)

    const novoPriceId = priceDoPeriodo(planoNovo)
    if (!novoPriceId)
      throw new BadRequestException(`O plano "${planoNovo.nome}" não tem Stripe Price ID configurado para o período ${periodo}. Cadastre-o antes de trocar.`)

    const precoAtual = precoDoPeriodo(licenca.plano)
    const precoNovo  = precoDoPeriodo(planoNovo)

    // ── UPGRADE: imediato + cobrança proporcional ──────────────────────────
    if (precoNovo > precoAtual) {
      await this.stripeService.atualizarPrecoSubscription(subId, novoPriceId, 'imediato')
      await updateLicenca(licencaId, { planoId, planoPendenteId: null })
      await registrarEventoLicenca(licencaId, { tipo: 'TROCA_PLANO', chaveAtivacao: licenca.chaveAtivacao, observacao: `Upgrade imediato para "${planoNovo.nome}" (cobrança proporcional).` })
      return { msg: `Upgrade para "${planoNovo.nome}" aplicado agora — o cliente paga apenas a diferença proporcional.`, aplicacao: 'imediata' as const }
    }

    // ── DOWNGRADE: agenda pro fim do ciclo; mantém o plano atual até lá ─────
    if (precoNovo < precoAtual) {
      await this.stripeService.atualizarPrecoSubscription(subId, novoPriceId, 'fim_do_ciclo')
      await updateLicenca(licencaId, { planoPendenteId: planoId })
      await registrarEventoLicenca(licencaId, { tipo: 'TROCA_PLANO', chaveAtivacao: licenca.chaveAtivacao, observacao: `Downgrade para "${planoNovo.nome}" agendado para o fim do ciclo atual.` })
      return { msg: `Downgrade para "${planoNovo.nome}" agendado — passa a valer no fim do ciclo já pago. Até lá o cliente mantém o plano atual.`, aplicacao: 'fim_do_ciclo' as const }
    }

    // ── Mesmo valor no período: troca direta (swap do price, sem cobrança) ──
    await this.stripeService.atualizarPrecoSubscription(subId, novoPriceId, 'fim_do_ciclo')
    await updateLicenca(licencaId, { planoId, planoPendenteId: null })
    await registrarEventoLicenca(licencaId, { tipo: 'TROCA_PLANO', chaveAtivacao: licenca.chaveAtivacao, observacao: `Plano alterado para "${planoNovo.nome}" (mesmo valor).` })
    return { msg: `Plano alterado para "${planoNovo.nome}".`, aplicacao: 'imediata' as const }
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

  /**
   * Dias de cortesia: estende o vencimento sem cobrar nada.
   *
   * O caminho de venda (renovar) trabalha em meses porque mes e a unidade do
   * contrato. Cortesia trabalha em dias porque a unidade do favor e outra:
   * "mais uma semana pra voce testar", "os 3 dias que voce ficou sem sistema".
   * Forcar as duas na mesma rota faria uma das duas mentir no historico.
   *
   * O que esta rota deliberadamente NAO faz: promover trial a licenca paga.
   * Cliente sem plano comprado continua trial depois da cortesia — ele ganhou
   * prazo, nao um plano. Isso mantem o funil honesto: o trial estendido segue
   * aparecendo como trial pra ser cobrado quando o prazo acabar.
   */
  async darCortesia(licencaId: string, body: unknown) {
    const { dias, observacao } = this.parseBody(cortesiaLicencaSchema, body ?? {})

    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    // Cortesia em licenca revogada seria prazo pra uma chave que nao volta a
    // funcionar — o admin acharia que resolveu e o cliente continuaria fora.
    // Reativar primeiro e uma decisao consciente, e tem botao proprio.
    if (licenca.status === 'REVOGADA')
      throw new BadRequestException('Licença revogada — reative antes de conceder cortesia.')

    const atualizada = await darCortesiaEmDias(licencaId, { dias, observacao })
    if (!atualizada) throw new NotFoundException('Licença não encontrada.')

    return {
      msg: `Cortesia de ${dias} ${dias === 1 ? 'dia' : 'dias'} concedida.`,
      data: {
        id:             licencaId,
        dataVencimento: atualizada.dataVencimento,
        diasCortesia:   atualizada.diasCortesia,
        status:         atualizada.status,
        isTrial:        atualizada.isTrial,
      },
    }
  }

  // ── Endpoints do ERP (públicos) ───────────────────────────────────────────

  async conectar(body: unknown, opts?: { autenticado?: boolean }) {
    const dados   = this.parseBody(conectarSchema, body)
    const licenca = await findLicencaByChave(dados.chave)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    // A carência precisa valer AQUI também, não só no /validar. São portas
    // diferentes para a mesma casa: liberar a validação e barrar a conexão
    // deixaria o cliente com um token válido e o sistema sem abrir — o pior
    // dos dois mundos, e difícil de diagnosticar do lado dele.
    const emCarencia = this.carenciaVigente(licenca)

    if (licenca.status !== 'ATIVA' && !(licenca.status === 'VENCIDA' && emCarencia))
      throw new BadRequestException(`Licença ${licenca.status.toLowerCase()}. Acesso negado.`)

    if (licenca.dataVencimento && licenca.dataVencimento < new Date() && !emCarencia) {
      await updateLicenca(licenca.id, { status: 'VENCIDA' })
      throw new BadRequestException('Licença vencida.')
    }

    const limite = (licenca.plano?.limiteUsuario ?? 1) + (licenca.usuariosExtras ?? 0)

    const assinado = this.assinarToken({
      licencaId:      licenca.id,
      hwid:           dados.hwid ?? null,
      plano:          licenca.plano?.nome,
      limite,
      dataVencimento: licenca.dataVencimento,
      carenciaAte:    licenca.carenciaAte,
      modulos:        modulosDaLicenca(licenca),
    })

    // Sem HWID: só valida a licença e devolve o JWT com o limite.
    // O ERP local gerencia os terminais internamente usando esse limite.
    if (!dados.hwid) {
      await updateLicenca(licenca.id, { ultimoHeartbeat: new Date() })
      return {
        msg:            'Conexão autorizada.',
        licencaId:      licenca.id,
        limite,
        dataVencimento: licenca.dataVencimento,
        ...assinado,
      }
    }

    // Com HWID: controla sessões por dispositivo (uso avançado / múltiplos backends)
    let countSessoes = await countSessoesAtivas(licenca.id)

    let reconexao = false
    try {
      const { prisma } = require('@startbig/database')
      const sessao = await prisma.licencaSessao.findUnique({
        where: { licencaId_hwid: { licencaId: licenca.id, hwid: dados.hwid } }
      })
      reconexao = !!sessao
    } catch(e) {}

    if (!reconexao && countSessoes >= limite) {
      // Login autenticado (email+senha) já provou a identidade do dono da licença —
      // nesse caso é seguro encerrar sessões antigas para liberar vaga num dispositivo novo
      // (reinstalação/troca de máquina). Via chave de ativação pura isso continua bloqueado,
      // pois a chave sozinha não prova quem está conectando.
      if (opts?.autenticado) {
        await deletarTodasSessoesDaLicenca(licenca.id)
        await registrarEventoLicenca(licenca.id, {
          tipo:          'TROCA_DISPOSITIVO',
          chaveAtivacao: licenca.chaveAtivacao,
          observacao:    `Sessão(ões) anterior(es) encerrada(s) automaticamente — login autenticado em novo dispositivo (hwid: ${dados.hwid}).`,
        })
        countSessoes = 0

        try {
          const nomeCliente = licenca.cliente.pf
            ? (licenca.cliente.pf.nomeCompleto ?? licenca.cliente.email)
            : (licenca.cliente.pj?.razaoSocial  ?? licenca.cliente.email)

          await this.emailService.enviarAlertaTrocaDispositivo({
            email:       licenca.cliente.email,
            nomeCliente,
            hwidNovo:    dados.hwid,
            dataHora:    new Date(),
          })
        } catch (err) {
          console.warn('[email] falha ao enviar alerta de troca de dispositivo:', err instanceof Error ? err.message : err)
        }
      } else {
        throw new BadRequestException(
          `Limite de ${limite} dispositivo(s) simultâneo(s) atingido. Encerre outra sessão e tente novamente.`
        )
      }
    }

    await upsertLicencaSessao(licenca.id, dados.hwid)
    const novoTotalSessoes = reconexao ? countSessoes : countSessoes + 1
    await updateLicenca(licenca.id, { totalUsuarios: novoTotalSessoes, ultimoHeartbeat: new Date() })

    return {
      msg:            reconexao ? 'Reconexão autorizada.' : 'Conexão autorizada.',
      licencaId:      licenca.id,
      sessionKey:     dados.hwid,
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

    // Terceira porta. Sem a carência aqui, o cliente com cartão recusado
    // conectaria e seria derrubado no primeiro heartbeat — o sistema caindo
    // sozinho no meio do expediente, sem explicação na tela.
    if (licenca.status !== 'ATIVA' && !(licenca.status === 'VENCIDA' && this.carenciaVigente(licenca))) {
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
    const vencida    = licenca.status === 'VENCIDA' || (licenca.dataVencimento && licenca.dataVencimento < new Date())
    const emCarencia = this.carenciaVigente(licenca)

    if (vencida) {
      if (licenca.status !== 'VENCIDA') await updateLicenca(licenca.id, { status: 'VENCIDA' })

      // Sem carência, trava aqui — é o caso de quem paga por PIX e de quem
      // nunca teve cartão. Com carência, segue adiante como válida: o Stripe
      // ainda está tentando cobrar, e derrubar a loja de quem tem um cartão
      // recusado (e talvez nem saiba) seria punir antes de avisar.
      if (!emCarencia) {
        return {
          valida:         false,
          motivo:         'Licença vencida.',
          status:         'VENCIDA',
          dataVencimento: licenca.dataVencimento,
          // Campos novos, aditivos: o ERP vencido precisa saber que é trial e
          // qual é a licença para conseguir abrir a tela de renovação.
          licencaId:      licenca.id,
          isTrial:        licenca.isTrial,
        }
      }
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
      carenciaAte:    licenca.carenciaAte,
      modulos:        modulosDaLicenca(licenca),
    })

    // `assinado` já traz emCarencia, dataLimiteCarencia e diasRestantesCarencia.
    return {
      valida:         true,
      licencaId:      licenca.id,
      status:         statusFinal,
      dataVencimento: licenca.dataVencimento,
      isTrial:        licenca.isTrial,
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

    }

    // 2. Validação do domínio do e-mail (rejeita domínio inexistente/digitado
    // errado antes de criar o cliente e depender de e-mails que vão falhar)
    if (!(await dominioDeEmailExiste(dados.email)))
      throw new BadRequestException('O domínio do e-mail informado não existe ou não aceita e-mails. Verifique se digitou corretamente.')

    const { prisma } = require('@startbig/database')

    // Gera o hash da senha enviada pelo ERP no cadastro. Assim o cliente já sai
    // do auto-cadastro com senha configurada e consegue usar /erp/auth/login
    // numa reinstalação futura sem depender do e-mail de primeiro acesso.
    const senhaHash = await bcrypt.hash(dados.senha, 10)

    // 3. Pegar um usuário ADMIN padrão para ser o "dono" do cliente
    const admin = await prisma.usuario.findFirst({ where: { tipoUsuario: 'ADMIN' } })
    if (!admin) throw new BadRequestException('Sistema não configurado para auto-cadastro (Sem administrador master).')

    // 4. Plano da licença trial. Não é só rótulo: o cliente não tem como trocar de
    // plano sozinho (trocar-plano é rota de admin), então é ESTE plano que define o
    // Price cobrado quando ele assinar. Ordem: plano fixado por configuração, senão
    // o mais barato ATIVO. Antes, não havendo plano de preço 0, caía num `findFirst()`
    // sem filtro nenhum — qualquer plano do catálogo podia ser sorteado, inclusive os
    // de teste (numa conta com Price de intervalo diário, isso vira cobrança por dia).
    const planoFixado = process.env.PLANO_AUTOCADASTRO_ID?.trim()

    let plano = planoFixado
      ? await prisma.plano.findFirst({ where: { id: planoFixado }, include: INCLUDE_MODULOS_DO_PLANO })
      : null

    if (planoFixado && !plano)
      throw new BadRequestException(`PLANO_AUTOCADASTRO_ID aponta para um plano inexistente (${planoFixado}). Corrija a configuração antes de aceitar novos cadastros.`)

    if (!plano)
      plano = await prisma.plano.findFirst({
        where:   { status: 'ATIVO' },
        orderBy: [{ precoMensal: 'asc' }, { criadoEm: 'asc' }],
        include: INCLUDE_MODULOS_DO_PLANO,
      })

    if (!plano) throw new BadRequestException('Nenhum plano ATIVO cadastrado no sistema para vincular a licença.')

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
          email: dados.email, senhaHash, usuarioId: admin.id,
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
          email: dados.email, senhaHash, usuarioId: admin.id,
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
    
    // Atualiza campos extras da licença (não crítico — criarLicenca já seta os principais)
    try {
      await updateLicenca(licenca.id, {
        status: 'ATIVA',
        isTrial: true,
        dataVencimento: vencimento,
        dataAtivacao: agora,
        ultimaSincronizacao: agora,
        totalUsuarios: 1
      })
    } catch (err) {
      this.logger.warn(`[auto-cadastro] falha ao atualizar licença (não crítico): ${err instanceof Error ? err.message : err}`)
    }

    try {
      await upsertLicencaSessao(licenca.id, hwidKey)
    } catch (err) {
      this.logger.warn(`[auto-cadastro] falha ao criar sessão inicial (não crítico): ${err instanceof Error ? err.message : err}`)
    }

    // 8. Assinar Token
    const assinado = this.assinarToken({
      licencaId:      licenca.id,
      hwid:           hwidKey,
      plano:          plano.nome,
      limite:         plano.limiteUsuario,
      dataVencimento: vencimento,
      // Licença recém-criada não tem extra contratado — só o que o plano inclui.
      modulos:        modulosDaLicenca({ plano }),
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

    // A senha já é definida no próprio auto-cadastro (senhaHash acima), então
    // não é mais necessário enviar o e-mail de "criar senha de acesso": o
    // cliente já pode usar /erp/auth/login numa reinstalação futura.

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
