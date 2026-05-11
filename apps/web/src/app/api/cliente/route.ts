import { proxyRequest } from '@/lib/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') ?? ''
  return proxyRequest(`/cliente${q ? `?q=${encodeURIComponent(q)}` : ''}`)
}
