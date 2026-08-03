# Resposta à Especificação v1 — API StartBig · Backup em Nuvem

**De:** equipe de plataforma (API StartBig web)
**Para:** equipe do StartBig ERP desktop
**Referência:** *Especificação de Contrato — API StartBig · Backup em Nuvem (v1)*
**Status:** resposta técnica + proposta de convergência para v2

---

## 0. Sumário executivo

A v1 está bem escrita e os quatro princípios de segurança estão corretos — três
deles já são exatamente o que o servidor faz hoje. O documento, porém, parece ter
sido escrito sem conhecer um trabalho que já foi entregue do nosso lado: **o
backup já é particionado por tipo e por mês, e os endpoints já estão
implementados e em produção.** Boa parte do que a v1 propõe como novo já existe
com outro nome, e uma parte do que ela propõe como estrutura conflita com essa
partição.

| # | Item da v1 | Veredito |
|---|---|---|
| P1 | Credenciais R2 nunca saem do servidor | ✅ **Acordo** — já é assim |
| P2 | Chave do objeto montada pelo servidor | ✅ **Acordo** — já é assim |
| P3 | Idempotência em todos os endpoints | ✅ **Acordo** — é o nosso `PULAR` |
| P4 | Validação do nome de arquivo por regex | ⚠️ **Dispensável** — sob P2 o desktop não envia nome nenhum |
| 1 | Pacote único `backup_AAAA-MM-DD_HHMMSS.zip` | ❌ **Recusado** — ver §4 |
| 4.1 | `sha256` calculado sobre o `.zip` | ❌ **Recusado** — ver §5 |
| 4.4 | `DELETE` de retenção comandado pelo desktop | ❌ **Recusado** — adotar a alternativa que a própria v1 oferece, ver §6 |
| 4.4 | **Retenção / versionamento** como conceito | ✅ **Aceito, e é uma contribuição real** — ver §3 |
| 4.1 | Limite de 5 GiB por arquivo | ❌ **Recusado** — o teto é 500 MB **por pedaço**, ver §4.3 |
| 6 | Restauração fora de escopo | ℹ️ **Já implementada** — `POST /erp/backup/url-download` |
| 4.x | Rotas `/v1/backups/*` | ⚠️ **Divergência de nome** — as rotas em produção são `/erp/backup/*` |

Uma correção factual antes de tudo: **os bytes já nunca trafegam pela API** e
**a restauração já existe**. Os dois pontos que a v1 trata como premissa a
estabelecer e como evolução futura já estão prontos.

---

## 1. O que já está implementado no servidor

Para calibrar o resto do documento. Tudo abaixo está em produção hoje:

```
POST  /erp/backup/url-upload     autoriza e assina a URL de PUT
POST  /erp/backup/confirmar      confere no bucket e registra no inventário
GET   /erp/backup/status         inventário + cotas + bloqueios + mês corrente
POST  /erp/backup/url-download   assina URLs de GET para restauração
```

Autenticação: token de licença (`ErpLicencaGuard`), com o `clienteId` resolvido
**a partir da licença no banco** — não do token e não do corpo. Há ainda
conferência de HWID contra o da sessão (`403 BACKUP_HWID_DIVERGENTE`).

Chave do objeto, montada só no servidor:

```
clientes/{clienteId}/{licencaId}/banco.zip
clientes/{clienteId}/{licencaId}/imagens.zip
clientes/{clienteId}/{licencaId}/os-AAAA-MM.zip
```

O `licencaId` entra no caminho porque um cliente pode ter várias licenças, cada
uma com seu banco local. Sem ele, duas lojas do mesmo dono escreveriam no mesmo
objeto e a segunda apagaria o backup da primeira.

**Três tipos, com semânticas diferentes** — este é o ponto central do desenho:

| Tipo | Semântica | Chave | Frequência |
|---|---|---|---|
| `banco` | **espelho** — o envio de hoje substitui o de ontem | fixa | todo dia |
| `imagens` | **espelho** — catálogo de produtos | fixa | quando muda |
| `os` | **arquivo morto**, particionado por mês | uma por mês | cada pedaço sobe **uma vez** |

