'use client'
import { useRef } from 'react'
import { useNetStore } from '@/store/netStore'
import StationList from './StationList'
import StationProps from './StationProps'
import LinkProps from './LinkProps'
import styles from './Sidebar.module.css'

export default function Sidebar() {
  const { selId, selLinkId, stations, links, exportJSON, importJSON } = useNetStore()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const json = exportJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'netplanner-config.json'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { importJSON(ev.target?.result as string) }
    reader.readAsText(file)
    e.target.value = ''
  }

  const headerLabel = selLinkId ? 'Link RF' : selId ? 'Proprietăți' : 'Network Topology'

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>{headerLabel}</span>
        {!selId && !selLinkId && <span className={styles.headerCount}>{stations.length} stații · {links.length} linkuri</span>}
      </div>

      <div className={styles.body}>
        {selLinkId ? <LinkProps /> : selId ? <StationProps /> : <StationList />}
      </div>

      <div className={styles.footer}>
        <button className={styles.actionBtn} onClick={handleExport}>↓ EXPORT</button>
        <button className={styles.actionBtn} onClick={() => fileRef.current?.click()}>↑ IMPORT</button>
        <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
      </div>
    </div>
  )
}
