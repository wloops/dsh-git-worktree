import type { MessageCatalog } from './core.js'

export const transportMessages = {
  malformed: {
    zh: 'Remote {method} 返回了不符合 strict contract 的 payload',
    en: 'Remote {method} returned a payload that does not match the strict contract',
  },
  mountFailed: {
    zh: 'Worktree Console Remote namespace 挂载失败',
    en: 'Failed to mount the Worktree Console Remote namespace',
  },
} as const satisfies MessageCatalog
