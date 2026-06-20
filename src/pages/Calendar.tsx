import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCEnquiry, logActivity, getActor } from '../lib/supabase'
import { ChevronLeft, ChevronRight } from 'lucide-react'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
 
interface DayNote { id: string; note: string; created_at: string }
 
export const Calendar: React.FC = () => {
  const { user, tenantId, isOwner, profile, employee } = useAuth()
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [enquiries, setEnquiries] = useState<HCEnquiry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [filterInterest, setFilterInterest] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [notes, setNotes]         = useState<DayNote[]>([])
  const [noteDates, setNoteDates] = useState<Map<string, string>>(new Map())
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [newNote, setNewNote]     = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText]   = useState('')
  const [savingNote, setSavingNote] = useState(false)
 
  useEffect(() => {
    if (!tenantId) return
    supabase.from('hc_inventory').select('name').eq('tenant_id', tenantId).eq('is_active', true).order('sort_order')
      .then(({ data }) => { if (data) setInterests(data.map((i: {name:string}) => i.name)) })
  }, [tenantId])
 
  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const from = new Date(viewYear, viewMonth - 1, 1).toISOString().slice(0,10)
    const to   = new Date(viewYear, viewMonth + 2, 0).toISOString().slice(0,10)
    const { data } = await supabase.from('hc_enquiries')
      .select('id, name, phone, interest, check_in, check_out, guests, status')
      .eq('tenant_id', tenantId).in('status', ['booked','completed'])
      .or(`check_in.gte.${from},check_out.gte.${from}`).lte('check_in', to)
    setEnquiries((data as HCEnquiry[]) || [])
    setLoading(false)
  }, [user, viewYear, viewMonth, tenantId])
 
  useEffect(() => { load() }, [load])
 
  // Load which dates have notes for the current month
  useEffect(() => {
    if (!tenantId) return
    const from = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-01`
    const to   = new Date(viewYear, viewMonth+1, 0).toISOString().slice(0,10)
    supabase.from('hc_calendar_notes')
      .select('date, note')
      .eq('tenant_id', tenantId)
      .gte('date', from)
      .lte('date', to)
      .then(({ data }) => {
        if (data) {
          const map = new Map<string, string>()
          data.forEach((n: {date: string; note: string}) => { if (!map.has(n.date)) map.set(n.date, n.note) })
          setNoteDates(map)
        }
      })
  }, [tenantId, viewYear, viewMonth])
 
  // Load notes whenever selectedDay changes
  useEffect(() => {
    if (!selectedDay || !tenantId) { setNotes([]); setNewNote(''); setEditingId(null); return }
    const dayToLoad = selectedDay
    setLoadingNotes(true)
    supabase.from('hc_calendar_notes')
      .select('id, note, created_at')
      .eq('tenant_id', tenantId)
      .eq('date', dayToLoad)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!error) setNotes((data as DayNote[]) || [])
        setLoadingNotes(false)
      })
    setNewNote('')
    setEditingId(null)
  }, [selectedDay, tenantId])
 
  const prevMonth = () => { setViewMonth(m => m === 0 ? (setViewYear(y => y-1), 11) : m-1); setSelectedDay(null) }
  const nextMonth = () => { setViewMonth(m => m === 11 ? (setViewYear(y => y+1), 0) : m+1); setSelectedDay(null) }
 
  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay  = new Date(viewYear, viewMonth + 1, 0)
  let startDow = firstDay.getDay() - 1; if (startDow < 0) startDow = 6
  const rows = Math.ceil((startDow + lastDay.getDate()) / 7)
 
  const dateStr = (day: number) => `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  const filteredEnq = filterInterest ? enquiries.filter(e => e.interest === filterInterest) : enquiries
  const getIns  = (ds: string) => filteredEnq.filter(e => e.check_in === ds)
  const getOuts = (ds: string) => filteredEnq.filter(e => e.check_out === ds)
  const todayStr = today.toISOString().slice(0,10)
  const selIns  = selectedDay ? getIns(selectedDay)  : []
  const selOuts = selectedDay ? getOuts(selectedDay) : []
  const daysWithEvents = Array.from({length: lastDay.getDate()}, (_,i) => {
    const ds = dateStr(i+1); const ins = getIns(ds); const outs = getOuts(ds)
    return {day:i+1, ds, ins, outs, hasEvents: ins.length>0||outs.length>0}
  }).filter(d => d.hasEvents)
 
  const addNote = async () => {
    if (!newNote.trim() || !selectedDay || !tenantId) return
    setSavingNote(true)
    const { data, error } = await supabase.from('hc_calendar_notes').insert({
      tenant_id: tenantId, date: selectedDay,
      note: newNote.trim(), created_by: user?.id, updated_by: user?.id,
    }).select('id, note, created_at').single()
    if (error) {
      console.error('addNote error:', error)
      alert('Error saving note: ' + error.message)
    } else if (data) {
      setNotes(prev => [...prev, data as DayNote])
      setNoteDates(prev => { const m = new Map(prev); if (!m.has(selectedDay)) m.set(selectedDay, data.note); return m })
      setNewNote('')
      if (user) {
        const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
        logActivity({
          tenantId, ...actor,
          action: 'calendar_note_added', entityType: 'calendar_note', entityId: data.id,
          description: `${actor.actorName} added a calendar note for ${selectedDay}`,
        })
      }
    }
    setSavingNote(false)
  }
 
  const saveEdit = async (id: string) => {
    if (!editText.trim()) return
    setSavingNote(true)
    const { error } = await supabase.from('hc_calendar_notes')
      .update({ note: editText.trim(), updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (!error) {
      setNotes(prev => prev.map(n => n.id === id ? {...n, note: editText.trim()} : n))
      if (user && tenantId) {
        const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
        logActivity({
          tenantId, ...actor,
          action: 'calendar_note_edited', entityType: 'calendar_note', entityId: id,
          description: `${actor.actorName} edited a calendar note for ${selectedDay || 'a day'}`,
        })
      }
    }
    setEditingId(null)
    setSavingNote(false)
  }
 
  const deleteNote = async (id: string) => {
    const { error } = await supabase.from('hc_calendar_notes').delete().eq('id', id)
    if (!error) {
      if (user && tenantId) {
        const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
        logActivity({
          tenantId, ...actor,
          action: 'calendar_note_deleted', entityType: 'calendar_note', entityId: id,
          description: `${actor.actorName} deleted a calendar note for ${selectedDay || 'a day'}`,
        })
      }
      const remaining = notes.filter(n => n.id !== id)
      setNotes(remaining)
      if (remaining.length === 0 && selectedDay) {
        setNoteDates(prev => { const m = new Map(prev); m.delete(selectedDay); return m })
      } else if (remaining.length > 0 && selectedDay) {
        setNoteDates(prev => { const m = new Map(prev); m.set(selectedDay, remaining[0].note); return m })
      }
    }
  }
 
  // Shared styles
  const guestCard = (color: string, bg: string, border: string) => ({
    padding:'10px 12px', background:bg, border:`1px solid ${border}`, borderRadius:'8px', marginBottom:'6px'
  })
 
  const renderBookings = () => (
    <div style={{padding:'12px 16px'}}>
      {selIns.length === 0 && selOuts.length === 0 ? (
        <div style={{fontSize:'12px', color:'#9ca3af', textAlign:'center', padding:'20px 0'}}>No bookings on this day.</div>
      ) : (
        <>
          {selIns.length > 0 && (
            <div style={{marginBottom:'16px'}}>
              <div style={{fontSize:'10px', fontWeight:600, color:'#17341e', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px'}}>
                <span style={{width:'8px', height:'8px', borderRadius:'2px', background:'#17341e', display:'inline-block'}} />
                Check-ins ({selIns.length})
              </div>
              {selIns.map(e => (
                <div key={e.id} style={guestCard('#17341e','#f0fdf4','#86efac')}>
                  <div style={{fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'2px'}}>{e.name}</div>
                  <div style={{fontSize:'11px', color:'#6b7280'}}>{e.interest || ''} · {e.guests} guest{e.guests!==1?'s':''}</div>
                  {e.phone && <div style={{fontSize:'11px', color:'#9ca3af', marginTop:'2px'}}>{e.phone}</div>}
                  <div style={{fontSize:'11px', color:'#9ca3af', marginTop:'2px'}}>
                    Out: {e.check_out ? new Date(e.check_out+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {selOuts.length > 0 && (
            <div>
              <div style={{fontSize:'10px', fontWeight:600, color:'#dc2626', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px'}}>
                <span style={{width:'8px', height:'8px', borderRadius:'2px', background:'#dc2626', display:'inline-block'}} />
                Check-outs ({selOuts.length})
              </div>
              {selOuts.map(e => (
                <div key={e.id} style={guestCard('#dc2626','#fef2f2','#fca5a5')}>
                  <div style={{fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'2px'}}>{e.name}</div>
                  <div style={{fontSize:'11px', color:'#6b7280'}}>{e.interest || ''} · {e.guests} guest{e.guests!==1?'s':''}</div>
                  {e.phone && <div style={{fontSize:'11px', color:'#9ca3af', marginTop:'2px'}}>{e.phone}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
 
  const renderNotes = () => (
    <div style={{padding:'12px 16px', borderTop:'1px solid #f3f4f6'}}>
      <div style={{fontSize:'11px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'10px'}}>
        Notes{notes.length > 0 ? ` (${notes.length})` : ''}
      </div>
      {loadingNotes ? (
        <div style={{fontSize:'12px', color:'#9ca3af'}}>Loading...</div>
      ) : (
        <>
          {notes.map(n => (
            <div key={n.id} style={{marginBottom:'8px'}}>
              {editingId === n.id ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    rows={2}
                    autoFocus
                    style={{width:'100%', padding:'8px 10px', border:'1px solid #17341e', borderRadius:'8px', fontSize:'12px', color:'#111111', resize:'vertical', outline:'none', fontFamily:'inherit', boxSizing:'border-box'}}
                  />
                  <div style={{display:'flex', gap:'6px', marginTop:'4px'}}>
                    <button onClick={() => saveEdit(n.id)} disabled={savingNote}
                      style={{padding:'5px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'6px', fontSize:'11px', fontWeight:500, cursor:'pointer'}}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)}
                      style={{padding:'5px 12px', background:'#f3f4f6', color:'#374151', border:'none', borderRadius:'6px', fontSize:'11px', cursor:'pointer'}}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{display:'flex', alignItems:'flex-start', gap:'8px', padding:'8px 10px', background:'#f9fafb', borderRadius:'8px', border:'1px solid #f3f4f6'}}>
                  <span style={{flex:1, fontSize:'12px', color:'#374151', lineHeight:'1.5', whiteSpace:'pre-wrap'}}>{n.note}</span>
                  <div style={{display:'flex', gap:'4px', flexShrink:0}}>
                    <button onClick={() => {setEditingId(n.id); setEditText(n.note)}}
                      style={{padding:'3px 8px', background:'#ffffff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'6px', fontSize:'10px', cursor:'pointer'}}>
                      Edit
                    </button>
                    <button onClick={() => deleteNote(n.id)}
                      style={{padding:'3px 8px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'6px', fontSize:'10px', cursor:'pointer'}}>
                      Del
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            onKeyDown={e => { if (e.key==='Enter' && (e.metaKey||e.ctrlKey)) addNote() }}
            style={{width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', resize:'vertical', outline:'none', fontFamily:'inherit', boxSizing:'border-box', marginTop:'4px'}}
          />
          <button onClick={addNote} disabled={!newNote.trim() || savingNote}
            style={{marginTop:'6px', padding:'6px 14px', background: newNote.trim() ? '#17341e' : '#f3f4f6', color: newNote.trim() ? '#ffffff' : '#9ca3af', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor: newNote.trim() ? 'pointer' : 'default'}}>
            + Add note
          </button>
        </>
      )}
    </div>
  )
 
  const dayHeader = (ds: string) => (
    <div style={{padding:'12px 16px', borderBottom:'1px solid #f3f4f6', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0}}>
      <div style={{fontSize:'13px', fontWeight:500, color:'#111111'}}>
        {new Date(ds+'T12:00:00').toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long'})}
      </div>
      <button onClick={() => setSelectedDay(null)} style={{background:'none', border:'none', cursor:'pointer', fontSize:'18px', color:'#9ca3af', lineHeight:1, padding:0}}>×</button>
    </div>
  )
 
  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%', overflow:'hidden'}}>
      {/* Topbar */}
      <div className="topbar">
        <span style={{fontSize:'15px', fontWeight:500, color:'#111111'}}>Calendar</span>
        <div className="cal-nav">
          <div className="cal-legend" style={{display:'flex', gap:'12px', marginRight:'12px'}}>
            <span style={{display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'#6b7280'}}>
              <span style={{width:'10px', height:'10px', borderRadius:'3px', background:'#17341e', display:'inline-block'}}/>Check-in
            </span>
            <span style={{display:'flex', alignItems:'center', gap:'5px', fontSize:'11px', color:'#6b7280'}}>
              <span style={{width:'10px', height:'10px', borderRadius:'3px', background:'#dc2626', display:'inline-block'}}/>Check-out
            </span>
          </div>
          <button onClick={prevMonth} style={{padding:'6px', background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', cursor:'pointer', display:'flex', alignItems:'center', color:'#6b7280'}}><ChevronLeft size={16}/></button>
          <span className="cal-month-label" style={{fontSize:'14px', fontWeight:500, color:'#111111', minWidth:'140px', textAlign:'center'}}>{MONTHS[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} style={{padding:'6px', background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', cursor:'pointer', display:'flex', alignItems:'center', color:'#6b7280'}}><ChevronRight size={16}/></button>
          <button onClick={() => {setViewYear(today.getFullYear()); setViewMonth(today.getMonth())}}
            style={{padding:'6px 14px', background:'#f3f4f6', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, color:'#374151', cursor:'pointer', marginLeft:'4px'}}>Today</button>
          {interests.length > 0 && (
            <select value={filterInterest} onChange={e => setFilterInterest(e.target.value)}
              style={{padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151', background:'#ffffff', outline:'none', cursor:'pointer', marginLeft:'4px'}}>
              <option value="">All properties</option>
              {interests.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
        </div>
      </div>
 
      {loading ? (
        <div style={{textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:'13px'}}>Loading…</div>
      ) : (
        <>
          {/* Desktop grid */}
          <div className="cal-desktop" style={{flex:1, overflow:'hidden', display:'flex'}}>
            <div style={{flex:1, overflowY:'auto', padding:'14px 16px'}}>
              <div style={{background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden'}}>
                <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid #e5e7eb'}}>
                  {DAYS.map(d => <div key={d} style={{padding:'10px', textAlign:'center', fontSize:'11px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em'}}>{d}</div>)}
                </div>
                {Array.from({length:rows},(_,row) => (
                  <div key={row} style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom: row<rows-1?'1px solid #f3f4f6':'none'}}>
                    {Array.from({length:7},(_,col) => {
                      const idx = row*7+col; const day = idx-startDow+1
                      const isValid = day>=1 && day<=lastDay.getDate()
                      const ds = isValid ? dateStr(day) : ''
                      const ins = isValid ? getIns(ds) : []; const outs = isValid ? getOuts(ds) : []
                      const isToday = ds===todayStr; const isSel = ds===selectedDay
                      return (
                        <div key={col} onClick={() => isValid && setSelectedDay(isSel?null:ds)}
                          style={{minHeight:'80px', padding:'6px 8px', cursor:isValid?'pointer':'default', background:isSel?'#f0fdf4':'#ffffff', borderLeft:col>0?'1px solid #f3f4f6':'none'}}>
                          {isValid && (<>
                            <div style={{fontSize:'12px', fontWeight:isToday?600:400, color:isToday?'#ffffff':'#374151', width:'22px', height:'22px', borderRadius:'50%', background:isToday?'#17341e':'transparent', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'4px'}}>{day}</div>
                            {ins.slice(0,2).map(e => <div key={e.id} style={{background:'#17341e', color:'#ffffff', fontSize:'10px', fontWeight:500, padding:'2px 5px', borderRadius:'4px', marginBottom:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>↓ {e.name.split(' ')[0]}</div>)}
                            {ins.length>2 && <div style={{fontSize:'9px', color:'#17341e'}}>+{ins.length-2}</div>}
                            {outs.slice(0,2).map(e => <div key={e.id} style={{background:'#fee2e2', color:'#dc2626', fontSize:'10px', fontWeight:500, padding:'2px 5px', borderRadius:'4px', marginBottom:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>↑ {e.name.split(' ')[0]}</div>)}
                            {outs.length>2 && <div style={{fontSize:'9px', color:'#dc2626'}}>+{outs.length-2}</div>}
                            {noteDates.has(ds) && <div style={{marginTop:'3px', fontSize:'9px', color:'#9ca3af', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:'1.2', paddingTop:'1px', borderTop:'1px dashed #f3f4f6'}}>{noteDates.get(ds)}</div>}
                          </>)}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
 
            {selectedDay && (
              <div className="side-panel" style={{width:'300px', display:'flex', flexDirection:'column'}}>
                {dayHeader(selectedDay)}
                <div style={{flex:1, overflowY:'auto'}}>
                  {renderBookings()}
                  {renderNotes()}
                </div>
              </div>
            )}
          </div>
 
          {/* Mobile list */}
          <div className="cal-mobile" style={{flex:1, overflowY:'auto', padding:'12px'}}>
            <div style={{background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'12px', marginBottom:'12px'}}>
              <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'4px', marginBottom:'8px'}}>
                {DAYS.map(d => <div key={d} style={{textAlign:'center', fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase'}}>{d[0]}</div>)}
              </div>
              <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'4px'}}>
                {Array.from({length:startDow},(_,i) => <div key={`e${i}`}/>)}
                {Array.from({length:lastDay.getDate()},(_,i) => {
                  const day=i+1; const ds=dateStr(day)
                  const ins=getIns(ds); const outs=getOuts(ds)
                  const isToday=ds===todayStr; const isSel=ds===selectedDay
                  return (
                    <div key={day} onClick={() => setSelectedDay(isSel?null:ds)} style={{textAlign:'center', cursor:'pointer'}}>
                      <div style={{width:'28px', height:'28px', borderRadius:'50%', margin:'0 auto', background:isSel?'#17341e':isToday?'#e8f5e9':'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:isToday?600:400, color:isSel?'#ffffff':isToday?'#17341e':'#374151'}}>{day}</div>
                      <div style={{display:'flex', justifyContent:'center', gap:'2px', marginTop:'2px'}}>
                        {ins.length>0 && <div style={{width:'5px', height:'5px', borderRadius:'50%', background:'#17341e'}}/>}
                        {outs.length>0 && <div style={{width:'5px', height:'5px', borderRadius:'50%', background:'#dc2626'}}/>}
                        {noteDates.has(ds) && <div style={{width:'5px', height:'5px', borderRadius:'50%', background:'#9ca3af'}}/>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
 
            {selectedDay ? (
              <div style={{background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden'}}>
                {dayHeader(selectedDay)}
                {renderBookings()}
                {renderNotes()}
              </div>
            ) : (
              <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                {daysWithEvents.length===0 ? (
                  <div style={{textAlign:'center', padding:'24px', fontSize:'13px', color:'#9ca3af', background:'#ffffff', borderRadius:'10px', border:'1px solid #e5e7eb'}}>No bookings this month</div>
                ) : daysWithEvents.map(({day,ds,ins,outs}) => (
                  <div key={ds} onClick={() => setSelectedDay(ds)} style={{background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'12px 14px', cursor:'pointer'}}>
                    <div style={{fontSize:'12px', fontWeight:600, color:'#374151', marginBottom:'8px'}}>
                      {new Date(ds+'T12:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}
                      {ds===todayStr && <span style={{marginLeft:'8px', fontSize:'10px', background:'#17341e', color:'#fff', padding:'2px 8px', borderRadius:'10px'}}>Today</span>}
                    </div>
                    {ins.map(e => (
                      <div key={e.id} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px'}}>
                        <span style={{width:'8px', height:'8px', borderRadius:'2px', background:'#17341e', flexShrink:0}}/>
                        <span style={{fontSize:'12px', color:'#111111', fontWeight:500}}>{e.name}</span>
                        <span style={{fontSize:'11px', color:'#9ca3af', marginLeft:'auto'}}>Check-in</span>
                      </div>
                    ))}
                    {outs.map(e => (
                      <div key={e.id} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px'}}>
                        <span style={{width:'8px', height:'8px', borderRadius:'2px', background:'#dc2626', flexShrink:0}}/>
                        <span style={{fontSize:'12px', color:'#111111', fontWeight:500}}>{e.name}</span>
                        <span style={{fontSize:'11px', color:'#9ca3af', marginLeft:'auto'}}>Check-out</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
 
export default Calendar