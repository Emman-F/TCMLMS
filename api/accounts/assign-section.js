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
  const sectionId = ((body || {}).sectionId || '').toString().trim();

  if (!ids.length) return res.status(400).json({ error: 'No students selected.' });
  if (!sectionId) return res.status(400).json({ error: 'No section selected.' });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { error } = await supabase.from('users').update({ section_id: sectionId }).in('id', ids);
  if (error) {
    console.error('Bulk assign-section error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({ updatedCount: ids.length });
};
