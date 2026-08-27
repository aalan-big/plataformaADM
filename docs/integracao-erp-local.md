# Integração ERP Local ↔ Plataforma StartBig

**Documento de especificação técnica — o que o ERP local precisa enviar para a plataforma central**

URL base de produção: `https://api.startbig.com.br`

---

## 1. Visão geral do fluxo

O ERP local (instalado no computador/servidor do cliente, em qualquer lugar do mundo) se comunica com a plataforma central via HTTP/JSON pela internet. Não precisa estar na mesma rede — só precisa de acesso à internet até `api.startbig.com.br`.

Fluxo completo, na ordem:

```
1. AUTO-CADASTRO → ERP cria o cliente e recebe uma chave de ativação + token (só na 1ª instalação)
1b. LOGIN        → cliente já existente, sem chave salva localmente (reinstalação/troca de máquina)
2. CONECTAR      → ERP usa a chave para abrir uma sessão de uso (a cada login/abertura)
3. HEARTBEAT     → ERP avisa periodicamente "ainda estou ativo" (a cada poucos minutos)
4. VALIDAR       → ERP revalida a licença periodicamente (token expira, precisa renovar)
5. DESCONECTAR   → ERP avisa que encerrou a sessão (ao fechar o programa)
```

Todos os endpoints abaixo são **públicos** (não exigem login admin) — pensados para serem chamados pelo próprio ERP instalado na máquina do cliente.

---

## 2. Endpoint 1 — Auto-cadastro (primeiro contato)

Usado **uma única vez**, quando o ERP é instalado e ainda não existe cliente cadastrado na plataforma.

```
POST https://api.startbig.com.br/erp/auto-cadastro
Content-Type: application/json
```

### Campos obrigatórios

| Campo | Tipo | Descrição |
|---|---|---|
| `documento` | string | CPF (11 dígitos) ou CNPJ (14 dígitos), só números ou formatado — o sistema limpa automaticamente |
| `nomeOuRazao` | string | Nome completo (PF) ou Razão Social (PJ) |
| `email` | string | E-mail do cliente — será o "usuário" de login |
| `senha` | string | Senha de acesso (mínimo 8 caracteres). É gravada já no cadastro e usada depois em `/erp/auth/login` numa reinstalação/troca de máquina |

### Campos opcionais

| Campo | Tipo | Descrição |
|---|---|---|
| `hwid` | string | Identificador único da máquina/instalação (recomendado enviar sempre) |
| `rg` | string | Só para PF |
| `dataNascimento` | string (AAAA-MM-DD) | Só para PF |
| `nomeFantasia` | string | Só para PJ |
| `inscricaoEstadual` | string | Só para PJ |
| `inscricaoMunicipal` | string | Só para PJ |
| `regimeTributario` | string | Só para PJ |
| `telefone` | string | Só para PJ |
| `celular` | string | Só para PJ |
| `setorAtividade` | string | Só para PJ |
| `logo` | string | Só para PJ (URL ou base64) |
| `responsavel` | string | Só para PJ |
| `endereco` | objeto | Ver abaixo |

### Objeto `endereco` (opcional, mas se enviar precisa de tudo exceto complemento)

```json
{
  "cep": "00000-000",
  "logradouro": "Rua Exemplo",
  "numero": "123",
  "complemento": "Sala 1",
  "bairro": "Centro",
  "cidade": "Cidade",
  "estado": "UF"
}
```

### Exemplo de payload — Pessoa Jurídica

```json
{
  "documento": "12345678000199",
  "nomeOuRazao": "Empresa Exemplo LTDA",
  "email": "contato@empresa.com",
  "senha": "SenhaDoCliente123",
  "hwid": "PC-DESKTOP-ABC123",
  "nomeFantasia": "Empresa Exemplo",
  "telefone": "1133334444",
  "celular": "11999998888",
  "responsavel": "João da Silva",
  "endereco": {
    "cep": "01310-100",
    "logradouro": "Av. Paulista",
    "numero": "1000",
    "bairro": "Bela Vista",
    "cidade": "São Paulo",
    "estado": "SP"
  }
}
```

### O que a plataforma valida antes de aceitar

- CPF/CNPJ matematicamente válido
- Se for CNPJ: consulta a Receita Federal (via BrasilAPI) e confirma que está **ativo**
- E-mail e documento ainda não cadastrados no sistema

### Resposta de sucesso

```json
{
  "msg": "Auto-cadastro concluído com sucesso. Licença Trial de 14 dias gerada.",
  "clienteId": "uuid...",
  "licencaId": "uuid...",
  "chaveAtivacao": "XXXX-XXXX-XXXX-XXXX",
  "sessionKey": "PC-DESKTOP-ABC123",
  "limite": 1,
  "dataVencimento": "2026-06-30T00:00:00.000Z",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "ultimaSincronizacao": "2026-06-16T00:00:00.000Z",
  "gracePeriodDias": 7,
  "proximaValidacaoEm": "2026-06-17T00:00:00.000Z"
}
```

**Importante:** a `senha` enviada já é gravada no cadastro — o cliente **não** precisa criar senha por e-mail depois. Essa mesma senha (com o e-mail) é o que ele usará em `/erp/auth/login` caso reinstale o ERP. A `chaveAtivacao` retornada é o que o ERP deve **guardar localmente** — é ela que será usada em `conectar` e `validar` daqui pra frente.

Ganha automaticamente um **trial de 14 dias**, status `ATIVA`.

Se o `documento` ou `email` já estiverem cadastrados, esse endpoint retorna erro — nesse caso o ERP deve usar o **Login** (seção 3) em vez de auto-cadastro.

---

## 3. Endpoint 1b — Login (cliente já existente, sem chave salva)

