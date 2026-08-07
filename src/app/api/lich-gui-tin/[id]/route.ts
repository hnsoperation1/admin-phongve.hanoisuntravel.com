import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePhongVe } from '@/lib/require-phong-ve'

// PATCH — sửa job hoặc huỷ (status: 'cancelled'), cũng dùng để reset job
// 'error' về lại 'pending' sau khi admin đã sửa nguyên nhân lỗi.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const allowed = ['title', 'message', 'zalo_group_id', 'zalo_group_name', 'run_at', 'recurrence', 'status'] as const
  const payload: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) payload[key] = body[key]

  if (payload.status === 'pending') payload.last_error = null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_scheduled_messages')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const admin = createAdminClient()
  const { error } = await admin.from('zalo_scheduled_messages').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
