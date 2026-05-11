import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.toString()
  return proxyRequest(`/licenca${query ? `?${query}` : ''}`)
}

export async function POST(request: Request) {
  const body = await request.json()
  return proxyRequest('/licenca', { method: 'POST', body: JSON.stringify(body) })
}