# Backup em nuvem — contrato do servidor

Respostas fechadas às dúvidas de desenho do lado do ERP. Tudo aqui foi conferido
contra o código em produção, não contra a intenção — onde a doc antiga divergia do
código, o código venceu e está marcado como **⚠ corrige a doc**.

Complementa:
- [`erp-portas-de-entrada.md`](./erp-portas-de-entrada.md) — seção 3 (rotas) e 7 (o ciclo do backup)
- [`integracao-erp-local.md`](./integracao-erp-local.md) — payloads campo a campo

Fontes no servidor: `apps/server/src/features/erp/erp-backup.service.ts`,
`apps/server/src/common/storage/storage.service.ts`,
`packages/database/src/repositories/backup.repository.ts`,
`packages/schemas/src/backup/backup.schema.ts`,
`apps/server/src/features/cron/cron.service.ts`.

---

## A. O que trava o desenho

### A.1 — Dois espelhos que sobrescrevem, e um acervo que acumula por mês.

São **três tipos**, porque são três ciclos de vida diferentes:

```
clientes/<clienteId>/<licencaId>/banco.zip        ESPELHO — sobrescrito todo dia
clientes/<clienteId>/<licencaId>/imagens.zip      ESPELHO — sobrescrito todo dia
clientes/<clienteId>/<licencaId>/os-2026-05.zip   PEDAÇO  — sobe uma vez, nunca mais
clientes/<clienteId>/<licencaId>/os-2026-06.zip   PEDAÇO  — sobe uma vez, nunca mais
clientes/<clienteId>/<licencaId>/os-2026-07.zip   PEDAÇO  — mês corrente, sobe todo dia
```

**Espelho** (`banco`, `imagens`): o envio de hoje sobrescreve o de ontem. Não há ring
de dias, não há versionamento, não existe "restaurar o de terça". Só faz sentido
guardar o estado atual, porque o conteúdo muda o tempo todo — venda nova, produto
editado, foto de catálogo trocada.

**Pedaço** (`os`): foto de ordem de serviço é escrita uma vez e nunca mais tocada.
Cada mês vira um arquivo próprio; mês fechado sobe uma única vez na vida da
instalação. Não é versionamento — é o acervo particionado. Restaurar OS significa
baixar **todos** os pedaços.

> **Por que não um espelho só.** Pasta de OS cresce para sempre e nunca encolhe. Como
> espelho, o envio diário cresceria junto: aos 400 MB o ERP subiria 400 MB toda noite,
> dos quais ~99 % seriam fotos de meses atrás que não mudaram e nunca vão mudar — até
> bater no teto de 500 MB, quando o backup de imagens simplesmente pararia de
> funcionar. Particionado, o envio diário é só o mês corrente e **não cresce com a
> idade da instalação**.

**Consequência para o ERP:** cada ZIP tem que ser **completo e autossuficiente dentro
do seu escopo**. Delta não tem para onde ir — não existe base anterior no bucket para
aplicar diferença em cima. Em `os`, o escopo é o mês: `os-2026-05.zip` contém todas as
fotos de OS de maio, e só elas.

**O teto de 500 MB agora se aplica a cada pedaço, não ao acervo.** Era o muro real
enquanto o pacote de imagens crescia sem limite; com a partição, um mês de fotos de OS
não chega perto dele. Se um único mês passar de 500 MB, aí sim há um problema de
volume que merece conversa — mas é um sinal, não o funcionamento normal.

É por isso que a seção 6 da doc de portas de entrada insiste em **reduzir a foto no
cadastro** (~1200px). ZIP não comprime JPEG nem WebP: o tamanho fica decidido no
momento em que a foto é salva.

> **Neste ERP isso já está feito** para foto de produto (WebP a 1200 px). O que
> dimensiona aqui é outra pasta — foto de ordem de serviço, 1920 px, append-only.
> Ver a seção **"O teto de 500 MB e a pasta que cresce para sempre"** no fim deste
> documento: para dado que só cresce, reduzir a foto adia o problema, não o resolve.

### A.2 — ⚠ O checksum é **opaco** para o servidor. ZIP determinístico NÃO é necessário.

Este é o ponto que mais muda o trabalho do ERP.

O servidor **nunca recalcula, nunca confere e nunca repassa** o `checksumSha256` para
o bucket. Ele apenas guarda a string e, no envio seguinte, compara por **igualdade
literal** com a do último backup confirmado. O `gerarUrlUpload` recebe o parâmetro e
não o usa: a URL assinada trava apenas `Content-Length` e `Content-Type`.

O contrato real do campo é só este:

> uma string hex de 64 caracteres que **muda quando o conteúdo muda** e **não muda
> quando o conteúdo não muda**.

**Portanto: não persiga ZIP determinístico.** Aquilo é uma batalha perdida (timestamps,
ordem de entrada, versão da lib de compressão) e o sintoma da derrota é silencioso —
o checksum muda todo dia, o dedupe nunca dispara, e a loja sobe 300 MB por dia sem
que ninguém perceba.

**Calcule o checksum sobre um manifesto, não sobre o ZIP** — e monte o manifesto com
dados do **banco**, não do sistema de arquivos:

```python
import hashlib

def checksum_do_manifesto(linhas):
    """`linhas` vem do banco: (nome_arquivo, tamanho, data_criacao)."""
    h = hashlib.sha256()
    for nome, tamanho, data_criacao in sorted(linhas):       # ordem estável
        h.update(f"{nome}|{tamanho}|{data_criacao.isoformat()}\n".encode('utf-8'))
    return h.hexdigest()
```

Estável por construção, barato (não relê os bytes das fotos) e responde exatamente à
pergunta que o dedupe faz.

> **Por que do banco e não do disco.** Um manifesto montado com `os.stat().st_mtime`
> muda inteiro quando a pasta é copiada para outra máquina — e aí o checksum de todos os
> meses muda de uma vez, disparando o reenvio do acervo completo justamente no dia da
> migração. `data_criacao` vem do banco e sobrevive à cópia. Mesmo raciocínio da D.1.1,
> e vale para os dois usos: particionar e comparar.

**Guarde o manifesto dentro do próprio zip** (`manifest.json`), não só o hash dele. Sem
isso a restauração não tem como se verificar: o hash do manifesto não é o hash dos bytes
do zip, então baixar o arquivo não prova que ele veio inteiro. Com o `manifest.json`
dentro, a verificação é auto-suficiente — descompacta, confere a lista contra o que
saiu, e não precisa do banco para isso. Ver a seção **E**.

> ⚠ **Corrigido na doc do ERP:** a seção 7 de `erp-portas-de-entrada.md` mandava fazer
> `checksum = sha256_do_arquivo('tmp/banco.zip')`. Para `imagens` e `os` isso é a
> receita do bug descrito acima. Para `banco` é inofensivo — o campo é opcional ali e
> o dedupe nem se aplica, já que o banco muda todo dia de qualquer forma.

**Em `os` o checksum carrega o mecanismo inteiro.** É ele que faz um mês fechado
responder `PULAR` para sempre depois do primeiro envio — sem lógica adicional no
servidor. Se o checksum de um pedaço fechado oscilar, aquele mês volta a subir todo
dia e a partição perde o sentido. Como o conteúdo de mês fechado não muda, o manifesto
ordenado dá um valor estável por construção.

