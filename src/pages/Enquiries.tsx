import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCEnquiry, HCCustomer, fmtDate, STATUS_ORDER } from '../lib/supabase'
import * as XLSX from 'xlsx'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const PAGE_SIZE = 50
 
const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  new:        { label:'New',         bg:'#dbeafe', color:'#1e40af' },
  contacted:  { label:'Contacted',   bg:'#fef9c3', color:'#854f0b' },
  booked:     { label:'Booked',      bg:'#dcfce7', color:'#166534' },
  completed:  { label:'Completed',   bg:'#d1fae5', color:'#065f46' },
  noresponse: { label:'No response', bg:'#f3f4f6', color:'#6b7280' },
  cancelled:  { label:'Cancelled',   bg:'#fee2e2', color:'#991b1b' },
}
 
const DEFAULT_SOURCES = ['WhatsApp DM','Instagram DM','Website form','Phone call','Walk-in','Referral','Other']
const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const inpRO: React.CSSProperties = { ...inp, background:'#f9fafb', color:'#6b7280', cursor:'not-allowed' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
 
const Badge = ({ status }: { status: string }) => {
  const s = STATUS[status] || { label: status, bg:'#f3f4f6', color:'#6b7280' }
  return <span style={{ display:'inline-block', padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:500, background:s.bg, color:s.color, whiteSpace:'nowrap' }}>{s.label}</span>
}
 
const rupee = (n: number | null | undefined) => n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—'
 
const BLANK = () => ({
  name:'', phone:'', email:'', source:'WhatsApp DM', status:'new',
  interest:'', check_in:'', check_out:'', guests:'1',
  total_price:'', amount_paid:'0', notes:'',
  enquiry_date: new Date().toISOString().slice(0, 10),
})
 
export const Enquiries: React.FC = () => {
  const { user, tenantId } = useAuth()
  const [enquiries, setEnquiries] = useState<HCEnquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
 
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState(BLANK())
  const [saving, setSaving] = useState(false)
 
  // Dynamic options
  const [sources, setSources] = useState<string[]>(DEFAULT_SOURCES)
  const [interests, setInterests] = useState<string[]>([])
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
    const [{ data }, { data: srcData }, { data: invData }] = await Promise.all([
      supabase.from('hc_enquiries').select('*').eq('tenant_id', tenantId).order('enquiry_date', { ascending: false, nullsFirst: false }),
      supabase.from('hc_settings').select('value').eq('tenant_id', tenantId).eq('type', 'source').order('sort_order'),
      supabase.from('hc_inventory').select('name').eq('tenant_id', tenantId).eq('is_active', true).order('sort_order'),
    ])
    const enqRecords = (data as HCEnquiry[]) || []
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
    if (filterStatus && e.status !== filterStatus) return false
    if (filterSource && e.source !== filterSource) return false
    if (filterMonth !== '') {
      const d = e.enquiry_date || e.created_at
      if (new Date(d).getMonth() !== parseInt(filterMonth)) return false
    }
    if (dateFrom && e.check_in && e.check_in < dateFrom) return false
    if (dateTo && e.check_in && e.check_in > dateTo) return false
    return true
  })
 
  // Sort by status priority, then by enquiry_date descending within same status
  const displayed = [...filtered].sort((a, b) => {
    const sa = STATUS_ORDER[a.status] || 99
    const sb = STATUS_ORDER[b.status] || 99
    if (sa !== sb) return sa - sb
    const da = a.enquiry_date || a.created_at
    const db = b.enquiry_date || b.created_at
    return db.localeCompare(da)
  })
 
  const totalPages = Math.ceil(displayed.length / PAGE_SIZE)
  const paginated = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
 
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
    setSaving(true)
 
    const totalPrice = parseFloat(addForm.total_price) || 0
    const amountPaid = parseFloat(addForm.amount_paid) || 0
 
    const { customerId, isExisting, existingCustomer } = await resolveCustomer(
      addForm.name, addForm.phone, addForm.email
    )
 
    // If existing customer found and name differs — show confirmation
    if (isExisting && existingCustomer && !forceNewCustomer) {
      const nameDiffers = existingCustomer.name.toLowerCase().trim() !== addForm.name.toLowerCase().trim()
      if (nameDiffers) {
        setDupCustomer(existingCustomer)
        setPendingSave(() => () => doAddEnquiry(customerId, totalPrice, amountPaid))
        setSaving(false)
        return
      }
    }
 
    await doAddEnquiry(customerId, totalPrice, amountPaid)
  }
 
  const doAddEnquiry = async (customerId: string | null, totalPrice: number, amountPaid: number) => {
    if (!user) return
    const entry = {
      date: new Date().toLocaleDateString('en-IN', { day:'numeric', month:'short' }),
      text: addForm.notes || 'Enquiry recorded.',
      added_by: user.id,
    }
    await supabase.from('hc_enquiries').insert({
      tenant_id:    user.id,
      customer_id:  customerId,
      name:         addForm.name.trim(),
      phone:        addForm.phone || null,
      email:        addForm.email || null,
      source:       addForm.source,
      status:       addForm.status,
      interest:     addForm.interest || null,
      check_in:     addForm.check_in || null,
      check_out:    addForm.check_out || null,
      guests:       parseInt(addForm.guests) || 1,
      total_price:  totalPrice,
      amount_paid:  amountPaid,
      enquiry_date: addForm.enquiry_date || new Date().toISOString().slice(0, 10),
      conversation_log: [entry],
      created_by:   user.id,
      updated_by:   user.id,
    })
    setSaving(false)
    setAddForm(BLANK())
    setShowAdd(false)
    setDupCustomer(null)
    setPendingSave(null)
    load()
    showToast(addForm.name + ' added')
  }
 
  // ── Open edit panel ────────────────────────────────────
  const openPanel = (e: HCEnquiry) => {
    setPanel(e)
    setEditForm({
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
      enquiry_date: e.enquiry_date || e.created_at?.slice(0, 10) || '',
    })
    setNewNote('')
  }
 
  // ── Save edit panel ────────────────────────────────────
  const savePanel = async () => {
    if (!panel || !user) return
    const totalPrice  = parseFloat(editForm.total_price) || 0
    const amountPaid  = parseFloat(editForm.amount_paid) || 0
    const balanceDue  = Math.max(0, totalPrice - amountPaid)
    const wasBooked   = panel.status !== 'booked' && editForm.status === 'booked'
    const isFullyPaid = totalPrice > 0 && amountPaid >= totalPrice
 
    await supabase.from('hc_enquiries').update({
      name:         editForm.name,
      phone:        editForm.phone || null,
      email:        editForm.email || null,
      source:       editForm.source,
      status:       editForm.status,
      interest:     editForm.interest || null,
      check_in:     editForm.check_in || null,
      check_out:    editForm.check_out || null,
      guests:       parseInt(editForm.guests) || 1,
      total_price:  totalPrice,
      amount_paid:  amountPaid,
      enquiry_date: editForm.enquiry_date || null,
      updated_by:   user.id,
      updated_at:   new Date().toISOString(),
    }).eq('id', panel.id)
 
    // Handle income draft
    const { data: existingDrafts } = await supabase
      .from('hc_finance')
      .select('id')
      .eq('tenant_id', panel.tenant_id)
      .eq('enquiry_id', panel.id)
      .eq('type', 'income')
      .eq('status', 'draft')
 
    if (wasBooked) {
      if (!existingDrafts || existingDrafts.length === 0) {
        await supabase.from('hc_finance').insert({
          tenant_id:   panel.tenant_id,
          type:        'income',
          status:      isFullyPaid ? 'confirmed' : 'draft',
          enquiry_id:  panel.id,
          amount:      totalPrice,
          advance_paid: amountPaid,
          balance_due:  balanceDue,
          date:         editForm.check_in || new Date().toISOString().slice(0, 10),
          description:  `${panel.name} booking`,
          created_by:   user.id,
          ...(isFullyPaid ? { confirmed_at: new Date().toISOString(), confirmed_by: user.id } : {}),
        })
        showToast(isFullyPaid ? 'Saved · Income confirmed — fully paid' : 'Saved · Draft income created')
      } else {
        await supabase.from('hc_finance').update({
          amount:       totalPrice,
          advance_paid: amountPaid,
          balance_due:  balanceDue,
          ...(isFullyPaid ? { status:'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: user.id } : {}),
        }).eq('tenant_id', panel.tenant_id).eq('enquiry_id', panel.id).eq('status', 'draft')
        showToast(isFullyPaid ? 'Saved · Income confirmed — fully paid' : 'Changes saved · Draft income updated')
      }
    } else {
      showToast('Changes saved')
    }
 
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
    await supabase.from('hc_enquiries').update({ conversation_log: updatedLog }).eq('id', panel.id)
    setPanel({ ...panel, conversation_log: updatedLog })
    setNewNote('')
    load()
    showToast('Note added')
  }
 
  // ── Delete ─────────────────────────────────────────────
  const deleteEnquiry = async (id: string, name: string) => {
    if (!confirm(`Delete enquiry for ${name}? This cannot be undone.`)) return
    await supabase.from('hc_enquiries').delete().eq('id', id)
    if (panel?.id === id) setPanel(null)
    load()
    showToast(name + ' deleted')
  }
 
  // ── Export ─────────────────────────────────────────────
  const exportExcel = () => {
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
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', padding:'0 22px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
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
          <button onClick={exportExcel} style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>↓ Excel</button>
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
        {(filterStatus || filterSource || filterMonth !== '' || dateFrom || dateTo) && (
          <button onClick={() => { setFilterStatus(''); setFilterSource(''); setFilterMonth(''); setDateFrom(''); setDateTo(''); resetPage() }}
            style={{ fontSize:'11px', color:'#991b1b', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:'8px', padding:'5px 12px', cursor:'pointer', whiteSpace:'nowrap' }}>
            Clear filters
          </button>
        )}
      </div>
 
      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 20px' }}>
 
        {/* Add form */}
        {showAdd && (
          <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'18px 20px', marginBottom:'14px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
              <span style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>New enquiry</span>
              <button onClick={() => setShowAdd(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
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
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'10px' }}>
              {/* Name */}
              {([
                ['Name *', 'name', 'text', 'Full name'],
              ] as [string,string,string,string][]).map(([l, k, t, p]) => (
                <div key={k}>
                  <label style={lbl}>{l}</label>
                  <input type={t} placeholder={p} value={(addForm as Record<string,string>)[k]}
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
                  <select value={addForm.interest} onChange={e => setAddForm(f => ({ ...f, interest: e.target.value }))} style={inp}>
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
                ['Amount paid ₹', 'amount_paid',  'number', '0'],
              ] as [string,string,string,string][]).map(([l, k, t, p]) => (
                <div key={k}>
                  <label style={lbl}>{l}</label>
                  <input type={t} placeholder={p} value={(addForm as Record<string,string>)[k]}
                    onChange={e => setAddForm(f => ({ ...f, [k]: e.target.value }))} style={inp} />
                </div>
              ))}
            </div>
 
            {/* Status */}
            <div style={{ marginBottom:'10px' }}>
              <label style={lbl}>Status</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                {Object.entries(STATUS).map(([k, v]) => (
                  <button key={k} onClick={() => setAddForm(f => ({ ...f, status: k }))}
                    style={{ padding:'5px 12px', borderRadius:'20px', border:'1px solid', borderColor:addForm.status===k?'#17341e':'#e5e7eb', background:addForm.status===k?'#17341e':'#ffffff', color:addForm.status===k?'#ffffff':'#374151', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                    {v.label}
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
              <button onClick={() => setShowAdd(false)} style={{ padding:'9px 18px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
 
        {/* Duplicate customer confirmation popup */}
        {dupCustomer && (
          <>
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', zIndex:60 }} />
            <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#ffffff', borderRadius:'12px', padding:'24px', width:'360px', zIndex:70, boxShadow:'0 8px 32px rgba(0,0,0,0.12)' }}>
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
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'960px' }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid #e5e7eb', background:'#f9fafb' }}>
                    {['Customer','Source','Property / Stay','Enquiry date','Check-in','Check-out','Guests','Total','Paid','Balance','Status',''].map(h => (
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
                        <td style={{ padding:'11px 14px' }}>
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
                          <div style={{ display:'flex', gap:'6px' }}>
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
          <div onClick={() => setPanel(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.2)', zIndex:40 }} />
          <div style={{ position:'fixed', top:0, right:0, width:'340px', height:'100%', background:'#ffffff', borderLeft:'1px solid #e5e7eb', display:'flex', flexDirection:'column', zIndex:50 }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>{panel.name}</div>
                <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>{panel.source} · {fmtDate(panel.enquiry_date || panel.created_at)}</div>
              </div>
              <button onClick={() => setPanel(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
 
            <div style={{ flex:1, overflowY:'auto', padding:'16px 18px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'14px' }}>
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
                    <input type={t} value={editForm[k] || ''} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={inp} />
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
                    <select value={editForm.interest} onChange={e => setEditForm(f => ({ ...f, interest: e.target.value }))} style={inp}>
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
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                  <div>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Total price ₹</label>
                    <input type="number" value={editForm.total_price} onChange={e => setEditForm(f => ({ ...f, total_price: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ ...lbl, color:'#9ca3af' }}>Amount paid ₹</label>
                    <input type="number" value={editForm.amount_paid} onChange={e => setEditForm(f => ({ ...f, amount_paid: e.target.value }))} style={inp} />
                  </div>
                </div>
                {(() => {
                  const total   = parseFloat(editForm.total_price) || 0
                  const paid    = parseFloat(editForm.amount_paid) || 0
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
                <div style={{ display:'flex', flexWrap:'wrap', gap:'5px' }}>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <button key={k} onClick={() => setEditForm(f => ({ ...f, status: k }))}
                      style={{ padding:'5px 10px', borderRadius:'20px', border:'1px solid', borderColor:editForm.status===k?'#17341e':'#e5e7eb', background:editForm.status===k?'#17341e':'#ffffff', color:editForm.status===k?'#ffffff':'#374151', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                      {v.label}
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
              <button onClick={() => setPanel(null)} style={{ padding:'9px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
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