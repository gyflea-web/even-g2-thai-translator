import { describe, expect, it } from 'vitest'
import { Segmenter, pcmToInt16 } from '../src/vad'

// 10 ms frames of 160 samples at a constant amplitude.
function frame(amp: number): Uint8Array {
  const b = new Uint8Array(320)
  const v = new DataView(b.buffer)
  for (let i = 0; i < 160; i++) v.setInt16(i * 2, i % 2 ? amp : -amp, true)
  return b
}
const feed = (s: Segmenter, amp: number, ms: number) => {
  for (let i = 0; i < ms / 10; i++) s.push(frame(amp))
}

describe('Segmenter', () => {
  it('emits one utterance per spoken phrase, including the pre-roll', () => {
    const out: Int16Array[] = []
    const s = new Segmenter((p) => out.push(p))
    feed(s, 50, 1000) // quiet room
    feed(s, 5000, 1000) // speech
    feed(s, 50, 1000) // silence ends it
    expect(out).toHaveLength(1)
    // ~300 ms pre-roll + 1000 ms speech + 800 ms trailing silence
    expect(out[0].length / 16).toBeGreaterThan(1900)
    expect(out[0].length / 16).toBeLessThan(2300)
  })

  it('ignores short clicks', () => {
    const out: Int16Array[] = []
    const s = new Segmenter((p) => out.push(p))
    feed(s, 50, 500)
    feed(s, 8000, 50)
    feed(s, 50, 2000)
    expect(out).toHaveLength(0)
  })

  it('cuts very long speech into pieces', () => {
    const out: Int16Array[] = []
    const s = new Segmenter((p) => out.push(p), { maxUtteranceMs: 3000 })
    feed(s, 5000, 7000)
    expect(out.length).toBe(2)
  })

  it('flush sends speech in progress', () => {
    const out: Int16Array[] = []
    const s = new Segmenter((p) => out.push(p))
    feed(s, 5000, 500)
    s.flush()
    expect(out).toHaveLength(1)
  })

  it('reads little-endian samples', () => {
    expect([...pcmToInt16(new Uint8Array([0x01, 0x00, 0xff, 0xff]))]).toEqual([1, -1])
  })
})
