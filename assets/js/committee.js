/* ---------------- CTA BAGES (formación del comité de árbitros del Bages) ----------------
   Tests mensuales privados para los árbitros que elige el administrador.
   Toda la seguridad vive en Supabase (ver supabase/committee.sql): aquí solo se pinta.
   Depende de app.js (STATE, render, esc, allQuestions, LAW_NAMES, isDevUser, ringSVG, scoreColor,
   accuracyBadge, normalizeQuestionText) y de shell.js (shellIcon). */

const COMMITTEE = {
  status: null,       // null = sin cargar · {is_admin, is_member, setupMissing?}
  myTests: null,
  tests: null,        // admin: tabla committee_tests (con nº de preguntas)
  members: null,
  attempts: null,
  ruleStats: null,
  qStats: null,
  usedMap: null,      // texto normalizado de pregunta -> títulos de los tests donde ya salió
  tab: 'tests',
  rankMonth: 'all',
  rankSeason: null,
  newMemberEmail: '',
  detailTestId: null,
  settings: null,     // ajustes de UN test (detalle)
  messages: null,     // admin: mensajes del comité (borradores y publicados)
  myMessages: null,   // miembro: mensajes publicados
  msgDraft: { id: null, title: '', body: '' },
  run: null,
  result: null,
  builder: null,
  error: null
};

const CM_LETTERS = ['a', 'b', 'c', 'd'];
const CM_PAGE_SIZE = 10;

