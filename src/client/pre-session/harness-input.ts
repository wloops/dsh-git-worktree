import type { PreSessionDraftActions, PreSessionDraftState } from './controller.js'

/** Harness renamed the image-only composer API when adding general attachments. */
export type HarnessInputState = PreSessionDraftState | (Omit<PreSessionDraftState, 'imageIds'> & {
  readonly attachmentIds: readonly string[]
})

export type HarnessInputActions = PreSessionDraftActions | {
  setDraft(text: string): void
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): void
}

export function readHarnessInput(input: HarnessInputState): PreSessionDraftState {
  return {
    ...input,
    imageIds: 'attachmentIds' in input ? input.attachmentIds : input.imageIds,
  }
}

/** Bind through the original receiver: target input faces may be class instances. */
export function adaptHarnessInputActions(input: HarnessInputActions): PreSessionDraftActions {
  if ('addAttachments' in input) {
    return {
      setDraft: text => input.setDraft(text),
      addImages: ids => input.addAttachments(ids),
      removeImage: id => input.removeAttachment(id),
    }
  }
  return input
}
