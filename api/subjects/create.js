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
  body = body || {};
  const name = (body.name || '').toString().trim();
  const sectionIds = Array.isArray(body.sectionIds) ? body.sectionIds.filter(Boolean) : [];
  const instructorId = (body.instructorId || '').toString().trim();

  if (!name) return res.status(400).json({ error: 'Please name the subject.' });
  if (!sectionIds.length) return res.status(400).json({ error: 'No sections in this year yet.' });
  if (!instructorId) return res.status(400).json({ error: 'Missing instructor.' });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // One row per section, same as the app has always done -- "creating a
  // subject for a year level" really means creating it in every section
  // within that year level at once.
  const rows = sectionIds.map(sectionId => ({ name, section_id: sectionId, instructor_id: instructorId }));

  const { data: created, error } = await supabase.from('subjects').insert(rows).select();
  if (error) {
    console.error('Subject insert error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(201).json({
    subjects: (created || []).map(s => ({ id: s.id, name: s.name, sectionId: s.section_id, instructorId: s.instructor_id })),
  });
};
