import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NetPlanner — RF Network Planning',
  description: 'RF Network planning tool for telecom engineers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  )
}
