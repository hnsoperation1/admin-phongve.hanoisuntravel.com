import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireKeToan } from '@/lib/require-ke-toan'

// GET — danh sách nhóm Zalo thật, do worker/ (Railway) đồng bộ định kỳ vào
// bảng zalo_groups (xem worker/index.js syncGroups()). Chỉ đọc, không có
// POST — nhóm mới xuất hiện tự nhiên sau lần đồng bộ kế tiếp của worker.
export async function GET() {
  const user = await requireKeToan()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_groups')
    .select('*')
    .order('zalo_group_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data: data ?? [] })
}
