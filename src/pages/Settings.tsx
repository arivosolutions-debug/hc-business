import React, { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase, HCEmployee, HCProfile, HCSubscriber, HCInventory, HCActivityLog, fmtDate, logActivity, getActor } from '../lib/supabase'
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
    { id:'inventory',  label:'Property / Stay' },
    { id:'employees',  label:'Employees' },
    ...(isOwner ? [{ id:'activity', label:'Activity log' }] : []),
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
 
  // Inventory state
  const BLANK_INV = { name:'', type:'stay' as 'stay'|'package'|'other', base_price:'', default_margin:'', capacity:'', description:'' }
  const [inventory, setInventory]     = useState<HCInventory[]>([])
  const [showAddInv, setShowAddInv]   = useState(false)
  const [invForm, setInvForm]         = useState(BLANK_INV)
  const [savingInv, setSavingInv]     = useState(false)
  const [editInvId, setEditInvId]     = useState<string | null>(null)
  const [editInvForm, setEditInvForm] = useState(BLANK_INV)
  const [savingEditInv, setSavingEditInv] = useState(false)
 
  // Subscriber (onboarding) state
  const [subscribers, setSubscribers] = useState<HCSubscriber[]>([])
  const [subProfiles, setSubProfiles] = useState<Record<string, boolean>>({})
  const [showAddSub, setShowAddSub] = useState(false)
  const [subForm, setSubForm] = useState({ business_name:'', owner_name:'', phone:'', email:'', password:'', margin_enabled:false })
  const [showSubPw, setShowSubPw] = useState(false)
  const [savingSub, setSavingSub] = useState(false)
  const [createdSub, setCreatedSub] = useState<{ email: string; password: string } | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [editSubId, setEditSubId] = useState<string | null>(null)
  const [editSubForm, setEditSubForm] = useState({ business_name:'', owner_name:'', phone:'', email:'', password:'', margin_enabled:false })
  const [showEditSubPw, setShowEditSubPw] = useState(false)
  const [savingEditSub, setSavingEditSub] = useState(false)
 
  // Employee full edit state
  const [editEmpFullId, setEditEmpFullId] = useState<string | null>(null)
  const [editEmpFullForm, setEditEmpFullForm] = useState({ name:'', email:'', role:'', password:'' })
  const [showEditEmpPw, setShowEditEmpPw] = useState(false)
  const [savingEditEmp, setSavingEditEmp] = useState(false)

  // Activity log state
  const [activityLog, setActivityLog] = useState<HCActivityLog[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityActorFilter, setActivityActorFilter] = useState('')
 
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

    const ids = (data || []).map((s: HCSubscriber) => s.auth_user_id).filter(Boolean)
    if (ids.length > 0) {
      const { data: profs } = await supabase.from('hc_profiles').select('id, margin_enabled').in('id', ids)
      const map: Record<string, boolean> = {}
      ;(profs || []).forEach((p: { id: string; margin_enabled: boolean }) => { map[p.id] = !!p.margin_enabled })
      setSubProfiles(map)
    }
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

  const loadActivityLog = useCallback(async () => {
    if (!tenantId) return
    setLoadingActivity(true)
    const { data } = await supabase.from('hc_activity_log')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(300)
    setActivityLog((data as HCActivityLog[]) || [])
    setLoadingActivity(false)
  }, [tenantId])

  useEffect(() => {
    if (section === 'activity') loadActivityLog()
  }, [section, loadActivityLog])
 
  const saveBiz = async () => {
    if (!tenantId) return
    setSavingBiz(true)
    await supabase.from('hc_profiles').update({ ...biz }).eq('id', tenantId)
    await refreshProfile()
    const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: biz.owner_name || profile?.owner_name })
    logActivity({
      tenantId, ...actor,
      action: 'business_profile_edited', entityType: 'business_profile',
      description: `${actor.actorName} updated the business profile`,
    })
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
      const actor = getActor({ userId: user.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'employee_created', entityType: 'employee',
        description: `${actor.actorName} created an employee account for ${empForm.name} (${empForm.role || 'Staff'})`,
      })
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
    if (tenantId) {
      const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: emp.is_active ? 'employee_deactivated' : 'employee_activated', entityType: 'employee', entityId: emp.id,
        description: `${actor.actorName} ${emp.is_active ? 'deactivated' : 'activated'} ${emp.name}'s account`,
      })
    }
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
    if (tenantId) {
      const empName = employees.find(e => e.id === empId)?.name || 'employee'
      const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'employee_permissions_edited', entityType: 'employee', entityId: empId,
        description: `${actor.actorName} updated page access permissions for ${empName}`,
      })
    }
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
      setSubForm({ business_name:'', owner_name:'', phone:'', email:'', password:'', margin_enabled:false })
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
 
  const openEditSub = (sub: HCSubscriber) => {
    setEditSubId(sub.id)
    setEditSubForm({ business_name: sub.business_name || '', owner_name: sub.owner_name || '', phone: sub.phone || '', email: sub.email || '', password: '', margin_enabled: !!subProfiles[sub.auth_user_id] })
    setShowEditSubPw(false)
  }
 
  const updateSubscriber = async () => {
    if (!editSubId) return
    setSavingEditSub(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-subscriber`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ subscriber_id: editSubId, ...editSubForm }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      setEditSubId(null)
      loadSubscribers()
      showToast('Subscriber updated')
    } catch (err: unknown) {
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSavingEditSub(false)
    }
  }
 
  const openEditEmpFull = (emp: HCEmployee) => {
    setEditEmpFullId(emp.id)
    setEditEmpFullForm({ name: emp.name, email: emp.email, role: emp.role_label || '', password: '' })
    setShowEditEmpPw(false)
  }
 
  const updateEmployee = async () => {
    if (!editEmpFullId) return
    setSavingEditEmp(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${SUPABASE_URL}/functions/v1/update-employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ employee_id: editEmpFullId, ...editEmpFullForm }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      if (tenantId) {
        const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
        logActivity({
          tenantId, ...actor,
          action: 'employee_edited', entityType: 'employee', entityId: editEmpFullId,
          description: `${actor.actorName} edited employee ${editEmpFullForm.name}'s account details`,
        })
      }
      setEditEmpFullId(null)
      load()
      showToast('Employee updated')
    } catch (err: unknown) {
      showToast('Error: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setSavingEditEmp(false)
    }
  }
 
 
  // ── Inventory functions ──────────────────────────────────
  const loadInventory = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase.from('hc_inventory').select('*').eq('tenant_id', tenantId).order('sort_order')
    setInventory((data as HCInventory[]) || [])
  }, [tenantId])
 
  useEffect(() => {
    if (section === 'inventory') loadInventory()
  }, [section, loadInventory])
 
  const saveInventory = async () => {
    if (!invForm.name.trim() || !tenantId) { showToast('Name is required'); return }
    setSavingInv(true)
    const { error } = await supabase.from('hc_inventory').insert({
      tenant_id: tenantId,
      name: invForm.name.trim(),
      type: invForm.type,
      base_price: invForm.base_price ? parseFloat(invForm.base_price) : null,
      default_margin: invForm.default_margin ? parseFloat(invForm.default_margin) : null,
      capacity: invForm.capacity ? parseInt(invForm.capacity) : null,
      description: invForm.description || null,
      is_active: true,
      sort_order: inventory.length,
    })
    setSavingInv(false)
    if (error) { showToast('Error: ' + error.message); return }
    if (tenantId) {
      const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'inventory_added', entityType: 'inventory',
        description: `${actor.actorName} added a property/stay: ${invForm.name.trim()}`,
      })
    }
    setInvForm({ name:'', type:'stay', base_price:'', default_margin:'', capacity:'', description:'' })
    setShowAddInv(false)
    loadInventory()
    showToast('Property added')
  }
 
  const updateInventory = async () => {
    if (!editInvId || !editInvForm.name.trim()) { showToast('Name is required'); return }
    setSavingEditInv(true)
    const { error } = await supabase.from('hc_inventory').update({
      name: editInvForm.name.trim(),
      type: editInvForm.type,
      base_price: editInvForm.base_price ? parseFloat(editInvForm.base_price) : null,
      default_margin: editInvForm.default_margin ? parseFloat(editInvForm.default_margin) : null,
      capacity: editInvForm.capacity ? parseInt(editInvForm.capacity) : null,
      description: editInvForm.description || null,
    }).eq('id', editInvId)
    setSavingEditInv(false)
    if (error) { showToast('Error: ' + error.message); return }
    if (tenantId) {
      const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'inventory_edited', entityType: 'inventory', entityId: editInvId,
        description: `${actor.actorName} edited property/stay: ${editInvForm.name.trim()}`,
      })
    }
    setEditInvId(null)
    loadInventory()
    showToast('Property updated')
  }
 
  const deleteInventory = async (item: HCInventory) => {
    const { count } = await supabase
      .from('hc_enquiries')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('interest', item.name)
    if (count && count > 0) {
      if (!window.confirm(`"${item.name}" is used in ${count} enquiry record${count > 1 ? 's' : ''}. It will be removed from dropdowns but existing records won't change. Delete anyway?`)) return
    }
    await supabase.from('hc_inventory').delete().eq('id', item.id)
    if (tenantId) {
      const actor = getActor({ userId: user?.id, isOwner, employeeName: null, ownerName: profile?.owner_name })
      logActivity({
        tenantId, ...actor,
        action: 'inventory_deleted', entityType: 'inventory', entityId: item.id,
        description: `${actor.actorName} deleted property/stay: ${item.name}`,
      })
    }
    loadInventory()
    showToast(item.name + ' deleted')
  }
 
  const openEditInv = (item: HCInventory) => {
    setEditInvId(item.id)
    setEditInvForm({
      name: item.name,
      type: item.type,
      base_price: item.base_price ? String(item.base_price) : '',
      default_margin: item.default_margin ? String(item.default_margin) : '',
      capacity: item.capacity ? String(item.capacity) : '',
      description: item.description || '',
    })
  }
 
  const renderBusiness = () => (
    <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
      <div style={{ fontSize:'14px', fontWeight:500, color:'#111111', marginBottom:'3px' }}>Business profile</div>
      <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'18px' }}>Appears on all receipts and documents.</div>
      <div className="form-grid-2">
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
 
  const renderInventory = () => (
    <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'3px' }}>
        <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>Property / Stay</div>
        <button onClick={() => { setShowAddInv(v => !v); setEditInvId(null) }}
          style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
          {showAddInv ? 'Cancel' : '+ Add property'}
        </button>
      </div>
      <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'18px' }}>Rooms, stays and packages. These appear in the Interest dropdown across the app.</div>
 
      {showAddInv && (
        <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'9px', padding:'16px 18px', marginBottom:'16px' }}>
          <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'12px' }}>New property / stay</div>
          <div className="form-grid-2">
            <div><label style={lbl}>Name *</label><input placeholder="e.g. Forest Suite" value={invForm.name} onChange={e => setInvForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
            <div>
              <label style={lbl}>Type</label>
              <select value={invForm.type} onChange={e => setInvForm(f => ({ ...f, type: e.target.value as 'stay'|'package'|'other' }))} style={inp}>
                <option value="stay">Stay</option>
                <option value="package">Package</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div><label style={lbl}>Base price (₹)</label><input type="number" placeholder="0" value={invForm.base_price} onChange={e => setInvForm(f => ({ ...f, base_price: e.target.value }))} style={inp} /></div>
            {profile?.margin_enabled && <div><label style={lbl}>Margin (₹)</label><input type="number" min="0" placeholder="0" value={invForm.default_margin} onChange={e => setInvForm(f => ({ ...f, default_margin: e.target.value }))} style={inp} /></div>}
            <div><label style={lbl}>Capacity (guests)</label><input type="number" placeholder="2" value={invForm.capacity} onChange={e => setInvForm(f => ({ ...f, capacity: e.target.value }))} style={inp} /></div>
            <div style={{ gridColumn:'span 2' }}><label style={lbl}>Description</label><input placeholder="Short description (optional)" value={invForm.description} onChange={e => setInvForm(f => ({ ...f, description: e.target.value }))} style={inp} /></div>
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button onClick={saveInventory} disabled={savingInv}
              style={{ padding:'8px 20px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingInv?0.7:1 }}>
              {savingInv ? 'Saving...' : 'Add property'}
            </button>
            <button onClick={() => setShowAddInv(false)}
              style={{ padding:'8px 16px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
 
      <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
        {inventory.length === 0 && (
          <div style={{ fontSize:'12px', color:'#9ca3af', textAlign:'center', padding:'20px' }}>No properties added yet.</div>
        )}
        {inventory.map(item => {
          const isEditing = editInvId === item.id
          return (
            <div key={item.id} style={{ border:'1px solid #f3f4f6', borderRadius:'10px', background:'#fafafa', padding:'14px 16px' }}>
              {isEditing ? (
                <div>
                  <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'12px' }}>Edit property</div>
                  <div className="form-grid-2">
                    <div><label style={lbl}>Name *</label><input value={editInvForm.name} onChange={e => setEditInvForm(f => ({ ...f, name: e.target.value }))} style={inp} /></div>
                    <div>
                      <label style={lbl}>Type</label>
                      <select value={editInvForm.type} onChange={e => setEditInvForm(f => ({ ...f, type: e.target.value as 'stay'|'package'|'other' }))} style={inp}>
                        <option value="stay">Stay</option>
                        <option value="package">Package</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div><label style={lbl}>Base price (₹)</label><input type="number" value={editInvForm.base_price} onChange={e => setEditInvForm(f => ({ ...f, base_price: e.target.value }))} style={inp} /></div>
                    {profile?.margin_enabled && <div><label style={lbl}>Margin (₹)</label><input type="number" min="0" value={editInvForm.default_margin} onChange={e => setEditInvForm(f => ({ ...f, default_margin: e.target.value }))} style={inp} /></div>}
                    <div><label style={lbl}>Capacity (guests)</label><input type="number" value={editInvForm.capacity} onChange={e => setEditInvForm(f => ({ ...f, capacity: e.target.value }))} style={inp} /></div>
                    <div style={{ gridColumn:'span 2' }}><label style={lbl}>Description</label><input value={editInvForm.description} onChange={e => setEditInvForm(f => ({ ...f, description: e.target.value }))} style={inp} /></div>
                  </div>
                  <div style={{ display:'flex', gap:'8px' }}>
                    <button onClick={updateInventory} disabled={savingEditInv}
                      style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingEditInv?0.7:1 }}>
                      {savingEditInv ? 'Saving...' : 'Save changes'}
                    </button>
                    <button onClick={() => setEditInvId(null)}
                      style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                  <div style={{ width:'38px', height:'38px', borderRadius:'8px', background:'#17341e', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'15px', fontWeight:500, color:'#ffffff', flexShrink:0 }}>
                    {item.name[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:'13px', fontWeight:500, color:'#111111' }}>{item.name}</div>
                    <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'2px' }}>
                      {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                      {item.base_price ? ` · ₹${item.base_price.toLocaleString('en-IN')}` : ''}
                      {item.default_margin ? ` · Margin ₹${item.default_margin.toLocaleString('en-IN')}` : ''}
                      {item.capacity ? ` · ${item.capacity} guest${item.capacity !== 1 ? 's' : ''}` : ''}
                    </div>
                    {item.description && <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>{item.description}</div>}
                  </div>
                  <button onClick={() => openEditInv(item)}
                    style={{ padding:'7px 14px', background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                    Edit
                  </button>
                  <button onClick={() => deleteInventory(item)}
                    style={{ padding:'7px 14px', background:'#fee2e2', color:'#991b1b', border:'1px solid #fca5a5', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
 
  const ACTION_LABELS: Record<string, { label: string; bg: string; color: string }> = {
    enquiry_created:            { label:'Enquiry added',    bg:'#dbeafe', color:'#1e40af' },
    enquiry_edited:              { label:'Edited',           bg:'#f3f4f6', color:'#6b7280' },
    enquiry_booked:              { label:'Booked',           bg:'#dcfce7', color:'#166534' },
    enquiry_cancelled:           { label:'Cancelled',        bg:'#fee2e2', color:'#991b1b' },
    enquiry_marked_noresponse:   { label:'No response',      bg:'#f3f4f6', color:'#6b7280' },
    enquiry_deleted:              { label:'Deleted',          bg:'#fee2e2', color:'#991b1b' },
    enquiry_payment_changed:     { label:'Payment changed',  bg:'#fef9c3', color:'#854f0b' },
    enquiry_note_added:          { label:'Note added',       bg:'#f3f4f6', color:'#6b7280' },
    income_created:               { label:'Income added',     bg:'#dbeafe', color:'#1e40af' },
    income_recorded:             { label:'Payment recorded', bg:'#dcfce7', color:'#166534' },
    income_deleted:               { label:'Deleted',          bg:'#fee2e2', color:'#991b1b' },
    expense_added:                { label:'Expense added',    bg:'#dbeafe', color:'#1e40af' },
    expense_edited:               { label:'Expense edited',   bg:'#fef9c3', color:'#854f0b' },
    expense_deleted:              { label:'Deleted',          bg:'#fee2e2', color:'#991b1b' },
    customer_edited:              { label:'Customer edited',  bg:'#fef9c3', color:'#854f0b' },
    customer_deleted:             { label:'Deleted',          bg:'#fee2e2', color:'#991b1b' },
    calendar_note_added:         { label:'Note added',       bg:'#dbeafe', color:'#1e40af' },
    calendar_note_edited:        { label:'Note edited',      bg:'#fef9c3', color:'#854f0b' },
    calendar_note_deleted:       { label:'Deleted',          bg:'#fee2e2', color:'#991b1b' },
    employee_created:             { label:'Employee added',   bg:'#dbeafe', color:'#1e40af' },
    employee_edited:              { label:'Employee edited',  bg:'#fef9c3', color:'#854f0b' },
    employee_permissions_edited: { label:'Permissions changed', bg:'#fef9c3', color:'#854f0b' },
    employee_activated:          { label:'Activated',        bg:'#dcfce7', color:'#166534' },
    employee_deactivated:        { label:'Deactivated',      bg:'#fee2e2', color:'#991b1b' },
    business_profile_edited:     { label:'Profile updated',  bg:'#f3f4f6', color:'#6b7280' },
    inventory_added:              { label:'Property added',   bg:'#dbeafe', color:'#1e40af' },
    inventory_edited:             { label:'Property edited',  bg:'#fef9c3', color:'#854f0b' },
    inventory_deleted:            { label:'Deleted',          bg:'#fee2e2', color:'#991b1b' },
  }

  const activityActors = Array.from(new Set(activityLog.map(a => a.actor_name))).sort()
  const filteredActivity = activityActorFilter
    ? activityLog.filter(a => a.actor_name === activityActorFilter)
    : activityLog

  const renderActivity = () => (
    <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'10px', padding:'20px 22px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'3px', flexWrap:'wrap', gap:'10px' }}>
        <div style={{ fontSize:'14px', fontWeight:500, color:'#111111' }}>Activity log</div>
        {activityActors.length > 0 && (
          <select value={activityActorFilter} onChange={e => setActivityActorFilter(e.target.value)}
            style={{ ...inp, width:'auto', padding:'6px 10px', fontSize:'11px' }}>
            <option value="">All staff</option>
            {activityActors.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        )}
      </div>
      <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'18px' }}>
        Everything you and your employees do — enquiries, bookings, payments, customers, calendar notes, and more.
      </div>

      {loadingActivity ? (
        <div style={{ padding:'30px', textAlign:'center', fontSize:'13px', color:'#9ca3af' }}>Loading…</div>
      ) : filteredActivity.length === 0 ? (
        <div style={{ padding:'30px', textAlign:'center', fontSize:'13px', color:'#9ca3af' }}>No activity recorded yet.</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
          {filteredActivity.map(a => {
            const tag = ACTION_LABELS[a.action] || { label: a.action, bg:'#f3f4f6', color:'#6b7280' }
            return (
              <div key={a.id} style={{ display:'flex', alignItems:'flex-start', gap:'10px', padding:'10px 0', borderBottom:'1px solid #f9fafb' }}>
                <span style={{ flexShrink:0, padding:'2px 9px', borderRadius:'20px', fontSize:'10px', fontWeight:600, background:tag.bg, color:tag.color, whiteSpace:'nowrap', marginTop:'1px' }}>
                  {tag.label}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'12px', color:'#374151' }}>{a.description}</div>
                  <div style={{ fontSize:'10px', color:'#9ca3af', marginTop:'2px' }}>
                    {fmtDate(a.created_at)} · {new Date(a.created_at).toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit' })}
                    {a.actor_role === 'staff' && <span style={{ marginLeft:'6px', color:'#6b7280' }}>· Staff</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
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
          <div className="form-grid-2">
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
                ) : editEmpFullId === e.id ? (
                  <div style={{ width:'100%' }}>
                    <div className="form-grid-2">
                      <div><label style={lbl}>Name</label><input value={editEmpFullForm.name} onChange={e2 => setEditEmpFullForm(f => ({ ...f, name: e2.target.value }))} style={inp} /></div>
                      <div><label style={lbl}>Email</label><input type="email" value={editEmpFullForm.email} onChange={e2 => setEditEmpFullForm(f => ({ ...f, email: e2.target.value }))} style={inp} /></div>
                      <div><label style={lbl}>Role</label><input value={editEmpFullForm.role} onChange={e2 => setEditEmpFullForm(f => ({ ...f, role: e2.target.value }))} style={inp} /></div>
                      <div>
                        <label style={lbl}>New password (optional)</label>
                        <div style={{ position:'relative' }}>
                          <input type={showEditEmpPw ? 'text' : 'password'} value={editEmpFullForm.password} onChange={e2 => setEditEmpFullForm(f => ({ ...f, password: e2.target.value }))} placeholder="Leave blank to keep current" style={{ ...inp, paddingRight:'36px' }} />
                          <button type="button" onClick={() => setShowEditEmpPw(v => !v)} style={{ position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', display:'flex', alignItems:'center' }}>
                            {showEditEmpPw ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={updateEmployee} disabled={savingEditEmp}
                        style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingEditEmp?0.7:1 }}>
                        {savingEditEmp ? 'Saving...' : 'Save changes'}
                      </button>
                      <button onClick={() => setEditEmpFullId(null)}
                        style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button onClick={() => openEditEmpFull(e)}
                      style={{ padding:'7px 16px', background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                      Edit details
                    </button>
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
            <div className="form-grid-2">
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
              <div style={{ gridColumn:'span 2' }}>
                <label style={{ display:'flex', alignItems:'flex-start', gap:'9px', cursor:'pointer' }}>
                  <input type="checkbox" checked={subForm.margin_enabled} onChange={e => setSubForm(f => ({ ...f, margin_enabled: e.target.checked }))} style={{ marginTop:'3px', width:'15px', height:'15px', cursor:'pointer' }} />
                  <span>
                    <div style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>Operates as an agent / OTA</div>
                    <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>Enables the Margin field on Property/Stay — for businesses that connect guests to third-party stays, not direct property owners.</div>
                  </span>
                </label>
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
            <div className="form-grid-2">
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
              const isEditingSub = editSubId === sub.id
              return (
                <div key={sub.id} style={{ border:'1px solid #f3f4f6', borderRadius:'10px', background:'#fafafa', padding:'14px 16px' }}>
                  {isEditingSub ? (
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:500, color:'#111111', marginBottom:'12px' }}>Edit subscriber</div>
                      <div className="form-grid-2">
                        <div><label style={lbl}>Business name</label><input value={editSubForm.business_name} onChange={e => setEditSubForm(f => ({ ...f, business_name: e.target.value }))} style={inp} /></div>
                        <div><label style={lbl}>Owner name</label><input value={editSubForm.owner_name} onChange={e => setEditSubForm(f => ({ ...f, owner_name: e.target.value }))} style={inp} /></div>
                        <div><label style={lbl}>Phone</label><input value={editSubForm.phone} onChange={e => setEditSubForm(f => ({ ...f, phone: e.target.value }))} style={inp} /></div>
                        <div><label style={lbl}>Email</label><input type="email" value={editSubForm.email} onChange={e => setEditSubForm(f => ({ ...f, email: e.target.value }))} style={inp} /></div>
                        <div style={{ gridColumn:'span 2' }}>
                          <label style={lbl}>New password (optional)</label>
                          <div style={{ position:'relative' }}>
                            <input type={showEditSubPw ? 'text' : 'password'} value={editSubForm.password} onChange={e => setEditSubForm(f => ({ ...f, password: e.target.value }))} placeholder="Leave blank to keep current" style={{ ...inp, paddingRight:'36px' }} />
                            <button type="button" onClick={() => setShowEditSubPw(v => !v)} style={{ position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', display:'flex', alignItems:'center' }}>
                              {showEditSubPw ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </div>
                        <div style={{ gridColumn:'span 2' }}>
                          <label style={{ display:'flex', alignItems:'flex-start', gap:'9px', cursor:'pointer' }}>
                            <input type="checkbox" checked={editSubForm.margin_enabled} onChange={e => setEditSubForm(f => ({ ...f, margin_enabled: e.target.checked }))} style={{ marginTop:'3px', width:'15px', height:'15px', cursor:'pointer' }} />
                            <span>
                              <div style={{ fontSize:'12px', fontWeight:500, color:'#111111' }}>Operates as an agent / OTA</div>
                              <div style={{ fontSize:'11px', color:'#9ca3af', marginTop:'1px' }}>Enables the Margin field on Property/Stay.</div>
                            </span>
                          </label>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:'8px' }}>
                        <button onClick={updateSubscriber} disabled={savingEditSub}
                          style={{ padding:'7px 16px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:savingEditSub?0.7:1 }}>
                          {savingEditSub ? 'Saving...' : 'Save changes'}
                        </button>
                        <button onClick={() => setEditSubId(null)}
                          style={{ padding:'7px 14px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
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
                      {subProfiles[sub.auth_user_id] && (
                        <span style={{ fontSize:'11px', padding:'3px 10px', borderRadius:'20px', fontWeight:500, background:'#e0f2fe', color:'#075985', flexShrink:0 }}>
                          Agent / OTA
                        </span>
                      )}
                      <button onClick={() => openEditSub(sub)}
                        style={{ padding:'7px 14px', background:'#f3f4f6', color:'#374151', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', flexShrink:0 }}>
                        Edit
                      </button>
                      <button onClick={() => toggleSubscriber(sub)} disabled={isToggling}
                        style={{ padding:'7px 14px', background: isActive ? '#fee2e2' : '#dcfce7', color: isActive ? '#991b1b' : '#166534', border:`1px solid ${isActive ? '#fca5a5' : '#86efac'}`, borderRadius:'8px', fontSize:'12px', fontWeight:500, cursor:'pointer', opacity:isToggling?0.6:1, flexShrink:0 }}>
                        {isToggling ? '...' : isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  )}
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
      <div className="topbar" style={{ justifyContent:'flex-start' }}>
        <span style={{ fontSize:'15px', fontWeight:500, color:'#111111' }}>Settings</span>
      </div>
      <div className="settings-body">
        <div className="settings-sidebar">
          <div style={{ fontSize:'10px', fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.08em', padding:'0 8px', marginBottom:'8px' }}>Settings</div>
          {SECTIONS.map(s => (
            <div key={s.id} onClick={() => setSection(s.id)}
              style={{ padding:'8px 10px', borderRadius:'8px', marginBottom:'2px', cursor:'pointer', fontSize:'12px', fontWeight: s.id === section ? 500 : 400, background: s.id === section ? '#ffffff' : 'transparent', color: s.id === section ? '#111111' : '#6b7280', border: s.id === section ? '1px solid #e5e7eb' : '1px solid transparent' }}>
              {s.label}
            </div>
          ))}
        </div>
        <div className="page-content">
          {section === 'business'   && renderBusiness()}
          {section === 'inventory'  && renderInventory()}
          {section === 'employees'  && renderEmployees()}
          {section === 'activity'   && isOwner && renderActivity()}
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