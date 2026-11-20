// Cuts a continuous PCM s16le 16 kHz stream into utterances by loudness.
// Pure logic (no timers): time is measured in samples, so it is unit tested.

export const SAMPLE_RATE = 16000

export interface VadOptions {
  /** Silence that ends an utterance. */
  endSilenceMs?: number
  /** Speech needed before an utterance starts. */
  minSpeechMs?: number
  /** Audio kept from before speech started, so first syllables are not cut. */
  preRollMs?: number
  /** Long monologues are cut here and sent in pieces. */
  maxUtteranceMs?: number
  /** Absolute floor for "speech" loudness (RMS of int16 samples). */
  minRms?: number
}

const ms = (v: number) => Math.round((v * SAMPLE_RATE) / 1000)

export function pcmToInt16(bytes: Uint8Array): Int16Array {
  const n = Math.floor(bytes.length / 2)
  const out = new Int16Array(n)
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true)
  return out
}

function rms(samples: Int16Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export class Segmenter {
  private endSilence: number
  private minSpeech: number
  private preRoll: number
  private maxLen: number
  private minRms: number

  private noise = 200
  private speaking = false
  private speechRun = 0
  private silenceRun = 0
  private pre: Int16Array[] = []
  private preLen = 0
  private cur: Int16Array[] = []
  private curLen = 0

  /** Fires with each finished utterance. */
  constructor(
    private onUtterance: (pcm: Int16Array) => void,
    opts: VadOptions = {},
  ) {
    this.endSilence = ms(opts.endSilenceMs ?? 800)
    this.minSpeech = ms(opts.minSpeechMs ?? 150)
    this.preRoll = ms(opts.preRollMs ?? 300)
    this.maxLen = ms(opts.maxUtteranceMs ?? 15000)
    this.minRms = opts.minRms ?? 400
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  push(bytes: Uint8Array): void {
    const samples = pcmToInt16(bytes)
    if (!samples.length) return
    const level = rms(samples)
    const loud = level > Math.max(this.minRms, this.noise * 3)

    if (!this.speaking) {
      if (!loud) this.noise = this.noise * 0.95 + level * 0.05
      this.keepPreRoll(samples)
      this.speechRun = loud ? this.speechRun + samples.length : 0
      if (this.speechRun >= this.minSpeech) {
        this.speaking = true
        this.silenceRun = 0
        this.cur = this.pre
        this.curLen = this.preLen
        this.pre = []
        this.preLen = 0
      }
      return
    }

    this.cur.push(samples)
    this.curLen += samples.length
    this.silenceRun = loud ? 0 : this.silenceRun + samples.length
    if (this.silenceRun >= this.endSilence || this.curLen >= this.maxLen) this.finish()
  }

  /** Sends whatever is being spoken now (e.g. when pausing). */
  flush(): void {
    if (this.speaking) this.finish()
  }

  reset(): void {
    this.speaking = false
    this.speechRun = 0
    this.pre = []
    this.preLen = 0
    this.cur = []
    this.curLen = 0
  }

  private keepPreRoll(samples: Int16Array) {
    this.pre.push(samples)
    this.preLen += samples.length
    while (this.pre.length > 1 && this.preLen - this.pre[0].length >= this.preRoll) {
      this.preLen -= this.pre.shift()!.length
    }
  }

  private finish() {
    const out = new Int16Array(this.curLen)
    let off = 0
    for (const c of this.cur) {
      out.set(c, off)
      off += c.length
    }
    this.reset()
    this.onUtterance(out)
  }
}