Outros mecanismos já ativos: cotas diárias (2/dia por tipo + 12/dia de backfill
de meses antigos), teto de 500 MB e piso de 1 KB por arquivo, recusa de envio
automático cujo tamanho caia abaixo de um limiar do último confirmado
(`BACKUP_TAMANHO_SUSPEITO`), TTL de 30 min na URL de upload acoplado por
invariante ao cron que varre uploads órfãos, e rede de proteção que força reenvio
completo dos espelhos após 7 dias sem mudança de checksum — para que um checksum
calculado errado no desktop não congele o backup indefinidamente.

---

## 2. Princípios — acordo

**P1, P2 e P3 estão aceitos integralmente** e já implementados. Nada a debater.

**P4 merece um comentário**, porque sob P2 ele perde a função. A v1 pede que a
API rejeite nomes fora de `^backup_\d{4}-\d{2}-\d{2}_\d{6}(_full|_incr)?\.zip$`.
Mas se a chave é montada pelo servidor a partir da identidade autenticada — como
P2 exige e como já é feito — **o desktop nunca envia um nome de arquivo**. Ele
envia `tipo` (enum de três valores) e, quando `tipo=os`, `periodo` no formato
`AAAA-MM`, ambos validados por schema. A superfície que o regex defenderia já
está fechada estruturalmente, e por um caminho mais forte: não há string livre a
sanitizar.

O sufixo `_full`/`_incr` também deixa de ser necessário — ver a seção seguinte.

---

## 3. Onde a v1 está certa e nós estávamos errados

**A retenção com versionamento é uma contribuição real, e resolve um buraco que
nós já tínhamos identificado e ainda não tratado.**

Nosso `banco.zip` é espelho: chave fixa, sobrescrita diária. Existe **uma única
cópia**. Os pedaços de foto têm uma imunidade natural — se um arquivo for
alterado por fora do ERP (Explorer, ransomware), o ERP não percebe, não sobe
nada, e a cópia boa na nuvem sobrevive por construção. **O banco não tem essa
imunidade.** Um `.db` truncado, corrompido ou cifrado ainda é zipado e enviado, e
a checagem de queda de tamanho só pega encolhimento — cifra não encolhe.

A retenção proposta (7 diários + 4 semanais) fecha isso, e no `banco.zip` o custo
é trivial: ~30 MB × 11 cópias = **~330 MB por cliente**.

**Aceito, com dois ajustes:**

**3.1 — Retenção por tipo, não global.** Faz sentido no `banco`, que muda todo
dia e é pequeno. Não faz sentido nos pedaços de OS, que são grandes e mudam
raramente: 11 cópias de cada mês de fotos multiplicaria o armazenamento por 11
para proteger contra um risco que a partição já cobre de outro jeito.

| Tipo | Política |
|---|---|
| `banco` | **versionado** — 7 diários + 4 semanais |
| `imagens` | espelho, cópia única (é catálogo de produto, reconstruível) |
| `os` | pedaço mensal, cópia única por mês |

**3.2 — Muda o esquema de chave do `banco`.** Para versionar, a chave fixa deixa
de servir. Proposta:

```
clientes/{clienteId}/{licencaId}/banco/banco-AAAA-MM-DD.zip
```

O inventário do servidor continua sabendo qual é a mais recente, e isso destrava
de graça algo que a v1 lista como fora de escopo: **restauração para um ponto no
tempo.** O `url-download` de `tipo=banco` passa a aceitar um parâmetro opcional
de data; sem ele, devolve a mais recente. Comportamento atual preservado.

Esse é o único ponto do documento em que a v1 nos fez mudar de desenho, e vale o
registro.

---

## 4. Divergência central: pacote único diário × partição por mês

Este é o ponto que não dá para conciliar por acordo de nomenclatura, e é o
motivo principal desta resposta.

### 4.1 O que a v1 propõe, e o que ela custa

A v1 define **um zip por execução, com nome único** (`backup_AAAA-MM-DD_HHMMSS.zip`).
Nome novo todo dia significa objeto novo todo dia, o que significa que **não
existe nada a deduplicar: o acervo inteiro é enviado toda madrugada, para
sempre.**

O custo não é o armazenamento. 11 cópias de 700 MiB são ~7,7 GiB por cliente, o
que no R2 dá cerca de US$ 0,12/mês — irrelevante. **O gargalo é o link de upload
da oficina.** Um cliente com dois anos de operação tem cerca de **8,6 GB** de
fotos:

| Upload disponível | Tempo por madrugada |
|---|---|
| 10 Mbps | ~1h55 |
| 5 Mbps | ~3h50 |
| 2 Mbps | ~9h30 |

