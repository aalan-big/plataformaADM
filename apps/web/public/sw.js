/**
 * Service worker do painel StartBIG.
 *
 * Só existe para receber notificação push. Não faz cache de nada, e isso é
 * deliberado: cache mal calibrado num painel administrativo mostra saldo velho
 * como se fosse atual, e número financeiro errado na tela é pior do que tela
 * que não carrega.
 */

self.addEventListener('push', function (event) {
  if (!event.data) return

  let dados
  try {
    dados = event.data.json()
  } catch {
    // Payload que não é JSON não deveria acontecer — mas se acontecer, mostrar
    // algo genérico é melhor que engolir em silêncio uma notificação que o
    // servidor achou importante o bastante para enviar.
    dados = { titulo: 'StartBIG', corpo: 'Você tem uma novidade no painel.' }
  }

  const opcoes = {
    body:    dados.corpo,
    // No iOS estes dois campos são ignorados: o sistema usa o ícone do app
    // instalado na tela inicial. Ficam para Android e desktop.
    icon:    '/icone-192.png',
    badge:   '/icone-192.png',
    vibrate: [80, 40, 80],
    data:    { url: dados.url || '/financeiro' },
    // Sem `tag`: cada pagamento é um evento próprio. Com tag fixa, dois
    // pagamentos seguidos virariam um aviso só e o segundo passaria batido.
    ...(dados.tag ? { tag: dados.tag } : {}),
  }

  event.waitUntil(self.registration.showNotification(dados.titulo, opcoes))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  const destino = (event.notification.data && event.notification.data.url) || '/financeiro'

  // Reaproveita uma janela já aberta em vez de abrir outra. Sem isto, cada
  // notificação tocada empilharia mais uma aba do painel no celular.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (janelas) {
      for (const janela of janelas) {
        if ('focus' in janela) {
          janela.navigate?.(destino)
          return janela.focus()
        }
      }
      return self.clients.openWindow(destino)
    }),
  )
})
