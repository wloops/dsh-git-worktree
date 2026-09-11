import {
  FileText, GitBranch, CircleCheck, TriangleAlert, CircleMinus, X, ListChecks,
  CircleEllipsis, TvMinimalPlay, Check, Undo2, Pencil, Save, Trash2, FolderOpen, ExternalLink,
  RefreshCw, ChevronRight, ChevronDown, Monitor, Plus, Search, FolderGit2, Archive, Send, ShieldCheck, CircleHelp,
} from 'lucide-react'

const icons = {
  file: FileText, branch: GitBranch, check: CircleCheck, warning: TriangleAlert,
  minus: CircleMinus, close: X, list: ListChecks, more: CircleEllipsis, preview: TvMinimalPlay,
  confirm: Check, rollback: Undo2, edit: Pencil, save: Save, discard: Trash2,
  local: Monitor, down: ChevronDown, create: Plus, search: Search, manager: FolderGit2, retain: Archive, send: Send, shield: ShieldCheck, help: CircleHelp,
  folder: FolderOpen, external: ExternalLink, refresh: RefreshCw, chevron: ChevronRight,
}
export type ReviewIconName = keyof typeof icons

export function ReviewIcon({ name, className = '' }: { name: ReviewIconName; className?: string }) {
  const Icon = icons[name]
  return <Icon className={`dsh-wt-icon ${className}`} size={18} strokeWidth={1.75} aria-hidden="true" focusable="false" />
}
