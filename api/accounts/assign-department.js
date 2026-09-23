const { getSupabaseAdmin } = require('../_supabaseAdmin');

const DEPARTMENTS = ['BSIT', 'BSN', 'LAED', 'FPST', 'BSBA', 'BSA'];

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
  const department = ((body || {}).department || '').toString().trim().toUpperCase();

  if (!ids.length) return res.status(400).json({ error: 'No accounts selected.' });
  if (!DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department.' });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { error } = await supabase.from('users').update({ department }).in('id', ids);
  if (error) {
    console.error('Bulk assign-department error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({ updatedCount: ids.length });
};
