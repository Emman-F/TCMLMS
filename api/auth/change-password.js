const crypto = require('crypto');
const { getSupabaseAdmin } = require('../_supabaseAdmin');

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + ':' + password).digest('hex');
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
  const userId = (body.userId || '').toString().trim();
  const currentPassword = (body.currentPassword || '').toString();
  const newPassword = (body.newPassword || '').toString();

  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Please fill in all fields.' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from your current one.' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.error('Supabase admin client init failed:', e.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const { data: user, error: lookupError } = await supabase
    .from('users')
    .select('id, salt, password_hash')
    .eq('id', userId)
    .maybeSingle();

  if (lookupError) {
    console.error('Change-password lookup error:', lookupError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
  if (!user) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  const currentHash = hashPassword(currentPassword, user.salt);
  if (currentHash !== user.password_hash) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = hashPassword(newPassword, newSalt);

  const { error: updateError } = await supabase
    .from('users')
    .update({ salt: newSalt, password_hash: newHash })
    .eq('id', userId);

  if (updateError) {
    console.error('Change-password update error:', updateError.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }

  return res.status(200).json({ ok: true });
};
