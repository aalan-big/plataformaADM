import { proxyRequest } from '@/lib/server'

export async function POST(req: Request) {
  const body = await req.json()
  return proxyRequest('/financeiro/cobranca', { method: 'POST', body: JSON.stringify(body) })
}
