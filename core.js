/* =====================================================================
   CORE.JS — shared state, storage, auth, and the rendering engine.
   Loaded FIRST (see index.html) — every other file depends on this one.

   ARCHITECTURE, PLAINLY STATED:
   This app has 5 files (core, admin, instructor, student, init) but no
   build step and no ES modules — index.html loads them as plain classic
   <script> tags, in this exact order: core → admin → instructor →
   student → init. Because of that, all 5 files share ONE global JS
   scope at runtime. Splitting them organizes the CODE by role; it does
   NOT create hard runtime isolation the way separate modules or
   separate apps would. Nothing in instructor.js is technically
   *prevented* from calling something in admin.js — it's just that
   nothing needs to, and cross-file calls only happen for the handful
   of genuinely shared helpers below.

   WHAT IS ACTUALLY ENFORCED, not just organized:
   renderApp() (below) checks the signed-in user's role against the
   screen ("view") about to be shown, BEFORE the page title, sidebar,
   or content are built. If they don't match — e.g. a student's
   session somehow pointing at an admin-only screen — it's blocked and
   redirected to that user's own dashboard, and logged to the console.
   This is a real, tested guard: see renderApp() for the check itself.

   SHARED HELPERS: a few functions used by 2+ roles live in this file
   (search below for "SHARED ACCOUNT / UI HELPERS") even though some
   were originally written inside admin.js — they were moved here
   specifically so this file, not any one role's file, is their home.
   ===================================================================== */
/* ============================= STATE ============================= */
// Bump this on every shipped update — shown in the sidebar footer so it's easy to
// verify you're looking at the build you think you are (not a stale cached copy).
const BUILD_VERSION = '2026.09.18-15';

let DB = { users:[], sections:[], subjects:[], assessments:[], submissions:[], attendance:[], yearLevels:[], terms:[], notifications:[], auditLog:[] };
let session = null;
let view = 'login';
let params = {};
let ready = false;
// Shared "which year am I browsing" context for Class/Subjects/Students — set when
// any of the three pages drills into a year, read as the default on the others so
// picking "1st Year" once doesn't mean re-picking it again on each page. Cleared
// when you deliberately go back to the year overview on any of them.
let lastBrowsedYear = null;

let selectedAccountIds = new Set();
let assessmentDraft = null;
let attendanceDraft = { subjectId:null, date:null, statuses:{} };
let takeDraft = { assessmentId:null, answers:{} };

/* ============================= PASSWORD HASHING ============================= */
// Passwords are never stored or sent in plain text — only their SHA-256 hash is saved.
// (This stays true even in this no-backend version, so it's a one-line swap-in
// once a real database is wired up later.)
async function sha256Hex(text){
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function generateSalt(){
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function hashPassword(password, salt){
  return sha256Hex(salt + ':' + password);
}

/* ============================= STORAGE (browser localStorage — temporary) ============================= */
// NOTE: this is a stand-in for a real database. Data lives only in this browser,
// on this device, and won't sync anywhere else. Swap this block out for a real
// backend (e.g. Supabase) once the client-side app is finished.
async function getData(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  }catch(e){ return fallback; }
}
async function setData(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }
  catch(e){ console.error('storage error', e); showToast('Could not save — storage error.', 'err'); }
}
async function persist(part){
  await setData('tcmlms:'+part, DB[part]);
}
async function loadDB(){
  DB.users = await getData('tcmlms:users', null);
  if(!DB.users || DB.users.length===0){
    // First run: seed a default admin account so someone can get in and create
    // real accounts. Default login: School ID 00000001 / password admin123.
    // Deliberately not shown on the public sign-in screen — change this password
    // via Accounts → Reset as your first action after logging in.
    const salt = generateSalt();
    const passwordHash = await hashPassword('admin123', salt);
    DB.users = [{id:uid(), schoolId:'00000001', salt, passwordHash, role:'admin', name:'System Administrator'}];
    await persist('users');
  }
  DB.sections = await getData('tcmlms:sections', []);
  DB.yearLevels = await getData('tcmlms:yearLevels', []);
  DB.subjects = await getData('tcmlms:subjects', []);
  DB.assessments = await getData('tcmlms:assessments', []);
  DB.submissions = await getData('tcmlms:submissions', []);
  DB.attendance = await getData('tcmlms:attendance', []);
  DB.terms = await getData('tcmlms:terms', []);
  DB.notifications = await getData('tcmlms:notifications', []);
  DB.auditLog = await getData('tcmlms:auditLog', []);
  if(!DB.terms.length){
    DB.terms = [{id:uid(), name:'AY 2025–2026, 1st Semester', status:'active', createdAt:Date.now()}];
    await persist('terms');
  }
  ready = true;
}
function activeTerm(){ return DB.terms.find(t=>t.status==='active') || DB.terms[0]; }

/* ============================= AUDIT LOG (grade changes) ============================= */
function logGradeChange(entry){
  DB.auditLog.push({
    id: uid(),
    actorId: session.id, actorName: session.name,
    timestamp: Date.now(),
    ...entry,
  });
  persist('auditLog');
}