**Rede de proteção nos espelhos:** se o checksum de `imagens` ficar congelado por
**7 dias**, o servidor ignora o dedupe e força o envio completo. O pior caso de um
checksum errado-mas-estável é backup semanal em vez de diário, não imagens paradas para
sempre. Não conte com isso como estratégia — é rede, não plano. **Pedaço de OS fechado
não tem essa rede**, pela razão explicada em A.3.

### A.3 — `PULAR` compara contra a última cópia **confirmada do mesmo escopo**.

Filtra `status: 'CONFIRMADO'` e ordena por `emitidoEm` desc. Tentativa que falhou, ou
que ficou pendurada sem confirmar, **não** entra na comparação. Um upload que morreu no
meio não faz o próximo dia responder "nada mudou" apontando para arquivo que não subiu.

**Em `os` o escopo é o mês.** `os-2026-06` compara só com envios anteriores de
`os-2026-06`, nunca com maio. Comparar meses diferentes não faria sentido nenhum — são
acervos distintos, e a checagem de queda suspeita acusaria todo mês mais fraco que o
anterior como suspeito.

**A rede de proteção dos 7 dias NÃO se aplica a pedaço de mês fechado.** Nos espelhos,
checksum congelado por 7 dias força reenvio completo (é a proteção contra checksum
errado-mas-estável). Em pedaço fechado o conteúdo é imutável de verdade, então checksum
igual significa mesmo "nada mudou" — forçar reenvio semanal reintroduziria exatamente o
custo que a partição existe para eliminar.

### A.4 — Quatro cotas independentes, e em `os` a cota é **por mês**.

| Balde | Cota/dia | Env |
|---|---|---|
| `banco` | **2** | `BACKUP_LIMITE_DIARIO_BANCO` |
| `imagens` | **2** | `BACKUP_LIMITE_DIARIO_IMAGENS` |
| `os` do **mês corrente** | **2** | `BACKUP_LIMITE_DIARIO_OS` |
| `os` de meses **fechados** (backfill) | **12** | `BACKUP_LIMITE_BACKFILL_DIARIO` |

Contadores independentes. O ciclo automático consome 1 de banco, 1 de imagens e 1 do
mês corrente de OS — sobrando uma vaga de cada para o botão manual do usuário.

> **Mudou.** `imagens` era 1/dia: o automático zerava a vaga e o botão manual respondia
> `429` justamente no único dia em que ele importa, aquele em que o usuário mexeu nas
> fotos e quis forçar. Corrigido para 2.

**A cota de OS é por mês, não pelo tipo inteiro.** Sem isso o backfill dos meses
antigos competiria por vaga com o backup do mês corrente, e o cliente ficaria com o
dado de hoje desprotegido enquanto recupera o de dois anos atrás.

**Por que o backfill tem 12 e não 2.** Um cliente que instala hoje com dois anos de OS
tem 24 pedaços para subir, cada um exatamente uma vez na vida. A 2/dia isso levaria 12
dias com o acervo desprotegido — justamente na janela em que ele ainda não tem backup
nenhum. A folga é segura porque o caso é limitado por construção: o que a cota diária
protege é upload **repetido**, e pedaço fechado que já subiu responde `PULAR` sem
consumir vaga. O número de pedaços novos possíveis é o número de meses de histórico —
finito, e só diminui. Estourou a cota de backfill? O envio continua amanhã de onde
parou; nenhum mês é perdido.

Duas coisas que **não** gastam vaga, e valem para o cálculo do ERP:

- `acao: "PULAR"` — o dedupe roda antes da contagem e antes de gravar a linha. **Em
  `os` isso é a regra, não a exceção:** depois do primeiro envio, todo mês fechado
  responde `PULAR` para sempre.
- `/confirmar` com `ok: false` — devolve a vaga na hora.

Mesmo assim, a tela deve ler `enviadosHoje` e `limiteDiario` do `/status` e desabilitar
o botão quando estiver no teto, em vez de deixar o usuário clicar e tomar 429.

### A.5 — Teto de 500 MB, piso de 1 KB, imposto em dois lugares.

```
BACKUP_TAMANHO_MIN_BYTES = 1.024          (1 KB)
BACKUP_TAMANHO_MAX_BYTES = 524.288.000    (500 MB)
```

- **No schema:** `tamanhoBytes` fora da faixa → `400 BACKUP_DADOS_INVALIDOS`, sem
  emitir URL e sem gastar cota.
- **Na URL assinada:** o `Content-Length` entra em `signableHeaders`. O bucket recusa
  qualquer corpo que não tenha exatamente aquele número de bytes. Não é validação de
  cortesia — é o que impede que um "backup de 30 MB" chegue como 4 GB e vire fatura.

O bucket (R2) não tem teto próprio abaixo disso — o limite dele para PUT simples é da
ordem de GB. **500 MB é o limite que vale.**

O `/status` devolve `tamanhoMaximoBytes`; leia de lá em vez de fixar 500 no código do
ERP.

---

## B. Cota e vagas

### B.1 — `PULAR` **não** consome vaga.

A verificação de dedupe acontece **antes** da contagem de cota e **antes** de gravar
a linha no banco. Sem linha, não há o que contar. Não vaza, não reserva, não precisa
de `/confirmar`.

Sequência real dentro de `url-upload`:

```
1. gate de plano          → 403 se trial/vencida/inativa
2. HWID confere           → 403 se divergir do token
3. período futuro         → 400 se o mês ainda não chegou
4. checksum obrigatório   → 400 em imagens e os sem checksum
5. dedupe                 → PULAR aqui, e acaba. Nada gravado.
6. queda suspeita         → 409 se automático e < 50% do último
7. cota (diária OU backfill) → 429 se estourou
8. assina a URL           → falha aqui não gasta cota (assina antes de gravar)
9. grava a linha          → é ESTA linha que ocupa a vaga
```

O passo 6 vir antes do 7 é deliberado: se o bucket estiver mal configurado, o cliente
não sai com "2 de 2 backups usados" num dia em que nada foi enviado.

### B.2 — A vaga é reservada no `url-upload` e liberada no `confirmar`. Órfã expira em ~60–70 min.

A contagem é `emitidoEm >= 00:00 de hoje (America/Sao_Paulo)` e `status != 'FALHOU'`.
Linha `EMITIDO` (upload em andamento) **conta**. É intencional: URL assinada entregue
já é custo em potencial, então um loop com bug que pede 500 URLs e nunca sobe também
bate no teto.

**Queda de luz no meio do upload:** o `/confirmar` nunca chega, a linha fica `EMITIDO`
e ocupa a vaga. Um cron varre isso:

- roda **a cada 10 minutos** (junto do GC de sessões, não só de madrugada);
- marca como `FALHOU` toda linha `EMITIDO` com mais de **60 minutos**;
- a vaga volta.

**Pior caso: ~70 minutos** (60 do corte + até 10 do intervalo do cron).

O corte não é um número solto: ele é **derivado** do TTL da URL de upload
(`TTL_UPLOAD_SEGUNDOS / 60 + 30`). A relação é load-bearing e por isso está no código,
não num comentário — se um dia o TTL subir para atender uma loja com internet pior, a
janela da órfã sobe junto. Sem isso, os dois se igualariam e um upload **lento e
legítimo** seria marcado `FALHOU` enquanto ainda estivesse subindo, custando ao cliente
uma vaga por um envio que ia dar certo.

