export const inject = ['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']

export const apply = (ctx: any): void => {
  const OfficialBrowser = (_props: any) => null
  ctx.effect(() => ctx.locale?.register?.('workspace', {}), 'ui-workspace: dictionaries')
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    children: {
      'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
    },
    inject: () => ({}),
    locale: 'workspace',
  }, OfficialBrowser))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace',
    children: {
      'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' },
    },
  }, OfficialBrowser))
}
