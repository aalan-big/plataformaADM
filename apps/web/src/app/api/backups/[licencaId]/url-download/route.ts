import type { NextRequest } from 'next/server'
import { proxyRequest } from '@/lib/server'

export async function POST(req: NextRequest, ctx: RouteContext<'/api/backups/[licencaId]/url-download'>) {
  const { licencaId } = await ctx.params
  const body = await req.json().catch(() => ({}))
  return proxyRequest(`/backups/${licencaId}/url-download`, {
    method: 'POST',
    body:   JSON.stringify(body),
  })
}
