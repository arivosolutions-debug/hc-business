import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCCustomer, HCEnquiry, fmtDate, logActivity, getActor } from '../lib/supabase'
 
const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  new:        { label:'New',         bg:'#dbeafe', color:'#1e40af' },
  contacted:  { label:'Contacted',   bg:'#fef9c3', color:'#854f0b' },
  booked:     { label:'Booked',      bg:'#dcfce7', color:'#166534' },
  completed:  { label:'Completed',   bg:'#d1fae5', color:'#065f46' },
  noresponse: { label:'No response', bg:'#f3f4f6', color:'#6b7280' },
  cancelled:  { label:'Cancelled',   bg:'#fee2e2', color:'#991b1b' },
}
 
const rupee = (n: number | null | undefined) => n ? '₹' + Math.round(n).toLocaleString('en-IN') : '—'
 
export const CustomersPage: React.FC = () => {
  const { user, tenantId, isOwner, profile, employee } = useAuth()
  const [customers, setCustomers] = useState<HCCustomer[]>([])
  const [enquiries, setEnquiries] = useState<HCEnquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [editingCustomer, setEditingCustomer] = useState<HCCustomer | null>(null)
  const [editForm, setEditForm] = useState({ name: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }
 
  const load = useCallback(async () => {
    if (!user) return
    const [{ data: custs }, { data: enqs }] = await Promise.all([
      supabase.from('hc_customers').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('hc_enquiries').select('*').eq('tenant_id', tenantId).order('enquiry_date', { ascending: false }),
    ])
    setCustomers((custs as HCCustomer[]) || [])
    setEnquiries((enqs as HCEnquiry[]) || [])
    setLoading(false)
  }, [user])
 
  useEffect(() => { load() }, [load])
 
  const deleteCustomer = async (c: HCCustomer) => {
    const msg = 'Delete customer "' + c.name + '"? This cannot be undone.'
    if (!window.confirm(msg)) return
    await supabase.from('hc_customers').delete().eq('id', c.id)
    if (user && tenantId) {
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'customer_deleted', entityType: 'customer', entityId: c.id,
        description: `${actor.actorName} deleted the customer profile for ${c.name}`,
      })
    }
    load()
  }

  // ── Open edit modal ─────────────────────────────────────
  const openEdit = (c: HCCustomer) => {
    setEditingCustomer(c)
    setEditForm({ name: c.name, phone: c.phone || '', email: c.email || '' })
  }

  // ── Save customer edit — cascades to linked enquiries (and Income, which reads via the enquiry join) ─
  const saveEdit = async () => {
    if (!editingCustomer) return
    const name = editForm.name.trim()
    if (!name) { showToast('Name cannot be empty'); return }
    const phone = editForm.phone.trim() || null
    const email = editForm.email.trim() || null

    setSaving(true)
    const now = new Date().toISOString()

    await supabase.from('hc_customers')
      .update({ name, phone, email, updated_at: now })
      .eq('id', editingCustomer.id)

    const { data: linked } = await supabase
      .from('hc_enquiries')
      .update({ name, phone, email, updated_at: now })
      .eq('customer_id', editingCustomer.id)
      .select('id')

    if (user && tenantId) {
      const actor = getActor({ userId: user.id, isOwner, employeeName: employee?.name, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'customer_edited', entityType: 'customer', entityId: editingCustomer.id,
        description: `${actor.actorName} edited customer ${editingCustomer.name}${name !== editingCustomer.name ? ` (renamed to ${name})` : ''}`,
      })
    }

    setSaving(false)
    setEditingCustomer(null)
    showToast(`Customer updated · ${linked?.length || 0} enquir${linked?.length === 1 ? 'y' : 'ies'} synced`)
    load()
  }

  // Get all enquiries for a customer — match by customer_id or phone number
  const getEnquiries = (c: HCCustomer) => {
    return enquiries.filter(e =>
      e.customer_id === c.id ||
      (c.phone && e.phone && e.phone === c.phone)
    ).sort((a, b) => (b.enquiry_date || b.created_at).localeCompare(a.enquiry_date || a.created_at))
  }
 
  const filtered = customers
    .filter(c => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.email || '').toLowerCase().includes(q)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
 
      {/* Topbar */}
      <div className="topbar">
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Customers</span>
          <span style={{ fontSize:'12px', color:'#9ca3af' }}>{customers.length} total</span>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or phone..."
          className="cust-search" style={{ padding:'7px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none' }}
        />
      </div>
 
      {/* Info bar */}
      <div style={{ background:'#f9fafb', borderBottom:'1px solid #f3f4f6', padding:'8px 22px' }}>
        <span style={{ fontSize:'11px', color:'#9ca3af' }}>
          Customer profiles are created automatically when enquiries are added. Click any customer to see their booking history.
        </span>
      </div>
 
      {/* Content */}
      <div className="page-content">
        {loading ? (
          <div style={{ padding:'40px', textAlign:'center', fontSize:'13px', color:'#9ca3af' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:'40px', textAlign:'center', fontSize:'13px', color:'#9ca3af' }}>
            {search ? 'No customers match your search.' : 'No customers yet. They will appear automatically when enquiries are added.'}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {filtered.map(c => {
              const cEnqs = getEnquiries(c)
              const isExpanded = expanded === c.id
              const totalSpend = cEnqs.filter(e => e.status !== 'cancelled').reduce((s, e) => s + (e.total_price || 0), 0)
              const lastEnq = cEnqs[0]
 
              return (
                <div key={c.id} style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', overflow:'hidden' }}>
 
                  {/* Customer header row */}
                  <div
                    onClick={() => setExpanded(isExpanded ? null : c.id)}
                    style={{ padding:'14px 18px', cursor:'pointer' }}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                      {/* Avatar */}
                      <div style={{ width:'36px', height:'36px', borderRadius:'50%', background:'#17341e', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', fontWeight:500, color:'#ffffff', flexShrink:0 }}>
                        {c.name[0].toUpperCase()}
                      </div>
                      {/* Info */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>{c.name}</div>
                        <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {c.phone || '—'}{c.email ? ` · ${c.email}` : ''}
                        </div>
                      </div>
                      {/* Actions */}
                      <button
                        onClick={e => { e.stopPropagation(); openEdit(c) }}
                        style={{ padding:'4px 10px', background:'#dbeafe', color:'#1e40af', border:'1px solid #93c5fd', borderRadius:'6px', fontSize:'10px', fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                        Edit
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteCustomer(c) }}
                        style={{ padding:'4px 10px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'6px', fontSize:'10px', fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                        Delete
                      </button>
                      <div style={{ fontSize:'16px', color:'#9ca3af', flexShrink:0 }}>
                        {isExpanded ? '▲' : '▼'}
                      </div>
                    </div>
                    {/* Stats row */}
                    <div style={{ display:'flex', gap:'16px', marginTop:'8px', marginLeft:'48px', flexWrap:'wrap' }}>
                      <span style={{ fontSize:'11px', color:'#6b7280' }}>
                        <strong style={{ color:'#111111' }}>{cEnqs.length}</strong> booking{cEnqs.length !== 1 ? 's' : ''}
                      </span>
                      {totalSpend > 0 && (
                        <span style={{ fontSize:'11px', color:'#6b7280' }}>
                          <strong style={{ color:'#17341e' }}>{rupee(totalSpend)}</strong> total
                        </span>
                      )}
                      {lastEnq && (
                        <span style={{ fontSize:'11px', color:'#9ca3af' }}>
                          Last: {lastEnq.enquiry_date ? new Date(lastEnq.enquiry_date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : fmtDate(lastEnq.created_at)}
                        </span>
                      )}
                    </div>
                  </div>
 
                  {/* Expanded booking history */}
                  {isExpanded && (
                    <div style={{ borderTop:'1px solid #f3f4f6', background:'#f9fafb' }}>
                      {cEnqs.length === 0 ? (
                        <div style={{ padding:'16px 18px', fontSize:'12px', color:'#9ca3af' }}>No bookings yet.</div>
                      ) : (
                        <div className="table-wrap">
                          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'600px' }}>
                            <thead>
                              <tr style={{ borderBottom:'1px solid #e5e7eb' }}>
                                {['Enquiry date','Interest','Check-in','Check-out','Guests','Total','Paid','Status'].map(h => (
                                  <th key={h} style={{ padding:'8px 18px', textAlign:'left', fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {cEnqs.map(e => (
                                <tr key={e.id} style={{ borderBottom:'1px solid #f3f4f6' }}>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', color:'#9ca3af', whiteSpace:'nowrap' }}>
                                    {e.enquiry_date ? new Date(e.enquiry_date + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : fmtDate(e.created_at)}
                                  </td>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', color:'#374151' }}>{e.interest || '—'}</td>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', color:'#111111', whiteSpace:'nowrap' }}>
                                    {e.check_in ? new Date(e.check_in + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}
                                  </td>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', color:'#111111', whiteSpace:'nowrap' }}>
                                    {e.check_out ? new Date(e.check_out + 'T12:00:00').toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}
                                  </td>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', color:'#6b7280', textAlign:'center' }}>{e.guests}</td>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', fontWeight:500, color:'#111111', whiteSpace:'nowrap' }}>{e.total_price ? rupee(e.total_price) : '—'}</td>
                                  <td style={{ padding:'10px 18px', fontSize:'12px', color:'#166534', whiteSpace:'nowrap' }}>{e.amount_paid ? rupee(e.amount_paid) : '—'}</td>
                                  <td style={{ padding:'10px 18px' }}>
                                    {(() => {
                                      const s = STATUS[e.status] || { label: e.status, bg:'#f3f4f6', color:'#6b7280' }
                                      return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:'20px', fontSize:'11px', fontWeight:500, background:s.bg, color:s.color }}>{s.label}</span>
                                    })()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit customer modal */}
      {editingCustomer && (
        <>
          <div onClick={() => !saving && setEditingCustomer(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:60 }} />
          <div className="modal" style={{ padding:'24px', width:'380px', maxWidth:'92vw' }}>
            <div style={{ fontSize:'15px', fontWeight:600, color:'#111111', marginBottom:'4px' }}>Edit customer</div>
            <div style={{ fontSize:'11px', color:'#9ca3af', marginBottom:'18px' }}>
              Changes will also update all enquiries linked to this customer, and Income records will reflect them automatically.
            </div>

            <label style={{ fontSize:'11px', fontWeight:500, color:'#6b7280', display:'block', marginBottom:'5px' }}>Name</label>
            <input
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              style={{ width:'100%', padding:'9px 11px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', color:'#111111', outline:'none', marginBottom:'14px' }}
            />

            <label style={{ fontSize:'11px', fontWeight:500, color:'#6b7280', display:'block', marginBottom:'5px' }}>Phone</label>
            <input
              value={editForm.phone}
              onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
              style={{ width:'100%', padding:'9px 11px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', color:'#111111', outline:'none', marginBottom:'14px' }}
            />

            <label style={{ fontSize:'11px', fontWeight:500, color:'#6b7280', display:'block', marginBottom:'5px' }}>Email</label>
            <input
              value={editForm.email}
              onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
              style={{ width:'100%', padding:'9px 11px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', color:'#111111', outline:'none', marginBottom:'20px' }}
            />

            <div style={{ display:'flex', gap:'8px' }}>
              <button
                disabled={saving}
                onClick={saveEdit}
                style={{ flex:1, padding:'10px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                disabled={saving}
                onClick={() => setEditingCustomer(null)}
                style={{ padding:'10px 16px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#17341e', color:'#ffffff', fontSize:'12px', fontWeight:500, padding:'8px 20px', borderRadius:'20px', zIndex:80, whiteSpace:'nowrap' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
 
export default CustomersPage