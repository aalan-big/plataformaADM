import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

export async function GET() {
  try {
    const res = await fetch(`${SERVER_URL}/licenca/chave-publica`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ erro: 'Backend offline' }, { status: 502 })
  }
}
