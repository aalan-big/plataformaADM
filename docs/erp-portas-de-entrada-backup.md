# Backup em nuvem — o que o ERP precisa chamar

> ⚠️ **Contrato v3, definido em 03/08/2026. As rotas descritas aqui ainda NÃO
> estão no ar.** A API responde hoje o contrato antigo (três pacotes:
> `banco`/`imagens`/`os`). Este documento existe para que os dois lados
> programem em paralelo — **não tente exercitar estas chamadas contra a API
> ainda**, você vai receber `400` de schema e perder tempo achando que é bug seu.
> A data de subida vai ser combinada.
>
> Este documento cobre **só backup**. Cadastro, conexão, heartbeat, validação e
> cobrança estão em [`erp-portas-de-entrada.md`](./erp-portas-de-entrada.md) e
> **não mudaram** — o que está lá continua valendo integralmente.

---

## 1. O modelo, em uma tela

```
Primeiro login da semana  →  FULL       banco completo + todas as fotos, 1 zip
Demais logins da semana   →  FRAGMENTO  só o que é novo, 1 zip
```

Uma semana é um **ciclo**, identificado pela segunda-feira que o abre
(`2026-08-03`). Quando o full do ciclo novo é confirmado na nuvem, o servidor
apaga o ciclo anterior inteiro. O ERP não participa disso e não precisa saber
que existe retenção.

**O gatilho é o login**, não um horário. O PC do cliente pode estar desligado à
noite, então o backup dispara quando alguém abre o ERP no começo do dia.

**Um zip por envio, sempre.** Dentro dele vão as pastas que fizerem sentido
(`bd/`, `fotos_estoque/`, `fotos_empresa/`, `fotos_vistorias/`). O servidor não
abre o zip nem sabe o que tem dentro — ele autoriza, confere tamanho e registra.

---

## 2. Quem decide se sobe: o código do conteúdo

O ERP mantém, no momento em que grava, uma **pasta de pendentes** com o que
mudou — não é uma varredura noturna comparando tudo, é acumulação na escrita. A
partir dela sai um código (`codigoConteudo`) que resume o estado.

Todo login o ERP manda esse código. O servidor compara com o do **último envio
confirmado**:

| Comparação | Resposta | O que o ERP faz |
|---|---|---|
| Igual | `acao: "PULAR"` | exibe "backup em dia" e **não** chama `/confirmar` |
| Diferente | `acao: "ENVIAR"` | zipa o pendente, sobe, confirma |

### O contrato do campo

O servidor **não recalcula nem confere** esse valor. Ele guarda a string e
compara por igualdade literal. O contrato é só este:

> **Muda quando o conteúdo muda. Não muda quando o conteúdo não muda.**

Duas formas de errar, e as duas custam caro:

- **Sensível demais** (entra timestamp, contador de geração, id de sessão): muda
  todo dia mesmo com a pasta vazia. O ERP sobe zip vazio todo login, queimando
  cota.
- **Cego** (calculado sobre algo que a substituição de arquivo não toca): não muda
  quando devia. O cliente vê "backup em dia" por meses com o conteúdo congelado, e
  só descobre na hora de restaurar.

A forma robusta é o código ser o **hash do manifesto da pasta de pendentes**
(caminho + tamanho + hash de cada item, em ordem estável). Pasta vazia → manifesto
vazio → código idêntico ao de ontem → `PULAR`, de graça.

---

## 3. O ciclo de chamadas

São quatro passos por envio.

### 3.1 Descobrir onde estamos

```
GET /erp/backup/status
```

```jsonc
{
  "planoPermiteBackup": true,
  "codigoBloqueio": null,
  "cicloCorrente": "2026-08-03",        // a segunda de referência
  "fullDoCicloConfirmado": false,       // false → este envio é FULL
  "envioEmAndamento": null,             // ou { hwid, desde }
  "tamanhoMaximoBytes": 524288000,
  "limiteDiario": { ... },
  "enviadosHoje": { ... }
}
```

**Nunca calcule o ciclo localmente.** O `cicloCorrente` vem do servidor, cortado
no fuso de São Paulo pelo relógio dele. Máquina de cliente com data errada faria
o full no dia errado — ou nunca.

**`fullDoCicloConfirmado: false` significa "o próximo envio é full"**, em qualquer
dia da semana. É isso que faz a terça assumir quando a oficina não abre na
segunda, e é isso que torna o primeiro backup de uma instalação nova um full
automaticamente.

