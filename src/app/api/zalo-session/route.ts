import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePhongVe } from '@/lib/require-phong-ve'

// CHỈ trả các cột an toàn — credentials là session sống của acc Zalo,
// không bao giờ được gửi ra browser.
const SAFE_COLUMNS = 'status, qr_image, error_message, requested_at, updated_at'

// Mỗi user_id (CRM users.id) có ĐÚNG 1 dòng — trang "Đăng nhập lại Zalo"
// luôn thao tác trên dòng của CHÍNH người đang đăng nhập, không còn 1 dòng
// chung cho cả team (xem migration_zalo_session_per_user.sql).
export async function GET() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_session')
    .select(SAFE_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

// Ghi status='requested' — worker (worker/index.js, đang chạy sẵn trên
// Railway) tự poll thấy và xử lý, xem worker/README.md. Upsert vì đây có
// thể là lần đầu tiên user_id này có dòng trong bảng.
export async function POST() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_session')
    .upsert({
      user_id: user.id,
      status: 'requested',
      qr_image: null,
      error_message: null,
      requested_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select(SAFE_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}
