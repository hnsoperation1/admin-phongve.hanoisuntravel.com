import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Dùng chung cho mọi route API — RLS của zalo_scheduled_messages cố ý
// default-deny (xem migration_zalo_scheduled_messages.sql trong hns-crm),
// nên mọi route đọc/ghi phải tự check quyền ở đây rồi mới dùng
// service_role client.
//
// Quyền vào app này TÁCH RIÊNG khỏi ke_toan/role (đổi từ requireKeToan()
// cũ, vốn tái dùng nhầm quyền Kế toán) — chọn thủ công từng tài khoản ở
// crm.hanoisuntravel.com/admin/users, mục "App Phòng vé"
// (phong_ve_allowlist). KHÔNG tự cấp theo role==='boss' như trước nữa —
// muốn boss vào thì phải add thủ công vào allowlist này.
export async function requirePhongVe() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('is_super_admin, email')
    .eq('id', user.id)
    .single()
  if (!profile) return null
  if (profile.is_super_admin) return user
  if (!profile.email) return null

  const admin = createAdminClient()
  const { data: allow } = await admin
    .from('phong_ve_allowlist')
    .select('email')
    .eq('email', profile.email)
    .maybeSingle()
  return allow ? user : null
}

// Dùng riêng cho trang "Danh mục Zalo" (/danh-muc-zalo) + API nó gọi
// (/api/zalo-contacts, /api/zalo-sync-request) — danh bạ bạn bè Zalo có số
// điện thoại cá nhân, KHÔNG mở cho phong_ve_allowlist như requirePhongVe()
// ở trên. Cùng logic requireSuperAdmin() bên hns-crm.
export async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('is_super_admin').eq('id', user.id).single()
  return profile?.is_super_admin ? user : null
}
