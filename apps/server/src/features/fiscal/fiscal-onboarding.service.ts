import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common'
import { prisma, MODULO_NFE, MODULO_NFCE } from '@startbig/database'
import { FocusNfeService } from '../../common/focus-nfe/focus-nfe.service'
import { camposFaltandoParaCriar, emitenteParaCadastroFocus, EmitenteErp } from '../../common/focus-nfe/focus-empresa.mapper'
import { cifraDisponivel, cifrar } from '../../common/cripto/segredo-fiscal'
import { AMBIENTE_PRODUCAO, tokenDeEmissao, nomeAmbiente, buscarEmpresaConfig } from './fiscal-comum'

/** O que o ERP manda para ativar a emissão (`POST /erp/fiscal/ativacao`). */
export type DadosAtivacao = {
  emitente:       EmitenteErp
  email?:         string | null
  telefone?:      string | null
  arquivo_base64: string
  senha:          string
}

/**
 * Cadastro do emitente na Focus: o `/config` que o ERP lê, certificado,
 * ativação da emissão num passo só (F2) e CSC.
 */
@Injectable()
export class FiscalOnboardingService {
  private readonly logger = new Logger(FiscalOnboardingService.name)

  constructor(private readonly focusNfeService: FocusNfeService) {}

  /**
   * O que o ERP pode mostrar na tela fiscal antes de tentar emitir.
   *
   * Existe porque o ambiente é decidido AQUI, na configuração do cliente, e o
   * ERP não tem como saber qual é. Sem esta rota, a tela dele só poderia exibir
   * uma chave local — que ficaria dizendo "Homologação" enquanto a plataforma
   * emite em produção. Nenhum segredo sai: nem o token da Focus, nem o CSC, que
   * a plataforma nem guarda.
   */
  async configFiscal(licencaId: string) {
    const config = await buscarEmpresaConfig(licencaId)

    if (!config) {
      return {
        configurado:       false,
        cnpj:              null,
        razaoSocial:       null,
        inscricaoEstadual: null,
        ambiente:          null,
        ambienteNome:      null,
        tokenConfigurado:  false,
        cscConfigurado:    false,
        certificadoStatus: null,
        certificadoVencimento: null,
        pendencias:        ['Nenhuma configuração fiscal vinculada a esta licença.'],
      }
    }

    /**
     * A lista do que impede a emissão, pronta para a tela.
     *
     * O ERP poderia deduzir isso dos campos, mas cada integração deduziria à sua
     * maneira e a mensagem no balcão seria diferente em cada loja.
     */
    const pendencias: string[] = []
    const temToken = !!tokenDeEmissao(config)
    if (!temToken)                          pendencias.push('Token de emissão da Focus NFe não configurado.')
    if (!config.cscConfigurado)             pendencias.push('CSC não cadastrado na Focus para este ambiente — a NFC-e sairá sem QR Code.')
    if (config.certificadoStatus === 'VENCIDO') pendencias.push('Certificado digital vencido.')
    if (config.certificadoStatus === 'AUSENTE') pendencias.push('Certificado digital não informado.')

    return {
      configurado:       true,
      cnpj:              config.cnpj,
      razaoSocial:       config.razaoSocial,
      inscricaoEstadual: config.inscricaoEstadual,
      ambiente:          config.ambiente,
      ambienteNome:      nomeAmbiente(config.ambiente),
      tokenConfigurado:  temToken,
      cscConfigurado:    config.cscConfigurado,
      certificadoStatus: config.certificadoStatus,
      certificadoVencimento: config.certificadoVencimento,
      pendencias,
    }
  }

