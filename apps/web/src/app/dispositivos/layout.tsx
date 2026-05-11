/*
 * ARQUIVO: Layout do Módulo de Dispositivos (layout.tsx)
 * POSIÇÃO: src/app/dispositivos/layout.tsx
 *
 * Mesma estrutura de layout do painel (Sidebar + Header + main) aplicada
 * ao módulo de Dispositivos/Licenças. Cada módulo tem seu próprio layout
 * para que o Next.js possa aplicar loading states e error boundaries
 * independentemente por módulo.
 */
import { Sidebar, Header } from '@/components/layout'

export default function DispositivosLayout