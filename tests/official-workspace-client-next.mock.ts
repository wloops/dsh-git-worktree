export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts']

export const apply = (ctx: any): void => {
  ctx.effect(() => ctx.locale?.register?.('workspace', {}), 'ui-workspace: dictionaries')
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    children: {
      'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
      'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
      'sidebar.session.row.leading': { kind: 'list', scope: 'root' },
      'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
    },
    inject: () => ({}),
    locale: 'workspace',
  }, (_props: any) => null))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace',
    children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
  }, (_props: any) => null))
}
