import { z } from 'zod'

/// Teto de 500 MB por arquivo. Não é chute: é o valor que vai assinado no
/// Content-Length da URL, então é o limite que a nuvem realmente impõe — não
/// uma sugestão que o cliente pode ignorar.
export const BACKUP_TAMANHO_MIN_BYTES = 1024               // 1 KB
export const BACKUP_TAMANHO_MAX_BYTES = 500 * 1024 * 1024  // 500 MB

export const tipoBackupSchema = z.enum(['banco', 'imagens'])

export const urlUploadBackupSchema = z.object({
  hwid:  z.string().min(1),
  tipo:  tipoBackupSchema,
  tamanhoBytes: z.number()
    .int()
    .min(BACKUP_TAMANHO_MIN_BYTES, 'Arquivo pequeno demais para ser um backup válido.')
    .max(BACKUP_TAMANHO_MAX_BYTES, 'Arquivo acima do limite de 500 MB.'),
  /// SHA-256 do zip em hex. Obrigatório em `imagens`: é o que deixa o servidor
  /// responder "não precisa subir, nada mudou" em vez de pagar o upload de novo.
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i, 'checksumSha256 deve ser SHA-256 em hex.').optional(),
  origem: z.enum(['AUTOMATICO', 'MANUAL']).default('AUTOMATICO'),
})

export const confirmarBackupSchema = z.object({
  uploadId: z.string().uuid(),
  hwid:     z.string().min(1),
  ok:       z.boolean(),
  tamanhoBytes: z.number().int().min(0).optional(),
  erro:     z.string().max(500).optional(),
})

export const urlDownloadBackupSchema = z.object({
  hwid: z.string().min(1),
  tipo: tipoBackupSchema,
})
