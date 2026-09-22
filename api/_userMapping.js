// The rest of this app (all 5 frontend files) has always used camelCase
// property names on user objects -- schoolId, firstName, middleInitial,
// sectionId, yearStanding -- because that's what the old localStorage
// version used. Supabase's Postgres columns are snake_case by convention
// (school_id, first_name, ...). Rather than touch every place the frontend
// reads a user property, every API endpoint converts at the boundary, so
// the rest of the app can stay exactly as it already is.

// Supabase row -> safe camelCase object for the client. Never includes
// password_hash or salt -- those must never leave the server.
function toClientUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    role: row.role,
    name: row.name,
    surname: row.surname || undefined,
    firstName: row.first_name || undefined,
    middleInitial: row.middle_initial || undefined,
    sectionId: row.section_id || null,
    yearStanding: row.year_standing || undefined,
    status: row.status || undefined,
    performanceThreshold: row.performance_threshold ?? undefined,
  };
}

module.exports = { toClientUser };
