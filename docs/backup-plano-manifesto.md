# Backup — plano do manifesto

> **Parada em 30/07/2026.** Nada deste documento está implementado. Ele registra o
> que foi decidido numa rodada de debate com o Carlos, o que foi descartado e por
> quê, e o que falta responder antes de escrever código.
>
> Complementa — e em alguns pontos **corrige** — o
> [`erp-backup-contrato.md`](./erp-backup-contrato.md). Onde os dois divergirem,
> este vale, e a correção do outro está listada na seção 7.

---

## 1. Onde paramos

O ponto de partida foi uma observação do Carlos: **se uma foto for trocada por
outra, o backup não tem como saber.** A investigação confirmou que o problema é
real e maior do que a doc admitia, e a discussão passou por quatro propostas até
chegar num desenho fechado.

O resumo em uma frase: **o servidor não precisa dos bytes, precisa do índice.**
Um manifesto de um mês inteiro de OS tem ~175 KB; as fotos desse mesmo mês têm
~50 MB. É 0,3% do tamanho e carrega toda a informação necessária para decidir.

---

## 2. O que ficou decidido

### 2.1 Três pacotes, não um zip só

O ERP havia sido escrito para mandar **um zip único** com as pastas `bd`,
`imagens` e `laudo` dentro. Descartado. Fica o que já existe:

```
banco.zip            ← bd (laudos incluídos)      ESPELHO, sobe todo dia
imagens.zip          ← catálogo de produtos       ESPELHO, muda raramente
os-AAAA-MM.zip       ← fotos de OS + de laudo     PEDAÇO mensal
```

**O motivo é aritmético.** Um zip = um checksum. O `bd` muda todo dia, então o
checksum do conjunto muda todo dia, então **nada nunca dá `PULAR`** e tudo sobe
toda madrugada. Numa oficina de 10 OS/dia × 4 fotos (~12 MB/dia), o pacote
unificado bate no teto de 500 MB em **~6 semanas** — e a partir daí o
`url-upload` responde `400` e o cliente fica **sem backup nenhum, inclusive do
banco de dados**.

A separação não é organização, é **isolamento de falha**: hoje, se a pasta de
fotos explodir, o `banco.zip` continua subindo.

O retrabalho no ERP é pequeno: é o mesmo código de zipar, chamado três vezes com
listas de arquivos diferentes.

### 2.2 O laudo não vira pacote

Chegou a ser proposto um quarto tipo (`laudo-AAAA-MM.zip`). **Cancelado**, porque:

- o **laudo** é gravado no banco → já vai dentro do `banco.zip`;
- as **fotos de laudo** ficam na pasta de OS → já vão dentro do `os-AAAA-MM.zip`.

Some junto a preocupação com "laudo reaberto": como `banco.zip` é espelho
(sobrescreve todo dia), reabrir um laudo de maio simplesmente entra no dump desta
noite. Custo zero, complexidade zero.

Foto nova anexada em julho a um laudo de maio vai para o pedaço de **julho** — o
mês é o da `data_criacao` da própria foto (regra D.1.1, já em vigor). Maio não
muda.

**Nenhuma mudança de servidor é necessária por causa de laudo.**

### 2.3 `/avaliar` — o JSON vem antes do zip

Endpoint novo. Separa **decidir** de **assinar**:

```
1. POST /erp/backup/avaliar     { tipo, periodo, inventario|manifesto }
      ↑ sem tamanho, sem zip — nada foi empacotado ainda
      → { acao: "PULAR" | "ENVIAR" | "RECUSAR", motivo }

2. só se ENVIAR: o ERP zipa e mede

3. POST /erp/backup/url-upload  { tipo, periodo, tamanhoBytes, checksum }
      → URL assinada (fluxo atual, inalterado)
```

