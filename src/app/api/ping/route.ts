/**
 * ARQUIVO: Rota de API (Exemplo)
 * POSIÇÃO: Camada de Entrada do Servidor (Controller)
 * FUNÇÃO: Responder a uma requisição do tipo POST para confirmar 
 * que o servidor está "vivo" e funcionando.
 */
export async function POST() {
  // Retorna uma resposta no formato JSON com um status de sucesso
  // O termo 'pong' é uma resposta padrão para um teste de 'ping'
  return Response.json({ ok: true, msg: 'pong' })
}
