/// <reference types="vite/client" />
import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCFinance, fmt, fmtDate } from '../lib/supabase'
import * as XLSX from 'xlsx'
 
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DEFAULT_CATS = ['Electricity','Staff Salary','Maintenance','Food & Supplies','Marketing','Transport','Other']
const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
const BLANK = { date: new Date().toISOString().slice(0,10), amount:'', category:'Staff Salary', description:'' }
 
export const Expenses: React.FC = () => {
  const { user, tenantId } = useAuth()
  const [records, setRecords]     = useState<HCFinance[]>([])
  const [loading, setLoading]     = useState(true)
  const [filterMonth, setFilterMonth] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd]     = useState(false)
  const [form, setForm]           = useState(BLANK)
  const [saving, setSaving]       = useState(false)
  const [cats, setCats]           = useState<string[]>(DEFAULT_CATS)
  const [toast, setToast]         = useState('')
  const [editRecord, setEditRecord] = useState<HCFinance | null>(null)
  const [editForm, setEditForm]   = useState(BLANK)
  const [newCat, setNewCat]       = useState('')
  const [newEditCat, setNewEditCat] = useState('')
  const [managingCats, setManagingCats] = useState(false)
 
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2800) }
 
  const addCatOption = async (val: string, isEdit = false) => {
    if (!val.trim() || !tenantId) return
    await supabase.from('hc_settings').insert({ tenant_id: tenantId, type: 'expense_category', value: val.trim(), sort_order: cats.length })
    const updated = [...cats, val.trim()]
    setCats(updated)
    if (isEdit) { setNewEditCat(''); setEditForm(f => ({ ...f, category: val.trim() })) }
    else { setNewCat(''); setForm(f => ({ ...f, category: val.trim() })) }
  }
 
  const deleteCatOption = async (val: string) => {
    if (!tenantId) return
    await supabase.from('hc_settings').delete().eq('tenant_id', tenantId).eq('type', 'expense_category').eq('value', val)
    setCats(prev => prev.filter(c => c !== val))
  }
 
  const load = useCallback(async () => {
    if (!user) return
    const [{ data: exp }, { data: settings }] = await Promise.all([
      supabase.from('hc_finance').select('*').eq('tenant_id', tenantId).eq('type', 'expense').order('date', { ascending: false }),
      supabase.from('hc_settings').select('value').eq('tenant_id', tenantId).eq('type', 'expense_category').order('sort_order'),
    ])
    const expRecords = (exp as HCFinance[]) || []
    setRecords(expRecords)
 
    // Merge: settings cats + cats already used in records (deduplicated)
    const settingsCats = settings && settings.length > 0 ? settings.map(s => s.value) : DEFAULT_CATS
    const recordCats = expRecords.map(r => r.category).filter(Boolean) as string[]
    const merged = Array.from(new Set([...settingsCats, ...recordCats]))
 
    // Seed any missing cats into hc_settings so they appear next time
    const missing = merged.filter(c => !settingsCats.includes(c))
    if (missing.length > 0 && tenantId) {
      try {
        await supabase.from('hc_settings').insert(
          missing.map((c, i) => ({ tenant_id: tenantId, type: 'expense_category', value: c, sort_order: settingsCats.length + i }))
        )
      } catch (_) { /* ignore duplicate errors */ }
    }
 
    setCats(merged)
    setLoading(false)
  }, [user])
 
  useEffect(() => { load() }, [load])
 
  // Filter and sort by date descending
  const displayed = records
    .filter(r => {
      if (filterMonth !== '' && new Date(r.date + 'T12:00:00').getMonth() !== parseInt(filterMonth)) return false
      if (filterCat && r.category !== filterCat) return false
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))
 
  const total = displayed.reduce((s, r) => s + r.amount, 0)
 
  const handleAdd = async () => {
    if (!user || !form.amount || !form.description.trim()) { showToast('Amount and description are required'); return }
    setSaving(true)
    await supabase.from('hc_finance').insert({
      tenant_id: tenantId, type:'expense', status:'confirmed',
      amount: parseFloat(form.amount), category: form.category,
      description: form.description, date: form.date, created_by: user.id,
    })
    setSaving(false); setForm(BLANK); setShowAdd(false); load()
    showToast('Expense saved')
  }
 
  const openEdit = (r: HCFinance) => {
    setEditRecord(r)
    setEditForm({ date: r.date, amount: String(r.amount), category: r.category || 'Staff Salary', description: r.description || '' })
  }
 
  const saveEdit = async () => {
    if (!editRecord || !user) return
    setSaving(true)
    await supabase.from('hc_finance').update({
      date:        editForm.date,
      amount:      parseFloat(editForm.amount) || 0,
      category:    editForm.category,
      description: editForm.description,
      updated_at:  new Date().toISOString(),
    }).eq('id', editRecord.id)
    setSaving(false); setEditRecord(null); load()
    showToast('Expense updated')
  }
 
  const deleteRecord = async (id: string) => {
    if (!confirm('Delete this expense?')) return
    await supabase.from('hc_finance').delete().eq('id', id)
    if (editRecord?.id === id) setEditRecord(null)
    load(); showToast('Expense deleted')
  }
 
  const exportExcel = () => {
    if (displayed.length === 0) { showToast('No expenses to export'); return }
    const rows = displayed.map(r => ({ Date: r.date, Description: r.description || '', Category: r.category || '', Amount: r.amount }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Expenses')
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses-${new Date().toISOString().slice(0, 7)}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`Exported ${displayed.length} expenses`)
  }
 
  const sel: React.CSSProperties = { padding:'7px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#374151', background:'#ffffff', outline:'none', cursor:'pointer' }
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
 
      {/* Topbar */}
      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Expenses</span>
          <span style={{ fontSize:'12px', color:'#9ca3af' }}>Total: {fmt(total)}</span>
        </div>
        <div className="filter-bar">
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...sel, width:'130px' }}>
            <option value="">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={sel}>
            <option value="">All categories</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={exportExcel} style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>↓ Excel</button>
          <button onClick={() => setShowAdd(v => !v)} style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>+ Add expense</button>
        </div>
      </div>
 
      {/* Content */}
      <div style={{ padding:"14px 20px 0 20px" }}>
 
        {/* Add form */}
        {showAdd && (
          <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'18px 20px', marginBottom:'14px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
              <span style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>New expense</span>
              <button onClick={() => setShowAdd(false)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
            <div className="form-grid-4">
              <div><label style={lbl}>Date *</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Amount Rs *</label><input type="number" placeholder="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={inp} /></div>
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <label style={lbl}>Category *</label>
                  <span onClick={() => setManagingCats(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingCats ? 'Done' : 'Manage'}</span>
                </div>
                {managingCats ? (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                    {cats.map(c => (
                      <div key={c} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                        <span style={{ fontSize:'12px', color:'#374151' }}>{c}</span>
                        <button onClick={() => deleteCatOption(c)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                      </div>
                    ))}
                    {cats.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                  </div>
                ) : (
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inp}>
                    {cats.map(c => <option key={c}>{c}</option>)}
                    <option value="__add__">+ Add new...</option>
                  </select>
                )}
                {form.category === '__add__' && !managingCats && (
                  <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                    <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category" style={{ ...inp, flex:1 }}
                      onKeyDown={e => { if (e.key === 'Enter') addCatOption(newCat) }} autoFocus />
                    <button onClick={() => addCatOption(newCat)}
                      style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                    <button onClick={() => { setNewCat(''); setForm(f => ({ ...f, category: cats[0] })) }}
                      style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                  </div>
                )}
              </div>
              <div><label style={lbl}>Description *</label><input type="text" placeholder="What was this for?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button onClick={handleAdd} disabled={saving} style={{ padding:'9px 22px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:saving?0.7:1 }}>{saving ? 'Saving…' : 'Save expense'}</button>
              <button onClick={() => setShowAdd(false)} style={{ padding:'9px 18px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
 
        {/* Table */}
        <div style={{ flex:1, overflowX:'auto', overflowY:'auto', WebkitOverflowScrolling:'touch', borderTop:'1px solid #e5e7eb', background:'#ffffff' }}>
          {loading ? <div style={{ padding:'40px', textAlign:'center', color:'#9ca3af', fontSize:'13px' }}>Loading…</div> : (
              <table className="alt-table" style={{ width:'100%', borderCollapse:'collapse', minWidth:'560px' }}>
                <thead>
                  <tr style={{ borderBottom:'1px solid #e5e7eb', background:'#f9fafb' }}>
                    {['Date','Description','Category','Amount',''].map(h => (
                      <th key={h} style={{ padding:'11px 16px', textAlign:'left', fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0
                    ? <tr><td colSpan={5} style={{ padding:'32px', textAlign:'center', fontSize:'12px', color:'#9ca3af' }}>No expenses yet.</td></tr>
                    : displayed.map(r => (
                      <tr key={r.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                        <td style={{ padding:'13px 16px', fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap' }}>{fmtDate(r.date)}</td>
                        <td style={{ padding:'13px 16px', fontSize:'13px', color:'#111111' }}>{r.description}</td>
                        <td style={{ padding:'13px 16px' }}><span style={{ fontSize:'12px', background:'#f3f4f6', color:'#6b7280', padding:'4px 10px', borderRadius:'20px', whiteSpace:'nowrap' }}>{r.category}</span></td>
                        <td style={{ padding:'13px 16px', fontSize:'13px', fontWeight:500, color:'#991b1b', whiteSpace:'nowrap' }}>{fmt(r.amount)}</td>
                        <td style={{ padding:'13px 16px' }}>
                          <div style={{ display:'flex', gap:'6px', justifyContent:'flex-end' }}>
                            <button onClick={() => openEdit(r)} style={{ padding:'6px 14px', background:'#dbeafe', color:'#1e40af', border:'1px solid #93c5fd', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Edit</button>
                            <button onClick={() => deleteRecord(r.id)} style={{ padding:'6px 14px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
          )}
        </div>
 
      {/* Edit panel */}
      {editRecord && (
        <>
          <div onClick={() => setEditRecord(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.2)', zIndex:40 }} />
          <div className="side-panel" style={{ width:'320px' }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid #e5e7eb', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>Edit expense</div>
              <button onClick={() => setEditRecord(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'20px', color:'#9ca3af', lineHeight:1, padding:0 }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'16px 18px' }}>
              <div style={{ marginBottom:'12px' }}><label style={lbl}>Date</label><input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} style={inp} /></div>
              <div style={{ marginBottom:'12px' }}><label style={lbl}>Amount Rs</label><input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} style={inp} /></div>
              <div style={{ marginBottom:'12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <label style={lbl}>Category</label>
                  <span onClick={() => setManagingCats(v => !v)} style={{ fontSize:'10px', color:'#6b7280', cursor:'pointer', textDecoration:'underline', marginBottom:'4px' }}>{managingCats ? 'Done' : 'Manage'}</span>
                </div>
                {managingCats ? (
                  <div style={{ border:'1px solid #e5e7eb', borderRadius:'8px', padding:'6px', maxHeight:'130px', overflowY:'auto' }}>
                    {cats.map(c => (
                      <div key={c} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 6px', borderRadius:'4px' }}>
                        <span style={{ fontSize:'12px', color:'#374151' }}>{c}</span>
                        <button onClick={() => deleteCatOption(c)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:'16px', lineHeight:1, padding:'0 2px' }}>×</button>
                      </div>
                    ))}
                    {cats.length === 0 && <div style={{ fontSize:'11px', color:'#9ca3af', padding:'4px 6px' }}>No items yet</div>}
                  </div>
                ) : (
                  <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} style={inp}>
                    {cats.map(c => <option key={c}>{c}</option>)}
                    <option value="__add__">+ Add new...</option>
                  </select>
                )}
                {editForm.category === '__add__' && !managingCats && (
                  <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                    <input value={newEditCat} onChange={e => setNewEditCat(e.target.value)} placeholder="New category" style={{ ...inp, flex:1 }}
                      onKeyDown={e => { if (e.key === 'Enter') addCatOption(newEditCat, true) }} autoFocus />
                    <button onClick={() => addCatOption(newEditCat, true)}
                      style={{ padding:'6px 12px', background:'#17341e', color:'#fff', border:'none', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>Add</button>
                    <button onClick={() => { setNewEditCat(''); setEditForm(f => ({ ...f, category: cats[0] })) }}
                      style={{ padding:'6px 10px', background:'#fff', color:'#6b7280', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', cursor:'pointer' }}>x</button>
                  </div>
                )}
              </div>
              <div style={{ marginBottom:'12px' }}><label style={lbl}>Description</label><input type="text" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ padding:'12px 18px', borderTop:'1px solid #e5e7eb', display:'flex', gap:'8px', flexShrink:0 }}>
              <button onClick={saveEdit} disabled={saving} style={{ flex:1, padding:'9px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:saving?0.7:1 }}>{saving ? 'Saving…' : 'Save changes'}</button>
              <button onClick={() => setEditRecord(null)} style={{ padding:'9px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Cancel</button>
              <button onClick={() => deleteRecord(editRecord.id)} style={{ padding:'9px 14px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Delete</button>
            </div>
          </div>
        </>
      )}
 
      {toast && <div style={{ position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#17341e', color:'#ffffff', fontSize:'12px', fontWeight:500, padding:'8px 20px', borderRadius:'20px', zIndex:60 }}>{toast}</div>}
    </div>
  )
}
 
export default Expenses