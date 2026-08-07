'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/auth'
import Sidebar from './Sidebar'

const CRM_LOGIN_URL = 'https://crm.hanoisuntravel.com/login'

// Quyền vào app này TÁCH RIÊNG khỏi ke_toan/role — chọn thủ công từng tài
// khoản ở crm.hanoisuntravel.com/admin/users, mục "App Phòng vé"
// (phong_ve_allowlist), không tự động cấp theo vai trò hay quyền Kế toán.
// super_admin luôn vào được (bypass chung cho mọi app trong hệ sinh thái).
function hasAccess(user: { is_super_admin?: boolean; phong_ve?: boolean }) {
  return !!user.is_super_admin || !!user.phong_ve
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    // Không có route /login trong app này — đăng nhập qua SSO của CRM.
    // Nếu chưa có session (cookie .hanoisuntravel.com chưa đăng nhập ở
    // CRM), điều hướng full-page sang CRM login kèm redirect quay lại đây.
    if (!user) {
      const redirect = encodeURIComponent(window.location.href)
      window.location.href = `${CRM_LOGIN_URL}?redirect=${redirect}`
    }
  }, [user, loading])

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-sidebar">
        <div className="text-center">
          <div className="font-black text-3xl tracking-wide mb-2">
            <span style={{ color: '#ef5e2f' }}>HNS</span>
            <span className="text-brand-300"> PHÒNG VÉ</span>
          </div>
          <div className="text-brand-400 text-sm">Đang tải...</div>
        </div>
      </div>
    )
  }

  if (!hasAccess(user)) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm">
          <div className="text-xl font-bold text-gray-800 mb-2">Không có quyền truy cập</div>
          <div className="text-sm text-gray-500">
            Tài khoản {user.email} chưa được cấp quyền vào app Phòng Vé. Liên hệ admin để được thêm vào danh sách "App Phòng vé" ở trang quản lý người dùng.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
