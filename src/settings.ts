import { GEMINI_DEFAULT_MODEL } from './gemini'
import { DEFAULT_MODEL } from './soniox'

export type MicSource = 'glasses' | 'phone' | 'browser'
export type Provider = 'gemini' | 'soniox'

export interface Settings {
  /** Which translation service to use. */
  provider: Provider
  /** Google AI Studio key (Gemini). */
  geminiKey: string
  geminiModel: string
  /** Soniox key. */
  apiKey: string
  micSource: MicSource
  model: string
  /** Show what I said (Korean) on the lens too. */
  showMine: boolean
  /** Read my Thai translation aloud on the phone speaker. */
  autoSpeak: boolean
  speechRate: number
}

export const SETTINGS_KEY = 'thai-translator.settings.v1'

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  geminiKey: '',
  geminiModel: GEMINI_DEFAULT_MODEL,
  apiKey: '',
  micSource: 'glasses',
  model: DEFAULT_MODEL,
  showMine: true,
  autoSpeak: false,
  speechRate: 0.9,
}

export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    const obj = JSON.parse(raw) as Partial<Settings>
    const s = { ...DEFAULT_SETTINGS, ...obj }
    if (!['glasses', 'phone', 'browser'].includes(s.micSource)) s.micSource = 'glasses'
    if (s.provider !== 'gemini' && s.provider !== 'soniox') s.provider = 'gemini'
    s.apiKey = typeof s.apiKey === 'string' ? s.apiKey.trim() : ''
    s.geminiKey = typeof s.geminiKey === 'string' ? s.geminiKey.trim() : ''
    if (typeof s.geminiModel !== 'string' || !s.geminiModel.trim()) s.geminiModel = GEMINI_DEFAULT_MODEL
    if (typeof s.model !== 'string' || !s.model.trim()) s.model = DEFAULT_MODEL
    s.showMine = !!s.showMine
    s.autoSpeak = !!s.autoSpeak
    if (typeof s.speechRate !== 'number' || !(s.speechRate >= 0.5 && s.speechRate <= 1.5)) {
      s.speechRate = DEFAULT_SETTINGS.speechRate
    }
    return s
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Key for the selected provider. */
export function activeKey(s: Settings): string {
  return s.provider === 'gemini' ? s.geminiKey : s.apiKey
}
