import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSuperAdmin } from '@/lib/require-phong-ve'

// GET — danh bạ bạn bè Zalo thật, do worker/ (Railway) đồng bộ định kỳ vào
// bảng zalo_contacts (xem worker/index.js syncContacts()). Chỉ đọc, chỉ để
// xem — chưa dùng để gửi tin (lịch gửi tin hiện chỉ gửi nhóm). Có số điện
// thoại cá nhân nên chỉ super_admin (trang "Danh mục Zalo"), KHÔNG mở rộng
// cho ke_toan_allowlist/boss như /api/zalo-groups.
export async function GET() {
  const user = await requireSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_contacts')
    .select('*')
    .order('display_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data: data ?? [] })
}
