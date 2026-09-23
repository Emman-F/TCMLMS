/* =====================================================================
   INSTRUCTOR.JS — every instructor-only page and function (dashboard,
   classes, subjects, students, quizzes & exams, grading, attendance).
   Depends on core.js, which must load first. Nothing in this file is
   used by admin.js or student.js — it's genuinely self-contained.
   ===================================================================== */
/* ============================= INSTRUCTOR ============================= */
function insDashboard(){
  const mySubjects = subjectsOfInstructor(session.id);
  const mySections = DB.sections.filter(s=>s.instructorId===session.id);
  const myAssessments = DB.assessments.filter(a=> mySubjects.some(s=>s.id===a.subjectId));
  const pendingReview = myAssessments.reduce((n,a)=> n + DB.submissions.filter(s=>s.assessmentId===a.id && !submissionFullyGraded(s,a)).length, 0);
  const taughtSectionIds = [...new Set(mySubjects.map(s=>s.sectionId).filter(Boolean))];
  const myStudentIds = new Set();
  taughtSectionIds.forEach(secId=> studentsInSection(secId).forEach(st=>myStudentIds.add(st.id)));
  return `
  <div class="grid grid-5" style="margin-bottom:22px;">
    ${statCard('book','My subjects', mySubjects.length)}
    ${statCard('layers','My sections', mySections.length)}
    ${statCard('users','My students', myStudentIds.size)}
    ${statCard('clip','Assessments', myAssessments.length)}
    ${statCard('check','Submissions to review', pendingReview, pendingReview>0)}
  </div>
  <div class="card card-pad">
    <div class="section-title">Your subjects</div>
    <div class="section-desc">Jump into grading or attendance for any subject.</div>
    ${mySubjects.length? `<div class="grid grid-3">${mySubjects.map(subjectMiniCard).join('')}</div>`
      : emptyState('book','No subjects yet','Create a section, then add your first subject.')}
  </div>`;
}
function subjectMiniCard(s){
  const sec = sectionById(s.sectionId);
  const count = assessmentsOfSubject(s.id).length;
  const enrolled = sec ? studentsInSection(sec.id).length : 0;
  return `<div class="subject-card" onclick="setView('ins-assessments',{subjectId:'${s.id}'})">
    <div class="swatch"></div>
    <div style="font-weight:800;color:var(--e-950);font-size:14.5px;">${esc(s.name)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:2px;">${sec? esc(sec.yearLevel)+' · '+esc(sec.name):'No section'}</div>
    <div style="display:flex;gap:12px;margin-top:10px;">
      <span style="font-size:11.5px;color:var(--e-700);font-weight:700;">${count} assessment${count===1?'':'s'}</span>
      <span style="font-size:11.5px;color:var(--ink-soft);font-weight:700;">${enrolled} student${enrolled===1?'':'s'}</span>
    </div>
  </div>`;
}

