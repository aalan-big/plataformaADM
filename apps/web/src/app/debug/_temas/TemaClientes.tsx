'use client'

/*
 * ARQUIVO: Tema Clientes — Tela de Testes (TemaClientes.tsx)
 * POSIÇÃO: src/app/debug/_temas/TemaClientes.tsx
 *
 * Módulo de teste completo do CRUD de clientes exibido na página /debug.
 * Cada seção testa uma rota diferente da API:
 *
 * SecaoRegistrar  — POST /api/cliente/registrar
 *   Cria um cliente (PF ou PJ) com endereço opcional.
 *   Requer `usuarioId` do usuário logado (passado como prop desde o login).
 *
 * SecaoEditar — PATCH /api/cliente/:id
 *   Cola o ID, clica em Carregar — os campos preenchem automaticamente.
 *   Altera os campos desejados e salva.
 *
 * SecaoListar — GET /api/cliente?q=
 *   Busca por nome/CPF/CNPJ/e-mail. Deixar vazio retorna todos.
 *
 * SecaoBuscar — GET /api/cliente/:id
 *   Retorna dados completos incluindo endereços.
 *
 * SecaoRemover — DELETE /api/cliente/:id
 *   Remove permanentemente um cliente.
 *
 * Export:
 *   - `TemaClientes` : componente que renderiza todas as seções
 */
import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'
import { FormEndereco, enderecoVazio, type EnderecoForm } from '../_shared/FormEndereco'