Usado quando o ERP é **reinstalado** (mesma máquina reformatada ou máquina nova) e o cliente **já é cadastrado** na plataforma, mas o arquivo/config local com a `chaveAtivacao` foi perdido. Em vez de rodar o auto-cadastro de novo (que falharia, pois e-mail/documento já existem), o ERP pede e-mail e senha — a mesma senha que o cliente usa para entrar no painel `admin.startbig.com.br`.

```
POST https://api.startbig.com.br/erp/auth/login
Content-Type: application/json
```

### Campos

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `email` | string | ✅ | E-mail cadastrado do cliente |
| `senha` | string | ✅ | Senha de acesso ao painel |
| `hwid` | string | opcional | Identificador da nova máquina — recomendado sempre enviar |

```json
{
  "email": "contato@empresa.com",
  "senha": "SenhaDoCliente123",
  "hwid": "PC-DESKTOP-NOVO456"
}
```

### Resposta de sucesso

Igual à de `conectar` (seção 4), **acrescida de `chaveAtivacao`**:

```json
{
  "msg": "Conexão autorizada.",
  "licencaId": "uuid...",
  "sessionKey": "PC-DESKTOP-NOVO456",
  "limite": 1,
  "dataVencimento": "2026-06-30T00:00:00.000Z",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "chaveAtivacao": "XXXX-XXXX-XXXX-XXXX"
}
```

O ERP deve **guardar `chaveAtivacao` localmente**, exatamente como faria após o auto-cadastro — é ela que será usada em `validar`/`desconectar` daqui pra frente.

### Comportamento em caso de limite de dispositivos atingido

Diferente de `conectar` (que bloqueia com erro 400), o `login` **prova a identidade** do cliente via senha — então, se o limite de dispositivos simultâneos já estiver ocupado (ex.: sessão antiga de uma instalação anterior que nunca chamou `desconectar`), a plataforma **encerra automaticamente as sessões antigas** dessa licença e libera vaga para o novo dispositivo. O evento fica registrado no histórico da licença (auditoria) para o caso de precisar investigar compartilhamento indevido de conta.

### Erros possíveis

- `401` — e-mail ou senha incorretos
- `400` — cliente ainda não criou senha (`"Senha não configurada..."`) → deve ser orientado a checar o e-mail de primeiro acesso
- `400` — nenhuma licença ativa encontrada para esse e-mail

---

## 4. Endpoint 2 — Conectar (abrir sessão de uso)

Chamado a cada vez que o ERP é aberto / usuário faz login local **usando a chave já salva**.

```
POST https://api.startbig.com.br/erp/conectar
Content-Type: application/json
```

### Campos

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `chave` | string | ✅ | A `chaveAtivacao` recebida no auto-cadastro (ou no login) |
| `hwid` | string | opcional | Identificador da máquina — recomendado sempre enviar |

```json
{
  "chave": "XXXX-XXXX-XXXX-XXXX",
  "hwid": "PC-DESKTOP-ABC123"
}
```

### Resposta de sucesso

```json
{
  "msg": "Conexão autorizada.",
  "licencaId": "uuid...",
  "sessionKey": "PC-DESKTOP-ABC123",
  "limite": 1,
  "dataVencimento": "2026-06-30T00:00:00.000Z",
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "ultimaSincronizacao": "...",
  "gracePeriodDias": 7,
  "proximaValidacaoEm": "...",
  "diasRestantes": 23
}
```

Se a licença estiver bloqueada/suspensa/vencida ou o limite de dispositivos simultâneos for atingido, retorna erro (400) com a mensagem explicando o motivo — o ERP deve **bloquear o uso** localmente nesse caso. (Aqui, diferente do `login`, o limite atingido **não** libera vaga automaticamente — só a chave sozinha não prova identidade suficiente para isso. Se o cliente trocou de máquina e não tem mais acesso à instalação antiga, o caminho é usar `login` com e-mail/senha.)

`sessionKey` deve ser guardado: é o `hwid` a usar em `heartbeat` e `desconectar`.

---

## 5. Endpoint 3 — Heartbeat (sinal de vida periódico)

O ERP deve chamar isso **a cada poucos minutos** enquanto estiver em uso (recomendado: a cada 5–10 min). Se o servidor não receber heartbeat por **35 minutos**, a sessão é considerada morta e a vaga é liberada.

```
POST https://api.startbig.com.br/erp/heartbeat
Content-Type: application/json
```

### Campos

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `licencaId` | string (UUID) | ✅ | Recebido em `conectar` |
| `hwid` | string | opcional | A `sessionKey` recebida em `conectar` |
| `totalUsuarios` | number | opcional | Quantidade de usuários ativos no momento, se aplicável |

```json
{
  "licencaId": "uuid...",
  "hwid": "PC-DESKTOP-ABC123"
}
```

### Resposta

```json
{ "ok": true }
```

Se a licença foi bloqueada/suspensa pelo admin nesse meio tempo, retorna erro — o ERP deve **encerrar a sessão imediatamente**.

---

## 6. Endpoint 4 — Validar (revalidação da licença / renovar token)

O token (JWT) assinado tem validade curta (no máximo 7 dias, e geralmente recalculado para expirar perto do vencimento da licença). A resposta de `conectar`/`validar` traz `proximaValidacaoEm` — **o ERP deve chamar `validar` novamente antes dessa data/hora**, mesmo que o programa fique aberto o tempo todo.

```
POST https://api.startbig.com.br/erp/validar
Content-Type: application/json
```

### Campos

| Campo | Tipo | Obrigatório |
|---|---|---|
| `chave` | string | ✅ |
| `hwid` | string | opcional |

```json
{
  "chave": "XXXX-XXXX-XXXX-XXXX",
  "hwid": "PC-DESKTOP-ABC123"
}
```

### Resposta (licença válida)

```json
{
  "valida": true,
  "licencaId": "uuid...",
  "status": "ATIVA",
  "dataVencimento": "...",
  "token": "...",
  "ultimaSincronizacao": "...",
  "gracePeriodDias": 7,
  "proximaValidacaoEm": "...",
  "diasRestantes": 23
}
```

