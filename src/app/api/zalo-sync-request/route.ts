import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePhongVe } from '@/lib/require-phong-ve'

// POST — bấm nút "Đồng bộ ngay" ở /danh-muc-zalo. Ghi sync_requested=true
// trên đúng dòng của CHÍNH người gọi (không còn 1 dòng chung id=1), worker/
// (poll mỗi vài giây) thấy vậy thì tự đồng bộ nhóm + danh bạ của user_id
// đó ngay, không cần chờ tới lượt định kỳ (mặc định 5 phút).
export async function POST() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { error } = await admin.from('zalo_session').update({ sync_requested: true }).eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
