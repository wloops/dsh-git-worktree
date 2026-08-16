// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorktreeReviewRow } from '../src/client/WorktreeReviewRow.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { WorktreeReviewPanel, type WorktreeReviewEvidence } from '../src/client/review-console/WorktreeReviewPanel.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

afterEach(() => cleanup())

function review(overrides: Partial<WorktreeReviewEvidence> = {}): WorktreeReviewEvidence {
  return {
    reviewId: 'review-1',
    revision: 7,
    iteration: 1,
    preparedAt: 1,
    summary: 'Review summary',
    validationStatus: 'passed',
    validationSummary: 'Focused validation passed',
    tests: [
      { command: 'pnpm test', status: 'passed', summary: 'All tests passed' },
      { command: 'pnpm run typecheck', status: 'not_run', summary: 'Not required yet' },
    ],
    changedFiles: ['src/client/review-console/WorktreeReviewPanel.tsx'],
    suggestedCommitMessage: 'feat(review): add Worktree Review UI',
    detailsMarkdown: '# Delivery\n\nNo raw HTML is rendered.',
    ...overrides,
  }
}

describe('WorktreeReviewPanel', () => {
  test('renders persisted review summary, validation evidence, changed files, commit message, and details as text', () => {
    const evidence = review({ detailsMarkdown: '<img src=x onerror=alert(1)>\n\n**plain markdown source**' })
    const { container } = render(<WorktreeReviewPanel review={evidence} />)

    expect(screen.getByText('Review summary')).toBeTruthy()
    expect(screen.getAllByText('passed')).toHaveLength(2)
    expect(screen.getByText('Focused validation passed')).toBeTruthy()
    expect(screen.getByText('pnpm test')).toBeTruthy()
    expect(screen.getByText('All tests passed')).toBeTruthy()
    expect(screen.getByText('src/client/review-console/WorktreeReviewPanel.tsx')).toBeTruthy()
    expect(screen.getByText('feat(review): add Worktree Review UI')).toBeTruthy()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  test('fails closed before effects when the live target no longer matches the review identity', () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const staleTarget = { ...fixture.target, revision: 8 }
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity} target={staleTarget} />)

    expect(screen.getByText(/Review 已过期，请刷新/)).toBeTruthy()
    const finalize = screen.getByRole('button', { name: 'Finalize cleanup' }) as HTMLButtonElement
    expect(finalize.disabled).toBe(true)
    fireEvent.click(finalize)
    expect(fixture.calls).toEqual([])
  })

  test('loads unified diff only after expansion and sends the exact review identity', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.reviewDiff = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
        truncated: true,
        files: [
          { path: 'src/modified.ts', status: 'modified' as const, patch: '@@ -1 +1 @@\n-old\n+new\n', truncated: false },
          { path: 'src/added.ts', status: 'added' as const, patch: '@@ -0,0 +1 @@\n+added\n', truncated: true },
          { path: 'src/deleted.ts', status: 'deleted' as const, patch: '@@ -1 +0,0 @@\n-deleted\n', truncated: false },
          { path: 'src/new-name.ts', previousPath: 'src/old-name.ts', status: 'renamed' as const, patch: 'similarity index 100%', truncated: false },
          { path: 'assets/logo.png', status: 'binary' as const, patch: null, truncated: false },
        ],
      },
    }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity} target={fixture.target} />)

    expect(fixture.adapter.reviewDiff).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show diff' }))

    await waitFor(() => expect(fixture.adapter.reviewDiff).toHaveBeenCalledTimes(1))
    expect(fixture.adapter.reviewDiff).toHaveBeenCalledWith(identity)
    expect(screen.getByText(/Diff response was truncated/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /modified.*src\/modified\.ts/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /added.*src\/added\.ts/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /deleted.*src\/deleted\.ts/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /renamed.*src\/old-name\.ts.*src\/new-name\.ts/i })).toBeTruthy()
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === '@@ -1 +1 @@\n-old\n+new\n')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /added.*src\/added\.ts/i }))
    expect(screen.getByText(/This file patch was truncated/)).toBeTruthy()
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === '@@ -0,0 +1 @@\n+added\n')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /binary.*assets\/logo\.png/i }))
    expect(screen.getByText('Binary file — patch is not available.')).toBeTruthy()
  })

  test('shows diff recovery metadata and retries a transport failure only after a user click', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.reviewDiff = vi.fn(async (request) => {
      if (vi.mocked(fixture.adapter.reviewDiff).mock.calls.length === 1) {
        return { ok: false as const, error: { code: 'transport_unavailable' as const, message: 'Remote disconnected.' } }
      }
      return {
        ok: true as const,
        value: {
          reviewId: request.expectedReviewId,
          revision: request.expectedRevision,
          truncated: false,
          files: [{ path: 'src/retry.ts', status: 'modified' as const, patch: '+retried', truncated: false }],
        },
      }
    })
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity} target={fixture.target} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show diff' }))
    await waitFor(() => expect(screen.getByText('Remote disconnected.')).toBeTruthy())
    expect(screen.getByText(/Category: unavailable.*Recovery: retry/i)).toBeTruthy()
    expect(fixture.adapter.reviewDiff).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retry diff' }))
    await waitFor(() => expect(fixture.adapter.reviewDiff).toHaveBeenCalledTimes(2))
    expect(screen.getByText('+retried')).toBeTruthy()
  })

  test('invalidates a stale diff without retrying the old review identity', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const onRefresh = vi.fn(async () => undefined)
    fixture.adapter.reviewDiff = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'stale_target' as const, message: 'Review fingerprint changed.' },
    }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel
      review={review()}
      adapter={fixture.adapter}
      identity={identity}
      target={fixture.target}
      onRefresh={onRefresh}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Show diff' }))
    await waitFor(() => expect(screen.getByText(/Review 已过期，请刷新/)).toBeTruthy())
    expect(fixture.adapter.reviewDiff).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Retry diff' })).toBeNull()
  })

  test('handles 200 files, long paths, and long patches through focusable plain-text controls', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const longPath = `src/${'nested/'.repeat(40)}file.ts`
    const longPatch = `@@ -1 +1 @@\n-${'old'.repeat(4000)}\n+<script>${'new'.repeat(4000)}</script>\n`
    fixture.adapter.reviewDiff = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
        truncated: false,
        files: [{ path: longPath, status: 'modified' as const, patch: longPatch, truncated: false }],
      },
    }))
    const files = Array.from({ length: 200 }, (_, index) => `src/generated/${index.toString().padStart(3, '0')}-${'x'.repeat(80)}.ts`)
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    const { container } = render(<WorktreeReviewPanel
      review={review({ changedFiles: files })}
      adapter={fixture.adapter}
      identity={identity}
      target={fixture.target}
    />)

    expect(screen.getByRole('list', { name: '200 changed files' }).children).toHaveLength(200)
    const showDiff = screen.getByRole('button', { name: 'Show diff' })
    showDiff.focus()
    expect(document.activeElement).toBe(showDiff)
    expect(showDiff.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(showDiff)
    await waitFor(() => expect(screen.getByRole('button', { name: `modified ${longPath}` })).toBeTruthy())
    expect(showDiff.getAttribute('aria-expanded')).toBe('true')
    const patch = screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === longPatch)
    expect(patch.getAttribute('tabindex')).toBe('0')
    expect(container.querySelector('script')).toBeNull()
  })

  test('finalizes once with the exact review-bound payload and never sends a commit message', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const onTargetChange = vi.fn()
    fixture.adapter.finalize = vi.fn(async (request) => ({
      ok: true as const,
      value: {
        target: {
          ...fixture.target,
          revision: 8,
          state: 'delivered' as const,
          phase: 'discarded' as const,
          dirty: false,
          commitOid: 'c'.repeat(40),
        },
        commitOid: 'c'.repeat(40),
      },
    }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel
      review={review()}
      adapter={fixture.adapter}
      identity={identity}
      target={fixture.target}
      onTargetChange={onTargetChange}
    />)

    const finalize = screen.getByRole('button', { name: 'Finalize cleanup' })
    fireEvent.click(finalize)
    fireEvent.click(finalize)

    await waitFor(() => expect(fixture.adapter.finalize).toHaveBeenCalledTimes(1))
    const request = vi.mocked(fixture.adapter.finalize).mock.calls[0]?.[0]
    expect(request).toEqual({ ...identity, retention: 'cleanup' })
    expect(request).not.toHaveProperty('commitMessage')
    await waitFor(() => expect(onTargetChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 8, state: 'delivered' })))
    expect(screen.getByText(/Finalized.*revision 8/i)).toBeTruthy()
  })

  test('disables every mutation while Finalize is submitting', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    let resolveFinalize: ((value: Awaited<ReturnType<typeof fixture.adapter.finalize>>) => void) | undefined
    fixture.adapter.finalize = vi.fn(() => new Promise((resolve) => { resolveFinalize = resolve }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity} target={fixture.target} />)

    fireEvent.click(screen.getByRole('button', { name: 'Finalize cleanup' }))
    expect((screen.getByRole('button', { name: 'Finalizing…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Submitting…' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/All mutation controls are disabled/).closest('[aria-live="polite"]')).toBeTruthy()

    resolveFinalize?.({
      ok: true,
      value: { target: { ...fixture.target, state: 'delivered', phase: 'discarded', revision: 8 } },
    })
    await waitFor(() => expect(screen.getByText(/revision 8/)).toBeTruthy())
  })

  test('offers all explicit Finalize retention modes with exact payloads', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.finalize = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'transport_unavailable' as const, message: 'Remote disconnected.' },
    }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity} target={fixture.target} />)

    for (const [index, [label, retention]] of [
      ['Retain 24h', 'retain_24h'],
      ['Retain 3d', 'retain_3d'],
      ['Manual retention', 'retain_manual'],
    ].entries()) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      await waitFor(() => expect(fixture.adapter.finalize).toHaveBeenCalledTimes(index + 1))
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeTruthy())
      expect(vi.mocked(fixture.adapter.finalize).mock.calls[index]?.[0]).toEqual({ ...identity, retention })
    }
  })

  test('reuses retention actions for an already retained target', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const retainedTarget = {
      ...fixture.target,
      revision: 8,
      state: 'retained' as const,
      phase: 'retained' as const,
      retention: 'retain_24h' as const,
      retainedAt: 2,
      expiresAt: 3,
      commitOid: 'c'.repeat(40),
      capabilities: {
        ...fixture.target.capabilities,
        finalize: false,
        discard: false,
        setRetention: true,
      },
    }
    const onTargetChange = vi.fn()
    fixture.adapter.setRetention = vi.fn(async (request) => ({
      ok: true as const,
      value: { target: { ...retainedTarget, revision: 9, retention: request.retention } },
    }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 8,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel
      review={review()}
      adapter={fixture.adapter}
      identity={identity}
      target={retainedTarget}
      onTargetChange={onTargetChange}
    />)

    expect(screen.getByText('Retained target')).toBeTruthy()
    expect(screen.getByText(/cccccccc/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manual retention' }))
    await waitFor(() => expect(fixture.adapter.setRetention).toHaveBeenCalledWith({
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 8,
      retention: 'retain_manual',
    }))
    expect(onTargetChange).toHaveBeenCalledWith(expect.objectContaining({ revision: 9, retention: 'retain_manual' }))
  })

  test.each(['stale_target', 'stale_isolated', 'stale_local'] as const)(
    'invalidates %s, refreshes once, and never replays Finalize',
    async (code) => {
      const fixture = createWorktreeConsoleAdapterFixture()
      const onRefresh = vi.fn(async () => undefined)
      fixture.adapter.finalize = vi.fn(async () => ({
        ok: false as const,
        error: { code, message: `${code} rejected the review.` },
      }))
      const identity = {
        sessionId: 'target-session',
        checkoutId: 'checkout-1',
        expectedRevision: 7,
        expectedReviewId: 'review-1',
      }
      render(<WorktreeReviewPanel
        review={review()}
        adapter={fixture.adapter}
        identity={identity}
        target={fixture.target}
        onRefresh={onRefresh}
      />)

      fireEvent.click(screen.getByRole('button', { name: 'Finalize cleanup' }))

      await waitFor(() => expect(screen.getByText(/Review 已过期，请刷新/)).toBeTruthy())
      expect(fixture.adapter.finalize).toHaveBeenCalledTimes(1)
      expect(onRefresh).toHaveBeenCalledTimes(1)
      const finalize = screen.getByRole('button', { name: 'Finalize cleanup' }) as HTMLButtonElement
      expect(finalize.disabled).toBe(true)
      fireEvent.click(finalize)
      expect(fixture.adapter.finalize).toHaveBeenCalledTimes(1)
    },
  )

  test('requires an explicit dirty Discard confirmation and sends confirmDirty only after confirmation', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.discard = vi.fn(fixture.adapter.discard)
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity} target={fixture.target} />)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(fixture.adapter.discard).not.toHaveBeenCalled()
    expect(screen.getByText(/will not commit the Worktree changes to Local/i)).toBeTruthy()
    const dialog = screen.getByRole('alertdialog')
    const confirm = screen.getByRole('button', { name: 'Confirm dirty discard' })
    expect(document.activeElement).toBe(confirm)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(fixture.adapter.discard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dirty discard' }))
    await waitFor(() => expect(fixture.adapter.discard).toHaveBeenCalledTimes(1))
    expect(fixture.adapter.discard).toHaveBeenCalledWith({
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      confirmDirty: true,
    })
  })

  test('does not replay a stale destructive Discard', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const onRefresh = vi.fn(async () => undefined)
    fixture.adapter.discard = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'stale_target' as const, message: 'Target revision changed.' },
    }))
    const identity = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
    }
    render(<WorktreeReviewPanel
      review={review()}
      adapter={fixture.adapter}
      identity={identity}
      target={fixture.target}
      onRefresh={onRefresh}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dirty discard' }))
    await waitFor(() => expect(screen.getByText(/Review 已过期，请刷新/)).toBeTruthy())
    expect(fixture.adapter.discard).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('upgrades the logged ToolView with live review-bound actions when the Remote adapter is available', async () => {
    const evidence = review()
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: fixture.target } }))
    render(<WorktreeReviewRow
      callId="call-review-live"
      toolName="worktree_ready_for_review"
      sessionId="target-session"
      block={{
        callId: 'call-review-live',
        kind: 'result',
        call: { argsRaw: JSON.stringify({
          summary: evidence.summary,
          details: evidence.detailsMarkdown,
          validationStatus: evidence.validationStatus,
          validationSummary: evidence.validationSummary,
          tests: evidence.tests,
          suggestedCommitMessage: evidence.suggestedCommitMessage,
        }) },
        content: [{ type: 'text', text: JSON.stringify({
          kind: 'worktree_ready_for_review',
          state: 'ready_for_review',
          reviewId: evidence.reviewId,
          revision: evidence.revision,
          changedFiles: evidence.changedFiles,
        }) }],
      }}
      services={{} as WorktreeClientServices}
      adapter={fixture.adapter}
    />)

    await waitFor(() => expect(fixture.adapter.current).toHaveBeenCalledWith({ sessionId: 'target-session' }))
    expect((screen.getByRole('button', { name: 'Finalize cleanup' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Show diff' }))
    await waitFor(() => expect(fixture.calls).toContainEqual({
      method: 'reviewDiff',
      request: {
        sessionId: 'target-session',
        checkoutId: 'checkout-1',
        expectedRevision: 7,
        expectedReviewId: 'review-1',
      },
    }))
  })

  test('keeps a logged ToolView replayable when the live Console adapter is unavailable', () => {
    const evidence = review()
    const services = {} as WorktreeClientServices
    render(<WorktreeReviewRow
      callId="call-review"
      toolName="worktree_ready_for_review"
      block={{
        callId: 'call-review',
        kind: 'result',
        call: { argsRaw: JSON.stringify({
          summary: evidence.summary,
          details: evidence.detailsMarkdown,
          validationStatus: evidence.validationStatus,
          validationSummary: evidence.validationSummary,
          tests: evidence.tests,
          suggestedCommitMessage: evidence.suggestedCommitMessage,
        }) },
        content: [{ type: 'text', text: JSON.stringify({
          kind: 'worktree_ready_for_review',
          state: 'ready_for_review',
          reviewId: evidence.reviewId,
          revision: evidence.revision,
          changedFiles: evidence.changedFiles,
        }) }],
      }}
      services={services}
    />)

    expect(screen.getByText('Review summary')).toBeTruthy()
    expect(screen.getByText('# Delivery', { exact: false })).toBeTruthy()
    expect(screen.getByText(/连接后刷新/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Finalize cleanup' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
