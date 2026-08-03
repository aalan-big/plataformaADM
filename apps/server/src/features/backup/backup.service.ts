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
import {
  findVisaoGeralDeBackups,
  findEventosDeBackup,
  findLicencaById,
  findCorrenteDoCiclo,
  cicloAtual,
  registrarLog,
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
    const { licencas, fulls, fragmentos, falhas } = await findVisaoGeralDeBackups()

    const fullPorLicenca = new Map(fulls.map(f => [f.licencaId, f]))

    // Fragmentos agregados por licença — mas com a LISTA junto, não só a contagem.
    //
    // O agregado responde "o acervo está protegido?"; a lista é o que permite
    // olhar a CORRENTE. Numa cadeia isso não é detalhe: um elo faltando no meio
    // invalida tudo que vem depois, e é a sequência que denuncia o buraco. Um
    // total agregado esconderia exatamente o que precisa ser visto.
    type Elo     = { sequencia: number; bytes: number; geradoEm: Date }
    type Corrente = { elos: number; bytes: number; ultimaSequencia: number; lista: Elo[] }

    const correntePorLicenca = new Map<string, Corrente>()
    for (const f of fragmentos) {
      // Só o ciclo do full que está na nuvem interessa: fragmento de ciclo antigo
      // já foi apagado pela rotação, e mostrá-lo somaria bytes que não existem.
      if (f.ciclo !== fullPorLicenca.get(f.licencaId)?.ciclo) continue

      const atual = correntePorLicenca.get(f.licencaId)
        ?? { elos: 0, bytes: 0, ultimaSequencia: 0, lista: [] as Elo[] }
      const bytes = f.tamanhoRealBytes ?? f.tamanhoBytes

      atual.elos  += 1
      atual.bytes += bytes
      atual.lista.push({ sequencia: f.sequencia, bytes, geradoEm: f.confirmadoEm ?? f.emitidoEm })
      atual.ultimaSequencia = Math.max(atual.ultimaSequencia, f.sequencia)
      correntePorLicenca.set(f.licencaId, atual)
    }

    const falhasPorLicenca = new Map(falhas.map(f => [f.licencaId, f._count._all]))
    const agora = Date.now()

    const itens = licencas.map(l => {
      const full     = fullPorLicenca.get(l.id) ?? null
      const corrente = correntePorLicenca.get(l.id) ?? null

      // A licença é elegível a backup pela mesma regra do gate do ERP. Sem isso
      // a tela acusaria de "atrasado" todo trial e toda licença vencida, e o
      // alerta viraria ruído.
      const elegivel = l.status === 'ATIVA' && !l.isTrial &&
        (!l.dataVencimento || l.dataVencimento.getTime() > agora)

      // O que importa é o ÚLTIMO elo da corrente, não o full: com fragmento
      // diário, um full de segunda e nenhum fragmento desde então significa
      // backup parado — e olhar só o full mostraria "em dia" a semana inteira.
      const ultimoElo  = corrente?.lista.reduce(
        (a, b) => (b.geradoEm > a.geradoEm ? b : a),
        corrente.lista[0],
      )
      const referencia = ultimoElo?.geradoEm
        ?? (full ? (full.confirmadoEm ?? full.emitidoEm) : null)
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
        ciclo:    full?.ciclo ?? null,
        full:     full ? this.resumo(full) : null,
        corrente: corrente ?? { elos: 0, bytes: 0, ultimaSequencia: 0, lista: [] },
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
          (s, i) => s + (i.full?.tamanhoBytes ?? 0) + i.corrente.bytes, 0,
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
        ciclo:        e.ciclo,
        sequencia:    e.sequencia,
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
    contexto: { usuarioId?: string | null; ip?: string | null; ciclo?: string | null; sequencia?: number | null },
  ) {
    const licenca = await findLicencaById(licencaId)
    if (!licenca) throw new NotFoundException('Licença não encontrada.')

    const ciclo = contexto.ciclo ?? cicloAtual()

    // Um elo por vez, e o suporte precisa dizer QUAL. Devolver "o mais recente"
    // sem pedir seria entregar um fragmento — alguns MB do dia — a quem acha que
    // baixou o acervo do cliente.
    //
    // O padrão é a sequência 0, que é sempre o full: é o único elo que sozinho
    // significa alguma coisa.
    const sequencia = contexto.sequencia ?? 0
    const corrente  = await findCorrenteDoCiclo(licencaId, ciclo)
    const ultimo    = corrente.find(b => b.sequencia === sequencia)

    if (!ultimo)
      throw new NotFoundException(
        `Nenhum elo de sequência ${sequencia} confirmado no ciclo ${ciclo} desta licença.`,
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
    const rotulo = ultimo.tipo === 'FULL' ? 'full' : `frag${String(ultimo.sequencia).padStart(3, '0')}`
    const nomeArquivo = `${apelido}-${rotulo}-${dia}.zip`

    const { url, expiraEm } = await this.storage.gerarUrlDownload(ultimo.chaveS3, nomeArquivo)

    await registrarLog({
      usuarioId:    contexto.usuarioId,
      acao:         'BACKUP_DOWNLOAD',
      entidadeNome: 'Licenca',
      entidadeId:   licencaId,
      descricao:    `Download do backup ${ultimo.tipo} seq ${ultimo.sequencia} do ciclo ${ciclo} ` +
                    `(${objeto.tamanhoBytes} bytes) do cliente ${nomeCliente}.`,
      ipAddress:    contexto.ip,
    })

    return {
      url,
      chave:        ultimo.chaveS3,
      tipo:         ultimo.tipo,
      ciclo,
      sequencia:    ultimo.sequencia,
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
