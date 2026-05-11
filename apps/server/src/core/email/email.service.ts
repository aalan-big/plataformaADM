import { Injectable, Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  private transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

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

    await this.transporter.sendMail({
      from:    `"StartBig ERP" <${process.env.SMTP_USER}>`,
      to:      dados.email,
      subject: 'Sua chave de ativação StartBig ERP',
      html:    this.template({ ...dados, vencimento }),
    })

    this.logger.log(`Chave de ativação enviada para ${dados.email}`)
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
