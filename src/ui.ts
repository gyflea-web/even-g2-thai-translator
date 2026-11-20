// Phone screen: status, the "show to the other person" card, the conversation
// log, settings and the lens preview.

import type { MicSource, Provider, Settings } from './settings'
import type { TranscriptView, Utterance } from './transcript'
import { hasThaiVoice, speechAvailable } from './speech'

export type StatusKind = 'idle' | 'connecting' | 'live' | 'paused' | 'error'

export interface UiHandlers {
  onSave: (s: Settings) => void
  onTogglePause: () => void
  onClear: () => void
  onSpeak: (thai: string) => void
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

let handlers: UiHandlers
let current: Settings
let latestThai = ''

export function mountUi(settings: Settings, isReal: boolean, h: UiHandlers): void {
  handlers = h
  current = settings

  const micSel = $<HTMLSelectElement>('#set-mic')
  if (!isReal) {
    micSel.innerHTML = '<option value="browser">이 컴퓨터의 마이크 (미리보기)</option>'
    $('#preview-note').hidden = false
    $<HTMLDetailsElement>('#lens-box').open = true
  }
  fillSettings(settings, isReal)

  $('#pause-btn').addEventListener('click', () => handlers.onTogglePause())
  $('#clear-btn').addEventListener('click', () => handlers.onClear())
  $('#speak-btn').addEventListener('click', () => handlers.onSpeak(latestThai))
  $('#big-btn').addEventListener('click', () => openBig())
  $('#big-view').addEventListener('click', () => ($('#big-view').hidden = true))
  document.querySelectorAll<HTMLButtonElement>('.key-toggle').forEach((btn) =>
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.for ?? '') as HTMLInputElement
      input.type = input.type === 'password' ? 'text' : 'password'
    }),
  )
  const providerSel = $<HTMLSelectElement>('#set-provider')
  providerSel.addEventListener('change', () => showProviderFields(providerSel.value as Provider))
  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const next: Settings = {
      ...current,
      provider: providerSel.value as Provider,
      geminiKey: $<HTMLInputElement>('#set-gkey').value.trim(),
      geminiModel: $<HTMLInputElement>('#set-gmodel').value.trim() || current.geminiModel,
      apiKey: $<HTMLInputElement>('#set-key').value.trim(),
      micSource: micSel.value as MicSource,
      model: $<HTMLInputElement>('#set-model').value.trim() || current.model,
      showMine: $<HTMLInputElement>('#set-mine').checked,
      autoSpeak: $<HTMLInputElement>('#set-speak').checked,
      speechRate: Number($<HTMLInputElement>('#set-rate').value) || current.speechRate,
    }
    current = next
    handlers.onSave(next)
    flash('#save-note', '저장했습니다. 다시 연결합니다.')
  })

  if (!speechAvailable()) {
    $('#speak-btn').hidden = true
    $('#tts-note').textContent = '이 화면에서는 음성 읽기를 쓸 수 없습니다.'
  } else {
    const check = () => {
      $('#tts-note').textContent = hasThaiVoice()
        ? ''
        : '태국어 음성이 설치되어 있지 않으면 읽어주기가 동작하지 않을 수 있습니다.'
    }
    check()
    window.speechSynthesis.addEventListener?.('voiceschanged', check)
  }

  if (!(settings.provider === 'gemini' ? settings.geminiKey : settings.apiKey)) {
    $<HTMLDetailsElement>('#settings-box').open = true
  }
}

function showProviderFields(p: Provider) {
  document.querySelectorAll<HTMLElement>('[data-provider]').forEach((el) => {
    el.hidden = el.dataset.provider !== p
  })
}

