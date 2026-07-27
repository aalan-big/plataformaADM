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

**`banco` e `imagens` são espelhos: só existe uma cópia de cada na nuvem.** O envio de hoje sobrescreve o de ontem. Se a tela mostrar uma lista de envios, deixe claro que é histórico de eventos, não escolha de restauração.

**`os` é diferente: um arquivo por mês, e cada mês fechado sobe uma vez só.** Restaurar OS significa baixar **todos** os pedaços. O contrato completo está em [`erp-backup-contrato.md`](./erp-backup-contrato.md), seção D.

**Nunca calcule o mês corrente localmente.** Ele vem em `periodoCorrente` no `/status`, cortado no fuso de São Paulo pelo relógio do servidor.

**Nunca pule um mês porque ele "já está na nuvem" — pule por checksum igual.** São coisas diferentes. Um mês fechado pode mudar (foto com data retroativa, arquivo recuperado, exclusão), e a regra do "já subiu" perderia isso em silêncio. A do checksum se conserta sozinha no ciclo seguinte e não custa nada quando nada mudou. Ver seção D.1.2 do contrato.

---

## 6. Antes de programar o backup, decidir

Três coisas do lado do ERP que definem se o backup funciona bem ou mal, detalhadas na seção 12 do documento de integração:

1. **Reduzir a foto no cadastro do produto** (~1200px, ~150 KB). Zip não comprime JPEG — o tamanho fica decidido no momento em que a foto é salva, não na hora do backup.
2. **Gerar o export do banco na hora** (`VACUUM INTO` + zip). Nunca empacotar a pasta de backups anteriores: fazer backup de backup estoura o limite de 500 MB rapidamente.
3. **Se houver módulo fiscal, gravar o XML autorizado dentro do banco**, não numa pasta. O XML tem assinatura e protocolo da SEFAZ, não pode ser regenerado, e a guarda é obrigação legal.

---

## 7. Backup — o que construir no ERP

São quatro chamadas por pacote, e existem **três tipos de pacote**:

| Tipo | O que é | Comportamento |
|---|---|---|
| `banco` | export do banco | espelho — sobrescreve, todo dia |
| `imagens` | fotos de **produto** (catálogo) | espelho — sobrescreve, todo dia |
| `os` | fotos de **ordem de serviço**, por mês | pedaço — cada mês sobe uma vez |

A separação existe porque catálogo muda e OS não. Foto de OS é escrita uma vez e nunca mais tocada, mas a pasta cresce para sempre — tratada como espelho, o envio diário cresceria junto até bater no teto de 500 MB e o backup parar de funcionar. Particionada por mês, o envio diário é só o mês corrente e não cresce com a idade da instalação. O contrato completo está em [`erp-backup-contrato.md`](./erp-backup-contrato.md), seção D.

### O motor de empacotamento

```python
# BANCO — nunca copiar o arquivo com o banco aberto
conn.execute("VACUUM INTO 'tmp/banco.db'")     # export consistente
zipar(['tmp/banco.db', 'manifest.json'], 'tmp/banco.zip')

# IMAGENS — só o catálogo de produtos
zipar_pasta('dados/imagens/produtos/', 'tmp/imagens.zip')

# OS — um zip por mês. O mês vem da data de criação DO ARQUIVO, não da OS:
# é o que faz "mês fechado" significar imutável de verdade.
for mes, fotos in agrupar_por_mes_do_arquivo('dados/imagens/ordens-servico/'):
    zipar(fotos, f'tmp/os-{mes}.zip')          # mes no formato 'AAAA-MM'

# Medir DEPOIS de fechar o zip — este número vai na assinatura
tamanho = os.path.getsize('tmp/banco.zip')
```

O `manifest.json` dentro do zip deve conter: versão do ERP, versão do schema do banco, data/hora, e o tamanho e sha256 de cada arquivo. É o que permite saber, na hora de restaurar, se aquele backup é compatível com a versão instalada.

#### O `checksumSha256` — calcule sobre o conteúdo, NUNCA sobre o zip

O servidor não recalcula nem confere esse valor. Ele guarda a string e, no envio seguinte, compara por igualdade literal com a do último backup confirmado. O contrato do campo é só este: **muda quando o conteúdo muda, não muda quando o conteúdo não muda.**

Por isso **não** use o sha256 do arquivo `.zip`. Zip não é determinístico — timestamps, ordem das entradas e versão da biblioteca de compressão fazem o hash mudar mesmo com as fotos idênticas. O resultado é uma falha silenciosa e cara: o checksum muda todo dia, a deduplicação nunca dispara, e a loja sobe o pacote inteiro de imagens diariamente sem que ninguém perceba.

```python
import hashlib, os

def checksum_das_imagens(pasta):
    h = hashlib.sha256()
    for caminho in sorted(todos_os_arquivos(pasta)):      # ordem estável é essencial
        rel = os.path.relpath(caminho, pasta).replace('\\', '/')
        st  = os.stat(caminho)
        h.update(f"{rel}|{st.st_size}|{int(st.st_mtime)}\n".encode('utf-8'))
    return h.hexdigest()
```

Estável por construção, e barato — não relê os bytes das fotos. Se quiser rigor maior (imune a mexida no relógio do sistema), troque `st_mtime` pelo sha256 de cada arquivo, ao custo de ler tudo.

Em `banco` o campo é opcional e o dedupe não se aplica na prática — o banco muda todo dia. Envie se quiser, ou omita.

> **Rede de proteção:** se o checksum de `imagens` ficar congelado por 7 dias, o servidor ignora a deduplicação e força o envio completo. Ou seja, o pior caso de um checksum errado-mas-estável é backup semanal, não imagens paradas para sempre. É rede, não plano — não construa contando com ela.
>
> **Aproveite o `/status`:** `copiaAtual.imagens.checksumSha256` traz o que já está na nuvem. Compare com o seu antes de zipar e economize o trabalho todo quando nada mudou.

### O ciclo

```python
# 1) Pedir a URL
r = requests.post(
    f"{BASE}/erp/backup/url-upload",
    headers={"Authorization": f"Bearer {token_licenca}"},
    json={
        "hwid":           hwid,
        "tipo":           "banco",          # "imagens" ou "os"
        "periodo":        None,             # obrigatório em "os": 'AAAA-MM'
        "tamanhoBytes":   tamanho,
        "checksumSha256": checksum,         # obrigatório em "imagens" e "os"
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

Um backup por dia de cada tipo, em horário de baixo movimento. A cota padrão é **2 por dia** para `banco`, `imagens` e o **mês corrente** de `os` — o automático mais um manual do usuário. Meses fechados de `os` têm balde próprio, de **12 por dia**, que é o que permite subir o histórico inteiro na primeira semana sem competir com o backup do dia. Se o envio falhar, chame `/confirmar` com `ok: false` e **tente de novo só no próximo ciclo**: a vaga é devolvida, mas insistir em looping bate no limite e trava o dia.

No backfill, um `429 BACKUP_LIMITE_BACKFILL` não é erro: significa que a cota de hoje acabou e o restante continua amanhã de onde parou. Pare o laço e siga.

A URL assinada de upload vale **30 minutos**. Peça-a imediatamente antes do `PUT` — zipe, meça e calcule o checksum **antes** de chamar `url-upload`, porque o relógio começa a correr na resposta dela, não no início do envio.

---

## 8. Ambiente de teste

O painel administrativo tem um laboratório em `/debug` que exercita todas essas rotas com token real e mostra requisição e resposta cruas. É útil para conferir o formato exato de um payload antes de escrever o código, e para comparar quando algo não bater.
