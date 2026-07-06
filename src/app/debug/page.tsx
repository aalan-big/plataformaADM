import { Tema } from './_shared/Tema'
import { TemaLogin } from './_temas/TemaLogin'


export default function DebugPage() {
  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 p-8 font-sans">
      <header className="mb-8 border-b border-slate-700 pb-4">
        <h1 className="text-2xl font-bold text-cyan-400">BigTec API Laboratory</h1>
        <p className="text-slate-400 text-sm">
          Ambiente isolado para validação de Modules (Zod + Service + Prisma)
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <Tema titulo="Login">
          <TemaLogin />
        </Tema>
      </div>
    </div>
  )
}
