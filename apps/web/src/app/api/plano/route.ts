import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'
import { cookies } from 'next/headers'

export async function GET() {
  const token = (await cookies()).get('token')?.value
  const res = await fetch(`${SERVER_URL}/plano`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function POST(request: Request) {
  const token = (await cookies()).get('token')?.value
  const body = await request.json()
  const res = await fetch(`${SERVER_URL}/plano`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
