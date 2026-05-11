'use client'

/*
 * ARQUIVO: Menu Lateral (Sidebar.tsx)
 * POSIÇÃO: src/components/layout/Sidebar.tsx
 *
 * Barra de navegação lateral presente em todos os módulos do painel.
 * Como funciona:
 *   - O array `itens` define todos os links do menu (label, ícone, url).
 *   - Links com href='#' estão BLOQUEADOS (módulos ainda não implementados).
 *   - O item ativo é detectado pelo usePathname() do Next.js, que retorna
 *     a URL atual — o item cujo href começa com ela recebe destaque azul.
 *   - O botão "Sair" chama POST /api/auth/logout (limpa o cookie de sessão)
 *     e remove os dados do usuário do localStorage antes de redirecionar.
 *
 * A sidebar fica oculta em mobile (hidden md:flex) — em telas pequenas
 * seria necessário um menu hambúrguer (não implementado ainda).
 */
import { useRouter, usePathname } from 'next/navigation'