import { proxyRequest } from '@/lib/server'
export async function POST() {
  return proxyRequest('/notificacao/teste', { method: 'POST', body: JSON.stringify({}) })
}
