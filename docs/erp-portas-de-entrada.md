# Portas de entrada — o que o ERP local precisa chamar

Documento de partida para quem vai programar o lado do ERP. Lista **todas** as rotas que o ERP usa, em que momento cada uma entra, e o que precisa ser guardado na máquina do cliente.

Os payloads campo a campo estão em [`integracao-erp-local.md`](./integracao-erp-local.md) — este aqui é o mapa; aquele é o detalhe.

---

## 1. Endereço e autenticação

**Base:** `https://api.startbig.com.br`

Existem **dois tipos de credencial**, e confundir os dois é o erro mais comum:

| Tipo | O que é | Onde se usa |
|---|---|---|
| **Nenhuma** | rota aberta | Cadastro, login, conexão, heartbeat, validação, cobrança |
| **Token de licença** | JWT RS256 devolvido por `/erp/conectar` ou `/erp/auth/login`, enviado como `Authorization: Bearer <token>` | Perfil do usuário e backup |

O token tem validade curta (no máximo 7 dias, e menos se a licença vencer antes). A resposta traz `proximaValidacaoEm` — o ERP deve renovar antes dessa hora chamando `/erp/validar`.

> **Sobre `/licenca/*`:** as rotas de conexão existem em dois caminhos — `/erp/conectar` e `/licenca/conectar`, por exemplo. São **a mesma coisa**, atendidas pelo mesmo código. Use `/erp/*` em tudo: é um namespace só, e é onde estão as rotas mais novas (auth, usuário, backup). O caminho `/licenca/*` é compartilhado com o painel administrativo.

---

## 2. A ordem das coisas

### Primeira execução, máquina nova

```
1. GET  /erp/chave-publica        → guardar a chave RSA em disco (uma vez só)
2. POST /erp/auto-cadastro        → cria cliente + licença, devolve chaveAtivacao
   └─ se responder "já cadastrado" (reinstalação):
      POST /erp/auth/login        → e-mail + senha, devolve chaveAtivacao
3. Salvar a chaveAtivacao localmente
```

### Toda vez que o ERP abre

```
4. POST /erp/conectar             → abre sessão, devolve o token da licença
```

### Enquanto estiver aberto

```
5. POST /erp/heartbeat            → a cada 5–10 min
6. POST /erp/validar              → antes de proximaValidacaoEm (renova o token)
```

### Ao fechar

```
7. POST /erp/desconectar          → libera a vaga de dispositivo
```

### Quando a licença vence ou o cliente quer assinar

```
8. GET  /erp/plano/:licencaId     → preços por período
9. POST /erp/cobranca             → devolve URL do checkout Stripe
   └─ depois disso, /erp/validar volta com status ATIVA (sem webhook para o ERP)
```

### Backup (diário, em segundo plano)

```
10. GET  /erp/backup/status       → o plano libera? quanto de cota sobrou?
11. POST /erp/backup/url-upload   → devolve URL assinada (ou acao: PULAR)
12. PUT  <a URL assinada>         → sobe o arquivo direto no bucket
13. POST /erp/backup/confirmar    → sempre, mesmo quando falha
```

---

## 3. Todas as rotas

### Sem autenticação

| Método | Rota | Quando chamar |
|---|---|---|
| `GET` | `/erp/chave-publica` | Uma vez, na instalação. Permite validar o token offline |
| `POST` | `/erp/auto-cadastro` | Primeira execução, cliente novo. Exige senha |
| `POST` | `/erp/auth/login` | Reinstalação ou troca de máquina, sem chave salva |
| `POST` | `/erp/auth/primeiro-acesso` | Definir senha usando o token que chega por e-mail |
| `POST` | `/erp/conectar` | Toda abertura do ERP, com a chave salva |
| `POST` | `/erp/heartbeat` | A cada 5–10 min, enquanto aberto |
| `POST` | `/erp/validar` | Antes de `proximaValidacaoEm` |
| `POST` | `/erp/desconectar` | Ao fechar o ERP |
| `GET` | `/erp/plano/:licencaId` | Antes de exibir opções de pagamento |
| `POST` | `/erp/cobranca` | Quando o cliente decide assinar ou renovar |

