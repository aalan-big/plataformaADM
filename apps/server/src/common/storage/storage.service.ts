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
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/// 30 min. Já foram 10, e 10 não fecha a conta: 500 MB (o teto) em 600 s exigem
/// ~6,7 Mbps de upload SUSTENTADO, que loja com rádio, ADSL ou 4G compartilhado
/// não tem. O upload morria de forma reproduzível e o bucket respondia 403 —
/// indistinguível de erro de assinatura, o que mandava quem estava depurando
/// para o lado errado por horas.
///
/// O que se perde: uma URL vazada em log fica utilizável por mais tempo. É um
/// risco pequeno e limitado — ela escreve em UM caminho fixo, do próprio
/// cliente, com o tamanho travado na assinatura. Backup que não sobe é o dano
/// maior. Ainda expira no mesmo turno de trabalho, que era o ponto.
///
/// ⚠ INVARIANTE: este TTL tem que ser MENOR que a janela em que o cron marca
/// upload pendurado como FALHOU. Se os dois se igualarem, um upload lento e
/// LEGÍTIMO é marcado como falha enquanto ainda está subindo — e o cliente
/// perde a vaga da cota por um envio que ia dar certo.
///
/// Não é um comentário pedindo cuidado: o cron IMPORTA esta constante e deriva
/// a janela dele a partir dela (ver MINUTOS_ORFA em cron.service.ts). Mexer
/// aqui move a janela de lá junto. Exportado por causa disso — não é para uso
/// geral.
export const TTL_UPLOAD_SEGUNDOS = 30 * 60
/// Download é interativo (alguém clicou e vai baixar agora) — 5 min bastam.
///
/// NÃO acompanha o TTL de upload, e a assimetria é deliberada: URL de escrita
/// vazada deixa alguém gravar lixo num caminho só; URL de leitura vazada
/// entrega o banco inteiro do cliente. O prazo curto é a mitigação.
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

  /**
   * URL assinada de download.
   *
   * O `nomeArquivo` vira `Content-Disposition` na resposta do bucket. Sem ele
   * todo download chega como `banco.zip`, e quem baixa de três clientes fica com
   * `banco.zip`, `banco (1).zip` e `banco (2).zip` sem saber qual é de quem —
   * ambiguidade justamente na hora de restaurar, que é quando errar custa caro.
   */
  async gerarUrlDownload(chave: string, nomeArquivo?: string): Promise<{ url: string; expiraEm: Date }> {
    const comando = new GetObjectCommand({
      Bucket: this.bucket,
      Key:    chave,
      ...(nomeArquivo
        ? { ResponseContentDisposition: `attachment; filename="${nomeArquivo.replace(/"/g, '')}"` }
        : {}),
    })
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
   * "Pastas" imediatamente abaixo de um prefixo, usando o delimitador — não
   * baixa a lista de objetos, só os prefixos comuns. Para 1000 clientes é uma
   * chamada por cliente, não uma por arquivo.
   *
   * Devolve o nome do nível (sem o prefixo e sem a barra final).
   */
  async listarPastas(prefixo: string): Promise<string[]> {
    const pastas: string[] = []
    let continuationTok: string | undefined

    do {
      const lista = await this.cliente.send(new ListObjectsV2Command({
        Bucket:            this.bucket,
        Prefix:            prefixo,
        Delimiter:         '/',
        ContinuationToken: continuationTok,
      }))

      for (const p of lista.CommonPrefixes ?? []) {
        const nome = (p.Prefix ?? '').slice(prefixo.length).replace(/\/$/, '')
        if (nome) pastas.push(nome)
      }

      continuationTok = lista.IsTruncated ? lista.NextContinuationToken : undefined
    } while (continuationTok)

    return pastas
  }

  /**
   * Apaga uma lista EXPLÍCITA de chaves.
   *
   * É o que a rotação de ciclo usa, e nunca o `removerPrefixo` abaixo. A
   * diferença não é estilo: apagar por prefixo ou por idade varreria junto
   * qualquer coisa que estivesse no caminho, e no bucket de backup existe
   * conteúdo que só tem uma cópia no mundo. Aqui a lista vem do inventário — se
   * a linha não está no banco, o objeto não é tocado.
   *
   * O DeleteObjects aceita 1000 chaves por chamada, e a operação é gratuita no
   * R2. Devolve quantas foram efetivamente pedidas para exclusão.
   */
  async removerChaves(chaves: string[]): Promise<number> {
    if (chaves.length === 0) return 0

    let apagadas = 0

    for (let i = 0; i < chaves.length; i += 1000) {
      const lote = chaves.slice(i, i + 1000)
      await this.cliente.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: lote.map(Key => ({ Key })) },
      }))
      apagadas += lote.length
    }

    return apagadas
  }

  /**
   * Apaga tudo sob um prefixo. Usado pelas rotinas de limpeza.
   *
   * Com `simular`, percorre exatamente a mesma listagem mas não envia o comando
   * de exclusão — devolve quantos objetos seriam apagados. É o mesmo caminho de
   * código, e não uma reimplementação: simulação que roda por outro caminho não
   * prova nada sobre o que vai acontecer de verdade.
   */
  async removerPrefixo(prefixo: string, opcoes: { simular?: boolean } = {}): Promise<number> {
    let afetados        = 0
    let continuationTok: string | undefined

    do {
      const lista = await this.cliente.send(new ListObjectsV2Command({
        Bucket:            this.bucket,
        Prefix:            prefixo,
        ContinuationToken: continuationTok,
      }))

      const chaves = (lista.Contents ?? []).map(o => ({ Key: o.Key as string })).filter(o => o.Key)
      if (chaves.length > 0) {
        if (!opcoes.simular) {
          await this.cliente.send(new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chaves },
          }))
        }
        afetados += chaves.length
      }

      continuationTok = lista.IsTruncated ? lista.NextContinuationToken : undefined
    } while (continuationTok)

    return afetados
  }
}
