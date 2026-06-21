/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'
 
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
 
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}
 
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 
// ── Profiles — business settings only ─────────────────────
// Stores branding/settings configured by the tenant themselves
export interface HCProfile {
  id: string
  business_name: string | null
  owner_name: string | null
  phone: string | null
  address: string | null
  gst_number: string | null
  logo_url: string | null
  is_super_admin: boolean
  margin_enabled: boolean
  created_at: string
  updated_at: string
}
 
// ── Subscribers — tenant registry & access control ────────
// One row per onboarded business. Source of truth for who can log in.
export interface HCSubscriber {
  id: string
  auth_user_id: string
  business_name: string | null
  owner_name: string | null
  email: string | null
  phone: string | null
  is_active: boolean
  subscription_expires: string | null
  created_at: string
  updated_at: string
}
 
// ── Employees ─────────────────────────────────────────────
export interface HCEmployee {
  id: string; tenant_id: string; auth_user_id: string | null
  name: string; email: string; role: 'owner' | 'staff'
  role_label: string | null
  is_active: boolean; created_at: string; updated_at: string
  permissions: Record<string, boolean> | null
}
 
// ── Settings ──────────────────────────────────────────────
export interface HCSetting {
  id: string; tenant_id: string
  type: 'source' | 'status' | 'expense_category' | 'payment_type'
  value: string; sort_order: number; is_default: boolean; created_at: string
}
 
// ── Inventory ─────────────────────────────────────────────
export interface HCInventory {
  id: string; tenant_id: string; type: 'stay' | 'package' | 'other'
  name: string; description: string | null; capacity: number | null
  base_price: number | null; default_margin: number | null; is_active: boolean; sort_order: number
  created_at: string; updated_at: string
}
 
// ── Customers ─────────────────────────────────────────────
export interface HCCustomer {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  email: string | null
  created_at: string
  updated_at: string
  enquiry_count?: number
  last_enquiry_date?: string | null
  enquiries?: HCEnquiry[]
}
 
// ── Enquiries ─────────────────────────────────────────────
export interface HCEnquiry {
  id: string; tenant_id: string
  customer_id: string | null
  name: string
  phone: string | null; email: string | null
  source: string; status: string
  interest: string | null
  check_in: string | null; check_out: string | null
  guests: number
  enquiry_date: string | null
  total_price: number | null
  amount_paid: number | null
  margin: number | null
  discount: number | null
  conversation_log: ConversationEntry[]
  notes: string | null
  created_by: string | null; updated_by: string | null
  source_enquiry_id: string | null; ref: string | null
  created_at: string; updated_at: string
}
 
export interface ConversationEntry {
  date: string; text: string; added_by?: string
}
 
// ── Finance ───────────────────────────────────────────────
export interface HCFinance {
  id: string; tenant_id: string; type: 'income' | 'expense'
  status: 'draft' | 'confirmed'
  enquiry_id: string | null
  advance_paid: number; balance_due: number; expected_date: string | null
  amount: number; description: string | null; category: string | null
  payment_type: string | null; date: string; accounting_date: string | null; receipt_number: string | null
  confirmed_at: string | null; confirmed_by: string | null
  created_by: string | null; notes: string | null
  created_at: string; updated_at: string
  enquiry?: {
    name: string; phone: string | null
    total_price: number | null; amount_paid: number | null
    interest: string | null
    check_in: string | null; check_out: string | null
    guests: number | null
  }
}
 
// ── Status sort order ─────────────────────────────────────
export const STATUS_ORDER: Record<string, number> = {
  contacted: 1, booked: 2, completed: 3, noresponse: 4, cancelled: 5,
}
 
// ── Helpers ───────────────────────────────────────────────
export const fmt = (n: number | null | undefined) =>
  n ? '₹' + Math.round(n).toLocaleString('en-IN') : '₹0'
 
const safeDate = (d: string) => new Date(d.length === 10 ? d + 'T12:00:00' : d)
 
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  try {
    return safeDate(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch { return d }
}
 
export const fmtShortDate = (d: string | null | undefined) => {
  if (!d) return '—'
  try {
    return safeDate(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short',
    })
  } catch { return d }
}

// ── Activity log ──────────────────────────────────────────
export type HCActivityEntityType = 'enquiry' | 'income' | 'expense' | 'customer' | 'calendar_note' | 'employee' | 'business_profile' | 'inventory'

export interface HCActivityLog {
  id: string; tenant_id: string
  actor_id: string; actor_name: string; actor_role: 'owner' | 'staff'
  action: string
  entity_type: HCActivityEntityType
  entity_id: string | null
  description: string
  created_at: string
}

// Resolves "who is performing this action" from useAuth() values, for use with logActivity.
export const getActor = (args: {
  userId: string | undefined
  isOwner: boolean
  employeeName: string | undefined | null
  ownerName: string | undefined | null
}): { actorId: string; actorName: string; actorRole: 'owner' | 'staff' } => ({
  actorId:   args.userId || '',
  actorName: args.isOwner ? (args.ownerName || 'Owner') : (args.employeeName || 'Staff'),
  actorRole: args.isOwner ? 'owner' : 'staff',
})

// Fire-and-forget — never blocks or breaks the action it's attached to if logging fails.
export const logActivity = async (params: {
  tenantId: string
  actorId: string
  actorName: string
  actorRole: 'owner' | 'staff'
  action: string
  entityType: HCActivityEntityType
  entityId?: string | null
  description: string
}) => {
  try {
    const { error } = await supabase.from('hc_activity_log').insert({
      tenant_id:   params.tenantId,
      actor_id:    params.actorId,
      actor_name:  params.actorName,
      actor_role:  params.actorRole,
      action:      params.action,
      entity_type: params.entityType,
      entity_id:   params.entityId || null,
      description: params.description,
    })
    if (error) console.error('logActivity insert failed:', error.message, error)
  } catch (err) { console.error('logActivity threw:', err) /* never break the real action */ }
}