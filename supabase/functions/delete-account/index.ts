import { corsHeaders } from '@supabase/supabase-js/cors'
import { createDeletionDependencies } from './adapter.ts'
import { createDeletionHandler } from './handler.ts'

const dependencies = createDeletionDependencies(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(createDeletionHandler(dependencies, {
  ...corsHeaders,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}))