E cresce indefinidamente. No terceiro ano não fecha em uma noite; no quarto, o
backup simplesmente não termina nunca.

### 4.2 A v1 já sabe disso

A seção 5 do documento diz, textualmente: *"Com a entrada do backup incremental
no desktop, cada byte de conteúdo passará a ser enviado ao R2 exatamente uma
vez"*, e reserva o sufixo `_incr` para quando isso chegar.

**A partição por mês é exatamente esse incremental, e já está entregue.**
`os-2026-07.zip` sobe uma vez e nunca mais; o envio diário toca apenas o mês
corrente, cujo tamanho é limitado por construção. Os meses antigos que ainda não
subiram entram pela cota de backfill (12/dia), sem competir com o ciclo diário.

Não faz sentido implementar um segundo esquema incremental depois quando o
primeiro já está de pé, testado no ciclo e integrado ao painel administrativo.

### 4.3 O teto de 500 MB, e por que não sobe para 5 GiB

A v1 sugere limite de 5 GiB. O nosso é 500 MB, e não é uma sugestão: **o
`tamanho_bytes` entra na assinatura criptográfica da URL** (`Content-Length` é
header assinado). O bucket recusa qualquer corpo com tamanho diferente do
declarado — é o que impede um "backup de 30 MB" chegar como 4 GB e é a única
proteção real de cota que existe nesse desenho.

Com a partição, esse teto deixou de ser bomba-relógio, porque se aplica a **cada
pedaço** — um mês de fotos — e não ao acervo inteiro. Sem partição, o teto é
garantia de que uma hora o backup para de funcionar; numa oficina de 10 OS/dia
com 4 fotos (~12 MB/dia), um pacote unificado bate em 500 MB em cerca de seis
semanas, e a partir daí o cliente fica **sem backup nenhum, inclusive do banco de
dados**.

Vale registrar que essa é a razão de fundo dos três pacotes: não é organização, é
**isolamento de falha**. Hoje, se a pasta de fotos estourar, o `banco.zip`
continua subindo.

Consequência prática: **multipart deixa de ser necessário.** A v1 o adia para a
v1.1 justamente porque assume arquivos grandes. Com pedaços abaixo de 500 MB,
PUT único basta — e com TTL de 30 min (não 15), até um link modesto conclui.

### 4.4 O que pedimos ao ERP

Voltar dos zips com nome único para os três pacotes, informando `tipo` e
`periodo` no `url-upload`. É o mesmo código de zipar, chamado três vezes com
listas de arquivos diferentes.

---

## 5. O `sha256` precisa ser do manifesto, não do `.zip`

Ponto técnico curto e decisivo.

**Zip não é determinístico.** Zipar a mesma pasta duas vezes produz bytes
diferentes — timestamp por entrada, ordem de varredura do sistema de arquivos,
nível de compressão. O hash do `.zip` muda toda noite mesmo quando nenhum arquivo
mudou. Se for ele o campo de decisão, **o `PULAR` nunca dispara** e voltamos a
enviar tudo todo dia.

O contrato atual pede o checksum sobre um **manifesto ordenado** dos arquivos
(caminho, tamanho, data), não sobre o pacote. É isso que faz um pedaço de mês
fechado responder `PULAR` para sempre depois do primeiro envio.

**Não é incompatível com o que a v1 quer.** Os dois hashes podem coexistir, com
papéis distintos:

| Hash | Sobre o quê | Para quê |
|---|---|---|
| `checksumSha256` (no `url-upload`) | manifesto ordenado | **decidir** se sobe |
| `sha256` do pacote (opcional, no `confirmar`) | o `.zip` | **verificar** integridade do que chegou |

Aceitamos o segundo de bom grado. Só não podemos trocar o primeiro por ele.

Um pedido relacionado, que fortalece os dois: **gravar o `manifest.json` dentro
de cada zip**. Na restauração, isso permite conferir arquivo por arquivo em vez
de confiar no pacote inteiro.

---

## 6. Retenção executada pelo servidor, não pelo desktop

A v1 propõe `DELETE /v1/backups/{arquivo}` comandado pelo desktop, e no mesmo
parágrafo oferece a alternativa: *"a retenção remota ser executada pelo próprio
servidor (job periódico sobre o inventário)"*.

**Ficamos com a alternativa**, e o motivo é de segurança, não de preferência.

