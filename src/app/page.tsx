import { CalendarClock } from 'lucide-react'
import Link from 'next/link'

export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Tổng quan</h1>
      <Link href="/lich-gui-tin"
        className="flex items-center gap-3 p-5 bg-white rounded-2xl border border-gray-200 hover:border-accent-400 transition-colors max-w-sm">
        <div className="w-10 h-10 rounded-xl bg-accent-500/10 flex items-center justify-center flex-shrink-0">
          <CalendarClock size={20} className="text-accent-500" />
        </div>
        <div>
          <div className="font-semibold text-gray-800">Lịch gửi tin Zalo</div>
          <div className="text-sm text-gray-500">Tạo & quản lý tin nhắn gửi định kỳ vào nhóm Zalo</div>
        </div>
      </Link>
    </div>
  )
}
