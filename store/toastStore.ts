import { create } from 'zustand'

export type ToastType = 'error' | 'warn' | 'info' | 'success'

export interface Toast {
  id: number
  type: ToastType
  message: string
  duration: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: number) => void
}

let _nextToastId = 1

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (type, message, duration = 4500) => {
    const id = _nextToastId++
    set(s => ({ toasts: [...s.toasts, { id, type, message, duration }] }))
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, duration)
  },

  removeToast: (id) =>
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
