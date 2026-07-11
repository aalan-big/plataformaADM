/**
 * ============================================================================
 * NOME DO ARQUIVO: secrets.ts
 * MÓDULO: CORE/CONFIG
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Centraliza a leitura de segredos sensíveis do ambiente. Em produção nenhum
 * fallback inseguro é permitido — a ausência de um segredo obrigatório derruba
 * o boot em vez de subir com uma chave conhecida (que qualquer um poderia forjar).
 * ============================================================================
 */

const DEV_JWT_FALLBACK = 'chave-secreta-de-desenvolvimento'

function ehProducao(): boolean {
  return process.env.NODE_ENV === 'production'
}

/**
 * Segredo usado para assinar/verificar o JWT do painel admin.
 * Em produção é obrigatório; em dev cai num fallback fixo por conveniência.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if (ehProducao())
    throw new Error('JWT_SECRET não configurada — é obrigatória em produção.')
  return DEV_JWT_FALLBACK
}

/**
 * Valida, no boot, que todos os segredos obrigatórios em produção estão presentes.
 * Falha cedo (antes de aceitar requisições) em vez de estourar na 1ª chamada.
 */
export function validarSegredosProducao(): void {
  if (!ehProducao()) return

  const obrigatorias = ['JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
  const faltando = obrigatorias.filter(k => !process.env[k])

  if (faltando.length > 0)
    throw new Error(`Variáveis de ambiente obrigatórias ausentes em produção: ${faltando.join(', ')}`)
}
