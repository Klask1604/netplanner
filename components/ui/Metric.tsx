import styles from './Metric.module.css'

interface MetricProps {
  label: string
  value: string
  color?: string
}

export default function Metric({ label, value, color = 'var(--cyan)' }: MetricProps) {
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value} style={{ color }}>{value}</div>
    </div>
  )
}
