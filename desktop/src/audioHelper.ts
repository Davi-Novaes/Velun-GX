import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import path from 'node:path'
import { app, type WebContents } from 'electron'

/**
 * Origem do som. exclude-discord-and-app: PC sem o Discord e sem o próprio Velun Gx (você continua ouvindo as
 * transmissões dos outros). exclude-discord: modo antigo/reserva, que inclui o som do app — a página então
 * silencia as outras transmissões enquanto você transmite, para não dar eco. window-app: só o programa da janela.
 */
export type AudioMode = 'exclude-discord-and-app' | 'exclude-discord' | 'window-app'

export interface SelectedSource {
  id: string
  name: string
  kind: 'screen' | 'window'
}

export interface AudioStatus {
  event: string
  data: Record<string, unknown>
}

const BYTES_PER_FRAME = 4 // PCM 16 bits estéreo

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'VelunAudio.exe')
    : path.join(__dirname, '..', 'dist-native', 'VelunAudio.exe')
}

/**
 * Roda o VelunAudio.exe e repassa o PCM para a página que pediu.
 * Só existe uma captura por vez; iniciar de novo troca a anterior.
 */
export class AudioHelper {
  private process: ChildProcessWithoutNullStreams | null = null
  private probeResult: Promise<{ supported: boolean; message?: string }> | null = null

  probe(): Promise<{ supported: boolean; message?: string }> {
    // testes: simula um Windows sem captura por programa (Windows 10)
    if (process.env.VELUN_SIMULATE_WIN10 === '1') return Promise.resolve({ supported: false, message: 'A captura por programa exige Windows 11.' })
    this.probeResult ??= new Promise((resolve) => {
      const child = spawn(helperPath(), ['--probe'], { windowsHide: true })
      let output = ''
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
      child.on('error', (error) => resolve({ supported: false, message: `Componente de áudio indisponível: ${error.message}` }))
      child.on('exit', (code) => {
        const status = parseLines(output).at(-1)
        resolve(code === 0 ? { supported: true } : { supported: false, message: String(status?.data.message ?? 'Este Windows não permite separar o som por programa.') })
      })
    })
    return this.probeResult
  }

  async start(owner: WebContents, scope: 'shared' | 'system', source: SelectedSource | null): Promise<{ mode: AudioMode }> {
    this.stop()
    // janela + "só o que é compartilhado": som apenas daquele programa; nos outros casos, o PC inteiro sem o
    // Discord e sem o próprio app (a árvore deste processo inclui o serviço de áudio do Chromium)
    const hwnd = scope === 'shared' && source?.kind === 'window' ? source.id.split(':')[1] : undefined
    const args = hwnd ? ['--include-hwnd', hwnd] : ['--multi', '--exclude-tree-pid', String(process.pid)]
    const child = spawn(helperPath(), args, { windowsHide: true })
    this.process = child
    let resolveMode: (mode: AudioMode) => void = () => undefined
    const decided = new Promise<AudioMode>((resolve) => { resolveMode = resolve })
    // o componente diz qual modo conseguiu: o novo (sem o app) ou o reserva (só sem o Discord)
    const fallbackTimer = setTimeout(() => resolveMode(hwnd ? 'window-app' : 'exclude-discord'), 4000)

    let pending: Buffer = Buffer.alloc(0)
    child.stdout.on('data', (chunk: Buffer) => {
      if (owner.isDestroyed()) return
      // só repassa quadros inteiros (4 bytes); o resto espera o próximo pedaço
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk
      const usable = data.length - (data.length % BYTES_PER_FRAME)
      pending = data.subarray(usable)
      if (usable > 0) owner.send('velun:audio:data', data.subarray(0, usable))
    })
    let lines = ''
    child.stderr.on('data', (chunk: Buffer) => {
      lines += chunk.toString('utf8')
      const end = lines.lastIndexOf('\n')
      if (end < 0) return
      for (const status of parseLines(lines.slice(0, end))) {
        if (status.event === 'started') {
          clearTimeout(fallbackTimer)
          resolveMode(hwnd ? 'window-app' : status.data.mode === 'exclude-discord-and-app' ? 'exclude-discord-and-app' : 'exclude-discord')
        }
        if (!owner.isDestroyed()) owner.send('velun:audio:status', status)
      }
      lines = lines.slice(end + 1)
    })
    child.on('error', (error) => { if (!owner.isDestroyed()) owner.send('velun:audio:status', { event: 'error', data: { message: error.message } }) })
    child.on('exit', (code) => {
      clearTimeout(fallbackTimer)
      resolveMode(hwnd ? 'window-app' : 'exclude-discord')
      if (this.process === child) this.process = null
      if (!owner.isDestroyed()) owner.send('velun:audio:status', { event: 'exited', data: { code } })
    })
    return { mode: await decided }
  }

  stop(): void {
    void this.stopAndWait(2000)
  }

  /** Pede o encerramento (fecha o stdin) e espera o processo sair; passado o prazo, encerra à força. */
  stopAndWait(timeoutMs: number): Promise<void> {
    const child = this.process
    this.process = null
    if (!child || child.exitCode !== null) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve() }, timeoutMs)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.stdin.end()
    })
  }
}

function parseLines(text: string): AudioStatus[] {
  const result: AudioStatus[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try { result.push(JSON.parse(line) as AudioStatus) } catch { /* linha que não é status */ }
  }
  return result
}