**O `tamanhoBytes` não sai do `url-upload`.** Chegou a ser proposto trocá-lo pelo
JSON; não dá. Ele entra na assinatura criptográfica da URL
(`signableHeaders: new Set(['content-length'])`,
[storage.service.ts:149](../apps/server/src/common/storage/storage.service.ts#L149)),
e é o que faz o bucket recusar qualquer corpo com tamanho diferente — a única
coisa que impede um "backup de 30 MB" chegar como 4 GB. Precisa ser exato ao byte
e existir **antes** da assinatura. Não é derivável do manifesto: o tamanho do zip
não é a soma dos tamanhos dos arquivos (cabeçalho por entrada, diretório central,
alinhamento), e errar em 1 byte dá `403 SignatureDoesNotMatch`.

O tamanho exato adiantado é, precisamente, **o preço de não passar o arquivo pela
VPS**.

O que o `/avaliar` ganha:

- acaba o zip desperdiçado (hoje o ERP zipa para descobrir o tamanho e só depois
  ouve `PULAR`);
- a decisão passa a ser do **servidor**, corrigível num deploy, em vez de morar no
  desktop de cada cliente;
- a recusa acontece **antes** do trabalho caro.

Não consome cota — igual ao `PULAR` de hoje, a vaga só é ocupada quando a URL é
assinada.

### 2.4 Nível 1 → Nível 2

**Nível 1 — resumo (~100 bytes).** Campo novo no corpo:

```jsonc
"inventario": { "arquivos": 1200, "novos": 0, "alterados": 1190, "removidos": 0 }
```

O servidor cruza com o envio anterior e ganha uma terceira resposta:

```jsonc
{ "acao": "RECUSAR", "codigo": "BACKUP_ALTERACAO_ANOMALA",
  "motivo": "1.190 de 1.200 arquivos de um mês fechado mudaram. A cópia da nuvem foi preservada." }
```

Limiar sugerido: recusar quando `alterados` passar de ~30% **e** de ~20 arquivos
num mês fechado — configurável por env, como os outros limites. Uma foto trocada
(1 de 1.200) é normal e passa.

**Nível 2 — manifesto do mês (~175 KB, só quando há novidade).** O ERP continua
comparando o checksum contra o `/status` de graça; **só quando um mês difere** ele
manda o manifesto completo daquele mês, e o servidor faz o diff ele mesmo.

```jsonc
{ "pasta": "os", "nome": "foto-4471-02.jpg", "tamanho": 312044,
  "data_criacao": "2026-07-14T10:22:31Z", "atualizado_em": "...", "hash_sha256": "..." }
```

**O Nível 2 é requisito, não refinamento.** O Nível 1 confia no diff do próprio
ERP: se ele for cego para uma mudança, reporta `0 alterados` e o servidor acredita.
Como agora se sabe que meses fechados mudam de verdade (seção 4), e como pedaço
fechado não tem a rede de proteção dos 7 dias, um mês alterado poderia ficar
congelado indefinidamente. Com o servidor guardando o manifesto anterior, a lógica
de diff do ERP deixa de ser autoridade.

### 2.5 Hash na escrita — lado ERP

Pré-requisito de tudo acima. **Não** relendo os bytes toda noite (8,6 GB num
cliente de 2 anos, 3 minutos de disco moendo por madrugada, crescendo para
sempre), e sim gravando na linha do banco no momento em que o arquivo é salvo:

```
ordem_servico_fotos
  + hash_sha256    char(64)    ← preenchido no INSERT e no UPDATE da substituição
  + atualizado_em  timestamp   ← tocado em qualquer substituição
```

Como a substituição de foto **já faz UPDATE na linha** (confirmado), isso é uma
coluna a mais num caminho de escrita que já existe. Custo em runtime:
milissegundos, com os bytes já em memória durante o redimensionamento. Mais um job
único para preencher o histórico.

**O mínimo que fecha o caso do Carlos é só o `atualizado_em`.** O `hash_sha256`
acrescenta duas coisas que valem: verificação na restauração (o `manifest.json`
dentro do zip prova arquivo por arquivo) e um diff no servidor que significa "o
conteúdo mudou" em vez de "alguém tocou no timestamp".

Nenhum dos dois enxerga alteração feita **por fora** do ERP (Explorer, ransomware)
— e nesse caso a cegueira é proteção, não defeito: o ERP não sobe nada e a cópia
boa da nuvem sobrevive.

---

## 3. O que foi descartado, e por quê

Registrado para não voltar.

| Proposta | Veredito | Motivo |
|---|---|---|
| **Um zip só** com `bd`/`imagens`/`laudo` | ❌ | Mata o dedupe (o `bd` muda todo dia), estoura 500 MB em ~6 semanas e leva o backup do banco junto |
| **Arquivo passando pela VPS**, que repassa ao R2 | ❌ | Não resolve o problema do Carlos (o ERP não manda o que não percebe), dobra a banda, prende a conexão por até 30 min por loja, disputa I/O com o Postgres que está no mesmo box e põe a VPS no caminho crítico — hoje o backup termina mesmo com a API no chão |
| **Verificar relendo todos os arquivos** toda noite | ❌ | Custo cresce para sempre; é a doença que a partição por mês curou |
| **JSON no lugar do `tamanhoBytes`** | ⚠️ invertido | O tamanho é a assinatura, não metadado. Virou: JSON antes (`/avaliar`), tamanho depois (`url-upload`) |
| **Quarto tipo `laudo`** | ❌ | Laudo mora no banco e foto de laudo mora na pasta de OS — os dois já estão cobertos |

**Sobre a proxy pela VPS, vale guardar o raciocínio:** o que a motivava era o
servidor poder olhar o conteúdo. O manifesto entrega exatamente isso por ~0,3% do
custo, sem tirar o backup da rota direta para o R2.

**Correção registrada:** durante o debate o `RECUSAR` foi apresentado como proteção
contra ransomware. Não é. Com o hash calculado na escrita, um ransomware que cifre
as fotos por fora não é visto pelo ERP, que não sobe nada — a cópia boa sobrevive
por construção. O `RECUSAR` protege contra alteração em massa **legítima porém
indesejada**: reprocessamento de imagens, migração que reescreve linhas, bug que
toca milhares de registros. Continua valendo, só não é aquele escudo.

> **Fora de escopo, mas anotado:** o `banco.zip` **não** tem essa imunidade. Um
> `.db` cifrado ainda seria zipado e enviado, e o `QUEDA_SUSPEITA` só pega
> encolhimento, não cifra. Merece uma conversa própria.

---

## 4. A premissa que caiu

Está escrita na doc **e** sustenta uma decisão no código:

> Em pedaço fechado o conteúdo é imutável de verdade, então checksum igual
> significa mesmo "nada mudou".
> — [erp-backup.service.ts:275](../apps/server/src/features/erp/erp-backup.service.ts#L275)

**É falsa.** O ERP tem botão de substituir foto de OS, e laudo pode ser reaberto.
Um pedaço de maio pode mudar em julho.

**Isso não derruba a partição.** O valor dela nunca foi "mês fechado nunca muda",
foi "mês fechado muda **raramente**, então o envio diário é só o mês corrente".
Uma alteração retroativa custa o reenvio de **um** pedaço — exatamente o que a cota
de backfill (12/dia) existe para absorver.

**O que cai é a dispensa da rede de proteção.** Hoje `ehPedacoFechado()` isenta o
pedaço fechado do reenvio forçado dos 7 dias, e a justificativa era a
imutabilidade. Sem ela, um mês que mudou de verdade poderia ficar congelado para
sempre se o checksum do ERP não perceber. **A resposta não é restaurar a rede**
(reenviar todo mês fechado semanalmente é o custo que a partição eliminou) — é o
Nível 2, com o servidor fazendo o diff a partir do manifesto que ele guardou.

Consequência boa da resposta sobre substituição: como o ERP **mantém a mesma linha
e a mesma `data_criacao`**, a foto continua no mês dela. Só **um** pedaço muda, não
há migração entre meses, e o laço diário da D.2 funciona como já está desenhado.

---

## 5. Perguntas em aberto

Nenhuma bloqueia começar o trabalho do servidor.

| # | Pergunta | Por que importa |
|---|---|---|
| 1 | O UPDATE da substituição de foto atualiza a coluna **`tamanho`**? | Se atualiza, o manifesto atual já detecta quase toda troca e só escapa a colisão exata de bytes — buraco bem menor. Se não, é cego a 100% das substituições |
| 2 | O laudo é **texto/estruturado** no banco ou **PDF em blob**? | Blob a ~300 KB × 5/dia faz o `banco.zip` (espelho, não particionável) sair dos ~30 MB de hoje e bater nos 500 MB em **menos de um ano** — e então o backup do banco para. Se for blob, o PDF precisa sair do banco e virar arquivo em pasta particionada |
| 3 | As **fotos de laudo** estão na mesma tabela das fotos de OS? | O manifesto é montado a partir do banco. Se estiverem em outra tabela, a consulta precisa cobrir as duas — senão viram "arquivo órfão" e caem no fallback de `mtime`, que não sobrevive a cópia de pasta: na migração de PC, todas re-particionam para o mês da migração e sobem de uma vez |

---

## 6. Plano de trabalho

### Servidor (nosso lado)

| # | Tarefa | Arquivos |
|---|---|---|
| 1 | Schema do `/avaliar` (Nível 1: `inventario`) | `packages/schemas/src/backup/backup.schema.ts` |
| 2 | Rota `POST /erp/backup/avaliar` | `apps/server/src/features/erp/erp-backup.controller.ts` |
| 3 | Lógica de decisão + `RECUSAR` + limiar por env | `apps/server/src/features/erp/erp-backup.service.ts` |
| 4 | Guardar o inventário do último confirmado | `prisma/schema.prisma`, `packages/database/src/repositories/backup.repository.ts` |
| 5 | Subir o limite de corpo para ~10 MB nas rotas de backup | `apps/server/src/main.ts` |
| 6 | Correções na doc (seção 7) | `docs/erp-backup-contrato.md` |
| 7 | *(depois)* Nível 2 — manifesto completo e diff no servidor | os mesmos |

**Sobre o limite de corpo:** o Nest usa o padrão do body-parser, **100 KB**, e não
há configuração mudando isso no `main.ts`. Um manifesto de mês (~175 KB) toma `413`
de cara. A boa notícia é que o body-parser **já descomprime requisição gzipada por
padrão** — o ERP manda `Content-Encoding: gzip`, os 175 KB viram ~60 KB no fio e
não é preciso código extra de nenhum lado.

**Nada disso é breaking.** Endpoint novo + campo opcional: um ERP escrito contra o
contrato de hoje continua funcionando sem alteração.

### ERP (lado do Carlos)

| # | Tarefa |
|---|---|
| 1 | Voltar de um zip único para os três pacotes |
| 2 | Colunas `hash_sha256` e `atualizado_em`, preenchidas no INSERT **e** no UPDATE da substituição |
| 3 | Job único para preencher o hash do histórico |
| 4 | Manifesto passa a incluir os dois campos novos |
| 5 | Consultar `/avaliar` antes de zipar; tratar `RECUSAR` |
| 6 | Guardar o manifesto anterior localmente para calcular `novos/alterados/removidos` |
| 7 | Gravar o `manifest.json` **dentro** de cada zip (verificação na restauração) |

---

## 7. Correções pendentes na doc

Em [`erp-backup-contrato.md`](./erp-backup-contrato.md):

1. **D.3** — "o caso é teórico" está errado. O ERP tem botão de substituir foto;
   o caso é uma funcionalidade do produto.
2. **D.3** — "foto de OS é escrita uma vez e nunca editada" é falso.
3. **A.2 / A.3** — "em pedaço fechado o conteúdo é imutável de verdade" é falso, e
   com ele cai a justificativa da dispensa da rede dos 7 dias.
4. **D.3, limite conhecido** — o texto descreve o buraco como "troca por arquivo de
   tamanho exatamente igual", o que só valeria se o `tamanho` do manifesto viesse
   do disco. Como vem do banco, e a coluna não é atualizada (a confirmar —
   pergunta 1), **qualquer** troca é invisível, de qualquer tamanho.
5. **A.1 / D.1** — descrever `banco.zip` como contendo também os laudos, e
   `os-AAAA-MM.zip` como contendo fotos de OS **e** de laudo.
6. Acrescentar o comentário no
   [`ehPedacoFechado`](../apps/server/src/features/erp/erp-backup.service.ts#L215),
   que hoje justifica o comportamento com a imutabilidade.

---

## 8. Restrições do ambiente

- **Supabase local fora do ar** — qualquer coisa que toque o Prisma falha por isso,
  não por bug. Dá para escrever e compilar (`tsc --noEmit`); não dá para exercitar
  integração.
- **Sem ambiente de staging** — nada sobe na VPS até essa separação existir.
- A partição por mês, feita no ciclo anterior, **ainda não foi testada em ambiente
  real**. Entra na fila junto.
