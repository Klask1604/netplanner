import styles from './MapView.module.css'

interface LinkModeHintProps {
  hasSource: boolean
}

export default function LinkModeHint({ hasSource }: LinkModeHintProps) {
  return (
    <div className={styles.linkHint}>
      {hasSource
        ? '↔ Selectează stația destinație'
        : '↔ Selectează stația sursă pentru link'}
    </div>
  )
}
