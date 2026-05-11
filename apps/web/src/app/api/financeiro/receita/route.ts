import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.toString()
  return proxyRequest(`/financeiro/receita${query ? `?${query}` : ''}`)
}
