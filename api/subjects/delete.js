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
  if (!id) return res.status(400).json({ error: 'No subject specified.' });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { error } = await supabase.from('subjects').delete().eq('id', id);
  if (error) {
    console.error('Subject delete error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({ ok: true });
};
