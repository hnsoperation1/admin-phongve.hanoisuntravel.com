import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Dùng chung cho mọi route API — RLS của zalo_scheduled_messages cố ý
// default-deny (xem migration_zalo_scheduled_messages.sql trong hns-crm),
// nên mọi route đọc/ghi phải tự check quyền ở đây rồi mới dùng
// service_role client. Cùng logic requireKeToan() bên hns-crm để 1 tài
// khoản có quyền ở CRM thì cũng có quyền ở app này (SSO).
export async function requireKeToan() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('is_super_admin, role, email')
    .eq('id', user.id)
    .single()
  if (!profile) return null
  if (profile.is_super_admin || profile.role === 'boss') return user
  if (!profile.email) return null

  const admin = createAdminClient()
  const { data: allow } = await admin
    .from('ke_toan_allowlist')
    .select('email')
    .eq('email', profile.email)
    .maybeSingle()
  return allow ? user : null
}
