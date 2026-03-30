'use client'
import styles from './TopoLegend.module.css'

const ELEVATION_BANDS = [
  { color: '#c8e6a0', label: '< 300 m'      },
  { color: '#b5cc80', label: '300 – 700 m'  },
  { color: '#c8a864', label: '700 – 1200 m' },
  { color: '#a07840', label: '1200 – 2000 m'},
  { color: '#886050', label: '> 2000 m'     },
]

export default function TopoLegend() {
  return (
    <div className={styles.legend}>
      <div className={styles.title}>Altitudine</div>
      {ELEVATION_BANDS.map(band => (
        <div key={band.label} className={styles.row}>
          <span className={styles.swatch} style={{ background: band.color }} />
          <span className={styles.label}>{band.label}</span>
        </div>
      ))}
    </div>
  )
}
