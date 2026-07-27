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
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import {
  findVisaoGeralDeBackups,
  findEventosDeBackup,
  findLicencaById,
  findUltimoBackupConfirmado,
  registrarLog,
  type TipoBackupDb,
} from '@startbig/database'
import { StorageService } from '../../common/storage/storage.service'

/// Depois de quantas horas sem backup uma licença ativa é considerada atrasada.
/// 36h e não 24h porque o backup diário do ERP pode atrasar algumas horas
/// (máquina desligada, cliente abriu a loja mais tarde) sem que nada esteja
/// errado. Alarme que dispara por atraso normal é alarme que ninguém olha.
const HORAS_ATE_ATRASADO = 36

type Situacao = 'EM_DIA' | 'ATRASADO' | 'NUNCA' | 'NAO_ELEGIVEL'

@Injectable()
export class BackupService {
  constructor(private readonly storage: StorageService) {}

  async visaoGeral() {
    const { licencas, ultimos, pedacosOs, falhas } = await findVisaoGeralDeBackups()

    const porLicenca = new Map<string, Record<string, (typeof ultimos)[number]>>()
    for (const u of ultimos) {
      const atual = porLicenca.get(u.licencaId) ?? {}
      atual[u.tipo] = u
      porLicenca.set(u.licencaId, atual)
    }

    // OS é agregado por licença: quantos meses existem, quanto ocupam e qual o
    // mais recente. O detalhe pedaço a pedaço fica na gaveta de eventos — nesta
    // tela o que importa é "o acervo está protegido e até quando".
    const osPorLicenca = new Map<string, { meses: number; bytes: number; ultimoPeriodo: string | null }>()
    for (const p of pedacosOs) {
      const atual = osPorLicenca.get(p.licencaId) ?? { meses: 0, bytes: 0, ultimoPeriodo: null }
      atual.meses += 1
      atual.bytes += p.tamanhoRealBytes ?? p.tamanhoBytes
      // A consulta vem ordenada por período desc, então o primeiro é o mais novo.
      if (atual.ultimoPeriodo === null) atual.ultimoPeriodo = p.periodo
      osPorLicenca.set(p.licencaId, atual)
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
        os:      osPorLicenca.get(l.id) ?? { meses: 0, bytes: 0, ultimoPeriodo: null },
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
          (s, i) => s + (i.banco?.tamanhoBytes ?? 0) + (i.imagens?.tamanhoBytes ?? 0) + i.os.bytes, 0,
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
        periodo:      e.periodo,
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

  /**
   * URL assinada para o ADMIN baixar o backup de um cliente — a porta de
   * suporte, para quando o cliente perde a máquina e liga pedindo socorro.
   *
   * Não é a mesma coisa que o download do ERP: aqui quem se autentica é o
   * administrador, então não passa pelo gate de plano. Um cliente com licença
   * vencida não baixa sozinho, mas você pode baixar por ele — que era o caso
   * que ficava sem saída.
   *
   * Justamente por isso fica registrado: baixar o banco de um cliente é acessar
   * o cadastro, o financeiro e a carteira de clientes da empresa dele. Quem fez,
   * de quem, e quando precisa estar escrito em algum lugar.
   */
  async urlDownloadAdmin(
    licencaId: string,
    tipo: string,
    contexto: { usuarioId?: string | null; ip?: string | null; periodo?: string | null },
  ) {
    if (tipo !== 'banco' && tipo !== 'imagens' && tipo !== 'os')
      throw new BadRequestException('tipo deve ser "banco", "imagens" ou "os".')

    // OS tem um arquivo por mês, então o suporte precisa dizer QUAL mês quer.
    // Sem isso a rota devolveria um pedaço arbitrário — o mais recente — e quem
    // está atendendo o cliente acharia que baixou o acervo inteiro.
    if (tipo === 'os' && !contexto.periodo)
      throw new BadRequestException('Para tipo "os" informe o periodo no formato AAAA-MM.')

    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const tipoDb: TipoBackupDb = tipo === 'banco' ? 'BANCO' : tipo === 'imagens' ? 'IMAGENS' : 'OS'
    const ultimo = await findUltimoBackupConfirmado(
      licencaId,
      tipoDb,
      tipo === 'os' ? contexto.periodo : undefined,
    )

    if (!ultimo)
      throw new NotFoundException(
        `Nenhum backup de ${tipo}${tipo === 'os' ? ` (${contexto.periodo})` : ''} confirmado para esta licença.`,
      )

    // Confere antes de assinar: a retenção pode ter apagado o objeto, e um link
    // que estoura em 404 no meio do download não explica nada a quem clicou.
    const objeto = await this.storage.conferirObjeto(ultimo.chaveS3)
    if (!objeto)
      throw new NotFoundException('O backup registrado não está mais disponível na nuvem.')

    const nomeCliente = licenca.cliente.pf?.nomeCompleto
      ?? licenca.cliente.pj?.razaoSocial
      ?? licenca.cliente.email

    // Data no nome porque backup é fotografia de um momento: numa restauração,
    // saber de que dia é o arquivo importa tanto quanto saber de quem é.
    const dia = (ultimo.confirmadoEm ?? ultimo.emitidoEm).toISOString().slice(0, 10)
    const apelido = nomeCliente
      // Tira acento: header HTTP é ASCII, e "José" viraria lixo no nome do arquivo.
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()
      .slice(0, 40)
    const nomeArquivo = tipo === 'os'
      ? `${apelido}-os-${ultimo.periodo}.zip`
      : `${apelido}-${tipo}-${dia}.zip`

    const { url, expiraEm } = await this.storage.gerarUrlDownload(ultimo.chaveS3, nomeArquivo)

    await registrarLog({
      usuarioId:    contexto.usuarioId,
      acao:         'BACKUP_DOWNLOAD',
      entidadeNome: 'Licenca',
      entidadeId:   licencaId,
      descricao:    `Download do backup de ${tipo}${ultimo.periodo ? ` ${ultimo.periodo}` : ''} ` +
                    `(${objeto.tamanhoBytes} bytes) do cliente ${nomeCliente}.`,
      ipAddress:    contexto.ip,
    })

    return {
      url,
      chave:        ultimo.chaveS3,
      tipo,
      tamanhoBytes: objeto.tamanhoBytes,
      geradoEm:     ultimo.confirmadoEm ?? ultimo.emitidoEm,
      expiraEm:     expiraEm.toISOString(),
      nomeArquivo,
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