### Resposta (licença inválida)

```json
{ "valida": false, "motivo": "Licença vencida.", "status": "VENCIDA" }
```

Possíveis motivos: `Licença bloqueada`, `Licença suspensa`, `Licença revogada`, `Licença vencida`, `Licença não encontrada`.

**`diasRestantes`** — dias até o vencimento, recalculado a cada chamada. Vem em `conectar`, `validar` e `auto-cadastro`, para QUALQUER licença: paga, trial ou em carência. É o campo para exibir a contagem no menu do ERP.

Use ele em vez de calcular a partir de `dataVencimento` na máquina do cliente: o relógio do PC pode estar errado, e aí o lojista vê um número diferente do que o servidor considera. Mesma razão pela qual o ciclo de backup é calculado aqui e lido daí.

`null` = licença sem vencimento. `0` = venceu — o que não é o mesmo que bloqueada, que continua sendo o `status`.

**Grace period:** mesmo sem internet, o ERP pode continuar funcionando localmente por até **7 dias** usando o último token válido (verificado com a chave pública RSA — ver seção 9). Depois disso, exige nova validação online.

---

## 7. Endpoint 5 — Desconectar (encerrar sessão)

Chamado quando o usuário fecha o ERP / faz logout.

```
POST https://api.startbig.com.br/erp/desconectar
Content-Type: application/json
```

```json
{
  "chave": "XXXX-XXXX-XXXX-XXXX",
  "hwid": "PC-DESKTOP-ABC123"
}
```

### Resposta

```json
{ "msg": "Desconectado." }
```

Libera a vaga de dispositivo simultâneo para outro usuário/máquina.

---

## 8. Chave pública (validação offline do token)

```
GET https://api.startbig.com.br/erp/chave-publica
```

```json
{ "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
```

O ERP pode (e deve) baixar essa chave pública **uma vez** e guardá-la localmente. Com ela, consegue verificar a assinatura do `token` (JWT, algoritmo RS256) **sem precisar de internet** — é isso que permite o grace period de 7 dias funcionando offline.

O conteúdo (payload) do token contém: `licencaId`, `hwid`, `plano`, `limite`, `dataVencimento`, `ultimaSincronizacao`, `gracePeriodDias`, `proximaValidacaoEm`.

---

## 9. Resumo rápido — checklist para o seu amigo implementar no ERP

- [ ] Gerar um `hwid` único e estável por instalação (ex.: hash do serial da placa-mãe/disco)
- [ ] Na primeira execução sem chave salva → pedir e-mail + senha ao cliente e chamar `POST /erp/auto-cadastro` (a senha é obrigatória e fica gravada para o login futuro)
- [ ] Se `/erp/auto-cadastro` recusar por e-mail/documento já cadastrado (ex.: reinstalação) → pedir e-mail/senha e chamar `POST /erp/auth/login`
- [ ] Salvar `chaveAtivacao` localmente (arquivo de config / banco local) — vem no auto-cadastro **e** no login
- [ ] Ao abrir o programa → chamar `POST /erp/conectar` com a chave salva
- [ ] Enquanto o programa estiver aberto → chamar `POST /erp/heartbeat` a cada 5–10 min
- [ ] Respeitar o campo `proximaValidacaoEm` → chamar `POST /erp/validar` antes desse horário
- [ ] Ao fechar o programa → chamar `POST /erp/desconectar`
- [ ] Baixar e guardar a `chave-publica` para validar o token localmente quando estiver offline
- [ ] Se qualquer chamada retornar erro de licença bloqueada/suspensa/revogada/vencida → bloquear o uso do ERP imediatamente

---

## 10. Resumo de todos os endpoints

| Ação | Método | Rota | Quando chamar |
|---|---|---|---|
| Cadastrar cliente novo | POST | `/erp/auto-cadastro` | Uma vez, na instalação |
| Login (cliente já existente, sem chave local) | POST | `/erp/auth/login` | Reinstalação/troca de máquina, sem `chaveAtivacao` salva |
| Abrir sessão | POST | `/erp/conectar` | A cada abertura do ERP, com a chave já salva |
| Sinal de vida | POST | `/erp/heartbeat` | A cada 5–10 min, enquanto em uso |
| Revalidar licença | POST | `/erp/validar` | Antes de `proximaValidacaoEm` |
| Fechar sessão | POST | `/erp/desconectar` | Ao fechar o ERP |
| Obter chave pública | GET | `/erp/chave-publica` | Uma vez, guardar localmente |
| Consultar planos/preços | GET | `/erp/plano/:licencaId` | Antes de exibir opções de pagamento |
| Gerar cobrança (checkout) | POST | `/erp/cobranca` | Quando o cliente decide assinar/renovar |
| Situação do backup | GET | `/erp/backup/status` | Ao abrir a tela de backup |
| Pedir URL de upload | POST | `/erp/backup/url-upload` | Antes de cada envio de backup |
| Confirmar o envio | POST | `/erp/backup/confirmar` | Logo após o PUT, sempre |
| Pedir URL de restauração | POST | `/erp/backup/url-download` | Quando o usuário for restaurar |
| Emitir NF-e | POST | `/erp/fiscal/nfe/emitir` | Ao fechar uma venda que gera nota |
| Consultar NF-e | GET | `/erp/fiscal/nfe/consultar?ref=` | Para acompanhar `processando` até o status final |
| Cancelar NF-e | POST | `/erp/fiscal/nfe/cancelar` | Quando o usuário cancela uma nota autorizada |
| Cota fiscal do mês | GET | `/erp/fiscal/nfe/consumo` | Ao abrir a tela de emissão |

---

## 11. Cobrança e renovação (pagamento recorrente via Stripe)

