import type { CreatedRoom, ErrorCode, JoinResponse, RoomInfo } from './contracts'

/** Erro da API já traduzido do ProblemDetails (campo `code`). */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly retryAfterSeconds: number | undefined

  constructor(code: ErrorCode, status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const BASE = '/api/v1'

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, 'Sem conexão com o servidor.')
  }

  if (response.ok) {
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  let code: ErrorCode = 'UNKNOWN'
  let message = `Erro ${response.status}`
  try {
    const problem = (await response.json()) as { code?: ErrorCode; detail?: string; title?: string }
    code = problem.code ?? code
    message = problem.detail ?? problem.title ?? message
  } catch {
    // corpo não é JSON (ex.: proxy): mantém mensagem genérica
  }
  const retryAfter = Number(response.headers.get('Retry-After'))
  throw new ApiError(code, response.status, message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined)
}

let sessionPromise: Promise<void> | null = null

/** Garante o cookie de sessão de convidado (idempotente; renova se já existir). */
export function ensureSession(): Promise<void> {
  sessionPromise ??= request<unknown>('POST', '/sessions').then(
    () => undefined,
    (error: unknown) => {
      sessionPromise = null
      throw error
    },
  )
  return sessionPromise
}

/** Só para testes. */
export function resetSessionForTests(): void {
  sessionPromise = null
}

async function withSession<T>(call: () => Promise<T>): Promise<T> {
  await ensureSession()
  try {
    return await call()
  } catch (error) {
    // sessão expirou entre chamadas: renova uma vez e tenta de novo
    if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
      sessionPromise = null
      await ensureSession()
      return call()
    }
    throw error
  }
}

export const api = {
  createRoom: () => withSession(() => request<CreatedRoom>('POST', '/rooms')),

  getRoom: (code: string) => request<RoomInfo>('GET', `/rooms/${encodeURIComponent(code)}`),

  joinRoom: (code: string, displayName: string, participantId?: string) =>
    withSession(() =>
      request<JoinResponse>('POST', `/rooms/${encodeURIComponent(code)}/join`, { displayName, participantId }),
    ),

  /** Melhor esforço, inclusive ao fechar a aba (sendBeacon). */
  leaveRoom: (code: string, participantId: string) => {
    const url = `${BASE}/rooms/${encodeURIComponent(code)}/leave`
    const body = JSON.stringify({ participantId })
    if (typeof navigator.sendBeacon === 'function' &&
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) {
      return
    }
    void fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body })
      .catch(() => undefined)
  },
}

export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Algo deu errado. Tente novamente.'
  switch (error.code) {
    case 'ROOM_NOT_FOUND':
      return 'Sala não encontrada. Confira o link.'
    case 'ROOM_EXPIRED':
      return 'Esta sala expirou. Crie uma nova sala.'
    case 'ROOM_FULL':
      return 'A sala atingiu o limite de participantes.'
    case 'RATE_LIMITED':
      return `Muitas tentativas. Aguarde ${error.retryAfterSeconds ?? 'alguns'} segundos.`
    case 'NETWORK_ERROR':
      return 'Sem conexão com o servidor. Verifique sua internet.'
    case 'SFU_UNAVAILABLE':
    case 'ROOM_BUSY':
      return 'O servidor está ocupado. Tente novamente em instantes.'
    default:
      return error.message
  }
}
