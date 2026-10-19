/**
 * Histórico de e-mails: o `EmailService` grava o desfecho de cada envio (deu
 * certo, falhou, não saiu por falta de configuração) e a tela E-mails lista.
 * O Resend é simulado no `fetch` — nenhum e-mail sai daqui.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NotFoundException } from '@nestjs/common'
import { EmailService } from '../../src/core/email/email.service'
import { EmailHistoricoService } from '../../src/features/email/email-historico.service'
import { reiniciarBanco, tabelas, prismaFalso } from '../apoio/prisma-falso'

const fetchOriginal = globalThis.fetch
let respostaResend: () => Response

function resendResponde(status: number, corpo: unknown) {
  respostaResend = () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
}

const DADOS_RENOVACAO = {
  email: 'dono@loja.com.br', nomeCliente: 'Loja', dataVencimento: new Date('2026-11-18T15:00:00Z'), nomeDispositivo: 'Servidor',
}

describe('EmailService — grava cada envio no histórico', () => {
  beforeEach(() => {
    reiniciarBanco()
    globalThis.fetch = (async () => respostaResend()) as any
  })
  afterEach(() => {
    globalThis.fetch = fetchOriginal
    delete process.env.ADMIN_ALERT_EMAIL
  })

  it('aceito pelo Resend: ENVIADO, com o id do Resend e o HTML', async () => {
    resendResponde(200, { id: 're_123' })
    await new EmailService().enviarRenovacao(DADOS_RENOVACAO)

    assert.equal(tabelas.emailLog.length, 1)
    const log = tabelas.emailLog[0]
    assert.equal(log.tipo, 'RENOVACAO')
    assert.equal(log.status, 'ENVIADO')
    assert.equal(log.resendId, 're_123')
    assert.equal(log.destinatario, 'dono@loja.com.br')
    assert.equal(log.assunto, 'Renovação confirmada — StartBig ERP')
    assert.ok(log.html.includes('Sua licença foi renovada'))
    assert.equal(log.erro, null)
  })

  it('recusado pelo Resend: FALHOU com o motivo, e o erro continua chegando a quem chamou', async () => {
    resendResponde(422, { name: 'validation_error', message: 'Invalid `to` field.' })

    await assert.rejects(new EmailService().enviarRenovacao(DADOS_RENOVACAO), /Resend/)

    const log = tabelas.emailLog[0]
    assert.equal(log.status, 'FALHOU')
    assert.match(log.erro, /Invalid `to` field/)
    assert.equal(log.resendId, null)
  })

  it('alerta operacional sem ADMIN_ALERT_EMAIL: não chama o Resend e fica como NAO_ENVIADO', async () => {
    let chamou = false
    globalThis.fetch = (async () => { chamou = true; return new Response('{}') }) as any

    await new EmailService().enviarAlertaOperacional({
      titulo: 'Pagamento sem dono', subtitulo: 's', evento: 'checkout.session.completed',
      motivo: 'Licença não encontrada', referencia: 'cs_1', valor: 180, acao: 'Ver no Stripe.',
    })

    assert.equal(chamou, false)
    assert.equal(tabelas.emailLog[0].status, 'NAO_ENVIADO')
    assert.match(tabelas.emailLog[0].erro, /ADMIN_ALERT_EMAIL/)
  })

  it('se gravar o histórico falhar, o e-mail sai do mesmo jeito', async () => {
    resendResponde(200, { id: 're_456' })
    const create = prismaFalso.emailLog.create
    prismaFalso.emailLog.create = async () => { throw new Error('banco fora') }
    try {
      await new EmailService().enviarRenovacao(DADOS_RENOVACAO)
    } finally {
      prismaFalso.emailLog.create = create
    }
    assert.equal(tabelas.emailLog.length, 0)
  })
})

describe('EmailHistoricoService — a lista da tela E-mails', () => {
  const agora = Date.now()
  const linha = (n: number, extra: Record<string, any> = {}) => ({
    id: `e${n}`, tipo: 'RENOVACAO', destinatario: 'dono@loja.com.br', assunto: `Assunto ${n}`,
    status: 'ENVIADO', erro: null, resendId: `re_${n}`, html: '<p>oi</p>',
    criadoEm: new Date(agora - n * 60_000), ...extra,
  })

  beforeEach(() => {
    reiniciarBanco()
    tabelas.cliente.push({ id: 'cli-1', email: 'dono@loja.com.br', pf: null, pj: { razaoSocial: 'Loja LTDA', nomeFantasia: 'Loja do Dono' } })
  })

  it('mais recente primeiro, com o nome do cliente e o resumo de 30 dias', async () => {
    tabelas.emailLog.push(
      linha(3),
      linha(1),
      linha(2, { status: 'FALHOU', erro: 'x' }),
      linha(4, { destinatario: 'admin@startbig.com.br', tipo: 'ALERTA_OPERACIONAL', status: 'NAO_ENVIADO' }),
      linha(60 * 24 * 40, { assunto: 'velho' }), // 40 dias atrás: fora do resumo
    )

    const r = await new EmailHistoricoService().listar({})

    assert.deepEqual(r.itens.map(i => i.id), ['e1', 'e2', 'e3', 'e4', `e${60 * 24 * 40}`])
    assert.equal(r.itens[0].nomeCliente, 'Loja do Dono')
    assert.equal(r.itens[3].nomeCliente, null, 'alerta para o admin não é de cliente')
    assert.equal(r.total, 5)
    assert.deepEqual(r.resumo, { enviados: 2, falhas: 1, naoEnviados: 1, dias: 30 })
  })

  it('filtra por status, por tipo e busca no destinatário e no assunto, sem diferenciar maiúsculas', async () => {
    tabelas.emailLog.push(
      linha(1, { assunto: 'Sua chave de ativação', tipo: 'CHAVE_ATIVACAO' }),
      linha(2, { status: 'FALHOU' }),
      linha(3, { destinatario: 'outro@cliente.com' }),
    )
    const h = new EmailHistoricoService()

    assert.deepEqual((await h.listar({ status: 'FALHOU' })).itens.map(i => i.id), ['e2'])
    assert.deepEqual((await h.listar({ tipo: 'CHAVE_ATIVACAO' })).itens.map(i => i.id), ['e1'])
    assert.deepEqual((await h.listar({ q: 'OUTRO@' })).itens.map(i => i.id), ['e3'])
    assert.deepEqual((await h.listar({ q: 'chave' })).itens.map(i => i.id), ['e1'])
  })

  it('pagina e ignora parâmetro inválido em vez de quebrar a tela', async () => {
    for (let n = 1; n <= 5; n++) tabelas.emailLog.push(linha(n))
    const h = new EmailHistoricoService()

    const p2 = await h.listar({ pagina: '2', porPagina: '2' })
    assert.deepEqual(p2.itens.map(i => i.id), ['e3', 'e4'])
    assert.equal(p2.total, 5)

    const lixo = await h.listar({ pagina: 'abc', status: 'QUALQUER' })
    assert.equal(lixo.pagina, 1)
    assert.equal(lixo.total, 5)
  })

  it('detalhe traz o HTML; id inexistente é 404', async () => {
    tabelas.emailLog.push(linha(1))
    const h = new EmailHistoricoService()

    const d = await h.detalhe('e1')
    assert.equal(d.html, '<p>oi</p>')
    assert.equal(d.nomeCliente, 'Loja do Dono')
    await assert.rejects(h.detalhe('nao-existe'), NotFoundException)
  })
})
