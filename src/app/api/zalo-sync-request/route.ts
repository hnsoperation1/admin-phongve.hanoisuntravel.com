import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperAdmin } from '@/lib/require-phong-ve'

const SESSION_ROW_ID = 1

// POST — bấm nút "Đồng bộ ngay" ở /danh-muc-zalo (chỉ super_admin vào
// được trang đó). Ghi sync_requested=true vào zalo_session, worker/ (poll
// mỗi vài giây) thấy vậy thì tự đồng bộ nhóm + danh bạ ngay, không cần chờ
// tới lượt định kỳ (mặc định 5 phút).
export async function POST() {
  const user = await requireSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin.from('zalo_session').update({ sync_requested: true }).eq('id', SESSION_ROW_ID)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
