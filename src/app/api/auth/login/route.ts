import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { authenticateUser } from '@/features/auth/auth.service'
import { loginSchema } from '@/features/auth/auth.schema'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const dados = loginSchema.parse(body)
    const result = await authenticateUser(dados)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { erro: 'Dados inválidos', detalhes: error.issues },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Erro interno'
    return NextResponse.json({ erro: message }, { status: 401 })
  }
}
