/* =====================================================================
   ADMIN.JS — every admin-only page and function (dashboard, accounts,
   terms, audit log, backup/restore). Depends on core.js, which must
   load first. Nothing in this file is used by instructor.js or
   student.js — that leakage was found and moved into core.js instead.
   ===================================================================== */
/* ============================= ADMIN ============================= */
// Real accounts now live in Supabase, not DB.users/localStorage. This cache
// bridges that into the existing synchronous-render architecture: the first
// time the Accounts page renders, it kicks off a fetch and shows a loading
// state; when the fetch resolves, the cache fills in and the page re-renders
// for real. Anything that changes accounts (create, for now) clears the
// cache so the next render fetches fresh data instead of showing stale rows.
let supabaseAccountsCache = null;
let supabaseAccountsLoading = false;
function loadAccountsFromServer(){
  if(supabaseAccountsLoading || supabaseAccountsCache!==null) return;
  supabaseAccountsLoading = true;
  fetch('/api/accounts/list')
    .then(r=>r.json())
    .then(data=>{
      supabaseAccountsCache = data.users || [];
      supabaseAccountsLoading = false;
      renderApp();
    })
    .catch(()=>{
      supabaseAccountsCache = [];
      supabaseAccountsLoading = false;
      showToast('Could not load accounts from the server.','err');
      renderApp();
    });
}
// Same bridge pattern, for the real Supabase-backed sections list -- used by
// the "Assign section" batch action below. Kept separate from the instructor's
// own Class page, which still manages sections locally for now.
let supabaseSectionsCache = null;
let supabaseSectionsLoading = false;
function loadSectionsFromServer(onDone){
  if(supabaseSectionsCache!==null){ if(onDone) onDone(); return; }
  if(supabaseSectionsLoading) return;
  supabaseSectionsLoading = true;
  fetch('/api/sections/list')
    .then(r=>r.json())
    .then(data=>{
      supabaseSectionsCache = data.sections || [];
      supabaseSectionsLoading = false;
      if(onDone) onDone(); else renderApp();
    })
    .catch(()=>{
      supabaseSectionsCache = [];
      supabaseSectionsLoading = false;
      showToast('Could not load sections from the server.','err');
      if(onDone) onDone(); else renderApp();
    });
}
let assignSectionCreateNew = false;
function openAssignSectionModal(){
  if(supabaseSectionsCache===null){
    openModal(`<div class="modal"><div class="modal-body" style="padding:30px;">${emptyState('layers','Loading sections…','Fetching the latest sections from the server.')}</div></div>`);
    loadSectionsFromServer(()=>{ closeModal(); openModal(assignSectionModalHtml()); });
    return;
  }
  assignSectionCreateNew = false;
  openModal(assignSectionModalHtml());
}
function assignSectionModalHtml(){
  const sections = supabaseSectionsCache || [];
  const n = selectedAccountIds.size;
  return `
  <div class="modal">
    <div class="modal-head"><h3>Assign section</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="hint" style="margin-bottom:14px;">Assigning to ${n} selected account${n===1?'':'s'}.</p>
      ${!assignSectionCreateNew ? `
        <div class="form-group"><label>Section</label>
          <select class="input" id="assign-section-select">
            ${sections.length ? sections.map(s=>`<option value="${s.id}">${esc(s.yearLevel)} · ${esc(s.name)}</option>`).join('') : `<option value="">No sections yet — create one below</option>`}
          </select>
        </div>
        <a href="#" onclick="event.preventDefault(); assignSectionCreateNew=true; openModal(assignSectionModalHtml());" style="font-size:12.8px;font-weight:700;color:var(--e-700);">+ Create a new section instead</a>
      ` : `
        <div class="row-2">
          <div class="form-group"><label>Section name</label><input class="input" id="assign-section-newname" placeholder="e.g. Section A"></div>
          <div class="form-group"><label>Year level</label>
            <select class="input" id="assign-section-newyear">
              ${STUDENT_YEAR_STANDINGS.map(y=>`<option value="${y}">${y}</option>`).join('')}
            </select>
          </div>
        </div>
        ${sections.length ? `<a href="#" onclick="event.preventDefault(); assignSectionCreateNew=false; openModal(assignSectionModalHtml());" style="font-size:12.8px;font-weight:700;color:var(--e-700);">← Pick an existing section instead</a>` : ''}
      `}
      <div id="assign-section-err" class="hint" style="color:var(--rose);display:none;margin-top:10px;"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="assign-section-btn" onclick="applyAssignSection()">${icon('save')} Assign</button></div>
  </div>`;
}
async function applyAssignSection(){
  const ids = [...selectedAccountIds];
  const errEl = document.getElementById('assign-section-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  const btn = document.getElementById('assign-section-btn');

  let sectionId;
  if(assignSectionCreateNew){
    const name = document.getElementById('assign-section-newname').value.trim();
    const yearLevel = document.getElementById('assign-section-newyear').value;
    if(!name){ showErr('Please name the section.'); return; }
    btn.disabled = true; btn.textContent = 'Creating…';
    try{
      const resp = await fetch('/api/sections/create', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({name, yearLevel, instructorId: session.id}),
      });
      const data = await resp.json();
      if(!resp.ok){ showErr(data.error || 'Could not create the section.'); btn.disabled=false; btn.textContent='Assign'; return; }
      sectionId = data.section.id;
      supabaseSectionsCache = null; // refresh so the new section shows up in the list next time
    } catch(e){
      showErr('Could not reach the server. Check your connection and try again.'); btn.disabled=false; btn.textContent='Assign'; return;
    }
  } else {
    sectionId = document.getElementById('assign-section-select').value;
    if(!sectionId){ showErr('Select a section, or create a new one.'); return; }
  }

  btn.disabled = true; btn.textContent = 'Assigning…';
  try{
    const resp = await fetch('/api/accounts/assign-section', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ids, sectionId}),
    });
    const data = await resp.json();
    if(!resp.ok){ showErr(data.error || 'Could not assign the section.'); btn.disabled=false; btn.textContent='Assign'; return; }
  } catch(e){
    showErr('Could not reach the server. Check your connection and try again.'); btn.disabled=false; btn.textContent='Assign'; return;
  }

  supabaseAccountsCache = null; // force a fresh fetch so the Section column updates
  ids.forEach(id=>selectedAccountIds.delete(id));
  closeModal();
  showToast(`${ids.length} account${ids.length===1?'':'s'} assigned.`);
  renderApp();
}
function openAssignDepartmentModal(){
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Assign department</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="hint" style="margin-bottom:14px;">Assigning to ${selectedAccountIds.size} selected account${selectedAccountIds.size===1?'':'s'} — works for students and instructors alike.</p>
      <div class="form-group"><label>Department</label>
        <select class="input" id="assign-dept-select">
          ${DEPARTMENTS.map(d=>`<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      <div id="assign-dept-err" class="hint" style="color:var(--rose);display:none;margin-top:10px;"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="assign-dept-btn" onclick="applyAssignDepartment()">${icon('save')} Assign</button></div>
  </div>`);
}
async function applyAssignDepartment(){
  const ids = [...selectedAccountIds];
  const department = document.getElementById('assign-dept-select').value;
  const errEl = document.getElementById('assign-dept-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  const btn = document.getElementById('assign-dept-btn');
  btn.disabled = true; btn.textContent = 'Assigning…';
  let data;
  try{
    const resp = await fetch('/api/accounts/assign-department', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ids, department}),
    });
    data = await resp.json();
    if(!resp.ok){ showErr(data.error || 'Could not assign the department.'); btn.disabled=false; btn.textContent='Assign'; return; }
  } catch(e){
    showErr('Could not reach the server. Check your connection and try again.'); btn.disabled=false; btn.textContent='Assign'; return;
  }
  supabaseAccountsCache = null; // force a fresh fetch so the Department column updates
  ids.forEach(id=>selectedAccountIds.delete(id));
  closeModal();
  showToast(`${ids.length} account${ids.length===1?'':'s'} assigned.`);
  renderApp();
}
function openAdminChangePasswordModal(){
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Change password</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Current password</label><input class="input" type="password" id="cp-current" autocomplete="current-password"></div>
      <div class="form-group"><label>New password</label><input class="input" type="password" id="cp-new" autocomplete="new-password"></div>
      <div class="form-group"><label>Confirm new password</label><input class="input" type="password" id="cp-confirm" autocomplete="new-password"></div>
      <div id="cp-err" class="hint" style="color:var(--rose);display:none;"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="cp-save-btn" onclick="saveAdminChangePassword()">${icon('save')} Update password</button></div>
  </div>`);
}
async function saveAdminChangePassword(){
  const current = document.getElementById('cp-current').value;
  const next = document.getElementById('cp-new').value;
  const confirmVal = document.getElementById('cp-confirm').value;
  const errEl = document.getElementById('cp-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  if(!current || !next || !confirmVal){ showErr('Please fill in all three fields.'); return; }
  if(next !== confirmVal){ showErr('New password and confirmation don\'t match.'); return; }

  const btn = document.getElementById('cp-save-btn');
  btn.disabled = true;
  btn.textContent = 'Updating…';
  let data;
  try{
    const resp = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({userId: session.id, currentPassword: current, newPassword: next}),
    });
    data = await resp.json();
    if(!resp.ok){
      showErr(data.error || 'Could not update your password.');
      btn.disabled = false;
      btn.textContent = 'Update password';
      return;
    }
  } catch(e){
    showErr('Could not reach the server. Check your connection and try again.');
    btn.disabled = false;
    btn.textContent = 'Update password';
    return;
  }
  closeModal();
  showToast('Password updated.');
}
function adminDashboard(){
  if(supabaseAccountsCache===null || supabaseSectionsCache===null){
    loadAccountsFromServer();
    loadSectionsFromServer();
    return `<div class="card card-pad">${emptyState('layers','Loading dashboard…','Fetching the latest account data from the server.')}</div>`;
  }
  const allAccounts = supabaseAccountsCache;
  const instructors = allAccounts.filter(u=>u.role==='instructor');
  const students = allAccounts.filter(u=>u.role==='student');
  const unassignedStudents = students.filter(s=>!s.sectionId);
  const emptySections = supabaseSectionsCache.filter(sec=> !DB.subjects.some(sub=>sub.sectionId===sec.id));
  const needsGradingCount = DB.submissions.filter(s=>{
    const a = assessmentById(s.assessmentId);
    return a && !submissionFullyGraded(s, a);
  }).length;

  return `
  <div class="hint" style="margin-bottom:10px;">Current term: ${esc(activeTerm().name)}</div>
  <div class="grid grid-4" style="margin-bottom:16px;">
    ${statCard('users','Instructors', instructors.length)}
    ${statCard('users','Students', students.length)}
    ${statCard('layers','Sections', supabaseSectionsCache.length)}
    ${statCard('book','Subjects', DB.subjects.length)}
  </div>
  <div class="grid grid-4" style="margin-bottom:22px;">
    ${statCard('clip','Assessments', DB.assessments.length)}
    ${statCard('check','Submissions', DB.submissions.length)}
    ${statCard('clip','Needs grading', needsGradingCount, needsGradingCount>0)}
    ${statCard('calendar','Attendance records', DB.attendance.length)}
  </div>
  <div class="grid grid-2">
    <div class="card card-pad">
      <div class="section-title">Needs attention</div>
      <div class="section-desc">Structural gaps worth a look.</div>
      ${(unassignedStudents.length || emptySections.length || needsGradingCount) ? `<div class="kv-list">
        ${unassignedStudents.length ? `<div class="kv-row"><span>${unassignedStudents.length} student${unassignedStudents.length===1?'':'s'} with no section assigned</span><button class="btn btn-outline btn-sm" onclick="setView('admin-accounts',{roleFilter:'student'})">View</button></div>` : ''}
        ${emptySections.length ? `<div class="kv-row"><span>${emptySections.length} section${emptySections.length===1?'':'s'} with no subjects yet</span><span class="hint" style="text-align:right;">${emptySections.slice(0,3).map(s=>esc(s.name)).join(', ')}${emptySections.length>3?'…':''}</span></div>` : ''}
        ${needsGradingCount ? `<div class="kv-row"><span>${needsGradingCount} submission${needsGradingCount===1?'':'s'} awaiting grading school-wide</span></div>` : ''}
      </div>` : emptyState('check','Nothing needs attention','Everything looks in order right now.')}
    </div>
    <div class="card card-pad">
      <div class="section-title">Sections overview</div>
      <div class="section-desc">Class sections created by instructors.</div>
      ${DB.sections.length? `<div class="kv-list">${DB.sections.map(s=>`
        <div class="kv-row"><span>${esc(s.name)} · ${esc(s.yearLevel)}</span><span style="color:var(--muted)">${studentsInSection(s.id).length} students</span></div>`).join('')}</div>`
        : emptyState('layers','No sections yet','Instructors haven\'t created sections yet.')}
    </div>
  </div>`;
}
function filteredAccountsList(){
  const q = (params.q||'').toLowerCase();
  const roleFilter = params.roleFilter || 'all';
  const yearFilter = params.yearFilter || 'all';
  const statusFilter = params.statusFilter || 'all';
  let list = (supabaseAccountsCache || []).filter(u=>u.id!==session.id);
  if(roleFilter!=='all') list = list.filter(u=>u.role===roleFilter);
  if(yearFilter!=='all') list = list.filter(u=>u.role==='student' && u.yearStanding===yearFilter);
  if(statusFilter!=='all') list = list.filter(u=>u.role==='student' && u.status===statusFilter);
  if(q) list = list.filter(u=> u.name.toLowerCase().includes(q) || u.schoolId.toLowerCase().includes(q));
  return [...list].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
}
function adminAccounts(){
  if(supabaseAccountsCache===null || supabaseSectionsCache===null){
    loadAccountsFromServer();
    loadSectionsFromServer();
    return `<div class="card card-pad">${emptyState('layers','Loading accounts…','Fetching the latest accounts from the server.')}</div>`;
  }
  const roleFilter = params.roleFilter || 'all';
  const yearFilter = params.yearFilter || 'all';
  const statusFilter = params.statusFilter || 'all';
  const list = filteredAccountsList();

  return `
  <div class="toolbar">
    <div class="toolbar-left" style="flex-wrap:wrap;">
      <input class="input" id="admin-accounts-search" style="width:220px;" placeholder="Search name or school ID…" value="${esc(params.q||'')}" oninput="liveSearch('q', this.value)">
      <select class="input" style="width:150px;" onchange="params.roleFilter=this.value; renderApp()">
        <option value="all" ${roleFilter==='all'?'selected':''}>All roles</option>
        <option value="instructor" ${roleFilter==='instructor'?'selected':''}>Instructors</option>
        <option value="student" ${roleFilter==='student'?'selected':''}>Students</option>
      </select>
      <select class="input" style="width:150px;" onchange="params.yearFilter=this.value; renderApp()">
        <option value="all" ${yearFilter==='all'?'selected':''}>All years</option>
        ${STUDENT_YEAR_STANDINGS.map(y=>`<option value="${y}" ${yearFilter===y?'selected':''}>${y}</option>`).join('')}
      </select>
      <select class="input" style="width:150px;" onchange="params.statusFilter=this.value; renderApp()">
        <option value="all" ${statusFilter==='all'?'selected':''}>All statuses</option>
        ${STUDENT_STATUSES.map(s=>`<option value="${s}" ${statusFilter===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="btn btn-outline btn-sm" onclick="exportAccountsCSV()">${icon('down')} Download CSV</button>
      ${selectedAccountIds.size? `<button class="btn btn-outline btn-sm" onclick="openBatchPasswordModal()">${icon('key')} Set password (${selectedAccountIds.size})</button>
      <button class="btn btn-outline btn-sm" onclick="openAssignSectionModal()">${icon('layers')} Assign section (${selectedAccountIds.size})</button>
      <button class="btn btn-outline btn-sm" onclick="openAssignDepartmentModal()">${icon('layers')} Assign department (${selectedAccountIds.size})</button>
      <button class="btn btn-outline btn-sm" style="color:var(--rose);border-color:var(--rose);" onclick="deleteSelectedAccounts()">${icon('trash')} Delete (${selectedAccountIds.size})</button>` : ''}
    </div>
    <div class="toolbar-left">
      <button class="btn btn-outline btn-sm" onclick="openBulkImportModal(true)">${icon('up')} Bulk add</button>
      <button class="btn btn-primary btn-sm" onclick="openAddAccountModal()">${icon('plus')} Add account</button>
    </div>
  </div>
  <div class="card">
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th><input type="checkbox" class="checkbox" onchange="toggleSelectAll(this.checked)" ${list.length && list.every(u=>selectedAccountIds.has(u.id))?'checked':''}></th>
        <th>Name</th><th>School ID</th><th>Role</th><th>Department</th><th>Section</th><th>Year standing</th><th>Status</th><th>Password</th><th></th>
      </tr></thead>
      <tbody>
        ${list.length ? list.map(u=>`
          <tr>
            <td><input type="checkbox" class="checkbox" ${selectedAccountIds.has(u.id)?'checked':''} onchange="toggleSelectOne('${u.id}', this.checked)"></td>
            <td style="font-weight:700;color:var(--e-950);">${esc(u.name)}</td>
            <td style="color:var(--muted);">${esc(u.schoolId)}</td>
            <td><span class="badge badge-neutral" style="text-transform:capitalize;">${u.role}</span></td>
            <td>${u.department ? esc(u.department) : '<span style="color:var(--muted)">Unassigned</span>'}</td>
            <td>${u.role==='student' ? (sectionById(u.sectionId)? esc(sectionById(u.sectionId).name) : '<span style="color:var(--muted)">Unassigned</span>') : '<span class="hint">—</span>'}</td>
            <td>${u.role==='student' ? esc(u.yearStanding||'—') : '<span class="hint">—</span>'}</td>
            <td>${u.role==='student' ? statusBadge(u.status) : '<span class="hint">—</span>'}</td>
            <td><button class="btn btn-outline btn-sm" onclick="openResetPasswordModal('${u.id}')">${icon('key')} Reset</button></td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" onclick="openEditAccountModal('${u.id}')" aria-label="Edit account">${icon('edit')}</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteAccount('${u.id}')" aria-label="Delete account">${icon('trash')}</button>
            </td>
          </tr>`).join('')
        : `<tr><td colspan="10">${emptyState('users','No accounts found','Try a different search or add a new account.')}</td></tr>`}
      </tbody>
    </table>
    </div>
  </div>`;
}
function toggleSelectAll(checked){
  const list = filteredAccountsList();
  if(checked) list.forEach(u=>selectedAccountIds.add(u.id)); else list.forEach(u=>selectedAccountIds.delete(u.id));
  renderApp();
}
function exportAccountsCSV(){
  const list = filteredAccountsList();
  const header = ['Name','School ID','Role','Department','Section','Year Standing','Status'];
  const rows = [header, ...list.map(u=>[
    u.name, u.schoolId, u.role, u.department || '',
    u.role==='student' ? (sectionById(u.sectionId)?sectionById(u.sectionId).name:'Unassigned') : '',
    u.role==='student' ? (u.yearStanding||'') : '',
    u.role==='student' ? (u.status||'') : '',
  ])];
  const stamp = new Date().toISOString().slice(0,10);
  downloadCSV(`accounts_${stamp}.csv`, rows);
}

function openAddAccountModal(){
  autoPasswordEdited = false;
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Add account</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Role</label>
        <select class="input" id="f-role" onchange="toggleAccountRoleFields(this.value)">
          <option value="instructor">Instructor</option>
          <option value="student">Student</option>
        </select>
      </div>
      <div id="f-name-instructor">
        <div class="form-group"><label>Full name</label><input class="input" id="f-name" placeholder="e.g. Maria Santos"></div>
      </div>
      <div id="f-name-student" style="display:none;">
        <div class="row-2">
          <div class="form-group"><label>Surname</label><input class="input" id="f-surname" placeholder="e.g. Dela Cruz" oninput="updateSurnameLivePassword()"></div>
          <div class="form-group"><label>First name</label><input class="input" id="f-firstname" placeholder="e.g. Juan"></div>
        </div>
        <div class="form-group" style="max-width:170px;"><label>Middle initial (optional)</label><input class="input" id="f-mi" maxlength="4" placeholder="e.g. D"></div>
      </div>
      <div class="row-2">
        <div class="form-group"><label>School ID</label><input class="input" id="f-username" placeholder="e.g. 20223059" inputmode="numeric"></div>
        <div class="form-group"><label>Password</label><input class="input" id="f-password" value="${genPassword()}" oninput="autoPasswordEdited=true;">
          <div class="hint" id="f-password-hint" style="display:none;">Defaults to the student's surname, e.g. Felices.</div>
        </div>
      </div>
      <div id="f-section-wrap">
        <div class="form-group">
          <label>Section</label>
          <select class="input" id="f-section">
            <option value="">— No section yet —</option>
            ${DB.sections.map(s=>`<option value="${s.id}">${esc(s.name)} · ${esc(s.yearLevel)}</option>`).join('')}
          </select>
        </div>
        <div class="row-2">
          <div class="form-group"><label>Year standing</label>
            <select class="input" id="f-standing">
              ${STUDENT_YEAR_STANDINGS.map(y=>`<option value="${y}">${y}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Status</label>
            <select class="input" id="f-status">
              ${STUDENT_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="save-account-btn" onclick="saveNewAccount()">${icon('save')} Save account</button></div>
  </div>`);
}
function toggleAccountRoleFields(role){
  const isStudent = role==='student';
  document.getElementById('f-name-instructor').style.display = isStudent ? 'none' : 'block';
  document.getElementById('f-name-student').style.display = isStudent ? 'block' : 'none';
  document.getElementById('f-section-wrap').style.display = isStudent ? 'block' : 'none';
  const hint = document.getElementById('f-password-hint');
  if(hint) hint.style.display = isStudent ? 'block' : 'none';
  if(isStudent) updateSurnameLivePassword();
}
let autoPasswordEdited = false;
async function saveNewAccount(){
  const roleEl = document.getElementById('f-role');
  const role = roleEl ? roleEl.value : 'student';
  const schoolId = document.getElementById('f-username').value.trim();
  const password = document.getElementById('f-password').value.trim();
  const sectionId = document.getElementById('f-section') ? document.getElementById('f-section').value : '';

  let name, surname, firstName, middleInitial;
  const payload = {role, schoolId, password};
  if(role==='student'){
    surname = document.getElementById('f-surname').value.trim();
    firstName = document.getElementById('f-firstname').value.trim();
    middleInitial = document.getElementById('f-mi').value.trim();
    if(!surname || !firstName){ showToast('Please fill in surname and first name.','err'); return; }
    name = formatStudentName(surname, firstName, middleInitial);
    payload.surname = surname; payload.firstName = firstName; payload.middleInitial = middleInitial;
    payload.sectionId = sectionId || null;
    payload.yearStanding = document.getElementById('f-standing').value;
    payload.status = document.getElementById('f-status').value;
  } else {
    name = document.getElementById('f-name').value.trim();
    if(!name){ showToast('Please fill in the full name.','err'); return; }
    payload.name = name;
  }
  if(!schoolId || !password){ showToast('Please fill in school ID and password.','err'); return; }

  const btn = document.getElementById('save-account-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  let data;
  try{
    const resp = await fetch('/api/accounts/create', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
    data = await resp.json();
    if(!resp.ok){
      showToast(data.error || 'Could not create the account.', 'err');
      btn.disabled = false;
      btn.textContent = 'Save account';
      return;
    }
  } catch(e){
    showToast('Could not reach the server. Check your connection and try again.', 'err');
    btn.disabled = false;
    btn.textContent = 'Save account';
    return;
  }

  supabaseAccountsCache = null; // force a fresh fetch next time the Accounts page renders
  closeModal();
  showToast('Account created.');
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Account created</h3><button class="modal-close" onclick="closeModal(); renderApp();">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="hint" style="margin-bottom:10px;">This password won't be shown again — copy it now.</p>
      <div class="kv-list">
        <div class="kv-row"><span>Name</span><span>${esc(name)}</span></div>
        <div class="kv-row"><span>School ID</span><span>${esc(schoolId)}</span></div>
        <div class="kv-row"><span>Password</span><code>${esc(password)}</code></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal(); renderApp();">Done</button></div>
  </div>`);
}
async function saveEditAccount(id){
  const u = userById(id);
  const schoolId = document.getElementById('f-username').value.trim();
  const password = document.getElementById('f-password').value.trim();

  let name;
  if(u.role==='student'){
    const surname = document.getElementById('f-surname').value.trim();
    const firstName = document.getElementById('f-firstname').value.trim();
    const middleInitial = document.getElementById('f-mi').value.trim();
    if(!surname || !firstName){ showToast('Please fill in surname and first name.','err'); return; }
    name = formatStudentName(surname, firstName, middleInitial);
    u.surname = surname; u.firstName = firstName; u.middleInitial = middleInitial;
  } else {
    name = document.getElementById('f-name').value.trim();
    if(!name){ showToast('Please fill in the full name.','err'); return; }
  }
  if(!schoolId){ showToast('Please fill in the school ID.','err'); return; }
  if(DB.users.some(x=>x.id!==id && x.schoolId.toLowerCase()===schoolId.toLowerCase())){ showToast('That school ID is already registered.','err'); return; }
  u.name=name; u.schoolId=schoolId;
  if(password){ u.salt = generateSalt(); u.passwordHash = await hashPassword(password, u.salt); }
  if(u.role==='student'){
    const sec = document.getElementById('f-section'); u.sectionId = sec.value || null;
    u.yearStanding = document.getElementById('f-standing').value;
    u.status = document.getElementById('f-status').value;
  }
  await persist('users'); closeModal(); showToast('Account updated.'); renderApp();
}
async function deleteAccount(id){
  const u = userById(id);
  if(!u){ showToast('Could not find that account. Try refreshing the page.','err'); return; }
  let msg = `Remove ${u.name}'s account?`;
  if(u.role==='student'){
    const subCount = DB.submissions.filter(s=>s.studentId===id).length;
    const attCount = DB.attendance.filter(a=>a.studentId===id).length;
    if(subCount || attCount){
      msg += ` This also removes ${subCount} submission${subCount===1?'':'s'} and ${attCount} attendance record${attCount===1?'':'s'} tied to them.`;
    }
  } else if(u.role==='instructor'){
    const secCount = DB.sections.filter(s=>s.instructorId===id).length;
    if(secCount){
      msg += ` They still own ${secCount} section${secCount===1?'':'s'} — those (and their subjects, assessments, submissions, and attendance) will be left ownerless, not deleted. Reassign or remove those sections first if that's not what you want.`;
    }
  }
  msg += ` This can't be undone.`;
  if(!confirm(msg)) return;

  let data;
  try{
    const resp = await fetch('/api/accounts/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids: [id]}),
    });
    data = await resp.json();
    if(!resp.ok){ showToast(data.error || 'Could not remove the account.', 'err'); return; }
  } catch(e){
    showToast('Could not reach the server. Check your connection and try again.', 'err');
    return;
  }

  DB.users = DB.users.filter(x=>x.id!==id); // harmless if it was never local to begin with
  selectedAccountIds.delete(id);
  if(u.role==='student'){
    DB.submissions = DB.submissions.filter(s=>s.studentId!==id);
    DB.attendance = DB.attendance.filter(a=>a.studentId!==id);
    Promise.all(['users','submissions','attendance'].map(persist));
  } else {
    persist('users');
  }
  supabaseAccountsCache = null; // force a fresh fetch so the account actually disappears from the list
  showToast('Account removed.'); renderApp();
}
async function deleteSelectedAccounts(){
  const ids = [...selectedAccountIds];
  const selected = ids.map(userById).filter(Boolean);
  const students = selected.filter(u=>u.role==='student');
  const skipped = selected.filter(u=>u.role!=='student');
  if(!students.length){
    showToast(skipped.length ? 'Select at least one student — other roles must be removed one at a time.' : 'Nothing selected.', 'err');
    return;
  }
  const studentIds = students.map(u=>u.id);
  const subCount = DB.submissions.filter(s=>studentIds.includes(s.studentId)).length;
  const attCount = DB.attendance.filter(a=>studentIds.includes(a.studentId)).length;
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Remove ${students.length} student${students.length===1?'':'s'}?</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;margin-bottom:14px;">
        ${students.map(u=>`<div style="font-size:12.8px;font-weight:600;color:var(--ink-soft);">${esc(u.name)} <span class="hint">(${esc(u.schoolId)})</span></div>`).join('')}
      </div>
      <div class="hint" style="margin-bottom:10px;">This also removes ${subCount} submission${subCount===1?'':'s'} and ${attCount} attendance record${attCount===1?'':'s'} tied to them. Their grade audit log history stays intact, since that's a record of what an instructor did, not of the student's account.</div>
      ${skipped.length ? `<div class="hint" style="color:var(--rose);">${skipped.length} non-student account${skipped.length===1?'':'s'} in your selection (${skipped.map(u=>esc(u.name)).join(', ')}) will be skipped — remove instructor accounts one at a time.</div>` : ''}
      <p style="font-size:12.8px;font-weight:700;color:var(--rose);margin-top:14px;">This can't be undone.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="confirm-delete-btn" style="background:var(--rose);" onclick="confirmDeleteSelectedAccounts()">${icon('trash')} Remove ${students.length} student${students.length===1?'':'s'}</button></div>
  </div>`);
}
async function confirmDeleteSelectedAccounts(){
  const ids = [...selectedAccountIds];
  const students = ids.map(userById).filter(u=>u && u.role==='student');
  const studentIds = students.map(u=>u.id);
  if(!studentIds.length){ closeModal(); return; }

  const btn = document.getElementById('confirm-delete-btn');
  if(btn){ btn.disabled = true; btn.textContent = 'Removing…'; }
  let data;
  try{
    const resp = await fetch('/api/accounts/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids: studentIds}),
    });
    data = await resp.json();
    if(!resp.ok){
      showToast(data.error || 'Could not remove the selected students.', 'err');
      if(btn){ btn.disabled = false; btn.textContent = `Remove ${students.length} student${students.length===1?'':'s'}`; }
      return;
    }
  } catch(e){
    showToast('Could not reach the server. Check your connection and try again.', 'err');
    if(btn){ btn.disabled = false; btn.textContent = `Remove ${students.length} student${students.length===1?'':'s'}`; }
    return;
  }

  DB.users = DB.users.filter(u=>!studentIds.includes(u.id));
  DB.submissions = DB.submissions.filter(s=>!studentIds.includes(s.studentId));
  DB.attendance = DB.attendance.filter(a=>!studentIds.includes(a.studentId));
  studentIds.forEach(id=>selectedAccountIds.delete(id));
  supabaseAccountsCache = null; // force a fresh fetch so removed students actually disappear
  Promise.all(['users','submissions','attendance'].map(persist)).then(()=>{
    closeModal();
    showToast(`${students.length} student${students.length===1?'':'s'} removed.`);
    renderApp();
  });
}
async function applyResetPassword(id){
  const u = userById(id);
  const newPass = document.getElementById('rp-pass').value.trim();
  if(!newPass){ showToast('Enter a password.','err'); return; }
  u.salt = generateSalt();
  u.passwordHash = await hashPassword(newPass, u.salt);
  await persist('users');
  closeModal();
  showToast(`Password updated for ${u.name}.`);
  renderApp();
}
function toggleBatchMode(mode){ document.getElementById('bp-same-wrap').style.display = mode==='same'?'block':'none'; }
async function applyBatchPassword(){
  const mode = document.querySelector('input[name="bp-mode"]:checked').value;
  const results = [];
  for(const id of selectedAccountIds){
    const u = userById(id); if(!u) continue;
    const newPass = mode==='same' ? document.getElementById('bp-same-pass').value.trim() : (u.role==='student' ? surnamePassword(u.surname||u.name) : genPassword());
    u.salt = generateSalt();
    u.passwordHash = await hashPassword(newPass, u.salt);
    results.push({name:u.name, schoolId:u.schoolId, password:newPass});
  }
  await persist('users');
  showToast(`Password${results.length>1?'s':''} updated for ${results.length} account(s).`);
  selectedAccountIds.clear();
  closeModal();
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>New passwords</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="hint" style="margin-bottom:10px;">Share these with each person securely.</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>School ID</th><th>Password</th></tr></thead>
      <tbody>${results.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.schoolId)}</td><td><code>${esc(r.password)}</code></td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal(); renderApp();">Done</button></div>
  </div>`);
}
let bulkImportMode = 'student';
function splitCells(line){
  const delim = line.includes('\t') ? '\t' : ',';
  return line.split(delim).map(c=>c.trim());
}
function looksLikeHeaderRow(cells, mode){
  const first = (cells[0]||'').toLowerCase();
  return mode==='student' ? first==='surname' : (first==='name'||first==='full name');
}
let bulkImportYear = null;
function bulkImportModalHtml(allowInstructors){
  const yearSuffix = bulkImportYear ? ` — ${esc(bulkImportYear)}` : '';
  return `
  <div class="modal wide">
    <div class="modal-head"><h3>Bulk add ${bulkImportMode==='student'?'students':'instructors'}${yearSuffix}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      ${allowInstructors ? `
      <div class="tabs" style="margin-bottom:14px;">
        <div class="tab ${bulkImportMode==='student'?'active':''}" onclick="setBulkImportMode('student', ${allowInstructors})">Students</div>
        <div class="tab ${bulkImportMode==='instructor'?'active':''}" onclick="setBulkImportMode('instructor', ${allowInstructors})">Instructors</div>
      </div>` : ''}
      <p class="hint" style="margin-bottom:6px;">${bulkImportColumnsHint()}</p>
      <p class="hint" style="margin-bottom:10px;">Paste rows below, or upload a .csv file exported from Excel or Google Sheets — either comma or tab separated works. A header row is fine, it's detected and skipped automatically. ${bulkImportMode==='student' ? "Each student's password defaults to their surname (e.g. Felices)." : 'Passwords are generated for you.'}</p>
      <input type="file" id="bulk-file" accept=".csv,.txt,text/csv,text/plain" style="margin-bottom:10px;" onchange="handleBulkFileSelect(this)">
      <textarea class="input" id="bulk-text" rows="7" placeholder="${bulkImportPlaceholder()}"></textarea>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="bulk-import-btn" onclick="applyBulkImport()">${icon('up')} Add ${bulkImportMode==='student'?'students':'instructors'}</button></div>
  </div>`;
}
function bulkImportColumnsHint(){
  if(bulkImportMode!=='student') return 'Columns: <code>Full Name, School ID</code>.';
  return bulkImportYear
    ? `Columns: <code>Surname, First Name, Middle Initial, School ID, Section, Status</code>. Middle Initial, School ID, Section, and Status are optional — leave School ID out if a student doesn't have one yet (add it later from Edit Account). Every student here is added as ${esc(bulkImportYear)}.`
    : 'Columns: <code>Surname, First Name, Middle Initial, School ID, Section, Year Standing, Status</code>. Middle Initial, School ID, Section, Year Standing, and Status are optional — leave School ID out if a student doesn\'t have one yet.';
}
function bulkImportPlaceholder(){
  if(bulkImportMode!=='student') return 'Ana Reyes, 20190042\nMark Santos, 20180011';
  return bulkImportYear
    ? 'Dela Cruz, Juan, D, 20223059, Section A, Active\nAbad, Liza, , 20223060, Section A, Active'
    : 'Dela Cruz, Juan, D, 20223059, Section A, 2nd Year, Active\nAbad, Liza, , 20223060, Section A, 2nd Year, Active';
}
function setBulkImportMode(mode, allowInstructors){
  bulkImportMode = mode;
  openModal(bulkImportModalHtml(allowInstructors));
}
function handleBulkFileSelect(input){
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('bulk-text').value = reader.result; };
  reader.onerror = () => showToast('Could not read that file.','err');
  reader.readAsText(file);
}
async function applyBulkImport(){
  const raw = document.getElementById('bulk-text').value;
  const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
  const candidates = []; const preSkipped = [];
  const mode = bulkImportMode;
  const yearLock = bulkImportYear;

  for(const line of lines){
    const cells = splitCells(line);
    if(looksLikeHeaderRow(cells, mode)) continue;

    if(mode==='student'){
      let parts = [...cells];
      const expectedCols = yearLock ? 6 : 7;
      if(parts.length === expectedCols - 1) parts.splice(3, 0, '');
      const [surname, firstName, middleInitial, schoolIdRaw, sectionName, col6, col7] = parts;
      const schoolId = (schoolIdRaw||'').trim();
      const yearStanding = yearLock || col6;
      const status = yearLock ? col6 : col7;
      if(!surname || !firstName){ preSkipped.push(line); continue; }
      candidates.push({role:'student', surname, firstName, middleInitial: middleInitial||'', schoolId, yearStanding, status});
    } else {
      const [name, schoolId] = cells;
      if(!name || !schoolId){ preSkipped.push(line); continue; }
      candidates.push({role:'instructor', name, schoolId});
    }
  }

  if(!candidates.length){
    showToast('No accounts were added — check the format.','err');
    return;
  }

  const btn = document.getElementById('bulk-import-btn');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  let data;
  try{
    const resp = await fetch('/api/accounts/bulk-create', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({accounts: candidates}),
    });
    data = await resp.json();
    if(!resp.ok){
      showToast(data.error || 'Could not import accounts.', 'err');
      btn.disabled = false;
      btn.textContent = `Add ${mode==='student'?'students':'instructors'}`;
      return;
    }
  } catch(e){
    showToast('Could not reach the server. Check your connection and try again.', 'err');
    btn.disabled = false;
    btn.textContent = `Add ${mode==='student'?'students':'instructors'}`;
    return;
  }

  const created = data.created || [];
  const skipped = [...preSkipped, ...(data.skipped||[]).map(s=>`${s.schoolId} (${s.reason})`)];
  supabaseAccountsCache = null; // force a fresh fetch so imported accounts actually show up
  closeModal();
  if(created.length===0){ showToast('No accounts were added — check the format.','err'); renderApp(); return; }
  openModal(`
  <div class="modal wide">
    <div class="modal-head"><h3>Import complete</h3><button class="modal-close" onclick="closeModal(); renderApp();">${icon('x')}</button></div>
    <div class="modal-body">
      <p class="hint" style="margin-bottom:10px;">${created.length} added${skipped.length? `, ${skipped.length} skipped`:''}.</p>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>School ID</th><th>Password</th></tr></thead>
      <tbody>${created.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.schoolId)}</td><td><code>${esc(r.password)}</code></td></tr>`).join('')}</tbody></table></div>
      ${skipped.length? `<p class="hint" style="margin-top:12px;color:var(--rose);">Skipped: ${skipped.map(esc).join(' · ')}</p>`:''}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal(); renderApp();">Done</button></div>
  </div>`);
}

function adminTerms(){
  const terms = [...DB.terms].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const active = activeTerm();
  return `
  <div class="card card-pad" style="margin-bottom:18px;">
    <div class="section-title">Current term</div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:10px;">
      <div>
        <div style="font-size:20px;font-weight:800;color:var(--e-900);">${esc(active.name)}</div>
        <div class="hint">Sections, subjects, and students added anywhere in the system belong to this term.</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openStartNewTermModal()">${icon('plus')} Start new term</button>
    </div>
  </div>
  <div class="card">
    <div class="table-wrap"><table>
      <thead><tr><th>Term</th><th>Status</th><th>Sections</th><th></th></tr></thead>
      <tbody>${terms.map(t=>{
        const secCount = DB.sections.filter(s=>(s.termId||active.id)===t.id).length;
        return `<tr>
          <td style="font-weight:700;color:var(--e-950);">${esc(t.name)}</td>
          <td>${t.status==='active' ? '<span class="badge badge-present">Active</span>' : '<span class="badge badge-neutral">Archived</span>'}</td>
          <td>${secCount}</td>
          <td style="text-align:right;"><button class="btn btn-ghost btn-sm" onclick="openRenameTermModal('${t.id}')" aria-label="Rename term">${icon('edit')}</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}
function openStartNewTermModal(){
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Start a new term</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Term name</label><input class="input" id="f-termname" placeholder="e.g. AY 2026–2027, 1st Semester"></div>
      <p class="hint">"${esc(activeTerm().name)}" will be archived — its sections, subjects, and records stay exactly as they are, viewable read-only from Class pages, but new sections and students go into the new term instead.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="startNewTerm()">${icon('save')} Archive current & start new</button></div>
  </div>`);
}
function startNewTerm(){
  const name = document.getElementById('f-termname').value.trim();
  if(!name){ showToast('Please name the new term.','err'); return; }
  const cur = activeTerm();
  if(cur) cur.status = 'archived';
  DB.terms.push({id:uid(), name, status:'active', createdAt:Date.now()});
  persist('terms');
  closeModal();
  showToast('New term started — the previous term is now archived.');
  renderApp();
}
function openRenameTermModal(id){
  const t = DB.terms.find(x=>x.id===id);
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Rename term</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Term name</label><input class="input" id="f-termname-edit" value="${esc(t.name)}"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveRenameTerm('${id}')">${icon('save')} Save</button></div>
  </div>`);
}
function saveRenameTerm(id){
  const t = DB.terms.find(x=>x.id===id);
  const name = document.getElementById('f-termname-edit').value.trim();
  if(!name){ showToast('Please enter a name.','err'); return; }
  t.name = name;
  persist('terms');
  closeModal();
  renderApp();
}
function adminAudit(){
  let entries = [...DB.auditLog].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  const q = (params.auditQ||'').toLowerCase();
  if(q) entries = entries.filter(e=>
    (e.studentName||'').toLowerCase().includes(q) ||
    (e.actorName||'').toLowerCase().includes(q) ||
    (e.assessmentTitle||'').toLowerCase().includes(q)
  );
  const searchBox = `<div class="toolbar" style="margin-bottom:14px;"><div class="toolbar-left">
    <input class="input" id="admin-audit-search" style="width:260px;" placeholder="Search student, instructor, or assessment…" value="${esc(params.auditQ||'')}" oninput="liveSearch('auditQ', this.value)">
  </div></div>`;
  if(!DB.auditLog.length) return `<div class="card">${emptyState('clip','No grade changes recorded yet','Every essay score an instructor sets or edits will show up here.')}</div>`;
  if(!entries.length) return searchBox + `<div class="card">${emptyState('clip','No matching changes','Try a different search.')}</div>`;
  return searchBox + `
  <div class="card">
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Instructor</th><th>Student</th><th>Assessment</th><th>Action</th><th>Before</th><th>After</th></tr></thead>
      <tbody>${entries.map(e=>{
        const subj = subjectById(e.subjectId);
        return `<tr>
          <td class="hint">${new Date(e.timestamp).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</td>
          <td style="font-weight:700;">${esc(e.actorName)}</td>
          <td>${esc(e.studentName)}</td>
          <td>${esc(e.assessmentTitle)}${subj?` <span class="hint">— ${esc(subj.name)}</span>`:''}</td>
          <td><span class="badge ${e.action==='Edited essay grade'?'badge-late':'badge-present'}">${esc(e.action)}</span></td>
          <td>${e.before===null ? '<span class="hint">—</span>' : `${e.before}/${e.total}`}</td>
          <td style="font-weight:700;color:var(--e-800);">${e.after}/${e.total}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}
function adminBackup(){
  return `
  <div class="grid grid-2">
    <div class="card card-pad">
      <div class="stat-icon">${icon('down')}</div>
      <div class="section-title">Export a backup</div>
      <div class="section-desc">Download every account, section, subject, assessment, submission, and attendance record as one JSON file.</div>
      <button class="btn btn-primary" onclick="exportBackup()">${icon('down')} Download backup</button>
    </div>
    <div class="card card-pad">
      <div class="stat-icon">${icon('up')}</div>
      <div class="section-title">Restore from backup</div>
      <div class="section-desc">Replace current data with a previously exported file. This can't be undone.</div>
      <input type="file" id="restore-file" accept="application/json" style="display:none;" onchange="handleRestoreFile(this)">
      <button class="btn btn-outline" onclick="document.getElementById('restore-file').click()">${icon('up')} Choose backup file</button>
    </div>
  </div>
  <div class="card card-pad" style="margin-top:18px;">
    <div class="section-title">What's included</div>
    <div class="kv-list">
      <div class="kv-row"><span>Accounts</span><span>${DB.users.length}</span></div>
      <div class="kv-row"><span>Sections</span><span>${DB.sections.length}</span></div>
      <div class="kv-row"><span>Subjects</span><span>${DB.subjects.length}</span></div>
      <div class="kv-row"><span>Assessments</span><span>${DB.assessments.length}</span></div>
      <div class="kv-row"><span>Submissions</span><span>${DB.submissions.length}</span></div>
      <div class="kv-row"><span>Attendance records</span><span>${DB.attendance.length}</span></div>
      <div class="kv-row"><span>School terms</span><span>${DB.terms.length}</span></div>
      <div class="kv-row"><span>Notifications</span><span>${DB.notifications.length}</span></div>
      <div class="kv-row"><span>Grade audit log entries</span><span>${DB.auditLog.length}</span></div>
    </div>
  </div>`;
}
function exportBackup(){
  const payload = { exportedAt: new Date().toISOString(), ...DB };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tcm-lms-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  showToast('Backup downloaded.');
}
function handleRestoreFile(input){
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!data.users) throw new Error('missing users');
      if(!confirm('This will replace all current data with the backup file. Continue?')) return;
      DB.users = data.users||[]; DB.sections = data.sections||[]; DB.subjects = data.subjects||[];
      DB.assessments = data.assessments||[]; DB.submissions = data.submissions||[]; DB.attendance = data.attendance||[];
      DB.yearLevels = data.yearLevels||[]; DB.terms = data.terms||[]; DB.notifications = data.notifications||[]; DB.auditLog = data.auditLog||[];
      if(!DB.terms.length) DB.terms = [{id:uid(), name:'AY 2025–2026, 1st Semester', status:'active', createdAt:Date.now()}];
      Promise.all(['users','sections','subjects','assessments','submissions','attendance','yearLevels','terms','notifications','auditLog'].map(persist)).then(()=>{
        showToast('Backup restored successfully.'); renderApp();
      });
    }catch(e){ showToast('That file doesn\'t look like a valid backup.','err'); }
  };
  reader.readAsText(file);
}

