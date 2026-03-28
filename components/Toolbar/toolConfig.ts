import { LucideIcon, MousePointer2, RadioTower, Antenna, Router, Satellite, ArrowLeftRight, Trash2, Activity } from 'lucide-react'
import { ToolType } from '@/lib/rf'

export interface ToolBtn {
  kind?: 'tool'
  id: ToolType
  icon: LucideIcon
  label: string
  color?: string
}

export interface ToolToggle {
  kind: 'toggle'
  id: 'heatmap'
  icon: LucideIcon
  label: string
  color: string
}

export const TOOLS: (ToolBtn | ToolToggle | 'sep')[] = [
  { id: 'select',   icon: MousePointer2,  label: 'Select / Move' },
  'sep',
  { id: 'bts',      icon: RadioTower,     label: 'BTS / eNodeB',     color: '#00d4ff' },
  { id: 'antenna',  icon: Antenna,        label: 'Antenă Radio',     color: '#ff8c00' },
  { id: 'router',   icon: Router,         label: 'Router / Switch',  color: '#00ff88' },
  { id: 'repeater', icon: Satellite,      label: 'Repeater',         color: '#cc00ff' },
  'sep',
  { id: 'link',     icon: ArrowLeftRight, label: 'Link între stații', color: '#ffffff' },
  'sep',
  { id: 'delete',   icon: Trash2,         label: 'Șterge stație',    color: '#ff3860' },
  'sep',
  { kind: 'toggle', id: 'heatmap', icon: Activity, label: 'RF Heatmap', color: '#ff8c00' },
]
