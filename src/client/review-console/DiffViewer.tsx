import { useCallback, useEffect, useId, useState } from 'react'
import type { WorktreeConsoleAdapter, WorktreeConsoleDiffFile, WorktreeConsoleError } from '../../console-contract.js'
import { worktreeConsoleErrorMeta } from '../../console-contract.js'
import type { WorktreeReviewIdentity } from './WorktreeReviewPanel.js'
import { useReviewDiff } from './useReviewDiff.js'

interface DiffViewerProps {
  adapter: WorktreeConsoleAdapter
  identity: WorktreeReviewIdentity
  disabled: boolean
  onStale: (error: WorktreeConsoleError) => void
}

function fileAccessibleName(file: WorktreeConsoleDiffFile): string {
  return file.status === 'renamed' && file.previousPath
    ? `${file.status} ${file.previousPath} to ${file.path}`
    : `${file.status} ${file.path}`
}

function FilePatch({ file }: { file: WorktreeConsoleDiffFile }) {
  if (file.status === 'binary' || file.patch === null) {
    return <p className="dsh-wt-diff-empty">Binary file — patch is not available.</p>
  }
  return (
    <div className="dsh-wt-diff-patch-wrap">
      {file.truncated ? <p className="dsh-wt-warning">This file patch was truncated.</p> : null}
      <pre className="dsh-wt-diff-patch" tabIndex={0}>{file.patch}</pre>
    </div>
  )
}

export function DiffViewer({ adapter, identity, disabled, onStale }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const regionId = useId()
  const stableOnStale = useCallback((error: WorktreeConsoleError) => onStale(error), [onStale])
  const { state, load, retry } = useReviewDiff(adapter, identity, stableOnStale)

  useEffect(() => {
    if (state.status === 'loaded' && selectedPath === null) {
      setSelectedPath(state.value.files[0]?.path ?? null)
    }
  }, [selectedPath, state])

  const toggle = (): void => {
    const next = !expanded
    setExpanded(next)
    if (next) void load()
  }

  const retryLoad = (): void => {
    retry()
    queueMicrotask(() => void load())
  }

  const selected = state.status === 'loaded'
    ? state.value.files.find((file) => file.path === selectedPath) ?? state.value.files[0] ?? null
    : null

  return (
    <section className="dsh-wt-review-section" aria-labelledby={`${regionId}-title`}>
      <div className="dsh-wt-review-section-head">
        <h3 id={`${regionId}-title`} className="dsh-wt-review-heading">Unified diff</h3>
        <button
          type="button"
          className="dsh-wt-button"
          aria-expanded={expanded}
          aria-controls={regionId}
          disabled={disabled}
          onClick={toggle}
        >
          {expanded ? 'Hide diff' : 'Show diff'}
        </button>
      </div>
      {expanded ? (
        <div id={regionId} className="dsh-wt-diff" aria-live="polite">
          {state.status === 'idle' ? <button type="button" className="dsh-wt-button" onClick={() => void load()}>Load diff</button> : null}
          {state.status === 'loading' ? <p className="dsh-wt-status">Loading review-bound diff…</p> : null}
          {state.status === 'error' ? (
            <div className="dsh-wt-error" role="alert">
              <p>{state.error.message}</p>
              <p>Category: {worktreeConsoleErrorMeta(state.error.code).category}. Recovery: {worktreeConsoleErrorMeta(state.error.code).recovery}.</p>
              {!disabled && worktreeConsoleErrorMeta(state.error.code).retryable
                ? <button type="button" className="dsh-wt-button" onClick={retryLoad}>Retry diff</button>
                : null}
            </div>
          ) : null}
          {state.status === 'loaded' ? (
            <>
              {state.value.truncated ? <p className="dsh-wt-warning">Diff response was truncated by the total payload limit.</p> : null}
              {state.value.files.length === 0 ? <p className="dsh-wt-status">No diff files were returned.</p> : (
                <div className="dsh-wt-diff-layout">
                  <div className="dsh-wt-diff-files" role="list" aria-label={`${state.value.files.length} diff files`}>
                    {state.value.files.map((file, index) => (
                      <div role="listitem" key={`${file.path}-${index}`}>
                        <button
                          type="button"
                          className="dsh-wt-diff-file"
                          data-status={file.status}
                          aria-label={fileAccessibleName(file)}
                          aria-pressed={selected?.path === file.path}
                          onClick={() => setSelectedPath(file.path)}
                        >
                          <span className="dsh-wt-diff-status">{file.status}</span>
                          <span className="dsh-wt-diff-path dsh-wt-code">
                            {file.status === 'renamed' && file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                          </span>
                          {file.truncated ? <span className="dsh-wt-diff-truncated">truncated</span> : null}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="dsh-wt-diff-view" aria-label="Selected file patch">
                    {selected ? <FilePatch file={selected} /> : null}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
