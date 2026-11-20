// Google Gemini: one finished utterance (audio) in, transcript + translation out.
// Uses the plain generateContent REST call, which allows browser requests (CORS)
// with a key from aistudio.google.com.

import { SAMPLE_RATE } from './vad'

export const GEMINI_DEFAULT_MODEL = 'gemini-flash-lite-latest'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiResult {
  language: 'th' | 'ko' | 'none'
  original: string
  translation: string
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message)
  }
}

const PROMPT = `You are a live interpreter between a Thai speaker and a Korean speaker.
The audio is one utterance from the conversation.
1. Decide whether it is Thai ("th") or Korean ("ko"). If there is no clear speech (silence, noise, music), return language "none" with empty strings.
2. "original": exact transcription in the spoken language and script.
3. "translation": natural, polite, conversational translation. Thai -> Korean, Korean -> Thai.
Do not add explanations.`

/** Wraps PCM s16le mono 16 kHz in a WAV header. */
export function toWav(pcm: Int16Array): Uint8Array {
  const dataLen = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, SAMPLE_RATE, true)
  v.setUint32(28, SAMPLE_RATE * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, dataLen, true)
  new Int16Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

export function buildRequest(wavBase64: string): Record<string, unknown> {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'audio/wav', data: wavBase64 } }, { text: PROMPT }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          language: { type: 'STRING', enum: ['th', 'ko', 'none'] },
          original: { type: 'STRING' },
          translation: { type: 'STRING' },
        },
        required: ['language', 'original', 'translation'],
      },
    },
  }
}

export function parseResponse(json: unknown): GeminiResult {
  const text = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content
    ?.parts?.map((p) => p.text ?? '')
    .join('')
  if (!text) return { language: 'none', original: '', translation: '' }
  try {
    const r = JSON.parse(text) as Partial<GeminiResult>
    const language = r.language === 'th' || r.language === 'ko' ? r.language : 'none'
    return { language, original: String(r.original ?? '').trim(), translation: String(r.translation ?? '').trim() }
  } catch {
    return { language: 'none', original: '', translation: '' }
  }
}

export function describeGeminiError(status: number, message: string): GeminiError {
  if (/API key not valid|API_KEY_INVALID/i.test(message) || status === 401 || status === 403) {
    return new GeminiError('Gemini API 키가 올바르지 않습니다. 설정에서 키를 확인하세요.', true)
  }
  if (status === 429) {
    return new GeminiError('무료 사용량 한도에 걸렸습니다. 1분쯤 뒤 자동으로 다시 됩니다.', false)
  }
  if (status === 404) {
    return new GeminiError(`모델을 찾을 수 없습니다. 설정의 모델 이름을 확인하세요. (${message})`, true)
  }
  return new GeminiError(`Gemini 오류 ${status}: ${message}`, false)
}

export async function translateUtterance(
  pcm: Int16Array,
  apiKey: string,
  model = GEMINI_DEFAULT_MODEL,
  fetchFn: typeof fetch = fetch,
): Promise<GeminiResult> {
  const body = JSON.stringify(buildRequest(toBase64(toWav(pcm))))
  let res: Response
  try {
    res = await fetchFn(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    })
  } catch {
    throw new GeminiError('인터넷 연결을 확인하세요.', false)
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? res.statusText
    throw describeGeminiError(res.status, msg)
  }
  return parseResponse(json)
}
