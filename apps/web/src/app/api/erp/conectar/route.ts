import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const res = await fetch(`${SERVER_URL}/licenca/conectar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ erro: 'Backend offline' }, { status: 502 })
  }
}
