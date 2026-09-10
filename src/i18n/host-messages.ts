import type { MessageCatalog, Translator } from './core.js'

/** Host-owned prose. Keys are stable; user data is passed only as interpolation values. */
export const hostMessages = {
  "initialStateChanged": {"zh": "仓库状态已变化，请重新选择独立 Worktree 并确认。没有沿用旧确认创建提交。", "en": "The repository changed. Select Independent Worktree again and confirm the new state. The old confirmation was not used."},
  "initialCommitFailed": {"zh": "无法创建初始版本。请检查 Git 仓库权限和配置后重试。", "en": "Cannot create the initial version. Check Git repository permissions and configuration, then retry."},
  "initialIdentityMissing": {"zh": "Git 提交身份未配置。请在该仓库中设置 git config user.name \"你的名字\" 和 git config user.email \"你的邮箱\" 后重试。插件不会修改身份。", "en": "Git commit identity is not configured. In this repository, set git config user.name \"Your Name\" and git config user.email \"you@example.com\", then retry. The plugin will not change your identity."},
  "initialRepositoryBusy": {"zh": "仓库正在被其他操作使用。请等待操作完成后重试。", "en": "The repository is busy. Wait for the other operation to finish, then retry."},
  "initialConfirmationRequired": {"zh": "当前仓库尚无提交。请通过工作目录菜单确认创建初始版本，或使用本地目录。", "en": "This repository has no commits. Confirm an initial version through the working directory menu, or use the local directory."},
  "initialHasFiles": {"zh": "当前未提交的文件不会带入独立工作目录。可以先提交需要的文件，或使用本地目录开始任务。", "en": "Uncommitted files will not be included in the independent working directory. Commit the files you need first, or start in the local directory."},
  "initialCreatedWorktreeFailed": {"zh": "初始版本已创建，但独立 Worktree 创建失败。提交已保留，请重新选择独立 Worktree 重试。", "en": "The initial version was created, but Worktree creation failed. The commit is retained. Select Independent Worktree again to retry."},

  "repositoryInspectionFailed": {
    "zh": "无法读取 Git 仓库状态。请检查目录权限、HEAD 和 Git 元数据是否完整，然后重试。",
    "en": "Cannot read the Git repository state. Check directory permissions, HEAD and Git metadata, then retry."
  },
  "sessionNotFound": {
    "zh": "会话不存在: {p0}",
    "en": "Session not found: {p0}"
  },
  "theSessionIsNotAssociatedWithAProject": {
    "zh": "会话尚未关联项目",
    "en": "The Session is not associated with a project."
  },
  "projectNotFound": {
    "zh": "项目不存在: {p0}",
    "en": "Project not found: {p0}"
  },
  "projectRootDirectoryNotFound": {
    "zh": "项目根目录不存在: {p0}",
    "en": "Project root directory not found: {p0}"
  },
  "theSessionWorkspaceNoLongerMatchesItsBoundSession": {
    "zh": "会话当前 Workspace 与已绑定 Session Target 不一致，已停止访问 checkout",
    "en": "The Session Workspace no longer matches its bound Session Target; checkout access has stopped."
  },
  "theSessionHasNotSelectedASessionTarget": {
    "zh": "会话尚未选择 Session Target",
    "en": "The Session has not selected a Session Target."
  },
  "onlyTheOwnerIsolatedSessionCanPrepareAReview": {
    "zh": "只有 owner Isolated 会话可以准备验收",
    "en": "Only the owner Isolated Session can prepare a review."
  },
  "theReviewSummaryCommitMessageOrValidationItemsAre": {
    "zh": "验收摘要、提交信息或验证项目无效",
    "en": "The review summary, commit message, or validation items are invalid."
  },
  "theIsolatedCheckoutRecordDoesNotExist": {
    "zh": "Isolated Checkout 记录不存在",
    "en": "The Isolated Checkout record does not exist."
  },
  "cannotPrepareAReviewInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能准备验收",
    "en": "Cannot prepare a review in the current {p0}/{p1} state."
  },
  "theIsolatedCheckoutIdentityCannotBeVerifiedRecoveryIs": {
    "zh": "Isolated Checkout 身份无法确认，需要恢复",
    "en": "The Isolated Checkout identity cannot be verified; recovery is required."
  },
  "onlyTheOwnerIsolatedSessionCanSaveACheckpoint": {
    "zh": "只有 owner Isolated 会话可以保存阶段",
    "en": "Only the owner Isolated Session can save a checkpoint."
  },
  "theCheckpointRequestOrCommitMessageIsInvalid": {
    "zh": "Checkpoint 请求或 Commit Message 无效",
    "en": "The Checkpoint request or commit message is invalid."
  },
  "theCheckpointRequestIdIsAlreadyUsedByAnotherState": {
    "zh": "Checkpoint requestId 已被其他状态使用，请刷新",
    "en": "The Checkpoint requestId is already used by another state. Refresh and retry."
  },
  "theSessionTargetHasChangedRefreshAndRetry": {
    "zh": "Session Target 已变化，请刷新后重试",
    "en": "The Session Target has changed. Refresh and retry."
  },
  "cannotSaveACheckpointInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能保存阶段",
    "en": "Cannot save a checkpoint in the current {p0}/{p1} state."
  },
  "theCheckpointReviewOrGenerationHasChangedRefreshAnd": {
    "zh": "Checkpoint Review 或 generation 已变化，请刷新后重试",
    "en": "The Checkpoint Review or generation has changed. Refresh and retry."
  },
  "anotherTaskIsOccupyingThisProjectSLocalAcceptance": {
    "zh": "另一个任务正在占用该项目的 Local 验收槽位",
    "en": "Another task is occupying this project's Local acceptance slot."
  },
  "theCheckpointStateChangedBeforeTheHostCASRefresh": {
    "zh": "Checkpoint 状态在 Host CAS 前发生变化，请刷新后重试",
    "en": "The Checkpoint state changed before the Host CAS. Refresh and retry."
  },
  "previewWasRolledBackButTheCheckoutRecordIs": {
    "zh": "Preview 已撤回，但 Checkout 记录丢失",
    "en": "Preview was rolled back, but the Checkout record is missing."
  },
  "thereIsNoReviewCheckpointToSave": {
    "zh": "当前没有可保存的验收阶段",
    "en": "There is no review checkpoint to save."
  },
  "theCheckpointJournalChangedBeforeRetainingTheInternalRef": {
    "zh": "Checkpoint journal 在保留内部 ref 前发生变化",
    "en": "The Checkpoint journal changed before retaining the internal ref."
  },
  "checkpointWasCreatedButTheCheckoutRecordIsMissing": {
    "zh": "Checkpoint 已创建，但 Checkout 记录丢失",
    "en": "Checkpoint was created, but the Checkout record is missing."
  },
  "onlyTheOwnerIsolatedSessionCanResumeEditing": {
    "zh": "只有 owner Isolated 会话可以恢复编辑",
    "en": "Only the owner Isolated Session can resume editing."
  },
  "theCurrentWorktreeHasNoUnsyncedReviewToResume": {
    "zh": "当前 Worktree 没有可恢复编辑的未同步验收稿",
    "en": "The current Worktree has no unsynced review to resume editing."
  },
  "thisReviewCardIsNoLongerTheCurrentReview": {
    "zh": "该验收卡已不是当前 Review，请刷新后重试",
    "en": "This review card is no longer the current Review. Refresh and retry."
  },
  "theAcceptanceStateChangedBeforeResumingEditingRefreshAnd": {
    "zh": "验收状态在恢复编辑前发生变化，请刷新后重试",
    "en": "The acceptance state changed before resuming editing. Refresh and retry."
  },
  "theConflictRecoveryIdentityChangedBeforeHostCASRun": {
    "zh": "冲突恢复身份在 Host CAS 前已变化，请重新预检",
    "en": "The conflict recovery identity changed before Host CAS. Run preflight again."
  },
  "theAcceptanceStateChangedBeforeConflictRecoveryRefreshAnd": {
    "zh": "验收状态在冲突恢复前发生变化，请刷新后重试",
    "en": "The acceptance state changed before conflict recovery. Refresh and retry."
  },
  "onlyTheOwnerIsolatedSessionCanRequestReviewRegeneration": {
    "zh": "只有 owner Isolated 会话可以请求重新生成验收结果",
    "en": "Only the owner Isolated Session can request review regeneration."
  },
  "theReadOnlyReviewRegenerationIdentityChangedBeforeHost": {
    "zh": "只读验收再生成身份在 Host 授权前已变化",
    "en": "The read-only review regeneration identity changed before Host authorization."
  },
  "theReadyReviewChangedBeforeReadOnlyAuthorization": {
    "zh": "Ready Review 在只读授权前发生变化",
    "en": "The Ready Review changed before read-only authorization."
  },
  "theDetachedPreviewRecoveryProofHasChangedCheckAgain": {
    "zh": "Detached Preview Recovery proof 已变化，请重新检查",
    "en": "The Detached Preview Recovery proof has changed. Check again."
  },
  "theDetachedPreviewChangedBeforeAnalysisAuthorization": {
    "zh": "Detached Preview 在分析授权前发生变化",
    "en": "The Detached Preview changed before analysis authorization."
  },
  "recoveryHandoffRequiresANewPreallocatedSessionID": {
    "zh": "Recovery handoff 必须使用新的预分配 Session ID",
    "en": "Recovery handoff requires a new preallocated Session ID."
  },
  "theRecoveryHandoffSessionIDIsAlreadyInUse": {
    "zh": "Recovery handoff Session ID 已被占用",
    "en": "The Recovery handoff Session ID is already in use."
  },
  "thePreviousDetachedPreviewIdentityHasChanged": {
    "zh": "旧 Detached Preview 身份已变化",
    "en": "The previous Detached Preview identity has changed."
  },
  "theOriginalSourceSessionIsUnavailableNoHandoffWorktree": {
    "zh": "原始 source Session 不可用，未创建 handoff Worktree",
    "en": "The original source Session is unavailable; no handoff Worktree was created."
  },
  "theRecoveryHandoffWorktreeRecordIsMissingAfterCreation": {
    "zh": "Recovery handoff Worktree 创建后记录缺失",
    "en": "The Recovery handoff Worktree record is missing after creation."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform": {
    "zh": "继承 Session Target 的会话不能执行 Apply",
    "en": "A Session that inherited its Session Target cannot perform Apply."
  },
  "localCheckoutDoesNotSupportApply": {
    "zh": "Local Checkout 不支持 Apply",
    "en": "Local Checkout does not support Apply."
  },
  "cannotApplyInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能 Apply",
    "en": "Cannot Apply in the current {p0}/{p1} state."
  },
  "anotherAcceptanceTaskInTheSameProjectIsOccupying": {
    "zh": "同一项目已有验收任务正在占用 Local：{p0}",
    "en": "Another acceptance task in the same project is occupying Local: {p0}"
  },
  "theIsolatedCheckoutStateHasChangedRecoveryIsRequired": {
    "zh": "Isolated Checkout 状态已变化，需要恢复",
    "en": "The Isolated Checkout state has changed; recovery is required."
  },
  "worktreeChangedAfterBeingMarkedReadyForReviewPrepare": {
    "zh": "Worktree 在标记可验收后又发生变化，请重新准备验收",
    "en": "Worktree changed after being marked ready for review. Prepare the review again."
  },
  "worktreeChangesWereWrittenToLocalPreviewThroughApplyWorktree": {
    "zh": "Worktree 修改已通过 ApplyWorktree 写入 Local Preview",
    "en": "Worktree changes were written to Local Preview through ApplyWorktree."
  },
  "choreCommitWorktreeChanges": {
    "zh": "chore: 提交 Worktree 修改",
    "en": "chore: commit Worktree changes"
  },
  "onlyTheOwnerIsolatedSessionCanCheckPreviewRecovery": {
    "zh": "只有 owner Isolated 会话可以检查 Preview 恢复",
    "en": "Only the owner Isolated Session can check Preview recovery."
  },
  "theSessionTargetHasChangedRefreshBeforeCheckingAgain": {
    "zh": "Session Target 已变化，请刷新后重新检查",
    "en": "The Session Target has changed. Refresh before checking again."
  },
  "theCurrentStateIsNotTheSpecifiedDetachedPreview": {
    "zh": "当前并非指定的 detached Preview 恢复状态",
    "en": "The current state is not the specified detached Preview recovery state."
  },
  "theWorktreeIdentityPathOrGitStateCannotCurrently": {
    "zh": "Worktree 身份、路径或 Git 状态暂时无法确认",
    "en": "The Worktree identity, path, or Git state cannot currently be verified."
  },
  "previewRetainedArtifactsAreMissingOrDoNotMatch": {
    "zh": "Preview retained artifacts 缺失或与 receipt 不一致",
    "en": "Preview retained artifacts are missing or do not match the receipt."
  },
  "thePreviewRecoveryStateChangedDuringTheCheck": {
    "zh": "Preview 恢复状态在检查期间发生变化",
    "en": "The Preview recovery state changed during the check."
  },
  "previewRetainedArtifactsChangedDuringTheCheck": {
    "zh": "Preview retained artifacts 在检查期间发生变化",
    "en": "Preview retained artifacts changed during the check."
  },
  "previewRecoveryCheckFailed": {
    "zh": "Preview 恢复检查失败",
    "en": "Preview recovery check failed."
  },
  "onlyTheOwnerIsolatedSessionCanRunSyncPreflight": {
    "zh": "只有 owner Isolated 会话可以执行同步预检",
    "en": "Only the owner Isolated Session can run sync preflight."
  },
  "theSessionTargetHasChangedRefreshBeforeRunningPreflight": {
    "zh": "Session Target 已变化，请刷新后重新预检",
    "en": "The Session Target has changed. Refresh before running preflight again."
  },
  "theCurrentWorktreeIsNotReadyForReview": {
    "zh": "当前 Worktree 尚未处于可验收状态",
    "en": "The current Worktree is not ready for review."
  },
  "theSessionTargetChangedDuringPreflightRefreshAndRetry": {
    "zh": "Session Target 在预检期间发生变化，请刷新后重试",
    "en": "The Session Target changed during preflight. Refresh and retry."
  },
  "worktreeChangedAfterTheReviewWasPreparedRegenerateThe": {
    "zh": "Worktree 在准备验收后发生变化，请重新生成验收结果",
    "en": "Worktree changed after the review was prepared. Regenerate the review."
  },
  "onlyTheOwnerIsolatedSessionCanSyncAReview": {
    "zh": "只有 owner Isolated 会话可以同步验收",
    "en": "Only the owner Isolated Session can sync a review."
  },
  "theAcceptanceStateHasChangedRefreshAndRetry": {
    "zh": "验收状态已变化，请刷新后重试",
    "en": "The acceptance state has changed. Refresh and retry."
  },
  "thereIsNoLocalPreviewToRelease": {
    "zh": "当前没有可解除的 Local Preview",
    "en": "There is no Local Preview to release."
  },
  "thePreviewStateHasChangedRefreshAndRetry": {
    "zh": "Preview 状态已变化，请刷新后重试",
    "en": "The Preview state has changed. Refresh and retry."
  },
  "onlyTheOwnerIsolatedSessionCanRollBackAcceptance": {
    "zh": "只有 owner Isolated 会话可以撤回验收",
    "en": "Only the owner Isolated Session can roll back acceptance."
  },
  "thereIsNoLocalPreviewToRollBack": {
    "zh": "当前没有可撤回的 Local Preview",
    "en": "There is no Local Preview to roll back."
  },
  "thePreviewRecoveryProofHasExpiredOrDoesNot": {
    "zh": "Preview Recovery proof 已过期或不匹配，请重新检查",
    "en": "The Preview Recovery proof has expired or does not match. Check again."
  },
  "onlyTheOwnerIsolatedSessionCanFinalizeTheAcceptance": {
    "zh": "只有 owner Isolated 会话可以完成验收提交",
    "en": "Only the owner Isolated Session can finalize the acceptance commit."
  },
  "thereIsNoLocalPreviewAwaitingAcceptance": {
    "zh": "当前没有等待验收的 Local Preview",
    "en": "There is no Local Preview awaiting acceptance."
  },
  "theCommitWasCreatedButTheCheckoutRecordIs": {
    "zh": "提交已创建，但 Checkout 记录丢失",
    "en": "The commit was created, but the Checkout record is missing."
  },
  "theCommitWasCreatedButSavingTheRetainedWorktree": {
    "zh": "提交已创建，但保留 Worktree 状态写入失败",
    "en": "The commit was created, but saving the retained Worktree state failed."
  },
  "onlyTheOwnerIsolatedSessionCanRetryCleanup": {
    "zh": "只有 owner Isolated 会话可以重试清理",
    "en": "Only the owner Isolated Session can retry cleanup."
  },
  "thereIsNoWorktreeCleanupToRetry": {
    "zh": "当前没有待重试的 Worktree 清理",
    "en": "There is no Worktree cleanup to retry."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform162": {
    "zh": "继承 Session Target 的会话不能执行 Finish",
    "en": "A Session that inherited its Session Target cannot perform Finish."
  },
  "localCheckoutDoesNotSupportFinish": {
    "zh": "Local Checkout 不支持 Finish",
    "en": "Local Checkout does not support Finish."
  },
  "thisReviewCardIsNoLongerTheCurrentReview166": {
    "zh": "该验收卡已不是当前 Review，请刷新并确认最新交付",
    "en": "This review card is no longer the current Review. Refresh and confirm the latest delivery."
  },
  "thisLegacyWorktreeWasWrittenToLocalThroughAn": {
    "zh": "该历史 Worktree 已通过旧版 Apply 写入 Local；为避免遗漏或重复提交，已禁止自动 Finish，请先人工核对 Local 后再清理记录。",
    "en": "This legacy Worktree was written to Local through an older Apply. Automatic Finish is disabled to avoid missing or duplicate commits. Check Local manually before cleaning up the record."
  },
  "cannotFinishDirectlyInTheCurrentState": {
    "zh": "当前 {p0}/{p1} 状态不能直接 Finish",
    "en": "Cannot Finish directly in the current {p0}/{p1} state."
  },
  "worktreeChangedAfterReviewPrepareTheReviewAgain": {
    "zh": "Worktree 在验收后又发生变化，请重新准备验收",
    "en": "Worktree changed after review. Prepare the review again."
  },
  "skipLocalAcceptanceAndCommitDirectly": {
    "zh": "跳过 Local 验收并直接提交",
    "en": "Skip Local acceptance and commit directly."
  },
  "theTaskCommitWasCreatedButTheCheckoutRecord": {
    "zh": "任务提交已创建，但 Checkout 记录丢失，需要人工检查",
    "en": "The task commit was created, but the Checkout record is missing. Manual inspection is required."
  },
  "theTaskCommitWasCreatedButSavingTheRetained": {
    "zh": "任务提交已创建，但保留 Worktree 状态写入失败",
    "en": "The task commit was created, but saving the retained Worktree state failed."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform178": {
    "zh": "继承 Session Target 的会话不能执行 Discard",
    "en": "A Session that inherited its Session Target cannot perform Discard."
  },
  "localCheckoutDoesNotSupportDiscard": {
    "zh": "Local Checkout 不支持 Discard",
    "en": "Local Checkout does not support Discard."
  },
  "localPreviewDriftedIntoDetachedRecoveryToPreserveRecovery": {
    "zh": "Local Preview 已因漂移进入 detached 恢复态；为保留恢复证据，不能删除 Worktree。请先成功撤回 Preview。",
    "en": "Local Preview drifted into detached recovery. To preserve recovery evidence, this Worktree cannot be deleted. Successfully roll back Preview first."
  },
  "thisLegacyWorktreeWasWrittenToLocalThroughAn183": {
    "zh": "该历史 Worktree 已通过旧版 Apply 写入 Local；不会自动 Discard，请先人工核对 Local 的未提交修改。",
    "en": "This legacy Worktree was written to Local through an older Apply. Automatic Discard is disabled. Check Local's uncommitted changes manually first."
  },
  "thisTaskIsPreviewingInLocalSafelyRollBack": {
    "zh": "本任务正在 Local 预览；放弃任务前必须先安全撤回 Preview",
    "en": "This task is previewing in Local. Safely roll back Preview before discarding the task."
  },
  "cannotDiscardInTheCurrentState": {
    "zh": "当前 {p0} 状态不能 Discard",
    "en": "Cannot Discard in the current {p0} state."
  },
  "confirmationWillPermanentlyDeleteCheckpointsNotYetDeliveredTo": {
    "zh": "；确认后会永久删除 {p0} 个尚未交付到 Local 的阶段",
    "en": "; confirmation will permanently delete {p0} checkpoints not yet delivered to Local"
  },
  "theIsolatedCheckoutHasUncommittedChangesUndeliveredCheckpointsOr": {
    "zh": "Isolated Checkout 含未提交修改、未交付阶段或状态无法确认，需要明确确认{p0}",
    "en": "The Isolated Checkout has uncommitted changes, undelivered checkpoints, or an unverified state. Explicit confirmation is required{p0}"
  },
  "failedToDeleteTheManagedCheckout": {
    "zh": "删除 managed checkout 失败",
    "en": "Failed to delete the managed checkout."
  },
  "aSessionThatInheritedItsSessionTargetCannotPerform192": {
    "zh": "继承 Session Target 的会话不能执行 Recover",
    "en": "A Session that inherited its Session Target cannot perform Recover."
  },
  "localCheckoutDoesNotSupportRecover": {
    "zh": "Local Checkout 不支持 Recover",
    "en": "Local Checkout does not support Recover."
  },
  "cannotSafelyDetermineWhetherApplyModifiedLocalItWill": {
    "zh": "Apply 是否已修改 Local 无法安全确认；不会自动重试或猜测成功",
    "en": "Cannot safely determine whether Apply modified Local. It will not retry automatically or assume success."
  },
  "theIsolatedCheckoutIsMissingOnlyAnExplicitDiscard": {
    "zh": "Isolated Checkout 缺失，只能由 owner 明确 Discard 收口",
    "en": "The Isolated Checkout is missing. Only an explicit Discard by its owner can close it."
  },
  "theIsolatedCheckoutPathGitIdentityProjectHEADOr": {
    "zh": "Isolated Checkout 的路径、Git 身份、项目、HEAD 或状态无法完整确认",
    "en": "The Isolated Checkout path, Git identity, project, HEAD, or state cannot be fully verified."
  },
  "deletedAgentSession": {
    "zh": "已删除的 Agent 会话",
    "en": "Deleted Agent Session"
  },
  "theCurrentIterationIsStillBeingEditedAndHas": {
    "zh": "当前轮次仍在修改，尚未形成可清理的交付环境。",
    "en": "The current iteration is still being edited and has no delivered environment to clean up."
  },
  "theCurrentIterationIsAwaitingAcceptanceAndCannotBe": {
    "zh": "当前轮次正在等待验收，不能清理。",
    "en": "The current iteration is awaiting acceptance and cannot be cleaned up."
  },
  "localPreviewHasNotBeenSafelyResolvedAndCannot": {
    "zh": "Local Preview 尚未完成安全收口，不能清理。",
    "en": "Local Preview has not been safely resolved and cannot be cleaned up."
  },
  "worktreeHasBeenDeliveredAndReleasedFromManagementNo": {
    "zh": "Worktree 已交付并解除管理，无需再次清理。",
    "en": "Worktree has been delivered and released from management. No further cleanup is needed."
  },
  "theLocalCheckoutIdentityCannotBeVerifiedThisIteration": {
    "zh": "Local checkout identity 无法验证，不能证明本轮交付仍存在。",
    "en": "The Local checkout identity cannot be verified; this iteration's delivery cannot be proven to exist."
  },
  "thisIterationSDeliveryCommitIsNoLongerIn": {
    "zh": "本轮交付 commit 已不在 Local 历史中，不能清理环境。",
    "en": "This iteration's delivery commit is no longer in Local history. The environment cannot be cleaned up."
  },
  "cannotVerifyWhetherThisIterationSDeliveryCommitIs": {
    "zh": "无法验证本轮交付 commit 是否仍在 Local 历史中。",
    "en": "Cannot verify whether this iteration's delivery commit is still in Local history."
  },
  "theCleanupDirectoryIdentityCannotBeReverifiedTheEnvironment": {
    "zh": "清理目录身份无法重新验证，已保留环境。",
    "en": "The cleanup directory identity cannot be reverified. The environment was preserved."
  },
  "theWorktreeCheckoutIdentityCannotBeVerifiedTheEnvironment": {
    "zh": "Worktree checkout identity 无法验证，已保留环境。",
    "en": "The Worktree checkout identity cannot be verified. The environment was preserved."
  },
  "newChangesWereDetectedAfterCommitOrRetentionBulk": {
    "zh": "提交或保留后检测到新增修改，不能批量清理。",
    "en": "New changes were detected after commit or retention. Bulk cleanup is not allowed."
  },
  "cannotProveTheCurrentWorktreeStateIsSafeThe": {
    "zh": "无法证明 Worktree 当前状态安全，已保留环境。",
    "en": "Cannot prove the current Worktree state is safe. The environment was preserved."
  },
  "thePreviousCleanupDidNotFinishRevalidateAndRetry": {
    "zh": "上次清理未完成，可重新校验后重试。",
    "en": "The previous cleanup did not finish. Revalidate and retry."
  },
  "retainedManuallyAtTheUserSRequest": {
    "zh": "按用户选择手动保留。",
    "en": "Retained manually at the user's request."
  },
  "theRetentionPeriodHasNotExpired": {
    "zh": "保留期限尚未到期。",
    "en": "The retention period has not expired."
  },
  "readOnlySafetyInspectionPassedCleanupIsAvailable": {
    "zh": "已通过只读安全巡检，可以清理。",
    "en": "Read-only safety inspection passed. Cleanup is available."
  },
  "theWorktreeRevisionHasChangedCleanupWasNotPerformed": {
    "zh": "Worktree revision 已变化，未执行清理。",
    "en": "The Worktree revision has changed. Cleanup was not performed."
  },
  "worktreeChangedBeforeCleanupCleanupWasNotPerformed": {
    "zh": "Worktree 在清理前发生变化，未执行清理。",
    "en": "Worktree changed before cleanup. Cleanup was not performed."
  },
  "theWorktreeRecordDoesNotExist": {
    "zh": "Worktree 记录不存在",
    "en": "The Worktree record does not exist."
  },
  "theCurrentSessionIsNotAllowedToManageThis": {
    "zh": "当前 Session 无权管理该 Worktree",
    "en": "The current Session is not allowed to manage this Worktree."
  },
  "theOwnerSessionHasTakenOverThisWorktreeOnly": {
    "zh": "Owner Session 已接管该 Worktree，只有 owner 可以管理",
    "en": "The owner Session has taken over this Worktree. Only the owner can manage it."
  },
  "theCurrentSessionAndWorktreeDoNotBelongTo": {
    "zh": "当前 Session 与 Worktree 不属于同一原始项目",
    "en": "The current Session and Worktree do not belong to the same original project."
  },
  "theWorktreeStateHasChangedRefreshAndRetry": {
    "zh": "Worktree 状态已变化，请刷新后重试",
    "en": "The Worktree state has changed. Refresh and retry."
  },
  "onlyRetainedFrozenWorktreesCanHaveTheirRetentionPeriod": {
    "zh": "只有已保留的冻结 Worktree 可以调整保留期限",
    "en": "Only retained, frozen Worktrees can have their retention period changed."
  },
  "theCurrentWorktreeIsNotInACleanableState": {
    "zh": "当前 Worktree 不处于可清理状态",
    "en": "The current Worktree is not in a cleanable state."
  },
  "theWorktreeDirectoryNoLongerExists": {
    "zh": "Worktree 目录已不存在",
    "en": "The Worktree directory no longer exists."
  },
  "theWorktreeDirectoryIdentityCannotBeVerified": {
    "zh": "Worktree 目录身份无法验证",
    "en": "The Worktree directory identity cannot be verified."
  },
  "onlyADeliveredIsolatedSessionCanBeginTheNext": {
    "zh": "只有已交付的 Isolated Session 可以开始下一轮",
    "en": "Only a delivered Isolated Session can begin the next iteration."
  },
  "thePreviousIterationSWorktreeRecordDoesNotExist": {
    "zh": "上一轮 Worktree 记录不存在",
    "en": "The previous iteration's Worktree record does not exist."
  },
  "onlyTheOwnerSessionCanBeginTheNextIteration": {
    "zh": "只有 owner Session 可以开始下一轮",
    "en": "Only the owner Session can begin the next iteration."
  },
  "theWorktreeStateHasChangedRefreshBeforeBeginningThe": {
    "zh": "Worktree 状态已变化，请刷新后再开始下一轮",
    "en": "The Worktree state has changed. Refresh before beginning the next iteration."
  },
  "onlyADeliveredStateWithSuccessfulCleanupCanBegin": {
    "zh": "只有已成功清理的交付状态可以开始下一轮",
    "en": "Only a delivered state with successful cleanup can begin the next iteration."
  },
  "theCurrentSessionIsNotAssociatedWithAWorkspace": {
    "zh": "当前 Session 尚未关联 Workspace",
    "en": "The current Session is not associated with a Workspace."
  },
  "theCurrentSessionSImmutableCwdDoesNotMatch": {
    "zh": "当前 Session 的 immutable cwd 与上一轮 Worktree 不一致",
    "en": "The current Session's immutable cwd does not match the previous iteration's Worktree."
  },
  "thePreviousIterationSWorktreePathHasReappearedUnknown": {
    "zh": "上一轮 Worktree 路径已重新出现，拒绝覆盖未知内容",
    "en": "The previous iteration's Worktree path has reappeared. Unknown content will not be overwritten."
  },
  "theOriginalLocalProjectIsUnavailableTheNextIteration": {
    "zh": "原始 Local 项目已不可用，不能开始下一轮",
    "en": "The original Local project is unavailable. The next iteration cannot begin."
  },
  "theOriginalLocalProjectIdentityHasChanged": {
    "zh": "原始 Local 项目身份已变化",
    "en": "The original Local project identity has changed."
  },
  "theOriginalLocalGitIdentityHasChanged": {
    "zh": "原始 Local Git 身份已变化",
    "en": "The original Local Git identity has changed."
  },
  "theProjectRootIsNotInsideItsGitCheckout": {
    "zh": "项目根目录不在其 Git checkout 内",
    "en": "The project root is not inside its Git checkout."
  },
  "thePreviousIterationSManagedProjectPathCannotBe": {
    "zh": "上一轮 managed project 路径无法从 Local 身份重建",
    "en": "The previous iteration's managed project path cannot be reconstructed from the Local identity."
  },
  "theWorktreeContainerIsNotATrustedDirectory": {
    "zh": "Worktree 容器不是可信目录",
    "en": "The Worktree container is not a trusted directory."
  },
  "theWorktreeContainerPathHasBeenRedirected": {
    "zh": "Worktree 容器路径已被重定向",
    "en": "The Worktree container path has been redirected."
  },
  "theNextIterationSCheckoutGitIdentityDoesNot": {
    "zh": "下一轮 checkout 的 Git 身份不匹配",
    "en": "The next iteration's checkout Git identity does not match."
  },
  "theStateChangedWhileCreatingTheNextIterationS": {
    "zh": "下一轮 Worktree 创建期间状态已变化",
    "en": "The state changed while creating the next iteration's Worktree."
  },
  "creatingTheNextIterationSWorktreeFailedAndIts": {
    "zh": "下一轮 Worktree 创建失败且残余目录包含未知内容，已保留现场",
    "en": "Creating the next iteration's Worktree failed and its remaining directory contains unknown content. The environment was preserved."
  },
  "theSessionIsAlreadyBoundToASessionTarget": {
    "zh": "会话已经绑定 Session Target，不能切换",
    "en": "The Session is already bound to a Session Target and cannot switch."
  },
  "aNonGitProjectCannotCreateAnIsolatedCheckout": {
    "zh": "非 Git 项目不能创建 Isolated Checkout",
    "en": "A non-Git project cannot create an Isolated Checkout."
  },
  "theFallbackWorktreeContainerIsNotATrustedDirectory": {
    "zh": "Worktree 回退容器不是可信目录，未创建或修改任何 checkout",
    "en": "The fallback Worktree container is not a trusted directory. No checkout was created or modified."
  },
  "allWorktreeCheckoutIdentityPathsAlreadyExistUnknownDirectories": {
    "zh": "Worktree Checkout identity 路径均已存在，拒绝覆盖未知目录",
    "en": "All Worktree Checkout identity paths already exist. Unknown directories will not be overwritten."
  },
  "theNewCheckoutSGitCommonDirectoryDoesNot": {
    "zh": "新建 checkout 的 Git common dir 不匹配",
    "en": "The new checkout's Git common directory does not match."
  },
  "worktreeCreationFailedAndTheRemainingDirectoryContainsUnknown": {
    "zh": "Worktree 创建失败且残余目录包含未知内容，已保留现场，请查看原因或改用新会话",
    "en": "Worktree creation failed and the remaining directory contains unknown content. The environment was preserved. Check the cause or use a new Session."
  },
  "worktreeCreationFailedTheRemainingDirectoryWasSafelyCleaned": {
    "zh": "Worktree 创建失败，已安全清理残余目录，可直接重试",
    "en": "Worktree creation failed. The remaining directory was safely cleaned up; you can retry."
  },
  "anIsolatedTargetRequiresASeparatePreallocatedSessionID": {
    "zh": "Isolated Target 必须使用独立的预分配 Session ID",
    "en": "An Isolated Target requires a separate preallocated Session ID."
  },
  "theTargetSessionIDIsAlreadyUsedByAnother": {
    "zh": "目标 Session ID 已被其他 Workspace 使用",
    "en": "The target Session ID is already used by another Workspace."
  },
  "aNewIsolatedTargetCanOnlyBeCreatedFrom": {
    "zh": "只能从 Local Session 创建新的 Isolated Target",
    "en": "A new Isolated Target can only be created from a Local Session."
  },
  "theIsolatedTargetRecordIsMissingAfterCreation": {
    "zh": "Isolated Target 创建后记录缺失",
    "en": "The Isolated Target record is missing after creation."
  },
  "gitExitedWithCode": {
    "zh": "git 命令退出码为 {p0}",
    "en": "git exited with code {p0}"
  },
  "gitCommandTimedOut": {
    "zh": "git 命令超时：{p0}",
    "en": "git command timed out: {p0}"
  },
  "theLocalBranchHasChangedPreviewCannotBeRolled": {
    "zh": "Local branch 已变化，不能自动撤回 Preview",
    "en": "The Local branch has changed. Preview cannot be rolled back automatically."
  },
  "localHEADIsNotASafeFastForwardFrom": {
    "zh": "Local HEAD 不是 Preview 基线的安全快进，不能自动撤回",
    "en": "Local HEAD is not a safe fast-forward from the Preview base. Automatic rollback is not allowed."
  },
  "newLocalCommitsConflictWithPrePreviewLocalChanges": {
    "zh": "Local 新提交与 Preview 前的本地修改冲突，无法安全撤回：{p0}",
    "en": "New Local commits conflict with pre-Preview local changes. Safe rollback is not possible: {p0}"
  },
  "newLocalCommitsConflictWithThePreviewTaskChanges": {
    "zh": "Local 新提交与 Preview 任务增量冲突，无法安全撤回：{p0}",
    "en": "New Local commits conflict with the Preview task changes. Safe rollback is not possible: {p0}"
  },
  "newLocalCommitsAlreadyContainSomeOrAllPreview": {
    "zh": "Local 新提交已经包含部分或全部 Preview 增量，不能通过撤回工作区改动来改写已提交历史",
    "en": "New Local commits already contain some or all Preview changes. Rolling back workspace changes cannot rewrite committed history."
  },
  "localHasAdditionalChangesInThePreviewAreaSafe": {
    "zh": "Local 在 Preview 区域出现额外修改，无法安全撤回：{p0}",
    "en": "Local has additional changes in the Preview area. Safe rollback is not possible: {p0}"
  },
  "localIsNotOnANormalBranchATask": {
    "zh": "Local 当前不是普通分支，不能自动创建任务提交",
    "en": "Local is not on a normal branch. A task commit cannot be created automatically."
  },
  "theLocalBranchHasChangedThePreviewCommitCannot": {
    "zh": "Local branch 已变化，不能完成 Preview 提交",
    "en": "The Local branch has changed. The Preview commit cannot be finalized."
  },
  "localHEADIsNotASafeFastForwardFrom281": {
    "zh": "Local HEAD 不是 Preview 基线的安全快进，不能完成 Preview 提交",
    "en": "Local HEAD is not a safe fast-forward from the Preview base. The Preview commit cannot be finalized."
  },
  "localHasAdditionalChangesInThePreviewAreaA": {
    "zh": "Local 在 Preview 区域出现额外修改，无法可靠提交：{p0}",
    "en": "Local has additional changes in the Preview area. A reliable commit is not possible: {p0}"
  },
  "previewTaskChangesCannotBeReliablySeparatedFromThe": {
    "zh": "Preview 任务增量无法与最新 Local HEAD 可靠拆分：{p0}",
    "en": "Preview task changes cannot be reliably separated from the latest Local HEAD: {p0}"
  },
  "previewTaskChangesAreAlreadyInLocalHEADNo": {
    "zh": "Preview 任务增量已经进入 Local HEAD；不会创建重复或空提交",
    "en": "Preview task changes are already in Local HEAD. No duplicate or empty commit will be created."
  },
  "thePreviewCommitCannotBeReliablySeparatedFromLocal": {
    "zh": "Preview 提交与 Local staged 修改无法可靠分离：{p0}",
    "en": "The Preview commit cannot be reliably separated from Local staged changes: {p0}"
  },
  "invalidCheckpointInput": {
    "zh": "Checkpoint 输入无效",
    "en": "Invalid Checkpoint input."
  },
  "theCheckpointProjectDirectoryDoesNotBelongToThe": {
    "zh": "Checkpoint 项目目录不属于当前 Worktree",
    "en": "The Checkpoint project directory does not belong to the current Worktree."
  },
  "checkpointCanOnlyWriteToADetachedManagedWorktree": {
    "zh": "Checkpoint 只允许写入 detached managed Worktree",
    "en": "Checkpoint can only write to a detached managed Worktree."
  },
  "worktreeChangedAfterPreparingTheReviewTheCheckpointCannot": {
    "zh": "Worktree 在准备验收后发生变化，不能保存阶段",
    "en": "Worktree changed after preparing the review. The checkpoint cannot be saved."
  },
  "worktreeContainsChangesOutsideTheProjectRootTheCheckpoint": {
    "zh": "Worktree 包含项目根目录外的变更，不能保存阶段",
    "en": "Worktree contains changes outside the project root. The checkpoint cannot be saved."
  },
  "theCurrentCheckpointHasNoNewChangesToSave": {
    "zh": "当前阶段没有可保存的新修改",
    "en": "The current checkpoint has no new changes to save."
  },
  "worktreeChangedBeforeSavingTheCheckpointPrepareTheReview": {
    "zh": "Worktree 在保存阶段前发生变化，请重新准备验收",
    "en": "Worktree changed before saving the checkpoint. Prepare the review again."
  },
  "checkpointIndexWriteFailedAndHEADCouldNotBe": {
    "zh": "Checkpoint index 写入失败且 HEAD 无法回滚：{p0}；{p1}",
    "en": "Checkpoint index write failed and HEAD could not be rolled back: {p0}; {p1}"
  },
  "checkpointWriteFailedAndWasRolledBack": {
    "zh": "Checkpoint 写入失败，已回滚：{p0}",
    "en": "Checkpoint write failed and was rolled back: {p0}"
  },
  "checkpointWasWrittenButWorktreeDidNotReachA": {
    "zh": "Checkpoint 已写入，但 Worktree 未收敛到 clean 状态",
    "en": "Checkpoint was written, but Worktree did not reach a clean state."
  },
  "cannotVerifyTheCheckpointAfterWritingTheEnvironmentMust": {
    "zh": "Checkpoint 写后无法完成验证，需要保留现场确认：{p0}",
    "en": "Cannot verify the Checkpoint after writing. The environment must be preserved for inspection: {p0}"
  },
  "anotherGitOperationIsUpdatingTheWorktreeIndexRetry": {
    "zh": "Worktree index 正在被其他 Git 操作更新，请重试",
    "en": "Another Git operation is updating the Worktree index. Retry later."
  },
  "invalidCheckpointRecoveryOID": {
    "zh": "Checkpoint 恢复 OID 无效",
    "en": "Invalid Checkpoint recovery OID."
  },
  "worktreeNoLongerHasADetachedHEAD": {
    "zh": "Worktree 已不再是 detached HEAD",
    "en": "Worktree no longer has a detached HEAD."
  },
  "cannotProveTheRemainingIndexLockBelongsToThe": {
    "zh": "遗留 index.lock 无法证明属于当前 Checkpoint，已保留现场",
    "en": "Cannot prove the remaining index.lock belongs to the current Checkpoint. The environment was preserved."
  },
  "worktreeHEADDoesNotMatchTheCheckpointBeingRecovered": {
    "zh": "Worktree HEAD 与待恢复 Checkpoint 不一致",
    "en": "Worktree HEAD does not match the Checkpoint being recovered."
  },
  "worktreeHasNewChangesAfterCheckpointInterruptionTheIndex": {
    "zh": "Worktree 在 Checkpoint 中断后出现新修改，不能自动恢复 index",
    "en": "Worktree has new changes after Checkpoint interruption. The index cannot be recovered automatically."
  },
  "theIndexHasNewStagedChangesAfterCheckpointInterruption": {
    "zh": "Checkpoint 中断后 index 出现新 staged 修改，不能自动覆盖",
    "en": "The index has new staged changes after Checkpoint interruption. Automatic overwrite is not allowed."
  },
  "theRemainingIndexLockDoesNotMatchTheCheckpoint": {
    "zh": "遗留 index.lock 与 Checkpoint 目标不一致，已保留现场",
    "en": "The remaining index.lock does not match the Checkpoint target. The environment was preserved."
  },
  "worktreeOrItsIndexChangedBeforeAcquiringTheCheckpoint": {
    "zh": "Checkpoint 恢复加锁前 Worktree 或 index 已变化",
    "en": "Worktree or its index changed before acquiring the Checkpoint recovery lock."
  },
  "worktreeIsStillNotCleanAfterCheckpointIndexRecovery": {
    "zh": "Checkpoint index 恢复后仍未收敛到 clean 状态",
    "en": "Worktree is still not clean after Checkpoint index recovery."
  },
  "invalidSessionBaseOIDFormat": {
    "zh": "Session Base OID 格式无效",
    "en": "Invalid Session Base OID format."
  },
  "localAndIsolatedDoNotBelongToTheSame": {
    "zh": "Local 与 Isolated 不属于同一 Git 仓库",
    "en": "Local and Isolated do not belong to the same Git repository."
  },
  "theLocalAndIsolatedProjectSubdirectoriesDoNotMatch": {
    "zh": "Local 与 Isolated 的项目子目录不一致",
    "en": "The Local and Isolated project subdirectories do not match."
  },
  "isolatedContainsChangesOutsideTheProjectRootAReview": {
    "zh": "Isolated 包含项目根目录外的变更，不能准备验收",
    "en": "Isolated contains changes outside the project root. A review cannot be prepared."
  },
  "isolatedContainsChangesOutsideTheProjectRootApplyWas": {
    "zh": "Isolated 包含项目根目录外的变更，已拒绝 Apply",
    "en": "Isolated contains changes outside the project root. Apply was rejected."
  },
  "theApplyPlanIsMissingAlreadyUsedOrModified": {
    "zh": "Apply plan 不存在、已使用或已被修改",
    "en": "The Apply plan is missing, already used, or modified."
  },
  "theApplyPlanSGitRepositoryIdentityHasChanged": {
    "zh": "Apply plan 的 Git 仓库身份已变化",
    "en": "The Apply plan's Git repository identity has changed."
  },
  "localChangedAfterPlanningRecalculateThePlan": {
    "zh": "Local 在 plan 后发生变化，请重新计算",
    "en": "Local changed after planning. Recalculate the plan."
  },
  "isolatedChangedAfterPlanningRecalculateThePlan": {
    "zh": "Isolated 在 plan 后发生变化，请重新计算",
    "en": "Isolated changed after planning. Recalculate the plan."
  },
  "localChangedBeforeApplyWroteItsChangesRecalculateThe": {
    "zh": "Local 在 Apply 写入前发生变化，请重新计算",
    "en": "Local changed before Apply wrote its changes. Recalculate the plan."
  },
  "thePreviewPlanIsMissingAlreadyUsedOrModified": {
    "zh": "Preview plan 不存在、已使用或已被修改",
    "en": "The Preview plan is missing, already used, or modified."
  },
  "invalidPreviewIdentity": {
    "zh": "Preview identity 无效",
    "en": "Invalid Preview identity."
  },
  "thePreviewPlanSGitRepositoryIdentityHasChanged": {
    "zh": "Preview plan 的 Git 仓库身份已变化",
    "en": "The Preview plan's Git repository identity has changed."
  },
  "thePersistentPreviewSnapshotDoesNotMatchTheReviewed": {
    "zh": "Preview 持久快照与审核 plan 不一致",
    "en": "The persistent Preview snapshot does not match the reviewed plan."
  },
  "localChangedBeforePreviewWroteItsChangesRecalculateThe": {
    "zh": "Local 在 Preview 写入前发生变化，请重新计算",
    "en": "Local changed before Preview wrote its changes. Recalculate the plan."
  },
  "theLocalSnapshotAfterPreviewDoesNotMatchThe": {
    "zh": "Preview 写入后的 Local snapshot 与准备结果不一致，需要恢复确认",
    "en": "The Local snapshot after Preview does not match the prepared result. Recovery confirmation is required."
  },
  "localChangedBeforePreviewRollbackRetry": {
    "zh": "Local 在撤回 Preview 前发生变化，请重试",
    "en": "Local changed before Preview rollback. Retry."
  },
  "cannotVerifyAfterWritingPreviewRollbackTheEnvironmentMust": {
    "zh": "Preview 撤回写后无法完成验证，需要保留现场确认：{p0}",
    "en": "Cannot verify after writing Preview rollback. The environment must be preserved for inspection: {p0}"
  },
  "theLocalSnapshotAfterPreviewRollbackDoesNotMatch": {
    "zh": "Preview 撤回后的 Local snapshot 与安全恢复结果不一致，需要保留现场确认",
    "en": "The Local snapshot after Preview rollback does not match the safe recovery result. The environment must be preserved for inspection."
  },
  "theCommitMessageMustNotBeEmpty": {
    "zh": "提交信息不能为空",
    "en": "The commit message must not be empty."
  },
  "localChangedBeforeFinalizingPreviewRetry": {
    "zh": "Local 在完成 Preview 前发生变化，请重试",
    "en": "Local changed before finalizing Preview. Retry."
  },
  "thePreviewTaskCommitTreeDoesNotMatchThe": {
    "zh": "Preview 任务提交 tree 与恢复评估不一致",
    "en": "The Preview task commit tree does not match the recovery assessment."
  },
  "thePreviewFinalIndexTreeDoesNotMatchThe": {
    "zh": "Preview 最终 index tree 与恢复评估不一致",
    "en": "The Preview final index tree does not match the recovery assessment."
  },
  "anotherGitOperationIsUpdatingTheLocalIndexRetry": {
    "zh": "Local index 正在被其他 Git 操作更新，请重试",
    "en": "Another Git operation is updating the Local index. Retry later."
  },
  "localChangedBeforeThePreviewCommitWasWrittenRetry": {
    "zh": "Local 在 Preview 提交写入前发生变化，请重试",
    "en": "Local changed before the Preview commit was written. Retry."
  },
  "previewCommitVerificationFailedAfterWriting": {
    "zh": "Preview 提交写后验证失败",
    "en": "Preview commit verification failed after writing."
  },
  "indexLocalIndexChangedAfterPreviewWroteItsChanges": {
    "zh": "index: Local index 在 Preview 写入后发生变化，拒绝覆盖并发 staged 状态",
    "en": "index: Local index changed after Preview wrote its changes. Concurrent staged state will not be overwritten."
  },
  "refVerifiableIndexCompensationEvidenceIsMissingPartialRollback": {
    "zh": "ref: 缺少可验证的 index 补偿证据，拒绝部分回滚",
    "en": "ref: Verifiable index compensation evidence is missing. Partial rollback was rejected."
  },
  "thePreviewCommitWriteCouldNotBeVerifiedAnd": {
    "zh": "Preview 提交写入未能验证，已完整回滚：{p0}",
    "en": "The Preview commit write could not be verified and was fully rolled back: {p0}"
  },
  "cannotProveSuccessOrCompleteRollbackAfterWritingThe": {
    "zh": "Preview 提交写入后无法证明成功或完整回滚，需要保留现场确认：{p0}{p1}",
    "en": "Cannot prove success or complete rollback after writing the Preview commit. The environment must be preserved for inspection: {p0}{p1}"
  },
  "theFinishPlanIsMissingAlreadyUsedOrModified": {
    "zh": "Finish plan 不存在、已使用或已被修改",
    "en": "The Finish plan is missing, already used, or modified."
  },
  "theFinishPlanSGitRepositoryIdentityHasChanged": {
    "zh": "Finish plan 的 Git 仓库身份已变化",
    "en": "The Finish plan's Git repository identity has changed."
  },
  "finishRevalidationFoundConflictsInconsistentWithTheReviewedPlan": {
    "zh": "Finish 复验得到与已审核 plan 不一致的冲突",
    "en": "Finish revalidation found conflicts inconsistent with the reviewed plan."
  },
  "theFileSetChangedDuringFinishRevalidation": {
    "zh": "Finish 复验的文件集合已变化",
    "en": "The file set changed during Finish revalidation."
  },
  "localChangedBeforeFinishRecalculateThePlan": {
    "zh": "Local 在 Finish 前发生变化，请重新计算",
    "en": "Local changed before Finish. Recalculate the plan."
  },
  "taskChangesCannotBeReliablySeparatedFromExistingLocal": {
    "zh": "任务增量无法与 Local 原有修改可靠拆分：{p0}",
    "en": "Task changes cannot be reliably separated from existing Local changes: {p0}"
  },
  "theTaskCommitCannotBeReliablySeparatedFromExisting": {
    "zh": "任务提交与 Local 原有 staged 修改无法可靠分离：{p0}",
    "en": "The task commit cannot be reliably separated from existing Local staged changes: {p0}"
  },
  "localChangedBeforeFinishWroteItsChangesRecalculateThe": {
    "zh": "Local 在 Finish 写入前发生变化，请重新计算",
    "en": "Local changed before Finish wrote its changes. Recalculate the plan."
  },
  "finishWriteFailedAndCompleteRollbackCouldNotBe": {
    "zh": "Finish 写入失败且无法证明完整回滚：{p0}；{p1}",
    "en": "Finish write failed and complete rollback could not be proven: {p0}; {p1}"
  },
  "finishWriteFailedAndWasRolledBack": {
    "zh": "Finish 写入失败，已回滚：{p0}",
    "en": "Finish write failed and was rolled back: {p0}"
  },
  "gitOperationFailed": {
    "zh": "Git 操作失败（{p0}）：{p1}",
    "en": "Git operation failed ({p0}): {p1}"
  },
  "unknownGitError": {
    "zh": "未知 Git 错误",
    "en": "Unknown Git error"
  },
  "worktreeToolsCanOnlyBeCalledInADSH": {
    "zh": "worktree 工具只能在 DSH Agent 会话中调用",
    "en": "Worktree tools can only be called in a DSH Agent Session."
  },
  "reserveAUniqueManagedGitWorktreeAndADistinct": {
    "zh": "预留一个唯一的托管 Git Worktree 及独立 owner Session ID。此操作不会改变当前会话 cwd。工具返回后，停止在此 Local 会话中修改代码，让用户从 Worktree 卡片打开隔离会话。",
    "en": "Reserve a unique managed Git worktree and a distinct owner Session ID. This does not change the current Session cwd. After the tool returns, stop modifying code in this Local Session and let the user open the isolated Session from the Worktree card."
  },
  "createIsolatedSessionTarget": {
    "zh": "创建隔离会话目标",
    "en": "Create isolated Session Target"
  },
  "listManagedWorktreesVisibleToTheCurrentSessionResults": {
    "zh": "列出当前会话可见的托管 Worktree。结果仅限原始项目内由此会话拥有或创建的 Worktree。",
    "en": "List managed worktrees visible to the current Session. Results are scoped to the original project and to worktrees this Session owns or created."
  },
  "listManagedWorktrees": {
    "zh": "列出托管 Worktree",
    "en": "List managed worktrees"
  },
  "whenTheCurrentIsolatedSessionIsReadyForReview": {
    "zh": "当前 Isolated Session 处于尚未同步 Local 的 Ready for Review，且用户提出新的代码或文件修改时，必须先自动调用本工具使旧 Review 失效并恢复同一轮 Working，然后直接继续执行请求。纯讨论、问答或补充信息不要调用；不要要求用户点击恢复编辑，也不要先同步 Local。",
    "en": "When the current Isolated Session is Ready for Review but not yet synced to Local, and the user requests new code or file changes, automatically call this tool first to invalidate the old Review and resume Working in the same iteration, then continue the request directly. Do not call it for discussion, questions, or additional information. Do not ask the user to click resume editing or sync Local first."
  },
  "theCurrentWorktreeHasNoUnsyncedReviewToResume372": {
    "zh": "当前 Worktree 没有可恢复的未同步 Review: {p0}",
    "en": "The current Worktree has no unsynced Review to resume: {p0}"
  },
  "worktreeDidNotReturnToWorkingState": {
    "zh": "Worktree 未恢复到 working 状态: {p0}",
    "en": "Worktree did not return to working state: {p0}"
  },
  "resumeWorktreeRevision": {
    "zh": "恢复 Worktree 编辑",
    "en": "Resume Worktree revision"
  },
  "whenTheCurrentIsolatedSessionHasBeenDeliveredAnd": {
    "zh": "当当前 Isolated Session 已交付并完成 cleanup，而用户在同一对话中提出新的代码或文件修改时，先调用本工具安全重建同一个 immutable cwd 并进入下一轮，然后继续执行用户请求。不要改用 worktree_create；retained 或 cleanup_pending 状态不能调用。",
    "en": "When the current Isolated Session has been delivered and cleanup is complete, and the user requests new code or file changes in the same conversation, call this tool first to safely recreate the same immutable cwd and begin the next iteration, then continue the request. Do not use worktree_create instead. Do not call this tool in retained or cleanup_pending state."
  },
  "theNextWorktreeIterationDidNotEnterWorkingState": {
    "zh": "下一轮 Worktree 未进入 working 状态: {p0}",
    "en": "The next Worktree iteration did not enter working state: {p0}"
  },
  "startNextWorktreeIteration": {
    "zh": "开始下一轮 Worktree",
    "en": "Start next Worktree iteration"
  },
  "onlyForWorktreeSessionsThatHaveAlreadySelectedAn": {
    "zh": "仅用于已经选择 Isolated Checkout 的 Worktree Session，普通 Local Checkout 任务必须用正常助手回复结束且不得调用本工具。它是 Isolated Session 的最后一个模型动作：把完整交付报告、验证证据和建议 Commit Message 仅写入本工具参数，然后立即停止。不要在调用前后用普通回复重复完整报告；最多用一句话提示用户通过底部验收条处理。用户会显式决定是否提交或放弃，模型不得自动提交或清理。",
    "en": "Only for Worktree Sessions that have already selected an Isolated Checkout. Ordinary Local Checkout tasks must end with a normal assistant reply and must not call this tool. This is the Isolated Session's final model action: put the complete delivery report, validation evidence, and suggested commit message only in this tool's arguments, then stop immediately. Do not repeat the complete report in normal replies before or after calling it; at most one sentence may direct the user to the bottom acceptance bar. The user explicitly decides whether to commit or discard. The model must not automatically commit or clean up."
  },
  "oneLineSummaryOfTheChangeMax240Chars": {
    "zh": "一句话描述改动（最多 240 个字符）。",
    "en": "One-line summary of the change (max 240 chars)."
  },
  "optionalFullMarkdownDetailsMax12000Chars": {
    "zh": "可选的完整 Markdown 详情（最多 12000 个字符）。",
    "en": "Optional full Markdown details (max 12000 chars)."
  },
  "optionalOneLineValidationOutcome": {
    "zh": "可选的一句话验证结果。",
    "en": "Optional one-line validation outcome."
  },
  "suggestedCommitMessageForTheHumanAcceptanceAction": {
    "zh": "建议用于人工验收操作的提交信息。",
    "en": "Suggested commit message for the human acceptance action."
  },
  "worktreeDidNotEnterAReviewableState": {
    "zh": "worktree 未进入可验收状态: {p0}",
    "en": "Worktree did not enter a reviewable state: {p0}"
  },
  "readyForWorktreeReview": {
    "zh": "提交 Worktree 验收",
    "en": "Ready for Worktree review"
  },
  "checkoutPhase": {
    "zh": "检出：{p0}（{p1}，阶段 {p2}）",
    "en": "checkout: {p0} ({p1}, phase {p2})"
  },
  "worktreeCanOnlyBeUsedInADSHAgent": {
    "zh": "`/worktree` 只能在 DSH Agent 会话中使用",
    "en": "`/worktree` can only be used in a DSH Agent Session."
  },
  "usageWorktreeStatusListContinueNextFinalizeReviewIdRevision": {
    "zh": "用法：/worktree status | list | continue | next | finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual] | finish <message> | discard | remove <checkoutId>",
    "en": "Usage: /worktree status | list | continue | next | finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual] | finish <message> | discard | remove <checkoutId>"
  },
  "finishedCommittedFileSAsCleanup": {
    "zh": "已完成：{p0} 个文件已提交为 {p1}（清理：{p2}）。",
    "en": "Finished: committed {p0} file(s) as {p1} (cleanup: {p2})."
  },
  "inspectAndExplicitlyAcceptManagedWorktreeDelivery": {
    "zh": "查看并明确确认托管 Worktree 交付",
    "en": "inspect and explicitly accept managed worktree delivery"
  },
  "statusListContinueNextFinalizeRetentionFinishMessageDiscard": {
    "zh": "status（状态）| list（列表）| continue（继续修改）| next（下一轮）| finalize [retention]（验收提交）| finish <message>（直接提交）| discard（丢弃）| remove <checkoutId>（移除）",
    "en": "status | list | continue | next | finalize [retention] | finish <message> | discard | remove <checkoutId>"
  },
  "noManagedWorktreesVisibleToThisSession": {
    "zh": "当前会话没有可见的托管 Worktree。",
    "en": "No managed worktrees visible to this Session."
  },
  "theCurrentWorktreeHasNoUnsyncedReadyForReview": {
    "zh": "当前 Worktree 没有尚未同步的 Ready for Review 验收稿。",
    "en": "The current Worktree has no unsynced Ready for Review draft."
  },
  "resumedWorktreeIterationLocalWasNotModified": {
    "zh": "已恢复 Worktree 第 {p0} 轮；未修改 Local。",
    "en": "Resumed Worktree iteration {p0}; Local was not modified."
  },
  "startedWorktreeIterationInTheCurrentSession": {
    "zh": "已在当前会话开始 Worktree 第 {p0} 轮。",
    "en": "Started Worktree iteration {p0} in the current Session."
  },
  "theCurrentWorktreeIsNotReadyForReviewAnd": {
    "zh": "当前 Worktree 尚未 Ready for Review，不能 finalize。",
    "en": "The current Worktree is not Ready for Review and cannot be finalized."
  },
  "thisReviewCardHasExpiredConfirmTheLatestReady": {
    "zh": "该验收卡已过期；请确认会话中的最新 Ready for Review 卡片。",
    "en": "This review card has expired. Confirm the latest Ready for Review card in the Session."
  },
  "conflictNLocalHEADSyncAndResolveConflictsInWorktree": {
    "zh": "Conflict: {p0}\nLocal HEAD: {p1} — 在 Worktree 内同步并解决后重新 Ready。",
    "en": "Conflict: {p0}\\nLocal HEAD: {p1} — Sync and resolve conflicts in Worktree, then mark it Ready again."
  },
  "finalizeDidNotReturnTheExpectedResult": {
    "zh": "Finalize 未返回预期结果",
    "en": "Finalize did not return the expected result."
  },
  "finishDidNotReturnTheExpectedResult": {
    "zh": "Finish 未返回预期结果",
    "en": "Finish did not return the expected result."
  },
  "worktreeDiscardedThisSessionTargetIsNoLongerAvailable": {
    "zh": "Worktree 已丢弃。此会话目标不再可用。",
    "en": "Worktree discarded. This Session target is no longer available."
  },
  "discardDidNotReturnTheExpectedResult": {
    "zh": "Discard 未返回预期结果",
    "en": "Discard did not return the expected result."
  },
  "noManagedWorktreeVisibleToThisSession": {
    "zh": "当前会话没有可见的托管 Worktree {p0}。",
    "en": "No managed worktree {p0} visible to this Session."
  },
  "removedWorktree": {
    "zh": "已移除 Worktree {p0}。",
    "en": "Removed worktree {p0}."
  },
  "unknownVerb": {
    "zh": "未知操作 {p0}。\\n{p1}",
    "en": "Unknown verb {p0}.\n{p1}"
  },
  "conflictRecoveryIsMissingAValidLocalHEADIdentity": {
    "zh": "冲突恢复缺少有效的 Local HEAD 身份",
    "en": "Conflict recovery is missing a valid Local HEAD identity."
  },
  "conflictRecoveryContainsUnsafeOrOutOfBoundsFile": {
    "zh": "冲突恢复包含不安全或越界的文件身份",
    "en": "Conflict recovery contains unsafe or out-of-bounds file identities."
  },
  "theCurrentSessionCheckoutModuleDoesNotSupportAcceptancePreflight": {
    "zh": "当前 SessionCheckoutModule 不支持验收预检",
    "en": "The current SessionCheckoutModule does not support acceptance preflight."
  },
  "theCurrentSessionDoesNotExist": {
    "zh": "当前 Session 不存在",
    "en": "The current Session does not exist."
  },
  "theCurrentSessionIsNotAssociatedWithAProject": {
    "zh": "当前 Session 尚未关联项目",
    "en": "The current Session is not associated with a project."
  },
  "theCurrentSessionSProjectDoesNotExist": {
    "zh": "当前 Session 项目不存在",
    "en": "The current Session's project does not exist."
  },
  "theCurrentSessionSProjectDirectoryDoesNotExist": {
    "zh": "当前 Session 项目目录不存在",
    "en": "The current Session's project directory does not exist."
  },
  "theCurrentSessionSProjectIsNotAnAvailable": {
    "zh": "当前 Session 项目不是可用的 Git Worktree",
    "en": "The current Session's project is not an available Git Worktree."
  },
  "theCurrentSessionWorkspaceCannotBeProvenToBelong": {
    "zh": "当前 Session Workspace 无法证明属于该 Worktree 的原始项目",
    "en": "The current Session Workspace cannot be proven to belong to this Worktree's original project."
  },
  "theCurrentSessionCwdDoesNotMatchTheWorktree": {
    "zh": "当前 Session cwd 与 Worktree 授权边界不一致",
    "en": "The current Session cwd does not match the Worktree authorization boundary."
  },
  "theCurrentSessionIsNotAllowedToAccessThis": {
    "zh": "当前 Session 无权访问该 Worktree",
    "en": "The current Session is not allowed to access this Worktree."
  },
  "worktreeDoesNotMatchTheCurrentSessionSProject": {
    "zh": "Worktree 与当前 Session 项目不一致",
    "en": "Worktree does not match the current Session's project."
  },
  "theAssociatedWorktreeSOwnerSessionIsUnavailable": {
    "zh": "关联 Worktree 的 owner Session 不可用",
    "en": "The associated Worktree's owner Session is unavailable."
  },
  "theAcceptanceSlotHolderHasChangedCheckAgain": {
    "zh": "验收槽位占用者已变化，请重新检查",
    "en": "The acceptance slot holder has changed. Check again."
  },
  "theWorktreeGitIdentityCannotBeVerified": {
    "zh": "Worktree Git 身份无法验证",
    "en": "The Worktree Git identity cannot be verified."
  },
  "theCurrentSessionWorkspaceCannotBeProvenToBe": {
    "zh": "当前 Session Workspace 无法证明关联 Worktree 项目",
    "en": "The current Session Workspace cannot be proven to be associated with the Worktree project."
  },
  "hostIdentityVerificationFailedForTheNewlyCreatedWorktree": {
    "zh": "新建 Worktree 的 Host 身份校验失败",
    "en": "Host identity verification failed for the newly created Worktree."
  },
  "onlyTheOwnerIsolatedSessionCanReadTheReview": {
    "zh": "只有 owner Isolated Session 可以读取验收 Diff",
    "en": "Only the owner Isolated Session can read the review Diff."
  },
  "theSessionTargetHasChangedRefresh": {
    "zh": "Session Target 已变化，请刷新",
    "en": "The Session Target has changed. Refresh."
  },
  "theReviewIdentityHasChangedRefresh": {
    "zh": "Review 身份已变化，请刷新",
    "en": "The Review identity has changed. Refresh."
  },
  "isolatedHEADChangedAfterReady": {
    "zh": "Ready 后 Isolated HEAD 已变化",
    "en": "Isolated HEAD changed after Ready."
  },
  "isolatedContentChangedAfterReadyDiffBytesWereDiscarded": {
    "zh": "Ready 后 Isolated 内容已变化，Diff bytes 已丢弃",
    "en": "Isolated content changed after Ready. Diff bytes were discarded."
  },
  "onlyTheOwnerIsolatedSessionCanRunSyncPreflight436": {
    "zh": "只有 owner Isolated Session 可以执行同步预检",
    "en": "Only the owner Isolated Session can run sync preflight."
  },
  "onlyTheOwnerIsolatedSessionCanCheckPreviewRecovery440": {
    "zh": "只有 owner Isolated Session 可以检查 Preview 恢复",
    "en": "Only the owner Isolated Session can check Preview recovery."
  },
  "theDetachedPreviewIdentityHasChangedRefresh": {
    "zh": "Detached Preview 身份已变化，请刷新",
    "en": "The Detached Preview identity has changed. Refresh."
  },
  "theCurrentSessionCheckoutModuleDoesNotSupportPreviewRecoveryPreflight": {
    "zh": "当前 SessionCheckoutModule 不支持 Preview Recovery 预检",
    "en": "The current SessionCheckoutModule does not support Preview Recovery preflight."
  },
  "thePreviewRecoveryAnalysisIdentityDoesNotMatch": {
    "zh": "Preview Recovery 分析身份不匹配",
    "en": "The Preview Recovery analysis identity does not match."
  },
  "thePreviewRecoveryHandoffIdentityDoesNotMatch": {
    "zh": "Preview Recovery handoff 身份不匹配",
    "en": "The Preview Recovery handoff identity does not match."
  },
  "hostIdentityVerificationFailedForTheRecoveryHandoffWorktree": {
    "zh": "Recovery handoff Worktree 的 Host 身份校验失败",
    "en": "Host identity verification failed for the Recovery handoff Worktree."
  },
  "onlyTheOwnerIsolatedSessionCanSaveACheckpoint447": {
    "zh": "只有 owner Isolated Session 可以保存阶段",
    "en": "Only the owner Isolated Session can save a checkpoint."
  },
  "theCheckpointCommitMessageOrRequestIdIsInvalid": {
    "zh": "Checkpoint Commit Message 或 requestId 无效",
    "en": "The Checkpoint commit message or requestId is invalid."
  },
  "checkpointReturnedAnUnexpectedState": {
    "zh": "Checkpoint 返回了非预期状态",
    "en": "Checkpoint returned an unexpected state."
  },
  "worktreeDidNotReturnToWorkingAfterCheckpoint": {
    "zh": "Checkpoint 后 Worktree 状态未收敛到 Working",
    "en": "Worktree did not return to Working after Checkpoint."
  },
  "onlyTheOwnerIsolatedSessionCanPreviewChanges": {
    "zh": "只有 owner Isolated Session 可以预览修改",
    "en": "Only the owner Isolated Session can preview changes."
  },
  "localPreviewPreflightFoundContentConflicts": {
    "zh": "Local Preview 预检发现内容冲突",
    "en": "Local Preview preflight found content conflicts."
  },
  "previewReturnedAnUnexpectedState": {
    "zh": "Preview 返回了非预期状态",
    "en": "Preview returned an unexpected state."
  },
  "onlyTheOwnerIsolatedSessionCanResumeEditing456": {
    "zh": "只有 owner Isolated Session 可以继续修改",
    "en": "Only the owner Isolated Session can resume editing."
  },
  "invalidConflictRecoveryRequestIdentity": {
    "zh": "冲突恢复请求身份无效",
    "en": "Invalid conflict recovery request identity."
  },
  "theWorktreeIdentityOrStateDoesNotMatchAfter": {
    "zh": "恢复编辑后 Worktree 身份或状态不一致",
    "en": "The Worktree identity or state does not match after resuming editing."
  },
  "theHostCouldNotPersistTheExactConflictRecovery": {
    "zh": "Host 未能持久化精确冲突恢复凭证",
    "en": "The Host could not persist the exact conflict recovery receipt."
  },
  "onlyTheOwnerIsolatedSessionCanRequestReviewRegeneration462": {
    "zh": "只有 owner Isolated Session 可以请求重新生成验收结果",
    "en": "Only the owner Isolated Session can request review regeneration."
  },
  "onlyTheOwnerIsolatedSessionCanRollBackLocal": {
    "zh": "只有 owner Isolated Session 可以撤回 Local Preview",
    "en": "Only the owner Isolated Session can roll back Local Preview."
  },
  "rollbackPreviewReturnedAnUnexpectedState": {
    "zh": "Rollback Preview 返回了非预期状态",
    "en": "Rollback Preview returned an unexpected state."
  },
  "theOwnerSessionHasTakenOverThisWorktreeOnly467": {
    "zh": "Owner Session 已接管该 Worktree，只有 owner 可以 Discard",
    "en": "The owner Session has taken over this Worktree. Only the owner can Discard it."
  },
  "discardReturnedAnUnexpectedState": {
    "zh": "Discard 返回了非预期状态",
    "en": "Discard returned an unexpected state."
  },
  "onlyTheOwnerIsolatedSessionCanCommitAcceptance": {
    "zh": "只有 owner Isolated Session 可以提交验收",
    "en": "Only the owner Isolated Session can commit acceptance."
  },
  "theCommitMessageMustContain1500Characters": {
    "zh": "Commit Message 必须为 1–500 个字符",
    "en": "The commit message must contain 1–500 characters."
  },
  "applyingToLocalCausedConflicts": {
    "zh": "Local 应用发生冲突",
    "en": "Applying to Local caused conflicts."
  },
  "finalizeReturnedAnUnexpectedState": {
    "zh": "Finalize 返回了非预期状态",
    "en": "Finalize returned an unexpected state."
  },
  "onlyTheOwnerIsolatedSessionCanFinalizeLocalPreview": {
    "zh": "只有 owner Isolated Session 可以完成 Local Preview 验收",
    "en": "Only the owner Isolated Session can finalize Local Preview acceptance."
  },
  "finalizePreviewReturnedAnUnexpectedState": {
    "zh": "Finalize Preview 返回了非预期状态",
    "en": "Finalize Preview returned an unexpected state."
  },
  "theNextWorktreeIterationDidNotEnterWorkingState484": {
    "zh": "下一轮 Worktree 未进入 working 状态",
    "en": "The next Worktree iteration did not enter working state."
  },
  "theNextIterationSWorktreeLineageOrCwdIdentity": {
    "zh": "下一轮 Worktree 的 lineage 或 cwd 身份不一致",
    "en": "The next iteration's Worktree lineage or cwd identity does not match."
  },
  "gitFailed": {
    "zh": "git {p0} 失败（{p1}）：{p2}",
    "en": "git {p0} failed ({p1}): {p2}"
  },
  "reviewChangedFilesContainsAnUnsafeProjectRelativePath": {
    "zh": "验收 changedFiles 包含不安全的项目相对路径。",
    "en": "review changedFiles contains an unsafe project-relative path"
  },
  "reviewDiffPathInventoryExceedsTheSafeReadBudget": {
    "zh": "验收 Diff 路径清单超出安全读取额度。",
    "en": "review diff path inventory exceeds the safe read budget"
  },
  "gitDiffReturnedAnUnsafeProjectRelativePath": {
    "zh": "git diff 返回了不安全的项目相对路径。",
    "en": "git diff returned an unsafe project-relative path"
  },
  "reviewChangedFilesNoLongerMatchesTheIsolatedSnapshot": {
    "zh": "验收 changedFiles 不再匹配隔离快照。",
    "en": "review changedFiles no longer matches the isolated snapshot"
  },
  "worktreeConsoleOperationFailed": {
    "zh": "Worktree Console 操作失败",
    "en": "Worktree Console operation failed."
  },
  "theWorktreeQuarantinePathIsInvalidOrAlreadyOccupied": {
    "zh": "Worktree quarantine 路径无效或已被占用",
    "en": "The Worktree quarantine path is invalid or already occupied."
  },
  "theWorktreeDirectoryObjectWasReplacedRecursiveCleanupWas": {
    "zh": "Worktree 目录对象已被替换，未执行递归清理",
    "en": "The Worktree directory object was replaced. Recursive cleanup was not performed."
  },
  "refusingToDeleteWorktreeResidueThatIsNotA": {
    "zh": "拒绝删除非目录或符号链接形式的 Worktree 残余",
    "en": "Refusing to delete Worktree residue that is not a directory or is a symbolic link."
  },
  "gitTimedOutMsAndWasTerminated": {
    "zh": "git {p0} 超时（{p1}ms），已终止",
    "en": "git {p0} timed out ({p1}ms) and was terminated."
  },
  "gitOperationFailedGit": {
    "zh": "Git 操作失败: git {p0}{p1}",
    "en": "Git operation failed: git {p0}{p1}"
  },
  "invalidInternalGitArtifactName": {
    "zh": "内部 Git artifact 名称无效",
    "en": "Invalid internal Git artifact name."
  },
  "cannotReadTheInternalGitArtifact": {
    "zh": "无法读取内部 Git artifact",
    "en": "Cannot read the internal Git artifact."
  },
  "cannotProveGitCommitAncestry": {
    "zh": "无法证明 Git commit ancestry",
    "en": "Cannot prove Git commit ancestry."
  },
  "managedCheckoutsJsonIsCorruptCheckoutAccessHasStopped": {
    "zh": "managed-checkouts.json 损坏，已停止访问 checkout",
    "en": "managed-checkouts.json is corrupt. Checkout access has stopped."
  },
  "commandDirty": {
    "zh": "有未提交修改：{value}",
    "en": "dirty: {value}"
  },
  "commandCurrent": {
    "zh": "当前：{branch} @ {oid}",
    "en": "current: {branch} @ {oid}"
  },
  "commandDelivery": {
    "zh": "交付：{state}",
    "en": "delivery: {state}"
  },
  "commandDetached": {
    "zh": "分离 HEAD",
    "en": "detached"
  },
  "commandNoOp": {
    "zh": "无新增提交",
    "en": "no-op"
  },
  "cleanupIdentityChanged": {
    "zh": "Worktree 的 Git 身份或路径已变化，未执行清理。",
    "en": "The Worktree Git identity or path has changed. Cleanup was not performed."
  },
  "cleanupResidue": {
    "zh": "Git Worktree 已解除注册，仅剩物理目录残余；可重试清理环境。",
    "en": "Git Worktree has been unregistered; only directory residue remains. Environment cleanup can be retried."
  },
  "cleanupIncompleteDelivery": {
    "zh": "Worktree 交付状态不完整，未执行清理。",
    "en": "The Worktree delivery state is incomplete. Cleanup was not performed."
  },
  "cleanupIncompleteReceipt": {
    "zh": "Worktree cleanup receipt 不完整",
    "en": "The Worktree cleanup receipt is incomplete."
  },
  "cleanupMissingBeforeQuarantine": {
    "zh": "Worktree 记录在 quarantine 前丢失",
    "en": "The Worktree record was lost before quarantine."
  },
  "cleanupQuarantineIdentity": {
    "zh": "Worktree quarantine 身份无法验证",
    "en": "The Worktree quarantine identity cannot be verified."
  },
  "cleanupNewChanges": {
    "zh": "Worktree 在提交后出现了新修改，未执行清理。",
    "en": "Worktree has new changes after the commit. Cleanup was not performed."
  },
  "cleanupMissingBeforeRemoval": {
    "zh": "Worktree 记录在清理前丢失，未执行清理。",
    "en": "The Worktree record was lost before cleanup. Cleanup was not performed."
  },
  "cleanupQuarantineBusy": {
    "zh": "Worktree 已安全移入 quarantine，但目录仍被进程占用；dsh-git-worktree 会在同一清理授权内有限重试。",
    "en": "Worktree was safely moved into quarantine, but a process still holds the directory. dsh-git-worktree will retry a limited number of times under the same cleanup authorization."
  },
  "cleanupDirectoryBusy": {
    "zh": "Worktree 目录仍被进程占用或 Windows 暂时拒绝删除；dsh-git-worktree 已完成有限重试，可稍后重试清理。",
    "en": "A process still holds the Worktree directory or Windows temporarily denied deletion. dsh-git-worktree has completed its limited retries. Retry cleanup later."
  },
  "commandConflict": {
    "zh": "冲突：{files}",
    "en": "Conflict: {files}"
  },
  "localCheckout": {
    "zh": "本地检出",
    "en": "Local Checkout"
  },
  "isolatedCheckout": {
    "zh": "隔离检出",
    "en": "Isolated Checkout"
  },
  "cleanupTimeout": {
    "zh": "[session-checkout] {p0} 清理超时（{p1}ms），已跳过本次收敛",
    "en": "[session-checkout] Cleanup of {p0} timed out ({p1}ms); skipped this reconciliation."
  },
  "checkpointRefCleanupFailed": {
    "zh": "[session-checkout] 清理未生效 Checkpoint ref 失败，已保守保留不可见引用",
    "en": "[session-checkout] Failed to clean up the unapplied Checkpoint ref; conservatively retained the hidden ref."
  },
  "tempDirectoryCleanupFailed": {
    "zh": "[session-checkout-apply] 临时目录清理失败：",
    "en": "[session-checkout-apply] Failed to clean up the temporary directory:"
  },
  "corruptPrimaryIndex": {
    "zh": "[数据恢复] 主索引文件损坏: {p0}",
    "en": "[Data recovery] Primary index file is corrupt: {p0}"
  },
  "recoveredFromTmp": {
    "zh": "[数据恢复] 从 .tmp 文件恢复: {p0}",
    "en": "[Data recovery] Recovered from .tmp file: {p0}"
  },
  "recoveredFromBak": {
    "zh": "[数据恢复] 从 .bak 文件恢复: {p0}",
    "en": "[Data recovery] Recovered from .bak file: {p0}"
  },
  "corruptBackupIndex": {
    "zh": "[数据恢复] .bak 文件也损坏: {p0}",
    "en": "[Data recovery] The .bak file is also corrupt: {p0}"
  },
  "previewRefsCleanupFailed": {
    "zh": "[session-checkout] 清理 Preview refs 失败，已保守保留不可见引用",
    "en": "[session-checkout] Failed to clean up Preview refs; conservatively retained the hidden refs."
  },
  "internalRefsCleanupFailed": {
    "zh": "[session-checkout] 清理内部 Session Checkout refs 失败，已保守保留不可见引用",
    "en": "[session-checkout] Failed to clean up internal Session Checkout refs; conservatively retained the hidden refs."
  }

} as const satisfies MessageCatalog

/** Registration metadata is shared between sessions, so expose both languages. */
export function hostRegistrationMessage(key: keyof typeof hostMessages): string {
  return hostMessages[key].zh + ' / ' + hostMessages[key].en
}

/**
 * These exact legacy messages are persisted and used by cleanup recovery discriminants.
 * Keep their stored values unchanged; localize only their public projection.
 * This finite allowlist never interprets or rewrites third-party error text.
 */
const persistedCleanupKeys = ["cleanupIdentityChanged","cleanupResidue","cleanupIncompleteDelivery","cleanupIncompleteReceipt","cleanupMissingBeforeQuarantine","cleanupQuarantineIdentity","cleanupNewChanges","cleanupMissingBeforeRemoval","cleanupQuarantineBusy","cleanupDirectoryBusy"] as const

export function hostPersistedCleanupMessage(message: string, translate: Translator<typeof hostMessages>): string {
  const key = persistedCleanupKeys.find(key => hostMessages[key].zh === message)
  return key ? translate(key) : message
}