/* ---------- utilidades ---------- */
function cmIc(name){ return `<span class="cm-ic">${shellIcon(name)}</span>`; }
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
    no_questions: 'El test no tiene preguntas.',
    time_up: 'Se agotó el tiempo del test y no se ha podido guardar el intento.'
  };
  for(const k in known){ if(m.includes(k)) return known[k]; }
  if(/timer_mode|time_minutes|seconds_per_question/.test(m)){
    return 'Falta ejecutar el SQL de temporización (committee-timer.sql) en Supabase.';
  }
  if(/Could not find the function|PGRST202|PGRST205|42883|42P01|does not exist|schema cache/i.test(m + ' ' + (err && err.code || ''))){
    return 'Falta ejecutar el archivo SQL del comité en Supabase.';
  }
  return 'Error: ' + m;
}
function cmFmtDate(iso){
  if(!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function cmFmtDay(iso){ return iso ? new Date(iso).toLocaleDateString('es-ES') : '—'; }
function cmFmtDur(sec){
  if(sec === null || sec === undefined) return '—';
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function cmToLocalInput(iso){
  if(!iso) return '';
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function cmWho(r){ return r.username || r.full_name || r.email || '—'; }
function cmInitial(r){ return esc(String(cmWho(r)).charAt(0).toUpperCase() || '?'); }
function cmToast(msg){ STATE.toast = msg; render(); }
function cmInCommittee(){ return typeof STATE.view === 'string' && STATE.view.startsWith('committee'); }
function cmRefresh(){ if(cmInCommittee()) render(); }
function cmRuleLabel(q){
  if(q.domain === 'glossary') return 'Glosario';
  return q.rule ? 'Regla ' + q.rule : 'Sin regla';
}
function cmRuleShort(q){ return q.domain === 'glossary' ? 'G' : (q.rule ? 'R' + q.rule : '—'); }
function cmShuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function cmSetupWarning(){
  if(!(COMMITTEE.status && COMMITTEE.status.setupMissing)) return '';
  return `<div class="cm-card" style="border-color:#F0C4C4;">
    <div style="font-weight:700; margin-bottom:6px;">Falta un paso de instalación</div>
    <div style="font-size:13.5px;">Hay que ejecutar una vez el archivo <span class="mono">supabase/committee.sql</span> en Supabase (SQL Editor). Hasta entonces este apartado no funcionará.</div>
  </div>`;
}
function cmExport(rows, sheetName, fileName){
  if(typeof XLSX === 'undefined'){ cmToast('No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'); return; }
  if(!rows.length){ cmToast('No hay datos que exportar.'); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  XLSX.writeFile(wb, fileName);
}

/* ---------- CTA BAGES siempre abierto: los árbitros ven lo que se va publicando ---------- */
function cmMemberAccess(){
  const st = COMMITTEE.status;
  return !!(st && (st.is_admin || st.is_member));
}
/* Mensajes del comité (tabla committee_messages): borradores o publicados */
async function cmLoadMessages(){
  try{
    const { data, error } = await supabaseClient.from('committee_messages').select('*').order('created_at', { ascending: false });
    if(error) throw error;
    COMMITTEE.messages = data || [];
    COMMITTEE.messagesMissing = false;
  }catch(e){
    COMMITTEE.messages = COMMITTEE.messages || [];
    COMMITTEE.messagesMissing = true;
  }
}
async function cmLoadMyMessages(){
  try{
    const { data, error } = await supabaseClient.from('committee_messages').select('*').eq('published', true).order('published_at', { ascending: false });
    if(error) throw error;
    COMMITTEE.myMessages = data || [];
  }catch(e){
    COMMITTEE.myMessages = COMMITTEE.myMessages || [];
  }
}
function cmPublishedMessages(){
  const st = COMMITTEE.status || {};
  if(st.is_admin && !st.is_member) return (COMMITTEE.messages || []).filter(m => m.published).sort((a, b) => Date.parse(b.published_at || b.created_at) - Date.parse(a.published_at || a.created_at));
  return COMMITTEE.myMessages || [];
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
  await cmLoadMyMessages();
  const { data, error } = await supabaseClient.rpc('committee_my_tests');
  if(error){ COMMITTEE.error = cmErrText(error); COMMITTEE.myTests = []; }
  else { COMMITTEE.myTests = data || []; }
  cmRefresh();
}

async function cmLoadAdminData(){
  COMMITTEE.error = null;
  await cmLoadMessages();
  const results = await Promise.all([
    supabaseClient.from('committee_tests').select('*, committee_test_questions(count)').order('created_at', { ascending: false }),
    supabaseClient.rpc('committee_admin_list_members'),
    supabaseClient.rpc('committee_admin_all_attempts'),
    supabaseClient.rpc('committee_admin_rule_stats'),
    supabaseClient.from('committee_test_questions').select('question, committee_tests(title)')
  ]);
  const firstErr = results.map(r => r.error).find(Boolean);
  if(firstErr){
    COMMITTEE.error = cmErrText(firstErr);
    COMMITTEE.tests = COMMITTEE.tests || [];
    COMMITTEE.members = COMMITTEE.members || [];
    COMMITTEE.attempts = COMMITTEE.attempts || [];
    COMMITTEE.ruleStats = COMMITTEE.ruleStats || [];
    COMMITTEE.usedMap = COMMITTEE.usedMap || {};
  } else {
    COMMITTEE.tests = (results[0].data || []).map(t => Object.assign({}, t, {
      question_count: (t.committee_test_questions && t.committee_test_questions[0]) ? t.committee_test_questions[0].count : 0
    }));
    COMMITTEE.members = results[1].data || [];
    COMMITTEE.attempts = results[2].data || [];
    COMMITTEE.ruleStats = results[3].data || [];
    const used = {};
    (results[4].data || []).forEach(r => {
      const k = normalizeQuestionText(r.question);
      const title = r.committee_tests && r.committee_tests.title;
      if(!k || !title) return;
      (used[k] = used[k] || []);
      if(!used[k].includes(title)) used[k].push(title);
    });
    COMMITTEE.usedMap = used;
  }
  cmRefresh();
}

function cmUsedIn(q){
  return (COMMITTEE.usedMap && COMMITTEE.usedMap[normalizeQuestionText(q.question)]) || [];
}

/* ---------- enrutado de vistas ---------- */
function committeeView(v){
  if(v === 'committeeAdmin') return cmTrainingView();
  if(v === 'committeeTraining') return cmTrainingView();
  if(v === 'committeeBuilder') return cmBuilderView();
  if(v === 'committeeTestDetail') return cmTestDetailView();
  if(v === 'committeeRun') return cmRunView();
  if(v === 'committeeResult') return cmResultView();
  return cmMemberView();
}

function cmHero(eyebrow, title, text, actionsHtml, rightHtml){
  return `<section class="lg-hero ac-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      ${text ? `<p>${text}</p>` : ''}
      ${actionsHtml ? `<div class="ac-hero-actions">${actionsHtml}</div>` : ''}
    </div>
    ${rightHtml || ''}
  </section>`;
}
function cmRingBlock(pct, label, sub){
  return `<div class="cm-ringcard">
    <div class="cm-ringcard-ring">${ringSVG(pct, 84, 7)}<div class="pct">${pct}%</div></div>
    <div><b>${esc(label)}</b><span>${esc(sub)}</span></div>
  </div>`;
}
/* ---------- miembro: lista de tests ---------- */
/* ---------- CTA BAGES: lo que ven los árbitros (el administrador lo ve como vista previa) ---------- */
function cmFmtMsgDate(iso){
  return iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/* Novedades: mensajes publicados por el comité (los más recientes primero) */
function cmMessagesFeed(){
  const list = cmPublishedMessages();
  if(!list.length) return '';
  const week = 7 * 86400000;
  return `<div class="lg-section-head"><h2>Novedades del comité</h2><span>${list.length} ${list.length === 1 ? 'mensaje' : 'mensajes'}</span></div>
  <div class="cm-feed">${list.map(m => {
    const when = m.published_at || m.created_at;
    const isNew = when && (Date.now() - Date.parse(when)) < week;
    return `<article class="cm-msg">
      <span class="cm-msg-ic">${shellIcon('message')}</span>
      <div class="cm-msg-body">
        <div class="cm-msg-top"><strong>${esc(m.title)}</strong>${isNew ? '<em>Nuevo</em>' : ''}</div>
        <p>${esc(m.body)}</p>
        <small>${cmFmtMsgDate(when)}</small>
      </div>
    </article>`;
  }).join('')}</div>`;
}

/* ---------- CTA BAGES: lo que ven los árbitros (el administrador lo ve como vista previa) ---------- */
function cmMemberView(){
  const ic = (n) => shellIcon(n);
  const st = COMMITTEE.status || {};
  const preview = !!st.is_admin && !st.is_member;
  let list = null;
  if(preview){
    if(COMMITTEE.tests !== null){
      list = COMMITTEE.tests.filter(t => t.published).map(t => ({
        id: t.id, title: t.title, opens_at: t.opens_at, closes_at: t.closes_at, max_attempts: t.max_attempts,
        attempts_used: 0, total_questions: t.question_count, preview: true,
        timer_mode: t.timer_mode, time_minutes: t.time_minutes, seconds_per_question: t.seconds_per_question
      }));
    }
  } else {
    list = COMMITTEE.myTests;
  }
  const now = Date.now();
  const previewBar = preview ? `<div class="cm-previewbar">${cmIc('eye')}<div><strong>Vista previa</strong><span>Así ven CTA BAGES los árbitros. Los tests y los mensajes se preparan y se publican desde el Panel de Formación.</span></div>
    <button class="btn btn-yellow" data-action="committee-training">${ic('target')} Ir al Panel de Formación</button></div>` : '';
  const group = (title, sub, items) => items.length ? `<div class="lg-section-head"><h2>${title}</h2><span>${sub}</span></div><div class="cm-testlist">${items.map(t => cmMemberTestCard(t, now)).join('')}</div>` : '';
  let body;
  if(COMMITTEE.error) body = `<div class="ac-empty">${ic('flag')}<strong>${esc(COMMITTEE.error)}</strong></div>`;
  else if(list === null) body = `<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  else if(!list.length && !cmPublishedMessages().length) body = `<div class="ac-empty">${ic('book')}<strong>Todavía no hay nada publicado</strong><span>${preview ? 'Cuando publiques un test o un mensaje desde el Panel de Formación aparecerá aquí.' : 'El comité irá publicando aquí tests y mensajes. Te llegarán en cuanto estén listos.'}</span></div>`;
  else if(!list.length) body = '';
  else {
    const isClosed = t => t.closes_at && now >= Date.parse(t.closes_at);
    const isUpcoming = t => now < Date.parse(t.opens_at);
    const open = list.filter(t => !isClosed(t) && !isUpcoming(t));
    const upcoming = list.filter(t => isUpcoming(t));
    const past = list.filter(t => isClosed(t));
    body = group('Tests disponibles ahora', 'Puedes hacerlos ya', open) + group('Próximamente', 'Todavía no han abierto', upcoming) + group('Anteriores', 'Ya cerrados', past);
  }
  const total = list ? list.length : 0;
  const done = list ? list.filter(t => t.attempts_used > 0).length : 0;
  const pct = total ? Math.round(done / total * 100) : 0;
  return `
  ${cmHero('Comité de árbitros · Bages', 'CTA BAGES',
      '',
      '', preview ? '' : cmRingBlock(pct, 'Tests hechos', done + ' de ' + total))}
  ${previewBar}
  ${cmMessagesFeed()}
  ${body}`;
}

/* ---------- Panel de Formación · Mensajes: se preparan y se publican en CTA BAGES ---------- */
function cmMessagesTab(){
  const ic = (n) => shellIcon(n);
  const list = COMMITTEE.messages || [];
  const d = COMMITTEE.msgDraft || { id: null, title: '', body: '' };
  const editing = !!d.id;
  const rows = list.map(m => `<article class="ms-card ${m.published ? 'pub' : 'draft'}">
      <div class="ms-head">
        <span class="cm-chip ${m.published ? 'open' : 'draft'}">${m.published ? 'Publicado' : 'Borrador'}</span>
        <small>${cmFmtMsgDate(m.published ? (m.published_at || m.created_at) : m.created_at)}</small>
      </div>
      <h3>${esc(m.title)}</h3>
      <p>${esc(m.body)}</p>
      <div class="tx-actions">
        <button class="btn ${m.published ? 'btn-ghost' : 'btn-primary'} tx-main" data-action="committee-msg-publish" data-mid="${m.id}">${ic(m.published ? 'lock' : 'play')} ${m.published ? 'Quitar de CTA BAGES' : 'Publicar en CTA BAGES'}</button>
        <button class="tx-icon" data-action="committee-msg-edit" data-mid="${m.id}" title="Editar" aria-label="Editar">${ic('pencil')}</button>
        <button class="tx-icon danger" data-action="committee-msg-delete" data-mid="${m.id}" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>
      </div>
    </article>`).join('');
  return `
  ${COMMITTEE.messagesMissing ? `<div class="cm-draftbar" style="background:#FDECEC; border-color:#F3C4C4;">${ic('flag')}<div><strong>Falta un paso de instalación</strong><span>Ejecuta una vez el archivo supabase/committee-messages.sql en Supabase para poder publicar mensajes.</span></div></div>` : ''}
  <div class="tp-layout mb-layout">
    <div class="ms-list">
      ${rows || `<div class="ac-empty">${ic('message')}<strong>Todavía no hay mensajes</strong><span>Escribe el primero a la derecha. Se guarda como borrador hasta que lo publiques en CTA BAGES.</span></div>`}
    </div>
    <aside class="tc-card mb-add">
      <div class="tc-card-head"><span class="tc-step">${ic(editing ? 'pencil' : 'plus')}</span><div><h3>${editing ? 'Editar mensaje' : 'Nuevo mensaje'}</h3><small>Para los árbitros de CTA BAGES</small></div></div>
      <label for="cm-msg-title">Título</label>
      <input type="text" id="cm-msg-title" data-cm-field="msgDraft.title" maxlength="120" value="${esc(d.title)}" placeholder="Ej: Ya está el test de octubre">
      <label for="cm-msg-body">Mensaje</label>
      <textarea id="cm-msg-body" data-cm-field="msgDraft.body" rows="6" maxlength="1500" placeholder="Escribe aquí lo que quieres contar a los árbitros...">${esc(d.body)}</textarea>
      <div class="ms-form-actions">
        <button class="btn btn-primary" data-action="committee-msg-save" data-publish="0" ${COMMITTEE.messagesMissing ? 'disabled' : ''}>${ic('check')} Guardar borrador</button>
        <button class="btn btn-yellow" data-action="committee-msg-save" data-publish="1" ${COMMITTEE.messagesMissing ? 'disabled' : ''}>${ic('play')} Guardar y publicar</button>
        ${editing ? `<button class="btn btn-ghost" data-action="committee-msg-cancel">Cancelar</button>` : ''}
      </div>
    </aside>
  </div>`;
}

/* ---------- Panel de Formación: aquí se prepara todo y se publica en CTA BAGES ---------- */
/* ---------- miembro: hacer el test ---------- */
/* Reloj del test: se calcula con Date.now() para que no se descuadre si la pestaña queda en segundo plano. */
let CM_TIMER = null;
function cmStopRunTimer(){ if(CM_TIMER){ clearInterval(CM_TIMER); CM_TIMER = null; } }
function cmRunRemaining(r){
  const t = r.test;
  if(t.timer_mode === 'total' && t.time_minutes) return Math.ceil(t.time_minutes * 60 - (Date.now() - r.startedAt) / 1000);
  if(t.timer_mode === 'perQuestion' && t.seconds_per_question) return Math.ceil(t.seconds_per_question - (Date.now() - (r.qStartedAt || r.startedAt)) / 1000);
  return null;
}
function cmStartRunTimer(){
  cmStopRunTimer();
  const r0 = COMMITTEE.run;
  if(!r0 || cmRunRemaining(r0) === null) return;
  CM_TIMER = setInterval(() => {
    const r = COMMITTEE.run;
    if(!r || STATE.view !== 'committeeRun'){ cmStopRunTimer(); return; }
    const rem = cmRunRemaining(r);
    if(rem === null){ cmStopRunTimer(); return; }
    const el = document.getElementById('cm-timer');
    if(el){
      el.textContent = formatTime(rem);
      el.classList.toggle('time-low', rem <= (r.test.timer_mode === 'perQuestion' ? 10 : 60));
    }
    if(rem <= 0){
      if(r.test.timer_mode === 'perQuestion' && r.idx < r.test.questions.length - 1){
        r.idx++; r.qStartedAt = Date.now(); render();
      } else {
        cmStopRunTimer();
        cmSubmitRun(true);
      }
    }
  }, 500);
}

async function cmSubmitRun(auto){
  const r = COMMITTEE.run; if(!r || r.submitting) return;
  cmStopRunTimer();
  r.submitting = true; render();
  const { data, error } = await supabaseClient.rpc('committee_submit_attempt', {
    p_test_id: r.test.id, p_answers: r.answers, p_duration: Math.round((Date.now() - r.startedAt) / 1000)
  });
  if(error){
    r.submitting = false;
    cmToast(cmErrText(error));
    if(auto){
      // Con el tiempo agotado no se puede seguir: se sale del test para no reintentar en bucle.
      COMMITTEE.run = null; STATE.view = 'committee'; render(); cmLoadMyTests();
    } else {
      render(); cmStartRunTimer();
    }
    return;
  }
  COMMITTEE.result = { title: r.test.title, score: data.score, total: data.total, review: data.review };
  COMMITTEE.run = null;
  if(auto) STATE.toast = '¡Tiempo agotado! Tu test se ha enviado con las respuestas que tenías.';
  STATE.view = 'committeeResult'; render(); window.scrollTo(0, 0);
  cmLoadMyTests();
}

function cmRunView(){
  const r = COMMITTEE.run;
  if(!r) return cmMemberView();
  const qs = r.test.questions;
  const q = qs[r.idx];
  const answered = Object.keys(r.answers).length;
  const sel = r.answers[q.pos];
  const isLast = r.idx === qs.length - 1;
  const perQ = r.test.timer_mode === 'perQuestion';
  const rem = cmRunRemaining(r);
  const dots = qs.map((x, i) => perQ
    ? `<span class="cm-dot ${r.answers[x.pos] ? 'answered' : ''} ${i === r.idx ? 'current' : ''}" aria-label="Pregunta ${i + 1}">${i + 1}</span>`
    : `<button class="cm-dot ${r.answers[x.pos] ? 'answered' : ''} ${i === r.idx ? 'current' : ''}" data-action="committee-goto" data-idx="${i}" aria-label="Pregunta ${i + 1}">${i + 1}</button>`).join('');
  const timerChip = rem === null ? '' : `<span class="qz-chip">${shellIcon(perQ ? 'timer' : 'clock')}<span class="mono ${rem <= (perQ ? 10 : 60) ? 'time-low' : ''}" id="cm-timer">${formatTime(rem)}</span></span>`;
  return `
  <div class="qz">
    <header class="qz-top">
      <button class="qz-exit" data-action="committee-exit-run" aria-label="Salir del test">${shellIcon('chevron')}<span>Salir</span></button>
      <div class="qz-info"><strong>${esc(r.test.title)}</strong><small>Pregunta ${r.idx + 1} de ${qs.length} · ${answered} respondidas</small></div>
      <div class="qz-status">${timerChip}<span class="qz-chip soft">${shellIcon('check')} ${answered}/${qs.length}</span></div>
    </header>
    <div class="qz-progress"><i style="width:${Math.round(answered / qs.length * 100)}%"></i></div>
    <article class="qz-card">
      ${q.rule ? `<div class="qz-tag">Regla ${q.rule} · ${esc(LAW_NAMES[q.rule] || '')}</div>` : '<div class="qz-tag">CTA BAGES</div>'}
      <h2 class="qz-text">${esc(q.question)}</h2>
      <div class="qz-options">
        ${q.options.map((o, i) => `<button class="option ${sel === CM_LETTERS[i] ? 'selected' : ''}" data-action="committee-answer" data-letter="${CM_LETTERS[i]}"><span class="letter">${CM_LETTERS[i].toUpperCase()}</span><span class="opt-text">${esc(o)}</span></button>`).join('')}
      </div>
    </article>
    <div class="qz-actions">
      ${perQ ? `<span></span>` : `<button class="btn btn-secondary" data-action="committee-prev" ${r.idx === 0 ? 'disabled' : ''}>&larr; Anterior</button>`}
      ${isLast
        ? `<button class="btn btn-primary" data-action="committee-finish" ${r.submitting ? 'disabled' : ''}>${r.submitting ? 'Enviando...' : 'Finalizar test'}</button>`
        : `<button class="btn btn-primary" data-action="committee-next">Siguiente &rarr;</button>`}
    </div>
    <div class="cm-dots">${dots}</div>
    ${answered < qs.length ? '' : '<div class="cm-allanswered">Has respondido todas. Cuando quieras, finaliza el test.</div>'}
  </div>`;
}

function cmResultView(){
  const r = COMMITTEE.result;
  if(!r) return cmMemberView();
  const pct = Math.round(r.score / r.total * 100);
  const msg = pct >= 85 ? '¡Excelente resultado!' : pct >= 60 ? 'Buen trabajo, sigue así.' : 'Hay margen de mejora: repasa las reglas más flojas.';
  const review = r.review ? r.review.map((q, idx) => `
    <article class="ac-q">
      <div class="ac-q-head"><span class="ac-q-num">${idx + 1}</span><div class="ac-q-text">${esc(q.question)}</div></div>
      ${q.rule ? `<div class="qz-tag" style="margin-bottom:12px;">Regla ${q.rule} · ${esc(LAW_NAMES[q.rule] || '')}</div>` : ''}
      <div class="ac-q-opts">${q.options.map((o, i) => {
        const letter = CM_LETTERS[i];
        let cls = 'option';
        if(letter === q.correct) cls += ' correct';
        else if(letter === q.chosen) cls += ' incorrect';
        return `<div class="${cls}" style="cursor:default; padding:9px 12px;"><span class="letter">${letter.toUpperCase()}</span><span class="opt-text">${esc(o)}</span></div>`;
      }).join('')}</div>
      ${q.chosen ? '' : '<div style="font-size:12.5px; color:var(--red); margin-top:8px; font-weight:600;">Sin responder</div>'}
      ${q.explanation ? `<div class="ac-q-expl"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    </article>`).join('') : '';
  return `
  <button class="backbtn" data-action="committee-open">&larr; Volver a mis tests</button>
  ${acHero('CTA BAGES · Resultado', esc(r.title), msg, [[pct + '%', 'Resultado'], [r.score + '/' + r.total, 'Correctas'], [r.total - r.score, 'Falladas']])}
  ${r.review ? `<div class="lg-section-head"><h2>Revisión</h2><span>Con las respuestas correctas</span></div><div class="ac-qlist">${review}</div>` : `<div class="ac-empty">${shellIcon('lock')}<strong>Tu resultado ya está guardado</strong><span>Las respuestas correctas se publicarán cuando cierre el test.</span></div>`}`;
}

/* ---------- administrador: panel ---------- */
/* ---------- administración: Panel de Formación (controla CTA BAGES) ---------- */
/* ---------- miembro: lista de tests ---------- */
function cmMemberTestCard(t, now){
  const opens = Date.parse(t.opens_at);
  const closes = t.closes_at ? Date.parse(t.closes_at) : null;
  const notOpen = now < opens;
  const closed = closes !== null && now >= closes;
  const left = t.max_attempts - t.attempts_used;
  const done = t.attempts_used > 0;
  let cls, chip, action = '';
  if(notOpen){ cls = 'sched'; chip = `<span class="cm-chip sched">Abre el ${cmFmtDate(t.opens_at)}</span>`; }
  else if(closed){ cls = 'closed'; chip = '<span class="cm-chip closed">Cerrado</span>'; }
  else { cls = 'open'; chip = '<span class="cm-chip open">Abierto</span>'; }
  if(t.preview){
    action = '<span class="cm-chip soft">Vista previa</span>';
  } else if(!notOpen && !closed && left > 0){
    action = `<button class="btn btn-primary" data-action="committee-start" data-tid="${t.id}">${done ? 'Hacer otro intento' : 'Empezar test'}</button>`;
  } else if(done && (closed || !closes)){
    action = `<button class="btn btn-secondary" data-action="committee-review" data-tid="${t.id}">Ver respuestas</button>`;
  }
  const result = done
    ? `<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
         ${accuracyBadge(Math.round(t.best_score / t.best_total * 100))}
         <span style="font-size:13.5px;"><strong>Tu mejor resultado:</strong> ${t.best_score} / ${t.best_total}</span>
       </div>`
    : '';
  return `<div class="cm-test ${cls}">
    <div class="cm-test-head"><div class="cm-test-title">${esc(t.title)}</div>${chip}</div>
    <div class="cm-meta">
      <span>${cmIc('book')} ${t.total_questions} preguntas</span>
      <span>${cmIc('repeat')} Intentos: ${t.attempts_used}/${t.max_attempts}</span>
      ${t.closes_at ? `<span>${cmIc('clock')} Cierra el ${cmFmtDate(t.closes_at)}</span>` : ''}
      ${t.timer_mode && t.timer_mode !== 'none' ? `<span>${cmIc('timer')} ${cmTimerText(t)}</span>` : ''}
    </div>
    ${result}
    ${action ? `<div class="cm-actions">${action}</div>` : ''}
  </div>`;
}

/* ---------- miembro: hacer el test ---------- */
/* ---------- administrador: panel ---------- */
function cmAdminStats(){
  const members = COMMITTEE.members || [];
  const pub = (COMMITTEE.tests || []).filter(t => t.published);
  const att = COMMITTEE.attempts || [];
  const pubIds = new Set(pub.map(t => t.id));
  let part = 0;
  pub.forEach(t => {
    const users = new Set(att.filter(a => a.test_id === t.id).map(a => a.user_id));
    part += members.length ? Math.min(1, users.size / members.length) : 0;
  });
  const best = {};
  att.forEach(a => { if(!pubIds.has(a.test_id)) return; const k = a.test_id + '|' + a.user_id; if(!best[k] || a.score > best[k].score) best[k] = a; });
  let score = 0, total = 0;
  Object.values(best).forEach(a => { score += a.score; total += a.total; });
  return {
    members: members.length,
    published: pub.length,
    participation: pub.length ? Math.round(part / pub.length * 100) : 0,
    accuracy: total ? Math.round(score / total * 100) : null
  };
}

function cmTestState(t){
  const now = Date.now();
  if(!t.published) return { cls: 'draft', label: 'Borrador' };
  if(Date.parse(t.opens_at) > now) return { cls: 'sched', label: 'Programado' };
  if(t.closes_at && Date.parse(t.closes_at) <= now) return { cls: 'closed', label: 'Cerrado' };
  return { cls: 'open', label: 'Abierto' };
}
function cmStatusChip(t){ const s = cmTestState(t); return `<span class="cm-chip ${s.cls}">${s.label}</span>`; }

function cmMemberStats(uid){
  const pubIds = new Set((COMMITTEE.tests || []).filter(t => t.published).map(t => t.id));
  const best = {};
  (COMMITTEE.attempts || []).filter(a => a.user_id === uid && pubIds.has(a.test_id)).forEach(a => { if(!best[a.test_id] || a.score > best[a.test_id].score) best[a.test_id] = a; });
  const done = Object.values(best);
  const score = done.reduce((s, a) => s + a.score, 0), total = done.reduce((s, a) => s + a.total, 0);
  return { done: done.length, pct: total ? Math.round(score / total * 100) : null, published: pubIds.size };
}

function cmMineTab(){
  if(COMMITTEE.myTests === null){ cmLoadMyTests(); return '<div class="empty-state">Cargando...</div>'; }
  const now = Date.now();
  return COMMITTEE.myTests.length
    ? COMMITTEE.myTests.map(t => cmMemberTestCard(t, now)).join('')
    : '<div class="empty-state">No hay tests publicados.</div>';
}

/* ---------- temporadas: julio–junio (la 2026/2027 va de julio de 2026 a junio de 2027) ---------- */
const CM_MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const CM_SEASON_ORDER = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
function cmSeasonLabel(start){ return start + '/' + (parseInt(start, 10) + 1); }
function cmSeasonStartOf(year, month){ return month >= 7 ? year : year - 1; }
function cmSeasonOfMonth(ym){
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  return m ? String(cmSeasonStartOf(parseInt(m[1], 10), parseInt(m[2], 10))) : null;
}
function cmSeasonOfTest(t){
  const s = cmSeasonOfMonth(t.month);
  if(s) return s;
  const d = t.created_at ? new Date(t.created_at) : new Date();
  return String(cmSeasonStartOf(d.getFullYear(), d.getMonth() + 1));
}
function cmCurrentSeason(){ const d = new Date(); return String(cmSeasonStartOf(d.getFullYear(), d.getMonth() + 1)); }
function cmMonthName(ym){
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  return m ? CM_MONTHS[parseInt(m[2], 10) - 1] : '';
}
function cmMonthNameCap(ym){ const n = cmMonthName(ym); return n ? n.charAt(0).toUpperCase() + n.slice(1) : ''; }
function cmBuilderMonth(b){
  const s = parseInt(b.season, 10), m = parseInt(b.mon, 10);
  if(!s || !m) return null;
  return (m >= 7 ? s : s + 1) + '-' + String(m).padStart(2, '0');
}
function cmRankScope(){
  const tests = (COMMITTEE.tests || []).filter(t => t.published);
  const seasons = Array.from(new Set(tests.map(cmSeasonOfTest).concat([cmCurrentSeason()]))).sort().reverse();
  const season = seasons.includes(COMMITTEE.rankSeason) ? COMMITTEE.rankSeason : cmCurrentSeason();
  const months = Array.from(new Set(tests.filter(t => cmSeasonOfTest(t) === season && t.month).map(t => t.month))).sort();
  const month = months.includes(COMMITTEE.rankMonth) ? COMMITTEE.rankMonth : 'all';
  return { seasons, season, months, month };
}

/* ---------- temporización de los tests ---------- */
function cmTimerText(t){
  if(t && t.timer_mode === 'total' && t.time_minutes) return t.time_minutes + ' min en total';
  if(t && t.timer_mode === 'perQuestion' && t.seconds_per_question) return t.seconds_per_question + ' s por pregunta';
  return 'Sin límite de tiempo';
}
function cmTimerOpt(on, mode, icon, title, text){
  return `<button type="button" class="tc-opt ${on ? 'active' : ''}" data-action="committee-b-timer-mode" data-mode="${mode}">
    <span class="tc-opt-ic">${shellIcon(icon)}</span><span class="tc-opt-body"><strong>${title}</strong><small>${text}</small></span><span class="tc-opt-check">${shellIcon('check')}</span>
  </button>`;
}
function cmFmtMinSec(sec){
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? (r ? m + ' min ' + r + ' s' : m + ' min') : r + ' s';
}
function cmBuilderTimerSummary(b){
  const n = b.selected.length;
  if(b.timerMode === 'total'){
    const mins = parseInt(b.minutes, 10) || 0;
    return mins > 0
      ? `El test tendrá ${mins} min en total` + (n ? ` (${n} preguntas · unos ${cmFmtMinSec(mins * 60 / n)} por pregunta).` : '.')
      : 'Indica cuántos minutos tendrán para todo el test.';
  }
  if(b.timerMode === 'perQuestion'){
    const s = parseInt(b.secPerQ, 10) || 0;
    return s >= 5
      ? `Cada pregunta tendrá ${s} s` + (n ? ` (${n} preguntas · ${cmFmtMinSec(s * n)} como máximo en total).` : '.')
      : 'El mínimo son 5 segundos por pregunta.';
  }
  return 'Sin límite de tiempo: cada árbitro lo hace a su ritmo.';
}
function cmBuilderTimerFields(b){
  return {
    timer_mode: b.timerMode,
    time_minutes: b.timerMode === 'total' ? Math.round(parseInt(b.minutes, 10)) : null,
    seconds_per_question: b.timerMode === 'perQuestion' ? Math.round(parseInt(b.secPerQ, 10)) : null
  };
}

/* ---------- administrador: clasificación ---------- */
function cmComputeRanking(season, month){
  const tests = (COMMITTEE.tests || []).filter(t => t.published && cmSeasonOfTest(t) === season && (month === 'all' || t.month === month));
  const ids = new Set(tests.map(t => t.id));
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
  rows.sort((a, b) => (b.done > 0) - (a.done > 0) || b.pct - a.pct || b.score - a.score || (a.avgDur === null ? 1e9 : a.avgDur) - (b.avgDur === null ? 1e9 : b.avgDur));
  return { rows, testCount: tests.length };
}

/* ================== Panel de Formación: pestañas ================== */
function cmAvatar(name, cls){
  const n = String(name || '?').trim();
  let h = 0; for(let k = 0; k < n.length; k++) h = (h * 31 + n.charCodeAt(k)) % 360;
  return `<span class="lg-avatar ${cls || ''}" style="--h:${h};">${esc(n.charAt(0).toUpperCase())}</span>`;
}

/* ----- Tests ----- */
function cmTestsTab(){
  const ic = (n) => shellIcon(n);
  const tests = COMMITTEE.tests || [];
  const attempts = COMMITTEE.attempts || [];
  const m = (COMMITTEE.members || []).length;
  const filter = COMMITTEE.testFilter || 'all';
  const count = { all: tests.length, draft: 0, sched: 0, open: 0, closed: 0 };
  tests.forEach(t => { count[cmTestState(t).cls]++; });
  const chips = [['all', 'Todos'], ['draft', 'Borradores'], ['sched', 'Programados'], ['open', 'Abiertos'], ['closed', 'Cerrados']]
    .map(([k, label]) => `<button class="tx-filter ${k} ${filter === k ? 'active' : ''}" data-action="committee-test-filter" data-filter="${k}">${label}<em>${count[k]}</em></button>`).join('');
  const shown = tests.filter(t => filter === 'all' || cmTestState(t).cls === filter);
  const cards = shown.map(t => {
    const st = cmTestState(t);
    const people = new Set(attempts.filter(a => a.test_id === t.id).map(a => a.user_id)).size;
    const pct = m ? Math.min(100, Math.round(people / m * 100)) : 0;
    return `<article class="tx-card ${st.cls}">
      <div class="tx-head">
        <span class="tx-month">${ic('calendar')} ${t.month ? esc(cmMonthNameCap(t.month)) + ' · ' : ''}Temporada ${cmSeasonLabel(cmSeasonOfTest(t))}</span>
        ${cmStatusChip(t)}
      </div>
      <h3>${esc(t.title)}</h3>
      <ul class="tx-facts">
        <li>${ic('book')}<span>${t.question_count} preguntas</span></li>
        <li>${ic('repeat')}<span>${t.max_attempts} ${t.max_attempts === 1 ? 'intento' : 'intentos'}</span></li>
        <li>${ic('clock')}<span>${cmFmtDate(t.opens_at)} → ${t.closes_at ? cmFmtDate(t.closes_at) : 'sin cierre'}</span></li>
        <li>${ic('timer')}<span>${cmTimerText(t)}</span></li>
      </ul>
      ${t.published
        ? `<div class="tx-part"><div class="tx-part-top"><span>Participación</span><b>${people} de ${m}</b></div><div class="tx-part-bar"><i style="width:${pct}%"></i></div></div>`
        : `<div class="tx-draftnote">${ic('lock')} Borrador: los árbitros todavía no lo ven</div>`}
      <div class="tx-actions">
        <button class="btn ${t.published ? 'btn-ghost' : 'btn-primary'} tx-main" data-action="committee-toggle-pub" data-tid="${t.id}">${ic(t.published ? 'lock' : 'play')} ${t.published ? 'Quitar de CTA BAGES' : 'Publicar en CTA BAGES'}</button>
        ${t.published ? '' : `<button class="tx-icon" data-action="committee-edit-test" data-tid="${t.id}" title="Editar test" aria-label="Editar test">${ic('pencil')}</button>`}
        <button class="tx-icon" data-action="committee-detail" data-tid="${t.id}" title="Resultados y ajustes" aria-label="Resultados y ajustes">${ic('chart')}</button>
        <button class="tx-icon" data-action="committee-duplicate" data-tid="${t.id}" title="Duplicar" aria-label="Duplicar">${ic('copy')}</button>
        <button class="tx-icon danger" data-action="committee-delete-test" data-tid="${t.id}" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>
      </div>
    </article>`;
  }).join('');
  const empty = tests.length === 0
    ? `<div class="ac-empty">${ic('book')}<strong>Todavía no has creado ningún test</strong><span>Crea el primero con preguntas del banco o genera uno equilibrado en un clic.</span><button class="btn btn-primary" style="margin-top:10px;" data-action="committee-new">${ic('plus')} Crear el primer test</button></div>`
    : `<div class="ac-empty">${ic('search')}<strong>No hay tests en este estado</strong><span>Prueba con otro filtro.</span></div>`;
  return `
  <div class="tx-toolbar">
    <div class="tx-filters">${chips}</div>
  </div>
  ${cards ? `<div class="tx-grid">${cards}</div>` : empty}`;
}

/* ----- Miembros ----- */
function cmMembersTab(){
  const ic = (n) => shellIcon(n);
  const members = COMMITTEE.members || [];
  const rows = members.map(m => {
    const s = cmMemberStats(m.user_id);
    const pct = s.published ? Math.round(s.done / s.published * 100) : 0;
    return `<div class="mb-row">
      ${cmAvatar(cmWho(m))}
      <div class="mb-info"><strong>${esc(m.username || m.full_name || m.email || '')}</strong><small>${esc(m.full_name && m.username ? m.full_name + ' · ' : '')}${esc(m.email || '')}</small></div>
      <div class="mb-prog"><div class="mb-prog-top"><span>${s.done}/${s.published} tests</span></div><div class="mb-prog-bar"><i style="width:${pct}%"></i></div></div>
      <div class="mb-acc">${s.pct !== null ? accuracyBadge(s.pct) : '<span class="cm-chip soft">sin resultados</span>'}</div>
      <button class="tx-icon danger" data-action="committee-remove-member" data-uid="${m.user_id}" title="Quitar acceso" aria-label="Quitar acceso">${ic('trash')}</button>
    </div>`;
  }).join('');
  const withRes = members.filter(m => cmMemberStats(m.user_id).pct !== null).length;
  return `
  <div class="tp-layout mb-layout">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('users')}</span><div><h3>Árbitros con acceso</h3><small>${members.length} ${members.length === 1 ? 'miembro' : 'miembros'} · ${withRes} con resultados</small></div></div>
      ${rows || `<div class="ac-empty" style="padding:26px 14px;">${ic('users')}<strong>Todavía no hay ningún miembro</strong><span>Añade el primero con su email.</span></div>`}
    </div>
    <aside class="tc-card mb-add">
      <div class="tc-card-head"><span class="tc-step">${ic('userplus')}</span><div><h3>Añadir árbitro</h3><small>Por su correo</small></div></div>
      <input type="email" id="cm-new-member" data-cm-field="newMemberEmail" value="${esc(COMMITTEE.newMemberEmail)}" placeholder="correo@ejemplo.com">
      <button class="btn btn-primary" style="width:100%; margin-top:12px; display:inline-flex; align-items:center; justify-content:center; gap:8px;" data-action="committee-add-member">${ic('userplus')} Añadir</button>
      <div class="st-note" style="margin-top:12px;">La persona tiene que haberse registrado antes en we-ref.com con ese mismo email.</div>
    </aside>
  </div>`;
}

/* ----- Clasificación ----- */
function cmRankingTab(){
  const ic = (n) => shellIcon(n);
  const scope = cmRankScope();
  const { rows, testCount } = cmComputeRanking(scope.season, scope.month);
  const top = rows.filter(r => r.done > 0).slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  const pod = (r, i) => `<div class="lg-pod p${i + 1}">
      ${i === 0 ? '<div class="lg-crown">👑</div>' : ''}
      <div class="lg-pod-av">${cmAvatar(r.who, 'xl')}</div>
      <div class="lg-pod-name">${esc(r.who)}</div>
      <div class="lg-pod-meta">${r.score}/${r.total} · ${cmFmtDur(r.avgDur)}</div>
      <div class="lg-pod-score">${Math.round(r.pct)}%</div>
      <div class="lg-pod-step"><span>${i + 1}</span></div>
    </div>`;
  const podium = top.length ? `<div class="lg-podium cm-rank-podium">${[1, 0, 2].filter(i => i < top.length).map(i => pod(top[i], i)).join('')}</div>` : '';
  const list = rows.map((r, i) => `<div class="rk-line ${r.done ? '' : 'none'}">
      <span class="rk-pos">${r.done ? i + 1 : '—'}</span>
      ${cmAvatar(r.who)}
      <div class="rk-who"><strong>${esc(r.who)}</strong>${r.full_name && r.full_name !== r.who ? `<small>${esc(r.full_name)}</small>` : ''}</div>
      <span class="rk-cell"><b>${r.done}/${testCount}</b><small>Tests</small></span>
      <span class="rk-cell"><b>${r.score}/${r.total}</b><small>Puntos</small></span>
      <span class="rk-cell">${r.done ? accuracyBadge(Math.round(r.pct)) : '<span class="law-sub-muted">—</span>'}<small>Acierto</small></span>
      <span class="rk-cell"><b>${cmFmtDur(r.avgDur)}</b><small>Tiempo medio</small></span>
    </div>`).join('');
  return `
  <div class="tx-toolbar">
    <div class="rk-period">
      <label for="cm-rank-season">Temporada</label>
      <select id="cm-rank-season" data-cm-field="rankSeason" data-cm-rerender>
        ${scope.seasons.map(s => `<option value="${esc(s)}" ${scope.season === s ? 'selected' : ''}>${cmSeasonLabel(s)}</option>`).join('')}
      </select>
      <label for="cm-rank-month">Periodo</label>
      <select id="cm-rank-month" data-cm-field="rankMonth" data-cm-rerender>
        <option value="all" ${scope.month === 'all' ? 'selected' : ''}>Toda la temporada</option>
        ${scope.months.map(m => `<option value="${esc(m)}" ${scope.month === m ? 'selected' : ''}>${esc(cmMonthNameCap(m))} ${esc(m.slice(0, 4))}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-ghost" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-export-ranking">${ic('download')} Exportar a Excel</button>
  </div>
  <div class="st-note" style="margin-bottom:14px;">Se cuenta el mejor intento de cada test publicado. Orden: % de acierto, puntos y tiempo medio. Esta clasificación solo la ven los administradores.</div>
  ${podium}
  ${rows.length ? `<div class="rk-list">${list}</div>` : `<div class="ac-empty">${ic('trophy')}<strong>Todavía no hay resultados</strong><span>Cuando los árbitros hagan los tests publicados aparecerán aquí.</span></div>`}`;
}

/* ----- Puntos débiles ----- */
function cmStatsTab(){
  const ic = (n) => shellIcon(n);
  const stats = (COMMITTEE.ruleStats || []).map(s => Object.assign({}, s, { pct: s.answered ? Math.round(s.correct_count / s.answered * 100) : 0 })).sort((a, b) => a.pct - b.pct);
  if(!stats.length) return `<div class="ac-empty">${ic('target')}<strong>Todavía no hay resultados</strong><span>Cuando los árbitros hagan tests se calcularán aquí los puntos débiles del comité.</span></div>`;
  const tone = (p) => p >= 80 ? 'good' : p >= 60 ? 'mid' : 'bad';
  const weakest = stats.slice(0, 3);
  const rows = stats.map(s => `<div class="st-rule st-rule-static">
      <span class="st-rule-n">${s.rule}</span>
      <span class="st-rule-main"><span class="st-rule-name">${esc(LAW_NAMES[s.rule] || '')}</span><span class="st-rule-bar"><i style="width:${s.pct}%; background:${scoreColor(s.pct)};"></i></span></span>
      <span class="st-acc ${tone(s.pct)}">${s.pct}%</span>
    </div>`).join('');
  return `
  <div class="tp-layout">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('book')}</span><div><h3>Acierto del comité por regla</h3><small>De menor a mayor</small></div></div>
      <div class="st-rules">${rows}</div>
    </div>
    <aside class="tc-card">
      <div class="tc-card-head"><span class="tc-step" style="background:var(--red);">${ic('target')}</span><div><h3>A reforzar</h3><small>Las 3 reglas más flojas</small></div></div>
      ${weakest.map(s => `<div class="st-pill ${tone(s.pct)}"><b>R${s.rule}</b><span>${esc(LAW_NAMES[s.rule] || '')}</span><em>${s.pct}%</em></div>`).join('')}
    </aside>
  </div>`;
}

/* ----- Panel de Formación ----- */
function cmTrainingView(){
  const ic = (n) => shellIcon(n);
  const st = COMMITTEE.status || {};
  const tab = ['tests', 'messages', 'members', 'ranking', 'stats'].includes(COMMITTEE.tab) ? COMMITTEE.tab : 'tests';
  const nTests = (COMMITTEE.tests || []).length;
  const nMembers = (COMMITTEE.members || []).length;
  const tabs = [['tests', 'Tests', 'book', nTests], ['messages', 'Mensajes', 'message', (COMMITTEE.messages || []).length], ['members', 'Miembros', 'users', nMembers], ['ranking', 'Clasificación', 'trophy', null], ['stats', 'Puntos débiles', 'target', null]];
  let content;
  if(COMMITTEE.tests === null) content = `<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  else if(tab === 'members') content = cmMembersTab();
  else if(tab === 'ranking') content = cmRankingTab();
  else if(tab === 'stats') content = cmStatsTab();
  else if(tab === 'messages') content = cmMessagesTab();
  else content = cmTestsTab();
  const s = cmAdminStats();
  const hero = cmHero('Administración · CTA BAGES', 'Panel de Formación',
    'Prepara aquí los tests y los árbitros, en privado. Cuando esté listo, publícalo y aparecerá en CTA BAGES.',
    `<button class="btn btn-yellow" data-action="committee-new">${ic('plus')} Nuevo test</button>
     <button class="btn btn-glass" data-action="committee-open">${ic('eye')} Ver CTA BAGES</button>`,
    `<div class="lg-hero-stats cm-hero-stats">
      <div class="lg-stat"><b>${s.members}</b><span>Miembros</span></div>
      <div class="lg-stat"><b>${s.published}</b><span>Publicados</span></div>
      <div class="lg-stat"><b>${s.participation}%</b><span>Participación</span></div>
      <div class="lg-stat"><b>${s.accuracy !== null ? s.accuracy + '%' : '—'}</b><span>Acierto medio</span></div>
    </div>`);
  return `
  ${hero}
  ${cmSetupWarning()}
  ${COMMITTEE.error && !st.setupMissing ? `<div class="ac-empty" style="margin-bottom:12px;">${ic('flag')}<strong>${esc(COMMITTEE.error)}</strong></div>` : ''}
  <nav class="cm-tabs" role="tablist" aria-label="Secciones del Panel de Formación">
    ${tabs.map(([k, label, icon, n]) => `<button class="cm-tab ${tab === k ? 'active' : ''}" data-action="committee-tab" data-tab="${k}">${shellIcon(icon)}<span>${label}</span>${n !== null ? `<em>${n}</em>` : ''}</button>`).join('')}
  </nav>
  <section class="cm-content">${content}</section>`;
}

/* ---------- administrador: resultados y ajustes de un test ---------- */
async function cmOpenDetail(tid){
  COMMITTEE.detailTestId = tid;
  COMMITTEE.qStats = null;
  const t = (COMMITTEE.tests || []).find(x => x.id === tid);
  COMMITTEE.settings = t ? { opens: cmToLocalInput(t.opens_at), closes: cmToLocalInput(t.closes_at), max: String(t.max_attempts) } : null;
  STATE.view = 'committeeTestDetail';
  render();
  const { data, error } = await supabaseClient.rpc('committee_admin_question_stats', { p_test_id: tid });
  COMMITTEE.qStats = error ? [] : (data || []);
  if(error) STATE.toast = cmErrText(error);
  cmRefresh();
}

function cmTestDetailView(){
  const t = (COMMITTEE.tests || []).find(x => x.id === COMMITTEE.detailTestId);
  if(!t) return '<button class="backbtn" data-action="committee-training">&larr; Volver</button><div class="empty-state">Test no encontrado.</div>';
  const set = COMMITTEE.settings || { opens: '', closes: '', max: '1' };
  const attempts = (COMMITTEE.attempts || []).filter(a => a.test_id === t.id)
    .sort((a, b) => b.score - a.score || (a.duration_sec || 0) - (b.duration_sec || 0));
  const doneIds = new Set(attempts.map(a => a.user_id));
  const pending = (COMMITTEE.members || []).filter(m => !doneIds.has(m.user_id));
  const avgPct = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score / a.total * 100, 0) / attempts.length) : null;
  const avgDur = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.duration_sec || 0), 0) / attempts.length) : null;
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
    return `<div style="margin-bottom:12px;">
      <div style="display:flex; gap:10px; align-items:flex-start; margin-bottom:5px; font-size:13px;">
        <span class="mono" style="color:var(--muted); width:24px; flex-shrink:0;">${s.pos}.</span>
        <span style="flex:1;">${esc(s.question)}</span>
        <span class="mono" style="color:var(--muted); flex-shrink:0;">${s.rule ? 'R' + s.rule : '—'}</span>
        <span class="mono" style="width:42px; text-align:right; font-weight:700; color:${s.answered ? scoreColor(pct) : 'var(--muted)'};">${s.answered ? pct + '%' : '—'}</span>
      </div>
      <div class="cm-rule-bar" style="margin-left:34px;"><div style="width:${pct}%; background:${scoreColor(pct)};"></div></div>
    </div>`;
  }).join('');
  return `
  <button class="backbtn" data-action="committee-training">&larr; Volver al Panel de Formación</button>
  <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
    <h2 style="margin:0;">${esc(t.title)}</h2>${cmStatusChip(t)}
    ${t.published ? '' : `<button class="btn btn-primary" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-edit-test" data-tid="${t.id}">${cmIc('pencil')} Editar test</button>`}
    <button class="btn btn-secondary" style="margin-left:auto; display:inline-flex; align-items:center; gap:8px;" data-action="committee-export-test" data-tid="${t.id}">${cmIc('download')} Exportar a Excel</button>
  </div>
  <div class="home-kpis" style="margin-bottom:18px;">
    <div class="kpi"><div class="kpi-top">${cmIc('users')} Participantes</div><div class="kpi-val">${doneIds.size}<small> / ${(COMMITTEE.members || []).length}</small></div><div class="kpi-sub">${t.question_count} preguntas</div></div>
    <div class="kpi"><div class="kpi-top">${cmIc('target')} Acierto medio</div><div class="kpi-val" ${avgPct !== null ? `style="color:${scoreColor(avgPct)};"` : ''}>${avgPct !== null ? avgPct + '<small>%</small>' : '—'}</div><div class="kpi-sub">de todos los intentos</div></div>
    <div class="kpi"><div class="kpi-top">${cmIc('clock')} Tiempo medio</div><div class="kpi-val">${cmFmtDur(avgDur)}</div><div class="kpi-sub">por intento</div></div>
    <div class="kpi"><div class="kpi-top">${cmIc('repeat')} Pendientes</div><div class="kpi-val">${pending.length}</div><div class="kpi-sub">aún sin hacerlo</div></div>
  </div>

  <div class="cm-card">
    <div class="cm-sec-title">Ajustes del test</div>
    <div class="cm-fields">
      <div><label for="cm-s-opens">Abre</label><input type="datetime-local" id="cm-s-opens" data-cm-field="settings.opens" value="${esc(set.opens)}"></div>
      <div><label for="cm-s-closes">Cierra (vacío = sin cierre)</label><input type="datetime-local" id="cm-s-closes" data-cm-field="settings.closes" value="${esc(set.closes)}"></div>
      <div><label for="cm-s-max">Intentos permitidos</label><input type="number" id="cm-s-max" min="1" max="20" data-cm-field="settings.max" value="${esc(String(set.max))}"></div>
    </div>
    <div style="margin-top:14px;"><button class="btn btn-primary" data-action="committee-save-settings" data-tid="${t.id}">Guardar ajustes</button></div>
  </div>

  <div class="cm-card" style="overflow-x:auto;">
    <div class="cm-sec-title">Resultados</div>
    ${attempts.length ? `<table class="stat-table"><tr><th>Árbitro</th><th>Intento</th><th>Puntos</th><th>Acierto</th><th>Tiempo</th><th>Fecha</th></tr>${rows}</table>` : '<div style="font-size:13.5px; color:var(--muted);">Nadie ha hecho este test todavía.</div>'}
  </div>
  ${pending.length ? `<div class="cm-card"><div class="cm-sec-title">Pendientes de hacerlo (${pending.length})</div><div class="cm-chips">${pending.map(m => `<span class="cm-chip soft">${esc(cmWho(m))}</span>`).join('')}</div></div>` : ''}
  <div class="cm-card">
    <div class="cm-sec-title">Acierto por pregunta</div>
    ${COMMITTEE.qStats === null ? '<div style="font-size:13.5px; color:var(--muted);">Cargando...</div>' : (qrows || '<div style="font-size:13.5px; color:var(--muted);">Sin datos.</div>')}
  </div>`;
}

/* ---------- administrador: crear un test ---------- */
function cmNewBuilder(){
  const now = new Date();
  const season = String(cmSeasonStartOf(now.getFullYear(), now.getMonth() + 1));
  const mon = String(now.getMonth() + 1);
  return {
    editId: null, title: '', season, mon, opens: '', closes: '', maxAttempts: 1,
    timerMode: 'none', minutes: 20, secPerQ: 45, hadTimerCols: false,
    selected: [], expanded: {},
    filterRule: 'all', filterDiff: 'all', filterText: '', hideUsed: false, page: 1,
    genCount: 10, genRules: [],
    showCustom: false, custom: { q: '', a: '', b: '', c: '', d: '', correct: 'a', rule: '', expl: '' },
    saving: false
  };
}

function cmBankPool(b){
  let list = allQuestions().filter(q => q.domain === 'law' || q.domain === 'glossary');
  if(b.filterDiff === 'hard') list = list.filter(q => q.difficulty === 'hard');
  else if(b.filterDiff === 'normal') list = list.filter(q => q.difficulty !== 'hard');
  if(b.hideUsed) list = list.filter(q => !cmUsedIn(q).length);
  return list;
}
function cmBankCandidates(){
  const b = COMMITTEE.builder;
  let list = cmBankPool(b);
  if(b.filterRule === 'glossary') list = list.filter(q => q.domain === 'glossary');
  else if(b.filterRule !== 'all') list = list.filter(q => q.domain === 'law' && q.rule === parseInt(b.filterRule, 10));
  const s = b.filterText.trim().toLowerCase();
  if(s) list = list.filter(q => q.question.toLowerCase().includes(s) || q.options.some(o => o.toLowerCase().includes(s)));
  return list;
}

function cmQuestionDetail(q){
  return `<div style="margin:8px 0 10px;">
    ${q.options.map((o, i) => `<div class="option ${CM_LETTERS[i] === q.correct ? 'correct' : ''}" style="cursor:default; padding:8px 12px; margin-bottom:6px; font-size:13px;"><span class="letter">${CM_LETTERS[i]})</span>${esc(o)}</div>`).join('')}
    ${q.explanation ? `<div style="margin-top:6px; padding:8px 12px; background:#FBF1F1; border-radius:8px; font-size:12.5px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
  </div>`;
}

