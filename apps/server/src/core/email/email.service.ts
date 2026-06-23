import { Injectable, Logger } from '@nestjs/common'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM   = process.env.EMAIL_FROM ?? 'noreply@startbig.com.br'

async function enviar(payload: Parameters<typeof resend.emails.send>[0]) {
  const { data, error } = await resend.emails.send(payload)
  if (error) throw new Error(`Resend: ${JSON.stringify(error)}`)
  return data
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  async enviarChaveAtivacao(dados: {
    email:           string
    nomeCliente:     string
    chave:           string
    dataVencimento:  Date
    nomeDispositivo: string
  }) {
    const vencimento = dados.dataVencimento.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    })

    await enviar({
      from:    FROM,
      to:      dados.email,
      subject: 'Sua chave de ativação StartBig ERP',
      html:    this.template({ ...dados, vencimento }),
    })

    this.logger.log(`Chave de ativação enviada para ${dados.email}`)
  }

  async enviarRenovacao(dados: {
    email:           string
    nomeCliente:     string
    dataVencimento:  Date
    nomeDispositivo: string
  }) {
    const vencimento = dados.dataVencimento.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    })

    await enviar({
      from:    FROM,
      to:      dados.email,
      subject: 'Renovação confirmada — StartBig ERP',
      html:    `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <div style="max-width:540px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
    <div style="background:#1e3a5f;padding:28px 36px;text-align:center;">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:1px;">StartBig ERP</p>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Renovação Confirmada</p>
    </div>
    <div style="padding:32px 36px;">
      <p style="color:#e2e8f0;font-size:15px;margin:0 0 6px;">Olá, <strong>${dados.nomeCliente}</strong></p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;line-height:1.7;">
        Seu pagamento foi confirmado e sua licença foi renovada com sucesso. O sistema continua funcionando normalmente com a mesma chave de ativação.
      </p>
      <div style="background:#0f172a;border:1px solid #22c55e;border-radius:10px;padding:22px;text-align:center;margin-bottom:24px;">
        <p style="margin:0 0 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:2px;">Nova validade</p>
        <p style="margin:0;color:#4ade80;font-size:22px;font-weight:700;">${vencimento}</p>
        <p style="margin:10px 0 0;color:#94a3b8;font-size:12px;">Dispositivo: ${dados.nomeDispositivo}</p>
      </div>
      <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;border-top:1px solid #334155;padding-top:20px;">
        Não é necessário nenhuma ação. Em caso de dúvidas, entre em contato com o suporte.
      </p>
    </div>
  </div>
</body>
</html>`,
    })

    this.logger.log(`Confirmação de renovação enviada para ${dados.email}`)
  }

  async enviarAvisoVencimento(dados: {
    email:           string
    nomeCliente:     string
    diasRestantes:   number
    dataVencimento:  Date
  }) {
    const vencimento = dados.dataVencimento.toLocaleDateString('pt-BR', {
      day: '2-digit', month: 'long', year: 'numeric',
    })

    const subject = dados.diasRestantes === 1
      ? 'Aviso Importante: Sua licença vence amanhã'
      : `Sua licença vencerá em ${dados.diasRestantes} dias`

    await enviar({
      from:    FROM,
      to:      dados.email,
      subject,
      html:    this.templateVencimento({ ...dados, vencimento }),
    })

    this.logger.log(`Aviso de vencimento (${dados.diasRestantes} dias) enviado para ${dados.email}`)
  }

  private templateVencimento(d: {
    nomeCliente:   string
    diasRestantes: number
    vencimento:    string
  }) {
    const isUrgente  = d.diasRestantes <= 1
    const corDestaque = isUrgente ? '#ef4444' : '#f59e0b'

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <div style="max-width:540px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
    <div style="background:#1e3a5f;padding:28px 36px;text-align:center;">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:1px;">StartBig ERP</p>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Aviso de Vencimento</p>
    </div>
    <div style="padding:32px 36px;">
      <p style="color:#e2e8f0;font-size:15px;margin:0 0 6px;">Olá, <strong>${d.nomeCliente}</strong></p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;line-height:1.7;">
        Este é um lembrete automático de que a sua assinatura do sistema está prestes a expirar.
      </p>
      <div style="background:#0f172a;border:1px solid ${corDestaque};border-radius:10px;padding:22px;text-align:center;margin-bottom:24px;">
        <p style="margin:0 0 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:2px;">Sua licença expira em</p>
        <p style="margin:0;color:${corDestaque};font-size:26px;font-weight:700;letter-spacing:2px;">${d.diasRestantes} ${d.diasRestantes === 1 ? 'dia' : 'dias'}</p>
        <p style="margin:10px 0 0;color:#e2e8f0;font-size:13px;">Data: <strong>${d.vencimento}</strong></p>
      </div>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;line-height:1.7;">
        Para evitar a interrupção do seu acesso e a suspensão da sua licença, certifique-se de que o pagamento da renovação seja realizado antes do vencimento.
      </p>
      <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;border-top:1px solid #334155;padding-top:20px;">
        Caso já tenha efetuado o pagamento, por favor, desconsidere este e-mail. Em caso de dúvidas, entre em contato com o suporte.
      </p>
    </div>
  </div>
</body>
</html>`
  }

  private template(d: {
    nomeCliente:     string
    chave:           string
    vencimento:      string
    nomeDispositivo: string
  }) {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <div style="max-width:540px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
    <div style="background:#1e3a5f;padding:28px 36px;text-align:center;">
      <p style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:1px;">StartBig ERP</p>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Sistema de Gestão</p>
    </div>
    <div style="padding:32px 36px;">
      <p style="color:#e2e8f0;font-size:15px;margin:0 0 6px;">Olá, <strong>${d.nomeCliente}</strong></p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 28px;line-height:1.7;">
        Seu acesso ao StartBig ERP foi liberado. Use a chave abaixo para ativar o sistema no seu dispositivo.
      </p>
      <div style="background:#0f172a;border:1px solid #3b82f6;border-radius:10px;padding:22px;text-align:center;margin-bottom:24px;">
        <p style="margin:0 0 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:2px;">Chave de Ativação</p>
        <p style="margin:0;color:#60a5fa;font-size:26px;font-weight:700;letter-spacing:5px;font-family:monospace;">${d.chave}</p>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td width="48%" style="background:#0f172a;border-radius:8px;padding:14px;border:1px solid #1e293b;">
            <p style="margin:0 0 4px;color:#64748b;font-size:11px;text-transform:uppercase;">Dispositivo</p>
            <p style="margin:0;color:#e2e8f0;font-size:13px;">${d.nomeDispositivo}</p>
          </td>
          <td width="4%"></td>
          <td width="48%" style="background:#0f172a;border-radius:8px;padding:14px;border:1px solid #1e293b;">
            <p style="margin:0 0 4px;color:#64748b;font-size:11px;text-transform:uppercase;">Válida até</p>
            <p style="margin:0;color:#e2e8f0;font-size:13px;">${d.vencimento}</p>
          </td>
        </tr>
      </table>
      <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;border-top:1px solid #334155;padding-top:20px;">
        Não compartilhe esta chave. Em caso de dúvidas, entre em contato com o suporte.
      </p>
    </div>
  </div>
</body>
</html>`
  }
}
