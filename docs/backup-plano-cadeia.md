# Backup — plano da cadeia (full semanal + fragmentos)

> **Fechado em 03/08/2026**, numa rodada de alinhamento com o Carlos. Nada deste
> documento está implementado. Ele substitui o desenho de três pacotes
> (`banco`/`imagens`/`os`) que está em produção hoje.
>
> Substitui também a proposta enviada em [`backup-contrato-resposta-v2.md`](./backup-contrato-resposta-v2.md)
> nos pontos 4 e 5 — as razões da mudança estão na seção 6. O que continua
> valendo daquele documento está marcado na seção 5.

---

## 1. O desenho, em uma tela

```
Primeiro login de segunda   →  FULL       banco completo + todas as fotos, 1 zip
Ter, qua, qui, sex, sáb, dom →  FRAGMENTO  só o que é novo, 1 zip
Full novo confirmado na nuvem →  apaga o ciclo anterior inteiro
```

Quatro propriedades que sustentam o resto:

**O gatilho é o login, não a madrugada.** O PC do cliente pode estar desligado à
noite. O backup dispara quando alguém abre o ERP no começo do dia.

**O ciclo é ancorado na segunda-feira, não num contador.** Contador é estado:
some numa reinstalação, diverge entre as duas pontas, e ninguém mais sabe em que
dia do ciclo está. A segunda-feira de referência (`2026-08-03`) os dois lados
calculam a partir da data e sempre chegam no mesmo valor — e é o próprio nome da
pasta no bucket.

**Quem decide se sobe é o código do JSON.** O ERP mantém uma pasta de pendentes
alimentada no momento da escrita (não é diff varrido à noite — é staging). Todo
login ele manda o código; comparamos com o do último envio **confirmado**; igual
→ não sobe nada; diferente → assinamos a URL.

**Fragmento é por tabela e por arquivo.** Mudou a tabela de vendas, vai a tabela
de vendas inteira; entraram 5 fotos, vão as 5 fotos. Tudo dentro do mesmo zip.

### Por que isso restaura sem motor de replay

Granularidade por tabela dá a mesma semântica dos arquivos: **a última versão
vence.** Restaurar é extrair o full e depois cada fragmento em ordem, sobrescrevendo.
Um algoritmo só para banco e fotos, sem merge de registros.

A integridade referencial se sustenta por construção: se uma venda nova aponta
para um cliente novo, as duas tabelas mudaram no mesmo dia e as duas estão no
mesmo fragmento. Não existe venda órfã.

### Regras de borda

| Situação | Regra |
|---|---|
| Primeiro backup do cliente | é **full**, em qualquer dia da semana — não há contra o que ser incremental |
| Oficina fechada na segunda | o full é do **primeiro login do ciclo**, não do dia da semana. Terça assume |
| Máquina desligada dias seguidos | a unidade é "tudo que está pendente", não "o dia de ontem". A pasta acumula sozinha |
| Full da semana falhou | o ciclo continua aberto e o anterior **não** é apagado. Tenta de novo no próximo login |

---

## 2. Concorrência entre máquinas — o lock mora aqui

A oficina tem estações. O ERP dispara "assim que loga", então três logins às 8h
seriam três backups do mesmo cliente escrevendo na mesma chave e queimando a cota
antes das 9h.

Fazer esse lock na rede local é frágil: se a máquina servidor está desligada,
não há quem arbitre. **O lock fica no nosso banco**, onde o estado já existe:

```
Terminal A pede    → não há envio pendente → ENVIAR + uploadId
Terminal B pede    → há envio pendente e não vencido
                   → AGUARDANDO_OUTRO_TERMINAL (não é erro, não consome cota)
A confirma         → ciclo fechado; B não precisa fazer nada
A falha (ok:false) → libera na hora; B pode assumir
A some no meio     → o cron de órfãos libera ao vencer a URL
```

Desempate é sempre o mesmo: quem chegou primeiro com um envio válido. A
prioridade da máquina servidor fica do lado do ERP — ela tenta primeiro, os
terminais esperam alguns minutos antes de tentar.

---

## 3. O contrato novo

### 3.1 `POST /erp/backup/url-upload`

