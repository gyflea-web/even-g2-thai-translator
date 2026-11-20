// Soniox real-time speech recognition + two-way translation (Thai <-> Korean)
// over one WebSocket. Audio in: PCM s16le, 16 kHz, mono (the G2 mic format).
//
// Protocol (from the official @soniox/client SDK types):
//   1. open wss://stt-rt.soniox.com/transcribe-websocket
//   2. send one JSON config message (includes the API key)
//   3. send binary audio frames
//   4. receive JSON { tokens: [...], finished?, error_code?, error_message? }
//   5. send {"type":"keepalive"} while no audio flows, "" (empty) to finish

import type { SonioxToken } from './transcript'

export const SONIOX_WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
export const DEFAULT_MODEL = 'stt-rt-v6'

const KEEPALIVE_MS = 10_000
const MAX_PENDING_CHUNKS = 300 // ~3 s of 10 ms frames buffered while connecting
const BACKPRESSURE_BYTES = 256_000 // drop audio if the network falls this far behind
const RECONNECT_MAX_MS = 15_000

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error'

export interface StreamOptions {
  apiKey: string
  model?: string
  languageA?: string
  languageB?: string
  /** Factory so tests can inject a fake socket. */
  createSocket?: (url: string) => WebSocket
}

export interface StreamHandlers {
  onTokens: (tokens: SonioxToken[]) => void
  onStatus: (status: StreamStatus, detail?: string) => void
  /** Called before a reconnect so the caller can close unfinished sentences. */
  onRestart?: () => void
  /** Number of utterances waiting for a translation (Gemini only). */
  onBusy?: (pending: number) => void
}

export interface TranslationStream {
  sendPcm(chunk: Uint8Array): void
  /** Stop sending audio but keep the session open (keepalive). */
  setPaused(paused: boolean): void
  close(): void
}

export function buildConfig(opts: StreamOptions): Record<string, unknown> {
  const a = opts.languageA ?? 'th'
  const b = opts.languageB ?? 'ko'
  return {
    api_key: opts.apiKey,
    model: opts.model || DEFAULT_MODEL,
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    language_hints: [a, b],
    enable_language_identification: true,
    enable_endpoint_detection: true,
    translation: { type: 'two_way', language_a: a, language_b: b },
  }
}

interface SonioxResponse {
  tokens?: SonioxToken[]
  finished?: boolean
  error_code?: number
  error_type?: string
  error_message?: string
}

function isFatal(res: SonioxResponse): boolean {
  const c = res.error_code ?? 0
  return c === 400 || c === 401 || c === 402 || c === 403
}

export function describeError(res: { error_code?: number; error_message?: string }): string {
  const c = res.error_code
  if (c === 401 || c === 403) return 'API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.'
  if (c === 402) return 'Soniox 계정 잔액이 부족합니다.'
  if (c === 400) return `요청 설정 오류: ${res.error_message ?? ''}`.trim()
  if (c === 429) return '요청이 너무 많습니다. 잠시 후 다시 연결합니다.'
  return `Soniox 오류 ${c ?? ''} ${res.error_message ?? ''}`.trim()
}

export function startTranslationStream(opts: StreamOptions, h: StreamHandlers): TranslationStream {
  const createSocket = opts.createSocket ?? ((url: string) => new WebSocket(url))
  let ws: WebSocket | null = null
  let ready = false
  let closedByUs = false
  let fatal = false
  let paused = false
  let attempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null
  const pending: Uint8Array[] = []

  function connect(): void {
    if (closedByUs || fatal) return
    h.onStatus(attempts > 0 ? 'reconnecting' : 'connecting')
    ready = false
    const sock = createSocket(SONIOX_WS_URL)
    sock.binaryType = 'arraybuffer'
    ws = sock

    sock.addEventListener('open', () => {
      if (ws !== sock) return
      sock.send(JSON.stringify(buildConfig(opts)))
      ready = true
      h.onStatus('live')
      for (const chunk of pending) sock.send(chunk)
      pending.length = 0
    })

    sock.addEventListener('message', (ev: MessageEvent) => {
      if (ws !== sock) return
      let res: SonioxResponse
      try {
        const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
        res = JSON.parse(raw)
      } catch {
        return
      }
      if (res.error_code) {
        if (isFatal(res)) fatal = true
        h.onStatus('error', describeError(res))
        return
      }
      // A good response means the connection is healthy again.
      attempts = 0
      if (res.tokens?.length) h.onTokens(res.tokens)
    })

    sock.addEventListener('close', () => {
      if (ws !== sock) return
      ready = false
      if (closedByUs || fatal) {
        if (!fatal) h.onStatus('closed')
        return
      }
      h.onRestart?.()
      const delay = Math.min(RECONNECT_MAX_MS, 500 * 2 ** attempts)
      attempts++
      h.onStatus('reconnecting')
      reconnectTimer = setTimeout(connect, delay)
    })
  }

  function startKeepalive(): void {
    stopKeepalive()
    keepaliveTimer = setInterval(() => {
      if (ws && ready && ws.readyState === 1) ws.send(JSON.stringify({ type: 'keepalive' }))
    }, KEEPALIVE_MS)
  }

  function stopKeepalive(): void {
    if (keepaliveTimer !== null) clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }

  if (!opts.apiKey) {
    fatal = true
    h.onStatus('error', 'Soniox API 키가 없습니다. 휴대폰 화면의 설정에서 입력하세요.')
  } else {
    connect()
  }

  return {
    sendPcm(chunk) {
      if (closedByUs || fatal || paused) return
      if (ws && ready && ws.readyState === 1) {
        if (ws.bufferedAmount > BACKPRESSURE_BYTES) return
        ws.send(chunk)
      } else {
        if (pending.length >= MAX_PENDING_CHUNKS) pending.shift()
        pending.push(chunk.slice())
      }
    },
    setPaused(p) {
      paused = p
      if (p) startKeepalive()
      else stopKeepalive()
    },
    close() {
      closedByUs = true
      stopKeepalive()
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      try {
        if (ws && ws.readyState === 1) ws.send('')
        ws?.close()
      } catch {
        /* already closed */
      }
    },
  }
}
