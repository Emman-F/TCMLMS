// Shared server-side Supabase client. Uses the service_role key, which
// bypasses Row Level Security entirely -- this file must NEVER be imported
// by anything that ships to the browser. It only runs inside Vercel's
// serverless functions, where SUPABASE_SERVICE_ROLE_KEY is available as a
// server-only environment variable (Type: Secret in Vercel).
const { createClient } = require('@supabase/supabase-js');

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

module.exports = { getSupabaseAdmin };
