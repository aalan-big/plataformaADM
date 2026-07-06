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
| `email` | string | E-mail do cliente — é para onde vai a senha de primeiro acesso |

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

**Importante:** depois do cadastro, a plataforma envia automaticamente um e-mail para o cliente criar a senha de acesso ao painel. A `chaveAtivacao` retornada é o que o ERP deve **guardar localmente** — é ela que será usada em `conectar` e `validar` daqui pra frente.

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
POST https://api.startbig.com.br/licenca/conectar
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
POST https://api.startbig.com.br/licenca/heartbeat
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
POST https://api.startbig.com.br/licenca/validar
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
POST https://api.startbig.com.br/licenca/desconectar
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
GET https://api.startbig.com.br/licenca/chave-publica
```

```json
{ "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
```

O ERP pode (e deve) baixar essa chave pública **uma vez** e guardá-la localmente. Com ela, consegue verificar a assinatura do `token` (JWT, algoritmo RS256) **sem precisar de internet** — é isso que permite o grace period de 7 dias funcionando offline.

O conteúdo (payload) do token contém: `licencaId`, `hwid`, `plano`, `limite`, `dataVencimento`, `ultimaSincronizacao`, `gracePeriodDias`, `proximaValidacaoEm`.

---

## 9. Resumo rápido — checklist para o seu amigo implementar no ERP

- [ ] Gerar um `hwid` único e estável por instalação (ex.: hash do serial da placa-mãe/disco)
- [ ] Na primeira execução sem chave salva → chamar `POST /erp/auto-cadastro`
- [ ] Se `/erp/auto-cadastro` recusar por e-mail/documento já cadastrado (ex.: reinstalação) → pedir e-mail/senha e chamar `POST /erp/auth/login`
- [ ] Salvar `chaveAtivacao` localmente (arquivo de config / banco local) — vem no auto-cadastro **e** no login
- [ ] Ao abrir o programa → chamar `POST /licenca/conectar` com a chave salva
- [ ] Enquanto o programa estiver aberto → chamar `POST /licenca/heartbeat` a cada 5–10 min
- [ ] Respeitar o campo `proximaValidacaoEm` → chamar `POST /licenca/validar` antes desse horário
- [ ] Ao fechar o programa → chamar `POST /licenca/desconectar`
- [ ] Baixar e guardar a `chave-publica` para validar o token localmente quando estiver offline
- [ ] Se qualquer chamada retornar erro de licença bloqueada/suspensa/revogada/vencida → bloquear o uso do ERP imediatamente

---

## 10. Resumo de todos os endpoints

| Ação | Método | Rota | Quando chamar |
|---|---|---|---|
| Cadastrar cliente novo | POST | `/erp/auto-cadastro` | Uma vez, na instalação |
| Login (cliente já existente, sem chave local) | POST | `/erp/auth/login` | Reinstalação/troca de máquina, sem `chaveAtivacao` salva |
| Abrir sessão | POST | `/licenca/conectar` | A cada abertura do ERP, com a chave já salva |
| Sinal de vida | POST | `/licenca/heartbeat` | A cada 5–10 min, enquanto em uso |
| Revalidar licença | POST | `/licenca/validar` | Antes de `proximaValidacaoEm` |
| Fechar sessão | POST | `/licenca/desconectar` | Ao fechar o ERP |
| Obter chave pública | GET | `/licenca/chave-publica` | Uma vez, guardar localmente |

---

*Documento gerado a partir do código-fonte da plataforma (`apps/server/src/features/dispositivos` e `apps/server/src/features/erp`) em 16/06/2026. Seção de login/reinstalação adicionada em 06/07/2026.*
