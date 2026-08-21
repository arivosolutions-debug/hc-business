import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCEnquiry, HCCustomer, fmt, fmtDate, STATUS_ORDER, logActivity, getActor } from '../lib/supabase'
import { draftKey, saveDraft, loadDraft, clearDraft } from '../lib/drafts'
import * as XLSX from 'xlsx'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const PAGE_SIZE = 50
 
const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  contacted:  { label:'Contacted',   bg:'#fef9c3', color:'#854f0b' },
  booked:     { label:'Booked',      bg:'#dcfce7', color:'#166534' },
  completed:  { label:'Completed',   bg:'#d1fae5', color:'#065f46' },
  noresponse: { label:'No response', bg:'#f3f4f6', color:'#6b7280' },
  cancelled:  { label:'Cancelled',   bg:'#fee2e2', color:'#991b1b' },
}

// Statuses a person can manually choose. "Completed" is set automatically — see load() —
// once a booking is fully paid and its check-out date has passed.
const SELECTABLE_STATUS: Record<string, { label: string; bg: string; color: string }> =
  Object.fromEntries(Object.entries(STATUS).filter(([k]) => k !== 'completed'))

// Internal-only rating — never shown as a column in the Enquiries table itself,
// only fillable here and surfaced later on the CRM share link.
const LEAD_QUALITY_OPTIONS: { key: string; label: string; bg: string; color: string }[] = [
  { key:'good',    label:'Good',    bg:'#dcfce7', color:'#166534' },
  { key:'average', label:'Average', bg:'#fef9c3', color:'#854f0b' },
  { key:'poor',    label:'Poor',    bg:'#fee2e2', color:'#991b1b' },
]
 
