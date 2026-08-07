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
const CONTACT_SYNC_INTERVAL_MS = Number(process.env.CONTACT_SYNC_INTERVAL_MS ?? 5 * 60_000)
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

// recurrence_until là cột DATE thuần theo giờ VN (người dùng chọn trên
// UI), so sánh phải quy nextRun về NGÀY LỊCH VN chứ không phải ngày UTC —
// nếu không, job chạy giờ khuya VN (~UTC sáng hôm sau) có thể bị lệch
// ngày. +7h vào UTC rồi đọc bằng getUTC* là cách quy đổi không phụ thuộc
// timezone của máy chạy worker (Railway mặc định UTC).
function toVnDateStr(date) {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`
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
      // recurrence_until (NULL = lặp mãi mãi): lần chạy kế tiếp vượt quá
      // ngày này thì dừng lặp, coi như job đã hoàn tất.
      const pastEnd = nextRun && job.recurrence_until && toVnDateStr(nextRun) > job.recurrence_until
      await supabase.from('zalo_scheduled_messages').update(
        nextRun && !pastEnd
          ? { run_at: nextRun.toISOString(), last_sent_at: new Date().toISOString() }
          : { status: 'sent', last_sent_at: new Date().toISOString() },
      ).eq('id', job.id)
      console.log(`[worker] Đã gửi job ${job.id} (${job.title})${pastEnd ? ' — đã tới recurrence_until, dừng lặp' : ''}`)
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

const GROUP_INFO_BATCH_SIZE = 50

// Đồng bộ danh sách nhóm Zalo thật (tên + id) lên bảng zalo_groups để web
// hiển thị checklist ở form "Thêm lịch gửi tin" — thay vì phải gõ tay
// Thread ID. Chạy định kỳ (GROUP_SYNC_INTERVAL_MS) + gọi ngay sau khi login
// thành công (xem tryLoadStoredSession/checkLoginRequest) để có dữ liệu
// sớm nhất, không phải chờ tick đầu tiên.
//
// getGroupInfo() nhận nhiều ID cùng lúc nhưng gửi hết trong 1 request nếu
// không chia lô — acc ở nhiều nhóm dễ khiến request bị Zalo từ chối (đã
// gặp: getAllFriends chạy được nhưng getGroupInfo lỗi âm thầm, 0 nhóm được
// lưu). Chia theo GROUP_INFO_BATCH_SIZE + log riêng từng bước để lỗi lô
// nào không làm mất toàn bộ danh sách, và biết chính xác bước nào hỏng.
async function syncGroups() {
  if (!api) return

  let groupIds
  try {
    const { gridVerMap } = await api.getAllGroups()
    groupIds = Object.keys(gridVerMap)
  } catch (err) {
    console.error('[worker] Lỗi getAllGroups():', err instanceof Error ? err.message : err)
    return
  }
  if (groupIds.length === 0) return

  const rows = []
  for (let i = 0; i < groupIds.length; i += GROUP_INFO_BATCH_SIZE) {
    const batch = groupIds.slice(i, i + GROUP_INFO_BATCH_SIZE)
    try {
      const { gridInfoMap } = await api.getGroupInfo(batch)
      for (const [id, info] of Object.entries(gridInfoMap)) {
        rows.push({ zalo_group_id: id, zalo_group_name: info.name ?? null, synced_at: new Date().toISOString() })
      }
    } catch (err) {
      console.error(`[worker] Lỗi getGroupInfo() cho lô ${i}-${i + batch.length} (${batch.length} ID):`, err instanceof Error ? err.message : err)
    }
  }
  if (rows.length === 0) {
    console.error(`[worker] Không lấy được thông tin nhóm nào (tổng ${groupIds.length} ID từ getAllGroups) — xem lỗi getGroupInfo() ở trên`)
    return
  }

  const { error } = await supabase.from('zalo_groups').upsert(rows, { onConflict: 'zalo_group_id' })
  if (error) console.error('[worker] Lỗi ghi zalo_groups:', error.message)
  else console.log(`[worker] Đã đồng bộ ${rows.length}/${groupIds.length} nhóm Zalo`)
}

// Đồng bộ danh bạ bạn bè Zalo (cá nhân, khác nhóm) lên bảng zalo_contacts —
// hiện chỉ để có sẵn dữ liệu, CHƯA dùng ở đâu (lịch gửi tin vẫn chỉ gửi
// nhóm). Cùng nhịp chạy với syncGroups(): định kỳ + ngay sau login thành
// công.
async function syncContacts() {
  if (!api) return

  const friends = await api.getAllFriends()
  if (!friends || friends.length === 0) return

  const rows = friends.map(f => ({
    zalo_user_id: f.userId,
    display_name: f.displayName ?? null,
    zalo_name: f.zaloName ?? null,
    phone_number: f.phoneNumber ?? null,
    synced_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('zalo_contacts').upsert(rows, { onConflict: 'zalo_user_id' })
  if (error) console.error('[worker] Lỗi đồng bộ danh bạ:', error.message)
  else console.log(`[worker] Đã đồng bộ ${rows.length} liên hệ Zalo`)
}

// Nút "Đồng bộ ngay" trên web (trang /danh-muc-zalo) ghi
// zalo_session.sync_requested=true — dùng chung nhịp poll nhanh
// (LOGIN_CHECK_INTERVAL_MS) với luồng đăng nhập QR để phản hồi kịp thời,
// không phải chờ tới lượt GROUP_SYNC_INTERVAL_MS/CONTACT_SYNC_INTERVAL_MS.
async function checkSyncRequest() {
  const { data: session } = await supabase
    .from('zalo_session')
    .select('sync_requested')
    .eq('id', SESSION_ROW_ID)
    .maybeSingle()
  if (!session?.sync_requested) return

  await supabase.from('zalo_session').update({ sync_requested: false }).eq('id', SESSION_ROW_ID)
  await Promise.all([syncGroups(), syncContacts()])
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
    syncContacts().catch(err => console.error('[worker] Lỗi đồng bộ danh bạ sau đăng nhập:', err))
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
    syncContacts().catch(err => console.error('[worker] Lỗi đồng bộ danh bạ sau đăng nhập:', err))
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
  const runContactSyncTick = tick(syncContacts)
  const runSyncRequestTick = tick(checkSyncRequest)

  runJobsTick()
  runLoginTick()
  setInterval(runJobsTick, POLL_INTERVAL_MS)
  setInterval(runLoginTick, LOGIN_CHECK_INTERVAL_MS)
  setInterval(runGroupSyncTick, GROUP_SYNC_INTERVAL_MS)
  setInterval(runContactSyncTick, CONTACT_SYNC_INTERVAL_MS)
  setInterval(runSyncRequestTick, LOGIN_CHECK_INTERVAL_MS)

  console.log(`[worker] Đang chạy — poll job mỗi ${POLL_INTERVAL_MS}ms, poll login-request mỗi ${LOGIN_CHECK_INTERVAL_MS}ms, đồng bộ nhóm mỗi ${GROUP_SYNC_INTERVAL_MS}ms, đồng bộ danh bạ mỗi ${CONTACT_SYNC_INTERVAL_MS}ms`)
}

main().catch((err) => {
  console.error('[worker] Lỗi khởi động, thoát process:', err)
  process.exit(1)
})
