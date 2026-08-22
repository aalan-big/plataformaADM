/**
 * O símbolo da marca, em um lugar só.
 *
 * Mesmo desenho do favicon: gradiente azul e as três barras crescendo. Fica
 * aqui, compartilhado, porque agora ele é usado em quatro tamanhos diferentes
 * (aba, tela inicial do iPhone, manifest 192 e 512) — e um ícone que diverge
 * entre eles é pior do que ícone feio: parece outro app.
 *
 * Sem cantos arredondados de propósito nos tamanhos grandes: iOS e Android
 * aplicam a máscara do sistema por cima. Arredondar aqui daria canto duplo.
 */
export function DesenhoIcone({ tamanho, arredondar = false }: { tamanho: number; arredondar?: boolean }) {
  // Proporções derivadas do tamanho para o desenho ficar idêntico em qualquer
  // resolução — barra fixa em pixel encolheria a olho nos ícones grandes.
  const largura = Math.round(tamanho * 0.109)
  const vao     = Math.round(tamanho * 0.078)
  const base    = Math.round(tamanho * 0.234)

  const barra = (fracaoAltura: number, opacidade: number) => ({
    width:        largura,
    height:       Math.round(tamanho * fracaoAltura),
    borderRadius: Math.round(largura * 0.57),
    background:   `rgba(255,255,255,${opacidade})`,
  })

  return (
    <div
      style={{
        width:          '100%',
        height:         '100%',
        display:        'flex',
        alignItems:     'flex-end',
        justifyContent: 'center',
        gap:            vao,
        paddingBottom:  base,
        borderRadius:   arredondar ? Math.round(tamanho * 0.234) : 0,
        background:     'linear-gradient(145deg, #045CA1 0%, #5590BF 100%)',
      }}
    >
      <div style={barra(0.25,  0.45)} />
      <div style={barra(0.375, 0.75)} />
      <div style={barra(0.53,  1)}    />
    </div>
  )
}
