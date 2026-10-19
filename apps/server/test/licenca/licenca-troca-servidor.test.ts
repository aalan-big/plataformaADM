/**
 * Troca de servidor: o login da conta por outro computador revoga o servidor
 * antigo, que deixa de conectar, validar e ocupar vaga pelo heartbeat. Os caixas
 * ficam. Também os códigos de erro do /erp/auth/login, a licença em carência e
 * o limite de trocas por janela.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { HttpException } from '@nestjs/common'
import { DispositivoService } from '../../src/features/dispositivos/dispositivo.service'
import { ErpAuthService } from '../../src/features/erp/erp-auth.service'
import { reiniciarBanco, tabelas } from '../apoio/prisma-falso'

const LICENCA = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b' // o heartbeatSchema exige uuid
const CHAVE   = 'CHAVE-1'
const EMAIL   = 'dono@loja.com.br'
const SENHA   = 'senha-certa'

const DESKTOP  = 'hwid-desktop'
const NOTEBOOK = 'hwid-notebook'
const CAIXA    = 'hwid-caixa'

const dias    = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000)
const minutos = (n: number) => new Date(Date.now() + n * 60 * 1000)

let senhaHash: string

function cadastrar(licenca: Record<string, any> = {}) {
  tabelas.cliente.push({ id: 'cli-1', email: EMAIL, senhaHash })
  tabelas.licenca.push({
    id: LICENCA, clienteId: 'cli-1', planoId: 'plano-1', chaveAtivacao: CHAVE,
    status: 'ATIVA', usuariosExtras: 0, isTrial: false,
    dataVencimento: dias(30), carenciaAte: null, hwidServidor: DESKTOP, criadoEm: dias(-100),
    plano: { id: 'plano-1', nome: 'Básico', limiteUsuario: 2, modulos: [] },
    cliente: { email: EMAIL, pf: { nomeCompleto: 'Dono da Loja' }, pj: null },
    modulosExtras: [],
    ...licenca,
  })
}

const sessao = (hwid: string, ultimoHeartbeat = new Date()) =>
  tabelas.licencaSessao.push({ id: `s-${hwid}`, licencaId: LICENCA, hwid, ultimoHeartbeat })

const evento = (tipo: string, criadoEm: Date) =>
  tabelas.licencaHistorico.push({ id: `h-${tabelas.licencaHistorico.length}`, licencaId: LICENCA, tipo, chaveAtivacao: CHAVE, criadoEm })

const licencaAtual = () => tabelas.licenca.find(l => l.id === LICENCA)!
const hwidsComSessao = () => tabelas.licencaSessao.map(s => s.hwid).sort()
const revogados = () => tabelas.licencaHwidRevogado.map(r => r.hwid).sort()
const eventos = (tipo: string) => tabelas.licencaHistorico.filter(h => h.tipo === tipo)

/** Recusa com status e `codigo` — o que o ERP lê. */
const recusa = (status: number, codigo: string) => (e: unknown) => {
  assert.ok(e instanceof HttpException, String(e))
  assert.equal(e.getStatus(), status)
  assert.equal((e.getResponse() as any).codigo, codigo)
  return true
}

function montar() {
  const emails: any[] = []
  const emailFalso = { enviarAlertaTrocaDispositivo: async (d: any) => { emails.push(d) } }
  const dispositivos = new DispositivoService(emailFalso as any, {} as any)
  const auth = new ErpAuthService(dispositivos)
  const login = (hwid?: string, extra: Record<string, any> = {}) =>
    auth.login({ email: EMAIL, senha: SENHA, hwid, ...extra })
  return { dispositivos, auth, login, emails }
}

