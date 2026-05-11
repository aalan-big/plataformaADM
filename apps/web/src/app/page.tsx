/*
 * ARQUIVO: Página Raiz (page.tsx)
 * POSIÇÃO: src/app/page.tsx
 *
 * Esta é a primeira página acessada quando alguém entra na URL raiz ("/").
 * Ela não exibe nada — apenas redireciona o usuário automaticamente para
 * o Dashboard (/dashboard).
 *
 * Em sistemas reais, aqui você poderia verificar se o usuário está logado
 * antes de decidir para onde redirecionar (dashboard ou login).
 */
import { redirect } from 'next/navigation'