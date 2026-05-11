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