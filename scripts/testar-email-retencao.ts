/**
 * ============================================================================
 * NOME DO ARQUIVO: testar-email-retencao.ts
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Dispara o e-mail de aviso de remoção de backup para um endereço à escolha.
 *
 * POR QUE ISSO EXISTE:
 * Esse e-mail só sai sozinho aos 75 e 83 dias de licença inativa. Sem um jeito
 * de dispará-lo, um erro no template só apareceria daqui a dois meses e meio —
 * na caixa de entrada do cliente que precisava do aviso e não vai recebê-lo.
 *
 * COMO RODAR:
 *   npm run backup:testar-email -- seu@email.com
 * ============================================================================
 */
import { EmailService } from '../apps/server/src/core/email/email.service'

async function main() {
  const email = process.argv[2]

  if (!email || !email.includes('@')) {
    console.log('\nInforme o endereço de destino:')
    console.log('  npm run backup:testar-email -- seu@email.com\n')
    process.exit(1)
  }

  const service = new EmailService()

  // Os dois avisos que a rotina realmente envia: 15 e 7 dias antes de apagar.
  for (const diasRestantes of [15, 7]) {
    await service.enviarAvisoRetencaoBackup({
      email,
      nomeCliente:  'Cliente de Teste',
      diasRestantes,
      ultimoBackup: new Date(Date.now() - (90 - diasRestantes) * 24 * 60 * 60 * 1000),
    })
    console.log(`  ✔ aviso de ${diasRestantes} dias enviado para ${email}`)
  }

  console.log('\nConfira a caixa de entrada (e o spam). Dois e-mails devem ter chegado.\n')
}

main().catch(e => {
  console.error('\nFalha ao enviar:', e instanceof Error ? e.message : e)
  console.error('Se for erro de credencial, confira RESEND_API_KEY / SMTP_* no .env.\n')
  process.exit(1)
})
