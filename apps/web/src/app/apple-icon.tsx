import { ImageResponse } from 'next/og'
import { DesenhoIcone } from './_icone/desenho'

/**
 * Ícone do app na tela inicial do iPhone — e, por consequência, o ícone que
 * aparece em TODA notificação push no iOS.
 *
 * No iOS a notificação não usa o `icon` da mensagem; ela usa o ícone do app
 * instalado. Então este arquivo é o que decide como o aviso de pagamento se
 * apresenta na tela de bloqueio.
 *
 * 180×180 é o tamanho que o iOS pede. Sem cantos arredondados: o sistema aplica
 * a máscara dele, e arredondar aqui criaria uma borda dupla.
 */
export const size        = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(<DesenhoIcone tamanho={180} />, { ...size })
}
