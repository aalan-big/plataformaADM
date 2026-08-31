import { Controller, Get, Post, Patch, Delete, Body, Param, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import {
  listarModulosDetalhado,
  modulosDaLicencaDetalhado,
  concederModuloExtra,
  revogarModuloExtra,
  atualizarModulo,
  cancelarPixPendentesDaLicenca,
  modulosCobraveisDaLicenca,
  ModuloBaseProtegidoError,
  vincularItemAssinatura,
  findLicencaById,
} from '@startbig/database'
import { concederModuloExtraSchema, editarModuloSchema } from '@startbig/schemas'
import { Roles } from '../../core/decorators/roles.decorator'
import { StripeService } from '../../common/stripe/stripe.service'
import { ZodError } from 'zod'

/**
 * Catálogo de módulos e concessões por licença (painel administrativo).
 *
 * O catálogo é só leitura: cadastrar módulo é operação de uma vez por produto
 * novo, resolvida pelo `scripts/semear-modulos.ts`. Uma tela de CRUD aqui seria
 * uma tela a manter para algo que acontece uma vez por semestre.
 *
 * O que muda toda semana é a concessão avulsa — e essa tem endpoint próprio.
 */
@Roles('ADMIN')
@Controller('modulo')
export class ModuloController {
  private readonly logger = new Logger(ModuloController.name)

  constructor(private readonly stripeService: StripeService) {}

  /**
   * Fecha os PIX pendentes da licença — mas SÓ quando o valor da renovação
   * mudou de fato.
   *
   * A trava de idempotência casa por licença/meses/método/plano e não olha
   * valor, então um PIX gerado antes da concessão continuaria cobrando o valor
   * velho: o cliente pagaria R$ 59,90 e levaria o módulo sem ser cobrado.
   *
   * O `if` importa tanto quanto o cancelamento. Cortesia e concessão sem valor
   * não alteram o total, e cancelar nesses casos derrubaria o copia-e-cola que o
   * cliente já tem aberto na tela — ele veria o PIX morrer sozinho, sem nada ter
   * mudado para ele.
   */
  private async fecharPixSeMudouValor(licencaId: string, mudouValor: boolean) {
    if (!mudouValor) return
    const fechadas = await cancelarPixPendentesDaLicenca(licencaId)
    if (fechadas.count > 0) {
      this.logger.log(`[modulo] ${fechadas.count} PIX pendente(s) da licença ${licencaId} cancelado(s) — o valor da renovação mudou.`)
    }
  }

  private parse<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Dados inválidos',
          detalhes: e.issues.map(i => ({ campo: i.path.join('.'), mensagem: i.message })),
        })
      }
      throw e
    }
  }

  @Get()
  async listar() {
    return { data: await listarModulosDetalhado() }
  }

  /**
   * Edita um módulo do catálogo. Criar módulo continua sendo trabalho do
   * `scripts/semear-modulos.ts` — o que muda com o negócio é preço e status,
   * não a existência do produto.
   */
  @Patch(':identificador')
  async editar(@Param('identificador') identificador: string, @Body() body: unknown) {
    const dados = this.parse(editarModuloSchema, body)

    let atualizado
    try {
      atualizado = await atualizarModulo(identificador, dados)
    } catch (e) {
      // Recusa de regra de negócio vira 400 com o texto pronto para a tela; o
      // resto sobe e vira 500, que é o que erro de infraestrutura deve ser.
      if (e instanceof ModuloBaseProtegidoError) throw new BadRequestException(e.message)
      throw e
    }
    if (!atualizado) throw new NotFoundException(`Módulo desconhecido: ${identificador}.`)
    return { data: atualizado }
  }

  @Get('licenca/:licencaId')
  async daLicenca(@Param('licencaId') licencaId: string) {
    const data = await modulosDaLicencaDetalhado(licencaId)
    if (!data) throw new NotFoundException('Licença não encontrada.')
    return { data }
  }

  @Post('licenca/:licencaId/extra')
  async conceder(@Param('licencaId') licencaId: string, @Body() body: unknown) {
    const dados = this.parse(concederModuloExtraSchema, body)

    const criado = await concederModuloExtra(licencaId, {
      identificador:  dados.identificador,
      cortesia:       dados.cortesia,
      dataVencimento: dados.dataVencimento ? new Date(dados.dataVencimento) : null,
      valorCobrado:   dados.valorCobrado ?? null,
      cotaMensal:     dados.cotaMensal ?? null,
      observacao:     dados.observacao ?? null,
    })
    if (!criado) throw new NotFoundException(`Módulo desconhecido: ${dados.identificador}.`)

    // Só concessão COBRADA mexe no valor da renovação. Cortesia não.
    const mudaValor = !dados.cortesia && (dados.valorCobrado ?? 0) > 0
    await this.fecharPixSeMudouValor(licencaId, mudaValor)

    /**
     * Cliente de CARTÃO precisa da assinatura alterada — ela não muda sozinha.
     *
     * O caso comum da venda avulsa não é "assina já com o módulo", é "já paga
     * há meses e agora quer o módulo". Sem anexar o item aqui, a concessão
     * ficava valendo (acesso liberado) e nunca era cobrada: prejuízo silencioso.
     *
     * Falhar aqui NÃO desfaz a concessão. O acesso já está gravado, e o certo é
     * o operador saber que a cobrança não entrou — devolver erro faria ele
     * conceder de novo, e o retry criaria um segundo item cobrando em dobro.
     */
    let avisoCobranca: string | null = null
    if (mudaValor) {
      const licenca = await findLicencaById(licencaId)
      const subId   = (licenca as any)?.stripeSubscriptionId as string | null
      if (subId) {
        try {
          const { itemId } = await this.stripeService.adicionarModuloNaSubscription(subId, {
            nome:        criado.modulo.nome,
            valorMensal: dados.valorCobrado!,
          })
          await vincularItemAssinatura(licencaId, dados.identificador, itemId)
        } catch (err) {
          const detalhe = err instanceof Error ? err.message : String(err)
          this.logger.error(`[modulo] falha ao anexar ${dados.identificador} à assinatura ${subId}: ${detalhe}`)
          avisoCobranca = 'Módulo liberado, mas NÃO foi possível incluí-lo na assinatura do cartão. O acesso está valendo e a cobrança não — resolva no Stripe ou cobre à parte.'
        }
      }
    }

    return { data: await modulosDaLicencaDetalhado(licencaId), aviso: avisoCobranca }
  }

  @Delete('licenca/:licencaId/extra/:identificador')
  async revogar(
    @Param('licencaId') licencaId: string,
    @Param('identificador') identificador: string,
  ) {
    /**
     * Precisa saber ANTES de apagar se o extra era cobrado — depois da remoção
     * a informação não existe mais para consultar.
     */
    const cobraveis = await modulosCobraveisDaLicenca(licencaId)
    const cobrado   = cobraveis.find(m => m.identificador === identificador)
    const eraCobrado = !!cobrado

    /**
     * Parar a cobrança vem ANTES de apagar o vínculo: depois da remoção o id do
     * item some do banco, e o Stripe seguiria cobrando todo mês por um acesso
     * que o cliente já não tem — o único erro pior que não cobrar.
     */
    let avisoCobranca: string | null = null
    if (cobrado?.stripeSubscriptionItemId) {
      const licenca = await findLicencaById(licencaId)
      const subId   = (licenca as any)?.stripeSubscriptionId as string | null
      if (subId) {
        try {
          await this.stripeService.removerModuloDaSubscription(
            subId, cobrado.stripeSubscriptionItemId, cobrado.valorMensal,
          )
        } catch (err) {
          const detalhe = err instanceof Error ? err.message : String(err)
          this.logger.error(`[modulo] falha ao remover item ${cobrado.stripeSubscriptionItemId} da assinatura ${subId}: ${detalhe}`)
          avisoCobranca = 'Módulo revogado, mas a cobrança CONTINUA na assinatura do cartão. Remova o item no Stripe para o cliente parar de pagar.'
        }
      }
    }

    const r = await revogarModuloExtra(licencaId, identificador)
    if (!r) throw new NotFoundException(`Módulo desconhecido: ${identificador}.`)

    await this.fecharPixSeMudouValor(licencaId, eraCobrado)
    return { data: await modulosDaLicencaDetalhado(licencaId), aviso: avisoCobranca }
  }
}
