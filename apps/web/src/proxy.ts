import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Páginas que um visitante SEM sessão precisa alcançar.
 *
 * Cuidado ao mexer: quase tudo aqui é caminho de CLIENTE, não de admin. Uma
 * rota de pagamento presa atrás do login não dá erro visível — ela só some a
 * venda, e quem testa logado como admin nunca percebe. Foi o que aconteceu:
 * /renovar e /pagamento ficaram protegidas desde sempre, e o cliente que
 * pagasse cairia na tela de login vindo do Stripe.
 */
const ROTAS_PUBLICAS = [
  '/login',
  '/contratar',        // contratação de cliente novo (assine.startbig.com.br)
  '/renovar',          // escolha de período e pagamento
  '/pagamento',        // retorno do Stripe: /pagamento/sucesso e /cancelado
  '/primeiro-acesso',  // link de criar senha enviado por e-mail
  '/confirmar-email',  // link de confirmação enviado por e-mail
  '/debug',
]

function ehPublica(pathname: string): boolean {
  if (pathname === '/') return true
  return ROTAS_PUBLICAS.some(rota => pathname === rota || pathname.startsWith(`${rota}/`))
}

export function proxy(request: NextRequest) {
  const token    = request.cookies.get('token')?.value
  const pathname = request.nextUrl.pathname

  // Rotas de API gerenciam autenticação por conta própria — nunca redirecionar
  if (pathname.startsWith('/api/')) return NextResponse.next()

  if (!ehPublica(pathname) && !token) {
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
    /**
     * Além dos estáticos do Next, ficam de fora os arquivos do PWA.
     *
     * Eles NÃO são páginas e não podem cair no redirecionamento para /login:
     *  - `sw.js` é buscado pelo navegador, não pela aba. Redirecionado, o
     *    service worker não registra e não existe notificação nenhuma.
     *  - `manifest.webmanifest` é lido antes de haver sessão; sem ele o iPhone
     *    não oferece "Adicionar à Tela de Início", e sem instalar não há push.
     *  - `apple-icon` e `icon` são pedidos pelo navegador em contextos onde
     *    cookie nenhum acompanha.
     *
     * O sintoma de esquecer qualquer um deles é cruel: nada quebra visivelmente,
     * a notificação simplesmente nunca chega.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
