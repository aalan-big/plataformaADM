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

  // Credenciais do bucket de backup NÃO derrubam o boot de propósito: a API
  // inteira ficaria fora do ar num deploy feito antes de o bucket existir, e
  // licença/cobrança não dependem de backup. Sem elas, só as rotas de backup
  // respondem BACKUP_NAO_CONFIGURADO — e o aviso abaixo grita no log.
  const backup = ['BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_S3_ENDPOINT']
  const faltandoBackup = backup.filter(k => !process.env[k])

  if (faltandoBackup.length > 0)
    console.warn(
      `[BACKUP] Storage em nuvem DESATIVADO — variáveis ausentes: ${faltandoBackup.join(', ')}. ` +
      `As rotas /erp/backup/* vão recusar com BACKUP_NAO_CONFIGURADO.`,
    )
}
