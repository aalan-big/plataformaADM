import { proxyRequest } from '@/lib/server'

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return proxyRequest(`/fiscal/licencas/${id}/consumo`)
}
