/** Source preflight failed before checkout creation; changing the target path cannot help.
 * This classification grants no permission to clean up a target directory.
 */
export class WorktreeCreationPreflightFailure extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'WorktreeCreationPreflightFailure'
  }
}

/** A creation failure is not permission to infer that an empty-looking path is safe. */
export class WorktreeCreationFailure extends Error {
  constructor(message: string, readonly rolledBack: boolean) {
    super(message)
    this.name = 'WorktreeCreationFailure'
  }
}
