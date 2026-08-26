# Deploy — renovação por PIX (Asaas) e carência de cartão

Roteiro para subir esta mudança na VPS **sem derrubar o que já fatura**.

Não é o `npm run deploy` de sempre: essa mudança tem uma migration e um passo que
**quebra a cadeia do script**. Seguir o caminho automático deixa a VPS com código
novo baixado e processo antigo rodando — o pior estado possível, porque parece
que subiu.

- **Caminho na VPS:** `/root/plataformaADM`
- **O que muda:** 2 colunas novas (nullable), 1 tabela nova, endpoints novos, e
  campos aditivos no `/erp/validar`
- **O que NÃO muda:** todo o caminho do Stripe que fatura hoje

---

## 0. Antes de começar

### 0.1 O que ter em mãos

| item | onde consegue | usado em |
|---|---|---|
| Chave de API do Asaas **produção** | painel Asaas → ícone de pessoa → Integrações → Gerar nova Chave | passo 3 |
| Token do webhook | **você inventa** (senha longa, sem acento/espaço/aspas) | passos 3 e 5 |
| Chave PIX cadastrada na conta de produção | painel Asaas → Pix → Minhas Chaves | — |

Ao gerar a chave de produção, **deixe desligado** o toggle *"Permitir que esta
chave execute operações de saque via API"*. A integração só cria cobrança e
consulta pagamento; nunca tira dinheiro. Com o toggle ligado, uma chave vazada
esvazia a conta — sem ele, o pior caso é alguém gerar cobrança em seu nome.

> **Sem chave PIX cadastrada**, o QR fica vinculado a uma instituição parceira e
> só pode ser pago **até 23:59 do mesmo dia**. O código lida com isso (a validade
> do QR é sempre a autoritativa), mas o cliente que gerar o PIX à noite terá
> minutos para pagar.

### 0.2 Conferir o estado da VPS

```bash
cd /root/plataformaADM

# 1. Nomes reais dos processos — o script de deploy assume `api` e `web`,
#    mas o ecosystem.config.js os nomeia `startbig-server` e `startbig-web`.
pm2 list

# 2. Nada pendente sem commit que possa ser perdido no git pull
git status

# 3. O commit em que a VPS está agora — anote, é o alvo do rollback
git rev-parse --short HEAD
```

**Anote os nomes do `pm2 list`.** Eles entram no passo 6. Se o script de deploy
usar nomes que não existem, o `pm2 restart` falha e nada reinicia.

### 0.3 Backup do banco

```bash
pg_dump -U <usuario> <banco> > ~/backup-antes-pix-$(date +%F-%H%M).sql
ls -lh ~/backup-antes-pix-*.sql
```

A migration é aditiva e não apaga nada — mas backup antes de mexer em banco de
produção não se negocia.

---

## 1. Trazer o código (sem aplicar nada)

```bash
cd /root/plataformaADM
git pull
npm install
```

Até aqui **nada mudou em produção**: os processos continuam rodando o build
antigo. Ainda dá para abortar sem consequência.

---

## 2. Conferir a migration ANTES de aplicar

Este é o passo que o `npm run deploy` faz às cegas. Aqui a gente olha primeiro.

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

### O que você DEVE ver

```sql
ALTER TABLE "clientes" ADD COLUMN "asaasCustomerId" TEXT;
ALTER TABLE "licencas" ADD COLUMN "carenciaAte" TIMESTAMP(3);
CREATE TABLE "cobrancas_renovacao" ( ... );
CREATE UNIQUE INDEX ... / CREATE INDEX ... / ADD CONSTRAINT ... FOREIGN KEY ...
```

### O que NÃO pode aparecer

Se aparecer **qualquer** `DROP`, `ALTER COLUMN`, `RENAME` ou `SET NOT NULL`,
**pare**. Significa que o schema da VPS divergiu do nosso — e aplicar destruiria
dado. Nesse caso, mande o diff para análise antes de qualquer coisa.

```bash
# Confirmação rápida: tem que devolver 0
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  | grep -icE "drop|rename|alter column|set not null"
```

### Aplicar

```bash
npm run db:push -- --accept-data-loss
```

**Por que a flag:** o `db push` aborta por causa de um aviso sobre os índices
únicos novos (`asaasCustomerId`, `gatewayCobrancaId`). O aviso é inofensivo — são
colunas recém-criadas, todas nulas, sem duplicata possível. Mas ele derruba a
cadeia `&&` do `npm run deploy`, e é por isso que este roteiro existe.

> **Não coloque `--accept-data-loss` no script de deploy.** Essa fricção é uma
> proteção: um dia ela vai barrar uma mudança realmente destrutiva.

