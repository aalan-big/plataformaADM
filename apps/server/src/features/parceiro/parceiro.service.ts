/**
 * ============================================================================
 * NOME DO ARQUIVO: parceiro.service.ts
 * MÓDULO: PARCEIRO
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Regras do programa de parceiros: cadastro, vínculo de clientes, apuração de
 * comissão e baixa de repasse.
 *
 * A REGRA CENTRAL:
 * A comissão é APURADA NO MOMENTO DO PAGAMENTO e gravada como uma linha no
 * livro-razão, com uma cópia da regra vigente naquele dia. Nunca se recalcula
 * o passado varrendo pagamentos — reajustar a comissão de um parceiro não pode
 * reescrever o que ele já tinha a receber.
 * ============================================================================
 */
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { ZodError } from 'zod'
import {
  findAllParceiros,
  findParceiroById,
  findParceiroByCodigo,
  criarParceiro,
  updateParceiro,
  findClientesDoParceiro,
  vincularClienteAoParceiro,
  criarComissao,
  findComissoes,
  resumoRepasse,
  marcarComissoesPagas,
  cancelarComissaoDoPagamento,
  findClienteById,
} from '@startbig/database'
import {
  criarParceiroSchema,
  editarParceiroSchema,
  vincularClienteSchema,
  pagarComissoesSchema,
} from '@startbig/schemas'

/** Pagamento recém-criado, no formato mínimo que a apuração precisa. */
export type PagamentoApuravel = {
  id:        string
  clienteId: string
  licencaId: string | null
  valor:     number
  meses:     number
}

