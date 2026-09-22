/* =====================================================================
   STUDENT.JS — every student-only page and function (dashboard, to-do,
   subjects, grades, attendance, taking an assessment). Depends on
   core.js, which must load first. Nothing in this file is used by
   admin.js or instructor.js — it's genuinely self-contained.
   ===================================================================== */
/* ============================= STUDENT ============================= */
function myEnrolledSubjects(){
  if(!session.sectionId) return [];
  return DB.subjects.filter(s=>s.sectionId===session.sectionId);
}
function openChangePasswordModal(){
  openModal(`
  <div class="modal">
    <div class="modal-head"><h3>Change password</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Current password</label><input class="input" type="password" id="cp-current" autocomplete="current-password"></div>
      <div class="form-group"><label>New password</label><input class="input" type="password" id="cp-new" autocomplete="new-password"></div>
      <div class="form-group"><label>Confirm new password</label><input class="input" type="password" id="cp-confirm" autocomplete="new-password"></div>
      <div id="cp-err" class="hint" style="color:var(--rose);display:none;"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveChangePassword()">${icon('save')} Update password</button></div>
  </div>`);
}
async function saveChangePassword(){
  const current = document.getElementById('cp-current').value;
  const next = document.getElementById('cp-new').value;
  const confirmVal = document.getElementById('cp-confirm').value;
  const errEl = document.getElementById('cp-err');
  const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
  if(!current || !next || !confirmVal){ showErr('Please fill in all three fields.'); return; }
  const currentHash = await hashPassword(current, session.salt);
  if(currentHash !== session.passwordHash){ showErr('Current password is incorrect.'); return; }
  if(next !== confirmVal){ showErr('New password and confirmation don\'t match.'); return; }
  if(next === current){ showErr('New password must be different from your current one.'); return; }
  session.salt = generateSalt();
  session.passwordHash = await hashPassword(next, session.salt);
  await persist('users');
  closeModal();
  showToast('Password updated.');
}
function checkDeadlineReminders(){
  const subs = myEnrolledSubjects();
  const now = Date.now();
  const windowMs = 48*60*60*1000; // remind once a deadline is within 48 hours
  subs.forEach(subj=>{
    assessmentsOfSubject(subj.id).forEach(a=>{
      if(!a.dueDate) return;
      const due = new Date(a.dueDate).getTime();
      if(isNaN(due)) return;
      const msUntilDue = due - now;
      if(msUntilDue<=0 || msUntilDue>windowMs) return; // not due yet, or too far out, or already past
      if(submissionFor(a.id, session.id)) return; // already submitted, nothing to remind about
      const alreadyReminded = DB.notifications.some(n=>n.userId===session.id && n.params && n.params.assessmentId===a.id && n.message.startsWith('Reminder:'));
      if(alreadyReminded) return;
      const hoursLeft = Math.max(1, Math.round(msUntilDue/(60*60*1000)));
      notifyUser(session.id, `Reminder: ${a.title} (${subj.name}) is due in about ${hoursLeft} hour${hoursLeft===1?'':'s'}.`, 'stu-take', {assessmentId:a.id});
    });
  });
}
function stuDashboard(){
  checkDeadlineReminders();
  const subs = myEnrolledSubjects();
  const allAssessments = subs.flatMap(s=>assessmentsOfSubject(s.id));
  const done = allAssessments.filter(a=>submissionFor(a.id, session.id)).length;
  const pending = allAssessments.length - done;
  const myAtt = DB.attendance.filter(r=>r.studentId===session.id);
  const presentCt = myAtt.filter(r=>r.status==='present').length;
  const rate = myAtt.length ? Math.round(presentCt/myAtt.length*100) : null;
  return `
  <div class="card card-pad" style="margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div class="kv-list" style="flex-direction:row;gap:22px;">
      <div><div class="stat-label">Year standing</div><div style="font-weight:700;color:var(--e-900);margin-top:3px;">${esc(session.yearStanding||'—')}</div></div>
      <div><div class="stat-label">Enrollment status</div><div style="margin-top:5px;">${statusBadge(session.status)}</div></div>
    </div>
    ${session.status && session.status!=='Active' ? `<div style="font-size:12.5px;color:var(--rose);font-weight:600;max-width:320px;">Your enrollment status is marked as ${esc(session.status)}. Contact the registrar or your admin if this doesn't look right.</div>` : ''}
  </div>
  <div class="grid grid-4" style="margin-bottom:22px;">
    ${statCard('book','My subjects', subs.length)}
    ${statCard('clip','Pending assessments', pending)}
    ${statCard('check','Completed', done)}
    ${statCard('calendar','Attendance rate', rate===null? '—' : rate+'%')}
  </div>
  ${!session.sectionId? `<div class="card card-pad">${emptyState('layers','No section assigned yet','Ask your admin to assign you to a class section.')}</div>` : ''}
  <div class="card card-pad">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${pending?'10px':'0'};">
      <div class="section-title" style="margin:0;">Pending work</div>
      ${pending>0 ? `<button class="btn btn-ghost btn-sm" onclick="setView('stu-todo')">View all →</button>` : ''}
    </div>
    ${pending>0 ? `<div class="kv-list">
      ${allAssessments.filter(a=>!submissionFor(a.id, session.id)).slice(0,3).map(a=>{
        const subj = subjectById(a.subjectId);
        return `<div class="kv-row"><span>${typeBadge(a.type)} &nbsp;${esc(a.title)} <span style="color:var(--muted);">— ${esc(subj.name)}</span></span>
        <button class="btn btn-outline btn-sm" onclick="setView('stu-take',{assessmentId:'${a.id}'})">Start</button></div>`;
      }).join('')}
    </div>
    ${pending>3 ? `<div class="hint" style="margin-top:8px;">+${pending-3} more on your <a href="#" onclick="event.preventDefault(); setView('stu-todo')">To-Do page</a>.</div>` : ''}
    ` : emptyState('check','All caught up','No pending quizzes, activities, or exams right now.')}
  </div>`;
}
function stuTodo(){
  const subs = myEnrolledSubjects();
  const pending = [];
  subs.forEach(s=>{
    assessmentsOfSubject(s.id).forEach(a=>{
      if(!submissionFor(a.id, session.id)) pending.push({subject:s, assessment:a});
    });
  });
  const withDue = pending.filter(p=>p.assessment.dueDate).sort((a,b)=> new Date(a.assessment.dueDate) - new Date(b.assessment.dueDate));
  const now = Date.now();

  const upcomingHtml = withDue.length ? `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Assessment</th><th>Subject</th><th>Due</th><th></th></tr></thead>
        <tbody>${withDue.map(p=>{
          const overdue = new Date(p.assessment.dueDate).getTime() < now;
          return `<tr>
            <td style="font-weight:700;">${typeBadge(p.assessment.type)} ${esc(p.assessment.title)}</td>
            <td>${esc(p.subject.name)}</td>
            <td style="${overdue?'color:var(--rose);font-weight:700;':''}">${esc(fmtDueDate(p.assessment.dueDate))}${overdue?' — overdue':''}</td>
            <td style="text-align:right;"><button class="btn btn-outline btn-sm" onclick="setView('stu-take',{assessmentId:'${p.assessment.id}'})">Start</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>` : `<div class="card">${emptyState('calendar','Nothing due soon','Assessments with a deadline will show up here.')}</div>`;

  const allHtml = pending.length ? `
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Assessment</th><th>Subject</th><th>Deadline</th><th></th></tr></thead>
        <tbody>${pending.map(p=>`
          <tr>
            <td style="font-weight:700;">${typeBadge(p.assessment.type)} ${esc(p.assessment.title)}</td>
            <td>${esc(p.subject.name)}</td>
            <td>${p.assessment.dueDate ? esc(fmtDueDate(p.assessment.dueDate)) : '<span class="hint">No deadline</span>'}</td>
            <td style="text-align:right;"><button class="btn btn-outline btn-sm" onclick="setView('stu-take',{assessmentId:'${p.assessment.id}'})">Start</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>` : `<div class="card">${emptyState('check','All caught up','No pending quizzes, activities, or exams right now.')}</div>`;

  return `
  <div class="section-title" style="margin-bottom:2px;">Upcoming</div>
  <div class="section-desc">Assessments with a deadline, soonest first — with the date and time due.</div>
  <div style="margin-bottom:22px;">${upcomingHtml}</div>
  <div class="section-title" style="margin-bottom:2px;">To-Do</div>
  <div class="section-desc">Every active assessment you haven't submitted yet, across all your subjects.</div>
  ${allHtml}`;
}
function stuSubjects(){
  const subs = myEnrolledSubjects();
  if(!subs.length) return emptyState('book','No subjects yet','You\'ll see subjects here once your admin assigns you to a section.');
  return `
  <div class="hint" style="margin-bottom:14px;">This is for jumping into pending work. For your full score history and how you're trending, see <a href="#" onclick="setView('stu-grades');return false;" style="color:var(--e-700);font-weight:700;">My Grades →</a></div>
  <div class="grid grid-3">${subs.map(s=>{
    const items = assessmentsOfSubject(s.id);
    return `<div class="card card-pad">
      <div style="font-weight:800;font-size:15px;color:var(--e-950);margin-bottom:10px;">${esc(s.name)}</div>
      ${items.length? items.map(a=>{
        const done = submissionFor(a.id, session.id);
        const pending = done && !submissionFullyGraded(done, a);
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px dashed var(--border-soft);">
          <span style="font-size:12.8px;">${typeBadge(a.type)} ${esc(a.title)}</span>
          ${!done ? `<button class="btn btn-outline btn-sm" onclick="setView('stu-take',{assessmentId:'${a.id}'})">Take</button>`
            : pending ? `<span class="badge badge-late">Pending</span>`
            : `<span class="badge badge-present">${done.score}/${done.total}</span>`}
        </div>`;
      }).join('') : `<div class="hint">No assessments posted yet.</div>`}
    </div>`;
  }).join('')}</div>`;
}
function stuTake(){
  const a = assessmentById(params.assessmentId);
  if(!a) return emptyState('clip','Assessment not found','It may have been removed by your instructor.');
  const existing = submissionFor(a.id, session.id);
  if(existing){
    const note = adjustmentNote(existing);
    const pending = !submissionFullyGraded(existing, a);
    return `<div class="card card-pad">
      <div class="badge badge-present" style="margin-bottom:12px;">Already submitted</div>
      <h3 style="margin-bottom:6px;">${esc(a.title)}</h3>
      ${pending
        ? `<p style="color:var(--muted);font-size:13px;">Your instructor is still grading part of this (essay questions). Auto-graded portion so far: <strong style="color:var(--e-800);">${existing.score}/${existing.total}</strong>.</p>`
        : `<p style="color:var(--muted);font-size:13px;">You scored <strong style="color:var(--e-800);">${existing.score}/${existing.total}</strong> (${Math.round(existing.score/existing.total*100)}%). Your instructor can review the correct answers with you.</p>`}
      ${note ? `<p style="color:var(--muted);font-size:12.3px;margin-top:4px;">${esc(note)}</p>` : ''}
      <button class="btn btn-outline" style="margin-top:10px;" onclick="setView('stu-subjects')">Back to subjects</button>
    </div>`;
  }
  if(takeDraft.assessmentId!==a.id){ takeDraft = {assessmentId:a.id, answers:{}}; }
  const now = Date.now();
  const due = a.dueDate ? new Date(a.dueDate).getTime() : null;
  let deadlineHint = '';
  if(due){
    if(now > due){
      deadlineHint = `<div class="hint" style="color:var(--rose);margin-top:6px;">Past the deadline (${esc(fmtDueDate(a.dueDate))})${a.latePenalty ? ` — submitting now applies a ${a.latePenalty}-point penalty.` : '.'}</div>`;
    } else {
      deadlineHint = `<div class="hint" style="margin-top:6px;">Due ${esc(fmtDueDate(a.dueDate))}${a.earlyBonusEnabled && a.earlyBonusPoints ? ` — submit before then for a +${a.earlyBonusPoints} point bonus.` : '.'}</div>`;
    }
  }
  return `
  <div class="card card-pad">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div><h3>${esc(a.title)}</h3><div class="hint">${typeBadge(a.type)} &nbsp;${esc(a.instructions||'Answer every question, then submit.')}</div>${deadlineHint}</div>
    </div>
    <div style="margin-top:18px;">
    ${a.questions.map((q,i)=>`
      <div class="qcard">
        <strong style="font-size:13.3px;">${i+1}. ${esc(q.text)}</strong>
        <div style="margin-top:8px;">
        ${takeAnswerFieldHtml(q)}
        </div>
      </div>`).join('')}
    </div>
    <button class="btn btn-primary" onclick="submitAssessment('${a.id}')">${icon('check')} Submit</button>
  </div>`;
}
function takeAnswerFieldHtml(q){
  const t = qType(q);
  if(t==='mc'){
    return q.choices.map((c,ci)=>`
      <label class="choice-row" style="cursor:pointer;">
        <input type="radio" name="take-${q.id}" ${takeDraft.answers[q.id]===ci?'checked':''} onchange="setTakeAnswer('${q.id}', ${ci})">
        <span class="choice-letter">${choiceLetter(ci)}</span>
        <span>${esc(c)}</span>
      </label>`).join('');
  }
  if(t==='enumeration'){
    const n = Math.max(1, (q.answers||[]).filter(a=>a.trim()).length);
    return `<textarea class="input" rows="${Math.max(3,n)}" placeholder="One answer per line…" oninput="takeDraft.answers['${q.id}']=this.value">${esc(takeDraft.answers[q.id]||'')}</textarea>
      <div class="hint" style="margin-top:6px;">${n} expected answer${n===1?'':'s'} — one per line.</div>`;
  }
  if(t==='acronym' || t==='identification'){
    return `<input class="input" placeholder="Your answer…" value="${esc(takeDraft.answers[q.id]||'')}" oninput="takeDraft.answers['${q.id}']=this.value">`;
  }
  if(t==='essay'){
    return `<textarea class="input" rows="6" placeholder="Write your answer…" oninput="takeDraft.answers['${q.id}']=this.value">${esc(takeDraft.answers[q.id]||'')}</textarea>
      <div class="hint" style="margin-top:6px;">Graded manually by your instructor — worth ${questionPoints(q)} point${questionPoints(q)===1?'':'s'}.</div>`;
  }
  return '';
}
function setTakeAnswer(qid, idx){ takeDraft.answers[qid]=idx; renderApp(); }
function submitAssessment(aid){
  const a = assessmentById(aid);
  const unanswered = a.questions.filter(q=>{
    const ans = takeDraft.answers[q.id];
    return qType(q)==='mc' ? ans===undefined : !(ans && String(ans).trim());
  });
  if(unanswered.length){ showToast(`Please answer all questions (${unanswered.length} left).`,'err'); return; }

  let autoRaw = 0;
  a.questions.forEach(q=>{ if(!isEssay(q)) autoRaw += gradeAutoQuestion(q, takeDraft.answers[q.id]); });

  const submittedAt = Date.now();
  const adjustment = computeScoreAdjustment(a, submittedAt);
  let autoScore = autoRaw;
  if(adjustment.type==='late') autoScore = Math.max(0, autoScore - adjustment.amount);
  else if(adjustment.type==='early') autoScore = autoScore + adjustment.amount;

  const total = assessmentTotalPoints(a);
  const hasEssay = assessmentHasEssay(a);
  const submission = {
    id:uid(), assessmentId:aid, studentId:session.id, answers:{...takeDraft.answers},
    rawScore:autoRaw, autoScore, essayScores:{}, score:autoScore, total, adjustment, submittedAt
  };
  DB.submissions.push(submission);
  persist('submissions');
  const subjForNotif = subjectById(a.subjectId);
  if(subjForNotif && subjForNotif.instructorId){
    notifyUser(subjForNotif.instructorId, `New submission from ${session.name} for ${a.title}`, 'ins-grading', {subjectId:a.subjectId, assessmentId:a.id});
  }
  takeDraft = {assessmentId:null, answers:{}};

  let msg;
  if(hasEssay){
    msg = `Submitted! Auto-graded portion: ${autoScore}/${total}. Your instructor will grade the essay part separately.`;
  } else {
    msg = `Submitted! You scored ${autoScore}/${total}.`;
    if(adjustment.type==='late' && adjustment.amount) msg += ` (−${adjustment.amount} pt late penalty)`;
    if(adjustment.type==='early' && adjustment.amount) msg += ` (+${adjustment.amount} pt early bonus)`;
  }
  showToast(msg);
  setView('stu-subjects');
}
function stuGrades(){
  const subs = myEnrolledSubjects();
  if(!subs.length) return emptyState('chart','No grades yet','Grades will appear once you\'re assigned a subject.');
  return subs.map(s=>{
    const items = assessmentsOfSubject(s.id).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const graded = items.map(a=>({a, sub:submissionFor(a.id, session.id)})).filter(x=>x.sub && submissionFullyGraded(x.sub, x.a));
    const avg = graded.length ? Math.round(graded.reduce((sum,x)=>sum+(x.sub.score/x.sub.total*100),0)/graded.length) : null;

    let trend = null;
    if(graded.length>=2){
      const pcts = graded.map(x=>x.sub.score/x.sub.total*100);
      const mid = Math.ceil(pcts.length/2);
      const firstHalf = pcts.slice(0,mid), secondHalf = pcts.slice(mid);
      if(secondHalf.length){
        const firstAvg = firstHalf.reduce((a,b)=>a+b,0)/firstHalf.length;
        const secondAvg = secondHalf.reduce((a,b)=>a+b,0)/secondHalf.length;
        const diff = secondAvg-firstAvg;
        trend = diff>5 ? 'up' : diff<-5 ? 'down' : 'flat';
      }
    }
    const trendLabel = {
      up: '<span style="color:var(--e-700);font-weight:700;">▲ Improving</span>',
      down: '<span style="color:var(--rose);font-weight:700;">▼ Declining</span>',
      flat: '<span class="hint">Steady</span>',
    };

    return `<div class="card card-pad" style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
        <div class="section-title" style="margin:0;">${esc(s.name)}</div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${trend ? `${trendLabel[trend]}${graded.length<=2?' <span class="hint" title="Based on only '+graded.length+' graded assessments so far.">(early)</span>':''}` : ''}
          ${avg!==null ? `<div class="badge badge-present" style="font-size:13px;padding:6px 12px;">Average: ${avg}%</div>` : `<span class="hint">No graded work yet</span>`}
        </div>
      </div>
      ${items.length? `<div class="table-wrap"><table><thead><tr><th>Assessment</th><th>Type</th><th>Score</th><th>%</th></tr></thead>
      <tbody>${items.map(a=>{
        const sub = submissionFor(a.id, session.id);
        const pending = sub && !submissionFullyGraded(sub, a);
        return `<tr><td style="font-weight:700;">${esc(a.title)}</td><td>${typeBadge(a.type)}</td>
        <td>${sub? sub.score+'/'+sub.total : '—'}</td>
        <td>${!sub ? '<span class="hint">Not taken</span>' : pending ? '<span class="badge badge-late">Pending</span>' : Math.round(sub.score/sub.total*100)+'%'}</td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="hint">No assessments posted yet.</div>`}
    </div>`;
  }).join('');
}
function stuAttendance(){
  const subs = myEnrolledSubjects();
  if(!subs.length) return emptyState('calendar','No attendance yet','Attendance will appear once you\'re assigned a subject.');
  const subjectId = params.subjectId && subs.some(s=>s.id===params.subjectId) ? params.subjectId : subs[0].id;
  params.subjectId = subjectId;
  const records = DB.attendance.filter(r=>r.subjectId===subjectId && r.studentId===session.id).sort((a,b)=>b.date.localeCompare(a.date));
  const present = records.filter(r=>r.status==='present').length;
  const late = records.filter(r=>r.status==='late').length;
  const absent = records.filter(r=>r.status==='absent').length;
  const excused = records.filter(r=>r.status==='excused').length;
  return `
  <div class="toolbar"><div class="toolbar-left">${subjectPicker2(subjectId, subs)}</div></div>
  <div class="grid grid-4" style="margin-bottom:18px;">
    ${statCard('check','Present', present)}
    ${statCard('calendar','Late', late)}
    ${statCard('calendar','Absent', absent)}
    ${statCard('calendar','Excused', excused)}
  </div>
  <div class="card" style="overflow:hidden;">
    ${records.length? `
    <div class="glist-head" style="grid-template-columns:1fr 1fr 1fr;">
      <div>Date</div><div style="text-align:center;">Status</div><div></div>
    </div>
    ${records.map(r=>`
      <div class="glist-row" style="grid-template-columns:1fr 1fr 1fr;">
        <div style="font-weight:700;color:var(--e-950);">${fmtDate(r.date)}</div>
        <div style="text-align:center;">${attBadge(r.status)}</div>
        <div></div>
      </div>`).join('')}`
    : emptyState('calendar','No attendance recorded yet','Your instructor hasn\'t taken attendance for this subject.')}
  </div>`;
}
function subjectPicker2(currentId, subs){
  return `<select class="input" style="width:260px;" onchange="params.subjectId=this.value; renderApp()">
    ${subs.map(s=>`<option value="${s.id}" ${s.id===currentId?'selected':''}>${esc(s.name)}</option>`).join('')}
  </select>`;
}

