/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev only: lets the browser preview start without typing a key. */
  readonly VITE_SONIOX_API_KEY?: string
  readonly VITE_GEMINI_API_KEY?: string
}
