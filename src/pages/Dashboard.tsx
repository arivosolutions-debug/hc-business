import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, fmt } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const CUR_YEAR = new Date().getFullYear()
const CUR_MONTH = new Date().getMonth()
 
interface UpcomingEntry {
  id: string; name: string; interest: string | null
  check_in: string | null; check_out: string | null; guests: number; phone: string | null
}
 
interface PrevStats {
  totalLeads: number
  booked: number
  revenue: number
  expenses: number
  margin: number
}

interface Stats {
  checkIns: number
  checkOuts: number
  uncontacted: number
  totalLeads: number
  booked: number
  revenue: number
  expenses: number
  margin: number
  chartData: { month: string; revenue: number; expenses: number; monthIndex: number; year: number }[]
  sources: { source: string; count: number }[]
  upcomingCheckIns: UpcomingEntry[]
  upcomingCheckOuts: UpcomingEntry[]
  prev: PrevStats
}

// Small ↑/↓ delta badge — compares current vs previous-period value
const DeltaBadge = ({ current, previous }: { current: number; previous: number }) => {
  if (previous === 0 && current === 0) return null
  if (previous === 0) return <span style={{ fontSize:'10px', fontWeight:500, color:'#22c55e' }}>New</span>
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return <span style={{ fontSize:'10px', fontWeight:500, color:'#9ca3af' }}>—</span>
  const up = pct > 0
  return (
    <span style={{ fontSize:'10px', fontWeight:500, color: up ? '#22c55e' : '#dc2626', display:'inline-flex', alignItems:'center', gap:'2px' }}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

const KPICard = ({ label, value, dot, delta, onClick }: { label: string; value: string; dot: string; delta?: React.ReactNode; onClick?: () => void }) => (
  <div onClick={onClick} style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px', cursor: onClick ? 'pointer' : 'default', transition:'box-shadow 0.15s, border-color 0.15s' }}
    onMouseEnter={e => { if (onClick) { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; e.currentTarget.style.borderColor = '#d1d5db' } }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e5e7eb' }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
        <div style={{ width:'7px', height:'7px', borderRadius:'50%', background:dot }} />
        <span style={{ fontSize:'11px', color:'#6b7280' }}>{label}</span>
      </div>
      {delta}
    </div>
    <div style={{ fontSize:'22px', fontWeight:500, color:'#111111', lineHeight:1 }}>{value}</div>
  </div>
)
 
// Returns correct first and last date string for a given year/month
function monthRange(year: number, month: number) {
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  const fmt   = (d: Date) => d.toISOString().slice(0, 10)
  return { first: fmt(first), last: fmt(last) }
}
 
// Filter options
type FilterValue =
  | `month:${number}`   // month:0 to month:11
  | 'range:3'
  | 'range:6'
  | 'range:9'
  | 'range:year'
 
// Given a filter value, return the date range { first, last }
function getDateRange(filter: FilterValue): { first: string; last: string; label: string } {
  if (filter.startsWith('month:')) {
    const m = parseInt(filter.split(':')[1])
    const { first, last } = monthRange(CUR_YEAR, m)
    return { first, last, label: `${MONTHS[m]} revenue` }
  }
  const today = new Date()
  const lastDay = today.toISOString().slice(0, 10)
  if (filter === 'range:year') {
    const first = `${CUR_YEAR}-01-01`
    return { first, last: lastDay, label: `${CUR_YEAR} revenue` }
  }
  const months = filter === 'range:3' ? 3 : filter === 'range:6' ? 6 : 9
  const from = new Date(today.getFullYear(), today.getMonth() - months + 1, 1)
  return {
    first: from.toISOString().slice(0, 10),
    last: lastDay,
    label: `Last ${months} months revenue`,
  }
}
 
// Build chart data — one bar per month within the range
async function buildChartData(tenantId: string, filter: FilterValue) {
  const today = new Date()
 
  let months: { year: number; month: number }[] = []
 
  if (filter.startsWith('month:')) {
    // Single month — show that month plus 5 prior months
    const m = parseInt(filter.split(':')[1])
    for (let i = 5; i >= 0; i--) {
      const d = new Date(CUR_YEAR, m - i, 1)
      months.push({ year: d.getFullYear(), month: d.getMonth() })
    }
  } else if (filter === 'range:year') {
    // All 12 months of this year
    for (let m = 0; m <= today.getMonth(); m++) {
      months.push({ year: CUR_YEAR, month: m })
    }
  } else {
    const count = filter === 'range:3' ? 3 : filter === 'range:6' ? 6 : 9
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      months.push({ year: d.getFullYear(), month: d.getMonth() })
    }
  }
 
  const chartData = []
  for (const { year, month } of months) {
    const { first, last } = monthRange(year, month)
    const [{ data: inc }, { data: exp }] = await Promise.all([
      supabase.from('hc_finance').select('amount')
        .eq('tenant_id', tenantId).eq('type', 'income').eq('status', 'confirmed')
        .gte('date', first).lte('date', last),
      supabase.from('hc_finance').select('amount')
        .eq('tenant_id', tenantId).eq('type', 'expense')
        .gte('date', first).lte('date', last),
    ])
    chartData.push({
      month: MONTHS[month].slice(0, 3),
      monthIndex: month,
      year,
      revenue:  inc?.reduce((s, r) => s + (r.amount || 0), 0) || 0,
      expenses: exp?.reduce((s, r) => s + (r.amount || 0), 0) || 0,
    })
  }
  return chartData
}
 
export const Dashboard: React.FC = () => {
  const { user, tenantId, isOwner } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterValue>(`month:${CUR_MONTH}`)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [marginInUse, setMarginInUse] = useState(false)
 
  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
 
    const { first, last } = getDateRange(filter)

    // Previous period = same-length window immediately preceding the current one,
    // used for the month-over-month comparison arrows on KPI cards.
    const prevLastDate = new Date(first)
    prevLastDate.setDate(prevLastDate.getDate() - 1)
    const rangeDays = Math.round((new Date(last).getTime() - new Date(first).getTime()) / 86400000) + 1
    const prevFirstDate = new Date(prevLastDate)
    prevFirstDate.setDate(prevFirstDate.getDate() - (rangeDays - 1))
    const prevFirst = prevFirstDate.toISOString().slice(0, 10)
    const prevLast  = prevLastDate.toISOString().slice(0, 10)
 
    // All queries use the same date range — every metric reflects the selected period
    const [
      { count: ci },
      { count: co },
      { count: un },
      { count: totalLeads },
      { count: booked },
      { data: incData },
      { data: expData },
      { data: srcData },
      { data: marginData },
      { count: marginUsedCount },
    ] = await Promise.all([
      // Check-ins within period
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId).neq('status', 'cancelled')
        .gte('check_in', first).lte('check_in', last),
 
      // Check-outs within period
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId)
        .gte('check_out', first).lte('check_out', last),
 
      // Uncontacted leads — enquiry_date within period
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId).eq('status', 'contacted')
        .gte('enquiry_date', first).lte('enquiry_date', last),
 
      // Total leads — enquiry_date within period
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId)
        .gte('enquiry_date', first).lte('enquiry_date', last),
 
      // Booked + completed — enquiry_date within period
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId).in('status', ['booked', 'completed'])
        .gte('enquiry_date', first).lte('enquiry_date', last),
 
      // Revenue — confirmed income within period
      supabase.from('hc_finance').select('amount')
        .eq('tenant_id', tenantId).eq('type', 'income').eq('status', 'confirmed')
        .gte('date', first).lte('date', last),
 
      // Expenses within period
      supabase.from('hc_finance').select('amount')
        .eq('tenant_id', tenantId).eq('type', 'expense')
        .gte('date', first).lte('date', last),
 
      // Sources — customers with enquiry_date within period
      supabase.from('hc_enquiries').select('source')
        .eq('tenant_id', tenantId)
        .gte('enquiry_date', first).lte('enquiry_date', last),
 
      // Margin — booked/completed enquiries, enquiry_date within period
      supabase.from('hc_enquiries').select('margin')
        .eq('tenant_id', tenantId).in('status', ['booked', 'completed'])
        .gte('enquiry_date', first).lte('enquiry_date', last),

      // Whether this subscriber uses margin at all — checked across ALL of their
      // enquiries, not just the current date range, so the card doesn't flicker
      // in/out as the filter changes for a subscriber who genuinely uses it.
      supabase.from('hc_enquiries').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).gt('margin', 0),
    ])
 
    // Source breakdown
    const srcMap: Record<string, number> = {}
    srcData?.forEach(c => { srcMap[c.source] = (srcMap[c.source] || 0) + 1 })
    const sources = Object.entries(srcMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
 
    // Chart
    const chartData = await buildChartData(tenantId!, filter)
 
    // Upcoming 7 days — always from today, not affected by filter
    const todayDate = new Date()
    const in7Days   = new Date(todayDate)
    in7Days.setDate(todayDate.getDate() + 7)
    const todayStr  = todayDate.toISOString().slice(0, 10)
    const in7Str    = in7Days.toISOString().slice(0, 10)
 
    const [{ data: upIn }, { data: upOut }] = await Promise.all([
      supabase.from('hc_enquiries').select('id, name, interest, check_in, check_out, guests, phone')
        .eq('tenant_id', tenantId).in('status', ['booked', 'completed'])
        .gte('check_in', todayStr).lte('check_in', in7Str)
        .order('check_in', { ascending: true }),
      supabase.from('hc_enquiries').select('id, name, interest, check_in, check_out, guests, phone')
        .eq('tenant_id', tenantId).in('status', ['booked', 'completed'])
        .gte('check_out', todayStr).lte('check_out', in7Str)
        .order('check_out', { ascending: true }),
    ])
 
    // Previous-period stats — powers the month-over-month comparison arrows
    const [
      { count: prevTotalLeads },
      { count: prevBooked },
      { data: prevIncData },
      { data: prevExpData },
      { data: prevMarginData },
    ] = await Promise.all([
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId)
        .gte('enquiry_date', prevFirst).lte('enquiry_date', prevLast),
      supabase.from('hc_enquiries').select('*', { count:'exact', head:true })
        .eq('tenant_id', tenantId).in('status', ['booked', 'completed'])
        .gte('enquiry_date', prevFirst).lte('enquiry_date', prevLast),
      supabase.from('hc_finance').select('amount')
        .eq('tenant_id', tenantId).eq('type', 'income').eq('status', 'confirmed')
        .gte('date', prevFirst).lte('date', prevLast),
      supabase.from('hc_finance').select('amount')
        .eq('tenant_id', tenantId).eq('type', 'expense')
        .gte('date', prevFirst).lte('date', prevLast),
      supabase.from('hc_enquiries').select('margin')
        .eq('tenant_id', tenantId).in('status', ['booked', 'completed'])
        .gte('enquiry_date', prevFirst).lte('enquiry_date', prevLast),
    ])

    const prevRevenue  = prevIncData?.reduce((s, r) => s + (r.amount || 0), 0) || 0
    const prevExpenses = prevExpData?.reduce((s, r) => s + (r.amount || 0), 0) || 0

    setStats({
      checkIns:   ci || 0,
      checkOuts:  co || 0,
      uncontacted: un || 0,
      totalLeads: totalLeads || 0,
      booked:     booked || 0,
      revenue:    incData?.reduce((s, r) => s + (r.amount || 0), 0) || 0,
      expenses:   expData?.reduce((s, r) => s + (r.amount || 0), 0) || 0,
      margin:     marginData?.reduce((s, r) => s + (r.margin || 0), 0) || 0,
      chartData,
      sources,
      upcomingCheckIns:  (upIn  as UpcomingEntry[]) || [],
      upcomingCheckOuts: (upOut as UpcomingEntry[]) || [],
      prev: {
        totalLeads: prevTotalLeads || 0,
        booked:     prevBooked || 0,
        revenue:    prevRevenue,
        expenses:   prevExpenses,
        margin:     prevMarginData?.reduce((s, r) => s + (r.margin || 0), 0) || 0,
      },
    })
    setMarginInUse((marginUsedCount || 0) > 0)
    setLoading(false)
  }, [user, filter, tenantId])
 
  useEffect(() => { load() }, [load])
 
  const conv   = stats && stats.totalLeads > 0 ? Math.round((stats.booked / stats.totalLeads) * 100) : 0
  const profit = stats ? stats.revenue - stats.expenses : 0
  const prevProfit = stats ? stats.prev.revenue - stats.prev.expenses : 0
  const { first: periodFirst, last: periodLast, label: revenueLabel } = getDateRange(filter)
 
  // Build filter label for today strip
  const filterLabel = (() => {
    if (filter.startsWith('month:')) return MONTHS[parseInt(filter.split(':')[1])]
    if (filter === 'range:3') return 'Last 3 months'
    if (filter === 'range:6') return 'Last 6 months'
    if (filter === 'range:9') return 'Last 9 months'
    return `${CUR_YEAR}`
  })()
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
 
      {/* Topbar */}
      <div className="topbar">
        <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Dashboard</span>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ fontSize:'11px', color:'#9ca3af' }}>Viewing</span>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as FilterValue)}
            style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, color:'#111111', background:'#ffffff', outline:'none', cursor:'pointer', width:'160px' }}
          >
            <optgroup label="By month">
              {MONTHS.map((m, i) => (
                <option key={m} value={`month:${i}`}>{m} {CUR_YEAR}</option>
              ))}
            </optgroup>
            <optgroup label="By range">
              <option value="range:3">Last 3 months</option>
              <option value="range:6">Last 6 months</option>
              <option value="range:9">Last 9 months</option>
              <option value="range:year">This year ({CUR_YEAR})</option>
            </optgroup>
          </select>
        </div>
      </div>
 
      {/* Content */}
      <div className="page-content">
        {loading ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'200px', color:'#9ca3af', fontSize:'13px' }}>Loading…</div>
        ) : (
          <>
            {/* Today strip */}
            <div className="dash-hero">
              {[
                { v: stats!.checkIns,     l:`Check-ins — ${filterLabel}`,      c:'#ffffff',
                  onClick: () => navigate('/enquiries', { state: { checkInFrom: periodFirst, checkInTo: periodLast, status: 'contacted,booked,completed,noresponse', label: `Check-ins — ${filterLabel}` } }) },
                { v: stats!.checkOuts,    l:`Check-outs — ${filterLabel}`,     c:'#ffffff',
                  onClick: () => navigate('/enquiries', { state: { checkOutFrom: periodFirst, checkOutTo: periodLast, label: `Check-outs — ${filterLabel}` } }) },
                { v: stats!.uncontacted,  l:`Uncontacted — ${filterLabel}`,    c:'#fde68a',
                  onClick: () => navigate('/enquiries', { state: { status: 'contacted', enqDateFrom: periodFirst, enqDateTo: periodLast, label: `Uncontacted — ${filterLabel}` } }) },
                { v: fmt(stats!.revenue), l: revenueLabel,                     c:'#ffffff',
                  onClick: () => navigate('/income', { state: { dateFrom: periodFirst, dateTo: periodLast, label: revenueLabel } }) },
              ].map(t => (
                <div key={t.l} onClick={t.onClick} style={{ cursor:'pointer' }}>
                  <div style={{ fontSize:'22px', fontWeight:500, color:t.c, lineHeight:1, marginBottom:'5px' }}>{t.v}</div>
                  <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.45)', lineHeight:1.4 }}>{t.l}</div>
                </div>
              ))}
            </div>
 
            {/* KPI cards */}
            <div className="grid-4" style={{ marginBottom:'14px' }}>
              <KPICard label={`Total leads — ${filterLabel}`}     value={String(stats!.totalLeads)} dot="#3b82f6"
                delta={<DeltaBadge current={stats!.totalLeads} previous={stats!.prev.totalLeads} />}
                onClick={() => navigate('/enquiries', { state: { enqDateFrom: periodFirst, enqDateTo: periodLast, label: `Total leads — ${filterLabel}` } })} />
              <KPICard label={`Conversion — ${filterLabel}`}      value={`${conv}%`}               dot="#22c55e" />
              <KPICard label={`Revenue — ${filterLabel}`}         value={fmt(stats!.revenue)}       dot="#f97316"
                delta={<DeltaBadge current={stats!.revenue} previous={stats!.prev.revenue} />}
                onClick={() => navigate('/income', { state: { dateFrom: periodFirst, dateTo: periodLast, label: revenueLabel } })} />
              <KPICard label={`Net profit — ${filterLabel}`}      value={fmt(profit)}               dot="#a855f7"
                delta={<DeltaBadge current={profit} previous={prevProfit} />} />
              {isOwner && marginInUse && <KPICard label={`Margin — ${filterLabel}`} value={fmt(stats!.margin)}  dot="#14b8a6"
                delta={<DeltaBadge current={stats!.margin} previous={stats!.prev.margin} />}
                onClick={() => navigate('/enquiries', { state: { status: 'booked,completed', enqDateFrom: periodFirst, enqDateTo: periodLast, label: `Booked & completed — ${filterLabel}` } })} />}
            </div>
 
            {/* Upcoming 7 days strip */}
            {(stats!.upcomingCheckIns.length > 0 || stats!.upcomingCheckOuts.length > 0) && (
              <div className="grid-2" style={{ marginBottom:'14px' }}>
 
                {/* Upcoming check-ins */}
                <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'12px' }}>
                    <span style={{ width:'8px', height:'8px', borderRadius:'2px', background:'#17341e', display:'inline-block' }} />
                    <span style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>Upcoming check-ins — next 7 days</span>
                  </div>
                  {stats!.upcomingCheckIns.length === 0
                    ? <div style={{ fontSize:'12px', color:'#9ca3af' }}>No check-ins this week</div>
                    : stats!.upcomingCheckIns.map(e => (
                      <div key={e.id} onClick={() => navigate('/enquiries', { state: { openEnquiryId: e.id, label: `${e.name} — check-in` } })}
                        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f3f4f6', cursor:'pointer' }}>
                        <div>
                          <div style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>{e.name}</div>
                          <div style={{ fontSize:'11px', color:'#9ca3af' }}>{e.interest || '—'} · {e.guests} guest{e.guests !== 1 ? 's' : ''}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0, marginLeft:'10px' }}>
                          <div style={{ fontSize:'12px', fontWeight:500, color:'#17341e' }}>
                            {e.check_in ? new Date(e.check_in).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                          </div>
                          <div style={{ fontSize:'10px', color:'#9ca3af' }}>
                            Out: {e.check_out ? new Date(e.check_out).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
 
                {/* Upcoming check-outs */}
                <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'14px 16px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'12px' }}>
                    <span style={{ width:'8px', height:'8px', borderRadius:'2px', background:'#dc2626', display:'inline-block' }} />
                    <span style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>Upcoming check-outs — next 7 days</span>
                  </div>
                  {stats!.upcomingCheckOuts.length === 0
                    ? <div style={{ fontSize:'12px', color:'#9ca3af' }}>No check-outs this week</div>
                    : stats!.upcomingCheckOuts.map(e => (
                      <div key={e.id} onClick={() => navigate('/enquiries', { state: { openEnquiryId: e.id, label: `${e.name} — check-out` } })}
                        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f3f4f6', cursor:'pointer' }}>
                        <div>
                          <div style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>{e.name}</div>
                          <div style={{ fontSize:'11px', color:'#9ca3af' }}>{e.interest || '—'} · {e.guests} guest{e.guests !== 1 ? 's' : ''}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0, marginLeft:'10px' }}>
                          <div style={{ fontSize:'12px', fontWeight:500, color:'#dc2626' }}>
                            {e.check_out ? new Date(e.check_out).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                          </div>
                          <div style={{ fontSize:'10px', color:'#9ca3af' }}>
                            In: {e.check_in ? new Date(e.check_in).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
 
            {/* Charts */}
            <div className="grid-3-2">
 
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px 18px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
                  <div style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>Revenue vs Expenses</div>
                  <div style={{ display:'flex', gap:'12px' }}>
                    <span style={{ fontSize:'10px', color:'#6b7280', display:'flex', alignItems:'center', gap:'4px' }}>
                      <span style={{ width:'8px', height:'8px', borderRadius:'2px', background:'#17341e', display:'inline-block' }} />Income
                    </span>
                    <span style={{ fontSize:'10px', color:'#6b7280', display:'flex', alignItems:'center', gap:'4px' }}>
                      <span style={{ width:'8px', height:'8px', borderRadius:'2px', background:'#f0997b', display:'inline-block' }} />Expenses
                    </span>
                  </div>
                </div>
                {stats!.chartData.every(d => d.revenue === 0 && d.expenses === 0) ? (
                  <div style={{ height:'130px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', color:'#9ca3af' }}>
                    No data for this period
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={130}>
                    <BarChart data={stats!.chartData} barSize={14} barGap={3}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize:10, fill:'#9ca3af' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize:10, fill:'#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => v > 0 ? `₹${(v/1000).toFixed(0)}k` : '0'} />
                      <Tooltip
                        formatter={(v: number, name: string) => [fmt(v), name === 'revenue' ? 'Income' : 'Expenses']}
                        contentStyle={{ borderRadius:'8px', border:'1px solid #e5e7eb', fontSize:'11px' }}
                      />
                      <Bar dataKey="revenue"  name="Income"   fill="#17341e" radius={[4,4,0,0]} style={{ cursor:'pointer' }}
                        onClick={(data: { monthIndex: number; year: number }) => { if (data.year === CUR_YEAR) setFilter(`month:${data.monthIndex}` as FilterValue) }} />
                      <Bar dataKey="expenses" name="Expenses" fill="#f0997b" radius={[4,4,0,0]} style={{ cursor:'pointer' }}
                        onClick={(data: { monthIndex: number; year: number }) => { if (data.year === CUR_YEAR) setFilter(`month:${data.monthIndex}` as FilterValue) }} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
 
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'16px 18px' }}>
                <div style={{ fontSize:'12px', fontWeight:500, color:'#111111', marginBottom:'14px' }}>
                  Lead sources — {filterLabel}
                </div>
                {stats!.sources.length === 0 ? (
                  <div style={{ fontSize:'12px', color:'#9ca3af', textAlign:'center', padding:'20px 0' }}>No leads in this period</div>
                ) : stats!.sources.slice(0, 6).map(s => (
                  <div key={s.source} onClick={() => navigate('/enquiries', { state: { source: s.source, enqDateFrom: periodFirst, enqDateTo: periodLast, label: `${s.source} — ${filterLabel}` } })}
                    style={{ marginBottom:'10px', cursor:'pointer' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', marginBottom:'4px' }}>
                      <span style={{ color:'#374151' }}>{s.source}</span>
                      <span style={{ color:'#9ca3af' }}>{Math.round(s.count / (stats!.totalLeads || 1) * 100)}%</span>
                    </div>
                    <div style={{ height:'5px', background:'#f3f4f6', borderRadius:'3px', overflow:'hidden' }}>
                      <div style={{ height:'100%', background:'#17341e', borderRadius:'3px', width:`${Math.round(s.count / (stats!.totalLeads || 1) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
 
            </div>
          </>
        )}
      </div>
    </div>
  )
}
 
export default Dashboard