import { proxyRequest } from '@/lib/server'

// Cadastra ou renova a cidade direto da Focus (ignora o cache de um dia).
export async function POST(_request: Request, ctx: { params: Promise<{ ibge: string }> }) {
  const { ibge } = await ctx.params
  return proxyRequest(`/fiscal/municipios/${ibge}/atualizar`, { method: 'POST' })
}
