-- Remove a coluna redundante "tipo" da tabela clientes.
-- O tipo PF/PJ agora é determinado pela presença do registro em clientes_pf ou clientes_pj.
ALTER TABLE "clientes" DROP COLUMN IF EXISTS "tipo";
