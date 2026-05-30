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
  findPlanoById,
  findPlanoByNome,
  countLicencasAtivasByPlano,
  criarPlano,
  updatePlano,
} from '@startbig/database'
import { criarPlanoSchema, editarPlanoSchema } from '@startbig/schemas'

@Injectable()
export class PlanoService {

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
    const dados = this.parseBody(criarPlanoSchema, body)

    // Impede duplicatas: o nome do plano deve ser único no banco
    const existente = await findPlanoByNome(dados.nome)
    if (existente) throw new BadRequestException('Já existe um plano com esse nome.')

    return criarPlano(dados)
  }

  /**
   * Atualiza os dados de um plano existente.
   * Fluxo:
   * 1. Valida o corpo da requisição.
   * 2. Confirma que o plano existe (evita atualizar um ID fantasma).
   * 3. Se o nome estiver sendo alterado, verifica se o novo nome já pertence a outro plano.
   */
  async editar(id: string, body: unknown) {
    const dados = this.parseBody(editarPlanoSchema, body)

    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')

    // Só verifica duplicata de nome se o nome realmente mudou
    if (dados.nome && dados.nome !== plano.nome) {
      const existente = await findPlanoByNome(dados.nome)
      if (existente) throw new BadRequestException('Já existe um plano com esse nome.')
    }

    return updatePlano(id, dados)
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
