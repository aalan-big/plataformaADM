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
  | 'AVISO_FISCAL' | 'COBRANCA_EXCEDENTE'

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "2026-11" → "novembro de 2026". */
const mesPorExtenso = (competencia: string) => {
  const [ano, mes] = competencia.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

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
   * Avisos da franquia de notas fiscais: 80% usada, franquia atingida, teto
   * de segurança próximo e teto atingido. Cada um sai uma vez no mês — quem
   * segura isso é o `FiscalFranquiaService`, não este método.
   */
  async enviarAvisoFranquia(dados: {
    email:          string
    nomeCliente:    string
    tipo:           'FRANQUIA_80' | 'FRANQUIA_ATINGIDA' | 'TETO_PROXIMO' | 'TETO_ATINGIDO'
    emitidas:       number
    franquia:       number
    limite:         number
    formaCobranca:  'CARTAO' | 'PIX'
    precoExcedente: number
  }) {
    const cartao = dados.formaCobranca === 'CARTAO'
    const uso = destaque({
      rotulo:  'Notas emitidas neste mês',
      valor:   `${dados.emitidas} de ${dados.franquia}`,
      detalhe: 'NF-e, NFC-e e NFS-e somadas',
      tom:     dados.tipo === 'FRANQUIA_80' ? 'atencao' : 'perigo',
    })

    const conteudo = {
      FRANQUIA_80: {
        assunto: `Você já usou ${dados.emitidas} das ${dados.franquia} notas do mês`,
        tom:     'atencao' as const,
        titulo:  'Sua franquia de notas está acabando',
        texto: [
          paragrafo(`Seu plano inclui <strong style="color:${COR.escuro};">${dados.franquia} notas por mês</strong>, somando NF-e, NFC-e e NFS-e.`),
          cartao
            ? aviso(`Passando disso, a emissão continua normalmente e cada nota a mais custa <strong>${reais(dados.precoExcedente)}</strong>, cobrado no cartão no dia 1º do mês seguinte.`, 'info')
            : aviso('Passando disso, a emissão de notas para até a virada do mês. Para continuar emitindo, cadastre um cartão ou fale com o suporte.', 'atencao'),
        ],
      },
      FRANQUIA_ATINGIDA: {
        assunto: cartao ? 'Franquia de notas atingida — notas extras a partir de agora' : 'Franquia de notas atingida — emissão pausada',
        tom:     cartao ? 'atencao' as const : 'perigo' as const,
        titulo:  'Você usou todas as notas do mês',
        texto: [
          cartao
            ? paragrafo(`A emissão continua normalmente. Cada nota a partir de agora custa <strong style="color:${COR.escuro};">${reais(dados.precoExcedente)}</strong>, e o total vai numa cobrança única no cartão, no dia 1º.`)
            : paragrafo('A emissão de notas está pausada até a virada do mês.'),
          cartao
            ? aviso(`Por segurança, a emissão pausa sozinha se chegar a ${dados.limite} notas no mês. Você recebe um aviso antes.`, 'info')
            : aviso('Para voltar a emitir agora, cadastre um cartão na assinatura ou fale com o suporte.', 'atencao'),
        ],
      },
      TETO_PROXIMO: {
        assunto: `Atenção: ${dados.emitidas} notas emitidas este mês`,
        tom:     'atencao' as const,
        titulo:  'Volume de notas fora do comum',
        texto: [
          paragrafo(`Este mês já saíram <strong style="color:${COR.escuro};">${dados.emitidas} notas</strong>. Ao chegar em ${dados.limite}, a emissão pausa para proteger o seu cartão.`),
          aviso('Se esse volume não é o da sua loja, confira se o sistema está mandando a mesma venda mais de uma vez e fale com o suporte.', 'atencao'),
        ],
      },
      TETO_ATINGIDO: {
        assunto: 'Emissão de notas pausada — limite de segurança do mês',
        tom:     'perigo' as const,
        titulo:  'A emissão de notas foi pausada',
        texto: [
          paragrafo(`Chegamos a <strong style="color:${COR.escuro};">${dados.limite} notas</strong> neste mês, o limite de segurança. A emissão pausou para que um erro não vire uma cobrança alta no seu cartão.`),
          aviso('Se o volume é real, fale com o suporte e liberamos mais na hora.', 'atencao'),
        ],
      },
    }[dados.tipo]

    await this.enviar('AVISO_FISCAL', {
      from:    FROM,
      to:      dados.email,
      subject: `${conteudo.assunto} · StartBig ERP`,
      html:    layout({
        selo:      'Notas fiscais',
        tom:       conteudo.tom,
        titulo:    conteudo.titulo,
        preheader: conteudo.assunto,
        corpo:     [ola(dados.nomeCliente), uso, ...conteudo.texto].join(''),
      }),
    })
    this.logger.log(`Aviso de franquia ${dados.tipo} enviado para ${dados.email}`)
  }

  /** A mesma nota mandada de novo com outra ref foi barrada (no máximo um aviso por dia). */
  async enviarAvisoDuplicata(dados: {
    email:         string
    nomeCliente:   string
    ref:           string
    refAnterior:   string
    minutos:       number
    tipoDocumento: string
  }) {
    await this.enviar('AVISO_FISCAL', {
      from:    FROM,
      to:      dados.email,
      subject: 'Barramos uma nota repetida · StartBig ERP',
      html:    layout({
        selo:      'Notas fiscais',
        tom:       'atencao',
        titulo:    'Uma nota repetida não foi emitida',
        preheader: 'O sistema tentou emitir de novo uma nota igual a uma autorizada há pouco.',
        corpo: [
          ola(dados.nomeCliente),
          paragrafo(`O sistema tentou emitir uma nota igual a outra autorizada há ${dados.minutos} min. Para evitar nota em duplicidade, <strong style="color:${COR.escuro};">ela não foi emitida</strong> e não foi cobrada.`),
          tabelaDados([
            ['Documento',         esc(dados.tipoDocumento)],
            ['Nota já emitida',   esc(dados.refAnterior)],
            ['Tentativa barrada', esc(dados.ref)],
          ]),
          aviso('Se era mesmo uma venda nova, é só confirmar no sistema e enviar de novo. Se isso se repetir sem ninguém ter pedido, fale com o suporte.', 'info'),
        ].join(''),
      }),
    })
    this.logger.log(`Aviso de nota repetida enviado para ${dados.email}`)
  }

  /** Cobrança das notas acima da franquia: paga ou recusada no cartão. */
  async enviarCobrancaExcedente(dados: {
    email:       string
    nomeCliente: string
    competencia: string
    excedentes:  number
    valor:       number
    pago:        boolean
  }) {
    const mes = mesPorExtenso(dados.competencia)
    await this.enviar('COBRANCA_EXCEDENTE', {
      from:    FROM,
      to:      dados.email,
      subject: dados.pago
        ? `Notas extras de ${mes}: ${reais(dados.valor)} cobrados · StartBig ERP`
        : `Não conseguimos cobrar as notas extras de ${mes} · StartBig ERP`,
      html:    layout({
        selo:      dados.pago ? 'Pagamento confirmado' : 'Falha no pagamento',
        tom:       dados.pago ? 'sucesso' : 'perigo',
        titulo:    dados.pago ? 'Cobrança das notas extras' : 'A cobrança das notas extras não passou',
        preheader: `${dados.excedentes} notas acima da franquia em ${mes}.`,
        corpo: [
          ola(dados.nomeCliente),
          destaque({
            rotulo:  `Notas acima da franquia em ${mes}`,
            valor:   reais(dados.valor),
            detalhe: `${dados.excedentes} ${dados.excedentes === 1 ? 'nota' : 'notas'} a ${reais(dados.valor / Math.max(1, dados.excedentes))}`,
            tom:     dados.pago ? 'sucesso' : 'perigo',
          }),
          dados.pago
            ? nota('Cobrado no cartão da sua assinatura. Não precisa fazer nada.')
            : aviso('Vamos tentar de novo nos próximos dias. Enquanto estiver em aberto, a emissão de notas para quando a franquia do mês acabar. Confira o cartão com o banco ou atualize a forma de pagamento.', 'atencao'),
        ].join(''),
      }),
    })
    this.logger.log(`Cobrança de excedente (${dados.pago ? 'paga' : 'falhou'}) enviada para ${dados.email}`)
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
