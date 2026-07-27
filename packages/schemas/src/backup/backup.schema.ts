import { z } from 'zod'

/// Teto de 500 MB por arquivo. Não é chute: é o valor que vai assinado no
/// Content-Length da URL, então é o limite que a nuvem realmente impõe — não
/// uma sugestão que o cliente pode ignorar.
///
/// Com a partição de OS por mês, este teto deixou de ser uma bomba-relógio: ele
/// se aplica a CADA pedaço, e pedaço é um mês de fotos, não o acervo inteiro.
/// Antes, com um único pacote de imagens crescendo para sempre, era garantido
/// que uma hora estouraria e o backup pararia de funcionar.
export const BACKUP_TAMANHO_MIN_BYTES = 1024               // 1 KB
export const BACKUP_TAMANHO_MAX_BYTES = 500 * 1024 * 1024  // 500 MB

/// `banco` e `imagens` são ESPELHOS: chave fixa, o envio de hoje substitui o de
/// ontem. `os` é ARQUIVO MORTO, particionado por mês — cada pedaço sobe uma vez
/// e nunca mais. Ver a explicação completa no enum TipoBackup do schema Prisma.
export const tipoBackupSchema = z.enum(['banco', 'imagens', 'os'])

/// Mês do pedaço. Formato 'YYYY-MM', que ordena igual em texto e em data.
export const periodoBackupSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "periodo deve ser 'AAAA-MM' (ex.: '2026-07').")

export const urlUploadBackupSchema = z
  .object({
    hwid:  z.string().min(1),
    tipo:  tipoBackupSchema,
    /// Obrigatório em `os`, proibido nos demais — ver o refine abaixo.
    periodo: periodoBackupSchema.optional(),
    tamanhoBytes: z.number()
      .int()
      .min(BACKUP_TAMANHO_MIN_BYTES, 'Arquivo pequeno demais para ser um backup válido.')
      .max(BACKUP_TAMANHO_MAX_BYTES, 'Arquivo acima do limite de 500 MB.'),
    /// SHA-256 do conteúdo em hex. Obrigatório em `imagens` e `os`: é o que deixa
    /// o servidor responder "não precisa subir, nada mudou" em vez de pagar o
    /// upload de novo.
    ///
    /// Calcule sobre um MANIFESTO ordenado (caminho|tamanho|mtime de cada
    /// arquivo), nunca sobre o .zip: zip não é determinístico, o hash mudaria
    /// todo dia e a deduplicação nunca dispararia.
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i, 'checksumSha256 deve ser SHA-256 em hex.').optional(),
    origem: z.enum(['AUTOMATICO', 'MANUAL']).default('AUTOMATICO'),
  })
  /// O par tipo/periodo é validado aqui, e não no service, porque um `os` sem mês
  /// não tem chave onde ser gravado e um `banco` com mês daria a entender que
  /// existe histórico de banco por período — que não existe.
  .refine(d => d.tipo !== 'os' || Boolean(d.periodo), {
    message: "periodo é obrigatório quando tipo é 'os'.",
    path:    ['periodo'],
  })
  .refine(d => d.tipo === 'os' || !d.periodo, {
    message: "periodo só se aplica a tipo 'os'.",
    path:    ['periodo'],
  })

export const confirmarBackupSchema = z.object({
  uploadId: z.string().uuid(),
  hwid:     z.string().min(1),
  ok:       z.boolean(),
  tamanhoBytes: z.number().int().min(0).optional(),
  erro:     z.string().max(500).optional(),
})

/// Download não pede `periodo`: em `os` o ERP quer TODOS os pedaços (restauração
/// é do acervo inteiro, não de um mês solto), e nos espelhos existe um só. Pedir
/// mês a mês seria N chamadas para reconstruir o que o servidor já sabe montar.
export const urlDownloadBackupSchema = z.object({
  hwid: z.string().min(1),
  tipo: tipoBackupSchema,
})