Confirme que zerou:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# esperado: "-- This is an empty migration."
```

---

## 3. Variáveis de ambiente

```bash
nano /root/plataformaADM/apps/server/.env
```

Adicione ao final:

```
# Asaas — PIX
ASAAS_API_KEY="$aact_prod_..."
ASAAS_WEBHOOK_TOKEN="<a senha que você inventou>"
```

Salvar: `Ctrl+O`, Enter, `Ctrl+X`.

**Pontos de atenção:**

- O `$` faz parte da chave. Mantenha, e mantenha as aspas.
- O código deriva o ambiente do prefixo: `$aact_prod_` → API de produção,
  `$aact_hmlg_` → sandbox. Chave errada aponta para o lugar errado sozinha.
- Não existe `ASAAS_BASE_URL` a configurar. Ela só existe como escape manual.
- **Nenhuma das duas é obrigatória para o boot.** Faltando, a API sobe normal e
  o PIX responde `METODO_INDISPONIVEL`. Foi decisão de projeto: tornar o Asaas
  obrigatório derrubaria a API inteira — e com ela o Stripe e a validação de
  todas as licenças — por um meio de pagamento que ainda não é o principal.

---

## 4. Build e restart

```bash
cd /root/plataformaADM
npm run build
```

Só depois do build terminar sem erro:

```bash
# Use os nomes que apareceram no `pm2 list` do passo 0.2
pm2 restart <nome-do-server> <nome-do-web> --update-env
pm2 logs --lines 50
```

No log do server, confirme:

```
Nest application successfully started
Server running on http://localhost:3001 (NODE_ENV=production)
```

---

## 5. Cadastrar o webhook no Asaas

Só agora, com a API no ar respondendo com o token configurado. **Nesta ordem**:
cadastrar o webhook antes de o servidor conhecer o token faria toda entrega levar
401 — e o Asaas **desativa a fila após 15 falhas seguidas**.

No painel Asaas de **produção** → Integrações → Webhooks → novo webhook:

| campo | valor |
|---|---|
| URL | `https://api.startbig.com.br/financeiro/webhook/asaas` |
| E-mail para erros | um e-mail que você lê |
| Token de autenticação | **exatamente** o mesmo do `.env` |
| Eventos | os de cobrança tratados em `webhookAsaas`: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED` (renovam), `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_DELETED` (só alarmam). Os demais a API ignora — marcar é entrega à toa. |

Se as duas senhas não baterem caractere por caractere, o sintoma é 401 em toda
entrega — e a fila morre em 15 tentativas.

---

## 6. Verificação pós-deploy

### 6.1 O que já faturava continua faturando

```bash
# Licença real revalida normalmente
curl -s -X POST https://api.startbig.com.br/erp/validar \
  -H "Content-Type: application/json" \
  -d '{"chave":"<uma chave ATIVA de verdade>"}'
```

Esperado: `valida: true`, `status: ATIVA`, e agora também `isTrial` e
`emCarencia: false`. Campos novos são aditivos — ERP antigo ignora.

### 6.2 O webhook está fechado para estranhos

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://api.startbig.com.br/financeiro/webhook/asaas \
  -H "Content-Type: application/json" -d '{}'
```

**Esperado: `401`.** Se vier 400 ou 200, o token não foi lido — pare e confira o
`.env` e o restart.

### 6.3 O PIX aparece

```bash
curl -s -X POST https://api.startbig.com.br/licenca/renovacao/planos \
  -H "Content-Type: application/json" \
  -d '{"chave":"<uma chave de verdade>"}'
```

Esperado: períodos com `"metodos":["CARTAO","PIX"]`. Se vier só `CARTAO`, a
`ASAAS_API_KEY` não foi carregada.

### 6.4 Um PIX de verdade, de ponta a ponta

Gere um PIX do menor período, **pague de verdade com o celular** (é produção —
vai sair dinheiro) e confirme que a licença renova. Depois estorne pelo painel do
Asaas. É o único jeito de provar o webhook real, que só existe com URL pública.

---

## 7. Rollback

```bash
cd /root/plataformaADM
git reset --hard <o commit anotado no passo 0.3>
npm install
npm run build
pm2 restart <nome-do-server> <nome-do-web> --update-env
```

**As colunas e a tabela novas podem ficar.** São nullable e ninguém as lê no
código antigo — não atrapalham nada. Tentar removê-las é mais arriscado que
deixá-las órfãs.

Se quiser desligar só o PIX, sem reverter código: comente a `ASAAS_API_KEY` no
`.env` e reinicie. O PIX some das opções, o cartão segue intacto.

---

## Armadilhas conhecidas

| armadilha | sintoma | o que fazer |
|---|---|---|
| `npm run deploy` direto | Deploy "termina", VPS roda código antigo | Usar este roteiro; o `db push` aborta e mata a cadeia `&&` |
| Nomes de processo errados no pm2 | `pm2 restart` falha, nada reinicia | Conferir com `pm2 list` no passo 0.2 |
| Token do webhook diferente nos dois lados | 401 em toda entrega; fila morre em 15 falhas | Recadastrar o webhook com o token do `.env` |
| Chave de sandbox em produção | Cobrança criada no ambiente errado | Conferir prefixo `$aact_prod_` |
| Sem chave PIX na conta | QR expira às 23:59 do mesmo dia | Cadastrar em Pix → Minhas Chaves |
| Reboot da VPS sem `pm2 save` | Tudo fora do ar até subir na mão | `pm2 startup` + `pm2 save` |
| Scripts via `dotenv-cli` | `ASAAS_API_KEY` chega vazia | O `$` é expandido como variável; o servidor usa `dotenv` puro e não sofre disso |

---

## O que este deploy NÃO faz

- **Não muda o fluxo do cartão.** Stripe continua assinatura recorrente, mesmo
  código, mesmos webhooks.
- **Não altera preço de plano nenhum.** Preços seguem vindo do cadastro.
- **Não liga carência para quem paga PIX.** Ela só é aberta quando o Stripe avisa
  que o cartão falhou (`invoice.payment_failed`), dura 7 dias e some na renovação
  ou no cancelamento da assinatura.
