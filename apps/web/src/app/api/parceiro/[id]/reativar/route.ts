import { proxyRequest } from '@/lib/server'

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyRequest(`/parceiro/${id}/reativar`, { method: 'PATCH' })
}
