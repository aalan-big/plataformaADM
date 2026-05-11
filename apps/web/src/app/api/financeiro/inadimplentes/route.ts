import { proxyRequest } from '@/lib/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  return proxyRequest(`/financeiro/inadimplentes?${searchParams}`)
}
