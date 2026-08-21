import React, { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, HCProfile, HCEmployee, HCSubscriber } from '../lib/supabase'
 
export interface Permissions {
  dashboard: boolean
  enquiries: boolean
  income: boolean
  calendar: boolean
  customers: boolean
  expenses: boolean
  shareLinks: boolean
  accounts: boolean
}
 
const DEFAULT_OWNER_PERMISSIONS: Permissions = {
  dashboard: true,
  enquiries: true,
  income: true,
  calendar: true,
  customers: true,
  expenses: true,
  shareLinks: true,
  accounts: true,
}
 
const DEFAULT_EMPLOYEE_PERMISSIONS: Permissions = {
  dashboard: false,
  enquiries: true,
  income: true,
  calendar: true,
  customers: false,
  expenses: false,
  shareLinks: false,
  accounts: false,
}
 
interface AuthContextType {
  user: User | null
  session: Session | null
  profile: HCProfile | null
  subscriber: HCSubscriber | null
  employee: HCEmployee | null
  isOwner: boolean
  isSuperAdmin: boolean
  tenantId: string | null
  permissions: Permissions
  loading: boolean
  accessError: string | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}
 
const AuthContext = createContext<AuthContextType | null>(null)
 
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user,        setUser]        = useState<User | null>(null)
  const [session,     setSession]     = useState<Session | null>(null)
  const [profile,     setProfile]     = useState<HCProfile | null>(null)
  const [subscriber,  setSubscriber]  = useState<HCSubscriber | null>(null)
  const [employee,    setEmployee]    = useState<HCEmployee | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [accessError, setAccessError] = useState<string | null>(null)
 
  const fetchProfile = async (userId: string) => {
    setAccessError(null)
 
    // 1. Load business profile (settings)
    const { data: prof } = await supabase
      .from('hc_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile(prof)
 
    // 2. Check if super admin — skip subscriber check
    if (prof?.is_super_admin) {
      setSubscriber(null)
      setEmployee(null)
      return
    }
 
    // 3. Check hc_subscribers — is this an active tenant?
    const { data: sub } = await supabase
      .from('hc_subscribers')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle()
 
    if (sub) {
      // Check if account is active
      if (!sub.is_active) {
        setAccessError('Your account has been deactivated. Please contact Hillscamp.')
        await supabase.auth.signOut()
        setUser(null); setSession(null); setProfile(null); setSubscriber(null)
        return
      }
 
      // Check if subscription has expired
      if (sub.subscription_expires) {
        const expiry = new Date(sub.subscription_expires)
        if (expiry < new Date()) {
          setAccessError('Your subscription has expired. Please contact Hillscamp to renew.')
          await supabase.auth.signOut()
          setUser(null); setSession(null); setProfile(null); setSubscriber(null)
          return
        }
      }
 
      setSubscriber(sub as HCSubscriber)
      setEmployee(null)
      return
    }
 
    // 4. Check hc_employees — is this an active employee?
    const { data: emp } = await supabase
      .from('hc_employees')
      .select('*')
      .eq('auth_user_id', userId)
      .eq('is_active', true)
      .maybeSingle()
 
    if (emp) {
      // Also check if their parent tenant is still active
      const { data: tenantSub } = await supabase
        .from('hc_subscribers')
        .select('is_active, subscription_expires')
        .eq('auth_user_id', emp.tenant_id)
        .maybeSingle()
 
      if (tenantSub) {
        if (!tenantSub.is_active) {
          setAccessError('Your account has been deactivated. Please contact Hillscamp.')
          await supabase.auth.signOut()
          setUser(null); setSession(null); setProfile(null); setSubscriber(null)
          return
        }
        if (tenantSub.subscription_expires) {
          const expiry = new Date(tenantSub.subscription_expires)
          if (expiry < new Date()) {
            setAccessError('Your subscription has expired. Please contact Hillscamp to renew.')
            await supabase.auth.signOut()
            setUser(null); setSession(null); setProfile(null); setSubscriber(null)
            return
          }
        }
      }
 
      setEmployee(emp)
      setSubscriber(null)
      return
    }
 
    // 5. Not found anywhere — block access
    setAccessError('No account found. Please contact Hillscamp.')
    await supabase.auth.signOut()
    setUser(null); setSession(null); setProfile(null)
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
      if (session?.user) {
        setLoading(true)
        fetchProfile(session.user.id).finally(() => setLoading(false))
      } else { setProfile(null); setSubscriber(null); setEmployee(null) }
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
    setSubscriber(null)
    setEmployee(null)
  }
 
  // Super admin = has hc_profiles row with is_super_admin = true
  const isSuperAdmin = !!(profile?.is_super_admin)
 
  // Owner = is a subscriber (not an employee)
  const isOwner = !!subscriber || isSuperAdmin
 
  // tenantId — always auth user id for consistency across all data tables
  const tenantId = employee ? employee.tenant_id : user?.id ?? null
 
  // Permissions
  const permissions: Permissions = isOwner
    ? DEFAULT_OWNER_PERMISSIONS
    : {
        ...DEFAULT_EMPLOYEE_PERMISSIONS,
        ...(employee?.permissions as Partial<Permissions> || {}),
      }
 
  return (
    <AuthContext.Provider value={{
      user, session, profile, subscriber, employee,
      isOwner, isSuperAdmin, tenantId, permissions,
      loading, accessError, signIn, signOut, refreshProfile,
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