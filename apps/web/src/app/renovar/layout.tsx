/*
 * ARQUIVO: Layout da Página de Renovação (layout.tsx)
 * POSIÇÃO: src/app/renovar/layout.tsx
 *
 * Layout PÚBLICO — não tem Sidebar nem Header, pois esta página é acessada
 * diretamente pelo cliente (não pelo administrador) para renovar uma licença.
 * O link de renovação é enviado por e-mail com o parâmetro ?licencaId=...
 *
 * Exibe conteúdo centralizado na tela, igual ao layout de login.
 */
export default function RenovarLayout