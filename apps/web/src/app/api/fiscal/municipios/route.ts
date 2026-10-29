import { proxyRequest } from '@/lib/server'

// Municípios NFS-e (G6): o que a Focus diz de cada cidade e o que o suporte decidiu.
export async function GET() {
  return proxyRequest('/fiscal/municipios')
}
