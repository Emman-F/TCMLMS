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
  const id = ((body || {}).id || '').toString().trim();
  if (!id) return res.status(400).json({ error: 'No section specified.' });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // The schema already handles this correctly: subjects (and their
  // assessments/submissions/attendance) cascade-delete with the section,
  // while students in it get section_id set to null rather than being
  // deleted -- same careful behavior as the original local-only version.
  const { error } = await supabase.from('sections').delete().eq('id', id);
  if (error) {
    console.error('Section delete error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({ ok: true });
};
