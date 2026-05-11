'use client'

interface ApiResponse {
  ok: boolean
  status?: number
  statusText?: string
  payload?: unknown
  error?: string
  detalhes?: unknown
}

export function Console({ response }: { response: ApiResponse | null }) {
  return (
    <div className="bg-black rounded-xl p-4 border border-slate-700 overflow-auto max-h-48 shadow-inner mt-4">
      {response ? (
        <pre className={`text-sm ${response.ok ? 'text-green-400' : 'text-amber-400'}`}>
          {JSON.stringify(response, null, 2)}
        </pre>
      ) : (
        <p className="text-slate-600 italic text-sm">Aguardando requisição...</p>
      )}
    </div>
  )
}
