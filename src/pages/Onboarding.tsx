import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Check } from 'lucide-react'

type Step = 1 | 2 | 3 | 4

const DEFAULT_CATS = ['Electricity', 'Staff Salary', 'Maintenance', 'Food & Supplies', 'Marketing', 'Transport', 'Other']

const inp: React.CSSProperties = { width:'100%', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'12px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }
const lbl: React.CSSProperties = { display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'4px' }
const btnGreen: React.CSSProperties = { padding:'9px 24px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, cursor:'pointer' }
const btnWhite: React.CSSProperties = { padding:'9px 18px', background:'#ffffff', color:'#111111', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', fontWeight:500, cursor:'pointer' }

export const Onboarding: React.FC = () => {
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [saving, setSaving] = useState(false)
  const [newCat, setNewCat] = useState('')

  const [form, setForm] = useState({
    business_name: '', owner_name: '', phone: '', address: '', gst_number: '',
    inventory: [{ type: 'Stay', name: '' }, { type: 'Package', name: '' }],
    categories: [...DEFAULT_CATS],
  })

  const update = (key: string, val: unknown) => setForm(f => ({ ...f, [key]: val }))

  const steps = ['Business', 'Inventory', 'Categories', 'Done']

  const Progress = () => (
    <div style={{ display:'flex', alignItems:'flex-start', width:'100%', maxWidth:'480px', marginBottom:'24px' }}>
      {steps.map((s, i) => {
        const n = i + 1
        const done = n < step
        const active = n === step
        const bg = done || active ? '#17341e' : '#ffffff'
        const bd = done || active ? '#17341e' : '#d1d5db'
        const tc = done || active ? '#17341e' : '#9ca3af'
        return (
          <React.Fragment key={s}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', flex:1 }}>
              <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:bg, border:`1.5px solid ${bd}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {done
                  ? <Check size={13} color="#ffffff" strokeWidth={2.5} />
                  : <span style={{ fontSize:'11px', fontWeight:500, color: active ? '#ffffff' : '#9ca3af' }}>{n}</span>}
              </div>
              <span style={{ fontSize:'10px', fontWeight:500, color:tc }}>{s}</span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex:1, paddingTop:'14px', padding:'14px 4px 0' }}>
                <div style={{ height:'1.5px', background: done ? '#17341e' : '#e5e7eb' }} />
              </div>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )

  const finish = async () => {
    if (!user) return
    setSaving(true)
    // Save profile
    await supabase.from('hc_profiles').update({
      business_name: form.business_name,
      owner_name: form.owner_name,
      phone: form.phone,
      address: form.address,
      gst_number: form.gst_number,
      onboarding_complete: true,
    }).eq('id', user.id)

    // Save inventory
    const validItems = form.inventory.filter(i => i.name.trim())
    if (validItems.length > 0) {
      await supabase.from('hc_inventory').insert(
        validItems.map((item, idx) => ({ tenant_id: user.id, type: item.type.toLowerCase(), name: item.name, sort_order: idx }))
      )
    }

    // Save expense categories
    await supabase.from('hc_settings').insert(
      form.categories.map((cat, idx) => ({ tenant_id: user.id, type: 'expense_category', value: cat, sort_order: idx, is_default: DEFAULT_CATS.includes(cat) }))
    )

    // Seed all other defaults
    await supabase.rpc('hc_seed_defaults', { p_tenant_id: user.id })

    await refreshProfile()
    navigate('/dashboard')
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', background:'#f9fafb' }}>

      {/* Topbar */}
      <div style={{ background:'#17341e', padding:'14px 24px', display:'flex', alignItems:'center', gap:'9px', flexShrink:0 }}>
        <div style={{ width:'28px', height:'28px', background:'rgba(255,255,255,0.15)', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:'13px', height:'13px', background:'#fff', clipPath:'ellipse(45% 50% at 30% 50%)', transform:'rotate(-30deg)' }} />
        </div>
        <span style={{ fontSize:'14px', fontWeight:500, color:'#ffffff' }}>HC Business</span>
      </div>

      {/* Content */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', padding:'32px 20px' }}>
        <Progress />

        <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'12px', padding:'28px', width:'100%', maxWidth:'480px', boxSizing:'border-box' }}>

          {/* Step 1 */}
          {step === 1 && (
            <>
              <div style={{ fontSize:'16px', fontWeight:500, color:'#111111', marginBottom:'4px' }}>Your business details</div>
              <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'20px', lineHeight:1.6 }}>This appears on all your receipts and documents.</div>
              <div style={{ marginBottom:'12px' }}><label style={lbl}>Business name *</label><input style={inp} value={form.business_name} onChange={e => update('business_name', e.target.value)} placeholder="e.g. Green Valley Homestay" /></div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'12px' }}>
                <div><label style={lbl}>Owner name *</label><input style={inp} value={form.owner_name} onChange={e => update('owner_name', e.target.value)} placeholder="Your full name" /></div>
                <div><label style={lbl}>Phone</label><input style={inp} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+91 98470 00000" /></div>
              </div>
              <div style={{ marginBottom:'12px' }}><label style={lbl}>Address</label><input style={inp} value={form.address} onChange={e => update('address', e.target.value)} placeholder="Town, District, Kerala" /></div>
              <div style={{ marginBottom:'22px' }}><label style={lbl}>GST number <span style={{ fontSize:'9px', textTransform:'none', fontWeight:400, color:'#9ca3af' }}>(optional)</span></label><input style={inp} value={form.gst_number} onChange={e => update('gst_number', e.target.value)} placeholder="22AAAAA0000A1Z5" /></div>
              <div style={{ display:'flex', gap:'10px' }}>
                <button style={{ ...btnGreen, flex:1 }} onClick={() => form.business_name.trim() && setStep(2)}>Continue</button>
              </div>
            </>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <>
              <div style={{ fontSize:'16px', fontWeight:500, color:'#111111', marginBottom:'4px' }}>Rooms and packages</div>
              <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'20px', lineHeight:1.6 }}>Add what guests can book. You can edit these anytime from Settings.</div>
              {form.inventory.map((item, i) => (
                <div key={i} style={{ display:'flex', gap:'8px', marginBottom:'10px', alignItems:'center' }}>
                  <select value={item.type} onChange={e => { const inv=[...form.inventory]; inv[i]={...inv[i],type:e.target.value}; update('inventory',inv) }}
                    style={{ ...inp, width:'100px', flexShrink:0 }}>
                    <option>Stay</option><option>Package</option><option>Other</option>
                  </select>
                  <input style={{ ...inp, flex:1 }} value={item.name} placeholder={item.type==='Stay'?'e.g. Forest Suite':'e.g. Wayanad Trail Package'}
                    onChange={e => { const inv=[...form.inventory]; inv[i]={...inv[i],name:e.target.value}; update('inventory',inv) }} />
                  {form.inventory.length > 1 && (
                    <button onClick={() => update('inventory', form.inventory.filter((_,j)=>j!==i))}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:'18px', lineHeight:1, padding:'0 4px' }}>×</button>
                  )}
                </div>
              ))}
              <button onClick={() => update('inventory', [...form.inventory, { type:'Stay', name:'' }])}
                style={{ fontSize:'12px', color:'#17341e', fontWeight:500, background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:'22px', display:'block' }}>
                + Add another
              </button>
              <div style={{ display:'flex', gap:'10px' }}>
                <button style={btnWhite} onClick={() => setStep(1)}>Back</button>
                <button style={{ ...btnGreen, flex:1 }} onClick={() => setStep(3)}>Continue</button>
              </div>
            </>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <>
              <div style={{ fontSize:'16px', fontWeight:500, color:'#111111', marginBottom:'4px' }}>Expense categories</div>
              <div style={{ fontSize:'12px', color:'#9ca3af', marginBottom:'16px', lineHeight:1.6 }}>Remove what you don't need and add your own.</div>
              <div style={{ display:'flex', flexWrap:'wrap', marginBottom:'16px' }}>
                {form.categories.map(cat => (
                  <span key={cat} style={{ display:'inline-flex', alignItems:'center', gap:'6px', background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:'20px', padding:'5px 12px', fontSize:'12px', color:'#374151', margin:'3px' }}>
                    {cat}
                    <button onClick={() => update('categories', form.categories.filter(c=>c!==cat))}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:'14px', lineHeight:1, padding:0 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display:'flex', gap:'8px', marginBottom:'22px' }}>
                <input style={{ ...inp, flex:1 }} value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Add a custom category..."
                  onKeyDown={e => { if(e.key==='Enter'&&newCat.trim()){ update('categories',[...form.categories,newCat.trim()]); setNewCat('') } }} />
                <button style={{ ...btnWhite, whiteSpace:'nowrap' }} onClick={() => { if(newCat.trim()){ update('categories',[...form.categories,newCat.trim()]); setNewCat('') } }}>Add</button>
              </div>
              <div style={{ display:'flex', gap:'10px' }}>
                <button style={btnWhite} onClick={() => setStep(2)}>Back</button>
                <button style={{ ...btnGreen, flex:1 }} onClick={() => setStep(4)}>Continue</button>
              </div>
            </>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div style={{ textAlign:'center', padding:'16px 0 8px' }}>
              <div style={{ width:'56px', height:'56px', background:'#f0fdf4', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
                <Check size={26} color="#15803d" strokeWidth={2.5} />
              </div>
              <div style={{ fontSize:'18px', fontWeight:500, color:'#111111', marginBottom:'8px' }}>You're all set</div>
              <div style={{ fontSize:'13px', color:'#6b7280', lineHeight:1.7, marginBottom:'24px' }}>
                Your workspace is ready to use.<br />Everything can be changed anytime from Settings.
              </div>
              <button disabled={saving} style={{ ...btnGreen, width:'100%', padding:'12px', fontSize:'14px', opacity:saving?0.7:1 }} onClick={finish}>
                {saving ? 'Setting up…' : 'Open HC Business'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
