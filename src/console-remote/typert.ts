import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { WORKTREE_CONSOLE_DESCRIPTORS } from './descriptors.js'

/** Manual strict Host contribution discovered by the official Typert Loader through `./typert`. */
export const TYPERT: TypertContribution = Object.freeze({
  package: 'dsh-git-worktree',
  face: 'host',
  schemas: [],
  model: {
    services: [],
    events: [],
    objects: [],
  },
  invocations: WORKTREE_CONSOLE_DESCRIPTORS,
})