```jsonc
{
  "hwid": "...",
  "tipo": "full" | "fragmento",
  "ciclo": "2026-08-03",         // a segunda de referência, vinda do /status
  "tamanhoBytes": 31457280,      // exato ao byte — entra na assinatura
  "codigoConteudo": "9f2c...",   // o código do JSON; obrigatório SEMPRE
  "origem": "AUTOMATICO" | "MANUAL"
}
```

Respostas:

```jsonc
{ "acao": "ENVIAR", "uploadId": "...", "url": "...", "chave": "...",
  "metodo": "PUT", "headers": { ... }, "expiraEm": "..." }

{ "acao": "PULAR", "motivo": "Nada mudou desde o último envio confirmado.",
  "ultimoEm": "..." }

{ "acao": "AGUARDANDO_OUTRO_TERMINAL", "desde": "2026-08-04T08:03:00Z",
  "motivo": "Outro terminal está enviando o backup de hoje." }
```

### 3.2 Chaves no bucket

```
clientes/{clienteId}/{licencaId}/ciclos/2026-08-03/full.zip
clientes/{clienteId}/{licencaId}/ciclos/2026-08-03/frag-2026-08-04.zip
clientes/{clienteId}/{licencaId}/ciclos/2026-08-03/frag-2026-08-05.zip
```

O `licencaId` continua no caminho porque um cliente pode ter várias licenças,
cada uma com seu banco local — sem ele, duas lojas do mesmo dono se sobrescrevem.

A pasta `ciclos/` existe para que a rotação seja **estruturalmente** incapaz de
alcançar qualquer coisa que não seja um ciclo. Mesmo espírito do P2 do contrato
do Carlos: a chave é montada no servidor, então não há string a sanitizar.

### 3.3 `GET /erp/backup/status` — campos novos

```jsonc
"cicloCorrente": "2026-08-03",       // a segunda de referência, pelo NOSSO relógio
"fullDoCicloConfirmado": false,      // false → o próximo envio é full
"envioEmAndamento": { "hwid": "...", "desde": "..." } | null
```

`cicloCorrente` vem do servidor pelo mesmo motivo que `periodoCorrente` vinha:
máquina de cliente com data errada faria o full no dia errado, ou nunca.

### 3.4 `POST /erp/backup/url-download`

Passa a devolver **a corrente ordenada** — o full do ciclo mais os fragmentos na
ordem de extração — em vez de "o último espelho" ou "todos os pedaços de OS".
Pedaço registrado que sumiu do bucket continua sendo reportado em
`indisponiveis`: restauração com buracos que se apresenta como completa é o pior
resultado possível do sistema.

---

## 4. A refatoração, arquivo por arquivo

### O que sobrevive sem tocar

- URL assinada com `Content-Length` dentro da assinatura — é a única proteção
  real de custo, e não muda em desenho nenhum
- Chave montada no servidor a partir da licença, nunca do corpo
- `confirmar` fazendo `HEAD` e não confiando no `ok` do cliente
- Gate de licença/plano (`carregarLicencaLiberada`) e conferência de HWID
- O par código-do-conteúdo → `PULAR`, que já é exatamente o mecanismo do Carlos

### O que muda

| Arquivo | Mudança |
|---|---|
| `packages/schemas/src/backup/backup.schema.ts` | `tipo` vira `full \| fragmento`; `periodo` (AAAA-MM) vira `ciclo` (AAAA-MM-DD); `checksumSha256` vira `codigoConteudo` e passa a ser **obrigatório sempre**; cai o par de `refine` de tipo/periodo |
| `prisma/schema.prisma` | enum `TipoBackup` novo; `periodo` → `ciclo`; coluna `sequencia`; índice `[licencaId, ciclo, tipo, status]`; migration |
| `backup.repository.ts` | `findUltimoBackupConfirmado` passa a ser por ciclo; novas `findFullDoCiclo`, `findCorrenteDoCiclo`, `findEnvioPendente` (o lock), `findCiclosAnteriores` |
| `erp-backup.service.ts` | reescrita do `urlUpload` (lock + ciclo + full/fragmento); `urlDownload` devolvendo corrente ordenada; `status` com os três campos novos |
| `storage.service.ts` | `removerChaves(chaves[])` — a rotação apaga por chave vinda do inventário, **nunca** por prefixo ou idade |
| `cron.service.ts` | job de rotação (apaga ciclo anterior após full confirmado); varredura de verificação inventário × bucket |
| Painel admin | a tela consome `copiaAtual.{banco,imagens,os}` — quebra inteira |
| `/debug` | o laboratório exercita os três tipos — quebra junto |

