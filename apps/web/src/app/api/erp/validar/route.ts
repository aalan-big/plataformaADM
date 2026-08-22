import { proxyRequest } from '@/lib/server'

/**
 * Proxy do /erp/validar para a bancada de debug.
 *
 * Passa pelo SERVER_URL — ou seja, pelo backend que ESTE ambiente aponta. É a
 * diferença para o `ERP_API` usado em TemaLicencas, que cai em
 * `https://api.startbig.com.br` quando NEXT_PUBLIC_API_URL não está definida e
 * acaba testando contra produção sem avisar ninguém.
 */
export async function POST(request: Request) {
  const body = await request.json()
  return proxyRequest('/erp/validar', { method: 'POST', body: JSON.stringify(body) })
}
