'use client'

/*
 * ARQUIVO: Tema Financeiro — Tela de Testes (TemaFinanceiro.tsx)
 * POSIÇÃO: src/app/debug/_temas/TemaFinanceiro.tsx
 *
 * Módulo de teste completo do sistema financeiro exibido na página /debug.
 * Exporta 5 seções independentes, cada uma testando uma parte do módulo:
 *
 * SecaoConfirmarPagamento — POST /api/financeiro/confirmar
 *   Fluxo de 3 passos: busca o cliente → seleciona a licença → preenche o valor.
 *   Ao confirmar, renova a licença e exibe a nova chave de ativação gerada.
 *
 * SecaoTransacoes — GET /api/financeiro/transacoes/cliente/:id ou .../licenca/:id
 *   Feed imutável de eventos financeiros (TransacaoHistorico). Mostra tipo
 *   (Pagamento/Estorno/Trial/Ajuste), origem (MANUAL/ASAAS) e valor.
 *
 * SecaoHistoricoPagamentos — GET /api/financeiro/historico/cliente/:id ou .../licenca/:id
 *   Registros da tabela Pagamento — um por pagamento confirmado.
 *
 * SecaoReceita — GET /api/financeiro/receita?ano=&mes=
 *   Soma dos pagamentos PAGO em um mês/ano. Mostra total e quantidade.
 *
 * SecaoWebhook — POST /api/financeiro/webhook/asaas
 *   Simula o callback automático do Asaas. O campo `externalReference` deve
 *   ser o UUID da licença — é assim que o webhook sabe qual licença renovar.
 */
import { useState, type ChangeEvent } from 'react'
import { Console } from '../_shared/Console'