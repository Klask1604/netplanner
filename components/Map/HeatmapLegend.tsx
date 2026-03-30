'use client'
import styles from './HeatmapLegend.module.css'

export default function HeatmapLegend() {
  return (
    <div className={styles.legend}>
      <div className={styles.title}>Nivel semnal</div>
      <div className={styles.bar} />
      <div className={styles.labels}>
        <span>+30 dB</span>
        <span>+20 dB</span>
        <span>+10 dB</span>
        <span>+5 dB</span>
        <span>Edge</span>
      </div>
    </div>
  )
}
