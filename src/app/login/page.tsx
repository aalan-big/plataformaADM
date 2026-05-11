import { LoginForm } from '@/features/auth/components/LoginForm'

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Plataforma Admin
          </h1>
          <p className="text-zinc-500 text-sm mt-1">Faça login para continuar</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
