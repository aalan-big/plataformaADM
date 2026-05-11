'use client'

import { useState, useEffect, useCallback } from 'react'

interface Usuario {
  id: number
  nome: string
  email: string
  cargo: string
  ativo: boolean
  criadoEm: string
}

interface FormData {
  nome: string
  email: string
  senha: string
  cargo: string
}

interface Feedback {
  tipo: 'ok' | 'erro'
  msg: string
}

const FORM_VAZIO: FormData = { nome: '', email: '', senha: '', cargo: 'ADMIN' }

export default function DashboardPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [formData, setFormData] = useState<FormData>(FORM_VAZIO)
  const [editando, setEditando] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/usuario')
      const data = await res.json()
      if (res.ok && Array.isArray(data)) setUsuarios(data)
    } catch {
      mostrarFeedback('erro', 'Erro ao carregar usuários')
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  function mostrarFeedback(tipo: Feedback['tipo'], msg: string) {
    setFeedback({ tipo, msg })
    setTimeout(() => setFeedback(null), 3000)
  }

  function iniciarEdicao(usuario: Usuario) {
    setEditando(usuario.id)
    setFormData({ nome: usuario.nome, email: usuario.email, senha: '', cargo: usuario.cargo })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() {
    setEditando(null)
    setFormData(FORM_VAZIO)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    try {
      if (editando) {
        const res = await fetch('/api/usuario', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editando, ...formData }),
        })
        if (res.ok) {
          mostrarFeedback('ok', 'Usuário atualizado com sucesso!')
          cancelarEdicao()
          carregar()
        } else {
          const err = await res.json()
          mostrarFeedback('erro', err.erro || 'Erro ao atualizar')
        }
      } else {
        const res = await fetch('/api/usuario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })
        if (res.ok) {
          mostrarFeedback('ok', 'Usuário criado com sucesso!')
          setFormData(FORM_VAZIO)
          carregar()
        } else {
          const err = await res.json()
          mostrarFeedback('erro', err.erro || 'Erro ao criar')
        }
      }
    } catch {
      mostrarFeedback('erro', 'Erro ao conectar com a API')
    } finally {
      setLoading(false)
    }
  }

  async function deletar(id: number, nome: string) {
    if (!confirm(`Deletar "${nome}"?`)) return
    try {
      const res = await fetch(`/api/usuario?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        mostrarFeedback('ok', 'Usuário deletado')
        carregar()
      } else {
        const err = await res.json()
        mostrarFeedback('erro', err.erro || 'Erro ao deletar')
      }
    } catch {
      mostrarFeedback('erro', 'Erro ao conectar com a API')
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 font-sans">
      <main className="max-w-5xl mx-auto space-y-8">

        <header className="border-b pb-4">
          <h1 className="text-3xl font-bold tracking-tight">Sandbox: CRUD de Usuários</h1>
          <p className="text-zinc-500 text-sm mt-1">Teste de integração: Next.js + Prisma + SQLite</p>
        </header>

        {feedback && (
          <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
            feedback.tipo === 'ok'
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}>
            {feedback.msg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          <section className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-lg font-semibold mb-4">
              {editando ? `Editando usuário #${editando}` : 'Novo usuário'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Nome</label>
                <input
                  className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 text-sm"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">E-mail</label>
                <input
                  type="email"
                  className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 text-sm"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              {!editando && (
                <div>
                  <label className="block text-sm font-medium mb-1">Senha</label>
                  <input
                    type="password"
                    className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 text-sm"
                    value={formData.senha}
                    onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                    required
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Cargo</label>
                <select
                  className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700 text-sm"
                  value={formData.cargo}
                  onChange={(e) => setFormData({ ...formData, cargo: e.target.value })}
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="GERENTE">GERENTE</option>
                  <option value="SUPORTE">SUPORTE</option>
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar usuário'}
                </button>
                {editando && (
                  <button
                    type="button"
                    onClick={cancelarEdicao}
                    className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Usuários ({usuarios.length})</h2>
              <button
                onClick={carregar}
                className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                Atualizar
              </button>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-zinc-100 dark:bg-zinc-800">
                  <tr>
                    <th className="p-3 border-b dark:border-zinc-700">#</th>
                    <th className="p-3 border-b dark:border-zinc-700">Nome</th>
                    <th className="p-3 border-b dark:border-zinc-700">Cargo</th>
                    <th className="p-3 border-b dark:border-zinc-700">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-zinc-500">
                        Nenhum usuário cadastrado.
                      </td>
                    </tr>
                  ) : (
                    usuarios.map((user) => (
                      <tr
                        key={user.id}
                        className={`border-b dark:border-zinc-800 last:border-0 ${
                          editando === user.id ? 'bg-blue-50 dark:bg-blue-950' : ''
                        }`}
                      >
                        <td className="p-3 text-zinc-400">{user.id}</td>
                        <td className="p-3 font-medium">
                          {user.nome}
                          <div className="text-xs text-zinc-400 font-normal">{user.email}</div>
                        </td>
                        <td className="p-3">
                          <span className="text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded font-mono">
                            {user.cargo}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => iniciarEdicao(user)}
                              className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => deletar(user.id, user.nome)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              Deletar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      </main>
    </div>
  )
}