### Com token de licença

| Método | Rota | Quando chamar |
|---|---|---|
| `GET` | `/erp/usuario/dados` | Tela de perfil |
| `POST` | `/erp/usuario/alterar-senha` | Troca de senha |
| `POST` | `/erp/usuario/solicitar-novo-email` | Troca de e-mail (confirma por link) |
| `GET` | `/erp/backup/status` | Ao abrir a tela de backup |
| `POST` | `/erp/backup/url-upload` | Antes de cada envio |
| `POST` | `/erp/backup/confirmar` | Depois de cada envio, **sempre** |
| `POST` | `/erp/backup/url-download` | Restauração |

### Fora da API

| Método | Destino | Observação |
|---|---|---|
| `PUT` | URL assinada devolvida por `url-upload` | Vai direto ao bucket. Sem `Authorization` — a credencial está na própria URL |
| `GET` | URL assinada devolvida por `url-download` | Idem |

---

## 4. O que o ERP guarda na máquina

| Item | Por quê |
|---|---|
| `chaveAtivacao` | Sem ela, toda abertura vira login com e-mail e senha |
| Chave pública RSA | Valida o token sem internet — é o que sustenta o período de tolerância de 7 dias |
| Último token + `proximaValidacaoEm` | Permite trabalhar offline até a data-limite |
| `hwid` estável | Identifica a instalação. Precisa sobreviver a reinício e atualização |

O `hwid` deve ser derivado de algo fixo da máquina (serial da placa-mãe, do disco). Se ele mudar sozinho, o cliente ocupa duas vagas de dispositivo e o backup passa a recusar por HWID divergente.

---

## 5. Regras que quebram a integração se ignoradas

**Trate erro pelo campo `codigo`, nunca pelo texto.** As mensagens são escritas para o usuário final e podem mudar; o `codigo` é contrato.

**Nunca repita automaticamente em `403`, `429` ou `409`.** São recusas por regra de negócio, não falha de rede. Repetir vira loop.

**`acao: "PULAR"` é sucesso.** Vem quando o backup de imagens não mudou. Exiba "backup em dia" e não chame `/confirmar`.

**No `PUT`, o `Content-Length` faz parte da assinatura.** Calcule o tamanho **depois** de fechar o zip. Um byte de diferença dá `403 SignatureDoesNotMatch`, que não parece erro de tamanho.

**Chame `/erp/backup/confirmar` mesmo quando o upload falhar** (`ok: false`). É isso que devolve a vaga da cota diária — sem essa chamada, uma queda de internet consome o backup do dia.

**Só existe uma cópia de cada backup na nuvem.** O envio de hoje sobrescreve o de ontem. Se a tela mostrar uma lista de envios, deixe claro que é histórico de eventos, não escolha de restauração.

---

## 6. Antes de programar o backup, decidir

Três coisas do lado do ERP que definem se o backup funciona bem ou mal, detalhadas na seção 12 do documento de integração:

1. **Reduzir a foto no cadastro do produto** (~1200px, ~150 KB). Zip não comprime JPEG — o tamanho fica decidido no momento em que a foto é salva, não na hora do backup.
2. **Gerar o export do banco na hora** (`VACUUM INTO` + zip). Nunca empacotar a pasta de backups anteriores: fazer backup de backup estoura o limite de 500 MB rapidamente.
3. **Se houver módulo fiscal, gravar o XML autorizado dentro do banco**, não numa pasta. O XML tem assinatura e protocolo da SEFAZ, não pode ser regenerado, e a guarda é obrigação legal.

---

## 7. Backup — o que construir no ERP

São quatro chamadas por pacote, e o ERP faz o ciclo duas vezes por dia: uma para `banco`, outra para `imagens`.

