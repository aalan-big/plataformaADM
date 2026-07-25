import { proxyRequest } from '@/lib/server'

export async function PATCH(request: Request) {
  const body = await request.json()
  return proxyRequest('/parceiro/vincular-cliente', { method: 'PATCH', body: JSON.stringify(body) })
}
