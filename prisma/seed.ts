import { prisma } from '@startbig/database'
import bcrypt from 'bcryptjs'

async function main() {
  // ── Usuário Administrador ─────────────────────────────────────────────────
  // Altere email e senha antes de subir para produção.
  const senhaHash = await bcrypt.hash(process.env.ADMIN_SENHA ?? 'admin123', 10)

  const admin = await prisma.usuario.upsert({
    where:  { email: process.env.ADMIN_EMAIL ?? 'admin@admin.com' },
    update: {},
    create: {
      nome:        'Administrador',
      email:       process.env.ADMIN_EMAIL ?? 'admin@admin.com',
      senha:       senhaHash,
      tipoUsuario: 'ADMIN',
      ativo:       true,
    },
  })

  console.log(`[seed] Usuário admin: ${admin.email}`)

  // ── Planos ────────────────────────────────────────────────────────────────
  const planos = [
    {
      nome:               'Starter',
      limiteUsuario:      1,
      precoMensal:        79.90,
      precoTrimestral:    215.73,
      precoAnual:         766.08,
      descontoTrimestral: 10.00,
      descontoAnual:      20.00,
      status:             'ATIVO',
    },
    {
      nome:               'Profissional',
      limiteUsuario:      5,
      precoMensal:        149.90,
      precoTrimestral:    404.73,
      precoAnual:         1438.08,
      descontoTrimestral: 10.00,
      descontoAnual:      20.00,
      status:             'ATIVO',
    },
    {
      nome:               'Enterprise',
      limiteUsuario:      15,
      precoMensal:        299.90,
      precoTrimestral:    809.73,
      precoAnual:         2879.04,
      descontoTrimestral: 10.00,
      descontoAnual:      20.00,
      status:             'ATIVO',
    },
  ]

  for (const dados of planos) {
    const plano = await prisma.plano.upsert({
      where:  { nome: dados.nome },
      update: {},
      create: dados,
    })
    console.log(`[seed] Plano: ${plano.nome} (R$ ${plano.precoMensal}/mês, ${plano.limiteUsuario} usuário(s))`)
  }

  console.log('\n[seed] Banco populado com sucesso.')
}

main()
  .catch((e) => { console.error('[seed] Erro:', e); process.exit(1) })
