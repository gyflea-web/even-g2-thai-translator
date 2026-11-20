// Turns the token stream of a two-way Soniox translation session into a list of
// utterances. Pure logic, no DOM or network, so it is unit tested.
//
// Each original token has `language` (th or ko). Each translated token has
// `translation_status: "translation"` and `source_language` (the language it
// was translated from). Final tokens are sent once; non-final tokens are
// re-sent in full with every response, so they are kept apart as "interim".

export type Lang = 'th' | 'ko'

export interface SonioxToken {
  text?: string
  is_final?: boolean
  language?: string
  source_language?: string
  translation_status?: 'none' | 'original' | 'translation'
  speaker?: string
}

export interface Utterance {
  id: number
  /** Language the person spoke: th = the other person, ko = me. */
  lang: Lang
  original: string
  translation: string
  /** Set when Soniox marks the end of the sentence (<end>). */
  ended: boolean
}

export interface TranscriptView {
  utterances: Utterance[]
  /** Not-yet-final text, shown after the matching utterance. */
  interim: { lang: Lang | null; original: string; translation: string }
}

const MAX_UTTERANCES = 200

function isControl(text: string): boolean {
  return /^<[a-z_]+>$/i.test(text)
}

function toLang(code: string | undefined, fallback: Lang): Lang {
  if (code === 'th' || code === 'ko') return code
  return fallback
}

export class Transcript {
  private list: Utterance[] = []
  private nextId = 1
  private interim: TranscriptView['interim'] = { lang: null, original: '', translation: '' }

  /** Applies one Soniox response's tokens. Returns true when anything changed. */
  apply(tokens: SonioxToken[]): boolean {
    const interim = { lang: null as Lang | null, original: '', translation: '' }
    let changed = false

    for (const t of tokens) {
      const text = t.text ?? ''
      if (!text) continue

      if (isControl(text)) {
        if (t.is_final && /^<end>$/i.test(text)) {
          const last = this.last()
          if (last && !last.ended) {
            last.ended = true
            changed = true
          }
        }
        continue
      }

      if (t.translation_status === 'translation') {
        const src = toLang(t.source_language, this.last()?.lang ?? 'th')
        if (t.is_final) {
          const target = this.lastOf(src) ?? this.open(src)
          target.translation += text
          changed = true
        } else {
          interim.translation += text
          interim.lang ??= src
        }
        continue
      }

      // Original speech (translation_status "original" or "none").
      const lang = toLang(t.language, this.last()?.lang ?? 'th')
      if (t.is_final) {
        const cur = this.last()
        const target = cur && !cur.ended && cur.lang === lang ? cur : this.open(lang)
        target.original += text
        changed = true
      } else {
        interim.original += text
        interim.lang = lang
      }
    }

    if (
      interim.lang !== this.interim.lang ||
      interim.original !== this.interim.original ||
      interim.translation !== this.interim.translation
    ) {
      this.interim = interim
      changed = true
    }
    return changed
  }

  view(): TranscriptView {
    return { utterances: this.list, interim: this.interim }
  }

  clear(): void {
    this.list = []
    this.interim = { lang: null, original: '', translation: '' }
  }

  /** Called when the stream restarts: unfinished sentences are closed. */
  closeOpen(): void {
    const last = this.last()
    if (last) last.ended = true
    this.interim = { lang: null, original: '', translation: '' }
  }

  private open(lang: Lang): Utterance {
    const prev = this.last()
    if (prev) prev.ended = true
    const u: Utterance = { id: this.nextId++, lang, original: '', translation: '', ended: false }
    this.list.push(u)
    if (this.list.length > MAX_UTTERANCES) this.list.splice(0, this.list.length - MAX_UTTERANCES)
    return u
  }

  private last(): Utterance | undefined {
    return this.list[this.list.length - 1]
  }

  private lastOf(lang: Lang): Utterance | undefined {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].lang === lang) return this.list[i]
    }
    return undefined
  }
}