describe('Troca de servidor — login da conta por outro computador', () => {
  beforeEach(async () => {
    reiniciarBanco()
    senhaHash ??= await bcrypt.hash(SENHA, 4)
  })

  it('revoga só o servidor antigo, libera a vaga dele e mantém o caixa', async () => {
    cadastrar()
    sessao(DESKTOP)
    sessao(CAIXA)
    const { login, emails } = montar()

    const r = await login(NOTEBOOK, { nomeComputador: 'NOTEBOOK-LOJA' })

    assert.equal(r.chaveAtivacao, CHAVE)
    assert.equal(licencaAtual().hwidServidor, NOTEBOOK)
    assert.deepEqual(revogados(), [DESKTOP])
    assert.deepEqual(hwidsComSessao(), [CAIXA, NOTEBOOK])
    assert.equal(eventos('TROCA_SERVIDOR').length, 1)
    assert.equal(eventos('TROCA_DISPOSITIVO').length, 0, 'a troca não pode contar duas vezes')
    assert.equal(emails.length, 1)
    assert.equal(emails[0].nomeComputador, 'NOTEBOOK-LOJA')
    assert.equal(tabelas.licencaSessao.find(s => s.hwid === NOTEBOOK)!.nomeComputador, 'NOTEBOOK-LOJA')
  })

  it('o servidor antigo cai no conectar, no validar e no heartbeat — e não recria a sessão', async () => {
    cadastrar()
    sessao(DESKTOP)
    const { dispositivos, login } = montar()
    await login(NOTEBOOK)

    await assert.rejects(dispositivos.conectar({ chave: CHAVE, hwid: DESKTOP }), recusa(400, 'LICENCA_TRANSFERIDA'))
    await assert.rejects(dispositivos.heartbeat({ licencaId: LICENCA, hwid: DESKTOP }), recusa(400, 'LICENCA_TRANSFERIDA'))

    const v = await dispositivos.validar({ chave: CHAVE, hwid: DESKTOP }) as any
    assert.equal(v.valida, false)
    assert.equal(v.codigo, 'LICENCA_TRANSFERIDA')

    assert.ok(!hwidsComSessao().includes(DESKTOP))
  })

  it('o caixa continua batendo depois da troca', async () => {
    cadastrar()
    sessao(DESKTOP)
    sessao(CAIXA)
    const { dispositivos, login } = montar()
    await login(NOTEBOOK)

    assert.deepEqual(await dispositivos.heartbeat({ licencaId: LICENCA, hwid: CAIXA }), { ok: true })
    const c = await dispositivos.conectar({ chave: CHAVE, hwid: CAIXA })
    assert.equal(c.msg, 'Reconexão autorizada.')
  })

  it('voltar para o computador antigo pela conta tira ele da lista e revoga o outro', async () => {
    cadastrar()
    const { login } = montar()
    await login(NOTEBOOK)
    await login(DESKTOP)

    assert.equal(licencaAtual().hwidServidor, DESKTOP)
    assert.deepEqual(revogados(), [NOTEBOOK])
  })

  it('reinstalar no mesmo computador não é troca', async () => {
    cadastrar()
    const { login, emails } = montar()
    await login(DESKTOP)

    assert.equal(eventos('TROCA_SERVIDOR').length, 0)
    assert.deepEqual(revogados(), [])
    assert.equal(emails.length, 0)
  })

  it('licença antiga sem servidor gravado: o primeiro login só grava, ninguém é revogado', async () => {
    cadastrar({ hwidServidor: null })
    sessao(DESKTOP)
    const { login } = montar()
    await login(NOTEBOOK)

    assert.equal(licencaAtual().hwidServidor, NOTEBOOK)
    assert.deepEqual(revogados(), [])
    assert.equal(eventos('TROCA_SERVIDOR').length, 0)
  })

  it('login sem HWID não mexe no servidor da licença', async () => {
    cadastrar()
    const { login } = montar()
    await login(undefined)

    assert.equal(licencaAtual().hwidServidor, DESKTOP)
    assert.deepEqual(revogados(), [])
  })
})

describe('Heartbeat sem sessão — internet que caiu x vaga perdida', () => {
  beforeEach(async () => {
    reiniciarBanco()
    senhaHash ??= await bcrypt.hash(SENHA, 4)
  })

  it('o cron apagou a sessão e cabe: recria', async () => {
    cadastrar()
    const { dispositivos } = montar()

    assert.deepEqual(await dispositivos.heartbeat({ licencaId: LICENCA, hwid: CAIXA }), { ok: true })
    assert.deepEqual(hwidsComSessao(), [CAIXA])
  })

  it('a licença está cheia: recusa e não ocupa vaga', async () => {
    cadastrar()
    sessao(NOTEBOOK)
    sessao(CAIXA)
    const { dispositivos } = montar()

    await assert.rejects(dispositivos.heartbeat({ licencaId: LICENCA, hwid: 'hwid-intruso' }), recusa(400, 'LIMITE_DISPOSITIVOS'))
    assert.deepEqual(hwidsComSessao(), [CAIXA, NOTEBOOK])
  })

  it('quem já tem sessão bate normalmente mesmo com a licença cheia', async () => {
    cadastrar()
    sessao(NOTEBOOK)
    sessao(CAIXA)
    const { dispositivos } = montar()

    assert.deepEqual(await dispositivos.heartbeat({ licencaId: LICENCA, hwid: CAIXA }), { ok: true })
  })
})

describe('Login autenticado com a licença cheia', () => {
  beforeEach(async () => {
    reiniciarBanco()
    senhaHash ??= await bcrypt.hash(SENHA, 4)
  })

  it('derruba só a sessão mais antiga, não a loja inteira', async () => {
    cadastrar({ hwidServidor: null })
    sessao('hwid-velho', minutos(-30))
    sessao(CAIXA, minutos(-1))
    const { login, emails } = montar()

    await login(NOTEBOOK)

    assert.deepEqual(hwidsComSessao(), [CAIXA, NOTEBOOK])
    assert.equal(eventos('TROCA_DISPOSITIVO').length, 1)
    assert.equal(emails.length, 1)
  })

  it('via chave pura continua bloqueado', async () => {
    cadastrar()
    sessao(DESKTOP)
    sessao(CAIXA)
    const { dispositivos } = montar()

    await assert.rejects(dispositivos.conectar({ chave: CHAVE, hwid: 'hwid-outro' }), /Limite de 2/)
  })
})

