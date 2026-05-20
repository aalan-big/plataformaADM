import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

export async function GET(_req: Request, { params }: { params: Promise<{ licencaId: string }> }) {
  const { licencaId } = await params
  try {
    const res = await fetch(`${SERVER_URL}/financeiro/plano/${licencaId}`)
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ erro: 'Backend offline' }, { status: 502 })
  }
}
