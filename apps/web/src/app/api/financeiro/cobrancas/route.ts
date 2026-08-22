import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const url    = new URL(request.url)
  const status = url.searchParams.get('status') ?? ''
  const qs     = status ? `?status=${encodeURIComponent(status)}` : ''
  return proxyRequest(`/financeiro/cobrancas${qs}`, { method: 'GET' })
}
