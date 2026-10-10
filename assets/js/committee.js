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
  detailQuestions: null,
  usedMap: null,      // texto normalizado de pregunta -> títulos de los tests donde ya salió
  tab: 'tests',
  rankMonth: 'all',
  rankSeason: null,
  memberReport: null,
  memberSortKey: 'surname',
  memberSortDir: 'asc',
  memberFilters: { last: '', first: '', user: '', email: '', cat: 'all', res: 'all' },
  memberSel: {},
  categories: null,
  catsMissing: false,
  catDraft: { name: '', color: '#FF6A2B' },
  defaults: { maxAttempts: 1, timerMode: 'none', minutes: 20, secPerQ: 45, shuffleMode: 'fixed' },
  newMemberEmail: '',
  detailTestId: null,
  messages: null,     // admin: mensajes del comité (borradores y publicados)
  myMessages: null,   // miembro: mensajes publicados
  msgDraft: { id: null, title: '', body: '' },
  run: null,
  result: null,
  builder: null,
  pv: null,           // estado de la vista previa del test que se está montando
  error: null
};

const CM_LETTERS = ['a', 'b', 'c', 'd'];

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
  if(/category_id|committee_member_categories/.test(m)){
    return 'Falta ejecutar el SQL de categorías (committee-categories.sql) en Supabase.';
  }
  if(/shuffle_mode/.test(m)){
    return 'Falta ejecutar el SQL de orden de preguntas (committee-shuffle.sql) en Supabase.';
  }
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
  if(q.domain === 'fcf') return 'Reglament General FCF';
  return q.rule ? 'Regla ' + q.rule : 'Sin regla';
}
function cmRuleShort(q){ return q.domain === 'glossary' ? 'G' : q.domain === 'fcf' ? 'FCF' : (q.rule ? 'R' + q.rule : '—'); }
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

/* Miembros con nombre y apellidos por separado; si el SQL nuevo aún no está, se usa la función antigua. */
async function cmFetchMembers(){
  const r = await supabaseClient.rpc('committee_admin_members_detail');
  if(!r.error) return r;
  return supabaseClient.rpc('committee_admin_list_members');
}

