import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3001'

export async function proxyRequest(path: string, init: RequestInit = {}) {
  const cookieStore = await cookies()
  const token = cookieStore.get('token')?.value

  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
