/**
 * Identidade visual do site reproduzida em código — ícone de barras em quadrado
 * arredondado com o azul da marca, e o wordmark "Start" escuro + "BIG" azul.
 *
 * Feito assim, e não com arquivo de imagem, para a página não depender de um
 * asset que vive no outro projeto: um logo quebrado no topo da tela de
 * pagamento derruba a confiança na hora errada.
 */
export function LogoStartBig({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' }) {
  const icone = tamanho === 'sm' ? 'w-7 h-7' : 'w-9 h-9'
  const texto = tamanho === 'sm' ? 'text-base' : 'text-xl'

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${icone} rounded-[10px] flex items-end justify-center gap-[3px] p-2 shrink-0`}
        style={{ background: 'linear-gradient(145deg, #045CA1 0%, #5590BF 100%)' }}
        aria-hidden
      >
        <span className="w-[3px] h-[35%] rounded-full bg-white/45" />
        <span className="w-[3px] h-[65%] rounded-full bg-white/75" />
        <span className="w-[3px] h-full  rounded-full bg-white" />
      </div>

      <span className={`${texto} font-extrabold tracking-tight`}>
        <span className="text-[#151515]">Start</span>
        <span className="text-[#045CA1]">BIG</span>
      </span>
    </div>
  )
}

/** Pílula de seção, no mesmo estilo dos badges "Planos" e "Segmentos" do site. */
export function BadgeSecao({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-xs font-semibold px-3 py-1 rounded-full bg-[#E7F1FA] text-[#045CA1]">
      {children}
    </span>
  )
}