Para ramificar lógica use `codigoBloqueio`, nunca `motivoBloqueio` — o segundo é
texto de exibição e a redação muda.

### 3.2 Pedir autorização

```
POST /erp/backup/url-upload
Authorization: Bearer {token_licenca}
```

```jsonc
{
  "hwid": "...",
  "tipo": "full",                  // ou "fragmento"
  "ciclo": "2026-08-03",           // exatamente o que veio no /status
  "tamanhoBytes": 31457280,        // medido DEPOIS de fechar o zip
  "codigoConteudo": "9f2c...",     // obrigatório sempre
  "origem": "AUTOMATICO"           // "MANUAL" se o usuário clicou
}
```

Três respostas possíveis, todas `200`:

```jsonc
// autorizado
{ "acao": "ENVIAR", "uploadId": "...", "url": "https://...", "chave": "...",
  "metodo": "PUT",
  "headers": { "Content-Type": "application/zip", "Content-Length": "31457280" },
  "expiraEm": "2026-08-04T08:33:00Z" }

// nada mudou
{ "acao": "PULAR", "motivo": "...", "ultimoEm": "..." }

// outro terminal está enviando
{ "acao": "AGUARDANDO_OUTRO_TERMINAL", "desde": "...", "motivo": "..." }
```

**Leia o `expiraEm` da resposta.** Não assuma 15 nem 30 minutos — se um dia
subirmos o TTL para atender uma loja com internet pior, um ERP que assumiu o
valor antigo começa a abortar upload bom.

### 3.3 Subir direto no bucket

```
PUT <a url que veio>
```

Com **exatamente** os headers que vieram em `headers`, e **sem** `Authorization`
— a credencial está dentro da URL assinada. Mandar o cabeçalho junto invalida a
assinatura.

### 3.4 Confirmar — sempre, inclusive na falha

```
POST /erp/backup/confirmar
```

```jsonc
{ "uploadId": "...", "hwid": "...", "ok": true, "tamanhoBytes": 31457280 }
```

O servidor faz `HEAD` no objeto e **não confia no `ok`**: confere existência e
tamanho contra o que foi reservado.

Chamar com `ok: false` quando o upload falhar não é opcional — é o que devolve a
vaga da cota e libera o lock para outro terminal. Sem essa chamada, uma queda de
internet consome o backup do dia e trava as outras máquinas até a URL vencer.

---

## 4. A regra mais importante do lado do ERP

> **A pasta de pendentes só pode ser esvaziada depois do `/confirmar` responder
> `200` com `confirmado: true`.**

Não depois de fechar o zip. Não depois do `PUT` retornar 200. Depois da
confirmação, que é quando o `HEAD` provou que o objeto está no bucket com o
tamanho certo.

O motivo: uma pasta de pendentes é uma **fila**, não um diff. Um diff é
auto-corretivo — erra uma noite, a próxima recalcula e pega. Uma fila esvaziada
cedo perde o conteúdo para sempre, e nada nunca mais vai redescobrir aquilo,
porque não existe varredura que compare o disco com a nuvem.

O mesmo vale para a limpeza local do ciclo antigo, se houver.

---

## 5. Várias máquinas na mesma loja

O ERP dispara no login, então três estações abrindo às 8h tentariam três backups
do mesmo cliente. **O servidor arbitra**, e o desempate é sempre "quem chegou
primeiro com um envio válido":

```
Terminal A pede    → ENVIAR + uploadId
Terminal B pede    → AGUARDANDO_OUTRO_TERMINAL  (não é erro, não gasta cota)
A confirma         → pronto; B não precisa fazer nada hoje
A falha (ok:false) → libera na hora; B pode assumir
A trava e some     → libera sozinho quando a URL vencer
```

Do lado de vocês fica só a prioridade: a máquina servidor tenta primeiro, os
terminais esperam alguns minutos antes de tentar. `AGUARDANDO_OUTRO_TERMINAL` é
resultado normal — exibir "backup sendo feito em outra máquina", não erro.

---

## 6. Empacotamento

```python
# Nunca copie o banco com ele aberto — gere um export consistente
conn.execute("VACUUM INTO 'tmp/bd_export.db'")

# Um zip só, com as pastas dentro
zipar([
    'tmp/bd_export.db',            # no FULL: o banco inteiro
                                   # no FRAGMENTO: só as tabelas que mudaram
    *arquivos_pendentes,           # fotos novas/alteradas da pasta de pendentes
    'manifest.json',
], 'tmp/backup.zip')

# Medir DEPOIS de fechar — este número vai na assinatura
tamanho = os.path.getsize('tmp/backup.zip')
```