const DEFAULT_SOURCES = ['WhatsApp DM','Instagram DM','Website form','Phone call','Walk-in','Referral','Other']
const DEFAULT_PAYMENT_TYPES = ['UPI','Cash','Bank transfer','Cheque']
const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const inpRO: React.CSSProperties = { ...inp, background:'#f9fafb', color:'#6b7280', cursor:'not-allowed' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
 
const Badge = ({ status }: { status: string }) => {
  const s = STATUS[status] || { label: status, bg:'#f3f4f6', color:'#6b7280' }
  return <span style={{ display:'inline-block', padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:500, background:s.bg, color:s.color, whiteSpace:'nowrap' }}>{s.label}</span>
}
 
const rupee = (n: number | null | undefined) => n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—'

// ── Stale enquiry detection ──
const isStaleContacted = (e: HCEnquiry) => {
  if (e.status !== 'contacted') return false
  const lastTouched = new Date(e.updated_at).getTime()
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000
  return Date.now() - lastTouched >= tenDaysMs
}
 
const BLANK = () => ({
  name:'', phone:'', email:'', source:'WhatsApp DM', status:'contacted',
  interest:'', check_in:'', check_out:'', guests:'1',
  total_price:'', amount_paid:'0', discount:'0', notes:'',
  payment_type:'UPI', lead_quality:'',
  enquiry_date: new Date().toISOString().slice(0, 10),
})
 
export const Enquiries: React.FC = () => {
  const { user, tenantId, isOwner, profile, employee } = useAuth()
  const location = useLocation()

  // Apply drill-down filters passed in via navigation from the Dashboard (runs once on mount)
  useEffect(() => {
    const incoming = location.state as {
      status?: string; source?: string
      enqDateFrom?: string; enqDateTo?: string
      checkInFrom?: string; checkInTo?: string
      checkOutFrom?: string; checkOutTo?: string
      openEnquiryId?: string; label?: string
    } | null
    if (!incoming) return
    if (incoming.status) setFilterStatus(incoming.status)
    if (incoming.source) setFilterSource(incoming.source)
    if (incoming.enqDateFrom) setEnqDateFrom(incoming.enqDateFrom)
    if (incoming.enqDateTo) setEnqDateTo(incoming.enqDateTo)
    if (incoming.checkInFrom) setDateFrom(incoming.checkInFrom)
    if (incoming.checkInTo) setDateTo(incoming.checkInTo)
    if (incoming.checkOutFrom) setCheckOutFrom(incoming.checkOutFrom)
    if (incoming.checkOutTo) setCheckOutTo(incoming.checkOutTo)
    if (incoming.openEnquiryId) setPendingOpenId(incoming.openEnquiryId)
    if (incoming.label) setDrillLabel(incoming.label)
    // Clear navigation state so a page refresh doesn't re-apply it
    window.history.replaceState({}, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearDrillDown = () => {
    setFilterStatus(''); setFilterSource(''); setFilterMonth('')
    setDateFrom(''); setDateTo(''); setEnqDateFrom(''); setEnqDateTo('')
    setCheckOutFrom(''); setCheckOutTo(''); setDrillLabel('')
  }
  const [enquiries, setEnquiries] = useState<HCEnquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Drill-down filters — only ever set by navigating in from the Dashboard, not exposed in the manual filter bar
  const [enqDateFrom, setEnqDateFrom] = useState('')
  const [enqDateTo, setEnqDateTo] = useState('')
  const [checkOutFrom, setCheckOutFrom] = useState('')
  const [checkOutTo, setCheckOutTo] = useState('')
  const [drillLabel, setDrillLabel] = useState('')
  // Calendar-day filter — a quick-pick calendar popover in the filter bar.
  // Reuses the exact same enqDateFrom/enqDateTo/drillLabel state as the
  // Dashboard drill-down, so clicking a day here behaves identically.
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [pendingOpenId, setPendingOpenId] = useState('')
  const [page, setPage] = useState(1)
 
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(BLANK())
  const [saving, setSaving] = useState(false)

  // ── Draft auto-save: Add Enquiry form ──────────────────────────────────
  // Restores a half-filled enquiry if the browser tab got reloaded mid-entry
  // (e.g. switching to WhatsApp on Android and the tab losing its memory).
  const addDraftKeyRef = useRef<string>('')
  useEffect(() => {
    if (!tenantId || !user) return
    addDraftKeyRef.current = draftKey(tenantId, user.id, 'enquiry_add')
    const draft = loadDraft<ReturnType<typeof BLANK>>(addDraftKeyRef.current)
    if (draft && (draft.name || draft.phone || draft.total_price || draft.notes)) {
      setAddForm(draft)
      setShowAdd(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, user])

  useEffect(() => {
    if (!showAdd || !addDraftKeyRef.current) return
    const hasContent = addForm.name || addForm.phone || addForm.total_price || addForm.notes
    const t = setTimeout(() => {
      if (hasContent) saveDraft(addDraftKeyRef.current, addForm)
      else clearDraft(addDraftKeyRef.current)
    }, 500)
    return () => clearTimeout(t)
  }, [addForm, showAdd])

  // Dynamic options
  const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES)
  const [paymentTypes, setPaymentTypes] = useState<string[]>(DEFAULT_PAYMENT_TYPES)
  // Split payments — always at least one row. Adding a method just appends
  // another row; amount_paid is always kept in sync as the sum of these rows,
  // so entering a payment feels like "keep adding what came in," never like
  // dividing a pre-set total into parts.
  const [addPaymentSplits, setAddPaymentSplits] = useState<{ id: string; amount: string; payment_type: string }[]>(
    [{ id: crypto.randomUUID(), amount: '', payment_type: 'UPI' }]
  )
  const [editPaymentSplits, setEditPaymentSplits] = useState<{ id: string; amount: string; payment_type: string }[]>(
    [{ id: crypto.randomUUID(), amount: '', payment_type: 'UPI' }]
  )

  const cancelAdd = () => {
    if (addDraftKeyRef.current) clearDraft(addDraftKeyRef.current)
    setAddForm(BLANK())
    setAddPaymentSplits([{ id: crypto.randomUUID(), amount: '', payment_type: 'UPI' }])
    setShowAdd(false)
  }

  // Split-payment helpers — always-on rows, no separate "split mode" to toggle into
  const updateAddSplit = (i: number, field: 'amount' | 'payment_type', value: string) => {
    setAddPaymentSplits(prev => {
      const next = prev.map((sp, idx) => idx === i ? { ...sp, [field]: value } : sp)
      const total = next.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
      setAddForm(f => ({ ...f, amount_paid: String(total), payment_type: next[0].payment_type }))
      return next
    })
  }
  const addMoreAddSplitRow = () => {
    setAddPaymentSplits(prev => {
      const used = new Set(prev.map(sp => sp.payment_type))
      const nextType = paymentTypes.find(pt => !used.has(pt)) || paymentTypes[0] || 'UPI'
      return [...prev, { id: crypto.randomUUID(), amount: '', payment_type: nextType }]
    })
  }
  const removeAddSplitRow = (i: number) => {
    setAddPaymentSplits(prev => {
      if (prev.length <= 1) return prev // always keep at least one row
      const next = prev.filter((_, idx) => idx !== i)
      const total = next.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
      setAddForm(f => ({ ...f, amount_paid: String(total), payment_type: next[0].payment_type }))
      return next
    })
  }
 
  const [interests, setInterests] = useState<string[]>([])
  const [inventoryMap, setInventoryMap] = useState<Record<string, number | null>>({})
  const [marginMap, setMarginMap] = useState<Record<string, number | null>>({})
  const [addingSource, setAddingSource] = useState(false)
  const [newSource, setNewSource] = useState('')
  const [addingInterest, setAddingInterest] = useState(false)
  const [newInterest, setNewInterest] = useState('')
  const [addingEditSource, setAddingEditSource] = useState(false)
  const [newEditSource, setNewEditSource] = useState('')
  const [addingEditInterest, setAddingEditInterest] = useState(false)
  const [newEditInterest, setNewEditInterest] = useState('')
  const [managingSources, setManagingSources] = useState(false)
  const [managingInterests, setManagingInterests] = useState(false)
 
  const [panel, setPanel] = useState<HCEnquiry | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [newNote, setNewNote] = useState('')
  const [toast, setToast] = useState('')
 
  // Autofill state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<HCCustomer[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [phoneSuggestion, setPhoneSuggestion] = useState<HCCustomer | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)
 
  // Duplicate customer confirmation
  const [dupCustomer, setDupCustomer] = useState<HCCustomer | null>(null)
  const [pendingSave, setPendingSave] = useState<(() => void) | null>(null)
 
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }
  const resetPage = () => setPage(1)
 
  const load = useCallback(async () => {
    if (!user) return
    const [{ data }, { data: srcData }, { data: invData }, { data: payData }] = await Promise.all([
      supabase.from('hc_enquiries').select('*').eq('tenant_id', tenantId).order('enquiry_date', { ascending: false, nullsFirst: false }),
      supabase.from('hc_settings').select('value').eq('tenant_id', tenantId).eq('type', 'source').order('sort_order'),
      supabase.from('hc_inventory').select('name, base_price, default_margin').eq('tenant_id', tenantId).eq('is_active', true).order('sort_order'),
      supabase.from('hc_settings').select('value').eq('tenant_id', tenantId).eq('type', 'payment_type').order('sort_order'),
    ])
    const enqRecords = (data as HCEnquiry[]) || []

    // Auto-complete: a booking moves from Booked → Completed once check-out has passed
    // and it's fully paid. This is the only way an enquiry becomes Completed — it's never
    // manually selectable (see SELECTABLE_STATUS above).
    const todayStr = new Date().toISOString().slice(0, 10)
    const toComplete = enqRecords.filter(e =>
      e.status === 'booked' &&
      e.check_out && e.check_out < todayStr &&
      (e.total_price || 0) > 0 &&
      (e.amount_paid || 0) >= (e.total_price || 0)
    )
    if (toComplete.length > 0) {
      await supabase.from('hc_enquiries')
        .update({ status: 'completed' })
        .in('id', toComplete.map(e => e.id))
      const completedIds = new Set(toComplete.map(e => e.id))
      enqRecords.forEach(e => { if (completedIds.has(e.id)) e.status = 'completed' })
    }

    setEnquiries(enqRecords)
 
    // Merge sources from settings + sources already used in records
    const settingsSources = srcData && srcData.length > 0 ? srcData.map(s => s.value) : DEFAULT_SOURCES
    const recordSources = enqRecords.map(e => e.source).filter(Boolean) as string[]
    const mergedSources = Array.from(new Set([...settingsSources, ...recordSources]))
    const missingSources = mergedSources.filter(s => !settingsSources.includes(s))
    if (missingSources.length > 0 && tenantId) {
      try {
        await supabase.from('hc_settings').insert(
          missingSources.map((s, i) => ({ tenant_id: tenantId, type: 'source', value: s, sort_order: settingsSources.length + i }))
        )
      } catch (_) { /* ignore duplicate errors */ }
    }
    setSources(mergedSources)

    setPaymentTypes(payData && payData.length > 0 ? payData.map(p => p.value) : DEFAULT_PAYMENT_TYPES)
 
    // Merge interests from inventory + interests already used in records
    const invInterests = invData ? invData.map(i => i.name) : []
    const recordInterests = enqRecords.map(e => e.interest).filter(Boolean) as string[]
    const mergedInterests = Array.from(new Set([...invInterests, ...recordInterests]))
    // Only seed truly missing ones — not already in inventory
    const missingInterests = recordInterests.filter(i => !invInterests.includes(i))
    if (missingInterests.length > 0 && tenantId) {
      const uniqueMissing = Array.from(new Set(missingInterests))
      for (const name of uniqueMissing) {
        try {
          await supabase.from('hc_inventory').insert({ tenant_id: tenantId, name, type: 'stay', is_active: true, sort_order: invInterests.length })
        } catch (_) { /* ignore if already exists */ }
      }
    }
    setInterests(mergedInterests)
    // Build price map for auto-fill
    const priceMap: Record<string, number | null> = {}
    const marMap: Record<string, number | null> = {}
    if (invData) invData.forEach((i: { name: string; base_price: number | null; default_margin: number | null }) => { priceMap[i.name] = i.base_price; marMap[i.name] = i.default_margin })
    setInventoryMap(priceMap)
    setMarginMap(marMap)
    setLoading(false)
  }, [user, tenantId])
 
  const addSourceOption = async (val: string, isEdit = false) => {
    if (!val.trim() || !tenantId) return
    await supabase.from('hc_settings').insert({ tenant_id: tenantId, type: 'source', value: val.trim(), sort_order: sources.length })
    const newSources = [...sources, val.trim()]
    setSources(newSources)
    if (isEdit) { setNewEditSource(''); setAddingEditSource(false) }
    else { setNewSource(''); setAddingSource(false) }
  }
 
  const addInterestOption = async (val: string, isEdit = false) => {
    if (!val.trim() || !tenantId) return
    await supabase.from('hc_inventory').insert({ tenant_id: tenantId, name: val.trim(), type: 'stay', is_active: true, sort_order: interests.length })
    const newInterests = [...interests, val.trim()]
    setInterests(newInterests)
    if (isEdit) { setNewEditInterest(''); setAddingEditInterest(false) }
    else { setNewInterest(''); setAddingInterest(false) }
  }
 
  const deleteSourceOption = async (val: string) => {
    if (!tenantId) return
    await supabase.from('hc_settings').delete().eq('tenant_id', tenantId).eq('type', 'source').eq('value', val)
    setSources(prev => prev.filter(s => s !== val))
  }
 
  const deleteInterestOption = async (val: string) => {
    if (!tenantId) return
    await supabase.from('hc_inventory').delete().eq('tenant_id', tenantId).eq('name', val)
    setInterests(prev => prev.filter(i => i !== val))
  }
 
  useEffect(() => { load() }, [load])
 
  // ── Filtering + sort by status ─────────────────────────
  const filtered = enquiries.filter(e => {
    if (filterStatus && !filterStatus.split(',').includes(e.status)) return false
    if (filterSource && e.source !== filterSource) return false
    if (filterMonth !== '') {
      const d = e.enquiry_date || e.created_at
      if (new Date(d).getMonth() !== parseInt(filterMonth)) return false
    }
    if (dateFrom && e.check_in && e.check_in < dateFrom) return false
    if (dateTo && e.check_in && e.check_in > dateTo) return false
    if (checkOutFrom && e.check_out && e.check_out < checkOutFrom) return false
    if (checkOutTo && e.check_out && e.check_out > checkOutTo) return false
    if (enqDateFrom || enqDateTo) {
      const d = e.enquiry_date || e.created_at?.slice(0, 10) || ''
      if (enqDateFrom && d < enqDateFrom) return false
      if (enqDateTo && d > enqDateTo) return false
    }
    return true
  })
 
  // Sort by status priority, then by enquiry_date descending within same status
  const displayed = [...filtered].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] || 99
    const sb = STATUS_ORDER[b.status] || 99
    if (sa !== sb) return sa - sb
    if (a.status === 'booked') {
      const da = a.check_in || ''; const db = b.check_in || ''
      return da.localeCompare(db)
    }
    if (a.status === 'completed') {
      const da = a.check_out || ''; const db = b.check_out || ''
      return db.localeCompare(da)
    }
    const da = a.enquiry_date || a.created_at
    const db = b.enquiry_date || b.created_at
    return db.localeCompare(da)
  })
 
  const totalPages = Math.ceil(displayed.length / PAGE_SIZE)
  const paginated = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Days in the currently-displayed calendar month that have at least one enquiry —
  // drawn from data already loaded in memory, no extra query needed.
  const daysWithEnquiries = new Set(
    enquiries.map(e => e.enquiry_date || e.created_at?.slice(0, 10)).filter(Boolean)
  )

  const pickCalendarDay = (dateStr: string) => {
    setEnqDateFrom(dateStr)
    setEnqDateTo(dateStr)
    setDrillLabel(new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }))
    setShowCalendar(false)
    resetPage()
  }
 
  // ── Customer search (autofill) ─────────────────────────
  const searchCustomers = useCallback(async (q: string) => {
    if (!user || q.trim().length < 2) { setSearchResults([]); return }
    const { data } = await supabase
      .from('hc_customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(6)
    setSearchResults((data as HCCustomer[]) || [])
  }, [user])
 
  // Phone field live search — fires after 7 digits
  const handlePhoneChange = useCallback(async (phone: string) => {
    setAddForm(f => ({ ...f, phone }))
    if (!user || phone.replace(/\D/g, '').length < 7) { setPhoneSuggestion(null); return }
    const { data } = await supabase
      .from('hc_customers')
      .select('*')
      .eq('tenant_id', tenantId)
      .ilike('phone', `%${phone.replace(/\D/g, '').slice(-7)}%`)
      .limit(1)
    setPhoneSuggestion(data?.[0] as HCCustomer || null)
  }, [user])
 
  // Apply a customer suggestion to the add form
  const applyCustomer = (c: HCCustomer) => {
    setAddForm(f => ({ ...f, name: c.name, phone: c.phone || f.phone, email: c.email || f.email }))
    setSearchQuery('')
    setSearchResults([])
    setShowSearch(false)
    setPhoneSuggestion(null)
  }
 
  // ── Find or create customer, return customer_id ────────
  const resolveCustomer = async (name: string, phone: string, email: string): Promise<{ customerId: string | null; isExisting: boolean; existingCustomer: HCCustomer | null }> => {
    if (!user) return { customerId: null, isExisting: false, existingCustomer: null }
    const cleanPhone = phone?.trim()
 
    if (cleanPhone) {
      // Search by phone
      const { data } = await supabase
        .from('hc_customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('phone', cleanPhone)
        .limit(1)
      if (data && data.length > 0) {
        return { customerId: data[0].id, isExisting: true, existingCustomer: data[0] as HCCustomer }
      }
    }
 
    // Create new customer
    const { data: newCust } = await supabase
      .from('hc_customers')
      .insert({ tenant_id: tenantId, name: name.trim(), phone: cleanPhone || null, email: email?.trim() || null })
      .select()
      .single()
    return { customerId: newCust?.id || null, isExisting: false, existingCustomer: null }
  }
 
  // ── Add enquiry ────────────────────────────────────────
  const handleAdd = async (forceNewCustomer = false) => {
    if (!user || !addForm.name.trim()) { showToast('Name is required'); return }

    // Gate: a Contacted enquiry must have a phone number on file
    if (addForm.status === 'contacted' && !addForm.phone.trim()) {
      showToast('Phone number is required')
      return
    }

    // Gate: check-out cannot be before check-in (whenever both are filled in)
    if (addForm.check_in && addForm.check_out && addForm.check_out < addForm.check_in) {
      showToast('Check-out date cannot be before check-in date')
      return
    }

    // Auto-promote: a Contacted enquiry with dates and a payment already filled in
    // moves straight to Booked, no manual status switch needed.
    let finalStatus = addForm.status
    if (finalStatus === 'contacted') {
      const hasDates   = !!(addForm.check_in && addForm.check_out)
      const hasPayment = Math.max(0, parseFloat(addForm.amount_paid) || 0) > 0
      if (hasDates && hasPayment) {
        finalStatus = 'booked'
      } else if (hasPayment && !hasDates) {
        showToast('Add check-in and check-out dates to mark this as Booked')
        return
      }
    }

    // Gate: cannot mark as Booked without check-in and check-out dates
    if (finalStatus === 'booked' && (!addForm.check_in || !addForm.check_out)) {
      showToast('Check-in and check-out dates are required before marking as Booked')
      return
    }

    // Gate: cannot mark as Booked without an advance payment above zero
    if (finalStatus === 'booked' && (Math.max(0, parseFloat(addForm.amount_paid) || 0) <= 0)) {
      showToast('An advance payment is required before marking as Booked')
      return
    }

    // Checkpoint: creating a brand-new enquiry as Cancelled while also noting a
    // payment amount would leave that money with no ledger trail at all — since a
    // Cancelled enquiry never gets a linked income record. Make this a conscious choice.
    if (finalStatus === 'cancelled' && Math.max(0, parseFloat(addForm.amount_paid) || 0) > 0) {
      const keep = window.confirm(
        `You've entered ₹${Math.round(parseFloat(addForm.amount_paid) || 0).toLocaleString('en-IN')} as paid, but the status is Cancelled.\n\n` +
        `A Cancelled enquiry has no linked Income record — this amount will be saved on the enquiry itself but won't appear anywhere in Income or the accounts.\n\n` +
        `Click OK to save it this way anyway, or Cancel to change the status or amount first.`
      )
      if (!keep) return
    }

    setSaving(true)
 
    const totalPrice = Math.max(0, parseFloat(addForm.total_price) || 0)
    const amountPaid = Math.max(0, parseFloat(addForm.amount_paid) || 0)
 
    const { customerId, isExisting, existingCustomer } = await resolveCustomer(
      addForm.name, addForm.phone, addForm.email
    )
 
    // If existing customer found and name differs — show confirmation
    if (isExisting && existingCustomer && !forceNewCustomer) {
      const nameDiffers = existingCustomer.name.toLowerCase().trim() !== addForm.name.toLowerCase().trim()
      if (nameDiffers) {
        setDupCustomer(existingCustomer)
        setPendingSave(() => () => doAddEnquiry(customerId, totalPrice, amountPaid, finalStatus))
        setSaving(false)
        return
      }
    }
 
    await doAddEnquiry(customerId, totalPrice, amountPaid, finalStatus)
  }
 
  const doAddEnquiry = async (customerId: string | null, totalPrice: number, amountPaid: number, finalStatus: string) => {
    if (!user) return
    const entry = {
      date: new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short' }),
      text: addForm.notes || 'Enquiry recorded.',
      added_by: user.id,
    }
    const newId = crypto.randomUUID()
    const { error: addErr } = await supabase.from('hc_enquiries').insert({
      id:           newId,
      tenant_id:    tenantId,
      customer_id:  customerId,
      name:         addForm.name.trim(),
      phone:        addForm.phone || null,
      email:        addForm.email || null,
      source:       addForm.source,
      status:       finalStatus,
      interest:     addForm.interest || null,
      check_in:     addForm.check_in || null,
      check_out:    addForm.check_out || null,
      guests:       Math.max(1, parseInt(addForm.guests) || 1),
      total_price:  totalPrice,
      amount_paid:  amountPaid,
      discount:     Math.max(0, parseFloat(addForm.discount) || 0),
      margin:       Math.max(0, (marginMap[addForm.interest] || 0) - (Math.max(0, parseFloat(addForm.discount) || 0))),
      lead_quality: addForm.lead_quality || null,
      enquiry_date: addForm.enquiry_date || new Date().toISOString().slice(0, 10),
      conversation_log: [entry],
      created_by:   user.id,
      updated_by:   user.id,
    })

    if (addErr) {
      setSaving(false)
      showToast('Could not save — check your connection and try again')
      return
    }

    if (finalStatus === 'booked' && tenantId) {
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'enquiry_booked', entityType: 'enquiry', entityId: newId,
        description: `${actor.actorName} created and booked an enquiry for ${addForm.name.trim()} (₹${Math.round(amountPaid).toLocaleString('en-IN')} of ₹${Math.round(totalPrice).toLocaleString('en-IN')} paid)`,
      })
    } else if (tenantId) {
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'enquiry_created', entityType: 'enquiry', entityId: newId,
        description: `${actor.actorName} added a new enquiry for ${addForm.name.trim()}`,
      })
    }
    if (finalStatus === 'booked') {
      const finId = crypto.randomUUID()
      // Created with starting values — the ledger insert right after this is what
      // actually determines the true totals via the recompute trigger.
      const { error: finErr } = await supabase.from('hc_finance').insert({
        id: finId, tenant_id: tenantId, type: 'income',
        status: 'draft', enquiry_id: newId,
        amount: totalPrice, advance_paid: 0, balance_due: totalPrice,
        date: new Date().toISOString().slice(0,10),
        accounting_date: addForm.check_in || null,
        description: addForm.name.trim() + ' booking', created_by: user.id,
      })
      if (!finErr && amountPaid > 0 && tenantId) {
        const kind = amountPaid >= totalPrice ? 'full' : 'advance'
        const today = new Date().toISOString().slice(0, 10)
        const rows = addPaymentSplits.filter(sp => (parseFloat(sp.amount) || 0) > 0).map(sp => ({
          tenant_id: tenantId, finance_id: finId, enquiry_id: newId,
          amount: parseFloat(sp.amount) || 0, kind, payment_type: sp.payment_type,
          payment_date: today, recorded_by: user.id,
        }))
        await supabase.from('hc_payments').insert(rows)
      }
    }
    setSaving(false)
    if (addDraftKeyRef.current) clearDraft(addDraftKeyRef.current)
    setAddForm(BLANK())
    setAddPaymentSplits([{ id: crypto.randomUUID(), amount: '', payment_type: 'UPI' }])
    setShowAdd(false)
    setDupCustomer(null)
    setPendingSave(null)
    load()
    showToast(addForm.name + (finalStatus === 'booked' && addForm.status !== 'booked' ? ' added — automatically marked as Booked' : ' added'))
  }
 
  // ── Open edit panel ────────────────────────────────────
  const editDraftKeyRef = useRef<string>('')
  const openPanel = (e: HCEnquiry) => {
    setPanel(e)
    const fresh = {
      name:         e.name,
      phone:        e.phone || '',
      email:        e.email || '',
      source:       e.source,
      status:       e.status,
      interest:     e.interest || '',
      check_in:     e.check_in || '',
      check_out:    e.check_out || '',
      guests:       String(e.guests),
      total_price:  String(e.total_price || 0),
      amount_paid:  String(e.amount_paid || 0),
      discount:     String(e.discount || 0),
      payment_type: 'UPI',
      lead_quality: e.lead_quality || '',
      enquiry_date: e.enquiry_date || e.created_at?.slice(0, 10) || '',
    }
    if (tenantId && user) {
      editDraftKeyRef.current = draftKey(tenantId, user.id, 'enquiry_edit', e.id)
      const draft = loadDraft<typeof fresh>(editDraftKeyRef.current)
      setEditForm(draft || fresh)
    } else {
      setEditForm(fresh)
    }
    setEditPaymentSplits([{ id: crypto.randomUUID(), amount: '', payment_type: 'UPI' }])
    setNewNote('')
  }

  // Auto-open a specific enquiry's panel when navigated in from the Dashboard
  useEffect(() => {
    if (!pendingOpenId || enquiries.length === 0) return
    const target = enquiries.find(e => e.id === pendingOpenId)
    if (target) {
      openPanel(target)
      setPendingOpenId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenId, enquiries])

  // ── Draft auto-save: Edit panel ────────────────────────────────────────
  // If the tab reloaded while editing an enquiry, scan for an abandoned edit
  // draft on mount and silently reopen that record once the list has loaded.
  const [pendingEditDraftId, setPendingEditDraftId] = useState('')
  useEffect(() => {
    if (!tenantId || !user) return
    const prefix = `hc_draft_${tenantId}_${user.id}_enquiry_edit_`
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) {
        setPendingEditDraftId(k.slice(prefix.length))
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, user])

  useEffect(() => {
    if (!pendingEditDraftId || enquiries.length === 0) return
    const target = enquiries.find(e => e.id === pendingEditDraftId)
    if (target) openPanel(target)
    setPendingEditDraftId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEditDraftId, enquiries])

  useEffect(() => {
    if (!panel || !editDraftKeyRef.current) return
    const t = setTimeout(() => saveDraft(editDraftKeyRef.current, editForm), 500)
    return () => clearTimeout(t)
  }, [editForm, panel])

  const closePanel = () => {
    if (editDraftKeyRef.current) clearDraft(editDraftKeyRef.current)
    setEditPaymentSplits([{ id: crypto.randomUUID(), amount: '', payment_type: 'UPI' }])
    setPanel(null)
  }

  // Additional-payment rows — always at least one. These represent genuinely
  // NEW money coming in during this edit, added on top of "Already paid" (which
  // is independently editable below, for correcting a mistake in the record).
  const updateEditSplit = (i: number, field: 'amount' | 'payment_type', value: string) => {
    setEditPaymentSplits(prev => prev.map((sp, idx) => idx === i ? { ...sp, [field]: value } : sp))
  }
  const addMoreEditSplitRow = () => {
    setEditPaymentSplits(prev => {
      const used = new Set(prev.map(sp => sp.payment_type))
      const nextType = paymentTypes.find(pt => !used.has(pt)) || paymentTypes[0] || 'UPI'
      return [...prev, { id: crypto.randomUUID(), amount: '', payment_type: nextType }]
    })
  }
  const removeEditSplitRow = (i: number) => {
    setEditPaymentSplits(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
  }

  // ── Save edit panel ────────────────────────────────────
  const savePanel = async () => {
    if (!panel || !user) return

    // Gate: a Contacted enquiry must have a phone number on file
    if (editForm.status === 'contacted' && !editForm.phone.trim()) {
      showToast('Phone number is required')
      return
    }

    const totalPrice  = Math.max(0, parseFloat(editForm.total_price) || 0)
    const alreadyPaidBase = Math.max(0, parseFloat(editForm.amount_paid) || 0)
    const splitsTotal = editPaymentSplits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
    const amountPaid  = alreadyPaidBase + splitsTotal
    const discountValue = Math.max(0, parseFloat(editForm.discount) || 0)
    const marginValue   = Math.max(0, (marginMap[editForm.interest] || 0) - discountValue)
    const isFullyPaid = totalPrice > 0 && amountPaid >= totalPrice
 
    // Gate: check-out cannot be before check-in (whenever both are filled in)
    if (editForm.check_in && editForm.check_out && editForm.check_out < editForm.check_in) {
      showToast('Check-out date cannot be before check-in date')
      return
    }

    // Auto-promote: a Contacted enquiry with dates and a payment already filled in
    // moves straight to Booked, no manual status switch needed.
    let finalStatus = editForm.status
    if (finalStatus === 'contacted') {
      const hasDates = !!(editForm.check_in && editForm.check_out)
      if (amountPaid > 0) {
        if (hasDates) {
          finalStatus = 'booked'
        } else {
          showToast('Add check-in and check-out dates to mark this as Booked')
          return
        }
      }
    }
    const wasBooked = panel.status !== 'booked' && finalStatus === 'booked'
    const autoPromoted = wasBooked && editForm.status !== 'booked'

    // Gate: cannot mark as Booked without check-in and check-out dates
    if (finalStatus === 'booked' && (!editForm.check_in || !editForm.check_out)) {
      showToast('Check-in and check-out dates are required before marking as Booked')
      return
    }

    // Gate: cannot mark as Booked without an advance payment above zero
    if (finalStatus === 'booked' && amountPaid <= 0) {
      showToast('An advance payment is required before marking as Booked')
      return
    }

    // Checkpoint: cancelling a booking that has money recorded against it needs a
    // conscious choice, not a silent one — Cancelled shouldn't leave a stale, out-of-
    // sync Income record behind with no indication anything changed. If they actually
    // want to refund the guest, that belongs in Income (which cancels the enquiry for
    // them automatically); this is only for the deliberate "keep the deposit" case.
    if (finalStatus === 'cancelled' && panel.status !== 'cancelled' && (panel.amount_paid || 0) > 0) {
      const keep = window.confirm(
        `This booking has ₹${Math.round(panel.amount_paid || 0).toLocaleString('en-IN')} recorded as paid.\n\n` +
        `Cancelling here will NOT refund the guest — that amount stays on record as a kept deposit.\n\n` +
        `To refund the guest instead, go to Income and use the Refund button there — it will cancel this booking automatically.\n\n` +
        `Click OK to cancel and keep the deposit as-is, or Cancel to go back.`
      )
      if (!keep) return
    }


    const { error: updateErr } = await supabase.from('hc_enquiries').update({
      name:         editForm.name,
      phone:        editForm.phone || null,
      email:        editForm.email || null,
      source:       editForm.source,
      status:       finalStatus,
      interest:     editForm.interest || null,
      check_in:     editForm.check_in || null,
      check_out:    editForm.check_out || null,
      guests:       Math.max(1, parseInt(editForm.guests) || 1),
      total_price:  totalPrice,
      amount_paid:  amountPaid,
      margin:       marginValue,
      discount:     discountValue,
      lead_quality: editForm.lead_quality || null,
      enquiry_date: editForm.enquiry_date || null,
      updated_by:   user.id,
      updated_at:   new Date().toISOString(),
    }).eq('id', panel.id)

    if (updateErr) {
      showToast('Could not save — check your connection and try again')
      return
    }

    // ── Activity log: covers every kind of change, with the most meaningful one taking priority ──
    const wasCancelled       = panel.status !== 'cancelled'   && editForm.status === 'cancelled'
    const wasMarkedNoResponse = panel.status !== 'noresponse' && editForm.status === 'noresponse'
    const prevPaid      = panel.amount_paid || 0
    const paymentChanged = amountPaid !== prevPaid

    const FIELD_LABELS: Record<string, string> = {
      name:'name', phone:'phone', email:'email', source:'source', interest:'property/stay',
      check_in:'check-in', check_out:'check-out', guests:'guests', total_price:'total price', discount:'discount', enquiry_date:'enquiry date',
    }
    const changedFields: string[] = []
    if (editForm.name !== panel.name) changedFields.push('name')
    if ((editForm.phone || null) !== panel.phone) changedFields.push('phone')
    if ((editForm.email || null) !== panel.email) changedFields.push('email')
    if (editForm.source !== panel.source) changedFields.push('source')
    if ((editForm.interest || null) !== panel.interest) changedFields.push('interest')
    if ((editForm.check_in || null) !== panel.check_in) changedFields.push('check_in')
    if ((editForm.check_out || null) !== panel.check_out) changedFields.push('check_out')
    if (Math.max(1, parseInt(editForm.guests) || 1) !== panel.guests) changedFields.push('guests')
    if (totalPrice !== (panel.total_price || 0)) changedFields.push('total_price')
    if (discountValue !== (panel.discount || 0)) changedFields.push('discount')
    if ((editForm.enquiry_date || null) !== panel.enquiry_date) changedFields.push('enquiry_date')

    const actor = getActor({
      userId: user.id, isOwner,
      employeeName: employee?.name, ownerName: profile?.owner_name,
    })

    if (wasBooked) {
      logActivity({
        tenantId: panel.tenant_id, ...actor,
        action: 'enquiry_booked', entityType: 'enquiry', entityId: panel.id,
        description: `${actor.actorName} marked ${editForm.name}'s enquiry as Booked (₹${Math.round(amountPaid).toLocaleString('en-IN')} of ₹${Math.round(totalPrice).toLocaleString('en-IN')} paid)`,
      })
    } else if (wasCancelled) {
      logActivity({
        tenantId: panel.tenant_id, ...actor,
        action: 'enquiry_cancelled', entityType: 'enquiry', entityId: panel.id,
        description: `${actor.actorName} marked ${editForm.name}'s enquiry as Cancelled`,
      })
    } else if (wasMarkedNoResponse) {
      logActivity({
        tenantId: panel.tenant_id, ...actor,
        action: 'enquiry_marked_noresponse', entityType: 'enquiry', entityId: panel.id,
        description: `${actor.actorName} marked ${editForm.name}'s enquiry as No response`,
      })
    } else if (paymentChanged) {
      logActivity({
        tenantId: panel.tenant_id, ...actor,
        action: 'enquiry_payment_changed', entityType: 'enquiry', entityId: panel.id,
        description: `${actor.actorName} changed amount paid for ${editForm.name} from ₹${Math.round(prevPaid).toLocaleString('en-IN')} to ₹${Math.round(amountPaid).toLocaleString('en-IN')}`,
      })
    } else if (changedFields.length > 0) {
      logActivity({
        tenantId: panel.tenant_id, ...actor,
        action: 'enquiry_edited', entityType: 'enquiry', entityId: panel.id,
        description: `${actor.actorName} updated ${editForm.name}'s enquiry (${changedFields.map(f => FIELD_LABELS[f]).join(', ')})`,
      })
    }

    // Keep linked customer record AND every other enquiry from the same customer in sync (name, phone, email)
    if (panel.customer_id) {
      const custUpdates: Record<string, string | null> = {}
      if (editForm.name.trim() && editForm.name !== panel.name) custUpdates.name = editForm.name
      if ((editForm.phone || null) !== panel.phone) custUpdates.phone = editForm.phone || null
      if ((editForm.email || null) !== panel.email) custUpdates.email = editForm.email || null

      if (Object.keys(custUpdates).length > 0) {
        const now = new Date().toISOString()
        custUpdates.updated_at = now

        await supabase.from('hc_customers').update(custUpdates).eq('id', panel.customer_id)

        // Propagate to every other enquiry from this same customer (the current one is already updated above)
        await supabase.from('hc_enquiries')
          .update(custUpdates)
          .eq('customer_id', panel.customer_id)
          .neq('id', panel.id)
      }
    }
 
    // Sync the linked income record — fires for any Booked or Completed enquiry.
    // Two independent things can happen here, and they're handled differently:
    //  - "Additional payment now" rows are genuinely NEW money — always go
    //    through the ledger as real payment entries.
    //  - Editing "Already paid" directly is a correction to the record (fixing
    //    a mistake), not a new payment — recorded as its own 'correction' ledger
    //    entry so the total stays accurate without pretending money moved.
    const { data: existingFinance } = await supabase
      .from('hc_finance')
      .select('id, advance_paid')
      .eq('tenant_id', panel.tenant_id)
      .eq('enquiry_id', panel.id)
      .eq('type', 'income')
      .maybeSingle()

    const correctionDelta = alreadyPaidBase - prevPaid

    if (finalStatus === 'booked' || finalStatus === 'completed') {
      let financeId = existingFinance?.id as string | undefined

      if (!financeId) {
        const newFinId = crypto.randomUUID()
        await supabase.from('hc_finance').insert({
          id: newFinId,
          tenant_id:   panel.tenant_id,
          type:        'income',
          status:      'draft',
          enquiry_id:  panel.id,
          amount:      totalPrice,
          advance_paid: 0,
          balance_due:  totalPrice,
          date:         editForm.check_in || new Date().toISOString().slice(0, 10),
          accounting_date: editForm.check_in || null,
          description:  `${panel.name} booking`,
          created_by:   user.id,
        })
        financeId = newFinId
      } else if (totalPrice !== (panel.total_price || 0)) {
        // Total price changed but this isn't a payment event — just keep the sale amount in sync
        await supabase.from('hc_finance').update({ amount: totalPrice }).eq('id', financeId)
      }

      const ledgerRows: { tenant_id: string; finance_id: string; enquiry_id: string; amount: number; kind: string; payment_type: string | null; payment_date: string; notes?: string; recorded_by: string }[] = []
      const today = new Date().toISOString().slice(0, 10)

      if (splitsTotal > 0 && financeId) {
        const kind: 'advance' | 'additional' | 'full' = isFullyPaid ? 'full' : (prevPaid <= 0 ? 'advance' : 'additional')
        editPaymentSplits.filter(sp => (parseFloat(sp.amount) || 0) > 0).forEach(sp => {
          ledgerRows.push({
            tenant_id: panel.tenant_id, finance_id: financeId as string, enquiry_id: panel.id,
            amount: parseFloat(sp.amount) || 0, kind, payment_type: sp.payment_type,
            payment_date: today, recorded_by: user.id,
          })
        })
      }

      if (correctionDelta !== 0 && financeId) {
        ledgerRows.push({
          tenant_id: panel.tenant_id, finance_id: financeId as string, enquiry_id: panel.id,
          amount: correctionDelta, kind: 'correction', payment_type: null,
          payment_date: today, notes: 'Manual correction to Already Paid', recorded_by: user.id,
        })
      }

      if (ledgerRows.length > 0) {
        await supabase.from('hc_payments').insert(ledgerRows)
      }

      if (splitsTotal > 0 || correctionDelta !== 0) {
        showToast((isFullyPaid ? 'Saved · Income confirmed — fully paid' : existingFinance ? 'Changes saved · Draft income updated' : 'Saved · Draft income created') + (autoPromoted ? ' · Automatically marked as Booked' : ''))
      } else {
        showToast('Changes saved' + (autoPromoted ? ' · Automatically marked as Booked' : ''))
      }
    } else {
      showToast('Changes saved')
    }
 
    if (editDraftKeyRef.current) clearDraft(editDraftKeyRef.current)
    load(); setPanel(null)
  }
 
  // ── Add note ───────────────────────────────────────────
  const addNote = async () => {
    if (!panel || !newNote.trim() || !user) return
    const entry = {
      date: new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short' }) + ' — just now',
      text: newNote.trim(),
      added_by: user.id,
    }
    const updatedLog = [entry, ...(panel.conversation_log || [])]
    const now = new Date().toISOString()
    await supabase.from('hc_enquiries').update({ conversation_log: updatedLog, updated_at: now, updated_by: user.id }).eq('id', panel.id)
    if (tenantId) {
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'enquiry_note_added', entityType: 'enquiry', entityId: panel.id,
        description: `${actor.actorName} added a follow-up note for ${panel.name}`,
      })
    }
    setPanel({ ...panel, conversation_log: updatedLog, updated_at: now })
    setNewNote('')
    load()
    showToast('Note added')
  }
 
  // ── Delete ─────────────────────────────────────────────
  const deleteEnquiry = async (id: string, name: string) => {
    if (!confirm(`Delete enquiry for ${name}? This cannot be undone.`)) return
    await supabase.from('hc_enquiries').delete().eq('id', id)
    if (user && tenantId) {
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'enquiry_deleted', entityType: 'enquiry', entityId: id,
        description: `${actor.actorName} deleted the enquiry for ${name}`,
      })
    }
    if (panel?.id === id) { if (editDraftKeyRef.current) clearDraft(editDraftKeyRef.current); setPanel(null) }
    load()
    showToast(name + ' deleted')
  }
 
  // ── Export ─────────────────────────────────────────────
  const exportExcel = () => {
    if (!isOwner) { showToast('Only the owner can export data'); return }
    if (displayed.length === 0) { showToast('No enquiries to export'); return }
    const rows = displayed.map(e => ({
      Name:         e.name,
      Phone:        e.phone || '',
      Email:        e.email || '',
      Source:       e.source,
      'Property / Stay': e.interest || '',
      'Enquiry date': e.enquiry_date || '',
      'Check-in':   e.check_in || '',
      'Check-out':  e.check_out || '',
      Guests:       e.guests,
      'Total price':e.total_price || 0,
      'Amount paid':e.amount_paid || 0,
      Balance:      Math.max(0, (e.total_price || 0) - (e.amount_paid || 0)),
      Status:       STATUS[e.status]?.label || e.status,
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Enquiries')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `enquiries-${new Date().toISOString().slice(0, 7)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`Exported ${displayed.length} enquiries`)
  }
 
  const sel: React.CSSProperties = { padding:'7px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151', background:'#ffffff', outline:'none', cursor:'pointer' }
 
  // ── Render ─────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
 
      {/* Topbar */}
      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Enquiries</span>
          <span style={{ fontSize:'12px', color:'#9ca3af' }}>
            {displayed.length} {displayed.length !== enquiries.length ? `shown of ${enquiries.length}` : 'total'}
          </span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <select value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setDateFrom(''); setDateTo(''); resetPage() }} style={{ ...sel, width:'140px' }}>
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m} {new Date().getFullYear()}</option>)}
          </select>
          {isOwner && <button onClick={exportExcel} style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>↓ Excel</button>}
          <button onClick={() => setShowAdd(v => !v)} style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>+ Add enquiry</button>
        </div>
      </div>
 
      {/* Filter row */}
      <div style={{ background:'#ffffff', borderBottom:'1px solid #f3f4f6', padding:'10px 22px', display:'flex', gap:'10px', flexShrink:0, flexWrap:'wrap', alignItems:'center' }}>
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); resetPage() }} style={sel}>
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterSource} onChange={e => { setFilterSource(e.target.value); resetPage() }} style={sel}>
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <span style={{ fontSize:'11px', color:'#9ca3af', whiteSpace:'nowrap' }}>Check-in from</span>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setFilterMonth(''); resetPage() }} style={{ ...sel, fontSize:'12px', padding:'6px 8px' }} />
          <span style={{ fontSize:'11px', color:'#9ca3af' }}>to</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setFilterMonth(''); resetPage() }} style={{ ...sel, fontSize:'12px', padding:'6px 8px' }} />
        </div>
        <div style={{ position:'relative' }}>
          <button onClick={() => setShowCalendar(v => !v)}
            style={{ ...sel, display:'flex', alignItems:'center', gap:'6px', cursor:'pointer', background: showCalendar ? '#f0fdf4' : '#ffffff', borderColor: showCalendar ? '#17341e' : '#e5e7eb' }}>
            📅 Pick a day
          </button>
          {showCalendar && (
            <>
              <div onClick={() => setShowCalendar(false)} style={{ position:'fixed', inset:0, zIndex:59 }} />
              <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:60, background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', boxShadow:'0 8px 24px rgba(0,0,0,0.12)', padding:'14px', width:'260px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'10px' }}>
                  <button onClick={() => setCalendarMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:'14px', color:'#374151', padding:'2px 6px' }}>‹</button>
                  <span style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>
                    {calendarMonth.toLocaleDateString('en-IN', { month:'long', year:'numeric' })}
                  </span>
                  <button onClick={() => setCalendarMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:'14px', color:'#374151', padding:'2px 6px' }}>›</button>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'2px', marginBottom:'4px' }}>
                  {['S','M','T','W','T','F','S'].map((d, i) => (
                    <div key={i} style={{ textAlign:'center', fontSize:'10px', color:'#9ca3af', fontWeight:500, padding:'4px 0' }}>{d}</div>
                  ))}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'2px' }}>
                  {(() => {
                    const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth()
                    const firstWeekday = new Date(year, month, 1).getDay()
                    const daysInMonth = new Date(year, month + 1, 0).getDate()
                    const todayStr = new Date().toISOString().slice(0, 10)
                    const cells = []
                    for (let i = 0; i < firstWeekday; i++) cells.push(<div key={`pad-${i}`} />)
                    for (let day = 1; day <= daysInMonth; day++) {
                      const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
                      const hasData = daysWithEnquiries.has(dateStr)
                      const isToday = dateStr === todayStr
                      const isSelected = dateStr === enqDateFrom && dateStr === enqDateTo
                      cells.push(
                        <button key={day} onClick={() => pickCalendarDay(dateStr)}
                          style={{
                            position:'relative', padding:'6px 0', border:'none', borderRadius:'6px', cursor:'pointer', fontSize:'11px',
                            background: isSelected ? '#17341e' : isToday ? '#f0fdf4' : 'transparent',
                            color: isSelected ? '#ffffff' : '#374151', fontWeight: isToday || isSelected ? 600 : 400,
                          }}>
                          {day}
                          {hasData && !isSelected && (
                            <span style={{ position:'absolute', bottom:'2px', left:'50%', transform:'translateX(-50%)', width:'3px', height:'3px', borderRadius:'50%', background:'#17341e' }} />
                          )}
                        </button>
                      )
                    }
                    return cells
                  })()}
                </div>
              </div>
            </>
          )}
        </div>
        {(filterStatus || filterSource || filterMonth !== '' || dateFrom || dateTo) && (
          <button onClick={() => { setFilterStatus(''); setFilterSource(''); setFilterMonth(''); setDateFrom(''); setDateTo(''); resetPage() }}
            style={{ fontSize:'11px', color:'#991b1b', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:'8px', padding:'5px 12px', cursor:'pointer', whiteSpace:'nowrap' }}>
            Clear filters
          </button>
        )}
      </div>
 
      {/* Content */}
      <div className="page-content">

        {/* Drill-down banner — shown when arrived from a Dashboard click-through */}
        {drillLabel && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'8px', padding:'9px 14px', marginBottom:'14px' }}>
            <span style={{ fontSize:'12px', color:'#1e40af' }}>Showing: <strong>{drillLabel}</strong></span>
            <button onClick={clearDrillDown} style={{ background:'none', border:'none', color:'#1e40af', fontSize:'12px', fontWeight:500, cursor:'pointer', textDecoration:'underline' }}>Clear filter</button>
          </div>
        )}
 
        {/* Add form */}
        {showAdd && (
          <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'18px 20px', marginBottom:'14px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
              <span style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>New enquiry</span>
              <button onClick={cancelAdd} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
 
            {/* Search existing customer — Option B */}
            <div style={{ marginBottom:'14px', position:'relative' }} ref={searchRef}>
              <label style={lbl}>Search existing customer <span style={{ textTransform:'none', fontWeight:400, color:'#9ca3af', fontSize:'9px' }}>(by name or phone)</span></label>
              <input
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); searchCustomers(e.target.value); setShowSearch(true) }}
                onFocus={() => setShowSearch(true)}
                placeholder="Type name or phone to find existing customer..."
                style={{ ...inp, background:'#ffffff' }}
              />
              {showSearch && searchResults.length > 0 && (
                <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', boxShadow:'0 4px 12px rgba(0,0,0,0.08)', zIndex:20, marginTop:'4px' }}>
                  {searchResults.map(c => (
                    <div key={c.id} onClick={() => applyCustomer(c)}
                      style={{ padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <div>
                        <div style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{c.name}</div>
                        <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>{c.phone || c.email || '—'}</div>
                      </div>
                      <span style={{ fontSize:'11px', color:'#17341e', fontWeight:500 }}>Select →</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
 
            {/* Form fields */}
            <div className="form-grid">
              {/* Name */}
              {([
                ['Name *', 'name', 'text', 'Full name'],
              ] as [string,string,string,string][]).map(([l, k, t, p]) => (
                <div key={k}>
                  <label style={lbl}>{l}</label>
                  <input type={t} placeholder={p} value={(addForm as Record<string,string>)[k]}
                    min={t==='number' ? (k==='guests' ? '1' : '0') : undefined}
                    onChange={e => setAddForm(f => ({ ...f, [k]: e.target.value }))} style={inp} />
                </div>
              ))}
 
              {/* Phone — with live suggestion */}
              <div>
                <label style={lbl}>Phone</label>
                <input type="text" placeholder="+91..." value={addForm.phone}
                  onChange={e => handlePhoneChange(e.target.value)} style={inp} />
                {phoneSuggestion && (
                  <div onClick={() => applyCustomer(phoneSuggestion)}
                    style={{ marginTop:'4px', padding:'7px 10px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:'6px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div>
                      <span style={{ fontSize:'11px', fontWeight:500, color:'#166534' }}>Match found: {phoneSuggestion.name}</span>
                      <span style={{ fontSize:'10px', color:'#6b7280', marginLeft:'8px' }}>{phoneSuggestion.phone}</span>
                    </div>
                    <span style={{ fontSize:'10px', color:'#17341e', fontWeight:500 }}>Use →</span>
                  </div>
                )}
              </div>
 
              {/* Email */}
              <div>
                <label style={lbl}>Email</label>
                <input type="email" placeholder="email@..." value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} style={inp} />
              </div>
 
              {/* Interest — dropdown from Inventory */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <label style={lbl}>Property / Stay</label>
                  <span onClick={() => setManagingInterests(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingInterests ? 'Done' : 'Manage'}</span>
                </div>
                {managingInterests ? (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                    {interests.map(i => (
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                        <span style={{ fontSize:'12px', color:'#374151' }}>{i}</span>
                        <button onClick={() => deleteInterestOption(i)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                      </div>
                    ))}
                    {interests.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                  </div>
                ) : (
                  <select value={addForm.interest} onChange={e => {
                    const name = e.target.value
                    const price = inventoryMap[name]
                    setAddForm(f => ({ ...f, interest: name, ...(price ? { total_price: String(price) } : {}) }))
                  }} style={inp}>
                    <option value="">Select property / package...</option>
                    {interests.map(i => <option key={i} value={i}>{i}</option>)}
                    <option value="__add__">+ Add new...</option>
                  </select>
                )}
                {addForm.interest === '__add__' && !managingInterests && (
                  <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                    <input value={newInterest} onChange={e => setNewInterest(e.target.value)} placeholder="e.g. Forest Suite" style={{ ...inp, flex:1 }}
                      onKeyDown={e => { if (e.key === 'Enter') { addInterestOption(newInterest); setAddForm(f => ({ ...f, interest: newInterest.trim() })) } }} autoFocus />
                    <button onClick={() => { addInterestOption(newInterest); setAddForm(f => ({ ...f, interest: newInterest.trim() })) }}
                      style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                    <button onClick={() => { setAddingInterest(false); setNewInterest(''); setAddForm(f => ({ ...f, interest: '' })) }}
                      style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                  </div>
                )}
              </div>
 
              {/* Source */}
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <label style={lbl}>Source</label>
                  <span onClick={() => setManagingSources(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingSources ? 'Done' : 'Manage'}</span>
                </div>
                {managingSources ? (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                    {sources.map(s => (
                      <div key={s} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                        <span style={{ fontSize:'12px', color:'#374151' }}>{s}</span>
                        <button onClick={() => deleteSourceOption(s)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                      </div>
                    ))}
                    {sources.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                  </div>
                ) : (
                  <select value={addForm.source} onChange={e => setAddForm(f => ({ ...f, source: e.target.value }))} style={inp}>
                    {sources.map(s => <option key={s}>{s}</option>)}
                    <option value="__add__">+ Add new source...</option>
                  </select>
                )}
                {addForm.source === '__add__' && !managingSources && (
                  <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                    <input value={newSource} onChange={e => setNewSource(e.target.value)} placeholder="New source name" style={{ ...inp, flex:1 }}
                      onKeyDown={e => { if (e.key === 'Enter') { addSourceOption(newSource); setAddForm(f => ({ ...f, source: newSource.trim() })) } }} autoFocus />
                    <button onClick={() => { addSourceOption(newSource); setAddForm(f => ({ ...f, source: newSource.trim() })) }}
                      style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                    <button onClick={() => { setAddingSource(false); setNewSource(''); setAddForm(f => ({ ...f, source: sources[0] })) }}
                      style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                  </div>
                )}
              </div>
 
              {/* Date and number fields */}
              {([
                ['Enquiry date',  'enquiry_date', 'date',   ''],
                ['Check-in',      'check_in',     'date',   ''],
                ['Check-out',     'check_out',    'date',   ''],
                ['Guests',        'guests',       'number', '1'],
                ['Total price ₹', 'total_price',  'number', '0'],
              ] as [string,string,string,string][]).map(([l, k, t, p]) => (
                <div key={k}>
                  <label style={lbl}>{l}</label>
                  <input type={t} placeholder={p} value={(addForm as Record<string,string>)[k]}
                    min={t==='number' ? (k==='guests' ? '1' : '0') : undefined}
                    onChange={e => setAddForm(f => ({ ...f, [k]: e.target.value }))} style={inp} />
                </div>
              ))}
              <div>
                <label style={lbl}>Discount ₹</label>
                <input type="number" min="0" placeholder="0" value={addForm.discount}
                  onChange={e => {
                    const newDiscount = parseFloat(e.target.value) || 0
                    const oldDiscount = parseFloat(addForm.discount) || 0
                    const delta = newDiscount - oldDiscount
                    setAddForm(f => ({ ...f, discount: e.target.value, total_price: String(Math.max(0, (parseFloat(f.total_price) || 0) - delta)) }))
                  }} style={inp} />
              </div>
              <div style={{ gridColumn: addPaymentSplits.length > 1 ? 'span 2' : undefined }}>
                <label style={lbl}>Amount paid ₹</label>
                {addPaymentSplits.map((sp, i) => (
                  <div key={sp.id} style={{ display:'flex', gap:'6px', marginBottom:'6px' }}>
                    <input type="number" min="0" placeholder="0" value={sp.amount} onChange={e => updateAddSplit(i, 'amount', e.target.value)}
                      style={{ ...inp, flex:1 }} />
                    <select value={sp.payment_type} onChange={e => updateAddSplit(i, 'payment_type', e.target.value)} style={{ ...inp, flex:1 }}>
                      {paymentTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                    </select>
                    {addPaymentSplits.length > 1 && (
                      <button onClick={() => removeAddSplitRow(i)} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:'18px', lineHeight:1, padding:'0 4px' }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={addMoreAddSplitRow} style={{ background:'none', border:'none', color:'#1e40af', cursor:'pointer', fontSize:'11px', fontWeight:500, padding:0, textDecoration:'underline' }}>
                  + Add another payment method
                </button>
                {addPaymentSplits.length > 1 && (
                  <div style={{ fontSize:'11px', color:'#6b7280', marginTop:'6px' }}>
                    Total paid: <strong style={{ color:'#111111' }}>{fmt(parseFloat(addForm.amount_paid) || 0)}</strong>
                  </div>
                )}
              </div>
            </div>
 
            {/* Status */}
            <div style={{ marginBottom:'10px' }}>
              <label style={lbl}>Status</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                {Object.entries(SELECTABLE_STATUS).map(([k, v]) => (
                  <button key={k} onClick={() => setAddForm(f => ({ ...f, status: k }))}
                    style={{ padding:'5px 12px', borderRadius:'20px', border:'1px solid', borderColor:addForm.status===k?'#17341e':'#e5e7eb', background:addForm.status===k?'#17341e':'#ffffff', color:addForm.status===k?'#ffffff':'#374151', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Lead quality — optional, internal-only rating; never shown in the Enquiries table */}
            <div style={{ marginBottom:'10px' }}>
              <label style={lbl}>Lead quality <span style={{ textTransform:'none', fontWeight:400, color:'#9ca3af' }}>(optional)</span></label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                {LEAD_QUALITY_OPTIONS.map(opt => (
                  <button key={opt.key} onClick={() => setAddForm(f => ({ ...f, lead_quality: f.lead_quality === opt.key ? '' : opt.key }))}
                    style={{ padding:'5px 12px', borderRadius:'20px', border:'1px solid', borderColor:addForm.lead_quality===opt.key?opt.color:'#e5e7eb', background:addForm.lead_quality===opt.key?opt.bg:'#ffffff', color:addForm.lead_quality===opt.key?opt.color:'#374151', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
 
            {/* Notes */}
            <div style={{ marginBottom:'14px' }}>
              <label style={lbl}>Notes</label>
              <textarea value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                placeholder="Initial notes..." style={{ ...inp, resize:'none' }} />
            </div>
 
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => handleAdd()} disabled={saving}
                style={{ padding:'9px 22px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:saving?0.7:1 }}>
                {saving ? 'Saving…' : 'Save enquiry'}
              </button>
              <button onClick={cancelAdd} style={{ padding:'9px 18px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
 
        {/* Duplicate customer confirmation popup */}
        {dupCustomer && (
          <>
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', zIndex:60 }} />
            <div className="modal" style={{ padding:'24px', width:'360px' }}>
              <div style={{ fontSize:'14px', fontWeight:500, color:'#111111', marginBottom:'8px' }}>Existing customer found</div>
              <div style={{ fontSize:'12px', color:'#6b7280', lineHeight:1.7, marginBottom:'18px' }}>
                Phone number matches an existing customer:<br />
                <strong style={{ color:'#111111' }}>{dupCustomer.name}</strong> ({dupCustomer.phone})<br /><br />
                The name you entered is <strong style={{ color:'#111111' }}>{addForm.name}</strong>. Should we link this enquiry to the existing customer account?
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={() => { pendingSave && pendingSave(); }}
                  style={{ flex:1, padding:'9px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                  Yes, link to {dupCustomer.name}
                </button>
                <button onClick={() => { setDupCustomer(null); setPendingSave(null); setSaving(false) }}
                  style={{ padding:'9px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
 
        {/* Table */}
        <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden' }}>
          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', fontSize:'13px', color:'#9ca3af' }}>Loading…</div>
          ) : (
            <div className="table-wrap">
              <table className="alt-table" style={{ width:'100%', borderCollapse:'collapse', minWidth:'960px' }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid #e5e7eb', background:'#f9fafb' }}>
                    {['Customer','Source','Property / Stay','Enquiry date','Check-in','Check-out','Guests','Total','Paid','Balance','Status',''].map((h,hi) => (
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0 ? (
                    <tr><td colSpan={12} style={{ padding:'32px', textAlign:'center', fontSize:'12px', color:'#9ca3af' }}>No enquiries match the current filters.</td></tr>
                  ) : paginated.map(e => {
                    const total   = e.total_price || 0
                    const paid    = e.amount_paid || 0
                    const balance = Math.max(0, total - paid)
                    return (
                      <tr key={e.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                        <td className="sticky-col" style={{ padding:'11px 14px' }}>
                          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{e.name}</div>
                          <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>{e.phone || e.email || '—'}</div>
                        </td>
                        <td style={{ padding:'11px 14px' }}>
                          <span style={{ fontSize:'11px', background:'#f3f4f6', color:'#6b7280', padding:'3px 8px', borderRadius:'20px', whiteSpace:'nowrap' }}>{e.source.split(' ')[0]}</span>
                        </td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', color:'#6b7280', whiteSpace:'nowrap' }}>{e.interest || '—'}</td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap' }}>
                          {e.enquiry_date ? new Date(e.enquiry_date + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                        </td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', color:'#111111', whiteSpace:'nowrap' }}>
                          {e.check_in ? new Date(e.check_in + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                        </td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', color:'#111111', whiteSpace:'nowrap' }}>
                          {e.check_out ? new Date(e.check_out + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                        </td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', color:'#6b7280', textAlign:'center' }}>{e.guests}</td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', fontWeight:500, color:'#111111', whiteSpace:'nowrap' }}>{total > 0 ? rupee(total) : '—'}</td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', fontWeight:500, color:'#166534', whiteSpace:'nowrap' }}>{paid > 0 ? rupee(paid) : '—'}</td>
                        <td style={{ padding:'11px 14px', fontSize:'12px', fontWeight:500, whiteSpace:'nowrap', color: balance > 0 ? '#991b1b' : total > 0 ? '#166534' : '#9ca3af' }}>
                          {balance > 0 ? rupee(balance) : total > 0 ? '✓ Paid' : '—'}
                        </td>
                        <td style={{ padding:'11px 14px' }}><Badge status={e.status} /></td>
                        <td style={{ padding:'11px 14px' }}>
                          <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                            {isStaleContacted(e) && (
                              <button onClick={() => openPanel(e)} title="No activity for 10+ days — follow up or update status"
                                style={{ padding:'5px 11px', background:'#fef3c7', color:'#92400e', border:'1px solid #fcd34d', borderRadius:'7px', fontSize:'11px', fontWeight:600, cursor:'pointer' }}>
                                ⚠ Needs action
                              </button>
                            )}
                            <button onClick={() => openPanel(e)} style={{ padding:'5px 11px', background:'#dbeafe', color:'#1e40af', border:'1px solid #93c5fd', borderRadius:'7px', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>Edit</button>
                            <button onClick={() => deleteEnquiry(e.id, e.name)} style={{ padding:'5px 11px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'7px', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
 
        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 4px', marginTop:'10px' }}>
            <span style={{ fontSize:'12px', color:'#9ca3af' }}>
              Showing {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, displayed.length)} of {displayed.length}
            </span>
            <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ padding:'6px 14px', background:'#ffffff', color:page===1?'#d1d5db':'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:page===1?'default':'pointer' }}>← Prev</button>
              {Array.from({ length: totalPages }, (_, i) => i+1).filter(p => p===1||p===totalPages||Math.abs(p-page)<=1).map((p, i, arr) => (
                <React.Fragment key={p}>
                  {i>0 && arr[i-1]!==p-1 && <span style={{ color:'#9ca3af', fontSize:'12px' }}>…</span>}
                  <button onClick={() => setPage(p)}
                    style={{ padding:'6px 12px', background:p===page?'#17341e':'#ffffff', color:p===page?'#ffffff':'#111111', border:'1px solid', borderColor:p===page?'#17341e':'#e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', minWidth:'36px' }}>{p}</button>
                </React.Fragment>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                style={{ padding:'6px 14px', background:'#ffffff', color:page===totalPages?'#d1d5db':'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:page===totalPages?'default':'pointer' }}>Next →</button>
            </div>
          </div>
        )}
      </div>
 
      {/* Edit panel */}
      {panel && (
        <>
          <div onClick={closePanel} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.2)', zIndex:40 }} />
          <div className="side-panel" style={{ width:'340px' }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>{panel.name}</div>
                <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>{panel.source} · {fmtDate(panel.enquiry_date || panel.created_at)}</div>
              </div>
              <button onClick={closePanel} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
 
            <div style={{ flex:1, overflowY:'auto', padding:'16px 18px' }}>
              <div className="form-grid-2">
                {([
                  ['Name',         'name',         'text'],
                  ['Phone',        'phone',        'text'],
                  ['Email',        'email',        'text'],
                  ['Enquiry date', 'enquiry_date', 'date'],
                  ['Check-in',     'check_in',     'date'],
                  ['Check-out',    'check_out',    'date'],
                  ['Guests',       'guests',       'number'],
                ] as [string,string,string][]).map(([l, k, t]) => (
                  <div key={k}>
                    <label style={{ ...lbl, color:'#9ca3af' }}>{l}</label>
                    <input type={t} value={editForm[k] || ''} min={t==='number' ? (k==='guests' ? '1' : '0') : undefined} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={inp} />
                  </div>
                ))}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Source</label>
                    <span onClick={() => setManagingSources(v => !v)} style={{ fontSize:'10px', color:'#9ca3af', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingSources ? 'Done' : 'Manage'}</span>
                  </div>
                  {managingSources ? (
                    <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                      {sources.map(s => (
                        <div key={s} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                          <span style={{ fontSize:'12px', color:'#374151' }}>{s}</span>
                          <button onClick={() => deleteSourceOption(s)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                        </div>
                      ))}
                      {sources.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                    </div>
                  ) : (
                    <select value={editForm.source} onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))} style={inp}>
                      {sources.map(s => <option key={s}>{s}</option>)}
                      <option value="__add__">+ Add new source...</option>
                    </select>
                  )}
                  {editForm.source === '__add__' && !managingSources && (
                    <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                      <input value={newEditSource} onChange={e => setNewEditSource(e.target.value)} placeholder="New source" style={{ ...inp, flex:1 }}
                        onKeyDown={e => { if (e.key === 'Enter') { addSourceOption(newEditSource, true); setEditForm(f => ({ ...f, source: newEditSource.trim() })) } }} autoFocus />
                      <button onClick={() => { addSourceOption(newEditSource, true); setEditForm(f => ({ ...f, source: newEditSource.trim() })) }}
                        style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                      <button onClick={() => { setAddingEditSource(false); setNewEditSource(''); setEditForm(f => ({ ...f, source: sources[0] })) }}
                        style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                    </div>
                  )}
                </div>
 
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Property / Stay</label>
                    <span onClick={() => setManagingInterests(v => !v)} style={{ fontSize:'10px', color:'#9ca3af', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingInterests ? 'Done' : 'Manage'}</span>
                  </div>
                  {managingInterests ? (
                    <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                      {interests.map(i => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                          <span style={{ fontSize:'12px', color:'#374151' }}>{i}</span>
                          <button onClick={() => deleteInterestOption(i)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                        </div>
                      ))}
                      {interests.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                    </div>
                  ) : (
                    <select value={editForm.interest} onChange={e => {
                      const name = e.target.value
                      const price = inventoryMap[name]
                      setEditForm(f => ({ ...f, interest: name, ...(price && !f.total_price ? { total_price: String(price) } : {}) }))
                    }} style={inp}>
                      <option value="">Select property / package...</option>
                      {interests.map(i => <option key={i} value={i}>{i}</option>)}
                      <option value="__add__">+ Add new...</option>
                    </select>
                  )}
                  {editForm.interest === '__add__' && !managingInterests && (
                    <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                      <input value={newEditInterest} onChange={e => setNewEditInterest(e.target.value)} placeholder="e.g. Forest Suite" style={{ ...inp, flex:1 }}
                        onKeyDown={e => { if (e.key === 'Enter') { addInterestOption(newEditInterest, true); setEditForm(f => ({ ...f, interest: newEditInterest.trim() })) } }} autoFocus />
                      <button onClick={() => { addInterestOption(newEditInterest, true); setEditForm(f => ({ ...f, interest: newEditInterest.trim() })) }}
                        style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                      <button onClick={() => { setAddingEditInterest(false); setNewEditInterest(''); setEditForm(f => ({ ...f, interest: '' })) }}
                        style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                    </div>
                  )}
                </div>
              </div>
 
              {/* Payment section */}
              <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'12px 14px', marginBottom:'14px' }}>
                <div style={{ fontSize:'11px', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'10px' }}>Payment</div>
                <div className="form-grid-2">
                  <div>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Total price ₹</label>
                    <input type="number" min="0" value={editForm.total_price} onChange={e => setEditForm(f => ({ ...f, total_price: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Already paid ₹</label>
                    <input type="number" min="0" value={editForm.amount_paid} onChange={e => setEditForm(f => ({ ...f, amount_paid: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Discount ₹</label>
                    <input type="number" min="0" value={editForm.discount}
                      onChange={e => {
                        const newDiscount = parseFloat(e.target.value) || 0
                        const oldDiscount = parseFloat(editForm.discount) || 0
                        const delta = newDiscount - oldDiscount
                        setEditForm(f => ({ ...f, discount: e.target.value, total_price: String(Math.max(0, (parseFloat(f.total_price) || 0) - delta)) }))
                      }} style={inp} />
                  </div>
                  <div style={{ gridColumn:'span 2' }}>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Additional payment now ₹</label>
                    {editPaymentSplits.map((sp, i) => (
                      <div key={sp.id} style={{ display:'flex', gap:'6px', marginBottom:'6px' }}>
                        <input type="number" min="0" placeholder="0" value={sp.amount} onChange={e => updateEditSplit(i, 'amount', e.target.value)}
                          style={{ ...inp, flex:1 }} />
                        <select value={sp.payment_type} onChange={e => updateEditSplit(i, 'payment_type', e.target.value)} style={{ ...inp, flex:1 }}>
                          {paymentTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                        </select>
                        {editPaymentSplits.length > 1 && (
                          <button onClick={() => removeEditSplitRow(i)} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:'18px', lineHeight:1, padding:'0 4px' }}>×</button>
                        )}
                      </div>
                    ))}
                    <button onClick={addMoreEditSplitRow} style={{ background:'none', border:'none', color:'#1e40af', cursor:'pointer', fontSize:'11px', fontWeight:500, padding:0, textDecoration:'underline' }}>
                      + Add another payment method
                    </button>
                    <div style={{ marginTop:'8px' }}>
                      <label style={{ ...lbl, color:'#9ca3af' }}>New total paid ₹</label>
                      <input type="number" value={(parseFloat(editForm.amount_paid) || 0) + editPaymentSplits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)} readOnly style={{ ...inp, background:'#f3f4f6', color:'#6b7280' }} />
                    </div>
                  </div>
                </div>
                {(() => {
                  const total   = parseFloat(editForm.total_price) || 0
                  const paid    = (parseFloat(editForm.amount_paid) || 0) + editPaymentSplits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
                  const balance = Math.max(0, total - paid)
                  const fullyPaid = total > 0 && paid >= total
                  return total > 0 ? (
                    <div style={{ marginTop:'10px', padding:'8px 12px', borderRadius:'6px', background:fullyPaid?'#dcfce7':'#fef9c3', border:`1px solid ${fullyPaid?'#86efac':'#fde047'}` }}>
                      <span style={{ fontSize:'12px', fontWeight:500, color:fullyPaid?'#166534':'#854f0b' }}>
                        {fullyPaid ? '✓ Fully paid' : `Balance remaining: ₹${balance.toLocaleString('en-IN')}`}
                      </span>
                    </div>
                  ) : null
                })()}
              </div>
 
              {/* Status */}
              <div style={{ marginBottom:'14px' }}>
                <label style={{ ...lbl, color:'#9ca3af' }}>Status</label>
                {editForm.status === 'completed' ? (
                  <div style={{ fontSize:'11px', color:'#065f46', background:'#d1fae5', display:'inline-block', padding:'5px 10px', borderRadius:'20px' }}>
                    ✓ Completed — set automatically once fully paid and checked out
                  </div>
                ) : (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                    {Object.entries(SELECTABLE_STATUS).map(([k, v]) => (
                      <button key={k} onClick={() => setEditForm(f => ({ ...f, status: k }))}
                        style={{ padding:'5px 10px', borderRadius:'20px', border:'1px solid', borderColor:editForm.status===k?'#17341e':'#e5e7eb', background:editForm.status===k?'#17341e':'#ffffff', color:editForm.status===k?'#ffffff':'#374151', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Lead quality — optional, internal-only rating; never shown in the Enquiries table */}
              <div style={{ marginBottom:'14px' }}>
                <label style={{ ...lbl, color:'#9ca3af' }}>Lead quality <span style={{ textTransform:'none', fontWeight:400, color:'#9ca3af' }}>(optional)</span></label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                  {LEAD_QUALITY_OPTIONS.map(opt => (
                    <button key={opt.key} onClick={() => setEditForm(f => ({ ...f, lead_quality: f.lead_quality === opt.key ? '' : opt.key }))}
                      style={{ padding:'5px 10px', borderRadius:'20px', border:'1px solid', borderColor:editForm.lead_quality===opt.key?opt.color:'#e5e7eb', background:editForm.lead_quality===opt.key?opt.bg:'#ffffff', color:editForm.lead_quality===opt.key?opt.color:'#374151', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
 
              {/* Conversation log */}
              <div style={{ borderTop:'1px solid #f3f4f6', paddingTop:'14px' }}>
                <div style={{ fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'10px' }}>Conversation log</div>
                {(panel.conversation_log || []).length === 0
                  ? <p style={{ fontSize:'12px', color:'#9ca3af' }}>No notes yet.</p>
                  : (panel.conversation_log || []).map((n, i) => (
                    <div key={i} style={{ marginBottom:'12px', paddingBottom:'12px', borderBottom:'1px solid #f9fafb' }}>
                      <div style={{ fontSize:'10px', color:'#9ca3af', marginBottom:'3px' }}>{n.date}</div>
                      <div style={{ fontSize:'12px', color:'#374151', lineHeight:1.6 }}>{n.text}</div>
                    </div>
                  ))}
                <textarea value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} placeholder="Add a note…"
                  style={{ ...inp, resize:'none', marginBottom:'6px' }} />
                <button onClick={addNote} style={{ fontSize:'11px', color:'#17341e', fontWeight:500, background:'none', border:'none', cursor:'pointer', padding:0 }}>+ Add note</button>
              </div>
            </div>
 
            <div style={{ padding:'12px 18px', borderTop:'1px solid #e5e7eb', display:'flex', gap:'8px', flexShrink:0 }}>
              <button onClick={savePanel} style={{ flex:1, padding:'9px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Save changes</button>
              <button onClick={closePanel} style={{ padding:'9px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
              <button onClick={() => deleteEnquiry(panel.id, panel.name)} style={{ padding:'9px 14px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Delete</button>
            </div>
          </div>
        </>
      )}
 
      {toast && (
        <div style={{ position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#17341e', color:'#ffffff', fontSize:'12px', fontWeight:500, padding:'8px 20px', borderRadius:'20px', zIndex:60, whiteSpace:'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
 
export default Enquiries