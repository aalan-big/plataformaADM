import { NextResponse } from 'next/server'
import { SERVER_URL } from '@/lib/server'

/**
 * Vitrine da página de contratação. Sem token de propósito: quem chega aqui
 * ainda não é cliente. O backend só devolve planos marcados como públicos.
 */
export async function GET() {
  const res  = await fetch(`${SERVER_URL}/erp/planos-publicos`, { cache: 'no-store' })
  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
