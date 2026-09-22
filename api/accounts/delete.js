const { getSupabaseAdmin } = require('../_supabaseAdmin');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const ids = Array.isArray((body || {}).ids) ? body.ids.filter(Boolean) : [];

  if (!ids.length) {
    return res.status(400).json({ error: 'No accounts selected.' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // The schema already handles cleanup correctly: submissions and attendance
  // cascade-delete with the student, while audit_log rows survive with their
  // student_id set to null -- same rules already tested for the local version,
  // just enforced by Postgres itself here instead of application code.
  const { error } = await supabase.from('users').delete().in('id', ids);

  if (error) {
    console.error('Account delete error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({ deletedCount: ids.length });
};
