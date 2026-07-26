import type { NextRequest } from 'next/server'
import { proxyRequest } from '@/lib/server'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/backups/[licencaId]/eventos'>) {
  const { licencaId } = await ctx.params
  return proxyRequest(`/backups/${licencaId}/eventos`)
}