> ### ⚠️ Existe um caminho mais novo — e é o recomendado
>
> As rotas desta seção continuam funcionando e **não vão mudar**. Mas elas têm
> duas limitações que o fluxo novo resolve:
>
> 1. **Só cartão.** Não oferecem PIX.
> 2. **Exigem `licencaId`** — que o `/erp/validar` *não devolve* quando a licença
>    está vencida. Ou seja: pelo caminho antigo, o cliente vencido não consegue
>    pagar, que é exatamente quem precisa.
>
> O fluxo novo (`/licenca/renovacao/*`) usa `chave` + `hwid` como credencial,
> funciona com a licença vencida, e oferece PIX e cartão lado a lado.
>
> **Documentação:** [`renovacao-contrato-resposta.md`](./renovacao-contrato-resposta.md)

Quando a licença está vencida (ou o trial acabou), o ERP pode oferecer a assinatura direto pela plataforma. O pagamento é uma **assinatura recorrente** no Stripe: o cliente paga uma vez e, a cada ciclo (mensal/trimestral/anual), o Stripe cobra o cartão automaticamente e a plataforma **renova a licença sozinha** — o ERP não precisa fazer nada na renovação, só continuar chamando `/erp/validar` normalmente (a `dataVencimento` já vem atualizada).

### 11.1 Consultar preços — `GET /erp/plano/:licencaId`

Retorna os dados do cliente/licença e as opções de período com o preço já calculado (descontos aplicados).

```
GET https://api.startbig.com.br/erp/plano/{licencaId}
```

Resposta:

```json
{
  "licencaId": "uuid...",
  "cliente":   { "nome": "Empresa Exemplo LTDA", "email": "contato@empresa.com" },
  "plano":     "Plano Pro",
  "status":    "VENCIDA",
  "dataVencimento": "2026-06-30T00:00:00.000Z",
  "opcoes": [
    { "meses": 1,  "label": "Mensal",     "total": 100.00, "desconto": 0    },
    { "meses": 3,  "label": "Trimestral", "total": 270.00, "desconto": 0.10 },
    { "meses": 12, "label": "Anual",      "total": 960.00, "desconto": 0.20 }
  ]
}
```

### 11.2 Gerar a cobrança — `POST /erp/cobranca`

Cria uma sessão de checkout do Stripe e devolve a URL de pagamento. O ERP deve **abrir essa URL no navegador** do cliente.

```
POST https://api.startbig.com.br/erp/cobranca
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `licencaId` | string (UUID) | ✅ | Licença a ser cobrada |
| `meses` | number (1, 3 ou 12) | ✅ | Período escolhido — define qual Price recorrente do Stripe será usado |

```json
{ "licencaId": "uuid...", "meses": 3 }
```

Resposta:

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "sessionId": "cs_test_..."
}
```

O cliente conclui o pagamento nessa `url`. A partir daí:

1. **1º pagamento** → a plataforma ativa/renova a licença na hora (webhook `checkout.session.completed`).
2. **Renovações seguintes** → o Stripe cobra automaticamente a cada ciclo e a plataforma estende a `dataVencimento` (webhook `invoice.payment_succeeded`). **Sem ação do ERP.**
3. Se o cliente **trocar de plano/período** gerando uma nova cobrança, a assinatura anterior é **cancelada automaticamente** para não cobrar duas vezes.

### 11.3 Como o ERP sabe que o cliente pagou

Não há webhook para o ERP. O ERP descobre pelo fluxo normal: depois do pagamento, a próxima chamada a **`/erp/validar`** (ou `/erp/conectar`) já retorna `status: "ATIVA"` com a nova `dataVencimento`. Recomendado: após abrir o checkout, o ERP pode fazer *polling* leve em `/erp/validar` (ex.: a cada 30–60s por alguns minutos) para detectar a ativação e liberar o uso.

### Erros possíveis

- `404` — licença ou plano não encontrado
- `400` — período inválido (use 1, 3 ou 12) ou o plano não tem `Stripe Price ID` cadastrado para aquele período

---

## 12. Backup em nuvem

O ERP empacota o banco local e as imagens, e sobe para a nuvem da plataforma. O ERP **nunca recebe credencial de nuvem** — ele pede uma URL assinada, sobe naquela URL e avisa que terminou.

### 12.1 O modelo: um arquivo, sobrescrito

Cada licença tem **um** `banco.zip` e **um** `imagens.zip` na nuvem — são espelhos, e o backup de hoje **substitui** o de ontem. Não há histórico de versões nem cópia de dias anteriores.

Além deles, **um `os-AAAA-MM.zip` por mês** de ordens de serviço. Esses acumulam: mês fechado sobe uma única vez e nunca mais é reenviado. Não é versionamento — é o acervo particionado, e restaurar OS é baixar todos os pedaços. Ver [`erp-backup-contrato.md`](./erp-backup-contrato.md), seção D.

Três consequências que precisam aparecer na tela do ERP:

1. **Só existe uma cópia para restaurar.** Se a tela mostrar uma lista de backups, o usuário vai achar que pode escolher qual restaurar. Só o último existe.
2. **Subir um banco corrompido apaga o bom.** Por isso a plataforma recusa envio **automático** de arquivo com menos da metade do tamanho do anterior (ver `BACKUP_TAMANHO_SUSPEITO`). O envio manual passa, porque nele existe uma pessoa confirmando. O ERP não deve tratar essa recusa como falha de rede e tentar de novo em looping.
3. **O ERP não escolhe o caminho do arquivo.** A plataforma decide, a partir do token. Não existe parâmetro de nome ou pasta.

### 12.1.1 O que entra em cada pacote

| Pacote | Conteúdo |
|---|---|
| `banco` | Exportação **gerada na hora** do banco local (`VACUUM INTO` + zip). Nunca a pasta de backups anteriores |
| `imagens` | Fotos e anexos que ficam em disco e não estão no banco |

E o que **não** deve subir, porque se regenera a partir do que já está no backup:

- Backups anteriores que o ERP tenha deixado em disco (fazer backup de backup estoura o limite de tamanho em pouco tempo)
- Exportações em Excel/CSV de tabelas do banco (produtos, clientes) — restaurando o banco, o ERP as gera de novo
- Recibos, pedidos e orçamentos não fiscais em PDF — montados a partir dos dados do banco
- DANFE em PDF — se regenera a partir do XML

> **Sobre o tamanho das imagens:** reduza a foto **no cadastro do produto**, não na
> hora do backup. Zip não comprime JPEG/PNG — uma foto de 4 MB continua ocupando 4 MB
> dentro do pacote, então compactar depois não resolve nada.
>
> Uma foto de produto a ~1200px e qualidade 80 fica em 100–200 KB e é indistinguível
> na tela. Salva assim, 3.000 produtos dão ~400 MB; salvas como vêm do celular, dão
> 12 GB — o backup estoura o limite de 500 MB e o disco do cliente também sofre.
> É a decisão que mais afeta o tamanho do pacote, e precisa ser tomada antes de
> existirem milhares de fotos em tamanho original.

> **Decisão sobre documento fiscal (26/07/2026):** o XML autorizado da NF-e/NFC-e/NFS-e
> **deve ser gravado dentro do banco de dados**, numa coluna da tabela de notas — não
> numa pasta em disco. Assim ele viaja no `banco.zip` automaticamente.
>
> Isso não é preferência de organização. O XML autorizado carrega assinatura digital e
> protocolo da SEFAZ: ele **não pode ser regenerado** a partir dos campos do banco, e a
> guarda é obrigação legal por anos. Se o módulo fiscal for construído gravando XML em
> pasta (padrão de várias bibliotecas fiscais), essa pasta passa a ser obrigatória no
> pacote `imagens` — caso contrário os documentos fiscais ficam **fora do backup** sem
> ninguém perceber, e isso só aparece numa fiscalização.

### 12.2 Autenticação

Todas as rotas desta seção usam o **token da licença** (JWT RS256) obtido em `/erp/conectar` ou `/erp/auth/login`:

```
Authorization: Bearer <token>
```

O `hwid` enviado no corpo precisa ser **o mesmo** que está dentro do token, senão a resposta é `403 BACKUP_HWID_DIVERGENTE`.

### 12.3 Formato de erro

Toda recusa vem assim:

```json
{
  "statusCode": 403,
  "path": "/erp/backup/url-upload",
  "message": "Backup em nuvem não está disponível durante o período de teste.",
  "codigo": "BACKUP_PLANO_INATIVO"
}
```

**Trate pelo `codigo`, nunca pelo texto.** A `message` é escrita para o usuário final e pode mudar; o `codigo` é contrato.

### 12.4 `GET /erp/backup/status`

Leitura pura — pode ser chamada sempre que a tela de backup abrir.

```
GET https://api.startbig.com.br/erp/backup/status
Authorization: Bearer <token>
```

```json
{
  "planoPermiteBackup": true,
  "motivoBloqueio": null,
  "codigoBloqueio": null,
  "limiteDiario":  { "banco": 2, "imagens": 2 },
  "enviadosHoje":  { "banco": 1, "imagens": 0 },
  "tamanhoMaximoBytes": 524288000,
  "copiaAtual": {
    "banco":   { "tamanhoBytes": 65536, "geradoEm": "2026-07-26T16:48:38.859Z", "hwid": "...", "chave": "...", "checksumSha256": "ee8f7504f2d54f37..." },
    "imagens": null
  },
  "historicoEventos": [
    { "tipo": "BANCO", "status": "CONFIRMADO", "origem": "AUTOMATICO",
      "tamanhoBytes": 65536, "hwid": "...", "emitidoEm": "...", "confirmadoEm": "...", "erro": null }
  ]
}
```

| Campo | Para que serve |
|---|---|
| `planoPermiteBackup` | Habilita ou desabilita a tela. **Não é a trava** — a trava é no servidor |
| `motivoBloqueio` | Texto pronto para **exibir**. Pode mudar de redação — não ramifique lógica nele |
| `codigoBloqueio` | O **contrato** para ramificar: `TRIAL`, `LICENCA_VENCIDA`, `LICENCA_SUSPENSA`, `LICENCA_REVOGADA`, `LICENCA_BLOQUEADA`, `LICENCA_AGUARDANDO`. `null` quando liberado |
| `enviadosHoje` / `limiteDiario` | Mostrar "1 de 2 backups usados hoje" |
| `copiaAtual` | O que existe **de verdade** na nuvem: no máximo um de cada |
| `copiaAtual.*.checksumSha256` | O checksum do que já está na nuvem. Compare com o seu **antes de zipar** e pule o trabalho todo quando nada mudou |
| `historicoEventos` | Registro do que aconteceu. **Não são arquivos baixáveis** — rotule como "backups realizados", nunca como lista de restauração |

### 12.5 `POST /erp/backup/url-upload`

```json
{
  "hwid": "PC-DESKTOP-ABC123",
  "tipo": "banco",
  "tamanhoBytes": 65536,
  "checksumSha256": "ee8f7504f2d54f37...",
  "origem": "AUTOMATICO"
}
```

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `hwid` | string | ✅ | Igual ao do token |
| `tipo` | `banco` \| `imagens` \| `os` | ✅ | |
| `periodo` | string `AAAA-MM` | ✅ em `os` | Mês do pedaço. **Proibido** nos outros dois. Não pode ser mês futuro |
| `tamanhoBytes` | int | ✅ | Entre 1.024 e 524.288.000 (500 MB). **Tamanho exato do arquivo** |
| `checksumSha256` | string hex | ✅ em `imagens` e `os` | Calcule sobre um **manifesto ordenado**, nunca sobre o zip. Opcional em `banco` |
| `origem` | `AUTOMATICO` \| `MANUAL` | não | Padrão `AUTOMATICO` |