async function cmLoadAdminData(){
  COMMITTEE.error = null;
  await cmLoadMessages();
  const results = await Promise.all([
    supabaseClient.from('committee_tests').select('*, committee_test_questions(count)').order('created_at', { ascending: false }),
    cmFetchMembers(),
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
  await cmLoadCategories();
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
  if(v === 'committeePreview') return cmPreviewView();
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
  if(auto) appDialogClose();
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
        ${(q.perm || q.options.map((_, k) => k)).map((orig, i) => `<button class="option ${sel === CM_LETTERS[orig] ? 'selected' : ''}" data-action="committee-answer" data-letter="${CM_LETTERS[orig]}"><span class="letter">${CM_LETTERS[i].toUpperCase()}</span><span class="opt-text">${esc(q.options[orig])}</span></button>`).join('')}
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


/* ---------- orden de preguntas y respuestas (igual para todos o mezclado por árbitro) ---------- */
function cmSeededRandom(seedStr){
  let h = 1779033703 ^ String(seedStr).length;
  for(let i = 0; i < seedStr.length; i++){ h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^= h >>> 16) >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cmShuffleWith(arr, rnd){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/* "Ninguna respuesta es correcta" y "Todas las anteriores" se quedan en su sitio (al final). */
function cmAnchoredOption(text){
  return /^\s*(ninguna|ninguno|todas|todos)\b[^.]{0,40}\b(respuesta|anterior|correct)/i.test(String(text || ''));
}
/* Devuelve una copia de las preguntas en orden distinto, con `perm` = índice original de cada opción mostrada.
   Las respuestas se siguen guardando con la letra ORIGINAL (data-letter), así que la corrección no cambia. */
function cmShuffleQuestions(questions, seed){
  const rnd = cmSeededRandom(seed);
  const ordered = cmShuffleWith(questions, rnd);
  return ordered.map(q => {
    const idx = q.options.map((_, i) => i);
    const free = idx.filter(i => !cmAnchoredOption(q.options[i]));
    const mixed = cmShuffleWith(free, rnd);
    const perm = idx.slice();
    free.forEach((pos, k) => { perm[pos] = mixed[k]; });
    return Object.assign({}, q, { perm });
  });
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
function cmOrderOpt(on, mode, icon, title, text){
  return `<button type="button" class="tc-opt ${on ? 'active' : ''}" data-action="committee-b-order-mode" data-mode="${mode}">
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
/* Columnas opcionales del test (temporización y orden). Solo se envían las que hacen falta,
   para no romper si el SQL correspondiente aún no se ha ejecutado. */
function cmBuilderTimerFields(b){
  const o = {};
  if(b.timerMode !== 'none' || b.hadTimerCols){
    o.timer_mode = b.timerMode;
    o.time_minutes = b.timerMode === 'total' ? Math.round(parseInt(b.minutes, 10)) : null;
    o.seconds_per_question = b.timerMode === 'perQuestion' ? Math.round(parseInt(b.secPerQ, 10)) : null;
  }
  if(b.shuffleMode !== 'fixed' || b.hadShuffleCol) o.shuffle_mode = b.shuffleMode;
  return o;
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
        ${t.shuffle_mode === 'shuffled' ? `<li>${ic('shuffle')}<span>Orden mezclado por árbitro</span></li>` : ''}
      </ul>
      ${t.published
        ? `<div class="tx-part"><div class="tx-part-top"><span>Participación</span><b>${people} de ${m}</b></div><div class="tx-part-bar"><i style="width:${pct}%"></i></div></div>`
        : `<div class="tx-draftnote">${ic('lock')} Borrador: los árbitros todavía no lo ven</div>`}
      <div class="tx-actions">
        <button class="btn ${t.published ? 'btn-ghost' : 'btn-primary'} tx-main" data-action="committee-toggle-pub" data-tid="${t.id}">${ic(t.published ? 'lock' : 'play')} ${t.published ? 'Quitar de CTA BAGES' : 'Publicar en CTA BAGES'}</button>
        <button class="tx-icon" data-action="committee-edit-test" data-tid="${t.id}" title="Editar test" aria-label="Editar test">${ic('pencil')}</button>
        <button class="tx-icon" data-action="committee-detail" data-tid="${t.id}" title="Resultados y ajustes" aria-label="Resultados y ajustes">${ic('chart')}</button>
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
function cmNameParts(m){
  let first = String(m.first_name || '').trim(), last = String(m.last_name || '').trim();
  if(!first && !last && m.full_name) first = String(m.full_name).trim(); // función antigua: sin separar
  return { first, last };
}
function cmHasRealName(m){ const p = cmNameParts(m); return !!(p.last || p.first); }
/* "Apellidos, Nombre" */
function cmSurnameName(m){
  const { first, last } = cmNameParts(m);
  if(last && first) return last + ', ' + first;
  return last || first || m.username || m.email || '—';
}
function cmInitials(m){
  const { first, last } = cmNameParts(m);
  const a = (last || first || m.username || m.email || '?').charAt(0);
  const b = last && first ? first.charAt(0) : '';
  return (a + b).toUpperCase();
}
function cmCollate(a, b){ return String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' }); }
function cmPlain(s){ return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function cmFmtDay(iso){ return iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'; }
function cmCatById(id){ return id ? ((COMMITTEE.categories || []).find(c => c.id === id) || null) : null; }

/* Valor por el que se ordena cada columna (null = vacío, siempre va al final). */
function cmSortVal(e, key){
  const p = e.p, m = e.m;
  if(key === 'surname') return (p.last || p.first) ? cmPlain(p.last || p.first) : null;
  if(key === 'name') return (p.first || p.last) ? cmPlain(p.first || p.last) : null;
  if(key === 'user') return m.username ? cmPlain(m.username) : null;
  if(key === 'email') return m.email ? cmPlain(m.email) : null;
  if(key === 'cat'){ const c = cmCatById(m.category_id); return c ? cmPlain(c.name) : null; }
  if(key === 'done') return e.s.done;
  if(key === 'acc') return e.s.pct;
  if(key === 'added') return m.added_at ? Date.parse(m.added_at) : null;
  if(key === 'last') return m.last_sign_in_at ? Date.parse(m.last_sign_in_at) : null;
  return null;
}
function cmCompareMembers(a, b, key, dir){
  const va = cmSortVal(a, key), vb = cmSortVal(b, key);
  const na = va === null || va === '', nb = vb === null || vb === '';
  if(na !== nb) return na ? 1 : -1;
  let r = 0;
  if(!na){ r = (typeof va === 'number' && typeof vb === 'number') ? va - vb : cmCollate(va, vb); }
  if(r !== 0) return dir === 'desc' ? -r : r;
  // desempate siempre por apellidos y nombre
  return cmCollate(a.p.last || a.p.first || a.m.username || a.m.email, b.p.last || b.p.first || b.m.username || b.m.email)
    || cmCollate(a.p.first, b.p.first);
}

/* Lista ya filtrada (por las cajas de cada columna) y ordenada. */
function cmMembersData(){
  const f = COMMITTEE.memberFilters;
  const all = (COMMITTEE.members || []).map(m => ({ m, s: cmMemberStats(m.user_id), p: cmNameParts(m) }));
  const has = (v, q) => { const t = cmPlain(q).trim(); return !t || cmPlain(v).includes(t); };
  const list = all.filter(e => has(e.p.last, f.last) && has(e.p.first, f.first) && has(e.m.username, f.user) && has(e.m.email, f.email)
    && (f.cat === 'all' || (f.cat === 'none' ? !e.m.category_id : e.m.category_id === f.cat))
    && (f.res === 'all' || (f.res === 'with' ? e.s.pct !== null : e.s.pct === null)));
  list.sort((a, b) => cmCompareMembers(a, b, COMMITTEE.memberSortKey, COMMITTEE.memberSortDir));
  const filtered = !!(f.last || f.first || f.user || f.email || f.cat !== 'all' || f.res !== 'all');
  return { all, list, filtered };
}

function cmCatOptions(selectedId, noneLabel){
  return `<option value="">${esc(noneLabel)}</option>` +
    (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}" ${selectedId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function cmMemberRowHtml(e){
  const ic = (n) => shellIcon(n);
  const m = e.m, s = e.s, p = e.p;
  const cat = cmCatById(m.category_id);
  const pct = s.published ? Math.round(s.done / s.published * 100) : 0;
  return `<tr class="${COMMITTEE.memberSel[m.user_id] ? 'sel' : ''}">
      <td class="mb-c-chk"><input type="checkbox" class="mb-chk" data-uid="${m.user_id}" ${COMMITTEE.memberSel[m.user_id] ? 'checked' : ''} aria-label="Seleccionar"></td>
      <td class="mb-c-last"><strong>${esc(p.last || '—')}</strong></td>
      <td class="mb-c-first">${esc(p.first || '—')}</td>
      <td class="mb-c-user">${m.username ? '@' + esc(m.username) : '<span class="mb-none">—</span>'}</td>
      <td class="mb-c-email" title="${esc(m.email || '')}">${esc(m.email || '—')}</td>
      <td class="mb-c-cat">
        <select class="mb-cat" data-uid="${m.user_id}" style="${cat ? '--c:' + esc(cat.color) : ''}" ${COMMITTEE.catsMissing ? 'disabled' : ''} aria-label="Categoría">${cmCatOptions(m.category_id, 'Sin categoría')}</select>
      </td>
      <td class="mb-c-tests"><div class="mb-prog-top">${s.done}/${s.published}</div><div class="mb-prog-bar"><i style="width:${pct}%"></i></div></td>
      <td class="mb-c-acc">${s.pct !== null ? accuracyBadge(s.pct) : '<span class="mb-none">—</span>'}</td>
      <td class="mb-c-date">${cmFmtDay(m.added_at)}</td>
      <td class="mb-c-date">${m.last_sign_in_at ? cmFmtDay(m.last_sign_in_at) : '<span class="mb-none">—</span>'}</td>
      <td class="mb-c-del"><button class="tx-icon danger" data-action="committee-remove-member" data-uid="${m.user_id}" title="Quitar acceso" aria-label="Quitar acceso">${ic('trash')}</button></td>
    </tr>`;
}

function cmMembersBodyHtml(){
  const { all, list } = cmMembersData();
  if(!all.length) return `<tr><td colspan="11" class="mb-empty">Todavía no hay ningún miembro. Añade el primero con su correo.</td></tr>`;
  if(!list.length) return `<tr><td colspan="11" class="mb-empty">Nadie coincide con esos filtros.</td></tr>`;
  return list.map(cmMemberRowHtml).join('');
}
function cmMembersCountText(){
  const { all, list } = cmMembersData();
  return list.length === all.length
    ? `${all.length} ${all.length === 1 ? 'árbitro' : 'árbitros'}`
    : `${list.length} de ${all.length} árbitros`;
}
function cmMembersBulkHtml(){
  const n = Object.keys(COMMITTEE.memberSel).filter(k => COMMITTEE.memberSel[k]).length;
  if(!n) return '';
  const ic = (x) => shellIcon(x);
  return `<div class="mb-bulk">
      <strong>${n} ${n === 1 ? 'seleccionado' : 'seleccionados'}</strong>
      <select id="cm-bulk-cat" ${COMMITTEE.catsMissing ? 'disabled' : ''}>${cmCatOptions('', 'Sin categoría')}</select>
      <button class="btn btn-primary" data-action="committee-members-bulk-assign">${ic('check')} Asignar categoría</button>
      <button class="btn btn-ghost" data-action="committee-members-sel-clear">Deseleccionar</button>
    </div>`;
}

/* Repinta solo la tabla, el contador y la barra de selección (así no se pierde el foco al filtrar). */
function cmMembersRefreshParts(){
  const body = document.getElementById('cm-members-body');
  if(body) body.innerHTML = cmMembersBodyHtml();
  const cnt = document.getElementById('cm-members-count'); if(cnt) cnt.textContent = cmMembersCountText();
  const bulk = document.getElementById('cm-members-bulk');
  if(bulk){
    bulk.innerHTML = cmMembersBulkHtml();
    bulk.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  }
  if(body) body.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  const all = document.getElementById('mb-all');
  if(all){
    const { list } = cmMembersData();
    const sel = list.filter(e => COMMITTEE.memberSel[e.m.user_id]).length;
    all.checked = list.length > 0 && sel === list.length;
    all.indeterminate = sel > 0 && sel < list.length;
  }
}

async function cmSetMembersCategory(uids, catId){
  const { error } = await supabaseClient.rpc('committee_admin_set_members_category', { p_user_ids: uids, p_category_id: catId || null });
  if(error){ cmToast(cmErrText(error)); return false; }
  const set = new Set(uids);
  (COMMITTEE.members || []).forEach(m => { if(set.has(m.user_id)) m.category_id = catId || null; });
  return true;
}

/* Eventos de la tabla (delegados: siguen valiendo aunque se repinte el cuerpo). */
function cmBindMembersTable(){
  const root = document.getElementById('cm-members-table');
  if(!root) return;
  root.addEventListener('input', (ev) => {
    const t = ev.target;
    if(t.classList && t.classList.contains('mb-f') && t.tagName === 'INPUT'){
      COMMITTEE.memberFilters[t.dataset.col] = t.value;
      cmMembersRefreshParts();
    }
  });
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if(!t.classList) return;
    if(t.classList.contains('mb-f') && t.tagName === 'SELECT'){
      COMMITTEE.memberFilters[t.dataset.col] = t.value;
      cmMembersRefreshParts();
    } else if(t.classList.contains('mb-cat')){
      const ok = await cmSetMembersCategory([t.dataset.uid], t.value || null);
      if(!ok) render(); else cmMembersRefreshParts();
    } else if(t.classList.contains('mb-chk')){
      if(t.checked) COMMITTEE.memberSel[t.dataset.uid] = true; else delete COMMITTEE.memberSel[t.dataset.uid];
      cmMembersRefreshParts();
    } else if(t.id === 'mb-all'){
      const { list } = cmMembersData();
      list.forEach(e => { if(t.checked) COMMITTEE.memberSel[e.m.user_id] = true; else delete COMMITTEE.memberSel[e.m.user_id]; });
      cmMembersRefreshParts();
    }
  });
}

function cmMembersTab(){
  const ic = (n) => shellIcon(n);
  const f = COMMITTEE.memberFilters;
  const key = COMMITTEE.memberSortKey, dir = COMMITTEE.memberSortDir;
  const th = (k, label, cls) => `<th class="${cls || ''}"><button class="mb-sortbtn ${key === k ? 'on' : ''}" data-action="committee-member-sort" data-key="${k}">${label}<span class="mb-arrow">${key === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const rep = COMMITTEE.memberReport;
  const repHtml = rep ? `
      ${rep.added ? `<div class="cm-nums-rep ok">${ic('check')}<span>Añadidos <b>${rep.added}</b> ${rep.added === 1 ? 'árbitro' : 'árbitros'}.</span></div>` : ''}
      ${rep.already ? `<div class="cm-nums-rep warn">${ic('flag')}<span><b>${rep.already}</b> ya tenían acceso.</span></div>` : ''}
      ${rep.notFound.length ? `<div class="cm-nums-rep bad">${ic('flag')}<span>No están registrados en we-ref.com: <b>${rep.notFound.map(esc).join(', ')}</b>. Pídeles que se creen una cuenta.</span></div>` : ''}
      ${rep.invalid.length ? `<div class="cm-nums-rep bad">${ic('flag')}<span>No parecen correos válidos: <b>${rep.invalid.map(esc).join(', ')}</b>.</span></div>` : ''}` : '';
  const catFilterOpts = `<option value="all" ${f.cat === 'all' ? 'selected' : ''}>Todas</option><option value="none" ${f.cat === 'none' ? 'selected' : ''}>Sin categoría</option>` +
    (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `
  <div class="tp-layout mb-layout">
    <div class="mb-main">
      <div class="tc-card mb-listcard" id="cm-members-table">
        <div class="tc-card-head"><span class="tc-step">${ic('users')}</span><div><h3>Árbitros con acceso</h3><small id="cm-members-count">${cmMembersCountText()}</small></div>
          <div class="cm-actions">
            <button class="btn btn-ghost" data-action="committee-member-clear-filters">${ic('repeat')} Limpiar filtros</button>
            <button class="btn btn-ghost" data-action="committee-export-members">${ic('download')} Exportar</button>
          </div>
        </div>
        ${COMMITTEE.catsMissing ? `<div class="st-note" style="margin-bottom:12px;">Para usar categorías falta ejecutar el SQL <b>committee-categories.sql</b> en Supabase.</div>` : ''}
        <div id="cm-members-bulk">${cmMembersBulkHtml()}</div>
        <div class="mb-tablewrap">
          <table class="mb-table">
            <thead>
              <tr class="mb-th">
                <th class="mb-c-chk"><input type="checkbox" id="mb-all" aria-label="Seleccionar todos"></th>
                ${th('surname', 'Apellidos')}${th('name', 'Nombre')}${th('user', 'Usuario')}${th('email', 'Correo')}${th('cat', 'Categoría')}${th('done', 'Tests')}${th('acc', 'Acierto')}${th('added', 'Alta')}${th('last', 'Último acceso')}
                <th class="mb-c-del"></th>
              </tr>
              <tr class="mb-filters">
                <th></th>
                <th><input class="mb-f" data-col="last" type="text" value="${esc(f.last)}" placeholder="Filtrar" aria-label="Filtrar por apellidos" autocomplete="off"></th>
                <th><input class="mb-f" data-col="first" type="text" value="${esc(f.first)}" placeholder="Filtrar" aria-label="Filtrar por nombre" autocomplete="off"></th>
                <th><input class="mb-f" data-col="user" type="text" value="${esc(f.user)}" placeholder="Filtrar" aria-label="Filtrar por usuario" autocomplete="off"></th>
                <th><input class="mb-f" data-col="email" type="text" value="${esc(f.email)}" placeholder="Filtrar" aria-label="Filtrar por correo" autocomplete="off"></th>
                <th><select class="mb-f" data-col="cat" aria-label="Filtrar por categoría">${catFilterOpts}</select></th>
                <th colspan="2"><select class="mb-f" data-col="res" aria-label="Filtrar por resultados">
                  <option value="all" ${f.res === 'all' ? 'selected' : ''}>Todos</option>
                  <option value="with" ${f.res === 'with' ? 'selected' : ''}>Con resultados</option>
                  <option value="none" ${f.res === 'none' ? 'selected' : ''}>Sin resultados</option>
                </select></th>
                <th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody id="cm-members-body">${cmMembersBodyHtml()}</tbody>
          </table>
        </div>
      </div>
    </div>
    <aside class="tc-card mb-add">
      <div class="tc-card-head"><span class="tc-step">${ic('userplus')}</span><div><h3>Añadir árbitros</h3><small>Uno o varios correos</small></div></div>
      <textarea id="cm-new-member" data-cm-field="newMemberEmail" rows="4" placeholder="correo@ejemplo.com&#10;otro@ejemplo.com" style="margin:0;">${esc(COMMITTEE.newMemberEmail)}</textarea>
      <button class="btn btn-primary" style="width:100%; margin-top:12px; display:inline-flex; align-items:center; justify-content:center; gap:8px;" data-action="committee-add-member">${ic('userplus')} Añadir</button>
      ${repHtml}
      <div class="st-note" style="margin-top:12px;">Puedes pegar varios correos separados por comas, espacios o saltos de línea. Cada persona tiene que haberse registrado antes en we-ref.com con ese mismo correo.</div>
    </aside>
  </div>`;
}

/* ----- Configuración del módulo ----- */
const CM_CAT_COLORS = ['#FF6A2B', '#2A6FDB', '#1F9D55', '#8E44AD', '#E0A100', '#D64545', '#0E9AA7', '#6B7280'];
const CM_CAT_SUGGESTIONS = ['Árbitro de categoría', 'Situación especial', 'Primer año'];

async function cmLoadCategories(){
  try{
    const r = await supabaseClient.from('committee_member_categories').select('*').order('position', { ascending: true }).order('name', { ascending: true });
    if(r.error){ COMMITTEE.categories = []; COMMITTEE.catsMissing = true; }
    else { COMMITTEE.categories = r.data || []; COMMITTEE.catsMissing = false; }
  }catch(e){ COMMITTEE.categories = []; COMMITTEE.catsMissing = true; }
  try{
    const d = await supabaseClient.from('committee_settings').select('defaults').eq('id', 1).maybeSingle();
    if(!d.error && d.data && d.data.defaults && typeof d.data.defaults === 'object') Object.assign(COMMITTEE.defaults, d.data.defaults);
  }catch(e){}
}

function cmSettingsTab(){
  const ic = (n) => shellIcon(n);
  const cats = COMMITTEE.categories || [];
  const counts = {};
  (COMMITTEE.members || []).forEach(m => { if(m.category_id) counts[m.category_id] = (counts[m.category_id] || 0) + 1; });
  const dr = COMMITTEE.catDraft;
  const d = COMMITTEE.defaults;
  const rows = cats.map(c => `<div class="cs-cat">
      <input type="color" class="cs-color" data-cid="${esc(c.id)}" value="${esc(c.color)}" aria-label="Color">
      <input type="text" class="cs-name" data-cid="${esc(c.id)}" value="${esc(c.name)}" maxlength="60" aria-label="Nombre de la categoría">
      <span class="cs-count">${counts[c.id] || 0} ${(counts[c.id] || 0) === 1 ? 'árbitro' : 'árbitros'}</span>
      <button class="tx-icon danger" data-action="committee-cat-delete" data-cid="${esc(c.id)}" title="Eliminar categoría" aria-label="Eliminar categoría">${ic('trash')}</button>
    </div>`).join('');
  const palette = CM_CAT_COLORS.map(col => `<button type="button" class="cs-sw ${dr.color === col ? 'on' : ''}" style="--c:${col}" data-action="committee-cat-color" data-color="${col}" aria-label="Color ${col}"></button>`).join('');
  const sugg = !cats.length ? `<div class="cs-sugg"><span>Sugerencias:</span>${CM_CAT_SUGGESTIONS.map(s => `<button type="button" class="tx-filter" data-action="committee-cat-suggest" data-name="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '';
  const timerFields = d.timerMode === 'total'
    ? `<div><label for="cm-d-min">Minutos</label><input type="number" id="cm-d-min" min="1" max="600" data-cm-field="defaults.minutes" value="${esc(String(d.minutes))}"></div>`
    : (d.timerMode === 'perQuestion'
      ? `<div><label for="cm-d-sec">Segundos por pregunta</label><input type="number" id="cm-d-sec" min="5" max="3600" data-cm-field="defaults.secPerQ" value="${esc(String(d.secPerQ))}"></div>` : '');
  return `
  <div class="tp-layout cs-layout" id="cm-settings">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('users')}</span><div><h3>Categorías de árbitros</h3><small>Para clasificar a los miembros: categoría, situación especial, primer año…</small></div></div>
      ${COMMITTEE.catsMissing ? `<div class="st-note" style="margin-bottom:12px;">Para crear categorías falta ejecutar el SQL <b>committee-categories.sql</b> en Supabase.</div>` : ''}
      ${rows ? `<div class="cs-list">${rows}</div>` : `<div class="ac-empty" style="padding:22px 14px;">${ic('users')}<strong>Todavía no hay categorías</strong><span>Crea la primera abajo y asígnala desde la tabla de Miembros.</span></div>`}
      <div class="cs-add">
        <label for="cm-cat-new" style="margin-top:0;">Nueva categoría</label>
        <div class="cs-add-row">
          <input type="text" id="cm-cat-new" data-cm-field="catDraft.name" value="${esc(dr.name)}" maxlength="60" placeholder="Ej.: Primer año" autocomplete="off">
          <button class="btn btn-primary" data-action="committee-cat-add" ${COMMITTEE.catsMissing ? 'disabled' : ''}>${ic('plus')} Añadir</button>
        </div>
        <div class="cs-palette">${palette}</div>
        ${sugg}
      </div>
    </div>

    <aside class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('settings')}</span><div><h3>Nuevos tests</h3><small>Valores por defecto al crear un test</small></div></div>
      <label for="cm-d-att" style="margin-top:0;">Intentos permitidos</label>
      <input type="number" id="cm-d-att" min="1" max="20" data-cm-field="defaults.maxAttempts" value="${esc(String(d.maxAttempts))}">
      <label for="cm-d-timer">Temporización</label>
      <select id="cm-d-timer" data-cm-field="defaults.timerMode" data-cm-rerender>
        <option value="none" ${d.timerMode === 'none' ? 'selected' : ''}>Sin límite</option>
        <option value="total" ${d.timerMode === 'total' ? 'selected' : ''}>Tiempo total</option>
        <option value="perQuestion" ${d.timerMode === 'perQuestion' ? 'selected' : ''}>Por pregunta</option>
      </select>
      ${timerFields}
      <label for="cm-d-order">Orden de preguntas y respuestas</label>
      <select id="cm-d-order" data-cm-field="defaults.shuffleMode">
        <option value="fixed" ${d.shuffleMode !== 'shuffled' ? 'selected' : ''}>Igual para todos</option>
        <option value="shuffled" ${d.shuffleMode === 'shuffled' ? 'selected' : ''}>Mezclado para cada árbitro</option>
      </select>
      <button class="btn btn-primary" style="width:100%; margin-top:16px; display:inline-flex; align-items:center; justify-content:center; gap:8px;" data-action="committee-defaults-save">${ic('check')} Guardar valores</button>
      <div class="st-note" style="margin-top:12px;">Se aplican cuando pulsas "Nuevo test". Siempre los puedes cambiar dentro de cada test.</div>
    </aside>
  </div>`;
}

/* Edición directa de nombre y color de las categorías (eventos delegados). */
function cmBindSettings(){
  const root = document.getElementById('cm-settings');
  if(!root) return;
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if(!t.classList || !t.dataset.cid) return;
    const c = (COMMITTEE.categories || []).find(x => x.id === t.dataset.cid); if(!c) return;
    const patch = {};
    if(t.classList.contains('cs-name')){
      const v = t.value.trim();
      if(!v){ cmToast('La categoría necesita un nombre.'); return; }
      if(v === c.name) return;
      patch.name = v;
    } else if(t.classList.contains('cs-color')){
      if(t.value.toLowerCase() === String(c.color).toLowerCase()) return;
      patch.color = t.value;
    } else return;
    const { error } = await supabaseClient.from('committee_member_categories').update(patch).eq('id', c.id);
    if(error){
      cmToast(/duplicate|23505/i.test((error.message || '') + (error.code || '')) ? 'Ya existe una categoría con ese nombre.' : cmErrText(error));
      await cmLoadCategories(); cmRefresh();
      return;
    }
    Object.assign(c, patch);
    STATE.toast = 'Categoría actualizada.'; render();
  });
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
  const tab = ['tests', 'messages', 'members', 'ranking', 'stats', 'settings'].includes(COMMITTEE.tab) ? COMMITTEE.tab : 'tests';
  const nTests = (COMMITTEE.tests || []).length;
  const nMembers = (COMMITTEE.members || []).length;
  const tabs = [['tests', 'Tests', 'book', nTests], ['messages', 'Mensajes', 'message', (COMMITTEE.messages || []).length], ['members', 'Miembros', 'users', nMembers], ['ranking', 'Clasificación', 'trophy', null], ['stats', 'Puntos débiles', 'target', null], ['settings', 'Configuración', 'settings', null]];
  let content;
  if(COMMITTEE.tests === null) content = `<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  else if(tab === 'members') content = cmMembersTab();
  else if(tab === 'ranking') content = cmRankingTab();
  else if(tab === 'stats') content = cmStatsTab();
  else if(tab === 'settings') content = cmSettingsTab();
  else if(tab === 'messages') content = cmMessagesTab();
  else content = cmTestsTab();
  const s = cmAdminStats();
  const hero = cmHero('Administración · CTA BAGES', 'Panel de Formación',
    'Prepara aquí los tests y los árbitros, en privado. Cuando esté listo, publícalo y aparecerá en CTA BAGES.',
    `<button class="btn btn-yellow" data-action="committee-new">${ic('plus')} Nuevo test</button>`,
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
  COMMITTEE.detailQuestions = null;
  const t = (COMMITTEE.tests || []).find(x => x.id === tid);
  STATE.view = 'committeeTestDetail';
  render();
  const [st, qs] = await Promise.all([
    supabaseClient.rpc('committee_admin_question_stats', { p_test_id: tid }),
    supabaseClient.from('committee_test_questions').select('*').eq('test_id', tid).order('pos')
  ]);
  COMMITTEE.qStats = st.error ? [] : (st.data || []);
  COMMITTEE.detailQuestions = qs.error ? [] : (qs.data || []);
  if(st.error) STATE.toast = cmErrText(st.error);
  cmRefresh();
}

function cmTestDetailView(){
  const t = (COMMITTEE.tests || []).find(x => x.id === COMMITTEE.detailTestId);
  if(!t) return '<button class="backbtn" data-action="committee-training">&larr; Volver</button><div class="empty-state">Test no encontrado.</div>';
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
    <button class="btn btn-primary" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-edit-test" data-tid="${t.id}">${cmIc('pencil')} Editar test</button>
    <button class="btn btn-secondary" style="margin-left:auto; display:inline-flex; align-items:center; gap:8px;" data-action="committee-export-test" data-tid="${t.id}">${cmIc('download')} Exportar a Excel</button>
  </div>
  <div class="home-kpis" style="margin-bottom:18px;">
    <div class="kpi"><div class="kpi-top">${cmIc('users')} Participantes</div><div class="kpi-val">${doneIds.size}<small> / ${(COMMITTEE.members || []).length}</small></div><div class="kpi-sub">${t.question_count} preguntas</div></div>
    <div class="kpi"><div class="kpi-top">${cmIc('target')} Acierto medio</div><div class="kpi-val" ${avgPct !== null ? `style="color:${scoreColor(avgPct)};"` : ''}>${avgPct !== null ? avgPct + '<small>%</small>' : '—'}</div><div class="kpi-sub">de todos los intentos</div></div>
    <div class="kpi"><div class="kpi-top">${cmIc('clock')} Tiempo medio</div><div class="kpi-val">${cmFmtDur(avgDur)}</div><div class="kpi-sub">por intento</div></div>
    <div class="kpi"><div class="kpi-top">${cmIc('repeat')} Pendientes</div><div class="kpi-val">${pending.length}</div><div class="kpi-sub">aún sin hacerlo</div></div>
  </div>

  <div class="cm-card" style="overflow-x:auto;">
    <div class="cm-sec-title">Resultados</div>
    ${attempts.length ? `<table class="stat-table"><tr><th>Árbitro</th><th>Intento</th><th>Puntos</th><th>Acierto</th><th>Tiempo</th><th>Fecha</th></tr>${rows}</table>` : '<div style="font-size:13.5px; color:var(--muted);">Nadie ha hecho este test todavía.</div>'}
  </div>
  ${pending.length ? `<div class="cm-card"><div class="cm-sec-title">Pendientes de hacerlo (${pending.length})</div><div class="cm-chips">${pending.map(m => `<span class="cm-chip soft">${esc(cmWho(m))}</span>`).join('')}</div></div>` : ''}
  <div class="cm-card">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
      <div class="cm-sec-title" style="margin:0;">Preguntas del test${COMMITTEE.detailQuestions ? ' (' + COMMITTEE.detailQuestions.length + ')' : ''}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-ghost" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-dq-toggle-all">${cmIc('eye')} <span id="cm-dq-all-label">Ver todas</span></button>
        <button class="btn btn-ghost" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-edit-test" data-tid="${t.id}">${cmIc('pencil')} Modificar preguntas</button>
      </div>
    </div>
    ${t.published ? `<div class="st-note" style="margin-bottom:12px;">Este test está publicado: puedes corregirlo igualmente. Los cambios se ven al momento y, si cambias una respuesta correcta, podrás recalcular los resultados ya hechos.</div>` : ''}
    ${COMMITTEE.detailQuestions === null ? '<div style="font-size:13.5px; color:var(--muted);">Cargando...</div>' : (COMMITTEE.detailQuestions.length ? COMMITTEE.detailQuestions.map(q => `
      <details class="cm-dq">
        <summary><span class="mono cm-dq-n">${q.pos}.</span><span class="cm-dq-t">${esc(q.question)}</span><span class="cm-chip soft" style="padding:1px 8px; font-size:11px;">${q.rule ? 'R' + q.rule : '—'}</span></summary>
        ${cmQuestionDetail({ options: q.options || [], correct: q.correct, explanation: q.explanation })}
      </details>`).join('') : '<div style="font-size:13.5px; color:var(--muted);">Este test no tiene preguntas.</div>')}
  </div>
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
    editId: null, title: '', season, mon, opens: '', closes: '', maxAttempts: Math.max(1, parseInt(COMMITTEE.defaults.maxAttempts, 10) || 1),
    timerMode: COMMITTEE.defaults.timerMode || 'none', minutes: COMMITTEE.defaults.minutes || 20, secPerQ: COMMITTEE.defaults.secPerQ || 45, hadTimerCols: false,
    shuffleMode: COMMITTEE.defaults.shuffleMode === 'shuffled' ? 'shuffled' : 'fixed', hadShuffleCol: false,
    published: false, attemptCount: 0, orig: null, replacingId: null,
    selected: [], expanded: {},
    numsText: '', numsReport: null,
    saving: false
  };
}


function cmQuestionDetail(q){
  return `<div style="margin:8px 0 10px;">
    ${q.options.map((o, i) => `<div class="option ${CM_LETTERS[i] === q.correct ? 'correct' : ''}" style="cursor:default; padding:8px 12px; margin-bottom:6px; font-size:13px;"><span class="letter">${CM_LETTERS[i]})</span>${esc(o)}</div>`).join('')}
    ${q.explanation ? `<div style="margin-top:6px; padding:8px 12px; background:#FBF1F1; border-radius:8px; font-size:12.5px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
  </div>`;
}

function cmComposition(selected){
  const by = {};
  selected.forEach(q => { const k = q.domain === 'glossary' ? 'G' : q.domain === 'fcf' ? 'FCF' : (q.rule ? 'R' + q.rule : '—'); by[k] = (by[k] || 0) + 1; });
  const keys = Object.keys(by).sort((a, b) => (parseInt(a.slice(1), 10) || 99) - (parseInt(b.slice(1), 10) || 99));
  return keys.map(k => `<span class="cm-chip soft">${k} × ${by[k]}</span>`).join('');
}

/* ---------- números de pregunta (los mismos que se ven en Base de datos con #) ---------- */
function cmQuestionNumbers(){
  const list = allQuestionsAdmin();
  const numOf = {};
  list.forEach((q, i) => { const n = questionNumber(q, i + 1); if(n) numOf[q.id] = n; });
  return { list, numOf };
}
/* "12, 15-18  40 41" -> [12, 15, 16, 17, 18, 40, 41] (en el orden escrito, sin repetir) */
function cmParseNumbers(text){
  const out = [], seen = new Set();
  const push = (n) => { if(n > 0 && !seen.has(n)){ seen.add(n); out.push(n); } };
  const re = /(\d+)\s*(?:[-–—]|\.\.)\s*(\d+)|(\d+)/g;
  let m;
  while((m = re.exec(String(text || ''))) !== null){
    if(m[3] !== undefined){ push(parseInt(m[3], 10)); continue; }
    let a = parseInt(m[1], 10), z = parseInt(m[2], 10);
    if(a > z){ const t = a; a = z; z = t; }
    for(let n = a; n <= z && n - a < 300; n++) push(n);
  }
  return out;
}
function cmAddByNumbers(b){
  const byNum = questionsByNumber();
  const nums = cmParseNumbers(b.numsText);
  const inTest = new Set(b.selected.map(q => q.id));
  const rep = { added: 0, already: [], missing: [] };
  nums.forEach(n => {
    const q = byNum[n];
    if(!q){ rep.missing.push(n); return; }
    if(inTest.has(q.id)){ rep.already.push(n); return; }
    b.selected.push(q); inTest.add(q.id); rep.added++;
  });
  rep.total = nums.length;
  b.numsReport = rep;
  return rep;
}
/* Estado de cada número escrito: se calcula en directo, sin tocar el test. */
function cmNumsStatus(b){
  const nums = cmParseNumbers(b.numsText);
  const byNum = questionsByNumber();
  const inTest = new Set(b.selected.map(q => q.id));
  const items = nums.map(n => {
    const q = byNum[n];
    return { n, q, state: !q ? 'missing' : (inTest.has(q.id) ? 'already' : 'new') };
  });
  return { items, ok: items.filter(i => i.state === 'new').length };
}
function cmNumsAddLabel(b){
  const { ok } = cmNumsStatus(b);
  return ok ? `Añadir ${ok} ${ok === 1 ? 'pregunta' : 'preguntas'} al test` : 'Añadir al test';
}
function cmNumsPreviewHtml(b){
  const { items, ok } = cmNumsStatus(b);
  if(!items.length) return '';
  const already = items.filter(i => i.state === 'already').length;
  const missing = items.filter(i => i.state === 'missing').length;
  const LIMIT = 60;
  const cards = items.slice(0, LIMIT).map((it, idx) => {
    if(it.state === 'missing'){
      return `<div class="cm-pv missing"><div class="cm-pv-head"><span class="cm-qnum">#${it.n}</span><span class="cm-pv-state bad">No existe o se eliminó</span></div></div>`;
    }
    const q = it.q;
    return `<div class="cm-pv ${it.state}">
      <div class="cm-pv-head">
        <span class="cm-pv-pos">${idx + 1}</span><span class="cm-qnum">#${it.n}</span>
        <span class="cm-chip soft" style="padding:1px 8px; font-size:11px;">${esc(cmRuleLabel(q))}</span>
        ${q.difficulty === 'hard' ? '<span class="cm-chip soft" style="padding:1px 8px; font-size:11px;">Difícil</span>' : ''}
        ${it.state === 'already' ? '<span class="cm-pv-state warn">Ya está en el test</span>' : ''}
      </div>
      <div class="cm-pv-q">${esc(q.question)}</div>
      ${cmQuestionDetail(q)}
    </div>`;
  }).join('');
  return `<div class="cm-pv-wrap">
    <div class="cm-pv-title">${cmIc('eye')} Previsualización · ${ok} ${ok === 1 ? 'nueva' : 'nuevas'}${already ? ` · ${already} ya en el test` : ''}${missing ? ` · ${missing} sin encontrar` : ''}</div>
    ${cards}
    ${items.length > LIMIT ? `<div style="font-size:12.5px; color:var(--muted); text-align:center;">Se muestran las primeras ${LIMIT} de ${items.length}; se añadirán todas.</div>` : ''}
  </div>`;
}
function cmNumsReportHtml(rep){
  if(!rep) return '';
  if(!rep.total) return `<div class="cm-nums-rep warn">${cmIc('flag')}<span>No he encontrado ningún número. Escríbelos separados por comas, espacios o saltos de línea.</span></div>`;
  const rows = [];
  if(rep.added) rows.push(`<div class="cm-nums-rep ok">${cmIc('check')}<span>Añadidas <b>${rep.added}</b> ${rep.added === 1 ? 'pregunta' : 'preguntas'} al test.</span></div>`);
  if(rep.already.length) rows.push(`<div class="cm-nums-rep warn">${cmIc('flag')}<span>Ya estaban en el test: <b>${rep.already.join(', ')}</b>.</span></div>`);
  if(rep.missing.length) rows.push(`<div class="cm-nums-rep bad">${cmIc('flag')}<span>No existen (o se eliminaron): <b>${rep.missing.join(', ')}</b>.</span></div>`);
  return rows.join('');
}

function cmBuilderView(){
  const b = COMMITTEE.builder;
  if(!b) return cmAdminView();
  qnumSync();
  const ic = (n) => shellIcon(n);
  const numOf = cmQuestionNumbers().numOf;
  const numTag = (q) => numOf[q.id] ? `<span class="cm-qnum" title="Número en la base de datos">#${numOf[q.id]}</span>` : '';
  const curSeason = parseInt(cmCurrentSeason(), 10);
  const seasonSet = new Set([-1, 0, 1, 2].map(d => String(curSeason + d)));
  if(b.season) seasonSet.add(String(b.season));
  const seasonOpts = Array.from(seasonSet).sort();
  const n = b.selected.length;
  const allOpen = n > 0 && b.selected.every(q => b.expanded[q.id]);
  const monthName = CM_MONTHS[parseInt(b.mon, 10) - 1] || '';
  const monthCap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const timerLabel = cmTimerText({ timer_mode: b.timerMode, time_minutes: parseInt(b.minutes, 10) || null, seconds_per_question: parseInt(b.secPerQ, 10) || null });
  const fmt = (v) => v ? cmFmtDate(new Date(v).toISOString()) : '';
  const missing = [];
  if(!b.title.trim()) missing.push('el título');
  if(!n) missing.push('las preguntas');

  const selHtml = b.selected.map((q, i) => {
    const open = !!b.expanded[q.id];
    return `<div class="cm-sel-item">
      <div class="cm-sel-row">
        <span class="cm-sel-num">${i + 1}.</span>
        <span style="flex:1;">${esc(q.question)}<div style="margin-top:3px;">${numTag(q)} <span class="cm-chip soft" style="padding:1px 8px; font-size:11px;">${cmRuleShort(q)}</span></div></span>
        <span class="cm-sel-tools">
          <button class="icon-btn" title="Subir" data-action="committee-b-move" data-qid="${esc(q.id)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>${ic('up')}</button>
          <button class="icon-btn" title="Bajar" data-action="committee-b-move" data-qid="${esc(q.id)}" data-dir="1" ${i === n - 1 ? 'disabled' : ''}>${ic('down')}</button>
          <button class="icon-btn" title="${open ? 'Ocultar respuestas' : 'Ver respuestas'}" data-action="committee-b-expand" data-qid="${esc(q.id)}">${ic('eye')}</button>
          <button class="icon-btn" title="Sustituir por otra pregunta (por su número)" data-action="committee-b-repl-open" data-qid="${esc(q.id)}">${ic('repeat')}</button>
          <button class="icon-btn" title="Quitar" data-action="committee-b-toggle" data-qid="${esc(q.id)}">${ic('trash')}</button>
        </span>
      </div>
      ${open ? `<div style="padding-left:32px;">${cmQuestionDetail(q)}</div>` : ''}
      ${b.replacingId === q.id ? `<div class="cm-repl">
        <label for="cm-b-repl-n">Sustituir por la pregunta nº</label>
        <input type="number" id="cm-b-repl-n" min="1" placeholder="#">
        <button class="btn btn-primary" data-action="committee-b-repl-do" data-qid="${esc(q.id)}">Sustituir</button>
        <button class="btn btn-ghost" data-action="committee-b-repl-cancel">Cancelar</button>
        <small>Se queda en la misma posición, así que los resultados anteriores siguen cuadrando.</small>
      </div>` : ''}
    </div>`;
  }).join('');

  return `
  <button class="backbtn" data-action="committee-b-cancel">&larr; Cancelar</button>
  <section class="tc-hero">
    <div>
      <div class="home-eyebrow">Panel de Formación · CTA BAGES</div>
      <h1>${b.editId ? 'Editar test' : 'Nuevo test'}</h1>
      <p>Prepáralo en borrador, previsualízalo tal como lo verán los árbitros y publícalo en CTA BAGES cuando esté listo.</p>
    </div>
    <div class="tc-hero-stat"><b>${n}</b><span>preguntas<br>en el test</span></div>
  </section>

  <div class="tc-layout">
    <div class="tc-main">
      ${b.published ? `<div class="cm-warn-banner">${ic('flag')}<div><strong>Este test está publicado</strong><span>Los árbitros verán los cambios al momento.${b.attemptCount ? ` Ya hay ${b.attemptCount} ${b.attemptCount === 1 ? 'intento hecho' : 'intentos hechos'}: si cambias una respuesta correcta, al guardar podrás recalcular sus resultados.` : ''} Para no descuadrar nada, usa <b>Sustituir</b> en una pregunta (mantiene su posición) en vez de quitarla y añadir otra.</span></div></div>` : ''}
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">1</span><div><h3>Datos del test</h3><small>El nombre que verán los árbitros</small></div></div>
        <label for="cm-b-title" style="margin-top:0;">Título</label>
        <input type="text" id="cm-b-title" data-cm-field="builder.title" value="${esc(b.title)}" placeholder="Ej.: Test de octubre" maxlength="120">
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">2</span><div><h3>Temporada y mes</h3><small>Cada temporada tiene su propia clasificación</small></div></div>
        <div class="cm-fields">
          <div><label for="cm-b-season" style="margin-top:0;">Temporada</label>
            <select id="cm-b-season" data-cm-field="builder.season" data-cm-rerender>
              ${seasonOpts.map(s => `<option value="${s}" ${String(b.season) === s ? 'selected' : ''}>${cmSeasonLabel(s)}</option>`).join('')}
            </select></div>
          <div><label for="cm-b-mon" style="margin-top:0;">Mes</label>
            <select id="cm-b-mon" data-cm-field="builder.mon" data-cm-rerender>
              ${CM_SEASON_ORDER.map(m => `<option value="${m}" ${String(b.mon) === String(m) ? 'selected' : ''}>${CM_MONTHS[m - 1].charAt(0).toUpperCase() + CM_MONTHS[m - 1].slice(1)}</option>`).join('')}
            </select></div>
        </div>
        <div class="cm-season-note">${ic('trophy')}<span>Cuenta para la clasificación de la temporada <b>${cmSeasonLabel(b.season)}</b>, mes de <b>${monthName} de ${cmBuilderMonth(b).slice(0, 4)}</b>.</span></div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">3</span><div><h3>Fechas e intentos</h3><small>Cuándo está disponible y cuántas veces se puede hacer</small></div></div>
        <div class="cm-fields">
          <div><label for="cm-b-opens" style="margin-top:0;">Abre <small class="cm-opt">(vacío = al publicar)</small></label><input type="datetime-local" id="cm-b-opens" data-cm-field="builder.opens" value="${esc(b.opens)}"></div>
          <div><label for="cm-b-closes" style="margin-top:0;">Cierra <small class="cm-opt">(opcional)</small></label><input type="datetime-local" id="cm-b-closes" data-cm-field="builder.closes" value="${esc(b.closes)}"></div>
          <div><label for="cm-b-attempts">Intentos permitidos</label><input type="number" id="cm-b-attempts" min="1" max="20" data-cm-field="builder.maxAttempts" value="${esc(String(b.maxAttempts))}"></div>
        </div>
        <div class="cm-season-note">${ic('lock')}<span>Las respuestas correctas se enseñan a los árbitros cuando el test cierra. Si no pones fecha de cierre, se enseñan al terminar.</span></div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">4</span><div><h3>Temporización</h3><small>Controla el ritmo del test</small></div></div>
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
        <div class="cm-season-note">${ic('clock')}<span>${esc(cmBuilderTimerSummary(b))}</span></div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">5</span><div><h3>Orden de preguntas y respuestas</h3><small>Para que no se puedan ayudar entre ellos</small></div></div>
        <div class="tc-opts two">
          ${cmOrderOpt(b.shuffleMode !== 'shuffled', 'fixed', 'list', 'Igual para todos', 'Todos los árbitros ven las preguntas y las respuestas A, B, C, D en el mismo orden.')}
          ${cmOrderOpt(b.shuffleMode === 'shuffled', 'shuffled', 'shuffle', 'Mezclado para cada árbitro', 'Cada árbitro recibe las preguntas y las respuestas en un orden distinto.')}
        </div>
        <div class="cm-season-note">${ic(b.shuffleMode === 'shuffled' ? 'shuffle' : 'list')}<span>${b.shuffleMode === 'shuffled'
          ? 'El orden de las preguntas y de las respuestas es distinto para cada árbitro. "Ninguna respuesta es correcta" y "Todas las anteriores" se quedan siempre al final. La corrección no cambia.'
          : 'Todos verán exactamente el mismo orden que ves en "Preguntas del test".'}</span></div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">6</span><div><h3>Añadir preguntas</h3><small>Con los números de la Base de datos (los que ves con #)</small></div></div>
        <div style="font-size:13px; color:var(--muted); margin-bottom:10px;">Sepáralos con comas, espacios o saltos de línea; también vale un rango (por ejemplo <b>120-125</b>). Se añaden en el orden que los escribas y debajo ves cada pregunta con sus respuestas antes de añadirla.</div>
        <textarea id="cm-b-nums" data-cm-field="builder.numsText" rows="3" placeholder="Ej.: 12, 45, 87, 120-125, 301" style="margin:0;">${esc(b.numsText)}</textarea>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:12px;">
          <button class="btn btn-primary" style="display:inline-flex; align-items:center; gap:8px;" data-action="committee-b-add-numbers">${ic('plus')} <span id="cm-b-add-label">${cmNumsAddLabel(b)}</span></button>
          <span style="font-size:12.5px; color:var(--muted);">El número de cada pregunta es único y no cambia nunca.</span>
        </div>
        ${cmNumsReportHtml(b.numsReport)}
        <div id="cm-nums-preview">${cmNumsPreviewHtml(b)}</div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">7</span><div><h3>Preguntas del test (${n})</h3><small>Ordénalas, revísalas o quítalas</small></div>
          <div class="cm-actions">
            <button class="btn btn-ghost" style="padding:6px 12px; display:inline-flex; align-items:center; gap:7px;" data-action="committee-b-expand-all" ${n ? '' : 'disabled'}>${cmIc('eye')} ${allOpen ? 'Ocultar todas' : 'Ver todas'}</button>
            <button class="btn btn-ghost" style="padding:6px 11px;" data-action="committee-b-shuffle" ${n < 2 ? 'disabled' : ''} title="Mezclar el orden">${cmIc('shuffle')}</button>
            <button class="btn btn-ghost btn-danger-soft" style="padding:6px 11px;" data-action="committee-b-clear" ${n ? '' : 'disabled'} title="Vaciar">${cmIc('trash')}</button>
          </div>
        </div>
        ${n ? `<div class="cm-chips" style="margin-bottom:8px;">${cmComposition(b.selected)}</div>` : ''}
        ${selHtml || `<div class="ac-empty" style="margin:0;">${ic('list')}<strong>Todavía no hay preguntas</strong><span>Escribe arriba los números de las preguntas que quieras incluir.</span></div>`}
      </div>
    </div>

    <aside class="tc-side">
      <div class="tc-summary">
        <div class="tc-summary-title">Resumen del test</div>
        <div class="tc-sum-row">${ic('file')}<span>Título</span><b>${b.title.trim() ? esc(b.title.trim()) : '—'}</b></div>
        <div class="tc-sum-row">${ic('trophy')}<span>Temporada</span><b>${cmSeasonLabel(b.season)} · ${monthCap}</b></div>
        <div class="tc-sum-row">${ic('book')}<span>Preguntas</span><b>${n}</b></div>
        <div class="tc-sum-row">${ic('clock')}<span>Tiempo</span><b>${esc(timerLabel)}</b></div>
        <div class="tc-sum-row">${ic(b.shuffleMode === 'shuffled' ? 'shuffle' : 'list')}<span>Orden</span><b>${b.shuffleMode === 'shuffled' ? 'Mezclado' : 'Igual para todos'}</b></div>
        <div class="tc-sum-row">${ic('repeat')}<span>Intentos</span><b>${esc(String(parseInt(b.maxAttempts, 10) || 1))}</b></div>
        <div class="tc-sum-row">${ic('calendar')}<span>Abre</span><b>${b.opens ? esc(fmt(b.opens)) : 'Al publicar'}</b></div>
        <div class="tc-sum-row">${ic('lock')}<span>Cierra</span><b>${b.closes ? esc(fmt(b.closes)) : 'Sin cierre'}</b></div>
        ${missing.length ? `<div class="cm-sum-warn">${ic('flag')}<span>Falta ${missing.join(' y ')}.</span></div>` : ''}
        <button class="btn btn-glass tc-go" data-action="committee-b-preview" ${n ? '' : 'disabled'}>${ic('eye')} Previsualizar test</button>
        <button class="btn btn-yellow tc-go cm-save-go" data-action="committee-b-save" ${b.saving ? 'disabled' : ''}>${ic('file')} ${b.saving ? 'Guardando...' : (b.editId ? 'Guardar cambios' : 'Guardar como borrador')}</button>
        <div class="cm-sum-note">${b.editId ? (b.published ? 'Test publicado: los cambios se aplican al momento.' : 'Sigue en borrador: los árbitros no lo ven hasta que lo publiques.') : 'Se guarda como borrador: los árbitros no lo ven hasta que lo publiques.'}</div>
      </div>
    </aside>
  </div>`;
}

/* ---------- vista previa del test (como lo verá el árbitro; no guarda nada) ---------- */
function cmPreviewView(){
  const b = COMMITTEE.builder, pv = COMMITTEE.pv;
  if(!b) return cmAdminView();
  if(!pv || !b.selected.length) return cmBuilderView();
  const ic = (n) => shellIcon(n);
  const qs = b.selected;
  if(pv.idx >= qs.length) pv.idx = qs.length - 1;
  if(pv.idx < 0) pv.idx = 0;
  const q = qs[pv.idx];
  const letters = CM_LETTERS;
  const sel = pv.answers[q.id];
  const answered = Object.keys(pv.answers).length;
  const isLast = pv.idx === qs.length - 1;
  const numOf = cmQuestionNumbers().numOf;
  const perQ = b.timerMode === 'perQuestion';
  const secs = b.timerMode === 'total' ? (parseInt(b.minutes, 10) || 0) * 60 : (b.timerMode === 'perQuestion' ? (parseInt(b.secPerQ, 10) || 0) : null);
  const timerChip = secs ? `<span class="qz-chip">${ic(perQ ? 'timer' : 'clock')}<span class="mono">${formatTime(secs)}</span></span>` : '';
  const dots = qs.map((x, i) => `<button class="cm-dot ${pv.answers[x.id] ? 'answered' : ''} ${i === pv.idx ? 'current' : ''}" data-action="committee-pv-goto" data-idx="${i}" aria-label="Pregunta ${i + 1}">${i + 1}</button>`).join('');
  const optCls = (l) => {
    let c = 'option';
    if(pv.solution){
      if(l === q.correct) c += ' correct';
      else if(sel === l) c += ' incorrect';
    } else if(sel === l) c += ' selected';
    return c;
  };
  return `
  <div class="cm-pvbar">
    <span class="cm-pvbar-badge">${ic('eye')} Vista previa</span>
    <span class="cm-pvbar-text">Así lo verán los árbitros. Nada se guarda ni se envía.</span>
    <div class="cm-pvbar-actions">
      <button class="btn btn-ghost" data-action="committee-pv-solution">${ic('check')} ${pv.solution ? 'Ocultar solución' : 'Ver solución'}</button>
      <button class="btn btn-secondary" data-action="committee-pv-back">${ic('pencil')} Volver a editar</button>
      <button class="btn btn-primary" data-action="committee-b-save" ${b.saving ? 'disabled' : ''}>${ic('file')} ${b.saving ? 'Guardando...' : (b.editId ? 'Guardar cambios' : 'Guardar como borrador')}</button>
    </div>
  </div>
  <div class="qz">
    <header class="qz-top">
      <button class="qz-exit" data-action="committee-pv-back" aria-label="Volver a editar">${ic('chevron')}<span>Editar</span></button>
      <div class="qz-info"><strong>${esc(b.title.trim() || 'Test sin título')}</strong><small>Pregunta ${pv.idx + 1} de ${qs.length} · ${answered} respondidas</small></div>
      <div class="qz-status">${timerChip}<span class="qz-chip soft">${ic('check')} ${answered}/${qs.length}</span></div>
    </header>
    <div class="qz-progress"><i style="width:${Math.round(answered / qs.length * 100)}%"></i></div>
    <article class="qz-card">
      <div class="qz-tag">${q.domain === 'glossary' ? 'Glosario' : q.domain === 'fcf' ? 'Reglament General FCF' : (q.rule ? 'Regla ' + q.rule + ' · ' + esc(LAW_NAMES[q.rule] || '') : 'CTA BAGES')}${numOf[q.id] ? ` · <span class="cm-pv-adminnum">#${numOf[q.id]} (solo lo ves tú)</span>` : ''}</div>
      <h2 class="qz-text">${esc(q.question)}</h2>
      <div class="qz-options">
        ${q.options.map((o, i) => `<button class="${optCls(letters[i])}" data-action="committee-pv-answer" data-letter="${letters[i]}"><span class="letter">${letters[i].toUpperCase()}</span><span class="opt-text">${esc(o)}</span></button>`).join('')}
      </div>
      ${pv.solution && q.explanation ? `<div class="ac-q-expl" style="margin-top:14px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    </article>
    <div class="qz-actions">
      <button class="btn btn-secondary" data-action="committee-pv-prev" ${pv.idx === 0 ? 'disabled' : ''}>&larr; Anterior</button>
      ${isLast
        ? `<button class="btn btn-primary" data-action="committee-pv-back">Volver a editar</button>`
        : `<button class="btn btn-primary" data-action="committee-pv-next">Siguiente &rarr;</button>`}
    </div>
    <div class="cm-dots">${dots}</div>
    ${perQ ? `<div class="cm-allanswered">En el test real, con tiempo por pregunta, no se podrá volver a la pregunta anterior.</div>` : ''}
    ${b.shuffleMode === 'shuffled' ? `<div class="cm-allanswered">En el test real cada árbitro verá las preguntas y las respuestas en un orden distinto.</div>` : ''}
  </div>`;
}

async function cmSaveBuilder(){
  const b = COMMITTEE.builder;
  const bad = (m) => { if(STATE.view === 'committeePreview'){ STATE.view = 'committeeBuilder'; render(); } cmToast(m); };
  if(!b.title.trim()){ bad('Ponle un título al test.'); return; }
  if(!b.selected.length){ bad('Elige al menos una pregunta.'); return; }
  const opens = b.opens ? new Date(b.opens) : null;
  const closes = b.closes ? new Date(b.closes) : null;
  if(closes && opens && closes <= opens){ bad('La fecha de cierre tiene que ser posterior a la de apertura.'); return; }
  if(closes && !opens && closes.getTime() <= Date.now()){ bad('La fecha de cierre ya ha pasado.'); return; }
  const attempts = Math.max(1, parseInt(b.maxAttempts, 10) || 1);
  if(b.timerMode === 'total'){
    const mins = parseInt(b.minutes, 10);
    if(!(mins >= 1 && mins <= 600)){ bad('El tiempo total tiene que estar entre 1 y 600 minutos.'); return; }
  }
  if(b.timerMode === 'perQuestion'){
    const secs = parseInt(b.secPerQ, 10);
    if(!(secs >= 5 && secs <= 3600)){ bad('Los segundos por pregunta tienen que estar entre 5 y 3600.'); return; }
  }
  // Si el SQL de temporización aún no se ha ejecutado y no se usa tiempo, no se envían esas columnas.
  const extras = cmBuilderTimerFields(b);
  const withTimer = Object.keys(extras).length > 0;
  const questions = b.selected.map(q => ({
    question: q.question, options: q.options, correct: q.correct,
    rule: q.domain === 'glossary' ? null : (q.rule || null), explanation: q.explanation || ''
  }));
  // ¿Los cambios alteran las notas ya puestas? (distinto nº de preguntas o respuesta correcta distinta en alguna posición)
  const affectsScore = !!(b.editId && b.published && b.attemptCount > 0 && b.orig &&
    (questions.length !== b.orig.length || questions.some((q, i) => b.orig[i] && q.correct !== b.orig[i].correct)));
  if(b.editId && b.published){
    const hecho = b.attemptCount > 0 ? ` Ya hay ${b.attemptCount} ${b.attemptCount === 1 ? 'intento hecho' : 'intentos hechos'}.` : '';
    const ok = await appConfirm({
      title: '¿Guardar cambios en un test publicado?',
      message: 'Los árbitros verán los cambios al momento.' + hecho,
      confirmText: 'Guardar cambios', cancelText: 'Seguir editando', icon: 'pencil'
    });
    if(!ok) return;
  }
  b.saving = true; render();
  let error, timerErr = null;
  if(b.editId){
    // Edición de un borrador: se actualizan los datos y se reemplazan las preguntas.
    const patch = { title: b.title.trim(), month: cmBuilderMonth(b), closes_at: closes ? closes.toISOString() : null, max_attempts: attempts };
    if(opens) patch.opens_at = opens.toISOString();
    if(withTimer) Object.assign(patch, extras);
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
      const tr = await supabaseClient.from('committee_tests').update(extras).eq('id', newId);
      if(tr.error) timerErr = tr.error;
    }
  }
  const wasEdit = !!b.editId;
  const wasPublished = !!b.published;
  const editedId = b.editId;
  const nAttempts = b.attemptCount;
  b.saving = false;
  if(error){ cmToast(cmErrText(error)); return; }
  COMMITTEE.builder = null; COMMITTEE.pv = null;
  COMMITTEE.tab = 'tests';
  STATE.view = 'committeeTraining';
  render();
  let rescoreNote = '';
  if(affectsScore){
    const yes = await appConfirm({
      title: '¿Recalcular los resultados?',
      message: `Has cambiado respuestas correctas o el número de preguntas y ya hay ${nAttempts} ${nAttempts === 1 ? 'intento hecho' : 'intentos hechos'}. ¿Quieres recalcular sus notas con las preguntas actuales?`,
      confirmText: 'Recalcular', cancelText: 'Dejarlos como están', icon: 'repeat'
    });
    if(yes){
      const rs = await supabaseClient.rpc('committee_admin_rescore_test', { p_test_id: editedId });
      rescoreNote = rs.error ? ' No se pudieron recalcular los resultados: ' + cmErrText(rs.error) : ` Se recalcularon ${rs.data} ${rs.data === 1 ? 'resultado' : 'resultados'}.`;
    } else {
      rescoreNote = ' Los resultados anteriores se han dejado como estaban.';
    }
  }
  STATE.toast = timerErr
    ? 'El test se guardó, pero no se pudo guardar el tiempo (' + cmErrText(timerErr) + '). Edítalo para ponerlo.'
    : (wasEdit
        ? (wasPublished ? 'Cambios guardados en el test publicado.' : 'Cambios guardados. El test sigue en borrador.') + rescoreNote
        : 'Test guardado como borrador. Publícalo cuando esté listo.');
  render();
  cmLoadAdminData();
}

async function cmAddCategory(){
  const dr = COMMITTEE.catDraft;
  const name = String(dr.name || '').trim();
  if(!name){ cmToast('Escribe el nombre de la categoría.'); return; }
  const pos = (COMMITTEE.categories || []).reduce((mx, c) => Math.max(mx, c.position || 0), 0) + 1;
  const { error } = await supabaseClient.from('committee_member_categories').insert({ name, color: dr.color, position: pos });
  if(error){
    cmToast(/duplicate|23505/i.test((error.message || '') + (error.code || '')) ? 'Ya existe una categoría con ese nombre.' : cmErrText(error));
    return;
  }
  COMMITTEE.catDraft = { name: '', color: dr.color };
  await cmLoadCategories();
  STATE.toast = 'Categoría creada.'; render();
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
    if(!m.published && !(await appConfirm({ title: '¿Publicar el mensaje?', message: '"' + m.title + '" lo verán los árbitros en CTA BAGES.', confirmText: 'Publicar', cancelText: 'Todavía no', icon: 'play' }))) return;
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
    if(!(await appConfirm({ title: '¿Eliminar el mensaje?', message: '"' + m.title + '" se borrará y no se puede deshacer.', confirmText: 'Eliminar', danger: true }))) return;
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
      if(!(await appConfirm({ title: 'Test con tiempo limitado', message: cmTimerText(card) + '.' + extra + ' El reloj empieza al aceptar.', confirmText: 'Empezar ahora', cancelText: 'Todavía no', icon: 'timer' }))) return;
    }
    const { data, error } = await supabaseClient.rpc('committee_get_test', { p_test_id: tid });
    if(error){ cmToast(cmErrText(error)); cmLoadMyTests(); return; }
    if(data && data.shuffle_mode === 'shuffled' && Array.isArray(data.questions)){
      // Orden propio de este árbitro (fijo para este intento: si reabre el test ve el mismo).
      const uid = (typeof CURRENT_USER_ID !== 'undefined' && CURRENT_USER_ID) ? CURRENT_USER_ID : 'u';
      data.questions = cmShuffleQuestions(data.questions, uid + '|' + data.id + '|' + (data.attempts_used || 0));
    }
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
    if(!(await appConfirm({ title: '¿Salir del test?', message: 'No se guardará ninguna respuesta y no se gastará el intento.', confirmText: 'Sí, salir', cancelText: 'Seguir con el test', danger: true, icon: 'flag' }))) return;
    cmStopRunTimer();
    COMMITTEE.run = null;
    STATE.view = 'committee';
    render(); cmLoadMyTests();
  }
  else if(action === 'committee-finish'){
    const r = COMMITTEE.run; if(!r || r.submitting) return;
    const missing = r.test.questions.length - Object.keys(r.answers).length;
    const msg = missing > 0
      ? `Te ${missing === 1 ? "queda 1 pregunta" : "quedan " + missing + " preguntas"} sin responder y contará${missing === 1 ? "" : "n"} como fallo.`
      : 'Después no podrás cambiar tus respuestas.';
    if(!(await appConfirm({ title: '¿Finalizar el test?', message: msg, confirmText: 'Finalizar', cancelText: 'Seguir revisando', icon: 'check' }))) return;
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
    const raw = String(COMMITTEE.newMemberEmail || '');
    const tokens = Array.from(new Set(raw.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean)));
    if(!tokens.length){ cmToast('Escribe el correo del árbitro.'); return; }
    const emails = tokens.filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    const invalid = tokens.filter(x => !emails.includes(x));
    const known = new Set((COMMITTEE.members || []).map(m => String(m.email || '').toLowerCase()));
    const rep = { added: 0, already: 0, notFound: [], invalid };
    const keep = [];
    for(const em of emails){
      if(known.has(em)){ rep.already++; continue; }
      const { data, error } = await supabaseClient.rpc('committee_admin_add_member', { p_email: em });
      if(error){ cmToast(cmErrText(error)); return; }
      if(data && data.ok) rep.added++; else { rep.notFound.push(em); keep.push(em); }
    }
    COMMITTEE.newMemberEmail = keep.concat(invalid).join('\n');
    COMMITTEE.memberReport = rep;
    render();
    cmLoadAdminData();
  }
  else if(action === 'committee-member-sort'){
    const k = el.dataset.key;
    if(COMMITTEE.memberSortKey === k) COMMITTEE.memberSortDir = COMMITTEE.memberSortDir === 'asc' ? 'desc' : 'asc';
    else { COMMITTEE.memberSortKey = k; COMMITTEE.memberSortDir = (k === 'done' || k === 'acc' || k === 'added' || k === 'last') ? 'desc' : 'asc'; }
    render();
  }
  else if(action === 'committee-member-clear-filters'){
    COMMITTEE.memberFilters = { last: '', first: '', user: '', email: '', cat: 'all', res: 'all' };
    render();
  }
  else if(action === 'committee-members-sel-clear'){ COMMITTEE.memberSel = {}; cmMembersRefreshParts(); }
  else if(action === 'committee-members-bulk-assign'){
    const uids = Object.keys(COMMITTEE.memberSel).filter(k => COMMITTEE.memberSel[k]);
    if(!uids.length) return;
    const sel = document.getElementById('cm-bulk-cat');
    const catId = sel && sel.value ? sel.value : null;
    const ok = await cmSetMembersCategory(uids, catId);
    if(!ok) return;
    COMMITTEE.memberSel = {};
    const c = cmCatById(catId);
    STATE.toast = c ? `Categoría «${c.name}» asignada a ${uids.length} ${uids.length === 1 ? 'árbitro' : 'árbitros'}.` : `Categoría quitada a ${uids.length} ${uids.length === 1 ? 'árbitro' : 'árbitros'}.`;
    render();
  }
  else if(action === 'committee-cat-color'){ COMMITTEE.catDraft.color = el.dataset.color; render(); }
  else if(action === 'committee-cat-suggest'){ COMMITTEE.catDraft.name = el.dataset.name; await cmAddCategory(); }
  else if(action === 'committee-cat-add'){ await cmAddCategory(); }
  else if(action === 'committee-cat-delete'){
    const c = (COMMITTEE.categories || []).find(x => x.id === el.dataset.cid); if(!c) return;
    const n = (COMMITTEE.members || []).filter(m => m.category_id === c.id).length;
    const ok = await appConfirm({
      title: '¿Eliminar la categoría?',
      message: `«${c.name}» se eliminará.` + (n ? ` ${n} ${n === 1 ? 'árbitro quedará' : 'árbitros quedarán'} sin categoría.` : ''),
      confirmText: 'Eliminar', danger: true
    });
    if(!ok) return;
    const { error } = await supabaseClient.from('committee_member_categories').delete().eq('id', c.id);
    if(error){ cmToast(cmErrText(error)); return; }
    (COMMITTEE.members || []).forEach(m => { if(m.category_id === c.id) m.category_id = null; });
    COMMITTEE.categories = (COMMITTEE.categories || []).filter(x => x.id !== c.id);
    if(COMMITTEE.memberFilters.cat === c.id) COMMITTEE.memberFilters.cat = 'all';
    STATE.toast = 'Categoría eliminada.'; render();
  }
  else if(action === 'committee-defaults-save'){
    const d = COMMITTEE.defaults;
    const att = Math.max(1, Math.min(20, parseInt(d.maxAttempts, 10) || 1));
    const min = Math.max(1, Math.min(600, parseInt(d.minutes, 10) || 20));
    const sec = Math.max(5, Math.min(3600, parseInt(d.secPerQ, 10) || 45));
    const clean = { maxAttempts: att, timerMode: ['none', 'total', 'perQuestion'].includes(d.timerMode) ? d.timerMode : 'none', minutes: min, secPerQ: sec, shuffleMode: d.shuffleMode === 'shuffled' ? 'shuffled' : 'fixed' };
    const { error } = await supabaseClient.from('committee_settings').update({ defaults: clean }).eq('id', 1);
    if(error){ cmToast(/defaults/.test(error.message || '') ? 'Falta ejecutar el SQL committee-categories.sql en Supabase.' : cmErrText(error)); return; }
    Object.assign(COMMITTEE.defaults, clean);
    STATE.toast = 'Valores guardados. Se usarán en los nuevos tests.'; render();
  }
  else if(action === 'committee-export-members'){
    const { list } = cmMembersData();
    const rows = list.map(e => {
      const p = cmNameParts(e.m);
      return {
        'Apellidos': p.last, 'Nombre': p.first, 'Usuario': e.m.username || '', 'Email': e.m.email || '', 'Categoría': (cmCatById(e.m.category_id) || {}).name || '',
        'Tests hechos': e.s.done, 'Tests publicados': e.s.published, '% acierto': e.s.pct === null ? '' : e.s.pct,
        'Alta en CTA BAGES': cmFmtDay(e.m.added_at), 'Último acceso': e.m.last_sign_in_at ? cmFmtDay(e.m.last_sign_in_at) : ''
      };
    });
    cmExport(rows, 'Miembros', 'comite_miembros.xlsx');
  }
  else if(action === 'committee-remove-member'){
    const m = (COMMITTEE.members || []).find(x => x.user_id === el.dataset.uid);
    if(!(await appConfirm({ title: '¿Quitar el acceso?', message: (m ? cmWho(m) : 'Este árbitro') + ' dejará de ver CTA BAGES. Sus resultados anteriores se conservan.', confirmText: 'Quitar acceso', danger: true }))) return;
    const { error } = await supabaseClient.rpc('committee_admin_remove_member', { p_user_id: el.dataset.uid });
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = 'Acceso retirado.'; render();
    cmLoadAdminData();
  }

  /* administrador: tests */
  else if(action === 'committee-toggle-pub'){
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    if(!t.published && !t.question_count){ cmToast('El test no tiene preguntas.'); return; }
    if(!t.published && !(await appConfirm({ title: '¿Publicar el test?', message: '"' + t.title + '" lo verán los árbitros y podrán hacerlo desde la fecha de apertura.', confirmText: 'Publicar', cancelText: 'Todavía no', icon: 'play' }))) return;
    const { error } = await supabaseClient.from('committee_tests').update({ published: !t.published }).eq('id', tid);
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = t.published ? 'Test despublicado.' : 'Test publicado.'; render();
    cmLoadAdminData();
  }
  else if(action === 'committee-delete-test'){
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    if(!(await appConfirm({ title: '¿Eliminar el test?', message: '"' + t.title + '" se borrará junto con todos sus resultados. No se puede deshacer.', confirmText: 'Eliminar', danger: true }))) return;
    const { error } = await supabaseClient.from('committee_tests').delete().eq('id', tid);
    if(error){ cmToast(cmErrText(error)); return; }
    STATE.toast = 'Test eliminado.'; render();
    cmLoadAdminData();
  }
  else if(action === 'committee-edit-test'){
    if(!isDevUser()) return;
    const t = (COMMITTEE.tests || []).find(x => x.id === tid); if(!t) return;
    const { data, error } = await supabaseClient.from('committee_test_questions').select('*').eq('test_id', tid).order('pos');
    if(error){ cmToast(cmErrText(error)); return; }
    // Si la pregunta sigue en el banco se usa la del banco (para que los filtros la marquen como elegida);
    // el contenido que manda es el guardado en el test.
    const bank = {};
    allQuestionsAdmin().forEach(q => { bank[questionDedupeKey(q)] = q; });
    const nb = cmNewBuilder();
    nb.editId = t.id;
    nb.title = t.title;
    if(t.month){ nb.season = cmSeasonOfMonth(t.month); nb.mon = String(parseInt(t.month.slice(5, 7), 10)); }
    nb.opens = cmToLocalInput(t.opens_at);
    nb.closes = cmToLocalInput(t.closes_at);
    nb.maxAttempts = t.max_attempts; nb.hadTimerCols = ('timer_mode' in t); nb.hadShuffleCol = ('shuffle_mode' in t);
    nb.timerMode = t.timer_mode || 'none'; nb.minutes = t.time_minutes || nb.minutes; nb.secPerQ = t.seconds_per_question || nb.secPerQ;
    nb.shuffleMode = t.shuffle_mode || 'fixed';
    nb.selected = (data || []).map((q, i) => {
      const match = bank[questionDedupeKey({ question: q.question, options: q.options })];
      const base = match ? Object.assign({}, match) : { id: 'tq-' + t.id + '-' + i, domain: q.rule ? 'law' : 'glossary', difficulty: 'normal', source: 'user' };
      return Object.assign(base, { question: q.question, options: q.options, correct: q.correct, rule: q.rule, explanation: q.explanation || '' });
    });
    nb.published = !!t.published;
    nb.attemptCount = (COMMITTEE.attempts || []).filter(a => a.test_id === t.id).length;
    nb.orig = (data || []).map(q => ({ correct: q.correct }));
    COMMITTEE.builder = nb;
    STATE.view = 'committeeBuilder'; render(); window.scrollTo(0, 0);
  }
  else if(action === 'committee-dq-toggle-all'){
    const items = Array.from(document.querySelectorAll('.cm-dq'));
    if(!items.length) return;
    const open = !items.every(d => d.open);
    items.forEach(d => { d.open = open; });
    const lb = document.getElementById('cm-dq-all-label'); if(lb) lb.textContent = open ? 'Ocultar todas' : 'Ver todas';
  }
  else if(action === 'committee-detail'){ cmOpenDetail(tid); window.scrollTo(0, 0); }
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
    if(b && b.selected.length && !(await appConfirm({ title: '¿Descartar este test?', message: 'Se perderán los cambios que no hayas guardado.', confirmText: 'Descartar', cancelText: 'Seguir editando', danger: true }))) return;
    COMMITTEE.builder = null; COMMITTEE.pv = null; STATE.view = 'committeeTraining'; render();
  }
  else if(action === 'committee-b-toggle'){
    if(!b) return;
    const qid = el.dataset.qid;
    const idx = b.selected.findIndex(q => q.id === qid);
    if(idx >= 0) b.selected.splice(idx, 1);
    else { const q = allQuestionsAdmin().find(x => x.id === qid); if(q) b.selected.push(q); }
    render();
  }
  else if(action === 'committee-b-expand-all'){
    if(!b || !b.selected.length) return;
    const open = !b.selected.every(q => b.expanded[q.id]);
    b.selected.forEach(q => { b.expanded[q.id] = open; });
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
    if(!(await appConfirm({ title: '¿Quitar todas las preguntas?', message: 'Se vaciará la lista de preguntas del test.', confirmText: 'Vaciar', danger: true }))) return;
    b.selected = []; render();
  }
  else if(action === 'committee-b-add-numbers'){
    if(!b) return;
    const ta = document.getElementById('cm-b-nums');
    if(ta) b.numsText = ta.value;
    const rep = cmAddByNumbers(b);
    // Se quedan en la caja solo los números que no se han podido añadir.
    b.numsText = rep.missing.join(', ');
    render();
  }
  else if(action === 'committee-b-preview'){
    if(!b) return;
    if(!b.selected.length){ cmToast('Añade alguna pregunta para poder previsualizar el test.'); return; }
    COMMITTEE.pv = { idx: 0, answers: {}, solution: false };
    STATE.view = 'committeePreview'; render(); window.scrollTo(0, 0);
  }
  else if(action === 'committee-pv-back'){ STATE.view = 'committeeBuilder'; render(); window.scrollTo(0, 0); }
  else if(action === 'committee-pv-solution'){ if(COMMITTEE.pv){ COMMITTEE.pv.solution = !COMMITTEE.pv.solution; render(); } }
  else if(action === 'committee-pv-answer'){
    const pv = COMMITTEE.pv; if(!pv || !b) return;
    const q = b.selected[pv.idx]; if(!q) return;
    pv.answers[q.id] = el.dataset.letter; render();
  }
  else if(action === 'committee-pv-goto'){ if(COMMITTEE.pv){ COMMITTEE.pv.idx = parseInt(el.dataset.idx, 10) || 0; render(); } }
  else if(action === 'committee-pv-prev'){ if(COMMITTEE.pv && COMMITTEE.pv.idx > 0){ COMMITTEE.pv.idx--; render(); } }
  else if(action === 'committee-pv-next'){ if(COMMITTEE.pv && b && COMMITTEE.pv.idx < b.selected.length - 1){ COMMITTEE.pv.idx++; render(); } }
  else if(action === 'committee-b-timer-mode'){ if(b){ b.timerMode = el.dataset.mode; render(); } }
  else if(action === 'committee-b-order-mode'){ if(b){ b.shuffleMode = el.dataset.mode === 'shuffled' ? 'shuffled' : 'fixed'; render(); } }
  else if(action === 'committee-b-repl-open'){
    if(!b) return;
    b.replacingId = el.dataset.qid; render();
    setTimeout(() => { const i = document.getElementById('cm-b-repl-n'); if(i) i.focus(); }, 30);
  }
  else if(action === 'committee-b-repl-cancel'){ if(b){ b.replacingId = null; render(); } }
  else if(action === 'committee-b-repl-do'){
    if(!b) return;
    const inp = document.getElementById('cm-b-repl-n');
    const n = parseInt(inp && inp.value, 10);
    if(!(n > 0)){ cmToast('Escribe el número de la pregunta nueva.'); return; }
    const nq = questionsByNumber()[n];
    if(!nq){ cmToast('No existe ninguna pregunta con el número ' + n + '.'); return; }
    if(b.selected.some(x => x.id === nq.id)){ cmToast('La pregunta ' + n + ' ya está en el test.'); return; }
    const i = b.selected.findIndex(x => x.id === el.dataset.qid);
    if(i < 0) return;
    b.selected[i] = nq;
    b.replacingId = null;
    STATE.toast = 'Pregunta sustituida: ocupa la misma posición.';
    render();
  }
  else if(action === 'committee-b-save'){ cmSaveBuilder(); }
}

/* campos de formulario: se guardan en COMMITTEE sin repintar (salvo data-cm-rerender) */
function cmSetPath(path, value){
  const parts = path.split('.');
  let obj = COMMITTEE;
  for(let i = 0; i < parts.length - 1; i++){ obj = obj[parts[i]]; if(!obj) return; }
  obj[parts[parts.length - 1]] = value;
}

function committeeAfterRender(){
  document.querySelectorAll('[data-cm-field]').forEach(el => {
    const evt = (el.tagName === 'SELECT' || ['month', 'datetime-local', 'date', 'number', 'checkbox'].includes(el.type)) ? 'change' : 'input';
    el.addEventListener(evt, () => {
      cmSetPath(el.dataset.cmField, el.type === 'checkbox' ? el.checked : el.value);
      if(el.hasAttribute('data-cm-rerender')) render();
    });
  });
  cmBindMembersTable();
  cmBindSettings();
  const nta = document.getElementById('cm-b-nums');
  if(nta) nta.addEventListener('input', () => {
    const b = COMMITTEE.builder; if(!b) return;
    b.numsText = nta.value;
    const pv = document.getElementById('cm-nums-preview'); if(pv) pv.innerHTML = cmNumsPreviewHtml(b);
    const lb = document.getElementById('cm-b-add-label'); if(lb) lb.textContent = cmNumsAddLabel(b);
  });
}