O jeito rápido continua sendo o ERP reportar: chame `/confirmar` com `ok: false` na
próxima abertura e a vaga volta na hora.

#### B.2.1 — Reconciliação na inicialização: o caminho comum não chama a API

Vale explicitar, porque muda a ordem de inicialização do ERP.

Órfã nasce de queda de luz ou do PC desligado no meio do upload — e o PC volta na
manhã seguinte. Ou seja, **na esmagadora maioria dos casos a pendência já tem mais de
uma hora e o cron já a marcou `FALHOU`.** A vaga já voltou. Não há nada a informar.

| Idade da pendência | O que fazer no boot |
|---|---|
| **> 1 h** (caso comum) | **Limpeza local.** Fecha a linha do `backup_log` como falha e segue. Não chama a API. |
| **< 1 h** (crash com reabertura rápida) | `/confirmar` com o resultado real. Precisa de Bearer válido. |

**Consequência prática:** a reconciliação pode rodar cedo e barata, antes de a licença
estar validada. Só a exceção depende do ciclo de licença. Amarrar toda a limpeza ao
token seria pagar caro por um caminho que quase nunca acontece.

**A deriva que isso aceita, e por que é aceitável:** se o `PUT` tiver de fato
concluído e só o `/confirmar` ter se perdido, o arquivo está na nuvem mas o registro
ficou `FALHOU`. O `copiaAtual` passa a descrever a cópia **anterior** — data, tamanho
e checksum defasados — enquanto o objeto no bucket já é o novo. Isso não perde dado:
`url-download` entrega o arquivo que está lá, que é o mais recente. O custo é um ciclo
de metadado errado e, em `imagens`, um upload a mais no dia seguinte (o checksum de
referência é o velho, então o dedupe não dispara). O backup seguinte conserta sozinho.

Se quiser eliminar até essa deriva: reconcilie as pendências antigas **também**, mas
de forma oportunista — depois de a licença validar, fora do caminho crítico do boot.
Confirmar uma linha `FALHOU` com `ok: true` funciona e corrige o metadado, desde que o
tamanho do objeto ainda bata (ver a ressalva em B.4). É refinamento, não requisito.

### B.3 — `confirmar` com `ok: false` devolve a vaga. Não conta como envio.

Marca `FALHOU`, responde `200 { confirmado: false, motivo: 'Falha registrada.' }` e a
linha sai da contagem imediatamente. **Sempre chame**, inclusive quando o `PUT` deu
timeout ou a máquina não sabe se subiu. Não custa nada e é o que separa "loja com
internet ruim consegue backup" de "loja com internet ruim fica o dia travada".

### B.4 — `confirmar` é idempotente na prática, com uma ressalva.

Chamar duas vezes o mesmo `uploadId` com `ok: true` **não dá erro**: o servidor
confere o objeto no bucket de novo, o tamanho bate de novo, e regrava `CONFIRMADO`
(só atualiza `confirmadoEm`). Reconciliação na inicialização é segura.

**A ressalva:** o servidor confere a chave, e a chave é fixa por tipo. Se você
reconciliar um `uploadId` **antigo** depois que um envio mais novo já sobrescreveu
`banco.zip`, o servidor compara o tamanho do objeto novo com o reservado do registro
velho:

- tamanhos diferentes (o caso normal) → `409 BACKUP_TAMANHO_DIVERGENTE` e a linha
  velha vira `FALHOU`. Inofensivo: ela era lixo mesmo.
- tamanhos coincidentemente iguais → a linha velha é marcada `CONFIRMADO`. O histórico
  fica com um evento a mais. Não afeta a restauração — o arquivo na nuvem é o novo, e
  é ele que o `url-download` entrega.

**Regra prática:** reconcilie apenas `uploadId`s que o ERP sabe estarem pendentes, e
descarte os que passaram de ~1 hora — o cron já cuidou deles.

### B.5 — `PUT` com 5xx: repita **na mesma URL**, mesmo `uploadId`. Não gasta vaga nova.

A URL assinada não é de uso único. Enquanto estiver dentro dos **30 minutos** de
validade e o corpo tiver exatamente o mesmo `Content-Length`, pode repetir à vontade.
Nenhuma linha nova, nenhuma vaga a mais.

Como tratar cada falha do `PUT`:

| Resposta do bucket | O que é | O que fazer |
|---|---|---|
| `5xx`, timeout, conexão caída | falha transitória | 2–3 tentativas na **mesma URL**, com espera crescente |
| `403 SignatureDoesNotMatch` | bug no cliente (`Content-Length` divergente, ou mandou `Authorization`) | **não repita** — corrija o envio |
| `403` após 30 min | URL expirou | pedir URL nova, aí sim gasta outra vaga |

Estourou as tentativas: `/confirmar` com `ok: false` e tente **no próximo ciclo**,
não em loop.

### B.6 — A URL de upload expira em **30 minutos**.

```
upload   → 1800 s (30 min)
download →  300 s  (5 min)
```

O relógio começa a correr na resposta do `url-upload`, **não** no início do `PUT`.

> **Mudou.** Eram 600 s (10 min). Não fechava a conta: 500 MB em 600 s exigem
> ~6,7 Mbps de upload **sustentado**, que loja com rádio, ADSL ou 4G compartilhado
> não tem. Pior, o upload morria de forma reproduzível e o bucket respondia `403` —
> indistinguível de erro de assinatura, mandando quem depura para o lado errado.
> Com 1800 s, o teto de 500 MB pede **~2,2 Mbps**, que é realista.

Do lado do ERP, mesmo com a janela maior:

- **Peça a URL imediatamente antes do `PUT`.** Zipar, medir e calcular o checksum
  **antes** da chamada. Segundo gasto entre `url-upload` e `PUT` é segundo perdido.
- **Trate estouro de janela como falha normal:** `/confirmar` com `ok: false` e nova
  tentativa no ciclo seguinte. Nunca em loop.
- **Meça a taxa real** na primeira execução e registre no log. É o dado que decide se
  algum cliente específico precisa de tratamento diferente — e é o que eu preciso ver
  antes de mexer no teto de tamanho.

**Banda necessária para fechar dentro da janela:**

| Tamanho do pacote | Mbps de upload sustentado |
|---|---|
| 100 MB | 0,44 |
| 250 MB | 1,1 |
| 500 MB (teto) | 2,2 |

---

## C. Operação

### C.1 — HWID: a restauração em máquina nova funciona. Não existe `/reconnect`.

O `url-download` compara o `hwid` do corpo com o `hwid` **do token da sessão atual** —
nunca com o hwid que enviou o backup. Quem subiu o arquivo é irrelevante para quem
pode baixá-lo. O que vale é: sessão autenticada válida, para esta licença, com plano
ativo.

**O caminho da máquina nova, ponta a ponta:**

```
1. POST /erp/auth/login       e-mail + senha → devolve chaveAtivacao
                              (é o login autenticado que libera a troca)
2. POST /erp/conectar         com a chave + o hwid NOVO
                              → se as vagas de dispositivo estiverem cheias, o
                                servidor encerra as sessões antigas, registra
                                TROCA_DISPOSITIVO e manda e-mail de alerta ao cliente
                              → devolve token já assinado com o hwid novo
3. POST /erp/backup/url-download   { hwid: <o novo>, tipo: "banco" }
                              → 200 com URL assinada, 5 min de validade
```