**Resposta — precisa enviar:**

```json
{
  "acao": "ENVIAR",
  "uploadId": "fa0ae4f2-dafc-40d9-9a66-6f0e45a2dde0",
  "url": "https://<conta>.r2.cloudflarestorage.com/<bucket>/clientes/.../banco.zip?X-Amz-...",
  "chave": "clientes/<clienteId>/<licencaId>/banco.zip",
  "periodo": null,
  "metodo": "PUT",
  "headers": {
    "Content-Type": "application/zip",
    "Content-Length": "65536"
  },
  "expiraEm": "2026-07-26T16:58:38.859Z"
}
```

**Resposta — não precisa enviar nada:**

```json
{
  "acao": "PULAR",
  "motivo": "Nenhuma imagem mudou desde o último backup.",
  "chave": "clientes/.../imagens.zip",
  "ultimoEm": "2026-07-25T03:12:00.000Z"
}
```

`acao: "PULAR"` é **sucesso**, não erro. Acontece quando o `checksumSha256` é igual ao do último backup confirmado **do mesmo escopo** — em `os`, o mesmo mês. Mostre "backup em dia" e **não chame `/confirmar`**. É o que evita subir fotos todo dia sem nada ter mudado.

**Em `os` o `PULAR` é a regra, não a exceção.** Depois do primeiro envio, todo mês fechado responde `PULAR` para sempre — é exatamente assim que a partição economiza. Trate como sucesso silencioso, sem alarme na tela.

> **Nos espelhos, uma vez por semana o `PULAR` não vem mesmo sem nada ter mudado.** Se o último `imagens` confirmado tiver mais de 7 dias, a plataforma manda `acao: "ENVIAR"` de qualquer forma. Não é bug: é a rede de proteção contra um `checksumSha256` calculado errado, que ficaria igual para sempre e congelaria as imagens no primeiro envio sem ninguém perceber.
>
> **Pedaço de OS de mês fechado não tem essa rede**, e é de propósito: ali o conteúdo é imutável de verdade, então checksum igual significa mesmo "nada mudou". Forçar reenvio semanal devolveria o custo que a partição existe para eliminar.

### 12.6 O upload

```
PUT <url que veio na resposta>
Content-Type: application/zip
Content-Length: <exatamente o tamanhoBytes que você declarou>

<bytes do arquivo>
```

Três regras que quebram o upload se ignoradas:

1. **O `Content-Length` faz parte da assinatura.** Um byte de diferença entre o que você declarou e o que envia resulta em `403 SignatureDoesNotMatch`. Calcule o tamanho **depois** de fechar o zip, nunca antes.
2. **Envie os dois headers** exatamente como vieram em `headers`.
3. **A URL vale 30 minutos.** O relógio começa na resposta do `url-upload`, não no início do `PUT` — peça a URL imediatamente antes de enviar. Expirou, peça outra: aí sim consome uma nova vaga da cota diária. Dentro da validade, repetir o `PUT` na **mesma** URL não custa vaga nenhuma.

Não mande `Authorization` nesse PUT: a autenticação está na própria URL assinada.

### 12.7 `POST /erp/backup/confirmar`

Chame **sempre** depois do PUT, tanto no sucesso quanto na falha.

```json
{
  "uploadId": "fa0ae4f2-dafc-40d9-9a66-6f0e45a2dde0",
  "hwid": "PC-DESKTOP-ABC123",
  "ok": true,
  "tamanhoBytes": 65536
}
```

Em caso de falha, `"ok": false` e opcionalmente `"erro": "descrição curta"`.

```json
{ "confirmado": true, "uploadId": "...", "tamanhoBytes": 65536, "confirmadoEm": "..." }
```

A plataforma **não acredita** no `ok: true`: ela consulta o arquivo no bucket e compara o tamanho antes de registrar. Se você reportar sucesso de um upload que não chegou, a resposta é `409 BACKUP_ARQUIVO_AUSENTE` — e é isso que impede o painel de mostrar "backup em dia" para arquivo inexistente.

### 12.8 `POST /erp/backup/url-download`

```json
{ "hwid": "PC-DESKTOP-ABC123", "tipo": "banco" }
```

A resposta é sempre uma **lista**, mesmo quando há um arquivo só. Em `banco` e `imagens` vem um item com `periodo: null`; em `os` vêm **todos** os meses de uma vez.

```json
{
  "tipo": "os",
  "arquivos": [
    { "periodo": "2026-05", "url": "https://...", "chave": "clientes/.../os-2026-05.zip",
      "tamanhoBytes": 48234496, "geradoEm": "2026-06-01T03:10:00.000Z" },
    { "periodo": "2026-06", "url": "https://...", "chave": "clientes/.../os-2026-06.zip",
      "tamanhoBytes": 51201024, "geradoEm": "2026-07-01T03:10:00.000Z" }
  ],
  "indisponiveis": [],
  "totalBytes": 99435520,
  "expiraEm": "2026-07-26T16:53:38.859Z"
}
```

URLs válidas por **5 minutos**, e `expiraEm` é a primeira que vence. Mesmo gate do upload: licença em teste ou vencida não baixa.

**Acervo grande não cabe em 5 minutos, e isso é intencional.** Em vez de esticar a validade de um link que entrega o banco inteiro do cliente, baixe o que der e **chame de novo** para o que faltar — `url-download` é leitura pura e não tem cota diária.

**`indisponiveis` não pode ser ignorado.** Lista vazia é o caso normal; qualquer item ali é um pedaço que consta no registro mas sumiu do bucket, e a restauração vai sair com buraco. Avise o usuário **antes** de restaurar.

### 12.9 Códigos de erro

