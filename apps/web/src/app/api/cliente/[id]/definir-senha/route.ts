import { proxyRequest } from '@/lib/server'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/clientes/${id}/definir-senha`, { method: 'POST', body: JSON.stringify(body) })
}
