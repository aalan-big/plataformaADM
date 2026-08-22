import { proxyRequest } from '@/lib/server'
export async function GET() {
  return proxyRequest('/notificacao/config', { method: 'GET' })
}
