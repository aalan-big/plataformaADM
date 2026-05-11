'use client'

/*
 * ARQUIVO: Console de Resposta da API (Console.tsx)
 * POSIÇÃO: src/app/debug/_shared/Console.tsx
 *
 * Componente compartilhado usado em todas as seções de teste da página /debug.
 * Exibe a resposta bruta da API em formato JSON dentro de um bloco "terminal".
 *
 * - Fundo preto para parecer um terminal real.
 * - Texto verde para respostas de sucesso (ok=true), âmbar para erros.
 * - Quando `response` é null, mostra "Aguardando requisição..." em cinza.
 * - O JSON é formatado com indentação de 2 espaços para facilitar leitura.
 */
interface ApiResponse {