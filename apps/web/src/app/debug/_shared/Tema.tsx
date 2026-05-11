'use client'

/*
 * ARQUIVO: Container de Módulo (Tema.tsx)
 * POSIÇÃO: src/app/debug/_shared/Tema.tsx
 *
 * Componente de container colapsável usado na página /debug para agrupar
 * seções de teste de cada módulo (Login, Clientes, Licenças, Financeiro).
 *
 * Comportamento:
 *   - Por padrão inicia ABERTO (useState(true)).
 *   - O cabeçalho é um botão que alterna entre aberto/fechado mostrando ▲/▼.
 *   - Quando aberto, renderiza os `children` em um grid de 2 colunas (lg).
 *   - Cada `children` é uma seção de teste (SecaoCadastro, SecaoLogin, etc.).
 *
 * Props:
 *   - `titulo`   : texto exibido no cabeçalho do container
 *   - `children` : seções de teste a serem exibidas dentro do container
 */
import { useState, type ReactNode } from 'react'