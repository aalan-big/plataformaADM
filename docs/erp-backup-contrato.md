# Contrato de backup — OBSOLETO

> **Este documento descrevia o modelo de três pacotes (`banco` / `imagens` / `os`),
> substituído em 03/08/2026 pelo ciclo semanal (FULL + FRAGMENTO).**
>
> O conteúdo antigo foi removido de propósito. Ele descrevia com muita precisão um
> sistema que não existe mais — espelhos de chave fixa, partição de OS por mês,
> cota de backfill, `periodoCorrente`, `checksumSha256` sobre manifesto. Manter
> 900 linhas assim é pior que não ter documentação nenhuma: quem chegasse aqui
> programaria contra um contrato que a API recusa, e passaria um dia achando que
> o erro é dele.
>
> O texto original está no histórico do git, se algum dia precisar do raciocínio.

## Onde está cada coisa agora

| O que você procura | Onde |
|---|---|
| O desenho novo, e por que ele é assim | [`backup-plano-cadeia.md`](./backup-plano-cadeia.md) |
| O que o ERP precisa chamar, campo a campo | [`erp-portas-de-entrada-backup.md`](./erp-portas-de-entrada-backup.md) |
| Licença, conexão, heartbeat e cobrança | [`erp-portas-de-entrada.md`](./erp-portas-de-entrada.md) — **não mudaram** |
| A discussão que levou à mudança | [`backup-contrato-resposta-v2.md`](./backup-contrato-resposta-v2.md) e [`backup-plano-manifesto.md`](./backup-plano-manifesto.md) |

## O resumo em uma tela

A semana é um **ciclo**, aberto na segunda-feira e identificado pela data dela
(`2026-08-03`). O primeiro login do ciclo sobe um **FULL** — o acervo inteiro, na
sequência 0. Os logins seguintes sobem **FRAGMENTOS**, com o que a pasta de
pendentes do ERP acumulou desde o envio anterior.

Quando o full do ciclo novo confirma na nuvem, o servidor apaga o ciclo anterior
— e só pode fazer isso porque o full novo contém tudo o que o velho continha.

Restaurar é extrair o full e depois cada fragmento, **em ordem de sequência**,
sobrescrevendo. A última versão de cada tabela e de cada arquivo vence.
