import { DEFAULT_MODEL } from './soniox'

export type MicSource = 'glasses' | 'phone' | 'browser'

export interface Settings {
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
    if (typeof s.apiKey !== 'string') s.apiKey = ''
    s.apiKey = s.apiKey.trim()
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
