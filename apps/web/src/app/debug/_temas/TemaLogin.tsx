'use client'

/*
 * ARQUIVO: Tema Login — Tela de Testes (TemaLogin.tsx)
 * POSIÇÃO: src/app/debug/_temas/TemaLogin.tsx
 *
 * Módulo de teste do sistema de autenticação exibido na página /debug.
 * Composto por duas seções independentes:
 *
 * SecaoCadastro — POST /api/usuario
 *   Cria um novo usuário administrador no sistema. Campos: nome, e-mail,
 *   senha e tipo (ADMIN / GERENTE / SUPORTE). O Console exibe a resposta bruta.
 *
 * SecaoLogin — POST /api/auth/login
 *   Autentica um usuário existente. Se o login for bem-sucedido, chama
 *   `onLogin` com os dados do usuário (id, nome, e-mail) — isso desbloqueia
 *   os módulos de Clientes, Licenças e Financeiro na página de debug.
 *
 * Export:
 *   - `TemaLogin` : componente que renderiza as duas seções lado a lado
 */
import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'
import { SenhaInput } from '../_shared/SenhaInput'