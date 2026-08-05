'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, CalendarClock, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/auth'
import { getInitials } from '@/lib/utils'

const NAV = [
  { href: '/', icon: LayoutDashboard, label: 'Tổng quan' },
  { href: '/lich-gui-tin', icon: CalendarClock, label: 'Lịch gửi tin Zalo' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  return (
    <div className="flex flex-col w-52 flex-shrink-0 bg-sidebar text-white" style={{ borderRight: '1px solid #1e3050' }}>
      <div className="px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #1e3050' }}>
        <div className="font-black text-xl tracking-wide leading-none">
          <span style={{ color: '#ef5e2f' }}>HNS</span>
          <span className="text-brand-200"> PHÒNG VÉ</span>
        </div>
        <div className="text-[10px] text-brand-400 font-medium mt-0.5 uppercase tracking-widest">Admin</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-sidebar-active text-white'
                  : 'text-brand-300 hover:bg-sidebar-hover hover:text-white'
              }`}>
              <Icon size={17} className={isActive ? 'text-accent-400' : ''} />
              {label}
            </Link>
          )
        })}
      </nav>

      {user && (
        <div className="px-3 pb-4 flex-shrink-0 space-y-1" style={{ borderTop: '1px solid #1e3050', paddingTop: '12px' }}>
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #ef5e2f, #c04420)' }}>
              {getInitials(user.full_name)}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{user.full_name}</div>
              <div className="text-[11px] text-brand-400">{user.ke_toan_super_admin ? 'Kế toán (admin)' : user.ke_toan ? 'Kế toán' : 'Giám đốc'}</div>
            </div>
          </div>
          <button onClick={logout}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm text-brand-400 hover:text-red-400 hover:bg-sidebar-hover transition-colors">
            <LogOut size={14} /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  )
}
