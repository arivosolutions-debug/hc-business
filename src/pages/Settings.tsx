import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCEmployee, HCProfile, HCSubscriber } from '../lib/supabase'
import { Eye, EyeOff } from 'lucide-react'
 
const SUPABASE_URL = 'https://zecuxurmuydzlxsxasxq.supabase.co'
 
const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
 
const PERM_LABELS = [
  { key:'dashboard', label:'Dashboard' },
  { key:'enquiries', label:'Enquiries' },
  { key:'income',    label:'Income' },
  { key:'calendar',  label:'Calendar' },
  { key:'customers', label:'Customers' },
  { key:'expenses',  label:'Expenses' },
]
 
const DEFAULT_PERMS = {
  dashboard: false, enquiries: true, income: true,
  calendar: true, customers: false, expenses: false,
}
 
const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; label: string }> = ({ value, onChange, label }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f9fafb' }}>
    <span style={{ fontSize:'13px', color:'#374151' }}>{label}</span>
    <div onClick={() => onChange(!value)}
      style={{ width:'40px', height:'22px', borderRadius:'11px', cursor:'pointer', position:'relative', flexShrink:0, background: value ? '#17341e' : '#d1d5db', transition:'background 0.2s' }}>
      <div style={{ position:'absolute', top:'3px', left: value ? '21px' : '3px', width:'16px', height:'16px', borderRadius:'50%', background:'#ffffff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  </div>
)
 
export const Settings: React.FC = () => {
  const { user, tenantId, profile, isOwner, refreshProfile } = useAuth()
  const isSuperAdmin = !!(profile as HCProfile & { is_super_admin?: boolean })?.is_super_admin
  const [section, setSection] = useState('business')
  const [toast, setToast] = useState('')
 
  const SECTIONS = [
    { id:'business',   label:'Business profile' },
    { id:'employees',  label:'Employees' },
    ...(isSuperAdmin ? [{ id:'onboarding', label:'Onboarding' }] : []),
  ]
 
  // Business profile state
  const [biz, setBiz] = useState({ business_name:'', owner_name:'', phone:'', address:'', gst_number:'' })
  const [savingBiz, setSavingBiz] = useState(false)
 
  // Employee state
  const [employees, setEmployees] = useState<HCEmployee[]>([])
  const [showAddEmp, setShowAddEmp] = useState(false)
  const [empForm, setEmpForm] = useState({ name:'', email:'', password:'', role:'' })
  const [empPerms, setEmpPerms] = useState({ ...DEFAULT_PERMS })
  const [savingEmp, setSavingEmp] = useState(false)
  const [editEmpId, setEditEmpId] = useState<string | null>(null)
  const [editEmpPerms, setEditEmpPerms] = useState<Record<string, boolean>>({})
  const [savingEmpPerms, setSavingEmpPerms] = useState(false)
 
  // Subscriber (onboarding) state
  const [subscribers, setSubscribers] = useState<HCSubscriber[]>([])
  const [showAddSub, setShowAddSub] = useState(false)
  const [subForm, setSubForm] = useState({ business_name:'', owner_name:'', phone:'', email:'', password:'' })
  const [showSubPw, setShowSubPw] = useState(false)
  const [savingSub, setSavingSub] = useState(false)
  const [createdSub, setCreatedSub] = useState<{ email: string; password: string } | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
 
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2800) }
 
  const load = useCallback(async () => {
    if (!user || !tenantId) return
    const { data } = await supabase.from('hc_employees').select('*').eq('tenant_id', tenantId)
    setEmployees((data as HCEmployee[]) || [])
  }, [user, tenantId])
 
  const loadSubscribers = useCallback(async () => {
    if (!isSuperAdmin) return
    const { data } = await supabase
      .from('hc_subscribers')
      .select('*')
      .order('created_at', { ascending: false })
    setSubscribers((data as HCSubscriber[]) || [])
  }, [isSuperAdmin])
 
  useEffect(() => {
    if (profile) setBiz({
      business_name: profile.business_name || '',
      owner_name:    profile.owner_name    || '',
      phone:         profile.phone         || '',
      address:       profile.address       || '',
      gst_number:    profile.gst_number    || '',
    })
    load()
  }, [profile, load])
 
  useEffect(() => {
    if (section === 'onboarding') loadSubscribers()
  }, [section, loadSubscribers])
 
  const saveBiz = async () => {
    if (!tenantId) return
    setSavingBiz(true)
    await supabase.from('hc_profiles').update({ ...biz }).eq('id', tenantId)
    await refreshProfile()
    setSavingBiz(false)
    showToast('Profile saved')
  }
 
  const createEmployee = async () => {
    if (!user || !tenantId || !empForm.name || !empForm.email || !empForm.password) {
      showToast('Name, email and password are required')
      return
    }
    setSavingEmp(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ email: empForm.email, password: empForm.password, name: empForm.name, role: empForm.role || 'Staff', tenant_id: tenantId, permissions: empPerms }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      setSavingEmp(false)
      setEmpForm({ name:'', email:'', password:'', role:'' })
      setEmpPerms({ ...DEFAULT_PERMS })
      setShowAddEmp(false)
      load()
      showToast(empForm.name + ' account created')
    } catch (err: unknown) {
      setSavingEmp(false)
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }
 
  const toggleEmployee = async (emp: HCEmployee) => {
    await supabase.from('hc_employees').update({ is_active: !emp.is_active }).eq('id', emp.id)
    load()
    showToast(emp.is_active ? emp.name + ' deactivated' : emp.name + ' activated')
  }
 
  const openEditPerms = (emp: HCEmployee) => {
    setEditEmpId(emp.id)
    setEditEmpPerms({ ...DEFAULT_PERMS, ...(emp.permissions as Record<string, boolean> || {}) })
  }
 
  const saveEmpPerms = async (empId: string) => {
    setSavingEmpPerms(true)
    await supabase.from('hc_employees').update({ permissions: editEmpPerms }).eq('id', empId)
    setSavingEmpPerms(false)
    setEditEmpId(null)
    load()
    showToast('Permissions updated')
  }
 
  const createSubscriber = async () => {
    if (!subForm.business_name || !subForm.email || !subForm.password) {
      showToast('Business name, email and password are required')
      return
    }
    setSavingSub(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-subscriber`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify(subForm),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      setCreatedSub({ email: subForm.email, password: subForm.password })
      setSubForm({ business_name:'', owner_name:'', phone:'', email:'', password:'' })
      setShowAddSub(false)
      loadSubscribers()
      showToast(subForm.business_name + ' onboarded successfully')
    } catch (err: unknown) {
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSavingSub(false)
    }
  }
 
  const toggleSubscriber = async (sub: HCSubscriber) => {
    setTogglingId(sub.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const action = sub.is_active === false ? 'unban' : 'ban'
      const res = await fetch(`${SUPABASE_URL}/functions/v1/toggle-subscriber`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: sub.auth_user_id, action }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      loadSubscribers()
      showToast(action === 'ban' ? (sub.business_name || 'Subscriber') + ' deactivated' : (sub.business_name || 'Subscriber') + ' activated')
    } catch (err: unknown) {
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setTogglingId(null)
    }
  }
 
  const renderBusiness = () => (
    <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
      <div style={{ fontSize:'14px', fontWeight:500, color:'#111111', marginBottom:'3px' }}>Business profile</div>
      <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'18px' }}>Appears on all receipts and documents.</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
        {(['business_name','owner_name','phone','gst_number'] as const).map(k => (
          <div key={k}>
            <label style={lbl}>{k === 'business_name' ? 'Business name' : k === 'owner_name' ? 'Owner name' : k === 'phone' ? 'Phone' : 'GST number'}</label>
            <input value={biz[k]} onChange={e => setBiz(b => ({ ...b, [k]: e.target.value }))} style={inp} />
          </div>
        ))}
        <div style={{ gridColumn:'span 2' }}>
          <label style={lbl}>Address</label>
          <input value={biz.address} onChange={e => setBiz(b => ({ ...b, address: e.target.value }))} style={inp} />
        </div>
      </div>
      <div style={{ marginBottom:'18px' }}>
        <label style={lbl}>Logo</label>
        <div style={{ border:'1.5px dashed #e5e7eb', borderRadius:'8px', padding:'20px', textAlign:'center', background:'#fafafa' }}>
          <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'8px' }}>Upload your logo — appears on all receipts</div>
          <button style={{ padding:'7px 16px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>Choose file</button>
        </div>
      </div>
      <button onClick={saveBiz} disabled={savingBiz}
        style={{ padding:'9px 22px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingBiz?0.7:1 }}>
        {savingBiz ? 'Saving...' : 'Save profile'}
      </button>
    </div>
  )
 
  const renderEmployees = () => (
    <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'3px' }}>
        <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>Employees</div>
        <button onClick={() => setShowAddEmp(v => !v)}
          style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
          + Add employee
        </button>
      </div>
      <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'18px' }}>Control what each employee can see and do.</div>
 
      {showAddEmp && (
        <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'9px', padding:'16px 18px', marginBottom:'16px' }}>
          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'12px' }}>New employee</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'12px' }}>
            <div><label style={lbl}>Name *</label><input placeholder="Full name" value={empForm.name} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>Email *</label><input type="email" placeholder="email@..." value={empForm.email} onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>Password *</label><input type="password" placeholder="Min 6 characters" value={empForm.password} onChange={e => setEmpForm(f => ({ ...f, password: e.target.value }))} style={inp} /></div>
            <div><label style={lbl}>Role</label><input placeholder="e.g. Manager, Receptionist" value={empForm.role} onChange={e => setEmpForm(f => ({ ...f, role: e.target.value }))} style={inp} /></div>
          </div>
          <div style={{ marginBottom:'14px' }}>
            <div style={{ fontSize:'11px', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px' }}>Section access</div>
            <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'4px 14px' }}>
              {PERM_LABELS.map(p => (
                <Toggle key={p.key} label={p.label} value={empPerms[p.key as keyof typeof empPerms]} onChange={v => setEmpPerms(prev => ({ ...prev, [p.key]: v }))} />
              ))}
            </div>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={createEmployee} disabled={savingEmp}
              style={{ padding:'8px 20px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingEmp?0.7:1 }}>
              {savingEmp ? 'Creating...' : 'Create account'}
            </button>
            <button onClick={() => setShowAddEmp(false)}
              style={{ padding:'8px 16px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
 
      <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
        {employees.length === 0 && (
          <div style={{ fontSize:'12px', color:'#9ca3af', textAlign:'center', padding:'20px' }}>No employees added yet.</div>
        )}
        {employees.map(e => {
          const perms = { ...DEFAULT_PERMS, ...(e.permissions as Record<string, boolean> || {}) }
          const isEditingPerms = editEmpId === e.id
          return (
            <div key={e.id} style={{ border:'1px solid #f3f4f6', borderRadius:'10px', background:'#fafafa', padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'12px' }}>
                <div style={{ width:'38px', height:'38px', borderRadius:'50%', background: e.is_active ? '#17341e' : '#e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'15px', fontWeight:500, color: e.is_active ? '#ffffff' : '#9ca3af', flexShrink:0 }}>
                  {e.name[0].toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'13px', fontWeight:500, color: e.is_active ? '#111111' : '#9ca3af' }}>{e.name}</div>
                  <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>{e.email}</div>
                  {e.role_label && <div style={{ fontSize:'11px', color:'#6b7280', marginTop:'1px' }}>{e.role_label}</div>}
                </div>
                <span style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:500, background: e.is_active ? '#dcfce7' : '#f3f4f6', color: e.is_active ? '#166534' : '#9ca3af' }}>
                  {e.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
 
              <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'8px', padding:'4px 14px', marginBottom:'12px' }}>
                <div style={{ fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.07em', padding:'8px 0 4px' }}>Section access</div>
                {PERM_LABELS.map(p => (
                  isEditingPerms
                    ? <Toggle key={p.key} label={p.label} value={editEmpPerms[p.key] ?? false} onChange={v => setEditEmpPerms(prev => ({ ...prev, [p.key]: v }))} />
                    : (
                      <div key={p.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f9fafb' }}>
                        <span style={{ fontSize:'13px', color:'#374151' }}>{p.label}</span>
                        <span style={{ fontSize:'11px', fontWeight:500, color: perms[p.key as keyof typeof perms] ? '#166534' : '#9ca3af' }}>
                          {perms[p.key as keyof typeof perms] ? 'On' : 'Off'}
                        </span>
                      </div>
                    )
                ))}
              </div>
 
              <div style={{ display:'flex', gap:'8px' }}>
                {isEditingPerms ? (
                  <>
                    <button onClick={() => saveEmpPerms(e.id)} disabled={savingEmpPerms}
                      style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingEmpPerms?0.7:1 }}>
                      {savingEmpPerms ? 'Saving...' : 'Save permissions'}
                    </button>
                    <button onClick={() => setEditEmpId(null)}
                      style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => openEditPerms(e)}
                      style={{ padding:'7px 16px', background:'#dbeafe', color:'#1e40af', border:'1px solid #93c5fd', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                      Edit access
                    </button>
                    <button onClick={() => toggleEmployee(e)}
                      style={{ padding:'7px 16px', background: e.is_active ? '#fee2e2' : '#dcfce7', color: e.is_active ? '#991b1b' : '#166534', border:`1px solid ${e.is_active ? '#fca5a5' : '#86efac'}`, borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                      {e.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
 
  const renderOnboarding = () => (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'3px' }}>
          <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>New subscriber</div>
          <button onClick={() => { setShowAddSub(v => !v); setCreatedSub(null) }}
            style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
            {showAddSub ? 'Cancel' : '+ Add subscriber'}
          </button>
        </div>
        <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom: showAddSub ? '18px' : 0 }}>Create a new HC Business account for a subscriber.</div>
 
        {showAddSub && (
          <div style={{ marginTop:'16px' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'12px' }}>
              <div><label style={lbl}>Business name *</label><input placeholder="e.g. Suelo Tribe" value={subForm.business_name} onChange={e => setSubForm(f => ({ ...f, business_name: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Owner name</label><input placeholder="Owner's full name" value={subForm.owner_name} onChange={e => setSubForm(f => ({ ...f, owner_name: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Phone</label><input placeholder="+91 98470 00000" value={subForm.phone} onChange={e => setSubForm(f => ({ ...f, phone: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Email *</label><input type="email" placeholder="owner@business.com" value={subForm.email} onChange={e => setSubForm(f => ({ ...f, email: e.target.value }))} style={inp} /></div>
              <div style={{ gridColumn:'span 2' }}>
                <label style={lbl}>Password *</label>
                <div style={{ position:'relative' }}>
                  <input
                    type={showSubPw ? 'text' : 'password'}
                    placeholder="Min 6 characters"
                    value={subForm.password}
                    onChange={e => setSubForm(f => ({ ...f, password: e.target.value }))}
                    style={{ ...inp, paddingRight:'40px' }}
                  />
                  <button type="button" onClick={() => setShowSubPw(v => !v)}
                    style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', display:'flex', alignItems:'center' }}>
                    {showSubPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <button onClick={createSubscriber} disabled={savingSub}
              style={{ padding:'9px 24px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingSub?0.7:1 }}>
              {savingSub ? 'Creating account...' : 'Create account'}
            </button>
          </div>
        )}
 
        {createdSub && (
          <div style={{ marginTop:'16px', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:'9px', padding:'16px 18px' }}>
            <div style={{ fontSize:'13px', fontWeight:500, color:'#166534', marginBottom:'10px' }}>✓ Account created — share these credentials</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
              <div>
                <div style={{ fontSize:'10px', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }}>Email</div>
                <div style={{ fontSize:'13px', color:'#111111', fontWeight:500, background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'6px', padding:'7px 10px', userSelect:'all' }}>{createdSub.email}</div>
              </div>
              <div>
                <div style={{ fontSize:'10px', fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }}>Password</div>
                <div style={{ fontSize:'13px', color:'#111111', fontWeight:500, background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'6px', padding:'7px 10px', userSelect:'all' }}>{createdSub.password}</div>
              </div>
            </div>
            <div style={{ fontSize:'11px', color:'#6b7280', marginTop:'10px' }}>Send these via WhatsApp. They can log in at the HC Business URL.</div>
          </div>
        )}
      </div>
 
      <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
        <div style={{ fontSize:'14px', fontWeight:500, color:'#111111', marginBottom:'3px' }}>Subscribers</div>
        <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'16px' }}>All onboarded businesses.</div>
        {subscribers.length === 0 ? (
          <div style={{ fontSize:'12px', color:'#9ca3af', textAlign:'center', padding:'20px' }}>No subscribers yet.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            {subscribers.map(sub => {
              const isActive = sub.is_active !== false
              const isToggling = togglingId === sub.id
              return (
                <div key={sub.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'12px 14px', border:'1px solid #f3f4f6', borderRadius:'10px', background:'#fafafa' }}>
                  <div style={{ width:'38px', height:'38px', borderRadius:'50%', background: isActive ? '#17341e' : '#e5e7eb', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'15px', fontWeight:500, color: isActive ? '#ffffff' : '#9ca3af', flexShrink:0 }}>
                    {(sub.business_name || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:'13px', fontWeight:500, color: isActive ? '#111111' : '#9ca3af' }}>{sub.business_name || '—'}</div>
                    <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>{sub.owner_name || ''}</div>
                    <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>
                      {sub.created_at ? new Date(sub.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : ''}
                    </div>
                  </div>
                  <span style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:500, background: isActive ? '#dcfce7' : '#f3f4f6', color: isActive ? '#166534' : '#9ca3af', flexShrink:0 }}>
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => toggleSubscriber(sub)} disabled={isToggling}
                    style={{ padding:'7px 14px', background: isActive ? '#fee2e2' : '#dcfce7', color: isActive ? '#991b1b' : '#166534', border:`1px solid ${isActive ? '#fca5a5' : '#86efac'}`, borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:isToggling?0.6:1, flexShrink:0 }}>
                    {isToggling ? '...' : isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
 
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>
      <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', padding:'0 22px', height:'52px', display:'flex', alignItems:'center', flexShrink:0 }}>
        <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Settings</span>
      </div>
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        <div style={{ width:'180px', background:'#f9fafb', borderRight:'1px solid #e5e7eb', flexShrink:0, padding:'14px 8px' }}>
          <div style={{ fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.08em', padding:'0 8px', marginBottom:'8px' }}>Settings</div>
          {SECTIONS.map(s => (
            <div key={s.id} onClick={() => setSection(s.id)}
              style={{ padding:'8px 10px', borderRadius:'8px', marginBottom:'2px', cursor:'pointer', fontSize:'12px', fontWeight: s.id === section ? 500 : 400, background: s.id === section ? '#ffffff' : 'transparent', color: s.id === section ? '#111111' : '#6b7280', border: s.id === section ? '1px solid #e5e7eb' : '1px solid transparent' }}>
              {s.label}
            </div>
          ))}
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'18px 20px' }}>
          {section === 'business'   && renderBusiness()}
          {section === 'employees'  && renderEmployees()}
          {section === 'onboarding' && isSuperAdmin && renderOnboarding()}
        </div>
      </div>
      {toast && (
        <div style={{ position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#17341e', color:'#ffffff', fontSize:'12px', fontWeight:500, padding:'8px 20px', borderRadius:'20px', zIndex:60 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
 
export default Settings