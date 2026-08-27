import { proxyRequest } from '@/lib/server'

export async function POST(request: Request, ctx: { params: Promise<{ licencaId: string }> }) {
  const { licencaId } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/modulo/licenca/${licencaId}/extra`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
