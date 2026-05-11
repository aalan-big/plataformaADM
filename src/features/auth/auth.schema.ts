/**
 * ARQUIVO: Schema de Login (Zod)
 * POSIÇÃO: Camada de Validação de Entrada
 * FUNÇÃO: Validar os dados do formulário de login ANTES de enviar para o banco.
 * Ele protege o servidor de requisições inúteis ou malformadas.
 */
import { z } from 'zod'

// Definição das regras de validação para o Login
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'O e-mail é obrigatório.') // Garante que o campo não venha vazio
    .email('Insira um endereço de e-mail válido.') // Checa se tem @ e domínio (.com, etc)
    .max(255, 'O e-mail excede o limite de caracteres permitidos.'),

  senha: z
    .string()
    .min(6, 'A senha precisa ter no mínimo 6 caracteres.') // Segurança mínima
    .max(100, 'A senha excede o limite de caracteres permitidos.'), // Proteção contra ataques de textos gigantes
})

/**
 * TIPAGEM EXTRAÍDA
 * Aqui o TypeScript cria um tipo 'LoginInput' baseado nas regras acima.
 * Se você mudar a regra no Zod, o tipo se atualiza sozinho em todo o projeto.
 */
export type LoginInput = z.infer<typeof loginSchema>
