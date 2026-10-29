import { proxyRequest } from '@/lib/server'

// A decisão do suporte: rota de quem não é MEI, login da prefeitura, observação.
export async function PATCH(request: Request, ctx: { params: Promise<{ ibge: string }> }) {
  const { ibge } = await ctx.params
  const body = await request.json()
  return proxyRequest(`/fiscal/municipios/${ibge}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
