import { AccountApiError } from './accounts'

export interface AdminStream {
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  hardware: boolean | null
  /** none | cpu | bandwidth | other (WebRTC) */
  limitation: string | null
  mbps: number | null
}

export interface AdminCall {
  serverId: string
  server: string
  channelId: string
  channel: string
  streaming: boolean
  since: string | null
  stream: AdminStream | null
  /** como esta pessoa está recebendo cada transmissão que assiste (relatado pelo próprio navegador/app) */
  receiving: AdminReceiving[]
}

export interface AdminReceiving {
  from: string
  fps: number | null
  freezesPerMinute: number | null
  lossPercent: number | null
}

export interface AdminUser {
  id: string
  username: string
  nickname: string | null
  name: string
  createdAt: string
  lastLoginAt: string | null
  lastSeenAt: string | null
  online: boolean
  /** "App Velun Gx 0.2.9 · Windows", "Chrome · Android"… (de cada aba/app aberto agora) */
  clients: string[]
  /** logins ainda válidos (navegadores/PCs conectados à conta) */
  sessions: number
  servers: string[]
  call: AdminCall | null
  /** banida pelo administrador (null = ativa) */
  bannedAt: string | null
  banReason: string | null
  /** senha definida pelo administrador, ainda não trocada pela pessoa */
  mustChangePassword: boolean
}

export interface AdminServer {
  id: string
  name: string
  owner: string
  members: number
  channels: number
  inCall: number
  streaming: number
}

export interface AdminOverview {
  generatedAt: string
  sfuAvailable: boolean
  totals: { users: number; online: number; inCall: number; streaming: number; servers: number; activeToday: number; banned: number }
  users: AdminUser[]
  servers: AdminServer[]
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    let headers: Record<string, string> | undefined
    if (body !== undefined) {
      const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
      if (!csrf.ok) throw new AccountApiError(csrf.status, 'CSRF_INVALID', 'Não foi possível preparar o acesso. Tente novamente.')
      headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': ((await csrf.json()) as { token: string }).token }
    }
    response = await fetch(`/api/v1/admin/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof AccountApiError) throw error
    throw new AccountApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Tente novamente.')
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { code?: string; detail?: string }
    throw new AccountApiError(response.status, problem.code ?? 'UNKNOWN', problem.detail ?? (response.status === 401 ? 'Entre com o acesso de administrador.' : 'Não foi possível carregar o painel.'))
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

/** Acesso administrativo: login próprio (não é uma conta do site), definido no servidor. */
export const admin = {
  me: () => call<{ username: string }>('me'),
  login: (username: string, password: string) => call<{ username: string }>('login', { username, password }),
  logout: () => call<void>('logout', {}),
  overview: () => call<AdminOverview>('overview'),
  /** Desconecta a conta de tudo (site, app, call) e bloqueia o login. */
  ban: (userId: string, reason: string) => call<void>(`users/${userId}/ban`, { reason: reason.trim() || null }),
  unban: (userId: string) => call<void>(`users/${userId}/unban`, {}),
  /** Define a senha da conta (esqueceu a senha). mustChange: a pessoa cria a própria ao entrar. */
  setPassword: (userId: string, password: string, mustChange: boolean) => call<void>(`users/${userId}/password`, { password, mustChange }),
}
