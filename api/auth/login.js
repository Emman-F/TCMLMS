const crypto = require('crypto');
const { getSupabaseAdmin } = require('../_supabaseAdmin');

// Same algorithm the current client-side app already uses (salt + ':' + password,
// SHA-256), just running on the server now instead of in the browser. This is the
// actual security win of moving auth server-side: the correct hash is no longer
// something anyone can read via DevTools -- it never leaves this function.
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
}

// Same wording as the current client-side login error, on purpose: whether the
// school ID doesn't exist or the password is wrong, the caller sees the exact
// same message, so no one can use this endpoint to probe which IDs are real.
const GENERIC_ERROR = 'Incorrect school ID or password.';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const schoolId = ((body && body.schoolId) || '').toString().trim();
  const password = (body && body.password) || '';

  if (!schoolId || !password) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .ilike('school_id', schoolId)
    .maybeSingle();

  if (error) {
    console.error('Login lookup error:', error.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  if (!user) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  const computedHash = hashPassword(password, user.salt);
  if (computedHash !== user.password_hash) {
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  // Strip the two fields that must never reach the browser.
  const { password_hash, salt, ...safeUser } = user;

  return res.status(200).json({ user: safeUser });
};
