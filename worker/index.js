// Service Node độc lập, chạy trên Railway (process sống liên tục, KHÔNG
// serverless) — tách riêng khỏi app Next.js (vẫn ở Vercel) để nếu worker
// này crash/lỗi session Zalo thì không kéo theo UI/dashboard.
//
// Mỗi nhân viên CRM tự đăng nhập Zalo RIÊNG của mình (xem
// migration_zalo_session_per_user.sql) — worker giữ NHIỀU kết nối Zalo
// cùng lúc trong RAM, khoá theo user_id (CRM users.id), KHÔNG còn 1 tài
// khoản Zalo chung cho cả team như trước.
//
// 3 việc chạy song song, đều poll bảng Supabase (không cần route HTTP
// gọi vào worker, worker cũng không mở port nào):
//   1. processDueJobs()    — gửi job đến hạn bằng ĐÚNG tài khoản Zalo của
//      người tạo lịch (zalo_scheduled_messages.created_by)
//   2. checkLoginRequests() — mỗi dòng zalo_session status='requested' là
//      1 nhân viên đang bấm "Đăng nhập lại Zalo" trên trang RIÊNG của họ
//   3. checkSyncRequests()  — mỗi dòng sync_requested=true là 1 nhân viên
//      bấm "Đồng bộ ngay" ở /danh-muc-zalo
import { Zalo, ThreadType, LoginQRCallbackEventType, ZaloApiError } from 'zca-js'
import { createClient } from '@supabase/supabase-js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 20_000)
const LOGIN_CHECK_INTERVAL_MS = Number(process.env.LOGIN_CHECK_INTERVAL_MS ?? 4_000)
const GROUP_SYNC_INTERVAL_MS = Number(process.env.GROUP_SYNC_INTERVAL_MS ?? 5 * 60_000)
const CONTACT_SYNC_INTERVAL_MS = Number(process.env.CONTACT_SYNC_INTERVAL_MS ?? 5 * 60_000)
const GROUP_INFO_BATCH_SIZE = 50

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

// sessions: user_id -> api instance (zca-js) đang sống trong RAM.
// loginInProgress: user_id đang giữa luồng quét QR (tránh 2 tick xử lý
// trùng cùng 1 người khi request kéo dài qua nhiều lần poll).
const sessions = new Map()
const loginInProgress = new Set()

// Zalo trả lỗi này (nguyên văn tiếng Việt từ server, message kỹ thuật khó
// hiểu với người dùng cuối) khi phiên đang giữ trong RAM đã bị chính Zalo
// thu hồi — hay gặp nhất là do tài khoản vừa đăng nhập lại ở nơi khác
// (điện thoại/trình duyệt khác), Zalo chỉ cho 1 phiên Web sống tại 1 thời
// điểm. Nhận diện qua nội dung message vì zca-js không có mã lỗi riêng cho
// trường hợp này (`ZaloApiError.code` là mã lỗi số từ Zalo, không ổn định
// để dựa vào).
function isSessionRevokedError(err) {
  if (!(err instanceof ZaloApiError) && !(err instanceof Error)) return false
  return /zpw_sek/i.test(err.message)
}

// Gỡ session chết khỏi RAM (để các lần gửi/đồng bộ sau báo lỗi "chưa đăng
// nhập" luôn, thay vì lặp lại đúng lỗi này) + cập nhật zalo_session để
// trang "Đăng nhập lại Zalo" không còn hiện nhầm là đang đăng nhập tốt.
async function markSessionRevoked(userId) {
  sessions.delete(userId)
  await supabase.from('zalo_session').update({
    status: 'revoked',
    error_message: 'Tài khoản đã đăng nhập ở nơi khác (điện thoại/trình duyệt khác) nên phiên này bị Zalo ngắt.',
  }).eq('user_id', userId)
}

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

// Gửi job đến hạn bằng ĐÚNG tài khoản Zalo của người tạo lịch
// (job.created_by) — không còn 1 tài khoản chung cho cả team.
async function processDueJobs() {
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
    const api = sessions.get(job.created_by)
    if (!api) {
      // Người tạo lịch chưa đăng nhập Zalo (hoặc session hết hạn) — báo
      // lỗi ngay, không được để job kẹt "pending" mãi mà không rõ vì sao
      // chưa gửi.
      await supabase.from('zalo_scheduled_messages').update({
        status: 'error',
        last_error: 'Người tạo lịch chưa đăng nhập Zalo (hoặc session đã hết hạn) — vào "Đăng nhập lại Zalo" rồi bấm Thử lại.',
      }).eq('id', job.id)
      console.error(`[worker] Job ${job.id} lỗi: user ${job.created_by} chưa có session Zalo sống`)
      continue
    }
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
      console.log(`[worker] Đã gửi job ${job.id} (${job.title}) qua tài khoản user ${job.created_by}${pastEnd ? ' — đã tới recurrence_until, dừng lặp' : ''}`)
    } catch (err) {
      // Lỗi thì đánh dấu 'error' và dừng lặp lại — tránh spam nhóm nếu lỗi
      // dai dẳng (vd session Zalo hết hạn); admin phải vào sửa/reset tay.
      const message = err instanceof Error ? err.message : String(err)
      const revoked = isSessionRevokedError(err)
      await supabase.from('zalo_scheduled_messages').update({
        status: 'error',
        last_error: revoked
          ? 'Tài khoản Zalo đã đăng nhập ở nơi khác, phiên bị ngắt — vào "Đăng nhập lại Zalo" rồi bấm Thử lại.'
          : message,
      }).eq('id', job.id)
      if (revoked) await markSessionRevoked(job.created_by)
      console.error(`[worker] Lỗi gửi job ${job.id}:`, message)
    }
  }
}

