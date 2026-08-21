import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Onboarding } from './pages/Onboarding'
 
const Dashboard     = React.lazy(() => import('./pages/Dashboard'))
const Enquiries     = React.lazy(() => import('./pages/Enquiries'))
const CustomersPage = React.lazy(() => import('./pages/CustomersPage'))
const Income        = React.lazy(() => import('./pages/Income'))
const Accounts       = React.lazy(() => import('./pages/Accounts'))
const Expenses      = React.lazy(() => import('./pages/Expenses'))
const Calendar      = React.lazy(() => import('./pages/Calendar'))
const SettingsPage  = React.lazy(() => import('./pages/Settings'))
const SharedCRMReport = React.lazy(() => import('./pages/SharedCRMReport'))
 
const Loader = () => (
  <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f9fafb' }}>
    <div style={{ width:'32px', height:'32px', border:'3px solid #17341e', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
)
 
const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.Suspense fallback={<Loader />}>{children}</React.Suspense>
)
 
// Protected route — checks auth + optional permission key
const ProtectedRoute: React.FC<{
  children: React.ReactNode
  permKey?: string
  ownerOnly?: boolean
}> = ({ children, permKey, ownerOnly }) => {
  const { user, isOwner, permissions, loading } = useAuth()
  if (loading) return <Loader />
  if (!user) return <Navigate to="/login" replace />
  if (ownerOnly && !isOwner) return <Navigate to="/enquiries" replace />
  if (permKey && !permissions[permKey as keyof typeof permissions]) return <Navigate to="/enquiries" replace />
  return <Layout>{children}</Layout>
}
 
const AuthRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return <Loader />
  if (user) return <Navigate to="/enquiries" replace />
  return <>{children}</>
}
 
const AppRoutes = () => (
  <Routes>
    <Route path="/login"      element={<AuthRoute><Login /></AuthRoute>} />
    <Route path="/shared/:token" element={<Page><SharedCRMReport /></Page>} />
    <Route path="/dashboard"  element={<ProtectedRoute permKey="dashboard"><Page><Dashboard /></Page></ProtectedRoute>} />
    <Route path="/enquiries"  element={<ProtectedRoute permKey="enquiries"><Page><Enquiries /></Page></ProtectedRoute>} />
    <Route path="/customers"  element={<ProtectedRoute permKey="customers"><Page><CustomersPage /></Page></ProtectedRoute>} />
    <Route path="/income"     element={<ProtectedRoute permKey="income"><Page><Income /></Page></ProtectedRoute>} />
    <Route path="/accounts"   element={<ProtectedRoute permKey="accounts"><Page><Accounts /></Page></ProtectedRoute>} />
    <Route path="/expenses"   element={<ProtectedRoute permKey="expenses"><Page><Expenses /></Page></ProtectedRoute>} />
    <Route path="/calendar"   element={<ProtectedRoute permKey="calendar"><Page><Calendar /></Page></ProtectedRoute>} />
    <Route path="/settings"   element={<ProtectedRoute permKey="shareLinks"><Page><SettingsPage /></Page></ProtectedRoute>} />
    <Route path="*"           element={<Navigate to="/enquiries" replace />} />
  </Routes>
)
 
const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  </BrowserRouter>
)
 
export default App