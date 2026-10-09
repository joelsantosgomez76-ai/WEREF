/* ---------------- FORMACIÓN DEL COMITÉ (Bages) ----------------
   Tests mensuales privados para los árbitros que elige el administrador.
   Toda la seguridad vive en Supabase (ver supabase/committee.sql): aquí solo se pinta.
   Depende de app.js (STATE, render, esc, allQuestions, LAW_NAMES, isDevUser). */

const COMMITTEE = {
  status: null,       // null = sin cargar · {is_admin, is_member, setupMissing?}
  myTests: null,
  tests: null,        // admin: tabla committee_tests (con nº de preguntas)
  members: null,
  attempts: null,
  ruleStats: null,
  qStats: null,
  tab: 'tests',
  rankMonth: 'all',
  newMemberEmail: '',
  detailTestId: null,
  run: null,
  result: null,
  builder: null,
  error: null
};

const CM_LETTERS = ['a', 'b', 'c', 'd'];
const CM_PAGE_SIZE = 12;

/* ---------- utilidades ---------- */
function cmErrText(err){
  const m = String((err && (err.message || err.code)) || err || '');
  const known = {
    no_access: 'No tienes acceso a este apartado.',
    not_found: 'No se ha encontrado el test.',
    not_open: 'Este test todavía no está abierto.',
    closed: 'Este test ya ha cerrado.',
    no_attempts_left: 'Ya has agotado los intentos de este test.',
    review_not_available: 'Las respuestas correctas se publicarán cuando cierre el test.',
    no_attempt: 'Todavía no has hecho este test.',
    no_questions: 'El test no tiene preguntas.'
  };
  for(const k in known){ if(m.includes(k)) return known[k]; }
  if(/Could not find the function|PGRST202|PGRST205|42883|42P01|does not exist|schema cache/i.test(m + ' ' + (err && err.code || ''))){
    return 'Falta ejecutar el archivo SQL del comité en Supabase.';
  }
  return 'Error: ' + m;
}
function cmFmtDate(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function cmFmtDay(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES');
}
function cmFmtDur(sec){
  if(sec === null || sec === undefined) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
function cmWho(r){ return r.username || r.full_name || r.email || '—'; }
function cmToast(msg){ STATE.toast = msg; render(); }
function cmInCommittee(){ return typeof STATE.view === 'string' && STATE.view.startsWith('committee'); }
function cmRefresh(){ if(cmInCommittee()) render(); }
function cmSetupWarning(){
  if(!(COMMITTEE.status && COMMITTEE.status.setupMissing)) return '';
  return `<div class="qcard" style="border-color:#F0C4C4; margin-bottom:14px;">
    <div style="font-weight:700; margin-bottom:6px;">Falta un paso de instalación</div>
    <div style="font-size:13.5px; color:var(--ink);">Hay que ejecutar una vez el archivo <span class="mono">supabase/committee.sql</span> en Supabase (SQL Editor). Hasta entonces este apartado no funcionará.</div>
  </div>`;
}
function cmExport(rows, sheetName, fileName){
  if(typeof XLSX === 'undefined'){ cmToast('No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'); return; }
  if(!rows.length){ cmToast('No hay datos que exportar.'); return; }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

/* ---------- carga de datos ---------- */
async function loadCommitteeStatus(){
  try{
    const { data, error } = await supabaseClient.rpc('committee_status');
    if(error) throw error;
    COMMITTEE.status = data;
  }catch(e){
    COMMITTEE.status = { is_admin: isDevUser(), is_member: false, setupMissing: true };
  }
  if(STATE.view === 'home') render();
}

async function cmLoadMyTests(){
  COMMITTEE.error = null;
  const { data, error } = await supabaseClient.rpc('committee_my_tests');
  if(error){ COMMITTEE.error = cmErrText(error); COMMITTEE.myTests = []; }
  else { COMMITTEE.myTests = data || []; }
  cmRefresh();
}

async function cmLoadAdminData(){
  COMMITTEE.error = null;
  const results = await Promise.all([
    supabaseClient.from('committee_tests').select('*, committee_test_questions(count)').order('created_at', { ascending: false }),
    supabaseClient.rpc('committee_admin_list_members'),
    supabaseClient.rpc('committee_admin_all_attempts'),
    supabaseClient.rpc('committee_admin_rule_stats')
  ]);
  const firstErr = results.map(r => r.error).find(Boolean);
  if(firstErr){
    COMMITTEE.error = cmErrText(firstErr);
    COMMITTEE.tests = COMMITTEE.tests || [];
    COMMITTEE.members = COMMITTEE.members || [];
    COMMITTEE.attempts = COMMITTEE.attempts || [];
    COMMITTEE.ruleStats = COMMITTEE.ruleStats || [];
  } else {
    COMMITTEE.tests = (results[0].data || []).map(t => Object.assign({}, t, {
      question_count: (t.committee_test_questions && t.committee_test_questions[0]) ? t.committee_test_questions[0].count : 0
    }));
    COMMITTEE.members = results[1].data || [];
    COMMITTEE.attempts = results[2].data || [];
    COMMITTEE.ruleStats = results[3].data || [];
  }
  cmRefresh();
}

/* ---------- entrada desde la pantalla de inicio ---------- */
function cmHomeButton(){
  const st = COMMITTEE.status;
  if(!st || !(st.is_admin || st.is_member)) return '';
  return `<button class="btn btn-yellow" data-action="committee-open">🏅 Formación Comité Bages</button>`;
}

/* ---------- enrutado de vistas ---------- */
function committeeView(v){
  if(v === 'committeeAdmin') return cmAdminView();
  if(v === 'committeeBuilder') return cmBuilderView();
  if(v === 'committeeTestDetail') return cmTestDetailView();
  if(v === 'committeeRun') return cmRunView();
  if(v === 'committeeResult') return cmResultView();
  return cmMemberView();
}

/* ---------- miembro: lista de tests ---------- */
function cmMemberView(){
  const list = COMMITTEE.myTests;
  const now = Date.now();
  let body;
  if(COMMITTEE.error) body = `<div class="empty-state">${esc(COMMITTEE.error)}</div>`;
  else if(list === null) body = '<div class="empty-state">Cargando...</div>';
  else if(!list.length) body = '<div class="empty-state">Todavía no hay ningún test publicado. El comité te avisará cuando haya uno.</div>';
  else body = list.map(t => cmMemberTestCard(t, now)).join('');
  const back = (COMMITTEE.status && COMMITTEE.status.is_admin) ? 'committee-open' : 'home';
  return `
  <button class="backbtn" data-action="${back}">&larr; ${back === 'home' ? 'Inicio' : 'Volver'}</button>
  <h2 style="margin-bottom:4px;">Formación Comité Bages</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Tests del comité. Tu resultado es privado: la clasificación solo la ve el comité.</div>
  ${body}`;
}

function cmMemberTestCard(t, now){
  const opens = Date.parse(t.opens_at);
  const closes = t.closes_at ? Date.parse(t.closes_at) : null;
  const notOpen = now < opens;
  const closed = closes !== null && now >= closes;
  const left = t.max_attempts - t.attempts_used;
  const done = t.attempts_used > 0;
  let status, action = '';
  if(notOpen) status = `<span class="badge" style="background:var(--line); color:var(--ink);">Abre el ${cmFmtDate(t.opens_at)}</span>`;
  else if(closed) status = `<span class="badge" style="background:var(--line); color:var(--ink);">Cerrado</span>`;
  else status = `<span class="badge" style="background:var(--green-ok); color:#fff;">Abierto${closes ? ' hasta el ' + cmFmtDate(t.closes_at) : ''}</span>`;
  if(!notOpen && !closed && left > 0){
    action = `<button class="btn btn-primary" data-action="committee-start" data-tid="${t.id}">${done ? 'Hacer otro intento' : 'Empezar test'}</button>`;
  } else if(done && (closed || !closes)){
    action = `<button class="btn btn-secondary" data-action="committee-review" data-tid="${t.id}">Ver respuestas</button>`;
  }
  const result = done
    ? `<div style="margin-top:8px; font-size:13.5px;"><strong>Tu mejor resultado:</strong> ${t.best_score} / ${t.best_total} <span class="mono" style="color:var(--muted);">(${Math.round(t.best_score / t.best_total * 100)}%)</span> · intentos: ${t.attempts_used}/${t.max_attempts}</div>`
    : `<div style="margin-top:8px; font-size:13px; color:var(--muted);">${t.total_questions} preguntas · intentos: ${t.attempts_used}/${t.max_attempts}</div>`;
  return `<div class="qcard" style="margin-bottom:10px;">
    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
      <div style="font-weight:700; font-size:16px;">${esc(t.title)}</div>
      ${status}
    </div>
    ${result}
    ${action ? `<div style="margin-top:12px;">${action}</div>` : ''}
  </div>`;
}

/* ---------- miembro: hacer el test ---------- */
function cmRunView(){
  const r = COMMITTEE.run;
  if(!r) return cmMemberView();
  const qs = r.test.questions;
  const q = qs[r.idx];
  const answered = Object.keys(r.answers).length;
  const sel = r.answers[q.pos];
  const isLast = r.idx === qs.length - 1;
  return `
  <button class="backbtn" data-action="committee-exit-run">&larr; Salir</button>
  <h2 style="margin-bottom:4px;">${esc(r.test.title)}</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:10px; font-size:13.5px;">Pregunta ${r.idx + 1} de ${qs.length} · ${answered} respondidas</div>
  <div class="progress-track"><div class="progress-fill" style="width:${Math.round(answered / qs.length * 100)}%"></div></div>
  <div class="qcard">
    ${q.rule ? `<div class="qtag">Regla ${q.rule} · ${esc(LAW_NAMES[q.rule] || '')}</div>` : ''}
    <div class="qtext">${esc(q.question)}</div>
    ${q.options.map((o, i) => `<button class="option ${sel === CM_LETTERS[i] ? 'selected' : ''}" data-action="committee-answer" data-letter="${CM_LETTERS[i]}"><span class="letter">${CM_LETTERS[i]})</span>${esc(o)}</button>`).join('')}
  </div>
  <div style="display:flex; gap:10px; justify-content:space-between; margin-top:14px;">
    <button class="btn btn-ghost" data-action="committee-prev" ${r.idx === 0 ? 'disabled' : ''}>&larr; Anterior</button>
    ${isLast
      ? `<button class="btn btn-primary" data-action="committee-finish" ${r.submitting ? 'disabled' : ''}>${r.submitting ? 'Enviando...' : 'Finalizar test'}</button>`
      : `<button class="btn btn-primary" data-action="committee-next">Siguiente &rarr;</button>`}
  </div>`;
}

function cmResultView(){
  const r = COMMITTEE.result;
  if(!r) return cmMemberView();
  const pct = Math.round(r.score / r.total * 100);
  const review = r.review ? r.review.map((q, idx) => `
    <div class="qcard" style="margin-bottom:10px;">
      ${q.rule ? `<div class="qtag">Regla ${q.rule} · ${esc(LAW_NAMES[q.rule] || '')}</div>` : ''}
      <div class="qtext" style="font-size:14.5px;">${idx + 1}. ${esc(q.question)}</div>
      ${q.options.map((o, i) => {
        const letter = CM_LETTERS[i];
        let cls = 'option';
        if(letter === q.correct) cls += ' correct';
        else if(letter === q.chosen) cls += ' incorrect';
        return `<div class="${cls}" style="cursor:default; padding:9px 12px;"><span class="letter">${letter})</span>${esc(o)}</div>`;
      }).join('')}
      ${q.chosen ? '' : '<div style="font-size:12.5px; color:var(--red); margin-top:6px;">Sin responder</div>'}
      ${q.explanation ? `<div style="margin-top:8px; padding:8px 12px; background:#FBF1F1; border-radius:8px; font-size:12.5px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    </div>`).join('') : '';
  return `
  <button class="backbtn" data-action="committee-open">&larr; Volver</button>
  <h2 style="margin-bottom:4px;">${esc(r.title)}</h2>
  <div class="result-hero">
    <div class="big" style="color:${scoreColor(pct)};">${pct}%</div>
    <div class="label">${r.score} de ${r.total} respuestas correctas</div>
  </div>
  ${r.review ? `<div class="section-title">Revisión</div>${review}` : `<div class="empty-state">Tu resultado ya está guardado. Las respuestas correctas se publicarán cuando cierre el test.</div>`}`;
}

/* ---------- administrador: panel ---------- */
function cmAdminView(){
  const st = COMMITTEE.status || {};
  const tabs = [['tests', 'Tests'], ['members', 'Miembros'], ['ranking', 'Clasificación'], ['stats', 'Puntos débiles']];
  if(st.is_member) tabs.push(['mine', 'Mis tests']);
  const tab = COMMITTEE.tab;
  let content;
  if(COMMITTEE.tests === null) content = '<div class="empty-state">Cargando...</div>';
  else if(tab === 'members') content = cmMembersTab();
  else if(tab === 'ranking') content = cmRankingTab();
  else if(tab === 'stats') content = cmStatsTab();
  else if(tab === 'mine') content = cmMineTab();
  else content = cmTestsTab();
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Formación Comité Bages</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:14px; font-size:13.5px;">Panel del comité: tests mensuales, miembros y clasificación (privada).</div>
  ${cmSetupWarning()}
  ${COMMITTEE.error && !(st.setupMissing) ? `<div class="empty-state" style="margin-bottom:12px;">${esc(COMMITTEE.error)}</div>` : ''}
  <div class="tabs" style="margin-bottom:14px;">
    ${tabs.map(([k, label]) => `<button class="tab ${tab === k ? 'active' : ''}" data-action="committee-tab" data-tab="${k}">${label}</button>`).join('')}
  </div>
  ${content}`;
}

function cmTestStatus(t){
  const now = Date.now();
  if(!t.published) return '<span class="badge" style="background:var(--line); color:var(--ink);">Borrador</span>';
  if(Date.parse(t.opens_at) > now) return '<span class="badge" style="background:var(--yellow); color:var(--yellow-ink);">Programado</span>';
  if(t.closes_at && Date.parse(t.closes_at) <= now) return '<span class="badge" style="background:var(--pitch); color:#fff;">Cerrado</span>';
  return '<span class="badge" style="background:var(--green-ok); color:#fff;">Abierto</span>';
}

function cmTestsTab(){
  const tests = COMMITTEE.tests || [];
  const attempts = COMMITTEE.attempts || [];
  const cards = tests.map(t => {
    const mine = attempts.filter(a => a.test_id === t.id);
    const people = new Set(mine.map(a => a.user_id)).size;
    return `<div class="qcard" style="margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
        <div style="font-weight:700; font-size:16px;">${esc(t.title)}</div>
        ${cmTestStatus(t)}
      </div>
      <div style="font-size:12.5px; color:var(--muted); margin-top:6px;">
        ${t.month ? esc(t.month) + ' · ' : ''}${t.question_count} preguntas · ${t.max_attempts} ${t.max_attempts === 1 ? 'intento' : 'intentos'} ·
        abre ${cmFmtDate(t.opens_at)} · ${t.closes_at ? 'cierra ' + cmFmtDate(t.closes_at) : 'sin fecha de cierre'} · ${people} ${people === 1 ? 'persona lo ha hecho' : 'personas lo han hecho'}
      </div>
      <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
        <button class="btn ${t.published ? 'btn-secondary' : 'btn-primary'}" style="padding:7px 14px; font-size:13px;" data-action="committee-toggle-pub" data-tid="${t.id}">${t.published ? 'Despublicar' : 'Publicar'}</button>
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px;" data-action="committee-detail" data-tid="${t.id}">Resultados</button>
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px; color:var(--red); border-color:#F0C4C4;" data-action="committee-delete-test" data-tid="${t.id}">Eliminar</button>
      </div>
    </div>`;
  }).join('');
  return `
  <div style="margin-bottom:14px;"><button class="btn btn-primary" data-action="committee-new">+ Nuevo test</button></div>
  ${cards || '<div class="empty-state">Todavía no has creado ningún test.</div>'}`;
}

function cmMembersTab(){
  const members = COMMITTEE.members || [];
  const rows = members.map(m => `<tr>
    <td>${esc(m.username || '—')}</td>
    <td>${esc(m.full_name || '—')}</td>
    <td style="word-break:break-all;">${esc(m.email || '')}</td>
    <td class="mono">${cmFmtDay(m.added_at)}</td>
    <td><button class="btn btn-ghost" style="padding:5px 10px; font-size:12px; color:var(--red); border-color:#F0C4C4;" data-action="committee-remove-member" data-uid="${m.user_id}">Quitar</button></td>
  </tr>`).join('');
  return `
  <div class="qcard" style="margin-bottom:14px;">
    <label for="cm-new-member">Añadir árbitro por su email</label>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <input type="email" id="cm-new-member" data-cm-field="newMemberEmail" value="${esc(COMMITTEE.newMemberEmail)}" placeholder="correo@ejemplo.com" style="flex:1; min-width:200px;">
      <button class="btn btn-primary" data-action="committee-add-member">Añadir</button>
    </div>
    <div style="font-size:12.5px; color:var(--muted); margin-top:8px;">La persona tiene que haberse registrado antes en we-ref.com con ese mismo email.</div>
  </div>
  <div class="section-title">Miembros con acceso (${members.length})</div>
  ${members.length ? `<div class="qcard" style="overflow-x:auto;"><table class="stat-table"><tr><th>Usuario</th><th>Nombre</th><th>Email</th><th>Alta</th><th></th></tr>${rows}</table></div>` : '<div class="empty-state">Todavía no hay ningún miembro.</div>'}`;
}

function cmMineTab(){
  if(COMMITTEE.myTests === null){ cmLoadMyTests(); return '<div class="empty-state">Cargando...</div>'; }
  const now = Date.now();
  return COMMITTEE.myTests.length
    ? COMMITTEE.myTests.map(t => cmMemberTestCard(t, now)).join('')
    : '<div class="empty-state">No hay tests publicados.</div>';
}

/* ---------- administrador: clasificación ---------- */
function cmComputeRanking(month){
  const tests = (COMMITTEE.tests || []).filter(t => t.published && (month === 'all' || t.month === month));
  const ids = new Set(tests.map(t => t.id));
  const maxTotal = {};
  (COMMITTEE.attempts || []).forEach(a => { if(ids.has(a.test_id)) maxTotal[a.test_id] = a.total; });
  const people = {};
  (COMMITTEE.members || []).forEach(m => { people[m.user_id] = { id: m.user_id, who: cmWho(m), full_name: m.full_name, email: m.email, best: {} }; });
  (COMMITTEE.attempts || []).filter(a => ids.has(a.test_id)).forEach(a => {
    const p = people[a.user_id] || (people[a.user_id] = { id: a.user_id, who: cmWho(a), full_name: a.full_name, email: a.email, best: {} });
    const cur = p.best[a.test_id];
    if(!cur || a.score > cur.score || (a.score === cur.score && (a.duration_sec || 0) < (cur.duration_sec || 0))) p.best[a.test_id] = a;
  });
  const rows = Object.values(people).map(p => {
    const done = Object.values(p.best);
    const score = done.reduce((s, a) => s + a.score, 0);
    const total = done.reduce((s, a) => s + a.total, 0);
    const dur = done.reduce((s, a) => s + (a.duration_sec || 0), 0);
    return { who: p.who, full_name: p.full_name, email: p.email, done: done.length, score, total, pct: total ? score / total * 100 : 0, avgDur: done.length ? Math.round(dur / done.length) : null };
  });
  rows.sort((a, b) => (b.done > 0) - (a.done > 0) || b.pct - a.pct || b.score - a.score || (a.avgDur ?? 1e9) - (b.avgDur ?? 1e9));
  return { rows, testCount: tests.length };
}

function cmRankingTab(){
  const months = Array.from(new Set((COMMITTEE.tests || []).filter(t => t.published && t.month).map(t => t.month))).sort().reverse();
  const { rows, testCount } = cmComputeRanking(COMMITTEE.rankMonth);
  const body = rows.map((r, i) => `<tr>
    <td class="mono">${r.done ? i + 1 : '—'}</td>
    <td><strong>${esc(r.who)}</strong>${r.full_name && r.full_name !== r.who ? `<div style="font-size:11.5px; color:var(--muted);">${esc(r.full_name)}</div>` : ''}</td>
    <td class="mono">${r.done}/${testCount}</td>
    <td class="mono">${r.score}/${r.total}</td>
    <td>${r.done ? accuracyBadge(Math.round(r.pct)) : '<span class="law-sub-muted">—</span>'}</td>
    <td class="mono">${cmFmtDur(r.avgDur)}</td>
  </tr>`).join('');
  return `
  <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-bottom:14px;">
    <div style="flex:1; min-width:180px;">
      <label>Periodo</label>
      <select id="cm-rank-month" data-cm-field="rankMonth" data-cm-rerender>
        <option value="all" ${COMMITTEE.rankMonth === 'all' ? 'selected' : ''}>Toda la temporada</option>
        ${months.map(m => `<option value="${esc(m)}" ${COMMITTEE.rankMonth === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-secondary" data-action="committee-export-ranking">📊 Exportar a Excel</button>
  </div>
  <div style="font-size:12.5px; color:var(--muted); margin-bottom:10px;">Se cuenta el mejor intento de cada test publicado. Orden: % de acierto, puntos y tiempo medio. Esta clasificación solo la ves tú.</div>
  ${rows.length ? `<div class="qcard" style="overflow-x:auto;"><table class="stat-table"><tr><th>#</th><th>Árbitro</th><th>Tests</th><th>Puntos</th><th>Acierto</th><th>Tiempo medio</th></tr>${body}</table></div>` : '<div class="empty-state">Todavía no hay miembros ni resultados.</div>'}`;
}

function cmStatsTab(){
  const stats = (COMMITTEE.ruleStats || []).map(s => Object.assign({}, s, { pct: s.answered ? Math.round(s.correct_count / s.answered * 100) : 0 })).sort((a, b) => a.pct - b.pct);
  if(!stats.length) return '<div class="empty-state">Todavía no hay resultados para calcular los puntos débiles.</div>';
  const bars = stats.map(s => `<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
    <div style="width:170px; font-size:13px; flex-shrink:0;"><strong>R${s.rule}</strong> ${esc(LAW_NAMES[s.rule] || '')}</div>
    <div class="law-bar-bg" style="flex:1;"><div class="law-bar-fill" style="width:${s.pct}%; background:${scoreColor(s.pct)};"></div></div>
    <div class="mono" style="width:44px; text-align:right; font-size:13px;">${s.pct}%</div>
  </div>`).join('');
  return `<div style="font-size:12.5px; color:var(--muted); margin-bottom:10px;">Acierto del comité por regla, de menor a mayor. Las reglas de arriba son las que más conviene reforzar.</div>
  <div class="qcard">${bars}</div>`;
}

/* ---------- administrador: resultados de un test ---------- */
async function cmOpenDetail(tid){
  COMMITTEE.detailTestId = tid;
  COMMITTEE.qStats = null;
  STATE.view = 'committeeTestDetail';
  render();
  const { data, error } = await supabaseClient.rpc('committee_admin_question_stats', { p_test_id: tid });
  COMMITTEE.qStats = error ? [] : (data || []);
  if(error) STATE.toast = cmErrText(error);
  cmRefresh();
}

function cmTestDetailView(){
  const t = (COMMITTEE.tests || []).find(x => x.id === COMMITTEE.detailTestId);
  if(!t) return '<button class="backbtn" data-action="committee-open">&larr; Volver</button><div class="empty-state">Test no encontrado.</div>';
  const attempts = (COMMITTEE.attempts || []).filter(a => a.test_id === t.id)
    .sort((a, b) => b.score - a.score || (a.duration_sec || 0) - (b.duration_sec || 0));
  const doneIds = new Set(attempts.map(a => a.user_id));
  const pending = (COMMITTEE.members || []).filter(m => !doneIds.has(m.user_id));
  const rows = attempts.map(a => `<tr>
    <td><strong>${esc(cmWho(a))}</strong></td>
    <td class="mono">${a.attempt_no}</td>
    <td class="mono">${a.score}/${a.total}</td>
    <td>${accuracyBadge(Math.round(a.score / a.total * 100))}</td>
    <td class="mono">${cmFmtDur(a.duration_sec)}</td>
    <td class="mono">${cmFmtDate(a.finished_at)}</td>
  </tr>`).join('');
  const qrows = (COMMITTEE.qStats || []).map(s => {
    const pct = s.answered ? Math.round(s.correct_count / s.answered * 100) : 0;
    return `<tr><td class="mono">${s.pos}</td><td>${esc(s.question)}</td><td class="mono">${s.rule ? 'R' + s.rule : '—'}</td><td>${s.answered ? accuracyBadge(pct) : '<span class="law-sub-muted">—</span>'}</td></tr>`;
  }).join('');
  return `
  <button class="backbtn" data-action="committee-open">&larr; Volver</button>
  <h2 style="margin-bottom:4px;">${esc(t.title)}</h2>
  <div style="margin-bottom:14px;">${cmTestStatus(t)} <span style="font-size:12.5px; color:var(--muted);">${t.question_count} preguntas · ${attempts.length} intentos</span></div>
  <div style="margin-bottom:14px;"><button class="btn btn-secondary" data-action="committee-export-test" data-tid="${t.id}">📊 Exportar a Excel</button></div>
  <div class="section-title">Resultados</div>
  ${attempts.length ? `<div class="qcard" style="overflow-x:auto; margin-bottom:14px;"><table class="stat-table"><tr><th>Árbitro</th><th>Intento</th><th>Puntos</th><th>Acierto</th><th>Tiempo</th><th>Fecha</th></tr>${rows}</table></div>` : '<div class="empty-state" style="margin-bottom:14px;">Nadie ha hecho este test todavía.</div>'}
  ${pending.length ? `<div class="section-title">Pendientes de hacerlo (${pending.length})</div><div class="qcard" style="margin-bottom:14px; font-size:13.5px;">${pending.map(m => esc(cmWho(m))).join(' · ')}</div>` : ''}
  <div class="section-title">Acierto por pregunta</div>
  ${COMMITTEE.qStats === null ? '<div class="empty-state">Cargando...</div>' : `<div class="qcard" style="overflow-x:auto;"><table class="stat-table"><tr><th>#</th><th>Pregunta</th><th>Regla</th><th>Acierto</th></tr>${qrows}</table></div>`}`;
}

/* ---------- administrador: crear un test ---------- */
function cmNewBuilder(){
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  return { title: '', month, opens: '', closes: '', maxAttempts: 1, selected: [], filterRule: 'all', filterText: '', page: 1, randomCount: 10, saving: false };
}

function cmBankCandidates(){
  const b = COMMITTEE.builder;
  let list = allQuestions().filter(q => q.domain === 'law' || q.domain === 'glossary');
  if(b.filterRule === 'glossary') list = list.filter(q => q.domain === 'glossary');
  else if(b.filterRule !== 'all') list = list.filter(q => q.domain === 'law' && q.rule === parseInt(b.filterRule, 10));
  const s = b.filterText.trim().toLowerCase();
  if(s) list = list.filter(q => q.question.toLowerCase().includes(s) || q.options.some(o => o.toLowerCase().includes(s)));
  return list;
}

function cmBuilderView(){
  const b = COMMITTEE.builder;
  if(!b) return cmAdminView();
  const picked = new Set(b.selected.map(q => q.id));
  const cands = cmBankCandidates();
  const totalPages = Math.max(1, Math.ceil(cands.length / CM_PAGE_SIZE));
  if(b.page > totalPages) b.page = totalPages;
  const pageItems = cands.slice((b.page - 1) * CM_PAGE_SIZE, b.page * CM_PAGE_SIZE);
  const ruleOpts = `<option value="all">Todas las reglas</option>` +
    Array.from({ length: 17 }, (_, i) => i + 1).map(i => `<option value="${i}" ${b.filterRule == i ? 'selected' : ''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('') +
    `<option value="glossary" ${b.filterRule === 'glossary' ? 'selected' : ''}>Glosario</option>`;
  const candHtml = pageItems.map(q => `<div class="qcard" style="margin-bottom:8px; padding:12px 14px;">
    <div class="qtag" style="margin-bottom:4px;">${q.domain === 'glossary' ? 'Glosario' : 'Regla ' + q.rule}</div>
    <div style="font-size:13.5px; margin-bottom:8px;">${esc(q.question)}</div>
    <button class="btn ${picked.has(q.id) ? 'btn-secondary' : 'btn-primary'}" style="padding:6px 12px; font-size:12.5px;" data-action="committee-b-toggle" data-qid="${esc(q.id)}">${picked.has(q.id) ? '✓ Añadida · quitar' : '+ Añadir'}</button>
  </div>`).join('');
  const selHtml = b.selected.map((q, i) => `<div style="display:flex; gap:8px; align-items:flex-start; padding:7px 0; border-bottom:1px solid var(--line); font-size:13px;">
    <span class="mono" style="color:var(--muted); width:26px; flex-shrink:0;">${i + 1}.</span>
    <span style="flex:1;">${esc(q.question)}</span>
    <span class="mono" style="color:var(--muted); flex-shrink:0;">${q.domain === 'glossary' ? 'G' : 'R' + q.rule}</span>
    <button class="icon-btn" title="Quitar" data-action="committee-b-toggle" data-qid="${esc(q.id)}">✕</button>
  </div>`).join('');
  return `
  <button class="backbtn" data-action="committee-b-cancel">&larr; Cancelar</button>
  <h2 style="margin-bottom:14px;">Nuevo test</h2>
  <div class="qcard" style="margin-bottom:14px;">
    <label for="cm-b-title">Título</label>
    <input type="text" id="cm-b-title" data-cm-field="builder.title" value="${esc(b.title)}" placeholder="Ej.: Test de octubre" maxlength="120">
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
      <div style="flex:1; min-width:140px;"><label for="cm-b-month">Mes (para la clasificación)</label><input type="month" id="cm-b-month" data-cm-field="builder.month" value="${esc(b.month)}"></div>
      <div style="flex:1; min-width:140px;"><label for="cm-b-attempts">Intentos permitidos</label><input type="number" id="cm-b-attempts" min="1" max="20" data-cm-field="builder.maxAttempts" value="${esc(String(b.maxAttempts))}"></div>
    </div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
      <div style="flex:1; min-width:180px;"><label for="cm-b-opens">Abre (vacío = ahora)</label><input type="datetime-local" id="cm-b-opens" data-cm-field="builder.opens" value="${esc(b.opens)}"></div>
      <div style="flex:1; min-width:180px;"><label for="cm-b-closes">Cierra (opcional)</label><input type="datetime-local" id="cm-b-closes" data-cm-field="builder.closes" value="${esc(b.closes)}"></div>
    </div>
    <div style="font-size:12.5px; color:var(--muted); margin-top:8px;">Las respuestas correctas se enseñan a los árbitros cuando el test cierra. Si no pones fecha de cierre, se enseñan al terminar.</div>
  </div>

  <div class="section-title">Preguntas seleccionadas (${b.selected.length})</div>
  <div class="qcard" style="margin-bottom:14px;">${selHtml || '<div style="font-size:13px; color:var(--muted);">Todavía no has elegido ninguna. Búscalas abajo o añade aleatorias.</div>'}</div>

  <div class="section-title">Buscar en el banco de preguntas</div>
  <div class="qcard" style="margin-bottom:12px;">
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <div style="flex:1; min-width:180px;"><label for="cm-b-rule">Regla</label><select id="cm-b-rule" data-cm-field="builder.filterRule" data-cm-rerender>${ruleOpts}</select></div>
      <div style="flex:2; min-width:200px;"><label for="cm-b-search">Buscar texto</label><input type="text" id="cm-b-search" data-cm-field="builder.filterText" data-cm-rerender value="${esc(b.filterText)}" placeholder="Palabra de la pregunta o respuestas..." maxlength="100"></div>
    </div>
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-top:12px;">
      <div style="width:110px;"><label for="cm-b-random">Aleatorias</label><input type="number" id="cm-b-random" min="1" max="100" data-cm-field="builder.randomCount" value="${esc(String(b.randomCount))}"></div>
      <button class="btn btn-secondary" data-action="committee-b-random">+ Añadir aleatorias de esta búsqueda</button>
    </div>
  </div>
  <div style="font-size:12.5px; color:var(--muted); margin-bottom:8px;">${cands.length} preguntas coinciden</div>
  ${candHtml || '<div class="empty-state">Ninguna pregunta coincide.</div>'}
  ${cands.length > CM_PAGE_SIZE ? `<div style="display:flex; justify-content:center; align-items:center; gap:14px; margin:12px 0;">
    <button class="btn btn-ghost" data-action="committee-b-prev" ${b.page <= 1 ? 'disabled' : ''}>&larr; Anterior</button>
    <span class="mono" style="font-size:13px; color:var(--muted);">Página ${b.page} / ${totalPages}</span>
    <button class="btn btn-ghost" data-action="committee-b-next" ${b.page >= totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
  </div>` : ''}
  <div style="position:sticky; bottom:0; background:var(--chalk); padding:12px 0; margin-top:14px; border-top:1px solid var(--line);">
    <button class="btn btn-primary" data-action="committee-b-save" ${b.saving ? 'disabled' : ''}>${b.saving ? 'Guardando...' : 'Guardar como borrador (' + b.selected.length + ' preguntas)'}</button>
  </div>`;
}

async function cmSaveBuilder(){
  const b = COMMITTEE.builder;
  if(!b.title.trim()){ cmToast('Ponle un título al test.'); return; }
  if(!b.selected.length){ cmToast('Elige al menos una pregunta.'); return; }
  const opens = b.opens ? new Date(b.opens) : null;
  const closes = b.closes ? new Date(b.closes) : null;
  if(closes && opens && closes <= opens){ cmToast('La fecha de cierre tiene que ser posterior a la de apertura.'); return; }
  if(closes && !opens && closes.getTime() <= Date.now()){ cmToast('La fecha de cierre ya ha pasado.'); return; }
  const attempts = Math.max(1, parseInt(b.maxAttempts, 10) || 1);
  b.saving = true; render();
  const questions = b.selected.map(q => ({
    question: q.question, options: q.options, correct: q.correct,
    rule: q.domain === 'glossary' ? null : q.rule, explanation: q.explanation || ''
  }));
  const { error } = await supabaseClient.rpc('committee_admin_create_test', {
    p_title: b.title.trim(), p_month: b.month || null,
    p_opens: opens ? opens.toISOString() : null, p_closes: closes ? closes.toISOString() : null,
    p_max_attempts: attempts, p_questions: questions
  });
  b.saving = false;
  if(error){ cmToast(cmErrText(error)); return; }
  COMMITTEE.builder = null;
  COMMITTEE.tab = 'tests';
  STATE.view = 'committeeAdmin';
  STATE.toast = 'Test guardado como borrador. Publícalo cuando esté listo.';
  render();
  cmLoadAdminData();
}

/* ---------- acciones ---------- */
async function committeeOnAction(action, el){
  const tid = el.dataset.tid;
  const b = COMMITTEE.builder;

  if(action === 'committee-open'){
    const st = COMMITTEE.status;
    if(!st) return;
    if(st.is_admin){ STATE.view = 'committeeAdmin'; render(); cmLoadAdminData(); }
    else { STATE.view = 'committee'; render(); cmLoadMyTests(); }
  }
  else if(action === 'committee-tab'){ COMMITTEE.tab = el.dataset.tab; render(); }

  /* miembro */
  else if(action === 'committee-start'){
    const { data, error } = await supabaseClient.rpc('committee_get_test', { p_test_id: tid });
    if(error){ cmToast(cmErrText(error)); cmLoadMyTests(); return; }
    COMMITTEE.run = { test: data, answers: {}, idx: 0, startedAt: Date.now(), submitting: false };
    STATE.view = 'committeeRun'; render();
  }
  else if(action === 'committee-answer'){
    const r = COMMITTEE.run; if(!r) return;
    r.answers[r.test.questions[r.idx].pos] = el.dataset.letter; render();
  }
  else if(action === 'committee-prev'){ if(COMMITTEE.run && COMMITTEE.run.idx > 0){ COMMITTEE.run.idx--; render(); } }
  else if(action === 'committee-next'){
    const r = COMMITTEE.run;
    if(r && r.idx < r.test.questions.length - 1){ r.idx++; render(); }
  }
  else if(action === 'committee-exit-run'){
    if(!confirm('¿Salir del test? No se guardará ninguna respuesta y no se gastará el intento.')) return;
    COMMITTEE.run = null;
    STATE.view = (COMMITTEE.status && COMMITTEE.status.is_admin) ? 'committeeAdmin' : 'committee';
    render(); cmLoadMyTests();
  }
  else if(action === 'committee-finish'){
    const r = COMMITTEE.run; if(!r || r.submitting) return;
    const missing = r.test.questions.length - Object.keys(r.answers).length;
    const msg = missing > 0
      ? `Te quedan ${missing} preguntas sin responder (contarán como fallo). ¿Finalizar igualmente?`
      : '¿Finalizar el test? Después no podrás cambiar tus respuestas.';
    if(!confirm(msg)) return;
    r.submitting = true; render();
    const { data, error } = await supabaseClient.rpc('committee_submit_attempt', {
      p_test_id: r.test.id, p_answers: r.answers, p_duration: Math.round((Date.now() - r.startedAt) / 1000)
    });
    if(error){ r.submitting = false; cmToast(cmErrText(error)); return; }
    COMMITTEE.result = { title: r.test.title, score: data.score, total: data.total, review: data.review };
    COMMITTEE.run = null;
    STATE.view = 'committeeResult'; render();
    cmLoadMyTests();
  }
  else if(action === 'committee-review'){
    const { data, error } = await supabaseClient.rpc('committee_get_review', { p_test_id: tid });
    if(error){ cmToast(cmErrText(error)); return; }
    COMMITTEE.result = { title: data.title, score: data.score, total: data.total, review: data.review };
    STATE.view = 'committeeResult'; render();
  }

  /* administrador: miembros */
  else if(action === 'committee-add-member'){
    const email = COMMITTEE.newMemberEmail.trim();
    if(!email){ cmToast('Escribe el email del árbitro.'); return; }
    const { data, error } = await supabaseClient.rpc('committee_admin_add_member', { p_email: email });
    if(error){ cmToast(cmErrText(error)); return; }
    if(!data.ok){ cmToast('Ese email no está registrado en we-ref.com. Pídele que se cree una cuenta primero.'); return; }
    COMMITTEE.newMemberEmail = '';
    STATE.toast = 'Árbitro añadido.'; render();
    cmLoadAdminData();
  }
  else if(action === 'committee-remove-member'){
    const m = (COMMITTEE.members || []).find(x => x.user_id === el.dataset.uid);
    if(!confirm('¿Quitar el acceso a ' + (m ? cmWho(m) : 'este árbitro') + '? Sus resultados anteriores se conservan.')) return;
    const { error } = await supabaseClient.rpc('committee_admin_remove_member', { p_user_id: el.dataset.uid });
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = 'Acceso retirado.'; render();
    cmLoadAdminData();
  }

  /* administrador: tests */
  else if(action === 'committee-toggle-pub'){
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    if(!t.published && !t.question_count){ cmToast('El test no tiene preguntas.'); return; }
    if(!t.published && !confirm('¿Publicar "' + t.title + '"? Los miembros podrán verlo y hacerlo desde la fecha de apertura.')) return;
    const { error } = await supabaseClient.from('committee_tests').update({ published: !t.published }).eq('id', tid);
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = t.published ? 'Test despublicado.' : 'Test publicado.'; render();
    cmLoadAdminData();
  }
  else if(action === 'committee-delete-test'){
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    if(!confirm('¿Eliminar "' + t.title + '"? Se borrarán también todos los resultados. No se puede deshacer.')) return;
    const { error } = await supabaseClient.from('committee_tests').delete().eq('id', tid);
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = 'Test eliminado.'; render();
    cmLoadAdminData();
  }
  else if(action === 'committee-detail'){ cmOpenDetail(tid); }
  else if(action === 'committee-export-test'){
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    const rows = (COMMITTEE.attempts || []).filter(a => a.test_id === tid).map(a => ({
      'Usuario': a.username || '', 'Nombre': a.full_name || '', 'Email': a.email || '', 'Intento': a.attempt_no,
      'Aciertos': a.score, 'Total': a.total, '% acierto': Math.round(a.score / a.total * 100),
      'Tiempo (s)': a.duration_sec, 'Fecha': cmFmtDate(a.finished_at)
    }));
    cmExport(rows, 'Resultados', 'comite_' + t.title.replace(/[^\w]+/g, '_') + '.xlsx');
  }
  else if(action === 'committee-export-ranking'){
    const { rows, testCount } = cmComputeRanking(COMMITTEE.rankMonth);
    const out = rows.map((r, i) => ({
      'Posición': r.done ? i + 1 : '', 'Usuario': r.who, 'Nombre': r.full_name || '', 'Email': r.email || '',
      'Tests hechos': r.done, 'Tests del periodo': testCount, 'Aciertos': r.score, 'Preguntas': r.total,
      '% acierto': Math.round(r.pct), 'Tiempo medio (s)': r.avgDur
    }));
    cmExport(out, 'Clasificación', 'comite_clasificacion_' + (COMMITTEE.rankMonth === 'all' ? 'temporada' : COMMITTEE.rankMonth) + '.xlsx');
  }

  /* administrador: creación de test */
  else if(action === 'committee-new'){ COMMITTEE.builder = cmNewBuilder(); STATE.view = 'committeeBuilder'; render(); }
  else if(action === 'committee-b-cancel'){
    if(b && b.selected.length && !confirm('¿Descartar este test sin guardar?')) return;
    COMMITTEE.builder = null; STATE.view = 'committeeAdmin'; render();
  }
  else if(action === 'committee-b-toggle'){
    if(!b) return;
    const qid = el.dataset.qid;
    const idx = b.selected.findIndex(q => q.id === qid);
    if(idx >= 0) b.selected.splice(idx, 1);
    else { const q = allQuestions().find(x => x.id === qid); if(q) b.selected.push(q); }
    render();
  }
  else if(action === 'committee-b-random'){
    if(!b) return;
    const n = Math.max(1, Math.min(100, parseInt(b.randomCount, 10) || 1));
    const taken = new Set(b.selected.map(q => q.id));
    const pool = cmBankCandidates().filter(q => !taken.has(q.id));
    for(let i = pool.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.slice(0, n).forEach(q => b.selected.push(q));
    STATE.toast = pool.length ? 'Añadidas ' + Math.min(n, pool.length) + ' preguntas.' : 'No quedan preguntas con ese filtro.';
    render();
  }
  else if(action === 'committee-b-prev'){ if(b && b.page > 1){ b.page--; render(); } }
  else if(action === 'committee-b-next'){ if(b){ b.page++; render(); } }
  else if(action === 'committee-b-save'){ cmSaveBuilder(); }
}

/* campos de formulario: se guardan en COMMITTEE sin repintar (salvo data-cm-rerender) */
function cmSetPath(path, value){
  const parts = path.split('.');
  let obj = COMMITTEE;
  for(let i = 0; i < parts.length - 1; i++){ obj = obj[parts[i]]; if(!obj) return; }
  obj[parts[parts.length - 1]] = value;
  if(path === 'builder.filterRule' || path === 'builder.filterText') COMMITTEE.builder.page = 1;
}

function committeeAfterRender(){
  document.querySelectorAll('[data-cm-field]').forEach(el => {
    const evt = (el.tagName === 'SELECT' || ['month', 'datetime-local', 'date', 'number'].includes(el.type)) ? 'change' : 'input';
    el.addEventListener(evt, () => {
      cmSetPath(el.dataset.cmField, el.value);
      if(el.hasAttribute('data-cm-rerender')) render();
    });
  });
}
