import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/auth'
import { AppShell } from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'Phòng Vé HNS',
  description: 'Quản lý vé máy bay & lịch gửi tin Zalo — Hanoi Sun Travel',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="h-full">
      <body className="h-full">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  )
}
