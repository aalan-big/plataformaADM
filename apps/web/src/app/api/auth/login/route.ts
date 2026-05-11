import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

export async function POST(request: Request) {
  const body = await request.json()

  const res = await fetch(`${SERVER_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()

  if (!res.ok) return NextResponse.json(data, { status: res.status })

  const response = NextResponse.json(data)

  if (data.token) {
    response.cookies.set('token', data.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    })
  }

  return response
}