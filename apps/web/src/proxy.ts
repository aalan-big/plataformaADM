import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const token    = request.cookies.get('token')?.value
  const pathname = request.nextUrl.pathname

  // Rotas de API gerenciam autenticação por conta própria — nunca redirecionar
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Rotas públicas de página
  const publica = pathname === '/login' || pathname === '/' || pathname.startsWith('/debug')

  if (!publica && !token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Usuário já logado tentando acessar /login → manda pro dashboard
  if (pathname === '/login' && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