### O motor de empacotamento

```python
# BANCO — nunca copiar o arquivo com o banco aberto
conn.execute("VACUUM INTO 'tmp/banco.db'")     # export consistente
zipar(['tmp/banco.db', 'manifest.json'], 'tmp/banco.zip')

# IMAGENS — a pasta de fotos do ERP
zipar_pasta('dados/imagens/', 'tmp/imagens.zip')

# Medir DEPOIS de fechar o zip — este número vai na assinatura
tamanho  = os.path.getsize('tmp/banco.zip')
checksum = sha256_do_arquivo('tmp/banco.zip')
```

O `manifest.json` dentro do zip deve conter: versão do ERP, versão do schema do banco, data/hora, e o tamanho e sha256 de cada arquivo. É o que permite saber, na hora de restaurar, se aquele backup é compatível com a versão instalada.

### O ciclo

```python
# 1) Pedir a URL
r = requests.post(
    f"{BASE}/erp/backup/url-upload",
    headers={"Authorization": f"Bearer {token_licenca}"},
    json={
        "hwid":           hwid,
        "tipo":           "banco",          # ou "imagens"
        "tamanhoBytes":   tamanho,
        "checksumSha256": checksum,         # obrigatório em "imagens"
        "origem":         "AUTOMATICO",     # "MANUAL" se o usuário clicou
    },
)

if r.status_code != 200:
    codigo = r.json().get("codigo")
    # 403 / 429 / 409 → mostrar a mensagem e PARAR. Não repetir.
    return

dados = r.json()

# 2) O servidor pode dizer que não precisa enviar
if dados["acao"] == "PULAR":
    marcar_backup_em_dia(dados["ultimoEm"])
    return                                   # não chamar /confirmar

# 3) Subir direto no bucket — SEM Authorization aqui
with open("tmp/banco.zip", "rb") as f:
    conteudo = f.read()                      # ler em memória, ver o aviso abaixo

envio = requests.put(
    dados["url"],
    headers=dados["headers"],                # usar exatamente o que veio
    data=conteudo,
)

# 4) Confirmar SEMPRE, inclusive na falha
requests.post(
    f"{BASE}/erp/backup/confirmar",
    headers={"Authorization": f"Bearer {token_licenca}"},
    json={
        "uploadId":     dados["uploadId"],
        "hwid":         hwid,
        "ok":           envio.ok,
        "tamanhoBytes": tamanho,
        "erro":         None if envio.ok else f"HTTP {envio.status_code}",
    },
)
```

### Três armadilhas que custam horas

**Não passe um arquivo aberto para o `data=` do `requests`.** Com `data=open(...)`, a biblioteca usa *chunked transfer encoding* e **não envia o `Content-Length`** — a assinatura falha com `403 SignatureDoesNotMatch`, e a mensagem não diz nada sobre isso. Leia os bytes (`f.read()`) ou monte a requisição garantindo o header. Para arquivos grandes, use um objeto que exponha o tamanho e force o header explicitamente.

**Não mande `Authorization` no `PUT`.** A credencial está dentro da URL assinada. Mandar o cabeçalho junto invalida a assinatura.

**Calcule o tamanho depois de fechar o zip.** Medir antes, ou reescrever o arquivo entre o pedido da URL e o envio, muda o número e derruba a assinatura.

### Agendamento

Um backup por dia de cada tipo, em horário de baixo movimento. A cota padrão é **2 de banco e 1 de imagens por dia** — o suficiente para o automático mais um manual do usuário. Se o envio falhar, chame `/confirmar` com `ok: false` e **tente de novo só no próximo ciclo**: a vaga é devolvida, mas insistir em looping bate no limite e trava o dia.

---

## 8. Ambiente de teste

O painel administrativo tem um laboratório em `/debug` que exercita todas essas rotas com token real e mostra requisição e resposta cruas. É útil para conferir o formato exato de um payload antes de escrever o código, e para comparar quando algo não bater.
