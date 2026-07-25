import { proxyRequest } from '@/lib/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyRequest(`/parceiro/${id}`)
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  return proxyRequest(`/parceiro/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}
