'use client'

import { useState } from 'react'

/**
 * Logo da marca com degradação segura.
 *
 * Tenta `apps/web/public/logo-startbig.png` e, se o arquivo não existir ou
 * falhar ao carregar, desenha a marca em código no lugar. Numa tela que pede
 * CPF e senha, ícone quebrado no cabeçalho custa confiança na hora errada —
 * então ela nunca pode depender de um asset estar publicado.
 */
export function LogoStartBig({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' }) {
  const [falhou, setFalhou] = useState(false)
  const altura = tamanho === 'sm' ? 26 : 34

  if (!falhou) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/logo-startbig.png"
        alt="StartBIG"
        style={{ height: altura, width: 'auto' }}
        onError={() => setFalhou(true)}
      />
    )
  }

  return <MarcaDesenhada tamanho={tamanho} />
}

/** A marca em código: quadrado arredondado com as barras + wordmark. */
function MarcaDesenhada({ tamanho }: { tamanho: 'sm' | 'md' }) {
  const icone = tamanho === 'sm' ? 'w-7 h-7' : 'w-9 h-9'
  const texto = tamanho === 'sm' ? 'text-base' : 'text-xl'

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${icone} rounded-[10px] flex items-end justify-center gap-0.75 p-2 shrink-0`}
        style={{ background: 'linear-gradient(145deg, #045CA1 0%, #5590BF 100%)' }}
        aria-hidden
      >
        <span className="w-0.75 h-[35%] rounded-full bg-white/45" />
        <span className="w-0.75 h-[65%] rounded-full bg-white/75" />
        <span className="w-0.75 h-full  rounded-full bg-white" />
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
