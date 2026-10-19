/**
 * Layout dos e-mails no visual do site (startbig.com.br): fundo off-white,
 * cartão branco, logo no topo como a barra do site, azul da marca nos destaques
 * e Inter com fallback.
 *
 * Tudo em tabela e estilo inline porque é o que Gmail e Outlook respeitam:
 * <style>, flex e SVG somem em boa parte dos clientes. Pelo mesmo motivo o logo
 * é o PNG publicado no site, não o SVG do componente.
 *
 * Todo texto variável passa por `esc` antes de entrar aqui. Nome do cliente e
 * hostname chegam por rota pública (auto-cadastro, login do ERP).
 */

/** Paleta do site (`Projeto-blog-startbig/app/assets/css/main.css`). */
export const COR = {
  primaria:      '#045CA1',
  primariaClara: '#E7F1FA',
  secundaria:    '#5590BF',
  escuro:        '#151515',
  texto:         '#334155',
  apagado:       '#64748B',
  borda:         '#E9E9E9',
  fundo:         '#F8F7FF',
  branco:        '#FFFFFF',
} as const

/** Tom do selo e da caixa de destaque: o que o e-mail quer dizer de relance. */
export type Tom = 'info' | 'sucesso' | 'atencao' | 'perigo'

// Borda sólida, não a cor com transparência: o Outlook ignora hex de 8 dígitos.
const TONS: Record<Tom, { cor: string; fundo: string; borda: string }> = {
  info:    { cor: COR.primaria, fundo: COR.primariaClara, borda: '#BFD7EC' },
  sucesso: { cor: '#047857',    fundo: '#ECFDF5',         borda: '#A7F3D0' },
  atencao: { cor: '#B45309',    fundo: '#FFFBEB',         borda: '#FDE68A' },
  perigo:  { cor: '#B91C1C',    fundo: '#FEF2F2',         borda: '#FECACA' },
}

const LOGO_URL = process.env.EMAIL_LOGO_URL ?? 'https://startbig.com.br/img/logo-startbig.png'
const SITE_URL = 'https://startbig.com.br'

/** Os mesmos canais da seção Suporte do site (`app/shared/contact.js`). */
const WHATSAPP_NUMERO  = '5588996971128'
const WHATSAPP_EXIBIDO = '(88) 99697-1128'
const EMAIL_SUPORTE    = 'startbig.oficial@gmail.com'

const FONTE = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"

export const esc = (texto: unknown) =>
  String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// ── Blocos ──────────────────────────────────────────────────────────────────

/** Parágrafo de corpo. `html` já escapado por quem chama. */
export const paragrafo = (html: string) =>
  `<p style="margin:0 0 16px;color:${COR.texto};font-size:15px;line-height:1.7;">${html}</p>`

/** Nota de rodapé do conteúdo, em cinza, separada por uma linha. */
export const nota = (html: string) =>
  `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid ${COR.borda};color:${COR.apagado};font-size:13px;line-height:1.6;">${html}</p>`

/**
 * Caixa de destaque: rótulo pequeno em caixa alta e o valor grande — a chave
 * de ativação, a nova validade, os dias que faltam.
 */
export function destaque(o: { rotulo: string; valor: string; detalhe?: string; tom?: Tom; mono?: boolean }) {
  const t = TONS[o.tom ?? 'info']
  const fonteValor = o.mono ? "'Courier New',Courier,monospace" : FONTE
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
  <tr><td style="background:${t.fundo};border:1px solid ${t.borda};border-radius:12px;padding:22px 20px;text-align:center;">
    <p style="margin:0 0 8px;color:${COR.apagado};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;">${o.rotulo}</p>
    <p style="margin:0;color:${t.cor};font-size:${o.mono ? 22 : 24}px;font-weight:800;line-height:1.3;font-family:${fonteValor};${o.mono ? 'letter-spacing:2px;' : ''}word-break:break-all;">${o.valor}</p>
    ${o.detalhe ? `<p style="margin:10px 0 0;color:${COR.texto};font-size:13px;">${o.detalhe}</p>` : ''}
  </td></tr>
</table>`
}

/** Aviso em faixa, com a cor do tom na lateral. */
export function aviso(html: string, tom: Tom = 'atencao') {
  const t = TONS[tom]
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr><td style="background:${t.fundo};border-left:4px solid ${t.cor};border-radius:8px;padding:14px 16px;color:${COR.texto};font-size:14px;line-height:1.6;">${html}</td></tr>
</table>`
}

