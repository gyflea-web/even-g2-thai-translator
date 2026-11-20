import { describe, expect, it } from 'vitest'
import { MINE_PREFIX, renderLens, stripThai, wrap } from '../src/lens'
import { Transcript } from '../src/transcript'

// Fake font: every character is 10 px wide.
const measure = (s: string) => [...s].length * 10
const opts = { maxWidth: 100, maxLines: 3, showMine: true, measure }

describe('wrap', () => {
  it('wraps on spaces', () => {
    expect(wrap('aaa bbb ccc ddd', 70, measure)).toEqual(['aaa bbb', 'ccc ddd'])
  })
  it('breaks a word longer than the line', () => {
    expect(wrap('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('stripThai', () => {
  it('removes Thai characters and collapses spaces', () => {
    expect(stripThai('안녕 สวัสดี 세계')).toBe('안녕 세계')
  })
})

describe('renderLens', () => {
  it('shows the Korean translation of Thai speech, never the Thai', () => {
    const t = new Transcript()
    t.apply([
      { text: 'สวัสดี', is_final: true, language: 'th' },
      { text: '안녕하세요', is_final: true, translation_status: 'translation', source_language: 'th' },
    ])
    expect(renderLens(t.view(), opts)).toBe('안녕하세요')
  })

  it('shows a waiting mark while the translation has not arrived', () => {
    const t = new Transcript()
    t.apply([{ text: 'สวัสดี', is_final: true, language: 'th' }])
    expect(renderLens(t.view(), opts)).toBe('…')
  })

  it('prefixes my own Korean speech and can hide it', () => {
    const t = new Transcript()
    t.apply([{ text: '얼마예요', is_final: true, language: 'ko' }])
    expect(renderLens(t.view(), opts)).toBe(`${MINE_PREFIX}얼마예요`)
    expect(renderLens(t.view(), { ...opts, showMine: false })).toBe('')
  })

  it('appends interim translation to the open utterance', () => {
    const t = new Transcript()
    t.apply([
      { text: 'ไป', is_final: true, language: 'th' },
      { text: '가', is_final: true, translation_status: 'translation', source_language: 'th' },
      { text: '요', is_final: false, translation_status: 'translation', source_language: 'th' },
    ])
    expect(renderLens(t.view(), opts)).toBe('가요')
  })

  it('keeps only the newest lines', () => {
    const t = new Transcript()
    for (let i = 1; i <= 5; i++) {
      t.apply([
        { text: `ข${i}`, is_final: true, language: 'th' },
        { text: `문장${i}`, is_final: true, translation_status: 'translation', source_language: 'th' },
        { text: '<end>', is_final: true },
      ])
    }
    expect(renderLens(t.view(), opts)).toBe('문장3\n문장4\n문장5')
  })
})
