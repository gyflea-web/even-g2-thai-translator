// Thin layer over the Even Hub SDK bridge.
// Inside the Even app it talks to the real glasses. In a normal browser (for
// development) it falls back to a preview: the lens is drawn on the page and
// the computer's microphone can stand in for the glasses mic.

import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { MicSource } from './settings'

export const LENS_W = 576
export const LENS_H = 288
export const LINE_H = 27
export const PAD = 4
export const STATUS_H = 34

export const STATUS_ID = 1
export const STATUS_NAME = 'status'
export const BODY_ID = 2
export const BODY_NAME = 'body'

export type GlassesInput = 'tap' | 'doubleTap' | 'foregroundExit' | 'foregroundEnter'

export interface Glasses {
  readonly isReal: boolean
  getItem(key: string): Promise<string>
  setItem(key: string, value: string): Promise<void>
  createPage(status: string, body: string): Promise<boolean>
  setStatus(text: string): Promise<void>
  setBody(text: string): Promise<void>
  startMic(source: MicSource): Promise<boolean>
  stopMic(): Promise<void>
  onAudio(cb: (pcm: Uint8Array) => void): void
  onInput(cb: (input: GlassesInput) => void): void
  exit(): Promise<void>
}

/** Body area: below the one-line status bar. */
export function bodyGeometry() {
  const height = LENS_H - STATUS_H
  return {
    y: STATUS_H,
    height,
    maxWidth: LENS_W - 2 * PAD - 8,
    maxLines: Math.floor((height - 2 * PAD) / LINE_H),
  }
}

// The SDK can break the BLE link if calls overlap, and a call can hang. Every
// call goes through one queue with a timeout.
function makeQueue() {
  let chain: Promise<unknown> = Promise.resolve()
  return function serial<T>(label: string, fn: () => Promise<T>, ms = 4000): Promise<T> {
    const run = chain.then(() =>
      Promise.race([
        fn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
      ]),
    )
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

function pageLayout(status: string, body: string) {
  const g = bodyGeometry()
  return {
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: LENS_W,
        height: STATUS_H,
        borderWidth: 0,
        paddingLength: PAD,
        containerID: STATUS_ID,
        containerName: STATUS_NAME,
        content: status,
        textColor: 2,
        isEventCapture: 0,
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: g.y,
        width: LENS_W,
        height: g.height,
        borderWidth: 0,
        paddingLength: PAD,
        containerID: BODY_ID,
        containerName: BODY_NAME,
        content: body,
        isEventCapture: 1,
      }),
    ],
  }
}

function classify(eventType: OsEventTypeList | undefined, present: boolean): GlassesInput | null {
  if (!present) return null
  // On hardware a plain tap can arrive with eventType undefined (CLICK_EVENT = 0).
  if (eventType === undefined || eventType === OsEventTypeList.CLICK_EVENT) return 'tap'
  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'doubleTap'
  if (eventType === OsEventTypeList.FOREGROUND_EXIT_EVENT) return 'foregroundExit'
  if (eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT) return 'foregroundEnter'
  return null
}

class RealGlasses implements Glasses {
  readonly isReal = true
  private serial = makeQueue()
  private audioCbs: ((pcm: Uint8Array) => void)[] = []
  private inputCbs: ((i: GlassesInput) => void)[] = []
  private created = false

  constructor(private bridge: EvenAppBridge) {
    bridge.onEvenHubEvent((event) => {
      if (event.audioEvent?.audioPcm) {
        for (const cb of this.audioCbs) cb(event.audioEvent.audioPcm)
        return
      }
      const input =
        classify(event.textEvent?.eventType, !!event.textEvent) ??
        classify(event.sysEvent?.eventType, !!event.sysEvent) ??
        classify(event.listEvent?.eventType, !!event.listEvent)
      if (input) for (const cb of this.inputCbs) cb(input)
    })
  }

  async getItem(key: string) {
    try {
      return (await this.bridge.getLocalStorage(key)) ?? ''
    } catch {
      return ''
    }
  }

  async setItem(key: string, value: string) {
    await this.bridge.setLocalStorage(key, value)
  }

