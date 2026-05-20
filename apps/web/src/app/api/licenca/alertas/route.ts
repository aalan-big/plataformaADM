import { proxyRequest } from '@/lib/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dias = searchParams.get('dias')
  const qs = dias ? `?dias=${dias}` : ''
  return proxyRequest(`/licenca/alertas${qs}`)
}
