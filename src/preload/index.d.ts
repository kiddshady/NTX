import type { NtxApi } from '../shared/types.js'

declare global {
  interface Window {
    ntx: NtxApi
  }
}

export {}