function yearRank(yl){
  const i = YEAR_STANDINGS.indexOf((yl||'').trim());
  return i===-1 ? 999 : i;
}
function sortByYearThenName(list, yearField, nameField){
  return [...list].sort((a,b)=> yearRank(a[yearField])-yearRank(b[yearField]) || (a[yearField]||'').localeCompare(b[yearField]||'') || (a[nameField]||'').localeCompare(b[nameField]||''));
}
function sectionInTerm(s, termId){ return (s.termId || activeTerm().id) === termId; }
function termSelectorHtml(){
  if(DB.terms.length<=1) return '';
  const viewing = params.viewingTermId || activeTerm().id;
  const sorted = [...DB.terms].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  return `<select class="input" style="width:240px;" onchange="params.viewingTermId=this.value; params.sectionsYear=null; params.sectionsSectionId=null; lastBrowsedYear=null; renderApp()">
    ${sorted.map(t=>`<option value="${t.id}" ${viewing===t.id?'selected':''}>${esc(t.name)}${t.status==='active'?' (current)':''}</option>`).join('')}
  </select>`;
}
function insSections(){
  const viewingTermId = params.viewingTermId || activeTerm().id;
  const readOnly = viewingTermId !== activeTerm().id;

  if(!readOnly && (supabaseSectionsCache===null || supabaseAccountsCache===null)){
    loadSectionsFromServer();
    loadAccountsFromServer();
    return `<div class="card card-pad">${emptyState('layers','Loading sections…','Fetching the latest sections from the server.')}</div>`;
  }
  // Every section created through the real Add Section flow belongs to the
  // one active Supabase term by construction (see /api/sections/create), so
  // there's no need to filter those by term id the way local/historical data
  // still is -- they're already, definitionally, "current".
  const mine = readOnly
    ? sortByYearThenName(DB.sections.filter(s=>s.instructorId===session.id && sectionInTerm(s, viewingTermId)), 'yearLevel', 'name')
    : sortByYearThenName(supabaseSectionsCache.filter(s=>s.instructorId===session.id), 'yearLevel', 'name');
  const others = readOnly
    ? sortByYearThenName(DB.sections.filter(s=>s.instructorId!==session.id && sectionInTerm(s, viewingTermId)), 'yearLevel', 'name')
    : sortByYearThenName(supabaseSectionsCache.filter(s=>s.instructorId!==session.id), 'yearLevel', 'name');
  const activeYear = ('sectionsYear' in params) ? params.sectionsYear : lastBrowsedYear;
  const activeSectionId = params.sectionsSectionId || null;

  let mineBlock;
  let toolbarRight;

  if(activeYear && activeSectionId){
    // Level 3: roster of students in this specific section
    const sec = sectionById(activeSectionId);
    toolbarRight = '';
    if(!sec){
      mineBlock = `<div class="card">${emptyState('layers','Section not found','It may have been deleted.')}</div>`;
    } else {
      const roster = studentsInSection(sec.id);
      mineBlock = `
      <div class="toolbar" style="margin-bottom:10px;">
        <div class="toolbar-left">
          <button class="btn btn-ghost btn-sm" onclick="openSectionsSection(null)">← Back to ${esc(activeYear)}</button>
          <div class="section-title" style="margin:0;">${esc(sec.name)} <span style="color:var(--muted);font-weight:600;">· ${esc(activeYear)}</span></div>
        </div>
      </div>
      ${studentsTableHtml(roster, false, true)}`;
    }
  } else if(activeYear){
    // Level 2: sections within this year level
    const secs = mine.filter(s=>(s.yearLevel||'Unspecified')===activeYear);
    toolbarRight = readOnly ? '' : `<button class="btn btn-primary btn-sm" onclick="openAddSectionModal('${esc(activeYear)}')">${icon('plus')} Add section</button>`;
    mineBlock = `
    <div class="toolbar" style="margin-bottom:10px;">
      <div class="toolbar-left">
        <button class="btn btn-ghost btn-sm" onclick="openSectionsYear(null)">← Back to years</button>
        <div class="section-title" style="margin:0;">${esc(activeYear)}</div>
      </div>
    </div>
    <div class="card" style="overflow:hidden;">
      ${secs.length ? `
      <div class="glist-head" style="grid-template-columns:1fr 1fr 1fr;">
        <div>Class section</div><div style="text-align:center;">Students</div><div></div>
      </div>
      ${secs.map(s=>`
        <div class="glist-row" style="grid-template-columns:1fr 1fr 1fr;cursor:pointer;" onclick="openSectionsSection('${s.id}')">
          <div style="font-weight:700;color:var(--e-950);">${esc(s.name)}</div>
          <div style="text-align:center;">${studentsInSection(s.id).length}</div>
          <div style="text-align:right;" onclick="event.stopPropagation()">${readOnly?'':`<button class="btn btn-ghost btn-sm" onclick="deleteSection('${s.id}')" aria-label="Delete section">${icon('trash')}</button>`}</div>
        </div>`).join('')}`
      : emptyState('layers','No sections in this year yet', readOnly?'No sections were added to this year in this term.':'Add a section to start placing students in it.')}
    </div>`;
  } else {
    // Level 1: year overview — every year level always shown, read-only terms just show what's read-only
    toolbarRight = '';
    const years = STUDENT_YEAR_STANDINGS;
    mineBlock = `
      <div class="section-title" style="margin-bottom:2px;">Your classes</div>
      <div class="section-desc">${readOnly ? 'Archived term — browsing is read-only.' : 'Click a year level to add sections inside it.'}</div>
      <div class="grid grid-4">
        ${years.map(y=>{
          const secs = mine.filter(s=>(s.yearLevel||'Unspecified')===y);
          const totalStudents = secs.reduce((sum,s)=>sum+studentsInSection(s.id).length, 0);
          return `<div class="card card-pad" style="cursor:pointer;position:relative;" onclick="openSectionsYear('${esc(y)}')">
            <div class="stat-icon">${icon('layers')}</div>
            <div style="font-weight:800;font-size:15px;color:var(--e-950);">${esc(y)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px;">${secs.length} class${secs.length===1?'':'es'}</div>
            <div style="font-size:13px;color:var(--e-700);font-weight:700;margin-top:10px;">${totalStudents} student${totalStudents===1?'':'s'}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  return `
  <div class="toolbar">
    <div class="toolbar-left">${termSelectorHtml()}${readOnly?'<span class="badge badge-late">Archived — read only</span>':''}</div>
    ${toolbarRight}
  </div>
  <div style="margin-bottom:18px;">${mineBlock}</div>
  ${(!activeYear && others.length) ? `<div class="card card-pad">
    <div class="section-title">Other classes in the school</div>
    <div class="section-desc">Created by other instructors — pick from these when adding your own subject.</div>
    <div class="table-wrap"><table><thead><tr><th>Year level</th><th>Class section</th><th>Students</th></tr></thead>
    <tbody>${others.map(s=>`<tr><td style="font-weight:700;color:var(--e-800);">${esc(s.yearLevel)}</td><td>${esc(s.name)}</td><td>${studentsInSection(s.id).length}</td></tr>`).join('')}</tbody></table></div>
  </div>`:''}`;
}
function openSectionsYear(year){ params.sectionsYear = year; params.sectionsSectionId = null; lastBrowsedYear = year; renderApp(); }
function openSectionsSection(sectionId){ params.sectionsSectionId = sectionId; renderApp(); }
function openAddSectionModal(yearLevel){
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Add section — ${esc(yearLevel)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Section name</label><input class="input" id="f-secname" placeholder="e.g. Section A"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="save-section-btn" onclick="saveSection('${esc(yearLevel)}')">${icon('save')} Create section</button></div>
  </div>`);
}
async function saveSection(yearLevel){
  const name = document.getElementById('f-secname').value.trim();
  if(!name){ showToast('Please name the section.','err'); return; }
  const btn = document.getElementById('save-section-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  let data;
  try{
    const resp = await fetch('/api/sections/create', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({name, yearLevel, instructorId: session.id}),
    });
    data = await resp.json();
    if(!resp.ok){ showToast(data.error || 'Could not create the section.','err'); btn.disabled=false; btn.textContent='Create section'; return; }
  } catch(e){
    showToast('Could not reach the server. Check your connection and try again.','err'); btn.disabled=false; btn.textContent='Create section'; return;
  }
  supabaseSectionsCache = null; // force a fresh fetch so the new section shows up right away
  closeModal(); showToast('Section created.'); renderApp();
}
async function deleteSection(id){
  const sec = sectionById(id);
  if(!sec){ showToast('Could not find that section. Try refreshing the page.','err'); return; }
  const subs = DB.subjects.filter(s=>s.sectionId===id);
  const studentsHere = studentsInSection(id);
  let msg = `Delete "${sec.name}"?`;
  if(subs.length || studentsHere.length){
    msg += ` This also removes ${subs.length} subject${subs.length===1?'':'s'} (and their assessments, submissions, and attendance records)`;
    if(studentsHere.length) msg += `, and unassigns ${studentsHere.length} student${studentsHere.length===1?'':'s'} from it`;
    msg += `. This can't be undone.`;
  }
  if(!confirm(msg)) return;

  let data;
  try{
    const resp = await fetch('/api/sections/delete', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({id}),
    });
    data = await resp.json();
    if(!resp.ok){ showToast(data.error || 'Could not delete the section.','err'); return; }
  } catch(e){
    showToast('Could not reach the server. Check your connection and try again.','err'); return;
  }

  supabaseSectionsCache = null; // force a fresh fetch so the deletion shows up right away
  supabaseAccountsCache = null; // students who were in it need to show as unassigned now too

  const subjectIds = subs.map(s=>s.id);
  const assessmentIds = DB.assessments.filter(a=>subjectIds.includes(a.subjectId)).map(a=>a.id);
  DB.subjects = DB.subjects.filter(s=>s.sectionId!==id);
  DB.assessments = DB.assessments.filter(a=>!subjectIds.includes(a.subjectId));
  DB.submissions = DB.submissions.filter(s=>!assessmentIds.includes(s.assessmentId));
  DB.attendance = DB.attendance.filter(a=>!subjectIds.includes(a.subjectId));
  Promise.all(['subjects','assessments','submissions','attendance'].map(persist));

  showToast('Section deleted.');
  params.sectionsSectionId = null;
  if(params.sectionsYear){
    const stillHasSections = supabaseSectionsCache===null ? true : supabaseSectionsCache.some(s=>s.instructorId===session.id && (s.yearLevel||'Unspecified')===params.sectionsYear && s.id!==id);
    if(!stillHasSections){ params.sectionsYear = null; lastBrowsedYear = null; }
  }
  renderApp();
}

function insSubjects(){
  const mine = sortByYearThenName(subjectsOfInstructor(session.id).filter(s=>{ const sec=sectionById(s.sectionId); return sec && sectionInTerm(sec, activeTerm().id); }).map(s=>({...s, yearLevel:(sectionById(s.sectionId)||{}).yearLevel||'Unspecified'})), 'yearLevel', 'name');
  const activeYear = ('subjectsYear' in params) ? params.subjectsYear : lastBrowsedYear;

  let body;
  let toolbarRight = '';
  if(!activeYear){
    const grouped = {};
    mine.forEach(s=>{ (grouped[s.yearLevel] = grouped[s.yearLevel]||[]).push(s); });
    const years = STUDENT_YEAR_STANDINGS;
    body = `
    <div class="section-desc" style="margin-bottom:12px;">Click a year level to see or add its subjects.</div>
    <div class="grid grid-4">
      ${years.map(y=>{
        const subs = grouped[y] || [];
        const enrolled = new Set();
        subs.forEach(s=>{ if(s.sectionId) studentsInSection(s.sectionId).forEach(st=>enrolled.add(st.id)); });
        return `<div class="card card-pad" style="cursor:pointer;" onclick="openSubjectsYear('${esc(y)}')">
          <div class="stat-icon">${icon('book')}</div>
          <div style="font-weight:800;font-size:15px;color:var(--e-950);">${esc(y)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${subs.length} subject${subs.length===1?'':'s'}</div>
          <div style="font-size:13px;color:var(--e-700);font-weight:700;margin-top:10px;">${enrolled.size} student${enrolled.size===1?'':'s'}</div>
        </div>`;
      }).join('')}
    </div>`;
  } else {
    toolbarRight = `<button class="btn btn-primary btn-sm" onclick="openAddSubjectModal('${esc(activeYear)}')">${icon('plus')} New subject</button>`;
    const subs = [...mine].filter(s=>s.yearLevel===activeYear);
    const groups = {};
    subs.forEach(s=>{ (groups[s.name] = groups[s.name]||[]).push(s); });
    const groupNames = Object.keys(groups).sort((a,b)=>a.localeCompare(b));

    body = `
    <div class="toolbar" style="margin-bottom:10px;">
      <div class="toolbar-left">
        <button class="btn btn-ghost btn-sm" onclick="openSubjectsYear(null)">← Back to years</button>
        <div class="section-title" style="margin:0;">${esc(activeYear)}</div>
      </div>
    </div>
    ${groupNames.length ? groupNames.map(name=>{
      const items = [...groups[name]].sort((a,b)=>{
        const secA = sectionById(a.sectionId), secB = sectionById(b.sectionId);
        return (secA?secA.name:'').localeCompare(secB?secB.name:'');
      });
      const totalEnrolled = items.reduce((sum,s)=>{ const sec=sectionById(s.sectionId); return sum+(sec?studentsInSection(sec.id).length:0); }, 0);
      return `
      <div class="card" style="overflow:hidden;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid var(--border-soft);background:var(--surface-2);">
          <div class="swatch" style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--e-400),var(--e-700));flex:none;"></div>
          <div style="flex:1;">
            <div style="font-weight:800;font-size:14.5px;color:var(--e-950);">${esc(name)}</div>
            <div class="hint">${items.length} section${items.length===1?'':'s'} · ${totalEnrolled} student${totalEnrolled===1?'':'s'} total</div>
          </div>
        </div>
        ${items.map(s=>{
          const sec = sectionById(s.sectionId);
          const enrolled = sec ? studentsInSection(sec.id).length : 0;
          return `<div class="glist-row" style="grid-template-columns:1fr 2fr;padding:10px 20px;">
            <div>
              <div style="font-weight:700;color:var(--e-950);">${sec?esc(sec.name):'Section removed'}</div>
              <div class="hint">${enrolled} student${enrolled===1?'':'s'} enrolled</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center;">
              <button class="btn btn-outline btn-sm" onclick="setView('ins-assessments',{subjectId:'${s.id}'})">Assessments</button>
              <button class="btn btn-outline btn-sm" onclick="setView('ins-grading',{subjectId:'${s.id}'})">Grading</button>
              <button class="btn btn-outline btn-sm" onclick="setView('ins-attendance',{subjectId:'${s.id}'})">Attendance</button>
              <button class="btn btn-outline btn-sm" onclick="setView('ins-performance',{subjectId:'${s.id}'})">Performance</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteSubject('${s.id}')" aria-label="Delete subject">${icon('trash')}</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('') : `<div class="card card-pad">${emptyState('book','No subjects in '+esc(activeYear)+' yet','Use New subject above to add one for this year.')}</div>`}
    `;
  }

  return `<div class="toolbar"><div></div>${toolbarRight}</div>${body}`;
}
function openSubjectsYear(year){ params.subjectsYear = year; lastBrowsedYear = year; renderApp(); }
function openAddSubjectModal(year){
  const mySections = DB.sections.filter(s=>s.instructorId===session.id && sectionInTerm(s, activeTerm().id) && s.yearLevel===year);
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>New subject — ${esc(year)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Subject name</label><input class="input" id="f-subname" placeholder="e.g. Mathematics"></div>
      ${mySections.length ? `
      <div class="hint">Added automatically to every ${esc(year)} section: ${mySections.map(s=>esc(s.name)).join(', ')}.</div>
      ` : `
      <div class="hint">No sections in ${esc(year)} yet — add one from the Class page first, then come back to add subjects.</div>
      `}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveSubject('${esc(year)}')" ${mySections.length?'':'disabled'}>${icon('save')} Create subject</button></div>
  </div>`);
}
function saveSubject(year){
  const name = document.getElementById('f-subname').value.trim();
  if(!name){ showToast('Please name the subject.','err'); return; }
  const mySections = DB.sections.filter(s=>s.instructorId===session.id && sectionInTerm(s, activeTerm().id) && s.yearLevel===year);
  if(!mySections.length){ showToast('No sections in this year yet.','err'); return; }
  mySections.forEach(s=>{ DB.subjects.push({id:uid(), name, sectionId:s.id, instructorId:session.id}); });
  persist('subjects'); closeModal();
  showToast(mySections.length>1 ? `Subject created in ${mySections.length} sections.` : 'Subject added.');
  renderApp();
}
function deleteSubject(id){
  if(!confirm('Delete this subject and all its assessments?')) return;
  const assessIds = DB.assessments.filter(a=>a.subjectId===id).map(a=>a.id);
  DB.subjects = DB.subjects.filter(s=>s.id!==id);
  DB.assessments = DB.assessments.filter(a=>a.subjectId!==id);
  DB.submissions = DB.submissions.filter(s=>!assessIds.includes(s.assessmentId));
  DB.attendance = DB.attendance.filter(a=>a.subjectId!==id);
  Promise.all(['subjects','assessments','submissions','attendance'].map(persist));
  showToast('Subject deleted.'); renderApp();
}

function insStudents(){
  const q = (params.sq||'').toLowerCase();
  const allStudents = DB.users.filter(u=>u.role==='student');
  const searching = !!q;
  let list = allStudents;
  if(searching) list = list.filter(u=> u.name.toLowerCase().includes(q) || u.schoolId.toLowerCase().includes(q));
  list = [...list].sort((a,b)=> (a.surname||a.name||'').localeCompare(b.surname||b.name||'') || (a.firstName||'').localeCompare(b.firstName||''));

  const activeYear = ('studentsYear' in params) ? params.studentsYear : lastBrowsedYear;

  const searchBox = `<input class="input" id="ins-students-search" style="width:240px;" placeholder="Search name or school ID…" value="${esc(params.sq||'')}" oninput="liveSearch('sq', this.value)">`;
  const addButtons = activeYear ? `
    <button class="btn btn-outline btn-sm" onclick="openBulkImportModal(false, '${esc(activeYear)}')">${icon('up')} Bulk add</button>
    <button class="btn btn-primary btn-sm" onclick="openAddStudentModal('${esc(activeYear)}')">${icon('plus')} Add student</button>` : '';

  const toolbar = `
  <div class="toolbar">
    <div class="toolbar-left">${searchBox}</div>
    <div class="toolbar-left">${addButtons}</div>
  </div>
  ${(activeYear && DB.sections.filter(s=>s.instructorId===session.id && s.yearLevel===activeYear).length===0) ? `<div class="card card-pad" style="margin-bottom:16px;">${emptyState('layers','No sections in this year yet','Add a section under Class first so you have somewhere to place students.')}</div>` : ''}`;

  let body;
  if(searching){
    body = list.length ? studentsTableHtml(list, true) : `<div class="card">${emptyState('users','No matching students','Try a different search.')}</div>`;
  } else if(!activeYear){
    const grouped = {};
    allStudents.forEach(u=>{ const y = u.yearStanding || 'Unspecified'; (grouped[y]=grouped[y]||[]).push(u); });
    const years = STUDENT_YEAR_STANDINGS;
    body = `
    <div class="section-desc" style="margin-bottom:12px;">Click a year level to see its students, and to add new ones.</div>
    <div class="grid grid-4">
      ${years.map(y=>{
        const students = grouped[y] || [];
        return `<div class="card card-pad" style="cursor:pointer;" onclick="openStudentsYear('${esc(y)}')">
          <div class="stat-icon">${icon('users')}</div>
          <div style="font-weight:800;font-size:15px;color:var(--e-950);">${esc(y)}</div>
          <div style="font-size:13px;color:var(--e-700);font-weight:700;margin-top:10px;">${students.length} student${students.length===1?'':'s'}</div>
        </div>`;
      }).join('')}
    </div>`;
  } else {
    const students = list.filter(u=>(u.yearStanding||'Unspecified')===activeYear);
    body = `
    <div class="toolbar" style="margin-bottom:10px;">
      <div class="toolbar-left">
        <button class="btn btn-ghost btn-sm" onclick="openStudentsYear(null)">← Back to years</button>
        <div class="section-title" style="margin:0;">${esc(activeYear)}</div>
      </div>
    </div>
    ${students.length ? studentsTableHtml(students, false) : `<div class="card">${emptyState('users','No students in '+esc(activeYear)+' yet','Use Add student or Bulk add above.')}</div>`}`;
  }

  return toolbar + body;
}
function studentsTableHtml(list, showYearColumn, hideSectionColumn){
  const colCount = 6 + (showYearColumn?1:0) + (hideSectionColumn?0:1);
  const listIds = list.map(u=>u.id);
  const selectedInList = listIds.filter(id=>selectedAccountIds.has(id));
  return `
  ${selectedInList.length ? `<div class="toolbar" style="margin-bottom:10px;"><div class="toolbar-left">
    <span class="hint">${selectedInList.length} selected</span>
    <button class="btn btn-outline btn-sm" onclick="openBatchPasswordModal()">${icon('key')} Reset password (${selectedInList.length})</button>
    <button class="btn btn-outline btn-sm" style="color:var(--rose);border-color:var(--rose);" onclick="deleteSelectedAccounts()">${icon('trash')} Delete (${selectedInList.length})</button>
  </div></div>` : ''}
  <div class="card">
    <div class="table-wrap">
    <table>
      <thead><tr><th><input type="checkbox" class="checkbox" onchange="toggleSelectAllIn([${listIds.map(id=>`'${id}'`).join(',')}], this.checked)" ${listIds.length && listIds.every(id=>selectedAccountIds.has(id))?'checked':''}></th><th>Name</th><th>School ID</th>${showYearColumn?'<th>Year</th>':''}${hideSectionColumn?'':'<th>Section</th>'}<th>Status</th><th>Password</th><th></th></tr></thead>
      <tbody>
        ${list.length ? list.map(u=>{
          const sec = sectionById(u.sectionId);
          return `
          <tr>
            <td><input type="checkbox" class="checkbox" ${selectedAccountIds.has(u.id)?'checked':''} onchange="toggleSelectOne('${u.id}', this.checked)"></td>
            <td style="font-weight:700;color:var(--e-950);">${esc(u.name)}</td>
            <td style="color:var(--muted);">${esc(u.schoolId)}</td>
            ${showYearColumn?`<td style="font-weight:700;color:var(--e-800);">${esc(u.yearStanding||'—')}</td>`:''}
            ${hideSectionColumn?'':`<td>${sec ? esc(sec.name) : '<span class="hint">Unassigned</span>'}</td>`}
            <td>${statusBadge(u.status)}</td>
            <td><button class="btn btn-outline btn-sm" onclick="openResetPasswordModal('${u.id}')">${icon('key')} Reset</button></td>
            <td style="text-align:right;white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="openEditAccountModal('${u.id}')" aria-label="Edit account">${icon('edit')}</button></td>
          </tr>`;
        }).join('')
        : `<tr><td colspan="${colCount}">${emptyState('users','No students found','Add a student, or try a different search.')}</td></tr>`}
      </tbody>
    </table>
    </div>
  </div>`;
}
function toggleSelectAllIn(ids, checked){
  ids.forEach(id=>{ checked ? selectedAccountIds.add(id) : selectedAccountIds.delete(id); });
  renderApp();
}
function openStudentsYear(year){ params.studentsYear = year; lastBrowsedYear = year; renderApp(); }
function openAddStudentModal(year){
  autoPasswordEdited = false;
  const mySections = DB.sections.filter(s=>s.instructorId===session.id && s.yearLevel===year);
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Add student — ${esc(year)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="row-2">
        <div class="form-group"><label>Surname</label><input class="input" id="f-surname" placeholder="e.g. Dela Cruz" oninput="updateSurnameLivePassword()"></div>
        <div class="form-group"><label>First name</label><input class="input" id="f-firstname" placeholder="e.g. Juan"></div>
      </div>
      <div class="form-group" style="max-width:170px;"><label>Middle initial (optional)</label><input class="input" id="f-mi" maxlength="4" placeholder="e.g. D"></div>
      <div class="row-2">
        <div class="form-group"><label>School ID</label><input class="input" id="f-username" placeholder="e.g. 20223059" inputmode="numeric"></div>
        <div class="form-group"><label>Password</label><input class="input" id="f-password" value="${surnamePassword('')}" oninput="autoPasswordEdited=true;">
          <div class="hint">Defaults to the student's surname, e.g. Felices.</div>
        </div>
      </div>
      <input type="hidden" id="f-standing" value="${esc(year)}">
      <div class="row-2">
        <div class="form-group">
          <label>Section</label>
          <select class="input" id="f-section">
            <option value="">— No section yet —</option>
            ${mySections.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
          </select>
          ${mySections.length===0 ? `<div class="hint">No sections in ${esc(year)} yet — add one from the Class page first.</div>` : ''}
        </div>
        <div class="form-group"><label>Status</label>
          <select class="input" id="f-status">${STUDENT_STATUSES.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
        </div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveNewAccount()">${icon('save')} Save student</button></div>
  </div>`);
}

function subjectPicker(currentId, onchangeFn){
  const mine = sortByYearThenName(subjectsOfInstructor(session.id).map(s=>({...s, yearLevel:(sectionById(s.sectionId)||{}).yearLevel||''})), 'yearLevel', 'name');
  if(mine.length===0) return emptyState('book','No subjects yet','Add a subject first from the Subjects page.');
  return `<select class="input" style="width:300px;" onchange="${onchangeFn}(this.value)">
    ${mine.map(s=>{
      const sec = sectionById(s.sectionId);
      const label = sec ? `${sec.yearLevel} · ${sec.name} — ${s.name}` : s.name;
      return `<option value="${s.id}" ${s.id===currentId?'selected':''}>${esc(label)}</option>`;
    }).join('')}
  </select>`;
}

function insAssessments(){
  const mine = subjectsOfInstructor(session.id);
  if(mine.length===0) return emptyState('book','No subjects yet','Create a subject before adding assessments.');
  const subjectId = params.subjectId && mine.some(s=>s.id===params.subjectId) ? params.subjectId : mine[0].id;
  params.subjectId = subjectId;
  const list = [...assessmentsOfSubject(subjectId)].sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  return `
  <div class="toolbar">
    <div class="toolbar-left">${subjectPicker(subjectId, 'changeAssessSubject')}</div>
    <div class="toolbar-left">
      ${list.length ? `<button class="btn btn-outline btn-sm" onclick="setView('ins-grading',{subjectId:'${subjectId}', gradeTab:'history'})">${icon('chart')} Score history</button>` : ''}
      <button class="btn btn-primary btn-sm" onclick="openCreateAssessmentModal('${subjectId}')">${icon('plus')} New assessment</button>
    </div>
  </div>
  ${list.length ? `<div class="card"><div class="table-wrap"><table>
    <thead><tr><th>Title</th><th>Type</th><th>Questions</th><th>Deadline</th><th>Submissions</th><th>Class average</th><th></th></tr></thead>
    <tbody>${list.map(a=>{
      const subs = DB.submissions.filter(s=>s.assessmentId===a.id);
      const gradedSubs = subs.filter(s=>submissionFullyGraded(s, a));
      let deadlineCell = '<span style="color:var(--muted)">No deadline</span>';
      if(a.dueDate){
        const past = Date.now() > new Date(a.dueDate).getTime();
        deadlineCell = `<span style="${past?'color:var(--rose);':''}">${esc(fmtDueDate(a.dueDate))}</span>`;
        if(a.latePenalty) deadlineCell += `<div class="hint">−${a.latePenalty} pt if late</div>`;
        if(a.earlyBonusEnabled && a.earlyBonusPoints) deadlineCell += `<div class="hint">+${a.earlyBonusPoints} pt if early</div>`;
      }
      const avg = gradedSubs.length ? Math.round(gradedSubs.reduce((sum,s)=>sum+(s.score/s.total*100),0)/gradedSubs.length) : null;
      const pendingCount = subs.length - gradedSubs.length;
      return `<tr>
        <td style="font-weight:700;color:var(--e-950);">${esc(a.title)}</td>
        <td>${typeBadge(a.type)}</td>
        <td>${a.questions.length}</td>
        <td>${deadlineCell}</td>
        <td>${subs.length}${pendingCount?`<div class="hint">${pendingCount} need${pendingCount===1?'s':''} grading</div>`:''}</td>
        <td><span class="badge ${pctClass(avg)}">${pctText(avg)}</span></td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="setView('ins-grading',{subjectId:'${subjectId}', assessmentId:'${a.id}'})">Review</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateAssessment('${a.id}')" title="Duplicate">${icon('copy')}</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteAssessment('${a.id}')" aria-label="Delete assessment">${icon('trash')}</button>
        </td>
      </tr>`;
    }).join('')}</tbody></table></div></div>`
    : emptyState('clip','No assessments yet','Create your first quiz, activity, or exam for this subject.')}`;
}
function changeAssessSubject(id){ params.subjectId = id; renderApp(); }

function openCreateAssessmentModal(subjectId){
  assessmentDraft = { subjectId, type:'quiz', title:'', instructions:'', dueDate:'', latePenalty:0, earlyBonusEnabled:false, earlyBonusPoints:0, questions:[ blankQuestion() ], alsoCreateIn:[] };
  openModal(assessmentModalHtml());
}
function blankQuestion(type){
  type = type || 'mc';
  const base = {id:uid(), type, text:''};
  if(type==='mc') return {...base, choices:['','','',''], correct:0};
  if(type==='enumeration') return {...base, answers:['','']};
  if(type==='acronym' || type==='identification') return {...base, correctAnswer:'', altAnswers:''};
  if(type==='essay') return {...base, points:5};
  return base;
}
function assessmentModalHtml(){
  const d = assessmentDraft;
  return `
  <div class="modal wide">
    <div class="modal-head"><h3>${d.duplicatedFrom ? 'Duplicate assessment' : 'New assessment'}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="row-2">
        <div class="form-group"><label>Title</label><input class="input" id="d-title" value="${esc(d.title)}" oninput="assessmentDraft.title=this.value" placeholder="e.g. Chapter 3 Quiz"></div>
        <div class="form-group"><label>Type</label>
          <select class="input" id="d-type" onchange="assessmentDraft.type=this.value">
            <option value="quiz" ${d.type==='quiz'?'selected':''}>Quiz</option>
            <option value="activity" ${d.type==='activity'?'selected':''}>Activity</option>
            <option value="exam" ${d.type==='exam'?'selected':''}>Exam</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Instructions (optional)</label><textarea class="input" rows="2" oninput="assessmentDraft.instructions=this.value">${esc(d.instructions)}</textarea></div>

      ${alsoCreateInHtml()}

      <div class="qcard" style="background:var(--e-50);border-color:var(--e-200);">
        <div style="font-weight:800;font-size:12.8px;color:var(--e-800);margin-bottom:2px;">Deadline & scoring <span style="font-weight:600;color:var(--muted);">(optional)</span></div>
        <div class="hint" style="margin-bottom:10px;">Leave the deadline blank if this assessment shouldn't be timed at all.</div>
        <div class="row-2">
          <div class="form-group"><label>Deadline</label><input class="input" type="datetime-local" id="d-duedate" value="${esc(d.dueDate)}" onchange="assessmentDraft.dueDate=this.value; refreshScoringUI()"></div>
          <div class="form-group"><label>Late penalty (points off if past deadline)</label><input class="input" type="number" min="0" step="1" id="d-latepenalty" value="${d.latePenalty}" oninput="assessmentDraft.latePenalty=Number(this.value)||0" ${d.dueDate?'':'disabled'}></div>
        </div>
        ${scoringBonusHtml()}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px;">
        <div class="section-title" style="margin:0;">Questions</div>
        <button class="btn btn-outline btn-sm" onclick="addDraftQuestion()">${icon('plus')} Add question</button>
      </div>
      <div id="draft-questions">${d.questions.map((q,i)=>questionEditorHtml(q,i)).join('')}</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveAssessment()">${icon('save')} Save assessment</button></div>
  </div>`;
}
function scoringBonusHtml(){
  const d = assessmentDraft;
  return `<div id="scoring-bonus-wrap">
    <label style="display:flex;align-items:center;gap:8px;font-size:12.8px;font-weight:700;color:var(--ink-soft);margin-bottom:${d.earlyBonusEnabled?'8px':'0'};">
      <input type="checkbox" class="checkbox" ${d.earlyBonusEnabled?'checked':''} ${d.dueDate?'':'disabled'} onchange="assessmentDraft.earlyBonusEnabled=this.checked; refreshScoringUI()">
      Award bonus points for early submission
    </label>
    ${d.earlyBonusEnabled ? `<div class="form-group" style="margin-left:24px;margin-bottom:0;"><label>Bonus points (if submitted before the deadline)</label><input class="input" type="number" min="0" step="1" style="max-width:160px;" value="${d.earlyBonusPoints}" oninput="assessmentDraft.earlyBonusPoints=Number(this.value)||0"></div>` : ''}
  </div>`;
}
function refreshScoringUI(){
  const d = assessmentDraft;
  const latePenaltyInput = document.getElementById('d-latepenalty');
  if(latePenaltyInput) latePenaltyInput.disabled = !d.dueDate;
  const wrap = document.getElementById('scoring-bonus-wrap');
  if(wrap) wrap.outerHTML = scoringBonusHtml();
}
function questionEditorHtml(q, i){
  const t = qType(q);
  return `<div class="qcard">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px;">
      <strong style="font-size:12.5px;color:var(--e-800);white-space:nowrap;">Question ${i+1}</strong>
      <select class="input" style="width:auto;padding:5px 8px;font-size:12.3px;" onchange="setDraftQuestionType('${q.id}', this.value)">
        ${QUESTION_TYPES.map(qt=>`<option value="${qt.value}" ${t===qt.value?'selected':''}>${qt.label}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="removeDraftQuestion('${q.id}')" aria-label="Remove question">${icon('trash')}</button>
    </div>
    <input class="input" style="margin-bottom:10px;" placeholder="Type the question…" value="${esc(q.text)}" oninput="updateDraftQuestionText('${q.id}', this.value)">
    ${questionTypeFieldsHtml(q)}
  </div>`;
}
function questionTypeFieldsHtml(q){
  const t = qType(q);
  if(t==='mc'){
    return `${q.choices.map((c,ci)=>`
      <div class="choice-row ${q.correct===ci?'is-correct':''}">
        <input type="radio" name="correct-${q.id}" ${q.correct===ci?'checked':''} onchange="setDraftCorrect('${q.id}', ${ci})">
        <span class="choice-letter">${choiceLetter(ci)}</span>
        <input class="input" placeholder="Choice ${choiceLetter(ci)}" value="${esc(c)}" oninput="updateDraftChoice('${q.id}', ${ci}, this.value)">
      </div>`).join('')}
    <div class="hint">Select which letter is correct — the radio button next to it. Worth 1 point.</div>`;
  }
  if(t==='enumeration'){
    const pts = Math.max(1, (q.answers||[]).filter(a=>a.trim()).length);
    return `
      <div class="form-group"><label>Expected answers — one per line</label>
        <textarea class="input" rows="4" placeholder="Mitochondria&#10;Nucleus&#10;Ribosome" oninput="updateDraftAnswers('${q.id}', this.value)">${esc((q.answers||[]).join('\n'))}</textarea>
      </div>
      <div class="hint">The student types one answer per line. Matching ignores case, punctuation, and simple plurals — each matching line = 1 point, worth ${pts} point${pts===1?'':'s'} total.</div>`;
  }
  if(t==='acronym' || t==='identification'){
    return `
      <div class="form-group"><label>${t==='acronym'?'What the acronym stands for':'Correct answer'}</label>
        <input class="input" value="${esc(q.correctAnswer||'')}" oninput="updateDraftField('${q.id}','correctAnswer', this.value)" placeholder="${t==='acronym'?'e.g. National Aeronautics and Space Administration':'e.g. Mitochondria'}"></div>
      <div class="form-group"><label>Other acceptable answers (optional, comma-separated)</label>
        <input class="input" value="${esc(q.altAnswers||'')}" oninput="updateDraftField('${q.id}','altAnswers', this.value)" placeholder="e.g. mitochondrion, powerhouse of the cell"></div>
      <div class="hint">Matching ignores case, punctuation, and simple plurals (e.g. "cell" also matches "cells."). Worth 1 point.</div>`;
  }
  if(t==='essay'){
    return `
      <div class="form-group" style="max-width:160px;"><label>Points for this question</label>
        <input class="input" type="number" min="1" step="1" value="${q.points||5}" oninput="updateDraftField('${q.id}','points', Number(this.value)||1)"></div>
      <div class="form-group"><label>Grading criteria (optional)</label>
        <textarea class="input" rows="3" placeholder="One criterion per line, e.g.&#10;Clearly states a thesis&#10;Supports it with at least one example&#10;Free of major grammar errors" oninput="updateDraftField('${q.id}','rubric', this.value)">${esc(q.rubric||'')}</textarea></div>
      <div class="hint">Essays aren't auto-graded — you'll enter a score for each student's answer from the Grading page. Add criteria here and they'll show up right next to the student's answer while you grade, so your scoring stays consistent across students.</div>`;
  }
  return '';
}
function refreshQuestionsUI(){ document.getElementById('draft-questions').innerHTML = assessmentDraft.questions.map((q,i)=>questionEditorHtml(q,i)).join(''); }
function addDraftQuestion(){ assessmentDraft.questions.push(blankQuestion('mc')); refreshQuestionsUI(); }
function removeDraftQuestion(qid){
  if(assessmentDraft.questions.length<=1){ showToast('An assessment needs at least one question.','err'); return; }
  assessmentDraft.questions = assessmentDraft.questions.filter(q=>q.id!==qid); refreshQuestionsUI();
}
function setDraftQuestionType(qid, newType){
  const idx = assessmentDraft.questions.findIndex(q=>q.id===qid);
  const oldText = assessmentDraft.questions[idx].text;
  const fresh = blankQuestion(newType);
  fresh.id = qid; fresh.text = oldText;
  assessmentDraft.questions[idx] = fresh;
  refreshQuestionsUI();
}
function updateDraftQuestionText(qid, val){ const q = assessmentDraft.questions.find(x=>x.id===qid); q.text = val; }
function updateDraftChoice(qid, idx, val){ const q = assessmentDraft.questions.find(x=>x.id===qid); q.choices[idx] = val; }
function setDraftCorrect(qid, idx){ const q = assessmentDraft.questions.find(x=>x.id===qid); q.correct = idx; refreshQuestionsUI(); }
function updateDraftAnswers(qid, text){ const q = assessmentDraft.questions.find(x=>x.id===qid); q.answers = text.split('\n'); }
function updateDraftField(qid, field, val){ const q = assessmentDraft.questions.find(x=>x.id===qid); q[field] = val; }
function alsoCreateInHtml(){
  const d = assessmentDraft;
  const currentSubj = subjectById(d.subjectId);
  const currentSec = currentSubj ? sectionById(currentSubj.sectionId) : null;
  if(!currentSec) return ''; // can't determine year level — don't offer cross-subject targets
  const mine = subjectsOfInstructor(session.id)
    .filter(s=>s.id!==d.subjectId)
    .filter(s=>{ const sec = sectionById(s.sectionId); return sec && sec.yearLevel===currentSec.yearLevel; })
    .sort((a,b)=>{
      const aSame = a.name.trim().toLowerCase()===currentSubj.name.trim().toLowerCase();
      const bSame = b.name.trim().toLowerCase()===currentSubj.name.trim().toLowerCase();
      if(aSame!==bSame) return aSame ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  if(!mine.length) return '';
  const allSelected = mine.every(s=>d.alsoCreateIn.includes(s.id));
  return `
  <div class="qcard" style="background:var(--e-50);border-color:var(--e-200);">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:2px;">
      <div style="font-weight:800;font-size:12.8px;color:var(--e-800);">Also create this in <span style="font-weight:600;color:var(--muted);">(optional)</span></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:var(--e-800);cursor:pointer;">
        <input type="checkbox" class="checkbox" ${allSelected?'checked':''} onchange="toggleAlsoCreateInAll(this.checked)">
        Select all ${mine.length} ${esc(currentSec.yearLevel)} section${mine.length===1?'':'s'}
      </label>
    </div>
    <div class="hint" style="margin-bottom:10px;">Only showing other ${esc(currentSec.yearLevel)} subjects — an assessment for one year level stays within that year level. Check any you teach the same lesson in, or select all at once; saving once creates an identical copy in each.</div>
    <div style="display:flex;flex-direction:column;gap:7px;max-height:170px;overflow-y:auto;">
      ${mine.map(s=>{
        const sec = sectionById(s.sectionId);
        const sameName = s.name.trim().toLowerCase()===currentSubj.name.trim().toLowerCase();
        return `<label style="display:flex;align-items:center;gap:8px;font-size:12.8px;font-weight:600;color:var(--ink-soft);">
          <input type="checkbox" class="checkbox" ${d.alsoCreateIn.includes(s.id)?'checked':''} onchange="toggleAlsoCreateIn('${s.id}', this.checked)">
          ${esc(s.name)} <span style="color:var(--muted);font-weight:500;">— ${sec?esc(sec.yearLevel)+' · '+esc(sec.name):'No section'}</span>
          ${sameName?'<span class="badge badge-present" style="margin-left:auto;">Same subject</span>':''}
        </label>`;
      }).join('')}
    </div>
  </div>`;
}
function toggleAlsoCreateIn(subjectId, checked){
  const d = assessmentDraft;
  if(checked){ if(!d.alsoCreateIn.includes(subjectId)) d.alsoCreateIn.push(subjectId); }
  else { d.alsoCreateIn = d.alsoCreateIn.filter(id=>id!==subjectId); }
  openModal(assessmentModalHtml());
}
function toggleAlsoCreateInAll(checked){
  const d = assessmentDraft;
  const currentSubj = subjectById(d.subjectId);
  const currentSec = currentSubj ? sectionById(currentSubj.sectionId) : null;
  if(!currentSec) return;
  const ids = subjectsOfInstructor(session.id)
    .filter(s=>s.id!==d.subjectId)
    .filter(s=>{ const sec = sectionById(s.sectionId); return sec && sec.yearLevel===currentSec.yearLevel; })
    .map(s=>s.id);
  d.alsoCreateIn = checked ? ids : [];
  openModal(assessmentModalHtml());
}
function cloneQuestions(questions){
  return questions.map(q=>{
    const copy = {...q, id: uid()};
    if(copy.choices) copy.choices = [...copy.choices];
    if(copy.answers) copy.answers = [...copy.answers];
    return copy;
  });
}
function saveAssessment(){
  const d = assessmentDraft;
  if(!d.title.trim()){ showToast('Please give the assessment a title.','err'); return; }
  for(const q of d.questions){
    if(!q.text.trim()){ showToast('Every question needs its question text filled in.','err'); return; }
    const t = qType(q);
    if(t==='mc' && q.choices.some(c=>!c.trim())){ showToast('Every multiple choice question needs all four choices filled in.','err'); return; }
    if(t==='enumeration' && (q.answers||[]).filter(a=>a.trim()).length===0){ showToast('Every enumeration question needs at least one expected answer.','err'); return; }
    if((t==='acronym'||t==='identification') && !(q.correctAnswer||'').trim()){ showToast('Every '+questionTypeLabel(t).toLowerCase()+' question needs a correct answer.','err'); return; }
    if(t==='essay' && (!q.points || Number(q.points)<1)){ showToast('Every essay question needs at least 1 point.','err'); return; }
  }
  const targetSubjectIds = [d.subjectId, ...(d.alsoCreateIn||[])];
  const created = [];
  targetSubjectIds.forEach(subjectId=>{
    const a = {
      id:uid(), subjectId, type:d.type, title:d.title.trim(), instructions:d.instructions.trim(),
      dueDate: d.dueDate || null,
      latePenalty: d.dueDate ? (Number(d.latePenalty)||0) : 0,
      earlyBonusEnabled: !!(d.dueDate && d.earlyBonusEnabled),
      earlyBonusPoints: d.dueDate && d.earlyBonusEnabled ? (Number(d.earlyBonusPoints)||0) : 0,
      questions: cloneQuestions(d.questions), createdAt: Date.now()
    };
    DB.assessments.push(a);
    created.push(a);
    const subj = subjectById(subjectId);
    if(subj && subj.sectionId){
      studentsInSection(subj.sectionId).forEach(st=>{
        notifyUser(st.id, `New ${a.type}: ${a.title} posted in ${subj.name}`, 'stu-take', {assessmentId:a.id});
      });
    }
  });
  persist('assessments');
  assessmentDraft = null;
  closeModal();
  showToast(created.length>1 ? `Assessment created in ${created.length} subjects.` : 'Assessment created.');
  params.subjectId = targetSubjectIds[0];
  renderApp();
}
function deleteAssessment(id){
  if(!confirm('Delete this assessment and all student submissions for it?')) return;
  DB.assessments = DB.assessments.filter(a=>a.id!==id);
  DB.submissions = DB.submissions.filter(s=>s.assessmentId!==id);
  Promise.all(['assessments','submissions'].map(persist));
  showToast('Assessment deleted.'); renderApp();
}
function duplicateAssessment(id){
  const a = assessmentById(id);
  assessmentDraft = {
    subjectId: a.subjectId,
    type: a.type,
    title: a.title + ' (Copy)',
    instructions: a.instructions || '',
    dueDate: '', // start with no deadline — set a fresh one if needed
    latePenalty: a.latePenalty || 0,
    earlyBonusEnabled: a.earlyBonusEnabled || false,
    earlyBonusPoints: a.earlyBonusPoints || 0,
    questions: a.questions.map(q => {
      const copy = {...q, id: uid()};
      if(copy.choices) copy.choices = [...copy.choices];
      if(copy.answers) copy.answers = [...copy.answers];
      return copy;
    }),
    duplicatedFrom: a.title,
    alsoCreateIn: [],
  };
  openModal(assessmentModalHtml());
}

function setPerformanceThreshold(val){
  const n = Math.max(0, Math.min(100, Number(val)||75));
  session.performanceThreshold = n;
  const u = userById(session.id);
  if(u){ u.performanceThreshold = n; persist('users'); }
  renderApp();
}
function insGrading(){
  const mine = subjectsOfInstructor(session.id);
  if(mine.length===0) return emptyState('check','Nothing to grade yet','Create a subject and assessment first.');
  const subjectId = params.subjectId && mine.some(s=>s.id===params.subjectId) ? params.subjectId : mine[0].id;
  params.subjectId = subjectId;
  const tab = params.gradeTab==='performance' ? 'review' : (params.gradeTab || 'review');
  params.gradeTab = tab;

  const tabsHtml = `
  <div class="tabs">
    <div class="tab ${tab==='review'?'active':''}" onclick="params.gradeTab='review'; renderApp()">Review Submissions</div>
    <div class="tab ${tab==='history'?'active':''}" onclick="params.gradeTab='history'; renderApp()">Score History</div>
  </div>`;

  const page = tab==='history' ? insGradingHistory(subjectId) : insGradingReview(subjectId);
  return tabsHtml + page;
}
function insPerformance(){
  const mine = subjectsOfInstructor(session.id);
  if(mine.length===0) return emptyState('check','Nothing to monitor yet','Create a subject and assessment first.');
  const subjectId = params.subjectId && mine.some(s=>s.id===params.subjectId) ? params.subjectId : mine[0].id;
  params.subjectId = subjectId;
  return `<div class="toolbar"><div class="toolbar-left">${subjectPicker(subjectId, 'changeGradeSubject')}</div></div>` + insGradingPerformance(subjectId);
}
function insGradingPerformance(subjectId){
  const subj = subjectById(subjectId);
  const sec = sectionById(subj.sectionId);
  const roster = sec ? studentsInSection(sec.id) : [];
  const assessments = assessmentsOfSubject(subjectId).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  const threshold = session.performanceThreshold || 75;

  const rows = roster.map(st=>{
    const graded = assessments.map(a=>{
      const sub = submissionFor(a.id, st.id);
      return (sub && submissionFullyGraded(sub, a)) ? {pct: sub.score/sub.total*100} : null;
    }).filter(Boolean);
    const overallAvg = graded.length ? graded.reduce((s,g)=>s+g.pct,0)/graded.length : null;

    let trend = null;
    if(graded.length>=2){
      const mid = Math.ceil(graded.length/2);
      const firstHalf = graded.slice(0,mid), secondHalf = graded.slice(mid);
      if(secondHalf.length){
        const firstAvg = firstHalf.reduce((s,g)=>s+g.pct,0)/firstHalf.length;
        const secondAvg = secondHalf.reduce((s,g)=>s+g.pct,0)/secondHalf.length;
        const diff = secondAvg-firstAvg;
        trend = diff>5 ? 'up' : diff<-5 ? 'down' : 'flat';
      }
    }
    const attRecords = DB.attendance.filter(r=>r.subjectId===subjectId && r.studentId===st.id);
    const attRate = attRecords.length ? Math.round(attRecords.filter(r=>r.status==='present').length/attRecords.length*100) : null;
    const needsAttention = (overallAvg!==null && overallAvg<threshold) || (attRate!==null && attRate<threshold) || trend==='down';
    return {student:st, overallAvg, trend, attRate, needsAttention, gradedCount:graded.length};
  }).sort((a,b)=>{
    if(a.needsAttention!==b.needsAttention) return a.needsAttention?-1:1;
    return (a.overallAvg??101)-(b.overallAvg??101);
  });

  const withAvg = rows.filter(r=>r.overallAvg!==null);
  const buckets = {'90–100':0,'80–89':0,'70–79':0,'Below 70':0};
  withAvg.forEach(r=>{
    if(r.overallAvg>=90) buckets['90–100']++;
    else if(r.overallAvg>=80) buckets['80–89']++;
    else if(r.overallAvg>=70) buckets['70–79']++;
    else buckets['Below 70']++;
  });
  const classAvg = withAvg.length ? Math.round(withAvg.reduce((s,r)=>s+r.overallAvg,0)/withAvg.length) : null;
  const maxBucket = Math.max(1, ...Object.values(buckets));
  const trendLabel = {up:'<span style="color:var(--e-700);font-weight:700;">▲ Improving</span>', down:'<span style="color:var(--rose);font-weight:700;">▼ Declining</span>', flat:'<span class="hint">Steady</span>'};

  return `
  <div class="card card-pad" style="margin-bottom:18px;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div class="section-title">Section performance</div>
        <div class="section-desc">${sec?esc(sec.name)+' · '+esc(sec.yearLevel):''} — ${withAvg.length} of ${roster.length} student${roster.length===1?'':'s'} have graded work</div>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap;">
        Flag "needs attention" below
        <input type="number" min="0" max="100" step="1" value="${threshold}" style="width:56px;padding:4px 6px;border:1px solid var(--border-soft);border-radius:6px;font-size:12.5px;" onchange="setPerformanceThreshold(this.value)">%
      </label>
    </div>
    ${classAvg!==null ? `
    <div style="display:flex;align-items:center;gap:28px;margin-top:16px;flex-wrap:wrap;">
      <div><div class="stat-value" style="margin-top:0;">${classAvg}%</div><div class="hint">Class average</div></div>
      <div style="flex:1;min-width:240px;">
        ${Object.entries(buckets).map(([label,count])=>`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <div style="width:64px;font-size:11.3px;color:var(--muted);">${label}</div>
            <div style="flex:1;background:var(--e-50);border-radius:6px;height:14px;overflow:hidden;">
              <div style="width:${count/maxBucket*100}%;background:var(--e-500);height:100%;"></div>
            </div>
            <div style="width:18px;font-size:11.5px;font-weight:700;text-align:right;">${count}</div>
          </div>`).join('')}
      </div>
    </div>` : `<div class="hint" style="margin-top:10px;">No graded work yet — the class average and distribution show up once at least one assessment is graded.</div>`}
  </div>
  <div class="card" style="overflow:hidden;">
    <div class="glist-head" style="grid-template-columns:2fr 1fr 1fr 1fr;">
      <div>Student</div><div style="text-align:center;">Average</div><div style="text-align:center;">Trend</div><div style="text-align:center;">Attendance</div>
    </div>
    ${rows.length ? rows.map(r=>`
      <div class="glist-row" style="grid-template-columns:2fr 1fr 1fr 1fr;">
        <div style="font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${esc(r.student.name)} ${r.needsAttention?'<span class="badge badge-late">Needs attention</span>':''}</div>
        <div style="text-align:center;">${r.overallAvg!==null ? Math.round(r.overallAvg)+'%' : '<span class="hint">No grades</span>'}</div>
        <div style="text-align:center;">${r.trend ? trendLabel[r.trend] + (r.gradedCount<=2 ? ` <span class="hint" title="Based on only ${r.gradedCount} graded assessments — treat as a light signal, not a firm trend.">(early)</span>` : '') : '<span class="hint">—</span>'}</div>
        <div style="text-align:center;">${r.attRate!==null ? r.attRate+'%' : '<span class="hint">No records</span>'}</div>
      </div>`).join('') : `<div style="padding:20px;">${emptyState('users','No students in this section','Ask the admin to assign students to this section.')}</div>`}
  </div>`;
}
function insGradingReview(subjectId){
  const assessments = assessmentsOfSubject(subjectId);
  const assessmentId = params.assessmentId && assessments.some(a=>a.id===params.assessmentId) ? params.assessmentId : (assessments[0] && assessments[0].id);
  params.assessmentId = assessmentId;

  let body = '';
  if(!assessments.length){
    body = emptyState('clip','No assessments for this subject yet','Create one from the Quizzes & Exams page.');
  } else {
    const a = assessmentById(assessmentId);
    const sec = sectionById(subjectById(subjectId).sectionId);
    const roster = sec ? studentsInSection(sec.id) : [];
    const rows = roster.map(st=>{
      const sub = submissionFor(a.id, st.id);
      return {student:st, sub};
    });
    body = `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Student</th><th>Status</th><th>Score</th><th></th></tr></thead>
        <tbody>${rows.length? rows.map(r=>{
          const pending = r.sub && !submissionFullyGraded(r.sub, a);
          return `
          <tr>
            <td style="font-weight:700;">${esc(r.student.name)}</td>
            <td>${r.sub? `<span class="badge badge-present">Submitted</span>` : `<span class="badge badge-neutral">Not yet</span>`}</td>
            <td>${!r.sub ? '—' : pending ? '<span class="badge badge-late">Needs grading</span>' : `${r.sub.score}/${r.sub.total} (${Math.round(r.sub.score/r.sub.total*100)}%)`}</td>
            <td style="text-align:right;">${r.sub? `<button class="btn ${pending?'btn-primary':'btn-outline'} btn-sm" onclick="openSubmissionDetail('${r.sub.id}')">${pending?'Grade':'View answers'}</button>`:''}</td>
          </tr>`;
        }).join('') : `<tr><td colspan="4">${emptyState('users','No students in this section yet','Ask the admin to assign students to this section.')}</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  }
  return `
  <div class="toolbar">
    <div class="toolbar-left">
      ${subjectPicker(subjectId, 'changeGradeSubject')}
      ${assessments.length? `<select class="input" style="width:220px;" onchange="changeGradeAssessment(this.value)">
        ${assessments.map(a=>`<option value="${a.id}" ${a.id===assessmentId?'selected':''}>${esc(a.title)} (${a.type})</option>`).join('')}
      </select>` : ''}
    </div>
  </div>
  ${body}`;
}
function insGradingHistory(subjectId){
  const subj = subjectById(subjectId);
  const sec = sectionById(subj.sectionId);
  const roster = sec ? studentsInSection(sec.id) : [];
  const assessments = assessmentsOfSubject(subjectId);

  const pickerRow = `<div class="toolbar"><div class="toolbar-left">${subjectPicker(subjectId, 'changeGradeSubject')}</div>
    <div style="display:flex;align-items:center;gap:14px;">
      <div class="hint">${assessments.length} assessment${assessments.length===1?'':'s'} · ${roster.length} student${roster.length===1?'':'s'}</div>
      ${(roster.length && assessments.length) ? `<button class="btn btn-outline btn-sm" onclick="exportGradesCSV('${subjectId}')">${icon('down')} Download CSV</button>` : ''}
    </div></div>`;

  if(!roster.length) return pickerRow + `<div class="card">${emptyState('users','No students in this section yet','Ask the admin to assign students to this section.')}</div>`;
  if(!assessments.length) return pickerRow + `<div class="card">${emptyState('clip','No assessments for this subject yet','Scores will show up here once you create quizzes, activities, or exams.')}</div>`;

  return pickerRow + `
  <div class="card">
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th style="position:sticky;left:0;background:var(--surface-2);">Student</th>
        ${assessments.map(a=>`<th style="text-align:center;">${typeBadge(a.type)}<br><span style="font-weight:700;">${esc(a.title)}</span></th>`).join('')}
        <th style="text-align:center;">Average</th>
      </tr></thead>
      <tbody>
        ${roster.map(st=>{
          const pcts = assessments.map(a=>{
            const sub = submissionFor(a.id, st.id);
            if(!sub || !submissionFullyGraded(sub, a)) return null;
            return Math.round(sub.score/sub.total*100);
          });
          const taken = pcts.filter(p=>p!==null);
          const avg = taken.length ? Math.round(taken.reduce((s,p)=>s+p,0)/taken.length) : null;
          return `<tr>
            <td style="font-weight:700;color:var(--e-950);position:sticky;left:0;background:var(--surface);">${esc(st.name)}</td>
            ${assessments.map((a,i)=>{
              const sub = submissionFor(a.id, st.id);
              const pending = sub && !submissionFullyGraded(sub, a);
              const pct = pcts[i];
              return `<td style="text-align:center;">
                ${!sub ? `<span class="badge badge-neutral">Not yet</span>`
                  : pending ? `<button class="btn btn-ghost btn-sm" style="padding:4px 8px;" onclick="openSubmissionDetail('${sub.id}')"><span class="badge badge-late">Needs grading</span></button>`
                  : `<button class="btn btn-ghost btn-sm" style="padding:4px 8px;" onclick="openSubmissionDetail('${sub.id}')"><span class="badge ${pctClass(pct)}">${sub.score}/${sub.total} · ${pctText(pct)}</span></button>`}
              </td>`;
            }).join('')}
            <td style="text-align:center;"><span class="badge ${pctClass(avg)}" style="font-weight:800;">${pctText(avg)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
  </div>`;
}
function changeGradeSubject(id){ params.subjectId = id; params.assessmentId = null; renderApp(); }
function changeGradeAssessment(id){ params.assessmentId = id; renderApp(); }
function exportGradesCSV(subjectId){
  const subj = subjectById(subjectId);
  const sec = sectionById(subj.sectionId);
  const roster = sec ? studentsInSection(sec.id) : [];
  const assessments = assessmentsOfSubject(subjectId);
  const header = ['Student', 'School ID', ...assessments.map(a=>a.title+' ('+a.type+')'), 'Average (%)'];
  const rows = [header];
  roster.forEach(st=>{
    const pcts = assessments.map(a=>{
      const sub = submissionFor(a.id, st.id);
      if(!sub) return 'Not yet';
      if(!submissionFullyGraded(sub, a)) return 'Needs grading';
      return Math.round(sub.score/sub.total*100)+'%';
    });
    const taken = assessments.map((a,i)=>{
      const sub = submissionFor(a.id, st.id);
      return (sub && submissionFullyGraded(sub,a)) ? Math.round(sub.score/sub.total*100) : null;
    }).filter(p=>p!==null);
    const avg = taken.length ? Math.round(taken.reduce((s,p)=>s+p,0)/taken.length) : '';
    rows.push([st.name, st.schoolId, ...pcts, avg]);
  });
  const stamp = new Date().toISOString().slice(0,10);
  downloadCSV(`${subj.name.replace(/[^a-z0-9]+/gi,'_')}_grades_${stamp}.csv`, rows);
}

function openSubmissionDetail(subId){
  const sub = DB.submissions.find(s=>s.id===subId);
  const a = assessmentById(sub.assessmentId);
  const st = userById(sub.studentId);
  const note = adjustmentNote(sub);
  const pending = !submissionFullyGraded(sub, a);
  const scoreLabel = pending
    ? `<span class="badge badge-late">Needs grading</span> <span class="hint">Auto-graded so far: ${sub.score}/${sub.total}</span>`
    : `<span class="badge badge-present">Score: ${sub.score}/${sub.total} (${Math.round(sub.score/sub.total*100)}%)</span>`;
  openModal(`
  <div class="modal wide">
    <div class="modal-head"><h3>${esc(st.name)} — ${esc(a.title)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body" id="submission-detail-body">
      <div style="margin-bottom:6px;">${scoreLabel}</div>
      ${note ? `<div class="hint" style="margin-bottom:14px;">${esc(note)}</div>` : '<div style="margin-bottom:14px;"></div>'}
      ${a.questions.map((q,i)=>questionReviewHtml(q, i, sub)).join('')}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      ${assessmentHasEssay(a) ? `<button class="btn btn-primary" onclick="saveEssayGrades('${sub.id}')">${icon('save')} Save grades</button>` : ''}
    </div>
  </div>`);
}
function questionReviewHtml(q, i, sub){
  const t = qType(q);
  const ans = sub.answers[q.id];
  if(t==='mc'){
    return `<div class="qcard">
      <strong style="font-size:13px;">${i+1}. ${esc(q.text)}</strong>
      <div style="margin-top:8px;">
      ${q.choices.map((c,ci)=>{
        let style = '';
        if(ci===q.correct) style='color:var(--e-700);font-weight:700;';
        else if(ci===ans) style='color:var(--rose);text-decoration:line-through;';
        const tag = ci===q.correct ? ' ✓ correct' : (ci===ans ? ' ✕ student\'s answer' : '');
        return `<div style="padding:4px 0;${style}">${choiceLetter(ci)}. ${esc(c)}${tag}</div>`;
      }).join('')}
      </div>
    </div>`;
  }
  if(t==='enumeration'){
    const expected = (q.answers||[]).filter(x=>x.trim());
    const given = (ans||'').split('\n').map(x=>x.trim()).filter(Boolean);
    const pts = gradeAutoQuestion(q, ans);
    return `<div class="qcard">
      <strong style="font-size:13px;">${i+1}. ${esc(q.text)}</strong>
      <div class="hint" style="margin:4px 0 8px;">${pts}/${expected.length} matched</div>
      <div class="row-2">
        <div><div class="hint" style="font-weight:700;margin-bottom:4px;">Expected</div>
          ${expected.map(e=>{ const hit = given.some(g=>answersMatch(g,e)); return `<div style="padding:2px 0;${hit?'color:var(--e-700);font-weight:700;':'color:var(--muted);'}">${hit?'✓ ':'– '}${esc(e)}</div>`; }).join('')}
        </div>
        <div><div class="hint" style="font-weight:700;margin-bottom:4px;">Student wrote</div>
          ${given.length ? given.map(g=>`<div style="padding:2px 0;">${esc(g)}</div>`).join('') : '<div class="hint">(nothing)</div>'}
        </div>
      </div>
    </div>`;
  }
  if(t==='acronym' || t==='identification'){
    const correct = gradeAutoQuestion(q, ans)===1;
    return `<div class="qcard">
      <strong style="font-size:13px;">${i+1}. ${esc(q.text)}</strong>
      <div style="margin-top:8px;">
        <div class="hint">Correct answer: <strong style="color:var(--e-700);">${esc(q.correctAnswer)}</strong>${q.altAnswers?` <span style="color:var(--muted);">(also accepts: ${esc(q.altAnswers)})</span>`:''}</div>
        <div style="margin-top:4px;${correct?'color:var(--e-700);font-weight:700;':'color:var(--rose);'}">Student wrote: ${esc(ans||'(nothing)')} ${correct?'✓':'✕'}</div>
      </div>
    </div>`;
  }
  if(t==='essay'){
    const pts = questionPoints(q);
    const existing = sub.essayScores && sub.essayScores[q.id];
    const criteria = (q.rubric||'').split('\n').map(s=>s.trim()).filter(Boolean);
    return `<div class="qcard">
      <strong style="font-size:13px;">${i+1}. ${esc(q.text)}</strong>
      ${criteria.length ? `<div style="background:var(--e-50);border:1px solid var(--e-200);border-radius:8px;padding:10px 14px;margin:8px 0;">
        <div class="hint" style="font-weight:700;color:var(--e-800);margin-bottom:4px;">Grading criteria</div>
        <ul style="margin:0;padding-left:18px;font-size:12.8px;color:var(--ink-soft);">
          ${criteria.map(c=>`<li>${esc(c)}</li>`).join('')}
        </ul>
      </div>` : ''}
      <div class="hint" style="margin:6px 0 4px;font-weight:700;">Student's answer</div>
      <div style="white-space:pre-wrap;background:var(--surface);border:1px solid var(--border-soft);border-radius:8px;padding:10px;font-size:13px;margin-bottom:10px;">${esc(ans||'(no answer)')}</div>
      <div class="form-group" style="max-width:180px;margin-bottom:0;">
        <label>Points (out of ${pts})</label>
        <input class="input" type="number" min="0" max="${pts}" step="1" id="essay-score-${q.id}" value="${existing!==undefined?existing:''}" placeholder="0–${pts}">
      </div>
    </div>`;
  }
  return '';
}
function saveEssayGrades(subId){
  const sub = DB.submissions.find(s=>s.id===subId);
  const a = assessmentById(sub.assessmentId);
  const st = userById(sub.studentId);
  const essayQs = a.questions.filter(isEssay);
  const scores = {...(sub.essayScores||{})};
  const beforeScore = sub.score;
  const wasGraded = submissionFullyGraded(sub, a);
  for(const q of essayQs){
    const input = document.getElementById('essay-score-'+q.id);
    if(!input) continue;
    const val = input.value.trim();
    if(val===''){ showToast('Please enter a score for every essay question.','err'); return; }
    const max = questionPoints(q);
    const num = Math.max(0, Math.min(max, Number(val)||0));
    scores[q.id] = num;
  }
  sub.essayScores = scores;
  recomputeSubmissionScore(sub);
  persist('submissions');
  logGradeChange({
    studentId: sub.studentId, studentName: st ? st.name : sub.studentId,
    assessmentId: a.id, assessmentTitle: a.title, subjectId: a.subjectId,
    before: wasGraded ? beforeScore : null, after: sub.score, total: sub.total,
    action: wasGraded ? 'Edited essay grade' : 'Graded essay',
  });
  if(submissionFullyGraded(sub, a)){
    notifyUser(sub.studentId, `Your score for ${a.title} is ready: ${sub.score}/${sub.total}`, 'stu-grades', {});
  }
  closeModal();
  showToast('Grades saved.');
  renderApp();
}

function insAttendance(){
  const mine = subjectsOfInstructor(session.id);
  if(mine.length===0) return emptyState('calendar','No subjects yet','Create a subject before taking attendance.');
  const subjectId = params.subjectId && mine.some(s=>s.id===params.subjectId) ? params.subjectId : mine[0].id;
  params.subjectId = subjectId;
  const tab = params.attTab || 'take';
  params.attTab = tab;

  const tabsHtml = `
  <div class="tabs">
    <div class="tab ${tab==='take'?'active':''}" onclick="params.attTab='take'; renderApp()">Take Attendance</div>
    <div class="tab ${tab==='record'?'active':''}" onclick="params.attTab='record'; renderApp()">Full Record</div>
    <div class="tab ${tab==='summary'?'active':''}" onclick="params.attTab='summary'; renderApp()">Summary</div>
  </div>`;

  const page = tab==='record' ? insAttendanceRecord(subjectId) : tab==='summary' ? insAttendanceSummary(subjectId) : insAttendanceTake(subjectId);
  return tabsHtml + page;
}
function insAttendanceSummary(subjectId){
  const subj = subjectById(subjectId);
  const sec = sectionById(subj.sectionId);
  const roster = sec ? studentsInSection(sec.id) : [];
  const records = DB.attendance.filter(r=>r.subjectId===subjectId);
  const dateCount = new Set(records.map(r=>r.date)).size;

  if(!roster.length) return `<div class="card">${emptyState('users','No students in this section','Ask the admin to assign students to this section.')}</div>`;
  if(!dateCount) return `<div class="card">${emptyState('calendar','No attendance recorded yet','Once you start taking attendance, each student\'s totals will show up here.')}</div>`;

  const rows = roster.map(st=>{
    const mine = records.filter(r=>r.studentId===st.id);
    const counts = {present:0, late:0, absent:0, excused:0};
    mine.forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
    const rate = mine.length ? Math.round(counts.present/mine.length*100) : null;
    return {student:st, counts, total:mine.length, rate};
  }).sort((a,b)=> (a.rate===null?101:a.rate) - (b.rate===null?101:b.rate));

  return `
  <div class="hint" style="margin-bottom:10px;">${dateCount} date${dateCount===1?'':'s'} recorded for ${esc(sec.name)} · ${esc(sec.yearLevel)} — sorted lowest attendance first.</div>
  <div class="card">
    <div class="table-wrap"><table>
      <thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Rate</th></tr></thead>
      <tbody>${rows.map(r=>`
        <tr>
          <td style="font-weight:700;">${esc(r.student.name)}</td>
          <td>${r.counts.present}</td>
          <td>${r.counts.late}</td>
          <td>${r.counts.absent}</td>
          <td>${r.counts.excused}</td>
          <td><span class="badge ${pctClass(r.rate)}">${pctText(r.rate)}</span></td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}
function insAttendanceTake(subjectId){
  const date = params.date || todayStr();
  params.date = date;
  const subj = subjectById(subjectId);
  const sec = sectionById(subj.sectionId);
  const roster = sec ? studentsInSection(sec.id) : [];

  if(attendanceDraft.subjectId!==subjectId || attendanceDraft.date!==date){
    attendanceDraft = {subjectId, date, statuses:{}};
    roster.forEach(st=>{
      const rec = DB.attendance.find(r=>r.subjectId===subjectId && r.date===date && r.studentId===st.id);
      attendanceDraft.statuses[st.id] = rec ? rec.status : 'present';
    });
  }
  return `
  <div class="toolbar">
    <div class="toolbar-left">
      ${subjectPicker(subjectId, 'changeAttSubject')}
      <input class="input" type="date" style="width:170px;" value="${date}" onchange="changeAttDate(this.value)">
    </div>
    <button class="btn btn-primary btn-sm" onclick="saveAttendance()">${icon('save')} Save attendance</button>
  </div>
  <div class="card" style="overflow:hidden;">
    ${roster.length? `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 20px;background:var(--surface-2);border-bottom:1px solid var(--border-soft);flex-wrap:wrap;">
      <span style="font-size:11.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Mark all as</span>
      <button class="btn btn-ghost btn-sm" onclick="markAllAttendance('present')">Present</button>
      <button class="btn btn-ghost btn-sm" onclick="markAllAttendance('late')">Late</button>
      <button class="btn btn-ghost btn-sm" onclick="markAllAttendance('absent')">Absent</button>
      <button class="btn btn-ghost btn-sm" onclick="markAllAttendance('excused')">Excused</button>
      <span class="hint" style="margin-left:auto;">Everyone defaults to Present — adjust just the exceptions, or use this if the whole class shares one status today.</span>
    </div>
    <div class="glist-head" style="grid-template-columns:1fr 1fr 1fr;">
      <div>Student</div><div style="text-align:center;grid-column:2 / span 2;">Mark</div>
    </div>
    ${roster.map(st=>`
      <div class="glist-row" style="grid-template-columns:1fr 1fr 1fr;">
        <div style="font-weight:700;">${esc(st.name)}</div>
        <div style="text-align:center;grid-column:2 / span 2;">
          <button class="pill-btn ${attendanceDraft.statuses[st.id]==='present'?'active-present':''}" onclick="setAttStatus('${st.id}','present')">Present</button>
          <button class="pill-btn ${attendanceDraft.statuses[st.id]==='late'?'active-late':''}" onclick="setAttStatus('${st.id}','late')">Late</button>
          <button class="pill-btn ${attendanceDraft.statuses[st.id]==='absent'?'active-absent':''}" onclick="setAttStatus('${st.id}','absent')">Absent</button>
          <button class="pill-btn ${attendanceDraft.statuses[st.id]==='excused'?'active-excused':''}" onclick="setAttStatus('${st.id}','excused')">Excused</button>
        </div>
      </div>`).join('')}`
    : emptyState('users','No students in this section','Ask the admin to assign students to this section.')}
  </div>`;
}
function markAllAttendance(status){
  Object.keys(attendanceDraft.statuses).forEach(id=>{ attendanceDraft.statuses[id] = status; });
  renderApp();
}
function insAttendanceRecord(subjectId){
  const subj = subjectById(subjectId);
  const sec = sectionById(subj.sectionId);
  const roster = sec ? studentsInSection(sec.id) : [];
  const records = DB.attendance.filter(r=>r.subjectId===subjectId);
  const recordedDates = new Set(records.map(r=>r.date));

  if(!roster.length) return `<div class="toolbar"><div class="toolbar-left">${subjectPicker(subjectId, 'changeAttSubject')}</div></div>
    <div class="card">${emptyState('users','No students in this section','Ask the admin to assign students to this section.')}</div>`;

  const recordDate = params.recordDate || (recordedDates.size ? [...recordedDates].sort().reverse()[0] : todayStr());
  params.recordDate = recordDate;

  const dayRecords = roster.map(st=>({
    student: st,
    status: (records.find(r=>r.date===recordDate && r.studentId===st.id)||{}).status || null,
  }));
  const counts = {present:0, late:0, absent:0, excused:0};
  dayRecords.forEach(r=>{ if(r.status && counts[r.status]!==undefined) counts[r.status]++; });

  return `
  <div class="toolbar">
    <div class="toolbar-left">
      ${subjectPicker(subjectId, 'changeAttSubject')}
      <input class="input" type="date" style="width:180px;" value="${recordDate}" onchange="changeAttRecordDate(this.value)">
      ${recordedDates.has(recordDate) ? '' : '<span class="hint">No attendance taken this date</span>'}
    </div>
    <div class="hint">${esc(sec.name)} · ${esc(sec.yearLevel)} — ${recordedDates.size} date${recordedDates.size===1?'':'s'} recorded</div>
  </div>
  <div class="grid grid-4" style="margin-bottom:16px;">
    ${statCard('check','Present', counts.present)}
    ${statCard('calendar','Late', counts.late)}
    ${statCard('calendar','Absent', counts.absent)}
    ${statCard('calendar','Excused', counts.excused)}
  </div>
  <div class="card" style="overflow:hidden;">
    <div class="glist-head" style="grid-template-columns:1fr 1fr 1fr;">
      <div>Student</div><div style="text-align:center;">Status</div><div></div>
    </div>
    ${dayRecords.map(r=>`
      <div class="glist-row" style="grid-template-columns:1fr 1fr 1fr;">
        <div style="font-weight:700;color:var(--e-950);">${esc(r.student.name)}</div>
        <div style="text-align:center;">${r.status ? attBadge(r.status) : '<span class="badge badge-neutral">Not marked</span>'}</div>
        <div></div>
      </div>`).join('')}
  </div>`;
}
function changeAttRecordDate(d){ params.recordDate = d; renderApp(); }
function changeAttSubject(id){ params.subjectId = id; params.recordDate = null; renderApp(); }
function changeAttDate(d){ params.date = d; renderApp(); }
function setAttStatus(studentId, status){ attendanceDraft.statuses[studentId] = status; renderApp(); }
function saveAttendance(){
  const {subjectId, date, statuses} = attendanceDraft;
  Object.keys(statuses).forEach(studentId=>{
    let rec = DB.attendance.find(r=>r.subjectId===subjectId && r.date===date && r.studentId===studentId);
    if(rec) rec.status = statuses[studentId];
    else DB.attendance.push({id:uid(), subjectId, date, studentId, status:statuses[studentId]});
  });
  persist('attendance');
  showToast('Attendance saved for '+fmtDate(date)+'.');
}

let lablockNotFound = false;
function insScreenWatch(){
  return `
  <div class="card card-pad" style="max-width:560px;margin:0 auto;text-align:center;padding:44px 32px;">
    <div class="stat-icon" style="width:52px;height:52px;margin:0 auto 18px;">${icon('monitor')}</div>
    <h3 style="font-size:19px;margin-bottom:8px;">Screen Watch</h3>
    <p style="color:var(--muted);font-size:13.5px;line-height:1.6;max-width:400px;margin:0 auto 22px;">
      Opens Lablock Admin — the desktop app that powers live screen monitoring — straight to its Admin interface.
    </p>
    <button class="btn btn-primary" onclick="attemptLaunchLablock()">${icon('external')} Open Lablock Admin</button>
    ${lablockNotFound ? `
      <div style="background:var(--rose-bg);border-radius:10px;margin-top:18px;padding:16px;text-align:left;">
        <strong style="color:var(--rose);font-size:13.5px;">Lablock Admin is not installed</strong>
        <p style="color:var(--ink-soft);font-size:12.8px;margin-top:6px;line-height:1.5;">We tried to hand off to the Lablock Admin desktop app, but it doesn't seem to be installed (or registered) on this device.</p>
        ${LABLOCK_DOWNLOAD_URL
          ? `<a class="btn btn-outline btn-sm" style="margin-top:10px;" href="${esc(LABLOCK_DOWNLOAD_URL)}" target="_blank">${icon('down')} Download Lablock Admin</a>`
          : `<div class="hint" style="margin-top:8px;">Ask your admin for the Lablock Admin installer.</div>`}
      </div>` : ''}
  </div>`;
}
function attemptLaunchLablock(){
  lablockNotFound = false;
  renderApp(); // clear any previous "not installed" notice right away
  let handedOff = false;
  const markHandedOff = () => { handedOff = true; };
  window.addEventListener('blur', markHandedOff);
  document.addEventListener('visibilitychange', markHandedOff);
  try{ window.location.href = LABLOCK_PROTOCOL_URL; }catch(e){}
  setTimeout(()=>{
    window.removeEventListener('blur', markHandedOff);
    document.removeEventListener('visibilitychange', markHandedOff);
    if(!handedOff && view==='ins-screenwatch'){
      lablockNotFound = true;
      renderApp();
    }
  }, 1500);
}
