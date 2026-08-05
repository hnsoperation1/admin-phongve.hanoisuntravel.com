import { createClient } from '@supabase/supabase-js'

// Dùng trong API route cron + route ghi dữ liệu — bypass RLS bằng
// service_role, tự route check quyền (không cho client gọi thẳng).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
