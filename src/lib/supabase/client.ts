import { createBrowserClient } from '@supabase/ssr'

// SSO với CRM (crm.hanoisuntravel.com): cùng 1 Supabase project, và cookie
// session đặt domain CHUNG `.hanoisuntravel.com` (thay vì mặc định chỉ
// đúng host hiện tại) — nên user đã đăng nhập CRM thì app này tự đọc được
// session đó, không cần đăng nhập lại. Bắt buộc `hns-crm`'s client.ts phải
// đặt CÙNG cookieOptions.domain này thì cookie login của CRM mới lan sang
// được subdomain khác — xem CLAUDE_MEMORY.md phần app "phòng vé" để biết
// đã đồng bộ chưa nếu sửa lại sau này.
function cookieDomain(): string | undefined {
  if (typeof window === 'undefined') return undefined
  // localhost lúc dev không set domain (cookie chỉ hoạt động đúng trên domain thật)
  return window.location.hostname.endsWith('hanoisuntravel.com') ? '.hanoisuntravel.com' : undefined
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { domain: cookieDomain(), sameSite: 'lax', secure: true } },
  )
}
