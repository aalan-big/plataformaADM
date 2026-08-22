import { proxyRequest } from '@/lib/server'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const url    = new URL(request.url)
  const chave  = url.searchParams.get('chave') ?? ''
  const hwid   = url.searchParams.get('hwid')  ?? ''
  const qs     = new URLSearchParams({ chave, ...(hwid ? { hwid } : {}) }).toString()
  return proxyRequest(`/licenca/renovacao/cobranca/${id}?${qs}`, { method: 'GET' })
}
