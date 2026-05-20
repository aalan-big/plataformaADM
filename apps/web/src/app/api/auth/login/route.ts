import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

export async function POST(request: Request) {
  const body = await request.json()

  let res;
  try {
    res = await fetch(`${SERVER_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return NextResponse.json({ erro: 'O Servidor Backend (NestJS) parece estar offline ou recusou a conexão. Verifique se ele está rodando na porta 4000.' }, { status: 502 })
  }

  let data;
  try {
    data = await res.json()
  } catch {
    return NextResponse.json({ erro: 'O backend retornou uma resposta inválida (não-JSON). Status: ' + res.status }, { status: 500 })
  }

  if (!res.ok) return NextResponse.json(data, { status: res.status })

  const response = NextResponse.json(data)

  if (data.token) {
    response.cookies.set('token', data.token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    })
  }

  return response
}