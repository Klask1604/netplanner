'use client'
import { useNetStore } from '@/store/netStore'
import { ToolType } from '@/lib/rf'
import { TOOLS, ToolBtn, ToolToggle } from './toolConfig'
import styles from './Toolbar.module.css'

export default function Toolbar() {
  const { tool, setTool, cancelLink, heatmapVisible, toggleHeatmap } = useNetStore()

  const handleTool = (t: ToolType) => {
    cancelLink()
    setTool(t)
  }

  return (
    <div className={styles.toolbar}>
      {TOOLS.map((t, i) => {
        if (t === 'sep') return <div key={i} className={styles.sep} />

        if ((t as ToolToggle).kind === 'toggle') {
          const tog = t as ToolToggle
          const Icon = tog.icon
          return (
            <div key={tog.id} className={styles.btnWrap}>
              <button
                onClick={toggleHeatmap}
                className={`${styles.btn} ${heatmapVisible ? styles.active : ''}`}
                style={{ '--btn-color': tog.color } as React.CSSProperties}
              >
                <Icon size={16} strokeWidth={1.5} />
              </button>
              <div className={styles.tooltip}>{tog.label}</div>
            </div>
          )
        }

        const btn = t as ToolBtn
        const isActive = tool === btn.id
        const color = btn.color ?? '#00d4ff'
        const Icon = btn.icon

        return (
          <div key={btn.id} className={styles.btnWrap}>
            <button
              onClick={() => handleTool(btn.id)}
              className={`${styles.btn} ${isActive ? styles.active : ''}`}
              style={{ '--btn-color': color } as React.CSSProperties}
            >
              <Icon size={16} strokeWidth={1.5} />
            </button>
            <div className={styles.tooltip}>{btn.label}</div>
          </div>
        )
      })}
    </div>
  )
}
