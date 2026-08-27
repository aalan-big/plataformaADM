/**
 * ============================================================================
 * NOME DO ARQUIVO: plano.service.ts
 * MÓDULO: PLANO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Contém o "coração" e a Lógica de Negócio do módulo de PLANO. Aqui é onde
 * as regras são aplicadas, contas são feitas, e a comunicação direta com o
 * Banco de Dados (Prisma) acontece.
 *
 * O QUE ELE CONTÉM:
 * - Funções de criação, leitura, atualização e exclusão (CRUD).
 * - Regras de negócio complexas (ex: validação de limites, cálculos financeiros).
 * - Comunicação com bibliotecas externas (ex: Stripe, Envio de E-mails).
 * ============================================================================
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { ZodError } from 'zod'
import {
  findAllPlanosAdmin,
  findPlanosPublicos,
  findPlanoById,
  findPlanoByNome,
  countLicencasAtivasByPlano,
  criarPlano,
  updatePlano,
  listarModulos,
  definirModulosDoPlano,
} from '@startbig/database'
import { criarPlanoSchema, editarPlanoSchema } from '@startbig/schemas'
import { StripeService } from '../../common/stripe/stripe.service'
import { montarOpcoes } from './plano.precos'

@Injectable()
export class PlanoService {
  constructor(private readonly stripeService: StripeService) {}

  /**
   * Utilitário interno para validar o corpo de uma requisição usando um schema Zod.
   * Se os dados forem inválidos, lança um BadRequestException com os detalhes do erro
   * em vez de deixar o Zod explodir com uma mensagem genérica.
   *
   * @param schema - Schema Zod que define as regras de validação
   * @param body   - Dados brutos recebidos da requisição HTTP
   * @returns Os dados já tipados e validados
   */
  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      // Converte o erro do Zod em um erro HTTP 400 com os campos que falharam
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Lista todos os planos cadastrados no sistema (ativos e inativos).
   * Usado pela tela de administração para exibir o painel de planos.
   */
  async listar() {
    return findAllPlanosAdmin()
  }

  /**
   * Planos da página pública de contratação: ATIVO e marcados como públicos,
   * já com os períodos e preços prontos para exibir.
   *
   * Devolve só o necessário para vender. Nada de Price ID, desconto bruto ou
   * qualquer campo interno — é resposta de endpoint aberto na internet.
   */
  async listarPublicos() {
    const planos = await findPlanosPublicos()

    return planos
      .map(p => ({
        id:            p.id,
        nome:          p.nome,
        descricao:     p.descricaoCheckout,
        limiteUsuario: p.limiteUsuario,
        opcoes:        montarOpcoes(p),
      }))
      // Plano sem nenhum período com Price não tem como ser comprado: melhor
      // sumir da vitrine do que virar um card com botão que falha.
      .filter(p => p.opcoes.length > 0)
  }

  /**
   * Busca um plano específico pelo seu ID.
   * Lança 404 se o plano não existir — evita retornar `null` para o controller.
   */
  async buscarPorId(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')
    return plano
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Cria um novo plano após duas validações:
   * 1. Valida o corpo da requisição com o schema Zod (campos obrigatórios, tipos, etc.)
   * 2. Garante unicidade do nome — dois planos não podem ter o mesmo nome.
   */
  async criar(body: unknown) {
    const { modulos, ...dados } = this.parseBody(criarPlanoSchema, body)

    // Impede duplicatas: o nome do plano deve ser único no banco
    const existente = await findPlanoByNome(dados.nome)
    if (existente) throw new BadRequestException('Já existe um plano com esse nome.')

    const plano = await criarPlano(dados)
    if (modulos) await this.aplicarModulos(plano.id, modulos)
    return plano
  }

  /**
   * Grava o conjunto de módulos do plano.
   *
   * Traduz identificador → id aqui, e não no repositório, porque a API fala em
   * identificador ("FISCAL") de propósito: é estável, legível no corpo da
   * requisição e não muda se o catálogo for recriado. Identificador desconhecido
   * é erro explícito, e não linha ignorada em silêncio — senão um typo no
   * formulário viraria um módulo que o admin acha que marcou e não foi salvo.
   */
  private async aplicarModulos(
    planoId: string,
    modulos: { identificador: string; cotaMensal?: number | null }[],
  ) {
    const catalogo = await listarModulos(true)
    const porIdentificador = new Map(catalogo.map(m => [m.identificador, m.id]))

    const vinculos = modulos.map(m => {
      const moduloId = porIdentificador.get(m.identificador)
      if (!moduloId) throw new BadRequestException(`Módulo desconhecido: ${m.identificador}.`)
      return { moduloId, cotaMensal: m.cotaMensal ?? null }
    })

    await definirModulosDoPlano(planoId, vinculos)
  }

  /**
   * Atualiza os dados de um plano existente.
   * Fluxo:
   * 1. Valida o corpo da requisição.
   * 2. Confirma que o plano existe (evita atualizar um ID fantasma).
   * 3. Se o nome estiver sendo alterado, verifica se o novo nome já pertence a outro plano.
   */
  async editar(id: string, body: unknown) {
    const { modulos, ...dados } = this.parseBody(editarPlanoSchema, body)

    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')

    // Só verifica duplicata de nome se o nome realmente mudou
    if (dados.nome && dados.nome !== plano.nome) {
      const existente = await findPlanoByNome(dados.nome)
      if (existente) throw new BadRequestException('Já existe um plano com esse nome.')
    }

    // `undefined` = o formulário não mandou módulos, mantém como está.
    // Array vazio = o admin desmarcou tudo, e aí zera mesmo.
    if (modulos) await this.aplicarModulos(id, modulos)

    return updatePlano(id, dados)
  }

  /**
   * Sincroniza este plano com o catálogo do Stripe e regrava os Price IDs.
   *
   * Por que existe: Price no Stripe é IMUTÁVEL. Editar `precoMensal` aqui muda só o
   * valor que a tela exibe — o Stripe continua cobrando o Price antigo, e o cliente
   * vê um preço e paga outro. Só criar um Price novo e reapontar o plano resolve,
   * e é isso que este método faz numa operação, sem ninguém copiar `price_` à mão.
   *
   * Período sem preço definido fica sem Price: a tela de pagamento deixa de oferecer
   * a opção, em vez de mostrar um botão que o gateway recusa.
   *
   * Assinaturas já existentes NÃO são afetadas — quem contratou por R$ 89,90 segue
   * pagando R$ 89,90, porque continua vinculado ao Price antigo. O preço novo vale
   * para quem assinar a partir de agora.
   */
  async sincronizarStripe(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')

    const emCentavos = (v: unknown) =>
      v == null ? null : Math.round(Number(v) * 100)

    const { produtoId, produtoCriado, resultados } = await this.stripeService.sincronizarCatalogo({
      nome:      plano.nome,
      descricao: plano.descricaoCheckout ?? null,
      periodos: [
        { periodo: 'mensal',     valorCentavos: emCentavos(plano.precoMensal)     },
        { periodo: 'trimestral', valorCentavos: emCentavos(plano.precoTrimestral) },
        { periodo: 'anual',      valorCentavos: emCentavos(plano.precoAnual)      },
      ],
    })

    const idDe = (periodo: string) => resultados.find(r => r.periodo === periodo)?.priceId ?? null

    const atualizado = await updatePlano(plano.id, {
      stripePriceIdMensal:     idDe('mensal'),
      stripePriceIdTrimestral: idDe('trimestral'),
      stripePriceIdAnual:      idDe('anual'),
    })

    return {
      msg: `Catálogo sincronizado no Stripe (${this.stripeService.emModoLive ? 'LIVE — dinheiro real' : 'TEST'}).`,
      data: {
        modo:      this.stripeService.emModoLive ? 'LIVE' : 'TEST',
        produtoId,
        produtoCriado,
        resultados,
        plano: atualizado,
      },
    }
  }

  /**
   * Desativa um plano, impedindo novas licenças de serem vinculadas a ele.
   * Regras de negócio:
   * - Não pode desativar um plano que já está INATIVO (evita operação redundante).
   * - Não pode desativar se houver licenças ATIVAS vinculadas — clientes em uso
   *   seriam afetados. O admin precisa migrar ou cancelar essas licenças antes.
   */
  async desativar(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')
    if (plano.status === 'INATIVO') throw new BadRequestException('Plano já está inativo.')

    // Proteção: bloqueia desativação se ainda há clientes com licenças ativas neste plano
    const licencasAtivas = await countLicencasAtivasByPlano(id)
    if (licencasAtivas > 0)
      throw new BadRequestException(
        `Não é possível desativar: há ${licencasAtivas} licença(s) ativa(s) vinculada(s) a este plano.`
      )

    await updatePlano(id, { status: 'INATIVO' })
    return { msg: 'Plano desativado com sucesso.' }
  }

  /**
   * Reativa um plano previamente desativado, permitindo que novas licenças
   * sejam vinculadas a ele novamente.
   * Regra: não pode reativar um plano que já está ATIVO.
   */
  async reativar(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')
    if (plano.status === 'ATIVO') throw new BadRequestException('Plano já está ativo.')

    await updatePlano(id, { status: 'ATIVO' })
    return { msg: 'Plano reativado com sucesso.' }
  }
}