function fillSettings(s: Settings, isReal: boolean) {
  $<HTMLSelectElement>('#set-provider').value = s.provider
  showProviderFields(s.provider)
  $<HTMLInputElement>('#set-gkey').value = s.geminiKey
  $<HTMLInputElement>('#set-gmodel').value = s.geminiModel
  $<HTMLInputElement>('#set-key').value = s.apiKey
  $<HTMLSelectElement>('#set-mic').value = isReal ? (s.micSource === 'phone' ? 'phone' : 'glasses') : 'browser'
  $<HTMLInputElement>('#set-model').value = s.model
  $<HTMLInputElement>('#set-mine').checked = s.showMine
  $<HTMLInputElement>('#set-speak').checked = s.autoSpeak
  $<HTMLInputElement>('#set-rate').value = String(s.speechRate)
}

function flash(sel: string, text: string) {
  const el = $(sel)
  el.textContent = text
  setTimeout(() => {
    if (el.textContent === text) el.textContent = ''
  }, 3000)
}

export function setStatus(kind: StatusKind, text: string): void {
  const chip = $('#status')
  chip.dataset.kind = kind
  chip.textContent = text
}

export function setPaused(paused: boolean): void {
  $('#pause-btn').textContent = paused ? '다시 시작' : '일시정지'
}

function openBig() {
  if (!latestThai) return
  $('#big-text').textContent = latestThai
  $('#big-view').hidden = false
}

function bubble(u: Pick<Utterance, 'lang' | 'original' | 'translation'>, pending: boolean): HTMLElement {
  const el = document.createElement('div')
  el.className = `bubble ${u.lang === 'th' ? 'them' : 'me'}${pending ? ' pending' : ''}`
  const who = document.createElement('div')
  who.className = 'who'
  who.textContent = u.lang === 'th' ? '상대 (태국어)' : '나 (한국어)'
  const main = document.createElement('div')
  main.className = 'main'
  const sub = document.createElement('div')
  sub.className = 'sub'
  if (u.lang === 'th') {
    main.textContent = u.translation || '…'
    sub.textContent = u.original
    sub.lang = 'th'
  } else {
    main.textContent = u.translation || '…'
    main.lang = 'th'
    sub.textContent = u.original
  }
  el.append(who, main, sub)
  return el
}

export function renderConversation(view: TranscriptView): void {
  const log = $('#log')
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80
  const { utterances, interim } = view
  const last = utterances[utterances.length - 1]
  const joins = !!(interim.lang && last && !last.ended && last.lang === interim.lang)

  const frag = document.createDocumentFragment()
  const shown = utterances.slice(-60)
  for (const u of shown) {
    if (u === last && joins) {
      frag.append(
        bubble(
          { lang: u.lang, original: u.original + interim.original, translation: u.translation + interim.translation },
          true,
        ),
      )
    } else if (u.original.trim() || u.translation.trim()) {
      frag.append(bubble(u, false))
    }
  }
  if (interim.lang && !joins && (interim.original.trim() || interim.translation.trim())) {
    frag.append(bubble({ lang: interim.lang, original: interim.original, translation: interim.translation }, true))
  }
  if (!frag.childNodes.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = '대화가 시작되면 여기에 표시됩니다.'
    frag.append(empty)
  }
  log.replaceChildren(frag)
  if (nearBottom) log.scrollTop = log.scrollHeight

  // "Show to the other person" card: my latest sentence in Thai.
  let mine: Utterance | undefined
  for (let i = utterances.length - 1; i >= 0; i--) {
    if (utterances[i].lang === 'ko' && utterances[i].translation.trim()) {
      mine = utterances[i]
      break
    }
  }
  latestThai = mine?.translation.trim() ?? ''
  $('#show-thai').textContent = latestThai || '한국어로 말하면 태국어 번역이 여기에 크게 나옵니다.'
  $('#show-thai').classList.toggle('placeholder', !latestThai)
  $('#show-ko').textContent = mine?.original.trim() ?? ''
  $<HTMLButtonElement>('#speak-btn').disabled = !latestThai
  $<HTMLButtonElement>('#big-btn').disabled = !latestThai
  if (!$('#big-view').hidden && latestThai) $('#big-text').textContent = latestThai
}
