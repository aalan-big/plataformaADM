/*
 * ARQUIVO: Layout do Módulo de Clientes (layout.tsx)
 * POSIÇÃO: src/app/clientes/layout.tsx
 *
 * Define a estrutura visual padrão do painel para o módulo de Clientes.
 * Composição:
 *   <Sidebar>  — menu lateral fixo com a navegação principal
 *   <Header>   — barra superior com nome do usuário e notificações
 *   <main>     — área central com scroll onde a página de clientes é renderizada
 *
 * Esse padrão de layout é replicado em todos os módulos do painel
 * (Dispositivos, Financeiro, etc.) para manter consistência visual.
 */
import { Sidebar, Header } from '@/components/layout'

export default function ClientesLayout