  async createPage(status: string, body: string) {
    const layout = pageLayout(status, body)
    if (this.created) {
      return this.serial('rebuild', () => this.bridge.rebuildPageContainer(new RebuildPageContainer(layout)))
    }
    const res = await this.serial('create', () =>
      this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(layout)),
    )
    this.created = res === 0
    return this.created
  }

  async setStatus(text: string) {
    await this.upgrade(STATUS_ID, STATUS_NAME, text)
  }

  async setBody(text: string) {
    await this.upgrade(BODY_ID, BODY_NAME, text)
  }

  private async upgrade(id: number, name: string, content: string) {
    try {
      await this.serial('text', () =>
        this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: id, containerName: name, content })),
      )
    } catch (err) {
      console.warn('[glasses] text update failed', err)
    }
  }

  async startMic(source: MicSource) {
    const src = source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses
    try {
      return await this.serial('mic on', () => this.bridge.audioControl(true, src))
    } catch {
      return false
    }
  }

  async stopMic() {
    try {
      await this.serial('mic off', () => this.bridge.audioControl(false))
    } catch {
      /* ignore */
    }
  }

  onAudio(cb: (pcm: Uint8Array) => void) {
    this.audioCbs.push(cb)
  }

  onInput(cb: (i: GlassesInput) => void) {
    this.inputCbs.push(cb)
  }

  async exit() {
    await this.serial('exit', () => this.bridge.shutDownPageContainer(1))
  }
}

/** Browser preview: lens drawn in #lens-preview, computer mic via Web Audio. */
class PreviewGlasses implements Glasses {
  readonly isReal = false
  private audioCbs: ((pcm: Uint8Array) => void)[] = []
  private inputCbs: ((i: GlassesInput) => void)[] = []
  private stopAudio: (() => void) | null = null
  private status = ''
  private body = ''

  async getItem(key: string) {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  }

  async setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* private mode */
    }
  }

  async createPage(status: string, body: string) {
    this.status = status
    this.body = body
    this.draw()
    const lens = document.getElementById('lens-preview')
    lens?.addEventListener('click', () => this.inputCbs.forEach((cb) => cb('tap')))
    lens?.addEventListener('dblclick', () => this.inputCbs.forEach((cb) => cb('doubleTap')))
    return true
  }

  async setStatus(text: string) {
    this.status = text
    this.draw()
  }

  async setBody(text: string) {
    this.body = text
    this.draw()
  }

  private draw() {
    const s = document.querySelector('#lens-preview .lens-status')
    const b = document.querySelector('#lens-preview .lens-body')
    if (s) s.textContent = this.status
    if (b) b.textContent = this.body
  }

  async startMic() {
    if (this.stopAudio) return true
    try {
      this.stopAudio = await startBrowserMic((pcm) => this.audioCbs.forEach((cb) => cb(pcm)))
      return true
    } catch (err) {
      console.warn('[preview] mic unavailable', err)
      return false
    }
  }

  async stopMic() {
    this.stopAudio?.()
    this.stopAudio = null
  }

  onAudio(cb: (pcm: Uint8Array) => void) {
    this.audioCbs.push(cb)
  }

  onInput(cb: (i: GlassesInput) => void) {
    this.inputCbs.push(cb)
  }

  async exit() {
    await this.stopMic()
  }
}

/** Converts float samples (-1..1) to PCM s16le bytes. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

async function startBrowserMic(onPcm: (pcm: Uint8Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  // The browser resamples the mic to the context rate.
  const ctx = new AudioContext({ sampleRate: 16000 })
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(2048, 1, 1)
  proc.onaudioprocess = (e) => onPcm(floatToPcm16(e.inputBuffer.getChannelData(0)))
  src.connect(proc)
  proc.connect(ctx.destination)
  // Browsers start audio suspended until the page is touched.
  const resume = () => void ctx.resume()
  resume()
  document.addEventListener('pointerdown', resume, { once: true })
  return () => {
    proc.disconnect()
    src.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
}

function hasNativeBridge(): boolean {
  const w = window as unknown as { flutter_inappwebview?: { callHandler?: unknown } }
  return typeof w.flutter_inappwebview?.callHandler === 'function'
}

/** Connects to the Even app, or returns the browser preview after a short wait. */
export async function connectGlasses(timeoutMs = 2500): Promise<Glasses> {
  const deadline = Date.now() + timeoutMs
  while (!hasNativeBridge() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!hasNativeBridge()) return new PreviewGlasses()
  const bridge = await waitForEvenAppBridge()
  return new RealGlasses(bridge)
}
