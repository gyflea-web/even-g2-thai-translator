import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildConfig, startTranslationStream, type StreamStatus } from '../src/soniox'

class FakeSocket {
  static last: FakeSocket
  readyState = 0
  binaryType = ''
  bufferedAmount = 0
  sent: unknown[] = []
  private listeners: Record<string, ((ev: any) => void)[]> = {}
  constructor() {
    FakeSocket.last = this
  }
  addEventListener(type: string, cb: (ev: any) => void) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.emit('close', {})
  }
  emit(type: string, ev: any) {
    for (const cb of this.listeners[type] ?? []) cb(ev)
  }
  open() {
    this.readyState = 1
    this.emit('open', {})
  }
}

const createSocket = () => new FakeSocket() as unknown as WebSocket

afterEach(() => vi.useRealTimers())

describe('buildConfig', () => {
  it('asks for two-way Thai <-> Korean translation of 16 kHz PCM', () => {
    const c = buildConfig({ apiKey: 'k' })
    expect(c).toMatchObject({
      api_key: 'k',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      enable_language_identification: true,
      translation: { type: 'two_way', language_a: 'th', language_b: 'ko' },
    })
  })
})

describe('startTranslationStream', () => {
  it('sends config first, flushes buffered audio, then streams', () => {
    const statuses: StreamStatus[] = []
    const s = startTranslationStream({ apiKey: 'k', createSocket }, { onTokens: () => {}, onStatus: (x) => statuses.push(x) })
    const sock = FakeSocket.last
    s.sendPcm(new Uint8Array([1, 2]))
    sock.open()
    s.sendPcm(new Uint8Array([3, 4]))
    expect(JSON.parse(sock.sent[0] as string).api_key).toBe('k')
    expect(sock.sent.slice(1)).toEqual([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    expect(statuses).toEqual(['connecting', 'live'])
  })

  it('passes tokens through and stops on an auth error', () => {
    const tokens: unknown[] = []
    const statuses: string[] = []
    startTranslationStream(
      { apiKey: 'bad', createSocket },
      { onTokens: (t) => tokens.push(...t), onStatus: (x, d) => statuses.push(d ? `${x}:${d}` : x) },
    )
    const sock = FakeSocket.last
    sock.open()
    sock.emit('message', { data: JSON.stringify({ tokens: [{ text: 'a', is_final: true }] }) })
    expect(tokens).toHaveLength(1)
    sock.emit('message', { data: JSON.stringify({ error_code: 401, error_message: 'Invalid API key' }) })
    sock.close()
    expect(statuses.at(-1)).toMatch(/^error:API 키/)
    expect(FakeSocket.last).toBe(sock) // no reconnect
  })

  it('reconnects after an unexpected drop', () => {
    vi.useFakeTimers()
    let restarts = 0
    startTranslationStream({ apiKey: 'k', createSocket }, { onTokens: () => {}, onStatus: () => {}, onRestart: () => restarts++ })
    const first = FakeSocket.last
    first.open()
    first.close()
    expect(restarts).toBe(1)
    vi.advanceTimersByTime(600)
    expect(FakeSocket.last).not.toBe(first)
  })

  it('sends keepalive instead of audio while paused', () => {
    vi.useFakeTimers()
    const s = startTranslationStream({ apiKey: 'k', createSocket }, { onTokens: () => {}, onStatus: () => {} })
    const sock = FakeSocket.last
    sock.open()
    s.setPaused(true)
    s.sendPcm(new Uint8Array([9]))
    vi.advanceTimersByTime(10_000)
    expect(sock.sent.slice(1)).toEqual([JSON.stringify({ type: 'keepalive' })])
  })

  it('reports a missing key without connecting', () => {
    const statuses: string[] = []
    const before = FakeSocket.last
    startTranslationStream({ apiKey: '', createSocket }, { onTokens: () => {}, onStatus: (x) => statuses.push(x) })
    expect(statuses).toEqual(['error'])
    expect(FakeSocket.last).toBe(before)
  })
})
