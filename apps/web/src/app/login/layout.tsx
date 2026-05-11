/*
 * ARQUIVO: Layout da Tela de Login (layout.tsx)
 * POSIÇÃO: src/app/login/layout.tsx
 *
 * Define o "cenário" da tela de login: tela inteira com fundo escuro
 * (#0f172a = azul-escuro quase preto) e o conteúdo centralizado na tela.
 * O `children` recebe o card de login (src/app/login/page.tsx).
 *
 * Esse layout é separado do layout do painel administrativo propositalmente
 * — a tela de login não deve ter Sidebar nem Header.
 */
export default function LoginLayout