/* ============================= NOTIFICATIONS ============================= */
function notifyUser(userId, message, view, viewParams){
  DB.notifications.push({id:uid(), userId, message, view, params:viewParams||{}, createdAt:Date.now(), read:false});
  persist('notifications');
}
function myNotifications(){
  if(!session) return [];
  return DB.notifications.filter(n=>n.userId===session.id).sort((a,b)=>b.createdAt-a.createdAt);
}
function unreadNotificationCount(){ return myNotifications().filter(n=>!n.read).length; }
function openNotificationsModal(){
  const list = myNotifications().slice(0, 40);
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Notifications</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body" style="padding:0;">
      ${list.length ? `<div>${list.map(n=>`
        <div onclick="openNotification('${n.id}')" style="display:flex;gap:10px;align-items:flex-start;padding:13px 22px;border-bottom:1px solid var(--border-soft);cursor:pointer;${n.read?'':'background:var(--e-50);'}">
          <div style="width:8px;height:8px;border-radius:50%;background:${n.read?'transparent':'var(--e-600)'};margin-top:6px;flex:none;"></div>
          <div style="flex:1;">
            <div style="font-size:13px;color:var(--ink);font-weight:${n.read?'500':'700'};">${esc(n.message)}</div>
            <div class="hint" style="margin-top:2px;">${timeAgo(n.createdAt)}</div>
          </div>
        </div>`).join('')}</div>`
      : `<div style="padding:20px 22px;">${emptyState('check','No notifications yet','New assessments and graded scores will show up here.')}</div>`}
    </div>
    <div class="modal-foot">
      ${list.length ? `<button class="btn btn-ghost" onclick="markAllNotificationsRead()">Mark all as read</button>` : ''}
      <button class="btn btn-primary" onclick="closeModal()">Close</button>
    </div>
  </div>`);
}
function openNotification(id){
  const n = DB.notifications.find(x=>x.id===id);
  if(!n) return;
  n.read = true;
  persist('notifications');
  closeModal();
  if(n.view) setView(n.view, n.params||{});
  else renderApp();
}
function markAllNotificationsRead(){
  myNotifications().forEach(n=>n.read=true);
  persist('notifications');
  closeModal();
  showToast('All caught up.');
  renderApp();
}
function timeAgo(ts){
  const diff = Math.max(0, Date.now()-ts);
  const mins = Math.floor(diff/60000);
  if(mins<1) return 'just now';
  if(mins<60) return mins+'m ago';
  const hrs = Math.floor(mins/60);
  if(hrs<24) return hrs+'h ago';
  const days = Math.floor(hrs/24);
  if(days<7) return days+'d ago';
  return fmtDate(new Date(ts).toISOString().slice(0,10));
}

/* ============================= HELPERS ============================= */
function uid(){ return Math.random().toString(36).slice(2,10); }
function esc(s){ return (s===undefined||s===null?'':String(s)).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function downloadCSV(filename, rows){
  const escCell = v => {
    const s = String(v===undefined||v===null?'':v);
    return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
  };
  const csv = rows.map(row=>row.map(escCell).join(',')).join('\r\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded '+filename);
}
function initials(name){ return (name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
function fmtDate(d){ const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function genPassword(){
  const chars='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out=''; for(let i=0;i<8;i++) out+=chars[Math.floor(Math.random()*chars.length)];
  return out;
}
// Student default password convention: their surname, title-cased (e.g. "Felices", "Dela Cruz").
function surnamePassword(surname){
  const s = (surname||'').trim();
  if(!s) return genPassword();
  return s.split(' ').filter(Boolean).map(w=> w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function userById(id){ return DB.users.find(u=>u.id===id) || (typeof supabaseAccountsCache!=='undefined' && supabaseAccountsCache ? supabaseAccountsCache.find(u=>u.id===id) : undefined); }
function sectionById(id){ return DB.sections.find(s=>s.id===id); }
function subjectById(id){ return DB.subjects.find(s=>s.id===id); }
function assessmentById(id){ return DB.assessments.find(a=>a.id===id); }
function studentsInSection(sectionId){
  return DB.users
    .filter(u=>u.role==='student' && u.sectionId===sectionId)
    .sort((a,b)=> (a.surname||a.name||'').localeCompare(b.surname||b.name||'') || (a.firstName||'').localeCompare(b.firstName||''));
}
function subjectsOfInstructor(insId){ return DB.subjects.filter(s=>s.instructorId===insId); }
function assessmentsOfSubject(subId){ return DB.assessments.filter(a=>a.subjectId===subId); }
function submissionFor(assessmentId, studentId){ return DB.submissions.find(s=>s.assessmentId===assessmentId && s.studentId===studentId); }
function typeBadge(t){ return `<span class="badge badge-${t}">${t[0].toUpperCase()+t.slice(1)}</span>`; }
function pctClass(pct){ return pct===null ? 'badge-neutral' : pct>=75 ? 'badge-present' : pct>=50 ? 'badge-late' : 'badge-absent'; }
function pctText(pct){ return pct===null ? '—' : pct+'%'; }
function choiceLetter(i){ return String.fromCharCode(65+i); }

/* ---- Question types ---- */
const QUESTION_TYPES = [
  {value:'mc', label:'Multiple Choice'},
  {value:'enumeration', label:'Enumeration'},
  {value:'acronym', label:'Acronym'},
  {value:'identification', label:'Identification'},
  {value:'essay', label:'Essay'},
];
function questionTypeLabel(t){ return (QUESTION_TYPES.find(x=>x.value===t)||QUESTION_TYPES[0]).label; }
function qType(q){ return q.type || 'mc'; } // legacy questions with no type are treated as multiple choice
function questionPoints(q){
  const t = qType(q);
  if(t==='enumeration') return Math.max(1, (q.answers||[]).filter(a=>a.trim()).length);
  if(t==='essay') return Math.max(1, Number(q.points)||5);
  return 1; // mc, acronym, identification
}
function assessmentTotalPoints(a){ return a.questions.reduce((sum,q)=>sum+questionPoints(q), 0); }
function isEssay(q){ return qType(q)==='essay'; }
function assessmentHasEssay(a){ return a.questions.some(isEssay); }
// Points earned for one auto-gradable question given the student's raw answer. Essay questions
// are never auto-graded — they're scored later by the instructor.
// Tolerant text matching for typed-answer questions: trims, lowercases, strips
// punctuation, collapses whitespace, and tolerates a simple trailing-s plural
// mismatch. Not full NLP — just enough to stop "Mitochondria." vs "mitochondria"
// or "ribosome" vs "ribosomes" from being marked wrong over formatting alone.
function normalizeAnswer(s){
  return String(s||'')
    .trim()
    .toLowerCase()
    .replace(/[.,\/#!$%\^&*;:{}=\-_`~()'"?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function answersMatch(a, b){
  const na = normalizeAnswer(a), nb = normalizeAnswer(b);
  if(!na || !nb) return na===nb;
  if(na === nb) return true;
  // Trailing-s tolerance (e.g. "cell" vs "cells") only makes sense for single-word
  // terms. For multi-word phrases or acronym expansions, a trailing-s mismatch is
  // almost always a typo (e.g. "You Only Live Once" vs "...Onces"), not a real
  // plural — so don't silently mark those correct.
  if(na.includes(' ') || nb.includes(' ')) return false;
  const stripS = x => x.replace(/s$/, '');
  return stripS(na) === stripS(nb);
}
function gradeAutoQuestion(q, ans){
  const t = qType(q);
  if(t==='mc') return ans===q.correct ? 1 : 0;
  if(t==='acronym' || t==='identification'){
    if(!ans) return 0;
    const altList = (q.altAnswers||'').split(',').map(s=>s.trim()).filter(Boolean);
    const accepted = [q.correctAnswer, ...altList].filter(Boolean);
    return accepted.some(acc => answersMatch(ans, acc)) ? 1 : 0;
  }
  if(t==='enumeration'){
    const expected = (q.answers||[]).map(s=>s.trim()).filter(Boolean);
    const given = (ans||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const remaining = [...expected];
    let matched = 0;
    given.forEach(g=>{
      const idx = remaining.findIndex(exp => answersMatch(g, exp));
      if(idx!==-1){ matched++; remaining.splice(idx,1); }
    });
    return matched;
  }
  return 0; // essay
}
// A submission is fully graded when every essay question in the assessment has a recorded score.
function submissionFullyGraded(sub, a){
  const essayQs = a.questions.filter(isEssay);
  if(!essayQs.length) return true;
  return essayQs.every(q => sub.essayScores && sub.essayScores[q.id]!==undefined);
}
function recomputeSubmissionScore(sub){
  const essaySum = Object.values(sub.essayScores||{}).reduce((s,v)=>s+(Number(v)||0), 0);
  sub.score = (sub.autoScore||0) + essaySum;
}
function fmtDueDate(dueDateStr){
  if(!dueDateStr) return '';
  const d = new Date(dueDateStr);
  return d.toLocaleString(undefined, {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'});
}
function computeScoreAdjustment(a, submittedAt){
  if(!a.dueDate) return {type:null, amount:0};
  const due = new Date(a.dueDate).getTime();
  if(submittedAt > due) return {type:'late', amount:a.latePenalty||0};
  if(a.earlyBonusEnabled) return {type:'early', amount:a.earlyBonusPoints||0};
  return {type:null, amount:0};
}
function adjustmentNote(sub){
  if(!sub || !sub.adjustment || !sub.adjustment.type || !sub.adjustment.amount) return '';
  if(sub.adjustment.type==='late') return `Base score ${sub.rawScore}/${sub.total} · −${sub.adjustment.amount} pt${sub.adjustment.amount===1?'':'s'} for a late submission`;
  if(sub.adjustment.type==='early') return `Base score ${sub.rawScore}/${sub.total} · +${sub.adjustment.amount} pt${sub.adjustment.amount===1?'':'s'} early-submission bonus`;
  return '';
}
// Screen Watch -> Lablock Admin integration.
// LABLOCK_READY: flip to true once Lablock Admin is actually installed/registered
// at your school and the protocol URL below is confirmed. While false, the sidebar
// shows a "Soon" badge next to Screen Watch so nobody expects it to work yet.
const LABLOCK_READY = false;
// LABLOCK_PROTOCOL_URL: the custom URL scheme Lablock Admin registers on install
// (e.g. "lablockadmin://open"). The browser hands off to the desktop app when this
// is opened, if it's installed. Fill this in once Lablock Admin confirms the scheme.
// LABLOCK_DOWNLOAD_URL: where students/instructors can download the Lablock Admin
// installer. Shown as a button if the app doesn't seem to be installed.
const LABLOCK_PROTOCOL_URL = 'lablockadmin://open';
const LABLOCK_DOWNLOAD_URL = '';

const YEAR_STANDINGS = ['1st Year','2nd Year','3rd Year','4th Year'];
const STUDENT_YEAR_STANDINGS = YEAR_STANDINGS;
const STUDENT_STATUSES = ['Active','Inactive','Dropped','Withdrawn'];
function statusBadgeClass(status){
  if(status==='Active') return 'badge-present';
  if(status==='Inactive') return 'badge-late';
  return 'badge-absent'; // Dropped, Withdrawn
}
function statusBadge(status){
  const s = status || 'Active';
  return `<span class="badge ${statusBadgeClass(s)}">${esc(s)}</span>`;
}
function formatStudentName(surname, firstName, mi){
  const miClean = (mi||'').trim().replace(/\.+$/,'');
  const miPart = miClean ? ' ' + miClean.charAt(0).toUpperCase() + '.' : '';
  return `${surname.trim()}, ${firstName.trim()}${miPart}`;
}
const ATTENDANCE_STATUSES = ['present','late','absent','excused'];
function attLabel(s){ return s==='present'?'Present': s==='late'?'Late': s==='absent'?'Absent': s==='excused'?'Excused':'—'; }
function attBadgeClass(s){ return s==='present'?'badge-present': s==='late'?'badge-late': s==='absent'?'badge-absent': s==='excused'?'badge-excused':'badge-neutral'; }
function attBadge(s){ return `<span class="badge ${attBadgeClass(s)}">${attLabel(s)}</span>`; }

function showToast(msg, kind){
  const tw = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast'+(kind==='err'?' err':'');
  el.textContent = msg;
  tw.appendChild(el);
  setTimeout(()=>{ el.remove(); }, 3200);
}
function openModal(html){ document.getElementById('modal-root').innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">${html}</div>`; }
function closeModal(){ document.getElementById('modal-root').innerHTML=''; }
function setView(v, p){ view=v; params=p||{}; renderApp(); window.scrollTo(0,0); }

/* ============================= AUTH ============================= */
async function doLogin(ev){
  ev && ev.preventDefault();
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const err = document.getElementById('login-err');
  const btn = document.getElementById('login-submit-btn');
  err.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  let data;
  try{
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({schoolId: u, password: p}),
    });
    data = await resp.json();
    if(!resp.ok){
      err.style.display = 'block';
      err.textContent = data.error || 'Incorrect school ID or password.';
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }
  } catch(e){
    err.style.display = 'block';
    err.textContent = 'Could not reach the server. Check your connection and try again.';
    btn.disabled = false;
    btn.textContent = 'Sign in';
    return;
  }
  session = data.user;
  view = session.role==='admin' ? 'admin-dashboard' : session.role==='instructor' ? 'ins-dashboard' : 'stu-dashboard';
  params = {};
  renderApp();
}
function logout(){ session=null; view='login'; params={}; renderApp(); }

/* ============================= RENDER ROOT ============================= */
function renderApp(){
  const root = document.getElementById('root');
  if(!ready){ root.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#7c9791;font-family:Inter,sans-serif;">Loading TCM LMS…</div>`; return; }
  if(!session){ root.innerHTML = renderLogin(); return; }
  // Hard role boundary, checked before anything (title, sidebar, content) reads `view` --
  // a screen belonging to a different role than the signed-in user can never even start
  // rendering, not just "nav happens to hide the link to it".
  const routeRole = view.startsWith('admin-') ? 'admin' : view.startsWith('ins-') ? 'instructor' : view.startsWith('stu-') ? 'student' : null;
  if(routeRole && session.role !== routeRole){
    console.error(`Blocked cross-role render: view "${view}" needs role "${routeRole}", signed in as "${session.role}".`);
    view = {admin:'admin-dashboard', instructor:'ins-dashboard', student:'stu-dashboard'}[session.role];
  }
  root.innerHTML = renderShell();
}

function renderLogin(){
  return `
  <div class="login-wrap">
    <div class="login-stack">
      <div class="login-panel">
        <div class="login-side">
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="brand-mark" style="width:44px;height:44px;"><img src="logo.png" alt="TCM seal"></div>
              <div>
                <div style="font-family:Manrope;font-weight:800;font-size:19px;">TCM LMS</div>
                <div style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#9cdcc9;">For Undergraduates</div>
              </div>
            </div>
            <h2 style="color:#fff;font-size:26px;margin-top:38px;line-height:1.25;">Every class,<br>rooted in one place.</h2>
            <p style="color:#b4e6da;font-size:13.5px;margin-top:12px;max-width:340px;">Quizzes, activities, exams, grades and attendance — for students, instructors, and admins, all in one calm workspace.</p>
            <div style="margin-top:26px;display:flex;flex-direction:column;gap:11px;">
              ${[
                'Auto-graded quizzes, activities, and exams',
                'Attendance tracking with per-student rates',
                'A grade audit trail admins can actually trust',
              ].map(line => `
              <div style="display:flex;align-items:center;gap:9px;font-size:12.5px;color:#d7f3ea;">
                <span style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex:none;font-size:10px;">✓</span>
                ${line}
              </div>`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:22px;font-size:12px;color:#9cdcc9;">
            <div><div style="font-family:Manrope;font-weight:800;font-size:20px;color:#fff;">${DB.users.length}</div>Accounts</div>
            <div><div style="font-family:Manrope;font-weight:800;font-size:20px;color:#fff;">${DB.subjects.length}</div>Subjects</div>
            <div><div style="font-family:Manrope;font-weight:800;font-size:20px;color:#fff;">${DB.sections.length}</div>Sections</div>
          </div>
        </div>
        <div class="login-form-side">
          <h3 style="font-size:21px;">Sign in</h3>
          <p style="color:#7c9791;font-size:13px;margin:4px 0 22px;">Use the account your admin or instructor gave you.</p>
          <form onsubmit="doLogin(event)">
            <div class="form-group"><label>School ID</label><input class="input" id="login-user" autocomplete="username" inputmode="numeric" placeholder="e.g. 20223059" required></div>
            <div class="form-group"><label>Password</label><input class="input" id="login-pass" type="password" autocomplete="current-password" required></div>
            <div id="login-err" style="display:none;color:#c34b40;font-size:12.5px;margin-bottom:10px;font-weight:600;"></div>
            <button class="btn btn-primary" id="login-submit-btn" style="width:100%;justify-content:center;padding:11px;" type="submit">Sign in</button>
          </form>
        </div>
      </div>
      <div class="login-legal-footer">
        © ${new Date().getFullYear()} The College of Maasin ·
        <a href="#" onclick="event.preventDefault(); openLegalModal('copyright')">Copyright</a> ·
        <a href="#" onclick="event.preventDefault(); openLegalModal('privacy')">Privacy Policy</a> ·
        <a href="#" onclick="event.preventDefault(); openLegalModal('terms-use')">Terms of Use</a> ·
        <a href="#" onclick="event.preventDefault(); openLegalModal('terms-agreement')">Terms of Agreement</a>
        <div style="margin-top:4px;opacity:.6;">Build ${BUILD_VERSION}</div>
      </div>
    </div>
  </div>`;
}

/* ============================= LEGAL ============================= */
function legalTitle(type){
  return {copyright:'Copyright', privacy:'Privacy Policy', 'terms-use':'Terms of Use', 'terms-agreement':'Terms of Agreement'}[type] || 'Legal';
}
function legalBody(type){
  const year = new Date().getFullYear();
  if(type==='copyright') return `
    <p>© ${year} The College of Maasin. All rights reserved.</p>
    <p>TCM LMS: For Undergraduates Studies — including its design, source code, and the "TCM LMS" name — was developed as a capstone project for The College of Maasin. The college seal and related marks belong to The College of Maasin and are used here with permission for this system only.</p>
    <p>This system is a student-developed academic prototype. It is not a commercial product, and no part of it may be copied, redistributed, or reused outside its intended academic purpose without permission from the developers and The College of Maasin.</p>`;
  if(type==='privacy') return `
    <p>This Privacy Policy explains what information TCM LMS collects and how it's used. As a school system, it necessarily handles personal and academic information — here's a plain account of what that involves.</p>
    <p><strong>What we collect:</strong> names, school ID numbers, section and year-standing, account credentials (passwords are stored only as irreversible hashes, never in plain text), quiz and exam responses and scores, and attendance records.</p>
    <p><strong>Why:</strong> solely to operate the LMS — authenticating accounts, recording grades and attendance, and letting instructors and admins manage their classes.</p>
    <p><strong>Who can see it:</strong> students see only their own records. Instructors see records for students in their own sections. Admins can see records across the school for administrative purposes. Correct quiz/exam answers are visible only to instructors and admins, never to students before or during grading.</p>
    <p><strong>Where it's stored:</strong> in this browser's local storage on the device being used, unless the school has connected a separate database backend. Nothing is sent to a third party.</p>
    <p><strong>Your rights:</strong> students and staff may request correction of inaccurate records, or deletion of their account, by contacting their school administrator.</p>`;
  if(type==='terms-use') return `
    <p>By using TCM LMS, you agree to the following:</p>
    <p><strong>Acceptable use.</strong> This system is provided for legitimate academic purposes only — taking and administering coursework, recording grades, and tracking attendance. Attempting to access another person's account, tamper with records, or bypass grading safeguards is prohibited.</p>
    <p><strong>Account responsibility.</strong> You're responsible for keeping your password confidential and for activity under your account. Report a compromised account to your administrator immediately.</p>
    <p><strong>Academic integrity.</strong> Assessment answers, correct-answer keys, and grading tools are provided to instructors and admins in trust; sharing correct answers with students before or during an assessment is a violation of academic integrity.</p>
    <p><strong>Availability.</strong> This is an academic capstone system. It's provided as-is, without guarantee of uninterrupted availability, and data may be lost if the browser's storage is cleared unless a backend database has been connected.</p>`;
  if(type==='terms-agreement') return `
    <p>This Terms of Agreement applies to every account created on TCM LMS — student, instructor, and admin alike.</p>
    <p><strong>Account creation.</strong> Accounts are created by an admin or instructor on your behalf. By signing in, you agree that the information associated with your account (name, school ID, section) is accurate to the best of the creating admin/instructor's knowledge, and you agree to notify them of any correction needed.</p>
    <p><strong>Data handling.</strong> You agree to the collection and use of your academic data as described in the Privacy Policy, for the sole purpose of academic administration at The College of Maasin.</p>
    <p><strong>Conduct.</strong> You agree to use the system only for its intended academic purpose, and not to attempt to disrupt, reverse-engineer for malicious purposes, or gain unauthorized access to other accounts or data.</p>
    <p><strong>Termination.</strong> An administrator may suspend or remove an account that violates these terms, or upon a student's or staff member's departure from the college.</p>`;
  return '';
}
function openLegalModal(type){
  openModal(`
  <div class="modal wide">
    <div class="modal-head"><h3>${legalTitle(type)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body" style="font-size:13.3px;line-height:1.7;color:var(--ink-soft);">
      ${legalBody(type)}
      <p class="hint" style="margin-top:16px;">This is a template written for the TCM LMS capstone project — review and adapt the details with The College of Maasin's administration before any real-world deployment.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Close</button></div>
  </div>`);
}

function icon(name){
  const I = {
    home:'<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 19c0-3.3 3-5.5 6.5-5.5S15.5 15.7 15.5 19"/><circle cx="17" cy="9" r="2.6"/><path d="M15 13.6c2.7.3 4.7 2.2 4.7 5.4"/>',
    save:'<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V4"/><path d="M8 14h8v6H8z"/>',
    layers:'<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 18l9 5 9-5"/>',
    book:'<path d="M4 5.5c2-1 5-1 8 0v13c-3-1-6-1-8 0z"/><path d="M20 5.5c-2-1-5-1-8 0v13c3-1 6-1 8 0z"/>',
    clip:'<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.3" width="6" height="3.4" rx="1"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/>',
    calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M8 3v4M16 3v4"/>',
    chart:'<path d="M4 20V10M11 20V4M18 20v-7"/><path d="M2 20h20"/>',
    backup:'<path d="M4 7a8 8 0 1 1 1.6 11.9"/><path d="M4 3v5h5"/><path d="M12 8v4l3 2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    trash:'<path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 5l3 3"/><path d="M13.5 7.5l2.7 2.7"/>',
    down:'<path d="M12 4v13"/><path d="M6 12l6 5 6-5"/><path d="M5 21h14"/>',
    up:'<path d="M12 20V7"/><path d="M6 12l6-5 6 5"/><path d="M5 3h14"/>',
    x:'<path d="M6 6l12 12M18 6L6 18"/>',
    arrow:'<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><circle cx="12" cy="10.5" r="2.6"/>',
    external:'<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
    menu:'<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    bell:'<path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5z"/><path d="M9.5 17a2.5 2.5 0 0 0 5 0"/>',
  };
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[name]||''}</svg>`;
}

function renderShell(){
  const nav = navItems();
  return `
  <div class="app-shell">
    <div class="sidebar-backdrop" onclick="toggleSidebar()"></div>
    <div class="sidebar" id="app-sidebar">
      <div class="brand">
        <div class="brand-mark"><img src="logo.png" alt="TCM seal"></div>
        <div><div class="brand-name">TCM LMS</div><div class="brand-sub">For Undergraduates</div></div>
      </div>
      ${nav.map(group=>`
        <div class="nav-group-label">${group.label}</div>
        ${group.items.map(it=>`
          <div class="nav-item ${view===it.view?'active':''}" onclick="setView('${it.view}')">
            ${icon(it.icon)}<span>${it.label}</span>
            ${it.view==='ins-screenwatch' && !LABLOCK_READY ? '<span class="nav-soon-badge">Soon</span>' : ''}
          </div>`).join('')}
      `).join('')}
      <div class="sidebar-foot">
        <div class="user-chip">
          <div class="user-avatar">${initials(session.name)}</div>
          <div><div class="user-name">${esc(session.name)}</div><div class="user-role">${session.role}</div></div>
        </div>
        ${session.role==='student' ? `<a href="#" onclick="event.preventDefault(); openChangePasswordModal()" style="display:block;text-align:center;font-size:12px;color:#9cdcc9;margin-bottom:8px;">Change password</a>` : ''}
        ${session.role==='admin' ? `<a href="#" onclick="event.preventDefault(); openAdminChangePasswordModal()" style="display:block;text-align:center;font-size:12px;color:#9cdcc9;margin-bottom:8px;">Change password</a>` : ''}
        <button class="logout-btn" onclick="logout()">Sign out</button>
        <div style="text-align:center;margin-top:10px;font-size:10.5px;color:#6ea88c;">
          <a href="#" onclick="event.preventDefault(); openLegalModal('copyright')" style="color:#6ea88c;">Copyright</a> ·
          <a href="#" onclick="event.preventDefault(); openLegalModal('privacy')" style="color:#6ea88c;">Privacy</a> ·
          <a href="#" onclick="event.preventDefault(); openLegalModal('terms-use')" style="color:#6ea88c;">Terms</a> ·
          <a href="#" onclick="event.preventDefault(); openLegalModal('terms-agreement')" style="color:#6ea88c;">Agreement</a>
          <div style="margin-top:4px;opacity:.6;">Build ${BUILD_VERSION}</div>
        </div>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:center;gap:12px;">
          <button class="hamburger-btn" onclick="toggleSidebar()" aria-label="Menu">${icon('menu')}</button>
          <div>
            <h1>${pageTitle()}</h1>
            <div class="topbar-sub">${pageSubtitle()}</div>
          </div>
        </div>
        ${session.role!=='admin' ? `
        <button class="bell-btn" onclick="openNotificationsModal()" aria-label="Notifications">
          ${icon('bell')}${unreadNotificationCount()>0 ? `<span class="bell-badge">${unreadNotificationCount()>9?'9+':unreadNotificationCount()}</span>` : ''}
        </button>` : ''}
      </div>
      <div class="content">${renderContent()}</div>
    </div>
  </div>`;
}
function toggleSidebar(){
  document.getElementById('app-sidebar').classList.toggle('open');
  document.querySelector('.sidebar-backdrop').classList.toggle('open');
}

function navItems(){
  if(session.role==='admin') return [
    {label:'Overview', items:[{view:'admin-dashboard', icon:'home', label:'Dashboard'}]},
    {label:'People', items:[{view:'admin-accounts', icon:'users', label:'Accounts'}]},
    {label:'System', items:[
      {view:'admin-terms', icon:'calendar', label:'School Year & Term'},
      {view:'admin-audit', icon:'clip', label:'Grade Audit Log'},
      {view:'admin-backup', icon:'backup', label:'Backup & Restore'},
    ]},
  ];
  if(session.role==='instructor') return [
    {label:'Overview', items:[{view:'ins-dashboard', icon:'home', label:'Dashboard'}]},
    {label:'Classes', items:[
      {view:'ins-sections', icon:'layers', label:'Class'},
      {view:'ins-subjects', icon:'book', label:'Subjects'},
      {view:'ins-students', icon:'users', label:'Students'},
    ]},
    {label:'Coursework', items:[
      {view:'ins-assessments', icon:'clip', label:'Quizzes & Exams'},
      {view:'ins-grading', icon:'check', label:'Grading'},
      {view:'ins-attendance', icon:'calendar', label:'Attendance'},
    ]},
    {label:'Monitoring', items:[
      {view:'ins-performance', icon:'chart', label:'Performance'},
      {view:'ins-screenwatch', icon:'monitor', label:'Screen Watch'},
    ]},
  ];
  return [
    {label:'Overview', items:[{view:'stu-dashboard', icon:'home', label:'Dashboard'}]},
    {label:'Coursework', items:[
      {view:'stu-todo', icon:'clip', label:'To-Do'},
      {view:'stu-subjects', icon:'book', label:'My Subjects'},
      {view:'stu-grades', icon:'chart', label:'Grades'},
      {view:'stu-attendance', icon:'calendar', label:'Attendance'},
    ]},
  ];
}
function pageTitle(){
  const map = {
    'admin-dashboard':'Dashboard','admin-accounts':'Accounts','admin-terms':'School Year & Term','admin-audit':'Grade Audit Log','admin-backup':'Backup & Restore',
    'ins-dashboard':'Dashboard','ins-sections':'Class','ins-subjects':'Subjects','ins-students':'Students','ins-assessments':'Quizzes & Exams','ins-grading':'Grading','ins-attendance':'Attendance','ins-performance':'Performance','ins-screenwatch':'Screen Watch',
    'stu-dashboard':'Dashboard','stu-todo':'To-Do','stu-subjects':'My Subjects','stu-grades':'My Grades','stu-attendance':'My Attendance','stu-take':'Take Assessment',
  };
  return map[view] || 'TCM LMS';
}
function pageSubtitle(){
  const map = {
    'admin-dashboard':'A quick look at the whole school system.',
    'admin-accounts':'Add instructors and students, edit accounts, and manage passwords.',
    'admin-terms':'Manage the active school year and term. Starting a new one archives the current one — its records stay intact but read-only.',
    'admin-audit':'Every time an instructor sets or edits an essay grade, it\'s recorded here — who, when, and the score before and after.',
    'admin-backup':'Export a full snapshot or restore from a previous backup.',
    'ins-dashboard':'Your classes at a glance.',
    'ins-sections':'Add a year level, then sections inside it — click through to see who\'s enrolled.',
    'ins-subjects':'Browse by year level, then pick a subject to add quizzes, exams, or activities.',
    'ins-students':'Browse by year standing, or search across everyone.',
    'ins-assessments':'Type quizzes, activities, and exams by hand — auto-graded on submission.',
    'ins-grading':'Review submissions, or see each student\'s full score history. Only you and admins can see correct answers.',
    'ins-attendance':'Mark students present, late, or absent for a subject and date.',
    'ins-performance':'Class average, score trends, and attendance — flagged automatically for whoever needs a closer look.',
    'ins-screenwatch':'Monitor student screens during quizzes and exams.',
    'stu-dashboard':`Welcome back, ${session? session.name.split(' ')[0]:''}.`,
    'stu-todo':'Everything you still need to do, and what\'s due soon.',
    'stu-subjects':'Browse your subjects and jump into pending work.',
    'stu-grades':'Your full score history per subject, and whether you\'re trending up or down.',
    'stu-attendance':'Your attendance record by subject.',
    'stu-take':'Answer every question, then submit.',
  };
  return map[view] || '';
}

function renderContent(){
  const routes = {
    'admin-dashboard':adminDashboard,'admin-accounts':adminAccounts,'admin-terms':adminTerms,'admin-audit':adminAudit,'admin-backup':adminBackup,
    'ins-dashboard':insDashboard,'ins-sections':insSections,'ins-subjects':insSubjects,'ins-students':insStudents,'ins-assessments':insAssessments,'ins-grading':insGrading,'ins-attendance':insAttendance,'ins-performance':insPerformance,'ins-screenwatch':insScreenWatch,
    'stu-dashboard':stuDashboard,'stu-todo':stuTodo,'stu-subjects':stuSubjects,'stu-grades':stuGrades,'stu-attendance':stuAttendance,'stu-take':stuTake,
  };
  const fn = routes[view];
  if(fn) return fn();
  const home = {admin:'admin-dashboard', instructor:'ins-dashboard', student:'stu-dashboard'}[session.role];
  return `<div class="card card-pad">${emptyState('layers','Page not found','That screen doesn\'t exist — it may have moved, or the link was outdated.')}
    <div style="text-align:center;margin-top:6px;"><button class="btn btn-primary btn-sm" onclick="setView('${home}')">${icon('home')} Back to Dashboard</button></div>
  </div>`;
}

/* ============================= SHARED ACCOUNT / UI HELPERS ============================= */
/* Moved here from admin.js — these are genuinely role-agnostic, used by 2+ roles. */
function emptyState(iconName,title,desc){
  return `<div class="empty-state">${icon(iconName)}<h4>${title}</h4><div style="font-size:12.8px;">${desc}</div></div>`;
}

function liveSearch(field, value){
  params[field] = value;
  const active = document.activeElement;
  const restore = (active && active.id) ? {id:active.id, s:active.selectionStart, e:active.selectionEnd} : null;
  renderApp();
  if(restore){
    const el = document.getElementById(restore.id);
    if(el){ el.focus(); try{ el.setSelectionRange(restore.s, restore.e); }catch(e){} }
  }
}

function openBatchPasswordModal(){
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Set password for ${selectedAccountIds.size} account(s)</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label><input type="radio" name="bp-mode" value="same" checked onchange="toggleBatchMode('same')"> Use the same password for all</label>
      </div>
      <div id="bp-same-wrap" class="form-group" style="margin-left:22px;"><input class="input" id="bp-same-pass" value="${genPassword()}"></div>
      <div class="form-group">
        <label><input type="radio" name="bp-mode" value="random" onchange="toggleBatchMode('random')"> Generate a unique random password for each</label>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="applyBatchPassword()">${icon('key')} Apply</button></div>
  </div>`);
}

function openBulkImportModal(allowInstructors, year){
  bulkImportMode = 'student';
  bulkImportYear = year || null;
  openModal(bulkImportModalHtml(allowInstructors));
}

function openEditAccountModal(id){
  const u = userById(id);
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Edit account</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      ${u.role==='student' ? `
      <div class="row-2">
        <div class="form-group"><label>Surname</label><input class="input" id="f-surname" value="${esc(u.surname||'')}"></div>
        <div class="form-group"><label>First name</label><input class="input" id="f-firstname" value="${esc(u.firstName||'')}"></div>
      </div>
      <div class="form-group" style="max-width:170px;"><label>Middle initial (optional)</label><input class="input" id="f-mi" maxlength="4" value="${esc(u.middleInitial||'')}"></div>
      ` : `<div class="form-group"><label>Full name</label><input class="input" id="f-name" value="${esc(u.name)}"></div>`}
      <div class="row-2">
        <div class="form-group"><label>School ID</label><input class="input" id="f-username" value="${esc(u.schoolId)}" inputmode="numeric"></div>
        <div class="form-group"><label>New password</label><input class="input" id="f-password" placeholder="Leave blank to keep current"></div>
      </div>
      ${u.role==='student' ? `
      <div class="form-group"><label>Section</label>
        <select class="input" id="f-section">
          <option value="">— No section —</option>
          ${(session.role==='instructor' ? DB.sections.filter(s=>s.instructorId===session.id) : DB.sections).map(s=>`<option value="${s.id}" ${u.sectionId===s.id?'selected':''}>${esc(s.name)} · ${esc(s.yearLevel)}</option>`).join('')}
        </select>
      </div>
      <div class="row-2">
        <div class="form-group"><label>Year standing</label>
          <select class="input" id="f-standing">
            ${STUDENT_YEAR_STANDINGS.map(y=>`<option value="${y}" ${u.yearStanding===y?'selected':''}>${y}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Status</label>
          <select class="input" id="f-status">
            ${STUDENT_STATUSES.map(s=>`<option value="${s}" ${(u.status||'Active')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>` : `<div class="hint">Role: <strong style="text-transform:capitalize;">${u.role}</strong></div>`}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEditAccount('${id}')">${icon('save')} Save changes</button></div>
  </div>`);
}

function openResetPasswordModal(id){
  const u = userById(id);
  const suggested = u.role==='student' ? surnamePassword(u.surname||u.name) : genPassword();
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Reset password — ${esc(u.name)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>New password</label><input class="input" id="rp-pass" value="${esc(suggested)}"></div>
      <p class="hint">This won't be shown again after you close this — copy it now to share with ${esc(u.name)}.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="applyResetPassword('${id}')">${icon('key')} Set password</button></div>
  </div>`);
}

function statCard(iconName,label,value,urgent){
  return `<div class="stat-card${urgent?' stat-card-urgent':''}"><div class="stat-icon${urgent?' stat-icon-urgent':''}">${icon(iconName)}</div><div class="stat-label">${label}</div><div class="stat-value${urgent?' stat-value-urgent':''}">${value}</div></div>`;
}

function toggleSelectOne(id, checked){ checked? selectedAccountIds.add(id) : selectedAccountIds.delete(id); renderApp(); }

function updateSurnameLivePassword(){
  if(autoPasswordEdited) return;
  const sEl = document.getElementById('f-surname');
  const pEl = document.getElementById('f-password');
  if(sEl && pEl) pEl.value = surnamePassword(sEl.value.trim());
}

