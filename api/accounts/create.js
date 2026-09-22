const crypto = require('crypto');
const { getSupabaseAdmin } = require('../_supabaseAdmin');
const { toClientUser } = require('../_userMapping');

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}
// Same formatting the client already uses, so a name built here reads
// identically to one built in the browser: "Surname, First M."
function formatStudentName(surname, firstName, mi) {
  const miClean = (mi || '').trim().replace(/\.+$/, '');
  const miPart = miClean ? ' ' + miClean.charAt(0).toUpperCase() + '.' : '';
  return `${surname.trim()}, ${firstName.trim()}${miPart}`;
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

  const role = body.role === 'instructor' ? 'instructor' : 'student';
  const schoolId = (body.schoolId || '').toString().trim();
  const password = (body.password || '').toString().trim();

  let name, surname, firstName, middleInitial;
  if (role === 'student') {
    surname = (body.surname || '').toString().trim();
    firstName = (body.firstName || '').toString().trim();
    middleInitial = (body.middleInitial || '').toString().trim();
    if (!surname || !firstName) {
      return res.status(400).json({ error: 'Please fill in surname and first name.' });
    }
    name = formatStudentName(surname, firstName, middleInitial);
  } else {
    name = (body.name || '').toString().trim();
    if (!name) {
      return res.status(400).json({ error: 'Please fill in the full name.' });
    }
  }

  if (!schoolId || !password) {
    return res.status(400).json({ error: 'Please fill in school ID and password.' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // Duplicate check, case-insensitive, same rule the client already enforces.
  const { data: existing, error: lookupError } = await supabase
    .from('users')
    .select('id')
    .ilike('school_id', schoolId)
    .maybeSingle();

  if (lookupError) {
    console.error('Duplicate-check error:', lookupError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
  if (existing) {
    return res.status(409).json({ error: 'That school ID is already registered.' });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);

  const row = {
    school_id: schoolId,
    salt,
    password_hash: passwordHash,
    role,
    name,
  };
  if (role === 'student') {
    row.surname = surname;
    row.first_name = firstName;
    row.middle_initial = middleInitial || null;
    row.section_id = body.sectionId || null;
    row.year_standing = body.yearStanding || '1st Year';
    row.status = body.status || 'Active';
  }

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert(row)
    .select()
    .single();

  if (insertError) {
    console.error('Account insert error:', insertError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(201).json({ user: toClientUser(created) });
};