**Não existe endpoint `/reconnect` neste servidor.** O `/erp/conectar` *é* o
re-vínculo — ele faz upsert da sessão com o hwid novo. A "autorização" para trocar de
máquina vem de ter passado por `/erp/auth/login` (e-mail + senha), não de um endpoint
dedicado. Via chave de ativação pura, sem login, a troca continua bloqueada com
`Limite de N dispositivo(s) simultâneo(s) atingido` — a chave sozinha não prova quem
está conectando.

**Detalhe de implementação que importa:** a checagem é
`if (hwidToken && corpo.hwid !== hwidToken)`. Se o `/erp/conectar` foi chamado **sem**
`hwid`, o token sai sem hwid e a comparação é **pulada por completo** — qualquer valor
no corpo passa. Não construa nada em cima disso; mande sempre o hwid nos dois lugares.

#### C.1.1 — "E se o HD der pau?" — o backup **não** é vinculado a máquina

Vale explicitar, porque a leitura natural de "HWID divergente" é vínculo de hardware,
e não é isso:

> O `hwid` enviado no corpo é conferido contra o **hwid da sessão atual**, nunca
> contra o hwid que gerou o backup. É anti-adulteração — impede um ERP de pedir URL
> se passando por outro. **Não** é trava de máquina.

HD trocado, PC novo, Windows reinstalado: o backup baixa normalmente. O arquivo
pertence à **licença**, não ao equipamento.

**A única fricção real é a vaga de dispositivo**, no `/erp/conectar` — não o backup.
Com a licença de 1 dispositivo e a sessão da máquina morta ainda registrada, a
máquina nova é recusada com `Limite de 1 dispositivo(s) simultâneo(s) atingido`.
Duas saídas, ambas já implementadas:

| Caminho | Quando libera | Como |
|---|---|---|
| **Esperar** | ~45 min | O PC morto para de mandar heartbeat. O GC apaga sessões com mais de **35 min** sem sinal, e roda a cada **10 min**. A vaga se libera sozinha. |
| **`/erp/auth/login`** | imediato | E-mail + senha provam a identidade do dono → o servidor encerra as sessões antigas, registra `TROCA_DISPOSITIVO` e envia e-mail de alerta ao cliente. |

O caminho de suporte é o segundo. Via chave de ativação pura, sem login, a troca
continua bloqueada até o GC agir — a chave sozinha não prova quem está conectando.

##### ⚠ A armadilha que parece "bloqueio por HWID" e não é

Se o ERP chamar `/erp/auth/login` **sem** o campo `hwid`, o servidor inventa um
identificador (`login-<uuid>`) e **assina o token com ele**:

```ts
hwid: dados.hwid ?? `login-${randomUUID()}`   // erp-auth.service.ts:73
```

A partir daí, toda chamada de backup usando o HWID **real** da máquina responde
`403 BACKUP_HWID_DIVERGENTE` — e o sintoma é indistinguível de "o servidor está
travando por hardware". Não está: o ERP e o token estão falando de hwids diferentes.

**Regra:** mande o `hwid` real em `/erp/auth/login`, em `/erp/conectar` e em toda
chamada de backup. Sempre o mesmo valor, sempre o mesmo lugar. Se por algum motivo
conectar sem hwid, leia o `sessionKey` da resposta e use **esse** valor nas chamadas
de backup.

### C.2 — Retenção: 90 dias, e só depois que a licença deixa de estar ATIVA.

| Item | Prazo |
|---|---|
| Arquivos na nuvem, licença **ATIVA** | **indefinidamente** — nunca são apagados por retenção |
| Arquivos na nuvem, licença não-ATIVA | **90 dias** contados do último backup confirmado |
| Avisos por e-mail ao cliente | aos **75** e aos **83** dias (15 e 7 dias antes de apagar) |
| Diário de eventos (as linhas, não os arquivos) | podado aos **180 dias** |

Quantidade de cópias: **uma por tipo, sempre.** Retenção não é histórico — é só o
prazo até o arquivo único ser apagado.

A janela de 90 dias é também a janela de recuperação: quem venceu e voltou a pagar
dentro dela recupera o acesso ao próprio arquivo. Fora dela, não há de onde voltar.

Cliente ATIVO cujo PC ficou dois meses desligado **não** perde o backup — a regra
exige licença não-ATIVA, exatamente para não punir quem mais vai precisar do arquivo
quando voltar.

### C.3 — `copiaAtual` devolve data, tamanho, hwid, chave **e checksum**.

```jsonc
{
  "planoPermiteBackup": true,
  "motivoBloqueio": null,
  "codigoBloqueio": null,
  "periodoCorrente": "2026-07",        // qual mês o ERP deve tratar como aberto
  "limiteDiario":  { "banco": 2, "imagens": 2, "os": 2, "backfill": 12 },
  "enviadosHoje":  { "banco": 1, "imagens": 0, "os": 1, "backfill": 0 },
  "tamanhoMaximoBytes": 524288000,

  "copiaAtual": {
    "banco": {
      "tamanhoBytes": 31457280,       // real medido no bucket, não o reservado
      "geradoEm":     "2026-07-27T03:12:44.000Z",
      "hwid":         "a1b2c3...",    // qual máquina enviou
      "chave":        "clientes/<clienteId>/<licencaId>/banco.zip",
      "checksumSha256": "ee8f7504f2d54f37..."   // o que está na nuvem AGORA
    },
    "imagens": null,                   // null = nunca houve backup deste tipo

    // Um item por mês que existe na nuvem, do mais antigo para o mais novo.
    // Lista vazia = nenhum pedaço enviado ainda.
    "os": [
      { "periodo": "2026-05", "tamanhoBytes": 48234496, "geradoEm": "...", "checksumSha256": "..." },
      { "periodo": "2026-06", "tamanhoBytes": 51201024, "geradoEm": "...", "checksumSha256": "..." },
      { "periodo": "2026-07", "tamanhoBytes": 22118400, "geradoEm": "...", "checksumSha256": "..." }
    ]
  },

  "historicoEventos": [
    {
      "tipo": "BANCO", "periodo": null, "status": "CONFIRMADO", "origem": "AUTOMATICO",
      "tamanhoBytes": 31457280, "hwid": "a1b2c3...",
      "emitidoEm": "...", "confirmadoEm": "...", "erro": null
    }
    // até 30 eventos, mais recente primeiro. `periodo` só vem preenchido em OS.
  ]
}
```

Para a tela de Backup use `copiaAtual`. Ela responde "o que existe na nuvem **agora**":
um espelho de cada, e um pedaço por mês de OS.

**`periodoCorrente` vem do servidor de propósito.** É ele que diz qual mês ainda está
aberto, e o corte é no fuso de São Paulo pelo relógio **do servidor**. Se o ERP
calcular sozinho, uma máquina com a data errada fecharia o mês na hora errada — e
pedaço fechado cedo demais perde as fotos que ainda entrariam.

