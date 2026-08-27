import { proxyRequest } from '@/lib/server'

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ licencaId: string; identificador: string }> },
) {
  const { licencaId, identificador } = await ctx.params
  return proxyRequest(`/modulo/licenca/${licencaId}/extra/${identificador}`, { method: 'DELETE' })
}
