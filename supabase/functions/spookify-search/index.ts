import { corsHeaders } from '@supabase/supabase-js/cors'
import { createSearchDependencies } from './adapter.ts'
import { createSearchHandler } from './handler.ts'

const dependencies = createSearchDependencies(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  Deno.env.get('SPOTIFY_CLIENT_ID')!,
  Deno.env.get('SPOTIFY_CLIENT_SECRET')!,
)

Deno.serve(createSearchHandler(dependencies, {
  ...corsHeaders,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}))
