// Service Node độc lập, chạy trên Railway (process sống liên tục, KHÔNG
// serverless) — tách riêng khỏi app Next.js (vẫn ở Vercel) để nếu worker
// này crash/lỗi session Zalo thì không kéo theo UI/dashboard.
//
// 2 việc chạy song song, đều poll bảng Supabase (không cần route HTTP
// gọi vào worker, worker cũng không mở port nào):
//   1. processDueJobs()   — gửi các job đến hạn trong zalo_scheduled_messages
//   2. checkLoginRequest() — nếu ai đó bấm "Đăng nhập lại Zalo" trên web
//      (ghi zalo_session.status='requested'), worker tự quét QR, ghi ảnh
//      QR + credentials mới vào Supabase để web hiển thị/lưu lại. Nhờ vậy
//      không cần ZALO_SESSION_CREDENTIALS trên Railway nữa — worker tự
//      đọc session mới nhất từ Supabase lúc khởi động.
import { Zalo, ThreadType, LoginQRCallbackEventType } from 'zca-js'
import { createClient } from '@supabase/supabase-js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 20_000)
const LOGIN_CHECK_INTERVAL_MS = Number(process.env.LOGIN_CHECK_INTERVAL_MS ?? 4_000)
const GROUP_SYNC_INTERVAL_MS = Number(process.env.GROUP_SYNC_INTERVAL_MS ?? 5 * 60_000)
const SESSION_ROW_ID = 1