@Injectable()
export class ParceiroService {
  private readonly logger = new Logger(ParceiroService.name)

  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }
  }

  // ── Cadastro ──────────────────────────────────────────────────────────────

  async listar(filtro: { status?: string; q?: string }) {
    return findAllParceiros(filtro)
  }

  async buscarPorId(id: string) {
    const parceiro = await findParceiroById(id)
    if (!parceiro) throw new NotFoundException('Parceiro não encontrado.')

    const [clientes, comissoes] = await Promise.all([
      findClientesDoParceiro(id),
      findComissoes({ parceiroId: id }),
    ])

    const somaPor = (status: string) =>
      comissoes.filter(c => c.status === status).reduce((s, c) => s + Number(c.valor), 0)

    return {
      ...parceiro,
      clientes,
      comissoes,
      totais: {
        pendente:  somaPor('PENDENTE'),
        pago:      somaPor('PAGA'),
        cancelado: somaPor('CANCELADA'),
      },
    }
  }

  async criar(body: unknown) {
    const dados  = this.parseBody(criarParceiroSchema, body)
    const codigo = dados.codigo.toUpperCase()

    const existente = await findParceiroByCodigo(codigo)
    if (existente) throw new BadRequestException(`Já existe um parceiro com o código "${codigo}".`)

    return { msg: 'Parceiro cadastrado.', data: await criarParceiro({ ...dados, codigo }) }
  }

  async editar(id: string, body: unknown) {
    const dados  = this.parseBody(editarParceiroSchema, body)
    const codigo = dados.codigo?.toUpperCase()

    const parceiro = await findParceiroById(id)
    if (!parceiro) throw new NotFoundException('Parceiro não encontrado.')

    if (codigo && codigo !== parceiro.codigo) {
      const existente = await findParceiroByCodigo(codigo)
      if (existente) throw new BadRequestException(`Já existe um parceiro com o código "${codigo}".`)
    }

    return { msg: 'Parceiro atualizado.', data: await updateParceiro(id, { ...dados, ...(codigo ? { codigo } : {}) }) }
  }

  /**
   * Desativar não apaga nem mexe em comissão nenhuma — só impede que NOVOS
   * pagamentos gerem repasse. O que ele já tem a receber continua a receber.
   */
  async alterarStatus(id: string, status: 'ATIVO' | 'INATIVO') {
    const parceiro = await findParceiroById(id)
    if (!parceiro) throw new NotFoundException('Parceiro não encontrado.')
    if (parceiro.status === status) throw new BadRequestException(`O parceiro já está ${status}.`)

    await updateParceiro(id, { status })
    return {
      msg: status === 'INATIVO'
        ? 'Parceiro desativado. Novos pagamentos não geram mais comissão; o que já foi apurado continua devido.'
        : 'Parceiro reativado.',
    }
  }

  // ── Vínculo cliente ↔ parceiro ────────────────────────────────────────────

  async vincularCliente(body: unknown) {
    const { clienteId, parceiroId } = this.parseBody(vincularClienteSchema, body)

    const cliente = await findClienteById(clienteId)
    if (!cliente) throw new NotFoundException('Cliente não encontrado.')

    if (parceiroId) {
      const parceiro = await findParceiroById(parceiroId)
      if (!parceiro) throw new NotFoundException('Parceiro não encontrado.')
      if (parceiro.status !== 'ATIVO')
        throw new BadRequestException('Não é possível vincular clientes a um parceiro inativo.')
    }

    const atualizado = await vincularClienteAoParceiro(clienteId, parceiroId)

    // O vínculo vale daqui para a frente: pagamentos já apurados não são
    // reprocessados. Mudar o dono de um cliente não redistribui o passado.
    return {
      msg: parceiroId
        ? 'Cliente vinculado ao parceiro. Vale para os próximos pagamentos.'
        : 'Cliente desvinculado do parceiro.',
      data: atualizado,
    }
  }

  // ── Apuração ──────────────────────────────────────────────────────────────

  /**
   * Chamado logo depois de registrar um pagamento. Se o cliente pertence a um
   * parceiro ATIVO, grava a comissão devida.
   *
   * Nunca propaga erro: falha na apuração não pode derrubar o processamento de
   * um pagamento que já entrou. O que não pode é falhar em silêncio — por isso
   * todo caminho de saída deixa rastro no log.
   */
  async apurarComissao(pagamento: PagamentoApuravel): Promise<void> {
    try {
      const cliente = await findClienteById(pagamento.clienteId)
      if (!cliente?.parceiroId) return   // cliente direto: nada a apurar

      const parceiro = await findParceiroById(cliente.parceiroId)
      if (!parceiro) {
        this.logger.warn(`[comissao] parceiro ${cliente.parceiroId} do cliente ${pagamento.clienteId} não existe — nada apurado`)
        return
      }

      if (parceiro.status !== 'ATIVO') {
        this.logger.log(`[comissao] parceiro ${parceiro.codigo} está ${parceiro.status} — pagamento ${pagamento.id} não gera repasse`)
        return
      }

      const { valor, parametro } = this.calcular(parceiro, pagamento)

      // Comissão zero não vira linha: só polui o extrato do parceiro. Acontece,
      // por exemplo, no ajuste proporcional de upgrade, que tem meses = 0.
      if (valor <= 0) {
        this.logger.log(`[comissao] pagamento ${pagamento.id} renderia R$ 0,00 ao parceiro ${parceiro.codigo} — ignorado`)
        return
      }

      await criarComissao({
        parceiroId:   parceiro.id,
        clienteId:    pagamento.clienteId,
        licencaId:    pagamento.licencaId,
        pagamentoId:  pagamento.id,
        competencia:  new Date().toISOString().slice(0, 7),
        valorBase:    pagamento.valor,
        meses:        pagamento.meses,
        tipoComissao: parceiro.tipoComissao,
        parametro,
        valor,
      })

      this.logger.log(`[comissao] R$ ${valor.toFixed(2)} para ${parceiro.codigo} — pagamento ${pagamento.id} (${pagamento.meses} mês(es))`)
    } catch (err) {
      // Violação do índice único = webhook reentregue. É o comportamento
      // desejado, não um problema: significa que a trava funcionou.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Unique constraint') || msg.includes('P2002')) {
        this.logger.log(`[comissao] pagamento ${pagamento.id} já tinha comissão — reentrega ignorada`)
        return
      }
      this.logger.error(`[comissao] falha ao apurar comissão do pagamento ${pagamento.id}: ${msg}`)
    }
  }

  /**
   * FIXO_MENSAL  → valor por mês × meses cobertos pelo pagamento.
   *                Trimestral rende 3×, anual rende 12×, numa linha só.
   * PERCENTUAL   → percentual sobre o valor efetivamente pago.
   */
  private calcular(parceiro: { tipoComissao: string; valorComissaoFixa: unknown; comissaoPercentual: unknown }, pagamento: PagamentoApuravel) {
    if (parceiro.tipoComissao === 'PERCENTUAL') {
      const pct = Number(parceiro.comissaoPercentual ?? 0)
      return { parametro: pct, valor: Math.round(pagamento.valor * pct) / 100 }
    }

    const porMes = Number(parceiro.valorComissaoFixa ?? 0)
    return { parametro: porMes, valor: porMes * (pagamento.meses ?? 0) }
  }

  /** Estorno de pagamento cancela a comissão ainda não paga. */
  async cancelarPorEstorno(pagamentoId: string, motivo: string) {
    const r = await cancelarComissaoDoPagamento(pagamentoId, motivo)
    if (r.count > 0) this.logger.log(`[comissao] ${r.count} comissão(ões) cancelada(s) por estorno do pagamento ${pagamentoId}`)
    return r
  }

  // ── Repasse ───────────────────────────────────────────────────────────────

  async listarComissoes(filtro: { parceiroId?: string; status?: string; competencia?: string }) {
    return findComissoes(filtro)
  }

  /** "Quanto eu pago para cada parceiro nesta competência." */
  async repasse(filtro: { competencia?: string; status?: string }) {
    const linhas = await resumoRepasse({
      competencia: filtro.competencia,
      status:      filtro.status ?? 'PENDENTE',
    })
    return {
      competencia: filtro.competencia ?? 'todas',
      status:      filtro.status ?? 'PENDENTE',
      totalGeral:  linhas.reduce((s, l) => s + l.total, 0),
      linhas,
    }
  }

  async pagarComissoes(body: unknown) {
    const dados = this.parseBody(pagarComissoesSchema, body)

    const r = await marcarComissoesPagas(dados.comissaoIds, {
      referenciaPagamento: dados.referenciaPagamento,
      observacao:          dados.observacao,
    })

    if (r.count === 0)
      throw new BadRequestException('Nenhuma comissão foi baixada — verifique se as selecionadas ainda estão PENDENTE.')

    return { msg: `${r.count} comissão(ões) marcada(s) como paga(s).`, data: { baixadas: r.count } }
  }
}
