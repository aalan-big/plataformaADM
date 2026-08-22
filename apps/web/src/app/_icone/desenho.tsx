import fs from 'fs'
import path from 'path'

/**
 * O ícone do app, em um lugar só.
 *
 * É usado em quatro tamanhos (aba do navegador, tela inicial do iPhone,
 * manifest 192 e 512) — e ícone que diverge entre eles não parece descuido,
 * parece outro aplicativo.
 *
 * ── Por que a arte não é usada crua ──────────────────────────────────────────
 * O arquivo original já vem com os cantos arredondados desenhados e o fundo em
 * volta deles é BRANCO. iOS e Android aplicam a máscara arredondada por conta
 * própria, então usar assim deixaria quatro lascas brancas nas quinas, contra o
 * fundo escuro da tela inicial.
 *
 * A correção é geométrica: a arte entra ampliada (`ESCALA`) e centralizada, e o
 * contêiner recorta com o mesmo raio que ela já tem. O branco fica de fora do
 * quadro, e o que sobra é o desenho sangrando até a borda — que é exatamente o
 * que o sistema operacional espera receber.
 */

/**
 * Quanto a arte é ampliada antes de recortar.
 *
 * Vem da proporção do próprio arquivo: o quadrado arredondado ocupa cerca de
 * 88% da largura, e o resto é a margem branca. 1.14 ≈ 1/0.88 leva as bordas do
 * desenho até as bordas do quadro. Mexer neste número sem olhar o resultado
 * traz o branco de volta ou come as barras.
 */
const ESCALA = 1.14

/** Raio do recorte, na mesma proporção do arredondamento da arte original. */
const RAIO = 0.225

/** Azul-marinho do fundo da arte. Aparece se sobrar qualquer fresta no recorte. */
const FUNDO = '#061428'

/**
 * Lido do disco uma vez por processo, e não a cada requisição.
 *
 * `ImageResponse` não busca arquivo local por caminho — a arte precisa chegar
 * embutida. Ler a cada chamada seria reabrir 1 MB do disco para devolver um
 * ícone de 180 pixels.
 */
const arte = (() => {
  const caminho = path.join(process.cwd(), 'public', 'icone.jpeg')
  const bytes   = fs.readFileSync(caminho)

  // O tipo sai dos BYTES, não da extensão. O arquivo entregue tem nome .jpeg e
  // conteúdo PNG — declarar o MIME errado faz o decodificador estourar com um
  // "Offset is outside the bounds of the DataView", que não sugere em nada que
  // o problema é o nome do arquivo. Ler a assinatura evita a caça ao fantasma.
  const ehPng = bytes.toString('hex', 0, 4) === '89504e47'
  const tipo  = ehPng ? 'image/png' : 'image/jpeg'

  return `data:${tipo};base64,${bytes.toString('base64')}`
})()

export function DesenhoIcone({ tamanho }: { tamanho: number }) {
  const lado         = Math.round(tamanho * ESCALA)
  const deslocamento = Math.round((lado - tamanho) / 2)

  return (
    <div
      style={{
        width:        '100%',
        height:       '100%',
        display:      'flex',
        position:     'relative',
        overflow:     'hidden',
        borderRadius: Math.round(tamanho * RAIO),
        background:   FUNDO,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={arte}
        alt=""
        width={lado}
        height={lado}
        style={{ position: 'absolute', left: -deslocamento, top: -deslocamento }}
      />
    </div>
  )
}
