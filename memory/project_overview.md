---
name: project-overview
description: Visão geral da plataforma — stack, estrutura, funcionalidades implementadas
metadata:
  type: project
---

Plataforma SaaS de gestão para distribuidores de ERP. Admin panel que gerencia clientes (PF/PJ), licenças, dispositivos, financeiro e parceiros.

**Why:** Produto próprio do usuário para vender acesso ao ERP a clientes.

**Stack:**
- Monorepo npm workspaces (sem Turborepo)
- Backend: NestJS em `apps/server` (porta 3001), TypeScript, Prisma ORM
- Frontend: Next.js em `apps/web` (porta 3000), Tailwind CSS
- Banco: PostgreSQL via Prisma
- Shared: `packages/database` (repositórios Prisma), `packages/schemas` (Zod), `packages/ui`

**Funcionalidades implementadas:**
- Auth JWT (guard + roles ADMIN)
- CRUD Clientes PF/PJ com soft delete (campo `ativo`)
- Licenças com status (AGUARDANDO/ATIVA/SUSPENSA/BLOQUEADA/REVOGADA/VENCIDA)
- Heartbeat/sessões de dispositivos em tempo real
- Auto-cadastro ERP (endpoint público)
- Financeiro com Stripe + Asaas webhook
- Email via nodemailer (chave de ativação, alertas de vencimento)
- Parceiros

**How to apply:** Ao sugerir novas features, considerar que o foco é B2B (admin gerencia clientes), não self-service do cliente final.
