---
name: project-deploy-audit
description: Auditoria de deploy VPS — 6 bloqueadores críticos de Mai 2026 RESOLVIDOS em 11/07/2026
metadata:
  type: project
---

Auditoria realizada em 2026-05-20 antes do primeiro deploy para VPS.
**Todos os 6 bloqueadores críticos foram RESOLVIDOS e deployados em 2026-07-11.**

**Bloqueadores críticos (todos ✅ resolvidos em 11/07/2026):**
1. ✅ JWT_SECRET: fallback só em dev via `core/config/secrets.ts` (getJwtSecret); `validarSegredosProducao()` derruba o boot em produção se faltar. VPS agora tem JWT_SECRET forte + NODE_ENV=production no apps/server/.env
2. ✅ CORS restrito por `CORS_ORIGINS` em produção (main.ts) — VPS usa `https://admin.startbig.com.br`
3. ✅ PORT lido do ambiente (fallback 3001) — main.ts
4. ✅ `ecosystem.config.js` (PM2) criado — MAS a VPS usa processos PM2 próprios chamados `api` e `web` (não o ecosystem novo); NODE_ENV vem do .env via dotenv override
5. ✅ `build` da raiz agora builda web + server
6. ✅ Helmet instalado e ativo (main.ts)

**Deploy/infra da VPS (descoberto em 11/07):**
- Projeto em `/root/plataformaADM`, PM2 com processos `api` (id 1) e `web` (id 0)
- Server roda via `ts-node --transpile-only` (não compila pra dist)
- Logs PM2 em `~/.pm2/logs/api-out.log` e `api-error.log` (acumulam, não limpam no restart — usar `pm2 flush`)
- Boot novo confirmado pela linha `Server running ... (NODE_ENV=production)`

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

**Stripe (Live pendente):** VPS ainda usa chaves de TESTE (sk_test/pk_test). Preços recorrentes criados via código no modo teste (produtos "Plano Teste — Mensal/Trimestral/Anual"). Gotcha resolvido: o `stripePriceIdMensal` do plano tinha letra "O" no lugar do zero "0" → "No such price". Pra ir pro Live: trocar chaves p/ sk_live, recriar preços em modo Live, atualizar stripePriceId* dos planos, criar webhook Live. Ver [[stripe_api_dahlia_invoice]] e [[fluxo_pagamento_erp_admin]].

**Ainda não validado:** renovação automática do 2º ciclo (`invoice.payment_succeeded` billing_reason=subscription_cycle) — só ocorre quando um ciclo renova de fato; o teste de 11/07 exercitou só o 1º pagamento.

**How to apply:** Bloqueadores de segurança já resolvidos. Próximos passos são só a virada pro Live (chaves/preços/webhook) quando o cliente decidir.
