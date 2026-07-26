/**
 * ============================================================================
 * NOME DO ARQUIVO: storage.service.ts
 * MÓDULO: COMMON/STORAGE
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Fala com o bucket de backups (Cloudflare R2) pela API S3-compatible. É o único
 * lugar do sistema que conhece a credencial da nuvem.
 *
 * O ERP NUNCA recebe chave de acesso — só URL assinada com validade curta.
 * Isso não é preferência: chave embutida no sidecar é extraível, e uma licença
 * vazada daria acesso ao backup de todos os clientes de uma vez.
 *
 * O QUE ELE CONTÉM:
 * - Geração de URL assinada de upload (PUT) e download (GET).
 * - Conferência de objeto (HeadObject) e remoção de prefixo.
 * ============================================================================
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListBucketsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/// 10 min: tempo de sobra para subir 500 MB em link ruim, e curto o suficiente
/// para que uma URL vazada em log não seja utilizável no dia seguinte.
const TTL_UPLOAD_SEGUNDOS   = 10 * 60
/// Download é interativo (alguém clicou e vai baixar agora) — 5 min bastam.
const TTL_DOWNLOAD_SEGUNDOS = 5 * 60

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name)
  private clienteCache: S3Client | null = null

  get configurado(): boolean {
    return Boolean(
      process.env.BACKUP_S3_BUCKET &&
      process.env.BACKUP_S3_ACCESS_KEY_ID &&
      process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    )
  }

  private get bucket(): string {
    return process.env.BACKUP_S3_BUCKET as string
  }

  private get cliente(): S3Client {
    if (!this.configurado) {
      throw new ServiceUnavailableException({
        codigo:  'BACKUP_NAO_CONFIGURADO',
        message: 'Backup em nuvem não está configurado neste servidor.',
      })
    }

    if (!this.clienteCache) {
      const endpointCustomizado = Boolean(process.env.BACKUP_S3_ENDPOINT)

      this.clienteCache = new S3Client({
        // R2 não tem região de verdade — 'auto' é o valor que a Cloudflare pede.
        region:   process.env.BACKUP_S3_REGION || 'auto',
        endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,

        // Com endpoint próprio (R2), endereço no formato
        // <endpoint>/<bucket>/<chave>. O padrão do SDK seria pendurar o bucket
        // como subdomínio — o que exige que o nome dele seja válido em DNS e
        // falha com NoSuchBucket, um erro que não diz nada sobre a causa. O
        // path-style o R2 sempre aceita. Na AWS mantém-se o padrão dela.
        forcePathStyle: process.env.BACKUP_S3_PATH_STYLE
          ? process.env.BACKUP_S3_PATH_STYLE === 'true'
          : endpointCustomizado,

        credentials: {
          accessKeyId:     process.env.BACKUP_S3_ACCESS_KEY_ID as string,
          secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY as string,
        },
      })
      const endpoint = process.env.BACKUP_S3_ENDPOINT ?? '(padrão AWS)'
      this.logger.log(`Storage de backup pronto — bucket "${this.bucket}" em ${endpoint}`)

      // O painel da Cloudflare mostra a "S3 API" do bucket já com o nome dele no
      // fim da URL. Colado inteiro no endpoint, o bucket entra duas vezes no
      // endereço final e todo upload morre com NoSuchBucket — erro que não diz
      // nada sobre a causa. Melhor gritar aqui, uma vez, do que a cada upload.
      try {
        if (new URL(endpoint).pathname.replace(/\/+$/, '') !== '')
          this.logger.warn(
            `BACKUP_S3_ENDPOINT contém caminho — deve terminar no domínio, sem o nome do bucket. ` +
            `Do jeito que está, o R2 deve responder NoSuchBucket.`,
          )
      } catch { /* endpoint ausente = AWS padrão, nada a validar */ }
    }

    return this.clienteCache
  }

  /**
   * URL assinada de upload com o tamanho TRAVADO.
   *
   * O `ContentLength` entra em `signableHeaders`, então ele faz parte da
   * assinatura: o cliente é obrigado a enviar exatamente esse número de bytes,
   * senão a nuvem recusa. É isso que impede que um "backup de 30 MB" chegue como
   * 4 GB e vire fatura. Presigned PUT sem isso não limita nada — e presigned POST
   * com content-length-range, que seria a alternativa, tem suporte irregular fora
   * da S3 e prenderia o projeto num fornecedor.
   */
  async gerarUrlUpload(params: {
    chave:        string
    tamanhoBytes: number
    checksumSha256?: string | null
  }): Promise<{ url: string; expiraEm: Date }> {
    const comando = new PutObjectCommand({
      Bucket:        this.bucket,
      Key:           params.chave,
      ContentLength: params.tamanhoBytes,
      ContentType:   'application/zip',
    })

    const url = await getSignedUrl(this.cliente, comando, {
      expiresIn:       TTL_UPLOAD_SEGUNDOS,
      signableHeaders: new Set(['content-length']),
    })

    return { url, expiraEm: new Date(Date.now() + TTL_UPLOAD_SEGUNDOS * 1000) }
  }

  async gerarUrlDownload(chave: string): Promise<{ url: string; expiraEm: Date }> {
    const comando = new GetObjectCommand({ Bucket: this.bucket, Key: chave })
    const url = await getSignedUrl(this.cliente, comando, { expiresIn: TTL_DOWNLOAD_SEGUNDOS })
    return { url, expiraEm: new Date(Date.now() + TTL_DOWNLOAD_SEGUNDOS * 1000) }
  }

  /**
   * Confere se o objeto existe de verdade e com que tamanho.
   * É o que separa "subiu" de "pedi a URL e o upload morreu no meio" — sem isso
   * o painel mostra backup em dia para arquivo que não existe.
   */
  async conferirObjeto(chave: string): Promise<{ tamanhoBytes: number; modificadoEm?: Date } | null> {
    try {
      const r = await this.cliente.send(new HeadObjectCommand({ Bucket: this.bucket, Key: chave }))
      return { tamanhoBytes: Number(r.ContentLength ?? 0), modificadoEm: r.LastModified }
    } catch (err) {
      const nome = (err as { name?: string }).name
      if (nome === 'NotFound' || nome === 'NoSuchKey') return null
      throw err
    }
  }

  /**
   * Nomes dos buckets que a credencial enxerga. Só para diagnóstico: é o que
   * separa "nome errado" de "bucket em outra conta ou jurisdição", que produzem
   * o mesmo NoSuchBucket. Pode ser negado se o token só tem permissão de objeto.
   */
  async listarBuckets(): Promise<string[]> {
    const r = await this.cliente.send(new ListBucketsCommand({}))
    return (r.Buckets ?? []).map(b => b.Name as string).filter(Boolean)
  }

  /** Apaga tudo sob um prefixo. Usado só pela rotina de retenção. */
  async removerPrefixo(prefixo: string): Promise<number> {
    let removidos       = 0
    let continuationTok: string | undefined

    do {
      const lista = await this.cliente.send(new ListObjectsV2Command({
        Bucket:            this.bucket,
        Prefix:            prefixo,
        ContinuationToken: continuationTok,
      }))

      const chaves = (lista.Contents ?? []).map(o => ({ Key: o.Key as string })).filter(o => o.Key)
      if (chaves.length > 0) {
        await this.cliente.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chaves },
        }))
        removidos += chaves.length
      }

      continuationTok = lista.IsTruncated ? lista.NextContinuationToken : undefined
    } while (continuationTok)

    return removidos
  }
}
