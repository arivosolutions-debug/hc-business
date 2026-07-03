import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
 
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
 
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
 
  try {
    const { employee_id, name, email, role, password } = await req.json()
 
    if (!employee_id) {
      return new Response(JSON.stringify({ success: false, error: 'employee_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
 
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Authorization: caller must own the employee's tenant (or be super admin) ──
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: { user: caller }, error: callerErr } = await supabaseAdmin.auth.getUser(token)
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // Look up the employee's tenant and the caller's admin status
    const { data: targetEmp } = await supabaseAdmin
      .from('hc_employees').select('tenant_id').eq('id', employee_id).single()
    const { data: callerProfile } = await supabaseAdmin
      .from('hc_profiles').select('is_super_admin').eq('id', caller.id).single()

    const ownsTenant = targetEmp && targetEmp.tenant_id === caller.id
    const isSuperAdmin = !!callerProfile?.is_super_admin
    if (!ownsTenant && !isSuperAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // ─────────────────────────────────────────────────────────────────────

    // Update hc_employees table
    const { error: empError } = await supabaseAdmin.from('hc_employees').update({
      name,
      email,
      role_label: role,
    }).eq('id', employee_id)
 
    if (empError) throw new Error(empError.message)
 
    // Get auth_user_id to update Auth
    const { data: emp } = await supabaseAdmin.from('hc_employees').select('auth_user_id').eq('id', employee_id).single()
 
    if (emp?.auth_user_id) {
      const authUpdate: Record<string, string> = {}
      if (email) authUpdate.email = email
      if (password && password.trim()) authUpdate.password = password
 
      if (Object.keys(authUpdate).length > 0) {
        await supabaseAdmin.auth.admin.updateUserById(emp.auth_user_id, authUpdate)
      }
    }
 
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
 
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})