O desktop roda na máquina do cliente, fora do nosso perímetro. Dar a ele
autoridade para apagar objetos do R2 entrega o roteiro completo do ataque que
esse backup existe para sobreviver: cifrar o local e, em seguida, chamar o
`DELETE` de todas as cópias na nuvem. Nenhum backup que possa ser apagado pelo
mesmo host que ele protege cumpre a função.

O servidor já tem cron em operação, já mantém o inventário e conhece a política.
O desktop não precisa saber que retenção existe.

**Consequência para o ERP: o endpoint 4.4 não será implementado.** Nada a fazer
do lado de vocês — é um item a menos.

---

## 7. Contrato v2 — o que está de pé hoje

Documentado aqui na forma real, para servir de referência de implementação.

### 7.1 `POST /erp/backup/url-upload`

**Request:**

```jsonc
{
  "hwid": "...",                 // conferido contra o da sessão
  "tipo": "banco" | "imagens" | "os",
  "periodo": "2026-07",          // obrigatório se tipo=os, proibido nos demais
  "tamanhoBytes": 31457280,      // exato ao byte — entra na assinatura
  "checksumSha256": "9f2c...",   // do MANIFESTO; obrigatório em imagens e os
  "origem": "AUTOMATICO" | "MANUAL"
}
```

**Response `200` — autorizado:**

```jsonc
{
  "acao": "ENVIAR",
  "uploadId": "uuid",
  "url": "https://<presigned>",
  "chave": "clientes/1001/lic-.../os-2026-07.zip",
  "periodo": "2026-07",
  "metodo": "PUT",
  "headers": {
    "Content-Type":   "application/zip",
    "Content-Length": "31457280"     // assinado — divergir de 1 byte invalida a URL
  },
  "expiraEm": "2026-07-30T12:30:00Z"  // LER daqui, não assumir 15 nem 30 min
}
```

**Response `200` — nada mudou (equivale ao `ja_enviado` da v1):**

```jsonc
{ "acao": "PULAR", "motivo": "O pedaço de 2026-07 já está na nuvem e não mudou.",
  "chave": "...", "ultimoEm": "2026-07-29T03:12:00Z" }
```

`PULAR` **não consome cota** — a vaga só é ocupada quando a URL é assinada.

**Erros:** `400 BACKUP_PERIODO_FUTURO`, `400 BACKUP_CHECKSUM_OBRIGATORIO`,
`403 BACKUP_HWID_DIVERGENTE`, `409 BACKUP_TAMANHO_SUSPEITO`,
`429 BACKUP_LIMITE_DIARIO`, `429 BACKUP_LIMITE_BACKFILL`.

### 7.2 `POST /erp/backup/confirmar`

```jsonc
// request
{ "uploadId": "uuid", "hwid": "...", "ok": true, "tamanhoBytes": 31457280 }

// response 200
{ "confirmado": true, "uploadId": "uuid", "tamanhoBytes": 31457280,
  "confirmadoEm": "2026-07-30T12:07:41Z" }
```

O servidor faz `HEAD` no objeto e **não confia no `ok` do cliente**: confere
existência e tamanho contra o que foi reservado. Divergência devolve
`409 BACKUP_TAMANHO_DIVERGENTE`; ausência, `409 BACKUP_ARQUIVO_AUSENTE`. Em
falha, mandar `ok: false` com `erro` — o registro é marcado e a cota do dia não
fica presa.

A amarração é pelo `uploadId`, não pelo nome do arquivo: ele liga a confirmação à
autorização específica que a originou.

### 7.3 `GET /erp/backup/status`

Substitui o `GET /v1/backups` da v1, com bastante coisa a mais:

```jsonc
{
  "planoPermiteBackup": true,
  "motivoBloqueio": null, "codigoBloqueio": null,
  "limiteDiario": { "banco": 2, "imagens": 2, "os": 2, "backfill": 12 },
  "enviadosHoje": { "banco": 1, "imagens": 0, "os": 1, "backfill": 3 },
  "tamanhoMaximoBytes": 524288000,
  "periodoCorrente": "2026-07",
  "copiaAtual": {
    "banco":   { ... },
    "imagens": { ... },
    "os":      [ { "periodo": "2026-05", ... }, { "periodo": "2026-06", ... } ]
  },
  "historicoEventos": [ ... ]
}
```

Dois campos que pedimos atenção:

- **`periodoCorrente`** — qual mês tratar como pedaço aberto. Vem do servidor de
  propósito: o corte é no fuso de São Paulo pelo relógio **dele**. Máquina de
  cliente com data errada fecharia o mês na hora errada.
