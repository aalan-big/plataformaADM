/**
 * Configuração do PM2 para deploy na VPS.
 *
 * Sobe os dois processos (API NestJS + painel Next.js) já com NODE_ENV=production,
 * o que ATIVA as travas de segurança (JWT_SECRET obrigatório, CORS restrito).
 *
 * Uso na VPS:
 *   npm install                 # instala deps de todos os workspaces
 *   npm run build               # builda web + server
 *   pm2 start ecosystem.config.js
 *   pm2 save                    # persiste entre reboots
 *
 * As variáveis sensíveis (JWT_SECRET, STRIPE_*, DATABASE_URL, CORS_ORIGINS, PORT)
 * continuam vindo dos arquivos apps/server/.env e apps/web/.env da VPS —
 * aqui só forçamos NODE_ENV para não depender de o ambiente tê-lo setado.
 */
module.exports = {
  apps: [
    {
      name:      'startbig-server',
      cwd:       './apps/server',
      script:    'npm',
      args:      'run start',
      env:       { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name:      'startbig-web',
      cwd:       './apps/web',
      script:    'npm',
      args:      'run start',
      env:       { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
    },
  ],
}
