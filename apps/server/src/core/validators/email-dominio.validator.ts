import { resolveMx } from 'dns/promises'

const TIMEOUT_MS = 5000

async function comTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
  ])
}

/**
 * Confirma, via DNS, que o domínio do e-mail tem registro MX — ou seja,
 * está de fato configurado para receber e-mails. Domínios registrados mas
 * "parqueados" (ex.: typos como "gmial.com") normalmente têm um registro A
 * apontando pra uma landing page, mas não têm MX — por isso não usamos A/AAAA
 * como fallback, senão esses typos passariam. Não garante que a caixa de
 * entrada específica existe, só descarta domínios sem servidor de e-mail
 * configurado antes de criar o cliente e disparar e-mails que vão falhar.
 */
export async function dominioDeEmailExiste(email: string): Promise<boolean> {
  const dominio = email.split('@')[1]?.trim()
  if (!dominio) return false

  return comTimeout(
    resolveMx(dominio).then(registros => registros.length > 0).catch(() => false),
    false,
  )
}
