const DEV_USER_EMAIL = 'info@we-ref.com';

/* ---------------- ROLES ----------------
   master     -> info@we-ref.com (único): gestiona toda la app y asigna roles.
   developer  -> acceso a todo (panel, base de datos, sugerencias, comité), pero no asigna roles
                 ni puede bloquear/eliminar al maestro ni a otros desarrolladores.
   user       -> usuario normal; es el rol por defecto de todo el mundo. */
let USER_ROLE = null;
function userRole(){
  if(USER_ROLE) return USER_ROLE;
  return (typeof CURRENT_USER_EMAIL !== 'undefined' && CURRENT_USER_EMAIL === DEV_USER_EMAIL) ? 'master' : 'user';
}
function isMaster(){ return userRole() === 'master'; }
function isDevUser(){ const r = userRole(); return r === 'master' || r === 'developer'; }
const ROLE_LABELS = { master: 'Maestro', developer: 'Desarrollador', user: 'Usuario' };

async function loadUserRole(){
  try{
    const { data, error } = await supabaseClient.rpc('weref_role');
    if(!error && (data === 'master' || data === 'developer' || data === 'user')){ USER_ROLE = data; return; }
  }catch(e){}
  USER_ROLE = null; // sin la función en el servidor: el maestro se reconoce por su email
}
async function setUserRole(userId, role){
  if(!isMaster() || !userId) return;
  if(!STATE.roleOverrides) STATE.roleOverrides = {};
  const users = (STATE.adminStats && STATE.adminStats.users) || [];
  const target = users.find(x => x.id === userId);
  const prevRole = target ? (target.role || 'user') : 'user';
  const adjustCount = (from, to) => {
    if(STATE.adminStats && typeof STATE.adminStats.developers === 'number'){
      if(from !== 'developer' && to === 'developer') STATE.adminStats.developers++;
      if(from === 'developer' && to !== 'developer') STATE.adminStats.developers = Math.max(0, STATE.adminStats.developers - 1);
    }
  };
  // Cambio inmediato en pantalla; si el servidor lo rechaza, se deshace.
  STATE.roleOverrides[userId] = role;
  if(target) target.role = role;
  adjustCount(prevRole, role);
  STATE.toast = role === 'developer' ? 'Ahora es Desarrollador.' : 'Ahora es Usuario normal.';
  render();
  try{
    const { error } = await supabaseClient.rpc('weref_set_role', { p_user_id: userId, p_role: role });
    if(error) throw error;
    loadAdminStats(STATE.adminUsersPage);
  }catch(e){
    delete STATE.roleOverrides[userId];
    if(target) target.role = prevRole;
    adjustCount(role, prevRole);
    STATE.toast = 'No se pudo cambiar el rol. ¿Has instalado el SQL de roles en Supabase?';
    render();
  }
}

async function reportQuestion(qid){
  if(STATE.reportedIds[qid]) return;
  STATE.reportedIds[qid] = true;
  STATE.toast = 'Gracias, hemos recibido tu aviso.';
  render();
  try{
    await supabaseClient.from('question_reports').insert({
      question_id: qid,
      user_id: (typeof CURRENT_USER_ID !== 'undefined') ? CURRENT_USER_ID : null,
      user_email: (typeof CURRENT_USER_EMAIL !== 'undefined') ? CURRENT_USER_EMAIL : null
    });
  }catch(e){ /* aviso ya mostrado igualmente; el fallo de red no debe bloquear al usuario */ }
}

/* Finalizar el examen: pide confirmación (se contaba al primer toque y se cerraba sin querer). */
async function finishTrainingConfirm(){
  const quiz = STATE.quiz;
  if(!quiz) return;
  const left = quiz.qids.filter(id => !quiz.answers[id]).length;
  const ok = await appConfirm({
    icon: 'flag',
    title: '¿Finalizar el examen?',
    message: left > 0
      ? 'Te quedan ' + left + (left === 1 ? ' pregunta sin responder' : ' preguntas sin responder') + '. Si finalizas ahora, contarán como no respondidas.'
      : 'Has respondido todas las preguntas. Verás tu resultado.',
    confirmText: 'Sí, finalizar',
    cancelText: 'Seguir con el examen'
  });
  if(!ok || STATE.view !== 'quiz' || STATE.quiz !== quiz) return;
  if(quiz.server){ srvFinishQuiz(); return; }
  stopTimer(); recordTestResult(quiz); STATE.view = 'result'; render();
}

/* Modal de confirmación antes de enviar el aviso de error (guarda en question_reports con el id de la pregunta). */
async function reportQuestionDialog(qid){
  if(STATE.reportedIds[qid]) return;
  const ok = await appConfirm({
    icon: 'flag',
    title: 'Reportar error en esta pregunta',
    message: 'Avisaremos al equipo para que la revise: enunciado, respuestas o explicación. No se mostrará tu nombre.',
    confirmText: 'Enviar aviso',
    cancelText: 'Cancelar'
  });
  if(ok) reportQuestion(qid);
}

async function loadQuestionReports(quiet){
  if(!isDevUser()) return;
  try{
    const { data, error } = await supabaseClient.from('question_reports').select('question_id');
    if(error || !data) return;
    const counts = {};
    data.forEach(r => { counts[r.question_id] = (counts[r.question_id]||0) + 1; });
    if(quiet === true){
      // Sincronización en segundo plano: solo se repinta si algo ha cambiado (y sin pisar lo que se escribe).
      const cur = STATE.reports || {}, a = Object.keys(counts), b = Object.keys(cur);
      const same = STATE.reportsLoaded && a.length === b.length && a.every(k => cur[k] === counts[k]);
      STATE.reports = counts; STATE.reportsLoaded = true;
      if(!same) adminSyncRender();
      return;
    }
    STATE.reports = counts;
    STATE.reportsLoaded = true;
    render();
  }catch(e){}
}

async function dismissReports(qid){
  if(!isDevUser()) return;
  try{ await supabaseClient.from('question_reports').delete().eq('question_id', qid); }catch(e){}
  delete STATE.reports[qid];
  render();
}

async function sendSuggestion(){
  const el = document.getElementById('suggest-message');
  const message = el ? el.value.trim() : '';
  if(!message){ STATE.toast = 'Escribe algo antes de enviar.'; render(); return; }
  try{
    await supabaseClient.from('suggestions').insert({
      user_id: (typeof CURRENT_USER_ID !== 'undefined') ? CURRENT_USER_ID : null,
      user_email: (typeof CURRENT_USER_EMAIL !== 'undefined') ? CURRENT_USER_EMAIL : null,
      message
    });
    STATE.toast = '¡Gracias! Hemos recibido tu sugerencia.';
  }catch(e){
    STATE.toast = 'No se pudo enviar. Inténtalo de nuevo.';
  }
  STATE.view = 'home';
  render();
}

async function loadSuggestions(){
  if(!isMaster()) return;
  try{
    const { data, error } = await supabaseClient.from('suggestions').select('*').order('created_at', { ascending: false });
    if(error || !data) return;
    STATE.suggestions = data;
    render();
  }catch(e){}
}

async function setSuggestionStatus(id, status){
  if(!isMaster()) return;
  try{ await supabaseClient.from('suggestions').update({ status }).eq('id', id); }catch(e){}
  const s = STATE.suggestions.find(x=>x.id===id);
  if(s) s.status = status;
  render();
}

async function deleteSuggestion(id){
  if(!isMaster()) return;
  try{ await supabaseClient.from('suggestions').delete().eq('id', id); }catch(e){}
  STATE.suggestions = STATE.suggestions.filter(x=>x.id!==id);
  render();
}

async function loadAdminStats(page){
  if(!isDevUser()) return;
  if(page) STATE.adminUsersPage = page;
  if(!STATE.adminStats){ STATE.adminStats = null; render(); } // solo muestra el esqueleto de carga si aún no hay nada que ver
  try{
    const { data, error } = await supabaseClient.functions.invoke('admin-stats', { body: {
      page: STATE.adminUsersPage,
      search: STATE.adminUsersFilter.search,
      status: STATE.adminUsersFilter.status,
      role: STATE.adminUsersFilter.role
    } });
    if(error || !data || data.error){ STATE.adminStats = false; render(); return; }
    const ov = STATE.roleOverrides || {};
    (data.users || []).forEach(u => { if(u.role === undefined){ if(ov[u.id]) u.role = ov[u.id]; } else { delete ov[u.id]; } });
    // Si la función del servidor aún no filtra por rol, se filtra aquí la página recibida.
    const roleFilter = STATE.adminUsersFilter.role;
    if(roleFilter && roleFilter !== 'all' && data.roleFilter === undefined){
      const roleOfU = (u) => u.email === DEV_USER_EMAIL ? 'master' : (u.role || 'user');
      data.users = (data.users || []).filter(u => roleOfU(u) === roleFilter);
      data.usersFilteredTotal = data.users.length;
      data.usersTotalPages = 1;
      data.usersPage = 1;
    }
    STATE.adminStats = data;
    STATE.adminUsersPage = data.usersPage || 1;
    render();
  }catch(e){
    STATE.adminStats = false;
    render();
  }
}

async function deleteAdminUser(userId){
  if(!isDevUser() || !userId) return;
  STATE.confirmDeleteUserId = null;
  try{
    const { data, error } = await supabaseClient.functions.invoke('admin-stats', { body: { action: 'delete', userId } });
    if(error || !data || data.error){
      STATE.toast = (data && data.error) ? data.error : 'No se pudo eliminar la cuenta.';
      render();
      return;
    }
    STATE.toast = 'Cuenta eliminada.';
    render();
    loadAdminStats(STATE.adminUsersPage);
  }catch(e){
    STATE.toast = 'No se pudo eliminar la cuenta.';
    render();
  }
}

async function toggleBlockAdminUser(userId, block){
  if(!isDevUser() || !userId) return;
  try{
    const { data, error } = await supabaseClient.functions.invoke('admin-stats', { body: { action: block ? 'block' : 'unblock', userId } });
    if(error || !data || data.error){
      STATE.toast = (data && data.error) ? data.error : (block ? 'No se pudo bloquear la cuenta.' : 'No se pudo desbloquear la cuenta.');
      render();
      return;
    }
    STATE.toast = block ? 'Cuenta bloqueada.' : 'Cuenta desbloqueada.';
    render();
    loadAdminStats(STATE.adminUsersPage);
  }catch(e){
    STATE.toast = block ? 'No se pudo bloquear la cuenta.' : 'No se pudo desbloquear la cuenta.';
    render();
  }
}

const LAW_NAMES = {
  1:"El Terreno de Juego", 2:"El Balón", 3:"Los Jugadores", 4:"El Equipamiento de los Jugadores",
  5:"El Árbitro", 6:"Los Otros Miembros del Equipo Arbitral", 7:"La Duración del Partido",
  8:"Inicio y Reanudación del Juego", 9:"Balón en Juego",
  10:"El Resultado de un Partido", 11:"El Fuera de Juego", 12:"Faltas y Conducta Incorrecta",
  13:"Tiros Libres", 14:"El Penal (Tiro Penal)", 15:"El Saque de Banda", 16:"El Saque de Meta", 17:"El Saque de Esquina"
};

const LOGO_MARK = `<svg viewBox="0 0 48 48" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="10" width="18" height="26" rx="4" fill="#16181D" stroke="#fff" stroke-width="2" transform="rotate(-14 14 23)"/>
  <rect x="25" y="12" width="18" height="26" rx="4" fill="#FF6A2B" transform="rotate(14 34 25)"/>
</svg>`;

const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
const LAW_ICONS = {
  1: SVG_OPEN+'<rect x="2" y="5" width="20" height="14" rx="1"/><line x1="12" y1="5" x2="12" y2="19"/><circle cx="12" cy="12" r="2.6"/><path d="M2 9h2.5v6H2M22 9h-2.5v6H22"/></svg>',
  2: SVG_OPEN+'<circle cx="12" cy="12" r="9"/><path d="M12 8.8l3 2.2-1.1 3.6h-3.8l-1.1-3.6z" fill="currentColor" stroke="none"/><path d="M12 8.8V3M15 11l5.6-1.8M13.9 14.6l3.4 4.7M10.1 14.6l-3.4 4.7M9 11 3.4 9.2"/></svg>',
  3: SVG_OPEN+'<circle cx="12" cy="6.5" r="2.6"/><path d="M6.5 20c0-4 2.4-7 5.5-7s5.5 3 5.5 7"/></svg>',
  4: SVG_OPEN+'<path d="M3 9L8 4.5 9.5 6 12 7 14.5 6 16 4.5 21 9 17.5 11.5 17.5 20 6.5 20 6.5 11.5Z"/></svg>',
  5: SVG_OPEN+'<circle cx="15.5" cy="12" r="5"/><circle cx="15.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><path d="M3.3 10.2 10.5 9.3v5.4l-7.2-.9z"/><circle cx="3" cy="12" r="1"/></svg>',
  6: SVG_OPEN+'<line x1="5.5" y1="3" x2="5.5" y2="21"/><path d="M5.5 4.2h11.5l-3 3 3 3H5.5z" fill="currentColor" stroke="none"/></svg>',
  7: SVG_OPEN+'<circle cx="12" cy="12.5" r="8.5"/><path d="M12 7.5v5l3.3 2M9.5 2.5h5"/></svg>',
  8: SVG_OPEN+'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M12 3v3.2M12 17.8V21"/></svg>',
  9: SVG_OPEN+'<circle cx="14.5" cy="14" r="5"/><path d="M2.5 8.8h5.5M2 12h6M2.8 15.2h5"/></svg>',
  10: SVG_OPEN+'<path d="M7.5 4h9v3.5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5H4.8v1.8A2.7 2.7 0 0 0 7.5 9.5M16.5 5h2.7v1.8a2.7 2.7 0 0 1-2.7 2.7"/><path d="M12 12v3.2M9.3 19.5h5.4M10.3 15.8h3.4v3.2h-3.4z"/></svg>',
  11: SVG_OPEN+'<line x1="12" y1="3" x2="12" y2="21" stroke-dasharray="2.2 2.2"/><circle cx="7" cy="9" r="2"/><circle cx="17" cy="15" r="2"/></svg>',
  12: SVG_OPEN+'<rect x="7.3" y="3.2" width="9.4" height="13" rx="1.3" transform="rotate(-8 12 10)" fill="currentColor" stroke="none"/></svg>',
  13: SVG_OPEN+'<circle cx="5.5" cy="17" r="1.5"/><circle cx="10.5" cy="17" r="1.5"/><circle cx="15.5" cy="17" r="1.5"/><path d="M5.5 15.5V9M10.5 15.5V7M15.5 15.5V9"/><circle cx="20.5" cy="17" r="1.5" fill="currentColor" stroke="none"/></svg>',
  14: SVG_OPEN+'<path d="M5 5.5h14v8.5H5z"/><path d="M5 8h14M5 10.5h14M5 13h14M8.5 5.5v8.5M12 5.5v8.5M15.5 5.5v8.5"/><circle cx="12" cy="19.3" r="1" fill="currentColor" stroke="none"/></svg>',
  15: SVG_OPEN+'<path d="M6.5 19.5c1.7-5.2 3.4-8.6 3.4-11.5a2.1 2.1 0 1 1 4.2 0c0 2.9 1.7 6.3 3.4 11.5"/><circle cx="12" cy="5" r="1.8" fill="currentColor" stroke="none"/><circle cx="6.3" cy="20" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.7" cy="20" r="1.1" fill="currentColor" stroke="none"/></svg>',
  16: SVG_OPEN+'<path d="M6 19V6h12v13"/><path d="M6 9h12M6 12.5h12M6 16h12M9 6v13M12 6v13M15 6v13"/></svg>',
  17: SVG_OPEN+'<path d="M4 20V4"/><path d="M4 20h14"/><path d="M4 4.5l6 2.8-2.1 4.2z" fill="currentColor" stroke="none"/></svg>'
};

/* El banco base ya no viaja con la web: se descarga del almacén privado de Supabase al iniciar sesión (loadBaseBank). */
const BASE_QUESTIONS = [];
const BANK = { ready: false, source: '' };
/* ---- Entrega del banco por lotes (funcion "bank" del servidor) ----
   Con BANK_SERVER la app solo recibe un indice (id y regla); el texto de las preguntas se pide al servidor
   por lotes antes de cada test, con limite diario por usuario. Mientras BANK_ROLLOUT_ALL sea false, solo lo usa
   un administrador que lo active con: localStorage.setItem('weref_bank_server','1')  (para probarlo). */
let BANK_SERVER = false;
const BANK_ROLLOUT_ALL = false;
const BANK_INDEX = {};
/* Tope de preguntas por test en toda la web. */
const MAX_TEST_QUESTIONS = 25;
function bankCap(n){ return Math.min(n, MAX_TEST_QUESTIONS); }
async function bankIsAdmin(){ try{ const r = await supabaseClient.rpc('is_weref_admin'); return !!(r && r.data === true); }catch(e){ return false; } }
async function bankInvoke(body){
  const r = await supabaseClient.functions.invoke('bank', { body });
  if(r.error){
    let msg = ''; try{ const j = await r.error.context.json(); msg = j.message || j.error || ''; }catch(e){}
    const err = new Error(msg || 'bank'); err.userMessage = msg; throw err;
  }
  return r.data;
}
async function ensureBankContent(ids){
  if(BANK_INDEX_MODE){
    /* modo índice: solo se puede ver el contenido de tus Guardadas que ya has respondido (get_saved_question) */
    const need = Array.from(new Set(ids)).filter(id => { const q = BASE_QUESTIONS.find(x => x.id === id); return q && q._stub; });
    for(let i = 0; i < need.length; i += 25){
      const batch = need.slice(i, i + 25);
      const r = await supabaseClient.rpc('get_saved_question', { p_ids: batch });
      if(r.error) throw r.error;
      const got = {}; (srvParse(r.data) || []).forEach(it => { got[it.id] = it; });
      batch.forEach(id => {
        const q = BASE_QUESTIONS.find(x => x.id === id); if(!q) return;
        const it = got[id];
        if(it) Object.assign(q, { question: it.question, options: it.options, correct: it.correct, explanation: it.explanation || '', rule: it.rule, domain: it.domain });
        else q._unavailable = true;
        delete q._stub;
      });
    }
    return;
  }
  const need = Array.from(new Set(ids)).filter(id => BANK_INDEX[id] && BANK_INDEX[id]._stub);
  for(let i = 0; i < need.length; i += 40){
    const data = await bankInvoke({ action: 'get', ids: need.slice(i, i + 40) });
    ((data && data.questions) || []).forEach(item => {
      const q = BANK_INDEX[item.id]; if(!q) return;
      Object.assign(q, item, { id: q.id, source: 'base', domain: 'law' });
      if(!q.difficulty) q.difficulty = 'normal';
      delete q._stub;
    });
  }
}
function bankReady(list){
  if(!BANK_SERVER && !BANK_INDEX_MODE) return Promise.resolve(true);
  const ids = (list || []).map(x => typeof x === 'string' ? x : x.id);
  return ensureBankContent(ids).then(() => true, e => {
    STATE.toast = (e && e.userMessage) ? e.userMessage : 'No se pudieron cargar las preguntas. Int\u00e9ntalo de nuevo.';
    render(); return false;
  });
}
let BANK_LAZY_BUSY = false;
function bankLazy(ids){
  if(BANK_LAZY_BUSY) return; BANK_LAZY_BUSY = true;
  bankReady(ids).then(ok => { BANK_LAZY_BUSY = false; if(ok) render(); });
}
/* ---- Fase B · modo ÍNDICE: la app NO recibe el banco, solo id/regla/ámbito/dificultad (get_question_index).
   El texto de las preguntas llega únicamente dentro de los tests (start_test) o, en Guardadas, de get_saved_question.
   Se activa con app.html?srv=2 (prueba, también para administradores) o, al hacer el corte, con SRV_ALL_USERS = true
   (todos los usuarios que no son administradores). */
let BANK_INDEX_MODE = false;
async function loadBankIndex(){
  const rows = [];
  for(let from = 0; ; from += 1000){          /* PostgREST corta a 1000 filas: se pide por tramos */
    const r = await supabaseClient.rpc('get_question_index').order('id').range(from, from + 999);
    if(r.error) throw r.error;
    (r.data || []).forEach(q => rows.push(q));
    if(!r.data || r.data.length < 1000) break;
  }
  if(!rows.length) throw new Error('indice vacio');
  rows.forEach(q => BASE_QUESTIONS.push({ id: q.id, rule: q.rule, num: q.id, difficulty: q.difficulty || 'normal', source: 'base', domain: q.domain || 'law',
    question: '', options: [], correct: null, explanation: '', _stub: true }));
  BASE_ID_SET = null; BANK_INDEX_MODE = true; BANK.source = 'servidor (índice)'; BANK.ready = true;
  console.info('Banco de preguntas: solo índice (' + rows.length + ' preguntas, sin texto)');
}
async function loadBaseBank(){
  if(BANK.ready) return true;
  const admin = await bankIsAdmin();
  if(srvFlag() === '2' || srvFlag() === '3' || (SRV_ALL_USERS && !admin)){
    try{ await loadBankIndex(); return true; }
    catch(e){ console.warn('No se pudo cargar el índice del banco', e); return false; }
  }
  let wantServer = BANK_ROLLOUT_ALL ? !admin : false;
  try{
    // app.html?bank=1 activa el modo servidor en ESTE navegador para probarlo (con cualquier cuenta); ?bank=0 lo desactiva.
    const qp = new URLSearchParams(location.search).get('bank');
    if(qp === '1') localStorage.setItem('weref_bank_server', '1');
    if(qp === '0') localStorage.removeItem('weref_bank_server');
    if(localStorage.getItem('weref_bank_server') === '1') wantServer = true;
  }catch(e){}
  if(wantServer){
    try{
      const data = await bankInvoke({ action: 'index' });
      const rows = (data && data.questions) || [];
      if(rows.length){
        rows.forEach(q => {
          const s = { id: q.id, rule: q.rule, num: q.num, difficulty: q.difficulty || 'normal', source: 'base', domain: 'law', question: '', options: [], correct: null, explanation: '', _stub: true };
          BASE_QUESTIONS.push(s); BANK_INDEX[s.id] = s;
        });
        BANK_SERVER = true; BANK.source = 'servidor'; BASE_ID_SET = null; BANK.ready = true;
        console.info('Banco de preguntas: servidor, por lotes');
        return true;
      }
    }catch(e){ console.warn('Banco por lotes no disponible, se usa el archivo', e); }
  }
  let list = null;
  try{
    const { data, error } = await supabaseClient.storage.from('bank').download('base-questions.json');
    if(!error && data){ const l = JSON.parse(await data.text()); if(Array.isArray(l) && l.length) { list = l; BANK.source = 'privado'; } }
  }catch(e){}
  if(!list) return false;
  list.forEach(q => { q.id = 'R'+q.rule+'-'+q.num; q.source = 'base'; q.domain = 'law'; if(!q.difficulty) q.difficulty = 'normal'; q.question = capFirst(q.question); q.options = capOptions(q.options); BASE_QUESTIONS.push(q); });
  BASE_ID_SET = null; BANK.ready = true;
  console.info('Banco de preguntas: ' + BANK.source);
  return true;
}

/* Uso del banco (solo maestro con 2FA): quién se acerca al límite de 300 preguntas nuevas en 24 h y cuántas distintas ha visto cada uno. */
async function loadBankUsage(pct){
  const b = STATE.bankUsage = STATE.bankUsage || { rows: null, loading: false, error: '', pct: 80 };
  if(pct != null) b.pct = pct;
  b.loading = true; b.error = ''; render();
  try{
    const r = await supabaseClient.rpc('bank_usage_admin', { p_min_pct: b.pct });
    if(r.error) throw r.error;
    b.rows = r.data || [];
  }catch(e){
    b.rows = null;
    b.error = /Solo el maestro/.test(String((e && e.message) || '')) ? 'Solo el maestro con la verificación en dos pasos puede ver esto.' : 'No se pudo cargar el uso del banco.';
  }
  b.loading = false; render();
}
function bankUsageCardHtml(){
  if(!isMaster()) return '';
  const b = STATE.bankUsage || { rows: null, loading: false, error: '', pct: 80 };
  const ic = (n) => shellIcon(n);
  const chip = (v, label) => `<button type="button" class="ct-chip ${b.pct === v ? 'on' : ''}" data-action="bank-usage-pct" data-v="${v}" aria-pressed="${b.pct === v}">${label}</button>`;
  const th = 'text-align:left; padding:8px 10px; font-size:12px; color:var(--c-muted); font-weight:600; border-bottom:1px solid var(--c-line);';
  const td = 'padding:8px 10px; border-bottom:1px solid var(--c-line); font-size:13.5px; vertical-align:middle;';
  const fmt = (t) => { try{ return t ? new Date(t).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }catch(e){ return '—'; } };
  let body;
  if(b.loading && !b.rows) body = '<div class="st-note">Cargando…</div>';
  else if(b.error) body = `<div class="st-note">${esc(b.error)}</div>`;
  else if(!b.rows) body = '<div class="st-note">Pulsa «Actualizar» para ver el uso.</div>';
  else if(!b.rows.length) body = `<div class="st-note">${ic('check')} Nadie ha llegado al ${b.pct} % del límite en las últimas 24 horas.</div>`;
  else body = `<div style="overflow:auto;"><table style="width:100%; border-collapse:collapse;">
    <thead><tr><th style="${th}">Usuario</th><th style="${th}">Nuevas 24 h</th><th style="${th}">% del límite</th><th style="${th}">Distintas en total</th><th style="${th}">Tests 24 h</th><th style="${th}">Última vez</th></tr></thead>
    <tbody>${b.rows.map(r => {
      const p = Number(r.porcentaje_del_limite) || 0;
      return `<tr><td style="${td}">${esc(r.email || String(r.user_id).slice(0, 8))}</td>
        <td style="${td}"><b>${Number(r.nuevas_24h) || 0}</b> / 300</td>
        <td style="${td}"><span style="display:inline-block; min-width:48px; font-weight:700; color:${p >= 100 ? 'var(--c-bad)' : p >= 80 ? 'var(--c-action)' : 'var(--c-ink)'};">${p} %</span></td>
        <td style="${td}">${Number(r.distintas_total) || 0}</td>
        <td style="${td}">${Number(r.tests_24h) || 0}</td>
        <td style="${td}">${fmt(r.ultima_vista)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  return `<div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('chart')}</span><div><h3>Uso del banco · últimas 24 h</h3><small>Quién se acerca al límite de 300 preguntas nuevas al día (el límite no se aplica al maestro)</small></div></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
      ${chip(80, '≥ 80 % del límite')}${chip(50, '≥ 50 %')}${chip(0, 'Todos')}
      <button class="btn btn-secondary" data-action="bank-usage-reload" ${b.loading ? 'disabled' : ''} style="margin-left:auto;">${b.loading ? 'Cargando…' : 'Actualizar'}</button>
    </div>
    ${body}
  </div>`;
}
function bankCardHtml(){
  const ic = (n) => shellIcon(n);
  const ok = BANK.ready && (BANK.source === 'privado' || BANK.source === 'servidor' || BANK.source === 'servidor (índice)');
  return `<div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('lock')}</span><div><h3>Banco de preguntas</h3><small>${ok ? 'Protegido: se lee de un almacén privado que solo abre con sesión iniciada.' : 'No se pudo cargar el banco de preguntas.'}</small></div></div>
    <div class="st-note">${ok ? `${ic('check')} Banco privado en uso (${BASE_QUESTIONS.length} preguntas).` : 'Recarga la página. Si sigue igual, revisa que base-questions.json está en Storage > bank.'}</div>
  </div>`;
}
const ASSISTANT_QUESTIONS = (typeof ASSISTANT_QUESTIONS_RAW !== 'undefined') ? ASSISTANT_QUESTIONS_RAW : [];
ASSISTANT_QUESTIONS.forEach(q => { q.id = 'A-'+q.num; q.source = 'base'; q.domain = 'law'; q.rule = 6; if(!q.difficulty) q.difficulty = 'normal'; });

let STATE = {
  view: 'home',
  lawId: null,
  editingId: null,
  dbActive: null,
  dbFull: false,
  dbListMode: false,
  cameFromDb: false,
  quiz: null, // {qids, idx, mode, law, answers:{qid:letter}, instantFeedback, timeSec, remainingSec}
  storage: { progress:{}, failedStreaks:{}, userQuestions:[], saved:{}, edits:{}, reviewed:{}, needsFix:{}, deleted:{}, glossaryQuestions:[], testHistory:[], maxStreak:0, unlockedBadges:{}, dailyGoal:20, crownLevels:{}, heartsRecord:0, suddenDeathRecord:0, timeAttackRecord:0, myBank:[], myBankCategories:[], myDocsFolders:[], myDocs:[] },
  toast: null,
  reviewDetailIdx: null,
  savedBrowseIdx: 0,
  myBankEditingId: null,
  myBankSearch: '',
  myBankViewCategory: null,
  myBankOptionCount: null,
  myBankFormDraft: null,
  myBankCreatingCategory: false,
  myBankTrainCfg: { count: 20, minutes: 20, secondsPerQuestion: 45, timerMode: 'none', categories: [], feedbackMode: 'exam' },
  myBankQuiz: null,
  confirmDeleteMyBankId: null,
  confirmDeleteMyBankCategory: null,
  myDocsCurrentFolder: null,
  myDocsCreatingFolder: false,
  myDocsSearch: '',
  myDocsUploading: false,
  myDocsPreviewId: null,
  myDocsPreviewUrl: null,
  myDocsEditingNotesId: null,
  myDocsRenamingFolderId: null,
  myDocsMovingId: null,
  myDocsMovingFolderId: null,
  calendarAddingEvent: false,
  profileData: null,
  profileSaving: false,
  myDocsSortBy: 'name',
  confirmDeleteMyDocId: null,
  confirmDeleteMyDocFolderId: null,
  trainCfg: { count: 20, minutes: 20, secondsPerQuestion: 45, timerMode: 'total', laws: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,'glossary'], onlyFailed: false, scopeOverride: null, feedbackMode: 'exam', countOther: false, minOther: false, secOther: false },
  ctFrom: null,       // regla desde la que se abrió "Crear test" (para el botón Volver)
  lawMenuOpen: false, // menú ⋯ de la página de una regla
  dbFilter: { search: '', law: 'all', difficulty: 'all', status: 'all', pageSize: 50, myOnly: false, reviewStatus: 'all', reportedOnly: false, duplicatesOnly: false, dateField: 'created', dateFrom: '', dateTo: '', advOpen: null, page: 1 },
  reportedIds: {},
  reports: {},
  reportsLoaded: false,
  suggestions: [],
  adminStats: null,
  adminUsersPage: 1,
  adminUsersFilter: { search: '', status: 'all', role: 'all' },
  confirmDeleteUserId: null,
  leagueBoard: {},      // clasificación por modo (league_board): { hearts: { data, loading, error }, ... }
  leagueMode: null,     // último modo elegido en la League
  dataReady: false,   // true cuando loadStorage() ha terminado: hasta entonces Inicio y el menú lateral muestran skeletons
  confirmDeleteId: null,
  confirmResetLawId: null,
};
let TIMER_HANDLE = null;
let ADMIN_USERS_SEARCH_DEBOUNCE = null;

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}

// Devuelve una copia de la pregunta con las opciones en orden aleatorio y la
// letra "correct" recalculada para seguir apuntando a la respuesta correcta.
// No modifica la pregunta original (el banco/Base de datos debe conservar su
// orden real) — cada intento de test genera su propio orden.
/* Respuestas que dependen del orden: "Las respuestas A y B son correctas" nombra letras, y
   "Ninguna de las anteriores / Todas las respuestas" solo tiene sentido en su sitio. */
const OPT_LETTER_REF = /\b(opci[oó]n(es)?|respuestas?|apartados?)\s+(de respuesta\s+)?["“(]?[a-d]\b|\b[a-d]\)\s*(y|e|,|o)\s*[a-d]\)|(^|[\s(])(la\s+|las\s+)?["“]?[a-d]\)?\s*(,|y|e|o)\s*(la\s+)?["“]?[a-d]\)?\s+(son|es|est[aá]n|pueden|ser[ií]an|cierta|correcta|v[aá]lida)|^\s*(las\s+)?(dos|tres)\s+(primeras|[uú]ltimas|anteriores)|^\s*(la\s+)?primera\s+(y|e)\s+(la\s+)?(segunda|tercera|cuarta|[uú]ltima)\b|^\s*ambas\b.{0,30}(correct|cierta|v[aá]lid)|\bs[oó]lo?\s+(la|las)\s+[a-d]\b|\b(son correctas|es correcta)\s+(la|las)\s+[a-d]\b/i;
const OPT_META = /^\s*(ninguna|ninguno|todas|todos|ambas|las dos|las tres)\b.{0,50}\b(respuestas?|opciones?|anteriores|correct[ao]s?|incorrect[ao]s?|ciert[ao]s?|v[aá]lid[ao]s?)\b|\b(ninguno|ninguna) de (los|las) (objetos|casos|supuestos|otras?)/i;
function optionAnchored(text){ const t = String(text || ''); return t.length < 90 && OPT_META.test(t); }
function questionKeepsOrder(q){ return (q.options || []).some(t => OPT_LETTER_REF.test(String(t || ''))); }
function shuffledQuestionCopy(q){
  const letters = ['a','b','c','d'];
  if(questionKeepsOrder(q)) return Object.assign({}, q);   // sus opciones se citan entre sí: se quedan como están
  const idx = Array.from({length:q.options.length}, (_,i)=>i);
  const free = idx.filter(i => !optionAnchored(q.options[i]));
  const mixed = shuffle(free.slice());
  const order = idx.slice();
  free.forEach((pos, k) => { order[pos] = mixed[k]; });
  const newOptions = order.map(i => q.options[i]);
  const origCorrectIdx = letters.indexOf(q.correct);
  const newCorrect = letters[order.indexOf(origCorrectIdx)];
  return Object.assign({}, q, { options: newOptions, correct: newCorrect });
}

function buildQuizShuffleMap(qids){
  const map = {};
  qids.forEach(qid => {
    const q = allQuestions().find(x=>x.id===qid);
    if(q) map[qid] = shuffledQuestionCopy(q);
  });
  return map;
}

function quizQuestionById(qid, quiz){
  quiz = quiz || STATE.quiz;
  if(quiz && quiz.shuffled && quiz.shuffled[qid]) return quiz.shuffled[qid];
  return allQuestions().find(x=>x.id===qid);
}
function formatTime(sec){
  sec = Math.max(0, sec);
  const m = Math.floor(sec/60), s = sec%60;
  return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function markTimeoutFailed(quiz, qid){
  if(quiz.answers[qid]) return;
  const q = allQuestions().find(x=>x.id===qid);
  if(!q) return;
  STATE.storage.progress[qid] = { correct:false, ts: Date.now() };
  saveProgress();
  updateFailedStreak(qid, false);
  markDayActive();
  if(!quiz.timedOut) quiz.timedOut = {};
  quiz.timedOut[qid] = true;
  checkAndUnlockBadges();
}

function stopTimer(){ if(TIMER_HANDLE){ clearInterval(TIMER_HANDLE); TIMER_HANDLE = null; } }
function startTimer(){
  stopTimer();
  TIMER_HANDLE = setInterval(()=>{
    if(!STATE.quiz){ stopTimer(); return; }
    const quiz = STATE.quiz;
    quiz.remainingSec--;
    const el = document.getElementById('timer-display');
    const lowThreshold = quiz.timerMode==='perQuestion' ? 10 : (quiz.mode==='timeattack' ? 15 : 60);
    if(el){
      el.textContent = formatTime(quiz.remainingSec);
      if(quiz.remainingSec <= lowThreshold) el.classList.add('time-low');
      else el.classList.remove('time-low');
    }
    if(quiz.remainingSec <= 0){
      const isStudyTraining = quiz.mode==='training' && quiz.instantFeedback;
      if(quiz.timerMode==='perQuestion'){
        const qid = quiz.qids[quiz.idx];
        if(quiz.server && isStudyTraining){ stopTimer(); srvTimeout(quiz, qid).then(()=>render()); return; }
        if(quiz.server && !(quiz.idx+1 < quiz.qids.length)){ stopTimer(); srvFinishQuiz('¡Tiempo agotado! Aquí tienes tu resultado.'); return; }
        if(isStudyTraining){
          markTimeoutFailed(quiz, qid);
          stopTimer();
          render();
        } else if(quiz.idx+1 < quiz.qids.length){
          quiz.idx++;
          quiz.remainingSec = quiz.perQSeconds;
          render();
        } else {
          stopTimer();
          recordTestResult(quiz);
          STATE.toast = '¡Tiempo agotado! Aquí tienes tu resultado.';
          STATE.view = 'result';
          render();
        }
      } else {
        if(quiz.server){ stopTimer(); (isStudyTraining ? srvTimeout(quiz, quiz.qids[quiz.idx]) : Promise.resolve()).then(()=>srvFinishQuiz('¡Tiempo agotado! Aquí tienes tu resultado.')); return; }
        if(isStudyTraining){
          markTimeoutFailed(quiz, quiz.qids[quiz.idx]);
        }
        stopTimer();
        recordTestResult(quiz);
        STATE.toast = '¡Tiempo agotado! Aquí tienes tu resultado.';
        STATE.view = 'result';
        render();
      }
    }
  }, 1000);
}

/* ---------------- BANCO COMPARTIDO (tabla shared_questions) ----------------
   Preguntas añadidas por el administrador + sus cambios sobre las preguntas base
   (editar / eliminar). Lo leen todos los usuarios; solo el administrador escribe. */

/* Cuadro de confirmación propio de la app (sustituye a los avisos del navegador).
   Devuelve una promesa: true = confirmar, false = cancelar. Uso: if(!(await appConfirm({...}))) return; */
let APP_DIALOG_CLOSE = null;
function appDialogClose(){ if(APP_DIALOG_CLOSE) APP_DIALOG_CLOSE(false); }
function appConfirm(o){
  o = o || {};
  return new Promise(resolve => {
    appDialogClose();
    const prev = document.getElementById('app-dialog');
    if(prev) prev.remove();
    const lastFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.id = 'app-dialog';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card qz-confirm" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-msg">
      <span class="qz-confirm-ic ${o.danger ? 'danger' : ''}">${shellIcon(o.icon || (o.danger ? 'trash' : 'flag'))}</span>
      <h3 id="app-dialog-title">${esc(o.title || '¿Estás seguro?')}</h3>
      <p id="app-dialog-msg">${esc(o.message || '')}</p>
      <div class="qz-confirm-actions">
        <button type="button" class="btn ${o.danger ? 'btn-danger-solid' : 'btn-primary'}" data-dlg="ok">${esc(o.confirmText || 'Aceptar')}</button>
        <button type="button" class="btn btn-ghost" data-dlg="cancel">${esc(o.cancelText || 'Cancelar')}</button>
      </div>
    </div>`;
    let done = false;
    const finish = (val) => {
      if(done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      if(APP_DIALOG_CLOSE === finish) APP_DIALOG_CLOSE = null;
      modal.remove();
      try{ if(lastFocus && lastFocus.focus) lastFocus.focus(); }catch(e){}
      resolve(val);
    };
    const onKey = (e) => {
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    modal.addEventListener('click', (e) => {
      if(e.target === modal) return finish(false);
      const t = e.target.closest('[data-dlg]');
      if(t) finish(t.dataset.dlg === 'ok');
    });
    APP_DIALOG_CLOSE = finish;
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(modal);
    const okBtn = modal.querySelector('[data-dlg="ok"]');
    const cancelBtn = modal.querySelector('[data-dlg="cancel"]');
    // En acciones destructivas el foco empieza en "Cancelar" para evitar un Enter accidental.
    (o.danger ? cancelBtn : okBtn).focus();
  });
}
const SHARED = { ready:false, rows:{}, added:[], over:{}, hasDraftCol:false };

/* Número único y permanente de cada pregunta (tabla question_numbers; solo lo ven los administradores).
   Si la tabla aún no está instalada se usa la posición en el banco, como antes. */
const QNUM = { map:{}, ready:false, busy:false, failed:false };
function questionNumber(q, fallback){
  if(!q) return null;
  if(QNUM.map[q.id]) return QNUM.map[q.id];
  return QNUM.failed ? (fallback || null) : null;
}
/* Mapa número -> pregunta (con el mismo criterio que questionNumber). */
function questionsByNumber(){
  const all = allQuestionsAdmin(), out = {};
  all.forEach((q, i) => { const n = questionNumber(q, i + 1); if(n) out[n] = q; });
  return out;
}
async function qnumSync(){
  if(QNUM.busy || QNUM.failed || QNUM.stalled || !isDevUser() || typeof supabaseClient === 'undefined') return;
  if(QNUM.ready && !allQuestionsAdmin().some(q => !QNUM.map[q.id])) return;
  QNUM.busy = true;
  let changed = false;
  try{
    if(!QNUM.ready){
      let from = 0;
      while(true){
        const { data, error } = await supabaseClient.from('question_numbers').select('qid,num').range(from, from + 999);
        if(error) throw error;
        (data || []).forEach(r => { QNUM.map[r.qid] = r.num; });
        if(!data || data.length < 1000) break;
        from += 1000;
      }
      QNUM.ready = true; changed = true;
    }
    const missing = allQuestionsAdmin().filter(q => !QNUM.map[q.id]).map(q => q.id);
    for(let i = 0; i < missing.length; i += 500){
      const { data, error } = await supabaseClient.rpc('assign_question_numbers', { p_qids: missing.slice(i, i + 500) });
      if(error) throw error;
      (data || []).forEach(r => { QNUM.map[r.out_qid] = r.out_num; });
      changed = true;
    }
    // si el servidor no ha dado número a alguna, no se vuelve a pedir en bucle (cada intento repintaba la pantalla)
    if(missing.length && allQuestionsAdmin().some(q => !QNUM.map[q.id])) QNUM.stalled = true;
  }catch(e){
    QNUM.failed = true; changed = true;
  }
  QNUM.busy = false;
  if(changed && typeof render === 'function' && (STATE.view === 'database' || STATE.view === 'committeeBuilder')) render();
}
let BASE_ID_SET = null;
function baseIdSet(){
  if(!BASE_ID_SET) BASE_ID_SET = new Set(BASE_QUESTIONS.concat(ASSISTANT_QUESTIONS).map(q => q.id));
  return BASE_ID_SET;
}
function sharedActive(){ return SHARED.ready && isDevUser(); }
/* Norma general: toda pregunta y toda respuesta empieza por mayúscula (solo la primera letra; el resto no se toca). */
function capFirst(s){
  if(typeof s !== 'string') return s;
  const m = s.match(/^([\s¿¡“"«]*)([\s\S])([\s\S]*)$/);   // se salta espacios y signos de apertura (¿ ¡ comillas)
  if(!m) return s;
  const up = m[2].toUpperCase();
  return up.length === 1 ? m[1] + up + m[3] : s;
}
function capOptions(o){ return Array.isArray(o) ? o.map(capFirst) : o; }
function sharedNormRow(r){
  return {
    id: r.id, domain: r.domain,
    rule: r.rule == null ? null : r.rule,
    question: r.question == null ? null : capFirst(r.question),
    options: capOptions(r.options) || null,
    correct: r.correct || null,
    explanation: r.explanation == null ? null : r.explanation,
    difficulty: r.difficulty || 'normal',
    deleted: !!r.deleted,
    draft: !!r.draft,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null
  };
}
function sharedRowToQuestion(r){
  return { id:r.id, domain:r.domain, rule: r.rule == null ? null : r.rule, num:r.id, question:capFirst(r.question || ''),
    options: capOptions(r.options) || ['','','',''], correct: r.correct || 'a', explanation: r.explanation || '',
    difficulty: r.difficulty || 'normal', source:'user', shared:true, draft: !!r.draft, createdAt: r.created_at || null, updatedAt: r.updated_at || null };
}
function sharedRebuild(){
  const ids = baseIdSet();
  SHARED.added = []; SHARED.over = {};
  Object.values(SHARED.rows).forEach(r => {
    if(ids.has(r.id)) SHARED.over[r.id] = r;
    else if(!r.deleted && r.question) SHARED.added.push(sharedRowToQuestion(r));
  });
}
async function loadSharedQuestions(){
  try{
    let all = [], from = 0;
    while(true){
      const { data, error } = await supabaseClient.from('shared_questions').select('*').range(from, from + 999);
      if(error) throw error;
      all = all.concat(data || []);
      if(!data || data.length < 1000) break;
      from += 1000;
    }
    SHARED.rows = {};
    all.forEach(r => { SHARED.rows[r.id] = r; });
    SHARED.hasDraftCol = all.some(r => Object.prototype.hasOwnProperty.call(r, 'draft'));
    SHARED.ready = true;
  }catch(e){
    // Tabla aún sin instalar o sin conexión: la app sigue con el banco base.
  }
  sharedRebuild();
}
/* Guarda filas en el banco compartido. La parte local es inmediata (síncrona). */
async function sharedSave(rows){
  rows = rows.map(sharedNormRow);
  rows.forEach(r => { SHARED.rows[r.id] = r; });
  sharedRebuild();
  for(let i = 0; i < rows.length; i += 200){
    // Sin el SQL de borradores la columna no existe: solo se envía "draft" cuando se usa de verdad.
    const payload = rows.slice(i, i + 200).map(r => {
      const o = Object.assign({}, r);
      if(!SHARED.hasDraftCol && !o.draft) delete o.draft;
      return o;
    });
    const { error } = await supabaseClient.from('shared_questions').upsert(payload, { onConflict: 'id' });
    if(error){
      STATE.toast = /draft/.test(error.message || '')
        ? 'Falta ejecutar el SQL question-draft.sql en Supabase para poder retirar preguntas del juego.'
        : 'No se pudo guardar en el banco compartido. Inténtalo de nuevo.';
      await loadSharedQuestions(); render();
      return false;
    }
  }
  return true;
}
async function sharedDelete(ids){
  ids.forEach(id => { delete SHARED.rows[id]; });
  sharedRebuild();
  const { error } = await supabaseClient.from('shared_questions').delete().in('id', ids);
  if(error){
    STATE.toast = 'No se pudo eliminar del banco compartido. Inténtalo de nuevo.';
    await loadSharedQuestions(); render();
    return false;
  }
  return true;
}
/* ---------- Base de datos compartida entre maestro y desarrolladores ----------
   · "Revisada" ya no se guarda en la cuenta de cada persona: vive en la tabla question_reviews, igual para todos.
   · Los cambios de las demás personas (revisar, añadir, editar, quitar, retirar del juego) llegan en directo
     por Realtime; y como respaldo, cada pocos segundos se compara con el servidor por si Realtime no está activado. */
const REV = { ready: false };
const ADMIN_SYNC = { started: false, busy: false, rtOk: false, timer: null, renderTimer: null };

async function adminFetchAll(table, cols){
  const out = [];
  for(let from = 0; ; from += 1000){
    const r = await supabaseClient.from(table).select(cols).range(from, from + 999);
    if(r.error) return { error: r.error, data: null };
    out.push.apply(out, r.data || []);
    if(!r.data || r.data.length < 1000) break;
  }
  return { error: null, data: out };
}

/* Lee las revisiones compartidas. Lo que esta cuenta tenía revisado solo para ella se pasa al compartido (una vez). */
async function loadReviews(){
  if(!sharedActive()) return;
  let r = await adminFetchAll('question_reviews', 'qid,reviewed_at,needs_changes');
  REV.fix = !r.error;                                // false mientras falte el SQL de «Necesita cambios»
  if(r.error) r = await adminFetchAll('question_reviews', 'qid,reviewed_at');
  if(r.error){ REV.ready = false; return; }          // el SQL aún no está ejecutado: se sigue como antes
  const remote = {}, fix = {}, known = new Set();
  r.data.forEach(x => { known.add(x.qid); if(x.reviewed_at != null) remote[x.qid] = Number(x.reviewed_at); if(x.needs_changes) fix[x.qid] = true; });
  const local = STATE.storage.reviewed || {};
  const now = Date.now();
  const push = Object.keys(local).filter(id => !known.has(id)).map(id => ({
    qid: id, reviewed_at: Number(local[id]) > 1e11 ? Number(local[id]) : now, updated_at: now
  }));
  for(let i = 0; i < push.length; i += 200){
    const e = await supabaseClient.from('question_reviews').upsert(push.slice(i, i + 200), { onConflict: 'qid' });
    if(e.error){ REV.ready = false; return; }
  }
  push.forEach(x => { remote[x.qid] = x.reviewed_at; });
  STATE.storage.reviewed = remote;
  STATE.storage.needsFix = fix;
  REV.ready = true;
  if(Object.keys(local).length) await storageSet('reviewed', '{}');     // ya no se guarda en la cuenta personal
}

/* Estado de revisión de una pregunta, igual para todos: 'none' (sin revisar), 'reviewed' (revisada) o 'fix' (necesita cambios). */
function dbReviewState(qid){
  if(STATE.storage.reviewed[qid]) return 'reviewed';
  return (STATE.storage.needsFix || {})[qid] ? 'fix' : 'none';
}
function setReviewState(qid, state){
  const ts = Date.now();
  STATE.storage.needsFix = STATE.storage.needsFix || {};
  if(state === 'reviewed') STATE.storage.reviewed[qid] = ts; else delete STATE.storage.reviewed[qid];
  if(state === 'fix' && REV.ready && REV.fix) STATE.storage.needsFix[qid] = true; else delete STATE.storage.needsFix[qid];
  if(REV.ready){
    const row = { qid, reviewed_at: state === 'reviewed' ? ts : null, updated_at: ts };
    if(REV.fix) row.needs_changes = (state === 'fix');          // la columna solo existe si se ha ejecutado el SQL
    supabaseClient.from('question_reviews').upsert(row, { onConflict: 'qid' })
      .then(r => { if(r && r.error){ STATE.toast = 'No se pudo guardar la revisión. Inténtalo de nuevo.'; adminSyncPoll(); } });
  } else {
    saveReviewed();
  }
}
/* Marca o desmarca una pregunta como revisada para todos. */
function setReviewed(qid, on){ setReviewState(qid, on ? 'reviewed' : 'none'); }

/* Repinta la Base de datos con lo nuevo, sin pisar lo que se está escribiendo. */
function adminSyncRender(){
  clearTimeout(ADMIN_SYNC.renderTimer);
  ADMIN_SYNC.renderTimer = setTimeout(function tryRender(){
    if(STATE.view !== 'database') return;
    const a = document.activeElement;
    const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest && a.closest('#app');
    if(STATE.editingId || typing){ ADMIN_SYNC.renderTimer = setTimeout(tryRender, 1500); return; }
    render();
  }, 250);
}
function adminSyncShared(p){
  try{
    if(p.eventType === 'DELETE'){ const id = p.old && p.old.id; if(id) delete SHARED.rows[id]; }
    else if(p.new && p.new.id){ SHARED.rows[p.new.id] = sharedNormRow(p.new); }
    else return;
    sharedRebuild(); adminSyncRender();
  }catch(e){}
}
function adminSyncReview(p){
  try{
    STATE.storage.needsFix = STATE.storage.needsFix || {};
    if(p.eventType === 'DELETE'){ const q = p.old && p.old.qid; if(q){ delete STATE.storage.reviewed[q]; delete STATE.storage.needsFix[q]; } }
    else if(p.new && p.new.qid){
      if(p.new.reviewed_at != null) STATE.storage.reviewed[p.new.qid] = Number(p.new.reviewed_at);
      else delete STATE.storage.reviewed[p.new.qid];
      if(p.new.needs_changes) STATE.storage.needsFix[p.new.qid] = true; else delete STATE.storage.needsFix[p.new.qid];
    } else return;
    adminSyncRender();
  }catch(e){}
}

/* Respaldo: compara con el servidor y trae solo lo que ha cambiado. */
async function adminSyncPoll(){
  if(!sharedActive() || ADMIN_SYNC.busy || document.hidden) return;
  ADMIN_SYNC.busy = true;
  let changed = false;
  try{
    const cols = 'id,updated_at,deleted' + (SHARED.hasDraftCol ? ',draft' : '');
    const rem = await adminFetchAll('shared_questions', cols);
    if(!rem.error){
      const remoteIds = new Set(rem.data.map(r => r.id));
      const need = [];
      rem.data.forEach(r => {
        const l = SHARED.rows[r.id];
        if(!l || (l.updated_at || null) !== (r.updated_at || null) || !!l.deleted !== !!r.deleted || (SHARED.hasDraftCol && !!l.draft !== !!r.draft)) need.push(r.id);
      });
      Object.keys(SHARED.rows).forEach(id => { if(!remoteIds.has(id)){ delete SHARED.rows[id]; changed = true; } });
      for(let i = 0; i < need.length; i += 100){
        const q = await supabaseClient.from('shared_questions').select('*').in('id', need.slice(i, i + 100));
        if(!q.error) (q.data || []).forEach(r => { SHARED.rows[r.id] = sharedNormRow(r); changed = true; });
      }
      if(changed) sharedRebuild();
    }
    loadQuestionReports(true);
    if(REV.ready){
      const rv = await adminFetchAll('question_reviews', REV.fix ? 'qid,reviewed_at,needs_changes' : 'qid,reviewed_at');
      if(!rv.error){
        const next = {}, nextFix = {};
        rv.data.forEach(x => { if(x.reviewed_at != null) next[x.qid] = Number(x.reviewed_at); if(x.needs_changes) nextFix[x.qid] = true; });
        const cur = STATE.storage.reviewed || {}, curFix = STATE.storage.needsFix || {};
        const a = Object.keys(next), b = Object.keys(cur), c = Object.keys(nextFix), d = Object.keys(curFix);
        if(a.length !== b.length || a.some(k => cur[k] !== next[k])){ STATE.storage.reviewed = next; changed = true; }
        if(c.length !== d.length || c.some(k => !curFix[k])){ STATE.storage.needsFix = nextFix; changed = true; }
      }
    }
  }catch(e){}
  ADMIN_SYNC.busy = false;
  if(changed) adminSyncRender();
}
function adminSyncSchedule(){
  clearTimeout(ADMIN_SYNC.timer);
  // con Realtime activo basta una comprobación tranquila; sin él, una cada 15 segundos
  ADMIN_SYNC.timer = setTimeout(async () => { await adminSyncPoll(); adminSyncSchedule(); }, ADMIN_SYNC.rtOk ? 60000 : 15000);
}
function startAdminSync(){
  if(ADMIN_SYNC.started || !sharedActive()) return;
  ADMIN_SYNC.started = true;
  try{
    const ch = supabaseClient.channel('weref-admin-sync');
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'shared_questions' }, adminSyncShared);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'question_reviews' }, adminSyncReview);
    // Avisos de usuarios: un aviso nuevo o descartado se ve en todas las cuentas admin.
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'question_reports' }, () => {
      clearTimeout(ADMIN_SYNC.repTimer);
      ADMIN_SYNC.repTimer = setTimeout(() => loadQuestionReports(true), 400);
    });
    ch.subscribe((status) => { ADMIN_SYNC.rtOk = (status === 'SUBSCRIBED'); });
    ADMIN_SYNC.ch = ch;
  }catch(e){ ADMIN_SYNC.rtOk = false; }
  document.addEventListener('visibilitychange', () => { if(!document.hidden) adminSyncPoll(); });
  adminSyncSchedule();
}

/* Fila para una pregunta (nueva o editada) con los campos del formulario. */
function sharedRowFor(qid, domain, f, createdAt){
  const ex = SHARED.rows[qid];
  return sharedNormRow({
    id: qid, domain, rule: domain === 'law' ? f.rule : null,
    question: f.question, options: f.options, correct: f.correct,
    explanation: f.explanation || '', difficulty: f.difficulty || 'normal', deleted: false,
    draft: !!(ex && ex.draft),
    created_at: (ex && ex.created_at) || createdAt || Date.now(), updated_at: Date.now()
  });
}
/* Pasa al banco compartido lo que el administrador tenía guardado solo en su cuenta. */
async function sharedMigrateLocal(){
  if(!sharedActive()) return;
  const st = STATE.storage;
  const edits = st.edits || {}, del = st.deleted || {};
  const userQs = (st.userQuestions || []).concat(st.glossaryQuestions || []);
  if(!userQs.length && !Object.keys(edits).length && !Object.keys(del).length) return;
  const baseById = {};
  BASE_QUESTIONS.concat(ASSISTANT_QUESTIONS).forEach(q => { baseById[q.id] = q; });
  const rows = [];
  userQs.forEach(q => {
    if(del[q.id]) return;
    const m = Object.assign({}, q, edits[q.id] || {});
    rows.push({ id:q.id, domain:q.domain, rule: q.domain === 'law' ? m.rule : null, question:m.question, options:m.options,
      correct:m.correct, explanation:m.explanation || '', difficulty:m.difficulty || 'normal', deleted:false,
      created_at: q.createdAt || Date.now(), updated_at: m.updatedAt || q.createdAt || Date.now() });
  });
  Object.keys(edits).forEach(id => {
    const b = baseById[id]; if(!b) return;
    const e = edits[id];
    rows.push({ id, domain:b.domain, rule: b.domain === 'law' ? (e.rule != null ? e.rule : b.rule) : null, question:e.question, options:e.options,
      correct:e.correct, explanation:e.explanation || '', difficulty:e.difficulty || 'normal', deleted: !!del[id],
      created_at: null, updated_at: e.updatedAt || Date.now() });
  });
  Object.keys(del).forEach(id => {
    if(baseById[id] && !edits[id]) rows.push({ id, domain:baseById[id].domain, deleted:true, updated_at: Date.now() });
  });
  if(rows.length){
    const ok = await sharedSave(rows);
    if(!ok) return;
  }
  st.userQuestions = []; st.glossaryQuestions = []; st.edits = {}; st.deleted = {};
  saveUserQuestions(); saveGlossaryQuestions(); saveEdits(); saveDeleted();
  if(rows.length) STATE.toast = 'Tus preguntas y cambios ya están en el banco compartido: ahora los ven todos los usuarios.';
}

/* Todas las preguntas, incluidas las del Reglament General FCF (solo para administradores: Base de datos y tests del comité). */
function allQuestionsAdmin(){
  const combined = BASE_QUESTIONS.concat(ASSISTANT_QUESTIONS).concat(SHARED.added).concat(STATE.storage.userQuestions || []).concat(STATE.storage.glossaryQuestions || []);
  return combined
    .filter(q => {
      const o = SHARED.over[q.id];
      if(o && o.deleted) return false;
      return !(STATE.storage.deleted && STATE.storage.deleted[q.id]);
    })
    .map(q => {
      let r = q;
      const o = SHARED.over[q.id];
      if(o){
        const f = {};
        if(o.question != null) f.question = capFirst(o.question);
        if(o.options) f.options = capOptions(o.options);
        if(o.correct) f.correct = o.correct;
        if(o.explanation != null) f.explanation = o.explanation;
        if(o.difficulty) f.difficulty = o.difficulty;
        if(o.domain && o.domain !== q.domain){
          // La pregunta se movió de ámbito (por ejemplo, de una regla a Asistentes): fuera de las reglas no lleva número de regla.
          f.domain = o.domain;
          f.rule = o.domain === 'law' ? (o.rule != null ? o.rule : q.rule) : null;
        } else if(o.domain === 'law' && o.rule != null) f.rule = o.rule;
        if(o.updated_at) f.updatedAt = o.updated_at;
        if(o.draft) f.draft = true;
        r = Object.assign({}, q, f);
      }
      const e = STATE.storage.edits && STATE.storage.edits[q.id];
      const out = e ? Object.assign({}, r, e) : r;
      // La sala «Árbitros Asistentes» ya no existe: sus preguntas pertenecen a la Regla 6.
      return out.domain === 'assistants' ? Object.assign({}, out, { domain: 'law', rule: 6 }) : out;
    });
}
/* Lo que ve la web: sin las preguntas del Reglament General FCF ni las retiradas del juego. */
function allQuestions(){ return allQuestionsAdmin().filter(q => q.domain !== 'fcf' && !q.draft); }
function questionsForLaw(law){
  if(law === 'hard') return allQuestions().filter(q => q.difficulty === 'hard');
  if(law === 'failed') return allQuestions().filter(q => isFailedQuestion(q));
  if(law === 'glossary') return allQuestions().filter(q => q.domain === 'glossary');
  if(law === 'assistants') return allQuestions().filter(q => q.domain === 'assistants');
  if(law === 'saved') return allQuestions().filter(q => !!STATE.storage.saved[q.id]);
  return allQuestions().filter(q => q.domain!=='glossary' && q.rule === law);
}

/* ---- Fase B · f3: el progreso vive en el SERVIDOR (user_progress, user_failed, user_tests, user_crowns, user_days, user_badges, user_stats).
   La app lo lee de ahí al cargar y ya no lo escribe en user_data (lo escriben las funciones del servidor al contestar y terminar tests).
   Si la lectura falla, se avisa al usuario (ya no hay respaldo en user_data: esas claves se borraron). */
const SERVER_PROGRESS_KEYS = new Set(['progress', 'failedStreaks', 'testHistory', 'crownLevels', 'activeDays', 'unlockedBadges', 'maxStreak',
  'pointsCorrectOffset', 'heartsRecord', 'suddenDeathRecord', 'timeAttackRecord']);
const SERVER_PROGRESS_ALL = true;   /* f3: se pondrá a true al publicar el cambio general, tras repetir la migración. Con ?srv=3 se prueba en un solo navegador. */
function srvProgressOn(){ return SERVER_PROGRESS_ALL || srvFlag() === '3'; }
let SERVER_PROGRESS_ON = false;
async function srvPage(table, cols, order){
  const out = [];
  for(let from = 0; ; from += 1000){          /* PostgREST corta a 1000 filas: se pide por tramos */
    const r = await supabaseClient.from(table).select(cols).order(order).range(from, from + 999);
    if(r.error) throw r.error;
    (r.data || []).forEach(x => out.push(x));
    if(!r.data || r.data.length < 1000) break;
  }
  return out;
}
async function loadServerProgress(){
  try{
    const [prog, fail, tests, crowns, days, badges, st] = await Promise.all([
      srvPage('user_progress', 'qid,correct,ts', 'qid'), srvPage('user_failed', 'qid,streak', 'qid'),
      srvPage('user_tests', 'finished_at,mode,score,total,pct,by_rule', 'finished_at'), srvPage('user_crowns', 'rule,level', 'rule'),
      srvPage('user_days', 'day', 'day'), srvPage('user_badges', 'badge,unlocked_at', 'badge'),
      supabaseClient.from('user_stats').select('*').maybeSingle()
    ]);
    if(st.error) throw st.error;
    const d = { progress: {}, failedStreaks: {}, testHistory: [], crownLevels: {}, activeDays: {}, unlockedBadges: {} };
    prog.forEach(r => { d.progress[r.qid] = { correct: !!r.correct, ts: Date.parse(r.ts) }; });
    fail.forEach(r => { d.failedStreaks[r.qid] = r.streak; });
    d.testHistory = tests.map(r => ({ date: Date.parse(r.finished_at), score: r.score, total: r.total, pct: r.pct, mode: r.mode, byRule: r.by_rule || {} }));
    crowns.forEach(r => { d.crownLevels[r.rule] = r.level; });
    days.forEach(r => { const p = String(r.day).split('-').map(Number); d.activeDays[p[0] + '-' + p[1] + '-' + p[2]] = true; });
    badges.forEach(r => { d.unlockedBadges[r.badge] = Date.parse(r.unlocked_at) || Date.now(); });
    const s = st.data || {};
    d.maxStreak = s.max_streak || 0; d.pointsCorrectOffset = s.points_offset || 0;
    d.heartsRecord = Number(s.hearts_record || 0); d.suddenDeathRecord = Number(s.suddendeath_record || 0); d.timeAttackRecord = Number(s.timeattack_record || 0);
    /* cuenta sin datos en el servidor: se devuelve null (progreso vacío) */
    if(!prog.length && !tests.length && !days.length) return null;
    return d;
  }catch(e){ console.warn('No se pudo leer el progreso del servidor', e); return false; }
}
async function storageGet(key){
  if(SERVER_PROGRESS_ON && SERVER_PROGRESS_KEYS.has(key)) return null;
  try{ const r = await window.storage.get(key); return r ? r.value : null; }catch(e){ return null; }
}
async function storageSet(key, value){
  if(SERVER_PROGRESS_KEYS.has(key)) return;     /* el progreso lo escribe solo el servidor; la base de datos también bloquea estas claves */
  try{ await window.storage.set(key, value); }catch(e){}
}

async function loadStorage(){
  window.__stage = 'tu rol'; await loadUserRole();
  window.__stage = 'el banco de preguntas';
  if(!(await loadBaseBank())) STATE.toast = 'No se pudo cargar el banco de preguntas. Recarga la página.';
  window.__stage = 'las preguntas compartidas';
  if(BANK_INDEX_MODE) sharedRebuild();     /* modo índice: los cambios y preguntas añadidas ya vienen en el índice del servidor */
  else await loadSharedQuestions();
  window.__stage = 'tus datos (progreso, coronas...)';
  const SRVD = srvProgressOn() ? await loadServerProgress() : null;      /* objeto = datos; null = cuenta sin datos; false = error de lectura */
  SERVER_PROGRESS_ON = srvProgressOn();                                   /* el servidor manda aunque la cuenta aún no tenga datos */
  try{ const v = await storageGet('userQuestions'); STATE.storage.userQuestions = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.userQuestions = []; }
  try{ const v = await storageGet('saved'); STATE.storage.saved = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.saved = {}; }
  try{ const v = await storageGet('edits'); STATE.storage.edits = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.edits = {}; }
  try{ const v = await storageGet('reviewed'); STATE.storage.reviewed = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.reviewed = {}; }
  try{ const v = await storageGet('deleted'); STATE.storage.deleted = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.deleted = {}; }
  try{ const v = await storageGet('dailyGoal'); STATE.storage.dailyGoal = v ? JSON.parse(v) : 20; }catch(e){ STATE.storage.dailyGoal = 20; }
  try{ const v = await storageGet('glossaryQuestions'); STATE.storage.glossaryQuestions = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.glossaryQuestions = []; }
  try{ const v = await storageGet('myBank'); STATE.storage.myBank = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myBank = []; }
  try{ const v = await storageGet('myBankCategories'); STATE.storage.myBankCategories = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myBankCategories = []; }
  try{ const v = await storageGet('myDocsFolders'); STATE.storage.myDocsFolders = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myDocsFolders = []; }
  try{ const v = await storageGet('myDocs'); STATE.storage.myDocs = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myDocs = []; }
  try{ const v = await storageGet('calendarEvents'); STATE.storage.calendarEvents = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.calendarEvents = []; }
  /* f3: el progreso es SOLO el del servidor (las claves antiguas de user_data ya no existen).
     Cuenta sin datos = vacío; si falla la lectura (red), se avisa en vez de enseñar ceros en silencio. */
  Object.assign(STATE.storage, { progress: {}, failedStreaks: {}, testHistory: [], maxStreak: 0, unlockedBadges: {}, crownLevels: {},
    heartsRecord: 0, suddenDeathRecord: 0, timeAttackRecord: 0, activeDays: {}, pointsCorrectOffset: 0 }, SRVD || {});
  if(SRVD === false) STATE.toast = 'No se pudo cargar tu progreso. Recarga la página.';
  {
    // Compatibilidad con la versión anterior (categoría como texto libre sin lista propia):
    // si alguna pregunta tiene una categoría que ya no está en la lista, la recuperamos
    // para que no se quede "huérfana" sin aparecer en ningún sitio.
    const known = new Set(STATE.storage.myBankCategories);
    let missing = false;
    STATE.storage.myBank.forEach(q=>{
      if(q.category && !known.has(q.category)){ known.add(q.category); missing = true; }
    });
    if(missing){ STATE.storage.myBankCategories = Array.from(known); saveMyBankCategories(); }
  }
  STATE.storage.userQuestions.forEach(q=>{ if(!q.id) q.id = 'U'+Math.random().toString(36).slice(2,9); q.source='user'; q.domain='law'; });
  STATE.storage.glossaryQuestions.forEach(q=>{ if(!q.id) q.id = 'G'+Math.random().toString(36).slice(2,9); q.source='user'; q.domain='glossary'; });
  {
    // Preguntas propias creadas antes de que existiera el campo de fecha: les asignamos
    // como fecha de creación el 08/08/2026, ya que no tenemos el dato real.
    const BACKFILL_CREATED_AT = 1786183200000;
    let backfilled = false;
    STATE.storage.userQuestions.forEach(q=>{ if(!q.createdAt){ q.createdAt = BACKFILL_CREATED_AT; backfilled = true; } });
    STATE.storage.glossaryQuestions.forEach(q=>{ if(!q.createdAt){ q.createdAt = BACKFILL_CREATED_AT; backfilled = true; } });
    if(backfilled){ saveUserQuestions(); saveGlossaryQuestions(); }
  }
  window.__stage = 'migración de datos'; await sharedMigrateLocal();
  window.__stage = 'revisiones'; 
  await loadReviews();
  window.__stage = 'final';
  startAdminSync();
  pruneSavedStale();
  checkAndUnlockBadges();
  loadGami();
  STATE.dataReady = true;
  navInit();
  render();
}
async function saveProgress(){ await storageSet('progress', JSON.stringify(STATE.storage.progress)); }
async function saveFailedStreaks(){ await storageSet('failedStreaks', JSON.stringify(STATE.storage.failedStreaks)); }

// Cada pregunta que entra en la Sala de Repaso necesita 3 aciertos SEGUIDOS para salir de ahí
// (un fallo en cualquier momento reinicia el contador a 0). Mientras tenga una entrada en
// failedStreaks (0, 1 o 2) sigue perteneciendo al modo "Preguntas falladas"; al llegar a 3
// se elimina la entrada y la pregunta "se gradúa".
function updateFailedStreak(qid, correct){
  if(!STATE.storage.failedStreaks) STATE.storage.failedStreaks = {};
  if(!correct){
    STATE.storage.failedStreaks[qid] = 0;
  } else if(Object.prototype.hasOwnProperty.call(STATE.storage.failedStreaks, qid)){
    const next = STATE.storage.failedStreaks[qid] + 1;
    if(next >= 3) delete STATE.storage.failedStreaks[qid];
    else STATE.storage.failedStreaks[qid] = next;
  }
  saveFailedStreaks();
}
async function saveActiveDays(){ await storageSet('activeDays', JSON.stringify(STATE.storage.activeDays)); }
async function savePointsCorrectOffset(){ await storageSet('pointsCorrectOffset', JSON.stringify(STATE.storage.pointsCorrectOffset)); }
function markDayActive(){
  const key = dayKey(Date.now());
  if(!STATE.storage.activeDays[key]){
    STATE.storage.activeDays[key] = true;
    saveActiveDays();
  }
}
async function saveUserQuestions(){ await storageSet('userQuestions', JSON.stringify(STATE.storage.userQuestions)); }
/* Guardadas: las escrituras van de una en una y siempre con el estado más reciente, así borrar varias seguidas no deja que una copia vieja llegue la última y resucite lo borrado. */
let SAVED_BUSY = false, SAVED_AGAIN = false;
async function saveSaved(){
  if(SAVED_BUSY){ SAVED_AGAIN = true; return; }
  SAVED_BUSY = true;
  try{ do{ SAVED_AGAIN = false; await storageSet('saved', JSON.stringify(STATE.storage.saved)); }while(SAVED_AGAIN); }
  finally{ SAVED_BUSY = false; }
}
/* Ids guardados que siguen siendo preguntas que existen y se ven en el juego. */
function savedValidIds(){
  const ok = new Set(allQuestions().map(q => q.id));
  return Object.keys(STATE.storage.saved || {}).filter(id => ok.has(id));
}
/* Quita de Guardadas lo que apunta a preguntas que ya no existen (eliminadas): no se pueden ver ni borrar a mano. */
function pruneSavedStale(){
  const all = new Set(allQuestionsAdmin().map(q => q.id));
  let changed = false;
  Object.keys(STATE.storage.saved || {}).forEach(id => { if(!all.has(id)){ delete STATE.storage.saved[id]; changed = true; } });
  if(changed) saveSaved();
}
async function saveEdits(){ await storageSet('edits', JSON.stringify(STATE.storage.edits)); }
async function saveReviewed(){ if(REV.ready) return; await storageSet('reviewed', JSON.stringify(STATE.storage.reviewed)); }
async function saveGlossaryQuestions(){ await storageSet('glossaryQuestions', JSON.stringify(STATE.storage.glossaryQuestions)); }
async function saveMyBank(){ await storageSet('myBank', JSON.stringify(STATE.storage.myBank)); }
async function saveMyBankCategories(){ await storageSet('myBankCategories', JSON.stringify(STATE.storage.myBankCategories)); }
async function saveCalendarEvents(){ await storageSet('calendarEvents', JSON.stringify(STATE.storage.calendarEvents)); }

const CALENDAR_EVENTS_MAX = 10;

function calendarSaveEvent(){
  const dateVal = document.getElementById('cal-event-date').value;
  const title = document.getElementById('cal-event-title').value.trim();
  const type = document.getElementById('cal-event-type').value;
  if((STATE.storage.calendarEvents||[]).length >= CALENDAR_EVENTS_MAX){ STATE.toast = `Solo puedes tener ${CALENDAR_EVENTS_MAX} eventos a la vez. Elimina alguno para añadir otro.`; render(); return; }
  if(!dateVal){ STATE.toast = 'Elige una fecha para el evento.'; render(); return; }
  if(!title){ STATE.toast = 'Escribe un título para el evento.'; render(); return; }
  STATE.storage.calendarEvents.push({
    id: 'EV'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
    date: dateVal, title, type: CALENDAR_EVENT_TYPES[type] ? type : 'other'
  });
  saveCalendarEvents();
  STATE.calendarAddingEvent = false;
  render();
}

function calendarDeleteEvent(id){
  STATE.storage.calendarEvents = (STATE.storage.calendarEvents||[]).filter(ev=>ev.id!==id);
  saveCalendarEvents();
  render();
}
async function saveMyDocsFolders(){ await storageSet('myDocsFolders', JSON.stringify(STATE.storage.myDocsFolders)); }
async function saveMyDocs(){ await storageSet('myDocs', JSON.stringify(STATE.storage.myDocs)); }
async function saveDeleted(){ await storageSet('deleted', JSON.stringify(STATE.storage.deleted)); }
async function saveTestHistory(){ await storageSet('testHistory', JSON.stringify(STATE.storage.testHistory)); }
async function saveGamification(){
  await storageSet('maxStreak', JSON.stringify(STATE.storage.maxStreak));
  await storageSet('unlockedBadges', JSON.stringify(STATE.storage.unlockedBadges));
}
async function saveDailyGoal(){ await storageSet('dailyGoal', JSON.stringify(STATE.storage.dailyGoal)); }
async function saveCrownLevels(){ await storageSet('crownLevels', JSON.stringify(STATE.storage.crownLevels)); }
async function saveHeartsRecord(){ await storageSet('heartsRecord', JSON.stringify(STATE.storage.heartsRecord)); }
async function saveSuddenDeathRecord(){ await storageSet('suddenDeathRecord', JSON.stringify(STATE.storage.suddenDeathRecord)); }
async function saveTimeAttackRecord(){ await storageSet('timeAttackRecord', JSON.stringify(STATE.storage.timeAttackRecord)); }

const COUNTRY_FLAGS = {
  'Alemania':'🇩🇪','Andorra':'🇦🇩','Argelia':'🇩🇿','Argentina':'🇦🇷','Australia':'🇦🇺','Austria':'🇦🇹',
  'Bélgica':'🇧🇪','Bolivia':'🇧🇴','Brasil':'🇧🇷','Canadá':'🇨🇦','Chile':'🇨🇱','China':'🇨🇳',
  'Colombia':'🇨🇴','Corea del Sur':'🇰🇷','Costa Rica':'🇨🇷','Cuba':'🇨🇺','Dinamarca':'🇩🇰','Ecuador':'🇪🇨',
  'Egipto':'🇪🇬','El Salvador':'🇸🇻','España':'🇪🇸','Estados Unidos':'🇺🇸','Filipinas':'🇵🇭','Finlandia':'🇫🇮',
  'Francia':'🇫🇷','Grecia':'🇬🇷','Guatemala':'🇬🇹','Guinea Ecuatorial':'🇬🇶','Holanda (Países Bajos)':'🇳🇱','Honduras':'🇭🇳',
  'India':'🇮🇳','Indonesia':'🇮🇩','Irlanda':'🇮🇪','Israel':'🇮🇱','Italia':'🇮🇹','Japón':'🇯🇵',
  'Marruecos':'🇲🇦','México':'🇲🇽','Nicaragua':'🇳🇮','Noruega':'🇳🇴','Nueva Zelanda':'🇳🇿','Panamá':'🇵🇦',
  'Paraguay':'🇵🇾','Perú':'🇵🇪','Polonia':'🇵🇱','Portugal':'🇵🇹','Puerto Rico':'🇵🇷','Reino Unido':'🇬🇧',
  'República Dominicana':'🇩🇴','Rumanía':'🇷🇴','Rusia':'🇷🇺','Suecia':'🇸🇪','Suiza':'🇨🇭','Turquía':'🇹🇷',
  'Ucrania':'🇺🇦','Uruguay':'🇺🇾','Venezuela':'🇻🇪'
};

/* ---------------- WEREF LEAGUE · datos ----------------
   La posición, el top 25 y el "a X pts de ..." salen SIEMPRE de la función league_board del servidor:
   más puntos y, si empatan, quien lo consiguió antes (updated_at más antiguo); cada jugador tiene una posición única.
   Así el mismo #N se ve en la pantalla de la League y en Inicio. */
const LEAGUE_MODES = {
  hearts:      { label: 'Corazones',     short: 'Corazones', icon: 'heart', rules: '3 vidas · sin tiempo',               action: 'start-hearts',      rec: 'heartsRecord' },
  suddendeath: { label: 'Muerte Súbita', short: 'Súbita',    icon: 'zap',   rules: '1 vida · sin tiempo',                action: 'start-suddendeath', rec: 'suddenDeathRecord' },
  timeattack:  { label: 'Contrarreloj',  short: 'Reloj',     icon: 'timer', rules: '60 segundos · cada fallo resta 0,5', action: 'start-timeattack',  rec: 'timeAttackRecord' }
};
/* País (como lo guarda la cuenta) -> código ISO para la bandera SVG de /assets/flags/. Sin país o sin bandera: no se muestra nada. */
const FLAG_ISO = { 'Alemania':'de','Andorra':'ad','Argelia':'dz','Argentina':'ar','Australia':'au','Austria':'at','Bélgica':'be','Bolivia':'bo','Brasil':'br','Canadá':'ca','Chile':'cl','China':'cn','Colombia':'co','Corea del Sur':'kr','Costa Rica':'cr','Cuba':'cu','Dinamarca':'dk','Ecuador':'ec','Egipto':'eg','El Salvador':'sv','España':'es','Estados Unidos':'us','Filipinas':'ph','Finlandia':'fi','Francia':'fr','Grecia':'gr','Guatemala':'gt','Guinea Ecuatorial':'gq','Holanda (Países Bajos)':'nl','Honduras':'hn','India':'in','Indonesia':'id','Irlanda':'ie','Israel':'il','Italia':'it','Japón':'jp','Marruecos':'ma','México':'mx','Nicaragua':'ni','Noruega':'no','Nueva Zelanda':'nz','Panamá':'pa','Paraguay':'py','Perú':'pe','Polonia':'pl','Portugal':'pt','Puerto Rico':'pr','Reino Unido':'gb','República Dominicana':'do','Rumanía':'ro','Rusia':'ru','Suecia':'se','Suiza':'ch','Turquía':'tr','Ucrania':'ua','Uruguay':'uy','Venezuela':'ve' };
/* Puntuaciones de la League con coma decimal (12,5), como en el resto del texto en castellano. */
function lgFmt(n){ return formatScore(n).replace('.', ','); }
function flagHtml(country){
  const iso = FLAG_ISO[country];
  return iso ? `<img class="lg2-flag" src="/assets/flags/${iso}.svg" alt="" width="20" height="15" loading="lazy" decoding="async">` : '';
}
/* El último modo elegido se recuerda en este navegador. */
function leagueMode(){
  let m = STATE.leagueMode;
  if(!LEAGUE_MODES[m]){ try{ m = localStorage.getItem('weref_league_mode'); }catch(e){} }
  return LEAGUE_MODES[m] ? m : 'hearts';
}
function setLeagueMode(m){ if(!LEAGUE_MODES[m]) return; STATE.leagueMode = m; try{ localStorage.setItem('weref_league_mode', m); }catch(e){} }
async function loadLeagueBoard(mode){
  mode = LEAGUE_MODES[mode] ? mode : leagueMode();
  const cur = STATE.leagueBoard[mode];
  if(cur && cur.loading) return;
  STATE.leagueBoard[mode] = { data: (cur && cur.data) || null, loading: true, error: false };
  render();
  try{
    const { data, error } = await supabaseClient.rpc('league_board', { p_mode: mode, p_limit: 25 });
    if(error) throw error;
    STATE.leagueBoard[mode] = { data: (typeof data === 'string') ? JSON.parse(data) : data, loading: false, error: false };
  }catch(e){
    console.warn('league_board', e);
    STATE.leagueBoard[mode] = { data: (cur && cur.data) || null, loading: false, error: true };
  }
  render();
}

/* f3: con el progreso en el servidor, historial, corona, insignias y récord salen de lo que calculó finish_test (no se recalculan aquí). */
function srvApplyResult(quiz){
  const res = quiz.server.result || {};
  if(!STATE.storage.testHistory) STATE.storage.testHistory = [];
  STATE.storage.testHistory.push({ date: Date.now(), score: res.score, total: res.total, pct: res.pct, mode: quiz.mode, byRule: res.per_rule || {} });
  if(STATE.storage.testHistory.length > 100) STATE.storage.testHistory = STATE.storage.testHistory.slice(-100);
  (res.new_badges || []).forEach(id => {
    if(STATE.storage.unlockedBadges[id]) return;
    STATE.storage.unlockedBadges[id] = Date.now();
    const b = BADGES.find(x => x.id === id);
    if(b) STATE.toast = '¡Insignia desbloqueada! ' + b.icon + ' ' + b.name;
  });
  if(res.crown_up && typeof quiz.law === 'number'){
    if(!STATE.storage.crownLevels) STATE.storage.crownLevels = {};
    STATE.storage.crownLevels[quiz.law] = res.crown_level;
    STATE.toast = '👑 ¡Corona subida en Regla ' + quiz.law + '! Nivel ' + res.crown_level + '/4';
  }
  if(isRecordMode(quiz.mode) && res.record){
    const recordKey = quiz.mode === 'hearts' ? 'heartsRecord' : quiz.mode === 'suddendeath' ? 'suddenDeathRecord' : 'timeAttackRecord';
    STATE.lastHeartsResult = { score: res.record.score, isNewRecord: !!res.record.new_record };
    if(res.record.new_record) STATE.storage[recordKey] = res.record.score;
  }
}
function recordTestResult(quiz){
  if(typeof loadGami === 'function') setTimeout(loadGami, 400);   // puntos, rango e insignias nuevos: los calcula el servidor
  STATE.reviewDetailIdx = null;
  if(quiz.server && SERVER_PROGRESS_ON){ srvApplyResult(quiz); return; }
  let score = 0;
  let wrongAnswered = 0;
  const byRule = {};
  quiz.qids.forEach(qid => {
    const q = quizQuestionById(qid, quiz);
    if(!q) return;
    const sel = quiz.answers[qid];
    const isOk = sel === q.correct;
    if(sel){ if(isOk) score++; else wrongAnswered++; }
    if(q.domain === 'law' && q.rule){
      if(!byRule[q.rule]) byRule[q.rule] = {correct:0, total:0};
      byRule[q.rule].total++;
      if(isOk) byRule[q.rule].correct++;
    }
  });
  const total = quiz.qids.length;
  const pct = total ? Math.round(score/total*100) : 0;
  if(!STATE.storage.testHistory) STATE.storage.testHistory = [];
  STATE.storage.testHistory.push({ date: Date.now(), score, total, pct, mode: quiz.mode, byRule });
  if(STATE.storage.testHistory.length > 100) STATE.storage.testHistory = STATE.storage.testHistory.slice(-100);
  saveTestHistory();
  checkAndUnlockBadges();
  if(quiz.mode==='study25' && typeof quiz.law==='number' && pct>=70){
    if(!STATE.storage.crownLevels) STATE.storage.crownLevels = {};
    const cur = STATE.storage.crownLevels[quiz.law] || 0;
    if(cur < 4){
      STATE.storage.crownLevels[quiz.law] = cur + 1;
      STATE.toast = '👑 ¡Corona subida en Regla '+quiz.law+'! Nivel '+(cur+1)+'/4';
      saveCrownLevels();
    }
  }
  if(isRecordMode(quiz.mode)){
    const recordKey = quiz.mode==='hearts' ? 'heartsRecord' : quiz.mode==='suddendeath' ? 'suddenDeathRecord' : 'timeAttackRecord';
    const recordScore = quiz.mode==='timeattack' ? Math.max(0, score - wrongAnswered*0.5) : score;
    const prevRecord = STATE.storage[recordKey] || 0;
    STATE.lastHeartsResult = { score: recordScore, isNewRecord: recordScore > prevRecord };
    if(recordScore > prevRecord){
      STATE.storage[recordKey] = recordScore;
      if(quiz.mode==='hearts') saveHeartsRecord();
      else if(quiz.mode==='suddendeath') saveSuddenDeathRecord();
      else saveTimeAttackRecord();
      /* el ranking lo escribe finish_test en el servidor: el cliente ya no tiene permiso para escribirlo */
    }
  }
}

function weakestRuleRecent(n){
  const hist = (STATE.storage.testHistory || []).slice(-n);
  const agg = {};
  hist.forEach(h => {
    if(!h.byRule) return;
    Object.keys(h.byRule).forEach(rule => {
      if(!agg[rule]) agg[rule] = {correct:0, total:0};
      agg[rule].correct += h.byRule[rule].correct;
      agg[rule].total += h.byRule[rule].total;
    });
  });
  let candidates = Object.keys(agg).map(rule => ({
    rule: parseInt(rule,10),
    total: agg[rule].total,
    correct: agg[rule].correct,
    pct: agg[rule].total ? Math.round(agg[rule].correct/agg[rule].total*100) : 0
  })).filter(c => c.total >= 3);
  if(candidates.length === 0) return null;
  candidates.sort((a,b) => a.pct - b.pct);
  return candidates[0];
}

function dayKey(ts){
  const d = new Date(ts);
  return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
}

function activeDaysSet(){
  return new Set(Object.keys(STATE.storage.activeDays || {}));
}

const PROFILE_COUNTRIES = ['Alemania','Andorra','Argelia','Argentina','Australia','Austria','Bélgica','Bolivia','Brasil','Canadá','Chile','China','Colombia','Corea del Sur','Costa Rica','Cuba','Dinamarca','Ecuador','Egipto','El Salvador','España','Estados Unidos','Filipinas','Finlandia','Francia','Grecia','Guatemala','Guinea Ecuatorial','Holanda (Países Bajos)','Honduras','India','Indonesia','Irlanda','Israel','Italia','Japón','Marruecos','México','Nicaragua','Noruega','Nueva Zelanda','Panamá','Paraguay','Perú','Polonia','Portugal','Puerto Rico','Reino Unido','República Dominicana','Rumanía','Rusia','Suecia','Suiza','Turquía','Ucrania','Uruguay','Venezuela','Otro país'];

const CALENDAR_EVENT_TYPES = {
  exam: { label: 'Examen teórico', icon: '📝', color: '#D62828', bg: '#FBE0E0' },
  physical: { label: 'Prueba física', icon: '🏃', color: '#17181C', bg: '#ECEEF1' },
  meeting: { label: 'Reunión de comité', icon: '👥', color: '#5F6068', bg: '#ECEEF1' },
  other: { label: 'Otro', icon: '📌', color: '#C98A00', bg: '#FBEECB' }
};

function eventDayKey(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return y+'-'+m+'-'+d;
}

function calendarEventsByDay(){
  const map = {};
  (STATE.storage.calendarEvents||[]).forEach(ev=>{
    const key = eventDayKey(ev.date);
    if(!map[key]) map[key] = [];
    map[key].push(ev);
  });
  return map;
}

function todayKeyISO(d){
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const day = String(dt.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

function formatEventDate(dateStr){
  const [y,m,d] = dateStr.split('-').map(Number);
  return d+' '+MONTH_NAMES[m-1]+' '+y;
}

function formatRelativeTime(ts){
  if(!ts || Number(ts) < 1e11) return null;   // sin fecha real (por ejemplo true o 0): no se inventa «hace 57 años»
  const diffMs = Date.now() - Number(ts);
  const diffMin = Math.floor(diffMs/60000);
  if(diffMin < 1) return 'Hace un momento';
  if(diffMin < 60) return `Hace ${diffMin} minuto${diffMin===1?'':'s'}`;
  const diffH = Math.floor(diffMin/60);
  if(diffH < 24) return `Hace ${diffH} hora${diffH===1?'':'s'}`;
  const diffD = Math.floor(diffH/24);
  if(diffD === 1) return 'Ayer';
  if(diffD < 30) return `Hace ${diffD} días`;
  const diffMonths = Math.floor(diffD/30);
  if(diffMonths < 12) return `Hace ${diffMonths} mes${diffMonths===1?'':'es'}`;
  const diffY = Math.floor(diffMonths/12);
  return `Hace ${diffY} año${diffY===1?'':'s'}`;
}

function computeStreak(){
  const days = activeDaysSet();
  if(days.size === 0) return 0;
  let cursor = new Date();
  if(!days.has(dayKey(cursor.getTime()))){
    cursor.setDate(cursor.getDate()-1);
  }
  let streak = 0;
  while(days.has(dayKey(cursor.getTime()))){
    streak++;
    cursor.setDate(cursor.getDate()-1);
  }
  return streak;
}

/* ---------------- GAMIFICACIÓN: puntos, rangos e insignias ----------------
   Todo se calcula en el servidor (get_gamification, finish_test y los disparadores). Aquí solo se leen los valores (ver gami.js). */
function computePoints(){ return STATE.gami ? STATE.gami.points : 0; }
function currentRank(){
  const r = (STATE.gami && STATE.gami.rank) || { ord: 1, name: 'Aprendiz', sub: 1, sub_from: 0 };
  return { name: r.name, level: r.ord, sub: r.sub, label: r.name + ' ' + (['', 'I', 'II', 'III'][r.sub] || 'I'), min: r.sub_from };
}
function nextRankInfo(){ return (typeof gamiNext === 'function') ? gamiNext() : null; }
const BADGES = [];   /* el catálogo de insignias vive en el servidor (badge_defs) */

function buildBadgeContext(){
  const progress = STATE.storage.progress || {};
  const answered = Object.keys(progress).length;
  const points = computePoints();
  const testHistory = STATE.storage.testHistory || [];
  const hasPerfectTest = testHistory.some(h=>h.total>=10 && h.pct===100);
  let hasRuleMastered = false;
  for(let i=1;i<=17;i++){ const s=lawStats(i); if(s.total>0 && s.attempted===s.total && s.accuracyPct>=90){ hasRuleMastered=true; break; } }
  if(!hasRuleMastered){
    const gs = lawStats('glossary');
    if(gs.total>0 && gs.attempted===gs.total && gs.accuracyPct>=90){ hasRuleMastered = true; }
  }
  let allRulesComplete = true;
  for(let i=1;i<=17;i++){ const s=lawStats(i); if(s.total===0 || s.attempted<s.total){ allRulesComplete=false; break; } }
  const failedNow = allQuestions().filter(isFailedQuestion).length;
  const cleanRoom = failedNow===0 && testHistory.length>=5;
  const streakNow = computeStreak();
  if(streakNow > (STATE.storage.maxStreak||0)){ STATE.storage.maxStreak = streakNow; }
  return { answered, points, maxStreak: STATE.storage.maxStreak||0, hasPerfectTest, hasRuleMastered, allRulesComplete, cleanRoom };
}

function checkAndUnlockBadges(){
  const ctx = buildBadgeContext();
  if(SERVER_PROGRESS_ON) return ctx;     /* f3: las insignias las concede el servidor (finish_test) */
  let changed = false;
  BADGES.forEach(b=>{
    if(!STATE.storage.unlockedBadges[b.id] && b.check(ctx)){
      STATE.storage.unlockedBadges[b.id] = Date.now();
      changed = true;
      STATE.toast = '¡Insignia desbloqueada! '+b.icon+' '+b.name;
    }
  });
  if(changed) saveGamification();
  return ctx;
}

/* ---------------- RETO DIARIO: objetivo + corazones + coronas ---------------- */
function todaysAnsweredCount(){
  const today = dayKey(Date.now());
  return Object.values(STATE.storage.progress||{}).filter(p=>p.ts && dayKey(p.ts)===today).length;
}

function startCountedQuiz(count){
  if(srvOn()){ const n = Math.min(MAX_TEST_QUESTIONS, Math.max(1, count || 10)); srvStartQuiz(null, n === 10 ? 'short' : 'daily', n); return; }
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(MAX_TEST_QUESTIONS, Math.max(1,count)));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  bankReady(pool).then(function(ok){ if(!ok) return;
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'short', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  });
}

function isLifeMode(mode){ return mode==='hearts' || mode==='suddendeath'; }
function maxLivesFor(mode){ return mode==='suddendeath' ? 1 : 3; }
function isRecordMode(mode){ return mode==='hearts' || mode==='suddendeath' || mode==='timeattack'; }
function formatScore(n){ return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function startHeartsMode(){
  if(srvOn()){ srvStartLeague('hearts'); return; }
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(bankCap(60), pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  bankReady(pool).then(function(ok){ if(!ok) return;
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'hearts', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null, hearts:3, combo:0, bestCombo:0 };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  });
}

function startSuddenDeathMode(){
  if(srvOn()){ srvStartLeague('suddendeath'); return; }
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(bankCap(60), pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  bankReady(pool).then(function(ok){ if(!ok) return;
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'suddendeath', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null, hearts:1, combo:0, bestCombo:0 };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  });
}

function startTimeAttackMode(){
  if(srvOn()){ srvStartLeague('timeattack'); return; }
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(bankCap(150), pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  bankReady(pool).then(function(ok){ if(!ok) return;
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'timeattack', law:null, answers:{}, instantFeedback:true, timerMode:'total', timeSec:60, remainingSec:60, showFeedback:false, selected:null, combo:0, bestCombo:0 };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  startTimer();
  });
}

const CROWN_COLORS = ['', '#B87333', '#9AA0A6', '#E3A008', '#FF6A2B'];
function crownColor(level){ return CROWN_COLORS[Math.min(level,4)] || '#B87333'; }
function crownBadge(level){
  if(!level) return '';
  return `<div style="position:absolute; top:10px; left:10px; font-size:11px; font-weight:700; color:${crownColor(level)}; display:flex; align-items:center; gap:2px;">👑<span>${level}</span></div>`;
}

function recentPerformance(n){
  const hist = (STATE.storage.testHistory || []).slice(-n);
  if(hist.length === 0) return null;
  const totalScore = hist.reduce((s,h)=>s+h.score,0);
  const totalQ = hist.reduce((s,h)=>s+h.total,0);
  return { count: hist.length, pct: totalQ ? Math.round(totalScore/totalQ*100) : 0 };
}

function recentPerformanceByRule(n){
  const progress = STATE.storage.progress || {};
  const results = [];
  for(let i=1;i<=17;i++){
    const answered = allQuestions()
      .filter(q => q.domain==='law' && q.rule===i && progress[q.id] && progress[q.id].ts)
      .map(q => progress[q.id])
      .sort((a,b) => b.ts - a.ts)
      .slice(0, n);
    const total = answered.length;
    const correctCount = answered.filter(a => a.correct).length;
    results.push({ rule: i, total, pct: total ? Math.round(correctCount/total*100) : null });
  }
  return results;
}
async function resetLawProgress(law){
  if(SERVER_PROGRESS_ON){
    /* f3: el servidor borra el progreso de esa regla y conserva los puntos (los aciertos pasan al ajuste de puntos) */
    const r = await supabaseClient.rpc('reset_law_progress', { p_rule: law });
    if(r.error){ STATE.toast = 'No se pudo reiniciar el progreso de esta regla. Inténtalo de nuevo.'; render(); return false; }
  }
  const qids = new Set(questionsForLaw(law).map(q=>q.id));
  let correctCount = 0;
  Object.keys(STATE.storage.progress).forEach(qid=>{
    if(qids.has(qid)){
      if(STATE.storage.progress[qid].correct) correctCount++;
      delete STATE.storage.progress[qid];
    }
  });
  Object.keys(STATE.storage.failedStreaks||{}).forEach(qid=>{ if(qids.has(qid)) delete STATE.storage.failedStreaks[qid]; });
  STATE.storage.pointsCorrectOffset = (STATE.storage.pointsCorrectOffset||0) + correctCount;
  await savePointsCorrectOffset();
  await saveProgress();
  await saveFailedStreaks();
}

function lawStats(law){
  const qs = questionsForLaw(law);
  let attempted=0, correct=0;
  qs.forEach(q=>{ const p = STATE.storage.progress[q.id]; if(p){ attempted++; if(p.correct) correct++; } });
  const completionPct = qs.length ? (attempted===qs.length ? 100 : Math.min(99, Math.round(attempted/qs.length*100))) : 0;
  const accuracyPct = attempted ? Math.round(correct/attempted*100) : 0;
  return { total: qs.length, attempted, correct, completionPct, accuracyPct };
}
function overallStats(){
  let total=0, attempted=0, correct=0;
  for(let i=1;i<=17;i++){ const s=lawStats(i); total+=s.total; attempted+=s.attempted; correct+=s.correct; }
  const completionPct = total ? (attempted===total ? 100 : Math.min(99, Math.round(attempted/total*100))) : 0;
  const accuracyPct = attempted ? Math.round(correct/attempted*100) : 0;
  return { total, attempted, correct, completionPct, accuracyPct };
}

function accuracyBadge(pct){
  /* Paleta funcional: verde y rojo solo para respuestas correctas/incorrectas; un porcentaje es un dato neutro. */
  return `<span class="acc-badge" style="background:var(--c-paper-2); color:var(--c-ink);">${pct}%</span>`;
}

function scoreColor(pct){
  return 'var(--c-ink)';
}

function completionBadge(pct){
  return `<span class="acc-badge" style="background:#ECEEF1; color:var(--pitch);">${pct}% completado</span>`;
}

function lawSubLine(s){
  if(s.attempted === 0) return `<span class="law-sub-muted">Sin empezar</span>`;
  if(s.attempted === s.total) return `Completada · ${completionBadge(s.completionPct)}`;
  return `${completionBadge(s.completionPct)}`;
}

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function normalizeQuestionText(text){
  return (text||'')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // quita puntuación
    .replace(/\s+/g, ' ')
    .trim();
}

function questionDedupeKey(q){
  // Varias preguntas legítimas y distintas comparten un mismo enunciado genérico
  // (p.ej. "¿Cuál de estas afirmaciones no es correcta?") pero difieren en las
  // opciones de respuesta; por eso el texto solo no basta para considerarlas duplicadas.
  const qKey = normalizeQuestionText(q.question);
  const optKey = (q.options||[]).map(o => normalizeQuestionText(o)).sort().join('|');
  return qKey ? qKey + '::' + optKey : '';
}

function duplicateQuestionIds(){
  const groups = {};
  allQuestionsAdmin().forEach(q => {
    const key = questionDedupeKey(q);
    if(!key) return;
    (groups[key] = groups[key] || []).push(q.id);
  });
  const dupIds = new Set();
  Object.values(groups).forEach(ids => { if(ids.length > 1) ids.forEach(id => dupIds.add(id)); });
  return dupIds;
}

function questionCountsByLaw(){
  const counts = {};
  for(let i=1;i<=17;i++) counts[i] = 0;
  let glossary = 0;
  allQuestions().forEach(q => {
    if(q.domain === 'glossary') glossary++;
    else if(q.rule) counts[q.rule] = (counts[q.rule]||0) + 1;
  });
  return { counts, glossary };
}

function scopeLabel(q){
  if(q.domain==='glossary') return 'Glosario IFAB';
  if(q.domain==='assistants') return 'Árbitros Asistentes';
  if(q.domain==='fcf') return 'Reglament General FCF';
  return 'Regla '+q.rule+' · '+esc(LAW_NAMES[q.rule]);
}

function ringSVG(pct, size=64, stroke=6, color='#FF6A2B'){
  const r=(size-stroke)/2, c=size/2, circ=2*Math.PI*r, off=circ*(1-pct/100);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${off}" transform="rotate(-90 ${c} ${c})"/>
  </svg>`;
}

/* ---------------- RENDER ---------------- */
function render(){
  const app = document.getElementById('app');
  const active = document.activeElement;
  let focusId = null, selStart = null, selEnd = null;
  if(active && active.id && app.contains(active)){
    focusId = active.id;
    if(typeof active.selectionStart === 'number'){ selStart = active.selectionStart; selEnd = active.selectionEnd; }
  }
  let viewHtml;
  try{
    viewHtml = viewFor(STATE.view);
  }catch(err){
    /* Si una pantalla falla al pintarse, se enseña el motivo en vez de dejar la pantalla de carga para siempre. */
    console.error('Error al pintar la pantalla', STATE.view, err);
    STATE.lastRenderError = { view: String(STATE.view), message: String((err && err.message) || err) };
    viewHtml = `<div class="ui-card" style="max-width:560px; margin:40px auto;" role="alert">
      <h2 style="margin-bottom:8px;">No se ha podido mostrar esta pantalla</h2>
      <p style="color:var(--c-muted); font-size:14px; margin:0 0 10px;">Pantalla: <b>${esc(String(STATE.view))}</b>. Detalle técnico (cópialo si nos escribes):</p>
      <code style="display:block; word-break:break-word; background:var(--c-paper-2); padding:10px; border-radius:8px; font-size:12.5px; margin-bottom:14px;">${esc(STATE.lastRenderError.message)}</code>
      <div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn btn-primary" onclick="location.reload()">Recargar</button><button class="btn btn-ghost" data-action="academia">Ir a Mi Academia</button><button class="btn btn-ghost btn-danger-soft" data-action="logout">Cerrar sesión</button></div>
    </div>`;
  }
  const useShell = typeof shellFor==='function' && !SHELL_FOCUS_VIEWS.includes(STATE.view);
  app.classList.toggle('has-shell', useShell);
  app.innerHTML = useShell ? shellFor(STATE.view, viewHtml) : viewHtml;
  if(typeof phEnhance === 'function'){ try{ phEnhance(app); }catch(err){ console.warn('Cabecera', err); } }   // cabeceras comunes (pagehead.js)
  if(typeof gamiAfterRender === 'function'){ try{ gamiAfterRender(); }catch(err){ console.warn('Logros', err); } }   // celebraciones (gami.js)
  bindEvents();
  navSync();
  if(typeof committeeAfterRender==='function') committeeAfterRender();
  if(focusId){
    const el = document.getElementById(focusId);
    if(el){
      el.focus();
      if(selStart!==null && el.setSelectionRange){ try{ el.setSelectionRange(selStart, selEnd); }catch(e){} }
    }
  }
  if(STATE.toast){
    const t=document.createElement('div'); t.className='toast'; t.textContent=STATE.toast;
    document.body.appendChild(t);
    setTimeout(()=>{ t.remove(); STATE.toast=null; }, 2200);
  }
  const oldModal = document.getElementById('confirm-modal');
  if(oldModal) oldModal.remove();
  if(STATE.confirmQuit && !(STATE.view === 'quiz' || STATE.view === 'myBankQuiz')) STATE.confirmQuit = null;
  if(STATE.confirmQuit){
    const qz = STATE.confirmQuit === 'mybank' ? STATE.myBankQuiz : STATE.quiz;
    const league = qz && ['hearts','suddendeath','timeattack'].includes(qz.mode);
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card qz-confirm" role="dialog" aria-modal="true" aria-labelledby="qz-confirm-title">
      <span class="qz-confirm-ic">${shellIcon('flag')}</span>
      <h3 id="qz-confirm-title">¿Seguro que quieres salir del test?</h3>
      <p>${league ? 'Si sales ahora, esta partida no contará para la clasificación.' : 'Si sales ahora, perderás el progreso de este test y no se guardará su resultado.'}</p>
      <div class="qz-confirm-actions">
        <button class="btn btn-primary" data-action="quit-cancel">Seguir con el test</button>
        <button class="btn btn-ghost btn-danger-soft" data-action="quit-confirm">Sí, salir</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else
  if(STATE.confirmDeleteId){
    const q = allQuestionsAdmin().find(x=>x.id===STATE.confirmDeleteId);
    const preview = q ? q.question : '';
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Estás seguro de que quieres eliminar esta pregunta?</h3>
      <div style="font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; font-weight:700; margin-bottom:4px;">Pregunta a eliminar:</div>
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px; white-space:pre-wrap; word-break:break-word;">${esc(preview)}</p>
      <p style="font-size:12.5px; color:var(--muted); margin-bottom:16px;">Esta acción no se puede deshacer.</p>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="cancel-delete">Cancelar</button>
        <button class="btn" style="background:var(--red); color:#fff;" data-action="confirm-delete">Sí, eliminar</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else if(STATE.confirmResetLawId!==null){
    const lawLabel = 'Regla '+STATE.confirmResetLawId+' · '+esc(LAW_NAMES[STATE.confirmResetLawId]);
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Reiniciar el progreso de esta regla?</h3>
      <p style="font-size:13.5px; font-weight:700; margin-bottom:8px;">${lawLabel}</p>
      <p style="font-size:13.5px; color:var(--ink); margin-bottom:6px;"><strong>Se borra:</strong> tus aciertos y fallos de las preguntas de esta regla. La barra de progreso vuelve a 0 % y sus preguntas falladas dejan de aparecer en la Sala de Repaso.</p>
      <p style="font-size:13.5px; color:var(--ink); margin-bottom:10px;"><strong>No se toca:</strong> tus puntos, tu rango, tu racha, tus insignias, las coronas de esta regla ni las demás reglas.</p>
      <p style="font-size:13px; font-weight:700; color:var(--red); background:var(--c-bad-bg); padding:8px 12px; border-radius:8px; margin-bottom:16px;">Esta acción no se puede deshacer.</p>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="cancel-reset-law">Cancelar</button>
        <button class="btn" style="background:var(--red); color:#fff;" data-action="confirm-reset-law">Sí, reiniciar</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else if(STATE.confirmDeleteMyBankId){
    const q = (STATE.storage.myBank||[]).find(x=>x.id===STATE.confirmDeleteMyBankId);
    const preview = q ? q.question : '';
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Estás seguro de que quieres eliminar esta pregunta?</h3>
      <div style="font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; font-weight:700; margin-bottom:4px;">Pregunta a eliminar:</div>
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px; white-space:pre-wrap; word-break:break-word;">${esc(preview)}</p>
      <p style="font-size:12.5px; color:var(--muted); margin-bottom:16px;">Esta acción no se puede deshacer.</p>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="mybank-cancel-delete">Cancelar</button>
        <button class="btn" style="background:var(--red); color:#fff;" data-action="mybank-confirm-delete">Sí, eliminar</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else if(STATE.confirmDeleteMyBankCategory !== null){
    const catName = STATE.confirmDeleteMyBankCategory;
    const count = (STATE.storage.myBank||[]).filter(q=>q.category===catName).length;
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Eliminar la categoría "${esc(catName)}"?</h3>
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px;">${count>0 ? `${count} pregunta(s) de esta categoría pasarán a "Sin categoría". No se borra ninguna pregunta.` : 'Esta categoría no tiene preguntas.'}</p>
      <p style="font-size:12.5px; color:var(--muted); margin-bottom:16px;">Esta acción no se puede deshacer.</p>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="mybank-cancel-delete-category">Cancelar</button>
        <button class="btn" style="background:var(--red); color:#fff;" data-action="mybank-confirm-delete-category">Sí, eliminar</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else if(STATE.confirmDeleteMyDocId){
    const doc = (STATE.storage.myDocs||[]).find(x=>x.id===STATE.confirmDeleteMyDocId);
    const preview = doc ? doc.name : '';
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Eliminar este documento?</h3>
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px; white-space:pre-wrap; word-break:break-word;">📄 ${esc(preview)}</p>
      <p style="font-size:12.5px; color:var(--muted); margin-bottom:16px;">Esta acción no se puede deshacer.</p>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="mydocs-cancel-delete">Cancelar</button>
        <button class="btn" style="background:var(--red); color:#fff;" data-action="mydocs-confirm-delete">Sí, eliminar</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else if(STATE.confirmDeleteMyDocFolderId){
    const folder = (STATE.storage.myDocsFolders||[]).find(x=>x.id===STATE.confirmDeleteMyDocFolderId);
    const hasChildren = folder && (myDocsChildFolders(folder.id).length>0 || myDocsInFolder(folder.id).length>0);
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Eliminar esta carpeta?</h3>
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px;">📂 ${esc(folder ? folder.name : '')}</p>
      ${hasChildren
        ? `<p style="font-size:12.5px; color:var(--red); margin-bottom:16px;">Esta carpeta tiene documentos o subcarpetas dentro. Vacíala primero (muévelos o bórralos) antes de poder eliminarla.</p>`
        : `<p style="font-size:12.5px; color:var(--muted); margin-bottom:16px;">Esta carpeta está vacía. Esta acción no se puede deshacer.</p>`}
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="mydocs-cancel-delete-folder">Cancelar</button>
        ${hasChildren ? '' : `<button class="btn" style="background:var(--red); color:#fff;" data-action="mydocs-confirm-delete-folder">Sí, eliminar</button>`}
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  } else if(STATE.confirmDeleteUserId){
    const targetUser = (STATE.adminStats && STATE.adminStats.users) ? STATE.adminStats.users.find(x=>x.id===STATE.confirmDeleteUserId) : null;
    const label = targetUser ? (targetUser.username ? targetUser.username+' · '+targetUser.email : targetUser.email) : '';
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<div class="modal-card">
      <h3 style="margin-bottom:12px;">¿Eliminar esta cuenta de usuario?</h3>
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px; word-break:break-word;">${esc(label)}</p>
      <p style="font-size:12.5px; color:var(--red); margin-bottom:16px;">Esta acción es permanente: se eliminará el acceso de este usuario y todos sus datos asociados. No se puede deshacer.</p>
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn btn-ghost" data-action="admin-cancel-delete-user">Cancelar</button>
        <button class="btn" style="background:var(--red); color:#fff;" data-action="admin-confirm-delete-user">Sí, eliminar cuenta</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', onAction));
  }
}

function viewFor(v){
  if(v==='home') return homeView();
  if(v==='law') return lawMenuView();
  if(v==='quiz') return quizView();
  if(v==='result') return resultView();
  if(v==='add') return addQuestionView();
  if(v==='stats') return statsView();
  if(v==='trainConfig') return trainConfigView();
  if(v==='savedBrowse') return savedBrowseView();
  if(v==='suggestForm') return suggestFormView();
  if(v==='suggestionsAdmin') return isMaster() ? suggestionsAdminView() : homeView();
  if(v==='database') return databaseView();
  if(v==='adminDashboard') return isMaster() ? adminDashboardView() : homeView();
  if(v==='dailyChallenge') return leagueView();
  if(v==='leaderboard') return leagueView();
  if(v==='myBank') return myBankCategoriesView();
  if(v==='myBankCategory') return myBankCategoryView();
  if(v==='myBankForm') return myBankFormView();
  if(v==='myBankTrainConfig') return myBankTrainConfigView();
  if(v==='myBankQuiz') return myBankQuizView();
  if(v==='myBankResult') return myBankResultView();
  if(v==='myDocs') return myDocsView();
  if(v==='myDocsPreview') return myDocsPreviewView();
  if(v==='academia') return academiaView();
  if(v==='achievements') return achievementsView();
  if(v==='profile') return profileView();
  if(v==='profileEdit') return profileEditView();
  if(v==='streakCalendar') return streakCalendarView();
  if(v==='recentPerformance') return recentPerformanceView();
  if(v==='menu' && typeof menuView==='function') return menuView();
  if(typeof v==='string' && v.startsWith('committee') && typeof committeeView==='function') return committeeView(v);
  return homeView();
}

/* ---------------- WEREF LEAGUE · pantalla única (juego + posición + clasificación) ---------------- */
function leagueView(){
  const ic = (n) => shellIcon(n);
  const mode = leagueMode(), M = LEAGUE_MODES[mode];
  const slot = STATE.leagueBoard[mode] || null;
  const board = slot && slot.data ? slot.data : null;
  const loading = !slot || (slot.loading && !board);
  const failed = !!(slot && slot.error && !board);
  const me = board ? board.me : null;
  const rec = (k) => lgFmt(Number(STATE.storage[LEAGUE_MODES[k].rec]) || 0);
  const initial = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase() || '?');
  const nm = (n) => esc(n || 'Anónimo');

  const seg = Object.keys(LEAGUE_MODES).map(k => {
    const m = LEAGUE_MODES[k];
    return `<button type="button" role="tab" aria-selected="${k === mode}" class="lg2-seg-b${k === mode ? ' on' : ''}" data-action="league-mode" data-mode="${k}">${ic(m.icon)}<span class="lg2-full">${m.label}</span><span class="lg2-short">${m.short}</span></button>`;
  }).join('');

  const play = `
  <section class="lg2-play" aria-label="Jugar ${M.label}">
    <div class="lg2-play-top"><span class="lg2-play-ic">${ic(M.icon)}</span><div><h2>${M.label}</h2><p>${M.rules}</p></div></div>
    <div class="lg2-rec"><small>Tu récord</small><b>${rec(mode)}</b></div>
    <button type="button" class="btn btn-yellow lg2-go" data-action="${M.action}">${ic('play')} Jugar ahora</button>
  </section>`;

  let posBody;
  if(loading) posBody = '<span class="skel" style="display:block;width:70%;height:34px"></span><span class="skel" style="display:block;width:50%;height:14px;margin-top:10px"></span>';
  else if(failed) posBody = `<p class="lg2-muted">No se pudo cargar la clasificación.</p><button type="button" class="btn btn-secondary" data-action="league-reload">Reintentar</button>`;
  else if(!me) posBody = `<p class="lg2-muted">Juega una partida para entrar en el ranking.</p>`;
  else {
    const gap = me.rank === 1
      ? '<p class="lg2-gap">Eres el número 1 de este modo.</p>'
      : me.above
        ? `<p class="lg2-gap">A <b>${lgFmt(Math.max(0, Number(me.above.score) - Number(me.score)))}</b> pts de <b>${nm(me.above.username)}</b></p>`
        : '';
    const cut = (me.cut && me.rank > 10) ? `<p class="lg2-gap">A <b>${lgFmt(Math.max(0, Number(me.cut.score) - Number(me.score)))}</b> pts del Top ${me.cut.rank}</p>` : '';
    posBody = `<div class="lg2-pos-big"><b>#${me.rank}</b><span>en ${M.label}</span></div><div class="lg2-pos-pts">${lgFmt(Number(me.score))} pts</div>${gap}${cut}`
      + (me.rank > 1 ? `<button type="button" class="btn btn-secondary lg2-chase" data-action="${M.action}">${ic('play')} Jugar y superarle</button>` : '');
  }
  const pos = `<section class="lg2-card lg2-pos" aria-label="Tu posición"><h3>Tu posición</h3>${posBody}</section>`;

  const recs = `<section class="lg2-card lg2-recs" aria-label="Tus récords"><h3>Tus récords</h3><div class="lg2-recs-row">${
    Object.keys(LEAGUE_MODES).map(k => `<div class="lg2-rec3${k === mode ? ' on' : ''}">${ic(LEAGUE_MODES[k].icon)}<b>${rec(k)}</b><small>${LEAGUE_MODES[k].short}</small></div>`).join('')
  }</div></section>`;

  /* clasificación: podio + lista */
  const top = board ? (board.top || []) : [];
  let boardBody;
  if(loading){
    boardBody = '<div class="lg2-skel">' + '<span class="skel" style="display:block;height:150px;margin-bottom:12px"></span>' + Array.from({length: 5}, () => '<span class="skel" style="display:block;height:48px;margin-bottom:8px"></span>').join('') + '</div>';
  } else if(failed){
    boardBody = `<div class="lg2-empty">${ic('trophy')}<strong>No se pudo cargar la clasificación</strong><button type="button" class="btn btn-secondary" data-action="league-reload">Reintentar</button></div>`;
  } else if(!top.length){
    boardBody = `<div class="lg2-empty">${ic('trophy')}<strong>Sé el primero en este modo</strong><span>Juega una partida y aparecerás aquí.</span></div>`;
  } else {
    const pod = (r) => `<div class="lg2-pod p${r.rank}${r.is_me ? ' me' : ''}" title="${nm(r.username)}" role="button" tabindex="0" data-action="lg-pod" aria-label="${nm(r.username)}, puesto ${r.rank}">
      <div class="lg2-pod-av"><span class="lg2-av xl${r.is_me ? ' me' : ''}" aria-hidden="true">${initial(r.username)}</span><span class="lg2-pod-n">${r.rank}</span></div>
      <div class="lg2-pod-name">${nm(r.username)}${r.is_me ? ' <i class="lg2-you">Tú</i>' : ''}</div>
      <div class="lg2-pod-meta">${flagHtml(r.country)}<b>${lgFmt(Number(r.score))}</b></div>
    </div>`;
    const podium = `<div class="lg2-podium">${[1, 0, 2].filter(i => i < top.length).map(i => pod(top[i])).join('')}</div>`;
    const row = (r) => `<div class="lg2-row${r.is_me ? ' me' : ''}">
      <span class="lg2-rk">${r.rank}</span>
      <span class="lg2-av${r.is_me ? ' me' : ''}" aria-hidden="true">${initial(r.username)}</span>
      <span class="lg2-name"><span class="lg2-uname">${nm(r.username)}</span>${r.is_me ? '<i class="lg2-you">Tú</i>' : ''}${flagHtml(r.country)}</span>
      <b class="lg2-sc">${lgFmt(Number(r.score))}</b>
    </div>`;
    const rows = top.slice(3).map(row).join('');
    const outside = (me && me.rank > top.length)
      ? `<div class="lg2-dots" aria-hidden="true">···</div>` + row({ rank: me.rank, username: me.username, country: me.country, score: me.score, is_me: true })
      : '';
    boardBody = podium + (rows || outside ? `<div class="lg2-list">${rows}${outside}</div>` : '');
  }
  const total = board ? Number(board.total) || 0 : null;
  const boardSec = `<section class="lg2-board" id="lg2-board" aria-label="Clasificación">
    <div class="lg2-board-head"><h2>Clasificación · ${M.label}</h2><span>${total === null ? '' : total + (total === 1 ? ' jugador' : ' jugadores')}</span></div>
    ${boardBody}
  </section>`;

  return `
  <div class="lg2">
    <header class="lg2-head"><div class="lg2-head-t"><h1>WEREF League</h1><p>Compite, supera tus récords y escala posiciones.</p></div><button type="button" class="lg2-info" data-action="ph-league-info" aria-label="Cómo funciona la League"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/></svg><span>Cómo funciona</span></button></header>
    <div class="lg2-seg" role="tablist" aria-label="Modo de juego">${seg}</div>
    <div class="lg2-grid">
      <div class="lg2-main">${play}</div>
      <aside class="lg2-side">${pos}${recs}</aside>
    </div>
    ${boardSec}
  </div>`;
}


/* ---------------- MI BASE DE DATOS: banco de preguntas 100% privado del usuario ----------------
   Independiente de allQuestions()/BASE_QUESTIONS: nunca se mezcla con el contenido de la
   plataforma, ni al revisar, ni al generar tests, ni en Sala VAR/Repaso/Mi Lista/reportes.
   Modelo "categorías primero": el usuario crea categorías y añade preguntas dentro de ellas;
   el test se genera eligiendo una o varias categorías, con las mismas opciones (número de
   preguntas, cronómetro, examen/estudio) que "Crear test personalizado" de la plataforma. */

let MYBANK_TIMER_HANDLE = null;
function myBankStopTimer(){ if(MYBANK_TIMER_HANDLE){ clearInterval(MYBANK_TIMER_HANDLE); MYBANK_TIMER_HANDLE = null; } }
function myBankStartTimer(){
  myBankStopTimer();
  MYBANK_TIMER_HANDLE = setInterval(()=>{
    const quiz = STATE.myBankQuiz;
    if(!quiz){ myBankStopTimer(); return; }
    quiz.remainingSec--;
    const el = document.getElementById('mybank-timer-display');
    if(el) el.textContent = formatTime(quiz.remainingSec);
    if(quiz.remainingSec <= 0){
      if(quiz.timerMode==='perQuestion' && quiz.idx+1 < quiz.qids.length){
        quiz.idx++;
        quiz.remainingSec = quiz.perQSeconds;
        render();
      } else {
        myBankStopTimer();
        STATE.view = 'myBankResult';
        STATE.toast = '¡Tiempo agotado!';
        render();
      }
    }
  }, 1000);
}

function myBankCategoryCounts(){
  const counts = {};
  (STATE.storage.myBank||[]).forEach(q => { const c = q.category || ''; counts[c] = (counts[c]||0) + 1; });
  return counts;
}

function acHero(eyebrow, title, desc, stats, actions, small){
  return `<section class="lg-hero ac-hero${small ? ' lg-hero-sm' : ''}">
    <div class="lg-hero-main">
      <div class="home-eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      ${desc ? `<p>${desc}</p>` : ''}
      ${actions ? `<div class="ac-hero-actions">${actions}</div>` : ''}
    </div>
    ${stats && stats.length ? `<div class="lg-hero-stats">${stats.map(s => `<div class="lg-stat"><b>${s[0]}</b><span>${s[1]}</span></div>`).join('')}</div>` : ''}
  </section>`;
}

function myBankCategoriesView(){
  const ic = (n) => shellIcon(n);
  const cats = (STATE.storage.myBankCategories||[]).slice().sort((a,b)=>a.localeCompare(b));
  const counts = myBankCategoryCounts();
  const uncategorizedCount = counts[''] || 0;
  const totalQuestions = (STATE.storage.myBank||[]).length;

  const folder = (cat, label, n, iconName) => `
    <div class="ac-folder">
      <button class="ac-folder-open" data-action="mybank-open-category" data-category="${esc(cat)}">
        <span class="ac-folder-ic ${iconName === 'folder' ? '' : 'muted'}">${ic(iconName)}</span>
        <span class="ac-folder-txt"><strong>${esc(label)}</strong><small>${n} ${n === 1 ? 'pregunta' : 'preguntas'}</small></span>
        <span class="ac-folder-count">${n}</span>
      </button>
      <span class="ac-folder-go">${ic('chevron')}</span>
    </div>`;
  const rows = cats.map(c => folder(c, c, counts[c]||0, 'folder')).join('');

  const actions = `
    ${STATE.myBankCreatingCategory ? '' : `<button class="btn btn-yellow" data-action="mybank-new-category">${ic('plus')} Nueva categoría</button>`}
    ${totalQuestions>0 ? `<button class="btn btn-glass" data-action="mybank-train-config">${ic('play')} Crear test</button>` : ''}`;

  return `
  <button class="backbtn" data-action="academia">&larr; Mi Academia</button>
  ${acHero('Mi Academia · Privado', 'Mis propios test', 'Tu contenido privado, organizado por categorías. Nadie más puede verlo, y nunca se mezcla con las preguntas de WEREF.',
    [[cats.length, 'Categorías'], [totalQuestions, 'Preguntas'], [uncategorizedCount, 'Sin categoría']], actions)}

  ${STATE.myBankCreatingCategory ? `
  <div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('plus')}</span><div><h3>Nueva categoría</h3><small>Agrupa tus preguntas por tema</small></div></div>
    <input type="text" id="mybank-new-category-name" placeholder="Ej: Tema 3, Casos prácticos..." maxlength="60">
    <div style="margin-top:14px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="mybank-save-category">Crear</button>
      <button class="btn btn-ghost" data-action="mybank-cancel-category">Cancelar</button>
    </div>
  </div>
  ` : ''}

  <div class="lg-section-head"><h2>Tus categorías</h2><span>${cats.length === 0 ? 'Crea la primera para empezar' : 'Entra en una para ver y añadir preguntas'}</span></div>
  ${(rows || uncategorizedCount>0) ? `<div class="ac-folders list">${rows}${uncategorizedCount>0 ? folder('', 'Sin categoría', uncategorizedCount, 'file') : ''}</div>` :
    `<div class="ac-empty">${ic('folder')}<strong>Todavía no has creado ninguna categoría</strong><span>Crea la primera para empezar a añadir preguntas.</span></div>`}
  `;
}

function myBankCategoryView(){
  const ic = (n) => shellIcon(n);
  const cat = STATE.myBankViewCategory;
  const catLabel = cat === '' ? 'Sin categoría' : cat;
  const list = (STATE.storage.myBank||[]).filter(q => (q.category||'') === cat);
  const s = (STATE.myBankSearch||'').trim().toLowerCase();
  const filtered = s ? list.filter(q => q.question.toLowerCase().includes(s) || q.options.some(o=>o.toLowerCase().includes(s))) : list;
  const letters = ['a','b','c','d'];
  const rows = filtered.map((q, n) => `
    <article class="ac-q">
      <div class="ac-q-head"><span class="ac-q-num">${n+1}</span><div class="ac-q-text">${esc(q.question)}</div></div>
      <div class="ac-q-opts">${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default; padding:9px 12px;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}</div>
      ${q.explanation ? `<div class="ac-q-expl"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
      <div class="ac-q-actions">
        <button class="btn btn-ghost" data-action="mybank-edit" data-qid="${q.id}">${ic('pencil')} Editar</button>
        <button class="btn btn-ghost btn-danger-soft" data-action="mybank-delete" data-qid="${q.id}">${ic('trash')} Eliminar</button>
      </div>
    </article>
  `).join('');
  const actions = `
    <button class="btn btn-yellow" data-action="mybank-add">${ic('plus')} Añadir pregunta aquí</button>
    ${cat!=='' ? `<button class="btn btn-glass" data-action="mybank-delete-category" data-category="${esc(cat)}">${ic('trash')} Eliminar categoría</button>` : ''}`;
  return `
  <button class="backbtn" data-action="mybank">&larr; Mis propios test</button>
  ${acHero('Mis propios test · Categoría', esc(catLabel), '', [[list.length, list.length === 1 ? 'Pregunta' : 'Preguntas']], actions, true)}

  <div class="ac-search">
    ${ic('search')}
    <input type="text" id="mybank-search" placeholder="Busca en esta categoría por palabra..." value="${esc(STATE.myBankSearch)}" maxlength="100" aria-label="Buscar en esta categoría">
  </div>

  ${rows ? `<div class="ac-qlist">${rows}</div>` : `<div class="ac-empty">${ic('pencil')}<strong>${list.length===0 ? 'Todavía no hay preguntas en esta categoría' : 'Ninguna coincide con esa búsqueda'}</strong><span>${list.length===0 ? 'Pulsa "Añadir pregunta aquí" para crear la primera.' : 'Prueba con otra palabra.'}</span></div>`}
  `;
}

function myBankFormView(){
  const editing = STATE.myBankEditingId ? (STATE.storage.myBank||[]).find(q=>q.id===STATE.myBankEditingId) : null;
  const cats = (STATE.storage.myBankCategories||[]).slice().sort((a,b)=>a.localeCompare(b));
  const defaultCat = editing ? (editing.category||'') : (STATE.myBankViewCategory !== null ? STATE.myBankViewCategory : (cats[0]||''));
  const draft = STATE.myBankFormDraft;
  const catVal = draft && draft.category!==undefined ? draft.category : defaultCat;
  const allLetters = ['a','b','c','d'];
  const optionCount = 4;   // toda pregunta lleva siempre 4 respuestas
  const letters = allLetters.slice(0, optionCount);
  const getField = (field) => (draft && draft[field]!==undefined) ? draft[field] : (editing && editing[field]!==undefined ? editing[field] : '');
  const getOption = (i) => (draft && draft.options && draft.options[i]!==undefined) ? (draft.options[i]||'') : (editing && editing.options[i]!==undefined ? editing.options[i] : '');
  let correctVal = draft ? draft.correct : (editing ? editing.correct : 'a');
  if(!letters.includes(correctVal)) correctVal = letters[0];
  const backAct = STATE.myBankViewCategory!==null ? 'mybank-open-category-back' : 'mybank';
  return `
  <button class="backbtn" data-action="${backAct}">&larr; Volver</button>
  ${acHero('Mis propios test', editing ? 'Editar pregunta' : 'Añadir pregunta', '', [], '', true)}
  <div class="ac-form">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">1</span><div><h3>Enunciado</h3><small>Categoría y texto de la pregunta</small></div></div>
      <label>Categoría</label>
      <select id="mb-category">
        ${cats.map(c=>`<option value="${esc(c)}" ${catVal===c?'selected':''}>${esc(c)}</option>`).join('')}
        <option value="" ${catVal===''?'selected':''}>Sin categoría</option>
      </select>
      <label>Pregunta</label>
      <textarea id="mb-question" placeholder="Escribe el enunciado..." maxlength="1000">${esc(getField('question'))}</textarea>
    </div>
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">2</span><div><h3>Respuestas</h3><small>Indica cuál es la correcta</small></div></div>
      ${letters.map((l,i)=>`<label>Respuesta ${l})</label><input type="text" id="mb-${l}" maxlength="300" value="${esc(getOption(i))}">`).join('')}
      <label>Respuesta correcta</label>
      <select id="mb-correct">${letters.map(l=>`<option value="${l}" ${correctVal===l?'selected':''}>${l})</option>`).join('')}</select>
    </div>
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">3</span><div><h3>Explicación</h3><small>Opcional · solo la ves tú</small></div></div>
      <textarea id="mb-explanation" placeholder="Por qué es correcta, referencia, apunte propio..." maxlength="2000">${esc(getField('explanation'))}</textarea>
    </div>
    <div style="display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="mybank-save" ${editing ? `data-qid="${editing.id}"` : ''}>Guardar</button>
      <button class="btn btn-ghost" data-action="${backAct}">Cancelar</button>
    </div>
  </div>
  `;
}

function myBankTrainConfigView(){
  const ic = (n) => shellIcon(n);
  const cfg = STATE.myBankTrainCfg;
  const cats = (STATE.storage.myBankCategories||[]).slice().sort((a,b)=>a.localeCompare(b));
  const scoped = cfg.categories.length ? (STATE.storage.myBank||[]).filter(q=>cfg.categories.includes(q.category)) : (STATE.storage.myBank||[]);
  const opt = (on, action, attrs, icon, title, text) => `<button class="tc-opt ${on?'active':''}" data-action="${action}" ${attrs}>
    <span class="tc-opt-ic">${ic(icon)}</span><span class="tc-opt-body"><strong>${title}</strong><small>${text}</small></span><span class="tc-opt-check">${ic('check')}</span>
  </button>`;
  const timerText = cfg.timerMode==='none' ? 'Sin límite' : cfg.timerMode==='total' ? cfg.minutes + ' min en total' : cfg.secondsPerQuestion + ' s por pregunta';
  const catsText = cfg.categories.length===0 ? 'Todas las categorías' : cfg.categories.length===1 ? cfg.categories[0] : cfg.categories.length + ' categorías';
  return `
  <button class="backbtn" data-action="mybank">&larr; Mis propios test</button>
  ${acHero('Mis propios test', 'Crear test', 'Elige qué categorías incluir, cuántas preguntas quieres y cómo quieres el tiempo.', [[scoped.length, 'Preguntas disponibles']], '', true)}
  <div class="tc-layout">
    <div class="tc-main">
      ${cats.length>0 ? `
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">1</span><div><h3>Categorías incluidas</h3><small>Sin selección entran todas</small></div>
          <button class="tc-all ${cfg.categories.length===0?'active':''}" data-action="mybank-toggle-train-category" data-category="all">Todas</button></div>
        <div class="tc-rules">${cats.map(c=>`<button class="tc-rule ${cfg.categories.includes(c)?'active':''}" data-action="mybank-toggle-train-category" data-category="${esc(c)}"><b>${esc(c.charAt(0).toUpperCase())}</b><span>${esc(c)}</span></button>`).join('')}</div>
      </div>` : ''}

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${cats.length>0?2:1}</span><div><h3>Número de preguntas</h3><small>Máximo 50 por examen</small></div></div>
        <input type="text" inputmode="numeric" id="mybank-cfg-count" class="tc-count" value="${Math.min(cfg.count,50)}" maxlength="2">
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${cats.length>0?3:2}</span><div><h3>Tipo de test</h3><small>Cuándo quieres ver las soluciones</small></div></div>
        <div class="tc-opts two">
          ${opt(cfg.feedbackMode==='exam', 'mybank-set-feedback-mode', 'data-fbmode="exam"', 'target', 'Modo examen', 'No sabrás los resultados hasta terminar todo el test.')}
          ${opt(cfg.feedbackMode==='study', 'mybank-set-feedback-mode', 'data-fbmode="study"', 'book', 'Modo estudio', 'Verás si aciertas y la solución al momento de responder cada pregunta.')}
        </div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${cats.length>0?4:3}</span><div><h3>Temporización</h3><small>Controla el ritmo del examen</small></div></div>
        <div class="tc-opts three">
          ${opt(cfg.timerMode==='none', 'mybank-set-timer-mode', 'data-mode="none"', 'repeat', 'Sin límite', 'A tu ritmo.')}
          ${opt(cfg.timerMode==='total', 'mybank-set-timer-mode', 'data-mode="total"', 'clock', 'Tiempo total', 'Un reloj para todo el examen.')}
          ${opt(cfg.timerMode==='perQuestion', 'mybank-set-timer-mode', 'data-mode="perQuestion"', 'zap', 'Por pregunta', 'Cada pregunta con su cuenta atrás.')}
        </div>
        ${cfg.timerMode==='total' ? `
          <div class="tc-field"><label for="mybank-cfg-minutes">Minutos para todo el examen</label>
          <input type="text" inputmode="numeric" id="mybank-cfg-minutes" value="${cfg.minutes}" maxlength="4"></div>
        ` : ''}
        ${cfg.timerMode==='perQuestion' ? `
          <div class="tc-field"><label for="mybank-cfg-seconds-per-q">Segundos por pregunta</label>
          <input type="text" inputmode="numeric" id="mybank-cfg-seconds-per-q" value="${cfg.secondsPerQuestion}" maxlength="4"></div>
        ` : ''}
      </div>
    </div>

    <aside class="tc-side">
      <div class="tc-summary">
        <div class="tc-summary-title">Resumen del examen</div>
        <div class="tc-sum-row">${ic('folder')}<span>Categorías</span><b>${esc(catsText)}</b></div>
        <div class="tc-sum-row">${ic('target')}<span>Tipo</span><b>${cfg.feedbackMode==='study' ? 'Modo estudio' : 'Modo examen'}</b></div>
        <div class="tc-sum-row">${ic('clock')}<span>Tiempo</span><b>${timerText}</b></div>
        <div class="tc-sum-row">${ic('shuffle')}<span>Banco</span><b>${scoped.length} preguntas</b></div>
        <button class="btn btn-yellow tc-go" data-action="mybank-generate-exam">${ic('play')} Generar examen</button>
      </div>
    </aside>
  </div>
  `;
}

function saveMyBankQuestion(qid){
  const category = document.getElementById('mb-category').value;
  const question = document.getElementById('mb-question').value.trim();
  const existingQ = qid ? (STATE.storage.myBank||[]).find(q=>q.id===qid) : null;
  const optionCount = 4;
  const allLetters = ['a','b','c','d'];
  const letters = allLetters.slice(0, optionCount);
  const options = letters.map(l => document.getElementById('mb-'+l).value.trim());
  const correct = document.getElementById('mb-correct').value;
  const explanation = document.getElementById('mb-explanation').value.trim();
  if(!question || options.some(o=>!o)){
    STATE.toast = 'Rellena la pregunta y todas las respuestas.';
    render();
    return;
  }
  if(!STATE.storage.myBank) STATE.storage.myBank = [];
  if(qid){
    const existing = STATE.storage.myBank.find(q=>q.id===qid);
    if(existing){ Object.assign(existing, { category, question, options, correct, explanation }); }
  } else {
    STATE.storage.myBank.push({
      id: 'MB'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      category, question, options, correct, explanation,
      createdAt: Date.now()
    });
  }
  saveMyBank();
  STATE.myBankEditingId = null;
  STATE.myBankOptionCount = null;
  STATE.myBankFormDraft = null;
  STATE.view = STATE.myBankViewCategory!==null ? 'myBankCategory' : 'myBank';
  STATE.toast = 'Guardado en Mis Propios Test.';
  render();
}

function myBankAddCategory(){
  const input = document.getElementById('mybank-new-category-name');
  const name = input.value.trim();
  if(!name){ STATE.toast = 'Escribe un nombre para la categoría.'; render(); return; }
  if(!STATE.storage.myBankCategories) STATE.storage.myBankCategories = [];
  if(STATE.storage.myBankCategories.some(c=>c.toLowerCase()===name.toLowerCase())){
    STATE.toast = 'Ya tienes una categoría con ese nombre.';
    render();
    return;
  }
  STATE.storage.myBankCategories.push(name);
  saveMyBankCategories();
  STATE.myBankCreatingCategory = false;
  render();
}

function myBankDeleteCategory(name){
  STATE.storage.myBankCategories = (STATE.storage.myBankCategories||[]).filter(c=>c!==name);
  (STATE.storage.myBank||[]).forEach(q => { if(q.category===name) q.category = ''; });
  saveMyBankCategories();
  saveMyBank();
  STATE.myBankViewCategory = null;
  STATE.view = 'myBank';
  render();
}

function startMyBankTraining(opts){
  let pool = (opts.categories && opts.categories.length)
    ? (STATE.storage.myBank||[]).filter(q => opts.categories.includes(q.category))
    : (STATE.storage.myBank||[]).slice();
  pool = shuffle(pool.slice());
  const count = Math.max(1, Math.min(opts.count || 20, 50, pool.length));
  pool = pool.slice(0, count);
  if(pool.length===0){ STATE.toast = 'No hay preguntas disponibles con esos filtros.'; render(); return; }

  let timerMode = opts.timerMode || 'none';
  let timeSec=0, remainingSec=0, perQSeconds=0;
  if(timerMode==='total'){
    timeSec = (opts.minutes && opts.minutes>0) ? Math.round(opts.minutes*60) : 0;
    if(timeSec<=0) timerMode='none';
    remainingSec = timeSec;
  } else if(timerMode==='perQuestion'){
    perQSeconds = Math.min(120, Math.max(5, opts.secondsPerQuestion || 45));
    remainingSec = perQSeconds;
  }

  STATE.myBankQuiz = {
    qids: pool.map(q=>q.id), idx:0, answers:{},
    instantFeedback: !!opts.instantFeedback, timerMode, timeSec, remainingSec, perQSeconds
  };
  STATE.myBankQuiz.shuffled = {};
  STATE.myBankQuiz.qids.forEach(qid => {
    const q = (STATE.storage.myBank||[]).find(x=>x.id===qid);
    if(q) STATE.myBankQuiz.shuffled[qid] = shuffledQuestionCopy(q);
  });
  STATE.view = 'myBankQuiz';
  render();
  if(timerMode==='total' || timerMode==='perQuestion') myBankStartTimer();
}

function myBankQuestionById(qid, quiz){
  quiz = quiz || STATE.myBankQuiz;
  if(quiz && quiz.shuffled && quiz.shuffled[qid]) return quiz.shuffled[qid];
  return (STATE.storage.myBank||[]).find(x=>x.id===qid);
}

function myBankCurrentQ(){
  const quiz = STATE.myBankQuiz;
  return myBankQuestionById(quiz.qids[quiz.idx], quiz);
}

function myBankSelectAnswer(letter){
  const quiz = STATE.myBankQuiz;
  const q = myBankCurrentQ();
  quiz.answers[q.id] = letter;
  if(quiz.instantFeedback && quiz.timerMode==='perQuestion') myBankStopTimer();
  render();
}

function myBankGoToQuestion(newIdx){
  const quiz = STATE.myBankQuiz;
  if(newIdx<0 || newIdx>=quiz.qids.length) return;
  quiz.idx = newIdx;
  if(quiz.timerMode==='perQuestion'){ quiz.remainingSec = quiz.perQSeconds; }
  render();
}

function myBankAdvance(){
  const quiz = STATE.myBankQuiz;
  if(quiz.idx+1 < quiz.qids.length) myBankGoToQuestion(quiz.idx+1);
  else myBankFinish();
}

function myBankFinish(){
  myBankStopTimer();
  STATE.view = 'myBankResult';
  render();
}

function myBankQuizView(){
  const quiz = STATE.myBankQuiz;
  const q = myBankCurrentQ();
  const total = quiz.qids.length;
  const letters = ['a','b','c','d'];
  const selectedLetter = quiz.answers[q.id] || null;
  const reveal = quiz.instantFeedback && !!selectedLetter;
  const optsHtml = q.options.map((opt,i)=>{
    const letter = letters[i];
    let cls = 'option';
    let disabled = '';
    if(reveal){
      disabled = 'disabled';
      if(letter===q.correct) cls += ' correct';
      else if(letter===selectedLetter) cls += ' incorrect';
    } else if(selectedLetter===letter){
      cls += ' selected';
    }
    return `<button class="${cls}" data-action="mybank-answer" data-letter="${letter}" ${disabled}>
      <span class="letter">${letter})</span>${esc(opt)}
    </button>`;
  }).join('');
  return `
  <div class="quiz-topbar">
    <span class="qcount">Pregunta ${quiz.idx+1} / ${total}</span>
    ${quiz.timerMode==='total' ? `<span class="score mono" id="mybank-timer-display">${formatTime(quiz.remainingSec)}</span>` :
      quiz.timerMode==='perQuestion' ? `<span class="score mono" id="mybank-timer-display">⏱ ${formatTime(quiz.remainingSec)}</span>` :
      `<span class="score">Sin límite de tiempo</span>`}
  </div>
  <div class="qcard">
    ${q.category ? `<div class="qtag">${esc(q.category)}</div>` : ''}
    <div class="qtext">${esc(q.question)}</div>
    ${optsHtml}
    ${reveal ? `<div class="card-feedback ${selectedLetter===q.correct?'ok':'bad'}">
      <div class="ref-card ${selectedLetter===q.correct?'yellow':'red'}"></div>
      <div class="msg">${selectedLetter===q.correct ? '¡Correcto!' : 'Incorrecto.'}<small>${selectedLetter===q.correct ? '' : 'La respuesta correcta era la '+q.correct.toUpperCase()+').'}</small></div>
    </div>
    ${q.explanation ? `<div style="margin-top:10px; padding:10px 12px; background:#FBF1F1; border-radius:8px; font-size:13px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}` : ''}
  </div>
  <div class="quiz-actions">
    <button class="btn btn-ghost" data-action="mybank-quit">Salir</button>
    <button class="btn btn-secondary" data-action="mybank-prev" ${quiz.idx===0?'disabled':''}>Anterior</button>
    ${quiz.instantFeedback
      ? (reveal ? `<button class="btn btn-primary" data-action="mybank-advance">${quiz.idx+1<total?'Siguiente':'Ver resultado'}</button>` : '')
      : `${quiz.idx+1<total ? `<button class="btn btn-secondary" data-action="mybank-advance-nav">Siguiente</button>` : ''}<button class="btn btn-primary" data-action="mybank-finish">Finalizar test</button>`
    }
  </div>
  `;
}

function myBankResultView(){
  const quiz = STATE.myBankQuiz;
  const total = quiz.qids.length;
  const score = quiz.qids.filter(qid => {
    const q = myBankQuestionById(qid, quiz);
    return q && quiz.answers[qid] === q.correct;
  }).length;
  const answered = Object.keys(quiz.answers).length;
  const pct = total ? Math.round(score/total*100) : 0;
  return `
  <div class="result-hero">
    <div class="big" style="color:${scoreColor(pct)};">${pct}%</div>
    <div class="label">${score} de ${total} respuestas correctas${answered<total ? ' · '+(total-answered)+' sin responder' : ''}</div>
  </div>
  <div style="display:flex; gap:10px; margin-top:16px; justify-content:center; flex-wrap:wrap;">
    <button class="btn btn-primary" data-action="mybank">Volver a Mis Propios Test</button>
    <button class="btn btn-secondary" data-action="mybank-train-config">Nuevo test</button>
  </div>
  `;
}

/* ---------------- MIS DOCUMENTOS: archivos PDF privados por usuario ----------------
   Metadatos (carpetas y ficha de cada documento) en el mismo almacén privado de siempre;
   los archivos en sí viven en Supabase Storage, bucket "mybank-docs", en una ruta con tu
   propio user_id delante, protegida por políticas para que nadie más pueda leerlas. */

const MYDOCS_BUCKET = 'mybank-docs';
const MYDOCS_MAX_BYTES = 20 * 1024 * 1024;

function formatBytes(bytes){
  if(!bytes) return '0 KB';
  const kb = bytes/1024;
  if(kb < 1024) return Math.round(kb)+' KB';
  return (kb/1024).toFixed(1)+' MB';
}

function myDocsChildFolders(parentId){
  return (STATE.storage.myDocsFolders||[]).filter(f=>f.parentId===parentId).sort((a,b)=>a.name.localeCompare(b.name));
}

function myDocsInFolder(folderId){
  return (STATE.storage.myDocs||[]).filter(d=>d.folderId===folderId);
}

function myDocsBreadcrumb(folderId){
  const trail = [];
  let cur = folderId;
  while(cur){
    const f = (STATE.storage.myDocsFolders||[]).find(x=>x.id===cur);
    if(!f) break;
    trail.unshift(f);
    cur = f.parentId;
  }
  return trail;
}

function myDocsSort(list, dateField){
  const by = STATE.myDocsSortBy || 'name';
  const arr = list.slice();
  if(by==='date') arr.sort((a,b)=>(b[dateField]||0)-(a[dateField]||0));
  else arr.sort((a,b)=>a.name.localeCompare(b.name));
  return arr;
}

function myDocRowHtml(d, showPath){
  const ic = (n) => shellIcon(n);
  const pathLabel = showPath ? myDocsBreadcrumb(d.folderId).map(f=>f.name).join(' / ') || 'Mis Documentos' : null;
  const folderOptions = [{id:'', name:'Mis Documentos', depth:0}].concat(myDocsAllFoldersFlat().map(x=>({id:x.folder.id, name:x.folder.name, depth:x.depth})));
  return `
    <article class="ac-doc">
      <div class="ac-doc-main">
        <span class="ac-doc-ic">${ic('file')}</span>
        <div class="ac-doc-info">
          <strong>${esc(d.name)}</strong>
          <small>${formatBytes(d.size)} · ${new Date(d.createdAt).toLocaleDateString('es-ES')}${pathLabel ? ' · ' + esc(pathLabel) : ''}</small>
        </div>
      </div>
      ${STATE.myDocsEditingNotesId===d.id ? `
        <textarea id="mydoc-notes-${d.id}" placeholder="Notas o comentario personal..." maxlength="1000" style="margin-top:12px;">${esc(d.notes||'')}</textarea>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-primary" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-save-notes" data-id="${d.id}">Guardar nota</button>
          <button class="btn btn-ghost" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-cancel-notes">Cancelar</button>
        </div>
      ` : (d.notes ? `<div class="ac-doc-note">${esc(d.notes)}</div>` : '')}
      ${STATE.myDocsMovingId===d.id ? `
        <div style="margin-top:12px;">
          <label>Mover a</label>
          <select id="mydocs-move-select-${d.id}">
            ${folderOptions.map(f=>`<option value="${f.id}" ${d.folderId===(f.id||null)?'selected':''}>${'— '.repeat(f.depth)}${esc(f.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div class="ac-doc-actions">
        <button class="btn btn-primary" data-action="mydocs-preview" data-id="${d.id}">${ic('eye')} Ver</button>
        ${STATE.myDocsEditingNotesId===d.id ? '' : `<button class="btn btn-ghost" data-action="mydocs-edit-notes" data-id="${d.id}">${ic('pencil')} ${d.notes?'Editar nota':'Nota'}</button>`}
        ${STATE.myDocsMovingId===d.id ? '' : `<button class="btn btn-ghost" data-action="mydocs-move" data-id="${d.id}">${ic('folder')} Mover</button>`}
        <button class="btn btn-ghost btn-danger-soft" data-action="mydocs-delete" data-id="${d.id}">${ic('trash')} Eliminar</button>
      </div>
    </article>
  `;
}

function myDocsView(){
  const ic = (n) => shellIcon(n);
  const folderId = STATE.myDocsCurrentFolder;
  const s = (STATE.myDocsSearch||'').trim().toLowerCase();
  const totalDocs = (STATE.storage.myDocs||[]).length;

  const sortControls = `
    <div class="ac-seg">
      <button class="${STATE.myDocsSortBy==='name'?'active':''}" data-action="mydocs-set-sort" data-sort="name">Nombre</button>
      <button class="${STATE.myDocsSortBy==='date'?'active':''}" data-action="mydocs-set-sort" data-sort="date">Fecha</button>
    </div>
  `;
  const heroActions = `
    ${STATE.myDocsCreatingFolder ? '' : `<button class="btn btn-glass" data-action="mydocs-new-folder">${ic('plus')} Nueva carpeta</button>`}
    <label class="btn btn-yellow" style="cursor:pointer; margin:0;">
      ${ic('plus')} ${STATE.myDocsUploading ? 'Subiendo...' : 'Subir PDF'}
      <input type="file" id="mydocs-upload-input" accept="application/pdf" style="display:none;" ${STATE.myDocsUploading?'disabled':''}>
    </label>
    <span class="ac-last">o arrastra un PDF aquí</span>`;
  const toolbar = `
  ${STATE.myDocsCreatingFolder ? `
  <div class="tc-card" style="margin-bottom:14px;">
    <div class="tc-card-head"><span class="tc-step">${ic('folder')}</span><div><h3>Nueva carpeta</h3><small>Organiza tus documentos</small></div></div>
    <input type="text" id="mydocs-new-folder-name" placeholder="Ej: Temporada 2025/2026" maxlength="60">
    <div style="margin-top:14px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="mydocs-save-folder">Crear</button>
      <button class="btn btn-ghost" data-action="mydocs-cancel-folder">Cancelar</button>
    </div>
  </div>
  ` : ''}
  <div class="ac-search">
    ${ic('search')}
    <input type="text" id="mydocs-search" placeholder="Busca en todos tus documentos y carpetas por nombre o nota..." value="${esc(STATE.myDocsSearch)}" maxlength="100" aria-label="Buscar documentos">
  </div>
  `;

  if(s){
    const matchFolders = (STATE.storage.myDocsFolders||[]).filter(f=>f.name.toLowerCase().includes(s));
    const matchDocs = (STATE.storage.myDocs||[]).filter(d => d.name.toLowerCase().includes(s) || (d.notes||'').toLowerCase().includes(s));
    const folderRows = myDocsSort(matchFolders,'createdAt').map(f => `
      <div class="ac-folder">
        <button class="ac-folder-open" data-action="mydocs-open-folder" data-folder="${f.id}">
          <span class="ac-folder-ic">${ic('folder')}</span>
          <span class="ac-folder-txt"><strong>${esc(f.name)}</strong><small>${esc(myDocsBreadcrumb(f.parentId).map(x=>x.name).join(' / ') || 'Mis Documentos')}</small></span>
        </button>
        <span class="ac-folder-go">${ic('chevron')}</span>
      </div>`).join('');
    const docRows = myDocsSort(matchDocs,'createdAt').map(d=>myDocRowHtml(d, true)).join('');
    return `
    <button class="backbtn" data-action="academia">&larr; Mi Academia</button>
    ${acHero('Mi Academia · Documentos', 'Resultados de búsqueda', `Resultados de "${esc(STATE.myDocsSearch)}" en todas las carpetas.`,
      [[matchFolders.length, 'Carpetas'], [matchDocs.length, 'Documentos']], heroActions)}
    <div id="mydocs-dropzone" class="mydocs-dropzone">
    ${toolbar}
    ${matchFolders.length>0 ? `<div class="ac-folders" style="margin-bottom:14px;">${folderRows}</div>` : ''}
    ${docRows ? `<div class="ac-doclist">${docRows}</div>` : `<div class="ac-empty">${ic('search')}<strong>Nada coincide con esa búsqueda</strong><span>Prueba con otra palabra.</span></div>`}
    </div>
    `;
  }

  const subfolders = myDocsSort(myDocsChildFolders(folderId), 'createdAt');
  const docs = myDocsSort(myDocsInFolder(folderId), 'createdAt');
  const trail = myDocsBreadcrumb(folderId);

  const breadcrumbHtml = `
    <div class="ac-crumbs">
      <button class="${trail.length===0 ? 'active' : ''}" data-action="mydocs-open-folder" data-folder="">${ic('folder')} Mis Documentos</button>
      ${trail.map((f,i)=>`<span>/</span><button class="${i===trail.length-1 ? 'active' : ''}" data-action="mydocs-open-folder" data-folder="${f.id}">${esc(f.name)}</button>`).join('')}
    </div>
  `;

  const folderRows = subfolders.map(f => {
    const childCount = myDocsChildFolders(f.id).length + myDocsInFolder(f.id).length;
    if(STATE.myDocsRenamingFolderId===f.id){
      return `<div class="ac-folder editing">
        <input type="text" id="mydocs-rename-input-${f.id}" value="${esc(f.name)}" maxlength="60">
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-primary" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-save-rename-folder" data-folder="${f.id}">Guardar</button>
          <button class="btn btn-ghost" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-cancel-rename-folder">Cancelar</button>
        </div>
      </div>`;
    }
    if(STATE.myDocsMovingFolderId===f.id){
      const excludeIds = new Set([f.id, ...myDocsDescendantIds(f.id)]);
      const folderOptions = [{id:'', name:'Mis Documentos', depth:0}].concat(
        myDocsAllFoldersFlat().filter(x=>!excludeIds.has(x.folder.id)).map(x=>({id:x.folder.id, name:x.folder.name, depth:x.depth}))
      );
      return `<div class="ac-folder editing">
        <div style="font-size:13px; font-weight:700; margin-bottom:8px;">${esc(f.name)}</div>
        <select id="mydocs-move-folder-select-${f.id}">
          ${folderOptions.map(o=>`<option value="${o.id}" ${f.parentId===(o.id||null)?'selected':''}>${'— '.repeat(o.depth)}${esc(o.name)}</option>`).join('')}
        </select>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-primary" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-confirm-move-folder" data-folder="${f.id}">Mover aquí</button>
          <button class="btn btn-ghost" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-cancel-move-folder">Cancelar</button>
        </div>
      </div>`;
    }
    return `
    <div class="ac-folder">
      <button class="ac-folder-open" data-action="mydocs-open-folder" data-folder="${f.id}">
        <span class="ac-folder-ic">${ic('folder')}</span>
        <span class="ac-folder-txt"><strong>${esc(f.name)}</strong><small>${childCount} ${childCount === 1 ? 'elemento' : 'elementos'}</small></span>
      </button>
      <div class="ac-folder-tools">
        <button class="icon-btn" title="Renombrar" data-action="mydocs-rename-folder" data-folder="${f.id}">${ic('pencil')}</button>
        <button class="icon-btn" title="Mover" data-action="mydocs-move-folder" data-folder="${f.id}">${ic('chevron')}</button>
        <button class="icon-btn danger" title="Eliminar" data-action="mydocs-delete-folder" data-folder="${f.id}">${ic('trash')}</button>
      </div>
    </div>`;
  }).join('');

  const docRows = docs.map(d=>myDocRowHtml(d, false)).join('');
  const title = trail.length ? esc(trail[trail.length-1].name) : 'Mis Documentos';

  return `
  <button class="backbtn" data-action="academia">&larr; Mi Academia</button>
  ${acHero('Mi Academia · Documentos', title, 'Tus PDFs privados (informes, circulares, evaluaciones...). Solo tú puedes verlos. Máximo 20 MB por archivo.',
    [[subfolders.length, 'Carpetas'], [docs.length, 'Aquí'], [totalDocs, 'En total']], heroActions)}

  <div class="ac-bar">${breadcrumbHtml}${sortControls}</div>

  <div id="mydocs-dropzone" class="mydocs-dropzone">
  ${toolbar}

  ${subfolders.length>0 ? `<div class="lg-section-head"><h2>Carpetas</h2></div><div class="ac-folders" style="margin-bottom:18px;">${folderRows}</div>` : ''}

  ${docRows ? `<div class="lg-section-head"><h2>Documentos</h2></div><div class="ac-doclist">${docRows}</div>` : `<div class="ac-empty">${ic('file')}<strong>${subfolders.length===0 && docs.length===0 ? 'Esta carpeta está vacía' : 'No hay documentos en esta carpeta'}</strong><span>Crea una subcarpeta o sube tu primer PDF.</span></div>`}
  </div>
  `;
}

function myDocsPreviewView(){
  const ic = (n) => shellIcon(n);
  const doc = (STATE.storage.myDocs||[]).find(d=>d.id===STATE.myDocsPreviewId);
  if(!doc) return `<button class="backbtn" data-action="mydocs">&larr; Mis Documentos</button><div class="ac-empty">${ic('file')}<strong>Documento no encontrado</strong></div>`;
  const actions = STATE.myDocsPreviewUrl ? `<a href="${STATE.myDocsPreviewUrl}" target="_blank" rel="noopener" class="btn btn-yellow" style="text-decoration:none;">${ic('eye')} Abrir en pestaña nueva</a>` : '';
  return `
  <button class="backbtn" data-action="mydocs">&larr; Mis Documentos</button>
  ${acHero('Documento', esc(doc.name), `${formatBytes(doc.size)} · ${new Date(doc.createdAt).toLocaleDateString('es-ES')}`, [], actions, true)}
  ${STATE.myDocsPreviewUrl
    ? `<iframe class="ac-pdf" src="${STATE.myDocsPreviewUrl}"></iframe>`
    : `<div class="ac-empty">${ic('clock')}<strong>Cargando documento...</strong></div>`}
  `;
}

async function myDocsAddFolder(){
  const input = document.getElementById('mydocs-new-folder-name');
  const name = input.value.trim();
  if(!name){ STATE.toast = 'Escribe un nombre para la carpeta.'; render(); return; }
  const siblings = myDocsChildFolders(STATE.myDocsCurrentFolder);
  if(siblings.some(f=>f.name.toLowerCase()===name.toLowerCase())){
    STATE.toast = 'Ya tienes una carpeta con ese nombre aquí.';
    render();
    return;
  }
  STATE.storage.myDocsFolders.push({ id:'FLD'+Date.now().toString(36)+Math.random().toString(36).slice(2,7), name, parentId: STATE.myDocsCurrentFolder, createdAt: Date.now() });
  await saveMyDocsFolders();
  STATE.myDocsCreatingFolder = false;
  render();
}

function myDocsRenameFolder(id){
  const input = document.getElementById('mydocs-rename-input-'+id);
  const name = input.value.trim();
  const folder = STATE.storage.myDocsFolders.find(f=>f.id===id);
  if(!folder) return;
  if(!name){ STATE.toast = 'Escribe un nombre para la carpeta.'; render(); return; }
  const siblings = myDocsChildFolders(folder.parentId).filter(f=>f.id!==id);
  if(siblings.some(f=>f.name.toLowerCase()===name.toLowerCase())){
    STATE.toast = 'Ya tienes una carpeta con ese nombre aquí.';
    render();
    return;
  }
  folder.name = name;
  saveMyDocsFolders();
  STATE.myDocsRenamingFolderId = null;
  render();
}

function myDocsAllFoldersFlat(){
  const result = [];
  const walk = (parentId, depth) => {
    myDocsChildFolders(parentId).forEach(f => {
      result.push({ folder: f, depth });
      walk(f.id, depth+1);
    });
  };
  walk(null, 0);
  return result;
}

function myDocsDescendantIds(id){
  const result = new Set();
  const walk = (parentId) => {
    myDocsChildFolders(parentId).forEach(f => { result.add(f.id); walk(f.id); });
  };
  walk(id);
  return result;
}

async function myDocsMoveFolder(id, newParentId){
  const folder = (STATE.storage.myDocsFolders||[]).find(f=>f.id===id);
  if(!folder) return;
  const target = newParentId || null;
  if(target === id){ STATE.toast = 'No puedes mover una carpeta dentro de sí misma.'; render(); return; }
  if(target && myDocsDescendantIds(id).has(target)){ STATE.toast = 'No puedes mover una carpeta dentro de una de sus propias subcarpetas.'; render(); return; }
  const siblings = myDocsChildFolders(target).filter(f=>f.id!==id);
  if(siblings.some(f=>f.name.toLowerCase()===folder.name.toLowerCase())){
    STATE.toast = 'Ya tienes una carpeta con ese nombre en el destino.';
    render();
    return;
  }
  folder.parentId = target;
  await saveMyDocsFolders();
  STATE.myDocsMovingFolderId = null;
  STATE.toast = 'Carpeta movida.';
  render();
}

async function moveMyDoc(id, folderId){
  const doc = (STATE.storage.myDocs||[]).find(d=>d.id===id);
  if(!doc) return;
  doc.folderId = folderId || null;
  await saveMyDocs();
  STATE.myDocsMovingId = null;
  STATE.toast = 'Documento movido.';
  render();
}

function myDocsDeleteFolder(id){
  const hasChildren = myDocsChildFolders(id).length>0 || myDocsInFolder(id).length>0;
  if(hasChildren){
    STATE.toast = 'Vacía esta carpeta antes de eliminarla (mueve o borra sus documentos y subcarpetas).';
    render();
    return;
  }
  STATE.storage.myDocsFolders = STATE.storage.myDocsFolders.filter(f=>f.id!==id);
  saveMyDocsFolders();
  render();
}

async function uploadMyDoc(file){
  if(!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if(!isPdf){ STATE.toast = 'Solo se admiten archivos PDF.'; render(); return; }
  if(file.size > MYDOCS_MAX_BYTES){ STATE.toast = 'El archivo pesa demasiado (máximo 20 MB).'; render(); return; }
  STATE.myDocsUploading = true;
  render();
  try{
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path = `${CURRENT_USER_ID}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName}`;
    const { error } = await supabaseClient.storage.from(MYDOCS_BUCKET).upload(path, file, { contentType: 'application/pdf' });
    if(error) throw error;
    STATE.storage.myDocs.push({
      id: 'MD'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      name: file.name, folderId: STATE.myDocsCurrentFolder, path, size: file.size, notes: '',
      createdAt: Date.now()
    });
    await saveMyDocs();
    STATE.toast = 'Documento subido.';
  }catch(e){
    STATE.toast = 'No se pudo subir el documento. Inténtalo de nuevo.';
  }
  STATE.myDocsUploading = false;
  render();
}

async function myDocsPreview(id){
  const doc = (STATE.storage.myDocs||[]).find(d=>d.id===id);
  if(!doc) return;
  STATE.myDocsPreviewId = id;
  STATE.myDocsPreviewUrl = null;
  STATE.view = 'myDocsPreview';
  render();
  try{
    const { data, error } = await supabaseClient.storage.from(MYDOCS_BUCKET).createSignedUrl(doc.path, 3600);
    if(error) throw error;
    STATE.myDocsPreviewUrl = data.signedUrl;
    render();
  }catch(e){
    STATE.toast = 'No se pudo cargar el documento.';
    render();
  }
}

async function deleteMyDoc(id){
  const doc = (STATE.storage.myDocs||[]).find(d=>d.id===id);
  if(!doc) return;
  try{ await supabaseClient.storage.from(MYDOCS_BUCKET).remove([doc.path]); }catch(e){}
  STATE.storage.myDocs = STATE.storage.myDocs.filter(d=>d.id!==id);
  await saveMyDocs();
  render();
}

function saveMyDocNotes(id){
  const el = document.getElementById('mydoc-notes-'+id);
  const doc = (STATE.storage.myDocs||[]).find(d=>d.id===id);
  if(doc && el){ doc.notes = el.value.trim(); saveMyDocs(); }
  STATE.myDocsEditingNotesId = null;
  render();
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const WEEKDAY_LETTERS = ['L','M','X','J','V','S','D'];

function recentPerformanceView(){
  const ic = (n) => shellIcon(n);
  const rows = recentPerformanceByRule(25);
  const sort = STATE.perfSort || 'rule';
  const tone = (p) => p === null ? 'none' : p >= 85 ? 'good' : p >= 60 ? 'mid' : 'bad';

  const withData = rows.filter(r => r.total > 0);
  const totalAnswers = withData.reduce((s, r) => s + r.total, 0);
  const weighted = totalAnswers ? Math.round(withData.reduce((s, r) => s + r.pct * r.total, 0) / totalAnswers) : null;
  const strongCount = withData.filter(r => r.pct >= 85).length;
  const weakCount = withData.filter(r => r.pct < 60).length;

  let list = rows.slice();
  if(sort === 'best') list.sort((a, b) => (b.pct === null ? -1 : b.pct) - (a.pct === null ? -1 : a.pct));
  else if(sort === 'worst') list.sort((a, b) => (a.pct === null ? 101 : a.pct) - (b.pct === null ? 101 : b.pct));

  const tiles = list.map(r => `
    <button class="pf-tile ${tone(r.pct)}" data-action="open-law" data-law="${r.rule}">
      <div class="pf-tile-top"><span class="pf-n">R${r.rule}</span><span class="pf-pct">${r.pct === null ? '—' : r.pct + '%'}</span></div>
      <div class="pf-name">${esc(LAW_NAMES[r.rule])}</div>
      <div class="pf-bar"><i style="width:${r.pct === null ? 0 : r.pct}%"></i></div>
      <div class="pf-meta">${r.total === 0 ? 'Sin datos aún' : r.total + (r.total === 1 ? ' respuesta analizada' : ' respuestas analizadas')}</div>
    </button>`).join('');

  const seg = (key, label) => `<button class="${sort === key ? 'active' : ''}" data-action="perf-sort" data-sort="${key}">${label}</button>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Analiza tu rendimiento</div>
      <h1>Acierto reciente</h1>
      <p>Comprueba en qué reglas obtienes mejores resultados y cuáles necesitas reforzar. Los porcentajes se calculan sobre tus últimas 25 respuestas por regla.</p>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${weighted === null ? '—' : weighted + '%'}</b><span>Acierto medio</span></div>
      <div class="lg-stat"><b>${strongCount}</b><span>Reglas dominadas</span></div>
      <div class="lg-stat"><b>${weakCount}</b><span>A reforzar</span></div>
    </div>
  </section>

  <div class="ac-bar">
    <div class="st-legend" style="margin:0;"><span><i class="good"></i> 85% o más</span><span><i class="mid"></i> 60–84%</span><span><i class="bad"></i> menos de 60%</span><span><i class="none"></i> sin datos</span></div>
    <div class="ac-seg">${seg('rule', 'Por regla')}${seg('best', 'Mejores primero')}${seg('worst', 'A reforzar primero')}</div>
  </div>

  ${withData.length === 0 ? `<div class="st-note" style="margin-bottom:14px;">Responde algunas preguntas y aquí verás cómo te va en cada regla.</div>` : ''}
  <div class="pf-grid">${tiles}</div>
  `;
}

function streakCalendarView(){
  const ic = (n) => shellIcon(n);
  const days = activeDaysSet();
  const eventsByDay = calendarEventsByDay();
  const streak = computeStreak();
  const bestStreak = Math.max(STATE.storage.maxStreak || 0, streak);
  const totalActiveDays = days.size;
  const now = new Date();
  const todayKey = dayKey(now.getTime());
  const year = STATE.calendarYear || now.getFullYear();
  const isCurrentYear = year === now.getFullYear();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let months = '';
  for(let m=0; m<12; m++){
    const firstOfMonth = new Date(year, m, 1);
    const daysInMonth = new Date(year, m+1, 0).getDate();
    let startWeekday = firstOfMonth.getDay(); // 0=Sunday
    startWeekday = (startWeekday===0) ? 6 : startWeekday-1; // convert to Monday-first index 0-6

    let cells = WEEKDAY_LETTERS.map(l => `<div class="cal-wd">${l}</div>`).join('');
    for(let i=0;i<startWeekday;i++){ cells += `<div class="cal-cell empty"></div>`; }
    for(let d=1; d<=daysInMonth; d++){
      const key = year+'-'+(m+1)+'-'+d;
      const isActive = days.has(key);
      const isFuture = new Date(year,m,d) > now;
      const isToday = isCurrentYear && now.getDate()===d && now.getMonth()===m;
      const dayEvents = eventsByDay[key] || [];
      const hasEvent = dayEvents.length>0;
      const eventTitles = dayEvents.map(ev=>`${CALENDAR_EVENT_TYPES[ev.type].icon} ${ev.title}`).join(', ');
      const titleAttr = `${d} ${MONTH_NAMES[m]} ${year}${hasEvent ? ' · '+eventTitles : ''}`;
      let cellStyle = '';
      if(hasEvent){
        const primaryType = CALENDAR_EVENT_TYPES[dayEvents[0].type] || CALENDAR_EVENT_TYPES.other;
        cellStyle = `--event-dot:${primaryType.color}; opacity:1;`;
        if(!isActive) cellStyle += ` background:${primaryType.bg}; color:${primaryType.color}; font-weight:700;`;
      }
      cells += `<div class="cal-cell ${isActive?'active':''} ${(isFuture && !hasEvent)?'future':''} ${isToday?'today':''} ${hasEvent?'has-event':''}" style="${cellStyle}" title="${esc(titleAttr)}">${d}</div>`;
    }

    const isCurMonth = isCurrentYear && now.getMonth() === m;
    months += `<div class="cal-month ${isCurMonth ? 'current' : ''}">
      <div class="cal-month-name">${MONTH_NAMES[m]}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
  }

  const sortedEvents = (STATE.storage.calendarEvents||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const daysTo = (dateStr) => {
    const [y,m,d] = dateStr.split('-').map(Number);
    return Math.round((new Date(y, m-1, d).getTime() - todayMid) / 86400000);
  };
  const whenLabel = (n) => n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : n > 1 ? 'En ' + n + ' días' : n === -1 ? 'Ayer' : 'Hace ' + Math.abs(n) + ' días';
  const eventRows = sortedEvents.map(ev=>{
    const isPast = ev.date < todayKeyISO(now);
    const t = CALENDAR_EVENT_TYPES[ev.type] || CALENDAR_EVENT_TYPES.other;
    const n = daysTo(ev.date);
    return `<div class="sk-event ${isPast ? 'past' : ''}" style="--ec:${t.color}; --eb:${t.bg};">
      <span class="sk-event-ic">${t.icon}</span>
      <div class="sk-event-body">
        <strong>${esc(ev.title)}</strong>
        <small>${t.label} · ${formatEventDate(ev.date)}</small>
      </div>
      <span class="sk-event-when">${whenLabel(n)}</span>
      <button class="icon-btn danger" title="Eliminar" data-action="calendar-delete-event" data-id="${ev.id}">${ic('trash')}</button>
    </div>`;
  }).join('');

  const atMax = sortedEvents.length >= CALENDAR_EVENTS_MAX;
  const addForm = STATE.calendarAddingEvent ? `
  <div class="sk-form">
    <label>Fecha</label>
    <input type="date" id="cal-event-date">
    <label>Título</label>
    <input type="text" id="cal-event-title" placeholder="Ej: Examen teórico CTA" maxlength="100">
    <label>Tipo</label>
    <select id="cal-event-type">
      ${Object.keys(CALENDAR_EVENT_TYPES).map(k=>`<option value="${k}">${CALENDAR_EVENT_TYPES[k].icon} ${CALENDAR_EVENT_TYPES[k].label}</option>`).join('')}
    </select>
    <div style="margin-top:14px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="calendar-save-event">Guardar</button>
      <button class="btn btn-ghost" data-action="calendar-cancel-event">Cancelar</button>
    </div>
  </div>
  ` : '';

  const legend = `
  <div class="sk-legend">
    <span><i class="act"></i> Día con actividad</span>
    <span><i class="none"></i> Sin actividad</span>
    ${Object.values(CALENDAR_EVENT_TYPES).map(t=>`<span><i class="dot" style="background:${t.color};"></i> ${t.label}</span>`).join('')}
  </div>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Tu constancia</div>
      <h1>Racha de estudio</h1>
      <p>Convierte el calendario en tu centro de planificación. Registra automáticamente los días en los que estudias y añade las fechas más importantes de tu preparación, como exámenes, pruebas físicas o reuniones, para tener toda tu planificación en un mismo lugar.</p>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat sk-flame"><b>${streak}</b><span>${streak===1 ? 'Día seguido' : 'Días seguidos'}</span></div>
      <div class="lg-stat"><b>${bestStreak}</b><span>Mejor racha</span></div>
      <div class="lg-stat"><b>${totalActiveDays}</b><span>${totalActiveDays===1 ? 'Día activo' : 'Días activos'}</span></div>
    </div>
  </section>

  <div class="sk-layout">
    <div class="tc-card sk-cal">
      <div class="sk-year">
        <button class="btn btn-ghost" data-action="calendar-year" data-delta="-1" ${year<=2025?'disabled':''}>${ic('chevron')} ${year-1}</button>
        <strong>${year}</strong>
        <button class="btn btn-ghost" data-action="calendar-year" data-delta="1" ${year>=now.getFullYear()+1?'disabled':''}>${year+1} ${ic('chevron')}</button>
      </div>
      <div class="cal-wrap">${months}</div>
      ${legend}
    </div>

    <aside class="tc-card sk-events">
      <div class="tc-card-head">
        <span class="tc-step">${ic('calendar')}</span>
        <div><h3>Tus eventos</h3><small>${sortedEvents.length} de ${CALENDAR_EVENTS_MAX} · exámenes, pruebas y reuniones</small></div>
      </div>
      ${STATE.calendarAddingEvent || atMax ? '' : `<button class="btn btn-primary sk-add" data-action="calendar-add-event">${ic('plus')} Añadir evento</button>`}
      ${atMax && !STATE.calendarAddingEvent ? `<div class="st-note" style="margin-bottom:12px;">Has llegado al máximo de ${CALENDAR_EVENTS_MAX} eventos. Elimina alguno para añadir otro.</div>` : ''}
      ${addForm}
      ${sortedEvents.length>0 ? `<div class="sk-eventlist">${eventRows}</div>` : (STATE.calendarAddingEvent ? '' : `<div class="ac-empty" style="padding:24px 14px;">${ic('calendar')}<strong>Sin eventos todavía</strong><span>Marca tu próximo examen o prueba para tenerlo siempre a la vista.</span></div>`)}
    </aside>
  </div>
  `;
}

function achievementsView(){ return (typeof gamiView === 'function') ? gamiView() : ''; }

async function loadProfileData(){
  try{
    const { data } = await supabaseClient.auth.getUser();
    STATE.profileData = (data && data.user && data.user.user_metadata) || {};
  }catch(e){
    STATE.profileData = {};
  }
  render();
}

/* Nombre de pila del perfil. Al entrar con Google, Supabase reescribe "full_name" con el nombre completo
   de la cuenta de Google; el nombre que edita la persona se guarda aparte en "first_name" y manda sobre él
   (aunque esté vacío). Si todavía no existe, se usa "full_name". */
function profileFirstName(p){
  if(!p) return '';
  if(Object.prototype.hasOwnProperty.call(p, 'first_name') && p.first_name !== null && p.first_name !== undefined) return String(p.first_name);
  return String(p.full_name || '');
}

/* ---------------- SEGURIDAD · verificación en dos pasos (2FA con app de códigos, TOTP) ----------------
   Solo para cuentas de administrador. Activar: Configuración → Seguridad. Al entrar, quien tiene el 2FA activo
   debe escribir el código (pantalla en app.html). Ver supabase/admin-roles-fase-a.sql. */
async function loadMfaState(){
  const m = STATE.mfa = STATE.mfa || {};
  try{
    const r = await supabaseClient.rpc('weref_has_admin_role');
    m.adminRole = !r.error && r.data === true;
    if(r.error && isDevUser()) m.adminRole = true;   // antes de crear la función en el servidor, se reconoce por el rol de siempre
    const f = await supabaseClient.auth.mfa.listFactors();
    m.factors = (f.data && f.data.totp) || [];
    m.unverified = ((f.data && f.data.all) || []).filter(x => x.factor_type === 'totp' && x.status !== 'verified');
    const a = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
    m.aal = a.data ? a.data.currentLevel : null;
  }catch(e){ m.error = 'No se pudo comprobar el estado del 2FA.'; }
  m.loaded = true;
  render();
}

async function mfaStartEnroll(){
  const m = STATE.mfa = STATE.mfa || {};
  m.busy = true; m.error = ''; render();
  try{
    // Se limpian intentos de activación a medias (factores sin verificar) para poder empezar de cero.
    for(const u of (m.unverified || [])){ try{ await supabaseClient.auth.mfa.unenroll({ factorId: u.id }); }catch(e){} }
    const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'WEREF ' + new Date().toISOString().slice(0, 10) });
    if(error) throw error;
    m.enrolling = { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  }catch(e){ m.error = 'No se pudo iniciar la activación. Inténtalo de nuevo.'; }
  m.busy = false; render();
}

async function mfaVerifyEnroll(){
  const m = STATE.mfa;
  const code = ((document.getElementById('mfa-code') || {}).value || '').replace(/\s/g, '');
  if(!m || !m.enrolling) return;
  if(!/^\d{6}$/.test(code)){ m.error = 'Escribe los 6 números que muestra tu app.'; render(); return; }
  m.busy = true; m.error = ''; render();
  try{
    const ch = await supabaseClient.auth.mfa.challenge({ factorId: m.enrolling.id });
    if(ch.error) throw ch.error;
    const v = await supabaseClient.auth.mfa.verify({ factorId: m.enrolling.id, challengeId: ch.data.id, code });
    if(v.error) throw v.error;
    m.enrolling = null; m.busy = false;
    STATE.toast = 'Verificación en dos pasos activada.';
    await loadMfaState();
    return;
  }catch(e){ m.error = 'Código incorrecto o caducado. Prueba con el siguiente código de tu app.'; }
  m.busy = false; render();
}

async function mfaCancelEnroll(){
  const m = STATE.mfa;
  if(m && m.enrolling){ try{ await supabaseClient.auth.mfa.unenroll({ factorId: m.enrolling.id }); }catch(e){} m.enrolling = null; }
  await loadMfaState();
}

async function mfaDisable(factorId){
  const ok = await appConfirm({ icon: 'lock', title: '¿Desactivar la verificación en dos pasos?', message: 'La cuenta quedará protegida solo por la contraseña. Para quitarla Supabase te pedirá haber verificado el código en esta sesión.', confirmText: 'Sí, desactivar', cancelText: 'Cancelar', danger: true });
  if(!ok) return;
  const m = STATE.mfa;
  try{
    const { error } = await supabaseClient.auth.mfa.unenroll({ factorId });
    if(error) throw error;
    STATE.toast = 'Verificación en dos pasos desactivada.';
  }catch(e){ m.error = 'No se pudo desactivar (hace falta haber verificado el código en esta sesión).'; }
  await loadMfaState();
}

function mfaCardHtml(){
  const m = STATE.mfa;
  if(!m || !m.adminRole) return '';
  const ic = (n) => shellIcon(n);
  const on = (m.factors || []).length > 0;
  let body;
  if(!m.loaded) body = '<div class="st-note">Comprobando...</div>';
  else if(m.enrolling){
    body = `<p class="st-note" style="margin:0 0 10px;">1. Abre tu app de códigos (Google Authenticator, Authy, 1Password…) y escanea este QR.</p>
      <div style="text-align:center; margin-bottom:10px;"><img src="${esc(m.enrolling.qr)}" alt="Código QR para tu app de verificación" width="180" height="180" style="max-width:100%;"></div>
      <p class="st-note" style="margin:0 0 6px;">Si no puedes escanear, escribe esta clave en la app. <strong>Guárdala en un sitio seguro: es tu copia de seguridad.</strong></p>
      <code style="display:block; word-break:break-all; background:var(--c-paper-2); padding:8px 10px; border-radius:8px; font-size:12.5px; margin-bottom:12px;">${esc(m.enrolling.secret)}</code>
      <label for="mfa-code" style="font-weight:700; font-size:13px;">2. Escribe el código de 6 números que muestra la app</label>
      <input type="text" id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" style="width:100%; margin:6px 0 10px;">
      <div style="display:flex; gap:8px;"><button class="btn btn-primary" style="flex:1;" data-action="mfa-verify" ${m.busy ? 'disabled' : ''}>Activar</button><button class="btn btn-ghost" data-action="mfa-cancel">Cancelar</button></div>`;
  } else if(on){
    body = `<div class="pr-row"><span class="pr-row-ic">${ic('check')}</span><span class="pr-row-label">Estado</span><span class="pr-row-val">Activada</span></div>
      <p class="st-note" style="margin:8px 0 10px;">Al entrar se te pedirá el código de tu app. ${m.aal === 'aal2' ? 'Esta sesión ya está verificada.' : 'Esta sesión aún no está verificada: cierra sesión y vuelve a entrar.'}</p>
      <button class="btn btn-ghost btn-danger-soft pr-wide" data-action="mfa-disable" data-factor="${esc(m.factors[0].id)}">Desactivar</button>`;
  } else {
    body = `<div class="pr-row"><span class="pr-row-ic">${ic('flag')}</span><span class="pr-row-label">Estado</span><span class="pr-row-val">Sin activar</span></div>
      <p class="st-note" style="margin:8px 0 10px;">Las cuentas de administración deben llevar verificación en dos pasos: con la contraseña sola no bastará.</p>
      <button class="btn btn-primary pr-wide" data-action="mfa-start" ${m.busy ? 'disabled' : ''}>Activar verificación en dos pasos</button>`;
  }
  return `<div class="tc-card">
    <div class="tc-card-head"><span class="tc-step">${ic('lock')}</span><div><h3>Seguridad · 2FA</h3><small>Verificación en dos pasos para administradores</small></div></div>
    ${body}
    ${m.error ? `<div class="auth-error" style="display:block; margin-top:10px;">${esc(m.error)}</div>` : ''}
  </div>`;
}

function profileView(){
  const ic = (n) => shellIcon(n);
  const email = (typeof CURRENT_USER_EMAIL!=='undefined' && CURRENT_USER_EMAIL) ? CURRENT_USER_EMAIL : '';
  const username = (typeof CURRENT_USERNAME!=='undefined' && CURRENT_USERNAME) ? CURRENT_USERNAME : '';
  const points = computePoints();
  const rank = currentRank(points);
  const unlockedCount = gamiCounts().earned;
  const p = STATE.profileData;
  const fullName = p ? [profileFirstName(p), p.last_name].filter(Boolean).join(' ') : '';
  const initial = esc((username || email || '?').trim().charAt(0).toUpperCase());

  const row = (icon, label, value) => `<div class="pr-row"><span class="pr-row-ic">${ic(icon)}</span><span class="pr-row-label">${label}</span><span class="pr-row-val ${value ? '' : 'empty'}">${value ? esc(value) : 'Sin rellenar'}</span></div>`;
  let birth = '';
  if(p && p.birthdate){ const d = new Date(p.birthdate); birth = isNaN(d) ? p.birthdate : d.toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' }); }

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero pr-hero">
    <div class="pr-hero-id">
      <span class="pr-avatar">${initial}</span>
      <div class="lg-hero-main">
        <div class="home-eyebrow">Configuración de la cuenta</div>
        <h1>${esc(username || 'Mi cuenta')} <span class="ad-role ${userRole()} pr-role">${ROLE_LABELS[userRole()]}</span></h1>
        <p>${esc(email)}${fullName ? ' · ' + esc(fullName) : ''}</p>
        <div class="ac-hero-actions">
          <button class="btn btn-yellow" data-action="profile-edit">${ic('pencil')} Editar perfil</button>
          <button class="btn btn-glass" data-action="logout">${ic('logout')} Cerrar sesión</button>
        </div>
      </div>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${points}</b><span>Puntos</span></div>
      <div class="lg-stat"><b>${unlockedCount}/${gamiCounts().total}</b><span>Insignias</span></div>
      <div class="lg-stat"><b>${esc(rank.name.replace('Árbitro ', ''))}</b><span>Rango</span></div>
    </div>
  </section>

  <div class="pr-layout">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('users')}</span><div><h3>Datos de la cuenta</h3><small>Tu nombre de usuario no se puede cambiar</small></div></div>
      ${p ? `
        ${row('award', 'Usuario', username)}
        ${row('message', 'Correo', email)}
        ${row('pencil', 'Nombre', profileFirstName(p))}
        ${row('pencil', 'Apellidos', p.last_name)}
        ${row('calendar', 'Fecha de nacimiento', birth)}
        ${row('flag', 'País', p.country)}
        ${row('home', 'Ciudad', p.city)}
        ${row('database', 'Código postal', p.postcode)}
      ` : `<div class="st-note">Cargando tus datos...</div>`}
    </div>

    <aside class="pr-side">
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('pencil')}</span><div><h3>Editar perfil</h3><small>Nombre, país, nacimiento, ciudad y código postal</small></div></div>
        <button class="btn btn-primary pr-wide" data-action="profile-edit">${ic('pencil')} Editar mis datos</button>
      </div>
      ${mfaCardHtml()}
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('lock')}</span><div><h3>Sesión</h3><small>Cierra la sesión en este dispositivo</small></div></div>
        <button class="btn btn-ghost btn-danger-soft pr-wide" data-action="logout">${ic('logout')} Cerrar sesión</button>
      </div>
    </aside>
  </div>
  `;
}

function profileEditView(){
  const ic = (n) => shellIcon(n);
  if(!STATE.profileData){
    return `<button class="backbtn" data-action="profile">&larr; Configuración de cuenta</button><div class="ac-empty">${ic('clock')}<strong>Cargando tus datos...</strong></div>`;
  }
  const p = STATE.profileData;
  return `
  <button class="backbtn" data-action="profile">&larr; Configuración de cuenta</button>
  <section class="lg-hero lg-hero-sm">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Configuración de la cuenta</div>
      <h1>Editar perfil</h1>
      <p>Tu nombre de usuario no se puede cambiar. El resto de datos, sí.</p>
    </div>
  </section>

  <div class="ac-form">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">1</span><div><h3>Datos personales</h3><small>Cómo te llamas y cuándo naciste</small></div></div>
      <div class="pr-fields">
        <div><label for="profile-name">Nombre</label><input type="text" id="profile-name" maxlength="100" value="${esc(profileFirstName(p))}"></div>
        <div><label for="profile-lastname">Apellidos</label><input type="text" id="profile-lastname" maxlength="100" value="${esc(p.last_name||'')}"></div>
        <div class="full"><label for="profile-birthdate">Fecha de nacimiento</label><input type="date" id="profile-birthdate" value="${esc(p.birthdate||'')}"></div>
      </div>
    </div>
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">2</span><div><h3>Ubicación</h3><small>Dónde resides</small></div></div>
      <div class="pr-fields">
        <div class="full"><label for="profile-country">País</label>
          <select id="profile-country">
            <option value="">Selecciona tu país</option>
            ${PROFILE_COUNTRIES.map(c=>`<option value="${esc(c)}" ${p.country===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div><label for="profile-city">Ciudad</label><input type="text" id="profile-city" maxlength="100" value="${esc(p.city||'')}"></div>
        <div><label for="profile-postcode">Código postal</label><input type="text" id="profile-postcode" maxlength="12" inputmode="numeric" value="${esc(p.postcode||'')}"></div>
      </div>
    </div>
    <div style="display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="profile-save-edit" ${STATE.profileSaving?'disabled':''}>${STATE.profileSaving?'Guardando...':'Guardar cambios'}</button>
      <button class="btn btn-ghost" data-action="profile">Cancelar</button>
    </div>
  </div>
  `;
}

async function saveProfileEdit(){
  const firstName = document.getElementById('profile-name').value.trim();
  // A los miembros del comité se les ordena por apellidos: nombre y apellidos tienen que estar bien separados.
  if(typeof COMMITTEE !== 'undefined' && COMMITTEE.status && COMMITTEE.status.is_member && typeof nameProblem === 'function'){
    const msg = nameProblem(firstName, document.getElementById('profile-lastname').value);
    if(msg){ STATE.toast = msg; render(); return; }
  }
  const updated = {
    first_name: firstName,        // el que se lee: Google no lo pisa
    full_name: firstName,         // se mantiene por compatibilidad

    last_name: document.getElementById('profile-lastname').value.trim(),
    country: document.getElementById('profile-country').value,
    birthdate: document.getElementById('profile-birthdate').value,
    city: document.getElementById('profile-city').value.trim(),
    postcode: document.getElementById('profile-postcode').value.trim()
  };
  STATE.profileSaving = true;
  render();
  try{
    const { error } = await supabaseClient.auth.updateUser({ data: updated });
    if(error) throw error;
    STATE.profileData = Object.assign({}, STATE.profileData, updated);
    STATE.toast = 'Perfil actualizado.';
    STATE.view = 'profile';
  }catch(e){
    STATE.toast = 'No se pudieron guardar los cambios. Inténtalo de nuevo.';
  }
  STATE.profileSaving = false;
  render();
}

function academiaView(){
  const ic = (n) => shellIcon(n);
  const docs = STATE.storage.myDocs||[];
  const bank = STATE.storage.myBank||[];
  const savedMap = STATE.storage.saved||{};
  const docsCount = docs.length;
  const bankCount = bank.length;
  const savedIds = savedValidIds();
  const savedCount = savedIds.length;
  const hasContent = docsCount>0 || bankCount>0 || savedCount>0;

  // Fechas válidas: algunas guardadas antiguas valen true (=1) o 0 en vez de una fecha; se ignoran.
  const validTs = (n) => (Number(n) > 1e11 ? Number(n) : 0);
  const lastOf = (arr) => { const m = Math.max(0, ...arr.map(validTs)); return m || null; };
  const docsLastTs = docsCount>0 ? lastOf(docs.map(d=>d.createdAt)) : null;
  const bankLastTs = bankCount>0 ? lastOf(bank.map(q=>q.createdAt)) : null;
  const savedLastTs = savedCount>0 ? lastOf(savedIds.map(id => savedMap[id])) : null;
  const overallLastTs = [docsLastTs, bankLastTs, savedLastTs].filter(Boolean);
  const overallLastText = overallLastTs.length ? formatRelativeTime(Math.max(...overallLastTs)) : null;

  const module = (cls, icon, title, desc, count, countLabel, emptyLabel, lastText, action, law) => `
  <button class="ac-card ${cls}" data-action="${action}" ${law ? `data-law="${law}"` : ''}>
    <div class="ac-card-top">
      <span class="ac-card-ic">${ic(icon)}</span>
      <div class="ac-card-count"><b>${count}</b><small>${countLabel}</small></div>
    </div>
    <h3>${title}</h3>
    <p>${desc}</p>
    <div class="ac-card-state">${count > 0 ? (lastText || '') : emptyLabel}</div>
    <div class="ac-card-go">Entrar ${ic('chevron')}</div>
  </button>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Tu espacio personal</div>
      <h1>Mi Academia</h1>
      <p>Organiza documentos, crea tus propios test y guarda las preguntas que quieras repasar. Todo este contenido es completamente privado y nunca se mezcla con el contenido oficial de WEREF.</p>
      ${overallLastText ? `<div class="ac-last">${ic('clock')} Última actividad ${overallLastText}</div>` : ''}
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${docsCount}</b><span>Documentos</span></div>
      <div class="lg-stat"><b>${bankCount}</b><span>Preguntas creadas</span></div>
      <div class="lg-stat"><b>${savedCount}</b><span>Guardadas</span></div>
    </div>
  </section>

  <div class="lg-section-head"><h2>Tus herramientas</h2><span>Elige por dónde quieres empezar</span></div>
  <div class="ac-grid">
    ${module('docs', 'file', 'Documentos', 'Guarda reglamentos, circulares, apuntes y cualquier material de estudio.',
      docsCount, docsCount === 1 ? 'documento' : 'documentos', 'Todavía no has subido ningún documento',
      docsLastTs ? 'Último documento añadido ' + formatRelativeTime(docsLastTs) + '.' : '', 'mydocs-home')}
    ${module('bank', 'pencil', 'Mis propios test', 'Crea categorías, añade preguntas y genera test completamente personalizados.',
      bankCount, bankCount === 1 ? 'pregunta' : 'preguntas', 'Todavía no has creado ninguna pregunta',
      bankLastTs ? 'Última pregunta creada ' + formatRelativeTime(bankLastTs) + '.' : '', 'mybank')}
    ${module('saved', 'star', 'Preguntas guardadas', 'Accede rápidamente a todas las preguntas que has marcado para repasar más adelante.',
      savedCount, savedCount === 1 ? 'pendiente' : 'pendientes', 'Todavía no has guardado ninguna pregunta',
      savedLastTs ? 'Última pregunta guardada ' + formatRelativeTime(savedLastTs) + '.' : '', 'open-law', 'saved')}
  </div>

  <div class="ac-tip">
    <span class="ac-tip-ic">${ic(hasContent ? 'award' : 'idea')}</span>
    <div>
      <strong>${hasContent ? 'Tu academia sigue creciendo.' : 'Continúa construyendo tu academia'}</strong>
      <p>${hasContent ? 'Continúa añadiendo material y crea entrenamientos cada vez más personalizados.' : 'Crea tu primera categoría personalizada o añade nuevos documentos para ampliar tu biblioteca de estudio.'}</p>
    </div>
  </div>
  `;
}

/* ---------------- INICIO ----------------
   Datos que usa (todos ya existentes, nada nuevo en la base de datos):
   · racha ............ computeStreak() + STATE.storage.activeDays (días con actividad)
   · acierto reciente .. recentPerformance(20) sobre STATE.storage.testHistory
   · progreso global ... overallStats()
   · puntos y rango .... computePoints(), currentRank(), nextRankInfo()
   · liga .............. STATE.leagueBoard (loadLeagueBoard) → posición única del último modo elegido, desde league_board
   · coronas ........... STATE.storage.crownLevels[regla] (0-4)
   · examen ............ próximo evento de tipo "exam" en STATE.storage.calendarEvents
   · fallos pendientes . lawStats('failed')
   · regla más floja ... weakestRuleRecent(20)
   · comité ............ COMMITTEE.status / COMMITTEE.myTests */
const LAW_SHORT = {1:'Terreno de juego', 2:'El balón', 3:'Los jugadores', 4:'Equipamiento', 5:'El árbitro', 6:'Equipo arbitral', 7:'Duración del partido', 8:'Inicio y reanudación', 9:'Balón en juego', 10:'Resultado', 11:'Fuera de juego', 12:'Faltas y conducta', 13:'Tiros libres', 14:'Tiro penal', 15:'Saque de banda', 16:'Saque de meta', 17:'Saque de esquina'};
const IH_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10.3 3.9-8.4 14.5A2 2 0 0 0 3.6 21.4h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const IH_CROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18l1.2-11-5.2 4.2L12 4.5 7 12.2 1.8 8z" fill="currentColor"/></svg>';
const IH_WEEK = ['L','M','X','J','V','S','D'];

/* Los 7 días de la semana actual (lunes a domingo) y si hubo actividad cada día. */
function ihWeekDots(){
  const days = activeDaysSet();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return IH_WEEK.map((l, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { l, on: days.has(dayKey(d.getTime())), today: dayKey(d.getTime()) === dayKey(now.getTime()), future: d.getTime() > now.getTime() };
  });
}

/* Estado de una regla: sin empezar / en progreso / dominada (mismo criterio que la insignia "Maestro de Regla"). */
function ihRuleState(i){
  const s = lawStats(i);
  const crown = (STATE.storage.crownLevels || {})[i] || 0;
  const state = s.attempted === 0 ? 'new' : (s.total > 0 && s.attempted === s.total && s.accuracyPct >= 90) ? 'mastered' : 'progress';
  return { s, crown, state };
}

/* UN SOLO criterio de "regla floja": mínimo 5 preguntas respondidas y menos de 75 % de acierto, de menor a mayor acierto
   (a igualdad, la más respondida). La primera es "Tu punto débil" (y el botón del banner); las 3 primeras llevan el aviso
   y forman el filtro "Flojas". */
const IH_WEAK_MIN = 5, IH_WEAK_MAX_PCT = 75;
function ihWeakList(){
  const rows = [];
  for(let i = 1; i <= 17; i++){
    const s = lawStats(i);
    if(s.attempted >= IH_WEAK_MIN && s.accuracyPct < IH_WEAK_MAX_PCT) rows.push({ rule: i, pct: s.accuracyPct, n: s.attempted });
  }
  rows.sort((a, b) => a.pct - b.pct || b.n - a.n || a.rule - b.rule);
  return rows;
}

/* Esqueleto de Inicio mientras no han cargado los datos (nunca se pinta "usuario nuevo" ni "0 puntos" por error). */
function ihSkeleton(){
  const sk = (cls, style) => `<span class="skel ${cls || ''}" style="${style || ''}"></span>`;
  const slow = STATE.slowLoad ? `<div class="ui-card" role="alert" style="margin-bottom:16px;">
      <strong>Está tardando más de lo normal.</strong>
      <p style="margin:6px 0 10px; color:var(--c-muted); font-size:14px;">Se está cargando: <b>${esc(String(STATE.slowLoad))}</b>. Si no avanza, recarga la página o vuelve a entrar.</p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn btn-primary" onclick="location.reload()">Recargar</button><button class="btn btn-ghost btn-danger-soft" data-action="logout">Cerrar sesión</button></div>
    </div>` : '';
  return `${slow}<div class="ih" role="status" aria-busy="true" aria-label="Cargando tu panel">
    <div class="ih-top">
      <section class="ih-hero">
        ${sk('', 'width:150px;height:12px;')}${sk('', 'width:70%;height:34px;')}
        <div class="ih-hero-actions">${sk('', 'width:210px;height:46px;border-radius:12px;')}${sk('ih-opt', 'width:210px;height:46px;border-radius:12px;')}</div>
        ${sk('', 'width:100%;height:78px;border-radius:16px;')}
      </section>
      <aside class="ih-level">
        ${sk('', 'width:110px;height:20px;')}
        <div style="display:flex;gap:16px;align-items:center;">${sk('', 'width:84px;height:84px;border-radius:50%;')}<div style="flex:1;">${sk('', 'width:80%;height:16px;margin-bottom:8px;')}${sk('', 'width:60%;height:12px;')}</div></div>
        ${sk('', 'width:100%;height:44px;')}${sk('', 'width:100%;height:44px;')}
      </aside>
    </div>
    <section class="ih-section ih-s-today">
      <div class="ih-head">${sk('', 'width:160px;height:26px;')}</div>
      <div class="ih-today">
        <div class="ih-td-main" style="cursor:default;">${sk('', 'width:34px;height:34px;')}${sk('', 'width:45%;height:12px;')}${sk('', 'width:70%;height:28px;')}${sk('', 'width:60%;height:12px;')}${sk('', 'width:100%;height:48px;border-radius:12px;margin-top:12px;')}</div>
        <div class="ih-td-side">${[1, 2].map(() => `<div class="ih-td-c" style="cursor:default;">${sk('', 'width:34px;height:34px;')}${sk('', 'width:50%;height:26px;')}${sk('', 'width:70%;height:12px;')}</div>`).join('')}</div>
      </div>
    </section>
    <section class="ih-section ih-s-rules">
      <div class="ih-head">${sk('', 'width:180px;height:26px;')}</div>
      <div class="ih-rules">${Array.from({ length: 17 }, () => `<div class="ih-rule" style="cursor:default;">${sk('', 'width:34px;height:30px;')}${sk('', 'width:80%;height:12px;')}${sk('', 'width:60%;height:14px;margin-top:auto;')}${sk('', 'width:100%;height:5px;')}</div>`).join('')}</div>
    </section>
  </div>`;
}

/* Datos asíncronos de Inicio: se piden una sola vez y mientras tanto se pintan skeletons. */
function ihEnsureData(){
  if(!STATE.leagueBoard[leagueMode()] && !STATE.homeLeagueBusy){
    STATE.homeLeagueBusy = true;
    setTimeout(() => { Promise.resolve(loadLeagueBoard(leagueMode())).finally(() => { STATE.homeLeagueBusy = false; }); }, 0);
  }
  const cst = (typeof COMMITTEE !== 'undefined') ? COMMITTEE.status : null;
  if(cst && cst.is_member && COMMITTEE.myTests === null && !STATE.homeCmBusy){
    STATE.homeCmBusy = true;
    setTimeout(() => { Promise.resolve(cmLoadMyTests()).then(() => { if(STATE.view === 'home') render(); }).finally(() => { STATE.homeCmBusy = false; }); }, 0);
  }
}

function homeView(){
  if(!STATE.dataReady || !STATE.gami) return ihSkeleton();
  ihEnsureData();
  const os = overallStats();
  const points = computePoints();
  const rank = currentRank(points);
  const next = nextRankInfo(points);
  const rp = recentPerformance(20);
  const streak = computeStreak();
  const weakList = ihWeakList();
  const weak = weakList[0] || null;
  const goal = STATE.storage.dailyGoal || 20;
  const today = todaysAnsweredCount();
  const goalPct = Math.min(100, Math.round(today / goal * 100));
  const name = (typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) ? CURRENT_USERNAME : '';
  const hour = new Date().getHours();
  const greeting = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const ic = (n) => shellIcon(n);
  const SKEL = '<span class="skel" style="display:inline-block;width:56px;height:1em;vertical-align:middle"></span>';
  const isNew = os.attempted === 0 && streak === 0 && (STATE.storage.testHistory || []).length === 0;

  /* ---- 1 · banner principal ---- */
  const heroTitle = isNew ? 'Empieza con el test de nivel'
    : today >= goal ? '¡Objetivo de hoy cumplido!'
    : today > 0 ? `Llevas ${today} de ${goal} preguntas hoy`
    : 'Prepárate para tu próximo examen';
  const heroPrimary = isNew
    ? `<button class="btn btn-primary" data-action="start-daily-goal" data-count="10">${ic('play')} Hacer el test · 10 preguntas</button>`
    : weak
      ? `<button class="btn btn-primary" data-action="open-law" data-law="${weak.rule}">${ic('play')} Reforzar Regla ${weak.rule}</button>`
      : `<button class="btn btn-primary" data-action="train-config">${ic('play')} Empezar a entrenar</button>`;
  const heroSecondary = isNew
    ? `<button class="btn ih-btn-ghost" data-action="train-config">Crear test personalizado</button>`
    : `<button class="btn ih-btn-ghost" data-action="start-daily-goal" data-count="10">${ic('zap')} Test rápido · 10 preguntas</button>`;
  const week = ihWeekDots();
  const stats = isNew
    ? `<p class="ih-new-note">Responde 10 preguntas y empezaremos a medir tu racha, tu acierto y tu progreso.</p>`
    : `<div class="ih-strip">
      <button class="ih-stat ih-streak" data-action="streak-calendar" aria-label="Racha de ${streak} ${streak === 1 ? 'día' : 'días'}. Abrir calendario">
        <span class="ih-stat-label">${ic('flame')} Racha</span>
        <span class="ih-week" aria-hidden="true">${week.map(d => `<i class="${d.on ? 'on' : ''} ${d.today ? 'today' : ''} ${d.future ? 'future' : ''}">${d.l}</i>`).join('')}</span>
        <span class="ih-stat-val">${streak}<small> ${streak === 1 ? 'día' : 'días'}</small></span>
      </button>
      <button class="ih-stat ih-opt" data-action="recent-performance">
        <span class="ih-stat-label">${ic('target')} Acierto reciente</span>
        <span class="ih-stat-val">${rp ? rp.pct + '<small>%</small>' : '—'}</span>
      </button>
      <button class="ih-stat ih-opt" data-action="stats">
        <span class="ih-stat-label">${ic('chart')} Progreso</span>
        <span class="ih-stat-val">${os.completionPct}<small>%</small></span>
      </button>
    </div>`;
  const hero = `<section class="ih-hero">
    <div class="ih-eyebrow">${greeting}${name ? ', ' + esc(name) : ''}</div>
    <h1>${heroTitle}</h1>
    <div class="ih-hero-actions">${heroPrimary}${heroSecondary}</div>
    ${stats}
  </section>`;

  /* ---- 2 · tarjeta "Tu nivel" ---- */
  const R = 38, C = 2 * Math.PI * R, ringPct = next ? next.progressPct : 100;
  const ring = `<svg viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="${R}" fill="none" stroke="var(--c-line)" stroke-width="8"/><circle cx="44" cy="44" r="${R}" fill="none" stroke="var(--c-progress)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - ringPct / 100)).toFixed(2)}" transform="rotate(-90 44 44)"/></svg>`;
  /* Misma posición que en la pantalla de la League: la del último modo elegido, calculada por el servidor. */
  let leagueVal;
  const lgSlot = STATE.leagueBoard[leagueMode()];
  const lgData = lgSlot && lgSlot.data;
  if(!lgData) leagueVal = (lgSlot && lgSlot.error) ? '<small>—</small>' : SKEL;
  else leagueVal = lgData.me ? `<b>#${lgData.me.rank}</b> <small>${LEAGUE_MODES[leagueMode()].label}</small>` : '<small>Sin clasificar</small>';
  const todayISO = todayKeyISO();
  const nextExam = (STATE.storage.calendarEvents || []).filter(ev => ev && ev.type === 'exam' && typeof ev.date === 'string' && ev.date >= todayISO).sort((a, b) => a.date.localeCompare(b.date))[0];
  let examRow;
  if(nextExam){
    const d = Math.round((new Date(nextExam.date + 'T00:00:00') - new Date(todayISO + 'T00:00:00')) / 86400000);
    examRow = `<button class="ih-row" data-action="streak-calendar"><span class="ih-row-l">${ic('calendar')} Examen</span><span class="ih-row-r"><b>${d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d + ' días'}</b> <small>${esc(formatEventDate(nextExam.date))}</small></span></button>`;
  } else {
    examRow = `<button class="ih-row" data-action="streak-calendar"><span class="ih-row-l">${ic('calendar')} Examen</span><span class="ih-row-r ih-add">Añade la fecha de tu examen</span></button>`;
  }
  const level = isNew
    ? `<aside class="ih-level" aria-label="Tu nivel">
        <h2>Tu nivel</h2>
        <div class="ih-newblock"><strong>Empieza con el test de nivel</strong><span>Con tus primeras 10 respuestas verás aquí tus puntos y tu rango.</span>
        <button class="btn btn-secondary" data-action="start-daily-goal" data-count="10">Hacer el test</button></div>
        ${examRow}
      </aside>`
    : `<aside class="ih-level" aria-label="Tu nivel">
        <h2>Tu nivel</h2>
        <button class="ih-level-main" data-action="achievements" aria-label="Tu rango: ${esc(rank.name)}, ${points} puntos. Ver insignias">
          <span class="ih-ring">${ring}<b>${points}</b></span>
          <span class="ih-rank"><strong>${esc(rank.label)}</strong><small>${next ? '→ ' + esc(next.name) + ' · ' + next.hint : 'Rango máximo'}</small></span>
        </button>
        <button class="ih-row" data-action="dailyChallenge"><span class="ih-row-l">${ic('trophy')} WEREF League</span><span class="ih-row-r">${leagueVal}</span></button>
        ${examRow}
        <button class="ih-link" data-action="streak-calendar">Ver calendario →</button>
      </aside>`;

  /* ---- 3 · Hoy te toca ---- */
  const failed = lawStats('failed').total;
  const cst = (typeof COMMITTEE !== 'undefined') ? COMMITTEE.status : null;
  let cmOpen = 0;
  if(cst && cst.is_member && Array.isArray(COMMITTEE.myTests)){
    const done = new Set((COMMITTEE.myAttempts || []).map(a => a.test_id));
    cmOpen = COMMITTEE.myTests.filter(t => Date.parse(t.opens_at) <= Date.now() && !done.has(t.id)).length;
  }
  /* Una tarjeta principal + dos secundarias. Prioridad: reto del día pendiente > punto débil (si el reto ya está cumplido) > test rápido.
     "Punto débil" usa el mismo criterio que el resto de Inicio (weak = ihWeakList()[0]). */
  const goalDone = !isNew && today >= goal;
  const tdIc = (n, cls) => `<span class="ih-td-ic ${cls || ''}">${ic(n)}</span>`;
  const quickCardMain = (eyebrow, title, sub) => `<button type="button" class="ih-td-main" data-action="start-daily-goal" data-count="10">
      <span class="ih-td-top">${tdIc('zap')}<span class="ih-td-eyebrow">${eyebrow}</span></span>
      <span class="ih-td-title">${title}</span><span class="ih-td-sub">${sub}</span>
      <span class="btn btn-primary ih-td-go">Empezar</span>
    </button>`;
  const cardRepaso = `<button type="button" class="ih-td-c" data-action="open-law" data-law="failed">
      <span class="ih-td-top">${tdIc('repeat')}<span class="ih-td-eyebrow">Sala de Repaso</span></span>
      <span class="ih-td-big">${failed}</span>
      <span class="ih-td-lab">por repasar</span>
    </button>`;
  const cardQuick = `<button type="button" class="ih-td-c" data-action="start-daily-goal" data-count="10">
      <span class="ih-td-top">${tdIc('zap')}<span class="ih-td-eyebrow">Test rápido</span></span>
      <span class="ih-td-big">10</span>
      <span class="ih-td-lab">preguntas</span>
    </button>`;
  const cardWeak = weak
    ? `<button type="button" class="ih-td-c" data-action="start-quiz" data-law="${weak.rule}" data-mode="short">
        <span class="ih-td-top">${tdIc('target')}<span class="ih-td-eyebrow">Punto débil</span></span>
        <span class="ih-td-big">Regla ${weak.rule}</span>
        <span class="ih-td-lab">${esc(LAW_SHORT[weak.rule])}</span>
      </button>`
    : `<button type="button" class="ih-td-c" data-action="start-daily-goal" data-count="10">
        <span class="ih-td-top">${tdIc('target')}<span class="ih-td-eyebrow">Punto débil</span></span>
        <span class="ih-td-big ih-td-big-s">Sin detectar</span>
        <span class="ih-td-lab">Responde más preguntas</span>
      </button>`;
  const cardDone = `<button type="button" class="ih-td-c ih-td-done" data-action="start-daily-goal" data-count="10">
      <span class="ih-td-top">${tdIc('check', 'ih-td-ok')}<span class="ih-td-eyebrow">Reto del día</span></span>
      <span class="ih-td-big ih-td-big-s">Reto cumplido</span>
      <span class="ih-td-lab">${today} de ${goal} preguntas</span>
      <span class="btn btn-secondary ih-td-extra">Reto extra</span>
    </button>`;
  let mainCard, sideCards;
  if(isNew){
    mainCard = `<button type="button" class="ih-td-main" data-action="open-law" data-law="1">
        <span class="ih-td-top">${tdIc('book')}<span class="ih-td-eyebrow">Empieza por el principio</span></span>
        <span class="ih-td-title">Regla 1 · ${esc(LAW_SHORT[1])}</span><span class="ih-td-sub">Estudia una regla y practícala</span>
        <span class="btn btn-primary ih-td-go">Empezar</span>
      </button>`;
    sideCards = [cardQuick, `<button type="button" class="ih-td-c" data-action="train-config">
        <span class="ih-td-top">${tdIc('wand')}<span class="ih-td-eyebrow">Crear test</span></span>
        <span class="ih-td-big ih-td-big-s">A tu medida</span>
        <span class="ih-td-lab">Elige reglas y tiempo</span>
      </button>`];
  } else if(!goalDone){
    mainCard = `<button type="button" class="ih-td-main" data-action="start-daily-goal" data-count="10">
        <span class="ih-td-top">${tdIc('zap')}<span class="ih-td-eyebrow">Reto del día</span></span>
        <span class="ih-td-title">${today} de ${goal} preguntas</span>
        <span class="ih-td-bar" aria-hidden="true"><i style="width:${goalPct}%"></i></span>
        <span class="ih-td-sub">${today === 0 ? 'Empieza con un test rápido de 10 preguntas' : 'Sigue con un test rápido de 10 preguntas'}</span>
        <span class="btn btn-primary ih-td-go">Empezar</span>
      </button>`;
    sideCards = [failed > 0 ? cardRepaso : cardQuick, cardWeak];
  } else if(weak){
    mainCard = `<button type="button" class="ih-td-main" data-action="start-quiz" data-law="${weak.rule}" data-mode="short">
        <span class="ih-td-top">${tdIc('target')}<span class="ih-td-eyebrow">Punto débil</span></span>
        <span class="ih-td-title">Mejora la Regla ${weak.rule}</span><span class="ih-td-sub">${esc(LAW_SHORT[weak.rule])} · 10 preguntas</span>
        <span class="btn btn-primary ih-td-go">Empezar</span>
      </button>`;
    sideCards = [failed > 0 ? cardRepaso : cardQuick, cardDone];
  } else {
    mainCard = quickCardMain('Test rápido', '10 preguntas', 'Sin punto débil por ahora: practica un poco de todo');
    sideCards = [cardRepaso, cardDone];
  }
  const cmStrip = cmOpen > 0 ? `<button type="button" class="ih-td-cm" data-action="committee-open">
      <span class="ih-td-ic">${ic('users')}</span>
      <span class="ih-td-cm-t"><strong>CTA BAGES</strong><small>${cmOpen === 1 ? 'Tienes 1 test abierto' : 'Tienes ' + cmOpen + ' tests abiertos'}</small></span>
    </button>` : '';
  const todaySection = `<section class="ih-section ih-s-today" aria-labelledby="ih-h-today">
    <div class="ih-head"><h2 id="ih-h-today">Hoy te toca</h2></div>
    <div class="ih-today">${mainCard}<div class="ih-td-side">${sideCards.join('')}</div></div>
    ${cmStrip}
  </section>`;

  /* ---- 4 · las 17 reglas ---- */
  const weakSet = new Set(weakList.slice(0, 3).map(r => r.rule));
  const filter = STATE.homeFilter || 'all';
  const rows = [];
  for(let i = 1; i <= 17; i++) rows.push(Object.assign({ i }, ihRuleState(i), { weak: weakSet.has(i) }));
  const counts = { all: 17, weak: rows.filter(r => r.weak).length, new: rows.filter(r => r.state === 'new').length, mastered: rows.filter(r => r.state === 'mastered').length };
  const chips = [['all', 'Todas'], ['weak', 'Flojas'], ['new', 'Sin empezar'], ['mastered', 'Dominadas']].map(([k, label]) =>
    `<button type="button" class="ih-chip ${filter === k ? 'on' : ''}" data-action="home-filter" data-filter="${k}" aria-pressed="${filter === k}">${label}${k === 'all' ? '' : ' <b>' + counts[k] + '</b>'}</button>`).join('');
  const stLabel = { new: 'Sin empezar', progress: 'En progreso', mastered: 'Dominada' };
  const shown = rows.filter(r => filter === 'all' || (filter === 'weak' && r.weak) || (filter === 'new' && r.state === 'new') || (filter === 'mastered' && r.state === 'mastered'));
  const cards = shown.map(r => `<button class="ih-rule st-${r.state} ${r.weak ? 'is-weak' : ''}" data-action="open-law" data-law="${r.i}" aria-label="Regla ${r.i}, ${esc(LAW_SHORT[r.i])}. ${stLabel[r.state]}, ${r.s.completionPct}% completado${r.crown ? ', ' + r.crown + ' de 4 coronas' : ''}${r.weak ? '. Es una de tus reglas más flojas' : ''}">
    <span class="ih-rule-top"><b>${r.i}</b>${r.weak ? `<span class="ih-warn" title="Una de tus reglas más flojas">${IH_WARN}</span>` : ''}</span>
    <span class="ih-rule-name">${esc(LAW_SHORT[r.i])}</span>
    <span class="ih-crowns" aria-hidden="true">${[1,2,3,4].map(n => `<i class="${n <= r.crown ? 'on' : ''}">${IH_CROWN}</i>`).join('')}</span>
    <span class="ih-prog" aria-hidden="true"><i style="width:${r.s.completionPct}%"></i></span>
  </button>`).join('');
  const rulesSection = `<section class="ih-section ih-s-rules" aria-labelledby="ih-h-rules">
    <div class="ih-head"><h2 id="ih-h-rules">Las 17 reglas</h2><div class="ih-chips" role="group" aria-label="Filtrar reglas">${chips}</div></div>
    ${shown.length ? `<div class="ih-rules">${cards}</div>` : `<div class="ih-empty">${filter === 'weak' ? 'Aún no hay reglas flojas. ¡Sigue así!' : filter === 'mastered' ? 'Todavía no has dominado ninguna regla.' : 'No hay reglas en esta lista.'}</div>`}
  </section>`;

  /* ---- 5 · modos especiales ---- */
  const hs = lawStats('hard');
  const gs = lawStats('glossary');
  const modesSection = `<section class="ih-section ih-s-modes" aria-labelledby="ih-h-modes">
    <div class="ih-head"><h2 id="ih-h-modes">Modos especiales</h2></div>
    <div class="ih-modes">
      <button class="ih-mode ih-mode-var" data-action="open-law" data-law="hard"><span class="ih-mode-ic">${ic('shield')}</span><strong>Sala VAR</strong><span>Las preguntas más difíciles de la plataforma.</span></button>
      <button class="ih-mode" data-action="open-law" data-law="glossary"><span class="ih-mode-ic">${ic('glossary')}</span><strong>Glosario</strong><span>Términos y definiciones de las Reglas de Juego.</span></button>
      <button class="ih-mode" data-action="train-config"><span class="ih-mode-ic">${ic('settings')}</span><strong>Test personalizado</strong><span>Elige reglas, número de preguntas, tiempo y modo.</span></button>
    </div>
  </section>`;

  const install = (typeof installBannerHtml === 'function') ? installBannerHtml() : '';
  const nudge = (typeof profileNudgeHtml === 'function') ? profileNudgeHtml() : '';

  return `
  <div class="ih">
    <div class="ih-top">${hero}${level}</div>
    ${nudge}
    ${todaySection}
    ${rulesSection}
    ${modesSection}
    ${install}
    <p class="ih-foot">¿Una idea o algo que mejorar? <button type="button" data-action="open-suggest">Cuéntanoslo</button></p>
  </div>
  `;
}

/* ---------------- PÁGINA DE UNA REGLA ----------------
   Corona: la da recordTestResult() cuando se termina un Modo estudio (25 preguntas) de esa regla con un 70 % o más.
   Sube 1 nivel por test aprobado, hasta 4. No es acumulativo (no cuenta preguntas sueltas): cada test cuenta por sí solo. */
const CROWN_MIN_PCT = 70;
function ruleView(law){
  const ic = (n) => shellIcon(n);
  const s = lawStats(law);
  const crown = (STATE.storage.crownLevels || {})[law] || 0;
  const failedN = questionsForLaw(law).filter(isFailedQuestion).length;
  const acc = s.attempted > 0 ? s.accuracyPct + '%' : '—';
  let need = 25;
  for(let k = 1; k <= 25; k++){ if(Math.round(k / 25 * 100) >= CROWN_MIN_PCT){ need = k; break; } }
  const best = (STATE.storage.testHistory || [])
    .filter(h => h.mode === 'study25' && h.byRule && Object.keys(h.byRule).length === 1 && h.byRule[law])
    .reduce((m, h) => Math.max(m, h.pct), -1);
  const crownLine = crown >= 4
    ? 'Corona máxima · 4/4'
    : `Corona ${crown}/4 · Siguiente: un Modo estudio de 25 preguntas con ${need} aciertos o más (${CROWN_MIN_PCT} %)${best >= 0 ? ' · tu mejor intento: ' + best + ' %' : ''}`;
  const crowns = [1, 2, 3, 4].map(n => `<i class="${n <= crown ? 'on' : ''}">${IH_CROWN}</i>`).join('');
  const menuOpen = !!STATE.lawMenuOpen;
  const menu = `<div class="rp-menu"><button type="button" class="rp-menu-btn" data-action="law-menu" aria-label="Más opciones de esta regla" aria-haspopup="menu" aria-expanded="${menuOpen}">${ic('more')}</button>${menuOpen ? `<div class="rp-menu-pop" role="menu"><button type="button" role="menuitem" class="rp-menu-item" data-action="reset-law-progress" data-law="${law}" ${s.attempted === 0 ? 'disabled' : ''}>${ic('repeat')}<span>Reiniciar progreso de esta regla</span></button></div>` : ''}</div>`;
  const heroStats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto'], [failedN, 'Fallos']];
  /* El menú ⋯ va en la fila de arriba (junto a "Regla N · IFAB"), con su propio espacio: nunca sobre las cifras. */
  const hero = `<section class="lg-hero ac-hero rp-hero">
    <div class="rp-hero-top"><div class="home-eyebrow">Regla ${law} · IFAB</div>${menu}</div>
    <h1>${esc(LAW_NAMES[law])}</h1>
    <div class="rp-stats">${heroStats.map(x => `<div class="lg-stat"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('')}</div>
  </section>`;

  return `
  <div class="rp-page">
    <button class="backbtn" data-action="home">&larr; Todas las reglas</button>
    ${hero}
    <div class="rp-crown"><span class="rp-crowns" aria-hidden="true">${crowns}</span><span>${crownLine}</span></div>

    <section class="rp-actions" aria-label="Cómo quieres practicar">
      <button class="rp-quick" data-action="start-quiz" data-law="${law}" data-mode="short">
        <span class="rp-quick-txt"><span class="rp-tag">Más utilizado</span><strong>Test rápido · 10 preguntas</strong><small>Preguntas al azar de esta regla, sin configurar nada.</small></span>
        <span class="btn btn-primary rp-quick-go">${ic('play')} Empezar</span>
      </button>
      <div class="rp-sec">
        <button class="rp-card" data-action="start-quiz" data-law="${law}" data-mode="study25"><span class="rp-card-ic">${ic('book')}</span><strong>Modo estudio · 25 preguntas</strong><small>Con explicación tras cada una. Cuenta para tu corona.</small></button>
        <button class="rp-card" data-action="train-config-scoped" data-law="${law}"><span class="rp-card-ic">${ic('settings')}</span><strong>Test personalizado</strong><small>Elige número de preguntas, tiempo y tipo de test.</small></button>
      </div>
    </section>

    <section class="rp-fails" aria-labelledby="rp-h-fails">
      ${failedN > 0
        ? `<div class="rp-fails-txt"><span class="rp-fails-n" aria-hidden="true">${failedN}</span><div><strong id="rp-h-fails">Tus fallos en esta regla</strong><small>${failedN} ${failedN === 1 ? 'pregunta pendiente' : 'preguntas pendientes'} · salen de la lista al acertarlas 3 veces seguidas</small></div></div>
           <button class="btn btn-secondary" data-action="start-rule-failed" data-law="${law}">Repasar ${Math.min(failedN, MAX_TEST_QUESTIONS)} ${Math.min(failedN, MAX_TEST_QUESTIONS) === 1 ? 'fallo' : 'fallos'}</button>`
        : `<div class="rp-fails-txt"><span class="rp-fails-ok" aria-hidden="true">${ic('check')}</span><div><strong id="rp-h-fails">Tus fallos en esta regla</strong><small>Sin fallos pendientes en esta regla</small></div></div>`}
    </section>

  </div>
  `;
}

function lawMenuView(){
  const ic = (n) => shellIcon(n);
  const law = STATE.lawId;
  const s = lawStats(law);
  const scopeIds = questionsForLaw(law).map(q=>q.id);
  const isHard = law === 'hard';
  const isFailed = law === 'failed';
  const isGlossary = law === 'glossary';
  const isAssistants = law === 'assistants';
  const isSaved = law === 'saved';
  const isRule = typeof law === 'number';
  if(isRule) return ruleView(law);
  const backAction = isSaved ? 'academia' : 'home';
  const backLabel = isSaved ? '&larr; Mi Academia' : '&larr; Todas las reglas';
  const acc = s.attempted > 0 ? s.accuracyPct + '%' : '—';
  const crown = isRule ? ((STATE.storage.crownLevels || {})[law] || 0) : 0;

  let theme = '', eyebrow, title, desc, stats;
  if(isHard){
    theme = 'th-var'; eyebrow = 'Sala VAR · Modo difícil'; title = 'Sala VAR';
    desc = 'Las preguntas más difíciles de toda la plataforma. ¿Estás a la altura?';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto']];
  } else if(isFailed){
    theme = 'th-failed'; eyebrow = 'Sala de Repaso · Preguntas falladas'; title = 'Sala de Repaso';
    desc = s.total > 0 ? 'Tienes preguntas pendientes de repasar. ¡A por ellas!' : 'Nada pendiente. Sigue haciendo tests y aquí aparecerán las que falles.';
    stats = [[s.total, 'Pendientes'], [acc, 'Acierto'], ['3', 'Aciertos para salir']];
  } else if(isGlossary){
    eyebrow = 'Glosario IFAB'; title = 'Preguntas Glosario';
    desc = 'Términos y definiciones de las Reglas de Juego.';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto']];
  } else if(isAssistants){
    theme = 'th-assist'; eyebrow = 'Sala especial'; title = 'Árbitros Asistentes';
    desc = s.total > 0 ? 'Preguntas específicas para árbitros asistentes.' : 'Estamos preparando las preguntas de Árbitros Asistentes.';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto']];
  } else if(isSaved){
    eyebrow = 'Mi Academia · Privado'; title = 'Preguntas guardadas';
    desc = 'Todas las preguntas que has marcado para repasar más adelante.';
    stats = [[s.total, s.total === 1 ? 'Guardada' : 'Guardadas'], [s.completionPct + '%', 'Repasado'], [acc, 'Acierto']];
  } else {
    eyebrow = 'Regla ' + law + ' · IFAB'; title = esc(LAW_NAMES[law]);
    desc = 'Preguntas de esta regla para practicar a tu ritmo.';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto'], [crown + '/4', 'Corona']];
  }
  const hero = acHero(eyebrow, title, desc, stats).replace('class="lg-hero ac-hero', 'class="lg-hero ac-hero ' + theme);

  if(isFailed && s.total===0){
    return `
    <button class="backbtn" data-action="${backAction}">${backLabel}</button>
    ${hero}
    <div class="ac-empty">${ic('check')}<strong>¡Nada pendiente!</strong><span>No tienes ninguna pregunta fallada ahora mismo. Sigue haciendo tests y, si fallas alguna, aparecerá aquí para que la repases.</span></div>
    `;
  }
  if(isAssistants && s.total===0){
    return `
    <button class="backbtn" data-action="${backAction}">${backLabel}</button>
    ${hero}
    <div class="ac-empty">${ic('clock')}<strong>Próximamente</strong><span>En cuanto estén listas las preguntas de Árbitros Asistentes podrás practicar aquí.</span></div>
    `;
  }
  if(isSaved && s.total===0){
    return `
    <button class="backbtn" data-action="${backAction}">${backLabel}</button>
    ${hero}
    <div class="ac-empty">${ic('star')}<strong>Todavía no has guardado ninguna pregunta</strong><span>Pulsa "Guardar en Mi Lista" durante un test para añadirla aquí.</span></div>
    `;
  }

  const scopeOf = isHard?' del banco de difíciles':isFailed?' de tus falladas':isGlossary?' del glosario':isAssistants?' de árbitros asistentes':isSaved?' de tu lista':' de esta regla';
  const opt = (cls, icon, tag, title, sub, text, attrs) => `
    <button class="ac-card lw-card ${cls}" ${attrs}>
      <div class="ac-card-top">
        <span class="ac-card-ic">${ic(icon)}</span>
        <span class="lw-tag">${tag}</span>
      </div>
      <h3>${title}</h3>
      <p><strong>${sub}</strong><br>${text}</p>
      <div class="ac-card-go">Empezar ${ic('chevron')}</div>
    </button>`;

  return `
  <button class="backbtn" data-action="${backAction}">${backLabel}</button>
  ${hero}

  ${isFailed ? `<div class="lw-note">${ic('repeat')}<div>Todas las preguntas que falles se añadirán automáticamente a la Sala de Repaso. Solo desaparecerán cuando las aciertes 3 veces consecutivas; si vuelves a fallar una, el contador empezará de nuevo.</div></div>` : ''}

  <div class="lg-section-head"><h2>¿Cómo quieres practicar?</h2><span>Elige un modo para empezar</span></div>
  <div class="ac-grid">
    ${opt('lw-quick', 'zap', 'Más utilizado', 'Test rápido', 'Empieza a practicar en segundos.', `Responde 10 preguntas aleatorias${scopeOf} sin necesidad de configurar ninguna opción.`, `data-action="start-quiz" data-law="${law}" data-mode="short"`)}
    ${opt('lw-study', 'book', 'Recomendado', 'Modo estudio', 'Aprende mientras practicas.', `Realiza un test de 25 preguntas aleatorias${scopeOf}, con la explicación y la respuesta correcta después de cada una.`, `data-action="start-quiz" data-law="${law}" data-mode="study25"`)}
    ${opt('lw-custom', 'wand', 'Personalizable', 'Test personalizado', 'Crea un entrenamiento a tu medida.', 'Elige el número de preguntas, activa el cronómetro y selecciona el modo Estudio o Examen para adaptar la sesión.', `data-action="train-config-scoped" data-law="${law}"`)}
  </div>

  ${isSaved ? `<div class="lw-extras">
    <button class="lw-extra" data-action="saved-browse"><span class="lw-extra-ic">${ic('eye')}</span><span><strong>Ver tus guardadas</strong><small>Repásalas de una en una, con la respuesta y explicación</small></span><span class="ac-folder-go">${ic('chevron')}</span></button>
  </div>` : ''}

  ${(!isHard && !isFailed && !isGlossary && !isAssistants && !isSaved && s.attempted>0) ? `
  <div class="lw-reset">
    <div><strong>Reiniciar progreso de esta regla</strong><small>Borra tus aciertos/fallos solo de esta regla. No afecta a las demás ni a tus puntos, rango, racha o insignias.</small></div>
    <button class="btn btn-ghost btn-danger-soft" data-action="reset-law-progress" data-law="${law}">${ic('repeat')} Reiniciar</button>
  </div>
  ` : ''}
  `;
}

function pickQuestions(law, mode){
  let pool = law ? questionsForLaw(law) : allQuestions().filter(q=>q.domain!=='assistants');
  pool = shuffle(pool.slice());
  if(mode==='short') pool = pool.slice(0,10);
  if(mode==='study25') pool = pool.slice(0,25);
  pool = pool.slice(0, MAX_TEST_QUESTIONS);
  return pool.map(q=>q.id);
}

/* ---------------- BANCO EN SERVIDOR (Fase B · fase d) ----------------
   Interruptor por navegador: app.html?srv=1 lo enciende, ?srv=0 lo apaga. Apagado, nada cambia.
   Con él encendido, el test de una regla (Modo estudio / Test rápido) lo crea, lo corrige y lo puntúa el SERVIDOR
   (start_test / answer_question / finish_test / get_review_question). El cliente nunca recibe la solución antes de contestar.
   El estado local (progress, rachas, coronas...) se sigue actualizando igual para que el resto de la app se vea coherente
   mientras convive el sistema antiguo. */
/* srv=1: los tests van por el servidor (el banco aún se descarga, para probar). srv=2: además NO se descarga el banco (modo índice).
   SRV_ALL_USERS = true es el CORTE: todos los usuarios usan el servidor y los que no son administradores no descargan el banco. */
const SRV_ALL_USERS = true;
function srvFlag(){
  try{
    const qp = new URLSearchParams(location.search).get('srv');
    if(qp === '1' || qp === '2' || qp === '3') localStorage.setItem('weref_srv_bank', qp);
    if(qp === '0') localStorage.removeItem('weref_srv_bank');
    return localStorage.getItem('weref_srv_bank') || '';
  }catch(e){ return ''; }
}
function srvOn(){ const f = srvFlag(); return SRV_ALL_USERS || f === '1' || f === '2' || f === '3'; }
srvOn();   /* se evalúa al cargar: así ?srv=1 / ?srv=0 funcionan aunque la dirección cambie después */
function srvParse(d){ if(typeof d === 'string'){ try{ return JSON.parse(d); }catch(e){ return null; } } return d; }
function srvError(e){
  const m = String((e && (e.message || e.details)) || e || '');
  if(m.indexOf('limit_daily') >= 0) return 'Has entrenado mucho hoy, vuelve mañana.';
  if(m.indexOf('limit_hourly') >= 0) return 'Has hecho muchos tests seguidos. Espera un rato y vuelve a intentarlo.';
  if(m.indexOf('no_questions') >= 0) return 'No hay preguntas disponibles para este modo.';
  if(m.indexOf('no_session') >= 0) return 'Tu sesión ha caducado. Vuelve a entrar.';
  return 'No se pudo completar la acción con el servidor. Inténtalo de nuevo.';
}
/* Crea el test en el servidor y devuelve el estado de quiz que usa la app (preguntas SIN solución hasta contestar). */
async function srvCreateQuiz(mode, filters, fields){
  const { data, error } = await supabaseClient.rpc('start_test', { p_mode: mode, p_filters: filters || {} });
  if(error) throw error;
  const t = srvParse(data);
  if(!t || !t.attempt_id || !Array.isArray(t.questions) || !t.questions.length) throw new Error('no_questions');
  const shuffled = {};
  t.questions.forEach(x => { shuffled[x.id] = { id: x.id, domain: x.domain, rule: x.rule, difficulty: x.difficulty, question: x.question, options: x.options, correct: null, explanation: '', source: 'base' }; });
  return Object.assign({ qids: t.questions.map(x => x.id), idx: 0, mode: mode, law: null, answers: {}, instantFeedback: t.feedback === 'study', timeSec: 0, remainingSec: 0, showFeedback: false, selected: null,
    shuffled, server: { attemptId: t.attempt_id, busy: false, result: null, feedback: t.feedback } }, fields || {});
}
async function srvStartQuiz(law, mode, count){
  if(STATE.srvBusy) return; STATE.srvBusy = true;
  try{
    const filters = (law != null && law !== '') ? { law: String(law) } : {};
    if(count) filters.count = count;
    STATE.quiz = await srvCreateQuiz(mode, filters, { mode: mode || 'short', law });
    STATE.view = 'quiz';
  }catch(e){ console.warn('start_test', e); STATE.toast = srvError(e); }
  STATE.srvBusy = false; render();
}
/* "Crear test": examen o estudio, con o sin tiempo. "Solo falladas" y la Sala de Repaso siguen por el sistema antiguo hasta migrar el progreso (fase e). */
function srvCanTrain(opts){ return srvOn() && opts.scopeOverride !== 'assistants'; }
async function srvStartTraining(opts){
  if(STATE.srvBusy) return; STATE.srvBusy = true;
  try{
    const filters = { count: opts.count || 20, feedback: opts.instantFeedback ? 'study' : 'exam' };
    if(opts.scopeOverride) filters.law = String(opts.scopeOverride); else filters.laws = opts.laws || [];
    if(opts.onlyFailed) filters.only_failed = true;
    let timerMode = opts.timerMode || 'none', timeSec = 0, remainingSec = 0, perQSeconds = 0;
    if(timerMode === 'total'){ timeSec = (opts.minutes && opts.minutes > 0) ? Math.round(opts.minutes * 60) : 0; if(timeSec <= 0) timerMode = 'none'; remainingSec = timeSec; }
    else if(timerMode === 'perQuestion'){ perQSeconds = Math.min(120, Math.max(5, opts.secondsPerQuestion || 45)); remainingSec = perQSeconds; }
    STATE.quiz = await srvCreateQuiz('training', filters, { mode: 'training', law: opts.scopeOverride || null, timerMode, timeSec, remainingSec, perQSeconds, instantFeedback: !!opts.instantFeedback });
    STATE.view = 'quiz';
    STATE.srvBusy = false; render();
    if(timerMode === 'total' || timerMode === 'perQuestion') startTimer();
    return;
  }catch(e){ console.warn('start_test', e); STATE.toast = srvError(e); }
  STATE.srvBusy = false; render();
}
/* League (Corazones / Muerte Súbita / Contrarreloj): vidas, racha, récord y ranking los calcula el servidor. */
async function srvStartLeague(mode){
  if(STATE.srvBusy) return; STATE.srvBusy = true;
  try{
    const f = { mode, law: null, combo: 0, bestCombo: 0, instantFeedback: true };
    if(mode === 'hearts') f.hearts = 3;
    if(mode === 'suddendeath') f.hearts = 1;
    if(mode === 'timeattack'){ f.timerMode = 'total'; f.timeSec = 60; f.remainingSec = 60; }
    STATE.quiz = await srvCreateQuiz(mode, {}, f);
    STATE.view = 'quiz';
    STATE.srvBusy = false; render();
    if(mode === 'timeattack') startTimer();
    return;
  }catch(e){ console.warn('start_test(league)', e); STATE.toast = srvError(e); }
  STATE.srvBusy = false; render();
}
/* League por tandas: el servidor sirve 10 preguntas al empezar y otras 10 cuando al jugador le quedan 3 o menos por contestar (league_more). */
function srvAddQuestions(quiz, list){
  (list || []).forEach(x => {
    if(quiz.shuffled[x.id]) return;
    quiz.qids.push(x.id);
    quiz.shuffled[x.id] = { id: x.id, domain: x.domain, rule: x.rule, difficulty: x.difficulty, question: x.question, options: x.options, correct: null, explanation: '', source: 'base' };
  });
}
async function srvLeagueMore(quiz){
  const s = quiz.server;
  if(!s || s.moreBusy || s.noMore) return;
  s.moreBusy = true;
  try{
    const r = await supabaseClient.rpc('league_more', { p_attempt: s.attemptId });
    if(r.error) throw r.error;
    const list = srvParse(r.data) || [];
    if(!list.length) s.noMore = true;     /* tope de la partida o cupo diario agotado: se termina con las que hay */
    srvAddQuestions(quiz, list);
  }catch(e){
    console.warn('league_more', e);
    const m = String((e && e.message) || '');
    if(/too_early|late|game_over|finished|not_found|bad_mode/.test(m)) s.noMore = true;
  }
  s.moreBusy = false;
  if(STATE.quiz === quiz) render();
}
function srvMirror(qid, correct){
  STATE.storage.progress[qid] = { correct, ts: Date.now() };
  saveProgress(); updateFailedStreak(qid, correct); markDayActive(); checkAndUnlockBadges();
}
async function srvSelectAnswer(letter){
  const quiz = STATE.quiz, q = currentQ();
  const exam = quiz.server.feedback === 'exam';
  if(!q || quiz.server.busy || (!exam && quiz.answers[q.id])) return;
  quiz.server.busy = true;
  try{
    const { data, error } = await supabaseClient.rpc('answer_question', { p_attempt: quiz.server.attemptId, p_pos: quiz.idx + 1, p_choice: letter });
    if(error) throw error;
    const r = srvParse(data) || {};
    if(r.late){ quiz.server.busy = false; srvFinishQuiz('¡Tiempo agotado! Aquí tienes tu resultado.'); return; }   /* Contrarreloj: llegó fuera de tiempo */
    quiz.answers[q.id] = letter;
    if(!exam){          /* modo estudio: el servidor dice ahora si acertaste y cuál era la correcta (solo de esta pregunta) */
      if(r.correct_option){ q.correct = r.correct_option; q.explanation = r.explanation || ''; }
      srvMirror(q.id, !!r.correct);
      quiz.selected = letter; quiz.showFeedback = true;
      if(isRecordMode(quiz.mode)){
        if(r.lives != null) quiz.hearts = r.lives;
        if(r.combo != null){ quiz.combo = r.combo; if(r.combo > (quiz.bestCombo || 0)) quiz.bestCombo = r.combo; }
        /* quedan 3 o menos por contestar y la partida sigue: se pide la siguiente tanda */
        if(!r.game_over && quiz.qids.length - Object.keys(quiz.answers).length <= 3) srvLeagueMore(quiz);
      }
    }
  }catch(e){ console.warn('answer_question', e); STATE.toast = srvError(e); }
  quiz.server.busy = false; render();
}
/* Se acabó el tiempo de una pregunta (modo estudio): se registra como fallada en el servidor. */
async function srvTimeout(quiz, qid){
  const i = quiz.qids.indexOf(qid); if(i < 0 || quiz.answers[qid]) return;
  try{
    const { data, error } = await supabaseClient.rpc('answer_question', { p_attempt: quiz.server.attemptId, p_pos: i + 1, p_choice: null });
    if(error) throw error;
    const r = srvParse(data) || {}; const q = quiz.shuffled[qid];
    if(q && r.correct_option){ q.correct = r.correct_option; q.explanation = r.explanation || ''; }
    if(!quiz.timedOut) quiz.timedOut = {};
    quiz.timedOut[qid] = true;
    srvMirror(qid, false);
  }catch(e){ console.warn('answer_question(timeout)', e); }
}
/* Termina el test en el servidor, trae la revisión (solo ahora, ya terminado) y deja la pantalla de resultado como siempre. */
async function srvFinishQuiz(toast){
  const quiz = STATE.quiz; if(!quiz || !quiz.server || quiz.server.busy) return;
  quiz.server.busy = true; stopTimer();
  try{
    const f = await supabaseClient.rpc('finish_test', { p_attempt: quiz.server.attemptId });
    if(f.error) throw f.error;
    const res = srvParse(f.data) || {};
    /* En League solo se revisan las preguntas que llegaste a contestar (el resto no se enseña). */
    const want = quiz.qids.map((qid, i) => i).filter(i => !isRecordMode(quiz.mode) || quiz.answers[quiz.qids[i]]);
    const revs = await Promise.all(want.map(i => supabaseClient.rpc('get_review_question', { p_attempt: quiz.server.attemptId, p_pos: i + 1 })));
    revs.forEach((r, k) => {
      if(r.error) throw r.error;
      const v = srvParse(r.data); const q = quiz.shuffled[quiz.qids[want[k]]];
      if(v && q){ q.correct = v.correct_option; q.explanation = v.explanation || ''; if(v.rule != null) q.rule = v.rule; if(v.domain) q.domain = v.domain; }
    });
    if(quiz.server.feedback === 'exam'){      /* en examen el progreso local se apunta ahora, ya con las soluciones */
      quiz.qids.forEach(qid => { const sel = quiz.answers[qid]; if(sel){ const q = quiz.shuffled[qid]; STATE.storage.progress[qid] = { correct: sel === q.correct, ts: Date.now() }; updateFailedStreak(qid, sel === q.correct); } });
      saveProgress(); markDayActive();
    }
    quiz.server.result = res;
    recordTestResult(quiz);           /* historial, coronas, insignias: igual que hoy, ahora con las soluciones ya conocidas */
    console.info('[srv] resultado del servidor', res);
    if(toast) STATE.toast = toast;
    STATE.view = 'result';
  }catch(e){ console.warn('finish_test', e); STATE.toast = srvError(e); }
  quiz.server.busy = false; render();
}

function startQuiz(law, mode){
  /* Regla numérica, VAR, Glosario, Guardadas y Sala de Repaso van por el servidor (el progreso ya está migrado). */
  if(srvOn() && (mode === 'study25' || mode === 'short') && (law == null || typeof law === 'number' || law === 'hard' || law === 'glossary' || law === 'saved' || law === 'failed')){ srvStartQuiz(law, mode); return; }
  const qids = pickQuestions(law, mode);
  if(qids.length===0){ STATE.toast="No hay preguntas disponibles para este modo."; render(); return; }
  bankReady(qids).then(function(ok){ if(!ok) return;
  STATE.quiz = { qids, idx:0, mode: mode||'short', law, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  });
}

function isFailedQuestion(q){
  return !!(STATE.storage.failedStreaks && Object.prototype.hasOwnProperty.call(STATE.storage.failedStreaks, q.id));
}

/* Filtra por la selección del configurador: números = reglas, 'glossary' / 'assistants' = salas especiales */
function trainPoolForLaws(laws){
  if(!laws || !laws.length) return allQuestions().filter(q => q.domain!=='assistants');
  return allQuestions().filter(q => laws.some(l => typeof l === 'number' ? q.rule === l : q.domain === l));
}

function startTraining(opts){
  if(srvCanTrain(opts)){ srvStartTraining(opts); return; }
  let pool = opts.scopeOverride ? questionsForLaw(opts.scopeOverride)
    : trainPoolForLaws(opts.laws);
  if(opts.onlyFailed) pool = pool.filter(isFailedQuestion);   /* "Solo preguntas que he fallado": mismo origen que la Sala de Repaso */
  pool = shuffle(pool.slice());
  const count = Math.max(1, Math.min(opts.count || 20, MAX_TEST_QUESTIONS, pool.length));
  pool = pool.slice(0, count);
  if(pool.length===0){ STATE.toast = opts.scopeOverride==='failed' ? "No tienes preguntas falladas con esos filtros. ¡Buen trabajo!" : "No hay preguntas disponibles con esos filtros."; render(); return; }

  let timerMode = opts.timerMode || 'none';
  let timeSec = 0, remainingSec = 0, perQSeconds = 0;
  if(timerMode==='total'){
    timeSec = (opts.minutes && opts.minutes > 0) ? Math.round(opts.minutes*60) : 0;
    if(timeSec<=0) timerMode='none';
    remainingSec = timeSec;
  } else if(timerMode==='perQuestion'){
    perQSeconds = Math.min(120, Math.max(5, opts.secondsPerQuestion || 45));
    remainingSec = perQSeconds;
  }

  bankReady(pool).then(function(ok){ if(!ok) return;
  STATE.quiz = {
    qids: pool.map(q=>q.id), idx:0, mode:'training', law: opts.scopeOverride || null,
    answers:{}, instantFeedback: !!opts.instantFeedback, timerMode, timeSec, remainingSec, perQSeconds
  };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  if(timerMode==='total' || timerMode==='perQuestion') startTimer();
  });
}

function goToQuestion(newIdx){
  const quiz = STATE.quiz;
  if(newIdx<0 || newIdx>=quiz.qids.length) return;
  quiz.idx = newIdx;
  if(quiz.timerMode==='perQuestion'){ quiz.remainingSec = quiz.perQSeconds; }
  if(quiz.mode==='training' && quiz.instantFeedback && (quiz.timerMode==='total' || quiz.timerMode==='perQuestion')){
    const qid = quiz.qids[quiz.idx];
    if(!quiz.answers[qid]) startTimer(); else stopTimer();
  }
  render();
}

function currentQ(){
  const qid = STATE.quiz.qids[STATE.quiz.idx];
  return quizQuestionById(qid);
}

/* Indicador compacto de preguntas: una pastilla por pregunta (respondida / acertada / fallada / pendiente). */
function questionDots(quiz){
  const visibleQids = isRecordMode(quiz.mode) ? quiz.qids.slice(0, quiz.idx+1) : quiz.qids;
  let okN = 0, badN = 0, answeredN = 0, pendingN = 0;
  const segs = visibleQids.map((qid,i)=>{
    const sel = quiz.answers[qid];
    const timedOut = !!(quiz.timedOut && quiz.timedOut[qid]);
    let cls = 'qd-seg', state = 'pendiente';
    if(i === quiz.idx) cls += ' current';
    if(sel){
      if(quiz.instantFeedback){
        const q = quizQuestionById(qid, quiz);
        if(sel === q.correct){ cls += ' ok'; okN++; state = 'acertada'; }
        else { cls += ' bad'; badN++; state = 'fallada'; }
      } else { cls += ' answered'; answeredN++; state = 'respondida'; }
    } else if(timedOut){ cls += ' bad'; badN++; state = 'sin tiempo'; }
    else pendingN++;
    const clickable = !quiz.instantFeedback || !!sel || timedOut;
    const label = 'Pregunta ' + (i+1) + ', ' + state;
    return clickable
      ? `<button type="button" class="${cls}" data-action="goto-question" data-idx="${i}" aria-label="${label}">${i+1}</button>`
      : `<div class="${cls}" role="img" aria-label="${label}">${i+1}</div>`;
  }).join('');
  const legend = quiz.instantFeedback
    ? `<span><b>${okN}</b> acertadas</span><span><b>${badN}</b> falladas</span><span><b>${pendingN}</b> pendientes</span>`
    : `<span><b>${answeredN}</b> respondidas</span><span><b>${pendingN}</b> pendientes</span>`;
  return `<nav class="qd" aria-label="Progreso de preguntas"><div class="qd-bar">${segs}</div><div class="qd-legend">${legend}</div></nav>`;
}

const RULE_SLUGS = {1:'regla-1-terreno-de-juego',2:'regla-2-balon',3:'regla-3-jugadores',4:'regla-4-equipamiento',5:'regla-5-arbitro',6:'regla-6-otros-miembros-equipo-arbitral',7:'regla-7-duracion-del-partido',8:'regla-8-inicio-y-reanudacion',9:'regla-9-balon-en-juego-y-fuera-de-juego',10:'regla-10-determinar-el-resultado',11:'regla-11-fuera-de-juego',12:'regla-12-faltas-e-incorrecciones',13:'regla-13-tiros-libres',14:'regla-14-tiro-penal',15:'regla-15-saque-de-banda',16:'regla-16-saque-de-meta',17:'regla-17-saque-de-esquina'};
function ruleGuideUrl(rule){ return RULE_SLUGS[rule] ? '/reglas-de-juego/' + RULE_SLUGS[rule] + '/' : ''; }

function quizView(){
  const ic = (n) => shellIcon(n);
  const quiz = STATE.quiz;
  const q = currentQ();
  if(q && q._stub){ bankLazy(quiz.qids.slice(quiz.idx, quiz.idx + 40)); return '<div class="skel-wrap" role="status" aria-label="Cargando preguntas"><span class="skel skel-title"></span><span class="skel skel-block"></span><span class="skel skel-line"></span></div>'; }
  const total = quiz.qids.length;
  /* instantánea al abrir la primera pregunta: sirve para mostrar tiempo, puntos ganados y subida de rango al final */
  if(!quiz.startTs){ quiz.startTs = Date.now(); quiz.startPoints = computePoints(); quiz.startRank = currentRank(quiz.startPoints).name; quiz.startBadges = Object.keys(STATE.storage.unlockedBadges || {}); }
  const letters=['a','b','c','d'];
  const selectedLetter = quiz.answers[q.id] || null;
  const timedOut = !!(quiz.timedOut && quiz.timedOut[q.id]);
  const reveal = quiz.instantFeedback && (!!selectedLetter || timedOut);
  const doneN = quiz.mode==='training' ? Object.keys(quiz.answers).length : (quiz.idx + (reveal ? 1 : 0));
  const pct = Math.round(Math.min(total, doneN) / total * 100);
  const correctCount = () => Object.keys(quiz.answers).filter(id=>{ const qq=quizQuestionById(id, quiz); return qq && quiz.answers[id]===qq.correct; }).length;

  let optsHtml = q.options.map((opt,i)=>{
    const letter = letters[i];
    let cls = 'option';
    let disabled = '';
    if(reveal){
      disabled='disabled';
      if(letter===q.correct) cls+=' correct';
      else if(letter===selectedLetter) cls+=' incorrect';
    } else if(selectedLetter===letter){
      cls+=' selected';
    }
    return `<button class="${cls}" data-action="answer" data-letter="${letter}" ${disabled}>
      <span class="letter">${letter.toUpperCase()}</span><span class="opt-text">${esc(opt)}</span>
    </button>`;
  }).join('');

  let feedback = '';
  if(reveal){
    const isOk = !timedOut && selectedLetter === q.correct;
    feedback = `<div class="qz-feedback ${isOk?'ok':'bad'}">
      <span class="qz-fb-ic">${ic(isOk ? 'check' : (timedOut ? 'clock' : 'flag'))}</span>
      <div><strong>${timedOut ? 'Se acabó el tiempo.' : (isOk ? '¡Bien visto! Sigue así.' : 'Revisa esta jugada.')}</strong>
        <small>${isOk ? 'Respuesta correcta.' : 'La respuesta correcta era la ' + q.correct.toUpperCase() + '.'}</small>
      </div>
    </div>
    ${(isLifeMode(quiz.mode) && quiz.hearts<=0) ? `<div class="qz-alert">${quiz.mode==='suddendeath' ? '¡Eliminado! Un fallo y se acabó la partida.' : '¡Te has quedado sin vidas! Fin de la partida.'}</div>` : ''}
    ${q.explanation ? `<div class="qz-expl"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}`;
  }
  const reportBtn = STATE.reportedIds[q.id]
    ? `<button class="flag-btn reported" data-action="report-question" data-qid="${q.id}" data-tooltip="Ya has avisado de un posible error en esta pregunta. Nuestro equipo la revisará.">${ic('check')} Error reportado, ¡gracias!</button>`
    : `<button class="flag-btn" data-action="report-question" data-qid="${q.id}" aria-label="Reportar error en esta pregunta" data-tooltip="Avisa si crees que esta pregunta tiene un error o está desactualizada, para que la revisemos.">${ic('flag')} Reportar error en esta pregunta</button>`;
  const savedBtn = STATE.storage.saved[q.id]
    ? `<button class="flag-btn on" data-action="toggle-saved" data-qid="${q.id}" data-tooltip="Quítala de tu lista personal si ya no quieres tenerla guardada.">${ic('star')} Guardada en Mi Academia</button>`
    : `<button class="flag-btn" data-action="toggle-saved" data-qid="${q.id}" data-tooltip="La pregunta se añadirá a tu lista personal en Mi Academia, para repasarla más tarde.">${ic('star')} Guardar en Mi Academia</button>`;
  const actionLinksRow = `<div class="qz-links">${savedBtn}${reportBtn}</div>`;

  let info, status;
  if(quiz.mode==='training'){
    /* En modo examen no se dice a qué regla pertenece la pregunta (daría pistas); en estudio sí. */
    info = `<strong>${quiz.instantFeedback ? scopeLabel(q) : 'Modo examen'}</strong><small>Pregunta ${quiz.idx+1} de ${total}</small>`;
    status = quiz.timerMode==='total' ? `<span class="qz-chip">${ic('clock')}<span class="mono" id="timer-display">${formatTime(quiz.remainingSec)}</span></span>` :
      quiz.timerMode==='perQuestion' ? `<span class="qz-chip">${ic('timer')}<span class="mono" id="timer-display">${formatTime(quiz.remainingSec)}</span></span>` :
      `<span class="qz-chip soft">${ic('repeat')} Sin límite</span>`;
    /* "Finalizar" arriba, lejos de Anterior/Siguiente, y siempre con confirmación */
    status += `<button type="button" class="qz-finish" data-action="finish-training" aria-label="Finalizar examen">Finalizar</button>`;
  } else if(isLifeMode(quiz.mode)){
    const maxLives = maxLivesFor(quiz.mode);
    info = `<strong>${quiz.mode==='suddendeath' ? 'Muerte Súbita' : 'Modo Corazones'}</strong><small>${quiz.combo>=2 ? 'Racha ' + quiz.combo + ' · ' : ''}Pregunta ${quiz.idx+1}</small>`;
    status = quiz.mode==='suddendeath'
      ? `<span class="qz-chip ${quiz.hearts>0 ? 'bad' : 'soft'}">${ic('skull')} ${quiz.hearts>0 ? 'Una vida' : 'Eliminado'}</span>`
      : `<span class="qz-hearts">${Array.from({length:maxLives}, (_,i) => `<span class="qz-heart ${i < quiz.hearts ? 'on' : ''}">${ic('heart')}</span>`).join('')}</span>`;
  } else if(quiz.mode==='timeattack'){
    /* Puntuación en vivo: la misma fórmula que el récord (cada acierto suma 1, cada fallo resta 0,5, nunca por debajo de 0). */
    const taRight = correctCount(), taWrong = Math.max(0, Object.keys(quiz.answers).length - taRight);
    const taScore = Math.max(0, taRight - taWrong * 0.5);
    info = `<strong>Contrarreloj</strong><small>Pregunta ${quiz.idx+1} · Aciertos ${taRight} · Puntuación <b>${formatScore(taScore)}</b></small>`;
    status = `<span class="qz-chip">${ic('timer')}<span class="mono" id="timer-display">${formatTime(quiz.remainingSec)}</span></span>`;
  } else {
    const scoreLabel = quiz.law==='failed'
      ? `Aciertos seguidos: ${STATE.storage.failedStreaks[q.id]||0}/3`
      : `Aciertos: ${correctCount()}`;
    info = `<strong>${scopeLabel(q)}</strong><small>Pregunta ${quiz.idx+1} de ${total} · ${scoreLabel}</small>`;
    status = `<span class="qz-chip score" role="status" aria-label="Aciertos: ${correctCount()}">${ic('target')} ${correctCount()}</span>`;
  }

  let actions;
  if(quiz.mode==='training'){
    actions = `
      <button class="btn btn-secondary" data-action="prev-question" ${quiz.idx===0?'disabled':''}>&larr; Anterior</button>
      ${quiz.idx+1<total ? `<button class="btn btn-secondary" data-action="next-question">Siguiente &rarr;</button>` : `<button class="btn btn-primary" data-action="finish-training">Finalizar examen</button>`}
    `;
  } else {
    const isGameOver = isLifeMode(quiz.mode) && quiz.hearts<=0;
    actions = `
      <button class="btn btn-secondary" data-action="prev-question" ${quiz.idx===0?'disabled':''}>&larr; Anterior</button>
      <button class="btn btn-primary" data-action="next-question" ${reveal ? '' : 'disabled aria-disabled="true"'}>${isGameOver ? 'Ver resultado' : (quiz.idx+1<total?'Siguiente &rarr;':'Ver resultado')}</button>
    `;
  }

  return `
  <div class="qz">
    <header class="qz-top">
      <button class="qz-exit" data-action="quit-quiz" aria-label="Salir del test">${ic('chevron')}<span>Salir</span></button>
      <div class="qz-info">${info}</div>
      <div class="qz-status">${status}</div>
      <div class="qz-progress" role="progressbar" aria-label="Progreso del test" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    </header>
    <div class="qz-body">
      <div class="qz-main">
      <article class="qz-card">
        <h2 class="qz-text">${esc(q.question)}</h2>
        <div class="qz-options" role="group" aria-label="Respuestas">${optsHtml}</div>
        ${quiz.idx === 0 ? '<p class="qz-hint"><kbd>1</kbd>–<kbd>4</kbd> o <kbd>A</kbd>–<kbd>D</kbd> para responder · <kbd>Enter</kbd> para continuar</p>' : ''}
        ${feedback}
        ${quiz.mode!=='training' ? (reveal ? actionLinksRow : '') : actionLinksRow}
      </article>
      ${questionDots(quiz)}
      </div>
      <div class="qz-actions">${actions}</div>
    </div>
  </div>
  `;
}

function selectAnswer(letter){
  const quiz = STATE.quiz;
  if(quiz.server){ srvSelectAnswer(letter); return; }
  const q = currentQ();
  quiz.answers[q.id] = letter;
  const correct = letter === q.correct;
  STATE.storage.progress[q.id] = { correct, ts: Date.now() };
  saveProgress();
  updateFailedStreak(q.id, correct);
  markDayActive();
  checkAndUnlockBadges();
  if(quiz.instantFeedback){
    quiz.selected = letter;
    quiz.showFeedback = true;
  }
  if(isLifeMode(quiz.mode)){
    if(!correct){
      quiz.hearts = Math.max(0, (quiz.hearts||0) - 1);
      quiz.combo = 0;
    } else {
      quiz.combo = (quiz.combo||0) + 1;
      if(quiz.combo > (quiz.bestCombo||0)) quiz.bestCombo = quiz.combo;
    }
  }
  if(quiz.mode==='training' && quiz.instantFeedback && (quiz.timerMode==='total' || quiz.timerMode==='perQuestion')){
    stopTimer();
  }
  render();
}

function nextQuestion(){
  const quiz = STATE.quiz;
  if(quiz.server && isRecordMode(quiz.mode) && quiz.idx+1 >= quiz.qids.length && !(isLifeMode(quiz.mode) && quiz.hearts<=0) && !quiz.server.noMore){
    /* se acabaron las servidas pero puede haber más: se espera (o se reintenta) en vez de terminar la partida */
    if(!quiz.server.moreBusy) srvLeagueMore(quiz);
    STATE.toast = 'Cargando más preguntas…'; render(); return;
  }
  if(quiz.server && (quiz.idx+1 >= quiz.qids.length || (isLifeMode(quiz.mode) && quiz.hearts<=0))){ srvFinishQuiz(); return; }
  if(isLifeMode(quiz.mode) && quiz.hearts<=0){
    stopTimer();
    recordTestResult(quiz);
    STATE.view='result';
    render();
    return;
  }
  if(quiz.idx+1 < quiz.qids.length){
    quiz.idx++; quiz.selected=null; quiz.showFeedback=false;
    if(quiz.timerMode==='perQuestion'){ quiz.remainingSec = quiz.perQSeconds; }
    if(quiz.mode==='training' && quiz.instantFeedback && (quiz.timerMode==='total' || quiz.timerMode==='perQuestion')){
      const newQid = quiz.qids[quiz.idx];
      if(!quiz.answers[newQid]) startTimer();
    }
    STATE.view='quiz';
  } else {
    stopTimer();
    recordTestResult(quiz);
    STATE.view='result';
  }
  render();
}

function resultView(){
  const quiz = STATE.quiz;
  const ic = (n) => shellIcon(n);
  const letters = ['a','b','c','d'];
  const scopeQids = isRecordMode(quiz.mode) ? quiz.qids.filter(qid => quiz.answers[qid]) : quiz.qids;
  const total = scopeQids.length;
  let score = 0;
  const byLaw = {};
  const fails = [];
  const rights = [];
  scopeQids.forEach((qid, i) => {
    const q = quizQuestionById(qid, quiz);
    if(!q) return;
    const sel = quiz.answers[qid];
    const ok = sel === q.correct;
    if(ok){ score++; rights.push({ q, sel, n: i + 1 }); } else fails.push({ q, sel, n: i + 1 });
    if(!byLaw[q.rule]) byLaw[q.rule] = {total:0, correct:0};
    byLaw[q.rule].total++;
    if(ok) byLaw[q.rule].correct++;
  });
  const pct = total ? Math.round(score / total * 100) : 0;
  const unanswered = isRecordMode(quiz.mode) ? 0 : quiz.qids.filter(qid => !quiz.answers[qid]).length;

  /* tiempo empleado y puntos ganados (se miden desde que se abre la primera pregunta) */
  if(quiz.startTs && !quiz.endTs) quiz.endTs = Date.now();
  const elapsed = quiz.startTs ? Math.max(0, Math.round((quiz.endTs - quiz.startTs) / 1000)) : null;
  const pointsNow = computePoints();
  const srvRes = (quiz.server && quiz.server.result) || null;
  const pointsGained = (srvRes && srvRes.points_gained != null) ? srvRes.points_gained : (quiz.startPoints != null ? Math.max(0, pointsNow - quiz.startPoints) : null);
  const rankNow = currentRank(pointsNow);
  const rankUp = false;   // las subidas de rango y las insignias nuevas las celebra gami.js con una ventana (datos del servidor)
  const startBadges = quiz.startBadges || [];
  const newBadges = [];

  /* veredicto: mismos tramos que ya usa la app para colorear resultados (60 % y 85 %) */
  const verdict = pct >= 85 ? { t: 'Excelente', soft: false, msg: 'Resultado sobresaliente. Sigue así.' }
    : pct >= 60 ? { t: 'Aprobado', soft: false, msg: 'Estás por encima del umbral de aprobado. Repasa los fallos para afianzarlo.' }
    : { t: 'A reforzar', soft: true, msg: 'Todavía no llegas al aprobado. Repasa tus fallos y vuelve a intentarlo.' };
  const R = 70, C = 2 * Math.PI * R;
  const ring = `<div class="rs-ring" role="img" aria-label="${pct} por ciento de aciertos">
    <svg viewBox="0 0 168 168" aria-hidden="true"><circle class="track" cx="84" cy="84" r="${R}" fill="none" stroke-width="12"/><circle class="fill" cx="84" cy="84" r="${R}" fill="none" stroke-width="12" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - pct / 100)).toFixed(2)}"/></svg>
    <div class="rs-pct">${pct}<small>%</small></div>
  </div>`;
  const stats = [
    `<span class="rs-stat">${ic('target')}<b>${score}/${total}</b> correctas</span>`,
    elapsed != null ? `<span class="rs-stat">${ic('clock')}<b>${formatTime(elapsed)}</b> de tiempo</span>` : '',
    pointsGained != null ? `<span class="rs-stat">${ic('star')}<b>+${pointsGained}</b> puntos</span>` : '',
    unanswered > 0 ? `<span class="rs-stat"><b>${unanswered}</b> sin responder</span>` : ''
  ].join('');

  const lastHR = STATE.lastHeartsResult;
  const recordCard = isRecordMode(quiz.mode) ? `<section class="rs-record ${lastHR && lastHR.isNewRecord ? 'new' : ''}">
    <div class="big">${lastHR ? formatScore(lastHR.score) : score}</div>
    <div class="label">${lastHR && lastHR.isNewRecord ? '¡Nuevo récord personal!' : 'puntos · tu récord: ' + formatScore(quiz.mode==='suddendeath' ? STATE.storage.suddenDeathRecord : quiz.mode==='timeattack' ? STATE.storage.timeAttackRecord : STATE.storage.heartsRecord)}</div>
    ${quiz.mode==='timeattack' ? `<div class="label">Cada fallo resta 0,5 puntos</div>` : ''}
  </section>` : '';

  const celebrate = (rankUp ? `<div class="rs-celebrate"><span class="ic">${ic('award')}</span><div><strong>¡Subes de rango!</strong><small>Ahora eres ${esc(rankNow.name)}.</small></div></div>` : '')
    + newBadges.map(b => `<div class="rs-celebrate"><span class="ic">${ic('trophy')}</span><div><strong>Nueva insignia: ${esc(b.name)}</strong><small>${esc(b.desc)}</small></div></div>`).join('');

  /* revisión de preguntas: falladas y acertadas en dos bloques plegables */
  const reviewItem = (f) => {
    const q = f.q;
    const good = f.sel === q.correct;
    const opts = q.options.map((o, idx) => {
      const letter = letters[idx];
      if(letter === q.correct) return `<div class="rs-ans ok"><b>${letter.toUpperCase()}</b><span><small>${good ? 'Tu respuesta · correcta' : 'Respuesta correcta'}</small>${esc(o)}</span></div>`;
      if(letter === f.sel) return `<div class="rs-ans bad"><b>${letter.toUpperCase()}</b><span><small>Tu respuesta</small>${esc(o)}</span></div>`;
      return '';
    }).join('');
    return `<article class="rs-fail">
      <div class="rs-fail-tag">Pregunta ${f.n} · ${scopeLabel(q)}${f.sel ? '' : ' · sin responder'}</div>
      <div class="rs-fail-q">${esc(q.question)}</div>
      ${opts}
      ${q.explanation ? `<div class="qz-expl"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    </article>`;
  };
  const reviewBlock = (title, list, cls) => list.length ? `<details class="ui-card rs-fails">
    <summary><span>${title}</span><span class="count ${cls}">${list.length}</span><span class="chev">${ic('chevron')}</span></summary>
    <div class="rs-fails-list">${list.map(reviewItem).join('')}</div>
  </details>` : '';
  const failsHtml = reviewBlock('Preguntas falladas', fails, 'bad') + reviewBlock('Preguntas acertadas', rights, 'ok');

  const lawRows = Object.keys(byLaw).sort((a, b) => a - b).map(law => {
    const b = byLaw[law];
    const rulePct = Math.round(b.correct / b.total * 100);
    return `<button class="rs-law" data-action="open-law" data-law="${law}"><span>Regla ${law} · ${esc(LAW_NAMES[law])}</span><span class="mono">${b.correct}/${b.total} · ${rulePct}%</span><span class="bar ui-progress" aria-hidden="true"><i style="width:${rulePct}%"></i></span></button>`;
  }).join('');
  const byLawHtml = Object.keys(byLaw).length > 1 ? `<section class="ui-card">
    <div class="ui-section-head" style="margin-top:0;"><h3>Repasa por regla</h3><small>Toca una regla para practicarla</small></div>${lawRows}
  </section>` : '';

  const isLeague = ['hearts','suddendeath','timeattack'].includes(quiz.mode);
  const lawNumeric = typeof quiz.law === 'number' || /^\d+$/.test(String(quiz.law || ''));
  const actions = [
    fails.length ? `<button class="btn btn-secondary" data-action="open-law" data-law="failed">${ic('repeat')} Repasar mis fallos</button>` : '',
    quiz.mode==='hearts' ? `<button class="btn btn-primary" data-action="start-hearts">Jugar de nuevo</button>` : '',
    quiz.mode==='suddendeath' ? `<button class="btn btn-primary" data-action="start-suddendeath">Jugar de nuevo</button>` : '',
    quiz.mode==='timeattack' ? `<button class="btn btn-primary" data-action="start-timeattack">Jugar de nuevo</button>` : '',
    quiz.mode==='training' ? `<button class="btn btn-primary" data-action="train-config">Otro test</button>` : '',
    (!isLeague && quiz.mode!=='training' && quiz.law) ? `<button class="btn btn-primary" data-action="start-quiz" data-law="${quiz.law}" data-mode="${quiz.mode}">Otro test</button>` : '',
    (!isLeague && quiz.mode!=='training' && !quiz.law) ? `<button class="btn btn-primary" data-action="start-daily-goal" data-count="${quiz.qids.length}">Otro test</button>` : '',
    (!isLeague && quiz.law) ? `<button class="btn btn-ghost" data-action="open-law" data-law="${quiz.law}">${lawNumeric ? 'Volver a la regla' : 'Volver'}</button>` : '',
    isLeague ? `<button class="btn btn-ghost" data-action="dailyChallenge">Volver a la League</button>` : `<button class="btn btn-ghost" data-action="home">Inicio</button>`
  ].join('');

  return `
  <div class="rs">
    ${recordCard}
    <section class="rs-hero">
      ${ring}
      <div class="rs-main">
        <span class="rs-verdict ${verdict.soft ? 'soft' : ''}">${verdict.soft ? '' : ic('check')}${verdict.t}</span>
        <h1 class="rs-score">${score}<small>de ${total} respuestas correctas</small></h1>
        <p class="rs-msg">${verdict.msg}</p>
        <div class="rs-stats">${stats}</div>
      </div>
    </section>
    ${celebrate}
    ${failsHtml}
    ${byLawHtml}
    <div class="rs-actions">${actions}</div>
  </div>
  `;
}

/* ---------------- CREAR TEST (configurador "Diseña tu examen") ----------------
   Misma pantalla para todo: desde el menú, desde "Test personalizado" de Inicio y desde la página de una regla
   (que llega con esa regla ya marcada). Las salas especiales (VAR, Repaso, Guardadas...) siguen entrando con su ámbito fijo. */
const CT_COUNTS = [5, 10, 15, 20, 25];
const CT_MINS = [10, 20, 30, 45];
const CT_SECS = [30, 45, 60, 90];
/* Solo hay valores fijos (sin "Otro"): cualquier valor que llegue de otro sitio se ajusta al más cercano de la lista. */
function ctSnap(v, list, dflt){ const n = Number(v); if(!isFinite(n)) return dflt; return list.reduce((b, x) => Math.abs(x - n) < Math.abs(b - n) ? x : b, list[0]); }
function ctAllLaws(){ const a = []; for(let i = 1; i <= 17; i++) a.push(i); a.push('glossary'); return a; }

/* Selecciones que dan los atajos (Todas / Mis flojas / Sin empezar) y cuál de ellos coincide ahora con lo marcado. */
function ctSelSets(){
  const sin = [];
  for(let i = 1; i <= 17; i++) if(lawStats(i).attempted === 0) sin.push(i);
  if(lawStats('glossary').attempted === 0) sin.push('glossary');
  return { all: ctAllLaws(), weak: ihWeakList().slice(0, 3).map(r => r.rule), new: sin };
}
function ctActiveSel(laws){
  const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const s = ctSelSets();
  if(same(laws, s.all)) return 'all';
  if(!laws.length) return 'none';
  if(same(laws, s.weak)) return 'weak';
  if(same(laws, s.new)) return 'new';
  return null;
}

/* Preguntas que cumplen los filtros elegidos (reglas + "solo falladas"). Mismo origen que la Sala de Repaso: isFailedQuestion. */
function ctPool(cfg){
  let pool = cfg.scopeOverride ? questionsForLaw(cfg.scopeOverride)
    : (cfg.laws && cfg.laws.length ? trainPoolForLaws(cfg.laws) : []);
  if(cfg.onlyFailed) pool = pool.filter(isFailedQuestion);
  return pool;
}

function trainConfigView(){
  const cfg = STATE.trainCfg;
  const ic = (n) => shellIcon(n);
  const scope = cfg.scopeOverride;
  const scopeName = scope==='hard' ? 'Sala VAR' : scope==='failed' ? 'Sala de Repaso' : scope==='glossary' ? 'Preguntas Glosario' : scope==='assistants' ? 'Árbitros Asistentes' : scope==='saved' ? 'Preguntas Guardadas' : null;
  const backAction = scope ? 'open-law' : (STATE.ctFrom != null ? 'open-law' : 'home');
  const backData = scope ? scope : (STATE.ctFrom != null ? STATE.ctFrom : '');
  const backLabel = scope ? scopeName : (typeof STATE.ctFrom === 'number' ? 'Regla ' + STATE.ctFrom : STATE.ctFrom === 'glossary' ? 'Glosario' : 'Inicio');

  cfg.count = ctSnap(cfg.count, CT_COUNTS, 20); cfg.minutes = ctSnap(cfg.minutes, CT_MINS, 20); cfg.secondsPerQuestion = ctSnap(cfg.secondsPerQuestion, CT_SECS, 45);
  cfg.countOther = cfg.minOther = cfg.secOther = false;
  const pool = ctPool(cfg);
  const avail = pool.length;
  const want =Math.min(MAX_TEST_QUESTIONS, Math.max(1, cfg.count || 20));
  const real = Math.min(want, avail);
  const basePool = scope ? questionsForLaw(scope) : (cfg.laws.length ? trainPoolForLaws(cfg.laws) : []);
  const failedAvail = basePool.filter(isFailedQuestion).length;

  /* --- chips --- */
  const chip = (on, action, attrs, label) => `<button type="button" class="ct-chip ${on ? 'on' : ''}" data-action="${action}" ${attrs} aria-pressed="${on}">${label}</button>`;
  const countRow = CT_COUNTS.map(n => chip(cfg.count === n, 'ct-count', `data-v="${n}"`, n)).join('');
  const minRow = CT_MINS.map(n => chip(cfg.minutes === n, 'ct-min', `data-v="${n}"`, n + ' min')).join('');
  const secRow = CT_SECS.map(n => chip(cfg.secondsPerQuestion === n, 'ct-sec', `data-v="${n}"`, n + ' s')).join('');

  const seg = (on, action, attrs, icon, title, text) => `<button type="button" class="ct-opt ${on ? 'on' : ''}" data-action="${action}" ${attrs} aria-pressed="${on}">
    <span class="ct-opt-ic">${ic(icon)}</span><span class="ct-opt-body"><strong>${title}</strong><small>${text}</small></span><span class="ct-opt-check">${ic('check')}</span></button>`;

  /* --- reglas --- */
  let rulesCard = '';
  const nRules = cfg.laws.filter(l => typeof l === 'number').length;
  const hasGl = cfg.laws.includes('glossary');
  if(!scope){
    const weakSet = new Set(ihWeakList().slice(0, 3).map(r => r.rule));
    const activeSel = ctActiveSel(cfg.laws);
    const ruleBtn =(key, num, name, state, crown, weak) => {
      const on = cfg.laws.includes(key);
      return `<button type="button" class="ct-rule ${on ? 'on' : ''} st-${state}" data-action="toggle-train-law" data-law="${key}" aria-pressed="${on}" aria-label="${key === 'glossary' ? 'Preguntas Glosario' : 'Regla ' + key + ', ' + esc(name)}${weak ? '. Es una de tus reglas más flojas' : ''}">
        <span class="ct-rule-num">${num}</span>
        <span class="ct-rule-name">${esc(name)}</span>
        <span class="ct-rule-st"><i class="ct-dot" aria-hidden="true"></i><span class="ct-crowns" aria-hidden="true">${[1,2,3,4].map(n => `<i class="${n <= crown ? 'on' : ''}">${IH_CROWN}</i>`).join('')}</span>${weak ? `<span class="ct-warn" title="Una de tus reglas más flojas">${IH_WARN}</span>` : ''}</span>
        <span class="ct-rule-check" aria-hidden="true">${ic('check')}</span>
      </button>`;
    };
    let rules = '';
    for(let i = 1; i <= 17; i++){ const r = ihRuleState(i); rules += ruleBtn(i, i, LAW_SHORT[i], r.state, r.crown, weakSet.has(i)); }
    const gl = lawStats('glossary');
    const glState = gl.attempted === 0 ? 'new' : (gl.total > 0 && gl.attempted === gl.total && gl.accuracyPct >= 90) ? 'mastered' : 'progress';
    rules += ruleBtn('glossary', 'G', 'Preguntas Glosario', glState, 0, false);
    rulesCard = `<section class="ct-card" aria-labelledby="ct-h-rules">
      <div class="ct-card-head"><h3 id="ct-h-rules">Reglas incluidas</h3><span class="ct-count-sel" aria-live="polite">${nRules} ${nRules === 1 ? 'regla seleccionada' : 'reglas seleccionadas'}${hasGl ? ' + Glosario' : ''}</span></div>
      <div class="ct-shortcuts" role="group" aria-label="Atajos de selección">
        ${[['all', 'Todas'], ['weak', 'Mis flojas'], ['new', 'Sin empezar'], ['none', 'Ninguna']].map(([k, label]) => `<button type="button" class="ct-chip ${activeSel === k ? 'on' : ''}" data-action="ct-sel" data-sel="${k}" aria-pressed="${activeSel === k}">${label}</button>`).join('')}
      </div>
      <div class="ct-rules">${rules}</div>
    </section>`;
  }

  /* --- resumen --- */
  const timerText = cfg.timerMode === 'none' ? 'Sin límite' : cfg.timerMode === 'total' ? cfg.minutes + ' min' : cfg.secondsPerQuestion + ' s por pregunta';
  const timerShort = cfg.timerMode === 'none' ? 'sin tiempo' : cfg.timerMode === 'total' ? cfg.minutes + ' min' : cfg.secondsPerQuestion + ' s/preg.';
  const scopeText = scope ? scopeName : (nRules === 0 && !hasGl ? 'Ninguna' : nRules === 17 && hasGl ? 'Todas las reglas' : nRules + (nRules === 1 ? ' regla' : ' reglas') + (hasGl ? ' + Glosario' : ''));
  const noneSel = !scope && !cfg.laws.length;
  let warn = '';
  if(noneSel) warn = 'Selecciona al menos una regla.';
  else if(avail === 0) warn = cfg.onlyFailed ? 'No tienes preguntas falladas con estos filtros.' : 'No hay preguntas con estos filtros.';
  else if(avail < want) warn = cfg.onlyFailed
    ? 'Solo tienes ' + avail + (avail === 1 ? ' pregunta fallada' : ' preguntas falladas') + ' con estos filtros.'
    : 'No hay tantas preguntas con estos filtros: el test saldrá más corto.';
  /* El número que se enseña es el que pides (nunca el tamaño del banco); solo con "Solo falladas" se muestra el real, porque son tus propios fallos. */
  const shownN = cfg.onlyFailed ? real : want;
  const goLabel = real > 0 ? `Generar test · ${shownN} ${shownN === 1 ? 'pregunta' : 'preguntas'}` : 'Generar test';
  const summary = `
    <div class="ct-sum-title">Tu test</div>
    <div class="ct-sum-row"><span>${ic('shuffle')} Preguntas</span><b>${shownN}${cfg.onlyFailed && avail > 0 && avail !== real ? ' <small>de ' + avail + '</small>' : ''}</b></div>
    <div class="ct-sum-row"><span>${ic('clock')} Tiempo</span><b>${timerText}</b></div>
    <div class="ct-sum-row"><span>${ic('target')} Tipo</span><b>${cfg.feedbackMode === 'study' ? 'Modo estudio' : 'Modo examen'}</b></div>
    <div class="ct-sum-row"><span>${ic('book')} Ámbito</span><b>${esc(scopeText)}</b></div>
    ${cfg.onlyFailed ? `<div class="ct-sum-row"><span>${ic('repeat')} Solo falladas</span><b>${avail} disponibles</b></div>` : ''}
    ${warn ? `<div class="ct-sum-warn" role="alert">${IH_WARN}<span>${warn}</span></div>` : ''}
    <button class="btn btn-primary ct-go" data-action="generate-exam" ${avail === 0 ? 'disabled' : ''}>${ic('play')} ${goLabel}</button>`;

  return `
  <div class="ct-page">
  <button class="backbtn" data-action="${backAction}" data-law="${backData}">&larr; ${backLabel}</button>
  <header class="ct-hero">
    <div class="home-eyebrow">${scopeName ? 'Test personalizado' : 'Crear test'}</div>
    <h1>${scopeName ? esc(scopeName) : 'Diseña tu examen'}</h1>
    <p>Elige cuántas preguntas, el tiempo y las reglas. Se genera un test aleatorio y puedes moverte entre preguntas hasta finalizarlo.</p>
  </header>

  <div class="ct-layout">
    <div class="ct-main">
      <section class="ct-card" aria-labelledby="ct-h-count">
        <div class="ct-card-head"><h3 id="ct-h-count">Número de preguntas</h3><span class="ct-hint">Máximo 25</span></div>
        <div class="ct-chips">${countRow}</div>
      </section>

      <section class="ct-card" aria-labelledby="ct-h-type">
        <div class="ct-card-head"><h3 id="ct-h-type">Tipo de test</h3></div>
        <div class="ct-opts two">
          ${seg(cfg.feedbackMode === 'exam', 'set-feedback-mode', 'data-fbmode="exam"', 'target', 'Modo examen', 'Ves los resultados al terminar, como en un examen real.')}
          ${seg(cfg.feedbackMode === 'study', 'set-feedback-mode', 'data-fbmode="study"', 'book', 'Modo estudio', 'Ves si aciertas y la solución al responder cada pregunta.')}
        </div>
      </section>

      <section class="ct-card" aria-labelledby="ct-h-time">
        <div class="ct-card-head"><h3 id="ct-h-time">Temporización</h3></div>
        <div class="ct-opts three">
          ${seg(cfg.timerMode === 'none', 'set-timer-mode', 'data-mode="none"', 'repeat', 'Sin límite', 'A tu ritmo.')}
          ${seg(cfg.timerMode === 'total', 'set-timer-mode', 'data-mode="total"', 'clock', 'Tiempo total', 'Un reloj para todo el test.')}
          ${seg(cfg.timerMode === 'perQuestion', 'set-timer-mode', 'data-mode="perQuestion"', 'zap', 'Por pregunta', 'Cuenta atrás en cada una.')}
        </div>
        ${cfg.timerMode === 'total' ? `<div class="ct-chips ct-sub">${minRow}</div>` : ''}
        ${cfg.timerMode === 'perQuestion' ? `<div class="ct-chips ct-sub">${secRow}</div><p class="ct-note">Máximo 120 segundos (2 min) por pregunta. Si se acaba el tiempo, pasa sola a la siguiente.</p>` : ''}
      </section>

      ${rulesCard}

      <section class="ct-card ct-failed" aria-labelledby="ct-h-failed">
        <button type="button" class="ct-switch ${cfg.onlyFailed ? 'on' : ''}" role="switch" aria-checked="${!!cfg.onlyFailed}" data-action="ct-failed" aria-labelledby="ct-h-failed">
          <span class="ct-switch-txt"><strong id="ct-h-failed">Solo preguntas que he fallado</strong><small>${failedAvail > 0 ? failedAvail + (failedAvail === 1 ? ' pregunta fallada disponible' : ' preguntas falladas disponibles') + ' con estos filtros (las de la Sala de Repaso)' : 'No tienes preguntas falladas con estos filtros'}</small></span>
          <span class="ct-switch-knob" aria-hidden="true"></span>
        </button>
      </section>
    </div>

    <aside class="ct-side" aria-label="Resumen del test"><div class="ct-summary">${summary}</div></aside>
  </div>

  <div class="ct-bar" role="region" aria-label="Generar test">
    <div class="ct-bar-info"><b>${shownN} ${shownN === 1 ? 'pregunta' : 'preguntas'}</b><span>${timerShort}</span>${warn ? `<em>${warn}</em>` : ''}</div>
    <button class="btn btn-primary" data-action="generate-exam" ${avail === 0 ? 'disabled' : ''}>Generar test</button>
  </div>
  </div>
  `;
}

function savedBrowseView(){
  const ic = (n) => shellIcon(n);
  const ids = savedValidIds();
  const letters=['a','b','c','d'];
  if(ids.length===0){
    return `<button class="backbtn" data-action="open-law" data-law="saved">&larr; Preguntas guardadas</button>
    <div class="ac-empty">${ic('star')}<strong>Ya no te quedan preguntas guardadas</strong><span>Cuando guardes alguna durante un test aparecerá aquí.</span></div>`;
  }
  if(STATE.savedBrowseIdx >= ids.length) STATE.savedBrowseIdx = ids.length - 1;
  if(STATE.savedBrowseIdx < 0) STATE.savedBrowseIdx = 0;
  const id = ids[STATE.savedBrowseIdx];
  const q = allQuestions().find(x=>x.id===id);
  if(q && q._stub){ bankLazy(ids.slice(Math.max(0, STATE.savedBrowseIdx), STATE.savedBrowseIdx + 20)); return '<div class="skel-wrap" role="status" aria-label="Cargando pregunta"><span class="skel skel-title"></span><span class="skel skel-block"></span></div>'; }
  if(q && q._unavailable){
    /* modo índice: solo se enseñan las Guardadas que ya has respondido en un test */
    return `<button class="backbtn" data-action="open-law" data-law="saved">&larr; Preguntas guardadas</button>
    <div class="ac-empty">${ic('star')}<strong>Esta pregunta aún no se puede mostrar</strong><span>Responde esta pregunta en un test y podrás verla aquí con su solución.</span>
    <div class="ac-nav"><button class="btn btn-secondary" data-action="saved-browse-prev" ${STATE.savedBrowseIdx<=0?'disabled':''}>&larr; Anterior</button>
    <button class="btn btn-primary" data-action="saved-browse-next" ${STATE.savedBrowseIdx>=ids.length-1?'disabled':''}>Siguiente &rarr;</button></div>
    <button class="btn btn-ghost btn-danger-soft" data-action="toggle-saved" data-qid="${q.id}">${ic('trash')} Quitar de Guardadas</button></div>`;
  }
  const pct = Math.round((STATE.savedBrowseIdx + 1) / ids.length * 100);
  return `
  <button class="backbtn" data-action="open-law" data-law="saved">&larr; Preguntas guardadas</button>
  ${acHero('Mi Academia · Guardadas', `Pregunta ${STATE.savedBrowseIdx+1} de ${ids.length}`, '', [], '', true)}
  <div class="ac-progress"><i style="width:${pct}%"></i></div>
  <article class="ac-q big">
    <div class="qtag">${scopeLabel(q)}</div>
    <div class="ac-q-head"><div class="ac-q-text">${esc(q.question)}</div></div>
    <div class="ac-q-opts">${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}</div>
    ${q.explanation ? `<div class="ac-q-expl"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    <div class="ac-q-actions">
      <button class="btn btn-ghost btn-danger-soft" data-action="toggle-saved" data-qid="${q.id}">${ic('trash')} Quitar de Guardadas</button>
    </div>
  </article>
  <div class="ac-nav">
    <button class="btn btn-secondary" data-action="saved-browse-prev" ${STATE.savedBrowseIdx<=0?'disabled':''}>&larr; Anterior</button>
    <button class="btn btn-primary" data-action="saved-browse-next" ${STATE.savedBrowseIdx>=ids.length-1?'disabled':''}>Siguiente &rarr;</button>
  </div>
  `;
}

function suggestFormView(){
  const ic = (n) => shellIcon(n);
  const idea = (icon, title, text) => `<div class="sg-idea"><span class="sg-idea-ic">${ic(icon)}</span><div><strong>${title}</strong><small>${text}</small></div></div>`;
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Ayúdanos a mejorar</div>
      <h1>Buzón de sugerencias</h1>
      <p>Comparte tus ideas, propuestas o funcionalidades que te gustaría ver en la plataforma. Leemos todas las sugerencias y muchas de ellas terminan convirtiéndose en nuevas mejoras.</p>
    </div>
    <div class="lg-hero-stats sg-hero-ic"><span>${ic('message')}</span></div>
  </section>

  <div class="sg-layout">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('pencil')}</span><div><h3>Tu sugerencia</h3><small>Cuéntanos con tus palabras qué te gustaría</small></div></div>
      <textarea id="suggest-message" rows="7" class="sg-textarea" placeholder="Ej: me gustaría que hubiera un modo..." maxlength="3000"></textarea>
      <div class="sg-foot">
        <span class="sg-count"><b id="suggest-count">0</b> / 3000</span>
        <button class="btn btn-yellow sg-send" data-action="send-suggestion">${ic('play')} Enviar sugerencia</button>
      </div>
    </div>

    <aside class="tc-card sg-ideas">
      <div class="tc-card-head"><span class="tc-step">${ic('idea')}</span><div><h3>¿Qué puedes proponer?</h3><small>Algunas ideas para empezar</small></div></div>
      ${idea('zap', 'Nuevas funciones', 'Modos de juego, herramientas o ajustes que echas de menos.')}
      ${idea('flag', 'Errores o mejoras', 'Algo que no funciona bien o que podría ser más cómodo.')}
      ${idea('book', 'Contenido', 'Preguntas, reglas o materiales que te gustaría practicar.')}
      ${idea('message', 'Lo que quieras', 'Cualquier comentario es bienvenido: lo leemos todo.')}
    </aside>
  </div>
  `;
}

function suggestionsAdminView(){
  const ic = (n) => shellIcon(n);
  const list = STATE.suggestions || [];
  const filter = STATE.sugFilter || 'all';
  const count = (s) => list.filter(x => x.status === s).length;
  const pendingCount = count('pending');
  const plannedCount = list.filter(x => x.status === 'planned').length;
  const doneCount = count('done');
  const shown = filter === 'all' ? list : list.filter(x => (x.status || 'pending') === filter);

  const statusChip = (status) => status==='done'
    ? '<span class="sg-chip done">Hecho</span>'
    : status==='planned'
    ? '<span class="sg-chip planned">Planificado</span>'
    : '<span class="sg-chip pending">Pendiente</span>';
  const initial = (e) => esc(String(e || '?').trim().charAt(0).toUpperCase());

  const cards = shown.map(s => `
    <article class="sg-card">
      <div class="sg-card-head">
        <span class="sg-av">${initial(s.user_email)}</span>
        <div class="sg-card-who"><strong>${esc(s.user_email || 'anónimo')}</strong><small>${new Date(s.created_at).toLocaleDateString('es-ES', { day:'numeric', month:'long', year:'numeric' })}</small></div>
        ${statusChip(s.status)}
      </div>
      <div class="sg-msg">${esc(s.message)}</div>
      <div class="sg-card-actions">
        <div class="ac-seg">
          <button class="${s.status==='pending'?'active':''}" data-action="suggestion-status" data-id="${s.id}" data-status="pending">Pendiente</button>
          <button class="${s.status==='planned'?'active':''}" data-action="suggestion-status" data-id="${s.id}" data-status="planned">Planificado</button>
          <button class="${s.status==='done'?'active':''}" data-action="suggestion-status" data-id="${s.id}" data-status="done">Hecho</button>
        </div>
        <button class="btn btn-ghost btn-danger-soft" data-action="suggestion-delete" data-id="${s.id}">${ic('trash')} Eliminar</button>
      </div>
    </article>
  `).join('');

  const seg = (key, label, n) => `<button class="${filter===key?'active':''}" data-action="sug-filter" data-filter="${key}">${label} <em>${n}</em></button>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Administración</div>
      <h1>Sugerencias recibidas</h1>
      <p>Lo que los usuarios proponen para mejorar WEREF. Márcalas según su estado para llevar el seguimiento.</p>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${list.length}</b><span>En total</span></div>
      <div class="lg-stat"><b>${pendingCount}</b><span>Pendientes</span></div>
      <div class="lg-stat"><b>${doneCount}</b><span>Hechas</span></div>
    </div>
  </section>

  <div class="ac-bar">
    <div class="ac-seg sg-filter">${seg('all', 'Todas', list.length)}${seg('pending', 'Pendientes', pendingCount)}${seg('planned', 'Planificadas', plannedCount)}${seg('done', 'Hechas', doneCount)}</div>
  </div>

  ${cards ? `<div class="sg-list">${cards}</div>` : `<div class="ac-empty">${ic('message')}<strong>${list.length === 0 ? 'Todavía no hay sugerencias' : 'No hay sugerencias con este estado'}</strong><span>${list.length === 0 ? 'Cuando los usuarios envíen alguna aparecerá aquí.' : 'Prueba con otro filtro.'}</span></div>`}
  `;
}

function saveQuestionEdit(qid){
  const before = allQuestionsAdmin().find(x => x.id === qid) || {};
  let domain, selectedNum;
  const scopeEl = document.getElementById('e-law');
  if(scopeEl){
    // Desplegable de ámbito: un número = esa regla; si no, Glosario, Asistentes o FCF.
    const v = scopeEl.value;
    domain = (v === 'glossary' || v === 'assistants' || v === 'fcf') ? v : 'law';
    selectedNum = domain === 'law' ? parseInt(v, 10) : null;
  } else {
    domain = document.getElementById('e-domain').value;
    const ruleSelEl = document.getElementById('e-rule');
    selectedNum = ruleSelEl ? parseInt(ruleSelEl.value,10) : null;
  }
  const moved = (before.domain && before.domain !== domain) || (domain === 'law' && before.rule !== selectedNum);
  const scopeNames = { glossary: 'Glosario IFAB', assistants: 'Árbitros Asistentes', fcf: 'Reglament General FCF' };
  const movedTo = domain === 'law' ? 'la Regla ' + selectedNum : scopeNames[domain];
  const question = document.getElementById('e-question').value.trim();
  const a = document.getElementById('e-a').value.trim();
  const b = document.getElementById('e-b').value.trim();
  const c = document.getElementById('e-c').value.trim();
  const d = document.getElementById('e-d').value.trim();
  const correct = (document.querySelector('input[name="e-correct"]:checked') || {}).value || 'a';
  const explanation = document.getElementById('e-explanation').value.trim();
  const difficulty = document.getElementById('e-hard').checked ? 'hard' : 'normal';
  if(!question || !a || !b || !c || !d){ STATE.toast='Rellena la pregunta y las 4 respuestas (a, b, c y d).'; render(); return; }
  const edit = (domain==='glossary' || domain==='assistants' || domain==='fcf')
    ? { question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() }
    : { rule: selectedNum, question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() };
  if(sharedActive()){
    // Banco compartido: el cambio lo ven todos los usuarios.
    const cur = allQuestionsAdmin().find(x => x.id === qid) || {};
    sharedSave([sharedRowFor(qid, domain, edit, cur.createdAt)]);
    if(cur.draft){
      // La pregunta estaba retirada del juego: se ofrece volver a publicarla ya corregida.
      setTimeout(async () => {
        const ok = await appConfirm({
          title: '¿Volver a poner la pregunta en juego?',
          message: 'Estaba retirada del juego. Si ya está corregida, vuelve a estar disponible para todos los usuarios.',
          confirmText: 'Volver a ponerla en juego', cancelText: 'Dejarla retirada', icon: 'play'
        });
        if(!ok) return;
        const ex = SHARED.rows[qid];
        if(ex){ sharedSave([Object.assign({}, ex, { draft: false })]); STATE.toast = 'Pregunta puesta en juego de nuevo.'; render(); }
      }, 60);
    }
    if(STATE.storage.edits[qid]){ delete STATE.storage.edits[qid]; saveEdits(); }
  } else {
    STATE.storage.edits[qid] = edit;
    saveEdits();
  }
  STATE.editingId = null;
  STATE.toast = moved ? 'Pregunta actualizada y movida a ' + movedTo + '.' : 'Pregunta actualizada.';
  render();
}

function filteredDbList(opts){
  opts = opts || {};
  const f = STATE.dbFilter;
  let list = allQuestionsAdmin();
  if(opts.skipLaw){ /* sin filtrar por regla (para los contadores) */ }
  else if(f.law === 'hard') list = list.filter(q => q.difficulty === 'hard');
  else if(f.law === 'glossary') list = list.filter(q => q.domain === 'glossary');
  else if(f.law === 'assistants') list = list.filter(q => q.domain === 'assistants');
  else if(f.law === 'fcf') list = list.filter(q => q.domain === 'fcf');
  else if(f.law !== 'all') list = list.filter(q => q.domain !== 'glossary' && q.rule === parseInt(f.law,10));
  if(f.difficulty === 'hard') list = list.filter(q => q.difficulty === 'hard');
  else if(f.difficulty === 'normal') list = list.filter(q => q.difficulty !== 'hard');
  if(f.myOnly) list = list.filter(q => q.source === 'user');
  if(opts.skipStatus){ /* sin filtrar por estado (para los contadores) */ }
  else if(f.status === 'attention'){ const dups = duplicateQuestionIds(); list = list.filter(q => (STATE.reports[q.id]||0) > 0 || dups.has(q.id) || dbReviewState(q.id) === 'fix'); }
  else if(f.status === 'draft') list = list.filter(q => !!q.draft);
  else if(f.status === 'pending') list = list.filter(q => !STATE.storage.reviewed[q.id]);
  else if(f.status === 'reviewed') list = list.filter(q => !!STATE.storage.reviewed[q.id]);
  if(opts.skipStatus){ }
  else if(f.reviewStatus === 'reviewed') list = list.filter(q => !!STATE.storage.reviewed[q.id]);
  else if(f.reviewStatus === 'pending') list = list.filter(q => !STATE.storage.reviewed[q.id]);
  if(f.search && f.search.trim()){
    const s = f.search.trim().toLowerCase();
    const numQuery = /^#\d+$/.test(s) ? parseInt(s.slice(1), 10) : null;
    if(numQuery !== null){
      const pos = {}; allQuestionsAdmin().forEach((q, i) => { pos[q.id] = i + 1; });
      list = list.filter(q => questionNumber(q, pos[q.id]) === numQuery);
    } else {
      list = list.filter(q => q.question.toLowerCase().includes(s) || q.options.some(o => o.toLowerCase().includes(s)));
    }
  }
  if(f.reportedOnly){
    list = list.filter(q => (STATE.reports[q.id]||0) > 0);
    list = list.slice().sort((a,b) => (STATE.reports[b.id]||0) - (STATE.reports[a.id]||0));
  }
  if(f.duplicatesOnly){
    const dupIds = duplicateQuestionIds();
    list = list.filter(q => dupIds.has(q.id));
  }
  if(f.dateFrom || f.dateTo){
    const field = f.dateField === 'updated' ? 'updatedAt' : 'createdAt';
    const isRev = f.dateField === 'reviewed';
    const fromTs = f.dateFrom ? new Date(f.dateFrom+'T00:00:00').getTime() : -Infinity;
    const toTs = f.dateTo ? new Date(f.dateTo+'T23:59:59.999').getTime() : Infinity;
    list = list.filter(q => {
      let ts = isRev ? Number(STATE.storage.reviewed[q.id]) : Number(q[field]);
      if(isRev && !(ts > 1e11)) ts = 0;       // revisadas antes de que se guardara la fecha: sin fecha
      return ts && ts >= fromTs && ts <= toTs;
    });
  }
  return list;
}

/* ---------- Base de datos: filtro por fechas (selector propio: atajos + calendario) ----------
   Se evita <input type="date">: el navegador avisa del cambio en cuanto se teclea la primera cifra del año
   y la lista se repintaba a mitad de escribir. Aquí cada clic es una elección completa. */
const DB_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function dbIso(d){ const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function dbFmtDay(iso){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function dbPresets(){
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const day = (n) => { const d = new Date(y, m, now.getDate() - n); return dbIso(d); };
  const seasonStart = m >= 6 ? y : y - 1;
  return [
    ['today', 'Hoy', dbIso(now), dbIso(now)],
    ['yesterday', 'Ayer', day(1), day(1)],
    ['7d', 'Últimos 7 días', day(6), dbIso(now)],
    ['30d', 'Últimos 30 días', day(29), dbIso(now)],
    ['month', 'Este mes', dbIso(new Date(y, m, 1)), dbIso(new Date(y, m + 1, 0))],
    ['lastmonth', 'Mes pasado', dbIso(new Date(y, m - 1, 1)), dbIso(new Date(y, m, 0))],
    ['season', 'Esta temporada', dbIso(new Date(seasonStart, 6, 1)), dbIso(new Date(seasonStart + 1, 5, 30))]
  ];
}
function dbCalState(){
  if(!STATE.dbCal){ const n = new Date(); STATE.dbCal = { open: null, y: n.getFullYear(), m: n.getMonth() }; }
  return STATE.dbCal;
}
function dbCalendarHtml(f){
  const c = dbCalState();
  const first = new Date(c.y, c.m, 1);
  const lead = (first.getDay() + 6) % 7;                 // semana que empieza en lunes
  const start = new Date(c.y, c.m, 1 - lead);
  const todayIso = dbIso(new Date());
  let cells = '';
  for(let i = 0; i < 42; i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = dbIso(d);
    const cls = ['dc-day'];
    if(d.getMonth() !== c.m) cls.push('out');
    if(iso === todayIso) cls.push('today');
    if(f.dateFrom && f.dateTo && iso > f.dateFrom && iso < f.dateTo) cls.push('in');
    if(iso === f.dateFrom) cls.push('sel', 'from');
    if(iso === f.dateTo) cls.push('sel', 'to');
    cells += `<button type="button" class="${cls.join(' ')}" data-action="db-cal-pick" data-date="${iso}">${d.getDate()}</button>`;
  }
  const ic = (n) => shellIcon(n);
  return `<div class="dc-cal" role="dialog" aria-label="Calendario">
    <div class="dc-ask">Elige la fecha <b>${c.open === 'to' ? 'Hasta' : 'Desde'}</b></div>
    <div class="dc-head">
      <button type="button" class="dc-nav" data-action="db-cal-nav" data-dm="-12" aria-label="Año anterior">«</button>
      <button type="button" class="dc-nav" data-action="db-cal-nav" data-dm="-1" aria-label="Mes anterior">‹</button>
      <b>${DB_MONTHS[c.m]} ${c.y}</b>
      <button type="button" class="dc-nav" data-action="db-cal-nav" data-dm="1" aria-label="Mes siguiente">›</button>
      <button type="button" class="dc-nav" data-action="db-cal-nav" data-dm="12" aria-label="Año siguiente">»</button>
    </div>
    <div class="dc-dow"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div class="dc-grid">${cells}</div>
    <div class="dc-foot">
      <button type="button" class="btn btn-ghost" data-action="db-cal-today">Hoy</button>
      <button type="button" class="btn btn-ghost" data-action="db-cal-clear" data-target="${c.open}">Quitar esta fecha</button>
      <button type="button" class="btn btn-primary" data-action="db-cal-close">Listo</button>
    </div>
  </div>`;
}
function dbDateFilterHtml(f){
  const c = dbCalState();
  const fields = [['created', 'Creación'], ['updated', 'Última modificación'], ['reviewed', 'Revisión']];
  const presets = dbPresets();
  const active = presets.find(p => p[2] === f.dateFrom && p[3] === f.dateTo);
  const btn = (target, label, val) => `<button type="button" class="dc-input ${c.open === target ? 'open' : ''} ${val ? 'has' : ''}" data-action="db-cal-open" data-target="${target}"><small>${label}</small><span>${val ? esc(dbFmtDay(val)) : 'Sin fecha'}</span></button>`;
  return `<div class="dc-wrap">
    <div class="dc-label">Filtrar por fecha de</div>
    <div class="db-status-group dc-fields">${fields.map(([k, l]) => `<button type="button" class="db-status ${f.dateField === k ? 'active' : ''}" style="padding:8px 14px;" data-action="db-date-field" data-field="${k}">${l}</button>`).join('')}</div>
    <div class="dc-label">Periodo rápido</div>
    <div class="db-status-group dc-presets">${presets.map(p => `<button type="button" class="tx-filter ${active && active[0] === p[0] ? 'active' : ''}" data-action="db-date-preset" data-preset="${p[0]}">${p[1]}</button>`).join('')}</div>
    <div class="dc-label">O elige tú las fechas</div>
    <div class="dc-inputs">
      ${btn('from', 'Desde', f.dateFrom)}
      <span class="dc-sep">→</span>
      ${btn('to', 'Hasta', f.dateTo)}
      ${(f.dateFrom || f.dateTo) ? `<button type="button" class="btn btn-ghost" data-action="db-date-clear">Quitar fechas</button>` : ''}
    </div>
    ${c.open ? dbCalendarHtml(f) : ''}
  </div>`;
}
/* Acciones del filtro de fechas. Devuelve true si la acción era suya. */
function dbDateAction(action, el){
  const f = STATE.dbFilter;
  if(!/^db-(cal|date)-/.test(action)) return false;
  const c = dbCalState();
  f.advOpen = true; f.page = 1;
  if(action === 'db-date-field'){ f.dateField = el.dataset.field; }
  else if(action === 'db-date-preset'){
    const p = dbPresets().find(x => x[0] === el.dataset.preset);
    if(p){ f.dateFrom = p[2]; f.dateTo = p[3]; c.open = null; }
  }
  else if(action === 'db-date-clear'){ f.dateFrom = ''; f.dateTo = ''; c.open = null; }
  else if(action === 'db-cal-open'){
    const t = el.dataset.target;
    c.open = c.open === t ? null : t;
    const cur = t === 'to' ? (f.dateTo || f.dateFrom) : (f.dateFrom || f.dateTo);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(cur || '') ? new Date(cur + 'T00:00:00') : new Date();
    c.y = d.getFullYear(); c.m = d.getMonth();
  }
  else if(action === 'db-cal-nav'){
    const d = new Date(c.y, c.m + parseInt(el.dataset.dm, 10), 1);
    c.y = d.getFullYear(); c.m = d.getMonth();
  }
  else if(action === 'db-cal-today'){ const n = new Date(); c.y = n.getFullYear(); c.m = n.getMonth(); }
  else if(action === 'db-cal-pick'){
    const iso = el.dataset.date;
    if(c.open === 'to'){ f.dateTo = iso; if(f.dateFrom && f.dateFrom > iso) f.dateFrom = ''; c.open = null; }
    else {
      f.dateFrom = iso; if(f.dateTo && f.dateTo < iso) f.dateTo = '';
      if(f.dateTo) c.open = null;
      else {                                  // sigue con la fecha final, mostrando el mismo mes
        c.open = 'to';
        const d = new Date(iso + 'T00:00:00'); c.y = d.getFullYear(); c.m = d.getMonth();
      }
    }
  }
  else if(action === 'db-cal-clear'){
    if(el.dataset.target === 'to') f.dateTo = ''; else f.dateFrom = '';
    c.open = null;
  }
  else if(action === 'db-cal-close'){ c.open = null; }
  render();
  return true;
}

/* ---------- Base de datos: lista compacta + panel de detalle ---------- */
function dbScopeShort(q){
  if(q.domain === 'glossary') return 'Glosario';
  if(q.domain === 'fcf') return 'FCF';
  return 'R' + q.rule;
}
/* Pregunta abierta en el panel (solo si sigue dentro del filtro actual). */
function dbActiveQuestion(list){
  const id = STATE.dbActive;
  return id ? (list || filteredDbList()).find(q => q.id === id) || null : null;
}
/* Mueve la pregunta abierta arriba o abajo; cambia de página si hace falta. */
function dbMoveActive(delta){
  const f = STATE.dbFilter;
  const list = filteredDbList();
  if(!list.length) return;
  const pageSize = [25, 50, 100].includes(f.pageSize) ? f.pageSize : 50;
  let i = list.findIndex(q => q.id === STATE.dbActive);
  if(i < 0) i = delta > 0 ? -1 : list.length;
  const n = Math.max(0, Math.min(list.length - 1, i + delta));
  if(n === i) return;
  STATE.dbActive = list[n].id; STATE.editingId = null; STATE.dbListMode = false;
  f.page = Math.floor(n / pageSize) + 1;
  render();
  const row = document.querySelector('.dbx-row.active');
  if(row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}
/* Al abrir una pregunta con el panel junto a la lista, sube la página lo justo para que se vea entero
   (la barra de acciones del panel queda siempre dentro de la pantalla). */
function dbEnsureVisible(){
  const d = document.querySelector('.dbx-detail.open'), lay = document.querySelector('.dbx-layout');
  if(!d || !lay || getComputedStyle(d).position !== 'sticky') return;
  const need = lay.getBoundingClientRect().top + window.scrollY - 136;
  if(window.scrollY < need) window.scrollTo(0, Math.max(0, need));
}
/* Atajos de la Base de datos: ↑↓ moverte, R revisada y siguiente, E editar, / buscar, Esc cerrar. */
function dbKeydown(ev){
  if(STATE.view !== 'database' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if(document.querySelector('.modal-backdrop, #confirm-modal')) return;
  const a = document.activeElement;
  const typing = !!(a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable));
  const k = ev.key;
  if(k === 'Escape'){
    if(typing){ a.blur(); return; }
    if(STATE.editingId){ STATE.editingId = null; render(); }
    else if(STATE.dbFull){ STATE.dbFull = false; render(); }
    else if(STATE.dbActive){ STATE.dbActive = null; STATE.dbListMode = true; render(); }
    return;
  }
  if(typing) return;
  if(k === '/'){ const s = document.getElementById('db-search'); if(s){ ev.preventDefault(); s.focus(); s.select(); } }
  else if(k === 'ArrowDown' || k === 'j'){ ev.preventDefault(); dbMoveActive(1); }
  else if(k === 'ArrowUp' || k === 'k'){ ev.preventDefault(); dbMoveActive(-1); }
  else if((k === 'r' || k === 'R') && STATE.dbActive){ ev.preventDefault(); dbReviewNext(); }
  else if((k === 'e' || k === 'E') && STATE.dbActive){ ev.preventDefault(); STATE.editingId = STATE.dbActive; render(); }
  else if((k === 'c' || k === 'C') && STATE.dbActive){
    ev.preventDefault();
    if(!(REV.ready && REV.fix)){ STATE.toast = 'Falta ejecutar el SQL question-needs-changes.sql en Supabase.'; render(); return; }
    setReviewState(STATE.dbActive, dbReviewState(STATE.dbActive) === 'fix' ? 'none' : 'fix'); render();
  }
  else if((k === 'f' || k === 'F') && STATE.dbActive){ ev.preventDefault(); STATE.dbFull = !STATE.dbFull; render(); }
}
if(typeof window !== 'undefined' && !window.__dbKeys){ window.__dbKeys = true; window.addEventListener('keydown', dbKeydown); }
/* Marca la pregunta abierta como revisada y pasa a la siguiente. */
function dbReviewNext(){
  const id = STATE.dbActive; if(!id) return;
  const f = STATE.dbFilter;
  const pageSize = [25, 50, 100].includes(f.pageSize) ? f.pageSize : 50;
  const i = filteredDbList().findIndex(q => q.id === id);
  setReviewed(id, true);
  const after = filteredDbList();
  const still = after.findIndex(q => q.id === id);
  // con el filtro «Sin revisar» la que acaba de revisarse desaparece y la siguiente ocupa su sitio
  const target = still >= 0 ? still + 1 : i;
  if(target >= 0 && target < after.length){
    STATE.dbActive = after[target].id; STATE.editingId = null;
    f.page = Math.floor(target / pageSize) + 1;
  } else if(still < 0){
    STATE.dbActive = null;
  }
  render();
  const row = document.querySelector('.dbx-row.active');
  if(row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

function databaseView(){
  const ic = (n) => shellIcon(n);
  const f = STATE.dbFilter;
  const pageSize = [25, 50, 100].includes(f.pageSize) ? f.pageSize : 50;
  const list = filteredDbList();
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  if(f.page > totalPages) f.page = totalPages;
  const startIdx = (f.page - 1) * pageSize;
  const pageItems = list.slice(startIdx, startIdx + pageSize);
  const letters = ['a','b','c','d'];

  const all = allQuestionsAdmin();
  const numberMap = {};
  all.forEach((q,i) => { numberMap[q.id] = questionNumber(q, i+1); });
  qnumSync();
  const dupIds = duplicateQuestionIds();
  let active = dbActiveQuestion(list);
  // Estás revisando y cambias de regla, de estado o buscas: se abre la primera pregunta del nuevo filtro
  // (así sigues en el modo revisión en vez de volver a la lista). Si no hay ninguna, se cierra.
  // Al entrar en la Base de datos no se muestra el montón de preguntas: se abre directamente la primera del filtro actual.
  // La lista solo aparece cuando la pides con «Volver a la lista».
  if(!active && list.length && (STATE.dbActive || !STATE.dbListMode)){ active = list[0]; STATE.dbActive = active.id; STATE.editingId = null; }
  if(!active){ STATE.dbActive = null; STATE.dbFull = false; }

  const chip = (cls, text) => `<span class="db-tag ${cls}">${text}</span>`;
  const rows = pageItems.map(q => {
    const isReviewed = !!STATE.storage.reviewed[q.id];
    const needsFix = !isReviewed && !!(STATE.storage.needsFix || {})[q.id];
    const reportCount = STATE.reports[q.id] || 0;
    const tags = [
      q.draft ? chip('draft', 'Retirada') : '',
      needsFix ? chip('flag', 'Necesita cambios') : '',
      q.difficulty==='hard' ? chip('hard', 'Difícil') : '',
      q.source==='user' ? chip('mine', 'Añadida') : '',
      reportCount>0 ? chip('bad', 'Reportada x' + reportCount) : '',
      dupIds.has(q.id) ? chip('dup', 'Duplicada') : ''
    ].join('');
    return `<div class="dbx-row ${active && active.id === q.id ? 'active' : ''} ${isReviewed ? 'reviewed' : ''} ${needsFix ? 'needsfix' : ''} ${reportCount>0 ? 'reported' : ''} ${q.draft ? 'is-draft' : ''}">
      <button class="dbx-check ${isReviewed ? 'on' : ''} ${needsFix ? 'fix' : ''}" data-action="toggle-reviewed" data-qid="${q.id}" aria-pressed="${isReviewed ? 'true' : 'false'}" title="${isReviewed ? 'Revisada · pulsa para quitar la marca' : (needsFix ? 'Necesita cambios · pulsa para marcarla como revisada' : 'Marcar como revisada')}" aria-label="${isReviewed ? 'Quitar la marca de revisada' : 'Marcar como revisada'}">${ic(needsFix ? 'flag' : 'check')}</button>
      <button class="dbx-open" data-action="db-open" data-qid="${q.id}">
        <span class="dbx-num">#${numberMap[q.id] || '…'}</span>
        <span class="dbx-text"><strong>${esc(q.question)}</strong></span>
        <span class="dbx-scope">${esc(dbScopeShort(q))}</span>
        <span class="dbx-tags">${tags}</span>
      </button>
    </div>`;
  }).join('');

  // Contadores cruzados: los de estado respetan la regla elegida y los de regla respetan el estado elegido.
  const reviewedCount = all.filter(q => STATE.storage.reviewed[q.id]).length;
  const attentionCount = all.filter(q => (STATE.reports[q.id] || 0) > 0 || dupIds.has(q.id) || dbReviewState(q.id) === 'fix').length;
  const draftCount = all.filter(q => q.draft).length;
  const noStatus = filteredDbList({ skipStatus: true });
  const noLaw = filteredDbList({ skipLaw: true });
  const sAll = noStatus.length;
  const sReviewed = noStatus.filter(q => STATE.storage.reviewed[q.id]).length;
  const sPending = sAll - sReviewed;
  const sAttention = noStatus.filter(q => (STATE.reports[q.id] || 0) > 0 || dupIds.has(q.id) || dbReviewState(q.id) === 'fix').length;
  const sDraft = noStatus.filter(q => q.draft).length;
  const lawsCount = {};
  for(let i = 1; i <= 17; i++) lawsCount[i] = 0;
  let glossaryCnt = 0, fcfCnt = 0, hardCnt = 0;
  noLaw.forEach(q => {
    if(q.domain === 'glossary') glossaryCnt++;
    else if(q.domain === 'fcf') fcfCnt++;
    else if(q.rule) lawsCount[q.rule] = (lawsCount[q.rule] || 0) + 1;
    if(q.difficulty === 'hard') hardCnt++;
  });
  const countsFiltered = f.status !== 'all' || f.difficulty !== 'all' || f.myOnly || f.reportedOnly || f.duplicatesOnly || (f.search && f.search.trim()) || f.dateFrom || f.dateTo;
  const statusNow = f.status || 'all';
  const LOW_COUNT_THRESHOLD = 30;

  const railItem = (law, label, n, opts) => {
    opts = opts || {};
    const low = !countsFiltered && !opts.noLow && n < LOW_COUNT_THRESHOLD;
    return `<button class="dbx-rn ${String(f.law)===String(law) ? 'on' : ''} ${low ? 'low' : ''}" data-action="db-view-law-questions" data-law="${law}" title="${esc(opts.title || label)}"><b>${esc(label)}</b>${opts.sub ? `<span>${esc(opts.sub)}</span>` : ''}<em>${n}</em></button>`;
  };
  const shortName = (n) => String(LAW_NAMES[n] || '').replace(/^(El|La|Los|Las)\s+/i, '');
  const rail = `<div class="dbx-rsec">Reglas${countsFiltered ? '' : ` <small>· en rojo, menos de ${LOW_COUNT_THRESHOLD}</small>`}</div>`
    + `<button class="dbx-rn all ${String(f.law)==='all' ? 'on' : ''}" data-action="db-view-law-questions" data-law="all"><b>Todo el banco</b><em>${noLaw.length}</em></button>`
    + Array.from({length:17},(_,i)=>i+1).map(i => railItem(i, 'R' + i, lawsCount[i] || 0, { sub: shortName(i), title: 'Regla ' + i + ' · ' + LAW_NAMES[i] })).join('')
    + `<div class="dbx-rsec">Otros</div>`
    + railItem('glossary', 'Glosario', glossaryCnt)
    + railItem('fcf', 'Reglament FCF', fcfCnt, { noLow: true })
    + railItem('hard', 'Sala VAR (difíciles)', hardCnt, { noLow: true });

  const lawSelect = `<select id="db-law" class="dbx-mlaw" aria-label="Regla">` +
    `<option value="all" ${f.law==='all'?'selected':''}>Todo el banco (${noLaw.length})</option>` +
    Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${String(f.law)===String(i)?'selected':''}>R${i} — ${esc(LAW_NAMES[i])} (${lawsCount[i] || 0})</option>`).join('') +
    `<option value="glossary" ${f.law==='glossary'?'selected':''}>Glosario (${glossaryCnt})</option>` +
    `<option value="fcf" ${f.law==='fcf'?'selected':''}>Reglament FCF (${fcfCnt})</option>` +
    `<option value="hard" ${f.law==='hard'?'selected':''}>Sala VAR · difíciles (${hardCnt})</option></select>`;

  const statusChip = (key, label, n) => `<button class="db-status ${key} ${statusNow === key ? 'active' : ''}" data-action="db-set-status" data-status="${key}">${label}<em>${n}</em></button>`;
  const advOpen = f.advOpen === true;      // el filtro de fechas es un desplegable: solo se abre cuando lo pulsas
  const datesOn = !!(f.dateFrom || f.dateTo);
  const from = list.length ? startIdx + 1 : 0;
  const to = Math.min(startIdx + pageSize, list.length);

  // ----- panel de detalle -----
  let detail = '';
  if(active){
    const q = active;
    const isReviewed = !!STATE.storage.reviewed[q.id];
    const reportCount = STATE.reports[q.id] || 0;
    const idx = list.findIndex(x => x.id === q.id);
    const dates = [];
    if(q.createdAt) dates.push(`Creada ${new Date(q.createdAt).toLocaleDateString('es-ES')}`);
    if(q.updatedAt) dates.push(`Editada ${new Date(q.updatedAt).toLocaleDateString('es-ES')}`);
    { const rv = STATE.storage.reviewed[q.id]; if(typeof rv === 'number' && rv > 1e11) dates.push(`Revisada ${new Date(rv).toLocaleDateString('es-ES')}`); }
    const tagsAll = [
      q.draft ? chip('draft', 'Retirada del juego') : '',
      q.difficulty==='hard' ? chip('hard', 'Difícil') : '',
      q.source==='user' ? chip('mine', 'Añadida') : '',
      reportCount>0 ? chip('bad', 'Reportada x' + reportCount) : '',
      dupIds.has(q.id) ? chip('dup', 'Duplicada') : ''
    ].join('');
    // Estado de revisión: un solo control con tres opciones (en lugar de dos botones parecidos)
    const stNow = dbReviewState(q.id);
    const fixOk = REV.ready && REV.fix;
    const stBtn = (key, label, cls, icon, extra) => `<button type="button" class="dbx-st ${cls} ${stNow === key ? 'on' : ''}" data-action="db-set-state" data-qid="${q.id}" data-state="${key}" aria-pressed="${stNow === key ? 'true' : 'false'}" ${extra || ''}>${icon ? ic(icon) + ' ' : ''}${label}</button>`;
    const stateCtl = `<div class="dbx-state" role="group" aria-label="Estado de revisión">
        ${stBtn('reviewed', 'Revisada', 'ok', 'check')}
        ${stBtn('none', 'Sin revisar', '', '')}
        ${stBtn('fix', 'Necesita cambios <kbd>C</kbd>', 'fix', 'flag', fixOk ? '' : 'disabled title="Falta ejecutar el SQL question-needs-changes.sql en Supabase"')}
      </div>`;
    const head = `<div class="dbx-d-top">
        <div class="dbx-d-nav">
          <button type="button" class="tx-icon" data-action="db-nav" data-dir="-1" ${idx <= 0 ? 'disabled' : ''} title="Pregunta anterior (↑)" aria-label="Pregunta anterior">${ic('up')}</button>
          <button type="button" class="tx-icon" data-action="db-nav" data-dir="1" ${idx < 0 || idx >= list.length - 1 ? 'disabled' : ''} title="Pregunta siguiente (↓)" aria-label="Pregunta siguiente">${ic('down')}</button>
          <small>${idx + 1} de ${list.length}</small>
        </div>
        <div class="dbx-d-tools">
          <button type="button" class="btn btn-ghost dbx-fullbtn" data-action="db-full" title="${STATE.dbFull ? 'Volver a ver la lista' : 'Oculta la lista para tener más espacio'} (F)">${STATE.dbFull ? 'Salir de pantalla completa' : 'Pantalla completa'}</button>
          <button type="button" class="btn btn-ghost dbx-backbtn" data-action="db-close" title="Cerrar la pregunta y ver la lista (Esc)">&larr; Volver a la lista</button>
        </div>
      </div>`;
    const meta = `<div class="dbx-d-meta"><span class="db-q-num" title="Número único y permanente de la pregunta">#${numberMap[q.id] || '…'}</span><span class="db-q-scope">${scopeLabel(q)}</span></div>`;
    if(STATE.editingId === q.id){
      detail = `${head}<div class="dbx-d-body">${meta}${editFormHtml(q)}</div>`;
    } else {
      detail = `${head}
      <div class="dbx-d-body">
      ${meta}
      ${stateCtl}
      ${tagsAll ? `<div class="db-tags" style="margin-bottom:12px;">${tagsAll}</div>` : ''}
      <div class="dbx-d-q">${esc(q.question)}</div>
      <div class="dbx-opts">${q.options.map((o,i)=>`<div class="dbx-opt ${letters[i]===q.correct?'ok':''}"><u>${letters[i].toUpperCase()}</u><span>${esc(o)}</span>${letters[i]===q.correct ? `<em>${ic('check')} Correcta</em>` : ''}</div>`).join('')}</div>
      ${q.explanation ? `<div class="dbx-d-expl"><strong>Explicación</strong>${esc(q.explanation)}</div>` : `<div class="dbx-d-noexpl">Esta pregunta no tiene explicación.</div>`}
      ${dates.length ? `<div class="dbx-d-dates">${dates.join(' · ')}</div>` : ''}
      </div>
      <div class="dbx-d-actions">
        <button class="btn btn-primary" data-action="db-review-next" data-qid="${q.id}">${ic('check')} Revisada y siguiente <kbd>R</kbd></button>
        <button class="btn btn-ghost" data-action="edit-question" data-qid="${q.id}">${ic('pencil')} Editar <kbd>E</kbd></button>
        ${sharedActive() ? `<button class="btn ${q.draft ? 'btn-primary' : 'btn-ghost'}" data-action="toggle-draft" data-qid="${q.id}" title="${q.draft ? 'Vuelve a estar disponible para todos los usuarios' : 'Se retira del juego hasta que la corrijas'}">${ic(q.draft ? 'play' : 'lock')} ${q.draft ? 'Volver a poner en juego' : 'Retirar del juego'}</button>` : ''}
        ${reportCount>0 ? `<button class="btn btn-ghost" data-action="dismiss-reports" data-qid="${q.id}">${ic('flag')} Descartar reportes</button>` : ''}
        <button class="btn btn-ghost btn-danger-soft" data-action="delete-question" data-qid="${q.id}">${ic('trash')} Eliminar</button>
      </div>`;
    }
  }

  return `
  <div class="dbx ${active ? 'panel-on' : ''}">
    <button class="backbtn" data-action="home">&larr; Inicio</button>
    <section class="lg-hero">
      <div class="lg-hero-main">
        <div class="home-eyebrow">Administración</div>
        <h1>Base de datos</h1>
        <p>Revisa, edita y añade las preguntas de toda la plataforma. Los cambios que hagas los ven todos los usuarios.</p>
        <div class="ac-hero-actions">
          <button class="btn btn-yellow" data-action="add-from-db">${ic('plus')} Añadir pregunta</button>
          <details class="db-more">
            <summary class="btn btn-glass">${ic('more')} Más</summary>
            <div class="db-more-menu">
              <button class="db-more-item" data-action="export-excel">${ic('download')} Exportar a Excel</button>
              <label class="db-more-item">${ic('fileplus')} Importar desde Excel
                <input type="file" id="import-excel-file" accept=".xlsx,.xls" style="display:none;">
              </label>
            </div>
          </details>
        </div>
      </div>
      <div class="lg-hero-stats">
        <div class="lg-stat"><b>${all.length}</b><span>Preguntas</span></div>
        <div class="lg-stat"><b>${reviewedCount}</b><span>Revisadas</span></div>
        <div class="lg-stat"><b>${attentionCount}</b><span>Necesitan atención</span></div>
      </div>
    </section>

    <div class="dbx-bar">
      <div class="ac-search dbx-search">
        ${ic('search')}
        <input type="text" id="db-search" placeholder="Buscar por palabra o por número (#120)…" value="${esc(f.search)}" maxlength="100" aria-label="Buscar texto">
      </div>
      <div class="db-status-group" role="group" aria-label="Estado">
        ${statusChip('all', 'Todas', sAll)}
        ${statusChip('attention', 'Atención', sAttention)}
        ${statusChip('pending', 'Sin revisar', sPending)}
        ${statusChip('reviewed', 'Revisadas', sReviewed)}
        ${sharedActive() || draftCount ? statusChip('draft', 'Retiradas', sDraft) : ''}
      </div>
      <div class="dbx-bar2">
        ${lawSelect}
        <select id="db-difficulty" aria-label="Dificultad">
          <option value="all" ${f.difficulty==='all'?'selected':''}>Toda dificultad</option>
          <option value="normal" ${f.difficulty==='normal'?'selected':''}>Normal</option>
          <option value="hard" ${f.difficulty==='hard'?'selected':''}>Difícil</option>
        </select>
        <details class="db-adv" ${advOpen ? 'open' : ''}>
          <summary>Fechas${datesOn ? ' <i class="dbx-dot" title="Hay un filtro de fechas activo"></i>' : ''}</summary>
          <div class="db-adv-body">
            ${dbDateFilterHtml(f)}
            ${(f.dateFrom || f.dateTo) ? (f.dateField === 'reviewed'
              ? `<div class="st-note" style="margin-top:4px;">La fecha de revisión se guarda desde que se añadió esta función: las preguntas que ya estaban marcadas como revisadas antes no tienen fecha y no aparecerán en este filtro.</div>`
              : `<div class="st-note" style="margin-top:4px;">La fecha solo se registra desde que se añadió esta función: las preguntas antiguas que nunca se han vuelto a editar no tienen fecha y no aparecerán en este filtro.</div>`) : ''}
          </div>
        </details>
      </div>
    </div>

    <div class="dbx-layout ${active ? 'has-panel' : ''} ${active && STATE.dbFull ? 'full' : ''}">
      <nav class="dbx-rail" aria-label="Reglas">${rail}</nav>
      <div class="dbx-main">
        <div class="dbx-results-head">
          <span>${list.length ? `<b>${from}–${to}</b> de <b>${list.length}</b>` : 'Sin resultados'}</span>
          <span class="dbx-hint"><kbd>↑</kbd><kbd>↓</kbd> moverte · <kbd>R</kbd> revisada y siguiente · <kbd>C</kbd> necesita cambios · <kbd>E</kbd> editar · <kbd>/</kbd> buscar</span>
          <label class="db-pagesize">Por página
            <select id="db-page-size">
              ${[25, 50, 100].map(n => `<option value="${n}" ${pageSize === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>
        </div>
        ${rows ? `<div class="dbx-list">${rows}</div>` : `<div class="ac-empty">${ic('search')}<strong>Ninguna pregunta coincide con este filtro</strong><span>Prueba a quitar algún filtro.</span></div>`}
        ${list.length>pageSize ? `
        <div class="ad-pager">
          <button class="btn btn-ghost" data-action="db-prev-page" ${f.page<=1?'disabled':''}>&larr; Anterior</button>
          <span>Página ${f.page} / ${totalPages}</span>
          <button class="btn btn-ghost" data-action="db-next-page" ${f.page>=totalPages?'disabled':''}>Siguiente &rarr;</button>
        </div>` : ''}
      </div>
      <aside class="dbx-detail ${active ? 'open' : ''}" aria-label="Detalle de la pregunta">${detail}</aside>
    </div>
  </div>
  `;
}

function adminDashboardView(){
  const ic = (n) => shellIcon(n);
  const s = STATE.adminStats;
  const heroBase = (stats) => `
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Administración</div>
      <h1>Panel de administración</h1>
      <p>Estadísticas generales de la plataforma y gestión de usuarios.</p>
    </div>
    ${stats ? `<div class="lg-hero-stats">${stats}</div>` : ''}
  </section>`;

  if(s === null){
    return `
    <button class="backbtn" data-action="home">&larr; Inicio</button>
    ${heroBase('')}
    <div class="ac-empty">${ic('clock')}<strong>Cargando estadísticas...</strong></div>
    `;
  }

  if(s === false){
    return `
    <button class="backbtn" data-action="home">&larr; Inicio</button>
    ${heroBase('')}
    <div class="ac-empty">${ic('flag')}<strong>No se pudieron cargar las estadísticas</strong><button class="btn btn-primary" style="margin-top:8px;" data-action="admin-dashboard-retry">Reintentar</button></div>
    `;
  }

  const kpi = (icon, tone, value, label) => `<div class="ad-kpi ${tone}"><span class="ad-kpi-ic">${ic(icon)}</span><div><b>${value}</b><small>${esc(label)}</small></div></div>`;
  const kpis = [
    kpi('users', '', s.totalUsers, 'Total usuarios'),
    kpi('userplus', 'good', s.registeredToday, 'Registrados hoy'),
    kpi('calendar', '', s.registeredWeek, 'Esta semana'),
    kpi('calendar', '', s.registeredMonth, 'Este mes'),
    kpi('flame', 'good', s.active, 'Activos (30 días)'),
    kpi('clock', 'warn', s.inactive, 'Inactivos'),
    kpi('lock', 'bad', s.blocked, 'Bloqueados'),
    (s.developers !== undefined ? kpi('award', '', s.developers, 'Desarrolladores') : '')
  ].join('');

  const maxCount = Math.max(1, ...s.chart.map(d => d.count));
  const chartTotal = s.chart.reduce((a, d) => a + d.count, 0);
  const chartHtml = s.chart.map(d => {
    const h = Math.max(4, Math.round(d.count / maxCount * 100));
    const label = formatEventDate(d.date);
    return `<div class="ad-bar ${d.count > 0 ? 'on' : ''}" title="${label}: ${d.count} registro${d.count===1?'':'s'}"><i style="height:${h}%;"></i></div>`;
  }).join('');
  const axis = s.chart.length ? `<div class="ad-axis"><span>${formatEventDate(s.chart[0].date)}</span><span>${formatEventDate(s.chart[s.chart.length-1].date)}</span></div>` : '';

  const rowsHtml = s.users.map(u => {
    const isSelf = typeof CURRENT_USER_EMAIL !== 'undefined' && u.email === CURRENT_USER_EMAIL;
    const role = u.email === DEV_USER_EMAIL ? 'master' : (u.role || 'user');
    const initial = esc(String(u.username || u.email || '?').trim().charAt(0).toUpperCase());
    const canModerate = !isSelf && role !== 'master' && (role !== 'developer' || isMaster());
    const roleBtn = (isMaster() && !isSelf && role !== 'master')
      ? (role === 'developer'
          ? `<button class="btn btn-ghost" data-action="admin-set-role" data-uid="${u.id}" data-role="user">${ic('userplus')} Quitar desarrollador</button>`
          : `<button class="btn btn-ghost ad-dev" data-action="admin-set-role" data-uid="${u.id}" data-role="developer">${ic('userplus')} Hacer desarrollador</button>`)
      : '';
    return `
    <div class="ad-user ${u.blocked ? 'blocked' : ''}">
      <span class="ad-user-av">${initial}</span>
      <div class="ad-user-id">
        <strong>${u.username ? esc(u.username) : '<span style="color:var(--muted); font-weight:500;">Sin usuario</span>'}</strong>
        <small>${esc(u.email)}</small>
      </div>
      <span class="ad-user-date">${formatEventDate(u.created_at.slice(0,10))}</span>
      <span class="ad-role ${role}">${ROLE_LABELS[role]}</span>
      ${u.blocked ? '<span class="sg-chip bad">Bloqueado</span>' : '<span class="sg-chip done">Activo</span>'}
      <div class="ad-user-actions">${isSelf ? '<span class="ad-self">Tú</span>' : `
        ${roleBtn}
        ${canModerate ? (u.blocked
          ? `<button class="btn btn-ghost ad-ok" data-action="admin-unblock-user" data-uid="${u.id}">${ic('check')} Desbloquear</button>`
          : `<button class="btn btn-ghost ad-warn" data-action="admin-block-user" data-uid="${u.id}">${ic('lock')} Bloquear</button>`) : ''}
        ${canModerate ? `<button class="btn btn-ghost btn-danger-soft" data-action="admin-delete-user" data-uid="${u.id}">${ic('trash')} Eliminar</button>` : ''}
      `}</div>
    </div>`;
  }).join('');

  const tool = (icon, title, text, action) => `<button class="ad-tool" data-action="${action}"><span class="ad-tool-ic">${ic(icon)}</span><span><strong>${title}</strong><small>${text}</small></span><span class="ad-tool-go">${ic('chevron')}</span></button>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  ${heroBase(`
    <div class="lg-stat"><b>${s.totalUsers}</b><span>Usuarios</span></div>
    <div class="lg-stat"><b>${s.active}</b><span>Activos 30 d</span></div>
    <div class="lg-stat"><b>${s.registeredToday}</b><span>Nuevos hoy</span></div>`)}

  <div class="ad-kpis">${kpis}</div>

  <div class="ad-tools">
    ${tool('database', 'Base de datos', 'Gestiona las preguntas', 'database')}
    ${tool('message', 'Sugerencias', 'Revisa lo que proponen', 'suggestions-admin')}
    ${tool('target', 'Panel de Formación', 'Controla CTA BAGES', 'committee-training')}
  </div>

  ${bankCardHtml()}
  ${bankUsageCardHtml()}

  <div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('chart')}</span><div><h3>Registros de los últimos 30 días</h3><small>${chartTotal} nuevos usuarios en el periodo</small></div></div>
    ${s.totalUsers === 0 ? '<div class="st-note">Todavía no hay usuarios registrados.</div>' : `<div class="ad-chart">${chartHtml}</div>${axis}`}
  </div>

  <div class="tc-card">
    <div class="tc-card-head"><span class="tc-step">${ic('users')}</span><div><h3>Todos los usuarios</h3><small>${s.usersFilteredTotal} ${s.usersFilteredTotal === 1 ? 'resultado' : 'resultados'}</small></div></div>
    <div class="ad-filters">
      <div class="ac-search" style="margin:0; flex:2; min-width:200px;">
        ${ic('search')}
        <input type="text" id="admin-users-search" placeholder="Buscar por usuario o correo..." value="${esc(STATE.adminUsersFilter.search)}" maxlength="100" aria-label="Buscar usuarios">
      </div>
      <select id="admin-users-status" style="flex:1; min-width:150px; margin:0;">
        <option value="all" ${STATE.adminUsersFilter.status==='all'?'selected':''}>Todos los estados</option>
        <option value="active" ${STATE.adminUsersFilter.status==='active'?'selected':''}>Activos</option>
        <option value="inactive" ${STATE.adminUsersFilter.status==='inactive'?'selected':''}>Inactivos</option>
        <option value="blocked" ${STATE.adminUsersFilter.status==='blocked'?'selected':''}>Bloqueados</option>
      </select>
      <select id="admin-users-role" style="flex:1; min-width:150px; margin:0;" aria-label="Filtrar por rol">
        <option value="all" ${STATE.adminUsersFilter.role==='all'?'selected':''}>Todos los roles</option>
        <option value="master" ${STATE.adminUsersFilter.role==='master'?'selected':''}>Maestro</option>
        <option value="developer" ${STATE.adminUsersFilter.role==='developer'?'selected':''}>Desarrolladores</option>
        <option value="user" ${STATE.adminUsersFilter.role==='user'?'selected':''}>Usuarios normales</option>
      </select>
    </div>
    <div class="ad-users">${rowsHtml || `<div class="st-note">Ningún usuario coincide con este filtro.</div>`}</div>
    ${s.usersTotalPages > 1 ? `
    <div class="ad-pager">
      <button class="btn btn-ghost" data-action="admin-users-prev-page" ${s.usersPage<=1?'disabled':''}>&larr; Anterior</button>
      <span>Página ${s.usersPage} / ${s.usersTotalPages}</span>
      <button class="btn btn-ghost" data-action="admin-users-next-page" ${s.usersPage>=s.usersTotalPages?'disabled':''}>Siguiente &rarr;</button>
    </div>` : ''}
  </div>
  `;
}

/* Formulario de pregunta (alta y edición): mismas piezas, distinto prefijo de ids (f- / e-) */
function questionFormSections(p, v){
  const ic = (n) => shellIcon(n);
  const letters = ['a','b','c','d'];
  const answers = letters.map((l, i) => `
    <label class="fq-ans">
      <input type="radio" name="${p}-correct" value="${l}" ${v.correct === l ? 'checked' : ''}>
      <span class="fq-letter">${l.toUpperCase()}</span>
      <input type="text" id="${p}-${l}" maxlength="300" value="${esc(v.options[i] || '')}" placeholder="Respuesta ${l.toUpperCase()}" aria-label="Respuesta ${l.toUpperCase()}">
      <span class="fq-ok">${ic('check')} Correcta</span>
    </label>`).join('');
  return `
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">1</span><div><h3>Enunciado</h3><small>${v.scopeHint}</small></div></div>
      ${v.scopeHtml}
      <label for="${p}-question">Pregunta</label>
      <textarea id="${p}-question" placeholder="Escribe el enunciado..." maxlength="1000">${esc(v.question || '')}</textarea>
    </div>
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">2</span><div><h3>Respuestas</h3><small>Marca con el círculo cuál es la correcta</small></div></div>
      <div class="fq-answers">${answers}</div>
    </div>
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">3</span><div><h3>Explicación y dificultad</h3><small>Opcional · ayuda a quien estudia</small></div></div>
      <label for="${p}-explanation">Explicación</label>
      <textarea id="${p}-explanation" placeholder="Por qué es correcta, artículo del reglamento, matices..." maxlength="2000">${esc(v.explanation || '')}</textarea>
      <label class="fq-hard"><input type="checkbox" id="${p}-hard" ${v.hard ? 'checked' : ''}><span><strong>Es una pregunta difícil</strong><small>Aparecerá también en la Sala VAR</small></span></label>
    </div>`;
}

function addQuestionView(){
  const isGlossaryContext = STATE.lawId === 'glossary';
  const currentLawNum = typeof STATE.lawId === 'number' ? STATE.lawId : null;
  const lawSel = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${currentLawNum===i?'selected':''}>Regla ${i} — ${esc(LAW_NAMES[i])}</option>`).join('')
    + `<option value="glossary" ${isGlossaryContext?'selected':''}>Glosario IFAB</option>`
    + (sharedActive() ? `<option value="fcf" ${STATE.lawId==='fcf'?'selected':''}>Reglament General FCF (solo Base de datos y tests)</option>` : '');
  const backAction = STATE.cameFromDb ? 'database' : (STATE.lawId!=null ? 'open-law' : 'home');
  const sections = questionFormSections('f', {
    options: ['', '', '', ''], correct: 'a', question: '', explanation: '', hard: false,
    scopeHint: 'Dónde va y qué se pregunta',
    scopeHtml: `<label for="f-law">Ámbito</label><select id="f-law">${lawSel}</select>`
  });
  return `
  <button class="backbtn" data-action="${backAction}" data-law="${STATE.lawId!=null?STATE.lawId:''}">&larr; Volver</button>
  ${acHero('Base de datos', 'Añadir pregunta', 'Se publica para todos los usuarios en cuanto la guardes.', [], '', true)}
  <div class="ac-form fq-form">
    ${sections}
    <div class="fq-actions">
      <button class="btn btn-primary" data-action="save-question">${shellIcon('check')} Guardar pregunta</button>
      <button class="btn btn-ghost" data-action="${backAction}" data-law="${STATE.lawId!=null?STATE.lawId:''}">Cancelar</button>
    </div>
  </div>
  `;
}

function editFormHtml(q){
  const isGlossaryQ = q.domain === 'glossary' || q.domain === 'assistants' || q.domain === 'fcf';
  const lawOpts = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${q.rule===i?'selected':''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('');
  const tagLabel = q.domain === 'fcf' ? 'Reglament General FCF' : q.domain === 'assistants' ? 'Árbitros Asistentes' : isGlossaryQ ? 'Glosario IFAB' : 'Regla '+q.rule+' · '+esc(LAW_NAMES[q.rule]);
  // Con el banco compartido se puede cambiar el ámbito (regla, Glosario, Asistentes o FCF); sin él solo la regla.
  const scopeOpts = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${q.domain==='law' && q.rule===i?'selected':''}>Regla ${i} — ${esc(LAW_NAMES[i])}</option>`).join('')
    + `<option value="glossary" ${q.domain==='glossary'?'selected':''}>Glosario IFAB</option>`
    + `<option value="fcf" ${q.domain==='fcf'?'selected':''}>Reglament General FCF (solo Base de datos y tests)</option>`;
  const sections = questionFormSections('e', {
    options: q.options || ['', '', '', ''], correct: q.correct, question: q.question, explanation: q.explanation || '', hard: q.difficulty === 'hard',
    scopeHint: tagLabel,
    scopeHtml: sharedActive()
      ? `<label for="e-law">Ámbito</label><select id="e-law">${scopeOpts}</select>`
      : `<input type="hidden" id="e-domain" value="${q.domain}">${isGlossaryQ ? '' : `<label for="e-rule">Regla</label><select id="e-rule">${lawOpts}</select>`}`
  });
  return `<article class="fq-edit">
    <div class="fq-edit-head"><span class="cm-chip open">Editando</span><strong>${tagLabel}</strong></div>
    <div class="fq-form">
      ${sections}
      <div class="fq-actions">
        <button class="btn btn-primary" data-action="save-edit" data-qid="${q.id}">${shellIcon('check')} Guardar cambios</button>
        <button class="btn btn-ghost" data-action="cancel-edit">Cancelar</button>
      </div>
    </div>
  </article>`;
}

/* Guarda una pregunta nueva en el banco compartido (o en la cuenta si no está instalado) sin cambiar de pantalla.
   f = { domain, rule, question, options[4], correct, explanation, difficulty }.
   Devuelve { ok:false, msg } o { ok:true, id, saving } (saving = promesa de la escritura en el servidor). */
function persistNewQuestion(f){
  const dedupeKey = questionDedupeKey({ question: f.question, options: f.options });
  if(allQuestionsAdmin().some(q => questionDedupeKey(q) === dedupeKey)){
    return { ok: false, msg: 'Ya existe una pregunta con este mismo enunciado y estas mismas opciones en la base de datos.' };
  }
  const domain = f.domain;
  if(sharedActive()){
    const prefix = domain === 'glossary' ? 'G' : domain === 'assistants' ? 'S' : domain === 'fcf' ? 'F' : 'U';
    const id = prefix + Math.random().toString(36).slice(2,9);
    const saving = sharedSave([sharedRowFor(id, domain, { rule: f.rule, question: f.question, options: f.options, correct: f.correct, explanation: f.explanation, difficulty: f.difficulty }, Date.now())]);
    return { ok: true, id, saving };
  }
  if(domain === 'glossary'){
    const q = { domain:'glossary', rule:null, num: 'U'+(STATE.storage.glossaryQuestions.length+1), question: f.question, options: f.options, correct: f.correct, explanation: f.explanation, difficulty: f.difficulty, id:'G'+Math.random().toString(36).slice(2,9), source:'user', createdAt: Date.now() };
    STATE.storage.glossaryQuestions.push(q);
    saveGlossaryQuestions();
    return { ok: true, id: q.id, saving: Promise.resolve(true) };
  }
  const q = { domain:'law', rule: f.rule, num: 'U'+(STATE.storage.userQuestions.length+1), question: f.question, options: f.options, correct: f.correct, explanation: f.explanation, difficulty: f.difficulty, id:'U'+Math.random().toString(36).slice(2,9), source:'user', createdAt: Date.now() };
  STATE.storage.userQuestions.push(q);
  saveUserQuestions();
  return { ok: true, id: q.id, saving: Promise.resolve(true) };
}

function saveNewQuestion(){
  const lawSelEl = document.getElementById('f-law');
  const lawSelVal = lawSelEl.value;
  const domain = lawSelVal === 'glossary' ? 'glossary' : lawSelVal === 'assistants' ? 'assistants' : lawSelVal === 'fcf' ? 'fcf' : 'law';
  const selectedNum = domain === 'law' ? parseInt(lawSelVal,10) : null;
  const question = document.getElementById('f-question').value.trim();
  const a = document.getElementById('f-a').value.trim();
  const b = document.getElementById('f-b').value.trim();
  const c = document.getElementById('f-c').value.trim();
  const d = document.getElementById('f-d').value.trim();
  const correct = (document.querySelector('input[name="f-correct"]:checked') || {}).value || 'a';
  const explanation = document.getElementById('f-explanation').value.trim();
  const difficulty = document.getElementById('f-hard').checked ? 'hard' : 'normal';
  if(!question || !a || !b || !c || !d){ STATE.toast='Rellena la pregunta y las 4 respuestas (a, b, c y d).'; render(); return; }

  const saved = persistNewQuestion({ domain, rule: selectedNum, question, options: [a,b,c,d], correct, explanation, difficulty });
  if(!saved.ok){ STATE.toast = saved.msg; render(); return; }

  if(sharedActive()){
    // Banco compartido: la pregunta la ven todos los usuarios.
    if(domain==='glossary'){ STATE.toast='Pregunta guardada en el Glosario para todos los usuarios.'; if(!STATE.cameFromDb){ STATE.lawId='glossary'; STATE.view='law'; } }
    else if(domain==='assistants'){ STATE.toast='Pregunta guardada en Árbitros Asistentes para todos los usuarios.'; if(!STATE.cameFromDb){ STATE.lawId='assistants'; STATE.view='law'; } }
    else if(domain==='fcf'){ STATE.toast='Pregunta guardada en Reglament General FCF. Solo se ve en la Base de datos y en los tests del comité.'; STATE.cameFromDb = true; }
    else { STATE.toast='Pregunta guardada en la Regla '+selectedNum+' para todos los usuarios.'; if(!STATE.cameFromDb){ STATE.lawId=selectedNum; STATE.view='law'; } }
    if(STATE.cameFromDb){ STATE.view='database'; }
  } else if(domain==='glossary'){
    STATE.toast='Pregunta guardada en el Glosario.';
    if(STATE.cameFromDb){ STATE.view='database'; }
    else { STATE.lawId = 'glossary'; STATE.view='law'; }
  } else {
    STATE.toast='Pregunta guardada en la Regla '+selectedNum+'.';
    if(STATE.cameFromDb){ STATE.view='database'; }
    else { STATE.lawId = selectedNum; STATE.view='law'; }
  }
  render();
}

function statsView(){
  const ic = (n) => shellIcon(n);
  const os = overallStats();
  const hist = STATE.storage.testHistory || [];
  const streak = computeStreak();
  const rp = recentPerformance(20);
  const failedCount = allQuestions().filter(isFailedQuestion).length;
  const tone = (p) => p >= 80 ? 'good' : p >= 60 ? 'mid' : 'bad';

  const laws = [];
  for(let i=1;i<=17;i++) laws.push({ n:i, s:lawStats(i) });
  const ranked = laws.filter(l => l.s.attempted >= 3);
  const weak = ranked.slice().sort((a,b) => a.s.accuracyPct - b.s.accuracyPct).slice(0,3);
  let strong = ranked.slice().sort((a,b) => b.s.accuracyPct - a.s.accuracyPct).slice(0,3);
  if(ranked.length < 6) strong = strong.filter(l => !weak.includes(l));

  const rows = laws.map(l => `
    <button class="st-rule" data-action="open-law" data-law="${l.n}">
      <span class="st-rule-n">${l.n}</span>
      <span class="st-rule-main">
        <span class="st-rule-name">${esc(LAW_NAMES[l.n])}</span>
        <span class="st-rule-bar"><i style="width:${l.s.completionPct}%"></i></span>
      </span>
      <span class="st-rule-pct">${l.s.completionPct}%</span>
      <span class="st-acc ${l.s.attempted>0 ? tone(l.s.accuracyPct) : 'none'}">${l.s.attempted>0 ? l.s.accuracyPct + '%' : '—'}</span>
    </button>`).join('');

  const pill = (l) => `<button class="st-pill ${tone(l.s.accuracyPct)}" data-action="open-law" data-law="${l.n}"><b>R${l.n}</b><span>${esc(LAW_NAMES[l.n])}</span><em>${l.s.accuracyPct}%</em></button>`;

  const MODE = { short:'Test rápido', study25:'Modo estudio', training:'Examen personalizado', hearts:'Corazones', suddendeath:'Muerte Súbita', timeattack:'Contrarreloj', review:'Revisión' };
  const lastBars = hist.slice(-14);
  const bars = lastBars.map(h => `<div class="st-bar" title="${new Date(h.date).toLocaleDateString('es-ES')} · ${h.pct}%"><i class="${tone(h.pct)}" style="height:${Math.max(6, h.pct)}%"></i><span>${h.pct}</span></div>`).join('');
  const recent = hist.slice(-5).reverse().map(h => `
    <div class="st-test">
      <span class="st-test-date">${new Date(h.date).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit' })}</span>
      <span class="st-test-mode">${esc(MODE[h.mode] || 'Test')}</span>
      <span class="st-test-score">${h.score}/${h.total}</span>
      <span class="st-acc ${tone(h.pct)}">${h.pct}%</span>
    </div>`).join('');

  const days = [];
  for(let k = 13; k >= 0; k--){
    const ts = Date.now() - k * 86400000;
    days.push({ on: !!(STATE.storage.activeDays || {})[dayKey(ts)], label: new Date(ts).toLocaleDateString('es-ES', { weekday:'narrow' }).toUpperCase(), today: k === 0 });
  }
  const activeCount = days.filter(d => d.on).length;

  const kpi = (icon, val, label, sub) => `<div class="lg-sum"><span class="lg-sum-ic">${ic(icon)}</span><div><b>${val}</b><small>${label}${sub ? ' · ' + sub : ''}</small></div></div>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Tu rendimiento</div>
      <h1>Estadísticas</h1>
      <p>Mira cómo avanzas regla a regla, tu evolución en los últimos tests y dónde te conviene reforzar.</p>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${os.completionPct}%</b><span>Progreso</span></div>
      <div class="lg-stat"><b>${os.attempted>0 ? os.accuracyPct + '%' : '—'}</b><span>Acierto</span></div>
      <div class="lg-stat"><b>${streak}</b><span>${streak === 1 ? 'Día de racha' : 'Días de racha'}</span></div>
    </div>
  </section>

  <div class="st-kpis">
    ${kpi('check', todaysAnsweredCount(), 'Respondidas hoy')}
    ${kpi('book', hist.length, hist.length === 1 ? 'Test realizado' : 'Tests realizados')}
    ${kpi('target', rp ? rp.pct + '%' : '—', 'Acierto reciente', rp ? 'últimos ' + rp.count : '')}
    ${kpi('repeat', failedCount, 'Falladas por repasar')}
  </div>

  <div class="st-layout">
    <div class="st-main">
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('book')}</span><div><h3>Rendimiento por regla</h3><small>Progreso completado y porcentaje de acierto · pulsa una regla para practicarla</small></div></div>
        <div class="st-legend"><span><i class="good"></i> 80% o más</span><span><i class="mid"></i> 60–79%</span><span><i class="bad"></i> menos de 60%</span></div>
        <div class="st-rules">${rows}</div>
      </div>
    </div>

    <aside class="st-side">
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('chart')}</span><div><h3>Últimos tests</h3><small>${hist.length ? 'Tu acierto en los últimos ' + lastBars.length : 'Todavía sin datos'}</small></div></div>
        ${hist.length ? `<div class="st-bars">${bars}</div><div class="st-tests">${recent}</div>` : `<div class="st-note">Completa tu primer test para ver aquí tu evolución.</div>`}
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('flame')}</span><div><h3>Constancia</h3><small>${activeCount} de los últimos 14 días con actividad</small></div></div>
        <div class="st-days">${days.map(d => `<div class="st-day ${d.on ? 'on' : ''} ${d.today ? 'today' : ''}"><i></i><span>${d.label}</span></div>`).join('')}</div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('zap')}</span><div><h3>Qué reforzar</h3><small>Entre las reglas que ya has practicado</small></div></div>
        ${ranked.length ? `
          <div class="st-sub">A reforzar</div>${weak.map(pill).join('')}
          ${strong.length ? `<div class="st-sub">Tus puntos fuertes</div>${strong.map(pill).join('')}` : ''}
        ` : `<div class="st-note">Responde algunas preguntas de cada regla y aquí verás cuáles dominas y cuáles reforzar.</div>`}
      </div>
    </aside>
  </div>
  `;
}

/* La librería de Excel pesa unos 900 KB y solo hace falta al exportar o importar: se descarga entonces,
   no al abrir la app (así la web carga mucho más rápido en el móvil). */
let XLSX_LOADING = null;
function ensureXLSX(){
  if(typeof XLSX !== 'undefined') return Promise.resolve(true);
  if(XLSX_LOADING) return XLSX_LOADING;
  XLSX_LOADING = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '/assets/js/vendor/xlsx-0.18.5.full.min.js';
    s.integrity = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(typeof XLSX !== 'undefined');
    s.onerror = () => { XLSX_LOADING = null; resolve(false); };
    document.head.appendChild(s);
  });
  return XLSX_LOADING;
}

async function exportExcel(){
  if(!(await ensureXLSX())){ STATE.toast = 'No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'; render(); return; }
  const rows = allQuestionsAdmin().map((q,i) => ({
    'Número': questionNumber(q, i+1),
    'ID': q.id,
    'Ámbito': q.domain==='glossary' ? 'Glosario' : q.domain==='assistants' ? 'Asistentes' : q.domain==='fcf' ? 'FCF' : q.rule,
    'Pregunta': q.question,
    'Opción A': q.options[0]||'',
    'Opción B': q.options[1]||'',
    'Opción C': q.options[2]||'',
    'Opción D': q.options[3]||'',
    'Correcta (a/b/c/d)': q.correct,
    'Explicación': q.explanation||'',
    'Difícil (SI/NO)': q.difficulty==='hard' ? 'SI' : 'NO',
    'Retirada del juego (SI/NO)': q.draft ? 'SI' : 'NO'
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:8},{wch:10},{wch:10},{wch:50},{wch:28},{wch:28},{wch:28},{wch:28},{wch:10},{wch:40},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Preguntas');
  const infoWs = XLSX.utils.aoa_to_sheet([
    ['Cómo usar este archivo'],
    ['- La columna "Número" es solo de referencia (la misma que ves en Base de datos como #123 en la app); no hace falta rellenarla en filas nuevas.'],
    ['- Deja la columna ID tal cual para EDITAR una pregunta existente.'],
    ['- Borra el ID (déjalo vacío) en una fila nueva para AÑADIR una pregunta.'],
    ['- En "Ámbito" pon el número de regla (1-17), Glosario o FCF (Reglament General FCF).'],
    ['- Las 4 opciones (A, B, C y D) son obligatorias en cada pregunta.'],
    ['- En "Correcta" pon solo la letra: a, b, c o d.'],
    ['- No borres filas para eliminar preguntas: usa el botón Eliminar en la app.'],
    ['- Cuando termines, guarda el archivo y súbelo con "Importar desde Excel".']
  ]);
  infoWs['!cols'] = [{wch:70}];
  XLSX.utils.book_append_sheet(wb, infoWs, 'Instrucciones');
  XLSX.writeFile(wb, 'weref_base_de_datos.xlsx');
}

async function importExcelFile(file){
  if(!(await ensureXLSX())){ STATE.toast = 'No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'; render(); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      let updated = 0, added = 0, skipped = 0, duplicates = 0;
      const sharedRows = [];
      const seenKeys = new Set(allQuestionsAdmin().map(q => questionDedupeKey(q)));
      rows.forEach(row => {
        const id = String(row['ID']||'').trim();
        const ambito = String(row['Ámbito']||'').trim();
        const question = String(row['Pregunta']||'').trim();
        const a = String(row['Opción A']||'').trim();
        const b = String(row['Opción B']||'').trim();
        const c = String(row['Opción C']||'').trim();
        const d = String(row['Opción D']||'').trim();
        const correct = String(row['Correcta (a/b/c/d)']||'').trim().toLowerCase();
        const explanation = String(row['Explicación']||'').trim();
        const difficulty = String(row['Difícil (SI/NO)']||'').trim().toUpperCase()==='SI' ? 'hard' : 'normal';
        const isAssistWord = ambito.toLowerCase().startsWith('asis');
        const isAssist = false;   // esa sala ya no existe: lo que venga como Asistentes va a la Regla 6
        const isFcf = ambito.toLowerCase().startsWith('fcf') || ambito.toLowerCase().startsWith('reglament');
        const isGlossary = ambito.toLowerCase().startsWith('glos') || isAssist || isFcf;
        const rule = isGlossary ? null : (isAssistWord ? 6 : parseInt(ambito,10));

        if(!question || !a || !b || !c || !d || !['a','b','c','d'].includes(correct)){ skipped++; return; }
        if(!isGlossary && (!rule || rule<1 || rule>17)){ skipped++; return; }

        if(id){
          const exists = allQuestionsAdmin().find(q=>q.id===id);
          if(!exists){ skipped++; return; }
          const edit = isGlossary
            ? { question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() }
            : { rule, question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() };
          if(sharedActive()) sharedRows.push(sharedRowFor(id, exists.domain, edit, exists.createdAt));
          else STATE.storage.edits[id] = edit;
          updated++;
        } else {
          if((isAssist || isFcf) && !sharedActive()){ skipped++; return; }
          const dedupeKey = questionDedupeKey({ question, options:[a,b,c,d] });
          if(seenKeys.has(dedupeKey)){ duplicates++; return; }
          seenKeys.add(dedupeKey);
          if(sharedActive()){
            const dom = isFcf ? 'fcf' : isAssist ? 'assistants' : isGlossary ? 'glossary' : 'law';
            const nid = (isFcf ? 'F' : isAssist ? 'S' : isGlossary ? 'G' : 'U') + Math.random().toString(36).slice(2,9);
            sharedRows.push(sharedRowFor(nid, dom, { rule, question, options:[a,b,c,d], correct, explanation, difficulty }, Date.now()));
          } else if(isGlossary){
            STATE.storage.glossaryQuestions.push({ domain:'glossary', rule:null, num:'X'+Math.random().toString(36).slice(2,9), question, options:[a,b,c,d], correct, explanation, difficulty, id:'G'+Math.random().toString(36).slice(2,9), source:'user', createdAt: Date.now() });
          } else {
            STATE.storage.userQuestions.push({ domain:'law', rule, num:'X'+Math.random().toString(36).slice(2,9), question, options:[a,b,c,d], correct, explanation, difficulty, id:'U'+Math.random().toString(36).slice(2,9), source:'user', createdAt: Date.now() });
          }
          added++;
        }
      });
      if(sharedRows.length) sharedSave(sharedRows);
      saveEdits(); saveUserQuestions(); saveGlossaryQuestions();
      STATE.toast = `Importado: ${added} añadidas, ${updated} actualizadas, ${duplicates} omitidas por estar duplicadas, ${skipped} omitidas por datos incompletos.`;
      STATE.dbFilter.page = 1;
      render();
    }catch(err){
      STATE.toast = 'No se pudo leer el archivo. Asegúrate de que es el Excel exportado desde aquí.';
      render();
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ---------------- EVENTS ---------------- */
function bindEvents(){
  document.querySelectorAll('[data-action]').forEach(el=>{
    el.addEventListener('click', onAction);
  });
  const importExcelInput = document.getElementById('import-excel-file');
  if(importExcelInput){ importExcelInput.addEventListener('change', (e)=>{ if(e.target.files[0]) importExcelFile(e.target.files[0]); }); }

  const suggestMessage = document.getElementById('suggest-message');
  if(suggestMessage){
    const autoGrow = () => { suggestMessage.style.height = 'auto'; suggestMessage.style.height = suggestMessage.scrollHeight + 'px'; };
    autoGrow();
    const sgCount = document.getElementById('suggest-count');
    suggestMessage.addEventListener('input', () => { autoGrow(); if(sgCount) sgCount.textContent = suggestMessage.value.length; });
  }

  const mybankSearch = document.getElementById('mybank-search');
  if(mybankSearch){ mybankSearch.addEventListener('input', (e)=>{ STATE.myBankSearch = e.target.value; render(); }); }


  const mydocsSearch = document.getElementById('mydocs-search');
  if(mydocsSearch){ mydocsSearch.addEventListener('input', (e)=>{ STATE.myDocsSearch = e.target.value; render(); }); }
  const mydocsUploadInput = document.getElementById('mydocs-upload-input');
  if(mydocsUploadInput){ mydocsUploadInput.addEventListener('change', (e)=>{ if(e.target.files[0]) uploadMyDoc(e.target.files[0]); }); }
  const mydocsDropzone = document.getElementById('mydocs-dropzone');
  if(mydocsDropzone){
    mydocsDropzone.addEventListener('dragover', (e)=>{ e.preventDefault(); mydocsDropzone.classList.add('drag-over'); });
    mydocsDropzone.addEventListener('dragleave', (e)=>{ if(!mydocsDropzone.contains(e.relatedTarget)) mydocsDropzone.classList.remove('drag-over'); });
    mydocsDropzone.addEventListener('drop', (e)=>{
      e.preventDefault();
      mydocsDropzone.classList.remove('drag-over');
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      files.reduce((p, file) => p.then(()=>uploadMyDoc(file)), Promise.resolve());
    });
  }
  if(STATE.myDocsMovingId){
    const moveSelect = document.getElementById('mydocs-move-select-'+STATE.myDocsMovingId);
    if(moveSelect){ moveSelect.addEventListener('change', (e)=>{ moveMyDoc(STATE.myDocsMovingId, e.target.value || null); }); }
  }

  const dbSearch = document.getElementById('db-search');
  if(dbSearch){ dbSearch.addEventListener('input', (e)=>{ STATE.dbFilter.search = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbLaw = document.getElementById('db-law');
  if(dbLaw){ dbLaw.addEventListener('change', (e)=>{ STATE.dbFilter.law = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbDifficulty = document.getElementById('db-difficulty');
  if(dbDifficulty){ dbDifficulty.addEventListener('change', (e)=>{ STATE.dbFilter.difficulty = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbReportedOnly = document.getElementById('db-reported-only');
  if(dbReportedOnly){ dbReportedOnly.addEventListener('change', (e)=>{ STATE.dbFilter.reportedOnly = e.target.checked; STATE.dbFilter.page = 1; render(); }); }
  const dbDuplicatesOnly = document.getElementById('db-duplicates-only');
  if(dbDuplicatesOnly){ dbDuplicatesOnly.addEventListener('change', (e)=>{ STATE.dbFilter.duplicatesOnly = e.target.checked; STATE.dbFilter.page = 1; render(); }); }
  const dbReviewStatus = document.getElementById('db-review-status');
  if(dbReviewStatus){ dbReviewStatus.addEventListener('change', (e)=>{ STATE.dbFilter.reviewStatus = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbPageSize = document.getElementById('db-page-size');
  if(dbPageSize){ dbPageSize.addEventListener('change', (e)=>{ STATE.dbFilter.pageSize = parseInt(e.target.value, 10) || 25; STATE.dbFilter.page = 1; render(); }); }
  const dbAdv = document.querySelector('.db-adv');
  if(dbAdv){ dbAdv.addEventListener('toggle', () => { STATE.dbFilter.advOpen = dbAdv.open; }); }
  const dailyGoalSelect = document.getElementById('daily-goal-select');
  if(dailyGoalSelect){ dailyGoalSelect.addEventListener('change', (e)=>{ STATE.storage.dailyGoal = parseInt(e.target.value,10); saveDailyGoal(); render(); }); }

  const adminUsersSearch = document.getElementById('admin-users-search');
  if(adminUsersSearch){
    adminUsersSearch.addEventListener('input', (e)=>{
      const value = e.target.value;
      clearTimeout(ADMIN_USERS_SEARCH_DEBOUNCE);
      ADMIN_USERS_SEARCH_DEBOUNCE = setTimeout(()=>{ STATE.adminUsersFilter.search = value; loadAdminStats(1); }, 400);
    });
  }
  const adminUsersStatus = document.getElementById('admin-users-status');
  if(adminUsersStatus){ adminUsersStatus.addEventListener('change', (e)=>{ STATE.adminUsersFilter.status = e.target.value; loadAdminStats(1); }); }
  const adminUsersRole = document.getElementById('admin-users-role');
  if(adminUsersRole){ adminUsersRole.addEventListener('change', (e)=>{ STATE.adminUsersFilter.role = e.target.value; loadAdminStats(1); }); }
}

function onAction(e){
  const el = e.currentTarget;
  const action = el.dataset.action;
  const rawLaw = el.dataset.law;
  const law = rawLaw ? ((rawLaw==='hard' || rawLaw==='failed' || rawLaw==='glossary' || rawLaw==='assistants' || rawLaw==='saved' || /^fed-\d+$/.test(rawLaw)) ? rawLaw : parseInt(rawLaw,10)) : null;

  if(typeof action==='string' && action.startsWith('ph-') && typeof phAction==='function'){ phAction(action, el); return; }
  if(typeof action==='string' && action.startsWith('gami-') && typeof gamiAction==='function'){ gamiAction(action, el); return; }
  if(typeof action==='string' && action.startsWith('committee-') && typeof committeeOnAction==='function'){ committeeOnAction(action, el); return; }

  if(action==='logout'){ stopTimer(); if(typeof handleLogout==='function') handleLogout(); }
  else if(action==='home'){ stopTimer(); STATE.view='home'; render(); }
  else if(action==='home-filter'){ STATE.homeFilter = el.dataset.filter || 'all'; render(); }
  else if(action==='menu'){ STATE.view='menu'; render(); }
  else if(action==='open-law'){ STATE.lawId=law; STATE.view='law'; render(); }
  else if(action==='start-quiz'){ startQuiz(law, el.dataset.mode); }
  else if(action==='train-config'){ STATE.trainCfg.scopeOverride = null; STATE.ctFrom = null; STATE.view='trainConfig'; render(); window.scrollTo(0,0); }
  else if(action==='train-config-scoped'){
    /* Una regla (o el Glosario) abre el MISMO configurador con esa regla marcada; las salas especiales conservan su ámbito. */
    const cfg = STATE.trainCfg;
    if(typeof law === 'number' || law === 'glossary'){ cfg.scopeOverride = null; cfg.laws = [law]; cfg.onlyFailed = false; STATE.ctFrom = law; }
    else { cfg.scopeOverride = law; STATE.ctFrom = null; }
    STATE.view='trainConfig'; render(); window.scrollTo(0,0);
  }
  else if(action==='ct-count'){ STATE.trainCfg.count = parseInt(el.dataset.v,10); STATE.trainCfg.countOther = false; render(); }
  else if(action==='ct-count-other'){ STATE.trainCfg.countOther = true; render(); const i = document.getElementById('cfg-count'); if(i){ i.focus(); i.select(); } }
  else if(action==='ct-min'){ STATE.trainCfg.minutes = parseInt(el.dataset.v,10); STATE.trainCfg.minOther = false; render(); }
  else if(action==='ct-min-other'){ STATE.trainCfg.minOther = true; render(); const i = document.getElementById('cfg-minutes'); if(i){ i.focus(); i.select(); } }
  else if(action==='ct-sec'){ STATE.trainCfg.secondsPerQuestion = parseInt(el.dataset.v,10); STATE.trainCfg.secOther = false; render(); }
  else if(action==='ct-sec-other'){ STATE.trainCfg.secOther = true; render(); const i = document.getElementById('cfg-seconds-per-q'); if(i){ i.focus(); i.select(); } }
  else if(action==='ct-failed'){ STATE.trainCfg.onlyFailed = !STATE.trainCfg.onlyFailed; render(); }
  else if(action==='ct-sel'){
    const cfg = STATE.trainCfg, sel = el.dataset.sel;
    const sets = ctSelSets();
    cfg.laws = sel === 'none' ? [] : (sets[sel] || ctAllLaws()).slice();
    render();
  }
  else if(action==='law-menu'){
    STATE.lawMenuOpen = !STATE.lawMenuOpen; render();
    if(STATE.lawMenuOpen){ setTimeout(() => document.addEventListener('click', function closeLawMenu(){ if(STATE.lawMenuOpen){ STATE.lawMenuOpen = false; render(); } }, { once: true }), 0); }
  }
  else if(action==='start-rule-failed'){
    STATE.lawMenuOpen = false;
    startTraining({ count: MAX_TEST_QUESTIONS, timerMode: 'none', laws: [law], onlyFailed: true, instantFeedback: true });
  }
  else if(action==='set-timer-mode'){ STATE.trainCfg.timerMode = el.dataset.mode; render(); }
  else if(action==='set-feedback-mode'){ STATE.trainCfg.feedbackMode = el.dataset.fbmode; render(); }
  else if(action==='toggle-train-law'){
    const val = el.dataset.law;
    const num = (val==='glossary') ? val : parseInt(val,10);
    const idx = STATE.trainCfg.laws.indexOf(num);
    if(idx>=0) STATE.trainCfg.laws.splice(idx,1); else STATE.trainCfg.laws.push(num);
    render();
  }
  else if(action==='generate-exam'){
    const cfg = STATE.trainCfg;
    const rd = (id) => { const e = document.getElementById(id); return e ? parseInt(e.value,10) : NaN; };
    const countVal = rd('cfg-count'); if(!isNaN(countVal)) cfg.count = countVal;
    cfg.count = Math.min(MAX_TEST_QUESTIONS, Math.max(1, cfg.count || 20));
    if(cfg.timerMode==='total'){ const m = rd('cfg-minutes'); if(!isNaN(m)) cfg.minutes = m; }
    if(cfg.timerMode==='perQuestion'){ const sec = rd('cfg-seconds-per-q'); if(!isNaN(sec)) cfg.secondsPerQuestion = sec; cfg.secondsPerQuestion = Math.min(120, Math.max(5, cfg.secondsPerQuestion || 45)); }
    if(!ctPool(cfg).length){ STATE.toast = cfg.laws.length || cfg.scopeOverride ? 'No hay preguntas con estos filtros.' : 'Selecciona al menos una regla.'; render(); return; }
    startTraining({
      count: cfg.count,
      timerMode: cfg.timerMode,
      minutes: cfg.minutes,
      secondsPerQuestion: cfg.secondsPerQuestion,
      laws: cfg.laws,
      scopeOverride: cfg.scopeOverride,
      onlyFailed: !!cfg.onlyFailed,
      instantFeedback: cfg.feedbackMode === 'study'
    });
  }
  else if(action==='answer'){ selectAnswer(el.dataset.letter); }
  else if(action==='next-question'){ nextQuestion(); }
  else if(action==='prev-question'){ goToQuestion(STATE.quiz.idx-1); }
  else if(action==='goto-question'){ goToQuestion(parseInt(el.dataset.idx,10)); }
  else if(action==='toggle-review-detail'){
    const idx = parseInt(el.dataset.idx,10);
    STATE.reviewDetailIdx = (STATE.reviewDetailIdx === idx) ? null : idx;
    render();
  }
  else if(action==='finish-training'){ finishTrainingConfirm(); }
  else if(action==='quit-quiz'){ STATE.confirmQuit = 'quiz'; render(); }
  else if(action==='quit-cancel'){ STATE.confirmQuit = null; render(); }
  else if(action==='quit-confirm'){
    const kind = STATE.confirmQuit;
    STATE.confirmQuit = null;
    if(kind === 'mybank'){ myBankStopTimer(); STATE.view='myBank'; render(); return; }
    stopTimer();
    const qz = STATE.quiz;
    // Vuelve a la pantalla desde la que se empezó el test, no siempre al inicio.
    if(qz && qz.mode==='training'){ STATE.view='trainConfig'; }
    else if(qz && ['hearts','suddendeath','timeattack'].includes(qz.mode)){ setLeagueMode(qz.mode); STATE.view='dailyChallenge'; loadLeagueBoard(qz.mode); return; }
    else if(qz && qz.law!=null && qz.law!==''){ STATE.lawId=qz.law; STATE.view='law'; }
    else { STATE.view='home'; }
    render();
  }
  else if(action==='add'){ STATE.cameFromDb = false; STATE.lawId = law || STATE.lawId; STATE.view='add'; render(); }
  else if(action==='add-from-db'){
    STATE.cameFromDb = true;
    const currentLaw = STATE.dbFilter.law;
    STATE.lawId = (currentLaw==='glossary' || currentLaw==='assistants' || currentLaw==='fcf') ? currentLaw : (/^\d+$/.test(currentLaw) ? parseInt(currentLaw,10) : null);
    STATE.view='add'; render();
  }
  else if(action==='save-question'){ saveNewQuestion(); }
  else if(action==='stats'){ STATE.view='stats'; render(); }
  else if(action==='database'){ if(!isDevUser()) return; STATE.editingId=null; STATE.dbListMode=false; STATE.view='database'; loadQuestionReports(); render(); }
  else if(action==='db-view-law-questions'){
    if(!isDevUser()) return;
    { const rawL = el.dataset.law; STATE.dbFilter.law = (rawL === 'all' || String(STATE.dbFilter.law) === rawL) ? 'all' : String(rawL); }
    STATE.dbFilter.page = 1;
    STATE.editingId = null;
    STATE.view = 'database';
    loadQuestionReports();
    render();
  }
  else if(action==='report-question'){ reportQuestionDialog(el.dataset.qid); }
  else if(action==='dismiss-reports'){ if(!isDevUser()) return; dismissReports(el.dataset.qid); }
  else if(action==='profile-nudge-close'){ dismissProfileNudge(); }
  else if(action==='achievements'){ STATE.view='achievements'; if(typeof loadGami==='function') loadGami(); render(); }
  else if(action==='profile'){ STATE.view='profile'; STATE.profileData=null; render(); loadProfileData(); loadMfaState(); }
  else if(action==='mfa-start'){ mfaStartEnroll(); }
  else if(action==='mfa-verify'){ mfaVerifyEnroll(); }
  else if(action==='mfa-cancel'){ mfaCancelEnroll(); }
  else if(action==='mfa-disable'){ mfaDisable(el.dataset.factor); }
  else if(action==='profile-edit'){ STATE.view='profileEdit'; render(); }
  else if(action==='profile-save-edit'){ saveProfileEdit(); }
  else if(action==='streak-calendar'){ STATE.calendarYear = null; STATE.view='streakCalendar'; render(); }
  else if(action==='recent-performance'){ STATE.view='recentPerformance'; render(); }
  else if(action==='perf-sort'){ STATE.perfSort = el.dataset.sort; render(); }
  else if(action==='sug-filter'){ STATE.sugFilter = el.dataset.filter; render(); }
  else if(action==='calendar-year'){
    const current = STATE.calendarYear || new Date().getFullYear();
    const next = current + parseInt(el.dataset.delta,10);
    STATE.calendarYear = Math.max(2025, next);
    render();
  }
  else if(action==='calendar-add-event'){ STATE.calendarAddingEvent = true; render(); }
  else if(action==='calendar-cancel-event'){ STATE.calendarAddingEvent = false; render(); }
  else if(action==='calendar-save-event'){ calendarSaveEvent(); }
  else if(action==='calendar-delete-event'){ calendarDeleteEvent(el.dataset.id); }
  else if(action==='dailyChallenge'){ STATE.view='dailyChallenge'; loadLeagueBoard(leagueMode()); }
  else if(action==='leaderboard'){ STATE.view='leaderboard'; loadLeagueBoard(leagueMode()); setTimeout(() => { const b = document.getElementById('lg2-board'); if(b && b.scrollIntoView) b.scrollIntoView({ block: 'start' }); }, 60); }
  else if(action==='league-mode' || action==='leaderboard-tab'){ setLeagueMode(el.dataset.mode); loadLeagueBoard(leagueMode()); }
  else if(action==='league-reload'){ loadLeagueBoard(leagueMode()); }
  else if(action==='lg-pod'){ el.classList.toggle('open'); }
  else if(action==='academia'){ STATE.view='academia'; render(); }
  else if(action==='mybank'){ STATE.myBankEditingId=null; STATE.myBankViewCategory=null; STATE.myBankCreatingCategory=false; STATE.myBankSearch=''; STATE.view='myBank'; render(); }
  else if(action==='mybank-new-category'){ STATE.myBankCreatingCategory=true; render(); }
  else if(action==='mybank-cancel-category'){ STATE.myBankCreatingCategory=false; render(); }
  else if(action==='mybank-save-category'){ myBankAddCategory(); }
  else if(action==='mybank-open-category'){ STATE.myBankViewCategory=el.dataset.category; STATE.myBankSearch=''; STATE.view='myBankCategory'; render(); }
  else if(action==='mybank-open-category-back'){ STATE.view='myBankCategory'; render(); }
  else if(action==='mybank-delete-category'){ STATE.confirmDeleteMyBankCategory = el.dataset.category; render(); }
  else if(action==='mybank-cancel-delete-category'){ STATE.confirmDeleteMyBankCategory = null; render(); }
  else if(action==='mybank-confirm-delete-category'){
    myBankDeleteCategory(STATE.confirmDeleteMyBankCategory);
    STATE.confirmDeleteMyBankCategory = null;
  }
  else if(action==='mybank-add'){ STATE.myBankEditingId=null; STATE.myBankOptionCount=null; STATE.myBankFormDraft=null; STATE.view='myBankForm'; render(); }
  else if(action==='mybank-edit'){ STATE.myBankEditingId=el.dataset.qid; STATE.myBankOptionCount=null; STATE.myBankFormDraft=null; STATE.view='myBankForm'; render(); }
  else if(action==='mybank-delete'){ STATE.confirmDeleteMyBankId = el.dataset.qid; render(); }
  else if(action==='mybank-cancel-delete'){ STATE.confirmDeleteMyBankId = null; render(); }
  else if(action==='mybank-confirm-delete'){
    STATE.storage.myBank = (STATE.storage.myBank||[]).filter(q=>q.id!==STATE.confirmDeleteMyBankId);
    STATE.confirmDeleteMyBankId = null;
    saveMyBank();
    render();
  }
  else if(action==='mybank-save'){ saveMyBankQuestion(el.dataset.qid || null); }
  else if(action==='mybank-train-config'){ STATE.view='myBankTrainConfig'; render(); }
  else if(action==='mybank-toggle-train-category'){
    const val = el.dataset.category;
    if(val==='all'){ STATE.myBankTrainCfg.categories = []; }
    else {
      const idx = STATE.myBankTrainCfg.categories.indexOf(val);
      if(idx>=0) STATE.myBankTrainCfg.categories.splice(idx,1); else STATE.myBankTrainCfg.categories.push(val);
    }
    render();
  }
  else if(action==='mybank-set-timer-mode'){ STATE.myBankTrainCfg.timerMode = el.dataset.mode; render(); }
  else if(action==='mybank-set-feedback-mode'){ STATE.myBankTrainCfg.feedbackMode = el.dataset.fbmode; render(); }
  else if(action==='mybank-generate-exam'){
    const countVal = parseInt(document.getElementById('mybank-cfg-count').value,10);
    STATE.myBankTrainCfg.count = Math.min(50, Math.max(1, isNaN(countVal) ? 20 : countVal));
    if(STATE.myBankTrainCfg.timerMode==='total'){
      const minutesVal = parseInt(document.getElementById('mybank-cfg-minutes').value,10);
      STATE.myBankTrainCfg.minutes = isNaN(minutesVal) ? 0 : minutesVal;
    }
    if(STATE.myBankTrainCfg.timerMode==='perQuestion'){
      const secVal = parseInt(document.getElementById('mybank-cfg-seconds-per-q').value,10);
      STATE.myBankTrainCfg.secondsPerQuestion = isNaN(secVal) ? 45 : secVal;
    }
    startMyBankTraining({
      count: STATE.myBankTrainCfg.count,
      timerMode: STATE.myBankTrainCfg.timerMode,
      minutes: STATE.myBankTrainCfg.minutes,
      secondsPerQuestion: STATE.myBankTrainCfg.secondsPerQuestion,
      categories: STATE.myBankTrainCfg.categories,
      instantFeedback: STATE.myBankTrainCfg.feedbackMode === 'study'
    });
  }
  else if(action==='mybank-answer'){ myBankSelectAnswer(el.dataset.letter); }
  else if(action==='mybank-prev'){ myBankGoToQuestion(STATE.myBankQuiz.idx-1); }
  else if(action==='mybank-advance'){ myBankAdvance(); }
  else if(action==='mybank-advance-nav'){ myBankGoToQuestion(STATE.myBankQuiz.idx+1); }
  else if(action==='mybank-finish'){ myBankFinish(); }
  else if(action==='mybank-quit'){ STATE.confirmQuit = 'mybank'; render(); }
  else if(action==='mydocs-home'){ STATE.myDocsCurrentFolder=null; STATE.myDocsSearch=''; STATE.myDocsCreatingFolder=false; STATE.view='myDocs'; render(); }
  else if(action==='mydocs'){ STATE.view='myDocs'; render(); }
  else if(action==='mydocs-open-folder'){ STATE.myDocsCurrentFolder = el.dataset.folder || null; STATE.myDocsSearch=''; render(); }
  else if(action==='mydocs-new-folder'){ STATE.myDocsCreatingFolder=true; render(); }
  else if(action==='mydocs-cancel-folder'){ STATE.myDocsCreatingFolder=false; render(); }
  else if(action==='mydocs-save-folder'){ myDocsAddFolder(); }
  else if(action==='mydocs-delete-folder'){ STATE.confirmDeleteMyDocFolderId = el.dataset.folder; render(); }
  else if(action==='mydocs-cancel-delete-folder'){ STATE.confirmDeleteMyDocFolderId = null; render(); }
  else if(action==='mydocs-confirm-delete-folder'){
    const id = STATE.confirmDeleteMyDocFolderId;
    STATE.confirmDeleteMyDocFolderId = null;
    myDocsDeleteFolder(id);
  }
  else if(action==='mydocs-rename-folder'){ STATE.myDocsRenamingFolderId = el.dataset.folder; STATE.myDocsMovingFolderId = null; render(); }
  else if(action==='mydocs-cancel-rename-folder'){ STATE.myDocsRenamingFolderId = null; render(); }
  else if(action==='mydocs-save-rename-folder'){ myDocsRenameFolder(el.dataset.folder); }
  else if(action==='mydocs-move-folder'){ STATE.myDocsMovingFolderId = el.dataset.folder; STATE.myDocsRenamingFolderId = null; render(); }
  else if(action==='mydocs-cancel-move-folder'){ STATE.myDocsMovingFolderId = null; render(); }
  else if(action==='mydocs-confirm-move-folder'){
    const id = el.dataset.folder;
    const select = document.getElementById('mydocs-move-folder-select-'+id);
    myDocsMoveFolder(id, select ? select.value : '');
  }
  else if(action==='mydocs-set-sort'){ STATE.myDocsSortBy = el.dataset.sort; render(); }
  else if(action==='mydocs-move'){ STATE.myDocsMovingId = el.dataset.id; render(); }
  else if(action==='mydocs-preview'){ myDocsPreview(el.dataset.id); }
  else if(action==='mydocs-edit-notes'){ STATE.myDocsEditingNotesId = el.dataset.id; render(); }
  else if(action==='mydocs-cancel-notes'){ STATE.myDocsEditingNotesId = null; render(); }
  else if(action==='mydocs-save-notes'){ saveMyDocNotes(el.dataset.id); }
  else if(action==='mydocs-delete'){ STATE.confirmDeleteMyDocId = el.dataset.id; render(); }
  else if(action==='mydocs-cancel-delete'){ STATE.confirmDeleteMyDocId = null; render(); }
  else if(action==='mydocs-confirm-delete'){
    const id = STATE.confirmDeleteMyDocId;
    STATE.confirmDeleteMyDocId = null;
    deleteMyDoc(id);
  }
  else if(action==='start-daily-goal'){ startCountedQuiz(parseInt(el.dataset.count,10) || 10); }
  else if(action==='start-hearts'){ startHeartsMode(); }
  else if(action==='start-suddendeath'){ startSuddenDeathMode(); }
  else if(action==='start-timeattack'){ startTimeAttackMode(); }
  else if(dbDateAction(action, el)){ /* filtro de fechas de Base de datos */ }
  else if(typeof action === 'string' && action.startsWith('install-') && typeof installOnAction === 'function'){ installOnAction(action); }
  else if(action==='db-set-state'){
    if(!isDevUser()) return;
    const st = el.dataset.state;
    if(st === 'fix' && !(REV.ready && REV.fix)){ STATE.toast = 'Falta ejecutar el SQL question-needs-changes.sql en Supabase.'; render(); return; }
    setReviewState(el.dataset.qid, st); render();
  }
  else if(action==='db-open'){ if(!isDevUser()) return; STATE.dbActive = el.dataset.qid; STATE.editingId = null; STATE.dbListMode = false; render(); dbEnsureVisible(); }
  else if(action==='db-close'){
    // al volver a la lista, queda a la vista la pregunta que estabas revisando
    const lastId = STATE.dbActive;
    if(lastId){
      const f = STATE.dbFilter, ps = [25, 50, 100].includes(f.pageSize) ? f.pageSize : 50;
      const i = filteredDbList().findIndex(q => q.id === lastId);
      if(i >= 0) f.page = Math.floor(i / ps) + 1;
    }
    STATE.dbActive = null; STATE.dbFull = false; STATE.editingId = null; STATE.dbListMode = true; render();
    if(lastId){ const b = document.querySelector('.dbx-check[data-qid="' + lastId + '"]'); const r = b && b.closest('.dbx-row'); if(r && r.scrollIntoView) r.scrollIntoView({ block: 'center' }); }
  }
  else if(action==='db-full'){ STATE.dbFull = !STATE.dbFull; render(); dbEnsureVisible(); }
  else if(action==='db-nav'){ if(!isDevUser()) return; dbMoveActive(parseInt(el.dataset.dir, 10) || 1); }
  else if(action==='db-review-next'){ if(!isDevUser()) return; dbReviewNext(); }
  else if(action==='db-set-status'){ STATE.dbFilter.status = el.dataset.status; STATE.dbFilter.page = 1; STATE.editingId = null; render(); }
  else if(action==='db-prev-page'){ STATE.dbFilter.page = Math.max(1, STATE.dbFilter.page-1); render(); }
  else if(action==='db-next-page'){ STATE.dbFilter.page = STATE.dbFilter.page+1; render(); }
  else if(action==='toggle-reviewed'){
    const qid = el.dataset.qid;
    setReviewed(qid, !STATE.storage.reviewed[qid]);
    render();
  }
  else if(action==='delete-question'){
    STATE.confirmDeleteId = el.dataset.qid;
    render();
  }
  else if(action==='confirm-delete'){
    const qid = STATE.confirmDeleteId;
    if(qid){
      if(STATE.dbActive === qid){
        // revisando: al eliminar la abierta, se pasa a la siguiente (o a la anterior si era la última)
        const l = filteredDbList(), i = l.findIndex(q => q.id === qid);
        const nxt = l[i + 1] || l[i - 1];
        STATE.dbActive = nxt ? nxt.id : null;
      }
      if(sharedActive() && (baseIdSet().has(qid) || SHARED.rows[qid])){
        // Banco compartido: se elimina para todos los usuarios.
        if(baseIdSet().has(qid)){
          const cur = allQuestionsAdmin().find(x => x.id === qid) || {};
          const ex = SHARED.rows[qid] || {};
          sharedSave([{ id:qid, domain:cur.domain || ex.domain || 'law', deleted:true, created_at: ex.created_at || null, updated_at: Date.now() }]);
        } else {
          sharedDelete([qid]);
        }
      } else {
        STATE.storage.deleted[qid] = true;
        saveDeleted();
      }
      setReviewed(qid, false);
      STATE.toast = 'Pregunta eliminada.';
    }
    STATE.confirmDeleteId = null;
    render();
  }
  else if(action==='toggle-draft'){
    if(!isDevUser() || !sharedActive()) return;
    const qid = el.dataset.qid;
    const cur = allQuestionsAdmin().find(x => x.id === qid); if(!cur) return;
    const makeDraft = !cur.draft;
    const ex = SHARED.rows[qid];
    // Para una pregunta base sin cambios previos se guarda solo la marca (el resto queda como está).
    const row = ex
      ? Object.assign({}, ex, { draft: makeDraft })
      : { id: qid, domain: cur.domain, rule: null, question: null, options: null, correct: null, explanation: null,
          difficulty: cur.difficulty || 'normal', deleted: false, draft: makeDraft, created_at: null, updated_at: null };
    sharedSave([row]);
    STATE.toast = makeDraft
      ? 'Pregunta retirada del juego. Sigue en la Base de datos hasta que la vuelvas a poner en juego.'
      : 'Pregunta puesta en juego de nuevo.';
    render();
  }
  else if(action==='cancel-delete'){
    STATE.confirmDeleteId = null;
    render();
  }
  else if(action==='saved-browse'){ STATE.savedBrowseIdx = 0; STATE.view = 'savedBrowse'; render(); }
  else if(action==='saved-browse-prev'){ STATE.savedBrowseIdx--; render(); }
  else if(action==='saved-browse-next'){ STATE.savedBrowseIdx++; render(); }
  else if(action==='open-suggest'){ STATE.view = 'suggestForm'; render(); }
  else if(action==='send-suggestion'){ sendSuggestion(); }
  else if(action==='suggestions-admin'){ if(!isMaster()) return; STATE.view = 'suggestionsAdmin'; loadSuggestions(); render(); }
  else if(action==='admin-dashboard'){ if(!isMaster()) return; STATE.view = 'adminDashboard'; loadAdminStats(1); loadBankUsage(); render(); }
  else if(action==='bank-usage-pct'){ if(!isMaster()) return; loadBankUsage(parseInt(el.dataset.v, 10)); }
  else if(action==='bank-usage-reload'){ if(!isMaster()) return; loadBankUsage(); }
  else if(action==='admin-users-prev-page'){ if(!isMaster() || STATE.adminUsersPage<=1) return; loadAdminStats(STATE.adminUsersPage-1); }
  else if(action==='admin-users-next-page'){ if(!isMaster() || !STATE.adminStats || STATE.adminUsersPage>=STATE.adminStats.usersTotalPages) return; loadAdminStats(STATE.adminUsersPage+1); }
  else if(action==='admin-dashboard-retry'){ if(!isMaster()) return; loadAdminStats(); }
  else if(action==='admin-delete-user'){ if(!isMaster()) return; STATE.confirmDeleteUserId = el.dataset.uid; render(); }
  else if(action==='admin-cancel-delete-user'){ STATE.confirmDeleteUserId = null; render(); }
  else if(action==='admin-confirm-delete-user'){ if(!isMaster()) return; deleteAdminUser(STATE.confirmDeleteUserId); }
  else if(action==='admin-set-role'){ if(!isMaster()) return; setUserRole(el.dataset.uid, el.dataset.role); }
  else if(action==='admin-block-user'){ if(!isMaster()) return; toggleBlockAdminUser(el.dataset.uid, true); }
  else if(action==='admin-unblock-user'){ if(!isMaster()) return; toggleBlockAdminUser(el.dataset.uid, false); }
  else if(action==='suggestion-status'){ if(!isMaster()) return; setSuggestionStatus(el.dataset.id, el.dataset.status); }
  else if(action==='suggestion-delete'){ if(!isMaster()) return; deleteSuggestion(el.dataset.id); }
  else if(action==='toggle-saved'){
    const qid = el.dataset.qid;
    const was = !!STATE.storage.saved[qid];
    if(was) delete STATE.storage.saved[qid];
    else STATE.storage.saved[qid] = Date.now();
    saveSaved();
    if(was) STATE.toast = 'Pregunta quitada de Guardadas.';   // antes no se veía que se hubiera borrado
    render();
  }
  else if(action==='edit-question'){ STATE.editingId = el.dataset.qid; render(); }
  else if(action==='cancel-edit'){ STATE.editingId = null; render(); }
  else if(action==='save-edit'){ saveQuestionEdit(el.dataset.qid); }
  else if(action==='export-excel'){ exportExcel(); }
  else if(action==='reset-law-progress'){ STATE.lawMenuOpen = false; STATE.confirmResetLawId = parseInt(el.dataset.law,10); render(); }
  else if(action==='confirm-reset-law'){
    const law = STATE.confirmResetLawId;
    STATE.confirmResetLawId = null;
    resetLawProgress(law).then((ok)=>{
      if(ok === false) return;
      STATE.toast = 'Progreso de la regla reiniciado.';
      render();
    });
  }
  else if(action==='cancel-reset-law'){ STATE.confirmResetLawId = null; render(); }
}


/* Si el maestro cambia tu rol mientras tienes la web abierta, al volver a la pestaña se actualiza solo. */
document.addEventListener('visibilitychange', async () => {
  if(document.visibilityState !== 'visible') return;
  if(typeof CURRENT_USER_EMAIL === 'undefined' || !CURRENT_USER_EMAIL) return;
  const before = userRole();
  await loadUserRole();
  if(userRole() !== before) render();
});

/* Esc cierra el aviso de "¿Seguro que quieres salir del test?" y deja seguir con el test. */
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && STATE.confirmQuit){ STATE.confirmQuit = null; render(); }
});

/* ---------------- NAVEGACIÓN: historial del navegador ----------------
   Cada pantalla de la app tiene su dirección (#/inicio, #/regla/12, #/crear-test, #/league...). El botón o gesto "atrás"
   del móvil vuelve a la pantalla anterior en vez de salir de la app, y durante un test abre el aviso de salida.
   Recargar la página abre la misma pantalla (las que dependen de un test en curso vuelven a Inicio). */
const NAV = { ready: false, last: null, stack: [] };   // stack: pantallas de la app visitadas en esta sesion (para el boton volver)
const NAV_QUIZ_ROUTES = ['#/test', '#/mi-test'];
const NAV_SPECIAL_LAWS = ['failed', 'hard', 'glossary', 'saved', 'assistants'];

function navRoute(){
  const v = STATE.view;
  switch(v){
    case 'home': return '#/inicio';
    case 'law': return '#/regla/' + STATE.lawId;
    case 'trainConfig': return '#/crear-test';
    case 'dailyChallenge': return '#/league';
    case 'leaderboard': return '#/league/clasificacion';
    case 'academia': return '#/academia';
    case 'stats': return '#/estadisticas';
    case 'achievements': return '#/logros';
    case 'recentPerformance': return '#/rendimiento';
    case 'streakCalendar': return '#/calendario';
    case 'menu': return '#/mas';
    case 'profile': return '#/perfil';
    case 'quiz': return '#/test';
    case 'myBankQuiz': return '#/mi-test';
    case 'result': case 'myBankResult': return '#/resultado';
    default: return '#/v/' + String(v);
  }
}

/* De una dirección a la acción que abre esa pantalla (las mismas acciones que los botones, así cargan sus datos). */
function navParse(hash){
  const p = String(hash || '').replace(/^#\/?/, '').split('/');
  const k = p[0] || 'inicio';
  const simple = { inicio: 'home', 'crear-test': 'train-config', academia: 'academia', estadisticas: 'stats', logros: 'achievements', rendimiento: 'recent-performance', calendario: 'streak-calendar', mas: 'menu', perfil: 'profile' };
  if(simple[k] && p.length === 1) return { action: simple[k] };
  if(k === 'league' && p.length <= 2) return { action: p[1] === 'clasificacion' ? 'leaderboard' : 'dailyChallenge' };
  if(k === 'regla' && p[1]){
    const n = parseInt(p[1], 10);
    if(String(n) === p[1] && n >= 1 && n <= 17) return { action: 'open-law', law: p[1] };
    if(NAV_SPECIAL_LAWS.includes(p[1])) return { action: 'open-law', law: p[1] };
  }
  return null;
}

function navOpen(t){
  onAction({ currentTarget: { dataset: { action: t.action, law: t.law } } });
}

/* Tras cada pintado: si la pantalla ha cambiado, se añade una entrada al historial. */
function navSync(){
  if(!NAV.ready) return;
  let r;
  try{ r = navRoute(); }catch(e){ return; }
  if(location.hash === r){ NAV.last = r; return; }
  try{
    if(NAV_QUIZ_ROUTES.includes(NAV.last) && r === NAV.preQuiz){
      // Se sale del test a la pantalla desde la que se empezó: se retrocede una entrada (no se duplica la pantalla).
      NAV.stack.pop(); NAV.last = r; NAV.pendingBack = true; history.back(); return;
    }
    // Desde un test, la pantalla nueva sustituye a la entrada del test: "atrás" no vuelve a un test que ya no existe.
    if(location.hash === '' || NAV_QUIZ_ROUTES.includes(NAV.last)){ history.replaceState({ r }, '', r); NAV.stack[Math.max(0, NAV.stack.length - 1)] = r; }
    else {
      if(NAV_QUIZ_ROUTES.includes(r)) NAV.preQuiz = NAV.last;
      history.pushState({ r }, '', r); NAV.stack.push(r); window.scrollTo(0, 0);
    }
  }catch(e){}
  NAV.last = r;
}

function navGoto(hash){
  const t = navParse(hash);
  if(!t){
    try{ history.replaceState({ r: '#/inicio' }, '', '#/inicio'); }catch(e){}
    NAV.last = '#/inicio'; STATE.view = 'home'; render(); window.scrollTo(0, 0);
    return;
  }
  navOpen(t);
  window.scrollTo(0, 0);
}

/* Al terminar de cargar: si la dirección trae una pantalla, se abre; y se deja la dirección actual en el historial. */
function navInit(){
  if(NAV.ready) return;
  NAV.ready = true;
  const h = location.hash;
  if(h && h !== '#/inicio'){
    const t = navParse(h);
    if(t){ try{ navOpen(t); }catch(e){ STATE.view = 'home'; } }
    else STATE.view = 'home';
  }
  const r = navRoute();
  try{ history.replaceState({ r }, '', r); }catch(e){}
  NAV.last = r; NAV.stack = [r];
}

window.addEventListener('popstate', function(){
  if(!NAV.ready) return;
  if(NAV.pendingBack){ NAV.pendingBack = false; NAV.last = location.hash; return; }   // el retroceso lo hizo la propia app al salir de un test
  if(STATE.view === 'quiz' || STATE.view === 'myBankQuiz'){
    // Con un test en marcha, "atrás" no sale: se repone la entrada del test y se pregunta si quiere salir.
    try{ history.pushState({ r: NAV.last }, '', NAV.last); }catch(e){}
    STATE.confirmQuit = STATE.view === 'myBankQuiz' ? 'mybank' : 'quiz';
    render();
    return;
  }
  STATE.confirmQuit = null;
  /* la pila de pantallas se recorta hasta la dirección a la que se ha vuelto (o se reinicia si no estaba) */
  const at = NAV.stack.lastIndexOf(location.hash);
  if(at >= 0) NAV.stack.length = at + 1; else NAV.stack = [location.hash];
  navGoto(location.hash);
});

/* "Crear test": los campos "Otro" (número, minutos, segundos) actualizan el resumen al confirmar el valor. */
document.addEventListener('change', (e) => {
  const t = e.target;
  if(!t || STATE.view !== 'trainConfig') return;
  const v = parseInt(t.value, 10);
  if(t.id === 'cfg-count'){ STATE.trainCfg.count = Math.min(MAX_TEST_QUESTIONS, Math.max(1, isNaN(v) ? 20 : v)); STATE.trainCfg.countOther = true; render(); }
  else if(t.id === 'cfg-minutes'){ STATE.trainCfg.minutes = Math.min(300, Math.max(1, isNaN(v) ? 20 : v)); STATE.trainCfg.minOther = true; render(); }
  else if(t.id === 'cfg-seconds-per-q'){ STATE.trainCfg.secondsPerQuestion = Math.min(120, Math.max(5, isNaN(v) ? 45 : v)); STATE.trainCfg.secOther = true; render(); }
});

/* Teclado en el test: 1-4 o A-D responden, Enter continúa. Reutiliza los propios botones de la pantalla. */
document.addEventListener('keydown', (e) => {
  if(STATE.view !== 'quiz' || e.ctrlKey || e.metaKey || e.altKey) return;
  if(document.getElementById('app-dialog') || document.getElementById('confirm-modal')) return;
  const t = e.target;
  if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const root = document.querySelector('.qz'); if(!root) return;
  const k = e.key.toLowerCase();
  const map = { '1':'a', '2':'b', '3':'c', '4':'d', 'a':'a', 'b':'b', 'c':'c', 'd':'d' };
  if(map[k]){
    const btn = root.querySelector('button.option[data-letter="' + map[k] + '"]:not(:disabled)');
    if(btn){ e.preventDefault(); btn.click(); }
  } else if(e.key === 'Enter'){
    if(t && t.tagName === 'BUTTON') return; // Enter sobre un botón ya lo activa el navegador
    const next = root.querySelector('[data-action="next-question"]:not(:disabled)');
    if(next){ e.preventDefault(); next.click(); }
  }
});

/* ---------------- Seguridad: cierre de sesión por inactividad (solo maestro y desarrolladores) ----------------
   Las cuentas de administración tienen muchos permisos; si se queda el navegador abierto y nadie lo usa,
   la sesión se cierra sola tras 60 minutos sin actividad. */
const ADMIN_IDLE_MS = 60 * 60 * 1000;
let __lastActivity = Date.now();
let __idleLoggingOut = false;
['click', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(ev => {
  document.addEventListener(ev, () => { __lastActivity = Date.now(); }, { passive: true });
});
function adminIdleCheck(){
  if(__idleLoggingOut) return;
  if(typeof isDevUser !== 'function' || !isDevUser()) return;
  if(Date.now() - __lastActivity < ADMIN_IDLE_MS) return;
  __idleLoggingOut = true;
  STATE.toast = 'Sesión cerrada por inactividad.';
  try{ render(); }catch(e){}
  setTimeout(() => { if(typeof handleLogout === 'function') handleLogout(); else window.location.href = 'index.html'; }, 1200);
}
setInterval(adminIdleCheck, 60 * 1000);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') adminIdleCheck(); });

/* ---- Aviso opcional para completar el perfil (se puede cerrar con la X) ---- */
async function loadProfileNudge(){
  try{
    const { data } = await supabaseClient.from('profiles_onboarding').select('completado_at,saltado').eq('user_id', CURRENT_USER_ID).maybeSingle();
    STATE.profileNudge = !(data && (data.completado_at || data.saltado));
    if(STATE.profileNudge) render();
  }catch(e){ STATE.profileNudge = false; }
}
function profileNudgeHtml(){
  if(!STATE.profileNudge) return '';
  return `<section class="profile-nudge" role="region" aria-label="Completa tu perfil">
    <div class="pn-text"><strong>Cuéntanos más sobre ti</strong><span>Opcional · 1 minuto</span></div>
    <a class="pn-link" href="/bienvenida/?perfil=1">Completar</a>
    <button type="button" class="pn-x" data-action="profile-nudge-close" aria-label="Cerrar este aviso">&times;</button>
  </section>`;
}
async function dismissProfileNudge(){
  STATE.profileNudge = false; render();
  try{ await supabaseClient.from('profiles_onboarding').upsert({ user_id: CURRENT_USER_ID, saltado: true }, { onConflict: 'user_id' }); }catch(e){}
}
