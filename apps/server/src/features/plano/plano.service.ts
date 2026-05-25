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

  private parseBody<T>(schema: { parse: (x: unknown) => T }, body: unknown): T {
    try {
      return schema.parse(body)
    } catch (e) {
      if (e instanceof ZodError)
        throw new BadRequestException({ erro: 'Dados inválidos', detalhes: e.issues })
      throw e
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async listar() {
    return findAllPlanosAdmin()
  }

  async buscarPorId(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')
    return plano
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async criar(body: unknown) {
    const dados = this.parseBody(criarPlanoSchema, body)

    const existente = await findPlanoByNome(dados.nome)
    if (existente) throw new BadRequestException('Já existe um plano com esse nome.')

    return criarPlano(dados)
  }

  async editar(id: string, body: unknown) {
    const dados = this.parseBody(editarPlanoSchema, body)

    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')

    if (dados.nome && dados.nome !== plano.nome) {
      const existente = await findPlanoByNome(dados.nome)
      if (existente) throw new BadRequestException('Já existe um plano com esse nome.')
    }

    return updatePlano(id, dados)
  }

  async desativar(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')
    if (plano.status === 'INATIVO') throw new BadRequestException('Plano já está inativo.')

    const licencasAtivas = await countLicencasAtivasByPlano(id)
    if (licencasAtivas > 0)
      throw new BadRequestException(
        `Não é possível desativar: há ${licencasAtivas} licença(s) ativa(s) vinculada(s) a este plano.`
      )

    await updatePlano(id, { status: 'INATIVO' })
    return { msg: 'Plano desativado com sucesso.' }
  }

  async reativar(id: string) {
    const plano = await findPlanoById(id)
    if (!plano) throw new NotFoundException('Plano não encontrado.')
    if (plano.status === 'ATIVO') throw new BadRequestException('Plano já está ativo.')

    await updatePlano(id, { status: 'ATIVO' })
    return { msg: 'Plano reativado com sucesso.' }
  }
}
