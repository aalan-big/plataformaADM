import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * Ponte de upload para o laboratório de backup.
 *
 * O PUT na URL assinada acontece AQUI, no servidor, e não no navegador. Dois
 * motivos: o bucket precisaria de uma política de CORS liberando o domínio do
 * painel (superfície nova só para um teste), e o ERP real é um app desktop em
 * Python — fazer o PUT server-side reproduz o que ele vai fazer, o navegador não.
 *
 * Só existe para o /debug. Não faz parte do fluxo do ERP.
 */

/// Sem isso a rota seria um proxy aberto: qualquer um poderia mandar o servidor
/// fazer PUT em qualquer endereço (SSRF). Só destinos de bucket são aceitos.
const HOSTS_PERMITIDOS = [/\.r2\.cloudflarestorage\.com$/, /\.amazonaws\.com$/]

/// O laboratório sobe arquivos de brinquedo. Se chegou algo grande aqui, é uso
/// errado da rota — o upload de verdade vai direto do ERP para o bucket.
const TAMANHO_MAXIMO = 2 * 1024 * 1024

export async function POST(request: Request) {
  // O /debug é área administrativa; sem sessão de admin não se opera a ponte.
  const cookieStore = await cookies()
  if (!cookieStore.get('token')?.value)
    return NextResponse.json({ erro: 'Sessão de administrador necessária.' }, { status: 401 })

  let corpo: { url?: string; conteudoBase64?: string; contentType?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'JSON inválido.' }, { status: 400 })
  }

  const { url, conteudoBase64, contentType } = corpo

  if (!url || !conteudoBase64)
    return NextResponse.json({ erro: 'url e conteudoBase64 são obrigatórios.' }, { status: 400 })

  let destino: URL
  try {
    destino = new URL(url)
  } catch {
    return NextResponse.json({ erro: 'url malformada.' }, { status: 400 })
  }

  if (destino.protocol !== 'https:' || !HOSTS_PERMITIDOS.some(re => re.test(destino.hostname)))
    return NextResponse.json(
      { erro: `Destino não permitido: ${destino.hostname}. Só buckets R2/S3 por HTTPS.` },
      { status: 403 },
    )

  const conteudo = Buffer.from(conteudoBase64, 'base64')

  if (conteudo.byteLength === 0)
    return NextResponse.json({ erro: 'Conteúdo vazio.' }, { status: 400 })

  if (conteudo.byteLength > TAMANHO_MAXIMO)
    return NextResponse.json(
      { erro: `Conteúdo de ${conteudo.byteLength} bytes acima do limite do laboratório (2 MB).` },
      { status: 413 },
    )

  try {
    const resposta = await fetch(destino, {
      method: 'PUT',
      headers: {
        'Content-Type':   contentType ?? 'application/zip',
        'Content-Length': String(conteudo.byteLength),
      },
      body: conteudo,
    })

    // O corpo de erro do S3/R2 é XML e é onde aparece o motivo real
    // (SignatureDoesNotMatch, EntityTooLarge...). Repassa cru: num laboratório,
    // a mensagem original do bucket vale mais que qualquer resumo nosso.
    const texto = await resposta.text().catch(() => '')

    return NextResponse.json({
      ok:             resposta.ok,
      status:         resposta.status,
      statusText:     resposta.statusText,
      bytesEnviados:  conteudo.byteLength,
      etag:           resposta.headers.get('etag'),
      respostaBucket: texto.slice(0, 1500) || null,
    }, { status: 200 })   // 200 = a ponte funcionou; o resultado do PUT vai no corpo
  } catch (err) {
    return NextResponse.json(
      { ok: false, erro: 'Falha ao falar com o bucket.', detalhe: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
