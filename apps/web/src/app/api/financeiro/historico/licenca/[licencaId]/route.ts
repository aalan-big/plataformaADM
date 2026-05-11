import { proxyRequest } from '@/lib/server'

export async function GET(_req: Request, ctx: { params: Promise<{ licencaId: string }> }) {
  const { licencaId } = await ctx.params
  return proxyRequest(`/financeiro/historico/licenca/${licencaId}`)
}
