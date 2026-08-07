import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePhongVe } from '@/lib/require-phong-ve'

// GET — danh bạ bạn bè Zalo thật CỦA CHÍNH người đang gọi, do worker/
// (Railway) đồng bộ định kỳ vào bảng zalo_contacts (xem worker/index.js
// syncContacts()). Giờ mỗi tài khoản Zalo là của riêng 1 nhân viên (xem
// migration_zalo_session_per_user.sql) nên không còn cần khoá riêng
// super_admin như trước (lúc đó là 1 bot chung, lộ danh bạ của cả team) —
// requirePhongVe() + lọc user_id là đủ, mỗi người chỉ thấy đúng danh bạ
// của tài khoản Zalo họ tự đăng nhập.
export async function GET() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_contacts')
    .select('*')
    .eq('user_id', user.id)
    .order('display_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data: data ?? [] })
}
