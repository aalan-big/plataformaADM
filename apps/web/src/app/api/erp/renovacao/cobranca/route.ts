import { proxyRequest } from '@/lib/server'

export async function POST(request: Request) {
  const body = await request.json()
  return proxyRequest('/licenca/renovacao/cobranca', { method: 'POST', body: JSON.stringify(body) })
}
