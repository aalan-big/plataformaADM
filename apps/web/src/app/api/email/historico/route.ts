import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const { search } = new URL(request.url)
  return proxyRequest(`/email/historico${search}`)
}
