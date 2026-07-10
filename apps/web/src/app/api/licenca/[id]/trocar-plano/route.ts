import { proxyRequest } from '@/lib/server'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json()
  return proxyRequest(`/licenca/${id}/trocar-plano`, { method: 'PATCH', body: JSON.stringify(body) })
}
