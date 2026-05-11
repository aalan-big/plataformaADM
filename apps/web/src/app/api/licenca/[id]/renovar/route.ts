import { proxyRequest } from '@/lib/server'

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/licenca/${id}/renovar`, { method: 'POST', body: JSON.stringify(body) })
}
