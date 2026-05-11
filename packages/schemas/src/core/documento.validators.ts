export function validarCpf(raw: string): boolean {
  const n = raw.replace(/\D/g, '')
  if (n.length !== 11) return false
  if (/^(\d)\1{10}$/.test(n)) return false

  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(n[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  return calc(9) === Number(n[9]) && calc(10) === Number(n[10])
}

export function validarCnpj(raw: string): boolean {
  const n = raw.replace(/\D/g, '')
  if (n.length !== 14) return false
  if (/^(\d)\1{13}$/.test(n)) return false

  const calc = (len: number) => {
    const pesos = len === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = pesos.reduce((acc, p, i) => acc + Number(n[i]) * p, 0)
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  return calc(12) === Number(n[12]) && calc(13) === Number(n[13])
}
