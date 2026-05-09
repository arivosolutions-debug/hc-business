import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff } from 'lucide-react'

export const Login: React.FC = () => {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true); setError('')
    const { error } = await signIn(email, password)
    if (error) { setError('Incorrect email or password. Please try again.'); setLoading(false) }
    else navigate('/')
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f9fafb', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px' }}>
      <div style={{ width:'100%', maxWidth:'360px' }}>

        {/* Card */}
        <div style={{ background:'#ffffff', border:'1px solid #e5e7eb', borderRadius:'12px', overflow:'hidden' }}>

          {/* Green header */}
          <div style={{ background:'#17341e', padding:'22px 28px', display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{ width:'30px', height:'30px', background:'rgba(255,255,255,0.15)', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <div style={{ width:'14px', height:'14px', background:'#fff', clipPath:'ellipse(45% 50% at 30% 50%)', transform:'rotate(-30deg)' }} />
            </div>
            <div>
              <div style={{ fontSize:'16px', fontWeight:500, color:'#ffffff', lineHeight:1.2 }}>HC Business</div>
              <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.5)', marginTop:'2px' }}>Sign in to your workspace</div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding:'28px 28px 24px' }}>
            <div style={{ fontSize:'15px', fontWeight:500, color:'#111111', marginBottom:'20px' }}>Welcome back</div>

            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', padding:'10px 14px', fontSize:'12px', color:'#991b1b', marginBottom:'14px' }}>
                  {error}
                </div>
              )}

              <div style={{ marginBottom:'14px' }}>
                <label style={{ display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'5px' }}>
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@yourbusiness.com"
                  autoFocus
                  style={{ width:'100%', padding:'9px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }}
                />
              </div>

              <div style={{ marginBottom:'20px' }}>
                <label style={{ display:'block', fontSize:'10px', fontWeight:500, color:'#6b7280', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'5px' }}>
                  Password
                </label>
                <div style={{ position:'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Your password"
                    style={{ width:'100%', padding:'9px 40px 9px 12px', border:'1px solid #e5e7eb', borderRadius:'8px', fontSize:'13px', color:'#111111', background:'#ffffff', outline:'none', boxSizing:'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', padding:'2px', display:'flex', alignItems:'center' }}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{ width:'100%', padding:'10px', background:'#17341e', color:'#ffffff', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:500, cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1 }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div style={{ marginTop:'20px', textAlign:'center', fontSize:'11px', color:'#9ca3af', lineHeight:1.6 }}>
              Contact Hillscamp for your login credentials.<br />
              <span style={{ color:'#17341e', fontWeight:500 }}>HC Business</span> by Hillscamp
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
