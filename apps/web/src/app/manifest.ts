import type { MetadataRoute } from 'next'

/**
 * Manifest do PWA — é ele que torna o painel instalável na tela inicial.
 *
 * No iPhone isso não é enfeite: notificação web só existe para app instalado na
 * tela inicial. Em aba do Safari a API nem aparece, então sem manifest válido
 * não há como notificar ninguém no iOS.
 *
 * `display: standalone` abre sem a barra do navegador, que é o que faz parecer
 * app de verdade — e é também o que o iOS usa para decidir se aceita o push.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'StartBIG',
    short_name:       'StartBIG',
    description:      'Painel de gestão StartBIG',
    start_url:        '/financeiro',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#0f172a',
    theme_color:      '#045CA1',
    lang:             'pt-BR',
    icons: [
      { src: '/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` deixa o Android recortar no formato do sistema sem cortar o
      // desenho. O iOS ignora e usa o apple-icon, que tem rota própria.
      { src: '/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
