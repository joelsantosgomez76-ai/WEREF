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

async function loadQuestionReports(){
  if(!isDevUser()) return;
  try{
    const { data, error } = await supabaseClient.from('question_reports').select('question_id');
    if(error || !data) return;
    const counts = {};
    data.forEach(r => { counts[r.question_id] = (counts[r.question_id]||0) + 1; });
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
  if(!isDevUser()) return;
  try{
    const { data, error } = await supabaseClient.from('suggestions').select('*').order('created_at', { ascending: false });
    if(error || !data) return;
    STATE.suggestions = data;
    render();
  }catch(e){}
}

async function setSuggestionStatus(id, status){
  if(!isDevUser()) return;
  try{ await supabaseClient.from('suggestions').update({ status }).eq('id', id); }catch(e){}
  const s = STATE.suggestions.find(x=>x.id===id);
  if(s) s.status = status;
  render();
}

async function deleteSuggestion(id){
  if(!isDevUser()) return;
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

const BASE_QUESTIONS = BASE_QUESTIONS_RAW;
BASE_QUESTIONS.forEach(q => { q.id = 'R'+q.rule+'-'+q.num; q.source = 'base'; q.domain = 'law'; if(!q.difficulty) q.difficulty = 'normal'; });

const ASSISTANT_QUESTIONS = (typeof ASSISTANT_QUESTIONS_RAW !== 'undefined') ? ASSISTANT_QUESTIONS_RAW : [];
ASSISTANT_QUESTIONS.forEach(q => { q.id = 'A-'+q.num; q.source = 'base'; q.domain = 'assistants'; q.rule = null; if(!q.difficulty) q.difficulty = 'normal'; });

let STATE = {
  view: 'home',
  lawId: null,
  editingId: null,
  cameFromDb: false,
  quiz: null, // {qids, idx, mode, law, answers:{qid:letter}, instantFeedback, timeSec, remainingSec}
  storage: { progress:{}, failedStreaks:{}, userQuestions:[], flags:{}, saved:{}, edits:{}, reviewed:{}, deleted:{}, glossaryQuestions:[], testHistory:[], maxStreak:0, unlockedBadges:{}, dailyGoal:20, crownLevels:{}, heartsRecord:0, suddenDeathRecord:0, timeAttackRecord:0, myBank:[], myBankCategories:[], myDocsFolders:[], myDocs:[] },
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
  trainCfg: { count: 20, minutes: 20, secondsPerQuestion: 45, timerMode: 'total', laws: [], onlyFailed: false, scopeOverride: null, feedbackMode: 'exam' },
  dbFilter: { search: '', law: 'all', difficulty: 'all', flaggedOnly: false, myOnly: false, reviewStatus: 'all', reportedOnly: false, duplicatesOnly: false, dateField: 'created', dateFrom: '', dateTo: '', page: 1 },
  reportedIds: {},
  reports: {},
  reportsLoaded: false,
  suggestions: [],
  adminStats: null,
  adminUsersPage: 1,
  adminUsersFilter: { search: '', status: 'all', role: 'all' },
  confirmDeleteUserId: null,
  leaderboard: [],
  leaderboardMode: 'hearts',
  myStanding: null,
  leagueSummary: null,
  leaderboardParticipants: null,
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
function shuffledQuestionCopy(q){
  const letters = ['a','b','c','d'];
  const order = shuffle(Array.from({length:q.options.length}, (_,i)=>i));
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
const SHARED = { ready:false, rows:{}, added:[], over:{} };
let BASE_ID_SET = null;
function baseIdSet(){
  if(!BASE_ID_SET) BASE_ID_SET = new Set(BASE_QUESTIONS.concat(ASSISTANT_QUESTIONS).map(q => q.id));
  return BASE_ID_SET;
}
function sharedActive(){ return SHARED.ready && isDevUser(); }
function sharedNormRow(r){
  return {
    id: r.id, domain: r.domain,
    rule: r.rule == null ? null : r.rule,
    question: r.question == null ? null : r.question,
    options: r.options || null,
    correct: r.correct || null,
    explanation: r.explanation == null ? null : r.explanation,
    difficulty: r.difficulty || 'normal',
    deleted: !!r.deleted,
    created_at: r.created_at || null,
    updated_at: r.updated_at || null
  };
}
function sharedRowToQuestion(r){
  return { id:r.id, domain:r.domain, rule: r.rule == null ? null : r.rule, num:r.id, question:r.question || '',
    options: r.options || ['','','',''], correct: r.correct || 'a', explanation: r.explanation || '',
    difficulty: r.difficulty || 'normal', source:'user', shared:true, createdAt: r.created_at || null, updatedAt: r.updated_at || null };
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
    const { error } = await supabaseClient.from('shared_questions').upsert(rows.slice(i, i + 200), { onConflict: 'id' });
    if(error){
      STATE.toast = 'No se pudo guardar en el banco compartido. Inténtalo de nuevo.';
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
/* Fila para una pregunta (nueva o editada) con los campos del formulario. */
function sharedRowFor(qid, domain, f, createdAt){
  const ex = SHARED.rows[qid];
  return sharedNormRow({
    id: qid, domain, rule: domain === 'law' ? f.rule : null,
    question: f.question, options: f.options, correct: f.correct,
    explanation: f.explanation || '', difficulty: f.difficulty || 'normal', deleted: false,
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

function allQuestions(){
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
        if(o.question != null) f.question = o.question;
        if(o.options) f.options = o.options;
        if(o.correct) f.correct = o.correct;
        if(o.explanation != null) f.explanation = o.explanation;
        if(o.difficulty) f.difficulty = o.difficulty;
        if(o.domain === 'law' && o.rule != null) f.rule = o.rule;
        if(o.updated_at) f.updatedAt = o.updated_at;
        r = Object.assign({}, q, f);
      }
      const e = STATE.storage.edits && STATE.storage.edits[q.id];
      return e ? Object.assign({}, r, e) : r;
    });
}
function questionsForLaw(law){
  if(law === 'hard') return allQuestions().filter(q => q.difficulty === 'hard');
  if(law === 'failed') return allQuestions().filter(q => isFailedQuestion(q));
  if(law === 'glossary') return allQuestions().filter(q => q.domain === 'glossary');
  if(law === 'assistants') return allQuestions().filter(q => q.domain === 'assistants');
  if(law === 'saved') return allQuestions().filter(q => !!STATE.storage.saved[q.id]);
  return allQuestions().filter(q => q.domain!=='glossary' && q.rule === law);
}

async function storageGet(key){
  try{ const r = await window.storage.get(key); return r ? r.value : null; }catch(e){ return null; }
}
async function storageSet(key, value){
  try{ await window.storage.set(key, value); }catch(e){}
}

async function loadStorage(){
  await loadUserRole();
  await loadSharedQuestions();
  try{ const v = await storageGet('progress'); STATE.storage.progress = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.progress = {}; }
  let failedStreaksWasNew = false;
  try{ const v = await storageGet('failedStreaks'); if(v){ STATE.storage.failedStreaks = JSON.parse(v); } else { STATE.storage.failedStreaks = {}; failedStreaksWasNew = true; } }catch(e){ STATE.storage.failedStreaks = {}; failedStreaksWasNew = true; }
  try{ const v = await storageGet('userQuestions'); STATE.storage.userQuestions = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.userQuestions = []; }
  try{ const v = await storageGet('flags'); STATE.storage.flags = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.flags = {}; }
  try{ const v = await storageGet('saved'); STATE.storage.saved = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.saved = {}; }
  try{ const v = await storageGet('edits'); STATE.storage.edits = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.edits = {}; }
  try{ const v = await storageGet('reviewed'); STATE.storage.reviewed = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.reviewed = {}; }
  try{ const v = await storageGet('deleted'); STATE.storage.deleted = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.deleted = {}; }
  try{ const v = await storageGet('testHistory'); STATE.storage.testHistory = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.testHistory = []; }
  try{ const v = await storageGet('maxStreak'); STATE.storage.maxStreak = v ? JSON.parse(v) : 0; }catch(e){ STATE.storage.maxStreak = 0; }
  try{ const v = await storageGet('unlockedBadges'); STATE.storage.unlockedBadges = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.unlockedBadges = {}; }
  try{ const v = await storageGet('dailyGoal'); STATE.storage.dailyGoal = v ? JSON.parse(v) : 20; }catch(e){ STATE.storage.dailyGoal = 20; }
  try{ const v = await storageGet('crownLevels'); STATE.storage.crownLevels = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.crownLevels = {}; }
  try{ const v = await storageGet('heartsRecord'); STATE.storage.heartsRecord = v ? JSON.parse(v) : 0; }catch(e){ STATE.storage.heartsRecord = 0; }
  try{ const v = await storageGet('suddenDeathRecord'); STATE.storage.suddenDeathRecord = v ? JSON.parse(v) : 0; }catch(e){ STATE.storage.suddenDeathRecord = 0; }
  try{ const v = await storageGet('timeAttackRecord'); STATE.storage.timeAttackRecord = v ? JSON.parse(v) : 0; }catch(e){ STATE.storage.timeAttackRecord = 0; }
  try{ const v = await storageGet('glossaryQuestions'); STATE.storage.glossaryQuestions = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.glossaryQuestions = []; }
  try{ const v = await storageGet('myBank'); STATE.storage.myBank = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myBank = []; }
  try{ const v = await storageGet('myBankCategories'); STATE.storage.myBankCategories = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myBankCategories = []; }
  try{ const v = await storageGet('myDocsFolders'); STATE.storage.myDocsFolders = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myDocsFolders = []; }
  try{ const v = await storageGet('myDocs'); STATE.storage.myDocs = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.myDocs = []; }
  try{ const v = await storageGet('calendarEvents'); STATE.storage.calendarEvents = v ? JSON.parse(v) : []; }catch(e){ STATE.storage.calendarEvents = []; }
  let activeDaysWasNew = false;
  try{ const v = await storageGet('activeDays'); if(v){ STATE.storage.activeDays = JSON.parse(v); } else { STATE.storage.activeDays = {}; activeDaysWasNew = true; } }catch(e){ STATE.storage.activeDays = {}; activeDaysWasNew = true; }
  try{ const v = await storageGet('pointsCorrectOffset'); STATE.storage.pointsCorrectOffset = v ? JSON.parse(v) : 0; }catch(e){ STATE.storage.pointsCorrectOffset = 0; }
  if(activeDaysWasNew && Object.keys(STATE.storage.progress).length>0){
    // Primera vez que existe esta clave: recuperamos el historial de racha a partir de las marcas de tiempo ya guardadas en "progress", para no resetear la racha de nadie con este cambio.
    Object.values(STATE.storage.progress).forEach(p=>{ if(p && p.ts) STATE.storage.activeDays[dayKey(p.ts)] = true; });
    saveActiveDays();
  }
  if(failedStreaksWasNew){
    // Primera vez que existe esta clave: las preguntas ya falladas (según "progress") entran
    // en la Sala de Repaso con 0 aciertos seguidos, para no perder el repaso pendiente de nadie.
    Object.keys(STATE.storage.progress).forEach(qid=>{
      if(STATE.storage.progress[qid] && STATE.storage.progress[qid].correct === false){
        STATE.storage.failedStreaks[qid] = 0;
      }
    });
    saveFailedStreaks();
  }
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
  await sharedMigrateLocal();
  checkAndUnlockBadges();
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
async function saveFlags(){ await storageSet('flags', JSON.stringify(STATE.storage.flags)); }
async function saveSaved(){ await storageSet('saved', JSON.stringify(STATE.storage.saved)); }
async function saveEdits(){ await storageSet('edits', JSON.stringify(STATE.storage.edits)); }
async function saveReviewed(){ await storageSet('reviewed', JSON.stringify(STATE.storage.reviewed)); }
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

async function upsertLeaderboardScore(mode, score){
  try{
    const { data: userRes } = await supabaseClient.auth.getUser();
    const country = (userRes && userRes.user && userRes.user.user_metadata) ? (userRes.user.user_metadata.country || null) : null;
    const { data: unameRow } = await supabaseClient.from('usernames').select('username').eq('user_id', CURRENT_USER_ID).maybeSingle();
    const points = computePoints();
    const rankName = currentRank(points).name;
    await supabaseClient.from('leaderboard_scores').upsert({
      user_id: CURRENT_USER_ID,
      mode,
      score,
      username: unameRow ? unameRow.username : null,
      country,
      rank_name: rankName,
      points
    }, { onConflict: 'user_id,mode' });
  }catch(e){}
}

async function loadLeaderboard(mode){
  STATE.leaderboardMode = mode;
  STATE.myStanding = null;
  STATE.leaderboardParticipants = null;
  try{
    const { data, error } = await supabaseClient.from('leaderboard_scores').select('*').eq('mode', mode).order('score', { ascending: false }).limit(25);
    if(!error && data) STATE.leaderboard = data;
    const { count: totalCount } = await supabaseClient.from('leaderboard_scores').select('user_id', { count: 'exact', head: true }).eq('mode', mode);
    STATE.leaderboardParticipants = totalCount||0;
    render();
  }catch(e){}
  loadMyLeaderboardStanding(mode);
}

async function loadMyLeaderboardStanding(mode){
  try{
    const { data: mine } = await supabaseClient.from('leaderboard_scores').select('*').eq('mode', mode).eq('user_id', CURRENT_USER_ID).maybeSingle();
    if(!mine){ STATE.myStanding = false; render(); return; }
    const { count } = await supabaseClient.from('leaderboard_scores').select('user_id', { count: 'exact', head: true }).eq('mode', mode).gt('score', mine.score);
    const myRank = (count||0) + 1;
    let nextAbove = null;
    if(myRank > 1){
      const { data: aboveRows } = await supabaseClient.from('leaderboard_scores').select('score,username').eq('mode', mode).gt('score', mine.score).order('score', { ascending: true }).limit(1);
      if(aboveRows && aboveRows[0]) nextAbove = aboveRows[0];
    }
    let milestoneRank = null, milestoneScore = null;
    if(myRank > 25) milestoneRank = 25;
    else if(myRank > 10) milestoneRank = 10;
    if(milestoneRank){
      const { data: msRows } = await supabaseClient.from('leaderboard_scores').select('score').eq('mode', mode).order('score', { ascending: false }).range(milestoneRank-1, milestoneRank-1);
      if(msRows && msRows[0]) milestoneScore = msRows[0].score;
    }
    STATE.myStanding = Object.assign({}, mine, { rank: myRank, nextAbove, milestoneRank, milestoneScore });
    render();
  }catch(e){}
}

async function loadLeagueSummary(){
  const modes = ['hearts','suddendeath','timeattack'];
  const results = {};
  for(const mode of modes){
    try{
      const { data: mine } = await supabaseClient.from('leaderboard_scores').select('score').eq('mode', mode).eq('user_id', CURRENT_USER_ID).maybeSingle();
      if(mine){
        const { count } = await supabaseClient.from('leaderboard_scores').select('user_id', { count: 'exact', head: true }).eq('mode', mode).gt('score', mine.score);
        results[mode] = (count||0) + 1;
      } else {
        results[mode] = null;
      }
    }catch(e){ results[mode] = null; }
  }
  STATE.leagueSummary = results;
  render();
}

function recordTestResult(quiz){
  STATE.reviewDetailIdx = null;
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
      upsertLeaderboardScore(quiz.mode, recordScore);
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
  physical: { label: 'Prueba física', icon: '🏃', color: '#1D6FE0', bg: '#DFEBFC' },
  meeting: { label: 'Reunión de comité', icon: '👥', color: '#8033D6', bg: '#EDE0FB' },
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
  if(!ts) return null;
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

/* ---------------- GAMIFICACIÓN: puntos, rangos e insignias ---------------- */
function computePoints(){
  const progress = STATE.storage.progress || {};
  const correctCount = Object.values(progress).filter(p=>p.correct).length + (STATE.storage.pointsCorrectOffset||0);
  const testHistory = STATE.storage.testHistory || [];
  const testsCompleted = testHistory.length;
  const perfectTests = testHistory.filter(h=>h.total>=10 && h.pct===100).length;
  const streak = computeStreak();
  return correctCount*3 + testsCompleted*5 + perfectTests*15 + streak*2;
}

const RANKS = [
  {min:0,    name:'Aprendiz', level:1},
  {min:250,  name:'Árbitro Territorial', level:2},
  {min:800,  name:'Árbitro Autonómico', level:3},
  {min:2000, name:'Árbitro de Primera', level:4},
  {min:4000, name:'Árbitro Nacional', level:5},
  {min:7000, name:'Árbitro Internacional', level:6}
];
function rankLevelFor(rankName){
  const r = RANKS.find(x=>x.name===rankName);
  return r ? r.level : null;
}
function currentRank(points){
  let rank = RANKS[0];
  for(const r of RANKS){ if(points >= r.min) rank = r; }
  return rank;
}
function nextRankInfo(points){
  const next = RANKS.find(r => r.min > points);
  if(!next) return null;
  const current = currentRank(points);
  return { name: next.name, remaining: next.min - points, progressPct: Math.round((points-current.min)/(next.min-current.min)*100) };
}

const BADGES = [
  {id:'first_whistle', icon:'🎯', name:'Primer Pitido', desc:'Responde tu primera pregunta', check:ctx=>ctx.answered>=1},
  {id:'streak7', icon:'🔥', name:'Racha de Hierro', desc:'7 días seguidos estudiando', check:ctx=>ctx.maxStreak>=7},
  {id:'streak30', icon:'🔥', name:'Racha de Titanio', desc:'30 días seguidos estudiando', check:ctx=>ctx.maxStreak>=30},
  {id:'perfect_test', icon:'💯', name:'Partido Perfecto', desc:'100% en un test de 10 o más preguntas', check:ctx=>ctx.hasPerfectTest},
  {id:'rule_master', icon:'📘', name:'Maestro de Regla', desc:'Una regla (o el Glosario) al 100% completada con 90% de acierto o más', check:ctx=>ctx.hasRuleMastered},
  {id:'full_book', icon:'🏆', name:'Reglamento Completo', desc:'Las 17 Reglas al 100% completadas', check:ctx=>ctx.allRulesComplete},
  {id:'clean_room', icon:'🧹', name:'Sala Limpia', desc:'Sala de Repaso vacía tras completar al menos 5 tests', check:ctx=>ctx.cleanRoom},
  {id:'points_300', icon:'🥉', name:'300 Puntos', desc:'Acumula 300 puntos', check:ctx=>ctx.points>=300},
  {id:'points_1500', icon:'🥈', name:'1.500 Puntos', desc:'Acumula 1.500 puntos', check:ctx=>ctx.points>=1500},
  {id:'points_4000', icon:'🥇', name:'4.000 Puntos', desc:'Acumula 4.000 puntos', check:ctx=>ctx.points>=4000}
];

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
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.max(1,count));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'short', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
}

function isLifeMode(mode){ return mode==='hearts' || mode==='suddendeath'; }
function maxLivesFor(mode){ return mode==='suddendeath' ? 1 : 3; }
function isRecordMode(mode){ return mode==='hearts' || mode==='suddendeath' || mode==='timeattack'; }
function formatScore(n){ return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function startHeartsMode(){
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(60, pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'hearts', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null, hearts:3, combo:0, bestCombo:0 };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
}

function startSuddenDeathMode(){
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(60, pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'suddendeath', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null, hearts:1, combo:0, bestCombo:0 };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
}

function startTimeAttackMode(){
  let pool = allQuestions().filter(q=>q.domain!=='federation' && q.domain!=='assistants');
  pool = shuffle(pool.slice()).slice(0, Math.min(150, pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'timeattack', law:null, answers:{}, instantFeedback:true, timerMode:'total', timeSec:60, remainingSec:60, showFeedback:false, selected:null, combo:0, bestCombo:0 };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  startTimer();
}

const CROWN_COLORS = ['', '#B87333', '#9AA0A6', '#E3A008', '#4FC3D9'];
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
  let color = 'var(--red)', bg = '#FDECEC';
  if(pct >= 85){ color = 'var(--green-ok)'; bg = '#EAF7EF'; }
  else if(pct >= 60){ color = 'var(--yellow-ink)'; bg = '#FFF6DE'; }
  return `<span class="acc-badge" style="background:${bg}; color:${color};">${pct}%</span>`;
}

function scoreColor(pct){
  if(pct >= 85) return 'var(--green-ok)';
  if(pct >= 60) return 'var(--yellow-ink)';
  return 'var(--red)';
}

function completionBadge(pct){
  return `<span class="acc-badge" style="background:#F5E6E8; color:var(--pitch);">${pct}% completado</span>`;
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
  allQuestions().forEach(q => {
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
  const viewHtml = viewFor(STATE.view);
  const useShell = typeof shellFor==='function' && !SHELL_FOCUS_VIEWS.includes(STATE.view);
  app.classList.toggle('has-shell', useShell);
  app.innerHTML = useShell ? shellFor(STATE.view, viewHtml) : viewHtml;
  bindEvents();
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
    const q = allQuestions().find(x=>x.id===STATE.confirmDeleteId);
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
      <p style="font-size:13.5px; color:var(--ink); background:#F7F7F1; padding:10px 12px; border-radius:8px; margin-bottom:10px;">${lawLabel}: se borrará el progreso (aciertos y fallos) solo de esta regla. Tus puntos de experiencia, tu rango, tu racha de estudio y tus insignias no se ven afectados, y el resto de reglas no se tocan.</p>
      <p style="font-size:12.5px; color:var(--muted); margin-bottom:16px;">Esta acción no se puede deshacer.</p>
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
  if(v==='flagged') return flaggedView();
  if(v==='savedBrowse') return savedBrowseView();
  if(v==='suggestForm') return suggestFormView();
  if(v==='suggestionsAdmin') return suggestionsAdminView();
  if(v==='database') return databaseView();
  if(v==='adminDashboard') return adminDashboardView();
  if(v==='dailyChallenge') return dailyChallengeView();
  if(v==='leaderboard') return leaderboardView();
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

function dailyChallengeView(){
  const ic = (n) => shellIcon(n);
  const heartsR = STATE.storage.heartsRecord || 0;
  const sdR = STATE.storage.suddenDeathRecord || 0;
  const taR = STATE.storage.timeAttackRecord || 0;
  const totalRecord = formatScore(heartsR + sdR + taR);

  const summary = STATE.leagueSummary;
  let rankLabel = '...', modeLabel = '...';
  if(summary){
    const ranked = [
      { label:'Corazones', rank: summary.hearts },
      { label:'M. Súbita', rank: summary.suddendeath },
      { label:'Contrarreloj', rank: summary.timeattack }
    ].filter(e => e.rank !== null && e.rank !== undefined);
    if(ranked.length>0){
      ranked.sort((a,b)=>a.rank-b.rank);
      rankLabel = '#'+ranked[0].rank;
      modeLabel = ranked[0].label;
    } else {
      rankLabel = 'Sin clasificar';
      modeLabel = '—';
    }
  }

  const mode = (cls, icon, title, desc, rec, facts, tagline, action) => `
  <article class="lg-mode ${cls}">
    <div class="lg-mode-top">
      <span class="lg-mode-ic">${ic(icon)}</span>
      <div class="lg-mode-rec"><small>Récord personal</small><b>${rec}</b></div>
    </div>
    <h3>${title}</h3>
    <p>${desc}</p>
    <ul class="lg-facts">${facts.map(f => `<li>${ic(f[0])}<span>${f[1]}</span></li>`).join('')}</ul>
    <div class="lg-tag">${tagline}</div>
    <button class="btn lg-play" data-action="${action}">${ic('play')} Jugar ahora</button>
  </article>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Zona competitiva</div>
      <h1>WEREF League</h1>
      <p>Compite, supera tus récords y escala posiciones en la clasificación global.</p>
      <div class="lg-hero-actions">
        <button class="btn btn-yellow" data-action="leaderboard">${ic('trophy')} Clasificación global</button>
      </div>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${totalRecord}</b><span>Récord total</span></div>
      <div class="lg-stat"><b>${rankLabel}</b><span>Tu posición</span></div>
      <div class="lg-stat"><b>${modeLabel}</b><span>Mejor modo</span></div>
    </div>
  </section>

  <div class="lg-section-head"><h2>Elige tu modo de juego</h2><span>Cada partida cuenta para la clasificación</span></div>
  <div class="lg-modes">
    ${mode('hearts', 'heart', 'Modo Corazones', 'Consigue aciertos antes de perder tus 3 vidas.', heartsR,
      [['heart','3 vidas'], ['target','Sin límite de tiempo'], ['trophy','Récord: ' + heartsR]],
      '¿Serás capaz de superar tu récord?', 'start-hearts')}
    ${mode('sudden', 'skull', 'Muerte Súbita', 'Una sola vida. Falla una vez y quedas eliminado.', sdR,
      [['skull','Una única vida'], ['zap','Cada fallo termina la partida'], ['trophy','Récord: ' + sdR]],
      'Solo los mejores llegan al Top 25.', 'start-suddendeath')}
    ${mode('attack', 'timer', 'Contrarreloj', '60 segundos en el reloj. Sin vidas, pero cada fallo resta.', formatScore(taR),
      [['timer','60 segundos'], ['zap','Cada fallo resta 0,5 puntos'], ['trophy','Récord: ' + formatScore(taR)]],
      'Cada punto cuenta para la clasificación.', 'start-timeattack')}
  </div>
  `;
}

function leaderboardView(){
  const ic = (n) => shellIcon(n);
  const mode = STATE.leaderboardMode || 'hearts';
  const modeTitle = mode==='hearts' ? 'Modo Corazones' : mode==='suddendeath' ? 'Muerte Súbita' : 'Contrarreloj';
  const medals = ['🥇','🥈','🥉'];
  const s = STATE.myStanding;
  const participants = STATE.leaderboardParticipants;
  const list = STATE.leaderboard || [];

  const topScore = list.length ? Math.max(Number(list[0].score) || 0, 1) : 1;
  const avatar = (name, cls) => {
    const n = String(name || '?').trim();
    let h = 0; for(let k = 0; k < n.length; k++) h = (h * 31 + n.charCodeAt(k)) % 360;
    return `<span class="lg-avatar ${cls || ''}" style="--h:${h};">${esc(n.charAt(0).toUpperCase())}</span>`;
  };
  const pod = (r, i) => {
    const isMe = r.user_id === CURRENT_USER_ID;
    return `<div class="lg-pod p${i+1}${isMe?' me':''}">
      ${i===0 ? '<div class="lg-crown">👑</div>' : ''}
      <div class="lg-pod-av">${avatar(r.username, 'xl')}<span class="lg-pod-flag">${COUNTRY_FLAGS[r.country] || '🏳️'}</span></div>
      <div class="lg-pod-name">${esc(r.username || 'Anónimo')}${isMe?' <span class="lb-you-badge">TÚ</span>':''}</div>
      <div class="lg-pod-score">${formatScore(Number(r.score))}</div>
      <div class="lg-pod-step"><span>${i+1}</span></div>
    </div>`;
  };
  // Podio clásico: el 2.º a la izquierda, el 1.º en el centro y el 3.º a la derecha.
  const podium = list.length ? `<div class="lg-podium">${[1,0,2].filter(i => i < list.length).map(i => pod(list[i], i)).join('')}</div>` : '';

  const rows = list.slice(3).map((r,k) => {
    const i = k + 3;
    const isMe = r.user_id === CURRENT_USER_ID;
    const pct = Math.max(4, Math.round((Number(r.score) || 0) / topScore * 100));
    return `
    <div class="lg-row${isMe?' me':''}" style="animation-delay:${Math.min(k*0.03,0.4)}s;">
      <div class="lg-row-pos">${i+1}</div>
      ${avatar(r.username)}
      <div class="lg-row-info">
        <div class="lg-row-name"><span>${esc(r.username || 'Anónimo')}</span>${isMe?' <span class="lb-you-badge">TÚ</span>':''}<em>${COUNTRY_FLAGS[r.country] || '🏳️'}</em></div>
        <div class="lg-row-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="lg-row-score">${formatScore(Number(r.score))}</div>
    </div>`;
  }).join('');

  const stat = (icon, val, label) => `<div class="lg-sum"><span class="lg-sum-ic">${ic(icon)}</span><div><b>${val}</b><small>${label}</small></div></div>`;
  const summaryStripHtml = `
  <div class="lg-sumrow">
    ${stat('users', participants===null?'...':participants, 'Participantes')}
    ${stat('trophy', s?'#'+s.rank:(s===false?'—':'...'), 'Tu posición')}
    ${stat('target', s?formatScore(Number(s.score)):(s===false?'—':'...'), 'Récord personal')}
  </div>`;

  let standingHtml = '';
  if(s && s.rank>25){
    const gapText = s.nextAbove
      ? `Te faltan <strong>${formatScore(Number(s.nextAbove.score) - Number(s.score))}</strong> puntos para superar a ${esc(s.nextAbove.username || 'el jugador de arriba')}.`
      : 'Eres el primero de la lista en esta clasificación.';
    const milestoneText = (s.milestoneRank && s.milestoneScore!=null)
      ? `Te faltan <strong>${formatScore(Number(s.milestoneScore) - Number(s.score))}</strong> puntos para entrar en el Top ${s.milestoneRank}.`
      : (s.rank<=10 ? '¡Ya estás en el Top 10! 🎉' : '');
    standingHtml = `
    <div class="lb-standing">
      <div class="lg-stand-title">Tu posición</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="lb-rank" style="color:rgba(255,255,255,0.7); width:auto; min-width:34px;">#${s.rank}</div>
        <div class="lb-flag">${COUNTRY_FLAGS[s.country] || '🏳️'}</div>
        <div class="lb-info">
          <div class="lb-name">${esc(s.username || 'Tú')} <span class="lb-you-badge">TÚ</span></div>
        </div>
        <div class="lb-score">${formatScore(Number(s.score))}</div>
      </div>
      <div class="lb-gap">${gapText}</div>
      ${milestoneText ? `<div class="lb-gap">${milestoneText}</div>` : ''}
    </div>`;
  } else if(s===false){
    standingHtml = `<div class="lg-empty-me">${ic('flame')}<div>Todavía no tienes puntuación en este modo. ¡Juega una partida para entrar en la clasificación!</div></div>`;
  } else if(s){
    // Dentro del Top 25: resumen de tu posición y lo que te falta para subir.
    const gapText = s.rank <= 1
      ? '¡Eres el número 1 de esta clasificación! 🎉'
      : s.nextAbove
        ? `Te faltan <strong>${formatScore(Number(s.nextAbove.score) - Number(s.score))}</strong> puntos para superar a ${esc(s.nextAbove.username || 'el jugador de arriba')}.`
        : '';
    standingHtml = `
    <div class="lb-standing">
      <div class="lg-stand-title">Tu posición</div>
      <div class="lg-stand-big"><b>#${s.rank}</b><span>Estás en el Top 25</span></div>
      <div class="lg-stand-score">${formatScore(Number(s.score))} <small>puntos en ${modeTitle}</small></div>
      ${gapText ? `<div class="lb-gap">${gapText}</div>` : ''}
    </div>`;
  }

  const seg = (m, icon, label) => `<button class="${mode===m?'active':''}" data-action="leaderboard-tab" data-mode="${m}">${ic(icon)}<span>${label}</span></button>`;

  return `
  <button class="backbtn" data-action="dailyChallenge">&larr; WEREF League</button>
  <section class="lg-hero lg-hero-sm">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Clasificación global · Top 25</div>
      <h1>${modeTitle}</h1>
    </div>
    <div class="lg-seg">
      ${seg('hearts', 'heart', 'Corazones')}
      ${seg('suddendeath', 'skull', 'Muerte Súbita')}
      ${seg('timeattack', 'timer', 'Contrarreloj')}
    </div>
  </section>
  ${summaryStripHtml}
  <div class="lg-lb-layout ${standingHtml ? 'has-side' : ''}">
    <div class="lg-lb-main">
      ${podium}
      ${rows ? `<div class="lg-list">${rows}</div>` : ''}
      ${list.length ? '' : '<div class="empty-state">Todavía no hay puntuaciones en este modo. ¡Sé el primero!</div>'}
    </div>
    ${standingHtml ? `<aside class="lg-lb-side">${standingHtml}</aside>` : ''}
  </div>
  `;
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
  const optionCount = STATE.myBankOptionCount || (editing ? editing.options.length : 4);
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
      <label>Número de opciones de respuesta</label>
      <select id="mb-option-count">
        ${[3,4].map(n=>`<option value="${n}" ${optionCount===n?'selected':''}>${n} opciones</option>`).join('')}
      </select>
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
  const optionCount = STATE.myBankOptionCount || (existingQ ? existingQ.options.length : 4);
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
    perQSeconds = Math.max(5, opts.secondsPerQuestion || 45);
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

function achievementsView(){
  const ic = (n) => shellIcon(n);
  const points = computePoints();
  const rank = currentRank(points);
  const next = nextRankInfo(points);
  const unlocked = STATE.storage.unlockedBadges || {};
  const unlockedCount = BADGES.filter(b => unlocked[b.id]).length;
  const rankIdx = Math.max(0, RANKS.findIndex(r => r.name === rank.name));

  const rankRows = RANKS.map((r, i) => {
    const reached = points >= r.min;
    const current = r.name === rank.name;
    return `<div class="rk-step ${reached ? 'reached' : ''} ${current ? 'current' : ''}">
      <span class="rk-dot">${reached ? ic('check') : ''}</span>
      <div class="rk-step-body">
        <div class="rk-step-name">${esc(r.name)}${current ? '<em>Tu rango</em>' : ''}</div>
        <div class="rk-step-min">${r.min} pts</div>
        ${current && next ? `<div class="rk-step-bar"><i style="width:${next.progressPct}%"></i></div><div class="rk-step-hint">${next.remaining} puntos para ${esc(next.name)}</div>` : ''}
        ${current && !next ? '<div class="rk-step-hint">¡Has alcanzado el rango máximo!</div>' : ''}
      </div>
    </div>`;
  }).join('');

  const badgeCards = BADGES.map(b => {
    const isUnlocked = !!unlocked[b.id];
    return `<div class="rk-badge ${isUnlocked ? 'on' : 'off'}">
      <span class="rk-badge-ic">${b.icon}</span>
      <div class="rk-badge-body">
        <strong>${b.name}</strong>
        <small>${b.desc}</small>
      </div>
      <span class="rk-badge-state">${isUnlocked ? ic('check') : ic('lock')}</span>
    </div>`;
  }).join('');

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Tu progreso arbitral</div>
      <h1>${esc(rank.name)}</h1>
      <p>${points} puntos por preguntas acertadas, tests completados y racha de estudio. ${next ? `Te faltan ${next.remaining} para ser ${esc(next.name)}.` : '¡Has alcanzado el rango máximo!'}</p>
      ${next ? `<div class="rk-hero-bar"><i style="width:${next.progressPct}%"></i></div><div class="rk-hero-bar-label">${next.progressPct}% hacia ${esc(next.name)}</div>` : ''}
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${points}</b><span>Puntos</span></div>
      <div class="lg-stat"><b>${rankIdx + 1}/${RANKS.length}</b><span>Rango</span></div>
      <div class="lg-stat"><b>${unlockedCount}/${BADGES.length}</b><span>Insignias</span></div>
    </div>
  </section>

  <div class="rk-layout">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('award')}</span><div><h3>Escala de rangos</h3><small>Sube de rango sumando puntos</small></div></div>
      <div class="rk-ladder">${rankRows}</div>
    </div>
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('trophy')}</span><div><h3>Insignias</h3><small>${unlockedCount} de ${BADGES.length} conseguidas</small></div></div>
      <div class="rk-badges">${badgeCards}</div>
    </div>
  </div>
  `;
}

async function loadProfileData(){
  try{
    const { data } = await supabaseClient.auth.getUser();
    STATE.profileData = (data && data.user && data.user.user_metadata) || {};
  }catch(e){
    STATE.profileData = {};
  }
  render();
}

function profileView(){
  const ic = (n) => shellIcon(n);
  const email = (typeof CURRENT_USER_EMAIL!=='undefined' && CURRENT_USER_EMAIL) ? CURRENT_USER_EMAIL : '';
  const username = (typeof CURRENT_USERNAME!=='undefined' && CURRENT_USERNAME) ? CURRENT_USERNAME : '';
  const points = computePoints();
  const rank = currentRank(points);
  const unlockedCount = BADGES.filter(b => (STATE.storage.unlockedBadges || {})[b.id]).length;
  const p = STATE.profileData;
  const fullName = p ? [p.full_name, p.last_name].filter(Boolean).join(' ') : '';
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
      <div class="lg-stat"><b>${unlockedCount}/${BADGES.length}</b><span>Insignias</span></div>
      <div class="lg-stat"><b>${esc(rank.name.replace('Árbitro ', ''))}</b><span>Rango</span></div>
    </div>
  </section>

  <div class="pr-layout">
    <div class="tc-card">
      <div class="tc-card-head"><span class="tc-step">${ic('users')}</span><div><h3>Datos de la cuenta</h3><small>Tu nombre de usuario no se puede cambiar</small></div></div>
      ${p ? `
        ${row('award', 'Usuario', username)}
        ${row('message', 'Correo', email)}
        ${row('pencil', 'Nombre', p.full_name)}
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
        <div><label for="profile-name">Nombre</label><input type="text" id="profile-name" maxlength="100" value="${esc(p.full_name||'')}"></div>
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
  const updated = {
    full_name: document.getElementById('profile-name').value.trim(),
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
  const savedCount = Object.keys(savedMap).length;
  const hasContent = docsCount>0 || bankCount>0 || savedCount>0;

  const docsLastTs = docsCount>0 ? Math.max(...docs.map(d=>d.createdAt||0)) : null;
  const bankLastTs = bankCount>0 ? Math.max(...bank.map(q=>q.createdAt||0)) : null;
  const savedLastTs = savedCount>0 ? Math.max(...Object.values(savedMap).map(v=>Number(v)||0)) : null;
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

function homeView(){
  const os = overallStats();
  const points = computePoints();
  const rank = currentRank(points);
  const next = nextRankInfo(points);
  const rp = recentPerformance(20);
  const streak = computeStreak();
  const weak = weakestRuleRecent(20);
  const goal = STATE.storage.dailyGoal || 20;
  const today = todaysAnsweredCount();
  const goalPct = Math.min(100, Math.round(today / goal * 100));
  const name = (typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) ? CURRENT_USERNAME : '';
  const hour = new Date().getHours();
  const greeting = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const ic = (n) => shellIcon(n);

  const heroTitle = today >= goal ? '¡Objetivo de hoy cumplido!'
    : today > 0 ? `Llevas ${today} de ${goal} preguntas hoy`
    : 'Prepárate para tu próximo examen';
  const heroSub = next
    ? `${rank.name} · ${points} puntos · te faltan ${next.remaining} para ser ${next.name}`
    : `${rank.name} · ${points} puntos · has alcanzado el rango máximo`;
  const heroPrimary = weak
    ? `<button class="btn btn-yellow" data-action="open-law" data-law="${weak.rule}">${ic('play')} Reforzar Regla ${weak.rule}</button>`
    : `<button class="btn btn-yellow" data-action="train-config">${ic('play')} Empezar a entrenar</button>`;

  const hero = `
  <section class="home-hero">
    <div>
      <div class="home-eyebrow">${greeting}${name ? ', ' + esc(name) : ''}</div>
      <h1>${heroTitle}</h1>
      <p>${heroSub}</p>
      <div class="home-hero-actions">
        ${heroPrimary}
        <button class="btn home-btn-light" data-action="start-daily-goal" data-count="10">${ic('zap')} Test rápido · 10 preguntas</button>
      </div>
    </div>
    <button class="home-hero-rank" data-action="achievements" title="Ver tu rango e insignias">
      <div class="ring">${ringSVG(next ? next.progressPct : 100, 84, 7)}<div class="pct" style="font-size:14px;">${points}</div></div>
      <div><div class="rank-name">${esc(rank.name)}</div><div class="rank-sub">${next ? next.progressPct + '% hacia ' + esc(next.name) : 'Rango máximo'}</div></div>
    </button>
  </section>`;

  const kpis = `
  <div class="home-kpis">
    <button class="kpi" data-action="stats">
      <div class="kpi-top">${ic('chart')} Progreso</div>
      <div class="kpi-val">${os.completionPct}<small>%</small></div>
      <div class="kpi-bar"><div style="width:${os.completionPct}%"></div></div>
      <div class="kpi-sub">${os.attempted} de ${os.total} preguntas</div>
    </button>
    <button class="kpi" data-action="recent-performance">
      <div class="kpi-top">${ic('target')} Acierto reciente</div>
      <div class="kpi-val" ${rp ? `style="color:${scoreColor(rp.pct)};"` : ''}>${rp ? rp.pct + '<small>%</small>' : '—'}</div>
      <div class="kpi-sub">${rp ? 'en tus últimos 20 tests' : 'Completa un test para verlo'}</div>
    </button>
    <button class="kpi" data-action="streak-calendar">
      <div class="kpi-top">${ic('flame')} Racha</div>
      <div class="kpi-val">${streak}<small> ${streak === 1 ? 'día' : 'días'}</small></div>
      <div class="kpi-sub">${streak === 0 ? 'Empieza hoy tu racha' : `Mejor racha: ${Math.max(streak, STATE.storage.maxStreak || 0)} días`}</div>
    </button>
    <div class="kpi">
      <div class="kpi-top">${ic('check')} Objetivo de hoy</div>
      <div class="kpi-val">${today}<small> / ${goal}</small></div>
      <div class="kpi-bar"><div style="width:${goalPct}%; ${goalPct >= 100 ? 'background:var(--green-ok);' : ''}"></div></div>
      <div class="kpi-sub">${goalPct >= 100 ? '¡Cumplido!' : `Te faltan ${goal - today} preguntas`}</div>
    </div>
  </div>`;

  /* Reglas de Juego */
  let cards = '';
  for(let i = 1; i <= 17; i++){
    const s = lawStats(i);
    const crownLevel = (STATE.storage.crownLevels || {})[i] || 0;
    cards += `<button class="law-card" data-action="open-law" data-law="${i}">
      ${crownBadge(crownLevel)}
      <div class="law-icon">${LAW_ICONS[i]}</div>
      <div class="law-num">${i}</div>
      <div class="law-name">${esc(LAW_NAMES[i])}</div>
      <div class="law-meta">
        <div class="law-bar-bg"><div class="law-bar-fill" style="width:${s.completionPct}%"></div></div>
        <div class="law-pct">${s.completionPct}%</div>
      </div>
      <div class="law-sub">${lawSubLine(s)}</div>
    </button>`;
  }

  /* Salas especiales: van en la misma cuadrícula que las 17 reglas */
  const gs = lawStats('glossary');
  const hs = lawStats('hard');
  const fs2 = lawStats('failed');
  const as2 = lawStats('assistants');
  const failRatio = os.attempted > 0 ? Math.round(fs2.total / os.attempted * 100) : 0;
  cards += `<button class="law-card law-card-failed" data-action="open-law" data-law="failed">
      <div class="law-icon">${ic('repeat')}</div>
      <div class="law-num">R</div>
      <div class="law-name">Sala de Repaso</div>
      <div class="hard-tag">Preguntas falladas</div>
      <div class="law-meta">
        <div class="law-bar-bg"><div class="law-bar-fill" style="width:${failRatio}%; background:var(--yellow-ink);"></div></div>
        <div class="law-pct">${failRatio}%</div>
      </div>
      <div class="law-sub">${fs2.total === 0 ? '<span class="law-sub-muted">¡Nada pendiente!</span>' : fs2.total + (fs2.total === 1 ? ' pregunta por repasar' : ' preguntas por repasar')}</div>
    </button>
    <button class="law-card law-card-hard" data-action="open-law" data-law="hard">
      <div class="law-icon">${ic('shield')}</div>
      <div class="law-num">VAR</div>
      <div class="law-name">Sala VAR</div>
      <div class="hard-tag">Modo difícil</div>
      <div class="law-meta">
        <div class="law-bar-bg"><div class="law-bar-fill" style="width:${hs.completionPct}%; background:var(--red);"></div></div>
        <div class="law-pct">${hs.completionPct}%</div>
      </div>
      <div class="law-sub">${hs.total === 0 ? '<span class="law-sub-muted">Todavía no hay ninguna</span>' : lawSubLine(hs)}</div>
    </button>
    <button class="law-card law-card-hard law-card-assist" data-action="open-law" data-law="assistants">
      <div class="law-icon">${ic('flag')}</div>
      <div class="law-num">A</div>
      <div class="law-name">Árbitros Asistentes</div>
      <div class="hard-tag">Sala especial</div>
      <div class="law-meta">
        <div class="law-bar-bg"><div class="law-bar-fill" style="width:${as2.completionPct}%"></div></div>
        <div class="law-pct">${as2.completionPct}%</div>
      </div>
      <div class="law-sub">${as2.total === 0 ? '<span class="law-sub-muted">Próximamente</span>' : lawSubLine(as2)}</div>
    </button>
    <button class="law-card" data-action="open-law" data-law="glossary">
      <div class="law-icon">${ic('glossary')}</div>
      <div class="law-num">G</div>
      <div class="law-name">Preguntas Glosario</div>
      <div class="law-meta">
        <div class="law-bar-bg"><div class="law-bar-fill" style="width:${gs.completionPct}%"></div></div>
        <div class="law-pct">${gs.completionPct}%</div>
      </div>
      <div class="law-sub">${lawSubLine(gs)}</div>
    </button>`;

  /* Columna derecha */
  const todayISO = todayKeyISO();
  const nextEvent = (STATE.storage.calendarEvents || [])
    .filter(ev => ev.date >= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  let eventHtml;
  if(nextEvent){
    const t = CALENDAR_EVENT_TYPES[nextEvent.type] || CALENDAR_EVENT_TYPES.other;
    const daysUntil = Math.round((new Date(nextEvent.date + 'T00:00:00') - new Date(todayISO + 'T00:00:00')) / 86400000);
    const whenLabel = daysUntil === 0 ? 'Es hoy' : daysUntil === 1 ? 'Es mañana' : `Faltan ${daysUntil} días`;
    eventHtml = `<button class="qcard home-card-btn" data-action="streak-calendar">
      <div class="home-card-title">${ic('calendar')} Próximo evento</div>
      <div class="home-card-text"><strong>${t.icon} ${esc(nextEvent.title)}</strong></div>
      <div class="home-card-text">${formatEventDate(nextEvent.date)}</div>
      <div class="home-card-text" style="color:${t.color}; font-weight:700;">${whenLabel}</div>
      <div class="home-card-link">Ver calendario →</div>
    </button>`;
  } else {
    eventHtml = `<button class="qcard home-card-btn" data-action="streak-calendar">
      <div class="home-card-title">${ic('calendar')} Calendario de estudio</div>
      <div class="home-card-text" style="color:var(--muted);">Apunta tus exámenes y fechas importantes para no perder el ritmo.</div>
      <div class="home-card-link">Abrir calendario →</div>
    </button>`;
  }

  const weakHtml = weak
    ? `<button class="qcard home-card-btn" data-action="open-law" data-law="${weak.rule}">
        <div class="home-card-title">${ic('target')} Recomendación para hoy</div>
        <div class="home-card-text"><strong>Regla ${weak.rule} · ${esc(LAW_NAMES[weak.rule])}</strong></div>
        <div class="home-card-text" style="color:${scoreColor(weak.pct)}; font-weight:700;">${weak.pct}% de acierto: es tu regla más floja</div>
        <div class="home-card-link">Practicar ahora →</div>
      </button>`
    : `<div class="qcard">
        <div class="home-card-title">${ic('target')} Recomendación para hoy</div>
        <div class="home-card-text" style="color:var(--muted);">Completa algunos tests y aquí te diré qué regla conviene reforzar.</div>
      </div>`;

  const flagCount = Object.keys(STATE.storage.flags || {}).length;
  const flaggedHtml = flagCount > 0
    ? `<button class="qcard home-card-btn" data-action="flagged-list" style="display:flex; align-items:center; gap:10px;">
        <span style="color:var(--accent);">${ic('flag')}</span>
        <span style="font-weight:700; font-size:14px;">Preguntas marcadas</span>
        <span class="badge" style="margin-left:auto;">${flagCount}</span>
      </button>`
    : '';

  const cst = (typeof COMMITTEE !== 'undefined') ? COMMITTEE.status : null;
  const committeeHtml = (cst && (cst.is_admin || cst.is_member))
    ? `<button class="qcard home-card-btn" data-action="committee-open">
        <div class="home-card-title">${ic('users')} Formación Comité Bages</div>
        <div class="home-card-text" style="color:var(--muted);">${cst.is_admin ? 'Gestiona miembros, tests y clasificación.' : 'Tests mensuales del comité de árbitros.'}</div>
        <div class="home-card-link">Entrar →</div>
      </button>`
    : '';

  const suggestHtml = `<div class="home-panel" style="text-align:center;">
    <div style="font-weight:700; font-size:14px; color:var(--pitch); margin-bottom:4px;">Construyamos WEREF juntos</div>
    <div style="font-size:12.5px; color:var(--muted); margin-bottom:12px;">¿Una idea o algo que mejorar? Cuéntanoslo.</div>
    <button class="btn btn-secondary" style="padding:8px 14px; font-size:12.5px;" data-action="open-suggest">Enviar una sugerencia</button>
  </div>`;

  return `
  ${hero}
  ${kpis}
  <div class="home-cols">
    <div class="home-left">
      <div class="home-section-head">
        <h2>Reglas de Juego</h2>
        <button class="btn btn-secondary" style="padding:8px 14px; font-size:12.5px;" data-action="train-config">+ Crear test personalizado</button>
      </div>
      <div class="law-grid">${cards}</div>
    </div>
    <aside class="home-right">
      ${weakHtml}
      ${eventHtml}
      ${committeeHtml}
      ${flaggedHtml}
      ${suggestHtml}
    </aside>
  </div>
  `;
}

function lawMenuView(){
  const ic = (n) => shellIcon(n);
  const law = STATE.lawId;
  const s = lawStats(law);
  const scopeIds = questionsForLaw(law).map(q=>q.id);
  const flaggedCount = Object.keys(STATE.storage.flags).filter(id => scopeIds.includes(id)).length;
  const isHard = law === 'hard';
  const isFailed = law === 'failed';
  const isGlossary = law === 'glossary';
  const isAssistants = law === 'assistants';
  const isSaved = law === 'saved';
  const isRule = typeof law === 'number';
  const backAction = isSaved ? 'academia' : 'home';
  const backLabel = isSaved ? '&larr; Mi Academia' : '&larr; Todas las reglas';
  const acc = s.attempted > 0 ? s.accuracyPct + '%' : '—';
  const crown = isRule ? ((STATE.storage.crownLevels || {})[law] || 0) : 0;

  let theme = '', eyebrow, title, desc, stats;
  if(isHard){
    theme = 'th-var'; eyebrow = 'Sala VAR · Modo difícil'; title = 'Sala VAR';
    desc = 'Las preguntas más difíciles de toda la plataforma. ¿Estás a la altura?';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto'], [s.total, 'Preguntas']];
  } else if(isFailed){
    theme = 'th-failed'; eyebrow = 'Sala de Repaso · Preguntas falladas'; title = 'Sala de Repaso';
    desc = s.total > 0 ? 'Tienes preguntas pendientes de repasar. ¡A por ellas!' : 'Nada pendiente. Sigue haciendo tests y aquí aparecerán las que falles.';
    stats = [[s.total, 'Pendientes'], [acc, 'Acierto'], ['3', 'Aciertos para salir']];
  } else if(isGlossary){
    eyebrow = 'Glosario IFAB'; title = 'Preguntas Glosario';
    desc = 'Términos y definiciones de las Reglas de Juego.';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto'], [s.total, 'Preguntas']];
  } else if(isAssistants){
    theme = 'th-assist'; eyebrow = 'Sala especial'; title = 'Árbitros Asistentes';
    desc = s.total > 0 ? 'Preguntas específicas para árbitros asistentes.' : 'Estamos preparando las preguntas de Árbitros Asistentes.';
    stats = [[s.completionPct + '%', 'Progreso'], [acc, 'Acierto'], [s.total, 'Preguntas']];
  } else if(isSaved){
    eyebrow = 'Mi Academia · Privado'; title = 'Preguntas guardadas';
    desc = 'Todas las preguntas que has marcado para repasar más adelante.';
    stats = [[s.total, s.total === 1 ? 'Guardada' : 'Guardadas'], [s.completionPct + '%', 'Repasado'], [acc, 'Acierto']];
  } else {
    eyebrow = 'Regla ' + law + ' · IFAB'; title = esc(LAW_NAMES[law]);
    desc = s.total + ' preguntas de esta regla para practicar a tu ritmo.';
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

  ${(isSaved || flaggedCount>0) ? `<div class="lw-extras">
    ${isSaved ? `<button class="lw-extra" data-action="saved-browse"><span class="lw-extra-ic">${ic('eye')}</span><span><strong>Ver tus guardadas</strong><small>Repásalas de una en una, con la respuesta y explicación</small></span><span class="ac-folder-go">${ic('chevron')}</span></button>` : ''}
    ${flaggedCount>0 ? `<button class="lw-extra" data-action="review-flagged" data-law="${law}"><span class="lw-extra-ic">${ic('flag')}</span><span><strong>Revisar marcadas <em>${flaggedCount}</em></strong><small>Preguntas que marcaste como posiblemente desactualizadas</small></span><span class="ac-folder-go">${ic('chevron')}</span></button>` : ''}
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
  return pool.map(q=>q.id);
}

function startQuiz(law, mode){
  const qids = mode==='review' ? Object.keys(STATE.storage.flags).filter(id=>{
      const q=allQuestions().find(x=>x.id===id); return q && (!law || q.rule===law);
    }) : pickQuestions(law, mode);
  if(qids.length===0){ STATE.toast="No hay preguntas disponibles para este modo."; render(); return; }
  STATE.quiz = { qids, idx:0, mode: mode||'short', law, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
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
  let pool = opts.scopeOverride ? questionsForLaw(opts.scopeOverride)
    : trainPoolForLaws(opts.laws);
  pool = shuffle(pool.slice());
  const count = Math.max(1, Math.min(opts.count || 20, 50, pool.length));
  pool = pool.slice(0, count);
  if(pool.length===0){ STATE.toast = opts.scopeOverride==='failed' ? "No tienes preguntas falladas con esos filtros. ¡Buen trabajo!" : "No hay preguntas disponibles con esos filtros."; render(); return; }

  let timerMode = opts.timerMode || 'none';
  let timeSec = 0, remainingSec = 0, perQSeconds = 0;
  if(timerMode==='total'){
    timeSec = (opts.minutes && opts.minutes > 0) ? Math.round(opts.minutes*60) : 0;
    if(timeSec<=0) timerMode='none';
    remainingSec = timeSec;
  } else if(timerMode==='perQuestion'){
    perQSeconds = Math.max(5, opts.secondsPerQuestion || 45);
    remainingSec = perQSeconds;
  }

  STATE.quiz = {
    qids: pool.map(q=>q.id), idx:0, mode:'training', law: opts.scopeOverride || null,
    answers:{}, instantFeedback: !!opts.instantFeedback, timerMode, timeSec, remainingSec, perQSeconds
  };
  STATE.quiz.shuffled = buildQuizShuffleMap(STATE.quiz.qids);
  STATE.view = 'quiz';
  render();
  if(timerMode==='total' || timerMode==='perQuestion') startTimer();
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

function questionDots(quiz){
  const letters=['a','b','c','d'];
  const visibleQids = isRecordMode(quiz.mode) ? quiz.qids.slice(0, quiz.idx+1) : quiz.qids;
  const dots = visibleQids.map((qid,i)=>{
    const sel = quiz.answers[qid];
    const timedOut = !!(quiz.timedOut && quiz.timedOut[qid]);
    const isCurrent = i === quiz.idx;
    let cls = 'q-dot';
    if(isCurrent) cls += ' current';
    if(sel){
      if(quiz.instantFeedback){
        const q = quizQuestionById(qid, quiz);
        cls += (sel===q.correct) ? ' ok' : ' bad';
      } else {
        cls += ' answered';
      }
    } else if(timedOut){
      cls += ' bad';
    }
    const clickable = !quiz.instantFeedback || !!sel || timedOut;
    return `<${clickable?'button':'div'} class="${cls}" ${clickable?`data-action="goto-question" data-idx="${i}"`:''}>${i+1}</${clickable?'button':'div'}>`;
  }).join('');
  return `<div class="q-dots">${dots}</div>`;
}

function quizView(){
  const ic = (n) => shellIcon(n);
  const quiz = STATE.quiz;
  const q = currentQ();
  const total = quiz.qids.length;
  const pct = Math.round((quiz.idx)/total*100);
  const letters=['a','b','c','d'];
  const selectedLetter = quiz.answers[q.id] || null;
  const timedOut = !!(quiz.timedOut && quiz.timedOut[q.id]);
  const reveal = quiz.instantFeedback && (!!selectedLetter || timedOut);
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
    ? `<button class="flag-btn" data-action="report-question" data-qid="${q.id}" data-tooltip="Ya has avisado de un posible error en esta pregunta. Nuestro equipo la revisará.">${ic('check')} Error reportado, ¡gracias!</button>`
    : `<button class="flag-btn" data-action="report-question" data-qid="${q.id}" data-tooltip="Avisa si crees que esta pregunta tiene un error o está desactualizada, para que la revisemos.">${ic('flag')} Reportar un error</button>`;
  const savedBtn = STATE.storage.saved[q.id]
    ? `<button class="flag-btn on" data-action="toggle-saved" data-qid="${q.id}" data-tooltip="Quítala de tu lista personal si ya no quieres tenerla guardada.">${ic('star')} Guardada en Mi Academia</button>`
    : `<button class="flag-btn" data-action="toggle-saved" data-qid="${q.id}" data-tooltip="La pregunta se añadirá a tu lista personal en Mi Academia, para repasarla más tarde.">${ic('star')} Guardar en Mi Academia</button>`;
  const actionLinksRow = `<div class="qz-links">${savedBtn}${reportBtn}</div>`;

  let info, status;
  if(quiz.mode==='training'){
    info = `<strong>Pregunta ${quiz.idx+1} / ${total}</strong><small>Respondidas: ${Object.keys(quiz.answers).length}/${total}</small>`;
    status = quiz.timerMode==='total' ? `<span class="qz-chip">${ic('clock')}<span class="mono" id="timer-display">${formatTime(quiz.remainingSec)}</span></span>` :
      quiz.timerMode==='perQuestion' ? `<span class="qz-chip">${ic('timer')}<span class="mono" id="timer-display">${formatTime(quiz.remainingSec)}</span></span>` :
      `<span class="qz-chip soft">${ic('repeat')} Sin límite</span>`;
  } else if(isLifeMode(quiz.mode)){
    const maxLives = maxLivesFor(quiz.mode);
    info = `<strong>${quiz.combo>=2 ? 'Racha: ' + quiz.combo : 'Pregunta ' + (quiz.idx+1)}</strong><small>${quiz.mode==='suddendeath' ? 'Muerte Súbita' : 'Modo Corazones'}</small>`;
    status = quiz.mode==='suddendeath'
      ? `<span class="qz-chip ${quiz.hearts>0 ? 'bad' : 'soft'}">${ic('skull')} ${quiz.hearts>0 ? 'Una vida' : 'Eliminado'}</span>`
      : `<span class="qz-hearts">${Array.from({length:maxLives}, (_,i) => `<span class="qz-heart ${i < quiz.hearts ? 'on' : ''}">${ic('heart')}</span>`).join('')}</span>`;
  } else if(quiz.mode==='timeattack'){
    info = `<strong>Contrarreloj</strong><small>Aciertos: ${correctCount()}</small>`;
    status = `<span class="qz-chip">${ic('timer')}<span class="mono" id="timer-display">${formatTime(quiz.remainingSec)}</span></span>`;
  } else {
    const scoreLabel = quiz.law==='failed'
      ? `Aciertos seguidos: ${STATE.storage.failedStreaks[q.id]||0}/3`
      : `Aciertos: ${correctCount()}`;
    info = `<strong>Pregunta ${quiz.idx+1} / ${total}</strong><small>${scoreLabel}</small>`;
    status = `<span class="qz-chip soft">${ic('target')} ${correctCount()}</span>`;
  }

  let actions;
  if(quiz.mode==='training'){
    actions = `
      <button class="btn btn-secondary" data-action="prev-question" ${quiz.idx===0?'disabled':''}>&larr; Anterior</button>
      ${quiz.idx+1<total ? `<button class="btn btn-secondary" data-action="next-question">Siguiente &rarr;</button>` : ''}
      <button class="btn btn-primary" data-action="finish-training">Finalizar examen</button>
    `;
  } else {
    const isGameOver = isLifeMode(quiz.mode) && quiz.hearts<=0;
    actions = `
      <button class="btn btn-secondary" data-action="prev-question" ${quiz.idx===0?'disabled':''}>&larr; Anterior</button>
      ${reveal ? `<button class="btn btn-primary" data-action="next-question">${isGameOver ? 'Ver resultado' : (quiz.idx+1<total?'Siguiente &rarr;':'Ver resultado')}</button>` : ''}
    `;
  }

  return `
  <div class="qz">
    <header class="qz-top">
      <button class="qz-exit" data-action="quit-quiz" aria-label="Salir del test">${ic('chevron')}<span>Salir</span></button>
      <div class="qz-info">${info}</div>
      <div class="qz-status">${status}</div>
    </header>
    <div class="qz-progress"><i style="width:${pct}%"></i></div>
    <article class="qz-card">
      <div class="qz-tag">${scopeLabel(q)}</div>
      <h2 class="qz-text">${esc(q.question)}</h2>
      <div class="qz-options">${optsHtml}</div>
      ${feedback}
      ${quiz.mode!=='training' ? (reveal ? actionLinksRow : '') : actionLinksRow}
    </article>
    <div class="qz-actions">${actions}</div>
    ${questionDots(quiz)}
  </div>
  `;
}

function selectAnswer(letter){
  const quiz = STATE.quiz;
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
  const letters=['a','b','c','d'];
  const scopeQids = isRecordMode(quiz.mode) ? quiz.qids.filter(qid => quiz.answers[qid]) : quiz.qids;
  const total = scopeQids.length;
  let score = 0;
  const byLaw = {};
  scopeQids.forEach(qid=>{
    const q = quizQuestionById(qid, quiz);
    const sel = quiz.answers[qid];
    const ok = sel === q.correct;
    if(ok) score++;
    if(!byLaw[q.rule]) byLaw[q.rule]={total:0,correct:0};
    byLaw[q.rule].total++;
    if(ok) byLaw[q.rule].correct++;
  });
  const pct = total ? Math.round(score/total*100) : 0;
  const unanswered = isRecordMode(quiz.mode) ? 0 : quiz.qids.filter(qid => !quiz.answers[qid]).length;
  let rows = Object.keys(byLaw).sort((a,b)=>a-b).map(law=>{
    const b = byLaw[law];
    const rulePct = Math.round(b.correct/b.total*100);
    return `<button class="breakdown-row" data-action="open-law" data-law="${law}" style="width:100%; text-align:left; border:none; cursor:pointer; font:inherit; color:inherit;"><span>Regla ${law} · ${esc(LAW_NAMES[law])}</span><span class="mono" style="color:${scoreColor(rulePct)};">${rulePct}%</span></button>`;
  }).join('');

  return `
  ${isRecordMode(quiz.mode) ? `<div class="result-hero" style="margin-bottom:16px; ${STATE.lastHeartsResult && STATE.lastHeartsResult.isNewRecord ? 'border-color:var(--accent);' : ''}">
    <div style="font-size:28px;">${STATE.lastHeartsResult && STATE.lastHeartsResult.isNewRecord ? '🏆' : (quiz.mode==='suddendeath' ? '💀' : quiz.mode==='timeattack' ? '⏱' : '❤️')}</div>
    <div class="big" style="color:var(--pitch); font-size:38px;">${STATE.lastHeartsResult ? formatScore(STATE.lastHeartsResult.score) : score}</div>
    <div class="label">${STATE.lastHeartsResult && STATE.lastHeartsResult.isNewRecord ? '¡Nuevo récord personal!' : 'puntos · tu récord: '+formatScore(quiz.mode==='suddendeath' ? STATE.storage.suddenDeathRecord : quiz.mode==='timeattack' ? STATE.storage.timeAttackRecord : STATE.storage.heartsRecord)}</div>
    ${quiz.mode==='timeattack' ? `<div style="font-size:11.5px; color:var(--muted); margin-top:6px;">Cada fallo resta 0,5 puntos</div>` : ''}
  </div>` : ''}
  <div class="result-hero">
    <div class="big" style="color:${scoreColor(pct)};">${pct}%</div>
    <div class="label">${score} de ${total} respuestas correctas${unanswered>0?' · '+unanswered+' sin responder':''}</div>
  </div>
  <div class="q-dots" style="margin-top:14px; margin-bottom:6px;">
    ${scopeQids.map((qid,i)=>{
      const q = quizQuestionById(qid, quiz);
      const sel = quiz.answers[qid];
      const ok = sel === (q ? q.correct : null);
      const cls = sel ? (ok ? 'ok' : 'bad') : '';
      return `<button class="q-dot ${cls}" data-action="toggle-review-detail" data-idx="${i}">${i+1}</button>`;
    }).join('')}
  </div>
  ${(STATE.reviewDetailIdx!==null && STATE.reviewDetailIdx!==undefined && scopeQids[STATE.reviewDetailIdx]) ? (function(){
    const qid = scopeQids[STATE.reviewDetailIdx];
    const q = quizQuestionById(qid, quiz);
    const sel = quiz.answers[qid];
    const letters2 = ['a','b','c','d'];
    return `<div class="qcard" style="margin-bottom:14px;">
      <div class="qtag">Pregunta ${STATE.reviewDetailIdx+1} · ${scopeLabel(q)} ${sel ? (sel===q.correct?'· <span style="color:var(--green-ok)">Correcta</span>':'· <span style="color:var(--red)">Incorrecta</span>') : '· <span style="color:var(--muted)">Sin responder</span>'}</div>
      <div class="qtext" style="font-size:14.5px;">${esc(q.question)}</div>
      ${q.options.map((o,idx)=>{
        const letter=letters2[idx];
        let cls='option';
        if(letter===q.correct) cls+=' correct';
        else if(letter===sel) cls+=' incorrect';
        return `<div class="${cls}" style="cursor:default;"><span class="letter">${letter})</span>${esc(o)}</div>`;
      }).join('')}
      ${q.explanation ? `<div style="margin-top:10px; padding:10px 12px; background:#FBF1F1; border-radius:8px; font-size:13px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    </div>`;
  })() : ''}
  ${Object.keys(byLaw).length>1 ? `
  <div class="section-title">Repasa por regla</div>
  <div class="sub" style="color:var(--muted); margin-bottom:10px; font-size:12.5px;">Toca una regla para practicarla de nuevo.</div>
  <div class="qcard">${rows}</div>
  ` : ''}
  <div style="display:flex; gap:10px; margin-top:16px; justify-content:center; flex-wrap:wrap;">
    ${['hearts','suddendeath','timeattack'].includes(quiz.mode) ? '<button class="btn btn-primary" data-action="dailyChallenge">Volver a la League</button>' : '<button class="btn btn-primary" data-action="home">Volver al inicio</button>'}
    ${quiz.law ? `<button class="btn btn-secondary" data-action="open-law" data-law="${quiz.law}">Repetir esta regla</button>` : ''}
    ${quiz.mode==='hearts' ? `<button class="btn btn-secondary" data-action="start-hearts">Jugar de nuevo</button>` : ''}
    ${quiz.mode==='suddendeath' ? `<button class="btn btn-secondary" data-action="start-suddendeath">Jugar de nuevo</button>` : ''}
    ${quiz.mode==='timeattack' ? `<button class="btn btn-secondary" data-action="start-timeattack">Jugar de nuevo</button>` : ''}
    ${quiz.mode==='training' ? `<button class="btn btn-secondary" data-action="train-config">Nuevo entreno</button>` : ''}
  </div>
  `;
}

function trainConfigView(){
  const cfg = STATE.trainCfg;
  const ic = (n) => shellIcon(n);
  const scopeOverride = cfg.scopeOverride;
  const scoped = scopeOverride ? questionsForLaw(scopeOverride) : trainPoolForLaws(cfg.laws);
  const totalAvail = scoped.length;
  const failedAvail = scoped.filter(q => isFailedQuestion(q)).length;
  const scopeLabel = scopeOverride==='hard' ? 'Sala VAR' : scopeOverride==='failed' ? 'Sala de Repaso' : scopeOverride==='glossary' ? 'Preguntas Glosario' : scopeOverride==='assistants' ? 'Árbitros Asistentes' : scopeOverride==='saved' ? 'Preguntas Guardadas' : (typeof scopeOverride==='number') ? 'Regla '+scopeOverride+' · '+esc(LAW_NAMES[scopeOverride]) : null;
  const backAction = scopeOverride ? 'open-law' : 'home';

  let chips = '';
  for(let i=1;i<=17;i++){
    const active = cfg.laws.includes(i);
    chips += `<button class="tc-rule ${active?'active':''}" data-action="toggle-train-law" data-law="${i}"><b>${i}</b><span>${esc(LAW_NAMES[i])}</span></button>`;
  }
  [['glossary', 'G', 'Preguntas Glosario'], ['assistants', 'A', 'Árbitros Asistentes']].forEach(([key, letter, name]) => {
    chips += `<button class="tc-rule special ${cfg.laws.includes(key)?'active':''}" data-action="toggle-train-law" data-law="${key}"><b>${letter}</b><span>${name}</span></button>`;
  });
  const opt = (on, action, attrs, icon, title, text) => `<button class="tc-opt ${on?'active':''}" data-action="${action}" ${attrs}>
    <span class="tc-opt-ic">${ic(icon)}</span><span class="tc-opt-body"><strong>${title}</strong><small>${text}</small></span><span class="tc-opt-check">${ic('check')}</span>
  </button>`;

  const timerText = cfg.timerMode==='none' ? 'Sin límite' : cfg.timerMode==='total' ? cfg.minutes + ' min en total' : cfg.secondsPerQuestion + ' s por pregunta';
  const lawsText = scopeOverride ? scopeLabel : (cfg.laws.length===0 ? 'Todas las reglas' : cfg.laws.length===1 ? (cfg.laws[0]==='glossary' ? 'Glosario' : cfg.laws[0]==='assistants' ? 'Árbitros Asistentes' : 'Regla ' + cfg.laws[0]) : cfg.laws.length + ' secciones');

  return `
  <button class="backbtn" data-action="${backAction}" data-law="${scopeOverride||''}">&larr; ${scopeOverride ? scopeLabel : 'Inicio'}</button>
  <section class="tc-hero">
    <div>
      <div class="home-eyebrow">${scopeLabel ? 'Test personalizado' : 'Reglas de Juego · IFAB'}</div>
      <h1>${scopeLabel ? esc(scopeLabel) : 'Diseña tu examen'}</h1>
      <p>Elige cuántas preguntas quieres y cómo quieres el tiempo. Se genera un examen aleatorio y puedes moverte libremente entre preguntas hasta finalizarlo.</p>
    </div>
    <div class="tc-hero-stat"><b>${totalAvail}</b><span>preguntas<br>disponibles</span></div>
  </section>

  <div class="tc-layout">
    <div class="tc-main">
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">1</span><div><h3>Número de preguntas</h3><small>Máximo 50 por examen</small></div></div>
        <input type="text" inputmode="numeric" id="cfg-count" class="tc-count" value="${Math.min(cfg.count,50)}" maxlength="2">
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">2</span><div><h3>Tipo de test</h3><small>Cuándo quieres ver las soluciones</small></div></div>
        <div class="tc-opts two">
          ${opt(cfg.feedbackMode==='exam', 'set-feedback-mode', 'data-fbmode="exam"', 'target', 'Modo examen', 'No sabrás los resultados hasta terminar todo el test, como en un examen real.')}
          ${opt(cfg.feedbackMode==='study', 'set-feedback-mode', 'data-fbmode="study"', 'book', 'Modo estudio', 'Verás si aciertas y la solución al momento de responder cada pregunta.')}
        </div>
      </div>

      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">3</span><div><h3>Temporización</h3><small>Controla el ritmo del examen</small></div></div>
        <div class="tc-opts three">
          ${opt(cfg.timerMode==='none', 'set-timer-mode', 'data-mode="none"', 'repeat', 'Sin límite', 'A tu ritmo.')}
          ${opt(cfg.timerMode==='total', 'set-timer-mode', 'data-mode="total"', 'clock', 'Tiempo total', 'Un reloj para todo el examen.')}
          ${opt(cfg.timerMode==='perQuestion', 'set-timer-mode', 'data-mode="perQuestion"', 'zap', 'Por pregunta', 'Cada pregunta con su cuenta atrás.')}
        </div>
        ${cfg.timerMode==='total' ? `
          <div class="tc-field"><label for="cfg-minutes">Minutos para todo el examen</label>
          <input type="text" inputmode="numeric" id="cfg-minutes" value="${cfg.minutes}" maxlength="4"></div>
        ` : ''}
        ${cfg.timerMode==='perQuestion' ? `
          <div class="tc-field"><label for="cfg-seconds-per-q">Segundos por pregunta</label>
          <input type="text" inputmode="numeric" id="cfg-seconds-per-q" value="${cfg.secondsPerQuestion}" maxlength="4">
          <small>Si se acaba el tiempo de una pregunta, se pasa sola a la siguiente (sin responder si no elegiste nada).</small></div>
        ` : ''}
      </div>

      ${scopeOverride ? '' : `
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">4</span><div><h3>Reglas incluidas</h3><small>Elige reglas, Glosario o Árbitros Asistentes · sin selección entran las 17 reglas y el Glosario</small></div>
          <button class="tc-all ${cfg.laws.length===0?'active':''}" data-action="toggle-train-law" data-law="all">Todas</button></div>
        <div class="tc-rules">${chips}</div>
      </div>`}
    </div>

    <aside class="tc-side">
      <div class="tc-summary">
        <div class="tc-summary-title">Resumen del examen</div>
        <div class="tc-sum-row">${ic('book')}<span>Ámbito</span><b>${esc(lawsText)}</b></div>
        <div class="tc-sum-row">${ic('target')}<span>Tipo</span><b>${cfg.feedbackMode==='study' ? 'Modo estudio' : 'Modo examen'}</b></div>
        <div class="tc-sum-row">${ic('clock')}<span>Tiempo</span><b>${timerText}</b></div>
        <div class="tc-sum-row">${ic('shuffle')}<span>Banco</span><b>${totalAvail} preguntas</b></div>
        ${failedAvail > 0 ? `<div class="tc-sum-row">${ic('repeat')}<span>Falladas</span><b>${failedAvail}</b></div>` : ''}
        <button class="btn btn-yellow tc-go" data-action="generate-exam">${ic('play')} Generar examen</button>
      </div>
    </aside>
  </div>
  `;
}

function savedBrowseView(){
  const ic = (n) => shellIcon(n);
  const ids = Object.keys(STATE.storage.saved);
  const letters=['a','b','c','d'];
  if(ids.length===0){
    return `<button class="backbtn" data-action="open-law" data-law="saved">&larr; Preguntas guardadas</button>
    <div class="ac-empty">${ic('star')}<strong>Ya no te quedan preguntas guardadas</strong><span>Cuando guardes alguna durante un test aparecerá aquí.</span></div>`;
  }
  if(STATE.savedBrowseIdx >= ids.length) STATE.savedBrowseIdx = ids.length - 1;
  if(STATE.savedBrowseIdx < 0) STATE.savedBrowseIdx = 0;
  const id = ids[STATE.savedBrowseIdx];
  const q = allQuestions().find(x=>x.id===id);
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

function flaggedView(){
  const ids = Object.keys(STATE.storage.flags);
  const letters=['a','b','c','d'];
  if(ids.length===0){
    return `<button class="backbtn" data-action="home">&larr; Inicio</button>
    <h2 style="margin-bottom:10px;">Preguntas marcadas</h2>
    <div class="empty-state">Todavía no has marcado ninguna pregunta. Cuando veas una que parezca desactualizada o con un error, pulsa "Marcar esta pregunta" en el test o en modo estudio, y aparecerá aquí para que la corrijas.</div>`;
  }
  let items = ids.map(id=>{
    const q = allQuestions().find(x=>x.id===id);
    if(!q) return '';
    if(STATE.editingId === id) return editFormHtml(q);
    return `<div class="qcard" style="margin-bottom:10px;">
      <div class="qtag">${scopeLabel(q)}${q.explanation?' <span class="badge" style="background:var(--green-ok); color:#fff;">Con explicación</span>':''}</div>
      <div class="qtext">${esc(q.question)}</div>
      ${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}
      ${q.explanation ? `<div style="margin-top:10px; padding:10px 12px; background:#FBF1F1; border-radius:8px; font-size:13px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
        <button class="btn btn-secondary" data-action="edit-question" data-qid="${q.id}">Editar / añadir explicación</button>
        <button class="btn btn-ghost" data-action="unflag" data-qid="${q.id}">Quitar marca (ya revisada)</button>
      </div>
    </div>`;
  }).join('');
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Preguntas marcadas para revisar</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">${ids.length} pregunta(s) señaladas como posiblemente desactualizadas o con error.</div>
  ${items}
  `;
}

function editFormHtml(q){
  const letters=['a','b','c','d'];
  const isGlossaryQ = q.domain === 'glossary' || q.domain === 'assistants';
  const lawOpts = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${q.rule===i?'selected':''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('');
  const tagLabel = q.domain === 'assistants' ? 'Editando · Árbitros Asistentes' : isGlossaryQ ? 'Editando · Glosario IFAB' : 'Editando · Regla '+q.rule+' · '+esc(LAW_NAMES[q.rule]);
  return `<div class="qcard" style="margin-bottom:10px;">
    <div class="qtag">${tagLabel}</div>
    <input type="hidden" id="e-domain" value="${q.domain}">
    ${isGlossaryQ ? '' : `
    <label>Regla</label>
    <select id="e-rule">${lawOpts}</select>
    `}
    <label>Pregunta</label>
    <textarea id="e-question" maxlength="1000">${esc(q.question)}</textarea>
    ${letters.map((l,i)=>`<label>Respuesta ${l})</label><input type="text" id="e-${l}" value="${esc(q.options[i])}" maxlength="300">`).join('')}
    <label>Respuesta correcta</label>
    <select id="e-correct">${letters.map(l=>`<option value="${l}" ${l===q.correct?'selected':''}>${l})</option>`).join('')}</select>
    <label>Explicación para quien estudia (opcional)</label>
    <textarea id="e-explanation" placeholder="Por qué es correcta, artículo del reglamento, matices..." maxlength="2000">${esc(q.explanation||'')}</textarea>
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13.5px;">
      <input type="checkbox" id="e-hard" style="width:auto;" ${q.difficulty==='hard'?'checked':''}> Es una pregunta difícil (aparecerá también en "Sala VAR")
    </label>
    <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
      <button class="btn btn-primary" data-action="save-edit" data-qid="${q.id}">Guardar cambios</button>
      <button class="btn btn-secondary" data-action="save-edit-unflag" data-qid="${q.id}">Guardar y quitar marca</button>
      <button class="btn btn-ghost" data-action="cancel-edit">Cancelar</button>
    </div>
  </div>`;
}

function saveQuestionEdit(qid, alsoUnflag){
  const domain = document.getElementById('e-domain').value;
  const ruleSelEl = document.getElementById('e-rule');
  const selectedNum = ruleSelEl ? parseInt(ruleSelEl.value,10) : null;
  const question = document.getElementById('e-question').value.trim();
  const a = document.getElementById('e-a').value.trim();
  const b = document.getElementById('e-b').value.trim();
  const c = document.getElementById('e-c').value.trim();
  const d = document.getElementById('e-d').value.trim();
  const correct = document.getElementById('e-correct').value;
  const explanation = document.getElementById('e-explanation').value.trim();
  const difficulty = document.getElementById('e-hard').checked ? 'hard' : 'normal';
  if(!question || !a || !b || !c){ STATE.toast='Rellena al menos la pregunta y las opciones a, b y c.'; render(); return; }
  const edit = (domain==='glossary' || domain==='assistants')
    ? { question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() }
    : { rule: selectedNum, question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() };
  if(sharedActive()){
    // Banco compartido: el cambio lo ven todos los usuarios.
    const cur = allQuestions().find(x => x.id === qid) || {};
    sharedSave([sharedRowFor(qid, domain, edit, cur.createdAt)]);
    if(STATE.storage.edits[qid]){ delete STATE.storage.edits[qid]; saveEdits(); }
  } else {
    STATE.storage.edits[qid] = edit;
    saveEdits();
  }
  if(alsoUnflag){ delete STATE.storage.flags[qid]; saveFlags(); }
  STATE.editingId = null;
  STATE.toast = 'Pregunta actualizada.';
  render();
}

function filteredDbList(){
  const f = STATE.dbFilter;
  let list = allQuestions();
  if(f.law === 'hard') list = list.filter(q => q.difficulty === 'hard');
  else if(f.law === 'glossary') list = list.filter(q => q.domain === 'glossary');
  else if(f.law === 'assistants') list = list.filter(q => q.domain === 'assistants');
  else if(f.law !== 'all') list = list.filter(q => q.domain !== 'glossary' && q.rule === parseInt(f.law,10));
  if(f.difficulty === 'hard') list = list.filter(q => q.difficulty === 'hard');
  else if(f.difficulty === 'normal') list = list.filter(q => q.difficulty !== 'hard');
  if(f.flaggedOnly) list = list.filter(q => !!STATE.storage.flags[q.id]);
  if(f.myOnly) list = list.filter(q => q.source === 'user');
  if(f.reviewStatus === 'reviewed') list = list.filter(q => !!STATE.storage.reviewed[q.id]);
  else if(f.reviewStatus === 'pending') list = list.filter(q => !STATE.storage.reviewed[q.id]);
  if(f.search && f.search.trim()){
    const s = f.search.trim().toLowerCase();
    list = list.filter(q => q.question.toLowerCase().includes(s) || q.options.some(o => o.toLowerCase().includes(s)));
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
    const fromTs = f.dateFrom ? new Date(f.dateFrom+'T00:00:00').getTime() : -Infinity;
    const toTs = f.dateTo ? new Date(f.dateTo+'T23:59:59.999').getTime() : Infinity;
    list = list.filter(q => q[field] && q[field] >= fromTs && q[field] <= toTs);
  }
  return list;
}

function databaseView(){
  const ic = (n) => shellIcon(n);
  const f = STATE.dbFilter;
  const pageSize = 15;
  const list = filteredDbList();
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  if(f.page > totalPages) f.page = totalPages;
  const startIdx = (f.page - 1) * pageSize;
  const pageItems = list.slice(startIdx, startIdx + pageSize);
  const letters = ['a','b','c','d'];

  const all = allQuestions();
  const numberMap = {};
  all.forEach((q,i) => { numberMap[q.id] = i+1; });
  const dupIds = duplicateQuestionIds();

  const lawOptions = `<option value="all">Todas (todo el banco)</option>` +
    `<optgroup label="Reglas IFAB">` +
    Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${f.law==String(i)?'selected':''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('') +
    `<option value="glossary" ${f.law==='glossary'?'selected':''}>Preguntas Glosario</option>` +
    `<option value="assistants" ${f.law==='assistants'?'selected':''}>Árbitros Asistentes</option>` +
    `<option value="hard" ${f.law==='hard'?'selected':''}>Sala VAR (difíciles)</option>` +
    `</optgroup>`;

  const chip = (cls, text) => `<span class="db-tag ${cls}">${text}</span>`;
  let rows = pageItems.map(q => {
    if(STATE.editingId === q.id) return editFormHtml(q);
    const isReviewed = !!STATE.storage.reviewed[q.id];
    const reportCount = STATE.reports[q.id] || 0;
    const tags = [
      q.difficulty==='hard' ? chip('hard', 'Difícil') : '',
      STATE.storage.flags[q.id] ? chip('flag', 'Marcada') : '',
      q.source==='user' ? chip('mine', 'Añadida') : '',
      isReviewed ? chip('ok', 'Revisada') : '',
      reportCount>0 ? chip('bad', 'Reportada x' + reportCount) : '',
      dupIds.has(q.id) ? chip('dup', 'Duplicada') : ''
    ].join('');
    const dates = [];
    if(q.createdAt) dates.push(`Creada ${new Date(q.createdAt).toLocaleDateString('es-ES')}`);
    if(q.updatedAt) dates.push(`Editada ${new Date(q.updatedAt).toLocaleDateString('es-ES')}`);
    return `<article class="ac-q db-q ${reportCount>0 ? 'reported' : (isReviewed ? 'reviewed' : '')}">
      <div class="db-q-head">
        <span class="db-q-num">#${numberMap[q.id]}</span>
        <span class="db-q-scope">${scopeLabel(q)}</span>
        <div class="db-tags">${tags}</div>
        ${dates.length ? `<span class="db-q-dates">${dates.join(' · ')}</span>` : ''}
      </div>
      <div class="ac-q-text" style="margin-bottom:12px;">${esc(q.question)}</div>
      <div class="ac-q-opts">${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default; padding:9px 12px;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}</div>
      ${q.explanation ? `<div class="ac-q-expl"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
      <div class="ac-q-actions">
        <button class="btn ${isReviewed?'btn-secondary':'btn-primary'}" data-action="toggle-reviewed" data-qid="${q.id}">${ic('check')} ${isReviewed ? 'Revisada' : 'Marcar como revisada'}</button>
        <button class="btn btn-ghost" data-action="edit-question" data-qid="${q.id}">${ic('pencil')} Editar</button>
        <button class="btn btn-ghost btn-danger-soft" data-action="delete-question" data-qid="${q.id}">${ic('trash')} Eliminar</button>
        ${reportCount>0 ? `<button class="btn btn-ghost" data-action="dismiss-reports" data-qid="${q.id}">${ic('flag')} Descartar reportes</button>` : ''}
      </div>
    </article>`;
  }).join('');

  const reviewedCount = all.filter(q => STATE.storage.reviewed[q.id]).length;
  const reportedCount = Object.keys(STATE.reports).length;
  const dupTotal = dupIds.size;

  const LOW_COUNT_THRESHOLD = 30;
  const { counts: lawCounts, glossary: glossaryCount } = questionCountsByLaw();
  const assistantsCount = all.filter(q => q.domain === 'assistants').length;
  const lawChip = (law, label, n, extra) => {
    const low = n < LOW_COUNT_THRESHOLD && !extra;
    return `<button class="db-lawchip ${String(f.law)===String(law) ? 'active' : ''} ${low ? 'low' : ''}" data-action="db-view-law-questions" data-law="${law}"><b>${label}</b><span>${n}</span></button>`;
  };
  const lawCountChipsHtml = Array.from({length:17},(_,i)=>i+1).map(i => lawChip(i, 'R' + i, lawCounts[i] || 0)).join('')
    + lawChip('glossary', 'Glosario', glossaryCount)
    + lawChip('assistants', 'Asistentes', assistantsCount, true);

  const check = (id, checked, label) => `<label class="db-check ${checked ? 'on' : ''}"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <section class="lg-hero">
    <div class="lg-hero-main">
      <div class="home-eyebrow">Administración</div>
      <h1>Base de datos</h1>
      <p>Revisa, edita y añade las preguntas de toda la plataforma. Los cambios que hagas los ven todos los usuarios.</p>
      <div class="ac-hero-actions">
        <button class="btn btn-yellow" data-action="add-from-db">${ic('plus')} Añadir pregunta</button>
        <button class="btn btn-glass" data-action="export-excel">${ic('download')} Exportar Excel</button>
        <label class="btn btn-glass" style="cursor:pointer; margin:0;">
          ${ic('fileplus')} Importar Excel
          <input type="file" id="import-excel-file" accept=".xlsx,.xls" style="display:none;">
        </label>
      </div>
    </div>
    <div class="lg-hero-stats">
      <div class="lg-stat"><b>${all.length}</b><span>Preguntas</span></div>
      <div class="lg-stat"><b>${reviewedCount}</b><span>Revisadas</span></div>
      <div class="lg-stat"><b>${reportedCount}</b><span>Con reportes</span></div>
    </div>
  </section>

  <div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('book')}</span><div><h3>Preguntas por regla</h3><small>Pulsa una para filtrar · en rojo, las que tienen menos de ${LOW_COUNT_THRESHOLD}</small></div></div>
    <div class="db-lawchips">${lawCountChipsHtml}</div>
  </div>

  <div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('search')}</span><div><h3>Buscar y filtrar</h3><small>${list.length} ${list.length === 1 ? 'pregunta coincide' : 'preguntas coinciden'} con el filtro</small></div></div>
    <div class="ac-search" style="margin-bottom:14px;">
      ${ic('search')}
      <input type="text" id="db-search" placeholder="Busca por palabra en la pregunta o en las respuestas..." value="${esc(f.search)}" maxlength="100" aria-label="Buscar texto">
    </div>
    <div class="db-filters">
      <div><label for="db-law">Regla</label><select id="db-law">${lawOptions}</select></div>
      <div><label for="db-difficulty">Dificultad</label>
        <select id="db-difficulty">
          <option value="all" ${f.difficulty==='all'?'selected':''}>Todas</option>
          <option value="normal" ${f.difficulty==='normal'?'selected':''}>Normal</option>
          <option value="hard" ${f.difficulty==='hard'?'selected':''}>Difícil</option>
        </select></div>
      <div><label for="db-review-status">Revisión</label>
        <select id="db-review-status">
          <option value="all" ${f.reviewStatus==='all'?'selected':''}>Todas</option>
          <option value="pending" ${f.reviewStatus==='pending'?'selected':''}>Pendientes</option>
          <option value="reviewed" ${f.reviewStatus==='reviewed'?'selected':''}>Revisadas</option>
        </select></div>
      <div><label for="db-date-field">Filtrar por fecha de</label>
        <select id="db-date-field">
          <option value="created" ${f.dateField==='created'?'selected':''}>Creación</option>
          <option value="updated" ${f.dateField==='updated'?'selected':''}>Última modificación</option>
        </select></div>
      <div><label for="db-date-from">Desde</label><input type="date" id="db-date-from" value="${esc(f.dateFrom)}"></div>
      <div><label for="db-date-to">Hasta</label><input type="date" id="db-date-to" value="${esc(f.dateTo)}"></div>
    </div>
    ${(f.dateFrom || f.dateTo) ? `<div class="st-note" style="margin-top:12px;">La fecha solo se registra desde esta actualización: las preguntas que ya existían antes y nunca se han vuelto a editar no tienen fecha y no aparecerán en este filtro.</div>` : ''}
    <div class="db-checks">
      ${check('db-flagged-only', f.flaggedOnly, 'Solo marcadas para revisar')}
      ${check('db-reported-only', f.reportedOnly, `Solo reportadas por usuarios (${reportedCount})`)}
      ${check('db-duplicates-only', f.duplicatesOnly, `Solo duplicadas (${dupTotal})`)}
    </div>
  </div>

  ${rows ? `<div class="ac-qlist">${rows}</div>` : `<div class="ac-empty">${ic('search')}<strong>Ninguna pregunta coincide con este filtro</strong><span>Prueba a quitar algún filtro.</span></div>`}

  ${list.length>pageSize ? `
  <div class="ad-pager">
    <button class="btn btn-ghost" data-action="db-prev-page" ${f.page<=1?'disabled':''}>&larr; Anterior</button>
    <span>Página ${f.page} / ${totalPages}</span>
    <button class="btn btn-ghost" data-action="db-next-page" ${f.page>=totalPages?'disabled':''}>Siguiente &rarr;</button>
  </div>` : ''}
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
    ${tool('users', 'Formación Comité', 'Miembros, tests y ranking', 'committee-open')}
  </div>

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

function addQuestionView(){
  const isGlossaryContext = STATE.lawId === 'glossary';
  const currentLawNum = typeof STATE.lawId === 'number' ? STATE.lawId : null;
  const lawSel = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${currentLawNum===i?'selected':''}>Regla ${i} — ${esc(LAW_NAMES[i])}</option>`).join('')
    + `<option value="glossary" ${isGlossaryContext?'selected':''}>Glosario IFAB</option>`
    + (sharedActive() ? `<option value="assistants" ${STATE.lawId==='assistants'?'selected':''}>Árbitros Asistentes</option>` : '');
  const backAction = STATE.cameFromDb ? 'database' : (STATE.lawId!=null ? 'open-law' : 'home');
  return `
  <button class="backbtn" data-action="${backAction}" data-law="${STATE.lawId!=null?STATE.lawId:''}">&larr; Volver</button>
  <h2>Añadir pregunta</h2>
  <div class="qcard">
    <label>Ámbito</label>
    <select id="f-law">${lawSel}</select>
    <label>Pregunta</label>
    <textarea id="f-question" placeholder="Escribe el enunciado..." maxlength="1000"></textarea>
    <label>Respuesta a)</label><input type="text" id="f-a" maxlength="300">
    <label>Respuesta b)</label><input type="text" id="f-b" maxlength="300">
    <label>Respuesta c)</label><input type="text" id="f-c" maxlength="300">
    <label>Respuesta d)</label><input type="text" id="f-d" placeholder="p.ej. Ninguna respuesta es correcta." maxlength="300">
    <label>Respuesta correcta</label>
    <select id="f-correct"><option value="a">a)</option><option value="b">b)</option><option value="c">c)</option><option value="d">d)</option></select>
    <label>Explicación para quien estudia (opcional)</label>
    <textarea id="f-explanation" placeholder="Por qué es correcta, artículo del reglamento, matices..." maxlength="2000"></textarea>
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13.5px;">
      <input type="checkbox" id="f-hard" style="width:auto;"> Es una pregunta difícil (aparecerá también en "Sala VAR")
    </label>
    <div style="margin-top:18px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="save-question">Guardar pregunta</button>
    </div>
  </div>
  `;
}

function saveNewQuestion(){
  const lawSelEl = document.getElementById('f-law');
  const lawSelVal = lawSelEl.value;
  const domain = lawSelVal === 'glossary' ? 'glossary' : lawSelVal === 'assistants' ? 'assistants' : 'law';
  const selectedNum = domain === 'law' ? parseInt(lawSelVal,10) : null;
  const question = document.getElementById('f-question').value.trim();
  const a = document.getElementById('f-a').value.trim();
  const b = document.getElementById('f-b').value.trim();
  const c = document.getElementById('f-c').value.trim();
  const d = document.getElementById('f-d').value.trim() || 'Ninguna respuesta es correcta.';
  const correct = document.getElementById('f-correct').value;
  const explanation = document.getElementById('f-explanation').value.trim();
  const difficulty = document.getElementById('f-hard').checked ? 'hard' : 'normal';
  if(!question || !a || !b || !c){ STATE.toast='Rellena al menos la pregunta y las opciones a, b y c.'; render(); return; }

  const dedupeKey = questionDedupeKey({ question, options: [a,b,c,d] });
  if(allQuestions().some(q => questionDedupeKey(q) === dedupeKey)){
    STATE.toast = 'Ya existe una pregunta con este mismo enunciado y estas mismas opciones en la base de datos.';
    render();
    return;
  }

  if(sharedActive()){
    // Banco compartido: la pregunta la ven todos los usuarios.
    const prefix = domain === 'glossary' ? 'G' : domain === 'assistants' ? 'S' : 'U';
    const id = prefix + Math.random().toString(36).slice(2,9);
    sharedSave([sharedRowFor(id, domain, { rule:selectedNum, question, options:[a,b,c,d], correct, explanation, difficulty }, Date.now())]);
    if(domain==='glossary'){ STATE.toast='Pregunta guardada en el Glosario para todos los usuarios.'; if(!STATE.cameFromDb){ STATE.lawId='glossary'; STATE.view='law'; } }
    else if(domain==='assistants'){ STATE.toast='Pregunta guardada en Árbitros Asistentes para todos los usuarios.'; if(!STATE.cameFromDb){ STATE.lawId='assistants'; STATE.view='law'; } }
    else { STATE.toast='Pregunta guardada en la Regla '+selectedNum+' para todos los usuarios.'; if(!STATE.cameFromDb){ STATE.lawId=selectedNum; STATE.view='law'; } }
    if(STATE.cameFromDb){ STATE.view='database'; }
  } else if(domain==='glossary'){
    const q = { domain:'glossary', rule:null, num: 'U'+(STATE.storage.glossaryQuestions.length+1), question, options:[a,b,c,d], correct, explanation, difficulty, id:'G'+Math.random().toString(36).slice(2,9), source:'user', createdAt: Date.now() };
    STATE.storage.glossaryQuestions.push(q);
    saveGlossaryQuestions();
    STATE.toast='Pregunta guardada en el Glosario.';
    if(STATE.cameFromDb){ STATE.view='database'; }
    else { STATE.lawId = 'glossary'; STATE.view='law'; }
  } else {
    const q = { domain:'law', rule: selectedNum, num: 'U'+(STATE.storage.userQuestions.length+1), question, options:[a,b,c,d], correct, explanation, difficulty, id:'U'+Math.random().toString(36).slice(2,9), source:'user', createdAt: Date.now() };
    STATE.storage.userQuestions.push(q);
    saveUserQuestions();
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
  const flaggedTotal = Object.keys(STATE.storage.flags).length;
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
    ${kpi('check', os.attempted, 'Preguntas respondidas', 'de ' + os.total)}
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

      ${flaggedTotal>0 ? `
      <div class="tc-card">
        <div class="tc-card-head"><span class="tc-step">${ic('flag')}</span><div><h3>Preguntas marcadas</h3><small>${flaggedTotal} para revisar</small></div></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btn-secondary" data-action="flagged-list">Ver y corregir</button>
          <button class="btn btn-ghost" data-action="review-flagged">Practicarlas como test</button>
        </div>
      </div>` : ''}
    </aside>
  </div>
  `;
}

function exportExcel(){
  if(typeof XLSX === 'undefined'){ STATE.toast = 'No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'; render(); return; }
  const rows = allQuestions().map((q,i) => ({
    'Número': i+1,
    'ID': q.id,
    'Ámbito': q.domain==='glossary' ? 'Glosario' : q.domain==='assistants' ? 'Asistentes' : q.rule,
    'Pregunta': q.question,
    'Opción A': q.options[0]||'',
    'Opción B': q.options[1]||'',
    'Opción C': q.options[2]||'',
    'Opción D': q.options[3]||'',
    'Correcta (a/b/c/d)': q.correct,
    'Explicación': q.explanation||'',
    'Difícil (SI/NO)': q.difficulty==='hard' ? 'SI' : 'NO'
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
    ['- En "Ámbito" pon el número de regla (1-17) o la palabra Glosario.'],
    ['- En "Correcta" pon solo la letra: a, b, c o d.'],
    ['- No borres filas para eliminar preguntas: usa el botón Eliminar en la app.'],
    ['- Cuando termines, guarda el archivo y súbelo con "Importar desde Excel".']
  ]);
  infoWs['!cols'] = [{wch:70}];
  XLSX.utils.book_append_sheet(wb, infoWs, 'Instrucciones');
  XLSX.writeFile(wb, 'weref_base_de_datos.xlsx');
}

function importExcelFile(file){
  if(typeof XLSX === 'undefined'){ STATE.toast = 'No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'; render(); return; }
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      let updated = 0, added = 0, skipped = 0, duplicates = 0;
      const sharedRows = [];
      const seenKeys = new Set(allQuestions().map(q => questionDedupeKey(q)));
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
        const isAssist = ambito.toLowerCase().startsWith('asis');
        const isGlossary = ambito.toLowerCase().startsWith('glos') || isAssist;
        const rule = isGlossary ? null : parseInt(ambito,10);

        if(!question || !a || !b || !c || !['a','b','c','d'].includes(correct)){ skipped++; return; }
        if(!isGlossary && (!rule || rule<1 || rule>17)){ skipped++; return; }

        if(id){
          const exists = allQuestions().find(q=>q.id===id);
          if(!exists){ skipped++; return; }
          const edit = isGlossary
            ? { question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() }
            : { rule, question, options:[a,b,c,d], correct, explanation, difficulty, updatedAt: Date.now() };
          if(sharedActive()) sharedRows.push(sharedRowFor(id, exists.domain, edit, exists.createdAt));
          else STATE.storage.edits[id] = edit;
          updated++;
        } else {
          if(isAssist && !sharedActive()){ skipped++; return; }
          const dedupeKey = questionDedupeKey({ question, options:[a,b,c,d] });
          if(seenKeys.has(dedupeKey)){ duplicates++; return; }
          seenKeys.add(dedupeKey);
          if(sharedActive()){
            const dom = isAssist ? 'assistants' : isGlossary ? 'glossary' : 'law';
            const nid = (isAssist ? 'S' : isGlossary ? 'G' : 'U') + Math.random().toString(36).slice(2,9);
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

  const mbOptionCount = document.getElementById('mb-option-count');
  if(mbOptionCount){
    mbOptionCount.addEventListener('change', (e)=>{
      const allLetters = ['a','b','c','d'];
      STATE.myBankFormDraft = {
        category: (document.getElementById('mb-category')||{}).value,
        question: (document.getElementById('mb-question')||{}).value,
        options: allLetters.map(l => { const el2 = document.getElementById('mb-'+l); return el2 ? el2.value : undefined; }),
        correct: (document.getElementById('mb-correct')||{}).value,
        explanation: (document.getElementById('mb-explanation')||{}).value
      };
      STATE.myBankOptionCount = parseInt(e.target.value,10);
      render();
    });
  }

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
  const dbFlaggedOnly = document.getElementById('db-flagged-only');
  if(dbFlaggedOnly){ dbFlaggedOnly.addEventListener('change', (e)=>{ STATE.dbFilter.flaggedOnly = e.target.checked; STATE.dbFilter.page = 1; render(); }); }
  const dbReportedOnly = document.getElementById('db-reported-only');
  if(dbReportedOnly){ dbReportedOnly.addEventListener('change', (e)=>{ STATE.dbFilter.reportedOnly = e.target.checked; STATE.dbFilter.page = 1; render(); }); }
  const dbDuplicatesOnly = document.getElementById('db-duplicates-only');
  if(dbDuplicatesOnly){ dbDuplicatesOnly.addEventListener('change', (e)=>{ STATE.dbFilter.duplicatesOnly = e.target.checked; STATE.dbFilter.page = 1; render(); }); }
  const dbReviewStatus = document.getElementById('db-review-status');
  if(dbReviewStatus){ dbReviewStatus.addEventListener('change', (e)=>{ STATE.dbFilter.reviewStatus = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbDateField = document.getElementById('db-date-field');
  if(dbDateField){ dbDateField.addEventListener('change', (e)=>{ STATE.dbFilter.dateField = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbDateFrom = document.getElementById('db-date-from');
  if(dbDateFrom){ dbDateFrom.addEventListener('change', (e)=>{ STATE.dbFilter.dateFrom = e.target.value; STATE.dbFilter.page = 1; render(); }); }
  const dbDateTo = document.getElementById('db-date-to');
  if(dbDateTo){ dbDateTo.addEventListener('change', (e)=>{ STATE.dbFilter.dateTo = e.target.value; STATE.dbFilter.page = 1; render(); }); }
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

  if(typeof action==='string' && action.startsWith('committee-') && typeof committeeOnAction==='function'){ committeeOnAction(action, el); return; }

  if(action==='logout'){ stopTimer(); if(typeof handleLogout==='function') handleLogout(); }
  else if(action==='home'){ stopTimer(); STATE.view='home'; render(); }
  else if(action==='menu'){ STATE.view='menu'; render(); }
  else if(action==='open-law'){ STATE.lawId=law; STATE.view='law'; render(); }
  else if(action==='start-quiz'){ startQuiz(law, el.dataset.mode); }
  else if(action==='train-config'){ STATE.trainCfg.scopeOverride = null; STATE.view='trainConfig'; render(); }
  else if(action==='train-config-scoped'){ STATE.trainCfg.scopeOverride = law; STATE.view='trainConfig'; render(); }
  else if(action==='set-timer-mode'){ STATE.trainCfg.timerMode = el.dataset.mode; render(); }
  else if(action==='set-feedback-mode'){ STATE.trainCfg.feedbackMode = el.dataset.fbmode; render(); }
  else if(action==='toggle-train-law'){
    const val = el.dataset.law;
    if(val==='all'){ STATE.trainCfg.laws = []; }
    else {
      const num = (val==='glossary' || val==='assistants') ? val : parseInt(val,10);
      const idx = STATE.trainCfg.laws.indexOf(num);
      if(idx>=0) STATE.trainCfg.laws.splice(idx,1); else STATE.trainCfg.laws.push(num);
    }
    render();
  }
  else if(action==='generate-exam'){
    const countVal = parseInt(document.getElementById('cfg-count').value,10);
    STATE.trainCfg.count = Math.min(50, Math.max(1, isNaN(countVal) ? 20 : countVal));
    if(STATE.trainCfg.timerMode==='total'){
      const minutesVal = parseInt(document.getElementById('cfg-minutes').value,10);
      STATE.trainCfg.minutes = isNaN(minutesVal) ? 0 : minutesVal;
    }
    if(STATE.trainCfg.timerMode==='perQuestion'){
      const secVal = parseInt(document.getElementById('cfg-seconds-per-q').value,10);
      STATE.trainCfg.secondsPerQuestion = isNaN(secVal) ? 45 : secVal;
    }
    startTraining({
      count: STATE.trainCfg.count,
      timerMode: STATE.trainCfg.timerMode,
      minutes: STATE.trainCfg.minutes,
      secondsPerQuestion: STATE.trainCfg.secondsPerQuestion,
      laws: STATE.trainCfg.laws,
      scopeOverride: STATE.trainCfg.scopeOverride,
      instantFeedback: STATE.trainCfg.feedbackMode === 'study'
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
  else if(action==='finish-training'){ stopTimer(); recordTestResult(STATE.quiz); STATE.view='result'; render(); }
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
    else if(qz && ['hearts','suddendeath','timeattack'].includes(qz.mode)){ STATE.view='dailyChallenge'; STATE.leagueSummary=null; render(); loadLeagueSummary(); return; }
    else if(qz && qz.law!=null && qz.law!==''){ STATE.lawId=qz.law; STATE.view='law'; }
    else { STATE.view='home'; }
    render();
  }
  else if(action==='add'){ STATE.cameFromDb = false; STATE.lawId = law || STATE.lawId; STATE.view='add'; render(); }
  else if(action==='add-from-db'){
    STATE.cameFromDb = true;
    const currentLaw = STATE.dbFilter.law;
    STATE.lawId = currentLaw==='glossary' ? 'glossary' : (/^\d+$/.test(currentLaw) ? parseInt(currentLaw,10) : null);
    STATE.view='add'; render();
  }
  else if(action==='save-question'){ saveNewQuestion(); }
  else if(action==='stats'){ STATE.view='stats'; render(); }
  else if(action==='database'){ if(!isDevUser()) return; STATE.editingId=null; STATE.view='database'; loadQuestionReports(); render(); }
  else if(action==='db-view-law-questions'){
    if(!isDevUser()) return;
    STATE.dbFilter.law = String(law);
    STATE.dbFilter.page = 1;
    STATE.editingId = null;
    STATE.view = 'database';
    loadQuestionReports();
    render();
  }
  else if(action==='report-question'){ reportQuestion(el.dataset.qid); }
  else if(action==='dismiss-reports'){ if(!isDevUser()) return; dismissReports(el.dataset.qid); }
  else if(action==='achievements'){ STATE.view='achievements'; render(); }
  else if(action==='profile'){ STATE.view='profile'; STATE.profileData=null; render(); loadProfileData(); }
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
  else if(action==='dailyChallenge'){ STATE.view='dailyChallenge'; STATE.leagueSummary=null; render(); loadLeagueSummary(); }
  else if(action==='leaderboard'){ STATE.view='leaderboard'; loadLeaderboard(STATE.leaderboardMode||'hearts'); render(); }
  else if(action==='leaderboard-tab'){ loadLeaderboard(el.dataset.mode); }
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
  else if(action==='db-prev-page'){ STATE.dbFilter.page = Math.max(1, STATE.dbFilter.page-1); render(); }
  else if(action==='db-next-page'){ STATE.dbFilter.page = STATE.dbFilter.page+1; render(); }
  else if(action==='toggle-reviewed'){
    const qid = el.dataset.qid;
    if(STATE.storage.reviewed[qid]) delete STATE.storage.reviewed[qid];
    else STATE.storage.reviewed[qid] = true;
    saveReviewed();
    render();
  }
  else if(action==='delete-question'){
    STATE.confirmDeleteId = el.dataset.qid;
    render();
  }
  else if(action==='confirm-delete'){
    const qid = STATE.confirmDeleteId;
    if(qid){
      if(sharedActive() && (baseIdSet().has(qid) || SHARED.rows[qid])){
        // Banco compartido: se elimina para todos los usuarios.
        if(baseIdSet().has(qid)){
          const cur = allQuestions().find(x => x.id === qid) || {};
          const ex = SHARED.rows[qid] || {};
          sharedSave([{ id:qid, domain:cur.domain || ex.domain || 'law', deleted:true, created_at: ex.created_at || null, updated_at: Date.now() }]);
        } else {
          sharedDelete([qid]);
        }
      } else {
        STATE.storage.deleted[qid] = true;
        saveDeleted();
      }
      delete STATE.storage.flags[qid]; saveFlags();
      delete STATE.storage.reviewed[qid]; saveReviewed();
      STATE.toast = 'Pregunta eliminada.';
    }
    STATE.confirmDeleteId = null;
    render();
  }
  else if(action==='cancel-delete'){
    STATE.confirmDeleteId = null;
    render();
  }
  else if(action==='review-flagged'){ startQuiz(law, 'review'); }
  else if(action==='flagged-list'){ STATE.editingId=null; STATE.view='flagged'; render(); }
  else if(action==='saved-browse'){ STATE.savedBrowseIdx = 0; STATE.view = 'savedBrowse'; render(); }
  else if(action==='saved-browse-prev'){ STATE.savedBrowseIdx--; render(); }
  else if(action==='saved-browse-next'){ STATE.savedBrowseIdx++; render(); }
  else if(action==='open-suggest'){ STATE.view = 'suggestForm'; render(); }
  else if(action==='send-suggestion'){ sendSuggestion(); }
  else if(action==='suggestions-admin'){ if(!isDevUser()) return; STATE.view = 'suggestionsAdmin'; loadSuggestions(); render(); }
  else if(action==='admin-dashboard'){ if(!isDevUser()) return; STATE.view = 'adminDashboard'; loadAdminStats(1); render(); }
  else if(action==='admin-users-prev-page'){ if(!isDevUser() || STATE.adminUsersPage<=1) return; loadAdminStats(STATE.adminUsersPage-1); }
  else if(action==='admin-users-next-page'){ if(!isDevUser() || !STATE.adminStats || STATE.adminUsersPage>=STATE.adminStats.usersTotalPages) return; loadAdminStats(STATE.adminUsersPage+1); }
  else if(action==='admin-dashboard-retry'){ if(!isDevUser()) return; loadAdminStats(); }
  else if(action==='admin-delete-user'){ if(!isDevUser()) return; STATE.confirmDeleteUserId = el.dataset.uid; render(); }
  else if(action==='admin-cancel-delete-user'){ STATE.confirmDeleteUserId = null; render(); }
  else if(action==='admin-confirm-delete-user'){ if(!isDevUser()) return; deleteAdminUser(STATE.confirmDeleteUserId); }
  else if(action==='admin-set-role'){ if(!isMaster()) return; setUserRole(el.dataset.uid, el.dataset.role); }
  else if(action==='admin-block-user'){ if(!isDevUser()) return; toggleBlockAdminUser(el.dataset.uid, true); }
  else if(action==='admin-unblock-user'){ if(!isDevUser()) return; toggleBlockAdminUser(el.dataset.uid, false); }
  else if(action==='suggestion-status'){ if(!isDevUser()) return; setSuggestionStatus(el.dataset.id, el.dataset.status); }
  else if(action==='suggestion-delete'){ if(!isDevUser()) return; deleteSuggestion(el.dataset.id); }
  else if(action==='toggle-saved'){
    const qid = el.dataset.qid;
    if(STATE.storage.saved[qid]) delete STATE.storage.saved[qid];
    else STATE.storage.saved[qid] = Date.now();
    saveSaved();
    render();
  }
  else if(action==='edit-question'){ STATE.editingId = el.dataset.qid; render(); }
  else if(action==='cancel-edit'){ STATE.editingId = null; render(); }
  else if(action==='save-edit'){ saveQuestionEdit(el.dataset.qid, false); }
  else if(action==='save-edit-unflag'){ saveQuestionEdit(el.dataset.qid, true); }
  else if(action==='unflag'){
    delete STATE.storage.flags[el.dataset.qid];
    saveFlags();
    render();
  }
  else if(action==='export-excel'){ exportExcel(); }
  else if(action==='reset-law-progress'){ STATE.confirmResetLawId = parseInt(el.dataset.law,10); render(); }
  else if(action==='confirm-reset-law'){
    const law = STATE.confirmResetLawId;
    STATE.confirmResetLawId = null;
    resetLawProgress(law).then(()=>{
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