function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Thiếu env ${name}`)
  return v
}

const supabase = createClient(
  requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Session Zalo hiện tại trong RAM. null = chưa đăng nhập, chờ ai đó bấm
// "Đăng nhập lại" trên web — processDueJobs() sẽ tự bỏ qua cho tới lúc đó.
let api = null
let loginInProgress = false

function computeNextRun(runAt, recurrence) {
  const next = new Date(runAt)
  if (recurrence === 'daily') next.setDate(next.getDate() + 1)
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7)
  else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1)
  else return null // 'once' — không lặp lại
  return next
}

async function processDueJobs() {
  if (!api) return

  const { data: due, error } = await supabase
    .from('zalo_scheduled_messages')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())

  if (error) {
    console.error('[worker] Lỗi query job:', error.message)
    return
  }

  for (const job of due ?? []) {
    try {
      await api.sendMessage(job.message, job.zalo_group_id, ThreadType.Group)
      const nextRun = computeNextRun(new Date(job.run_at), job.recurrence)
      await supabase.from('zalo_scheduled_messages').update(
        nextRun
          ? { run_at: nextRun.toISOString(), last_sent_at: new Date().toISOString() }
          : { status: 'sent', last_sent_at: new Date().toISOString() },
      ).eq('id', job.id)
      console.log(`[worker] Đã gửi job ${job.id} (${job.title})`)
    } catch (err) {
      // Lỗi thì đánh dấu 'error' và dừng lặp lại — tránh spam nhóm nếu lỗi
      // dai dẳng (vd session Zalo hết hạn); admin phải vào sửa/reset tay.
      const message = err instanceof Error ? err.message : String(err)
      await supabase.from('zalo_scheduled_messages').update({
        status: 'error',
        last_error: message,
      }).eq('id', job.id)
      console.error(`[worker] Lỗi gửi job ${job.id}:`, message)
    }
  }
}

// Đồng bộ danh sách nhóm Zalo thật (tên + id) lên bảng zalo_groups để web
// hiển thị checklist ở form "Thêm lịch gửi tin" — thay vì phải gõ tay
// Thread ID. Chạy định kỳ (GROUP_SYNC_INTERVAL_MS) + gọi ngay sau khi login
// thành công (xem tryLoadStoredSession/checkLoginRequest) để có dữ liệu
// sớm nhất, không phải chờ tick đầu tiên.
async function syncGroups() {
  if (!api) return

  const { gridVerMap } = await api.getAllGroups()
  const groupIds = Object.keys(gridVerMap)
  if (groupIds.length === 0) return

  const { gridInfoMap } = await api.getGroupInfo(groupIds)
  const rows = Object.entries(gridInfoMap).map(([id, info]) => ({
    zalo_group_id: id,
    zalo_group_name: info.name ?? null,
    synced_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('zalo_groups').upsert(rows, { onConflict: 'zalo_group_id' })
  if (error) console.error('[worker] Lỗi đồng bộ danh sách nhóm:', error.message)
  else console.log(`[worker] Đã đồng bộ ${rows.length} nhóm Zalo`)
}

function eventToPatch(event) {
  switch (event.type) {
    case LoginQRCallbackEventType.QRCodeGenerated:
      return { status: 'qr_ready', qr_image: event.data.image }
    case LoginQRCallbackEventType.QRCodeScanned:
      return { status: 'scanned' }
    case LoginQRCallbackEventType.QRCodeExpired:
      return { status: 'expired', qr_image: null }
    case LoginQRCallbackEventType.QRCodeDeclined:
      return { status: 'declined', qr_image: null }
    default:
      return null
  }
}

async function checkLoginRequest() {
  if (loginInProgress) return

  const { data: session } = await supabase
    .from('zalo_session')
    .select('status')
    .eq('id', SESSION_ROW_ID)
    .maybeSingle()
  if (!session || session.status !== 'requested') return

  loginInProgress = true
  let terminal = false // đã có kết quả rõ ràng (expired/declined) từ callback, khỏi ghi đè 'error' chung chung
  await supabase.from('zalo_session').update({ status: 'in_progress', qr_image: null, error_message: null }).eq('id', SESSION_ROW_ID)

  try {
    const zalo = new Zalo()
    let credentials = null

    const newApi = await zalo.loginQR({}, (event) => {
      const patch = eventToPatch(event)
      if (patch) {
        if (patch.status === 'expired' || patch.status === 'declined') terminal = true
        supabase.from('zalo_session').update(patch).eq('id', SESSION_ROW_ID)
          .then(({ error }) => { if (error) console.error('[worker] Lỗi ghi trạng thái QR:', error.message) })
      }
      if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
        credentials = { imei: event.data.imei, cookie: event.data.cookie, userAgent: event.data.userAgent, language: 'vi' }
      }
    })

    await supabase.from('zalo_session').update({
      status: 'done', credentials, qr_image: null, error_message: null,
    }).eq('id', SESSION_ROW_ID)
    api = newApi
    console.log('[worker] Đăng nhập lại qua QR thành công, đã cập nhật session mới')
    syncGroups().catch(err => console.error('[worker] Lỗi đồng bộ nhóm sau đăng nhập:', err))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!terminal) {
      await supabase.from('zalo_session').update({ status: 'error', error_message: message, qr_image: null }).eq('id', SESSION_ROW_ID)
    }
    console.error('[worker] Lỗi xử lý yêu cầu đăng nhập lại:', message)
  } finally {
    loginInProgress = false
  }
}

async function tryLoadStoredSession() {
  const { data } = await supabase.from('zalo_session').select('credentials').eq('id', SESSION_ROW_ID).maybeSingle()
  if (!data?.credentials) {
    console.log('[worker] Chưa có session Zalo nào được lưu — vào web bấm "Đăng nhập lại Zalo" để quét QR.')
    return
  }
  try {
    const zalo = new Zalo()
    api = await zalo.login(data.credentials)
    console.log('[worker] Login Zalo thành công (dùng session đã lưu trong Supabase)')
    syncGroups().catch(err => console.error('[worker] Lỗi đồng bộ nhóm sau đăng nhập:', err))
  } catch (err) {
    console.error('[worker] Session đã lưu không login được nữa (có thể hết hạn):', err)
    console.log('[worker] Vào web bấm "Đăng nhập lại Zalo" để quét QR mới.')
  }
}

async function main() {
  await tryLoadStoredSession()

  const tick = (fn) => () => {
    fn().catch((err) => {
      // 1 vòng poll lỗi không được làm chết process — vòng sau vẫn chạy.
      console.error('[worker] Lỗi không mong đợi trong vòng poll:', err)
    })
  }

  const runJobsTick = tick(processDueJobs)
  const runLoginTick = tick(checkLoginRequest)
  const runGroupSyncTick = tick(syncGroups)

  runJobsTick()
  runLoginTick()
  setInterval(runJobsTick, POLL_INTERVAL_MS)
  setInterval(runLoginTick, LOGIN_CHECK_INTERVAL_MS)
  setInterval(runGroupSyncTick, GROUP_SYNC_INTERVAL_MS)

  console.log(`[worker] Đang chạy — poll job mỗi ${POLL_INTERVAL_MS}ms, poll login-request mỗi ${LOGIN_CHECK_INTERVAL_MS}ms, đồng bộ nhóm mỗi ${GROUP_SYNC_INTERVAL_MS}ms`)
}

main().catch((err) => {
  console.error('[worker] Lỗi khởi động, thoát process:', err)
  process.exit(1)
})
