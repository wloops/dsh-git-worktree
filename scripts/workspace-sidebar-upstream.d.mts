export const WORKSPACE_UI_VERSION: string
export const WORKSPACE_LOCALE_VERSION: string
export const WORKSPACE_CLIENT_SHA256: string
export const OFFICIAL_WORKSPACE_VIRTUAL_ID: string
export const RESOLVED_OFFICIAL_WORKSPACE_VIRTUAL_ID: string
export function readOfficialWorkspaceClient(): { source: string; clientPath: string }
export function decorateOfficialWorkspaceClient(source: string): string
export function materializeOfficialWorkspaceClientModule(): string
