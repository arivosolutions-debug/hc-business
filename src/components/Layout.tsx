import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutDashboard, Users, TrendingUp, TrendingDown,
  Settings, LogOut, Menu, X, CalendarDays, BookOpen, Wallet,
} from 'lucide-react'
 
interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
  permKey: string | null  // null = always show (owner only items handled separately)
  ownerOnly?: boolean
}
 
const ALL_NAV: NavItem[] = [
  { to: '/dashboard', icon: <LayoutDashboard size={15} />, label: 'Dashboard', permKey: 'dashboard' },
  { to: '/enquiries', icon: <BookOpen size={15} />,        label: 'Enquiries', permKey: 'enquiries' },
  { to: '/income',    icon: <TrendingUp size={15} />,      label: 'Income',    permKey: 'income'    },
  { to: '/accounts', icon: <Wallet size={15} />, label: 'Accounts', permKey: 'accounts' },
  { to: '/calendar',  icon: <CalendarDays size={15} />,    label: 'Calendar',  permKey: 'calendar'  },
  { to: '/customers', icon: <Users size={15} />,           label: 'Customers', permKey: 'customers' },
  { to: '/expenses',  icon: <TrendingDown size={15} />,    label: 'Expenses',  permKey: 'expenses', ownerOnly: false },
  { to: '/settings',  icon: <Settings size={15} />,        label: 'Settings',  permKey: 'shareLinks' },
]
 
export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, isOwner, permissions, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
 
  const handleSignOut = async () => { await signOut(); navigate('/login') }
 
  // Build visible nav based on permissions
  const visibleNav = ALL_NAV.filter(item => {
    if (item.ownerOnly) return isOwner
    if (item.permKey === null) return false // shouldn't happen but safety
    return permissions[item.permKey as keyof typeof permissions]
  })
 
  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div style={{ padding:'16px 14px 12px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'9px', marginBottom:'4px' }}>
          <div style={{ width:'28px', height:'28px', background:'rgba(255,255,255,0.12)', borderRadius:'7px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <div style={{ width:'13px', height:'13px', background:'#fff', clipPath:'ellipse(45% 50% at 30% 50%)', transform:'rotate(-30deg)' }} />
          </div>
          <span style={{ fontSize:'14px', fontWeight:500, color:'#ffffff' }}>HC Business</span>
        </div>
        <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.3)', paddingLeft:'37px' }}>
          {profile?.business_name || 'Your Business'}
        </div>
      </div>
 
      {/* Nav items */}
      <div style={{ flex:1, padding:'10px 6px', overflowY:'auto' }}>
        {visibleNav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            onClick={() => setMobileOpen(false)}
            style={({ isActive }) => ({
              display:'flex', alignItems:'center', gap:'10px', padding:'9px 10px',
              borderRadius:'8px', marginBottom:'2px', textDecoration:'none',
              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: isActive ? '#ffffff' : 'rgba(255,255,255,0.45)',
            })}
          >
            {item.icon}
            <span style={{ fontSize:'13px', fontWeight:400, flex:1 }}>{item.label}</span>
          </NavLink>
        ))}
      </div>
 
      {/* User + sign out */}
      <div style={{ padding:'10px 6px', borderTop:'1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'9px', padding:'8px 10px', marginBottom:'2px' }}>
          <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:500, color:'#ffffff', flexShrink:0 }}>
            {(profile?.owner_name || profile?.business_name || 'U')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.85)' }}>{profile?.owner_name || 'Owner'}</div>
            <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.35)' }}>{isOwner ? 'Owner' : 'Employee'}</div>
          </div>
        </div>
        <button onClick={handleSignOut}
          style={{ display:'flex', alignItems:'center', gap:'9px', padding:'8px 10px', width:'100%', background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.4)', borderRadius:'8px' }}>
          <LogOut size={14} />
          <span style={{ fontSize:'12px' }}>Sign out</span>
        </button>
      </div>
    </>
  )
 
  return (
    <div className="app-root" style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <aside style={{ width:'200px', background:'#17341e', display:'flex', flexDirection:'column', flexShrink:0 }} className="hidden-mobile">
        <SidebarContent />
      </aside>
 
      <div className="mobile-header" style={{ display:'none' }}>
        <button onClick={() => setMobileOpen(true)} style={{ background:'none', border:'none', cursor:'pointer', color:'#17341e' }}>
          <Menu size={22} />
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
          <div style={{ width:'22px', height:'22px', background:'#17341e', borderRadius:'5px', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ width:'10px', height:'10px', background:'#fff', clipPath:'ellipse(45% 50% at 30% 50%)', transform:'rotate(-30deg)' }} />
          </div>
          <span style={{ fontSize:'14px', fontWeight:500, color:'#17341e' }}>HC Business</span>
        </div>
        <div style={{ width:'32px' }} />
      </div>
 
      {mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.3)', zIndex:40 }} />
          <aside style={{ position:'fixed', top:0, left:0, width:'220px', height:'100%', background:'#17341e', zIndex:50, display:'flex', flexDirection:'column' }}>
            <div style={{ display:'flex', justifyContent:'flex-end', padding:'12px 12px 0' }}>
              <button onClick={() => setMobileOpen(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.6)' }}>
                <X size={20} />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </>
      )}
 
      <main style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
        {children}
      </main>
    </div>
  )
}
 
export default Layout