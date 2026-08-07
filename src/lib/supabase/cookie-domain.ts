// Domain cookie SSO chung .hanoisuntravel.com — dùng bởi cả client.ts và
// server.ts (app này không có middleware.ts) để mọi lần ghi cookie (kể cả
// lúc tự refresh token trong Server Component/route handler) đều cùng 1
// scope. Trước đây chỉ client.ts set domain này, server.ts không set gì
// (mặc định host hiện tại) — sinh cookie lệch domain, góp phần gây vòng
// lặp redirect /login <-> / bên hns-crm (2 app share chung cookie domain
// nên lệch ở bên này cũng ảnh hưởng bên kia). Xem cùng file này bên
// hns-crm/src/lib/supabase/cookie-domain.ts.
export function cookieDomainForHost(rawHost: string | undefined | null): string | undefined {
  const host = (rawHost ?? '').split(':')[0]
  return host.endsWith('hanoisuntravel.com') ? '.hanoisuntravel.com' : undefined
}
