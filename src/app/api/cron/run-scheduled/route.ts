import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendZaloGroupMessage } from '@/lib/zalo'

export const maxDuration = 30

function computeNextRun(runAt: Date, recurrence: string): Date | null {
  const next = new Date(runAt)
  if (recurrence === 'daily') next.setDate(next.getDate() + 1)
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7)
  else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1)
  else return null // 'once' — không lặp lại
  return next
}

// Vercel Cron gọi route này mỗi phút (xem vercel.json). Job cụ thể chạy
// giờ nào là do cột run_at trong DB quyết định, không phải cấu hình cron.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: due, error } = await admin
    .from('zalo_scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ id: string; ok: boolean }> = []

  for (const job of due ?? []) {
    try {
      await sendZaloGroupMessage(job.zalo_group_id, job.message)
      const nextRun = computeNextRun(new Date(job.run_at), job.recurrence)
      await admin.from('zalo_scheduled_messages').update(
        nextRun
          ? { run_at: nextRun.toISOString(), last_sent_at: new Date().toISOString() }
          : { status: 'sent', last_sent_at: new Date().toISOString() },
      ).eq('id', job.id)
      results.push({ id: job.id, ok: true })
    } catch (err) {
      // Lỗi thì đánh dấu 'error' và dừng lặp lại — tránh spam nhóm nếu lỗi
      // dai dẳng (vd session Zalo hết hạn); admin phải vào sửa/reset tay.
      await admin.from('zalo_scheduled_messages').update({
        status: 'error',
        last_error: err instanceof Error ? err.message : String(err),
      }).eq('id', job.id)
      results.push({ id: job.id, ok: false })
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}
