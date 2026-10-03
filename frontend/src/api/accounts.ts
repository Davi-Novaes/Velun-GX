export interface AccountProfile {
  id: string
  username: string
  /** Apelido escolhido; null = usa o nome de usuário. */
  nickname: string | null
  /** Nome exibido para os outros (apelido ou nome de usuário). */
  name: string
  avatar: string | null
  createdAt: string
  lastLoginAt: string | null
}

export class AccountApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

async function call<T>(path: string, body?: unknown, method?: 'POST' | 'PATCH'): Promise<T> {
  try {
    let csrf: string | undefined
    if (body !== undefined) {
      const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new AccountApiError(response.status, 'CSRF_INVALID', 'Não foi possível preparar a sessão. Tente novamente.')
      csrf = ((await response.json()) as { token: string }).token
    }
    const response = await fetch(`/api/v1/auth/${path}`, {
      method: body === undefined ? 'GET' : method ?? 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf! },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { code?: string; detail?: string }
      throw new AccountApiError(response.status, problem.code ?? 'UNKNOWN', problem.detail ?? (response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível concluir. Tente novamente.'))
    }
    return response.status === 204 ? undefined as T : await response.json() as T
  } catch (error) {
    if (error instanceof AccountApiError) throw error
    throw new AccountApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Tente novamente.')
  }
}

export const accounts = {
  me: () => call<AccountProfile>('me'),
  register: (username: string, password: string, confirmPassword: string) => call<AccountProfile>('register', { username, password, confirmPassword }),
  login: (username: string, password: string) => call<AccountProfile>('login', { username, password }),
  logout: () => call<void>('logout', {}),
  updateProfile: (changes: { nickname: string | null }) => call<AccountProfile>('me', changes, 'PATCH'),
}
