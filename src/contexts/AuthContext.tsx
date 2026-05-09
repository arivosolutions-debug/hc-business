import React, { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, HCProfile, HCEmployee } from '../lib/supabase'
 
export interface Permissions {
  dashboard: boolean
  enquiries: boolean
  income: boolean
  calendar: boolean
  customers: boolean
  expenses: boolean
}
 
const DEFAULT_OWNER_PERMISSIONS: Permissions = {
  dashboard: true,
  enquiries: true,
  income: true,
  calendar: true,
  customers: true,
  expenses: true,
}
 
const DEFAULT_EMPLOYEE_PERMISSIONS: Permissions = {
  dashboard: false,
  enquiries: true,
  income: true,
  calendar: true,
  customers: false,
  expenses: false,
}
 
interface AuthContextType {
  user: User | null
  session: Session | null
  profile: HCProfile | null
  employee: HCEmployee | null
  isOwner: boolean
  tenantId: string | null
  permissions: Permissions
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}
 
const AuthContext = createContext<AuthContextType | null>(null)
 
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user,    setUser]    = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<HCProfile | null>(null)
  const [employee, setEmployee] = useState<HCEmployee | null>(null)
  const [loading, setLoading] = useState(true)
 
  const fetchProfile = async (userId: string) => {
    const { data: prof } = await supabase
      .from('hc_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(prof)
 
    const { data: emp } = await supabase
      .from('hc_employees')
      .select('*')
      .eq('auth_user_id', userId)
      .eq('is_active', true)
      .maybeSingle()
    setEmployee(emp)
  }
 
  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id)
  }
 
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })
 
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setEmployee(null) }
    })
 
    return () => subscription.unsubscribe()
  }, [])
 
  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }
 
  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setEmployee(null)
  }
 
  // Owner = has hc_profiles row but no employee record
  const isOwner = !employee || employee.role === 'owner'
 
  // tenantId — for owner it's their own ID, for employee it's their tenant's ID
  const tenantId = employee ? employee.tenant_id : user?.id ?? null
 
  // Build permissions — owner gets everything, employee gets their specific permissions
  const permissions: Permissions = isOwner
    ? DEFAULT_OWNER_PERMISSIONS
    : {
        ...DEFAULT_EMPLOYEE_PERMISSIONS,
        ...(employee?.permissions as Partial<Permissions> || {}),
      }
 
  return (
    <AuthContext.Provider value={{
      user, session, profile, employee, isOwner, tenantId, permissions, loading, signIn, signOut, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
 
export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
 