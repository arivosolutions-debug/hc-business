import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCEnquiry } from '../lib/supabase'
import { ChevronLeft, ChevronRight } from 'lucide-react'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
 
export const Calendar: React.FC = () => {
  const { user, tenantId } = useAuth()
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [enquiries, setEnquiries] = useState<HCEnquiry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
 
  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    // Load current month + adjacent months for smooth nav
    const from = new Date(viewYear, viewMonth - 1, 1).toISOString().slice(0, 10)
    const to   = new Date(viewYear, viewMonth + 2, 0).toISOString().slice(0, 10)
    const { data } = await supabase
      .from('hc_enquiries')
      .select('id, name, phone, interest, check_in, check_out, guests, status')
      .eq('tenant_id', tenantId)
      .in('status', ['booked', 'completed'])
      .or(`check_in.gte.${from},check_out.gte.${from}`)
      .lte('check_in', to)
    setEnquiries((data as HCEnquiry[]) || [])
    setLoading(false)
  }, [user, viewYear, viewMonth])
 
  useEffect(() => { load() }, [load])
 
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
    setSelectedDay(null)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
    setSelectedDay(null)
  }
 
  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay  = new Date(viewYear, viewMonth + 1, 0)
 
  // Start grid on Monday — adjust so Mon=0
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6  // Sunday → 6
 
  const totalCells = startDow + lastDay.getDate()
  const rows = Math.ceil(totalCells / 7)
 
  // Build date string from day number
  const dateStr = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    return `${viewYear}-${m}-${d}`
  }
 
  // Get check-ins and check-outs for a specific date
  const getCheckIns  = (ds: string) => enquiries.filter(e => e.check_in === ds)
  const getCheckOuts = (ds: string) => enquiries.filter(e => e.check_out === ds)
 
  const todayStr = today.toISOString().slice(0, 10)
 
  // Selected day enquiries
  const selCheckIns  = selectedDay ? getCheckIns(selectedDay)  : []
  const selCheckOuts = selectedDay ? getCheckOuts(selectedDay) : []
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
 
      {/* Topbar */}
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', padding:'0 22px', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Calendar</span>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          {/* Legend */}
          <div style={{ display:'flex', gap:'12px', marginRight:'12px' }}>
            <span style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'#6b7280' }}>
              <span style={{ width:'10px', height:'10px', borderRadius:'3px', background:'#17341e', display:'inline-block' }} />Check-in
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'#6b7280' }}>
              <span style={{ width:'10px', height:'10px', borderRadius:'3px', background:'#dc2626', display:'inline-block' }} />Check-out
            </span>
          </div>
          <button onClick={prevMonth} style={{ padding:'6px', background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', cursor:'pointer', display:'flex', alignItems:'center', color:'#6b7280' }}><ChevronLeft size={16} /></button>
          <span style={{ fontSize:'14px', fontWeight:500, color:'#111111', minWidth:'140px', textAlign:'center' }}>{MONTHS[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} style={{ padding:'6px', background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', cursor:'pointer', display:'flex', alignItems:'center', color:'#6b7280' }}><ChevronRight size={16} /></button>
          <button onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()) }}
            style={{ padding:'6px 14px', background:'#f3f4f6', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, color:'#374151', cursor:'pointer', marginLeft:'4px' }}>Today</button>
        </div>
      </div>
 
      {/* Calendar + panel */}
      <div style={{ flex:1, overflow:'hidden', display:'flex' }}>
 
        {/* Grid */}
        <div style={{ flex:1, overflowY:'auto', padding:'14px 16px' }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:'13px' }}>Loading…</div>
          ) : (
            <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden' }}>
              {/* Day headers */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', borderBottom:'1px solid #e5e7eb' }}>
                {DAYS.map(d => (
                  <div key={d} style={{ padding:'10px', textAlign:'center', fontSize:'11px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em' }}>{d}</div>
                ))}
              </div>
 
              {/* Weeks */}
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', borderBottom: row < rows - 1 ? '1px solid #f3f4f6' : 'none' }}>
                  {Array.from({ length: 7 }, (_, col) => {
                    const cellIdx = row * 7 + col
                    const day     = cellIdx - startDow + 1
                    const isValid = day >= 1 && day <= lastDay.getDate()
                    const ds      = isValid ? dateStr(day) : ''
                    const checkIns  = isValid ? getCheckIns(ds)  : []
                    const checkOuts = isValid ? getCheckOuts(ds) : []
                    const isToday   = ds === todayStr
                    const isSelected = ds === selectedDay
                    const hasSomething = checkIns.length > 0 || checkOuts.length > 0
 
                    return (
                      <div
                        key={col}
                        onClick={() => isValid && setSelectedDay(isSelected ? null : ds)}
                        style={{
                          minHeight:'80px', padding:'6px 8px', cursor: hasSomething ? 'pointer' : isValid ? 'default' : 'default',
                          background: isSelected ? '#f0fdf4' : '#ffffff',
                          borderLeft: col > 0 ? '1px solid #f3f4f6' : 'none',
                          position:'relative',
                        }}
                      >
                        {isValid && (
                          <>
                            {/* Day number */}
                            <div style={{
                              fontSize:'12px', fontWeight: isToday ? 600 : 400,
                              color: isToday ? '#ffffff' : '#374151',
                              width:'22px', height:'22px', borderRadius:'50%',
                              background: isToday ? '#17341e' : 'transparent',
                              display:'flex', alignItems:'center', justifyContent:'center',
                              marginBottom:'4px',
                            }}>{day}</div>
 
                            {/* Check-in chips */}
                            {checkIns.slice(0, 3).map((e, i) => (
                              <div key={e.id} style={{ background:'#17341e', color:'#ffffff', fontSize:'10px', fontWeight:500, padding:'2px 6px', borderRadius:'4px', marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%' }}>
                                ↓ {e.name.split(' ')[0]}
                              </div>
                            ))}
                            {checkIns.length > 3 && (
                              <div style={{ fontSize:'10px', color:'#17341e', fontWeight:500, marginBottom:'2px' }}>+{checkIns.length - 3} more in</div>
                            )}
 
                            {/* Check-out chips */}
                            {checkOuts.slice(0, 3).map((e, i) => (
                              <div key={e.id} style={{ background:'#fee2e2', color:'#dc2626', fontSize:'10px', fontWeight:500, padding:'2px 6px', borderRadius:'4px', marginBottom:'2px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%' }}>
                                ↑ {e.name.split(' ')[0]}
                              </div>
                            ))}
                            {checkOuts.length > 3 && (
                              <div style={{ fontSize:'10px', color:'#dc2626', fontWeight:500 }}>+{checkOuts.length - 3} more out</div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
 
        {/* Day detail panel */}
        {selectedDay && (
          <div style={{ width:'280px', borderLeft:'1px solid #e5e7eb', background:'#ffffff', flexShrink:0, display:'flex', flexDirection:'column', overflowY:'auto' }}>
            <div style={{ padding:'14px 16px', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' })}
              </div>
              <button onClick={() => setSelectedDay(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
 
            <div style={{ padding:'12px 16px', flex:1 }}>
              {selCheckIns.length === 0 && selCheckOuts.length === 0 ? (
                <div style={{ fontSize:'12px', color:'#9ca3af', textAlign:'center', padding:'20px 0' }}>No bookings on this day.</div>
              ) : (
                <>
                  {selCheckIns.length > 0 && (
                    <div style={{ marginBottom:'16px' }}>
                      <div style={{ fontSize:'10px', fontWeight:600, color:'#17341e', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                        <span style={{ width:'8px', height:'8px', borderRadius:'2px', background:'#17341e', display:'inline-block' }} />
                        Check-ins ({selCheckIns.length})
                      </div>
                      {selCheckIns.map(e => (
                        <div key={e.id} style={{ padding:'10px 12px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:'8px', marginBottom:'6px' }}>
                          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'2px' }}>{e.name}</div>
                          <div style={{ fontSize:'11px', color:'#6b7280' }}>{e.interest || 'No interest specified'} · {e.guests} guest{e.guests !== 1 ? 's' : ''}</div>
                          {e.phone && <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>{e.phone}</div>}
                          <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>
                            Check-out: {e.check_out ? new Date(e.check_out + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
 
                  {selCheckOuts.length > 0 && (
                    <div>
                      <div style={{ fontSize:'10px', fontWeight:600, color:'#dc2626', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                        <span style={{ width:'8px', height:'8px', borderRadius:'2px', background:'#dc2626', display:'inline-block' }} />
                        Check-outs ({selCheckOuts.length})
                      </div>
                      {selCheckOuts.map(e => (
                        <div key={e.id} style={{ padding:'10px 12px', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:'8px', marginBottom:'6px' }}>
                          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'2px' }}>{e.name}</div>
                          <div style={{ fontSize:'11px', color:'#6b7280' }}>{e.interest || 'No interest specified'} · {e.guests} guest{e.guests !== 1 ? 's' : ''}</div>
                          {e.phone && <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>{e.phone}</div>}
                          <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>
                            Checked in: {e.check_in ? new Date(e.check_in + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
 
export default Calendar