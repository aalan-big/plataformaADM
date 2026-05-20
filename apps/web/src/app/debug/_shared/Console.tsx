'use client'

interface ApiResponse {
  ok: boolean
  status?: number
  data?: unknown
  payload?: unknown
}

export function Console({ response }: { response: ApiResponse | null }) {
  if (!response) {
    return (
      <pre className="bg-black rounded-xl p-4 text-xs text-slate-600 min-h-24 overflow-auto">
        Aguardando requisição...
      </pre>
    )
  }

  return (
    <pre className={`bg-black rounded-xl p-4 text-xs min-h-24 overflow-auto whitespace-pre-wrap break-all ${
      response.ok ? 'text-emerald-400' : 'text-amber-400'
    }`}>
      {JSON.stringify({ status: response.status, data: response.data ?? response.payload }, null, 2)}
    </pre>
  )
}
