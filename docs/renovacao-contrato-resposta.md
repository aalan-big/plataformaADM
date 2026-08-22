# Renovação de assinatura — resposta ao contrato do ERP

Espelho de `backend-fastapi/docs/renovacao-assinatura-contrato-web.md`.
Documenta **o que a API entrega de fato**, incluindo onde ela diverge da
proposta e por quê.

- **Base:** `https://api.startbig.com.br`
- **Formato:** JSON camelCase · datas ISO-8601 UTC · **dinheiro em centavos** nas
  rotas de renovação
- **Credencial:** `chave` + `hwid` — funciona com a licença **VENCIDA**

---

## 1. Divergências da proposta original

Quatro pontos mudaram. Todos por um motivo concreto.

### 1.1 `meses` no lugar de `diasAdicionados`

A renovação soma **mês de calendário** (`setMonth(+meses)`), não 30 dias. Pagar
em 31/01 leva a 28/02 — 28 dias. Anunciar "30 dias" seria mentira em fevereiro e
em todo mês de 31. A verdade é a `dataVencimento` que volta do `/erp/validar`.

### 1.2 `hwid` é aceito e registrado, mas **não conferido**

O contrato previa `LICENCA_NAO_ENCONTRADA` para "chave e hwid não batem". Só que
o hwid não é verificado em lugar nenhum hoje — nem no `/erp/validar`, que apenas
o ecoa dentro do token — e só existe em `licencas_sessoes` para máquina que
conectou nos últimos 35 minutos.

Exigir que ele "bata" trancaria justamente quem precisa pagar: licença vencida,
ERP em modo somente-renovação, sessão já expirada. A chave de ativação é a
credencial, no mesmo nível de confiança do resto do contrato. O pior que alguém
de posse dela consegue aqui é gerar um boleto para pagar a licença de outro.

### 1.3 `GET /licenca/planos` virou `POST /licenca/renovacao/planos`

Dois motivos: a credencial vai no corpo (não em query string), e
`GET /licenca/planos` **já existe** como rota de admin.

Mais importante: **não existe tabela global de preços.** O preço vem do plano
daquela licença. Por isso a rota exige credencial — sem saber a licença, não há
o que responder.

### 1.4 Formato de erro: `message`, não `mensagem`

O `codigo` é o contrato e está lá, como combinado. Mas o campo de texto se chama
`message`, seguindo o padrão que todos os outros endpoints do ERP já devolvem.
Renomear obrigaria a mexer no filtro global e mudaria a resposta de **todos** os
endpoints existentes — risco desproporcional.

```json
{ "statusCode": 400, "path": "/...", "message": "...", "codigo": "PLANO_INVALIDO" }
```

---

## 2. Endpoints

### 2.1 `POST /licenca/renovacao/planos`

```json
{ "chave": "START-XXXXXXXX", "hwid": "..." }
```

**200:**

```json
{
  "plano": "Start",
  "status": "VENCIDA",
  "dataVencimento": "2026-05-19T11:41:37.459Z",
  "planos": [
    { "codigo": "MENSAL", "nome": "Mensal", "valorCentavos": 8990,
      "meses": 1, "desconto": 0, "metodos": ["CARTAO", "PIX"] }
  ]
}
```

Um período só aparece se for vendável. `metodos` diz como: `CARTAO` exige Price
cadastrado no Stripe; `PIX` exige o Asaas configurado **e** preço próprio para
aquele período — período cujo valor seria derivado do mensal por desconto não é
oferecido no PIX, porque inventar preço é decisão comercial, não de software.

### 2.2 `POST /licenca/renovacao/cobranca`

```json
{ "chave": "...", "hwid": "...", "metodo": "PIX", "plano": "MENSAL" }
```

Aceita `plano` **ou** `periodo` — os dois nomes funcionam.

**201 (PIX):**

```json
{
  "cobrancaId": "fd518db5-...",
  "metodo": "PIX",
  "status": "PENDENTE",
  "pixCopiaECola": "00020101021226820014br.gov.bcb.pix...",
  "qrCodeBase64": "iVBORw0KGgo...",
  "valorCentavos": 8990,
  "meses": 1,
  "expiraEm": "2027-08-24T02:59:59.000Z"
}
```

**Se o Asaas demorar mais que o teto de I8**, a resposta vem com
`pixCopiaECola: null`. Não é erro: busque no polling da 2.4, que preenche assim
que o gateway responder.

**201 (cartão):** `{ "metodo": "CARTAO", "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }`

A URL do Stripe já carrega a identidade da licença nos metadados — não precisa de
parâmetro nem de URL fixa. Não devolvemos `expiraEm` para cartão: o Stripe não
expõe isso no retorno que usamos.

**Idempotência (I3):** dois cliques com a mesma licença + período + método
devolvem a **mesma** cobrança, com o mesmo copia-e-cola.

### 2.3 `POST /licenca/renovacao/checkout`

Atalho para 2.2 com `metodo: "CARTAO"`. Mesmo corpo, mesma resposta.

### 2.4 `GET /licenca/renovacao/cobranca/{id}?chave=...&hwid=...`

**200:**

```json
{
  "cobrancaId": "fd518db5-...",
  "status": "PENDENTE",
  "pagoEm": null,
  "dataVencimento": null,
  "pixCopiaECola": "000201...",
  "qrCodeBase64": "iVBOR...",
  "valorCentavos": 8990,
  "expiraEm": "2027-08-24T02:59:59.000Z"
}
```

