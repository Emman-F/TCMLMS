const crypto = require('crypto');
const { getSupabaseAdmin } = require('../_supabaseAdmin');

function generateSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPassword(password, salt) { return crypto.createHash('sha256').update(salt + ':' + password).digest('hex'); }
function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = ''; for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
// Same convention the app already uses: a student's default password is their
// own surname, title-cased.
function surnamePassword(surname) {
  const s = (surname || '').trim();
  if (!s) return genPassword();
  return s.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function formatStudentName(surname, firstName, mi) {
  const miClean = (mi || '').trim().replace(/\.+$/, '');
  const miPart = miClean ? ' ' + miClean.charAt(0).toUpperCase() + '.' : '';
  return `${surname.trim()}, ${firstName.trim()}${miPart}`;
}
const STUDENT_STATUSES = ['Active', 'Inactive', 'Dropped', 'Withdrawn'];
const STUDENT_YEAR_STANDINGS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const accounts = Array.isArray((body || {}).accounts) ? body.accounts : [];
  if (!accounts.length) {
    return res.status(400).json({ error: 'No accounts provided.' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // Fetch every existing School ID once, so the whole batch can be checked for
  // duplicates without one query per row.
  const { data: existingRows, error: fetchError } = await supabase.from('users').select('school_id');
  if (fetchError) {
    console.error('Bulk import lookup error:', fetchError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
  const existingIds = new Set((existingRows || []).map(r => (r.school_id || '').toLowerCase()));

  const rowsToInsert = [];
  const created = [];
  const skipped = [];
  const seenInBatch = new Set();

  for (const acc of accounts) {
    const role = acc.role === 'instructor' ? 'instructor' : 'student';
    const schoolId = (acc.schoolId || '').toString().trim();
    let name, surname, firstName, middleInitial;

    if (role === 'student') {
      surname = (acc.surname || '').toString().trim();
      firstName = (acc.firstName || '').toString().trim();
      middleInitial = (acc.middleInitial || '').toString().trim();
      if (!surname || !firstName) { skipped.push({ schoolId, reason: 'missing surname or first name' }); continue; }
      name = formatStudentName(surname, firstName, middleInitial);
    } else {
      name = (acc.name || '').toString().trim();
      if (!name) { skipped.push({ schoolId, reason: 'missing name' }); continue; }
    }

    // Unlike the old local-only version, School ID is required here -- Supabase's
    // schema enforces school_id as unique and non-null, so an empty ID can't be
    // deferred to "add later" the way it could before.
    if (!schoolId) { skipped.push({ schoolId: '(blank)', reason: 'missing School ID' }); continue; }
    const key = schoolId.toLowerCase();
    if (existingIds.has(key)) { skipped.push({ schoolId, reason: 'already registered' }); continue; }
    if (seenInBatch.has(key)) { skipped.push({ schoolId, reason: 'duplicate within this list' }); continue; }
    seenInBatch.add(key);

    const password = role === 'student' ? surnamePassword(surname) : genPassword();
    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);

    const row = { school_id: schoolId, salt, password_hash: passwordHash, role, name };
    if (role === 'student') {
      row.surname = surname;
      row.first_name = firstName;
      row.middle_initial = middleInitial || null;
      const yearStanding = (acc.yearStanding || '').toString().trim();
      row.year_standing = STUDENT_YEAR_STANDINGS.includes(yearStanding) ? yearStanding : '1st Year';
      const status = (acc.status || '').toString().trim();
      row.status = STUDENT_STATUSES.includes(status) ? status : 'Active';
      row.section_id = null; // sections don't exist in Supabase yet -- assign later once they do
    }
    rowsToInsert.push(row);
    created.push({ name, schoolId, password });
  }

  if (!rowsToInsert.length) {
    return res.status(200).json({ created: [], skipped });
  }

  const { error: insertError } = await supabase.from('users').insert(rowsToInsert);
  if (insertError) {
    console.error('Bulk import insert error:', insertError.message);
    return res.status(500).json({ error: 'Server error while saving accounts.' });
  }

  return res.status(200).json({ created, skipped });
};
