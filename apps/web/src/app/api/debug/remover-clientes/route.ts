import { proxyRequest } from '@/lib/server'

export async function DELETE(request: Request) {
  const body = await request.json()
  return proxyRequest('/clientes/remover-debug', { method: 'DELETE', body: JSON.stringify(body) })
}
