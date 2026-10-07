import { proxyRequest } from '@/lib/server'

// Painel de saúde fiscal (F4). Só leitura: o "Rodar conferência" é este mesmo GET.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return proxyRequest(`/fiscal/clientes/${id}/saude`)
}
