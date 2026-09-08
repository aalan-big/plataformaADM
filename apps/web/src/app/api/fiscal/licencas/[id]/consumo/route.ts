import { proxyRequest } from '@/lib/server'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  // Cota e consumo são por tipo de documento. Sem repassar isto, o painel
  // perguntaria sempre de NF-e e a NFC-e do cliente não apareceria em lugar
  // nenhum. Ausente, o servidor assume NFE — o comportamento de antes.
  const tipo = new URL(request.url).searchParams.get('tipo')
  return proxyRequest(`/fiscal/licencas/${id}/consumo${tipo ? `?tipo=${encodeURIComponent(tipo)}` : ''}`)
}
