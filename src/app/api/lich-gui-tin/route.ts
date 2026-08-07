import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePhongVe } from '@/lib/require-phong-ve'

export async function GET() {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_scheduled_messages')
    .select('*')
    .order('run_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data: data ?? [] })
}

// POST — { title, message, zalo_group_id, zalo_group_name?, run_at, recurrence, recurrence_until? }
export async function POST(req: NextRequest) {
  const user = await requirePhongVe()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { title, message, zalo_group_id, zalo_group_name, run_at, recurrence, recurrence_until } = body

  if (!title || !message || !zalo_group_id || !run_at) {
    return NextResponse.json({ error: 'Thiếu trường bắt buộc' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('zalo_scheduled_messages')
    .insert({
      title: String(title).trim(),
      message: String(message),
      zalo_group_id: String(zalo_group_id).trim(),
      zalo_group_name: zalo_group_name ? String(zalo_group_name).trim() : null,
      run_at,
      recurrence: recurrence ?? 'once',
      recurrence_until: recurrence_until || null,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}
