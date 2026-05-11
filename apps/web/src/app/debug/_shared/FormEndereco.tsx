'use client'

/*
 * ARQUIVO: Formulário de Endereço Reutilizável (FormEndereco.tsx)
 * POSIÇÃO: src/app/debug/_shared/FormEndereco.tsx
 *
 * Componente de formulário de endereço compartilhado entre TemaClientes e
 * TemaEnderecos na página /debug. Suporta busca automática de CEP via ViaCEP.
 *
 * Campos: ID (modo edição), CEP, Tipo, Logradouro, Número, Complemento,
 *         Bairro, Cidade e UF.
 *
 * Comportamentos especiais:
 *   - `modoEdicao=true` : exibe o campo ID do endereço (UUID) para edições.
 *   - A cor do tema (`cor`) é dinâmica — muda bordas e labels por módulo
 *     (ex: 'rose' para clientes, 'sky' para endereços).
 *   - A busca de CEP dispara ao perder foco no campo (`onBlur`) ou pressionar Enter.
 *   - Se o CEP for inválido ou não encontrado, exibe mensagem de erro abaixo.
 *
 * Exports:
 *   - `FormEndereco`   : o componente em si
 *   - `EnderecoForm`   : tipo TypeScript do objeto de formulário
 *   - `enderecoVazio`  : factory que retorna um objeto EnderecoForm zerado
 */
import { useState, type ChangeEvent, type KeyboardEvent } from 'react'