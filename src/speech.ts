// Reads Thai text aloud on the phone speaker with the system voice.
// Availability depends on the phone: a Thai voice must be installed
// (Android: Google TTS, iOS: Settings > Accessibility > Spoken Content).

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function thaiVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  return voices.find((v) => v.lang.toLowerCase().startsWith('th'))
}

export function hasThaiVoice(): boolean {
  return speechAvailable() && !!thaiVoice()
}

export function speakThai(text: string, rate = 0.9): boolean {
  if (!speechAvailable() || !text.trim()) return false
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'th-TH'
  u.rate = rate
  const voice = thaiVoice()
  if (voice) u.voice = voice
  synth.speak(u)
  return true
}

export function stopSpeaking(): void {
  if (speechAvailable()) window.speechSynthesis.cancel()
}
