'use client'

/*
 * ARQUIVO: Barra Superior (Header.tsx)
 * POSIÇÃO: src/components/layout/Header.tsx
 *
 * Componente fixo no topo de todas as páginas do painel administrativo.
 * Responsável por:
 *   - Ler o nome do usuário logado do localStorage (salvo pelo LoginForm).
 *   - Exibir as iniciais do usuário como avatar circular.
 *   - Exibir botões de notificações e mensagens (ainda sem funcionalidade real).
 *
 * O nome é lido do localStorage e não de um estado global intencional:
 * o painel é simples e não usa Context/Redux, então o localStorage serve
 * como armazenamento temporário da sessão do lado do cliente.
 */
import { useEffect, useState } from 'react'