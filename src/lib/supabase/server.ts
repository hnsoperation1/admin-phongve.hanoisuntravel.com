import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { cookieDomainForHost } from './cookie-domain'

export async function createClient() {
  const cookieStore = await cookies()
  const host = (await headers()).get('host')
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Cùng domain cookie SSO với client.ts (xem cookie-domain.ts) — nếu
      // không set, mỗi lần route/RSC này tự refresh token sẽ ghi cookie
      // scope host hiện tại (admin-phongve.hanoisuntravel.com) thay vì
      // .hanoisuntravel.com, lệch với cookie browser đang dùng.
      cookieOptions: { domain: cookieDomainForHost(host), sameSite: 'lax', secure: true },
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    },
  )
}
