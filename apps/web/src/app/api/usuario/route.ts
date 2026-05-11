import { proxyRequest } from '@/lib/server'

export async function GET() {
  return proxyRequest('/usuario')
}

export async function POST(request: Request) {
  const body = await request.json()
  return proxyRequest('/usuario', { method: 'POST', body: JSON.stringify(body) })
}

export async function PUT(request: Request) {
  const { id, ...data } = await request.json()
  return proxyRequest(`/usuario/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id') ?? ''
  return proxyRequest(`/usuario/${id}`, { method: 'DELETE' })
}
