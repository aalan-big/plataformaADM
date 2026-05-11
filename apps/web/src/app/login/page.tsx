/*
 * ARQUIVO: Página de Login (page.tsx)
 * POSIÇÃO: src/app/login/page.tsx
 *
 * Renderiza o card de login visualmente estilizado. A lógica de autenticação
 * fica no componente LoginForm (src/app/login/_components/LoginForm.tsx).
 *
 * Estrutura visual:
 *   Card escuro com topo decorativo (logo "SB" + gradiente)
 *   → LoginForm (campos de e-mail e senha + botão Entrar)
 *   → Rodapé com copyright
 *
 * Após o login bem-sucedido, o LoginForm redireciona para /dashboard.
 */
import { LoginForm } from './_components/LoginForm'