import { NextResponse } from 'next/server'
import { criarUsuario } from '@/features/usuario/usuario.service'
import { authenticateUser } from '@/features/auth/auth.service'
import { criarUsuarioSchema } from '@/features/usuario/usuario.schema'
import { loginSchema } from '@/features/auth/auth.schema'

export async function handleLogin(acao: string, dados: unknown) {
  if (acao === 'testar_cadastro') {
    const dadosValidados = criarUsuarioSchema.parse(dados)
    const res = await criarUsuario(dadosValidados)
    return NextResponse.json({ msg: 'Service de Cadastro OK', data: res })
  }

  if (acao === 'testar_login') {
    const dadosValidados = loginSchema.parse(dados)
    const res = await authenticateUser(dadosValidados)
    return NextResponse.json({ msg: 'Service de Login OK', data: res })
  }

  return null
}
