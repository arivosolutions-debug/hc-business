import React, { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'

const SUPABASE_URL = 'https://zecuxurmuydzlxsxasxq.supabase.co'
const PAGE_SIZE = 50

type RangeType = 'day' | 'week' | 'month' | 'all'

interface SharedEnquiry {
  id: string
  name: string
  source: string
  status: string
  enquiry_date: string | null
  lead_quality: 'good' | 'average' | 'poor' | null
  first_note: string | null
}

interface ReportResponse {
  business_name: string
  range: { start: string | null; end: string | null; label: string }
  enquiries: SharedEnquiry[]
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  contacted:  { label:'Contacted',   bg:'#fef9c3', color:'#854f0b' },
  booked:     { label:'Booked',      bg:'#dcfce7', color:'#166534' },
  completed:  { label:'Completed',   bg:'#d1fae5', color:'#065f46' },
  noresponse: { label:'No response', bg:'#f3f4f6', color:'#6b7280' },
  cancelled:  { label:'Cancelled',   bg:'#fee2e2', color:'#991b1b' },
}

const QUALITY_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  good:    { label:'Good',    bg:'#dcfce7', color:'#166534' },
  average: { label:'Average', bg:'#fef9c3', color:'#854f0b' },
  poor:    { label:'Poor',    bg:'#fee2e2', color:'#991b1b' },
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

function shiftDate(iso: string, range: RangeType, dir: 1 | -1): string {
  if (range === 'all') return iso // no-op — Prev/Next are hidden for All time anyway
  const d = new Date(iso + 'T12:00:00Z')
  if (range === 'day') d.setUTCDate(d.getUTCDate() + dir)
  else if (range === 'week') d.setUTCDate(d.getUTCDate() + dir * 7)
  else d.setUTCMonth(d.getUTCMonth() + dir)
  return d.toISOString().slice(0, 10)
}

export const SharedCRMReport: React.FC = () => {
  const { token } = useParams<{ token: string }>()
  const [range, setRange] = useState<RangeType>('day')
  const [refDate, setRefDate] = useState(todayISO())
  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterQuality, setFilterQuality] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/shared-report?token=${token}&range=${range}&date=${refDate}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Could not load this report')
        setData(null)
      } else {
        setData(json)
      }
    } catch {
      setError('Could not connect — check your internet connection and try again')
    }
    setLoading(false)
  }, [token, range, refDate])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setPage(1)
    setFilterStatus(''); setFilterSource(''); setFilterQuality('')
  }, [range, refDate])

  const rangeBtn = (r: RangeType, label: string) => (
    <button onClick={() => setRange(r)}
      style={{ padding:'7px 16px', borderRadius:'8px', border:'1px solid', borderColor: range===r?'#17341e':'#e5e7eb', background: range===r?'#17341e':'#ffffff', color: range===r?'#ffffff':'#374151', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
      {label}
    </button>
  )

  const sourceOptions = data ? Array.from(new Set(data.enquiries.map(e => e.source))).sort() : []

  const filteredEnquiries = (data?.enquiries || []).filter(e => {
    if (filterStatus && e.status !== filterStatus) return false
    if (filterSource && e.source !== filterSource) return false
    if (filterQuality && e.lead_quality !== filterQuality) return false
    return true
  })

  const totalPages = Math.ceil(filteredEnquiries.length / PAGE_SIZE)
  const paginated = filteredEnquiries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div style={{ minHeight:'100vh', background:'#f9fafb', padding:'24px 16px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ maxWidth:'760px', margin:'0 auto' }}>

        <div style={{ textAlign:'center', marginBottom:'20px' }}>
          <div style={{ fontSize:'11px', color:'#9ca3af', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'4px' }}>CRM Report</div>
          <div style={{ fontSize:'20px', fontWeight:600, color:'#17341e' }}>{data?.business_name || '—'}</div>
        </div>

        <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'12px', padding:'18px 20px', marginBottom:'16px' }}>
          <div style={{ display:'flex', gap:'8px', marginBottom:'14px', flexWrap:'wrap' }}>
            {rangeBtn('day', 'Day')}
            {rangeBtn('week', 'Week')}
            {rangeBtn('month', 'Month')}
            {rangeBtn('all', 'All time')}
          </div>
          {range !== 'all' && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px', flexWrap:'wrap' }}>
              <button onClick={() => setRefDate(d => shiftDate(d, range, -1))}
                style={{ padding:'6px 12px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#374151' }}>‹ Prev</button>
              <span style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{data?.range.label || '...'}</span>
              <button onClick={() => setRefDate(d => shiftDate(d, range, 1))}
                style={{ padding:'6px 12px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', cursor:'pointer', color:'#374151' }}>Next ›</button>
              <input type="date" value={refDate} onChange={e => e.target.value && setRefDate(e.target.value)}
                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151', cursor:'pointer' }}
                title="Jump to any date" />
            </div>
          )}
          {range === 'all' && (
            <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', textAlign:'center' }}>{data?.range.label || '...'}</div>
          )}
        </div>

        {loading && (
          <div style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:'13px' }}>Loading...</div>
        )}

        {!loading && error && (
          <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:'12px', padding:'20px', textAlign:'center', color:'#991b1b', fontSize:'13px' }}>
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'12px', overflow:'hidden' }}>
            <div style={{ display:'flex', gap:'8px', padding:'14px 16px', borderBottom:'1px solid #f3f4f6', flexWrap:'wrap' }}>
              <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151' }}>
                <option value="">All statuses</option>
                {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={filterSource} onChange={e => { setFilterSource(e.target.value); setPage(1) }}
                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151' }}>
                <option value="">All sources</option>
                {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterQuality} onChange={e => { setFilterQuality(e.target.value); setPage(1) }}
                style={{ padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151' }}>
                <option value="">All quality</option>
                {Object.entries(QUALITY_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              {(filterStatus || filterSource || filterQuality) && (
                <button onClick={() => { setFilterStatus(''); setFilterSource(''); setFilterQuality(''); setPage(1) }}
                  style={{ fontSize:'11px', color:'#991b1b', background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:'8px', padding:'6px 12px', cursor:'pointer' }}>
                  Clear filters
                </button>
              )}
            </div>
            {filteredEnquiries.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:'13px' }}>
                {data.enquiries.length === 0 ? 'No enquiries in this period.' : 'No enquiries match these filters.'}
              </div>
            ) : (
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
                      <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Name</th>
                      <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Source</th>
                      <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Status</th>
                      <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Date</th>
                      <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Quality</th>
                      <th style={{ textAlign:'left', padding:'10px 14px', fontSize:'11px', color:'#6b7280', fontWeight:600 }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(e => {
                      const st = STATUS_STYLE[e.status] || { label: e.status, bg:'#f3f4f6', color:'#6b7280' }
                      const q = e.lead_quality ? QUALITY_STYLE[e.lead_quality] : null
                      return (
                        <tr key={e.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#111111' }}>{e.name}</td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#374151' }}>{e.source}</td>
                          <td style={{ padding:'10px 14px' }}>
                            <span style={{ fontSize:'11px', padding:'3px 9px', borderRadius:'20px', fontWeight:500, background:st.bg, color:st.color }}>{st.label}</span>
                          </td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#374151' }}>{e.enquiry_date || '—'}</td>
                          <td style={{ padding:'10px 14px' }}>
                            {q ? (
                              <span style={{ fontSize:'11px', padding:'3px 9px', borderRadius:'20px', fontWeight:500, background:q.bg, color:q.color }}>{q.label}</span>
                            ) : (
                              <span style={{ fontSize:'12px', color:'#d1d5db' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding:'10px 14px', fontSize:'13px', color:'#374151', maxWidth:'220px' }}>
                            {e.first_note || <span style={{ color:'#d1d5db' }}>—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!loading && !error && data && totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 4px', marginTop:'10px', flexWrap:'wrap', gap:'8px' }}>
            <span style={{ fontSize:'12px', color:'#9ca3af' }}>
              Showing {((page-1)*PAGE_SIZE)+1}–{Math.min(page*PAGE_SIZE, filteredEnquiries.length)} of {filteredEnquiries.length}
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

        <div style={{ textAlign:'center', marginTop:'20px', fontSize:'11px', color:'#d1d5db' }}>
          Powered by HC Business
        </div>
      </div>
    </div>
  )
}

export default SharedCRMReport