### O que morre, e por quê

| Some | Motivo |
|---|---|
| `ehPedacoFechado()` | não existe mais pedaço de mês |
| `LIMITE_BACKFILL_DIARIO` e a cota de backfill | não existe mais backfill de meses antigos |
| `DIAS_FORCA_ESPELHO` (rede dos 7 dias) | o full semanal **é** o reenvio completo forçado. Convergiu |
| A discussão "checksum do manifesto × do zip" | não há mais decisão de dedupe pendurada em hash de pacote |
| A partição por mês | ver a ressalva na seção 6 |

### Duas travas que não podem ser afrouxadas

**O código só vira "último conhecido" depois do `confirmar`.** Se for promovido na
autorização e o upload morrer, no login seguinte o ERP manda o mesmo código, bate,
respondemos "nada novo" — e aquele conteúdo **nunca sobe**. Perda permanente, sem
erro em lugar nenhum. Hoje isso já está certo: a comparação usa
`findUltimoBackupConfirmado`, e a linha pendente não entra na conta.

**`BACKUP_TAMANHO_SUSPEITO` passa a comparar full com full.** Hoje ele compara
contra o último confirmado do mesmo tipo — e um fragmento é, por desenho, muito
menor que o full. Do jeito que está, dispararia em todo primeiro fragmento da
semana.

---

## 5. Plano em fases

Cada fase compila e passa nos testes sozinha. A ordem é a das dependências, não a
da importância.

| # | Fase | Entrega |
|---|---|---|
| 1 | **Schema e dados** | enum novo, `ciclo`, `sequencia`, migration, repositório |
| 2 | **`url-upload` novo** | ciclo corrente, full × fragmento, lock, `AGUARDANDO_OUTRO_TERMINAL` |
| 3 | **`status`** | `cicloCorrente`, `fullDoCicloConfirmado`, `envioEmAndamento` |
| 4 | **`url-download`** | corrente ordenada + `indisponiveis` |
| 5 | **Rotação** | `removerChaves`, job de ciclo, trava do "só depois do full confirmado" |
| 6 | **Verificação** | varredura periódica inventário × bucket (substitui o re-baseline que o full dava de graça) |
| 7 | **Painel e `/debug`** | telas e laboratório no vocabulário novo |
| 8 | **Docs** | reescrever `erp-portas-de-entrada.md` e `erp-backup-contrato.md` |

A fase 6 merece uma linha de justificativa: o full semanal tinha uma segunda
função que ninguém tinha nomeado — **re-baseline**. Fragmento corrompido ou sumido
era curado pelo full seguinte, em silêncio. Com o full presente isso continua
valendo, mas depender disso é esperar uma semana para descobrir um problema. A
varredura acha no dia.

---

## 6. Pendências conhecidas

Registradas para não serem descobertas em produção.

**O teto de 5 GB do PUT único.** O full leva banco + acervo inteiro num zip só.
Acima de 5 GB não existe PUT único — é limite do protocolo S3/R2, não nosso, e a
única saída é multipart. A ~12 MB/dia de fotos, um cliente cruza isso com **cerca
de 14 meses de operação**. O conserto não mexe na lógica do ciclo: o full sai em
partes e o marco que libera a rotação passa a ser a confirmação da última parte.
Não é para agora; é para não travar sem aviso quando o primeiro cliente antigo
chegar lá.

**O `BACKUP_TAMANHO_MAX_BYTES` de 500 MB.** Trava antes disso — um cliente com
seis semanas de operação já estoura no full. Precisa subir junto com a fase 2.

**A carga inicial de cliente antigo.** No primeiro backup a pasta de pendentes
contém o acervo inteiro: vários GB num zip só, contra o teto e contra uma janela
de upload em horário comercial. Acontece com todo cliente existente, uma vez, no
dia em que o recurso for ligado. Precisa de tratamento próprio — fatiado, ao longo
de vários dias.