`historicoEventos` é **diário de eventos, não lista de restauração.** Se a tela
mostrar essa lista, deixe explícito que é histórico: prometer escolha de versão que
não existe é o pior defeito possível numa tela de backup.

**Uso do checksum pelo ERP:** compare `copiaAtual.imagens.checksumSha256` com o que
você calcula localmente **antes de zipar**. Se bater, não zipe nada — o `url-upload`
responderia `PULAR` de qualquer forma, e zipar 300 MB de fotos é a parte cara do
ciclo. É a única economia que o `/status` permite e o `url-upload` não.

### C.4 — `motivoBloqueio` é texto para exibir; `codigoBloqueio` é o contrato.

| Situação | `codigoBloqueio` | `motivoBloqueio` (exibir como está) |
|---|---|---|
| `isTrial = true` | `TRIAL` | `"Backup em nuvem não está disponível durante o período de teste."` |
| status ≠ ATIVA | `LICENCA_<STATUS>` | `"Licença <status> — backup em nuvem indisponível."` |
| vencida por data | `LICENCA_VENCIDA` | `"Licença vencida — backup em nuvem indisponível até a renovação."` |
| liberado | `null` | `null` |

> **Mudou.** O `codigoBloqueio` é novo. Antes o `/status` era a única resposta da API
> que obrigava o cliente a comparar string — exatamente o que o resto do contrato
> proíbe.

`LICENCA_<STATUS>` usa o nome do enum, em maiúsculas. O conjunto fechado é:

```
TRIAL
LICENCA_AGUARDANDO
LICENCA_SUSPENSA
LICENCA_REVOGADA
LICENCA_BLOQUEADA
LICENCA_VENCIDA
```

`LICENCA_VENCIDA` sai tanto do status quanto da data vencida — de propósito: para quem
consome é a mesma situação, a diferença é só se o cron já passou marcando.

**Como usar:** `planoPermiteBackup === false` → desabilite os botões, **exiba o
`motivoBloqueio` como está** e ramifique no `codigoBloqueio` se precisar (ex.: só o
`LICENCA_VENCIDA` merece um botão "Renovar agora" levando ao `/erp/cobranca`). A ordem
de avaliação é trial → status → vencimento, e só o primeiro motivo aplicável volta.

O mesmo bloqueio, quando você tenta subir mesmo assim, vem como
`403 { codigo: "BACKUP_PLANO_INATIVO", message: <o mesmo texto> }`. Esse `codigo`
segue o de sempre — não foi trocado pelo `codigoBloqueio`, que é exclusivo do
`/status`.

**Nunca compare string contra os textos de `motivoBloqueio`** — eles vão mudar.

### C.5 — Token expirado no meio do fluxo: `401`, e **o envio não se perde**.

O `ErpLicencaGuard` responde `401 Token de licença inválido ou expirado` em qualquer
rota `/erp/backup/*`.

O importante: o arquivo **já está no bucket**. O `PUT` vai direto à nuvem, com a
credencial dentro da própria URL — ele não passa pelo guard e não sabe nada sobre o
seu token. Um 401 no `/confirmar` é só o registro que ficou pendente.

**Recuperação:**

```
1. POST /erp/validar               → token novo
2. POST /erp/backup/confirmar      → MESMO uploadId, mesmo ok: true
                                     (é idempotente — ver B.4)
```

Nada é perdido e nenhuma vaga é gasta a mais. Se o ERP fechar antes de conseguir,
o cron marca `FALHOU` em ~1 h e a vaga volta — o arquivo continua no bucket, mas
sem registro confirmado o `/status` e o `url-download` não o enxergam. Por isso vale
persistir o `uploadId` pendente em disco e reconciliar na próxima abertura.

**Prevenção que elimina o caso:** o token dura no máximo 7 dias, e o
`proximaValidacaoEm` que vem na resposta é sempre ≤ 24 h. Chame `/erp/validar`
**antes** de iniciar o ciclo de backup, não no meio dele.

---

## D. O ciclo com `os` — o que o ERP passa a fazer

### D.1 — Empacotamento

Três pacotes, não dois:

| Pacote | Conteúdo | Frequência |
|---|---|---|
| `banco.zip` | `VACUUM INTO` + manifesto | todo dia |
| `imagens.zip` | fotos de **produto** (catálogo) | todo dia |
| `os-AAAA-MM.zip` | fotos de OS **daquele mês** | ver abaixo |

### D.1.1 — A regra do mês: `data_criacao` **da foto**, no banco

O mês de uma foto é o da **`data_criacao` da linha dela em `ordem_servico_fotos`**. Não
é a data da OS, e não é o timestamp do arquivo no disco. Uma foto só pode estar em um
pedaço.

Duas correções sobre versões anteriores deste documento, ambas relevantes:

> **Não use a data da OS.** Uma foto anexada em 2 de agosto a uma OS aberta em 28 de
> julho iria para o pedaço de **julho**, que já estava fechado e enviado. Mês fechado
> deixaria de ser imutável e a premissa inteira da partição cai junto.

> **Não use o mtime do arquivo.** Timestamp de arquivo **não sobrevive a cópia de
> pasta**. Migrar o cliente para um PC novo reescreve todos eles com a data de hoje, e o
> histórico inteiro re-particiona para um mês só. A Regra 1 impede a perda — o checksum
> muda e tudo é reenviado — mas o cliente sobe anos de fotos exatamente no pior momento
> possível, que é o dia em que acabou de trocar de máquina.

`data_criacao` é um dado do banco: sobrevive a cópia de pasta, a restauração e a troca de
máquina. É o único dos três candidatos que é estável de verdade.

**Fallback:** arquivo órfão, sem linha correspondente no banco, cai no mtime. É o único
caso em que não há alternativa, e é raro o bastante para não contaminar o resto.

O custo dessa escolha é que fotos da mesma OS podem cair em meses diferentes. Para
backup isso é irrelevante — a restauração traz todos os pedaços de volta, e o vínculo
foto↔OS mora no banco, que tem backup próprio.

### D.1.2 — Quando um mês passa a ser fechado

| | Regra |
|---|---|
| Mês de uma foto | data de criação do arquivo |
| Mês corrente | `periodoCorrente` do `/status` — **nunca** calculado localmente |
| Mês fechado | qualquer `periodo < periodoCorrente` |
| Quando reenviar um mês | **quando o checksum local diferir do que está na nuvem** — fechado ou não |

**A última linha é a que fecha o buraco.** Nunca pule um mês por ele "já estar na
nuvem". Pule por **checksum igual**. São coisas diferentes, e confundi-las é o que
perderia foto em silêncio: bastaria uma foto entrar com data retroativa, ou um arquivo
ser recuperado de um pen drive, para o mês mudar depois de já ter subido.

Com a regra do checksum isso se conserta sozinho no ciclo seguinte, e não custa nada no
caso normal — mês fechado tem checksum estável, então a resposta é `PULAR`.

**Otimização opcional:** recalcular o manifesto de 24 meses todo dia é barato — é uma
consulta ao banco agrupada por mês, não uma varredura de disco. Se ainda incomodar,
guarde o checksum de cada mês numa tabela local e recalcule só o que teve escrita desde
a última vez. **Não troque isso pela regra de "já subiu, pula"** — é a otimização que
reintroduz o bug.

### D.2 — O ciclo diário

