import {
  FileText, GitBranch, CircleCheck, TriangleAlert, CircleMinus, X, ListChecks,
  Ellipsis, Eye, Check, Undo2, Pencil, Save, Trash2, FolderOpen, ExternalLink,
  RefreshCw, ChevronRight,
} from 'lucide-react'

const icons = {
  file: FileText, branch: GitBranch, check: CircleCheck, warning: TriangleAlert,
  minus: CircleMinus, close: X, list: ListChecks, more: Ellipsis, preview: Eye,
  confirm: Check, rollback: Undo2, edit: Pencil, save: Save, discard: Trash2,
  folder: FolderOpen, external: ExternalLink, refresh: RefreshCw, chevron: ChevronRight,
}
export type ReviewIconName = keyof typeof icons

export function ReviewIcon({ name, className = '' }: { name: ReviewIconName; className?: string }) {
  const Icon = icons[name]
  return <Icon className={`dsh-wt-icon ${className}`} size={18} strokeWidth={1.75} aria-hidden="true" focusable="false" />
}
