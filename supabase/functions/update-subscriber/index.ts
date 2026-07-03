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
    const { subscriber_id, business_name, owner_name, phone, email, password, margin_enabled, whatsapp_crm_enabled, whatsapp_number } = await req.json()
 
    if (!subscriber_id) {
      return new Response(JSON.stringify({ success: false, error: 'subscriber_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
 
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Authorization: caller must be a super admin ──────────────────────
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
    const { data: callerProfile } = await supabaseAdmin
      .from('hc_profiles').select('is_super_admin').eq('id', caller.id).single()
    if (!callerProfile?.is_super_admin) {
      return new Response(JSON.stringify({ success: false, error: 'Not authorized' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // ─────────────────────────────────────────────────────────────────────

    // Update hc_subscribers table
    const { error: subError } = await supabaseAdmin.from('hc_subscribers').update({
      business_name,
      owner_name,
      phone,
      email,
    }).eq('id', subscriber_id)
 
    if (subError) throw new Error(subError.message)
 
    // Get auth_user_id to update Auth
    const { data: sub } = await supabaseAdmin.from('hc_subscribers').select('auth_user_id').eq('id', subscriber_id).single()
 
    if (sub?.auth_user_id) {
      const authUpdate: Record<string, string> = {}
      if (email) authUpdate.email = email
      if (password && password.trim()) authUpdate.password = password
 
      if (Object.keys(authUpdate).length > 0) {
        await supabaseAdmin.auth.admin.updateUserById(sub.auth_user_id, authUpdate)
      }

      if (margin_enabled !== undefined) {
        await supabaseAdmin.from('hc_profiles').update({ margin_enabled: !!margin_enabled }).eq('id', sub.auth_user_id)
      }

      if (whatsapp_crm_enabled !== undefined) {
        await supabaseAdmin.from('hc_profiles').update({
          whatsapp_crm_enabled: !!whatsapp_crm_enabled,
          whatsapp_number: whatsapp_crm_enabled ? (whatsapp_number || null) : null,
        }).eq('id', sub.auth_user_id)
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