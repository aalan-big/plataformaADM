/**
 * Banco em memória para os testes do fiscal.
 *
 * O `@startbig/database` usa `globalThis.prisma` quando ele já existe
 * (`packages/database/src/client.ts`). O `setup.ts` instala ESTE objeto lá antes
 * de qualquer import, e o código de produção passa a falar com ele sem mudar uma
 * linha — nenhum teste precisa de Postgres, e nenhum toca no banco da VPS.
 *
 * Só existem aqui os modelos e as operações que o fiscal usa. Um método que o
 * código chamar e que não estiver aqui estoura `TypeError`, e isso é desejado:
 * o teste acusa que o código passou a depender de algo que ninguém simulou.
 */

type Linha = Record<string, any>

export const tabelas = {
  licenca:             [] as Linha[],
  empresaFiscalConfig: [] as Linha[],
  emissaoLog:          [] as Linha[],
  idempotenciaFiscal:  [] as Linha[],
  consumoFiscal:       [] as Linha[],
  planoModulo:         [] as Linha[],
  licencaModuloExtra:  [] as Linha[],
}

export function reiniciarBanco() {
  for (const tabela of Object.values(tabelas)) tabela.length = 0
}

/** Cópia rasa: o código que recebe a linha não pode alterar a tabela por fora. */
const copia = <T extends Linha | undefined>(linha: T): T | null =>
  (linha ? { ...linha } : null) as T | null

function aplicarDados(linha: Linha, dados: Linha) {
  for (const [campo, valor] of Object.entries(dados)) {
    if (valor && typeof valor === 'object' && 'increment' in valor) {
      linha[campo] = (linha[campo] ?? 0) + valor.increment
    } else if (valor !== undefined) {
      linha[campo] = valor
    }
  }
}

const chaveConsumo = (w: Linha) =>
  (l: Linha) =>
    l.licencaId === w.licencaId &&
    l.competencia === w.competencia &&
    l.ambiente === w.ambiente &&
    l.tipoDocumento === w.tipoDocumento

export const prismaFalso = {
  licenca: {
    findUnique: async ({ where }: Linha) =>
      copia(tabelas.licenca.find(l => l.id === where.id)),
  },

  empresaFiscalConfig: {
    findUnique: async ({ where }: Linha) =>
      copia(tabelas.empresaFiscalConfig.find(c => c.clienteId === where.clienteId)),
    create: async ({ data }: Linha) => {
      // `cnpj` e `clienteId` são únicos no schema: o Prisma estoura P2002.
      if (tabelas.empresaFiscalConfig.some(c => c.cnpj === data.cnpj || c.clienteId === data.clienteId)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      }
      const linha = {
        id: `cfg-${tabelas.empresaFiscalConfig.length + 1}`,
        ambiente: 1, certificadoStatus: 'ATIVO', certificadoVencimento: null,
        focusEmpresaId: null, focusEmpresaToken: null,
        focusTokenProducao: null, focusTokenHomologacao: null, cscConfigurado: false,
        ...data,
      }
      tabelas.empresaFiscalConfig.push(linha)
      return copia(linha)
    },
    update: async ({ where, data }: Linha) => {
      const linha = tabelas.empresaFiscalConfig.find(c => c.clienteId === where.clienteId)
      if (!linha) throw new Error(`empresaFiscalConfig ${where.clienteId} não existe`)
      aplicarDados(linha, data)
      return copia(linha)
    },
  },

  emissaoLog: {
    create: async ({ data }: Linha) => {
      tabelas.emissaoLog.push({ ...data })
      return { ...data }
    },
  },

  idempotenciaFiscal: {
    findUnique: async ({ where }: Linha) => {
      const { licencaId, chave } = where.licencaId_chave
      return copia(tabelas.idempotenciaFiscal.find(i => i.licencaId === licencaId && i.chave === chave))
    },
    create: async ({ data }: Linha) => {
      tabelas.idempotenciaFiscal.push({ ...data })
      return { ...data }
    },
  },

  consumoFiscal: {
    findUnique: async ({ where }: Linha) =>
      copia(tabelas.consumoFiscal.find(chaveConsumo(where.licencaId_competencia_ambiente_tipoDocumento))),
    upsert: async ({ where, update, create }: Linha) => {
      const chave = where.licencaId_competencia_ambiente_tipoDocumento
      const linha = tabelas.consumoFiscal.find(chaveConsumo(chave))
      if (linha) {
        aplicarDados(linha, update)
        return copia(linha)
      }
      const nova = { emitidas: 0, canceladas: 0, cotaExtra: 0, ...create }
      tabelas.consumoFiscal.push(nova)
      return copia(nova)
    },
  },

  planoModulo: {
    findFirst: async ({ where }: Linha) =>
      copia(tabelas.planoModulo.find(p =>
        p.planoId === where.planoId && p.identificador === where.modulo?.identificador)),
  },

  licencaModuloExtra: {
    findFirst: async ({ where }: Linha) =>
      copia(tabelas.licencaModuloExtra.find(e =>
        e.licencaId === where.licencaId && e.identificador === where.modulo?.identificador)),
  },
}
