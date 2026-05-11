/*
 * ARQUIVO: Layout Raiz da Aplicação (layout.tsx)
 * POSIÇÃO: src/app/layout.tsx
 *
 * Este é o arquivo de layout mais externo do Next.js — ele envolve TODAS as
 * páginas do sistema. Aqui definimos:
 *   - As fontes globais (Geist Sans e Geist Mono) via Google Fonts.
 *   - O elemento <html> com o idioma configurado para pt-BR.
 *   - O <body> que serve de container para todo o restante.
 *   - As metadatas padrão da aplicação (título e descrição da aba do navegador).
 *
 * O parâmetro `children` recebe o conteúdo da página que o usuário está
 * acessando no momento — o Next.js injeta isso automaticamente.
 */
import type { Metadata } from 'next'