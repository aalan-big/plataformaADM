import { proxyRequest } from '@/lib/server'
export async function GET() {
  return proxyRequest('/notificacao/aparelhos', { method: 'GET' })
}