**Granularidade por tabela economiza menos do que parece.** As tabelas que mudam
todo dia são as grandes (vendas, OS, itens, estoque, clientes); as que nunca mudam
são as pequenas (cidades, tipos, configurações). "Só a tabela que mudou" de um
banco de 30 MB tende a mandar 15–25 MB de qualquer jeito. Se o controle por tabela
der trabalho no ERP, saber que ele economiza pouco ajuda a decidir se vale manter.

**A partição por mês some, e ela resolvia uma coisa que o full não resolve.**
Pedaço de mês fechado subia **uma vez e nunca mais**. No desenho novo, o acervo
inteiro volta a subir toda semana dentro do full. Enquanto o cliente é novo isso
é irrelevante; num cliente de dois anos são 8,6 GB por semana, em horário
comercial. É a mesma causa do item dos 5 GB, e provavelmente o mesmo conserto —
full em partes, com as partes que não mudaram desde o full anterior sendo
puladas.

---

## 6.1 Procedimento de subida (primeira vez)

Esta subida tem um passo a mais que as outras, e ele existe por um motivo
específico: o `npm run deploy` roda `prisma db push`, e o `db push` **não olha só
a parte de backup** — ele compara o schema inteiro com o banco inteiro e alinha
tudo que estiver diferente. Como este projeto nunca gerou migration para a tabela
`backups` (as duas em `prisma/migrations/` são de abril e maio e não a
mencionam), o banco de produção pode ter divergências acumuladas em outras
tabelas, e o push tentaria "corrigir" aquilo no mesmo comando, com a API já
reiniciando.

```bash
# 1. captura o prefixo ANTES de apagar as linhas — é o inventário que sabe
#    quais objetos existem no R2. Sem ele, viram órfãos pagos para sempre.
psql "$(grep -m1 '^DATABASE_URL=' apps/server/.env | cut -d= -f2- | tr -d '"' | cut -d'?' -f1)" \
  -c 'SELECT DISTINCT "clienteId", "licencaId" FROM backups;'

# 2. apaga os objetos do prefixo no painel da Cloudflare (R2 → bucket → busca)

# 3. esvazia o inventário — é isto que destrava o db push, porque o enum
#    TipoBackup perdeu BANCO/IMAGENS/OS e não há conversão automática
psql "..." -c 'DELETE FROM backups;'

# 4. traz o código
git pull && npm install

# 5. ⚠ CONFERE o que o db push faria. Leitura pura, não altera nada.
npx prisma migrate diff \
  --from-url "$(grep -m1 '^DATABASE_URL=' apps/server/.env | cut -d= -f2- | tr -d '"')" \
  --to-schema-datamodel prisma/schema.prisma --script

#    esperado: só TYPE de TipoBackup/StatusBackup e ALTER TABLE backups.
#    se aparecer ALTER em clientes/licencas/planos/usuarios → PARA.

# 6. aplica
npm run db:push && npm run build && pm2 restart api web --update-env
```

**Não use `npm run deploy` nesta subida** — ele encadeia pull, push, build e
restart num comando só e não deixa olhar o diff no meio. Nas próximas volta ao
normal.

---

## 7. Restrições de ambiente

- **Supabase local fora do ar** — o que toca Prisma falha por isso, não por bug.
  Dá para escrever e compilar (`tsc --noEmit`); não dá para exercitar integração.
- **Sem ambiente de staging** — nada sobe na VPS até essa separação existir.
- A partição por mês, feita no ciclo anterior, nunca chegou a ser exercitada em
  ambiente real. Está sendo substituída sem ter rodado uma vez.

---

## 8. Em aberto

| # | Pergunta | Trava o quê |
|---|---|---|
| 1 | Existe algum cliente com backup no bucket hoje? | Se não, a fase 1 é uma quebra limpa, sem migração de dados nem compatibilidade retroativa |
| 2 | O ERP dispara o backup em qual máquina, e como decide? | O lock do lado do servidor funciona de qualquer jeito, mas a prioridade da máquina servidor é regra do lado deles |
| 3 | Cota diária faz sentido com gatilho por login? | Hoje são 2/dia por tipo. Com login + lock, provavelmente vira N/dia por licença |
