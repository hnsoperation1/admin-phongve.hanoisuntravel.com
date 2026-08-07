import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePhongVe } from '@/lib/require-phong-ve'

const SESSION_ROW_ID = 1

// CHỈ trả các cột an toàn — credentials là session sống của acc Zalo,
// không bao giờ được gửi ra browser.
const SAFE_COLUMNS = 'status, qr_image, error_message, requested_at, updated_at'

export async function GET() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_session')
    .select(SAFE_COLUMNS)
    .eq('id', SESSION_ROW_ID)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

// Ghi status='requested' — worker (worker/index.js, đang chạy sẵn trên
// Railway) tự poll thấy và xử lý, xem worker/README.md.
export async function POST() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_session')
    .update({
      status: 'requested',
      qr_image: null,
      error_message: null,
      requested_by: user.id,
      requested_at: new Date().toISOString(),
    })
    .eq('id', SESSION_ROW_ID)
    .select(SAFE_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}
