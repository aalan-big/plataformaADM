import { proxyRequest } from '@/lib/server'

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/clientes/${id}/configuracao-fiscal`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
