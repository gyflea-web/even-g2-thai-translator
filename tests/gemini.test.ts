import { describe, expect, it } from 'vitest'
import { buildRequest, describeGeminiError, parseResponse, toBase64, toWav, translateUtterance } from '../src/gemini'
import { resultToTokens, startGeminiStream } from '../src/gemini-stream'
import { Transcript } from '../src/transcript'

const reply = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] })

describe('gemini request/response', () => {
  it('builds a 16 kHz mono WAV', () => {
    const wav = toWav(new Int16Array([1, -1]))
    const v = new DataView(wav.buffer)
    expect(wav.length).toBe(48)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getInt16(46, true)).toBe(-1)
  })

  it('base64-encodes large buffers', () => {
    const b = new Uint8Array(100_000).fill(65)
    expect(atob(toBase64(b)).length).toBe(100_000)
  })

  it('asks for JSON with language, original, translation', () => {
    const r = buildRequest('AAA') as any
    expect(r.contents[0].parts[0].inlineData).toEqual({ mimeType: 'audio/wav', data: 'AAA' })
    expect(r.generationConfig.responseSchema.required).toEqual(['language', 'original', 'translation'])
  })

  it('parses a reply and tolerates junk', () => {
    expect(parseResponse(reply({ language: 'th', original: ' สวัสดี ', translation: '안녕하세요' }))).toEqual({
      language: 'th',
      original: 'สวัสดี',
      translation: '안녕하세요',
    })
    expect(parseResponse({}).language).toBe('none')
    expect(parseResponse({ candidates: [{ content: { parts: [{ text: 'oops' }] } }] }).language).toBe('none')
  })

  it('classifies errors', () => {
    expect(describeGeminiError(400, 'API key not valid. Please pass a valid API key.').fatal).toBe(true)
    expect(describeGeminiError(429, 'quota').fatal).toBe(false)
    expect(describeGeminiError(404, 'model not found').fatal).toBe(true)
  })

  it('sends the key in a header and reports HTTP errors', async () => {
    let seen: RequestInit | undefined
    const fake = (async (_url: string, init: RequestInit) => {
      seen = init
      return new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 })
    }) as unknown as typeof fetch
    await expect(translateUtterance(new Int16Array(10), 'k', 'm', fake)).rejects.toThrow(/API 키/)
    expect((seen!.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
  })
})

describe('gemini stream', () => {
  it('turns results into transcript utterances in speaking order', async () => {
    const t = new Transcript()
    const delays = [60, 10]
    let i = 0
    const results = [
      { language: 'th' as const, original: 'สวัสดี', translation: '안녕하세요' },
      { language: 'ko' as const, original: '반가워요', translation: 'ยินดีที่ได้รู้จัก' },
    ]
    const s = startGeminiStream(
      {
        apiKey: 'k',
        translate: () => {
          const idx = i++
          return new Promise((r) => setTimeout(() => r(results[idx]), delays[idx]))
        },
      },
      { onTokens: (tk) => t.apply(tk), onStatus: () => {} },
    )
    const loud = new Uint8Array(320).map((_, j) => (j % 2 ? 0x40 : 0))
    const quiet = new Uint8Array(320)
    for (const _ of [0, 1]) {
      for (let k = 0; k < 50; k++) s.sendPcm(loud)
      for (let k = 0; k < 100; k++) s.sendPcm(quiet)
    }
    await new Promise((r) => setTimeout(r, 120))
    const list = t.view().utterances
    expect(list.map((u) => [u.lang, u.translation])).toEqual([
      ['th', '안녕하세요'],
      ['ko', 'ยินดีที่ได้รู้จัก'],
    ])
  })

  it('drops "no speech" results', () => {
    expect(resultToTokens({ language: 'none', original: '', translation: '' })).toEqual([])
  })
})
