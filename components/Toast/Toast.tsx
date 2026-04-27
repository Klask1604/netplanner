'use client'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useToastStore, Toast as ToastItem } from '@/store/toastStore'
import styles from './Toast.module.css'

function ToastEntry({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore(s => s.removeToast)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    bar.style.transition = `width ${toast.duration}ms linear`
    // Force reflow so the transition starts from 100%
    bar.getBoundingClientRect()
    bar.style.width = '0%'
  }, [toast.duration])

  return (
    <div className={`${styles.toast} ${styles[toast.type]}`}>
      <span className={styles.message}>{toast.message}</span>
      <button className={styles.close} onClick={() => removeToast(toast.id)}>
        <X size={12} strokeWidth={2} />
      </button>
      <div className={styles.progressTrack}>
        <div ref={barRef} className={styles.progressBar} style={{ width: '100%' }} />
      </div>
    </div>
  )
}

export default function Toast() {
  const toasts = useToastStore(s => s.toasts)
  if (toasts.length === 0) return null

  return (
    <div className={styles.container}>
      {toasts.map(t => <ToastEntry key={t.id} toast={t} />)}
    </div>
  )
}
