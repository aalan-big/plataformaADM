import { proxyRequest } from '@/lib/server'

export async function PATCH(request: Request, ctx: { params: Promise<{ identificador: string }> }) {
  const { identificador } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/modulo/${identificador}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
