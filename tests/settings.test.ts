import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from '../src/settings'
import { floatToPcm16 } from '../src/glasses'

describe('parseSettings', () => {
  it('falls back to defaults for empty or broken input', () => {
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS)
  })
  it('keeps valid values and repairs invalid ones', () => {
    const s = parseSettings(JSON.stringify({ apiKey: ' abc ', micSource: 'x', speechRate: 9, showMine: false }))
    expect(s.apiKey).toBe('abc')
    expect(s.micSource).toBe('glasses')
    expect(s.speechRate).toBe(DEFAULT_SETTINGS.speechRate)
    expect(s.showMine).toBe(false)
  })
})

describe('floatToPcm16', () => {
  it('encodes little-endian signed 16-bit samples', () => {
    const out = floatToPcm16(new Float32Array([0, 1, -1]))
    const v = new DataView(out.buffer)
    expect([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true)]).toEqual([0, 32767, -32768])
  })
})
