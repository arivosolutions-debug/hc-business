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
    const { user_id, action } = await req.json()
 
    if (!user_id || !action) {
      return new Response(JSON.stringify({ success: false, error: 'user_id and action are required' }), {
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

    if (action === 'ban') {
      await supabaseAdmin.auth.admin.updateUserById(user_id, { ban_duration: '876600h' })
      await supabaseAdmin.from('hc_subscribers').update({ is_active: false }).eq('auth_user_id', user_id)
    } else if (action === 'unban') {
      await supabaseAdmin.auth.admin.updateUserById(user_id, { ban_duration: 'none' })
      await supabaseAdmin.from('hc_subscribers').update({ is_active: true }).eq('auth_user_id', user_id)
    } else {
      throw new Error('Invalid action. Use "ban" or "unban".')
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