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
  "proximaValidacaoEm": "..."
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
  "proximaValidacaoEm": "..."
}
```

### Resposta (licença inválida)

```json
{ "valida": false, "motivo": "Licença vencida.", "status": "VENCIDA" }
```

Possíveis motivos: `Licença bloqueada`, `Licença suspensa`, `Licença revogada`, `Licença vencida`, `Licença não encontrada`.

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

---

## 11. Cobrança e renovação (pagamento recorrente via Stripe)

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

Cada licença tem **um** `banco.zip` e **um** `imagens.zip` na nuvem. O backup de hoje **substitui** o de ontem. Não há histórico de versões nem cópia de dias anteriores.

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
| `tipo` | `banco` \| `imagens` | ✅ | |
| `tamanhoBytes` | int | ✅ | Entre 1.024 e 524.288.000 (500 MB). **Tamanho exato do arquivo** |
| `checksumSha256` | string hex | ✅ em `imagens` | SHA-256 do zip. Opcional em `banco`, obrigatório em `imagens` |
| `origem` | `AUTOMATICO` \| `MANUAL` | não | Padrão `AUTOMATICO` |

**Resposta — precisa enviar:**

```json
{
  "acao": "ENVIAR",
  "uploadId": "fa0ae4f2-dafc-40d9-9a66-6f0e45a2dde0",
  "url": "https://<conta>.r2.cloudflarestorage.com/<bucket>/clientes/.../banco.zip?X-Amz-...",
  "chave": "clientes/<clienteId>/<licencaId>/banco.zip",
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

`acao: "PULAR"` é **sucesso**, não erro. Acontece quando o `checksumSha256` de `imagens` é igual ao do último backup confirmado. Mostre "backup em dia" e **não chame `/confirmar`**. É o que evita subir 150 MB de fotos todo dia sem nada ter mudado.

> **Uma vez por semana o `PULAR` não vem, mesmo sem nada ter mudado.** Se o último backup de imagens confirmado tiver mais de 7 dias, a plataforma manda `acao: "ENVIAR"` de qualquer forma e o ERP deve subir o pacote completo. Isso não é bug: é a rede de proteção contra um `checksumSha256` calculado errado, que ficaria igual para sempre e congelaria as imagens no primeiro envio sem ninguém perceber.

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

```json
{
  "url": "https://...",
  "chave": "clientes/.../banco.zip",
  "tamanhoBytes": 65536,
  "geradoEm": "2026-07-26T16:48:38.859Z",
  "expiraEm": "2026-07-26T16:53:38.859Z"
}
```

URL de download válida por **5 minutos**. Mesmo gate do upload: licença em teste ou vencida não baixa.

### 12.9 Códigos de erro

| Código | HTTP | O que o ERP deve fazer |
|---|---|---|
| `BACKUP_PLANO_INATIVO` | 403 | Desabilitar a tela e exibir `message`. **Não repetir** |
| `BACKUP_LIMITE_DIARIO` | 429 | Avisar que a cota acabou. **Não repetir hoje** |
| — | — | *Upload que falhou **não** consome a cota, desde que o ERP reporte pelo `/confirmar` com `ok: false`. Se o ERP travar sem reportar, a vaga só volta quando o cron marca a linha como falha — **até ~70 min** (60 de carência + o intervalo de 10 min do cron), não quando a URL expira. É o principal motivo para sempre chamar `/confirmar`* |
| `BACKUP_TAMANHO_SUSPEITO` | 409 | Só acontece com `origem: "AUTOMATICO"`. Avisar o usuário que o arquivo encolheu muito e oferecer o botão de backup manual, que reenvia com `origem: "MANUAL"` e passa. **Nunca reenviar sozinho como MANUAL** — isso anularia a proteção |
| `BACKUP_HWID_DIVERGENTE` | 403 | Bug do ERP: use o `hwid` do token |
| `BACKUP_CHECKSUM_OBRIGATORIO` | 400 | Bug do ERP: calcule o SHA-256 antes de pedir URL de imagens |
| `BACKUP_DADOS_INVALIDOS` | 400 | Tamanho fora da faixa ou campo faltando. Ver `detalhes` |
| `BACKUP_ARQUIVO_AUSENTE` | 409 | O upload não chegou. Refazer o ciclo do início |
| `BACKUP_TAMANHO_DIVERGENTE` | 409 | O que chegou tem tamanho diferente. Refazer o ciclo |
| `BACKUP_INEXISTENTE` | 404 | Não há backup para restaurar |
| `BACKUP_NAO_CONFIGURADO` | 503 | Problema na plataforma, não no ERP. Tentar mais tarde |
| `BACKUP_LICENCA_NAO_ENCONTRADA` | 404 | Token de licença que não existe mais |

### 12.10 Checklist de implementação

- [ ] Empacotar o banco com `VACUUM INTO` (nunca copiar o arquivo com o banco aberto) e comprimir
- [ ] Incluir um `manifest.json` dentro do zip: versão do ERP, versão do schema local, data/hora, e o SHA-256 e tamanho de cada arquivo
- [ ] Calcular o `sha256` e o tamanho **do zip finalizado**
- [ ] `GET /status` ao abrir a tela → se `planoPermiteBackup: false`, desabilitar e exibir `motivoBloqueio`
- [ ] `POST /url-upload` → tratar `acao: "PULAR"` como sucesso
- [ ] `PUT` com `Content-Length` exato
- [ ] `POST /confirmar` sempre, inclusive com `ok: false`
- [ ] Tratar cada erro pelo `codigo`, nunca pelo texto
- [ ] Não repetir automaticamente em `403`, `429` ou `409`
- [ ] Na tela: "backups realizados" (histórico) separado de "cópia disponível para restaurar" (uma só)

---

*Documento gerado a partir do código-fonte da plataforma (`apps/server/src/features/dispositivos` e `apps/server/src/features/erp`) em 16/06/2026. Seção de login/reinstalação adicionada em 06/07/2026. Seção de cobrança/renovação recorrente adicionada em 11/07/2026. Seção de backup em nuvem adicionada em 26/07/2026, validada ponta a ponta em produção.*
