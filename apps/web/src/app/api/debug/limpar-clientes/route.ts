import { proxyRequest } from '@/lib/server'

export async function DELETE() {
  return proxyRequest('/clientes/limpar-debug', { method: 'DELETE' })
}
