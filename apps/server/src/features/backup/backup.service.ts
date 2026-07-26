/**
 * ============================================================================
 * NOME DO ARQUIVO: backup.service.ts
 * MÓDULO: BACKUP (ADMIN)
 * ============================================================================
 * O QUE ESTE ARQUIVO FAZ:
 * Monta a visão de backups para o painel administrativo. É leitura pura — quem
 * escreve é o ERP, pelas rotas /erp/backup/*.
 *
 * A pergunta que esta tela responde não é "quem fez backup", é "quem deveria
 * estar fazendo e não está". Por isso licenças sem nenhum backup aparecem, e
 * aparecem primeiro.
 * ============================================================================
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { findVisaoGeralDeBackups, findEventosDeBackup, findLicencaById } from '@startbig/database'

/// Depois de quantas horas sem backup uma licença ativa é considerada atrasada.
/// 36h e não 24h porque o backup diário do ERP pode atrasar algumas horas
/// (máquina desligada, cliente abriu a loja mais tarde) sem que nada esteja
/// errado. Alarme que dispara por atraso normal é alarme que ninguém olha.
const HORAS_ATE_ATRASADO = 36

type Situacao = 'EM_DIA' | 'ATRASADO' | 'NUNCA' | 'NAO_ELEGIVEL'

@Injectable()
export class BackupService {
  async visaoGeral() {
    const { licencas, ultimos, falhas } = await findVisaoGeralDeBackups()

    const porLicenca = new Map<string, Record<string, (typeof ultimos)[number]>>()
    for (const u of ultimos) {
      const atual = porLicenca.get(u.licencaId) ?? {}
      atual[u.tipo] = u
      porLicenca.set(u.licencaId, atual)
    }

    const falhasPorLicenca = new Map(falhas.map(f => [f.licencaId, f._count._all]))
    const agora = Date.now()

    const itens = licencas.map(l => {
      const copias  = porLicenca.get(l.id) ?? {}
      const banco   = copias['BANCO']   ?? null
      const imagens = copias['IMAGENS'] ?? null

      // A licença é elegível a backup pela mesma regra do gate do ERP. Sem isso
      // a tela acusaria de "atrasado" todo trial e toda licença vencida, e o
      // alerta viraria ruído.
      const elegivel = l.status === 'ATIVA' && !l.isTrial &&
        (!l.dataVencimento || l.dataVencimento.getTime() > agora)

      const referencia = banco ? (banco.confirmadoEm ?? banco.emitidoEm) : null
      const horasDesde = referencia ? (agora - referencia.getTime()) / 3_600_000 : null

      const situacao: Situacao =
        !elegivel                              ? 'NAO_ELEGIVEL'
        : referencia === null                  ? 'NUNCA'
        : (horasDesde as number) > HORAS_ATE_ATRASADO ? 'ATRASADO'
        : 'EM_DIA'

      return {
        licencaId:       l.id,
        clienteId:       l.clienteId,
        nomeCliente:     l.cliente.pf?.nomeCompleto ?? l.cliente.pj?.razaoSocial ?? l.cliente.email,
        email:           l.cliente.email,
        plano:           l.plano?.nome ?? null,
        statusLicenca:   l.status,
        isTrial:         l.isTrial,
        nomeDispositivo: l.nomeDispositivo,
        elegivel,
        situacao,
        horasDesdeUltimo: horasDesde === null ? null : Math.floor(horasDesde),
        falhas7Dias:     falhasPorLicenca.get(l.id) ?? 0,
        // O prefixo é o que se cola na busca do painel da Cloudflare. É por isso
        // que ele existe aqui: evita ter que caçar UUID no meio do bucket.
        prefixo:         `clientes/${l.clienteId}/${l.id}/`,
        banco:   banco   ? this.resumo(banco)   : null,
        imagens: imagens ? this.resumo(imagens) : null,
      }
    })

    // Quem precisa de atenção primeiro. Dentro do mesmo grupo, o mais parado no topo.
    const peso: Record<Situacao, number> = { NUNCA: 0, ATRASADO: 1, EM_DIA: 2, NAO_ELEGIVEL: 3 }
    itens.sort((a, b) =>
      peso[a.situacao] - peso[b.situacao] ||
      (b.horasDesdeUltimo ?? 0) - (a.horasDesdeUltimo ?? 0),
    )

    return {
      resumo: {
        elegiveis: itens.filter(i => i.elegivel).length,
        emDia:     itens.filter(i => i.situacao === 'EM_DIA').length,
        atrasados: itens.filter(i => i.situacao === 'ATRASADO').length,
        nunca:     itens.filter(i => i.situacao === 'NUNCA').length,
        bytesTotal: itens.reduce(
          (s, i) => s + (i.banco?.tamanhoBytes ?? 0) + (i.imagens?.tamanhoBytes ?? 0), 0,
        ),
        horasAteAtrasado: HORAS_ATE_ATRASADO,
      },
      itens,
    }
  }

  async eventos(licencaId: string) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const eventos = await findEventosDeBackup(licencaId)

    return {
      licencaId,
      prefixo: `clientes/${licenca.clienteId}/${licencaId}/`,
      eventos: eventos.map(e => ({
        id:           e.id,
        tipo:         e.tipo,
        status:       e.status,
        origem:       e.origem,
        tamanhoBytes: e.tamanhoRealBytes ?? e.tamanhoBytes,
        hwid:         e.hwid,
        emitidoEm:    e.emitidoEm,
        confirmadoEm: e.confirmadoEm,
        erro:         e.erroMensagem,
      })),
    }
  }

  private resumo(b: {
    tamanhoBytes: number
    tamanhoRealBytes: number | null
    confirmadoEm: Date | null
    emitidoEm: Date
    hwid: string | null
    chaveS3: string
  }) {
    return {
      tamanhoBytes: b.tamanhoRealBytes ?? b.tamanhoBytes,
      geradoEm:     b.confirmadoEm ?? b.emitidoEm,
      hwid:         b.hwid,
      chave:        b.chaveS3,
    }
  }
}
