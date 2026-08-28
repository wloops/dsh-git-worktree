# Official Workspace Browser integration

This integration derives at build time from the MIT-licensed DeepSeek Harness package `@deepseek-ai/dsh-client-ui-workspace@0.1.1-rc.2`.

The public Slot ledger can elect a lower-priority Browser, but a wrapper entry cannot inherit the original entry's child-slot authorization: omitting `children` removes the `renderSlot` seat, while repeating `children` redeclares `sidebar.workspaces.directoryFlow`. Therefore `cordis.patch.yml` disables the original loader row while this plugin is enabled, and `scripts/workspace-sidebar-upstream.mjs` embeds that exact official Client factory once. The proxy preserves the official declaration tree, WorkspacePicker, locale dictionaries, stores, and directory-flow behavior. It replaces the Browser data projection and applies exact, fail-closed source seams for the Managed owner Branch Icon, status Badge, HoverCard, search, and ARIA decoration; canonical Session titles and ordinary Local rows remain official behavior.

The upstream version and compiled Client SHA-256 are hard gates. `scripts/check-workspace-sidebar-version.mjs`, `scripts/check-publish.mjs`, focused compatibility tests, and the real Chromium DOM probe must all pass before an upstream upgrade. See the repository `NOTICE` for attribution.
