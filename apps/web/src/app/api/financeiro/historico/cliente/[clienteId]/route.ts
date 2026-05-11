import { proxyRequest } from '@/lib/server'

export async function GET(_req: Request, ctx: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await ctx.params
  return proxyRequest(`/financeiro/historico/cliente/${clienteId}`)
}
