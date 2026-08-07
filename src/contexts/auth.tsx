'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@/types'

interface AuthCtx {
  user: User | null
  loading: boolean
  logout: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

// Không có route /login riêng — session đến từ SSO với CRM (cookie chung
// domain .hanoisuntravel.com). Nếu không có session, AppShell sẽ tự
// redirect sang crm.hanoisuntravel.com/login?redirect=...
async function fetchProfile(supabase: ReturnType<typeof createClient>, userId: string, email?: string): Promise<User | null> {
  const { data } = await supabase.from('users').select('*').eq('id', userId).single()
  if (!data) return null

  let ke_toan = false
  let ke_toan_super_admin = false
  let phong_ve = false
  if (email) {
    const [{ data: allow }, { data: pv }] = await Promise.all([
      supabase.from('ke_toan_allowlist').select('is_super_admin').eq('email', email).maybeSingle(),
      supabase.from('phong_ve_allowlist').select('email').eq('email', email).maybeSingle(),
    ])
    if (allow) {
      ke_toan = true
      ke_toan_super_admin = !!allow.is_super_admin
    }
    phong_ve = !!pv
  }
  return { ...data, ke_toan, ke_toan_super_admin, phong_ve } as User
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(await fetchProfile(supabase, session.user.id, session.user.email))
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser(await fetchProfile(supabase, session.user.id, session.user.email))
      } else {
        setUser(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
