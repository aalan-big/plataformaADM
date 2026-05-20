import { proxyRequest } from '@/lib/server'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return proxyRequest(`/clientes/${id}`)
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