**Grave o `manifest.json` dentro do zip**, com: versão do ERP, versão do schema
do banco, data/hora, tipo (`full`/`fragmento`), ciclo, e o tamanho e sha256 de
cada item. É o que permite conferir arquivo por arquivo na restauração, em vez de
confiar no pacote inteiro — e é o que diz se aquele backup é compatível com a
versão instalada.

**Reduza a foto no cadastro, não no backup** (~1200px, ~150 KB). Zip não comprime
JPEG: o tamanho fica decidido no momento em que a foto é salva.

**Nunca empacote a pasta de backups anteriores.** Backup de backup cresce ao
quadrado e estoura o teto.

---

## 7. Restauração

Restaurar é: baixar o **full do ciclo** e depois **cada fragmento em ordem**,
extraindo por cima. A última versão de cada tabela e de cada arquivo vence — a
mesma regra para banco e para foto, sem merge de registros.

```
POST /erp/backup/url-download   { "hwid": "..." }
```

Devolve as URLs assinadas já na ordem de extração, com TTL curto (5 min — é
interativo, alguém clicou e vai baixar agora).

Se algum elo registrado tiver sumido do bucket, ele vem em `indisponiveis`.
**Isso precisa aparecer na tela.** Uma restauração com buracos que se apresenta
como completa é o pior resultado possível deste sistema — pior que falhar, porque
o cliente vai embora achando que está tudo lá.

---

## 8. Erros

**Trate sempre pelo campo `codigo`, nunca pelo texto.** As mensagens são escritas
para o usuário final e mudam.

| Código | Significa | O que fazer |
|---|---|---|
| `BACKUP_PLANO_INATIVO` | licença sem direito a backup | exibir e parar |
| `BACKUP_HWID_DIVERGENTE` | o hwid não bate com o da sessão | exibir e parar |
| `BACKUP_LIMITE_DIARIO` | cota do dia esgotada | tentar amanhã, sem loop |
| `BACKUP_TAMANHO_SUSPEITO` | full muito menor que o anterior | recusa de envio automático; refazer pelo botão manual |
| `BACKUP_ARQUIVO_AUSENTE` | o `HEAD` não achou o objeto | refazer o fluxo desde o `url-upload` |
| `BACKUP_TAMANHO_DIVERGENTE` | chegou com tamanho diferente do reservado | idem |
| `BACKUP_DADOS_INVALIDOS` | corpo fora do schema | é bug — conferir o payload |

**Nunca repita automaticamente em `403`, `429` ou `409`.** São recusas por regra
de negócio, não falha de rede. Repetir vira loop e trava o dia.

---

## 9. Três armadilhas que custam horas

**Não passe um arquivo aberto para o `data=` do `requests`.** Com `data=open(...)`
a biblioteca usa *chunked transfer encoding* e **não manda o `Content-Length`** —
a assinatura falha com `403 SignatureDoesNotMatch`, e a mensagem não diz nada
sobre tamanho. Leia os bytes (`f.read()`) ou force o header explicitamente.

**Meça o tamanho depois de fechar o zip, e não toque no arquivo depois disso.**
O `Content-Length` faz parte da assinatura criptográfica. Um byte de diferença
derruba o upload com um erro que parece de credencial.

**Peça a URL imediatamente antes do `PUT`.** Zipe, meça e calcule o código
**antes** de chamar `url-upload` — o relógio do `expiraEm` começa a correr na
resposta dela, não no início do envio.

---

## 10. O que ainda está em aberto

| # | Item | Situação |
|---|---|---|
| 1 | Teto de tamanho por envio | 500 MB hoje. O full de um cliente com meses de acervo passa disso — vai subir, mas acima de **5 GB** o PUT único deixa de existir (limite do protocolo S3/R2) e o full vai precisar sair em partes |
| 2 | Primeiro backup de cliente antigo | a pasta de pendentes contém o acervo inteiro. Vários GB num zip só, em horário comercial. Precisa de tratamento próprio |
| 3 | Cota diária | hoje são 2/dia por tipo. Com gatilho por login e lock no servidor, o número provavelmente muda |
| 4 | Granularidade do fragmento de banco | por tabela. Vale medir quanto isso economiza de verdade — as tabelas que mudam todo dia são as grandes |
