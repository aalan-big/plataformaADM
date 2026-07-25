import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const qs = new URL(request.url).search
  return proxyRequest(`/parceiro/repasse${qs}`)
}
