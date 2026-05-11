import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ZodError } from 'zod'
import {
  findAllClientes,
  searchClientes,
  findClienteById,
  findClientePFByCpf,
  findClientePJByCnpj,
  findClienteByEmail,
  prisma,
} from '@startbig/database'
import {
  criarClienteUnificadoSchema,
  criarEnderecoSchema,
  editarClientePFSchema,
  editarClientePJSchema,
  editarEnderecoSchema,
} from '@startbig/schemas'
import { editarClientePF } from './pf/cliente-pf.service'
import { editarClientePJ } from './pj/cliente-pj.service'

@Injectable()
export class ClienteService {

  async listarClientes() {
    return findAllClientes()
  }

  async pesquisarClientes(termo: string) {
    if (!termo.trim()) return findAllClientes()
    return searchClientes(termo)
  }

  async buscarCliente(id: string) {
    const cliente = await findClienteById(id)
    if (!cliente) throw new NotFoundException('Cliente não encontrado.')
    return cliente
  }

  async registrar(body: unknown) {
    const { endereco: enderecoRaw, ...dadosCliente } = body as Record<string, unknown>

    let dadosValidados: ReturnType<typeof criarClienteUnificadoSchema.parse>
    try {
      dadosValidados = criarClienteUnificadoSchema.parse(dadosCliente)
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Dados inválidos',
          detalhes: e.issues.map(i => ({ campo: i.path.join('.'), mensagem: i.message })),
        })
      }
      throw e
    }

    let enderecoPreValidado = null
    if (enderecoRaw && typeof enderecoRaw === 'object' && (enderecoRaw as any).cep) {
      enderecoPreValidado = criarEnderecoSchema.parse({
        ...(enderecoRaw as object),
        clienteId: '00000000-0000-0000-0000-000000000000',
      })
    }

    if (dadosValidados.tipo === 'PF') {
      const existe = await findClientePFByCpf(dadosValidados.cpf)
      if (existe) throw new BadRequestException('CPF já cadastrado.')
    } else {
      const existe = await findClientePJByCnpj(dadosValidados.cnpj)
      if (existe) throw new BadRequestException('CNPJ já cadastrado.')
    }

    const existeEmail = await findClienteByEmail(dadosValidados.email)
    if (existeEmail) throw new BadRequestException('E-mail já cadastrado em outro cliente.')

    const { cliente, enderecoSalvo } = await prisma.$transaction(async (tx) => {
      let novoCliente

      if (dadosValidados.tipo === 'PF') {
        const { nomeCompleto, cpf, rg, dataNascimento, tipo, usuarioId, parceiroId, email } = dadosValidados
        novoCliente = await tx.cliente.create({
          data: {
            tipo: 'PF',
            email: email as string,
            usuario: { connect: { id: usuarioId } },
            ...(parceiroId ? { parceiroObj: { connect: { id: parceiroId } } } : {}),
            pf: { create: { nomeCompleto, cpf, rg, dataNascimento: dataNascimento ? new Date(dataNascimento) : undefined } },
          },
          include: { pf: true, pj: true, enderecos: true },
        })
      } else {
        const { razaoSocial, cnpj, nomeFantasia, inscricaoEstadual, responsavel, tipo, usuarioId, parceiroId, email } = dadosValidados
        novoCliente = await tx.cliente.create({
          data: {
            tipo: 'PJ',
            email: email as string,
            usuario: { connect: { id: usuarioId } },
            ...(parceiroId ? { parceiroObj: { connect: { id: parceiroId } } } : {}),
            pj: { create: { razaoSocial, cnpj, nomeFantasia, inscricaoEstadual, responsavel } },
          },
          include: { pf: true, pj: true, enderecos: true },
        })
      }

      const novoEndereco = enderecoPreValidado
        ? await tx.endereco.create({ data: { ...enderecoPreValidado, clienteId: novoCliente.id } })
        : null

      return { cliente: novoCliente, enderecoSalvo: novoEndereco }
    })

    return {
      msg: `Cliente ${dadosValidados.tipo} registrado com sucesso`,
      data: { ...cliente, endereco: enderecoSalvo },
    }
  }

  async editar(id: string, body: unknown) {
    const cliente = await findClienteById(id)
    if (!cliente) throw new NotFoundException('Cliente não encontrado.')

    const { endereco: enderecoRaw, ...dadosCliente } = body as Record<string, unknown>

    try {
      if (cliente.tipo === 'PF') {
        const dadosValidados = editarClientePFSchema.parse(dadosCliente)
        const atualizado = await editarClientePF(id, dadosValidados)
        await this.upsertEndereco(id, cliente.enderecos, enderecoRaw)
        return { msg: 'Cliente PF atualizado com sucesso', data: atualizado }
      }

      if (cliente.tipo === 'PJ') {
        const dadosValidados = editarClientePJSchema.parse(dadosCliente)
        const atualizado = await editarClientePJ(id, dadosValidados)
        await this.upsertEndereco(id, cliente.enderecos, enderecoRaw)
        return { msg: 'Cliente PJ atualizado com sucesso', data: atualizado }
      }

      throw new BadRequestException('Tipo de cliente desconhecido.')

    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          erro: 'Dados inválidos',
          detalhes: e.issues.map(i => ({ campo: i.path.join('.'), mensagem: i.message })),
        })
      }
      if (e instanceof NotFoundException || e instanceof BadRequestException) throw e
      throw new BadRequestException(e instanceof Error ? e.message : 'Erro interno')
    }
  }

  async desativar(id: string) {
    const cliente = await findClienteById(id)
    if (!cliente) throw new NotFoundException('Cliente não encontrado.')
    await prisma.cliente.delete({ where: { id } })
    return { msg: 'Cliente removido com sucesso' }
  }

  private async upsertEndereco(
    clienteId: string,
    enderecos: { id: string; tipo: string }[],
    raw: unknown,
  ) {
    if (!raw || typeof raw !== 'object') return
    const dados = editarEnderecoSchema.parse(raw)
    const principal = enderecos.find(e => e.tipo === 'PRINCIPAL') ?? enderecos[0]
    if (principal) {
      await prisma.endereco.update({ where: { id: principal.id }, data: dados })
    } else {
      await prisma.endereco.create({
        data: { clienteId, tipo: 'PRINCIPAL', ...dados } as Parameters<typeof prisma.endereco.create>[0]['data'],
      })
    }
  }
}