```python
st        = get("/erp/backup/status")
mes_atual = st["periodoCorrente"]          # NUNCA calcule isso localmente
na_nuvem  = { p["periodo"]: p["checksumSha256"] for p in st["copiaAtual"]["os"] }

# 1) Espelhos, como sempre
enviar("banco",   checksum=None)
enviar("imagens", checksum=checksum_do_manifesto(pasta_produtos))

# 2) TODOS os meses que existem em disco — corrente e fechados, no mesmo laço.
#    O que decide se sobe é o CHECKSUM, nunca "já está na nuvem".
for mes in sorted(meses_com_fotos(), reverse=True):   # mais novo primeiro
    local = checksum_do_manifesto(fotos_de(mes))

    if na_nuvem.get(mes) == local:
        continue                           # nada mudou: nem zipa, nem chama a API

    r = enviar("os", periodo=mes, checksum=local)

    if r.status_code == 429:               # cota do dia acabou
        break                              # continua amanhã, nada é perdido
```

**Por que um laço só, e não "corrente" separado de "backfill".** São a mesma operação:
"este mês está diferente do que a nuvem tem?". O servidor é que separa os baldes de
cota, e ele faz isso sozinho olhando o `periodo`. Do lado do ERP, tratar como dois
casos é o que abre espaço para o mês fechado ser esquecido.

**Três coisas que economizam trabalho de verdade:**

1. **Compare o checksum antes de zipar.** `copiaAtual.os[].checksumSha256` diz o que já
   está na nuvem. Bateu, não zipe — o servidor responderia `PULAR` de qualquer forma, e
   zipar é a parte cara. No estado estável, o laço acima não zipa nada além do mês
   corrente.
2. **`PULAR` é o caminho normal em `os`.** Se o checksum local escapar da comparação e a
   chamada acontecer, o servidor devolve `PULAR`. Trate como sucesso silencioso, sem
   alarme na tela.
3. **Do mais novo para o mais antigo.** No backfill, protege primeiro o que tem mais
   chance de ser necessário numa restauração.

### D.3 — A virada do mês

**Com a regra da D.1.2, a virada deixa de ser um evento.** O ERP não precisa detectar
nada, não precisa de rotina de fechamento e não precisa de ordem especial entre os
envios. No dia 1º, `periodoCorrente` muda; o laço da D.2 percorre os mesmos meses de
sempre, encontra o mês que acabou com checksum diferente do que está na nuvem (porque
entraram fotos nos últimos dias), sobe ele uma última vez, e a partir daí ele bate o
checksum para sempre.

Os casos que costumam quebrar esse tipo de esquema, e o que acontece aqui:

| Situação | Resultado |
|---|---|
| Foto lançada 31/07 às 23h50 | Entra em julho. O ciclo de 01/08 vê julho diferente e reenvia. |
| PC desligado de 25/07 a 10/08 | Em 10/08 o laço acha julho e agosto diferentes e envia os dois. |
| Foto de agosto anexada a uma OS de julho | Vai para **agosto** — o mês é o da foto, não o da OS (D.1.1). Julho não muda. |
| **Cliente migra para um PC novo** | **Nada muda.** `data_criacao` vem do banco e a cópia de pasta não a altera. Nenhum reenvio. |
| Foto apagada em disco, linha continua no banco | Manifesto igual (o banco não mudou), mas o zip sai menor. Vale conferir na montagem: arquivo faltando é sintoma, não detalhe. |
| Linha apagada do banco | Manifesto muda, mês reenvia menor. Encolheu além de 50 %, vira `409 BACKUP_TAMANHO_SUSPEITO` no automático — refazer pelo botão manual. |

> **Um limite conhecido:** o manifesto é `nome | tamanho | data_criacao`. Uma foto
> substituída por outra de **exatamente** o mesmo tamanho, mantendo nome e linha no
> banco, não muda o checksum e não seria reenviada. Como foto de OS é escrita uma vez e
> nunca editada, o caso é teórico. Se algum dia deixar de ser, a saída é somar o sha256
> de cada arquivo ao manifesto do mês corrente apenas — os fechados não precisam.

**O que NÃO fazer:** marcar um mês como "concluído" localmente e pular a verificação a
partir dali. É a otimização que parece óbvia e perde foto em silêncio — exatamente o
buraco que essa regra existe para tapar.

### D.4 — Restauração

`url-download` com `tipo: "os"` devolve **todos** os pedaços de uma vez:

```jsonc
{
  "tipo": "os",
  "arquivos": [
    { "periodo": "2026-05", "url": "https://...", "chave": "...", "tamanhoBytes": 48234496, "geradoEm": "..." },
    { "periodo": "2026-06", "url": "https://...", "chave": "...", "tamanhoBytes": 51201024, "geradoEm": "..." }
  ],
  "indisponiveis": [],        // pedaços registrados que sumiram do bucket
  "totalBytes": 99435520,
  "expiraEm": "2026-07-27T14:05:00.000Z"
}
```

Para `banco` e `imagens` o formato é o mesmo, com **um** item e `periodo: null`.

**As URLs valem 5 minutos e isso não vai dar para um acervo grande — de propósito.**
Em vez de esticar a validade de um link que entrega o banco inteiro do cliente, o ERP
baixa o que conseguir e **chama de novo** para o que faltar. `url-download` é leitura
pura e não tem cota diária; repetir é barato.

**`indisponiveis` não pode ser ignorado.** Lista vazia é o caso normal. Qualquer item
ali significa que um pedaço registrado não está mais na nuvem, e a restauração vai sair
com buraco. Avise o usuário **antes** de restaurar: acervo parcial que se apresenta
como completo é o pior resultado possível nesta tela.

---

## E. Restauração — a fase que ainda não tem dono

Backup que ninguém sabe restaurar é fé, não seguro. Esta seção existe para que a
restauração seja um item planejado e não a surpresa daqui a três meses.

**Nada aqui está implementado.** O que existe hoje do lado do servidor é o
`url-download` (D.4) e o download do admin. Tudo abaixo é lado ERP.

Com duas exceções, que **não** devem esperar por esta seção:

- **E.5, "testar meu backup"** — não depende de nada destrutivo e pertence à fase 1.
- **Restaurar só o banco** — é operação válida e útil por si só (ver E.2), e não precisa
  da restauração de fotos existir.

### E.1 — A partição encareceu a restauração, e isso era previsível

| Antes | Agora |
|---|---|
| 1 download | N downloads (1 por mês de OS + 2 espelhos) |
| 1 URL de 5 min | N URLs de 5 min, com repedido quando vencem |
| — | pedaço ausente (`indisponiveis`) = restauração parcial |

Foi o preço de não ter o backup diário crescendo para sempre. Vale a troca, mas a conta
chega aqui.

### E.2 — A ordem importa, e a errada corrompe

```
1. Baixar tudo e VERIFICAR         ← nada é tocado ainda
2. Conferir compatibilidade de schema
3. Restaurar as fotos (aditivo, reversível)
4. Restaurar o banco (destrutivo)  ← por último, e só se 1–3 passaram
5. Reiniciar o ERP
```

**Fotos antes do banco, quando as duas coisas vão ser restauradas.** O banco referencia
fotos por nome de arquivo, então banco restaurado com as fotos ainda ausentes mostra
**imagem quebrada na tela** nas OS que tinham foto. É um defeito visual, não perda de
dado: a OS abre, os campos estão lá, o histórico está lá — falta a miniatura. Assim que
os pedaços de OS chegarem, as imagens voltam sozinhas.

