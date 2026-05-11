import { proxyRequest } from '@/lib/server'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return proxyRequest(`/licenca/${id}`)
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return proxyRequest(`/licenca/${id}`, { method: 'DELETE' })
}