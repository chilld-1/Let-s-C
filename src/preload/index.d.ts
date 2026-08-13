import type { CaptureApi } from './index'

declare global {
  interface Window {
    api: CaptureApi
  }
}

export {}