  /**
   * Recebe o certificado A1 do ERP e o entrega ao cadastro da empresa na Focus.
   *
   * É a peça que faltava do onboarding fiscal. Sem ela o ERP conferia o arquivo
   * na máquina do lojista — senha e validade — e não tinha para onde mandá-lo:
   * gravava `VALIDADO_LOCAL` e dizia na tela que o certificado não havia chegado
   * à emissora. Ele estava certo.
   *
   * Os códigos de status aqui são CONTRATO, não decoração. O ERP separa três
   * desfechos e reage diferente a cada um:
   *
   *   404/405/501 → "a plataforma ainda não recebe certificado". O cadastro fica
   *                 `VALIDADO_LOCAL` e o lojista NÃO é mandado procurar defeito
   *                 no arquivo dele. É o slot certo para o que falta do NOSSO
   *                 lado.
   *   demais 4xx  → recusa explícita. A `message` daqui aparece para o lojista.
   *   2xx         → `CONECTADO_NUVEM`, e a tela passa a dizer "Conectado".
   *
   * Por isso token da conta ausente e empresa sem `focusEmpresaId` saem como 501
   * e não como 500: os dois são configuração nossa pendente. Um 500 viraria
   * "a plataforma recusou o seu certificado", que é acusar o cliente de um
   * problema que é nosso.
   */
  async enviarCertificado(licencaId: string, arquivoBase64: string, senha: string) {
    const { config, tokenDaConta, empresaId } = await this.prepararCadastroNaFocus(
      licencaId,
      'O envio de certificado ainda não está habilitado nesta plataforma.',
    )

    let empresa: any
    try {
      empresa = await this.focusNfeService.atualizarEmpresa(tokenDaConta, empresaId, {
        arquivo_certificado_base64: arquivoBase64,
        senha_certificado: senha,
        /**
         * Empresa cadastrada e não habilitada não emite, e o erro só aparece na
         * primeira nota. Reafirmar aqui é barato e fecha esse buraco.
         *
         * São DUAS flags, não uma: `habilita_nfce` é independente na Focus.
         * Mandar só a primeira deixava a loja que comprou NFC-e com o
         * certificado aceito, o painel todo verde e a Focus recusando o
         * primeiro cupom — o pior desfecho, porque acontece no balcão.
         *
         * As duas vão sempre, para todo cliente, e isso NÃO é dar módulo de
         * graça: quem decide o que a loja pode emitir é o `ModuloGuard`, aqui
         * do nosso lado, e ele barra `/erp/fiscal/nfce/*` sem o módulo NFCE.
         * Estas flags são capacidade na emissora, não licença. Amarrá-las ao
         * módulo criaria uma segunda trava, invisível e fora do nosso banco,
         * que só se manifesta na primeira nota depois da venda do módulo.
         *
         * Não condicionamos `habilita_nfce` ao `cscConfigurado` pela mesma
         * razão: o CSC costuma ser cadastrado DEPOIS do certificado, e nada
         * reenvia esta chamada quando ele chega — a loja ficaria presa até
         * alguém reenviar o certificado à mão para destravar o cupom.
         */
        habilita_nfe:  true,
        habilita_nfce: true,
      })
    } catch (erro) {
      /**
       * 401/403 da Focus é o NOSSO token, nunca o certificado do cliente.
       *
       * Deixar passar cru mandaria o lojista trocar a senha de um certificado
       * que está perfeito. Vira 501 pela mesma razão dos casos acima: o que
       * falta é da plataforma.
       */
      if (erro instanceof HttpException && [401, 403].includes(erro.getStatus())) {
        this.logger.error('A Focus recusou o token de parceiro (FOCUS_NFE_PARTNER_TOKEN) ao enviar certificado.')
        throw new HttpException(
          {
            codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA',
            mensagem: 'O envio de certificado ainda não está habilitado nesta plataforma.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        )
      }
      // O resto sobe como veio: senha errada e CNPJ divergente são justamente o
      // que o lojista precisa ler, e quem sabe dizer isso é a emissora.
      throw erro
    }

    /**
     * A empresa devolve os DOIS tokens; guardamos o do ambiente desta ficha.
     *
     * `getBaseUrl` escolhe o host pelo `ambiente`, então gravar o token de
     * produção numa ficha de homologação faria toda emissão bater em 401 no host
     * de teste. Token vazio na resposta não apaga o que já está lá: o admin pode
     * tê-lo colado à mão, e limpar por omissão desligaria a emissão em silêncio.
     */
    const tokenDoAmbiente = config.ambiente === AMBIENTE_PRODUCAO
      ? empresa?.token_producao
      : empresa?.token_homologacao

    const validoAte = empresa?.certificado_valido_ate
      ? new Date(empresa.certificado_valido_ate)
      : null
    const vencimento = validoAte && !Number.isNaN(validoAte.getTime()) ? validoAte : null

    await prisma.empresaFiscalConfig.update({
      where: { clienteId: config.clienteId },
      data: {
        certificadoStatus: 'ATIVO',
        ...(vencimento ? { certificadoVencimento: vencimento } : {}),
        ...(typeof tokenDoAmbiente === 'string' && tokenDoAmbiente
          ? { focusEmpresaToken: tokenDoAmbiente }
          : {}),
      },
    })

    this.logger.log(`Certificado do cliente ${config.clienteId} cadastrado na Focus NFe.`)

    /**
     * A resposta que o ERP lê. Nenhum segredo sai daqui — nem a senha, nem o
     * token da empresa, nem o arquivo. O `valido_ate` é o que a tela do Centro
     * Fiscal mostra ao lojista.
     */
    return {
      status: 'ATIVO',
      habilitado: true,
      cnpj: config.cnpj,
      valido_ate: vencimento ? vencimento.toISOString() : null,
      mensagem: 'Certificado cadastrado na emissora.',
    }
  }

  /**
   * Ativa a emissão de um cliente num passo só: empresa na Focus (cria se não
   * existe), certificado, habilitação e os dois tokens. F2 do plano de
   * refatoração do fiscal.
   *
   * Antes disto (06/10/2026), o primeiro cliente em produção precisou de quatro
   * passos em três lugares: cadastrar a empresa no painel da Focus, criar a
   * ficha no admin, colar o id e o token, e reenviar o certificado pelo ERP.
   *
   * O ERP manda o MESMO bloco `emitente{}` das notas — o ERP é a fonte da
   * verdade do emitente; a plataforma guarda credenciais e política.
   *
   * Regras que não podem afrouxar:
   *   - o CNPJ do emitente tem de ser o da ficha (nunca grava em empresa alheia);
   *   - sem ficha, ela só nasce se a licença trouxer EXPLICITAMENTE NFE ou NFCE —
   *     criar empresa na Focus pode custar dinheiro, e a claim vazia (licença
   *     antiga) não autoriza isso; aí o admin cria a ficha com o CNPJ;
   *   - 401/403 da Focus é o NOSSO token de parceiro → 501, nunca "recusamos o
   *     seu certificado".
   */
  async ativarEmissao(licencaId: string, modulosDaLicenca: string[] | undefined, dados: DadosAtivacao) {
    const emitente = dados.emitente ?? {}
    const cnpj = String(emitente.cnpj ?? '').replace(/\D/g, '')
    if (cnpj.length !== 14) {
      throw new BadRequestException({ codigo: 'EMITENTE_SEM_CNPJ', mensagem: 'O CNPJ da empresa não foi informado em Dados da Empresa.' })
    }

    let config = await buscarEmpresaConfig(licencaId)

    if (!config) {
      const contratou = Array.isArray(modulosDaLicenca) &&
        (modulosDaLicenca.includes(MODULO_NFE) || modulosDaLicenca.includes(MODULO_NFCE))
      if (!contratou) {
        this.logger.warn(`Licença ${licencaId}: ativação fiscal sem ficha e sem NFE/NFCE na licença (claim: ${modulosDaLicenca?.join(', ') || 'vazia'}).`)
        throw new NotFoundException({
          codigo:   'SEM_CONFIGURACAO_FISCAL',
          mensagem: 'Nenhuma configuração fiscal vinculada a esta licença.',
        })
      }

      const licenca = await prisma.licenca.findUnique({ where: { id: licencaId }, select: { clienteId: true } })
      try {
        await prisma.empresaFiscalConfig.create({
          data: {
            clienteId:         licenca!.clienteId,
            cnpj,
            razaoSocial:       String(emitente.razao_social ?? emitente.nome ?? '').trim() || cnpj,
            inscricaoEstadual: emitente.inscricao_estadual || null,
            ambiente:          AMBIENTE_PRODUCAO,
            certificadoStatus: 'AUSENTE',
          },
        })
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') {
          throw new ConflictException({ codigo: 'CNPJ_DE_OUTRO_CLIENTE', mensagem: 'Este CNPJ já está configurado para outro cliente. Fale com o suporte StartBig.' })
        }
        throw err
      }
      this.logger.log(`Ficha fiscal criada pela ativação para a licença ${licencaId} (CNPJ ${cnpj}, produção).`)
      config = await buscarEmpresaConfig(licencaId)
    }

    if (config!.cnpj !== cnpj) {
      this.logger.warn(`Ativação barrada: licença ${licencaId} tem ficha do CNPJ ${config!.cnpj} e o ERP mandou ${cnpj}.`)
      throw new HttpException({
        codigo:   'CNPJ_DIVERGENTE',
        mensagem: 'O CNPJ em Dados da Empresa é diferente do cadastrado para esta licença. Fale com o suporte StartBig.',
      }, HttpStatus.UNPROCESSABLE_ENTITY)
    }
    const ficha = config!

    const tokenDaConta =
      process.env.FOCUS_NFE_PARTNER_TOKEN?.trim() || process.env.FOCUS_CONTA_TOKEN?.trim()
    if (!tokenDaConta) {
      this.logger.error('FOCUS_NFE_PARTNER_TOKEN ausente: ativação fiscal impossível.')
      throw new HttpException(
        { codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA', mensagem: 'A ativação da emissão ainda não está habilitada nesta plataforma.' },
        HttpStatus.NOT_IMPLEMENTED,
      )
    }

    const semPermissao = (erro: unknown) =>
      erro instanceof HttpException && [401, 403].includes(erro.getStatus())
    const erroDeToken = () => {
      this.logger.error('A Focus recusou o token de parceiro (FOCUS_NFE_PARTNER_TOKEN) na ativação.')
      return new HttpException(
        { codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA', mensagem: 'A ativação da emissão ainda não está habilitada nesta plataforma.' },
        HttpStatus.NOT_IMPLEMENTED,
      )
    }

    let empresaId = ficha.focusEmpresaId
    if (!empresaId) {
      try {
        const achada = await this.focusNfeService.buscarEmpresaPorCnpj(tokenDaConta, cnpj)
        empresaId = achada?.id ? String(achada.id) : null
      } catch (erro) {
        if (semPermissao(erro)) throw erroDeToken()
        throw erro
      }
    }

    // Conferido ANTES de chamar a Focus: ela recusa um campo por vez.
    if (!empresaId) {
      const faltam = camposFaltandoParaCriar(emitente)
      if (faltam.length) {
        throw new HttpException({
          codigo:   'DADOS_INCOMPLETOS',
          mensagem: `Para cadastrar a empresa na emissora, preencha em Dados da Empresa: ${faltam.join(', ')}.`,
        }, HttpStatus.UNPROCESSABLE_ENTITY)
      }
    }

    const corpo = {
      ...emitenteParaCadastroFocus(emitente, { email: dados.email, telefone: dados.telefone }),
      arquivo_certificado_base64: dados.arquivo_base64,
      senha_certificado:          dados.senha,
      // As duas, sempre — ver o comentário em `enviarCertificado`.
      habilita_nfe:  true,
      habilita_nfce: true,
    }

    let empresa: any
    let acao: 'CRIADA' | 'ATUALIZADA'
    try {
      if (empresaId) {
        empresa = await this.focusNfeService.atualizarEmpresa(tokenDaConta, empresaId, corpo)
        acao = 'ATUALIZADA'
      } else {
        empresa = await this.focusNfeService.criarEmpresa(tokenDaConta, corpo)
        acao = 'CRIADA'
        empresaId = empresa?.id ? String(empresa.id) : null
      }
    } catch (erro) {
      if (semPermissao(erro)) throw erroDeToken()
      if (erro instanceof HttpException && [400, 422].includes(erro.getStatus())) {
        // Recusa de validação da Focus: senha do certificado, CNPJ do .pfx,
        // município... É o que o lojista precisa ler. Só a lista de mensagens
        // sai daqui — nunca o corpo enviado, que tem certificado e senha.
        const r = erro.getResponse() as any
        const detalhes: string[] = Array.isArray(r?.erros)
          ? r.erros.map((e: any) => e?.mensagem).filter(Boolean)
          : []
        const lista = detalhes.length ? detalhes : [r?.mensagem].filter(Boolean)
        const motivo = [...new Set<string>(lista)].join(' ')
        throw new HttpException({
          codigo:   'EMISSORA_RECUSOU',
          mensagem: `A emissora recusou o cadastro${motivo ? `: ${motivo}` : '.'}`,
        }, HttpStatus.UNPROCESSABLE_ENTITY)
      }
      throw erro
    }

    if (!empresaId) {
      this.logger.error(`Ativação da licença ${licencaId}: a Focus não devolveu o id da empresa.`)
      throw new HttpException({ codigo: 'EMISSORA_SEM_ID', mensagem: 'A emissora não confirmou o cadastro. Tente de novo em instantes.' }, HttpStatus.BAD_GATEWAY)
    }

    /**
     * Tokens: os dois, cifrados, quando há chave. Com o do ambiente vigente
     * presente, o texto puro sai (o segredo passa a morar só cifrado). Sem
     * chave, o comportamento antigo: o token do ambiente em texto.
     */
    const tokenProducao    = typeof empresa?.token_producao === 'string' ? empresa.token_producao : null
    const tokenHomologacao = typeof empresa?.token_homologacao === 'string' ? empresa.token_homologacao : null
    const tokenDoAmbiente  = ficha.ambiente === AMBIENTE_PRODUCAO ? tokenProducao : tokenHomologacao
    let patchTokens: Record<string, string | null> = {}
    if (cifraDisponivel() && tokenDoAmbiente) {
      patchTokens = {
        ...(tokenProducao    ? { focusTokenProducao:    cifrar(tokenProducao) }    : {}),
        ...(tokenHomologacao ? { focusTokenHomologacao: cifrar(tokenHomologacao) } : {}),
        focusEmpresaToken: null,
      }
    } else if (tokenDoAmbiente) {
      patchTokens = { focusEmpresaToken: tokenDoAmbiente }
    }

    const validoAte  = empresa?.certificado_valido_ate ? new Date(empresa.certificado_valido_ate) : null
    const vencimento = validoAte && !Number.isNaN(validoAte.getTime()) ? validoAte : null

    await prisma.empresaFiscalConfig.update({
      where: { clienteId: ficha.clienteId },
      data: {
        focusEmpresaId:    empresaId,
        certificadoStatus: 'ATIVO',
        ...(vencimento ? { certificadoVencimento: vencimento } : {}),
        razaoSocial:       String(emitente.razao_social ?? emitente.nome ?? '').trim() || ficha.razaoSocial,
        inscricaoEstadual: emitente.inscricao_estadual || ficha.inscricaoEstadual,
        ...patchTokens,
      },
    })

    const atualizada = await buscarEmpresaConfig(licencaId)
    const temToken = !!(atualizada && tokenDeEmissao(atualizada))

    this.logger.log(
      `Emissão ativada para o cliente ${ficha.clienteId}: empresa ${empresaId} ${acao.toLowerCase()} na Focus` +
      ` (${nomeAmbiente(ficha.ambiente)}, token ${temToken ? 'ok' : 'AUSENTE'}, cifra ${cifraDisponivel() ? 'sim' : 'não'}).`,
    )

    return {
      status:           'ATIVO',
      habilitado:       true,
      empresa:          acao,
      cnpj,
      valido_ate:       vencimento ? vencimento.toISOString() : null,
      ambiente:         ficha.ambiente,
      ambienteNome:     nomeAmbiente(ficha.ambiente),
      tokenConfigurado: temToken,
      cscConfigurado:   !!atualizada?.cscConfigurado,
      mensagem: acao === 'CRIADA'
        ? 'Empresa cadastrada na emissora e certificado enviado. A emissão está ativa.'
        : 'Cadastro da empresa atualizado na emissora e certificado enviado. A emissão está ativa.',
    }
  }

  /**
   * Recebe o CSC (Código de Segurança do Contribuinte) do ERP e o grava na ficha
   * da empresa na Focus, no ambiente vigente desta licença.
   *
   * Fecha o buraco que o certificado deixou aberto: o lojista digitava o CSC no
   * ERP, o cartão dizia "Configurado", e o código ficava cifrado no SQLite da
   * loja sem caminho nenhum até a emissora. O `/config` respondia
   * `cscConfigurado: false` — corretamente — e o cupom saía sem QR Code. Até
   * aqui, o único caminho era o painel da plataforma, e nem ele: a caixa de lá é
   * um MARCADOR, não recebe o código. Quem tinha de digitar o CSC era o admin,
   * direto no painel da Focus.
   *
   * O CSC NÃO fica no nosso banco, de propósito. Somado à chave de acesso, ele
   * permite forjar QR Code de NFC-e em nome da loja; guardá-lo aqui seria um
   * segredo a mais em repouso sem criptografia, e a Focus só precisa dele uma
   * vez por empresa — é ela quem monta o hash do QR Code em cada cupom. O que
   * gravamos é o `cscConfigurado`, que já existia para o suporte enxergar.
   *
   * O código nunca entra em log — mesma regra da senha do certificado. A linha
   * de log abaixo cita cliente e ambiente, nunca o token; e a resposta da Focus
   * (que ecoa `csc_nfce_*`) não é registrada.
   *
   * Os status são contrato com o ERP, idênticos aos do certificado: 404/405/501
   * é "a plataforma ainda não recebe", demais 4xx é recusa com `mensagem`, 2xx
   * gravou. Por isso token da conta ausente sai como 501 e não como 500.
   */
  async cadastrarCsc(licencaId: string, cscId: string, cscToken: string) {
    const { config, tokenDaConta, empresaId } = await this.prepararCadastroNaFocus(
      licencaId,
      'O cadastro de CSC ainda não está habilitado nesta plataforma.',
    )

    /**
     * O CSC é POR AMBIENTE, e a Focus tem um par de campos para cada um. A
     * ficha decide qual: gravar o de produção enquanto a licença emite em
     * homologação deixaria a Focus sem CSC no ambiente em uso e o marcador
     * dizendo "sim" — exatamente a mentira que `cscConfigurado` existe para
     * evitar.
     *
     * O `id_token` é inteiro na Focus; o ERP manda a grafia da SEFAZ
     * ("000001"). `Number` faz a conversão e o schema já garantiu só dígitos.
     */
    const producao = config.ambiente === AMBIENTE_PRODUCAO
    const dados = producao
      ? { id_token_nfce_producao:    Number(cscId), csc_nfce_producao:    cscToken }
      : { id_token_nfce_homologacao: Number(cscId), csc_nfce_homologacao: cscToken }

    try {
      await this.focusNfeService.atualizarEmpresa(tokenDaConta, empresaId, dados)
    } catch (erro) {
      // 401/403 da Focus é o NOSSO token de parceiro, nunca o CSC do lojista.
      // Cru, chegaria como "a plataforma recusou o seu CSC".
      if (erro instanceof HttpException && [401, 403].includes(erro.getStatus())) {
        this.logger.error('A Focus recusou o token de parceiro (FOCUS_NFE_PARTNER_TOKEN) ao cadastrar CSC.')
        throw new HttpException(
          {
            codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA',
            mensagem: 'O cadastro de CSC ainda não está habilitado nesta plataforma.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        )
      }
      throw erro
    }

    await prisma.empresaFiscalConfig.update({
      where: { clienteId: config.clienteId },
      data:  { cscConfigurado: true },
    })

    this.logger.log(
      `CSC do cliente ${config.clienteId} cadastrado na Focus NFe (${nomeAmbiente(config.ambiente)}, id ${cscId}).`,
    )

    // Só o que a tela do ERP precisa; o código não volta.
    return {
      cscConfigurado: true,
      ambiente:       config.ambiente,
      ambienteNome:   nomeAmbiente(config.ambiente),
      mensagem:       `CSC cadastrado na emissora para ${nomeAmbiente(config.ambiente).toLowerCase()}.`,
    }
  }

  /**
   * O que toda escrita no cadastro da empresa na Focus precisa antes de começar:
   * a ficha fiscal da licença, o token da conta e o id da empresa lá.
   *
   * Compartilhado entre certificado e CSC porque os dois gravam na MESMA ficha,
   * com o MESMO token, e têm o mesmo contrato de status com o ERP — 501 para o
   * que falta do nosso lado. Duas cópias disto divergiriam na primeira
   * correção; a mensagem do 501 é o único pedaço que muda entre elas.
   */
  private async prepararCadastroNaFocus(licencaId: string, mensagemIndisponivel: string) {
    const config = await buscarEmpresaConfig(licencaId)

    if (!config) {
      /**
       * Logado de propósito. Foi o que aconteceu com o primeiro cliente em
       * produção (06/10/2026): o certificado saiu do ERP antes de existir a
       * ficha, o ERP mostrou "validado só localmente" e a VPS não tinha uma
       * linha sequer para dizer por quê.
       */
      this.logger.warn(`Licença ${licencaId}: cadastro na Focus pedido sem ficha fiscal no admin (404 SEM_CONFIGURACAO_FISCAL).`)
      throw new NotFoundException({
        codigo:   'SEM_CONFIGURACAO_FISCAL',
        mensagem: 'Nenhuma configuração fiscal vinculada a esta licença.',
      })
    }

    /**
     * O token da CONTA na Focus (o "token de parceiro"), não o da empresa.
     *
     * Fica em variável de ambiente e não no banco porque vale para todos os
     * clientes: é a credencial do painel, a mesma que cria e altera qualquer
     * empresa da nossa conta. Guardá-la por cliente seria N cópias do mesmo
     * segredo esperando divergir.
     *
     * DOIS NOMES ACEITOS, e isso é deliberado. `FOCUS_NFE_PARTNER_TOKEN` é o
     * nome que a Focus usa e o que está no `.env` da VPS; `FOCUS_CONTA_TOKEN`
     * foi o nome com que esta rota nasceu. Aceitar os dois custa uma linha e
     * mata um modo de falha caro: com o nome trocado, o token está presente e
     * correto e mesmo assim a rota devolve 501 — indistinguível de "a
     * plataforma não foi configurada". O lojista lê "ainda não recebemos
     * certificado" e ninguém suspeita do `.env`.
     *
     * Ausente NÃO derruba o boot de propósito — `validarSegredosProducao` não a
     * exige. Faltar aqui desabilita certificado e CSC; faltar lá derrubaria a
     * API inteira, licença e renovação junto, por causa do fiscal.
     */
    const tokenDaConta =
      process.env.FOCUS_NFE_PARTNER_TOKEN?.trim() || process.env.FOCUS_CONTA_TOKEN?.trim()

    if (!tokenDaConta) {
      this.logger.error(
        'FOCUS_NFE_PARTNER_TOKEN ausente: nada pode ser gravado no cadastro da empresa na Focus.',
      )
      throw new HttpException(
        { codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA', mensagem: mensagemIndisponivel },
        HttpStatus.NOT_IMPLEMENTED,
      )
    }

    /**
     * O `focusEmpresaId`, descoberto sozinho quando a ficha não o tem.
     *
     * Ele é DERIVÁVEL: temos o CNPJ aqui e o token de parceiro no ambiente, e a
     * Focus filtra empresa por CNPJ. Exigir que um humano copiasse esse número
     * de um painel para o outro só criava uma forma nova de errar — e quando
     * faltava, a resposta era 501 e o lojista lia "a plataforma ainda não
     * recebe certificado", procurando defeito no deploy, no `.env` e na Focus,
     * que era exatamente onde o problema não estava.
     *
     * O que continua NÃO sendo automático é CRIAR a empresa: isso exige
     * endereço completo e regime tributário, que esta ficha não guarda, e
     * empresa criada pela metade na Focus é pior do que nenhuma — passa a
     * existir, some da lista de pendências e falha só na primeira nota.
     */
    let empresaId = config.focusEmpresaId

    if (!empresaId) {
      let encontrada: any = null
      try {
        encontrada = await this.focusNfeService.buscarEmpresaPorCnpj(tokenDaConta, config.cnpj)
      } catch (erro) {
        // Mesma conversão que o chamador faz no envio: 401/403 aqui é o NOSSO
        // token, e deixá-lo passar cru faria o lojista mexer no que ele mandou.
        if (erro instanceof HttpException && [401, 403].includes(erro.getStatus())) {
          this.logger.error('A Focus recusou o token de parceiro ao procurar a empresa pelo CNPJ.')
          throw new HttpException(
            { codigo: 'PLATAFORMA_SEM_TOKEN_DA_CONTA', mensagem: mensagemIndisponivel },
            HttpStatus.NOT_IMPLEMENTED,
          )
        }
        throw erro
      }

      if (!encontrada?.id) {
        this.logger.error(
          `Cliente ${config.clienteId}: nenhuma empresa de CNPJ ${config.cnpj} no cadastro da Focus.`,
        )
        throw new HttpException(
          {
            codigo: 'EMPRESA_SEM_CADASTRO_NA_EMISSORA',
            mensagem: 'A empresa ainda não está cadastrada na emissora.',
          },
          HttpStatus.NOT_IMPLEMENTED,
        )
      }

      empresaId = String(encontrada.id)

      /**
       * Gravado ANTES da escrita que o chamador vai fazer, de propósito.
       *
       * Se ela falhar por outro motivo — senha errada, Focus fora do ar —,
       * o id descoberto continua correto e a próxima tentativa não repete a
       * consulta. Guardar só depois do sucesso jogaria fora um dado válido por
       * causa de uma falha que não tem relação com ele.
       */
      await prisma.empresaFiscalConfig.update({
        where: { clienteId: config.clienteId },
        data:  { focusEmpresaId: empresaId },
      })

      this.logger.log(
        `Empresa ${empresaId} descoberta na Focus pelo CNPJ ${config.cnpj} e vinculada ao cliente ${config.clienteId}.`,
      )
    }

    return { config, tokenDaConta, empresaId }
  }
}