Isso importa porque sustenta uma entrega parcial legítima: **restaurar só o banco é uma
operação válida e útil**, e não precisa esperar a restauração de fotos existir. Um
cliente que perdeu a máquina recupera cadastro, financeiro e o histórico de OS de
imediato, com as fotos voltando depois. Se o efeito fosse "OS antiga quebrada", essa
porta estaria fechada — e ela não está.

Fotos restauradas sem o banco também não quebram nada: ficam em disco, sem referência,
até o banco chegar.

**Nunca apague o banco local antes de o novo estar verificado e aberto com sucesso.**
Renomeie o antigo, não delete. O caso "restaurei e agora não abre nem o novo nem o
velho" é o único desfecho pior que não ter backup.

### E.3 — O SQLite não deixa trocar o arquivo em uso

O engine segura o arquivo. Sobrescrever com o ERP aberto vai de "erro claro" a
"corrupção silenciosa", dependendo do sistema de arquivos. O padrão seguro:

```
1. Baixar e verificar em  tmp/restauracao/banco.db
2. Gravar uma marca:      tmp/restauracao/PENDENTE
3. Pedir para o usuário fechar o ERP
4. NA PRÓXIMA ABERTURA, antes de abrir qualquer conexão:
   - achou a marca? renomeia o atual para banco-antigo-<data>.db
   - move o restaurado para o lugar
   - só então abre a conexão e continua o boot normal
```

A troca acontece no boot, com zero conexões abertas. É o único momento em que ela é
segura, e não depende de o usuário fazer nada certo além de reabrir o programa.

### E.4 — Verificar é o que separa seguro de fé

Cada zip carrega um `manifest.json` (ver A.2). Depois de baixar:

1. **O zip abre?** Zip corrompido no meio da rede acontece.
2. **A lista bate?** Todo arquivo do `manifest.json` saiu na descompactação, com o
   tamanho declarado.
3. **O banco abre?** `PRAGMA integrity_check` antes de considerar o arquivo bom.
4. **O schema é compatível?** O `manifest.json` do banco traz a versão do schema. Backup
   de um ERP mais novo que o instalado **não** pode ser restaurado em silêncio — ou o
   ERP atualiza primeiro, ou recusa com mensagem clara.

**`indisponiveis` não vazio = restauração parcial.** Diga ao usuário **quais meses** vão
faltar e peça confirmação explícita antes de seguir. Acervo com buraco que se apresenta
como completo é o pior resultado possível desta tela.

### E.5 — "Testar meu backup" — **isto é fase 1**, não restauração

Um botão que baixa, verifica (E.4) e joga fora, sem restaurar nada.

**Não pertence a esta seção na prática, e por isso não deve esperar por ela.** É o único
item aqui que não depende da troca do SQLite, da ordem de restauração, nem de nada
destrutivo — reaproveita o download e a verificação e para por aí. Preso à restauração,
ele herdaria um cronograma que não tem dono nem data.

Na fase 1 ele custa pouco e paga muito: é o que transforma o backup de promessa em fato
verificado. Rodando uma vez por mês em segundo plano, o cliente descobre que o backup
está quebrado num dia comum, e não no dia em que o HD morreu.

### E.6 — Integridade do download: por tipo, não em todo lugar

O `checksumSha256` que o servidor guarda é o hash do **manifesto**, não dos bytes do
zip — foi assim de propósito, para o dedupe ser estável (A.2). A consequência é que ele
**não serve para verificar o download**: baixar o arquivo e comparar não é possível.

A pergunta é o que preencher essa lacuna, e a resposta é diferente por tipo:

| Tipo | Como verificar | Precisa de `checksumZipSha256`? |
|---|---|---|
| `banco` | `PRAGMA integrity_check` no arquivo restaurado | **não** |
| `imagens`, `os` | CRC do zip + lista do `manifest.json` interno | opcional, ajuda |

**Em `banco` o `integrity_check` é melhor que um hash de bytes**, não só suficiente. Um
hash prova que o download bateu com o upload; o `integrity_check` prova que o banco é
internamente consistente — pega também o caso do arquivo já ter subido corrompido, que é
o que realmente importa na hora de restaurar. Comparar bytes ali é responder a pergunta
mais fraca.

Nos zips não há equivalente semântico, mas a cobertura já é razoável: o zip tem CRC por
entrada, e o `manifest.json` interno denuncia arquivo faltando. Um
`checksumZipSha256` acrescentaria a garantia ponta a ponta barata — não precisa ser
estável entre envios (o zip não é determinístico, e tudo bem), porque o uso é outro.

**Nada disso foi feito**, e o escopo encolheu: se entrar, entra só para `imagens` e `os`.

---

## Resumo das constantes

| Constante | Valor | Onde muda |
|---|---|---|
| Tamanho mínimo | 1 KB | `backup.schema.ts` |
| Tamanho máximo | 500 MB | `backup.schema.ts` |
| Cota diária `banco` | 2 | env `BACKUP_LIMITE_DIARIO_BANCO` |
| Cota diária `imagens` | 2 | env `BACKUP_LIMITE_DIARIO_IMAGENS` |
| Cota diária `os` (mês corrente) | 2 | env `BACKUP_LIMITE_DIARIO_OS` |
| Cota diária de backfill (meses fechados) | 12 | env `BACKUP_LIMITE_BACKFILL_DIARIO` |
| Corte do mês (`periodoCorrente`) | `America/Sao_Paulo`, relógio do servidor | `backup.repository.ts` |
| Corte do dia | 00:00 `America/Sao_Paulo`, relógio do servidor | `backup.repository.ts` |
| TTL da URL de upload | 30 min | `storage.service.ts` |
| TTL da URL de download | **5 min** — não acompanha o de upload, ver nota | `storage.service.ts` |
| Vaga órfã expira | 60 min (= TTL + 30, **derivado**), varrido a cada 10 min | `cron.service.ts` |
| Queda suspeita (só automático) | < 50 % do último confirmado do mesmo escopo → 409 | `erp-backup.service.ts` |
| Força envio de espelho | 7 dias com checksum igual (**não** vale para pedaço fechado) | `erp-backup.service.ts` |
| Retenção dos arquivos | 90 dias após licença não-ATIVA | `cron.service.ts` |
| Avisos de retenção | dias 75 e 83 | `cron.service.ts` |
| Retenção do histórico | 180 dias | `cron.service.ts` |

**Dois invariantes entre essas constantes:**

1. **TTL de upload < janela da órfã.** Garantido no código: a janela é derivada do
   TTL (`TTL_UPLOAD_SEGUNDOS / 60 + 30`). Se os dois se igualarem, upload lento e
   legítimo é marcado `FALHOU` enquanto ainda sobe.
2. **TTL de download NÃO acompanha o de upload.** A assimetria é deliberada: URL de
   escrita vazada deixa alguém gravar lixo num caminho fixo, com tamanho travado na
   assinatura; URL de leitura vazada entrega o banco inteiro do cliente. Subir o de
   upload é barato, o de download não é.

## Códigos de erro