| Código | HTTP | O que o ERP deve fazer |
|---|---|---|
| `BACKUP_PLANO_INATIVO` | 403 | Desabilitar a tela e exibir `message`. **Não repetir** |
| `BACKUP_LIMITE_DIARIO` | 429 | Avisar que a cota acabou. **Não repetir hoje** |
| — | — | *Upload que falhou **não** consome a cota, desde que o ERP reporte pelo `/confirmar` com `ok: false`. Se o ERP travar sem reportar, a vaga só volta quando o cron marca a linha como falha — **até ~70 min** (60 de carência + o intervalo de 10 min do cron), não quando a URL expira. É o principal motivo para sempre chamar `/confirmar`* |
| `BACKUP_TAMANHO_SUSPEITO` | 409 | Só acontece com `origem: "AUTOMATICO"`. Avisar o usuário que o arquivo encolheu muito e oferecer o botão de backup manual, que reenvia com `origem: "MANUAL"` e passa. **Nunca reenviar sozinho como MANUAL** — isso anularia a proteção |
| `BACKUP_LIMITE_BACKFILL` | 429 | A cota de meses antigos acabou hoje. **Pare o laço do backfill** — continua amanhã de onde parou, nenhum mês é perdido |
| `BACKUP_PERIODO_FUTURO` | 400 | Bug do ERP: só envie até o `periodoCorrente` que veio no `/status` |
| `BACKUP_HWID_DIVERGENTE` | 403 | Bug do ERP: use o `hwid` do token |
| `BACKUP_CHECKSUM_OBRIGATORIO` | 400 | Bug do ERP: calcule o checksum antes de pedir URL de `imagens` ou `os` |
| `BACKUP_DADOS_INVALIDOS` | 400 | Tamanho fora da faixa ou campo faltando. Ver `detalhes` |
| `BACKUP_ARQUIVO_AUSENTE` | 409 | O upload não chegou. Refazer o ciclo do início |
| `BACKUP_TAMANHO_DIVERGENTE` | 409 | O que chegou tem tamanho diferente. Refazer o ciclo |
| `BACKUP_INEXISTENTE` | 404 | Não há backup para restaurar |
| `BACKUP_NAO_CONFIGURADO` | 503 | Problema na plataforma, não no ERP. Tentar mais tarde |
| `BACKUP_LICENCA_NAO_ENCONTRADA` | 404 | Token de licença que não existe mais |

### 12.10 Checklist de implementação

- [ ] Empacotar o banco com `VACUUM INTO` (nunca copiar o arquivo com o banco aberto) e comprimir
- [ ] Incluir um `manifest.json` dentro do zip: versão do ERP, versão do schema local, data/hora, e o SHA-256 e tamanho de cada arquivo
- [ ] Medir o tamanho **do zip finalizado** (é ele que vai no `Content-Length` assinado)
- [ ] Calcular o `checksumSha256` sobre um **manifesto ordenado do conteúdo**, nunca sobre o zip — zip não é determinístico e o dedupe nunca dispararia
- [ ] Separar as fotos: catálogo de produtos em `imagens`, ordens de serviço em `os` agrupadas por mês
- [ ] Ler `periodoCorrente` do `/status` — **nunca** calcular o mês localmente
- [ ] `GET /status` ao abrir a tela → se `planoPermiteBackup: false`, desabilitar e exibir `motivoBloqueio` (ramificar pelo `codigoBloqueio`)
- [ ] Comparar `copiaAtual.os[].checksumSha256` com o local **antes de zipar** — economiza o trabalho todo
- [ ] Backfill: subir os meses fechados que faltam, parando no `429 BACKUP_LIMITE_BACKFILL`
- [ ] `POST /url-upload` → tratar `acao: "PULAR"` como sucesso (em `os` é o caso comum)
- [ ] `PUT` com `Content-Length` exato
- [ ] `POST /confirmar` sempre, inclusive com `ok: false`
- [ ] Reconciliação na inicialização: pendência com mais de 1 h é limpeza local, sem chamar a API
- [ ] Restauração de `os`: baixar **todos** os pedaços, e avisar o usuário se `indisponiveis` não vier vazio
- [ ] Tratar cada erro pelo `codigo`, nunca pelo texto
- [ ] Não repetir automaticamente em `403`, `429` ou `409`
- [ ] Na tela: "backups realizados" (histórico) separado do que existe para restaurar

---


---

## 13. Módulos e emissão fiscal (NF-e)

### 13.1. O que são módulos

Cada licença enxerga um conjunto de **módulos** liberados. A lista vem do plano contratado, mais o que tenha sido contratado à parte, e viaja **dentro do JWT assinado** — junto com `limite` e `dataVencimento`.

Cada tipo de documento fiscal é um módulo próprio, com cota própria:

| Identificador | Documento | Situação |
|---|---|---|
| `NFE` | Nota Fiscal Eletrônica (mercadoria) | disponível |
| `NFCE` | Nota Fiscal de Consumidor Eletrônica | planejado |
| `NFSE` | Nota Fiscal de Serviço Eletrônica | planejado |

São separados porque atendem clientes diferentes — quem vende mercadoria não emite NFS-e, e quem presta serviço não emite NFC-e. Um cliente pode ter um, dois ou os três, e cada um conta a própria cota: emitir NFC-e **não** consome a cota de NF-e.

Está no token assinado de propósito: é um campo que libera acesso, e campo que libera acesso não pode trafegar fora da assinatura, senão vira o único elo forjável entre a API e o ERP.

```json
{
  "licencaId": "uuid...",
  "limite": 3,
  "dataVencimento": "...",
  "modulos": ["NFCE", "NFE"]
}
```

> ⚠️ **Regra obrigatória: claim ausente = libera tudo.**
>
> Um token emitido antes desta versão não tem o campo `modulos`. Um ERP que faça
> `if (payload.modulos.Contains("NFE"))` vai ler nulo e **esconder o menu de um
> cliente que paga**, sem erro aparecendo em lugar nenhum. Trate a ausência do
> campo como "pode tudo", nunca como lista vazia:
>
> ```csharp
> // Lista ausente = token antigo = libera. Lista presente e sem o módulo = bloqueia.
> bool temModulo(string m) => payload.modulos == null || payload.modulos.Contains(m);
> ```
>
> Lista **presente e vazia** é diferente de ausente: significa "nenhum módulo liberado".

