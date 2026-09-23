const { getSupabaseAdmin } = require('../_supabaseAdmin');

async function getOrCreateActiveTerm(supabase) {
  const { data: terms, error: fetchErr } = await supabase
    .from('terms').select('*').eq('status', 'active').limit(1);
  if (fetchErr) throw new Error(fetchErr.message);
  if (terms && terms.length) return terms[0];

  // No active term exists (e.g. after a full data reset) -- seed one, the
  // same way the old local-only version always auto-seeded a default term
  // rather than leaving the admin stuck with no way to create anything.
  const { data: created, error: insertErr } = await supabase
    .from('terms')
    .insert({ name: 'AY 2025–2026, 1st Semester', status: 'active' })
    .select().single();
  if (insertErr) throw new Error(insertErr.message);
  return created;
}

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
  const yearLevel = (body.yearLevel || '').toString().trim();
  const instructorId = (body.instructorId || '').toString().trim();

  if (!name) return res.status(400).json({ error: 'Please name the section.' });
  if (!yearLevel) return res.status(400).json({ error: 'Year level is required.' });
  if (!instructorId) return res.status(400).json({ error: 'Missing instructor.' });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let term;
  try {
    term = await getOrCreateActiveTerm(supabase);
  } catch (e) {
    console.error('Term lookup/seed error:', e.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  // Prevent the same instructor from creating two sections with the same
  // name in the same year level -- case-insensitive, so "Section A" and
  // "section a" count as the same name.
  const { data: existing, error: dupCheckError } = await supabase
    .from('sections')
    .select('id, name')
    .eq('instructor_id', instructorId)
    .eq('year_level', yearLevel);
  if (dupCheckError) {
    console.error('Duplicate-check error:', dupCheckError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
  const nameKey = name.toLowerCase();
  if ((existing || []).some(s => (s.name || '').trim().toLowerCase() === nameKey)) {
    return res.status(409).json({ error: `You already have a section named "${name}" in ${yearLevel}.` });
  }

  const { data: created, error: insertError } = await supabase
    .from('sections')
    .insert({ name, year_level: yearLevel, instructor_id: instructorId, term_id: term.id })
    .select().single();

  if (insertError) {
    console.error('Section insert error:', insertError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(201).json({
    section: {
      id: created.id, name: created.name, yearLevel: created.year_level,
      instructorId: created.instructor_id, termId: created.term_id,
    },
  });
};
