import { describe, expect, it } from 'vitest'
import { Transcript } from '../src/transcript'

const th = (text: string, is_final = true) => ({ text, is_final, language: 'th', translation_status: 'original' as const })
const ko = (text: string, is_final = true) => ({ text, is_final, language: 'ko', translation_status: 'original' as const })
const tr = (text: string, source_language: string, is_final = true) => ({
  text,
  is_final,
  language: source_language === 'th' ? 'ko' : 'th',
  source_language,
  translation_status: 'translation' as const,
})
const end = { text: '<end>', is_final: true }

describe('Transcript', () => {
  it('groups Thai speech and its Korean translation into one utterance', () => {
    const t = new Transcript()
    t.apply([th('สวัสดี'), th('ครับ')])
    t.apply([tr('안녕', 'th'), tr('하세요', 'th'), end])
    const [u] = t.view().utterances
    expect(u.lang).toBe('th')
    expect(u.original).toBe('สวัสดีครับ')
    expect(u.translation).toBe('안녕하세요')
    expect(u.ended).toBe(true)
  })

  it('starts a new utterance when the language switches', () => {
    const t = new Transcript()
    t.apply([th('ไป'), tr('가요', 'th')])
    t.apply([ko('네 '), ko('좋아요'), tr('ครับ', 'ko')])
    const list = t.view().utterances
    expect(list.map((u) => u.lang)).toEqual(['th', 'ko'])
    expect(list[0].ended).toBe(true)
    expect(list[1].original).toBe('네 좋아요')
    expect(list[1].translation).toBe('ครับ')
  })

  it('attaches a late translation to the utterance it came from', () => {
    const t = new Transcript()
    t.apply([th('ไป'), end])
    t.apply([ko('네')])
    t.apply([tr('가요', 'th')])
    const list = t.view().utterances
    expect(list[0].translation).toBe('가요')
    expect(list[1].translation).toBe('')
  })

  it('starts a new utterance after <end> in the same language', () => {
    const t = new Transcript()
    t.apply([th('หนึ่ง'), end])
    t.apply([th('สอง')])
    expect(t.view().utterances).toHaveLength(2)
  })

  it('keeps non-final tokens as interim and replaces them on every response', () => {
    const t = new Transcript()
    t.apply([th('สวั', false), tr('안', 'th', false)])
    expect(t.view().interim).toEqual({ lang: 'th', original: 'สวั', translation: '안' })
    t.apply([th('สวัสดี', false)])
    expect(t.view().interim).toEqual({ lang: 'th', original: 'สวัสดี', translation: '' })
    expect(t.view().utterances).toHaveLength(0)
  })

  it('reports no change for an identical empty response', () => {
    const t = new Transcript()
    expect(t.apply([])).toBe(false)
    expect(t.apply([th('ก')])).toBe(true)
  })

  it('closes the open sentence on restart', () => {
    const t = new Transcript()
    t.apply([th('ก'), th('ข', false)])
    t.closeOpen()
    expect(t.view().utterances[0].ended).toBe(true)
    expect(t.view().interim.lang).toBeNull()
  })
})