- **`copiaAtual` × `historicoEventos`** — o primeiro é o que **existe** na nuvem;
  o segundo é registro de eventos, não lista de arquivos restauráveis. Não
  apresentar um como o outro na tela.

Para ramificar lógica, usar `codigoBloqueio`, nunca `motivoBloqueio` (texto de
exibição, sujeito a mudança de redação).

### 7.4 `POST /erp/backup/url-download`

```jsonc
// request
{ "hwid": "...", "tipo": "os" }
```

Devolve URLs assinadas de GET, TTL de 5 min (assimétrico ao upload, de
propósito). Em `tipo=os` devolve **todos** os pedaços — restauração é do acervo
inteiro. Pedaço registrado que sumiu do bucket é reportado explicitamente em
`indisponiveis`: **restauração com buracos que se apresenta como completa é o
pior resultado possível**, e o ERP precisa mostrar isso ao usuário.

### 7.5 Endpoint novo proposto: `POST /erp/backup/avaliar`

Hoje o ERP zipa para descobrir o tamanho e só então ouve `PULAR` — o trabalho
caro acontece antes da decisão. Proposta:

```
1. POST /erp/backup/avaliar   { tipo, periodo, inventario }
      ↑ sem tamanho, sem zip — nada foi empacotado ainda
      → { acao: "PULAR" | "ENVIAR" | "RECUSAR", motivo }

2. só se ENVIAR: o ERP zipa e mede

3. POST /erp/backup/url-upload  (fluxo atual, inalterado)
```

Onde `inventario` é um resumo de ~100 bytes:

```jsonc
"inventario": { "arquivos": 1200, "novos": 0, "alterados": 1190, "removidos": 0 }
```

Isso habilita uma terceira resposta, contra alteração em massa acidental
(reprocessamento de imagens, migração que reescreve linhas, bug que toca milhares
de registros):

```jsonc
{ "acao": "RECUSAR", "codigo": "BACKUP_ALTERACAO_ANOMALA",
  "motivo": "1.190 de 1.200 arquivos de um mês fechado mudaram. A cópia da nuvem foi preservada." }
```

O `tamanhoBytes` **continua no `url-upload`** e não migra para cá: ele entra na
assinatura da URL, precisa ser exato ao byte e não é derivável do inventário (o
tamanho do zip não é a soma dos arquivos — há cabeçalho por entrada, diretório
central e alinhamento).

**Nada disso é breaking:** endpoint novo, campo opcional. Um ERP escrito contra o
contrato de hoje continua funcionando sem alteração.

---

## 8. Rotas, TTL e outros ajustes menores

- **Prefixo.** As rotas em produção são `/erp/backup/*`, padronizadas junto com
  as demais rotas do ERP. Trocar por `/v1/backups/*` quebraria o que já está
  rodando sem ganho. Se versionamento explícito for desejável, propomos discutir
  `/erp/v1/backup/*` numa janela própria.
- **TTL de upload são 30 min, não 15.** Esse número está acoplado por invariante
  ao cron que marca uploads órfãos. **O ERP deve ler `expiraEm` da resposta** em
  vez de assumir qualquer valor — se um dia subirmos o TTL para atender uma loja
  com internet pior, um cliente que assumiu 15 min começa a abortar upload bom.
- **`Content-Type: application/zip`** deve ser enviado junto com o
  `Content-Length`.
- **Cotas** não aparecem na v1: são 2/dia por tipo e 12/dia de backfill. O ERP
  deve tratar `429` como "tenta amanhã", não como erro — a mensagem de
  `BACKUP_LIMITE_BACKFILL` já diz que o backfill continua de onde parou e nenhum
  mês é perdido.
- **`403` para licença válida sem o módulo de backup** — concordamos com a ideia
  de comercializar o recurso como opcional; hoje o bloqueio existe por
  `codigoBloqueio` no `/status`. Vamos alinhar os dois.

---

## 9. O que ainda precisamos do lado do ERP

Três perguntas continuam em aberto desde a rodada anterior e **nenhuma foi
respondida na v1**. Elas afetam decisões que não conseguimos tomar sozinhos:

