import { proxyRequest } from '@/lib/server'

// Troca manual da rota da NFS-e: reconfigura a empresa na Focus.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/fiscal/clientes/${id}/nfse-rota`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
