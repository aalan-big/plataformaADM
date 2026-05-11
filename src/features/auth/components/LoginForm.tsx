/**
 * ARQUIVO: Componente de Formulário de Login (Front-end)
 * POSIÇÃO: Camada de Interface (View / Client Component)
 * FUNÇÃO: Capturar o que o usuário digita, enviar para a API e 
 * dar um retorno visual (erro ou sucesso).
 */

'use client'  // Indica que este código roda no navegador do usuário (interativo)

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

// Interface para organizar os dados que o formulário armazena
interface LoginFormState {
  email: string
  senha: string
}

export function LoginForm() {
  const router = useRouter()// Ferramenta para mudar de página (redirecionar)

  // ESTADOS (Hooks): São as "memórias" temporárias da tela
  const [form, setForm] = useState<LoginFormState>({ email: '', senha: '' })// Guarda o texto digitado
  const [loading, setLoading] = useState(false) // Controla se o botão mostra "Entrando..."
  const [erro, setErro] = useState<string | null>(null) // Guarda mensagens de erro para mostrar ao usuário

  // FUNÇÃO DE ENVIO: Disparada quando o usuário clica no botão ou dá Enter
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault() // Impede que a página recarregue (padrão do HTML)
    setLoading(true) // Liga o "LED" de processamento
    setErro(null) // Limpa erros de tentativas anteriores

    try {
      // COMUNICAÇÃO: Envia os dados para a "ponte" que criamos (API Route)
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form), // Transforma o objeto em texto para a viagem
      })

      const data = await res.json()

      // VERIFICAÇÃO: Se o servidor disse que algo deu errado (ex: senha incorreta)
      if (!res.ok) {
        setErro(data.erro || 'Erro ao fazer login.')
        return
      }

      // SUCESSO: Se chegou aqui, o login deu certo. Manda o usuário para o Dashboard.
      router.push('/dashboard')
    } catch {
      // ERRO DE REDE: Caso a internet caia ou o servidor esteja desligado
      setErro('Erro ao conectar com o servidor.')
    } finally {
      setLoading(false) // Desliga o "LED" de processamento independente do resultado
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ALERTA DE ERRO: Só aparece se o estado 'erro' tiver algum texto */}
      {erro && (
        <div className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {erro}
        </div>
      )}

      {/* CAMPO DE E-MAIL */}
      <div>
        <label className="block text-sm font-medium mb-1 text-zinc-700 dark:text-zinc-300">
          E-mail
        </label>
        <input
          type="email"
          required
          className="w-full p-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="admin@exemplo.com"
        />
      </div>

      {/* CAMPO DE SENHA */}  
      <div>
        <label className="block text-sm font-medium mb-1 text-zinc-700 dark:text-zinc-300">
          Senha
        </label>
        <input
          type="password"
          required
          className="w-full p-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.senha}
          onChange={(e) => setForm({ ...form, senha: e.target.value })}
          placeholder="••••••"
        />
      </div>

      {/* BOTÃO DE AÇÃO: Muda de cor e trava enquanto 'loading' for verdadeiro */}
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors text-sm"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
