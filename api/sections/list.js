const { getSupabaseAdmin } = require('../_supabaseAdmin');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  res.setHeader('Cache-Control', 'no-store');

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { data: rows, error } = await supabase.from('sections').select('*').order('name');
  if (error) {
    console.error('Sections list error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({
    sections: (rows || []).map(r => ({
      id: r.id, name: r.name, yearLevel: r.year_level,
      instructorId: r.instructor_id, termId: r.term_id,
    })),
  });
};
