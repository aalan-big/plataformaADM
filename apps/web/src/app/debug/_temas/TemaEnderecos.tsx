'use client'

/*
 * ARQUIVO: Tema Endereços — Tela de Testes (TemaEnderecos.tsx)
 * POSIÇÃO: src/app/debug/_temas/TemaEnderecos.tsx
 *
 * Módulo de teste das operações de endereço via a rota unificada POST /api/test.
 * Diferente dos outros temas que chamam rotas REST diretas, este usa uma
 * rota de teste interna que recebe { acao, dados } e despacha para o handler.
 *
 * Seções disponíveis:
 *
 * SecaoListar    — ação: listar_enderecos
 *   Lista todos os endereços de um cliente pelo seu UUID.
 *
 * SecaoAdicionar — ação: adicionar_endereco
 *   Adiciona um novo endereço a um cliente. CEP com busca automática via ViaCEP.
 *
 * SecaoEditar    — ação: editar_endereco
 *   Edita um endereço existente pelo UUID do endereço. Só os campos preenchidos
 *   são alterados — campos vazios são ignorados.
 *
 * SecaoRemover   — ação: remover_endereco
 *   Remove permanentemente um endereço pelo seu UUID.
 *
 * Nota: este módulo usa a rota /api/test que provavelmente foi removida —
 * se o botão retornar 404, é esperado.
 */
import { useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Console } from '../_shared/Console'