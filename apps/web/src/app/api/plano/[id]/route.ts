import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'
import { cookies } from 'next/headers'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = (await cookies()).get('token')?.value
  const res = await fetch(`${SERVER_URL}/plano/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = (await cookies()).get('token')?.value
  const body = await request.json()
  const res = await fetch(`${SERVER_URL}/plano/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
