import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCFinance, HCProfile, fmt, fmtDate } from '../lib/supabase'
import * as XLSX from 'xlsx'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const PAGE_SIZE = 50
const DEFAULT_PAYMENT_TYPES = ['UPI','Cash','Bank transfer','Cheque']
 
const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const inpRO: React.CSSProperties = { ...inp, background:'#f9fafb', color:'#6b7280', cursor:'not-allowed' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
 
function getStatusBadge(r: HCFinance): { label: string; bg: string; color: string } {
  if (r.status === 'draft')    return { label:'Draft',       bg:'#fef9c3', color:'#854f0b' }
  if ((r.balance_due || 0) === 0) return { label:'Paid in full', bg:'#dcfce7', color:'#166534' }
  return { label:'Part paid', bg:'#fef9c3', color:'#854f0b' }
}
 
// ── Receipt Modal ──────────────────────────────────────────────
interface ReceiptProps { record: HCFinance; profile: HCProfile | null; onClose: () => void }
 
const ReceiptModal: React.FC<ReceiptProps> = ({ record, profile, onClose }) => {
  const printRef = useRef<HTMLDivElement>(null)
 
  const handlePrint = () => {
    const el = printRef.current
    if (!el) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write('<html><head><title>Receipt</title><style>'
      + 'body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#111}'
      + '.biz{text-align:center;border-bottom:2px solid #17341e;padding-bottom:16px;margin-bottom:16px}'
      + '.biz-name{font-size:20px;font-weight:600;color:#17341e}'
      + '.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f3f4f6;font-size:13px}'
      + '.lbl{color:#6b7280}.val{font-weight:500}'
      + '.total{display:flex;justify-content:space-between;padding:10px 0;font-size:15px;font-weight:600;border-top:2px solid #17341e;margin-top:4px}'
      + '.footer{text-align:center;margin-top:20px;font-size:11px;color:#9ca3af}'
      + '</style></head><body>' + el.innerHTML + '</body></html>')
    w.document.close()
    w.print()
  }
 
  const handleWhatsApp = () => {
    const rawPhone = record.enquiry?.phone || ''
    const phone = rawPhone.replace(/\D/g, '')
    const bizName = profile?.business_name || 'HC Business'
    const guestName = record.enquiry?.name || record.description || ''
    const msg = encodeURIComponent(
      `*Receipt — ${bizName}*\n\n`
      + `Guest: ${guestName}\n`
      + `Total: ${fmt(record.amount)}\n`
      + `Paid: ${fmt(record.advance_paid)}\n`
      + `Balance: ${fmt(record.balance_due)}\n\n`
      + `Thank you for choosing ${bizName}!`
    )
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank')
  }
 
  const receiptDate = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })
 
  const checkIn  = record.enquiry?.check_in  ? new Date(record.enquiry.check_in + 'T12:00:00').toLocaleDateString('en-IN',  { day:'numeric', month:'short', year:'numeric' }) : '—'
  const checkOut = record.enquiry?.check_out ? new Date(record.enquiry.check_out + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'
 
  const rows: Array<[string, string]> = [
    ['Guest name',    record.enquiry?.name || record.description || '—'],
    ['Phone',         record.enquiry?.phone || '—'],
    ['Property / stay', record.enquiry?.interest || '—'],
    ['Check-in',      checkIn],
    ['Check-out',     checkOut],
    ['Guests',        record.enquiry?.guests ? String(record.enquiry.guests) : '—'],
    ['Payment date',  fmtDate(record.date)],
    ['Payment type',  record.payment_type || '—'],
  ]
 
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:60 }} />
      <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'#ffffff', borderRadius:'12px', padding:'28px', width:'440px', zIndex:70, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
        <div ref={printRef}>
          <div className="biz" style={{ textAlign:'center', borderBottom:'2px solid #17341e', paddingBottom:'16px', marginBottom:'16px' }}>
            {profile?.logo_url && <img src={profile.logo_url} alt="logo" style={{ height:'48px', marginBottom:'8px', display:'block', margin:'0 auto 8px' }} />}
            <div style={{ fontSize:'20px', fontWeight:600, color:'#17341e' }}>{profile?.business_name || 'HC Business'}</div>
            {profile?.address && <div style={{ fontSize:'12px', color:'#6b7280', marginTop:'2px' }}>{profile.address}</div>}
            {profile?.phone && <div style={{ fontSize:'12px', color:'#6b7280' }}>{profile.phone}</div>}
            {profile?.gst_number && <div style={{ fontSize:'12px', color:'#6b7280' }}>GST: {profile.gst_number}</div>}
            <div style={{ fontSize:'13px', color:'#374151', marginTop:'8px', fontWeight:500, letterSpacing:'0.05em' }}>RECEIPT</div>
            <div style={{ fontSize:'11px', color:'#9ca3af' }}>{receiptDate}</div>
          </div>
 
          {rows.map(([label, value]) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f3f4f6', fontSize:'13px' }}>
              <span style={{ color:'#6b7280' }}>{label}</span>
              <span style={{ fontWeight:500 }}>{value}</span>
            </div>
          ))}
 
          <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f3f4f6', fontSize:'13px' }}>
            <span style={{ color:'#6b7280' }}>Total booking amount</span>
            <span style={{ fontWeight:500 }}>{fmt(record.amount)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f3f4f6', fontSize:'13px' }}>
            <span style={{ color:'#6b7280' }}>Amount paid</span>
            <span style={{ fontWeight:500, color:'#166534' }}>{fmt(record.advance_paid)}</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', fontSize:'15px', fontWeight:600, borderTop:'2px solid #17341e', marginTop:'4px' }}>
            <span>Balance due</span>
            <span style={{ color: (record.balance_due || 0) > 0 ? '#991b1b' : '#166534' }}>
              {(record.balance_due || 0) > 0 ? fmt(record.balance_due) : 'Fully paid'}
            </span>
          </div>
 
          <div style={{ textAlign:'center', marginTop:'20px', fontSize:'11px', color:'#9ca3af' }}>
            Thank you for choosing {profile?.business_name || 'us'}!
          </div>
        </div>
 
        <div style={{ display:'flex', gap:'8px', marginTop:'20px' }}>
          <button onClick={handlePrint} style={{ flex:1, padding:'10px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            Print / PDF
          </button>
          <button onClick={handleWhatsApp} style={{ flex:1, padding:'10px', background:'#25d366', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            WhatsApp
          </button>
          <button onClick={onClose} style={{ padding:'10px 16px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </>
  )
}
 
// ── Main Income component ──────────────────────────────────────
export const Income: React.FC = () => {
  const { user, tenantId } = useAuth()
  const [records, setRecords]   = useState<HCFinance[]>([])
  const [profile, setProfile]   = useState<HCProfile | null>(null)
  const [loading, setLoading]   = useState(true)
  const [filterMonth, setFilterMonth]     = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [filterInterest, setFilterInterest] = useState('')
  const [interests, setInterests]         = useState<string[]>([])
  const [currentPage, setCurrentPage]     = useState(1)
  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState({ description:'', total:'', amountPaid:'', expectedDate:'', paymentType:'UPI', notes:'' })
  const [saving, setSaving]     = useState(false)
  const [paymentTypes, setPaymentTypes] = useState<string[]>(DEFAULT_PAYMENT_TYPES)
  const [addingPayType, setAddingPayType] = useState(false)
  const [newPayType, setNewPayType] = useState('')
  const [addingEditPayType, setAddingEditPayType] = useState(false)
  const [newEditPayType, setNewEditPayType] = useState('')
  const [managingPayTypes, setManagingPayTypes] = useState(false)
  const [editRecord, setEditRecord]   = useState<HCFinance | null>(null)
  const [amountNow, setAmountNow]     = useState('')
  const [editPayType, setEditPayType] = useState('UPI')
  const [editExpDate, setEditExpDate] = useState('')
  const [editNotes, setEditNotes]     = useState('')
  const [receiptRec, setReceiptRec]   = useState<HCFinance | null>(null)
  const [toast, setToast] = useState('')
 
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }
 
  const load = useCallback(async () => {
    if (!user) return
    const [{ data }, { data: prof }, { data: ptData }, { data: invData }] = await Promise.all([
      supabase.from('hc_finance')
        .select('*, enquiry:hc_enquiries(name, phone, total_price, amount_paid, interest, check_in, check_out, guests)')
        .eq('tenant_id', tenantId)
        .eq('type', 'income')
        .order('date', { ascending: false }),
      supabase.from('hc_profiles').select('*').eq('id', tenantId).single(),
      supabase.from('hc_settings').select('value').eq('tenant_id', tenantId).eq('type', 'payment_type').order('sort_order'),
      supabase.from('hc_inventory').select('name').eq('tenant_id', tenantId).eq('is_active', true).order('sort_order'),
    ])
    const incRecords = (data as HCFinance[]) || []
    setRecords(incRecords)
    setProfile(prof as HCProfile)
 
    // Merge payment types from settings + types already used in records
    const settingsPT = ptData && ptData.length > 0 ? ptData.map(p => p.value) : DEFAULT_PAYMENT_TYPES
    const recordPT = incRecords.map(r => r.payment_type).filter(Boolean) as string[]
    const mergedPT = Array.from(new Set([...settingsPT, ...recordPT]))
    const missingPT = mergedPT.filter(p => !settingsPT.includes(p))
    if (missingPT.length > 0 && tenantId) {
      try {
        await supabase.from('hc_settings').insert(
          missingPT.map((p, i) => ({ tenant_id: tenantId, type: 'payment_type', value: p, sort_order: settingsPT.length + i }))
        )
      } catch (_) { /* ignore duplicate errors */ }
    }
    setPaymentTypes(mergedPT)
    // Merge interests from inventory + interests already used in income records
    const invInterests = invData ? invData.map((i: {name: string}) => i.name) : []
    const recordInterests = incRecords.map((r: any) => r.enquiry?.interest).filter(Boolean) as string[]
    const mergedInterests = Array.from(new Set([...invInterests, ...recordInterests]))
    setInterests(mergedInterests)
    setLoading(false)
  }, [user, tenantId])
 
  const addPayTypeOption = async (val: string, isEdit = false) => {
    if (!val.trim() || !tenantId) return
    await supabase.from('hc_settings').insert({ tenant_id: tenantId, type: 'payment_type', value: val.trim(), sort_order: paymentTypes.length })
    const updated = [...paymentTypes, val.trim()]
    setPaymentTypes(updated)
    if (isEdit) { setNewEditPayType(''); setAddingEditPayType(false) }
    else { setNewPayType(''); setAddingPayType(false) }
  }
 
  const deletePayTypeOption = async (val: string) => {
    if (!tenantId) return
    await supabase.from('hc_settings').delete().eq('tenant_id', tenantId).eq('type', 'payment_type').eq('value', val)
    setPaymentTypes(prev => prev.filter(p => p !== val))
  }
 
  useEffect(() => { load() }, [load])
 
  // ── Filter ─────────────────────────────────────────────────
  const filtered = records.filter(r => {
    if (filterMonth !== '' && new Date(r.date).getMonth() !== parseInt(filterMonth)) return false
    if (filterPayment && r.payment_type !== filterPayment) return false
    if (filterInterest && r.enquiry?.interest !== filterInterest) return false
    return true
  })
 
  // ── Sort: drafts on top, confirmed at bottom ───────────────
  const sorted: HCFinance[] = [
    ...filtered.filter(r => r.status === 'draft').sort((a, b) => b.date.localeCompare(a.date)),
    ...filtered.filter(r => r.status === 'confirmed').sort((a, b) => b.date.localeCompare(a.date)),
  ]
 
  const totalPages  = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated   = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const confirmedTotal = filtered.filter(r => r.status === 'confirmed').reduce((s, r) => s + (r.advance_paid || 0), 0)
  const drafts      = filtered.filter(r => r.status === 'draft')
 
  // ── Edit panel derived values ──────────────────────────────
  const totalPrice   = Number(editRecord?.enquiry?.total_price ?? editRecord?.amount ?? 0)
  const alreadyPaid  = Number(editRecord?.enquiry?.amount_paid ?? editRecord?.advance_paid ?? 0)
  const trueBalance  = Math.max(0, totalPrice - alreadyPaid)
  const amountNowNum = parseFloat(amountNow) || 0
  const newPaid      = alreadyPaid + amountNowNum
  const newBalance   = Math.max(0, totalPrice - newPaid)
  const isFullyPaid  = totalPrice > 0 && newPaid >= totalPrice
  const exceedsMax   = amountNow !== '' && amountNowNum > trueBalance
 
  const openEdit = (r: HCFinance) => {
    setEditRecord(r)
    setAmountNow('')
    setEditPayType(r.payment_type || 'UPI')
    setEditExpDate(r.expected_date || '')
    setEditNotes(r.notes || '')
  }
 
  const saveEdit = async () => {
    if (!editRecord || !user || exceedsMax) return
    setSaving(true)
    await supabase.from('hc_finance').update({
      advance_paid:  newPaid,
      balance_due:   newBalance,
      amount:        totalPrice,
      expected_date: editExpDate || null,
      payment_type:  editPayType,
      notes:         editNotes,
      ...(isFullyPaid ? { status:'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: user.id } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', editRecord.id)
 
    if (editRecord.enquiry_id) {
      await supabase.from('hc_enquiries').update({
        amount_paid: newPaid,
        updated_at:  new Date().toISOString(),
      }).eq('id', editRecord.enquiry_id)
    }
 
    setSaving(false)
    setEditRecord(null)
    load()
    showToast(isFullyPaid ? 'Fully paid — income confirmed' : `Saved · Balance: ${fmt(newBalance)}`)
  }
 
  const handleAdd = async () => {
    if (!user || !addForm.total) { showToast('Total amount is required'); return }
    setSaving(true)
    const total = parseFloat(addForm.total) || 0
    const paid  = parseFloat(addForm.amountPaid) || 0
    const bal   = Math.max(0, total - paid)
    const full  = total > 0 && paid >= total
    await supabase.from('hc_finance').insert({
      tenant_id: tenantId, type:'income', status: full ? 'confirmed' : 'draft',
      amount: total, advance_paid: paid, balance_due: bal,
      description: addForm.description, expected_date: addForm.expectedDate || null,
      payment_type: addForm.paymentType, notes: addForm.notes,
      date: new Date().toISOString().slice(0, 10), created_by: user.id,
      ...(full ? { confirmed_at: new Date().toISOString(), confirmed_by: user.id } : {}),
    })
    setSaving(false)
    setAddForm({ description:'', total:'', amountPaid:'', expectedDate:'', paymentType:'UPI', notes:'' })
    setShowAdd(false)
    load()
    showToast('Income saved')
  }
 
  const exportExcel = () => {
    if (sorted.length === 0) { showToast('No records to export'); return }
    const rows = sorted.map(r => ({
      Date:             r.date,
      Customer:         String(r.enquiry?.name || r.description || ''),
      'Property / Stay': r.enquiry?.interest || '',
      'Total':          r.amount || 0,
      'Amount paid':    r.advance_paid || 0,
      'Balance':        r.balance_due || 0,
      'Payment type':   r.payment_type || '',
      Status:           r.status === 'draft' ? 'Draft' : (r.balance_due || 0) === 0 ? 'Paid in full' : 'Part paid',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Income')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `income-${new Date().toISOString().slice(0, 7)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`Exported ${sorted.length} records`)
  }
 
  const sel: React.CSSProperties = { padding:'7px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151', background:'#ffffff', outline:'none', cursor:'pointer' }
 
  const PaginationBtn: React.FC<{ label: string; onClick: () => void; disabled?: boolean; active?: boolean }> = ({ label, onClick, disabled, active }) => (
    <button onClick={onClick} disabled={disabled}
      style={{ padding:'6px 12px', background: active ? '#17341e' : '#ffffff', color: disabled ? '#d1d5db' : active ? '#ffffff' : '#111111', border:'1px solid', borderColor: active ? '#17341e' : '#e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor: disabled ? 'default' : 'pointer', minWidth:'36px' }}>
      {label}
    </button>
  )
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
 
      {/* Topbar */}
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', padding:'0 22px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Income</span>
          <span style={{ fontSize:'12px', color:'#9ca3af' }}>Confirmed: {fmt(confirmedTotal)}</span>
          {drafts.length > 0 && (
            <span style={{ fontSize:'11px', background:'#fef9c3', color:'#854d0e', padding:'2px 8px', borderRadius:'20px', fontWeight:500 }}>
              {drafts.length} draft{drafts.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <select value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setCurrentPage(1) }} style={{ ...sel, width:'130px' }}>
            <option value="">All months</option>
            {MONTHS.map((m, idx) => <option key={m} value={String(idx)}>{m}</option>)}
          </select>
          <select value={filterInterest} onChange={e => { setFilterInterest(e.target.value); setCurrentPage(1) }} style={sel}>
            <option value="">All properties</option>
            {interests.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={filterPayment} onChange={e => { setFilterPayment(e.target.value); setCurrentPage(1) }} style={sel}>
            <option value="">All payment types</option>
            {paymentTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>
          <button onClick={exportExcel} style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>↓ Excel</button>
          <button onClick={() => setShowAdd(v => !v)} style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            + Add income
          </button>
        </div>
      </div>
 
      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 20px' }}>
 
        {/* Manual add form */}
        {showAdd && (
          <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'18px 20px', marginBottom:'14px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
              <span style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>New income entry</span>
              <button onClick={() => setShowAdd(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>x</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'14px' }}>
              <div><label style={lbl}>Description *</label><input placeholder="e.g. Walk-in booking" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Total price Rs *</label><input type="number" placeholder="0" value={addForm.total} onChange={e => setAddForm(f => ({ ...f, total: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Amount paid Rs</label><input type="number" placeholder="0" value={addForm.amountPaid} onChange={e => setAddForm(f => ({ ...f, amountPaid: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Expected date</label><input type="date" value={addForm.expectedDate} onChange={e => setAddForm(f => ({ ...f, expectedDate: e.target.value }))} style={inp} /></div>
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <label style={lbl}>Payment type</label>
                  <span onClick={() => setManagingPayTypes(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingPayTypes ? 'Done' : 'Manage'}</span>
                </div>
                {managingPayTypes ? (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                    {paymentTypes.map(pt => (
                      <div key={pt} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                        <span style={{ fontSize:'12px', color:'#374151' }}>{pt}</span>
                        <button onClick={() => deletePayTypeOption(pt)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                      </div>
                    ))}
                    {paymentTypes.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                  </div>
                ) : (
                  <select value={addForm.paymentType} onChange={e => setAddForm(f => ({ ...f, paymentType: e.target.value }))} style={inp}>
                    {paymentTypes.map(pt => <option key={pt}>{pt}</option>)}
                    <option value="__add__">+ Add new...</option>
                  </select>
                )}
                {addForm.paymentType === '__add__' && !managingPayTypes && (
                  <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                    <input value={newPayType} onChange={e => setNewPayType(e.target.value)} placeholder="New payment type" style={{ ...inp, flex:1 }}
                      onKeyDown={e => { if (e.key === 'Enter') { addPayTypeOption(newPayType); setAddForm(f => ({ ...f, paymentType: newPayType.trim() })) } }} autoFocus />
                    <button onClick={() => { addPayTypeOption(newPayType); setAddForm(f => ({ ...f, paymentType: newPayType.trim() })) }}
                      style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                    <button onClick={() => { setNewPayType(''); setAddForm(f => ({ ...f, paymentType: paymentTypes[0] })) }}
                      style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                  </div>
                )}
              </div>
              <div><label style={lbl}>Notes</label><input placeholder="Optional" value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={handleAdd} disabled={saving} style={{ padding:'9px 22px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:saving?0.7:1 }}>{saving ? 'Saving...' : 'Save income'}</button>
              <button onClick={() => setShowAdd(false)} style={{ padding:'9px 18px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
 
        {/* Table */}
        <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden' }}>
          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>Loading...</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'980px' }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid #e5e7eb', background:'#f9fafb' }}>
                    {['Date','Customer','Property / Stay','Total','Paid','Balance','Payment type','Status',''].map(h => (
                      <th key={h} style={{ padding:'11px 16px', textAlign:'left', fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding:'32px', textAlign:'center', fontSize:'12px', color:'#9ca3af' }}>No income records yet.</td></tr>
                  ) : paginated.map(r => {
                    const badge    = getStatusBadge(r)
                    const isDraft  = r.status === 'draft'
                    const custName = String(r.enquiry?.name || r.description || '—')
                    const balance  = r.balance_due || 0
                    return (
                      <tr key={r.id} style={{ borderBottom:'1px solid #f3f4f6', background: isDraft ? '#fefce8' : '#ffffff' }}>
                        <td style={{ padding:'12px 16px', fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap' }}>{fmtDate(r.date)}</td>
                        <td style={{ padding:'12px 16px' }}>
                          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{custName}</div>
                        </td>
                        <td style={{ padding:'12px 16px', fontSize:'12px', color:'#6b7280', whiteSpace:'nowrap' }}>{r.enquiry?.interest || '—'}</td>
                        <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:500, color:'#111111', whiteSpace:'nowrap' }}>{(r.amount || 0) > 0 ? fmt(r.amount) : '—'}</td>
                        <td style={{ padding:'12px 16px', fontSize:'13px', color:'#166534', whiteSpace:'nowrap' }}>{(r.advance_paid || 0) > 0 ? fmt(r.advance_paid) : '—'}</td>
                        <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight: balance > 0 ? 500 : 400, color: balance > 0 ? '#991b1b' : '#9ca3af', whiteSpace:'nowrap' }}>
                          {balance > 0 ? fmt(balance) : r.status === 'confirmed' ? 'Paid' : '—'}
                        </td>
                        <td style={{ padding:'12px 16px', fontSize:'12px', color:'#6b7280', whiteSpace:'nowrap' }}>{r.payment_type || '—'}</td>
                        <td style={{ padding:'12px 16px' }}>
                          <span style={{ display:'inline-block', padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:500, background:badge.bg, color:badge.color, whiteSpace:'nowrap' }}>{badge.label}</span>
                        </td>
                        <td style={{ padding:'12px 16px' }}>
                          <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end', whiteSpace:'nowrap' }}>
                            <button onClick={() => openEdit(r)} style={{ padding:'6px 12px', background:'#dbeafe', color:'#1e40af', border:'1px solid #93c5fd', borderRadius:'8px', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>
                              Edit
                            </button>
                            {r.status === 'confirmed' && (
                              <button onClick={() => setReceiptRec(r)} style={{ padding:'6px 12px', background:'#fef9c3', color:'#854f0b', border:'1px solid #fde047', borderRadius:'8px', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>Receipt</button>
                            )}
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
              {`Showing ${((currentPage-1)*PAGE_SIZE)+1}–${Math.min(currentPage*PAGE_SIZE, sorted.length)} of ${sorted.length}`}
            </span>
            <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
              <PaginationBtn label="Prev" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage === 1} />
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(pn => pn === 1 || pn === totalPages || Math.abs(pn - currentPage) <= 1)
                .map((pn, idx, arr) => (
                  <React.Fragment key={pn}>
                    {idx > 0 && arr[idx - 1] !== pn - 1 && (
                      <span style={{ color:'#9ca3af', fontSize:'12px', padding:'0 2px' }}>...</span>
                    )}
                    <PaginationBtn label={String(pn)} onClick={() => setCurrentPage(pn)} active={pn === currentPage} />
                  </React.Fragment>
                ))}
              <PaginationBtn label="Next" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage === totalPages} />
            </div>
          </div>
        )}
      </div>
 
      {/* Edit / Record payment panel */}
      {editRecord && (
        <>
          <div onClick={() => setEditRecord(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.2)', zIndex:40 }} />
          <div style={{ position:'fixed', top:0, right:0, width:'340px', height:'100%', background:'#ffffff', borderLeft:'1px solid #e5e7eb', display:'flex', flexDirection:'column', zIndex:50 }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>{String(editRecord.enquiry?.name || editRecord.description || '')}</div>
                <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>{fmtDate(editRecord.date)}</div>
              </div>
              <button onClick={() => setEditRecord(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>x</button>
            </div>
 
            <div style={{ flex:1, overflowY:'auto', padding:'16px 18px' }}>
              <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'14px', marginBottom:'14px' }}>
                <div style={{ fontSize:'11px', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'12px' }}>Payment breakdown</div>
 
                <div style={{ marginBottom:'10px' }}>
                  <label style={lbl}>Total price Rs <span style={{ textTransform:'none', fontWeight:400, fontSize:'9px', color:'#9ca3af' }}>(from booking)</span></label>
                  <input type="number" value={totalPrice} readOnly style={inpRO} />
                </div>
 
                <div style={{ marginBottom:'10px' }}>
                  <label style={lbl}>Already paid Rs <span style={{ textTransform:'none', fontWeight:400, fontSize:'9px', color:'#9ca3af' }}>(received so far)</span></label>
                  <input type="number" value={alreadyPaid} readOnly style={inpRO} />
                </div>
 
                <div style={{ marginBottom:'10px' }}>
                  <label style={lbl}>Amount received now Rs</label>
                  <input
                    type="number"
                    value={amountNow}
                    onChange={e => setAmountNow(e.target.value)}
                    placeholder={`Max: Rs ${trueBalance.toLocaleString('en-IN')}`}
                    style={{ ...inp, borderColor: exceedsMax ? '#fca5a5' : '#e5e7eb' }}
                    autoFocus
                  />
                  {exceedsMax && (
                    <div style={{ fontSize:'11px', color:'#991b1b', marginTop:'4px' }}>
                      {`Exceeds remaining balance of ${fmt(trueBalance)}`}
                    </div>
                  )}
                </div>
 
                <div style={{ marginBottom:'10px' }}>
                  <label style={lbl}>New balance Rs <span style={{ textTransform:'none', fontWeight:400, fontSize:'9px', color:'#9ca3af' }}>(auto-calculated)</span></label>
                  <input type="number" value={amountNow !== '' ? newBalance : trueBalance} readOnly style={inpRO} />
                </div>
 
                {amountNow !== '' && totalPrice > 0 && (
                  <div style={{ padding:'8px 12px', borderRadius:'6px', background: isFullyPaid ? '#dcfce7' : '#fef9c3', border:`1px solid ${isFullyPaid ? '#86efac' : '#fde047'}` }}>
                    <span style={{ fontSize:'12px', fontWeight:500, color: isFullyPaid ? '#166534' : '#854f0b' }}>
                      {isFullyPaid ? 'Fully paid — will confirm on save' : `${fmt(newBalance)} still pending`}
                    </span>
                  </div>
                )}
              </div>
 
              <div style={{ marginBottom:'12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <label style={lbl}>Payment type</label>
                  <span onClick={() => setManagingPayTypes(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingPayTypes ? 'Done' : 'Manage'}</span>
                </div>
                {managingPayTypes ? (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                    {paymentTypes.map(pt => (
                      <div key={pt} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                        <span style={{ fontSize:'12px', color:'#374151' }}>{pt}</span>
                        <button onClick={() => deletePayTypeOption(pt)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                      </div>
                    ))}
                    {paymentTypes.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                  </div>
                ) : (
                  <select value={editPayType} onChange={e => setEditPayType(e.target.value)} style={inp}>
                    {paymentTypes.map(pt => <option key={pt}>{pt}</option>)}
                    <option value="__add__">+ Add new...</option>
                  </select>
                )}
                {editPayType === '__add__' && !managingPayTypes && (
                  <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                    <input value={newEditPayType} onChange={e => setNewEditPayType(e.target.value)} placeholder="New payment type" style={{ ...inp, flex:1 }}
                      onKeyDown={e => { if (e.key === 'Enter') { addPayTypeOption(newEditPayType, true); setEditPayType(newEditPayType.trim()) } }} autoFocus />
                    <button onClick={() => { addPayTypeOption(newEditPayType, true); setEditPayType(newEditPayType.trim()) }}
                      style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                    <button onClick={() => { setNewEditPayType(''); setEditPayType(paymentTypes[0]) }}
                      style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                  </div>
                )}
              </div>
 
              <div style={{ marginBottom:'12px' }}>
                <label style={lbl}>Expected payment date</label>
                <input type="date" value={editExpDate} onChange={e => setEditExpDate(e.target.value)} style={inp} />
              </div>
 
              <div style={{ marginBottom:'12px' }}>
                <label style={lbl}>Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} style={{ ...inp, resize:'none' }} placeholder="Optional notes..." />
              </div>
            </div>
 
            <div style={{ padding:'12px 18px', borderTop:'1px solid #e5e7eb', display:'flex', gap:'8px', flexShrink:0 }}>
              <button
                onClick={saveEdit}
                disabled={saving || exceedsMax}
                style={{ flex:1, padding:'9px', background: exceedsMax ? '#f3f4f6' : '#17341e', color: exceedsMax ? '#9ca3af' : '#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor: exceedsMax ? 'not-allowed' : 'pointer', opacity:saving?0.7:1 }}
              >
                {saving ? 'Saving...' : exceedsMax ? 'Amount too high' : 'Save changes'}
              </button>
              <button onClick={() => setEditRecord(null)} style={{ padding:'9px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        </>
      )}
 
      {/* Receipt modal */}
      {receiptRec && <ReceiptModal record={receiptRec} profile={profile} onClose={() => setReceiptRec(null)} />}
 
      {toast && (
        <div style={{ position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#17341e', color:'#ffffff', fontSize:'12px', fontWeight:500, padding:'8px 20px', borderRadius:'20px', zIndex:80, whiteSpace:'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
 
export default Income