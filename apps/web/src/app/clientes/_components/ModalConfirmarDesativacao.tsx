'use client'

/*
 * ARQUIVO: Modal Confirmar Desativação (ModalConfirmarDesativacao.tsx)
 * POSIÇÃO: src/app/clientes/_components/ModalConfirmarDesativacao.tsx
 *
 * Modal de confirmação de dupla verificação antes de desativar um cliente.
 * Exibe o nome do cliente em destaque e explica que a operação é REVERSÍVEL
 * (o cliente não é excluído do banco, apenas marcado como inativo).
 *
 * Props:
 *   - `nomeCliente` : nome exibido no card de confirmação
 *   - `processando` : quando true, desabilita os botões e mostra spinner
 *   - `onConfirmar` : chamado quando o usuário confirma a desativação
 *   - `onCancelar`  : fecha o modal sem fazer nada
 *
 * Ao clicar no overlay escuro, o modal fecha apenas se não estiver processando
 * (evita que o usuário cancele acidentalmente enquanto a requisição ocorre).
 */
import { AlertTriangle, Loader2, X } from 'lucide-react'