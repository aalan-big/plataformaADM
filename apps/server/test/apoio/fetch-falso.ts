/**
 * `fetch` gravado: registra cada chamada e responde o que o teste roteirizou.
 *
 * Nenhum teste deste diretório pode chegar à Focus de verdade — em produção o
 * token de parceiro cria e altera empresas reais. Se o roteiro acabar, o falso
 * estoura em vez de cair no `fetch` original.
 */

export type ChamadaFetch = {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

type Resposta = { status: number; corpo?: unknown } | { erro: Error }

export function instalarFetchFalso() {
  const original = globalThis.fetch
  const chamadas: ChamadaFetch[] = []
  const roteiro: Resposta[] = []

  globalThis.fetch = (async (url: any, init: any = {}) => {
    chamadas.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    })
    const proxima = roteiro.shift()
    if (!proxima) throw new Error(`fetch falso sem resposta roteirizada para ${url}`)
    if ('erro' in proxima) throw proxima.erro
    return new Response(proxima.corpo === undefined ? '' : JSON.stringify(proxima.corpo), {
      status: proxima.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  return {
    chamadas,
    responder: (status: number, corpo?: unknown) => { roteiro.push({ status, corpo }) },
    falhar: (erro: Error) => { roteiro.push({ erro }) },
    restaurar: () => { globalThis.fetch = original },
  }
}
