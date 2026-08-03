import { z } from 'zod'

/// Piso de 1 KB: zip menor que isso não é backup, é pasta vazia empacotada.
export const BACKUP_TAMANHO_MIN_BYTES = 1024

/// Teto por envio. Não é chute nem preferência: é o limite do PUT único no
/// protocolo S3/R2. Acima de 5 GiB não existe forma de gravar um objeto sem
/// multipart, então autorizar mais que isso seria assinar uma URL que a nuvem
/// recusa — com um erro que não diz nada sobre tamanho.
///
/// O valor vai assinado no Content-Length, então é o limite que a nuvem
/// realmente impõe, não uma sugestão que o cliente pode ignorar.
///
/// ⚠ O FULL leva o acervo inteiro num pacote só, e cresce com a idade da
/// instalação: a ~12 MB/dia de fotos, um cliente cruza este teto por volta de 14
/// meses de operação e o backup para de funcionar sem aviso. O conserto é o full
/// sair em partes (ver `docs/backup-plano-cadeia.md`, seção 6) — está pendente,
/// e é a razão de este número ser o do protocolo e não um valor confortável.
export const BACKUP_TAMANHO_MAX_BYTES = 5 * 1024 * 1024 * 1024

/// FULL é o acervo inteiro; FRAGMENTO é o que mudou desde o envio anterior.
/// Ver a explicação completa no enum TipoBackup do schema Prisma.
export const tipoBackupSchema = z.enum(['full', 'fragmento'])

/// Ciclo em 'YYYY-MM-DD' — sempre a segunda-feira que o abriu. O ERP não calcula
/// este valor: ele lê `cicloCorrente` do /status, porque o corte é no fuso de São
/// Paulo pelo relógio do SERVIDOR. Máquina de cliente com data errada faria o
/// full no dia errado, ou nunca.
export const cicloBackupSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "ciclo deve ser 'AAAA-MM-DD' (ex.: '2026-08-03').")

export const urlUploadBackupSchema = z.object({
  hwid:  z.string().min(1),
  tipo:  tipoBackupSchema,
  ciclo: cicloBackupSchema,
  tamanhoBytes: z.number()
    .int()
    .min(BACKUP_TAMANHO_MIN_BYTES, 'Arquivo pequeno demais para ser um backup válido.')
    .max(BACKUP_TAMANHO_MAX_BYTES, 'Arquivo acima do limite por envio.'),
  /// O código que o ERP calcula sobre a pasta de pendentes, em hex.
  ///
  /// Obrigatório em TODO envio — inclusive no full. É ele que faz o servidor
  /// responder PULAR quando nada mudou, e sem ele o cliente sobe o acervo inteiro
  /// a cada login. No desenho anterior o tipo `banco` era isento porque espelho
  /// mudava todo dia de qualquer jeito; aqui não há isenção.
  codigoConteudo: z.string().regex(/^[a-f0-9]{64}$/i, 'codigoConteudo deve ser um hash SHA-256 em hex.'),
  origem: z.enum(['AUTOMATICO', 'MANUAL']).default('AUTOMATICO'),
})

export const confirmarBackupSchema = z.object({
  uploadId: z.string().uuid(),
  hwid:     z.string().min(1),
  ok:       z.boolean(),
  tamanhoBytes: z.number().int().min(0).optional(),
  erro:     z.string().max(500).optional(),
})

/// Download não escolhe tipo nem arquivo: restaurar é baixar a CORRENTE inteira
/// do ciclo — o full mais todos os fragmentos, na ordem de extração. Meia
/// restauração é pior que nenhuma, porque parece completa.
///
/// `ciclo` é opcional e existe para quando a retenção passar a guardar mais de um
/// ciclo; omitido, devolve o corrente.
export const urlDownloadBackupSchema = z.object({
  hwid:  z.string().min(1),
  ciclo: cicloBackupSchema.optional(),
})
