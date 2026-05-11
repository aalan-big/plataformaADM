import { proxyRequest } from '@/lib/server'

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return proxyRequest(`/licenca/${id}/resetar-sessoes`, { method: 'PATCH' })
}
