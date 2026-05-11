import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { handleLogin } from './_handlers/login'

export async function POST(request: Request) {
  try {
    const { acao, dados } = await request.json()

    const resLogin = await handleLogin(acao, dados)
    if (resLogin) return resLogin

    return NextResponse.json({ error: 'Ação de teste não reconhecida' }, { status: 400 })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Erro de Validação (Zod)', detalhes: error.issues },
        { status: 400 }
      )
    }

    const message = error instanceof Error ? error.message : 'Erro interno'
    return NextResponse.json(
      { error: message, stack: 'Erro capturado no Laboratório de Testes' },
      { status: 500 }
    )
  }
}
