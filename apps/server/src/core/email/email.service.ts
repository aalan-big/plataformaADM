import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Resend } from 'resend'
import { prisma, registrarEmail, type StatusEmail } from '@startbig/database'
import { layout, paragrafo, nota, destaque, aviso, dados as tabelaDados, botao, esc, COR } from './email-layout'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM   = process.env.EMAIL_FROM ?? 'noreply@startbig.com.br'

type Payload = Parameters<typeof resend.emails.send>[0]

/** Tipos gravados no histórico (`EmailLog.tipo`). A tela E-mails filtra por eles. */
export type TipoEmail =
  | 'CHAVE_ATIVACAO' | 'PRIMEIRO_ACESSO' | 'RENOVACAO' | 'FALHA_PAGAMENTO'
  | 'AVISO_VENCIMENTO' | 'RETENCAO_BACKUP' | 'TROCA_COMPUTADOR' | 'ALERTA_OPERACIONAL'

const dataLonga = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })

const ola = (nomeCliente: string) =>
  paragrafo(`Olá, <strong style="color:${COR.escuro};">${esc(nomeCliente)}</strong>!`)

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  /**
   * Manda pelo Resend e grava o desfecho no histórico, deu certo ou não.
   * A falha continua estourando para quem chamou, como antes.
   */
  private async enviar(tipo: TipoEmail, payload: Payload) {
    let resendId: string | null = null
    let erro: string | null = null

    try {
      const { data, error } = await resend.emails.send(payload)
      if (error) throw new Error(`Resend: ${JSON.stringify(error)}`)
      resendId = data?.id ?? null
      return data
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      await this.registrar(tipo, payload, erro ? 'FALHOU' : 'ENVIADO', erro, resendId)
    }
  }

  /**
   * Histórico é auxiliar: se a gravação falhar, o e-mail já saiu (ou já falhou)
   * e quem chamou não pode receber o erro do log no lugar do dele.
   */
  private async registrar(tipo: TipoEmail, payload: Payload, status: StatusEmail, erro: string | null, resendId: string | null = null) {
    try {
      await registrarEmail({
        tipo,
        destinatario: Array.isArray(payload.to) ? payload.to.join(', ') : payload.to,
        assunto:      payload.subject,
        status,
        erro,
        resendId,
        html:         payload.html ?? '',
      })
    } catch (err) {
      this.logger.warn(`[email] falha ao gravar o histórico (${tipo} para ${payload.to}): ${err instanceof Error ? err.message : err}`)
    }
  }

  async enviarChaveAtivacao(dados: {
    email:           string
    nomeCliente:     string
    chave:           string
    dataVencimento:  Date
    nomeDispositivo: string
  }) {
    const vencimento = dataLonga(dados.dataVencimento)

    await this.enviar('CHAVE_ATIVACAO', {
      from:    FROM,
      to:      dados.email,
      subject: 'Sua chave de ativação StartBig ERP',
      html:    layout({
        selo:      'Chave de ativação',
        titulo:    'Seu acesso ao StartBIG foi liberado',
        preheader: `Sua chave de ativação, válida até ${vencimento}.`,
        corpo: [
          ola(dados.nomeCliente),
          paragrafo('Use a chave abaixo para ativar o sistema no seu computador.'),
          destaque({ rotulo: 'Chave de ativação', valor: esc(dados.chave), mono: true }),
          tabelaDados([
            ['Dispositivo', esc(dados.nomeDispositivo)],
            ['Válida até',  vencimento],
          ]),
          nota('Não compartilhe esta chave: ela dá acesso à sua licença.'),
        ].join(''),
      }),
    })

    this.logger.log(`Chave de ativação enviada para ${dados.email}`)
  }

  /**
   * Gera o token de "criar senha", persiste no cliente (válido por 7 dias)
   * e envia o e-mail com o link. Usado tanto no cadastro (auto-cadastro do
   * ERP e cadastro manual pelo admin) quanto num reenvio manual, caso o
   * cliente perca ou deixe expirar o link original.
   */
  async enviarPrimeiroAcesso(dados: {
    clienteId:   string
    email:       string
    nomeCliente: string
  }) {
    const token  = randomUUID()
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias

    await prisma.cliente.update({
      where: { id: dados.clienteId },
      data:  { tokenEmail: token, tokenEmailExpiraEm: expira },
    })

    const appUrl = process.env.APP_URL ?? 'https://admin.startbig.com.br'
    const link   = `${appUrl}/primeiro-acesso?token=${token}`

    await this.enviar('PRIMEIRO_ACESSO', {
      from:    FROM,
      to:      dados.email,
      subject: 'Bem-vindo ao StartBig — Crie sua senha de acesso',
      html:    layout({
        selo:      'Boas-vindas',
        titulo:    'Crie sua senha de acesso',
        preheader: 'Sua empresa foi cadastrada no StartBIG. Falta só criar a senha.',
        corpo: [
          ola(dados.nomeCliente),
          paragrafo('Sua empresa foi cadastrada com sucesso no StartBIG. Para entrar, crie a sua senha de acesso:'),
          botao('Criar minha senha', link),
          paragrafo(`<span style="font-size:13px;color:${COR.apagado};">Se o botão não abrir, copie este endereço no navegador:<br><a href="${esc(link)}" style="color:${COR.primaria};word-break:break-all;">${esc(link)}</a></span>`),
          nota('Este link expira em 7 dias. Se não foi você quem se cadastrou, ignore este e-mail.'),
        ].join(''),
      }),
    })

    this.logger.log(`E-mail de primeiro acesso enviado para ${dados.email}`)
  }

  async enviarRenovacao(dados: {
    email:           string
    nomeCliente:     string
    dataVencimento:  Date
    nomeDispositivo: string
  }) {
    const vencimento = dataLonga(dados.dataVencimento)

    await this.enviar('RENOVACAO', {
      from:    FROM,
      to:      dados.email,
      subject: 'Renovação confirmada — StartBig ERP',
      html:    layout({
        selo:      'Pagamento confirmado',
        tom:       'sucesso',
        titulo:    'Sua licença foi renovada',
        preheader: `Pagamento confirmado. Nova validade: ${vencimento}.`,
        corpo: [
          ola(dados.nomeCliente),
          paragrafo('Recebemos o seu pagamento. O sistema continua funcionando normalmente, com a mesma chave de ativação.'),
          destaque({ rotulo: 'Nova validade', valor: vencimento, detalhe: `Dispositivo: ${esc(dados.nomeDispositivo)}`, tom: 'sucesso' }),
          nota('Você não precisa fazer nada. Obrigado por continuar com a gente!'),
        ].join(''),
      }),
    })

    this.logger.log(`Confirmação de renovação enviada para ${dados.email}`)
  }

  async enviarFalhaPagamento(dados: {
    email:          string
    nomeCliente:    string
    dataVencimento: Date | null
  }) {
    const vencimento = dados.dataVencimento ? dataLonga(dados.dataVencimento) : null

    await this.enviar('FALHA_PAGAMENTO', {
      from:    FROM,
      to:      dados.email,
      subject: 'Falha no pagamento da sua assinatura — atualize seu cartão · StartBig ERP',
      html:    layout({
        selo:      'Falha no pagamento',
        tom:       'perigo',
        titulo:    'Não conseguimos cobrar a sua assinatura',
        preheader: 'Atualize o cartão para não perder o acesso ao sistema.',
        corpo: [
          ola(dados.nomeCliente),
          paragrafo('A cobrança da renovação não passou. Isso costuma acontecer com cartão vencido, sem limite ou bloqueado.'),
          aviso('Vamos tentar cobrar de novo automaticamente nos próximos dias. Para não perder o acesso, <strong>atualize a forma de pagamento</strong> ou confira o seu cartão com o banco.', 'atencao'),
          vencimento ? paragrafo(`Seu acesso atual vale até <strong style="color:${COR.escuro};">${vencimento}</strong>.`) : '',
          nota('Se já resolveu com o banco, pode ignorar este aviso: a próxima tentativa deve passar.'),
        ].join(''),
      }),
    })

    this.logger.log(`Aviso de falha de pagamento enviado para ${dados.email}`)
  }

  async enviarAvisoVencimento(dados: {
    email:           string
    nomeCliente:     string
    diasRestantes:   number
    dataVencimento:  Date
  }) {
    const vencimento = dataLonga(dados.dataVencimento)

    const subject = dados.diasRestantes === 1
      ? 'Aviso Importante: Sua licença vence amanhã'
      : `Sua licença vencerá em ${dados.diasRestantes} dias`

    await this.enviar('AVISO_VENCIMENTO', {
      from:    FROM,
      to:      dados.email,
      subject,
      html:    this.templateVencimento({ ...dados, vencimento }),
    })

    this.logger.log(`Aviso de vencimento (${dados.diasRestantes} dias) enviado para ${dados.email}`)
  }

  /**
   * Avisa que o backup em nuvem será apagado se a licença não for reativada.
   *
   * Existe porque apagar o único backup de alguém em silêncio é indefensável —
   * e quem está nessa situação é justamente quem parou de pagar e pode estar
   * tentando voltar. O e-mail é o que transforma "perdeu tudo" em "foi avisado
   * duas vezes e teve 90 dias".
   */
  async enviarAvisoRetencaoBackup(dados: {
    email:         string
    nomeCliente:   string
    diasRestantes: number
    ultimoBackup:  Date
  }) {
    const ultimo = dataLonga(dados.ultimoBackup)
    const dias   = `${dados.diasRestantes} ${dados.diasRestantes === 1 ? 'dia' : 'dias'}`

    await this.enviar('RETENCAO_BACKUP', {
      from:    FROM,
      to:      dados.email,
      subject: dados.diasRestantes <= 7
        ? `Últimos ${dados.diasRestantes} dias do seu backup — StartBig ERP`
        : `Seu backup em nuvem será removido em ${dados.diasRestantes} dias`,
      html: layout({
        selo:      'Backup em nuvem',
        tom:       'atencao',
        titulo:    `Seu backup será removido em ${dias}`,
        preheader: 'Reative a licença dentro do prazo e o backup continua guardado.',
        corpo: [
          ola(dados.nomeCliente),
          paragrafo(`Sua licença está inativa e, por isso, a cópia de segurança guardada na nossa nuvem será <strong style="color:${COR.escuro};">removida em ${dias}</strong>.`),
          tabelaDados([['Último backup enviado', ultimo]]),
          aviso('<strong>Nada foi perdido até aqui.</strong> Enquanto o prazo não vence, basta reativar a licença para voltar a ter o backup e restaurá-lo pelo próprio sistema.', 'info'),
          nota('Depois do prazo a remoção é definitiva e não há como recuperar.'),
        ].join(''),
      }),
    })

    this.logger.log(`Aviso de retenção de backup (${dados.diasRestantes} dias) enviado para ${dados.email}`)
  }

  async enviarAlertaTrocaDispositivo(dados: {
    email:       string
    nomeCliente: string
    hwidNovo:    string
    /** Hostname, quando o ERP manda: "NOTEBOOK-LOJA" diz mais que um GUID. */
    nomeComputador?: string
    dataHora:    Date
  }) {
    const dataHora = dados.dataHora.toLocaleString('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
    })

    await this.enviar('TROCA_COMPUTADOR', {
      from:    FROM,
      to:      dados.email,
      subject: 'Alerta de segurança — novo dispositivo conectado à sua conta StartBig',
      html:    layout({
        selo:      'Alerta de segurança',
        tom:       'atencao',
        titulo:    'Sua licença foi ativada em outro computador',
        preheader: `Login com e-mail e senha em ${dados.nomeComputador ?? 'um novo computador'} em ${dataHora}.`,
        corpo: [
          ola(dados.nomeCliente),
          paragrafo('Alguém entrou na sua conta com e-mail e senha em um <strong>novo computador</strong>, e a licença passou a funcionar nele. O computador anterior foi desconectado para liberar a vaga.'),
          tabelaDados([
            ...(dados.nomeComputador ? [['Computador', esc(dados.nomeComputador)] as [string, string]] : []),
            ['Identificação', `<span style="font-family:'Courier New',Courier,monospace;font-size:12px;font-weight:400;word-break:break-all;">${esc(dados.hwidNovo)}</span>`],
            ['Data e hora',   dataHora],
          ]),
          aviso('Se foi você quem trocou de computador ou reinstalou o sistema, pode ignorar este aviso. <strong>Se não reconhece esse acesso</strong>, troque sua senha e fale com o suporte agora.', 'atencao'),
          nota('E-mail automático de segurança. Não é preciso responder.'),
        ].join(''),
      }),
    })

    this.logger.log(`Alerta de troca de dispositivo enviado para ${dados.email}`)
  }

  /**
   * Alerta OPERACIONAL (vai para você, não para o cliente): algo relacionado a
   * dinheiro não pôde ser concluído — evento descartado sem dono, checkout que o
   * gateway recusou, etc. Sem isso a falha é silenciosa e você só descobre pela
   * reclamação do cliente, semanas depois.
   * Precisa de ADMIN_ALERT_EMAIL configurada — sem ela, só registra no log.
   */
  async enviarAlertaOperacional(dados: {
    titulo:     string
    subtitulo:  string
    evento:     string
    motivo:     string
    referencia: string
    valor:      number | null
    acao:       string
  }) {
    const destino = process.env.ADMIN_ALERT_EMAIL

    const valor = dados.valor != null
      ? dados.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '—'
    const mono = (t: string) => `<span style="font-family:'Courier New',Courier,monospace;font-size:12px;word-break:break-all;">${esc(t)}</span>`

    const payload: Payload = {
      from:    FROM,
      to:      destino ?? '(ADMIN_ALERT_EMAIL não configurada)',
      subject: `[ALERTA] ${dados.titulo} — ${dados.evento}`,
      html:    layout({
        selo:      'Alerta operacional',
        tom:       'perigo',
        titulo:    dados.titulo,
        preheader: `${dados.evento}: ${dados.motivo}`,
        interno:   true,
        corpo: [
          paragrafo(esc(dados.subtitulo)),
          tabelaDados([
            ['Evento',     mono(dados.evento)],
            ['Motivo',     esc(dados.motivo)],
            ['Referência', mono(dados.referencia)],
            ['Valor',      valor],
          ]),
          aviso(`<strong>O que fazer:</strong> ${esc(dados.acao)}`, 'info'),
        ].join(''),
      }),
    }

    // Sem destino o alerta não sai, mas entra no histórico: é a única forma de
    // ele aparecer para alguém em vez de morrer no log do pm2.
    if (!destino) {
      this.logger.warn(`ADMIN_ALERT_EMAIL não configurada — alerta operacional não enviado (${dados.evento}: ${dados.motivo})`)
      await this.registrar('ALERTA_OPERACIONAL', payload, 'NAO_ENVIADO', 'ADMIN_ALERT_EMAIL não configurada no servidor.')
      return
    }

    await this.enviar('ALERTA_OPERACIONAL', payload)

    this.logger.warn(`Alerta operacional enviado para ${destino}: ${dados.evento} — ${dados.motivo} (${dados.referencia})`)
  }

  private templateVencimento(d: {
    nomeCliente:   string
    diasRestantes: number
    vencimento:    string
  }) {
    const urgente = d.diasRestantes <= 1
    const dias    = `${d.diasRestantes} ${d.diasRestantes === 1 ? 'dia' : 'dias'}`

    return layout({
      selo:      'Aviso de vencimento',
      tom:       urgente ? 'perigo' : 'atencao',
      titulo:    urgente ? 'Sua licença vence amanhã' : `Sua licença vence em ${dias}`,
      preheader: `Renove até ${d.vencimento} para não interromper o sistema.`,
      corpo: [
        ola(d.nomeCliente),
        paragrafo('Este é um lembrete automático: a sua assinatura do StartBIG está perto de vencer.'),
        destaque({ rotulo: 'Sua licença vence em', valor: dias, detalhe: `Data: <strong>${d.vencimento}</strong>`, tom: urgente ? 'perigo' : 'atencao' }),
        paragrafo('Para não interromper o acesso, faça o pagamento da renovação antes dessa data. Dá para renovar pelo próprio sistema.'),
        nota('Se já fez o pagamento, pode desconsiderar este e-mail.'),
      ].join(''),
    })
  }
}
