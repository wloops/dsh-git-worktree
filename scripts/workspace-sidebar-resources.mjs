const UPSTREAM_OWNER = '@deepseek-ai/dsh-client-ui-workspace'
const DERIVED_OWNER = 'dsh-git-worktree'

/** Embedded factories must not share CSS deduplication or cleanup identity.
 * All variants materialize eagerly, even though only one Browser is applied.
 * Keep the pinned CSS bytes/class maps; change only resource ownership/keys.
 */
export function ownWorkspaceStyles(source, version, expectedStyles) {
  let keys = 0
  let owners = 0
  const derived = source
    .replace(/const tagId(\$\d+)? = "@deepseek-ai\/dsh-client-ui-workspace\/([^"/]+\.module\.css)";/gu,
      (_match, suffix = '', file) => {
        keys++
        return `const tagId${suffix} = ${JSON.stringify(`${DERIVED_OWNER}/workspace-${version}/${file}`)};`
      })
    .replaceAll(`tag.dataset.plugin = "${UPSTREAM_OWNER}";`, () => {
      owners++
      return `tag.dataset.plugin = "${DERIVED_OWNER}";`
    })
  if (keys !== expectedStyles || owners !== expectedStyles) {
    throw new Error(`Cannot derive Workspace ${version} CSS ownership: expected ${expectedStyles} keys/owners, got ${keys}/${owners}`)
  }
  return derived
}
