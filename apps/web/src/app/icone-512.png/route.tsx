import { ImageResponse } from 'next/og'
import { DesenhoIcone } from '../_icone/desenho'

/** Ícone do manifest em 512px — usado pelo Android e pelo instalador. */
export async function GET() {
  return new ImageResponse(<DesenhoIcone tamanho={512} />, { width: 512, height: 512 })
}
