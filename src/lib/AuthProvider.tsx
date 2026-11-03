import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { AuthContext, type AuthState } from './auth'
import { supabase } from './supabase'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setReady(true)
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  const userId = session?.user.id ?? null
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: userId !== null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId ?? '')
        .single()
      if (error) throw error
      return data
    },
  })

  const profile = profileQuery.data ?? null
  const value: AuthState = {
    ready,
    session,
    profile,
    profileLoading: userId !== null && profileQuery.isPending,
    role: profile?.role ?? null,
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext value={value}>{children}</AuthContext>
}
