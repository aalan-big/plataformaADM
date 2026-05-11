import * as usuarioService from '@/features/usuario/usuario.service'

export async function GET() {
  try {
    const usuarios = await usuarioService.listarUsuarios()
    return Response.json(usuarios)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return Response.json({ erro: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json()
    const usuario = await usuarioService.criarUsuario(data)
    return Response.json(usuario, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return Response.json({ erro: message }, { status: 400 })
  }
}

export async function PUT(request: Request) {
  try {
    const { id, ...data } = await request.json()
    const usuario = await usuarioService.editarUsuario(id, data)
    return Response.json(usuario)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return Response.json({ erro: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id') ?? ''
    await usuarioService.deletarUsuario(id)
    return Response.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return Response.json({ erro: message }, { status: 400 })
  }
}