A lista é reavaliada a cada `validar`. Uma mudança feita no painel aparece para o cliente na próxima revalidação — em até 24 h, não na hora. Não guarde os módulos em disco separado do token: quem manda é sempre o token corrente.

### 13.2. Emitir NF-e

Todas as rotas de `/erp/fiscal/*` exigem o header `Authorization: Bearer <token>` com o JWT da licença.

```
POST https://api.startbig.com.br/erp/fiscal/nfe/emitir
Authorization: Bearer <token>
Content-Type: application/json
```

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `ref` | string | ✅ | Sua referência da nota. Só `A–Z a–z 0–9 . _ -`, máx. 50 caracteres |
| `payload` | objeto | ✅ | Dados da NF-e (emitente, destinatário, itens, totais) |

A `ref` é a **chave de idempotência**: ela é consultada na Focus antes de emitir. Reenviar a mesma `ref` devolve a nota que já existe em vez de emitir outra. Use um valor estável e único por nota (o número do seu pedido, por exemplo) — nunca um valor novo a cada tentativa, senão a idempotência não protege nada.

O `payload.emitente.cnpj` **precisa ser o CNPJ configurado para esta licença**. Não é o ERP que escolhe com qual empresa emite: o servidor usa o token da Focus vinculado à licença, e recusa se os dois não baterem.

```json
{
  "status": "autorizado",
  "chave_acesso": "3526...",
  "protocolo": "135260...",
  "numero": 1234,
  "serie": 1,
  "url_pdf": "https://.../danfe.pdf",
  "url_xml": "https://.../nota.xml",
  "codigo_sefaz": 100,
  "mensagem_sefaz": "Autorizado o uso da NF-e"
}
```

Valores de `status`: `autorizado`, `processando`, `cancelado`, `erro`.

`processando` **não é falha** — a nota entrou na fila da SEFAZ. Consulte a mesma `ref` depois para pegar o status final.

### 13.3. Consultar e cancelar

```
GET  /erp/fiscal/nfe/consultar?ref=PEDIDO-1234
POST /erp/fiscal/nfe/cancelar     { "ref": "...", "justificativa": "..." }
```

A `justificativa` exige no mínimo 15 caracteres — é regra da SEFAZ, não nossa.

### 13.4. Cota mensal

Planos podem ter teto de notas por mês. Quem consulta:

```
GET /erp/fiscal/nfe/consumo
```

```json
{
  "competencia": "2026-08",
  "emitidas": 78,
  "canceladas": 2,
  "cotaPlano": 100,
  "cotaExtra": 0,
  "cota": 100,
  "restantes": 22,
  "ilimitado": false
}
```

Regras que valem a pena conhecer antes de montar a tela:

- **`ilimitado: true` significa sem teto.** Não mostre "0 restantes" nesse caso — `restantes` vem `null`.
- **Emissão em homologação (`ambiente: 2`) não consome cota.** O cliente testar a integração não pode gastar o pacote dele.
- **Nota rejeitada não conta.** Só `autorizado` e `processando` entram no contador.
- **Cancelar não devolve cota.** A nota chegou a existir na SEFAZ.
- **A competência vira no fuso de São Paulo**, não em UTC.

Esta rota é **conveniência, não trava**: sirva para avisar o operador antes dele preencher a nota inteira. Quem barra de verdade é o `emitir`, no servidor — o ERP não precisa (e não deve) tentar controlar isso sozinho.

### 13.5. Erros

| HTTP | Quando | O que fazer |
|---|---|---|
| `401` | Token ausente, inválido ou expirado | Chamar `validar` e repetir |
| `403` | Licença não tem o módulo do documento (`NFE`, `NFCE`, `NFSE`) | Esconder a função. Não repetir |
| `402` | Cota do mês esgotada | Avisar o operador. **Não repetir** — só resolve com virada do mês ou concessão do admin |
| `404` | Cliente sem configuração fiscal cadastrada | Avisar que falta configurar. Não repetir |
| `400` | Dados inválidos, ou CNPJ do emitente não confere | Corrigir. Não repetir sem mudar o corpo |
| `503` | Não foi possível confirmar na Focus se a nota já existe | **Nenhuma nota foi emitida.** Repetir com a MESMA `ref` |
| `502` | Focus fora do ar ou sem resposta | Repetir com a MESMA `ref` |

> ⚠️ **Em `502` e `503`, reenvie sempre com a mesma `ref`.** Gerar uma `ref` nova
> na repetição é o caminho para a nota duplicada — e nota duplicada não se
> resolve com atualização, se resolve com contador e SEFAZ.

### 13.6. Checklist para o ERP

- [ ] Ler `modulos` do JWT, tratando **ausência como "libera tudo"**
- [ ] Reavaliar os módulos a cada `validar`, sem cache próprio em disco
- [ ] Usar uma `ref` estável por nota, e **reusá-la** em toda repetição
- [ ] Conferir que o CNPJ do emitente é o da licença antes de enviar
- [ ] Tratar `processando` como sucesso, com consulta posterior
- [ ] Chamar `/consumo` ao abrir a tela de emissão, e esconder o aviso quando `ilimitado`
- [ ] Tratar cada erro pelo código HTTP, nunca pelo texto da mensagem
- [ ] Não repetir automaticamente em `400`, `402`, `403` ou `404`

---

*Seção 13 (módulos e emissão fiscal) adicionada em 27/08/2026. As rotas fiscais existem no servidor; a trava por módulo (`403`) só passa a valer quando `ENTITLEMENTS_ENFORCE` for ligado em produção — até lá, licença sem o módulo continua emitindo normalmente.*
