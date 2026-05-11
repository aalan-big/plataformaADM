'use client'

/*
 * ARQUIVO: Input de Senha com Toggle (SenhaInput.tsx)
 * POSIÇÃO: src/app/debug/_shared/SenhaInput.tsx
 *
 * Campo de senha reutilizável usado nas seções de Login e Cadastro do /debug.
 * Possui um botão de olho (👁) que alterna entre mostrar e ocultar a senha.
 *
 * Props:
 *   - `value`    : valor atual do campo (controlado externamente)
 *   - `onChange` : handler de mudança do valor
 *
 * Nota: diferente do LoginForm de produção, este usa emojis no botão toggle
 * pois é apenas para uso interno da tela de debug.
 */
import { useState, type ChangeEvent } from 'react'