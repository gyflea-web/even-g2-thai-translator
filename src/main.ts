import { getTextWidth } from '@evenrealities/pretext'
import './styles.css'
import { bodyGeometry, connectGlasses } from './glasses'
import { renderLens } from './lens'
import { SETTINGS_KEY, parseSettings, type Settings } from './settings'
import { startTranslationStream, type StreamStatus, type TranslationStream } from './soniox'
import { speakThai, stopSpeaking } from './speech'
import { Transcript } from './transcript'
import { mountUi, renderConversation, setPaused, setStatus } from './ui'

const RENDER_INTERVAL_MS = 150
const AUTO_SPEAK_SETTLE_MS = 1200

const glasses = await connectGlasses()
let settings: Settings = parseSettings(await glasses.getItem(SETTINGS_KEY))
if (!settings.apiKey && import.meta.env.DEV && import.meta.env.VITE_SONIOX_API_KEY) {
  settings.apiKey = String(import.meta.env.VITE_SONIOX_API_KEY)
}

const transcript = new Transcript()
const geo = bodyGeometry()
let stream: TranslationStream | null = null
let paused = false
let micOn = false
let lensStatus = ''
let lensBody = ''

const HINT = '탭: 일시정지 · 두 번 탭: 종료'

// ── Lens ────────────────────────────────────────────────────────────────────
async function showLensStatus(text: string) {
  if (text === lensStatus) return
  lensStatus = text
  await glasses.setStatus(text)
}

let renderTimer: ReturnType<typeof setTimeout> | null = null
let renderQueued = false

function scheduleRender() {
  renderQueued = true
  if (renderTimer) return
  renderTimer = setTimeout(async () => {
    renderTimer = null
    if (!renderQueued) return
    renderQueued = false
    const view = transcript.view()
    renderConversation(view)
    const body =
      renderLens(view, {
        maxWidth: geo.maxWidth,
        maxLines: geo.maxLines,
        showMine: settings.showMine,
        measure: getTextWidth,
      }) || '태국어로 말하면 한국어 자막이 여기에 나옵니다.'
    if (body !== lensBody) {
      lensBody = body
      await glasses.setBody(body)
    }
    maybeAutoSpeak()
  }, RENDER_INTERVAL_MS)
}

// ── Auto speak: read my finished sentence aloud in Thai ────────────────────
let spokenId = 0
let speakTimer: ReturnType<typeof setTimeout> | null = null
let speakCandidate = { id: 0, text: '' }

function maybeAutoSpeak() {
  if (!settings.autoSpeak) return
  const list = transcript.view().utterances
  const u = [...list].reverse().find((x) => x.lang === 'ko' && x.ended && x.translation.trim())
  if (!u || u.id <= spokenId) return
  // The translation can keep arriving after the sentence ends; wait until it settles.
  if (speakCandidate.id === u.id && speakCandidate.text === u.translation) return
  speakCandidate = { id: u.id, text: u.translation }
  if (speakTimer) clearTimeout(speakTimer)
  speakTimer = setTimeout(() => {
    spokenId = u.id
    speakThai(u.translation, settings.speechRate)
  }, AUTO_SPEAK_SETTLE_MS)
}

// ── Stream ──────────────────────────────────────────────────────────────────
function onStreamStatus(status: StreamStatus, detail?: string) {
  switch (status) {
    case 'connecting':
      setStatus('connecting', '연결 중…')
      void showLensStatus('연결 중…')
      break
    case 'reconnecting':
      setStatus('connecting', '다시 연결 중…')
      void showLensStatus('다시 연결 중…')
      break
    case 'live':
      if (!paused) {
        setStatus('live', '번역 중 · 태국어 ⇄ 한국어')
        void showLensStatus(`● 번역 중   ${HINT}`)
      }
      break
    case 'error':
      setStatus('error', detail ?? '오류')
      void showLensStatus('오류: 휴대폰 화면을 확인하세요')
      break
    case 'closed':
      setStatus('idle', '멈춤')
      break
  }
}

async function startMic(): Promise<boolean> {
  micOn = await glasses.startMic(settings.micSource)
  if (!micOn) {
    const which = settings.micSource === 'phone' ? '휴대폰' : glasses.isReal ? '안경' : '이 컴퓨터의'
    setStatus('error', `${which} 마이크를 켜지 못했습니다. 권한과 연결 상태를 확인하세요.`)
    void showLensStatus('마이크를 켜지 못했습니다')
  }
  return micOn
}

async function stopMic() {
  if (!micOn) return
  micOn = false
  await glasses.stopMic()
}

async function start() {
  stream?.close()
  stream = null
  paused = false
  setPaused(false)

  if (!settings.apiKey) {
    setStatus('error', 'Soniox API 키를 입력하세요 (아래 설정).')
    await showLensStatus('휴대폰에서 API 키를 입력하세요')
    return
  }

  stream = startTranslationStream(
    { apiKey: settings.apiKey, model: settings.model },
    {
      onTokens: (tokens) => {
        if (transcript.apply(tokens)) scheduleRender()
      },
      onStatus: onStreamStatus,
      onRestart: () => {
        transcript.closeOpen()
        scheduleRender()
      },
    },
  )
  if (!micOn) await startMic()
}

async function togglePause() {
  if (!stream) {
    await start()
    return
  }
  paused = !paused
  setPaused(paused)
  stream.setPaused(paused)
  if (paused) {
    stopSpeaking()
    await stopMic()
    setStatus('paused', '일시정지됨')
    await showLensStatus('일시정지 · 탭하면 다시 시작')
  } else {
    await startMic()
    if (micOn) {
      setStatus('live', '번역 중 · 태국어 ⇄ 한국어')
      await showLensStatus(`● 번역 중   ${HINT}`)
    }
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────
glasses.onAudio((pcm) => stream?.sendPcm(pcm))
glasses.onInput((input) => {
  if (input === 'tap') void togglePause()
  else if (input === 'doubleTap') void shutdown()
})

async function shutdown() {
  stopSpeaking()
  stream?.close()
  stream = null
  await stopMic()
  await glasses.exit()
}

mountUi(settings, glasses.isReal, {
  onSave: async (next) => {
    settings = next
    await glasses.setItem(SETTINGS_KEY, JSON.stringify(next))
    await stopMic()
    lensBody = ''
    scheduleRender()
    await start()
  },
  onTogglePause: () => void togglePause(),
  onClear: () => {
    transcript.clear()
    scheduleRender()
  },
  onSpeak: (thai) => {
    if (!speakThai(thai, settings.speechRate)) setStatus('error', '음성 읽기를 쓸 수 없습니다.')
  },
})

// Glasses page must exist before the glasses mic can be opened.
const created = await glasses.createPage('준비 중…', '태국어로 말하면 한국어 자막이 여기에 나옵니다.')
if (!created) setStatus('error', '안경 화면을 만들지 못했습니다. 안경 연결을 확인하세요.')
renderConversation(transcript.view())
await start()