`status`: `PENDENTE` · `PAGA` · `EXPIRADA` · `CANCELADA`.
Quando `PAGA`, `pagoEm` e `dataVencimento` vêm preenchidos.

**Sobre o polling:** a rota lê o **nosso** banco, então pode ser chamada a cada
5s sem peso. No máximo uma vez a cada 30s ela pergunta ao gateway se o pagamento
caiu — rede de segurança para webhook perdido. Foi esse caminho que renovou a
licença nos testes, sem webhook nenhum.

---

## 3. Códigos de erro

| código | HTTP | quando |
|---|---|---|
| `LICENCA_NAO_ENCONTRADA` | 404 | chave não existe |
| `LICENCA_BLOQUEADA` | 403 | bloqueada / suspensa / revogada — pagar não resolve |
| `PLANO_INVALIDO` | 400 | plano não vendido naquele período |
| `METODO_INDISPONIVEL` | 400/503 | PIX não habilitado, ou o gateway não respondeu |
| `ASSINATURA_ATIVA` | 409 | já existe cartão renovando sozinho — cobrar de novo duplicaria |
| `DOCUMENTO_AUSENTE` | 400 | cadastro sem CPF/CNPJ, exigido pelo Asaas |
| `COBRANCA_NAO_ENCONTRADA` | 404 | id inexistente, ou de outra licença |
| `DADOS_INVALIDOS` | 400 | corpo malformado |

`LICENCA_VENCIDA` **não existe** aqui, de propósito: vencida é o caso principal.

---

## 4. Carência — só no cartão

O ERP nunca decide isso. O `/erp/validar` passa a devolver, **dentro do token
assinado em RS256**:

```json
{
  "valida": true,
  "status": "VENCIDA",
  "dataVencimento": "2026-05-19T11:41:37.459Z",
  "emCarencia": true,
  "dataLimiteCarencia": "2026-08-27T16:16:50.206Z",
  "diasRestantesCarencia": 5,
  "isTrial": false
}
```

**A regra:**

| pagou com | vence | e então |
|---|---|---|
| **PIX** ou manual | trava **na hora** | só renovação libera |
| **Cartão** | 7 dias de carência | depois trava |

A carência não é um favor ao cliente: é a janela em que o Stripe re-tenta um
cartão que falhou. Quem paga no cartão pode ficar inadimplente sem saber (cartão
vencido, limite, banco recusando). PIX não falha sozinho — quem não pagou,
escolheu não pagar.

Ela é aberta no `invoice.payment_failed`, **uma vez por falha** (retentativa não
empurra o prazo), e some na renovação ou no cancelamento da assinatura.

**Atenção — armadilha:** o campo `gracePeriodDias` que o ERP já recebe **não é**
isso. Ele é a validade offline do JWT (quanto tempo a loja roda sem internet).
Se o ERP estiver usando aquele número como carência de pagamento, está errado
desde antes desta mudança.

A carência vale nas **três** portas: `/validar`, `/conectar` e `/heartbeat`.
Liberar uma e barrar outra deixaria o cliente com token válido e sistema fechado.

### `/erp/validar` com licença vencida e sem carência

```json
{
  "valida": false,
  "motivo": "Licença vencida.",
  "status": "VENCIDA",
  "dataVencimento": "...",
  "licencaId": "14505928-...",
  "isTrial": true
}
```

`licencaId` e `isTrial` são novos: antes, o ERP vencido não sabia nem qual era a
própria licença.

---

## 5. Invariantes — como cada uma foi cumprida

| | invariante | como |
|---|---|---|
| **I1** | Cobrar funciona com licença vencida | Só bloqueio administrativo recusa. Testado nos três estados. |
| **I2** | Estender antes de marcar PAGA | `processarRenovacao` → depois `marcarCobrancaPaga`. Nessa ordem, no código. |
| **I3** | Criar duas vezes não gera duas cobranças | Busca por licença + período + método + `PENDENTE` não expirada. |
| **I4** | Nunca confiar no cliente para estender | O ERP não manda valor nem data. Não existe campo para isso. |
| **I5** | Só marcar PAGA após confirmação do PSP | Webhook autenticado por token, ou consulta direta ao gateway. |
| **I6** | ISO-8601 UTC | Padrão do sistema. |
| **I7** | Centavos, inteiros | Convertido na borda; o banco guarda reais em `Decimal(10,2)`. |
| **I8** | Responder em menos de 5s | Timeout de 8s por chamada ao gateway; estourando, devolve sem o copia-e-cola. |
| **I9** | `chave` + `hwid` como credencial | Com rate limit por rota — ver 1.2 sobre o hwid. |

---

## 6. O que o ERP ainda precisa saber

- **Cartão renova sozinho, PIX não.** Assinatura no Stripe cobra todo ciclo sem
  ação nenhuma. PIX é avulso: o cliente volta e paga de novo a cada período. A
  tela precisa dizer isso, senão quem pagou por PIX acha que está coberto.
- **Não existe webhook para o ERP.** Depois de pagar, ele descobre pelo
  `/erp/validar`, como sempre.
- **`valorCentavos` é a única fonte de preço.** Nada chumbado no ERP: o valor
  depende do plano daquela licença e muda quando o plano muda.
