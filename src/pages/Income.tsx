import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCFinance, HCProfile, HCPayment, fmt, fmtDate, logActivity, getActor } from '../lib/supabase'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const PAGE_SIZE = 50
const DEFAULT_PAYMENT_TYPES = ['UPI','Cash','Bank transfer','Cheque']
 
const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const inpRO: React.CSSProperties = { ...inp, background:'#f9fafb', color:'#6b7280', cursor:'not-allowed' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
 
type RecordStatusKey = 'draft' | 'paid_full' | 'refunded'

function getRecordStatusKey(r: HCFinance): RecordStatusKey {
  if (r.status === 'refunded') return 'refunded'
  if (r.status === 'draft')    return 'draft'
  return 'paid_full'
}

const STATUS_KEY_LABEL: Record<RecordStatusKey, string> = {
  draft: 'Draft', paid_full: 'Paid in full', refunded: 'Refunded',
}

function getStatusBadge(r: HCFinance): { label: string; bg: string; color: string } {
  const key = getRecordStatusKey(r)
  if (key === 'refunded')  return { label:'Refunded',    bg:'#fee2e2', color:'#991b1b' }
  if (key === 'draft')     return { label:'Draft',       bg:'#fef9c3', color:'#854f0b' }
  return { label:'Paid in full', bg:'#dcfce7', color:'#166534' }
}
 
// ── Receipt Modal ──────────────────────────────────────────────
interface ReceiptProps { record: HCFinance; profile: HCProfile | null; onClose: () => void }
 
const ReceiptModal: React.FC<ReceiptProps> = ({ record, profile, onClose }) => {
  const printRef = useRef<HTMLDivElement>(null)
  const [payments, setPayments] = useState<HCPayment[]>([])

  useEffect(() => {
    supabase.from('hc_payments').select('*').eq('finance_id', record.id).order('payment_date')
      .then(({ data }) => setPayments((data as HCPayment[]) || []))
  }, [record.id])

  const kindLabel = (k: HCPayment['kind']) =>
    k === 'advance' ? 'Advance' : k === 'full' ? 'Full payment' : k === 'refund' ? 'Refund' : 'Additional payment'
 
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
 
  const handleDownloadPDF = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a5' })
    const biz = profile?.business_name || 'HC Business'
    const addr = profile?.address || ''
    const phone = profile?.phone || ''
    const name = record.enquiry?.name || record.description || '—'
    const total = record.amount || 0
    const balance = record.balance_due || 0
    const refunded = record.refunded_amount || 0
    const date = fmtDate(record.date)
 
    doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text(biz, 74, 16, { align:'center' })
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100)
    if (addr) doc.text(addr, 74, 22, { align:'center' })
    if (phone) doc.text(phone, 74, 27, { align:'center' })
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(0)
    doc.text('RECEIPT', 74, 36, { align:'center' })
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100)
    doc.text(date, 74, 41, { align:'center' })
    doc.setDrawColor(200); doc.line(10, 44, 138, 44)
    doc.setTextColor(0); doc.setFontSize(10)
    const rows = [
      ['Receipt no.', record.receipt_number || '—'],
      ['Guest name', name],
      ['Property / Stay', record.enquiry?.interest || '—'],
      ['Check-in', record.enquiry?.check_in ? new Date(record.enquiry.check_in + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'],
      ['Check-out', record.enquiry?.check_out ? new Date(record.enquiry.check_out + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'],
      ['Accounting period', record.accounting_date ? new Date(record.accounting_date + 'T12:00:00').toLocaleDateString('en-IN', { month:'long', year:'numeric' }) : '—'],
      ['Total booking amount', 'Rs. ' + Math.round(total).toLocaleString('en-IN')],
    ]
    let y = 52
    rows.forEach(([label, val]) => {
      doc.setTextColor(100); doc.text(label, 12, y)
      doc.setTextColor(0); doc.setFont('helvetica','bold'); doc.text(val, 136, y, { align:'right' })
      doc.setFont('helvetica','normal')
      y += 8
    })

    // Itemized payment history — every installment gets its own line, not just a single cumulative total
    if (payments.length > 0) {
      doc.setDrawColor(200); doc.line(10, y, 138, y); y += 6
      doc.setFontSize(8); doc.setTextColor(100); doc.setFont('helvetica','bold')
      doc.text('PAYMENT HISTORY', 12, y); y += 6
      doc.setFontSize(9)
      payments.forEach(p => {
        doc.setFont('helvetica','normal'); doc.setTextColor(100)
        const label = `${fmtDate(p.payment_date)} - ${kindLabel(p.kind)}${p.payment_type ? ' (' + p.payment_type + ')' : ''}`
        doc.text(label, 12, y)
        doc.setFont('helvetica','bold'); doc.setTextColor(p.kind === 'refund' ? 153 : 22)
        doc.text((p.kind === 'refund' ? '- ' : '') + 'Rs. ' + Math.round(p.amount).toLocaleString('en-IN'), 136, y, { align:'right' })
        y += 6
      })
    }

    doc.setDrawColor(23,52,30); doc.line(10, y, 138, y); y += 6
    doc.setFontSize(11); doc.setFont('helvetica','bold')
    if (record.status === 'refunded') {
      doc.setTextColor(153); doc.text('Refunded', 12, y)
      doc.text('Rs. ' + Math.round(refunded).toLocaleString('en-IN'), 136, y, { align:'right' })
    } else {
      doc.text('Balance due', 12, y)
      doc.setTextColor(balance > 0 ? 153 : 22); doc.text(balance > 0 ? 'Rs. ' + Math.round(balance).toLocaleString('en-IN') : 'Fully paid', 136, y, { align:'right' })
    }
    doc.setTextColor(150); doc.setFontSize(9); doc.setFont('helvetica','normal')
    doc.text('Thank you for choosing ' + biz + '!', 74, y + 10, { align:'center' })
    doc.save('receipt-' + name.replace(/\s+/g,'-').toLowerCase() + '.pdf')
  }
 
  const receiptDate = new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })
 
  const checkIn  = record.enquiry?.check_in  ? new Date(record.enquiry.check_in + 'T12:00:00').toLocaleDateString('en-IN',  { day:'numeric', month:'short', year:'numeric' }) : '—'
  const checkOut = record.enquiry?.check_out ? new Date(record.enquiry.check_out + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'
 
  const acctDate = record.accounting_date
    ? new Date(record.accounting_date + 'T12:00:00').toLocaleDateString('en-IN', { month:'long', year:'numeric' })
    : '—'

  const rows: Array<[string, string]> = [
    ['Receipt no.',   record.receipt_number || '—'],
    ['Guest name',    record.enquiry?.name || record.description || '—'],
    ['Phone',         record.enquiry?.phone || '—'],
    ['Property / stay', record.enquiry?.interest || '—'],
    ['Check-in',      checkIn],
    ['Check-out',     checkOut],
    ['Guests',        record.enquiry?.guests ? String(record.enquiry.guests) : '—'],
    ['Payment date',  fmtDate(record.date)],
    ['Payment type',  record.payment_type || '—'],
    ['Accounting period', acctDate],
  ]
 
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:60 }} />
      <div className="modal" style={{ padding:'28px', width:'440px', maxHeight:'90vh', overflowY:'auto' }}>
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

          {payments.length > 0 && (
            <div style={{ margin:'10px 0', padding:'10px 12px', background:'#f9fafb', borderRadius:'8px' }}>
              <div style={{ fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Payment history</div>
              {payments.map(p => (
                <div key={p.id} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:'12px' }}>
                  <span style={{ color:'#6b7280' }}>
                    {fmtDate(p.payment_date)} — {kindLabel(p.kind)}{p.payment_type ? ` (${p.payment_type})` : ''}
                    {p.receipt_number && <span style={{ color:'#d1d5db' }}> · {p.receipt_number}</span>}
                  </span>
                  <span style={{ fontWeight:500, color: p.kind === 'refund' ? '#991b1b' : '#166534' }}>
                    {p.kind === 'refund' ? '- ' : ''}{fmt(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {record.status === 'refunded' ? (
            <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', fontSize:'15px', fontWeight:600, borderTop:'2px solid #17341e', marginTop:'4px' }}>
              <span>Refunded</span>
              <span style={{ color:'#991b1b' }}>{fmt(record.refunded_amount)}</span>
            </div>
          ) : (
            <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', fontSize:'15px', fontWeight:600, borderTop:'2px solid #17341e', marginTop:'4px' }}>
              <span>Balance due</span>
              <span style={{ color: (record.balance_due || 0) > 0 ? '#991b1b' : '#166534' }}>
                {(record.balance_due || 0) > 0 ? fmt(record.balance_due) : 'Fully paid'}
              </span>
            </div>
          )}

          <div style={{ textAlign:'center', marginTop:'20px', fontSize:'11px', color:'#9ca3af' }}>
            Thank you for choosing {profile?.business_name || 'us'}!
          </div>
        </div>

        <div style={{ display:'flex', gap:'8px', marginTop:'20px', flexWrap:'wrap' }}>
          <button onClick={handlePrint} style={{ flex:1, minWidth:'80px', padding:'10px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            Print
          </button>
          <button onClick={handleDownloadPDF} style={{ flex:1, minWidth:'80px', padding:'10px', background:'#1e40af', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            Download PDF
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
  const { user, tenantId, isOwner, profile: authProfile, employee } = useAuth()
  const location = useLocation()
  const [records, setRecords]   = useState<HCFinance[]>([])
  const [profile, setProfile]   = useState<HCProfile | null>(null)
  const [loading, setLoading]   = useState(true)
  const [filterMonth, setFilterMonth]     = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [filterInterest, setFilterInterest] = useState('')
  const [filterStatus, setFilterStatus]   = useState<'' | RecordStatusKey>('')
  // Drill-down filters — only ever set by navigating in from the Dashboard
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [drillLabel, setDrillLabel] = useState('')
  // Calendar-day filter — reuses the exact same dateFrom/dateTo/drillLabel
  // state as the Dashboard drill-down.
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [interests, setInterests]         = useState<string[]>([])

  // Apply drill-down filters passed in via navigation from the Dashboard (runs once on mount)
  useEffect(() => {
    const incoming = location.state as { dateFrom?: string; dateTo?: string; label?: string } | null
    if (!incoming) return
    if (incoming.dateFrom) setDateFrom(incoming.dateFrom)
    if (incoming.dateTo) setDateTo(incoming.dateTo)
    if (incoming.label) setDrillLabel(incoming.label)
    window.history.replaceState({}, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearDrillDown = () => {
    setDateFrom(''); setDateTo(''); setDrillLabel('')
  }
  const [currentPage, setCurrentPage]     = useState(1)
  const [saving, setSaving]     = useState(false)
  const [paymentTypes, setPaymentTypes] = useState<string[]>(DEFAULT_PAYMENT_TYPES)
  const [addingEditPayType, setAddingEditPayType] = useState(false)
  const [newEditPayType, setNewEditPayType] = useState('')
  const [managingPayTypes, setManagingPayTypes] = useState(false)
  const [editRecord, setEditRecord]   = useState<HCFinance | null>(null)
  const [paymentSplits, setPaymentSplits] = useState<{ id: string; amount: string; payment_type: string }[]>([])
  const [editExpDate, setEditExpDate] = useState('')
  const [editNotes, setEditNotes]     = useState('')
  const [receiptRec, setReceiptRec]   = useState<HCFinance | null>(null)
  const [refundRec, setRefundRec]     = useState<HCFinance | null>(null)
  const [refundSplits, setRefundSplits] = useState<{ id: string; amount: string; payment_type: string }[]>([])
  const [refundNotes, setRefundNotes] = useState('')
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
 
  const addPayTypeOption = async (val: string) => {
    if (!val.trim() || !tenantId) return
    await supabase.from('hc_settings').insert({ tenant_id: tenantId, type: 'payment_type', value: val.trim(), sort_order: paymentTypes.length })
    const updated = [...paymentTypes, val.trim()]
    setPaymentTypes(updated)
    setNewEditPayType('')
    setAddingEditPayType(false)
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
    if (filterStatus && getRecordStatusKey(r) !== filterStatus) return false
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo && r.date > dateTo) return false
    return true
  })
 
  // ── Sort: drafts on top (soonest check-in first — most urgent balance to collect),
  //          confirmed below (newest payment first, like a normal ledger) ───────────
  const sorted: HCFinance[] = [
    ...filtered.filter(r => r.status === 'draft').sort((a, b) => {
      const aIn = a.enquiry?.check_in, bIn = b.enquiry?.check_in
      if (aIn && bIn) return aIn.localeCompare(bIn)
      if (aIn) return -1   // has a check-in date → ranks above one that doesn't
      if (bIn) return 1
      return b.date.localeCompare(a.date)  // neither has a check-in date — fall back to payment date
    }),
    ...filtered.filter(r => r.status === 'confirmed').sort((a, b) => b.date.localeCompare(a.date)),
    ...filtered.filter(r => r.status === 'refunded').sort((a, b) => b.date.localeCompare(a.date)),
  ]
 
  const totalPages  = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated   = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const confirmedTotal = filtered.filter(r => r.status === 'confirmed').reduce((s, r) => s + (r.advance_paid || 0), 0)
  const drafts      = filtered.filter(r => r.status === 'draft')

  // Days in the currently-displayed calendar month that have at least one record —
  // drawn from data already loaded in memory, no extra query needed.
  const daysWithRecords = new Set(records.map(r => r.date).filter(Boolean))

  const pickCalendarDay = (dateStr: string) => {
    setDateFrom(dateStr)
    setDateTo(dateStr)
    setDrillLabel(new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }))
    setShowCalendar(false)
    setCurrentPage(1)
  }
 
  // ── Edit panel derived values ──────────────────────────────
  const totalPrice   = Number(editRecord?.enquiry?.total_price ?? editRecord?.amount ?? 0)
  const alreadyPaid  = Number(editRecord?.enquiry?.amount_paid ?? editRecord?.advance_paid ?? 0)
  const trueBalance  = Math.max(0, totalPrice - alreadyPaid)
  const amountNowNum = paymentSplits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
  const newPaid      = alreadyPaid + amountNowNum
  const newBalance   = Math.max(0, totalPrice - newPaid)
  const isFullyPaid  = totalPrice > 0 && newPaid >= totalPrice
  const exceedsMax   = paymentSplits.some(sp => sp.amount !== '') && amountNowNum > trueBalance

  const updateSplit = (i: number, field: 'amount' | 'payment_type', value: string) => {
    setPaymentSplits(prev => prev.map((sp, idx) => idx === i ? { ...sp, [field]: value } : sp))
  }
  const addSplitRow = () => {
    setPaymentSplits(prev => {
      const used = new Set(prev.map(sp => sp.payment_type))
      const nextType = paymentTypes.find(pt => !used.has(pt)) || paymentTypes[0] || 'UPI'
      return [...prev, { id: crypto.randomUUID(), amount: '', payment_type: nextType }]
    })
  }
  const removeSplitRow = (i: number) => {
    setPaymentSplits(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)
  }
 
 
  const openEdit = (r: HCFinance) => {
    setEditRecord(r)
    setPaymentSplits([{ id: crypto.randomUUID(), amount: '', payment_type: (r.payment_type || 'UPI').split(', ')[0] }])
    setEditExpDate(r.expected_date || '')
    setEditNotes(r.notes || '')
  }
 
  const saveEdit = async () => {
    if (!editRecord || !user || exceedsMax) return
    setSaving(true)

    // Non-payment fields (expected date, notes) still update directly — these
    // aren't part of the ledger, just metadata on the sale itself. payment_type
    // is no longer set here at all — the trigger derives it from the ledger.
    await supabase.from('hc_finance').update({
      expected_date: editExpDate || null,
      notes:         editNotes,
      updated_at:    new Date().toISOString(),
    }).eq('id', editRecord.id)

    const activeSplits = paymentSplits.filter(sp => (parseFloat(sp.amount) || 0) > 0)

    if (activeSplits.length > 0 && tenantId) {
      // A genuine payment happened — record each component as its own ledger entry.
      // Kind is the same for every component of one payment moment: first-ever
      // payment on this sale = advance (or full, if it settles everything in one
      // go); any later payment = additional (or full, if it's the one that finally
      // clears the balance).
      const isFirstPayment = alreadyPaid <= 0
      const kind: 'advance' | 'additional' | 'full' =
        isFullyPaid ? 'full' : (isFirstPayment ? 'advance' : 'additional')
      const today = new Date().toISOString().slice(0, 10)

      const { error: payErr } = await supabase.from('hc_payments').insert(
        activeSplits.map(sp => ({
          tenant_id:   tenantId,
          finance_id:  editRecord.id,
          enquiry_id:  editRecord.enquiry_id,
          amount:      parseFloat(sp.amount) || 0,
          kind,
          payment_type: sp.payment_type,
          payment_date: today,
          recorded_by: user.id,
        }))
      )

      if (payErr) {
        setSaving(false)
        showToast('Could not record payment — check your connection and try again')
        return
      }

      const label = editRecord.enquiry?.name || editRecord.description || 'this record'
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: authProfile?.owner_name })
      const methodNote = activeSplits.length > 1 ? ` split across ${activeSplits.map(sp => sp.payment_type).join(' + ')}` : ''
      logActivity({
        tenantId, ...actor,
        action: 'income_recorded', entityType: 'income', entityId: editRecord.id,
        description: `${actor.actorName} recorded ${fmt(amountNowNum)} payment${methodNote} for ${label}${isFullyPaid ? ' — fully paid' : ` (balance ${fmt(newBalance)})`}`,
      })
    }

    setSaving(false)
    setEditRecord(null)
    load()
    showToast(isFullyPaid ? 'Fully paid — income confirmed' : `Saved · Balance: ${fmt(newBalance)}`)
  }

  // ── Refund ───────────────────────────────────────────────────
  // A refund is its own ledger entry, never an edit to history. The moment it's
  // recorded, the database automatically marks this record 'refunded' and
  // cancels the linked enquiry — that cascade is guaranteed at the DB level,
  // not something this code has to remember to do.
  const openRefund = (r: HCFinance) => {
    setRefundRec(r)
    setRefundSplits([{ id: crypto.randomUUID(), amount: '', payment_type: (r.payment_type || 'UPI').split(', ')[0] }])
    setRefundNotes('')
  }

  const netPaidFor = (r: HCFinance) => Math.max(0, (r.advance_paid || 0))
  const refundAmountNum = refundSplits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0)
  const refundExceedsMax = refundRec ? refundAmountNum > netPaidFor(refundRec) : false

  const updateRefundSplit = (i: number, field: 'amount' | 'payment_type', value: string) => {
    setRefundSplits(prev => prev.map((sp, idx) => idx === i ? { ...sp, [field]: value } : sp))
  }
  const addRefundSplitRow = () => {
    setRefundSplits(prev => {
      const used = new Set(prev.map(sp => sp.payment_type))
      const nextType = paymentTypes.find(pt => !used.has(pt)) || paymentTypes[0] || 'UPI'
      return [...prev, { id: crypto.randomUUID(), amount: '', payment_type: nextType }]
    })
  }
  const removeRefundSplitRow = (i: number) => {
    setRefundSplits(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)
  }

  const saveRefund = async () => {
    if (!refundRec || !user || !tenantId) return
    if (refundAmountNum <= 0 || refundExceedsMax) return
    setSaving(true)

    const activeSplits = refundSplits.filter(sp => (parseFloat(sp.amount) || 0) > 0)
    const today = new Date().toISOString().slice(0, 10)

    const { error: refundErr } = await supabase.from('hc_payments').insert(
      activeSplits.map(sp => ({
        tenant_id:    tenantId,
        finance_id:   refundRec.id,
        enquiry_id:   refundRec.enquiry_id,
        amount:       parseFloat(sp.amount) || 0,
        kind:         'refund',
        payment_type: sp.payment_type,
        payment_date: today,
        notes:        refundNotes || null,
        recorded_by:  user.id,
      }))
    )

    if (refundErr) {
      setSaving(false)
      showToast('Could not process refund — check your connection and try again')
      return
    }

    const label = refundRec.enquiry?.name || refundRec.description || 'this record'
    const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: authProfile?.owner_name })
    const methodNote = activeSplits.length > 1 ? ` split across ${activeSplits.map(sp => sp.payment_type).join(' + ')}` : ''
    logActivity({
      tenantId, ...actor,
      action: 'income_refunded', entityType: 'income', entityId: refundRec.id,
      description: `${actor.actorName} refunded ${fmt(refundAmountNum)}${methodNote} to ${label} — booking marked as Cancelled`,
    })

    setSaving(false)
    setRefundRec(null)
    load()
    showToast('Refund processed — booking marked as Cancelled')
  }
 
  const exportExcel = () => {
    if (!isOwner) { showToast('Only the owner can export data'); return }
    if (sorted.length === 0) { showToast('No records to export'); return }
    const rows = sorted.map(r => ({
      Date:             r.date,
      Customer:         String(r.enquiry?.name || r.description || ''),
      'Property / Stay': r.enquiry?.interest || '',
      'Total':          r.amount || 0,
      'Amount paid':    r.advance_paid || 0,
      'Balance':        r.balance_due || 0,
      'Payment type':   r.payment_type || '',
      Status:           r.status === 'refunded' ? `Refunded (${fmt(r.refunded_amount)})` : r.status === 'draft' ? 'Draft' : 'Paid in full',
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
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
        {/* Row 1: Title + stats + buttons */}
        <div style={{ padding:'0 16px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', minWidth:0, flex:1, overflow:'hidden' }}>
            <span style={{ fontSize:'15px', fontWeight:500, color:'#111111', flexShrink:0 }}>Income</span>
            <span style={{ fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {fmt(confirmedTotal)}
            </span>
            {drafts.length > 0 && (
              <span style={{ fontSize:'11px', background:'#fef9c3', color:'#854d0e', padding:'2px 8px', borderRadius:'20px', fontWeight:500, flexShrink:0, whiteSpace:'nowrap' }}>
                {drafts.length} drafts
              </span>
            )}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'6px', flexShrink:0 }}>
            {isOwner && <button onClick={exportExcel} style={{ padding:'6px 10px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'11px', fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' }}>↓ Excel</button>}
          </div>
        </div>
        {/* Row 2: Filters - horizontally scrollable */}
        <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 16px', overflowX:'auto', WebkitOverflowScrolling:'touch', scrollbarWidth:'none', borderTop:'1px solid #f3f4f6' }}>
          <select value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setCurrentPage(1) }} style={{ ...sel, flexShrink:0, width:'105px' }}>
            <option value="">All months</option>
            {MONTHS.map((m, idx) => <option key={m} value={String(idx)}>{m}</option>)}
          </select>
          <select value={filterInterest} onChange={e => { setFilterInterest(e.target.value); setCurrentPage(1) }} style={{ ...sel, flexShrink:0, width:'105px' }}>
            <option value="">All stays</option>
            {interests.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={filterPayment} onChange={e => { setFilterPayment(e.target.value); setCurrentPage(1) }} style={{ ...sel, flexShrink:0, width:'110px' }}>
            <option value="">All payments</option>
            {paymentTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>
          <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value as '' | RecordStatusKey); setCurrentPage(1) }} style={{ ...sel, flexShrink:0, width:'115px' }}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_KEY_LABEL) as RecordStatusKey[]).map(k => <option key={k} value={k}>{STATUS_KEY_LABEL[k]}</option>)}
          </select>
          <div style={{ position:'relative', flexShrink:0 }}>
            <button onClick={() => setShowCalendar(v => !v)}
              style={{ ...sel, display:'flex', alignItems:'center', gap:'6px', cursor:'pointer', background: showCalendar ? '#f0fdf4' : '#ffffff', borderColor: showCalendar ? '#17341e' : '#e5e7eb', whiteSpace:'nowrap' }}>
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
                        const hasData = daysWithRecords.has(dateStr)
                        const isToday = dateStr === todayStr
                        const isSelected = dateStr === dateFrom && dateStr === dateTo
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
        </div>
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
 
        {/* Table */}
        <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden' }}>
          {loading ? (
            <div style={{ padding:'40px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>Loading...</div>
          ) : (
            <div className="table-wrap">
              <table className="alt-table" style={{ width:'100%', borderCollapse:'collapse', minWidth:'900px' }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid #e5e7eb', background:'#f9fafb' }}>
                    {['Date','Customer','Property / Stay','Total','Paid','Balance','Payment type','Status',''].map((h,hi) => (
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
                      <tr key={r.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'12px 16px', fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap' }}>{fmtDate(r.date)}</td>
                        <td className="sticky-col" style={{ padding:'12px 16px', background: isDraft ? '#fefce8' : undefined }}>
                          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{custName}</div>
                        </td>
                        <td style={{ padding:'12px 16px', fontSize:'12px', color:'#6b7280', whiteSpace:'nowrap', background: isDraft ? '#fefce8' : undefined }}>{r.enquiry?.interest || '—'}</td>
                        <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight:500, color:'#111111', whiteSpace:'nowrap' }}>{(r.amount || 0) > 0 ? fmt(r.amount) : '—'}</td>
                        <td style={{ padding:'12px 16px', fontSize:'13px', color:'#166534', whiteSpace:'nowrap' }}>{(r.advance_paid || 0) > 0 ? fmt(r.advance_paid) : '—'}</td>
                        <td style={{ padding:'12px 16px', fontSize:'13px', fontWeight: balance > 0 ? 500 : 400, color: r.status === 'refunded' ? '#991b1b' : balance > 0 ? '#991b1b' : '#9ca3af', whiteSpace:'nowrap' }}>
                          {r.status === 'refunded' ? `Refunded ${fmt(r.refunded_amount)}` : balance > 0 ? fmt(balance) : r.status === 'confirmed' ? 'Paid' : '—'}
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
                            <button onClick={() => setReceiptRec(r)} style={{ padding:'6px 12px', background:'#fef9c3', color:'#854f0b', border:'1px solid #fde047', borderRadius:'8px', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>Receipt</button>
                            {(r.advance_paid || 0) > 0 && (
                              <button onClick={() => openRefund(r)} style={{ padding:'6px 12px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'8px', fontSize:'11px', fontWeight:500, cursor:'pointer' }}>Refund</button>
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
          <div className="side-panel" style={{ width:'340px' }}>
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
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <label style={lbl}>Amount received now Rs</label>
                    <span onClick={() => setManagingPayTypes(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingPayTypes ? 'Done' : 'Manage payment types'}</span>
                  </div>

                  {managingPayTypes ? (
                    <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'160px', overflowY:'auto' }}>
                      {paymentTypes.map(pt => (
                        <div key={pt} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                          <span style={{ fontSize:'12px', color:'#374151' }}>{pt}</span>
                          <button onClick={() => deletePayTypeOption(pt)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                        </div>
                      ))}
                      {paymentTypes.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                      <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                        <input value={newEditPayType} onChange={e => setNewEditPayType(e.target.value)} placeholder="New payment type" style={{ ...inp, flex:1 }}
                          onKeyDown={e => { if (e.key === 'Enter') addPayTypeOption(newEditPayType) }} />
                        <button onClick={() => addPayTypeOption(newEditPayType)} style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {paymentSplits.map((sp, i) => (
                        <div key={sp.id} style={{ display:'flex', gap:'6px', marginBottom:'6px' }}>
                          <input type="number" min="0" placeholder={i === 0 ? `Max: Rs ${trueBalance.toLocaleString('en-IN')}` : '0'}
                            value={sp.amount} onChange={e => updateSplit(i, 'amount', e.target.value)}
                            style={{ ...inp, flex:1, borderColor: exceedsMax ? '#fca5a5' : '#e5e7eb' }} autoFocus={i === 0} />
                          <select value={sp.payment_type} onChange={e => updateSplit(i, 'payment_type', e.target.value)} style={{ ...inp, flex:1 }}>
                            {paymentTypes.map(pt => <option key={pt}>{pt}</option>)}
                          </select>
                          {paymentSplits.length > 1 && (
                            <button onClick={() => removeSplitRow(i)} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:'18px', lineHeight:1, padding:'0 4px' }}>×</button>
                          )}
                        </div>
                      ))}
                      <button onClick={addSplitRow} style={{ background:'none', border:'none', color:'#1e40af', cursor:'pointer', fontSize:'11px', fontWeight:500, padding:0, textDecoration:'underline' }}>
                        + Split across another payment method
                      </button>
                    </>
                  )}
                  {exceedsMax && (
                    <div style={{ fontSize:'11px', color:'#991b1b', marginTop:'6px' }}>
                      {`Exceeds remaining balance of ${fmt(trueBalance)}`}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom:'10px' }}>
                  <label style={lbl}>New balance Rs <span style={{ textTransform:'none', fontWeight:400, fontSize:'9px', color:'#9ca3af' }}>(auto-calculated)</span></label>
                  <input type="number" value={amountNowNum > 0 ? newBalance : trueBalance} readOnly style={inpRO} />
                </div>

                {amountNowNum > 0 && totalPrice > 0 && (
                  <div style={{ padding:'8px 12px', borderRadius:'6px', background: isFullyPaid ? '#dcfce7' : '#fef9c3', border:`1px solid ${isFullyPaid ? '#86efac' : '#fde047'}` }}>
                    <span style={{ fontSize:'12px', fontWeight:500, color: isFullyPaid ? '#166534' : '#854f0b' }}>
                      {isFullyPaid ? 'Fully paid — will confirm on save' : `${fmt(newBalance)} still pending`}
                    </span>
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

      {/* Refund modal */}
      {refundRec && (
        <>
          <div onClick={() => setRefundRec(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:60 }} />
          <div className="modal" style={{ padding:'24px', width:'380px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
              <span style={{ fontSize:'14px', fontWeight:600, color:'#111111' }}>Process refund</span>
              <button onClick={() => setRefundRec(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
            <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', padding:'10px 12px', marginBottom:'16px', fontSize:'11px', color:'#991b1b' }}>
              Refunding any amount will mark this booking as <strong>Cancelled</strong>.
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', color:'#6b7280', marginBottom:'14px' }}>
              <span>Currently received</span>
              <span style={{ fontWeight:500, color:'#111111' }}>{fmt(netPaidFor(refundRec))}</span>
            </div>
            <div style={{ marginBottom:'16px' }}>
              <label style={lbl}>Refund amount</label>
              {refundSplits.map((sp, i) => (
                <div key={sp.id} style={{ display:'flex', gap:'6px', marginBottom:'6px' }}>
                  <input type="number" min="0" placeholder="0" value={sp.amount} onChange={e => updateRefundSplit(i, 'amount', e.target.value)}
                    style={{ ...inp, flex:1, borderColor: refundExceedsMax ? '#fca5a5' : '#e5e7eb' }} />
                  <select value={sp.payment_type} onChange={e => updateRefundSplit(i, 'payment_type', e.target.value)} style={{ ...inp, flex:1 }}>
                    {paymentTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                  </select>
                  {refundSplits.length > 1 && (
                    <button onClick={() => removeRefundSplitRow(i)} style={{ background:'none', border:'none', color:'#9ca3af', cursor:'pointer', fontSize:'18px', lineHeight:1, padding:'0 4px' }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={addRefundSplitRow} style={{ background:'none', border:'none', color:'#1e40af', cursor:'pointer', fontSize:'11px', fontWeight:500, padding:0, textDecoration:'underline' }}>
                + Split across another payment method
              </button>
              {refundExceedsMax && (
                <div style={{ fontSize:'11px', color:'#991b1b', marginTop:'6px' }}>Cannot exceed the amount actually received ({fmt(netPaidFor(refundRec))})</div>
              )}
            </div>
            <div style={{ marginBottom:'16px' }}>
              <label style={lbl}>Reason (optional)</label>
              <textarea value={refundNotes} onChange={e => setRefundNotes(e.target.value)} rows={2} style={{ ...inp, resize:'none' }} placeholder="e.g. guest cancelled the booking" />
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={() => setRefundRec(null)} style={{ flex:1, padding:'9px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
              <button onClick={saveRefund} disabled={saving || refundAmountNum <= 0 || refundExceedsMax}
                style={{ flex:1, padding:'9px', background: (saving || refundAmountNum <= 0 || refundExceedsMax) ? '#f3f4f6' : '#991b1b', color: (saving || refundAmountNum <= 0 || refundExceedsMax) ? '#9ca3af' : '#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor: (saving || refundAmountNum <= 0 || refundExceedsMax) ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Processing...' : 'Confirm refund'}
              </button>
            </div>
          </div>
        </>
      )}
 
      {toast && (
        <div style={{ position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#17341e', color:'#ffffff', fontSize:'12px', fontWeight:500, padding:'8px 20px', borderRadius:'20px', zIndex:80, whiteSpace:'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
 
export default Income