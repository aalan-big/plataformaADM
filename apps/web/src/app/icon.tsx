import { ImageResponse } from 'next/og'

/**
 * Favicon gerado em código, com a marca nova.
 *
 * Só o símbolo, sem o wordmark: a aba renderiza isto em 16 ou 32 pixels, e
 * nesse tamanho qualquer texto vira borrão. O logo circular antigo tinha
 * "START BIG" escrito dentro e sumia.
 *
 * Em código, e não como PNG, para acompanhar a identidade sem depender de
 * alguém reexportar arquivo — é o mesmo desenho do cabeçalho das páginas.
 */
export const size        = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  const barra = (altura: number, opacidade: number) => ({
    width:        7,
    height:       altura,
    borderRadius: 4,
    background:   `rgba(255,255,255,${opacidade})`,
  })

  return new ImageResponse(
    (
      <div
        style={{
          width:          '100%',
          height:         '100%',
          display:        'flex',
          alignItems:     'flex-end',
          justifyContent: 'center',
          gap:            5,
          paddingBottom:  15,
          borderRadius:   15,
          background:     'linear-gradient(145deg, #045CA1 0%, #5590BF 100%)',
        }}
      >
        <div style={barra(16, 0.45)} />
        <div style={barra(24, 0.75)} />
        <div style={barra(34, 1)} />
      </div>
    ),
    { ...size },
  )
}
