import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCPayment, HCFinance, fmt, fmtDate } from '../lib/supabase'

const PAGE_SIZE = 50

type PeriodType = 'day' | 'week' | 'month' | 'fy'

const sel: React.CSSProperties = { padding:'7px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151', background:'#ffffff', outline:'none', cursor:'pointer' }

interface LedgerRow {
  date: string
  description: string
  receipts: number
  payments: number
  ref: string | null
  kind: 'income' | 'expense' | 'refund'
}

function pad(n: number) { return n < 10 ? '0' + n : String(n) }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

function getPeriod(type: PeriodType, refDate: string): { start: string; end: string; label: string } {
  const ref = new Date(refDate + 'T12:00:00')

  if (type === 'week') {
    const day = ref.getDay()
    const diffToMonday = day === 0 ? 6 : day - 1
    const start = new Date(ref); start.setDate(ref.getDate() - diffToMonday)
    const end = new Date(start); end.setDate(start.getDate() + 6)
    return { start: toISO(start), end: toISO(end), label: `${toISO(start)} to ${toISO(end)}` }
  }

  if (type === 'month') {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1)
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
    return { start: toISO(start), end: toISO(end), label: start.toLocaleDateString('en-IN', { month:'long', year:'numeric' }) }
  }

  if (type === 'fy') {
    // Indian financial year: April 1 to March 31
    const fyStartYear = ref.getMonth() >= 3 ? ref.getFullYear() : ref.getFullYear() - 1
    const start = new Date(fyStartYear, 3, 1)
    const end = new Date(fyStartYear + 1, 2, 31)
    return { start: toISO(start), end: toISO(end), label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}` }
  }

  // day
  const iso = toISO(ref)
  return { start: iso, end: iso, label: ref.toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) }
}

function shiftRefDate(refDate: string, type: PeriodType, dir: 1 | -1): string {
  const d = new Date(refDate + 'T12:00:00')
  if (type === 'day') d.setDate(d.getDate() + dir)
  else if (type === 'week') d.setDate(d.getDate() + dir * 7)
  else if (type === 'month') d.setMonth(d.getMonth() + dir)
  else { // fy — jump a full year while staying inside a financial year
    d.setFullYear(d.getFullYear() + dir)
  }
  return toISO(d)
}

const KIND_LABEL: Record<string, string> = {
  advance: 'Advance payment', additional: 'Additional payment', full: 'Full payment', refund: 'Refund',
}

export const Accounts: React.FC = () => {
  const { tenantId } = useAuth()
  const [payments, setPayments] = useState<(HCPayment & { enquiry?: { name: string } | null })[]>([])
  const [expenses, setExpenses] = useState<HCFinance[]>([])
  const [loading, setLoading] = useState(true)
  const [periodType, setPeriodType] = useState<PeriodType>('month')
  const [refDate, setRefDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [page, setPage] = useState(1)
  const [showCalendar, setShowCalendar] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    const [{ data: payData }, { data: expData }] = await Promise.all([
      supabase.from('hc_payments')
        .select('*, enquiry:hc_enquiries(name)')
        .eq('tenant_id', tenantId)
        .order('payment_date', { ascending: true }),
      supabase.from('hc_finance')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('type', 'expense')
        .order('date', { ascending: true }),
    ])
    setPayments((payData as (HCPayment & { enquiry?: { name: string } | null })[]) || [])
    setExpenses((expData as HCFinance[]) || [])
    setLoading(false)
  }, [tenantId])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [periodType, refDate])

  const { start, end, label } = getPeriod(periodType, refDate)

  // Build the full ledger — every payment event and every expense, each a real row.
  const allRows: LedgerRow[] = [
    ...payments.map(p => ({
      date: p.payment_date,
      description: `${p.enquiry?.name || 'Guest'} — ${KIND_LABEL[p.kind] || p.kind}${p.payment_type ? ` (${p.payment_type})` : ''}`,
      receipts: p.kind === 'refund' ? 0 : p.amount,
      payments: p.kind === 'refund' ? p.amount : 0,
      ref: p.receipt_number,
      kind: (p.kind === 'refund' ? 'refund' : 'income') as 'income' | 'refund',
    })),
    ...expenses.map(e => ({
      date: e.date,
      description: `${e.category || 'Expense'}${e.description ? ` — ${e.description}` : ''}`,
      receipts: 0,
      payments: e.amount,
      ref: null,
      kind: 'expense' as const,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const openingBalance = allRows
    .filter(r => r.date < start)
    .reduce((bal, r) => bal + r.receipts - r.payments, 0)

  const periodRows = allRows.filter(r => r.date >= start && r.date <= end)

  // Attach a running balance to each row, starting from the opening balance
  let runningBalance = openingBalance
  const rowsWithBalance = periodRows.map(r => {
    runningBalance += r.receipts - r.payments
    return { ...r, balance: runningBalance }
  })
  const closingBalance = runningBalance

  const totalReceipts = periodRows.reduce((s, r) => s + r.receipts, 0)
  const totalPayments = periodRows.reduce((s, r) => s + r.payments, 0)
  const netForPeriod = totalReceipts - totalPayments

  const categoryBreakdown: Record<string, number> = {}
  expenses.filter(e => e.date >= start && e.date <= end).forEach(e => {
    const cat = e.category || 'Other'
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + e.amount
  })

  const totalPages = Math.ceil(rowsWithBalance.length / PAGE_SIZE)
  const paginated = rowsWithBalance.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const daysWithActivity = new Set(allRows.map(r => r.date))

  const periodBtn = (p: PeriodType, l: string) => (
    <button onClick={() => setPeriodType(p)}
      style={{ padding:'7px 16px', borderRadius:'8px', border:'1px solid', borderColor: periodType===p?'#17341e':'#e5e7eb', background: periodType===p?'#17341e':'#ffffff', color: periodType===p?'#ffffff':'#374151', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
      {l}
    </button>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Accounts</span>
          <span style={{ fontSize:'12px', color:'#9ca3af' }}>{label}</span>
        </div>
      </div>

      <div style={{ background:'#ffffff', borderBottom:'1px solid #f3f4f6', padding:'12px 22px', display:'flex', flexDirection:'column', gap:'10px' }}>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', alignItems:'center' }}>
          {periodBtn('day', 'Day')}
          {periodBtn('week', 'Week')}
          {periodBtn('month', 'Month')}
          {periodBtn('fy', 'Financial Year')}
          <div style={{ position:'relative' }}>
            <button onClick={() => setShowCalendar(v => !v)}
              style={{ ...sel, display:'flex', alignItems:'center', gap:'6px', background: showCalendar ? '#f0fdf4' : '#ffffff', borderColor: showCalendar ? '#17341e' : '#e5e7eb' }}>
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
                        const hasData = daysWithActivity.has(dateStr)
                        const isToday = dateStr === todayStr
                        const isSelected = dateStr === refDate
                        cells.push(
                          <button key={day} onClick={() => { setPeriodType('day'); setRefDate(dateStr); setShowCalendar(false) }}
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
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <button onClick={() => setRefDate(d => shiftRefDate(d, periodType, -1))}
            style={{ padding:'6px 12px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#374151' }}>‹ Prev</button>
          <span style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{label}</span>
          <button onClick={() => setRefDate(d => shiftRefDate(d, periodType, 1))}
            style={{ padding:'6px 12px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#374151' }}>Next ›</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:'13px' }}>Loading...</div>
        ) : (
          <>
            {/* Summary cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'12px', marginBottom:'16px' }}>
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 16px' }}>
                <div style={{ fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Opening Balance</div>
                <div style={{ fontSize:'17px', fontWeight:600, color:'#111111' }}>{fmt(openingBalance)}</div>
              </div>
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 16px' }}>
                <div style={{ fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Total Receipts</div>
                <div style={{ fontSize:'17px', fontWeight:600, color:'#166534' }}>{fmt(totalReceipts)}</div>
              </div>
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 16px' }}>
                <div style={{ fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Total Payments</div>
                <div style={{ fontSize:'17px', fontWeight:600, color:'#991b1b' }}>{fmt(totalPayments)}</div>
              </div>
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 16px' }}>
                <div style={{ fontSize:'10px', color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Net for Period</div>
                <div style={{ fontSize:'17px', fontWeight:600, color: netForPeriod >= 0 ? '#166534' : '#991b1b' }}>{fmt(netForPeriod)}</div>
              </div>
              <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:'10px', padding:'14px 16px' }}>
                <div style={{ fontSize:'10px', color:'#166534', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Closing Balance</div>
                <div style={{ fontSize:'17px', fontWeight:600, color:'#166534' }}>{fmt(closingBalance)}</div>
              </div>
            </div>

            {/* Category breakdown */}
            {Object.keys(categoryBreakdown).length > 0 && (
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 18px', marginBottom:'16px' }}>
                <div style={{ fontSize:'11px', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'10px' }}>Expenses by Category</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'16px' }}>
                  {Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                    <div key={cat} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                      <span style={{ fontSize:'12px', color:'#374151' }}>{cat}:</span>
                      <span style={{ fontSize:'12px', fontWeight:600, color:'#991b1b' }}>{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* The ledger */}
            <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden' }}>
              {rowsWithBalance.length === 0 ? (
                <div style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:'13px' }}>No transactions in this period.</div>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
                        <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Date</th>
                        <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Description</th>
                        <th style={{ textAlign:'right', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Receipts</th>
                        <th style={{ textAlign:'right', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Payments</th>
                        <th style={{ textAlign:'right', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Balance</th>
                        <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((r, i) => (
                        <tr key={i} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#374151', whiteSpace:'nowrap' }}>{fmtDate(r.date)}</td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#111111' }}>{r.description}</td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#166534', textAlign:'right', whiteSpace:'nowrap' }}>{r.receipts > 0 ? fmt(r.receipts) : '—'}</td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#991b1b', textAlign:'right', whiteSpace:'nowrap' }}>{r.payments > 0 ? fmt(r.payments) : '—'}</td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:500, color:'#111111', textAlign:'right', whiteSpace:'nowrap' }}>{fmt(r.balance)}</td>
                          <td style={{ padding:'10px 14px', fontSize:'11px', color:'#9ca3af', whiteSpace:'nowrap' }}>{r.ref || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 4px', marginTop:'10px', flexWrap:'wrap', gap:'8px' }}>
                <span style={{ fontSize:'12px', color:'#9ca3af' }}>
                  Showing {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, rowsWithBalance.length)} of {rowsWithBalance.length}
                </span>
                <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                  <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                    style={{ padding:'6px 14px', background:'#ffffff', color:page===1?'#d1d5db':'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:page===1?'default':'pointer' }}>‹ Prev</button>
                  <span style={{ fontSize:'12px', color:'#374151', padding:'0 8px' }}>Page {page} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                    style={{ padding:'6px 14px', background:'#ffffff', color:page===totalPages?'#d1d5db':'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:page===totalPages?'default':'pointer' }}>Next ›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default Accounts