function cmComposition(selected){
  const by = {};
  selected.forEach(q => { const k = q.domain === 'glossary' ? 'G' : (q.rule ? 'R' + q.rule : '—'); by[k] = (by[k] || 0) + 1; });
  const keys = Object.keys(by).sort((a, b) => (parseInt(a.slice(1), 10) || 99) - (parseInt(b.slice(1), 10) || 99));
  return keys.map(k => `<span class="cm-chip soft">${k} × ${by[k]}</span>`).join('');
}

function cmBuilderView(){
  const b = COMMITTEE.builder;
  if(!b) return cmAdminView();
  const curSeason = parseInt(cmCurrentSeason(), 10);
  const seasonSet = new Set([-1, 0, 1, 2].map(d => String(curSeason + d)));
  if(b.season) seasonSet.add(String(b.season));
  const seasonOpts = Array.from(seasonSet).sort();
  const picked = new Set(b.selected.map(q => q.id));
  const cands = cmBankCandidates();
  const totalPages = Math.max(1, Math.ceil(cands.length / CM_PAGE_SIZE));
  if(b.page > totalPages) b.page = totalPages;
  const pageItems = cands.slice((b.page - 1) * CM_PAGE_SIZE, b.page * CM_PAGE_SIZE);
  const ruleOpts = `<option value="all">Todas las reglas</option>` +
    Array.from({ length: 17 }, (_, i) => i + 1).map(i => `<option value="${i}" ${String(b.filterRule) === String(i) ? 'selected' : ''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('') +
    `<option value="glossary" ${b.filterRule === 'glossary' ? 'selected' : ''}>Glosario</option>`;
  const genChips = Array.from({ length: 17 }, (_, i) => i + 1).map(i => `<button class="cm-pick ${b.genRules.includes(i) ? 'on' : ''}" data-action="committee-b-gen-rule" data-rule="${i}">R${i}</button>`).join('');

  const candHtml = pageItems.map(q => {
    const open = !!b.expanded[q.id];
    const used = cmUsedIn(q);
    return `<div class="cm-bank-q">
      <div class="qtag" style="margin-bottom:4px;">${cmRuleLabel(q)}${q.difficulty === 'hard' ? ' <span class="badge" style="background:var(--red); color:#fff;">Difícil</span>' : ''}${q.source === 'user' ? ' <span class="badge" style="background:var(--pitch); color:#fff;">Del comité</span>' : ''}</div>
      <div style="font-size:13.5px; margin-bottom:6px;">${esc(q.question)}</div>
      ${used.length ? `<div class="cm-used">Ya usada en: ${used.map(esc).join(', ')}</div>` : ''}
      ${open ? cmQuestionDetail(q) : ''}
      <div class="cm-actions" style="margin-top:8px;">
        <button class="btn ${picked.has(q.id) ? 'btn-secondary' : 'btn-primary'}" data-action="committee-b-toggle" data-qid="${esc(q.id)}">${picked.has(q.id) ? '✓ Añadida · quitar' : '+ Añadir'}</button>
        <button class="btn btn-ghost" data-action="committee-b-expand" data-qid="${esc(q.id)}">${open ? 'Ocultar respuestas' : 'Ver respuestas'}</button>
      </div>
    </div>`;
  }).join('');

  const selHtml = b.selected.map((q, i) => {
    const open = !!b.expanded[q.id];
    return `<div class="cm-sel-item">
      <div class="cm-sel-row">
        <span class="cm-sel-num">${i + 1}.</span>
        <span style="flex:1;">${esc(q.question)}<div style="margin-top:3px;"><span class="cm-chip soft" style="padding:1px 8px; font-size:11px;">${cmRuleShort(q)}</span></div></span>
        <span class="cm-sel-tools">
          <button class="icon-btn" title="Subir" data-action="committee-b-move" data-qid="${esc(q.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>${shellIcon('up')}</button>
          <button class="icon-btn" title="Bajar" data-action="committee-b-move" data-qid="${esc(q.id)}" data-dir="1" ${i === b.selected.length - 1 ? 'disabled' : ''}>${shellIcon('down')}</button>
          <button class="icon-btn" title="${open ? 'Ocultar respuestas' : 'Ver respuestas'}" data-action="committee-b-expand" data-qid="${esc(q.id)}">${shellIcon('eye')}</button>
          <button class="icon-btn" title="Quitar" data-action="committee-b-toggle" data-qid="${esc(q.id)}">${shellIcon('trash')}</button>
        </span>
      </div>
      ${open ? `<div style="padding-left:32px;">${cmQuestionDetail(q)}</div>` : ''}
    </div>`;
  }).join('');

  const c = b.custom;
  const customHtml = b.showCustom ? `<div class="cm-card">
    <div class="cm-sec-title">Pregunta propia del comité</div>
    <label for="cm-c-q" style="margin-top:0;">Enunciado</label><textarea id="cm-c-q" data-cm-field="builder.custom.q" maxlength="1000">${esc(c.q)}</textarea>
    <div class="cm-fields">
      <div><label for="cm-c-a">Respuesta a)</label><input type="text" id="cm-c-a" data-cm-field="builder.custom.a" value="${esc(c.a)}" maxlength="300"></div>
      <div><label for="cm-c-b">Respuesta b)</label><input type="text" id="cm-c-b" data-cm-field="builder.custom.b" value="${esc(c.b)}" maxlength="300"></div>
      <div><label for="cm-c-c">Respuesta c)</label><input type="text" id="cm-c-c" data-cm-field="builder.custom.c" value="${esc(c.c)}" maxlength="300"></div>
      <div><label for="cm-c-d">Respuesta d)</label><input type="text" id="cm-c-d" data-cm-field="builder.custom.d" value="${esc(c.d)}" maxlength="300" placeholder="Ninguna respuesta es correcta."></div>
      <div><label for="cm-c-correct">Correcta</label><select id="cm-c-correct" data-cm-field="builder.custom.correct">${CM_LETTERS.map(l => `<option value="${l}" ${c.correct === l ? 'selected' : ''}>${l})</option>`).join('')}</select></div>
      <div><label for="cm-c-rule">Regla (opcional)</label><select id="cm-c-rule" data-cm-field="builder.custom.rule"><option value="">Sin regla</option>${Array.from({ length: 17 }, (_, i) => i + 1).map(i => `<option value="${i}" ${String(c.rule) === String(i) ? 'selected' : ''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('')}</select></div>
      <div class="full"><label for="cm-c-expl">Explicación (opcional)</label><input type="text" id="cm-c-expl" data-cm-field="builder.custom.expl" value="${esc(c.expl)}" maxlength="500"></div>
    </div>
    <div style="margin-top:14px;"><button class="btn btn-primary" data-action="committee-b-add-custom">+ Añadir al test</button></div>
  </div>` : '';

  return `
  <button class="backbtn" data-action="committee-b-cancel">&larr; Cancelar</button>
  <h2 style="margin-bottom:14px;">${b.editId ? 'Editar test' : 'Nuevo test'}</h2>

  <div class="cm-card">
    <div class="cm-sec-title">Datos del test</div>
    <div class="cm-fields">
      <div class="full"><label for="cm-b-title" style="margin-top:0;">Título</label><input type="text" id="cm-b-title" data-cm-field="builder.title" value="${esc(b.title)}" placeholder="Ej.: Test de octubre" maxlength="120"></div>
      <div><label for="cm-b-season">Temporada (clasificación)</label>
        <select id="cm-b-season" data-cm-field="builder.season" data-cm-rerender>
          ${seasonOpts.map(s => `<option value="${s}" ${String(b.season) === s ? 'selected' : ''}>${cmSeasonLabel(s)}</option>`).join('')}
        </select></div>
      <div><label for="cm-b-mon">Mes</label>
        <select id="cm-b-mon" data-cm-field="builder.mon" data-cm-rerender>
          ${CM_SEASON_ORDER.map(n => `<option value="${n}" ${String(b.mon) === String(n) ? 'selected' : ''}>${CM_MONTHS[n - 1].charAt(0).toUpperCase() + CM_MONTHS[n - 1].slice(1)}</option>`).join('')}
        </select></div>
      <div class="full cm-season-note">${shellIcon('trophy')}<span>Este test cuenta para la clasificación de la temporada <b>${cmSeasonLabel(b.season)}</b>, mes de <b>${CM_MONTHS[parseInt(b.mon, 10) - 1]} de ${cmBuilderMonth(b).slice(0, 4)}</b>. Cada temporada tiene su propia clasificación.</span></div>
      <div><label for="cm-b-attempts">Intentos permitidos</label><input type="number" id="cm-b-attempts" min="1" max="20" data-cm-field="builder.maxAttempts" value="${esc(String(b.maxAttempts))}"></div>
      <div><label for="cm-b-opens">Abre (vacío = ahora)</label><input type="datetime-local" id="cm-b-opens" data-cm-field="builder.opens" value="${esc(b.opens)}"></div>
      <div><label for="cm-b-closes">Cierra (opcional)</label><input type="datetime-local" id="cm-b-closes" data-cm-field="builder.closes" value="${esc(b.closes)}"></div>
    </div>
    <div style="font-size:12.5px; color:var(--muted); margin-top:10px;">Las respuestas correctas se enseñan a los árbitros cuando el test cierra. Si no pones fecha de cierre, se enseñan al terminar.</div>
  </div>

  <div class="cm-card">
    <div class="cm-sec-title">${cmIc('clock')} Temporización</div>
    <div class="tc-opts three">
      ${cmTimerOpt(b.timerMode === 'none', 'none', 'repeat', 'Sin límite', 'Cada árbitro va a su ritmo.')}
      ${cmTimerOpt(b.timerMode === 'total', 'total', 'clock', 'Tiempo total', 'Un reloj para todo el test.')}
      ${cmTimerOpt(b.timerMode === 'perQuestion', 'perQuestion', 'zap', 'Por pregunta', 'Cada pregunta con su cuenta atrás.')}
    </div>
    ${b.timerMode === 'total' ? `
      <div class="cm-timer-field"><label for="cm-b-minutes">Minutos para todo el test</label>
      <input type="number" id="cm-b-minutes" min="1" max="600" data-cm-field="builder.minutes" data-cm-rerender value="${esc(String(b.minutes))}">
      <small>Al llegar a cero el test se envía solo con las respuestas que haya.</small></div>` : ''}
    ${b.timerMode === 'perQuestion' ? `
      <div class="cm-timer-field"><label for="cm-b-secq">Segundos por pregunta</label>
      <input type="number" id="cm-b-secq" min="5" max="3600" data-cm-field="builder.secPerQ" data-cm-rerender value="${esc(String(b.secPerQ))}">
      <small>Al acabarse el tiempo de una pregunta pasa sola a la siguiente. En este modo no se puede volver atrás.</small></div>` : ''}
    <div class="cm-season-note">${cmIc('clock')}<span>${esc(cmBuilderTimerSummary(b))}</span></div>
  </div>

  <div class="cm-builder">
    <div class="cm-b-main">
      <div class="cm-card">
        <div class="cm-sec-title">${cmIc('wand')} Generar un test equilibrado</div>
        <div style="font-size:13px; color:var(--muted); margin-bottom:10px;">Reparte las preguntas a partes iguales entre las reglas que elijas (si no eliges ninguna, entre las 17). Respeta los filtros de dificultad y de preguntas ya usadas.</div>
        <div class="cm-chips" style="margin-bottom:12px;">${genChips}</div>
        <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
          <div style="width:120px;"><label for="cm-b-gen" style="margin-top:0;">Nº de preguntas</label><input type="number" id="cm-b-gen" min="1" max="100" data-cm-field="builder.genCount" value="${esc(String(b.genCount))}"></div>
          <button class="btn btn-primary" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-b-generate">${cmIc('wand')} Generar y añadir</button>
        </div>
      </div>

      <div class="cm-card">
        <div class="cm-sec-title">Buscar en el banco de preguntas</div>
        <div class="cm-fields">
          <div><label for="cm-b-rule" style="margin-top:0;">Regla</label><select id="cm-b-rule" data-cm-field="builder.filterRule" data-cm-rerender>${ruleOpts}</select></div>
          <div><label for="cm-b-diff" style="margin-top:0;">Dificultad</label><select id="cm-b-diff" data-cm-field="builder.filterDiff" data-cm-rerender>
            <option value="all" ${b.filterDiff === 'all' ? 'selected' : ''}>Todas</option>
            <option value="hard" ${b.filterDiff === 'hard' ? 'selected' : ''}>Solo difíciles</option>
            <option value="normal" ${b.filterDiff === 'normal' ? 'selected' : ''}>Solo normales</option>
          </select></div>
          <div class="full"><label for="cm-b-search">Buscar texto</label><input type="text" id="cm-b-search" data-cm-field="builder.filterText" data-cm-rerender value="${esc(b.filterText)}" placeholder="Palabra de la pregunta o respuestas..." maxlength="100"></div>
        </div>
        <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13.5px; margin-top:12px; letter-spacing:0;">
          <input type="checkbox" id="cm-b-hideused" style="width:auto;" data-cm-field="builder.hideUsed" data-cm-rerender ${b.hideUsed ? 'checked' : ''}> Ocultar las preguntas que ya salieron en otros tests
        </label>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
          <button class="btn btn-secondary" data-action="committee-b-random">${cmIc('shuffle')} Añadir 10 aleatorias de esta búsqueda</button>
          <button class="btn btn-ghost" data-action="committee-b-toggle-custom">${cmIc('pencil')} ${b.showCustom ? 'Cerrar pregunta propia' : 'Escribir una pregunta propia'}</button>
        </div>
      </div>
      ${customHtml}
      <div style="font-size:12.5px; color:var(--muted); margin-bottom:8px;">${cands.length} preguntas coinciden</div>
      ${candHtml || '<div class="empty-state">Ninguna pregunta coincide.</div>'}
      ${cands.length > CM_PAGE_SIZE ? `<div style="display:flex; justify-content:center; align-items:center; gap:14px; margin:12px 0;">
        <button class="btn btn-ghost" data-action="committee-b-prev" ${b.page <= 1 ? 'disabled' : ''}>&larr; Anterior</button>
        <span class="mono" style="font-size:13px; color:var(--muted);">Página ${b.page} / ${totalPages}</span>
        <button class="btn btn-ghost" data-action="committee-b-next" ${b.page >= totalPages ? 'disabled' : ''}>Siguiente &rarr;</button>
      </div>` : ''}
    </div>

    <aside class="cm-b-side">
      <div class="cm-card">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
          <div class="cm-sec-title" style="margin:0;">Tu test (${b.selected.length})</div>
          <div class="cm-actions">
            <button class="btn btn-ghost" style="padding:5px 10px;" data-action="committee-b-shuffle" ${b.selected.length < 2 ? 'disabled' : ''} title="Mezclar el orden">${cmIc('shuffle')}</button>
            <button class="btn btn-ghost btn-danger-soft" style="padding:5px 10px;" data-action="committee-b-clear" ${b.selected.length ? '' : 'disabled'} title="Vaciar">${cmIc('trash')}</button>
          </div>
        </div>
        ${b.selected.length ? `<div class="cm-chips" style="margin-bottom:8px;">${cmComposition(b.selected)}</div>` : ''}
        ${selHtml || '<div style="font-size:13px; color:var(--muted); padding:8px 0;">Todavía no has elegido ninguna pregunta. Genera un test equilibrado o añade desde el banco.</div>'}
        <button class="btn btn-primary" style="width:100%; margin-top:14px;" data-action="committee-b-save" ${b.saving ? 'disabled' : ''}>${b.saving ? 'Guardando...' : (b.editId ? 'Guardar cambios' : 'Guardar como borrador')}</button>
        <div style="font-size:12px; color:var(--muted); margin-top:8px; text-align:center;">${b.editId ? 'Sigue en borrador: los árbitros no lo ven hasta que lo publiques.' : 'Después podrás revisarlo y publicarlo.'}</div>
      </div>
    </aside>
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
  if(b.timerMode === 'total'){
    const mins = parseInt(b.minutes, 10);
    if(!(mins >= 1 && mins <= 600)){ cmToast('El tiempo total tiene que estar entre 1 y 600 minutos.'); return; }
  }
  if(b.timerMode === 'perQuestion'){
    const secs = parseInt(b.secPerQ, 10);
    if(!(secs >= 5 && secs <= 3600)){ cmToast('Los segundos por pregunta tienen que estar entre 5 y 3600.'); return; }
  }
  // Si el SQL de temporización aún no se ha ejecutado y no se usa tiempo, no se envían esas columnas.
  const withTimer = b.timerMode !== 'none' || b.hadTimerCols;
  b.saving = true; render();
  const questions = b.selected.map(q => ({
    question: q.question, options: q.options, correct: q.correct,
    rule: q.domain === 'glossary' ? null : (q.rule || null), explanation: q.explanation || ''
  }));
  let error, timerErr = null;
  if(b.editId){
    // Edición de un borrador: se actualizan los datos y se reemplazan las preguntas.
    const patch = { title: b.title.trim(), month: cmBuilderMonth(b), closes_at: closes ? closes.toISOString() : null, max_attempts: attempts };
    if(opens) patch.opens_at = opens.toISOString();
    if(withTimer) Object.assign(patch, cmBuilderTimerFields(b));
    ({ error } = await supabaseClient.from('committee_tests').update(patch).eq('id', b.editId));
    if(!error){
      const rows = questions.map((q, i) => ({ test_id: b.editId, pos: i + 1, question: q.question, options: q.options, correct: q.correct, rule: q.rule, explanation: q.explanation }));
      ({ error } = await supabaseClient.from('committee_test_questions').upsert(rows, { onConflict: 'test_id,pos' }));
      if(!error) ({ error } = await supabaseClient.from('committee_test_questions').delete().eq('test_id', b.editId).gt('pos', rows.length));
    }
  } else {
    let newId;
    ({ data: newId, error } = await supabaseClient.rpc('committee_admin_create_test', {
      p_title: b.title.trim(), p_month: cmBuilderMonth(b),
      p_opens: opens ? opens.toISOString() : null, p_closes: closes ? closes.toISOString() : null,
      p_max_attempts: attempts, p_questions: questions
    }));
    if(!error && withTimer && newId){
      const tr = await supabaseClient.from('committee_tests').update(cmBuilderTimerFields(b)).eq('id', newId);
      if(tr.error) timerErr = tr.error;
    }
  }
  const wasEdit = !!b.editId;
  b.saving = false;
  if(error){ cmToast(cmErrText(error)); return; }
  COMMITTEE.builder = null;
  COMMITTEE.tab = 'tests';
  STATE.view = 'committeeTraining';
  STATE.toast = timerErr
    ? 'El test se guardó, pero no se pudo guardar el tiempo (' + cmErrText(timerErr) + '). Edítalo para ponerlo.'
    : (wasEdit ? 'Cambios guardados. El test sigue en borrador.' : 'Test guardado como borrador. Publícalo cuando esté listo.');
  render();
  cmLoadAdminData();
}

function cmGenerate(){
  const b = COMMITTEE.builder;
  const n = Math.max(1, Math.min(100, parseInt(b.genCount, 10) || 10));
  const taken = new Set(b.selected.map(q => q.id));
  const base = cmBankPool(b).filter(q => q.domain === 'law' && q.rule && !taken.has(q.id));
  const rules = b.genRules.length ? b.genRules : Array.from({ length: 17 }, (_, i) => i + 1);
  const buckets = rules.map(r => cmShuffle(base.filter(q => q.rule === r))).filter(a => a.length);
  const picked = [];
  let i = 0;
  while(picked.length < n && buckets.some(x => x.length)){
    const bk = buckets[i % buckets.length];
    if(bk.length) picked.push(bk.pop());
    i++;
  }
  picked.forEach(q => b.selected.push(q));
  return picked.length;
}

/* ---------- acciones ---------- */
async function committeeOnAction(action, el){
  const tid = el.dataset.tid;
  const b = COMMITTEE.builder;

  if(action === 'committee-open'){
    const st = COMMITTEE.status;
    if(!st) return;
    // CTA BAGES es lo que ven los árbitros; el administrador lo ve como vista previa.
    STATE.view = 'committee'; render(); window.scrollTo(0, 0);
    if(st.is_admin) cmLoadAdminData();
    if(st.is_member || !st.is_admin) cmLoadMyTests();
  }
  else if(action === 'committee-tab'){ COMMITTEE.tab = el.dataset.tab; STATE.view = 'committeeTraining'; render(); }
  else if(action === 'committee-test-filter'){ COMMITTEE.testFilter = el.dataset.filter; render(); }
  else if(action === 'committee-training'){
    if(!isDevUser()) return;
    STATE.view = 'committeeTraining'; render(); window.scrollTo(0, 0);
    cmLoadAdminData();
  }
  else if(action === 'committee-msg-save'){
    if(!isDevUser()) return;
    const d = COMMITTEE.msgDraft || { id: null, title: '', body: '' };
    const title = String(d.title || '').trim(), body = String(d.body || '').trim();
    if(!title || !body){ cmToast('Escribe un título y un mensaje.'); return; }
    const publish = el.dataset.publish === '1';
    const nowIso = new Date().toISOString();
    let error;
    if(d.id){
      const cur = (COMMITTEE.messages || []).find(m => m.id === d.id) || {};
      const patch = { title, body };
      if(publish && !cur.published){ patch.published = true; patch.published_at = nowIso; }
      ({ error } = await supabaseClient.from('committee_messages').update(patch).eq('id', d.id));
    } else {
      ({ error } = await supabaseClient.from('committee_messages').insert({ title, body, published: publish, published_at: publish ? nowIso : null }));
    }
    if(error){ cmToast(cmErrText(error)); return; }
    COMMITTEE.msgDraft = { id: null, title: '', body: '' };
    cmToast(publish ? 'Mensaje publicado en CTA BAGES.' : 'Mensaje guardado como borrador.');
    cmLoadAdminData();
  }
  else if(action === 'committee-msg-publish'){
    if(!isDevUser()) return;
    const m = (COMMITTEE.messages || []).find(x => x.id === el.dataset.mid); if(!m) return;
    if(!m.published && !confirm('¿Publicar "' + m.title + '" en CTA BAGES? Los árbitros lo verán.')) return;
    const patch = m.published ? { published: false } : { published: true, published_at: new Date().toISOString() };
    const { error } = await supabaseClient.from('committee_messages').update(patch).eq('id', m.id);
    if(error){ cmToast(cmErrText(error)); return; }
    cmToast(m.published ? 'Mensaje quitado de CTA BAGES.' : 'Mensaje publicado en CTA BAGES.');
    cmLoadAdminData();
  }
  else if(action === 'committee-msg-edit'){
    const m = (COMMITTEE.messages || []).find(x => x.id === el.dataset.mid); if(!m) return;
    COMMITTEE.msgDraft = { id: m.id, title: m.title, body: m.body };
    render(); window.scrollTo(0, 0);
  }
  else if(action === 'committee-msg-cancel'){ COMMITTEE.msgDraft = { id: null, title: '', body: '' }; render(); }
  else if(action === 'committee-msg-delete'){
    if(!isDevUser()) return;
    const m = (COMMITTEE.messages || []).find(x => x.id === el.dataset.mid); if(!m) return;
    if(!confirm('¿Eliminar el mensaje "' + m.title + '"? No se puede deshacer.')) return;
    const { error } = await supabaseClient.from('committee_messages').delete().eq('id', m.id);
    if(error){ cmToast(cmErrText(error)); return; }
    if(COMMITTEE.msgDraft && COMMITTEE.msgDraft.id === m.id) COMMITTEE.msgDraft = { id: null, title: '', body: '' };
    cmToast('Mensaje eliminado.');
    cmLoadAdminData();
  }

  /* miembro */
  else if(action === 'committee-start'){
    const card = (COMMITTEE.myTests || []).find(x => x.id === tid);
    if(card && card.timer_mode && card.timer_mode !== 'none'){
      const extra = card.timer_mode === 'perQuestion' ? ' Cada pregunta se pasa sola al acabarse su tiempo y no se puede volver atrás.' : ' Al llegar a cero se envía solo.';
      if(!confirm('Este test tiene tiempo limitado: ' + cmTimerText(card) + '.' + extra + ' El reloj empieza al aceptar. ¿Empezar ahora?')) return;
    }
    const { data, error } = await supabaseClient.rpc('committee_get_test', { p_test_id: tid });
    if(error){ cmToast(cmErrText(error)); cmLoadMyTests(); return; }
    const now0 = Date.now();
    COMMITTEE.run = { test: data, answers: {}, idx: 0, startedAt: now0, qStartedAt: now0, submitting: false };
    STATE.view = 'committeeRun'; render(); window.scrollTo(0, 0);
    cmStartRunTimer();
  }
  else if(action === 'committee-answer'){
    const r = COMMITTEE.run; if(!r) return;
    r.answers[r.test.questions[r.idx].pos] = el.dataset.letter; render();
  }
  else if(action === 'committee-goto'){
    const r = COMMITTEE.run; if(!r || r.test.timer_mode === 'perQuestion') return;
    r.idx = parseInt(el.dataset.idx, 10) || 0; render();
  }
  else if(action === 'committee-prev'){
    const r = COMMITTEE.run;
    if(r && r.test.timer_mode !== 'perQuestion' && r.idx > 0){ r.idx--; render(); }
  }
  else if(action === 'committee-next'){
    const r = COMMITTEE.run;
    if(r && r.idx < r.test.questions.length - 1){ r.idx++; r.qStartedAt = Date.now(); render(); }
  }
  else if(action === 'committee-exit-run'){
    if(!confirm('¿Salir del test? No se guardará ninguna respuesta y no se gastará el intento.')) return;
    cmStopRunTimer();
    COMMITTEE.run = null;
    STATE.view = 'committee';
    render(); cmLoadMyTests();
  }
  else if(action === 'committee-finish'){
    const r = COMMITTEE.run; if(!r || r.submitting) return;
    const missing = r.test.questions.length - Object.keys(r.answers).length;
    const msg = missing > 0
      ? `Te quedan ${missing} preguntas sin responder (contarán como fallo). ¿Finalizar igualmente?`
      : '¿Finalizar el test? Después no podrás cambiar tus respuestas.';
    if(!confirm(msg)) return;
    await cmSubmitRun(false);
  }
  else if(action === 'committee-review'){
    const { data, error } = await supabaseClient.rpc('committee_get_review', { p_test_id: tid });
    if(error){ cmToast(cmErrText(error)); return; }
    COMMITTEE.result = { title: data.title, score: data.score, total: data.total, review: data.review };
    STATE.view = 'committeeResult'; render(); window.scrollTo(0, 0);
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
    if(!t.published && !confirm('¿Publicar "' + t.title + '" en CTA BAGES? Los árbitros lo verán y podrán hacerlo desde la fecha de apertura.')) return;
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
  else if(action === 'committee-duplicate'){
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    const { data, error } = await supabaseClient.from('committee_test_questions').select('*').eq('test_id', tid).order('pos');
    if(error){ cmToast(cmErrText(error)); return; }
    const nb = cmNewBuilder();
    nb.title = 'Copia de ' + t.title;
    nb.maxAttempts = t.max_attempts;
    nb.timerMode = t.timer_mode || 'none'; nb.minutes = t.time_minutes || nb.minutes; nb.secPerQ = t.seconds_per_question || nb.secPerQ;
    nb.selected = (data || []).map((q, i) => ({
      id: 'dup-' + Date.now() + '-' + i, question: q.question, options: q.options, correct: q.correct,
      rule: q.rule, explanation: q.explanation || '', domain: q.rule ? 'law' : 'glossary', difficulty: 'normal', source: 'user'
    }));
    COMMITTEE.builder = nb;
    STATE.view = 'committeeBuilder'; render(); window.scrollTo(0, 0);
    STATE.toast = 'Test duplicado: cambia lo que quieras y guárdalo.'; render();
  }
  else if(action === 'committee-edit-test'){
    if(!isDevUser()) return;
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    if(t.published){ cmToast('Quita el test de CTA BAGES para poder editar sus preguntas.'); return; }
    const { data, error } = await supabaseClient.from('committee_test_questions').select('*').eq('test_id', tid).order('pos');
    if(error){ cmToast(cmErrText(error)); return; }
    // Si la pregunta sigue en el banco se usa la del banco (para que los filtros la marquen como elegida);
    // el contenido que manda es el guardado en el test.
    const bank = {};
    allQuestions().forEach(q => { bank[questionDedupeKey(q)] = q; });
    const nb = cmNewBuilder();
    nb.editId = t.id;
    nb.title = t.title;
    if(t.month){ nb.season = cmSeasonOfMonth(t.month); nb.mon = String(parseInt(t.month.slice(5, 7), 10)); }
    nb.opens = cmToLocalInput(t.opens_at);
    nb.closes = cmToLocalInput(t.closes_at);
    nb.maxAttempts = t.max_attempts; nb.hadTimerCols = ('timer_mode' in t);
    nb.timerMode = t.timer_mode || 'none'; nb.minutes = t.time_minutes || nb.minutes; nb.secPerQ = t.seconds_per_question || nb.secPerQ;
    nb.selected = (data || []).map((q, i) => {
      const match = bank[questionDedupeKey({ question: q.question, options: q.options })];
      const base = match ? Object.assign({}, match) : { id: 'tq-' + t.id + '-' + i, domain: q.rule ? 'law' : 'glossary', difficulty: 'normal', source: 'user' };
      return Object.assign(base, { question: q.question, options: q.options, correct: q.correct, rule: q.rule, explanation: q.explanation || '' });
    });
    COMMITTEE.builder = nb;
    STATE.view = 'committeeBuilder'; render(); window.scrollTo(0, 0);
  }
  else if(action === 'committee-detail'){ cmOpenDetail(tid); window.scrollTo(0, 0); }
  else if(action === 'committee-save-settings'){
    const s = COMMITTEE.settings; if(!s) return;
    const opens = s.opens ? new Date(s.opens) : null;
    const closes = s.closes ? new Date(s.closes) : null;
    if(!opens){ cmToast('Indica la fecha de apertura.'); return; }
    if(closes && closes <= opens){ cmToast('La fecha de cierre tiene que ser posterior a la de apertura.'); return; }
    const max = Math.max(1, parseInt(s.max, 10) || 1);
    const { error } = await supabaseClient.from('committee_tests').update({ opens_at: opens.toISOString(), closes_at: closes ? closes.toISOString() : null, max_attempts: max }).eq('id', tid);
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = 'Ajustes guardados.'; render();
    await cmLoadAdminData();
    const t = (COMMITTEE.tests || []).find(x => x.id === tid);
    if(t) COMMITTEE.settings = { opens: cmToLocalInput(t.opens_at), closes: cmToLocalInput(t.closes_at), max: String(t.max_attempts) };
    cmRefresh();
  }
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
    const scope = cmRankScope();
    const { rows, testCount } = cmComputeRanking(scope.season, scope.month);
    const out = rows.map((r, i) => ({
      'Posición': r.done ? i + 1 : '', 'Usuario': r.who, 'Nombre': r.full_name || '', 'Email': r.email || '',
      'Tests hechos': r.done, 'Tests del periodo': testCount, 'Aciertos': r.score, 'Preguntas': r.total,
      '% acierto': Math.round(r.pct), 'Tiempo medio (s)': r.avgDur
    }));
    cmExport(out, 'Clasificación', 'comite_clasificacion_' + cmSeasonLabel(scope.season).replace('/', '-') + (scope.month === 'all' ? '' : '_' + scope.month) + '.xlsx');
  }

  /* administrador: creación de test */
  else if(action === 'committee-new'){ COMMITTEE.builder = cmNewBuilder(); STATE.view = 'committeeBuilder'; render(); window.scrollTo(0, 0); }
  else if(action === 'committee-b-cancel'){
    if(b && b.selected.length && !confirm('¿Descartar este test sin guardar?')) return;
    COMMITTEE.builder = null; STATE.view = 'committeeTraining'; render();
  }
  else if(action === 'committee-b-toggle'){
    if(!b) return;
    const qid = el.dataset.qid;
    const idx = b.selected.findIndex(q => q.id === qid);
    if(idx >= 0) b.selected.splice(idx, 1);
    else { const q = allQuestions().find(x => x.id === qid); if(q) b.selected.push(q); }
    render();
  }
  else if(action === 'committee-b-expand'){
    if(!b) return;
    b.expanded[el.dataset.qid] = !b.expanded[el.dataset.qid];
    render();
  }
  else if(action === 'committee-b-move'){
    if(!b) return;
    const idx = b.selected.findIndex(q => q.id === el.dataset.qid);
    const to = idx + parseInt(el.dataset.dir, 10);
    if(idx < 0 || to < 0 || to >= b.selected.length) return;
    [b.selected[idx], b.selected[to]] = [b.selected[to], b.selected[idx]];
    render();
  }
  else if(action === 'committee-b-shuffle'){ if(b){ cmShuffle(b.selected); render(); } }
  else if(action === 'committee-b-clear'){
    if(!b || !b.selected.length) return;
    if(!confirm('¿Quitar todas las preguntas seleccionadas?')) return;
    b.selected = []; render();
  }
  else if(action === 'committee-b-gen-rule'){
    if(!b) return;
    const r = parseInt(el.dataset.rule, 10);
    const i = b.genRules.indexOf(r);
    if(i >= 0) b.genRules.splice(i, 1); else b.genRules.push(r);
    render();
  }
  else if(action === 'committee-b-generate'){
    if(!b) return;
    const n = cmGenerate();
    STATE.toast = n ? 'Añadidas ' + n + ' preguntas.' : 'No quedan preguntas con esos filtros.';
    render();
  }
  else if(action === 'committee-b-random'){
    if(!b) return;
    const taken = new Set(b.selected.map(q => q.id));
    const pool = cmShuffle(cmBankCandidates().filter(q => !taken.has(q.id)));
    const picked = pool.slice(0, 10);
    picked.forEach(q => b.selected.push(q));
    STATE.toast = picked.length ? 'Añadidas ' + picked.length + ' preguntas.' : 'No quedan preguntas con ese filtro.';
    render();
  }
  else if(action === 'committee-b-toggle-custom'){ if(b){ b.showCustom = !b.showCustom; render(); } }
  else if(action === 'committee-b-timer-mode'){ if(b){ b.timerMode = el.dataset.mode; render(); } }
  else if(action === 'committee-b-add-custom'){
    if(!b) return;
    const c = b.custom;
    if(!c.q.trim() || !c.a.trim() || !c.b.trim() || !c.c.trim()){ cmToast('Rellena el enunciado y al menos las respuestas a, b y c.'); return; }
    const rule = c.rule ? parseInt(c.rule, 10) : null;
    b.selected.push({
      id: 'custom-' + Date.now(), question: c.q.trim(), options: [c.a.trim(), c.b.trim(), c.c.trim(), c.d.trim() || 'Ninguna respuesta es correcta.'],
      correct: c.correct, rule, explanation: c.expl.trim(), domain: rule ? 'law' : 'glossary', difficulty: 'normal', source: 'user'
    });
    b.custom = { q: '', a: '', b: '', c: '', d: '', correct: 'a', rule: '', expl: '' };
    b.showCustom = false;
    STATE.toast = 'Pregunta propia añadida al test.';
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
  if(path === 'builder.filterRule' || path === 'builder.filterText' || path === 'builder.filterDiff' || path === 'builder.hideUsed') COMMITTEE.builder.page = 1;
}

function committeeAfterRender(){
  document.querySelectorAll('[data-cm-field]').forEach(el => {
    const evt = (el.tagName === 'SELECT' || ['month', 'datetime-local', 'date', 'number', 'checkbox'].includes(el.type)) ? 'change' : 'input';
    el.addEventListener(evt, () => {
      cmSetPath(el.dataset.cmField, el.type === 'checkbox' ? el.checked : el.value);
      if(el.hasAttribute('data-cm-rerender')) render();
    });
  });
}
