/**
 * Cifra dos tokens de emissão da Focus em repouso (AES-256-GCM).
 *
 * O token de uma empresa emite nota no CNPJ dela direto na Focus, sem passar
 * por esta API: quem lê o banco não pode sair com ele em texto. Até 06/10/2026
 * o `focusEmpresaToken` ficava puro, e o próprio schema avisava.
 *
 * A chave vem de `FISCAL_TOKENS_KEY` (32 bytes em base64). Ausente, a cifra fica
 * INDISPONÍVEL e quem chama volta ao comportamento antigo (texto puro na coluna
 * de sempre): faltar a variável não pode derrubar a ativação fiscal de ninguém —
 * mesma escolha do `FOCUS_NFE_PARTNER_TOKEN`, que também não é exigido no boot.
 *
 * Gerar uma chave:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * ⚠️ Trocar a chave torna ilegíveis os tokens já cifrados. Se precisar trocar,
 * reative a emissão dos clientes (o botão "Ativar emissão" grava de novo).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const VERSAO = 'v1'

function chave(): Buffer | null {
  const bruta = process.env.FISCAL_TOKENS_KEY?.trim()
  if (!bruta) return null
  const buf = Buffer.from(bruta, 'base64')
  // Chave de tamanho errado é configuração quebrada; tratar como ausente evita
  // gravar algo que ninguém consegue ler depois.
  return buf.length === 32 ? buf : null
}

export function cifraDisponivel(): boolean {
  return chave() !== null
}

/** "v1:<iv>:<tag>:<dados>" em base64. Lança se a cifra não está disponível. */
export function cifrar(texto: string): string {
  const k = chave()
  if (!k) throw new Error('FISCAL_TOKENS_KEY ausente ou inválida.')
  const iv = randomBytes(12)
  const cifra = createCipheriv('aes-256-gcm', k, iv)
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()])
  const tag = cifra.getAuthTag()
  return [VERSAO, iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join(':')
}

/**
 * Texto do token, ou `null` quando não há o que ler (vazio, chave ausente,
 * valor adulterado). Nunca lança: quem chama decide o que "sem token" significa.
 */
export function decifrar(valor: string | null | undefined): string | null {
  if (!valor) return null
  const k = chave()
  if (!k) return null
  const [versao, iv, tag, dados] = valor.split(':')
  if (versao !== VERSAO || !iv || !tag || !dados) return null
  try {
    const decifra = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'))
    decifra.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decifra.update(Buffer.from(dados, 'base64')), decifra.final()]).toString('utf8')
  } catch {
    return null
  }
}
