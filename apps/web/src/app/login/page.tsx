import { LoginForm } from './_components/LoginForm'

export default function LoginPage() {
  return (
    <div className="w-full max-w-md">
      <div className="bg-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="h-2 bg-linear-to-r from-blue-500 via-purple-500 to-pink-500" />
        <div className="p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">SB</span>
            </div>
            <div>
              <h1 className="text-white font-semibold text-lg leading-tight">StartBig</h1>
              <p className="text-slate-400 text-xs">Plataforma de Gestão</p>
            </div>
          </div>
          <LoginForm />
        </div>
        <div className="px-8 pb-6 text-center">
          <p className="text-slate-500 text-xs">© 2024 StartBig. Todos os direitos reservados.</p>
        </div>
      </div>
    </div>
  )
}
