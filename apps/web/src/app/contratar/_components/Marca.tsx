import Image from 'next/image'

/**
 * Logo da marca, servido de `apps/web/public/logo-startbig.png`.
 *
 * Arquivo em `public/` é servido na raiz do domínio e versionado junto com o
 * código — então ele sobe no mesmo deploy da página. Se um dia o arquivo sumir,
 * o `alt` mantém a identificação da empresa no lugar do ícone quebrado, que é o
 * mínimo aceitável numa tela que pede CPF e senha.
 */
export function LogoStartBig({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' }) {
  // O logo é horizontal, proporção ~2,7:1 (ícone + wordmark).
  const altura  = tamanho === 'sm' ? 26 : 34
  const largura = Math.round(altura * 2.7)

  return (
    <Image
      src="/logo-startbig.png"
      alt="StartBIG"
      width={largura}
      height={altura}
      priority
      className="h-auto w-auto"
      style={{ height: altura }}
    />
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