/** Pares rótulo / valor lado a lado (dispositivo, validade...). */
export function dados(linhas: [rotulo: string, valor: string][]) {
  // Linha só entre os pares: a última sem borda, para não somar com a da `nota`.
  const celulas = linhas.map(([rotulo, valor], i) => {
    const borda = i < linhas.length - 1 ? `border-bottom:1px solid ${COR.borda};` : ''
    return `
  <tr>
    <td style="padding:10px 0;${borda}color:${COR.apagado};font-size:13px;width:40%;">${rotulo}</td>
    <td style="padding:10px 0;${borda}color:${COR.escuro};font-size:14px;font-weight:600;text-align:right;word-break:break-word;">${valor}</td>
  </tr>`
  }).join('')
  // `fixed`: sem isso um HWID comprido alarga a tabela e estoura a tela do celular.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;table-layout:fixed;">${celulas}</table>`
}

/** Botão no estilo `.btn-primary` do site. */
export function botao(texto: string, href: string) {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
  <tr><td style="background:${COR.primaria};border-radius:8px;">
    <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;font-family:${FONTE};">${texto}</a>
  </td></tr>
</table>`
}

// ── Página ──────────────────────────────────────────────────────────────────

/**
 * Monta o e-mail inteiro.
 *
 * `preheader` é a frase que o Gmail mostra ao lado do assunto na caixa de
 * entrada; sem ela aparece o começo do HTML ("Sua chave... Olá, ...").
 */
export function layout(o: {
  selo:       string
  tom?:       Tom
  titulo:     string
  preheader:  string
  corpo:      string
  /** Alerta interno: troca o rodapé de suporte por uma linha técnica. */
  interno?:   boolean
}) {
  const t = TONS[o.tom ?? 'info']
  const ano = new Date().getFullYear()

  const rodape = o.interno
    ? `<p style="margin:0;color:${COR.apagado};font-size:12px;">Alerta automático da plataforma StartBIG.</p>`
    : `
<p style="margin:0 0 6px;color:${COR.texto};font-size:13px;font-weight:600;">Precisa de ajuda?</p>
<p style="margin:0 0 14px;color:${COR.apagado};font-size:13px;line-height:1.7;">
  WhatsApp <a href="https://wa.me/${WHATSAPP_NUMERO}" style="color:${COR.primaria};text-decoration:none;font-weight:600;">${WHATSAPP_EXIBIDO}</a>
  &nbsp;·&nbsp; <a href="mailto:${EMAIL_SUPORTE}" style="color:${COR.primaria};text-decoration:none;">${EMAIL_SUPORTE}</a>
</p>
<p style="margin:0;color:#94A3B8;font-size:12px;">
  © ${ano} <a href="${SITE_URL}" style="color:#94A3B8;text-decoration:none;">StartBIG</a> · Desenvolvido por BIG TEC
</p>`

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(o.titulo)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${COR.fundo};font-family:${FONTE};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.fundo};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COR.branco};border:1px solid ${COR.borda};border-radius:16px;overflow:hidden;">
        <tr><td style="height:4px;line-height:4px;font-size:0;background:${COR.primaria};background-image:linear-gradient(90deg,${COR.primaria},${COR.secundaria});">&nbsp;</td></tr>
        <tr><td style="padding:24px 32px 20px;border-bottom:1px solid ${COR.borda};">
          <a href="${SITE_URL}" style="text-decoration:none;"><img src="${LOGO_URL}" width="150" alt="StartBIG" style="display:block;width:150px;max-width:150px;height:auto;border:0;"></a>
        </td></tr>
        <tr><td style="padding:28px 32px 32px;font-family:${FONTE};">
          <span style="display:inline-block;background:${t.fundo};color:${t.cor};font-size:12px;font-weight:600;padding:5px 12px;border-radius:100px;letter-spacing:0.02em;margin-bottom:14px;">${esc(o.selo)}</span>
          <h1 style="margin:0 0 18px;color:${COR.escuro};font-size:24px;font-weight:800;line-height:1.25;letter-spacing:-0.01em;">${esc(o.titulo)}</h1>
          ${o.corpo}
        </td></tr>
        <tr><td style="padding:22px 32px;background:${COR.fundo};border-top:1px solid ${COR.borda};font-family:${FONTE};">
          ${rodape}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
