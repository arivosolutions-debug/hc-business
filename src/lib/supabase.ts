/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'
 
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
 
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}
 
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
 
// ── Profiles ──────────────────────────────────────────────
export interface HCProfile {
  id: string; business_name: string | null; owner_name: string | null
  phone: string | null; address: string | null; gst_number: string | null
  logo_url: string | null; plan_type: string; is_active: boolean
  subscription_expires: string | null; onboarding_complete: boolean
  created_at: string; updated_at: string
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
  base_price: number | null; is_active: boolean; sort_order: number
  created_at: string; updated_at: string
}
 
// ── Customers (lean personal info — new table) ────────────
// One record per unique person, identified by phone number.
// Auto-created when an enquiry is saved.
export interface HCCustomer {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  email: string | null
  created_at: string
  updated_at: string
  // populated by join
  enquiry_count?: number
  last_enquiry_date?: string | null
  enquiries?: HCEnquiry[]
}
 
// ── Enquiries (was hc_customers — bookings and leads) ─────
// Every booking or lead enquiry. Linked to a customer record.
export interface HCEnquiry {
  id: string; tenant_id: string
  customer_id: string | null   // links to hc_customers
  name: string
  phone: string | null; email: string | null
  source: string; status: string
  interest: string | null
  check_in: string | null; check_out: string | null
  guests: number
  enquiry_date: string | null   // when the lead actually contacted you
  total_price: number | null    // full agreed price
  amount_paid: number | null    // how much received (single source of truth)
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
  enquiry_id: string | null   // renamed from customer_id
  advance_paid: number; balance_due: number; expected_date: string | null
  amount: number; description: string | null; category: string | null
  payment_type: string | null; date: string; receipt_number: string | null
  confirmed_at: string | null; confirmed_by: string | null
  created_by: string | null; notes: string | null
  created_at: string; updated_at: string
  // joined from hc_enquiries
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
  new: 1, contacted: 2, booked: 3, completed: 4, noresponse: 5, cancelled: 6,
}
 
// ── Helpers ───────────────────────────────────────────────
export const fmt = (n: number | null | undefined) =>
  n ? '₹' + Math.round(n).toLocaleString('en-IN') : '₹0'
 
// Parse date strings at noon to avoid UTC-midnight timezone off-by-one errors
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