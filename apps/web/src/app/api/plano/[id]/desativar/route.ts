import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'
import { cookies } from 'next/headers'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = (await cookies()).get('token')?.value
  const res = await fetch(`${SERVER_URL}/plano/${id}/desativar`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
