import { Controller, Get, Post, Patch, Delete, Body, Param, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import {
  listarModulosDetalhado,
  modulosDaLicencaDetalhado,
  concederModuloExtra,
  revogarModuloExtra,
  atualizarModulo,
  cancelarPixPendentesDaLicenca,
  modulosCobraveisDaLicenca,
} from '@startbig/database'
import { concederModuloExtraSchema, editarModuloSchema } from '@startbig/schemas'
import { Roles } from '../../core/decorators/roles.decorator'
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
    const atualizado = await atualizarModulo(identificador, dados)
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
    return { data: await modulosDaLicencaDetalhado(licencaId) }
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
    const eraCobrado = cobraveis.some(m => m.identificador === identificador)

    const r = await revogarModuloExtra(licencaId, identificador)
    if (!r) throw new NotFoundException(`Módulo desconhecido: ${identificador}.`)

    await this.fecharPixSeMudouValor(licencaId, eraCobrado)
    return { data: await modulosDaLicencaDetalhado(licencaId) }
  }
}