| # | Pergunta | Por que importa |
|---|---|---|
| 1 | O UPDATE da substituição de foto atualiza a coluna **`tamanho`**? | Se atualiza, o manifesto atual já detecta quase toda troca e só escapa a colisão exata de bytes. Se não atualiza, o manifesto é **cego a 100% das substituições** — este é o problema original que abriu a discussão |
| 2 | O laudo é **texto/estruturado** no banco ou **PDF em blob**? | Blob a ~300 KB × 5/dia faz o `banco.zip` (espelho, não particionável) sair dos ~30 MB de hoje e bater nos 500 MB em **menos de um ano** — e então o backup do banco para. Se for blob, o PDF precisa sair do banco e virar arquivo em pasta particionada |
| 3 | As **fotos de laudo** estão na mesma tabela das fotos de OS? | O manifesto é montado a partir do banco. Se estiverem em outra tabela, a consulta precisa cobrir as duas — senão viram "arquivo órfão", caem no fallback de `mtime`, e numa migração de PC **todas re-particionam para o mês da migração e sobem de uma vez** |

E dois itens de implementação que são pré-requisito do resto:

**Colunas novas em `ordem_servico_fotos`:**

```
+ hash_sha256    char(64)    preenchido no INSERT e no UPDATE da substituição
+ atualizado_em  timestamp   tocado em qualquer substituição
```

Como a substituição de foto já faz UPDATE na linha, é uma coluna a mais num
caminho de escrita que já existe — custo em milissegundos, com os bytes já em
memória durante o redimensionamento. Mais um job único para preencher o
histórico.

Deliberadamente **não** relendo os bytes toda noite: em um cliente de dois anos
seriam 8,6 GB e vários minutos de disco moendo por madrugada, crescendo para
sempre. É a doença que a partição curou.

**O mínimo que resolve o caso original é só o `atualizado_em`.** O `hash_sha256`
acrescenta duas coisas que valem: verificação arquivo por arquivo na restauração,
e um diff que significa "o conteúdo mudou" em vez de "alguém tocou no timestamp".

Nenhum dos dois enxerga alteração feita **por fora** do ERP. E aqui a cegueira é
proteção, não defeito: o ERP não sobe nada, e a cópia boa da nuvem sobrevive.

---

## 10. Plano de convergência

### Lado da plataforma (nós)

| # | Tarefa |
|---|---|
| 1 | Versionamento do `banco` — chave datada + política 7 diários + 4 semanais |
| 2 | Job de retenção no servidor (substitui o `DELETE` da v1) |
| 3 | `url-download` de `banco` com seleção de data (restauração para ponto no tempo) |
| 4 | Endpoint `POST /erp/backup/avaliar` |
| 5 | Aceitar `sha256` do pacote no `confirmar`, como verificação de integridade |
| 6 | Alinhar o `403` de "módulo não habilitado" com o `codigoBloqueio` do `/status` |

### Lado do ERP (vocês)

| # | Tarefa |
|---|---|
| 1 | Voltar do zip único para os três pacotes (`tipo` + `periodo`) |
| 2 | Checksum sobre o **manifesto ordenado**, não sobre o `.zip` |
| 3 | Ler `expiraEm` da resposta em vez de assumir TTL fixo |
| 4 | Colunas `hash_sha256` e `atualizado_em` + job de preenchimento do histórico |
| 5 | Gravar o `manifest.json` **dentro** de cada zip |
| 6 | Tratar `429` como "tenta amanhã"; tratar `PULAR` como sucesso |
| 7 | Responder às três perguntas da §9 |
| 8 | Remover o `DELETE` de retenção do escopo |

### Restrições de ambiente do nosso lado

Vale a transparência: a partição por mês, entregue no ciclo anterior, **ainda não
foi exercitada em ambiente real** — não há ambiente de staging separado, e o
banco de desenvolvimento está indisponível. Um teste conjunto ponta a ponta é
provavelmente a próxima coisa mais útil a fazer, antes de qualquer um dos dois
lados escrever mais código.

---

## 11. Fechamento

Os pontos 4, 5 e 6 (pacote único, hash do zip, `DELETE` pelo desktop) são os que
pedimos para reverter, e os três têm o mesmo formato: a v1 propõe algo razoável
em abstrato que conflita com uma decisão já implementada e cujo motivo não estava
visível de fora. Se algum deles esbarrar numa restrição do desktop que não
conhecemos, é exatamente o que queremos ouvir — nenhuma dessas escolhas é
religião.

E o ponto 3 vale ser dito de novo: **a retenção que vocês propuseram cobre um
risco real do nosso lado que ainda estava em aberto.** Entrou no plano.