// Đồng bộ danh sách nhóm Zalo thật (tên + id) của user_id lên bảng
// zalo_groups để web hiển thị checklist ở form "Thêm lịch gửi tin".
//
// getGroupInfo() nhận nhiều ID cùng lúc nhưng gửi hết trong 1 request nếu
// không chia lô — acc ở nhiều nhóm dễ khiến request bị Zalo từ chối. Chia
// theo GROUP_INFO_BATCH_SIZE + log riêng từng bước để lỗi lô nào không
// làm mất toàn bộ danh sách, và biết chính xác bước nào hỏng.
async function syncGroups(userId) {
  const api = sessions.get(userId)
  if (!api) return

  let groupIds
  try {
    const { gridVerMap } = await api.getAllGroups()
    groupIds = Object.keys(gridVerMap)
  } catch (err) {
    if (isSessionRevokedError(err)) await markSessionRevoked(userId)
    console.error(`[worker] Lỗi getAllGroups() cho user ${userId}:`, err instanceof Error ? err.message : err)
    return
  }
  if (groupIds.length === 0) return

  const rows = []
  for (let i = 0; i < groupIds.length; i += GROUP_INFO_BATCH_SIZE) {
    const batch = groupIds.slice(i, i + GROUP_INFO_BATCH_SIZE)
    try {
      const { gridInfoMap } = await api.getGroupInfo(batch)
      for (const [id, info] of Object.entries(gridInfoMap)) {
        rows.push({ user_id: userId, zalo_group_id: id, zalo_group_name: info.name ?? null, synced_at: new Date().toISOString() })
      }
    } catch (err) {
      console.error(`[worker] Lỗi getGroupInfo() cho user ${userId}, lô ${i}-${i + batch.length}:`, err instanceof Error ? err.message : err)
    }
  }
  if (rows.length === 0) {
    console.error(`[worker] Không lấy được thông tin nhóm nào cho user ${userId} (tổng ${groupIds.length} ID từ getAllGroups)`)
    return
  }

  const { error } = await supabase.from('zalo_groups').upsert(rows, { onConflict: 'user_id,zalo_group_id' })
  if (error) console.error('[worker] Lỗi ghi zalo_groups:', error.message)
  else console.log(`[worker] Đã đồng bộ ${rows.length}/${groupIds.length} nhóm Zalo cho user ${userId}`)
}

