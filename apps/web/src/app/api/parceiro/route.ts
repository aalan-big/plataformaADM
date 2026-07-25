import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const qs = new URL(request.url).search
  return proxyRequest(`/parceiro${qs}`)
}

export async function POST(request: Request) {
  const body = await request.json()
  return proxyRequest('/parceiro', { method: 'POST', body: JSON.stringify(body) })
}
