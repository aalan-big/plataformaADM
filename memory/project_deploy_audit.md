---
name: project-deploy-audit
description: Auditoria de prontidão para deploy em VPS — problemas críticos identificados em Mai 2026
metadata:
  type: project
---

Auditoria realizada em 2026-05-20 antes do primeiro deploy para VPS.

**Bloqueadores críticos:**
1. JWT_SECRET tem fallback hardcoded `'chave-secreta-de-desenvolvimento'` — auth.guard.ts:41 e auth.service.ts:31
2. CORS aberto para todas as origens (`app.enableCors()` sem config) — main.ts:22
3. Porta hardcoded 3001, não lê `PORT` env var — main.ts:24
4. Nenhum arquivo de deploy: sem Dockerfile, docker-compose, PM2 ecosystem.config.js
5. Script `build` na raiz só builda o web, não o server
6. Helmet não instalado (sem headers de segurança CSP, X-Frame-Options)

**Pendências menores:**
- .env.example ausente
- Sem seed do banco para dados iniciais (admin user, planos)
- Email service pode falhar silenciosamente se SMTP não configurado
- TypeScript `strict: false` no server

**O que está pronto:**
- Soft delete clientes implementado e funcionando
- Stripe + webhooks implementados
- Rate limiting ThrottlerModule (100/60s) ativo
- Prisma com 1 migration aplicada no PostgreSQL
- Next.js proxy para backend via SERVER_URL env var

**How to apply:** Antes de qualquer deploy para VPS, resolver os 6 bloqueadores críticos acima. Sugerir PM2 + nginx como stack de deploy (sem Docker por simplicidade inicial).
