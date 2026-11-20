// Builds the text shown on the glasses lens from the transcript.
// Pure logic: the width function is passed in, so tests can use a fake one.

import type { TranscriptView } from './transcript'

export interface LensOptions {
  /** Pixel width available for text. */
  maxWidth: number
  /** Number of lines that fit on the lens. */
  maxLines: number
  /** Also show what I said (Korean) on the lens. */
  showMine: boolean
  measure: (text: string) => number
}

export const MINE_PREFIX = '나: '
const WAITING = '…'

// The stock G2 font has no Thai glyphs; the firmware silently drops them.
// Removing them here keeps line-width math correct.
const THAI_RE = /[฀-๿]+/g

export function stripThai(text: string): string {
  return text.replace(THAI_RE, '').replace(/[ \t]{2,}/g, ' ')
}

interface Entry {
  text: string
}

function entries(view: TranscriptView, showMine: boolean): Entry[] {
  const out: Entry[] = []
  const { utterances, interim } = view
  const last = utterances[utterances.length - 1]
  const interimJoinsLast = !!(interim.lang && last && !last.ended && last.lang === interim.lang)

  for (const u of utterances) {
    const isLast = u === last
    if (u.lang === 'th') {
      let text = u.translation
      if (isLast && interimJoinsLast) text += interim.translation
      if (!text.trim()) {
        if (u.ended && !isLast) continue
        text = WAITING
      }
      out.push({ text })
    } else if (showMine) {
      let text = u.original
      if (isLast && interimJoinsLast) text += interim.original
      if (!text.trim()) continue
      out.push({ text: MINE_PREFIX + text })
    }
  }

  if (interim.lang && !interimJoinsLast) {
    if (interim.lang === 'th') {
      out.push({ text: interim.translation.trim() ? interim.translation : WAITING })
    } else if (showMine && interim.original.trim()) {
      out.push({ text: MINE_PREFIX + interim.original })
    }
  }
  return out
}

/** Splits one paragraph into lines no wider than maxWidth. */
export function wrap(text: string, maxWidth: number, measure: (t: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (!word) continue
    const cand = line ? `${line} ${word}` : word
    if (measure(cand) <= maxWidth) {
      line = cand
      continue
    }
    if (line) lines.push(line)
    if (measure(word) <= maxWidth) {
      line = word
      continue
    }
    // A single word wider than the lens: break it by character.
    let chunk = ''
    for (const ch of word) {
      if (measure(chunk + ch) <= maxWidth) chunk += ch
      else {
        if (chunk) lines.push(chunk)
        chunk = ch
      }
    }
    line = chunk
  }
  if (line) lines.push(line)
  return lines
}

/** Returns the newest lines that fit on the lens, joined with newlines. */
export function renderLens(view: TranscriptView, opts: LensOptions): string {
  const lines: string[] = []
  for (const e of entries(view, opts.showMine)) {
    const clean = stripThai(e.text).trim()
    if (!clean) continue
    lines.push(...wrap(clean, opts.maxWidth, opts.measure))
  }
  return lines.slice(-opts.maxLines).join('\n')
}
