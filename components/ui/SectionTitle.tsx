import styles from './SectionTitle.module.css'

export default function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className={styles.title}>{children}</div>
}
