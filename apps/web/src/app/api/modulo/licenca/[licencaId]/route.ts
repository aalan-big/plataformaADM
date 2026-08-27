import { proxyRequest } from '@/lib/server'

export async function GET(_request: Request, ctx: { params: Promise<{ licencaId: string }> }) {
  const { licencaId } = await ctx.params
  return proxyRequest(`/modulo/licenca/${licencaId}`)
}