Trate **sempre** pelo campo `codigo`. As mensagens são escritas para o usuário final
e podem mudar.

| HTTP | `codigo` | Repetir? |
|---|---|---|
| 400 | `BACKUP_DADOS_INVALIDOS` | não — bug no ERP |
| 400 | `BACKUP_CHECKSUM_OBRIGATORIO` | não — falta o checksum em `imagens` ou `os` |
| 400 | `BACKUP_PERIODO_FUTURO` | não — mês que ainda não terminou de existir |
| 403 | `BACKUP_PLANO_INATIVO` | não — mostrar a mensagem |
| 403 | `BACKUP_HWID_DIVERGENTE` | não — reconectar antes |
| 404 | `BACKUP_LICENCA_NAO_ENCONTRADA` | não |
| 404 | `BACKUP_NAO_ENCONTRADO` | não — `uploadId` desconhecido |
| 404 | `BACKUP_INEXISTENTE` | não — nada para restaurar |
| 409 | `BACKUP_TAMANHO_SUSPEITO` | não — refazer pelo botão manual |
| 409 | `BACKUP_ARQUIVO_AUSENTE` | sim, no próximo ciclo |
| 409 | `BACKUP_TAMANHO_DIVERGENTE` | sim, no próximo ciclo |
| 429 | `BACKUP_LIMITE_DIARIO` | **não** — só amanhã |
| 429 | `BACKUP_LIMITE_BACKFILL` | **não** — o backfill continua amanhã de onde parou |
| 503 | `BACKUP_NAO_CONFIGURADO` | sim, no próximo ciclo — é o servidor |

---

## Mudanças já aplicadas no servidor

Todas conferidas com `tsc --noEmit` limpo. **Ainda não estão em produção** — sobem no
próximo deploy.

| # | Mudança | Onde |
|---|---|---|
| 1 | Cota de `imagens` 1 → **2**/dia | `erp-backup.service.ts` |
| 2 | TTL da URL de upload 600 → **1800 s** | `storage.service.ts` |
| 3 | `checksumSha256` exposto em `copiaAtual` | `erp-backup.service.ts` |
| 4 | `codigoBloqueio` novo no `/status` | `erp-backup.service.ts` |
| 5 | Checksum por manifesto na doc do ERP | `erp-portas-de-entrada.md` §7 |
| 6 | Janela da órfã **derivada** do TTL, não mais 60 fixo | `cron.service.ts` |

O TTL de **download** não foi tocado: continua em 300 s. Só o de upload foi para 1800.

Nenhuma é breaking: 1 e 2 afrouxam limites, 3 e 4 acrescentam campos, 5 é documentação.
Um ERP escrito contra a versão anterior continua funcionando.

## O dimensionamento que motivou a partição

> **Implementado.** A partição descrita abaixo saiu do papel — ver a seção **D** para o
> contrato do lado do ERP. Esta seção fica como registro do raciocínio, e o número do
> cliente ainda importa: ele diz o tamanho do backfill inicial e se algum mês isolado
> se aproxima do teto.

### O que dimensiona não é o catálogo

A recomendação da A.1 (reduzir a foto no cadastro) **já está aplicada** neste ERP: foto
de produto é gravada em WebP a 1200 px. O catálogo não é o problema, e ele estabiliza —
uma loja tem um número finito de produtos.

Quem enche a pasta é **foto de ordem de serviço**: 1920 px, várias por OS, entrando
todo dia e **nunca saindo**. Essa pasta cresce linearmente para sempre.

Isso muda a natureza do problema. Não é "cabe ou não cabe em 500 MB" — é "em quanto
tempo estoura", e a resposta é sempre *estoura*.

**Ordem de grandeza**, a 300 KB por foto de 1920 px:

| Volume de OS | Por dia | Estoura 500 MB em |
|---|---|---|
| 5 OS/dia × 3 fotos | 4,5 MB | ~3,5 meses |
| 10 OS/dia × 4 fotos | 12 MB | ~6 semanas |

### O problema real era a repetição, não o teto

Com pasta append-only, o modelo atual — **um zip completo, sobrescrito todo dia** —
tem dois defeitos que pioram com o tempo:

1. **O dedupe fica inútil.** Ele só dispara quando *nada* mudou. Numa oficina que abre
   OS todo dia, nunca é o caso. Todo dia é upload completo.
2. **A banda cresce sem limite.** Quando a pasta chegar a 400 MB, o ERP sobe 400 MB
   toda noite — dos quais 99 % são fotos de meses atrás, que não mudaram e nunca vão
   mudar. Subir o teto para 2 GB só piora: passa a subir 2 GB por noite.

Subir o teto sozinho **não resolve**, e ainda cria problema novo: 2 GB numa janela de
30 min exigiriam ~8,9 Mbps sustentados, e a falha volta como o `403` enganoso de antes.

### A saída que o formato dos dados sugere

Foto de OS é **write-once**: depois de anexada à ordem, nunca mais muda. Isso pede
backup **por período**, não por espelho:

```
clientes/<clienteId>/<licencaId>/imagens-2026-05.zip   ← fechado, sobe UMA vez
clientes/<clienteId>/<licencaId>/imagens-2026-06.zip   ← fechado, sobe UMA vez
clientes/<clienteId>/<licencaId>/imagens-2026-07.zip   ← mês corrente, sobe todo dia
```

Mês fechado nunca mais sobe. O envio diário passa a ser só o mês corrente — dezenas de
MB, constante, **não cresce com a idade da instalação**. Restauração baixa todos os
pedaços. O teto de 500 MB deixa de ser relevante, porque nenhum pedaço chega perto.

**Custo, que foi pago:** a chave deixou de ser fixa, o bucket passou a acumular objetos
por período, e retenção/download/`copiaAtual` passaram a lidar com N arquivos. A
retenção foi a única parte que não mudou nada — ela já apagava por prefixo.

### O número que ainda falta

A direção não dependia dele, mas duas coisas dependem: o tamanho do backfill inicial
(quantos meses o cliente vai subir na primeira semana) e se algum mês isolado chega
perto do teto de 500 MB. Rode na máquina do cliente e mande a saída:

```powershell
# Ajuste o caminho para a pasta de dados do ERP
$raiz = "C:\caminho\para\dados"

Get-ChildItem $raiz -Directory | ForEach-Object {
    $arqs = Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue
    $novos = $arqs | Where-Object { $_.CreationTime -gt (Get-Date).AddDays(-30) }
    [PSCustomObject]@{
        Pasta          = $_.Name
        Total_MB       = [math]::Round(($arqs | Measure-Object -Sum Length).Sum / 1MB, 1)
        Arquivos       = $arqs.Count
        Media_KB       = if ($arqs.Count) { [math]::Round(($arqs | Measure-Object -Average Length).Average / 1KB, 1) } else { 0 }
        Ultimos30d_MB  = [math]::Round(($novos | Measure-Object -Sum Length).Sum / 1MB, 1)
        Ultimos30d_Qtd = $novos.Count
    }
} | Sort-Object Total_MB -Descending | Format-Table -AutoSize
```

Ele quebra por pasta, então responde de uma vez: qual pasta domina, o tamanho atual, o
tamanho médio real do arquivo e — o que mais importa agora — **quanto entrou nos
últimos 30 dias**, que é a taxa de crescimento.
