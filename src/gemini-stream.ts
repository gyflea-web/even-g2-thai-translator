// Same interface as the Soniox stream, backed by Gemini: the mic stream is cut
// into utterances, each is translated, and results are emitted as tokens in
// the order they were spoken.

import { GeminiError, translateUtterance, type GeminiResult } from './gemini'
import type { StreamHandlers, TranslationStream } from './soniox'
import type { SonioxToken } from './transcript'
import { Segmenter } from './vad'

export interface GeminiStreamOptions {
  apiKey: string
  model?: string
  translate?: (pcm: Int16Array) => Promise<GeminiResult>
}

export function resultToTokens(r: GeminiResult): SonioxToken[] {
  if (r.language === 'none' || !r.original) return []
  return [
    { text: r.original, is_final: true, language: r.language, translation_status: 'original' },
    { text: r.translation, is_final: true, translation_status: 'translation', source_language: r.language },
    { text: '<end>', is_final: true },
  ]
}

export function startGeminiStream(opts: GeminiStreamOptions, h: StreamHandlers): TranslationStream {
  const translate = opts.translate ?? ((pcm: Int16Array) => translateUtterance(pcm, opts.apiKey, opts.model))
  let closed = false
  let fatal = false
  let paused = false
  let inFlight = 0
  // Results are applied strictly in speaking order.
  let chain: Promise<void> = Promise.resolve()

  const busy = () => h.onBusy?.(inFlight)

  const segmenter = new Segmenter((pcm) => {
    if (closed || fatal) return
    inFlight++
    busy()
    const job = translate(pcm).then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    )
    chain = chain.then(async () => {
      const out = await job
      inFlight--
      busy()
      if (closed) return
      if (out.ok) {
        const tokens = resultToTokens(out.r)
        if (tokens.length) h.onTokens(tokens)
        if (!fatal) h.onStatus('live')
        return
      }
      const err = out.e instanceof GeminiError ? out.e : new GeminiError(String(out.e), false)
      if (err.fatal) fatal = true
      h.onStatus('error', err.message)
    })
  })

  if (!opts.apiKey) {
    fatal = true
    h.onStatus('error', 'Gemini API 키가 없습니다. 휴대폰 화면의 설정에서 입력하세요.')
  } else {
    h.onStatus('live')
  }

  return {
    sendPcm(chunk) {
      if (closed || fatal || paused) return
      segmenter.push(chunk)
    },
    setPaused(p) {
      paused = p
      if (p) segmenter.flush()
    },
    close() {
      segmenter.flush()
      closed = true
    },
  }
}