describe('Limite de trocas de computador', () => {
  beforeEach(async () => {
    reiniciarBanco()
    senhaHash ??= await bcrypt.hash(SENHA, 4)
  })

  it('três trocas em 30 dias: a quarta é 429 e nada muda', async () => {
    cadastrar()
    sessao(DESKTOP)
    evento('TROCA_SERVIDOR', dias(-20))
    evento('TROCA_DISPOSITIVO', dias(-10))
    evento('TROCA_SERVIDOR', dias(-1))
    const { login, emails } = montar()

    await assert.rejects(login(NOTEBOOK), recusa(429, 'LIMITE_TRANSFERENCIAS'))

    assert.equal(licencaAtual().hwidServidor, DESKTOP)
    assert.deepEqual(revogados(), [])
    assert.deepEqual(hwidsComSessao(), [DESKTOP])
    assert.equal(emails.length, 0)
  })

  it('trocas fora da janela não contam', async () => {
    cadastrar()
    evento('TROCA_SERVIDOR', dias(-40))
    evento('TROCA_SERVIDOR', dias(-35))
    evento('TROCA_SERVIDOR', dias(-31))
    const { login } = montar()

    await login(NOTEBOOK)
    assert.equal(licencaAtual().hwidServidor, NOTEBOOK)
  })

  it('o "Trocar dispositivo" do admin libera a próxima troca', async () => {
    cadastrar()
    evento('TROCA_SERVIDOR', dias(-3))
    evento('TROCA_SERVIDOR', dias(-2))
    evento('TROCA_SERVIDOR', dias(-1))
    const { dispositivos, login } = montar()

    await dispositivos.trocarDispositivo(LICENCA)
    await login(NOTEBOOK)

    assert.equal(licencaAtual().hwidServidor, NOTEBOOK)
  })

  it('reinstalar no mesmo computador não esbarra no limite', async () => {
    cadastrar()
    evento('TROCA_SERVIDOR', dias(-3))
    evento('TROCA_SERVIDOR', dias(-2))
    evento('TROCA_SERVIDOR', dias(-1))
    const { login } = montar()

    await login(DESKTOP)
  })
})

describe('/erp/auth/login — códigos de erro e licença vencida', () => {
  beforeEach(async () => {
    reiniciarBanco()
    senhaHash ??= await bcrypt.hash(SENHA, 4)
  })

  it('e-mail desconhecido e senha errada: 401 CREDENCIAIS_INVALIDAS', async () => {
    cadastrar()
    const { auth } = montar()

    await assert.rejects(auth.login({ email: 'outro@loja.com.br', senha: SENHA }), recusa(401, 'CREDENCIAIS_INVALIDAS'))
    await assert.rejects(auth.login({ email: EMAIL, senha: 'errada' }), recusa(401, 'CREDENCIAIS_INVALIDAS'))
  })

  it('senha nunca criada: 400 SENHA_NAO_CONFIGURADA', async () => {
    cadastrar()
    tabelas.cliente[0].senhaHash = null
    const { login } = montar()

    await assert.rejects(login(NOTEBOOK), recusa(400, 'SENHA_NAO_CONFIGURADA'))
  })

  it('sem licença: 400 SEM_LICENCA_ATIVA', async () => {
    cadastrar({ status: 'BLOQUEADA' })
    const { login } = montar()

    await assert.rejects(login(NOTEBOOK), recusa(400, 'SEM_LICENCA_ATIVA'))
  })

  it('vencida sem carência: 402 LICENCA_VENCIDA', async () => {
    cadastrar({ status: 'VENCIDA', dataVencimento: dias(-2) })
    const { login } = montar()

    await assert.rejects(login(NOTEBOOK), recusa(402, 'LICENCA_VENCIDA'))
  })

  it('ATIVA com vencimento passado e sem carência também é 402', async () => {
    cadastrar({ dataVencimento: dias(-1) })
    const { login } = montar()

    await assert.rejects(login(NOTEBOOK), recusa(402, 'LICENCA_VENCIDA'))
  })

  it('vencida em carência: consegue trocar de computador', async () => {
    cadastrar({ status: 'VENCIDA', dataVencimento: dias(-2), carenciaAte: dias(5) })
    const { login } = montar()

    const r = await login(NOTEBOOK)
    assert.equal(r.emCarencia, true)
    assert.equal(licencaAtual().hwidServidor, NOTEBOOK)
  })
})
