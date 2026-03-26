import styles from './PropRow.module.css'

interface PropRowProps {
  label:    string
  value:    number
  unit:     string
  onChange: (value: number) => void
  min?:     number
  max?:     number
}

export default function PropRow({ label, value, unit, onChange, min, max }: PropRowProps) {
  const isInvalid = (min !== undefined && value < min) || (max !== undefined && value > max)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const parsed = parseFloat(e.target.value)
    if (!isNaN(parsed)) onChange(parsed)
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        type="number"
        value={value}
        step="any"
        min={min}
        max={max}
        onChange={handleChange}
        className={`${styles.input} ${isInvalid ? styles.inputInvalid : ''}`}
        title={isInvalid ? `Valoare invalida (min: ${min ?? '—'}, max: ${max ?? '—'})` : undefined}
      />
      <span className={styles.unit}>{unit}</span>
    </div>
  )
}
