import { ImageResponse } from 'next/og'
import { DesenhoIcone } from '../_icone/desenho'

/** Ícone do manifest em 192px. Rota, e não arquivo em public/, para o desenho
 *  continuar vindo de um lugar só — ver `_icone/desenho.tsx`. */
export async function GET() {
  return new ImageResponse(<DesenhoIcone tamanho={192} />, { width: 192, height: 192 })
}
