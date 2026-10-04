import { AccountApiError } from './accounts'
import type { JoinResponse } from './contracts'

export interface Server { id: string; name: string; icon: string | null; ownerUserId: string; role: string; memberCount: number }
export interface Channel { id: string; name: string; position: number }
export interface ServerRole { id: string; serverId: string; name: string; color: string; position: number; permissions: number }
export interface Member { id: string; username: string; name: string; role: string; serverRoleId?: string | null }
export interface ServerDetails { id: string; name: string; icon: string | null; ownerUserId: string; channels: Channel[]; members: Member[]; roles?: ServerRole[] }
export interface ChannelPresence { id: string; name: string; participants: { userId: string; identity: string; name: string; isSharing: boolean }[] }
export interface Snapshot { serverId: string; details: ServerDetails; channels: ChannelPresence[] }
export interface Invite { id: string; code: string; expiresAt: string | null }
export interface InviteInfo { serverId: string; name: string; icon: string | null; invitedBy: string; memberCount: number }
export interface InviteEntry { id: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; uses: number; maxUses: number | null }

export async function communityCall<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
      if (!csrf.ok) throw new AccountApiError(csrf.status, 'CSRF_INVALID', 'Não foi possível preparar a sessão.')
      headers['X-CSRF-Token'] = ((await csrf.json()) as { token: string }).token
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { code?: string; detail?: string }
      throw new AccountApiError(response.status, problem.code ?? 'COMMUNITY_ERROR', problem.detail ?? (response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível concluir a operação.'))
    }
    return response.status === 204 ? undefined as T : await response.json() as T
  } catch (error) {
    if (error instanceof AccountApiError) throw error
    throw new AccountApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Tente novamente.')
  }
}

export const communities = {
  list: () => communityCall<Server[]>('/servers'),
  create: (name: string, icon: string | null = null) => communityCall<Server>('/servers', 'POST', { name, icon }),
  setIcon: (id: string, icon: string | null) => communityCall<void>(`/servers/${id}/icon`, 'PUT', { icon }),
  details: (id: string) => communityCall<ServerDetails>(`/servers/${id}`),
  rename: (id: string, name: string) => communityCall<void>(`/servers/${id}`, 'PATCH', { name }),
  remove: (id: string) => communityCall<void>(`/servers/${id}`, 'DELETE'),
  leave: (id: string) => communityCall<void>(`/servers/${id}/leave`, 'POST'),
  kick: (id: string, user: string) => communityCall<void>(`/servers/${id}/members/${user}`, 'DELETE'),
  move: (id: string, user: string, channelId: string | null) => communityCall<void>(`/servers/${id}/members/${user}/move`, 'POST', { channelId }),
  assignRole: (id: string, user: string, roleId: string | null) => communityCall<void>(`/servers/${id}/members/${user}/role`, 'PUT', { roleId }),
  saveRole: (id: string, role: { id?: string; name: string; color: string; position: number; permissions: number }) => communityCall<ServerRole>(`/servers/${id}/roles${role.id ? `/${role.id}` : ''}`, role.id ? 'PUT' : 'POST', role),
  deleteRole: (id: string, role: string) => communityCall<void>(`/servers/${id}/roles/${role}`, 'DELETE'),
  createChannel: (id: string, name: string) => communityCall<Channel>(`/servers/${id}/channels`, 'POST', { name }),
  renameChannel: (id: string, name: string) => communityCall<void>(`/channels/${id}`, 'PATCH', { name }),
  removeChannel: (id: string) => communityCall<void>(`/channels/${id}`, 'DELETE'),
  reorder: (id: string, ids: string[]) => communityCall<void>(`/servers/${id}/channels/order`, 'PUT', { ids }),
  invite: (id: string, maxUses: number | null = null) => communityCall<Invite>(`/servers/${id}/invites`, 'POST', { maxUses }),
  invites: (id: string) => communityCall<InviteEntry[]>(`/servers/${id}/invites`),
  revoke: (id: string, invite: string) => communityCall<void>(`/servers/${id}/invites/${invite}`, 'DELETE'),
  preview: (code: string) => communityCall<InviteInfo>(`/invites/${encodeURIComponent(code)}`),
  accept: (code: string) => communityCall<{ serverId: string }>(`/invites/${encodeURIComponent(code)}/accept`, 'POST'),
  presence: (id: string) => communityCall<ChannelPresence[]>(`/servers/${id}/presence`),
  join: (id: string) => communityCall<JoinResponse>(`/channels/${id}/join`, 'POST'),
  exit: (id: string) => communityCall<void>(`/channels/${id}/leave`, 'POST'),
  publish: (id: string, enabled: boolean) => communityCall<void>(`/channels/${id}/broadcast`, 'POST', { enabled }),
}