// Đồng bộ danh bạ bạn bè Zalo (cá nhân, khác nhóm) của user_id lên bảng
// zalo_contacts — hiện chỉ để có sẵn dữ liệu, CHƯA dùng để gửi tin (lịch
// gửi tin vẫn chỉ gửi nhóm).
async function syncContacts(userId) {
  const api = sessions.get(userId)
  if (!api) return

  let friends
  try {
    friends = await api.getAllFriends()
  } catch (err) {
    if (isSessionRevokedError(err)) await markSessionRevoked(userId)
    console.error(`[worker] Lỗi getAllFriends() cho user ${userId}:`, err instanceof Error ? err.message : err)
    return
  }
  if (!friends || friends.length === 0) return

  const rows = friends.map(f => ({
    user_id: userId,
    zalo_user_id: f.userId,
    display_name: f.displayName ?? null,
    zalo_name: f.zaloName ?? null,
    phone_number: f.phoneNumber ?? null,
    synced_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('zalo_contacts').upsert(rows, { onConflict: 'user_id,zalo_user_id' })
  if (error) console.error('[worker] Lỗi đồng bộ danh bạ:', error.message)
  else console.log(`[worker] Đã đồng bộ ${rows.length} liên hệ Zalo cho user ${userId}`)
}

async function syncAllGroups() {
  for (const userId of sessions.keys()) await syncGroups(userId)
}

async function syncAllContacts() {
  for (const userId of sessions.keys()) await syncContacts(userId)
}

// Nút "Đồng bộ ngay" ghi sync_requested=true trên đúng dòng của user đó —
// quét TẤT CẢ dòng đang bật cờ (thường chỉ 1 tại 1 thời điểm) mỗi ~4s,
// dùng chung nhịp poll nhanh với luồng đăng nhập QR.
async function checkSyncRequests() {
  const { data: rows } = await supabase
    .from('zalo_session')
    .select('user_id')
    .eq('sync_requested', true)
  if (!rows || rows.length === 0) return

  for (const row of rows) {
    await supabase.from('zalo_session').update({ sync_requested: false }).eq('user_id', row.user_id)
    await Promise.all([syncGroups(row.user_id), syncContacts(row.user_id)])
  }
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

// Xử lý MỌI yêu cầu đăng nhập đang chờ (status='requested') — mỗi nhân
// viên bấm nút ở trang riêng của mình ghi đúng dòng user_id của họ, worker
// xử lý song song (không đợi người này quét xong QR mới xử lý người kia).
async function checkLoginRequests() {
  const { data: rows } = await supabase
    .from('zalo_session')
    .select('user_id')
    .eq('status', 'requested')
  if (!rows || rows.length === 0) return

  for (const row of rows) {
    if (loginInProgress.has(row.user_id)) continue
    handleLoginRequest(row.user_id).catch(err => console.error(`[worker] Lỗi xử lý đăng nhập user ${row.user_id}:`, err))
  }
}

async function handleLoginRequest(userId) {
  loginInProgress.add(userId)
  let terminal = false // đã có kết quả rõ ràng (expired/declined) từ callback, khỏi ghi đè 'error' chung chung
  await supabase.from('zalo_session').update({ status: 'in_progress', qr_image: null, error_message: null }).eq('user_id', userId)

  try {
    const zalo = new Zalo()
    let credentials = null

    const newApi = await zalo.loginQR({}, (event) => {
      const patch = eventToPatch(event)
      if (patch) {
        if (patch.status === 'expired' || patch.status === 'declined') terminal = true
        supabase.from('zalo_session').update(patch).eq('user_id', userId)
          .then(({ error }) => { if (error) console.error('[worker] Lỗi ghi trạng thái QR:', error.message) })
      }
      if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
        credentials = { imei: event.data.imei, cookie: event.data.cookie, userAgent: event.data.userAgent, language: 'vi' }
      }
    })

    await supabase.from('zalo_session').update({
      status: 'done', credentials, qr_image: null, error_message: null,
    }).eq('user_id', userId)
    sessions.set(userId, newApi)
    console.log(`[worker] User ${userId} đăng nhập Zalo qua QR thành công`)
    syncGroups(userId).catch(err => console.error('[worker] Lỗi đồng bộ nhóm sau đăng nhập:', err))
    syncContacts(userId).catch(err => console.error('[worker] Lỗi đồng bộ danh bạ sau đăng nhập:', err))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!terminal) {
      await supabase.from('zalo_session').update({ status: 'error', error_message: message, qr_image: null }).eq('user_id', userId)
    }
    console.error(`[worker] Lỗi xử lý đăng nhập user ${userId}:`, message)
  } finally {
    loginInProgress.delete(userId)
  }
}

// Lúc khởi động: nạp lại TOÀN BỘ session đã lưu (mỗi nhân viên từng đăng
// nhập trước đó), không chỉ 1 dòng cố định như hồi còn 1 bot chung.
async function loadStoredSessions() {
  const { data } = await supabase.from('zalo_session').select('user_id, credentials').not('credentials', 'is', null)
  if (!data || data.length === 0) {
    console.log('[worker] Chưa có session Zalo nào được lưu — mỗi người tự vào "Đăng nhập lại Zalo" để quét QR.')
    return
  }
  for (const row of data) {
    try {
      const zalo = new Zalo()
      const api = await zalo.login(row.credentials)
      sessions.set(row.user_id, api)
      console.log(`[worker] Login Zalo thành công cho user ${row.user_id} (dùng session đã lưu trong Supabase)`)
      syncGroups(row.user_id).catch(err => console.error('[worker] Lỗi đồng bộ nhóm sau đăng nhập:', err))
      syncContacts(row.user_id).catch(err => console.error('[worker] Lỗi đồng bộ danh bạ sau đăng nhập:', err))
    } catch (err) {
      console.error(`[worker] Session đã lưu của user ${row.user_id} không login được nữa (có thể hết hạn):`, err)
      console.log(`[worker] User ${row.user_id} cần vào "Đăng nhập lại Zalo" để quét QR mới.`)
    }
  }
}

async function main() {
  await loadStoredSessions()

  const tick = (fn) => () => {
    fn().catch((err) => {
      // 1 vòng poll lỗi không được làm chết process — vòng sau vẫn chạy.
      console.error('[worker] Lỗi không mong đợi trong vòng poll:', err)
    })
  }

  const runJobsTick = tick(processDueJobs)
  const runLoginTick = tick(checkLoginRequests)
  const runGroupSyncTick = tick(syncAllGroups)
  const runContactSyncTick = tick(syncAllContacts)
  const runSyncRequestTick = tick(checkSyncRequests)

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
