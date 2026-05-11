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
    const { email, password, business_name, owner_name, phone } = await req.json()
 
    if (!email || !password || !business_name) {
      return new Response(JSON.stringify({ success: false, error: 'Email, password and business name are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
 
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
 
    // Create auth user (skip email confirmation)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
 
    if (authError) throw new Error(authError.message)
 
    const userId = authData.user.id
 
    // Insert into hc_subscribers (tenant registry)
    const { error: subError } = await supabaseAdmin.from('hc_subscribers').insert({
      auth_user_id: userId,
      business_name,
      owner_name: owner_name || '',
      email,
      phone: phone || '',
      is_active: true,
      subscription_expires: null,
    })
 
    if (subError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      throw new Error(subError.message)
    }
 
    // Seed default settings for this tenant (tenant_id = userId)
    const defaultCats = ['Electricity', 'Staff Salary', 'Maintenance', 'Food & Supplies', 'Marketing', 'Transport', 'Other']
    const defaultSources = ['WhatsApp DM', 'Instagram DM', 'Website form', 'Phone call', 'Walk-in', 'Referral', 'Other']
    const defaultPayTypes = ['UPI', 'Cash', 'Bank transfer', 'Cheque']
 
    await supabaseAdmin.from('hc_settings').insert([
      ...defaultCats.map((cat, i) => ({ tenant_id: userId, type: 'expense_category', value: cat, sort_order: i })),
      ...defaultSources.map((src, i) => ({ tenant_id: userId, type: 'source', value: src, sort_order: i })),
      ...defaultPayTypes.map((pt, i) => ({ tenant_id: userId, type: 'payment_type', value: pt, sort_order: i })),
    ])
 
    return new Response(JSON.stringify({ success: true, user_id: userId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
 
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})