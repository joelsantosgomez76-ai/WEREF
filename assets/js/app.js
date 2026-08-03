const DEV_USER_EMAIL = 'info@we-ref.com';
function isDevUser(){
  return typeof CURRENT_USER_EMAIL !== 'undefined' && CURRENT_USER_EMAIL === DEV_USER_EMAIL;
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

async function loadAdminStats(){
  if(!isDevUser()) return;
  STATE.adminStats = null;
  render();
  try{
    const { data, error } = await supabaseClient.functions.invoke('admin-stats');
    if(error || !data || data.error){ STATE.adminStats = false; render(); return; }
    STATE.adminStats = data;
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
    loadAdminStats();
  }catch(e){
    STATE.toast = 'No se pudo eliminar la cuenta.';
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

let STATE = {
  view: 'home',
  lawId: null,
  editingId: null,
  cameFromDb: false,
  quiz: null, // {qids, idx, mode, law, answers:{qid:letter}, instantFeedback, timeSec, remainingSec}
  storage: { progress:{}, userQuestions:[], flags:{}, saved:{}, edits:{}, reviewed:{}, deleted:{}, glossaryQuestions:[], testHistory:[], maxStreak:0, unlockedBadges:{}, dailyGoal:20, crownLevels:{}, heartsRecord:0, suddenDeathRecord:0, timeAttackRecord:0, myBank:[], myBankCategories:[], myDocsFolders:[], myDocs:[] },
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
  dbFilter: { search: '', law: 'all', difficulty: 'all', flaggedOnly: false, myOnly: false, reviewStatus: 'all', reportedOnly: false, duplicatesOnly: false, page: 1 },
  reportedIds: {},
  reports: {},
  reportsLoaded: false,
  suggestions: [],
  adminStats: null,
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

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
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

function allQuestions(){
  const combined = BASE_QUESTIONS.concat(STATE.storage.userQuestions || []).concat(STATE.storage.glossaryQuestions || []);
  return combined
    .filter(q => !(STATE.storage.deleted && STATE.storage.deleted[q.id]))
    .map(q => {
      const e = STATE.storage.edits && STATE.storage.edits[q.id];
      return e ? Object.assign({}, q, e) : q;
    });
}
function questionsForLaw(law){
  if(law === 'hard') return allQuestions().filter(q => q.difficulty === 'hard');
  if(law === 'failed') return allQuestions().filter(q => isFailedQuestion(q));
  if(law === 'glossary') return allQuestions().filter(q => q.domain === 'glossary');
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
  try{ const v = await storageGet('progress'); STATE.storage.progress = v ? JSON.parse(v) : {}; }catch(e){ STATE.storage.progress = {}; }
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
  checkAndUnlockBadges();
  render();
}
async function saveProgress(){ await storageSet('progress', JSON.stringify(STATE.storage.progress)); }
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
    const q = allQuestions().find(x=>x.id===qid);
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
  {id:'rule_master', icon:'📘', name:'Maestro de Regla', desc:'Una regla al 100% completada con 90% de acierto o más', check:ctx=>ctx.hasRuleMastered},
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
  let pool = allQuestions().filter(q=>q.domain!=='federation');
  pool = shuffle(pool.slice()).slice(0, Math.max(1,count));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'short', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null };
  STATE.view = 'quiz';
  render();
}

function isLifeMode(mode){ return mode==='hearts' || mode==='suddendeath'; }
function maxLivesFor(mode){ return mode==='suddendeath' ? 1 : 3; }
function isRecordMode(mode){ return mode==='hearts' || mode==='suddendeath' || mode==='timeattack'; }
function formatScore(n){ return Number.isInteger(n) ? String(n) : n.toFixed(1); }

function startHeartsMode(){
  let pool = allQuestions().filter(q=>q.domain!=='federation');
  pool = shuffle(pool.slice()).slice(0, Math.min(60, pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'hearts', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null, hearts:3, combo:0, bestCombo:0 };
  STATE.view = 'quiz';
  render();
}

function startSuddenDeathMode(){
  let pool = allQuestions().filter(q=>q.domain!=='federation');
  pool = shuffle(pool.slice()).slice(0, Math.min(60, pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'suddendeath', law:null, answers:{}, instantFeedback:true, timeSec:0, remainingSec:0, showFeedback:false, selected:null, hearts:1, combo:0, bestCombo:0 };
  STATE.view = 'quiz';
  render();
}

function startTimeAttackMode(){
  let pool = allQuestions().filter(q=>q.domain!=='federation');
  pool = shuffle(pool.slice()).slice(0, Math.min(150, pool.length));
  if(pool.length===0){ STATE.toast='No hay preguntas disponibles.'; render(); return; }
  STATE.quiz = { qids: pool.map(q=>q.id), idx:0, mode:'timeattack', law:null, answers:{}, instantFeedback:true, timerMode:'total', timeSec:60, remainingSec:60, showFeedback:false, selected:null, combo:0, bestCombo:0 };
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
  STATE.storage.pointsCorrectOffset = (STATE.storage.pointsCorrectOffset||0) + correctCount;
  await savePointsCorrectOffset();
  await saveProgress();
}

function lawStats(law){
  const qs = questionsForLaw(law);
  let attempted=0, correct=0;
  qs.forEach(q=>{ const p = STATE.storage.progress[q.id]; if(p){ attempted++; if(p.correct) correct++; } });
  const completionPct = qs.length ? Math.round(attempted/qs.length*100) : 0;
  const accuracyPct = attempted ? Math.round(correct/attempted*100) : 0;
  return { total: qs.length, attempted, correct, completionPct, accuracyPct };
}
function overallStats(){
  let total=0, attempted=0, correct=0;
  for(let i=1;i<=17;i++){ const s=lawStats(i); total+=s.total; attempted+=s.attempted; correct+=s.correct; }
  const completionPct = total ? Math.round(attempted/total*100) : 0;
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
function scopeLabel(q){
  if(q.domain==='glossary') return 'Glosario IFAB';
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
  app.innerHTML = viewFor(STATE.view);
  bindEvents();
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
    const targetUser = (STATE.adminStats && STATE.adminStats.lastTen) ? STATE.adminStats.lastTen.find(x=>x.id===STATE.confirmDeleteUserId) : null;
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
  return homeView();
}

function dailyChallengeView(){
  const heartsR = STATE.storage.heartsRecord || 0;
  const sdR = STATE.storage.suddenDeathRecord || 0;
  const taR = STATE.storage.timeAttackRecord || 0;
  const totalRecord = formatScore(heartsR + sdR + taR);

  const summary = STATE.leagueSummary;
  let rankLabel = '...', modeLabel = '...';
  if(summary){
    const ranked = [
      { label:'❤️ Corazones', rank: summary.hearts },
      { label:'💀 M. Súbita', rank: summary.suddendeath },
      { label:'⏱️ Contrarreloj', rank: summary.timeattack }
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

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <div class="app-header league-hero">
    <div class="eyebrow">Zona competitiva</div>
    <h2>WEREF League</h2>
    <div class="sub">Compite, supera tus récords y escala posiciones en la clasificación global.</div>
    <div class="league-summary-row">
      <div class="league-stat"><div class="num">${totalRecord}</div><div class="label">Récord total</div></div>
      <div class="league-stat"><div class="num">${rankLabel}</div><div class="label">Tu posición</div></div>
      <div class="league-stat"><div class="num">${modeLabel}</div><div class="label">Mejor modo</div></div>
    </div>
  </div>

  <button class="qcard league-lb-card" data-action="leaderboard">
    <div style="font-size:30px; flex-shrink:0;">🏆</div>
    <div style="flex:1; min-width:0;">
      <div style="font-weight:700; font-size:16px;">Clasificación Global</div>
      <div style="font-size:12.5px; color:var(--muted); margin-top:2px;">Consulta el Top 25 y descubre en qué posición te encuentras.</div>
    </div>
    <div class="arrow">›</div>
  </button>

  <div class="qcard league-mode-card" style="border-left:4px solid var(--red); margin-bottom:16px;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="font-size:28px; flex-shrink:0;">❤️</div>
        <div>
          <div style="font-weight:700; font-size:16px;">Modo Corazones</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">Consigue aciertos antes de perder tus 3 vidas.</div>
        </div>
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div style="font-size:9.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">🔥 Récord personal</div>
        <div class="mono" style="font-weight:700; font-size:24px; color:var(--red);">${heartsR}</div>
      </div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <span class="league-fact">❤️ 3 vidas</span>
      <span class="league-fact">🎯 Sin límite de tiempo</span>
      <span class="league-fact">🏆 Récord: ${heartsR}</span>
    </div>
    <div style="font-size:12px; color:var(--muted); font-style:italic; margin-bottom:12px;">¿Serás capaz de superar tu récord?</div>
    <button class="btn btn-primary" style="width:100%; background:var(--red);" data-action="start-hearts">▶️ Jugar ahora</button>
  </div>

  <div class="qcard league-mode-card" style="border-left:4px solid var(--pitch); margin-bottom:16px;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="font-size:28px; flex-shrink:0;">💀</div>
        <div>
          <div style="font-weight:700; font-size:16px;">Muerte Súbita</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">Una sola vida. Falla una vez y quedas eliminado.</div>
        </div>
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div style="font-size:9.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">🔥 Récord personal</div>
        <div class="mono" style="font-weight:700; font-size:24px; color:var(--pitch);">${sdR}</div>
      </div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <span class="league-fact">☠️ Una única vida</span>
      <span class="league-fact">⚡ Cada fallo termina la partida</span>
      <span class="league-fact">🏆 Récord: ${sdR}</span>
    </div>
    <div style="font-size:12px; color:var(--muted); font-style:italic; margin-bottom:12px;">Solo los mejores llegan al Top 25.</div>
    <button class="btn" style="width:100%; background:var(--pitch); color:#fff;" data-action="start-suddendeath">▶️ Jugar ahora</button>
  </div>

  <div class="qcard league-mode-card" style="border-left:4px solid var(--accent); margin-bottom:16px;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="font-size:28px; flex-shrink:0;">⏱️</div>
        <div>
          <div style="font-weight:700; font-size:16px;">Contrarreloj</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">60 segundos en el reloj. Sin vidas, pero cada fallo resta.</div>
        </div>
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div style="font-size:9.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">🔥 Récord personal</div>
        <div class="mono" style="font-weight:700; font-size:24px; color:var(--accent-dark);">${formatScore(taR)}</div>
      </div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <span class="league-fact">⏱️ 60 segundos</span>
      <span class="league-fact">❌ Cada fallo resta 0,5 puntos</span>
      <span class="league-fact">🏆 Récord: ${formatScore(taR)}</span>
    </div>
    <div style="font-size:12px; color:var(--muted); font-style:italic; margin-bottom:12px;">Cada punto cuenta para la clasificación.</div>
    <button class="btn" style="width:100%; background:var(--accent); color:#fff;" data-action="start-timeattack">▶️ Jugar ahora</button>
  </div>
  `;
}

function leaderboardView(){
  const mode = STATE.leaderboardMode || 'hearts';
  const modeLabel = mode==='hearts' ? '❤️ Modo Corazones' : mode==='suddendeath' ? '💀 Muerte Súbita' : '⏱️ Contrarreloj';
  const medals = ['🥇','🥈','🥉'];
  const s = STATE.myStanding;
  const participants = STATE.leaderboardParticipants;

  const rows = (STATE.leaderboard||[]).map((r,i) => {
    const isMe = r.user_id === CURRENT_USER_ID;
    const topCls = i===0 ? ' lb-top1' : i===1 ? ' lb-top2' : i===2 ? ' lb-top3' : '';
    const level = rankLevelFor(r.rank_name);
    return `
    <div class="lb-row${topCls}${isMe?' lb-me':''}" style="animation-delay:${Math.min(i*0.03,0.4)}s;">
      ${i<3 ? `<div class="lb-medal">${medals[i]}</div>` : `<div class="lb-rank">${i+1}</div>`}
      <div class="lb-flag">${COUNTRY_FLAGS[r.country] || '🏳️'}</div>
      <div class="lb-info">
        <div class="lb-name">${i===0?'👑 ':''}${esc(r.username || 'Anónimo')}${isMe?' <span class="lb-you-badge">TÚ</span>':''}</div>
        <div class="lb-meta">⭐ ${esc(r.rank_name || '')}${level?' · Nivel '+level:''} · ${r.points||0} XP</div>
      </div>
      <div class="lb-score">${formatScore(Number(r.score))}</div>
    </div>`;
  }).join('');

  let summaryStripHtml = `
  <div class="lb-summary-row">
    <div class="lb-summary-stat"><div class="num">${participants===null?'...':participants}</div><div class="label">👥 Participantes</div></div>
    <div class="lb-summary-stat"><div class="num">${s?'#'+s.rank:(s===false?'—':'...')}</div><div class="label">🏆 Tu posición</div></div>
    <div class="lb-summary-stat"><div class="num">${s?formatScore(Number(s.score)):(s===false?'—':'...')}</div><div class="label">🎯 Récord personal</div></div>
  </div>`;

  let standingHtml = '';
  if(s && s.rank>25){
    const rankInfo = nextRankInfo(s.points || 0);
    const level = rankLevelFor(s.rank_name);
    const gapText = s.nextAbove
      ? `Te faltan <strong>${formatScore(Number(s.nextAbove.score) - Number(s.score))}</strong> puntos para superar a ${esc(s.nextAbove.username || 'el jugador de arriba')}.`
      : 'Eres el primero de la lista en esta clasificación.';
    const milestoneText = (s.milestoneRank && s.milestoneScore!=null)
      ? `Te faltan <strong>${formatScore(Number(s.milestoneScore) - Number(s.score))}</strong> puntos para entrar en el Top ${s.milestoneRank}.`
      : (s.rank<=10 ? '¡Ya estás en el Top 10! 🎉' : '');
    standingHtml = `
    <div style="text-align:center; color:var(--muted); font-size:11px; margin:18px 0 10px; letter-spacing:0.06em;">━━━━━━━━━━━━━━━━━━<br>TU POSICIÓN</div>
    <div class="lb-standing">
      <div style="display:flex; align-items:center; gap:10px;">
        <div class="lb-rank" style="color:rgba(255,255,255,0.7);">#${s.rank}</div>
        <div class="lb-flag">${COUNTRY_FLAGS[s.country] || '🏳️'}</div>
        <div class="lb-info">
          <div class="lb-name">${esc(s.username || 'Tú')} <span class="lb-you-badge">TÚ</span></div>
          <div class="lb-meta">⭐ ${esc(s.rank_name || '')}${level?' · Nivel '+level:''} · ${s.points||0} XP</div>
        </div>
        <div class="lb-score">${formatScore(Number(s.score))}</div>
      </div>
      <div class="lb-gap">${gapText}</div>
      ${milestoneText ? `<div class="lb-gap">${milestoneText}</div>` : ''}
      ${rankInfo ? `
      <div class="lb-gap">Progreso hacia ${esc(rankInfo.name)}: ${rankInfo.progressPct}%</div>
      <div class="lb-progress-track"><div class="lb-progress-fill" style="width:${rankInfo.progressPct}%;"></div></div>
      ` : ''}
    </div>`;
  } else if(s===false){
    standingHtml = `<div class="empty-state" style="padding:16px;">Todavía no tienes puntuación en este modo. ¡Juega una partida para entrar en la clasificación!</div>`;
  }

  return `
  <button class="backbtn" data-action="dailyChallenge">&larr; WEREF League</button>
  <h2 style="margin-bottom:4px;">🏆 Clasificación Global</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:14px; font-size:13.5px;">${modeLabel} · Top 25</div>
  <div class="tabs" style="margin-bottom:14px;">
    <button class="tab ${mode==='hearts'?'active':''}" data-action="leaderboard-tab" data-mode="hearts">❤️ Corazones</button>
    <button class="tab ${mode==='suddendeath'?'active':''}" data-action="leaderboard-tab" data-mode="suddendeath">💀 Muerte Súbita</button>
    <button class="tab ${mode==='timeattack'?'active':''}" data-action="leaderboard-tab" data-mode="timeattack">⏱️ Contrarreloj</button>
  </div>
  ${summaryStripHtml}
  <div class="qcard" style="padding:6px 10px;">${rows || '<div class="empty-state">Todavía no hay puntuaciones en este modo. ¡Sé el primero!</div>'}</div>
  ${standingHtml}
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

function myBankCategoriesView(){
  const cats = (STATE.storage.myBankCategories||[]).slice().sort((a,b)=>a.localeCompare(b));
  const counts = myBankCategoryCounts();
  const uncategorizedCount = counts[''] || 0;
  const totalQuestions = (STATE.storage.myBank||[]).length;

  const rows = cats.map(c => `
    <button class="breakdown-row" style="width:100%; text-align:left; border:none; cursor:pointer; font:inherit; color:inherit;" data-action="mybank-open-category" data-category="${esc(c)}">
      <span>📂 ${esc(c)} <span class="mono" style="color:var(--muted); font-size:11.5px;">(${counts[c]||0})</span></span>
      <span class="arrow">›</span>
    </button>
  `).join('');

  return `
  <button class="backbtn" data-action="academia">&larr; Mi Academia</button>
  <h2 style="margin-bottom:4px;">📁 Mis Propios Test</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Tu contenido privado, organizado por categorías. Nadie más puede verlo, y nunca se mezcla con las preguntas de WEREF.</div>

  <div style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap;">
    ${STATE.myBankCreatingCategory ? '' : `<button class="btn btn-primary" data-action="mybank-new-category">+ Nueva categoría</button>`}
    ${totalQuestions>0 ? `<button class="btn btn-secondary" data-action="mybank-train-config">▶ Crear test</button>` : ''}
  </div>

  ${STATE.myBankCreatingCategory ? `
  <div class="qcard" style="margin-bottom:14px;">
    <label>Nombre de la categoría</label>
    <input type="text" id="mybank-new-category-name" placeholder="Ej: Tema 3, Casos prácticos..." maxlength="60">
    <div style="margin-top:12px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="mybank-save-category">Crear</button>
      <button class="btn btn-ghost" data-action="mybank-cancel-category">Cancelar</button>
    </div>
  </div>
  ` : ''}

  <div class="qcard" style="padding:6px 10px; margin-bottom:14px;">
    ${rows || (uncategorizedCount===0 ? `<div class="empty-state">Todavía no has creado ninguna categoría. Crea la primera para empezar a añadir preguntas.</div>` : '')}
  </div>

  ${uncategorizedCount>0 ? `
  <button class="breakdown-row" style="width:100%; text-align:left; border:none; cursor:pointer; font:inherit; color:inherit;" data-action="mybank-open-category" data-category="">
    <span>🗂️ Sin categoría <span class="mono" style="color:var(--muted); font-size:11.5px;">(${uncategorizedCount})</span></span>
    <span class="arrow">›</span>
  </button>
  ` : ''}
  `;
}

function myBankCategoryView(){
  const cat = STATE.myBankViewCategory;
  const catLabel = cat === '' ? 'Sin categoría' : cat;
  const list = (STATE.storage.myBank||[]).filter(q => (q.category||'') === cat);
  const s = (STATE.myBankSearch||'').trim().toLowerCase();
  const filtered = s ? list.filter(q => q.question.toLowerCase().includes(s) || q.options.some(o=>o.toLowerCase().includes(s))) : list;
  const letters = ['a','b','c','d'];
  const rows = filtered.map(q => `
    <div class="qcard" style="margin-bottom:10px;">
      <div class="qtext" style="font-size:14.5px;">${esc(q.question)}</div>
      ${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default; padding:9px 12px;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}
      ${q.explanation ? `<div style="margin-top:8px; padding:8px 12px; background:#FBF1F1; border-radius:8px; font-size:12.5px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px;" data-action="mybank-edit" data-qid="${q.id}">Editar</button>
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px; color:var(--red); border-color:#F0C4C4;" data-action="mybank-delete" data-qid="${q.id}">Eliminar</button>
      </div>
    </div>
  `).join('');
  return `
  <button class="backbtn" data-action="mybank">&larr; Mis Propios Test</button>
  <h2 style="margin-bottom:4px;">📂 ${esc(catLabel)}</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">${list.length} pregunta(s)</div>

  <div style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap;">
    <button class="btn btn-primary" data-action="mybank-add">+ Añadir pregunta aquí</button>
    ${cat!=='' ? `<button class="btn btn-ghost" style="color:var(--red); border-color:#F0C4C4;" data-action="mybank-delete-category" data-category="${esc(cat)}">Eliminar categoría</button>` : ''}
  </div>

  <div class="qcard" style="margin-bottom:14px;">
    <label>Buscar en esta categoría</label>
    <input type="text" id="mybank-search" placeholder="Busca por palabra..." value="${esc(STATE.myBankSearch)}" maxlength="100">
  </div>

  ${rows || `<div class="empty-state">${list.length===0 ? 'Todavía no hay preguntas en esta categoría.' : 'Ninguna coincide con esa búsqueda.'}</div>`}
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
  return `
  <button class="backbtn" data-action="${STATE.myBankViewCategory!==null ? 'mybank-open-category-back' : 'mybank'}">&larr; Volver</button>
  <h2>${editing ? 'Editar pregunta' : 'Añadir pregunta'}</h2>
  <div class="qcard">
    <label>Categoría</label>
    <select id="mb-category">
      ${cats.map(c=>`<option value="${esc(c)}" ${catVal===c?'selected':''}>${esc(c)}</option>`).join('')}
      <option value="" ${catVal===''?'selected':''}>Sin categoría</option>
    </select>
    <label>Pregunta</label>
    <textarea id="mb-question" placeholder="Escribe el enunciado..." maxlength="1000">${esc(getField('question'))}</textarea>
    <label>Número de opciones de respuesta</label>
    <select id="mb-option-count">
      ${[3,4].map(n=>`<option value="${n}" ${optionCount===n?'selected':''}>${n} opciones</option>`).join('')}
    </select>
    ${letters.map((l,i)=>`<label>Respuesta ${l})</label><input type="text" id="mb-${l}" maxlength="300" value="${esc(getOption(i))}">`).join('')}
    <label>Respuesta correcta</label>
    <select id="mb-correct">${letters.map(l=>`<option value="${l}" ${correctVal===l?'selected':''}>${l})</option>`).join('')}</select>
    <label>Explicación o anotación personal (opcional)</label>
    <textarea id="mb-explanation" placeholder="Por qué es correcta, referencia, apunte propio..." maxlength="2000">${esc(getField('explanation'))}</textarea>
    <div style="margin-top:18px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="mybank-save" ${editing ? `data-qid="${editing.id}"` : ''}>Guardar</button>
      <button class="btn btn-ghost" data-action="${STATE.myBankViewCategory!==null ? 'mybank-open-category-back' : 'mybank'}">Cancelar</button>
    </div>
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

function myBankTrainConfigView(){
  const cfg = STATE.myBankTrainCfg;
  const cats = (STATE.storage.myBankCategories||[]).slice().sort((a,b)=>a.localeCompare(b));
  const scoped = cfg.categories.length ? (STATE.storage.myBank||[]).filter(q=>cfg.categories.includes(q.category)) : (STATE.storage.myBank||[]);
  return `
  <button class="backbtn" data-action="mybank">&larr; Mis Propios Test</button>
  <h2 style="margin-bottom:4px;">Crear test · Mis Propios Test</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:18px; font-size:13.5px;">Elige qué categorías incluir, cuántas preguntas quieres y cómo quieres el tiempo.</div>
  <div class="qcard">
    ${cats.length>0 ? `
    <label>Categorías incluidas</label>
    <div class="tabs">
      <button class="tab ${cfg.categories.length===0?'active':''}" data-action="mybank-toggle-train-category" data-category="all">Todas</button>
      ${cats.map(c=>`<button class="tab ${cfg.categories.includes(c)?'active':''}" data-action="mybank-toggle-train-category" data-category="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    ` : ''}
    <div style="font-size:12px; color:var(--muted); margin-top:8px;">${scoped.length} pregunta(s) disponibles con esta selección.</div>

    <label>Número de preguntas <span class="mono" style="color:var(--muted); text-transform:none; font-weight:500;">(máximo 50)</span></label>
    <input type="text" inputmode="numeric" id="mybank-cfg-count" value="${Math.min(cfg.count,50)}" maxlength="2">

    <label>Tipo de test</label>
    <div class="tabs">
      <button class="tab ${cfg.feedbackMode==='exam'?'active':''}" data-action="mybank-set-feedback-mode" data-fbmode="exam">Modo examen</button>
      <button class="tab ${cfg.feedbackMode==='study'?'active':''}" data-action="mybank-set-feedback-mode" data-fbmode="study">Modo estudio</button>
    </div>
    <div style="font-size:12px; color:var(--muted); margin-top:4px;">${cfg.feedbackMode==='study' ? 'Verás si aciertas y la solución al momento de responder cada pregunta.' : 'No sabrás los resultados hasta terminar todo el test.'}</div>

    <label>Temporización</label>
    <div class="tabs">
      <button class="tab ${cfg.timerMode==='none'?'active':''}" data-action="mybank-set-timer-mode" data-mode="none">Sin límite</button>
      <button class="tab ${cfg.timerMode==='total'?'active':''}" data-action="mybank-set-timer-mode" data-mode="total">Tiempo total</button>
      <button class="tab ${cfg.timerMode==='perQuestion'?'active':''}" data-action="mybank-set-timer-mode" data-mode="perQuestion">Tiempo por pregunta</button>
    </div>
    ${cfg.timerMode==='total' ? `
      <label>Minutos para todo el examen</label>
      <input type="text" inputmode="numeric" id="mybank-cfg-minutes" value="${cfg.minutes}" maxlength="4">
    ` : ''}
    ${cfg.timerMode==='perQuestion' ? `
      <label>Segundos por pregunta</label>
      <input type="text" inputmode="numeric" id="mybank-cfg-seconds-per-q" value="${cfg.secondsPerQuestion}" maxlength="4">
    ` : ''}

    <div style="margin-top:20px;">
      <button class="btn btn-primary" data-action="mybank-generate-exam">Generar examen</button>
    </div>
  </div>
  `;
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
  STATE.view = 'myBankQuiz';
  render();
  if(timerMode==='total' || timerMode==='perQuestion') myBankStartTimer();
}

function myBankCurrentQ(){
  const quiz = STATE.myBankQuiz;
  return (STATE.storage.myBank||[]).find(q=>q.id===quiz.qids[quiz.idx]);
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
  const bank = STATE.storage.myBank||[];
  const score = quiz.qids.filter(qid => {
    const q = bank.find(x=>x.id===qid);
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
  const pathLabel = showPath ? myDocsBreadcrumb(d.folderId).map(f=>f.name).join(' / ') || 'Mis Documentos' : null;
  const folderOptions = [{id:'', name:'Mis Documentos', depth:0}].concat(myDocsAllFoldersFlat().map(x=>({id:x.folder.id, name:x.folder.name, depth:x.depth})));
  return `
    <div class="qcard" style="margin-bottom:10px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div>
          <div style="font-weight:700; font-size:14px;">📄 ${esc(d.name)}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">${formatBytes(d.size)} · ${new Date(d.createdAt).toLocaleDateString('es-ES')}${pathLabel ? ' · 📁 '+esc(pathLabel) : ''}</div>
        </div>
      </div>
      ${STATE.myDocsEditingNotesId===d.id ? `
        <textarea id="mydoc-notes-${d.id}" placeholder="Notas o comentario personal..." maxlength="1000" style="margin-top:10px;">${esc(d.notes||'')}</textarea>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn btn-primary" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-save-notes" data-id="${d.id}">Guardar nota</button>
          <button class="btn btn-ghost" style="padding:6px 12px; font-size:12.5px;" data-action="mydocs-cancel-notes">Cancelar</button>
        </div>
      ` : (d.notes ? `<div style="margin-top:8px; padding:8px 12px; background:#FBF1F1; border-radius:8px; font-size:12.5px; white-space:pre-wrap;">${esc(d.notes)}</div>` : '')}
      ${STATE.myDocsMovingId===d.id ? `
        <div style="margin-top:10px;">
          <label>Mover a</label>
          <select id="mydocs-move-select-${d.id}">
            ${folderOptions.map(f=>`<option value="${f.id}" ${d.folderId===(f.id||null)?'selected':''}>${'— '.repeat(f.depth)}${esc(f.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-secondary" style="padding:7px 14px; font-size:13px;" data-action="mydocs-preview" data-id="${d.id}">Ver</button>
        ${STATE.myDocsEditingNotesId===d.id ? '' : `<button class="btn btn-ghost" style="padding:7px 14px; font-size:13px;" data-action="mydocs-edit-notes" data-id="${d.id}">${d.notes?'Editar nota':'+ Nota'}</button>`}
        ${STATE.myDocsMovingId===d.id ? '' : `<button class="btn btn-ghost" style="padding:7px 14px; font-size:13px;" data-action="mydocs-move" data-id="${d.id}">Mover</button>`}
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px; color:var(--red); border-color:#F0C4C4;" data-action="mydocs-delete" data-id="${d.id}">Eliminar</button>
      </div>
    </div>
  `;
}

function myDocsView(){
  const folderId = STATE.myDocsCurrentFolder;
  const s = (STATE.myDocsSearch||'').trim().toLowerCase();
  const sortControls = `
    <div class="tabs">
      <button class="tab ${STATE.myDocsSortBy==='name'?'active':''}" data-action="mydocs-set-sort" data-sort="name">Nombre</button>
      <button class="tab ${STATE.myDocsSortBy==='date'?'active':''}" data-action="mydocs-set-sort" data-sort="date">Fecha</button>
    </div>
  `;
  const uploadControls = `
  <div style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
    ${STATE.myDocsCreatingFolder ? '' : `<button class="btn btn-secondary" data-action="mydocs-new-folder">+ Nueva carpeta</button>`}
    <label class="btn btn-primary" style="cursor:pointer; margin:0;">
      ${STATE.myDocsUploading ? 'Subiendo...' : '+ Subir PDF'}
      <input type="file" id="mydocs-upload-input" accept="application/pdf" style="display:none;" ${STATE.myDocsUploading?'disabled':''}>
    </label>
    <span style="font-size:12px; color:var(--muted);">o arrastra un PDF aquí</span>
  </div>
  ${STATE.myDocsCreatingFolder ? `
  <div class="qcard" style="margin-bottom:14px;">
    <label>Nombre de la carpeta</label>
    <input type="text" id="mydocs-new-folder-name" placeholder="Ej: Temporada 2025/2026" maxlength="60">
    <div style="margin-top:12px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="mydocs-save-folder">Crear</button>
      <button class="btn btn-ghost" data-action="mydocs-cancel-folder">Cancelar</button>
    </div>
  </div>
  ` : ''}
  <div class="qcard" style="margin-bottom:14px;">
    <label>Buscar en todos tus documentos y carpetas</label>
    <input type="text" id="mydocs-search" placeholder="Busca por nombre o nota..." value="${esc(STATE.myDocsSearch)}" maxlength="100">
  </div>
  `;

  if(s){
    const matchFolders = (STATE.storage.myDocsFolders||[]).filter(f=>f.name.toLowerCase().includes(s));
    const matchDocs = (STATE.storage.myDocs||[]).filter(d => d.name.toLowerCase().includes(s) || (d.notes||'').toLowerCase().includes(s));
    const folderRows = myDocsSort(matchFolders,'createdAt').map(f => `
      <button class="breakdown-row" style="width:100%; text-align:left; border:none; cursor:pointer; font:inherit; color:inherit;" data-action="mydocs-open-folder" data-folder="${f.id}">
        <span>📂 ${esc(f.name)} <span class="mono" style="color:var(--muted); font-size:11px;">${esc(myDocsBreadcrumb(f.parentId).map(x=>x.name).join(' / ') || 'Mis Documentos')}</span></span>
        <span class="arrow">›</span>
      </button>`).join('');
    const docRows = myDocsSort(matchDocs,'createdAt').map(d=>myDocRowHtml(d, true)).join('');
    return `
    <button class="backbtn" data-action="academia">&larr; Mi Academia</button>
    <h2 style="margin-bottom:4px;">📁 Mis Documentos</h2>
    <div class="sub" style="color:var(--muted); margin-bottom:12px; font-size:13.5px;">Resultados de "${esc(STATE.myDocsSearch)}" en todas las carpetas.</div>
    <div id="mydocs-dropzone" class="mydocs-dropzone">
    ${uploadControls}
    ${matchFolders.length>0 ? `<div class="qcard" style="padding:6px 10px; margin-bottom:14px;">${folderRows}</div>` : ''}
    ${docRows || `<div class="empty-state">Nada coincide con esa búsqueda.</div>`}
    </div>
    `;
  }

  const subfolders = myDocsSort(myDocsChildFolders(folderId), 'createdAt');
  const docs = myDocsSort(myDocsInFolder(folderId), 'createdAt');
  const trail = myDocsBreadcrumb(folderId);

  const breadcrumbHtml = `
    <button class="btn btn-ghost" style="padding:4px 10px; font-size:12.5px;" data-action="mydocs-open-folder" data-folder="">📁 Mis Documentos</button>
    ${trail.map(f=>`<span style="color:var(--muted);">/</span> <button class="btn btn-ghost" style="padding:4px 10px; font-size:12.5px;" data-action="mydocs-open-folder" data-folder="${f.id}">${esc(f.name)}</button>`).join(' ')}
  `;

  const folderRows = subfolders.map(f => {
    const childCount = myDocsChildFolders(f.id).length + myDocsInFolder(f.id).length;
    if(STATE.myDocsRenamingFolderId===f.id){
      return `<div style="padding:10px 0; border-bottom:1px solid var(--line);">
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
      return `<div style="padding:10px 0; border-bottom:1px solid var(--line);">
        <div style="font-size:13px; margin-bottom:8px;">📂 ${esc(f.name)}</div>
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
    <div class="breakdown-row">
      <button style="flex:1; text-align:left; background:none; border:none; cursor:pointer; font:inherit; color:inherit; padding:0;" data-action="mydocs-open-folder" data-folder="${f.id}">
        📂 ${esc(f.name)} <span class="mono" style="color:var(--muted); font-size:11.5px;">(${childCount})</span>
      </button>
      <button class="icon-btn" title="Renombrar" data-action="mydocs-rename-folder" data-folder="${f.id}">✏️</button>
      <button class="icon-btn" title="Mover" data-action="mydocs-move-folder" data-folder="${f.id}">➡️</button>
      <button class="icon-btn" title="Eliminar" data-action="mydocs-delete-folder" data-folder="${f.id}">🗑️</button>
      <span class="arrow">›</span>
    </div>`;
  }).join('');

  const docRows = docs.map(d=>myDocRowHtml(d, false)).join('');

  return `
  <button class="backbtn" data-action="academia">&larr; Mi Academia</button>
  <h2 style="margin-bottom:4px;">📁 Mis Documentos</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:12px; font-size:13.5px;">Tus PDFs privados (informes, circulares, evaluaciones...). Solo tú puedes verlos. Máximo 20 MB por archivo.</div>

  <div style="margin-bottom:10px; font-size:13px;">${breadcrumbHtml}</div>
  <div style="margin-bottom:14px;">${sortControls}</div>

  <div id="mydocs-dropzone" class="mydocs-dropzone">
  ${uploadControls}

  ${subfolders.length>0 ? `<div class="qcard" style="padding:6px 10px; margin-bottom:14px;">${folderRows}</div>` : ''}

  ${docRows || `<div class="empty-state">${subfolders.length===0 && docs.length===0 ? 'Esta carpeta está vacía. Crea una subcarpeta o sube tu primer PDF.' : 'Ningún documento coincide con esa búsqueda.'}</div>`}
  </div>
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

function myDocsPreviewView(){
  const doc = (STATE.storage.myDocs||[]).find(d=>d.id===STATE.myDocsPreviewId);
  if(!doc) return `<button class="backbtn" data-action="mydocs">&larr; Mis Documentos</button><div class="empty-state">Documento no encontrado.</div>`;
  return `
  <button class="backbtn" data-action="mydocs">&larr; Mis Documentos</button>
  <h2 style="margin-bottom:4px; font-size:16px;">📄 ${esc(doc.name)}</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:12px; font-size:12.5px;">${formatBytes(doc.size)} · ${new Date(doc.createdAt).toLocaleDateString('es-ES')}</div>
  ${STATE.myDocsPreviewUrl
    ? `<iframe src="${STATE.myDocsPreviewUrl}" style="width:100%; height:70vh; border:1.5px solid var(--line); border-radius:10px; background:#fff;"></iframe>
       <div style="margin-top:10px;"><a href="${STATE.myDocsPreviewUrl}" target="_blank" rel="noopener" class="btn btn-ghost" style="text-decoration:none; display:inline-block;">Abrir en pestaña nueva</a></div>`
    : `<div class="empty-state">Cargando documento...</div>`}
  `;
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
  const rows = recentPerformanceByRule(25);
  const items = rows.map(r => {
    const label = r.total===0
      ? '<span class="law-sub-muted">Sin datos aún</span>'
      : `${accuracyBadge(r.pct)}`;
    return `<button class="breakdown-row" data-action="open-law" data-law="${r.rule}" style="width:100%; text-align:left; border:none; cursor:pointer; font:inherit; color:inherit;">
      <span>Regla ${r.rule} · ${esc(LAW_NAMES[r.rule])}</span>
      <span style="display:flex; align-items:center; gap:6px;">${label}</span>
    </button>`;
  }).join('');
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Analiza tu rendimiento</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:18px; font-size:13.5px;">Comprueba en qué reglas obtienes mejores resultados y cuáles necesitas reforzar. Los porcentajes se calculan sobre tus últimas 25 respuestas por regla.</div>
  <div class="qcard">${items}</div>
  `;
}

function streakCalendarView(){
  const days = activeDaysSet();
  const eventsByDay = calendarEventsByDay();
  const streak = computeStreak();
  const totalActiveDays = days.size;
  const now = new Date();
  const todayKey = dayKey(now.getTime());
  const year = STATE.calendarYear || now.getFullYear();
  const isCurrentYear = year === now.getFullYear();

  let months = '';
  for(let m=0; m<12; m++){
    const firstOfMonth = new Date(year, m, 1);
    const daysInMonth = new Date(year, m+1, 0).getDate();
    let startWeekday = firstOfMonth.getDay(); // 0=Sunday
    startWeekday = (startWeekday===0) ? 6 : startWeekday-1; // convert to Monday-first index 0-6

    let cells = '';
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

    months += `<div class="cal-month">
      <div class="cal-month-name">${MONTH_NAMES[m]}</div>
      <div class="cal-grid">${cells}</div>
    </div>`;
  }

  const sortedEvents = (STATE.storage.calendarEvents||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const eventRows = sortedEvents.map(ev=>{
    const isPast = ev.date < todayKeyISO(now);
    const t = CALENDAR_EVENT_TYPES[ev.type] || CALENDAR_EVENT_TYPES.other;
    return `<div class="breakdown-row" style="border-left:4px solid ${t.color}; padding-left:10px; ${isPast?'opacity:0.5;':''}">
      <span style="display:flex; align-items:center; gap:8px;">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; background:${t.bg}; font-size:13px; flex-shrink:0;">${t.icon}</span>
        <span><strong>${esc(ev.title)}</strong><br><span class="mono" style="color:${t.color}; font-size:11px; font-weight:700;">${t.label} · ${formatEventDate(ev.date)}</span></span>
      </span>
      <button class="icon-btn" title="Eliminar" data-action="calendar-delete-event" data-id="${ev.id}">🗑️</button>
    </div>`;
  }).join('');

  const addForm = STATE.calendarAddingEvent ? `
  <div class="qcard" style="margin-bottom:14px;">
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

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Racha de estudio</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:18px; font-size:13.5px;">Convierte el calendario en tu centro de planificación. Registra automáticamente los días en los que estudias y añade las fechas más importantes de tu preparación, como exámenes, pruebas físicas o reuniones, para tener toda tu planificación en un mismo lugar.</div>

  <div class="result-hero" style="margin-bottom:18px;">
    <div style="font-size:26px;">🔥</div>
    <div class="big" style="color:var(--pitch); font-size:38px;">${streak}</div>
    <div class="label">día${streak===1?'':'s'} seguidos ahora mismo · ${totalActiveDays} día${totalActiveDays===1?'':'s'} activo${totalActiveDays===1?'':'s'} en total</div>
  </div>

  <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
    <div class="section-title" style="margin:0;">Tus eventos <span class="mono" style="font-size:11px; color:var(--muted); text-transform:none;">(${sortedEvents.length}/${CALENDAR_EVENTS_MAX})</span></div>
    ${STATE.calendarAddingEvent || sortedEvents.length>=CALENDAR_EVENTS_MAX ? '' : `<button class="btn btn-secondary" style="padding:8px 14px; font-size:12.5px;" data-action="calendar-add-event">+ Añadir evento</button>`}
  </div>
  ${(!STATE.calendarAddingEvent && sortedEvents.length>=CALENDAR_EVENTS_MAX) ? `<div class="sub" style="color:var(--muted); margin-bottom:10px; font-size:12.5px;">Has llegado al máximo de ${CALENDAR_EVENTS_MAX} eventos. Elimina alguno para añadir otro.</div>` : ''}
  ${addForm}
  ${sortedEvents.length>0 ? `<div class="qcard" style="padding:6px 10px; margin-bottom:18px;">${eventRows}</div>` : `<div class="empty-state" style="padding:20px;">Todavía no has añadido ningún evento. Usa "+ Añadir evento" para marcar tu próximo examen, prueba física o reunión.</div>`}

  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
    <button class="btn btn-ghost" data-action="calendar-year" data-delta="-1" ${year<=2025?'disabled':''}>‹ ${year-1}</button>
    <div style="font-weight:700; font-size:16px;">${year}</div>
    <button class="btn btn-ghost" data-action="calendar-year" data-delta="1" ${year>=now.getFullYear()+1?'disabled':''}>${year+1} ›</button>
  </div>

  <div class="cal-wrap">${months}</div>
  <div style="display:flex; align-items:center; gap:6px; margin-top:14px; font-size:11.5px; color:var(--muted); flex-wrap:wrap;">
    <div class="cal-cell active" style="width:12px; height:12px; font-size:0;"></div> Día con actividad
    <div class="cal-cell" style="width:12px; height:12px; font-size:0; margin-left:10px;"></div> Sin actividad
    ${Object.values(CALENDAR_EVENT_TYPES).map(t=>`<span style="display:inline-flex; align-items:center; gap:5px; margin-left:10px;"><span style="width:10px; height:10px; border-radius:50%; background:${t.color}; display:inline-block; flex-shrink:0;"></span>${t.label}</span>`).join('')}
  </div>
  `;
}

function achievementsView(){
  const points = computePoints();
  const rank = currentRank(points);
  const next = nextRankInfo(points);
  const unlocked = STATE.storage.unlockedBadges || {};

  let rankRows = RANKS.map(r=>{
    const reached = points >= r.min;
    return `<div class="breakdown-row"><span style="${reached?'font-weight:700;':'color:var(--muted);'}">${reached?'✓ ':''}${r.name}</span><span class="mono" style="color:var(--muted);">${r.min}+ pts</span></div>`;
  }).join('');

  let badgeCards = BADGES.map(b=>{
    const isUnlocked = !!unlocked[b.id];
    return `<div class="qcard" style="display:flex; align-items:center; gap:14px; margin-bottom:10px; ${isUnlocked?'':'opacity:0.45;'}">
      <div style="width:44px; height:44px; border-radius:50%; background:${isUnlocked?'#FFF1E8':'#F0F0F0'}; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">${b.icon}</div>
      <div>
        <div style="font-weight:700; font-size:13.5px;">${b.name}${isUnlocked?' <span class="badge" style="background:var(--green-ok); color:#fff;">Conseguida</span>':''}</div>
        <div style="font-size:12px; color:var(--muted); margin-top:2px;">${b.desc}</div>
      </div>
    </div>`;
  }).join('');

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
    <div>
      <h2 style="margin-bottom:4px;">Tu progreso arbitral</h2>
      <div class="sub" style="color:var(--muted); margin-bottom:18px; font-size:13.5px;">Puntos por preguntas acertadas, tests completados y racha de estudio.</div>
    </div>
    <button class="btn btn-ghost" style="padding:8px 14px; font-size:12.5px;" data-action="profile">⚙️ Configuración de cuenta</button>
  </div>

  <div class="result-hero" style="margin-bottom:16px;">
    <div class="big" style="color:var(--pitch); font-size:34px;">${rank.name}</div>
    <div class="label">${points} puntos ${next ? '· '+next.remaining+' para '+next.name : '· ¡rango máximo!'}</div>
  </div>

  <div class="section-title">Escala de rangos</div>
  <div class="qcard" style="margin-bottom:20px;">${rankRows}</div>

  <div class="section-title">Insignias (${Object.keys(unlocked).length}/${BADGES.length})</div>
  ${badgeCards}
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
  return `
  <button class="backbtn" data-action="achievements">&larr; Tu progreso arbitral</button>
  <h2 style="margin-bottom:4px;">⚙️ Configuración de cuenta</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:18px; font-size:13.5px;">${typeof CURRENT_USER_EMAIL!=='undefined' && CURRENT_USER_EMAIL ? esc(CURRENT_USER_EMAIL) : ''}</div>
  <div class="menu-list">
    <button class="menu-item" data-action="profile-edit">
      <div><div class="title">Editar perfil</div><div class="desc">Nombre, apellidos, país, fecha de nacimiento, ciudad y código postal</div></div>
      <div class="arrow">›</div>
    </button>
    <button class="menu-item" data-action="logout">
      <div><div class="title" style="color:var(--red);">Cerrar sesión</div></div>
      <div class="arrow">›</div>
    </button>
  </div>
  `;
}

function profileEditView(){
  if(!STATE.profileData){
    return `<button class="backbtn" data-action="profile">&larr; Configuración de cuenta</button><div class="empty-state">Cargando tus datos...</div>`;
  }
  const p = STATE.profileData;
  return `
  <button class="backbtn" data-action="profile">&larr; Configuración de cuenta</button>
  <h2 style="margin-bottom:4px;">Editar perfil</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Tu nombre de usuario no se puede cambiar. El resto de datos, sí.</div>
  <div class="qcard">
    <label>Nombre</label>
    <input type="text" id="profile-name" maxlength="100" value="${esc(p.full_name||'')}">
    <label>Apellidos</label>
    <input type="text" id="profile-lastname" maxlength="100" value="${esc(p.last_name||'')}">
    <label>País</label>
    <select id="profile-country">
      <option value="">Selecciona tu país</option>
      ${PROFILE_COUNTRIES.map(c=>`<option value="${esc(c)}" ${p.country===c?'selected':''}>${esc(c)}</option>`).join('')}
    </select>
    <label>Fecha de nacimiento</label>
    <input type="date" id="profile-birthdate" value="${esc(p.birthdate||'')}">
    <label>Ciudad</label>
    <input type="text" id="profile-city" maxlength="100" value="${esc(p.city||'')}">
    <label>Código postal</label>
    <input type="text" id="profile-postcode" maxlength="12" inputmode="numeric" value="${esc(p.postcode||'')}">
    <div style="margin-top:16px; display:flex; gap:10px;">
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

  const DOC_COLOR = '#1D6FE0', BANK_COLOR = 'var(--accent)', SAVED_COLOR = 'var(--yellow-ink)', SAVED_BORDER = 'var(--yellow)';

  const summaryHtml = hasContent ? `
  <div class="qcard" style="margin-bottom:16px;">
    <div class="lb-summary-row" style="margin-bottom:${overallLastText?'10px':'0'};">
      <div class="lb-summary-stat"><div class="num">📄 ${docsCount}</div><div class="label">Documento(s)</div></div>
      <div class="lb-summary-stat"><div class="num">✍️ ${bankCount}</div><div class="label">Preguntas creadas</div></div>
      <div class="lb-summary-stat"><div class="num">⭐ ${savedCount}</div><div class="label">Preguntas guardadas</div></div>
    </div>
    ${overallLastText ? `<div style="font-size:12px; color:var(--muted); text-align:center;">Última actividad: ${overallLastText}</div>` : ''}
  </div>` : '';

  const motivationalHtml = hasContent ? `
  <div class="qcard" style="margin-top:2px; text-align:center; padding:22px 18px;">
    <div style="font-weight:700; font-size:14.5px; margin-bottom:6px;">Tu academia sigue creciendo.</div>
    <div style="font-size:13px; color:var(--muted);">Continúa añadiendo material y crea entrenamientos cada vez más personalizados.</div>
  </div>` : `
  <div class="qcard" style="margin-top:2px; text-align:center; padding:22px 18px;">
    <div style="font-weight:700; font-size:14.5px; margin-bottom:6px;">💡 Continúa construyendo tu academia</div>
    <div style="font-size:13px; color:var(--muted);">Crea tu primera categoría personalizada o añade nuevos documentos para ampliar tu biblioteca de estudio.</div>
  </div>`;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">🎓 Mi Academia</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Tu espacio personal para organizar documentos, crear tus propios test y guardar las preguntas que quieras repasar. Todo este contenido es completamente privado y nunca se mezcla con el contenido oficial de WEREF.</div>

  ${summaryHtml}

  <button class="qcard academia-module-card" style="border-left:4px solid ${DOC_COLOR}; margin-bottom:14px; text-align:left; cursor:pointer; width:100%;" data-action="mydocs-home">
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
      <div style="font-size:26px;">📄</div>
      <div style="font-weight:700; font-size:16px;">Documentos</div>
    </div>
    <div style="font-size:12.5px; color:var(--muted); margin-bottom:10px;">Guarda reglamentos, circulares, apuntes y cualquier material de estudio.</div>
    <div style="font-size:12px; color:${DOC_COLOR}; font-weight:700;">📂 ${docsCount>0 ? docsCount+' documento(s) almacenado(s)' : 'Todavía no has subido ningún documento'}</div>
    ${docsLastTs ? `<div style="font-size:11.5px; color:var(--muted); margin-top:3px;">Último documento añadido ${formatRelativeTime(docsLastTs)}.</div>` : ''}
    <div style="text-align:right; font-size:12px; color:${DOC_COLOR}; font-weight:700; margin-top:8px;">Entrar →</div>
  </button>

  <button class="qcard academia-module-card" style="border-left:4px solid ${BANK_COLOR}; margin-bottom:14px; text-align:left; cursor:pointer; width:100%;" data-action="mybank">
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
      <div style="font-size:26px;">✍️</div>
      <div style="font-weight:700; font-size:16px;">Mis propios test</div>
    </div>
    <div style="font-size:12.5px; color:var(--muted); margin-bottom:10px;">Crea categorías, añade preguntas y genera test completamente personalizados.</div>
    <div style="font-size:12px; color:${BANK_COLOR}; font-weight:700;">📝 ${bankCount>0 ? bankCount+' pregunta(s) creada(s)' : 'Todavía no has creado ninguna pregunta'}</div>
    ${bankLastTs ? `<div style="font-size:11.5px; color:var(--muted); margin-top:3px;">Última pregunta creada ${formatRelativeTime(bankLastTs)}.</div>` : ''}
    <div style="text-align:right; font-size:12px; color:${BANK_COLOR}; font-weight:700; margin-top:8px;">Entrar →</div>
  </button>

  <button class="qcard academia-module-card" style="border-left:4px solid ${SAVED_BORDER}; margin-bottom:16px; text-align:left; cursor:pointer; width:100%;" data-action="open-law" data-law="saved">
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
      <div style="font-size:26px;">⭐</div>
      <div style="font-weight:700; font-size:16px;">Preguntas guardadas</div>
    </div>
    <div style="font-size:12.5px; color:var(--muted); margin-bottom:10px;">Accede rápidamente a todas las preguntas que has marcado para repasar más adelante.</div>
    <div style="font-size:12px; color:${SAVED_COLOR}; font-weight:700;">📌 ${savedCount>0 ? savedCount+' pregunta(s) pendiente(s)' : 'Todavía no has guardado ninguna pregunta'}</div>
    ${savedLastTs ? `<div style="font-size:11.5px; color:var(--muted); margin-top:3px;">Última pregunta guardada ${formatRelativeTime(savedLastTs)}.</div>` : ''}
    <div style="text-align:right; font-size:12px; color:${SAVED_COLOR}; font-weight:700; margin-top:8px;">Entrar →</div>
  </button>

  ${motivationalHtml}
  `;
}

function homeView(){
  const os = overallStats();
  const points = computePoints();
  const rank = currentRank(points);
  const next = nextRankInfo(points);
  const academiaTotal = Object.keys(STATE.storage.saved).length;
  const rp = recentPerformance(20);
  let recentPerfHtml;
  if(!rp){
    recentPerfHtml = `<button class="qcard" data-action="recent-performance" style="flex:1; min-width:220px; text-align:left; cursor:pointer; display:flex; align-items:center; gap:12px;">
      <div style="font-size:20px;">📊</div>
      <div style="font-size:13px; color:var(--muted);">Completa algún test para ver aquí tu rendimiento reciente.</div>
    </button>`;
  } else {
    recentPerfHtml = `<button class="qcard" data-action="recent-performance" style="flex:1; min-width:220px; text-align:left; cursor:pointer;">
      <div style="font-weight:700; font-size:14px; margin-bottom:8px;">🎯 Analiza tu rendimiento</div>
      <div style="font-size:13px; color:${scoreColor(rp.pct)}; font-weight:700; margin-bottom:10px;">${rp.pct}% de acierto en tus últimos 20 tests</div>
      <div style="text-align:right; font-size:12px; color:var(--pitch); font-weight:700;">Ver por regla →</div>
    </button>`;
  }

  const streak = computeStreak();
  const todayISO = todayKeyISO();
  const nextEvent = (STATE.storage.calendarEvents||[])
    .filter(ev => ev.date >= todayISO)
    .sort((a,b)=>a.date.localeCompare(b.date))[0];

  let streakHtml;
  if(nextEvent){
    const t = CALENDAR_EVENT_TYPES[nextEvent.type] || CALENDAR_EVENT_TYPES.other;
    const daysUntil = Math.round((new Date(nextEvent.date+'T00:00:00') - new Date(todayISO+'T00:00:00')) / 86400000);
    const whenLabel = daysUntil===0 ? 'Es hoy' : daysUntil===1 ? 'Es mañana' : `Faltan ${daysUntil} días`;
    streakHtml = `<button class="qcard" data-action="streak-calendar" style="flex:1; min-width:220px; text-align:left; cursor:pointer;">
        <div style="font-weight:700; font-size:14px; margin-bottom:8px;">${t.icon} ${esc(nextEvent.title)}</div>
        <div style="font-size:13px; color:var(--ink); margin-bottom:4px;">📅 ${formatEventDate(nextEvent.date)}</div>
        <div style="font-size:13px; color:${t.color}; font-weight:700; margin-bottom:10px;">⏳ ${whenLabel}</div>
        <div style="text-align:right; font-size:12px; color:var(--pitch); font-weight:700;">Ver calendario →</div>
      </button>`;
  } else if(streak === 0){
    streakHtml = `<button class="qcard" data-action="streak-calendar" style="flex:1; min-width:220px; text-align:left; cursor:pointer; display:flex; align-items:center; gap:12px;">
        <div style="font-size:20px;">🔥</div>
        <div style="font-size:13px; color:var(--muted);">Empieza hoy tu racha de estudio.</div>
      </button>`;
  } else {
    streakHtml = `<button class="qcard" data-action="streak-calendar" style="flex:1; min-width:220px; text-align:left; cursor:pointer;">
        <div style="font-weight:700; font-size:14px; margin-bottom:8px;">🔥 Racha de estudio</div>
        <div style="font-size:13px; color:var(--ink); margin-bottom:10px;">${streak} día${streak===1?'':'s'} seguido${streak===1?'':'s'} · ¡sigue así!</div>
        <div style="text-align:right; font-size:12px; color:var(--pitch); font-weight:700;">Ver calendario →</div>
      </button>`;
  }

  const weak = weakestRuleRecent(20);
  const weakHtml = !weak
    ? `<div class="qcard" style="flex:1; min-width:220px; display:flex; align-items:center; gap:12px;">
        <div style="font-size:20px;">🎯</div>
        <div style="font-size:13px; color:var(--muted);">Completa más tests para ver aquí tu regla más floja.</div>
      </div>`
    : `<button class="qcard" data-action="open-law" data-law="${weak.rule}" style="flex:1; min-width:220px; text-align:left; cursor:pointer;">
        <div style="font-weight:700; font-size:14px; margin-bottom:8px;">🎯 Recomendación para hoy</div>
        <div style="font-size:13px; color:var(--ink); margin-bottom:4px;">📘 Regla ${weak.rule} · ${esc(LAW_NAMES[weak.rule])}</div>
        <div style="font-size:13px; color:${scoreColor(weak.pct)}; font-weight:700; margin-bottom:10px;">${weak.pct}% de acierto — es tu regla más floja</div>
        <div style="text-align:right; font-size:12px; color:var(--pitch); font-weight:700;">Practicar ahora →</div>
      </button>`;

  const badgeCount = Object.keys(STATE.storage.unlockedBadges||{}).length;
  const progressHtml = `<button class="qcard" data-action="stats" style="flex:1; min-width:220px; text-align:left; cursor:pointer;">
    <div style="font-weight:700; font-size:14px; margin-bottom:8px;">📊 Progreso general</div>
    <div style="font-size:13px; color:var(--ink); margin-bottom:10px;">${os.completionPct}% del temario completado</div>
    <div style="text-align:right; font-size:12px; color:var(--pitch); font-weight:700;">Ver estadísticas →</div>
  </button>`;

  let cards = '';
  for(let i=1;i<=17;i++){
    const s = lawStats(i);
    const crownLevel = (STATE.storage.crownLevels||{})[i] || 0;
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
  const gs = lawStats('glossary');
  const glossaryCard = `<button class="law-card" data-action="open-law" data-law="glossary">
    <div class="law-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h11a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/><path d="M6 4v14a2 2 0 0 0 2 2h11"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="11.5" x2="15" y2="11.5"/></svg></div>
    <div class="law-num">G</div>
    <div class="law-name">Preguntas Glosario</div>
    <div class="law-meta">
      <div class="law-bar-bg"><div class="law-bar-fill" style="width:${gs.completionPct}%"></div></div>
      <div class="law-pct">${gs.completionPct}%</div>
    </div>
    <div class="law-sub">${lawSubLine(gs)}</div>
  </button>`;
  const hs = lawStats('hard');
  const hardCard = `<button class="law-card law-card-hard" data-action="open-law" data-law="hard">
    <div class="law-name" style="font-size:20px; margin-top:2px;">Sala VAR</div>
    <div class="hard-tag" style="margin-top:6px; display:inline-block;">Modo difícil</div>
    <div class="law-meta">
      <div class="law-bar-bg"><div class="law-bar-fill" style="width:${hs.completionPct}%; background:var(--red);"></div></div>
      <div class="law-pct">${hs.completionPct}%</div>
    </div>
    <div class="law-sub">${hs.total===0 ? '<span class="law-sub-muted">Todavía no hay ninguna</span>' : lawSubLine(hs)}</div>
  </button>`;
  const fs2 = lawStats('failed');
  const failRatio = os.attempted>0 ? Math.round(fs2.total/os.attempted*100) : 0;
  const failedCard = `<button class="law-card law-card-failed" data-action="open-law" data-law="failed">
    <div class="law-name" style="font-size:20px; margin-top:2px; color:var(--yellow-ink);">Sala de Repaso</div>
    <div class="hard-tag" style="margin-top:6px; display:inline-block; background:rgba(91,67,0,0.14); color:var(--yellow-ink);">Preguntas falladas</div>
    <div class="law-meta">
      <div class="law-bar-bg" style="background:rgba(91,67,0,0.18);"><div class="law-bar-fill" style="width:${failRatio}%; background:var(--yellow-ink);"></div></div>
      <div class="law-pct" style="color:var(--yellow-ink);">${fs2.total}</div>
    </div>
    <div class="law-sub" style="color:var(--yellow-ink); opacity:0.8;">${fs2.total===0 ? '<span class="law-sub-muted" style="color:var(--yellow-ink);">¡Nada pendiente!</span>' : 'Preguntas por repasar'}</div>
  </button>`;
  return `
  <div class="app-header">
    <button class="header-logout-btn" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    </button>
    <div class="header-row">
      <div style="display:flex; align-items:center; gap:14px;">
        <div style="width:52px; height:52px;">${LOGO_MARK}</div>
        <div>
          <h1>WEREF</h1>
          <div class="sub" style="margin-top:2px;">Formación arbitral</div>
        </div>
      </div>
      <button class="ring-wrap" data-action="achievements" title="Ver tu rango e insignias" style="background:none; border:none; cursor:pointer; padding:0;">
        <div class="ring">${ringSVG(next ? next.progressPct : 100)}<div class="pct" style="font-size:13px;">${points}</div></div>
        <div class="ring-label" style="max-width:80px; white-space:normal; text-align:center; line-height:1.2;">${rank.name}</div>
      </button>
    </div>
  </div>
  <div style="display:flex; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
    <button class="btn btn-primary" data-action="train-config">📘 Reglas de Juego <span class="mono" style="font-size:10px; opacity:0.75;">IFAB</span></button>
    <button class="btn btn-primary" style="background:var(--accent);" data-action="dailyChallenge">🏆 WEREF League</button>
    <button class="btn btn-primary" style="background:var(--pitch);" data-action="academia">🎓 Mi Academia${academiaTotal>0 ? ` <span class="badge">${academiaTotal}</span>` : ''}</button>
  </div>
  <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
    ${isDevUser() ? `<button class="btn btn-ghost" data-action="database">Base de datos${Object.keys(STATE.reports).length>0 ? ` <span class="badge" style="background:var(--red); color:#fff;">${Object.keys(STATE.reports).length}</span>` : ''}</button>` : ''}
    ${isDevUser() ? `<button class="btn btn-ghost" data-action="suggestions-admin">📋 Sugerencias${STATE.suggestions.filter(s=>s.status==='pending').length>0 ? ` <span class="badge" style="background:var(--red); color:#fff;">${STATE.suggestions.filter(s=>s.status==='pending').length}</span>` : ''}</button>` : ''}
    ${isDevUser() ? `<button class="btn btn-ghost" data-action="admin-dashboard">📊 Panel de administración</button>` : ''}
    ${Object.keys(STATE.storage.flags).length>0 ? `<button class="btn btn-ghost" data-action="flagged-list">Marcadas <span class="badge">${Object.keys(STATE.storage.flags).length}</span></button>` : ''}
  </div>
  <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
    ${progressHtml}
    ${recentPerfHtml}
    ${streakHtml}
    ${weakHtml}
  </div>
  <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:22px; margin-bottom:10px; flex-wrap:wrap;">
    <div class="section-title" style="margin:0;">Reglas de juego</div>
    <button class="btn btn-secondary" style="padding:8px 14px; font-size:12.5px;" data-action="train-config">+ Crear test personalizado</button>
  </div>
  <div class="law-grid">${cards}${glossaryCard}${hardCard}${failedCard}</div>
  <div class="qcard" style="margin-top:24px; text-align:center; padding:26px 20px;">
    <div style="font-weight:700; font-size:15px; color:var(--pitch); margin-bottom:4px;">🚀 Construyamos WEREF juntos</div>
    <div style="font-size:13px; color:var(--muted); margin-bottom:14px;">Esta plataforma también la crean sus usuarios. Si tienes una idea, has encontrado algo que mejorar o echas de menos alguna función, cuéntanoslo. Tu opinión puede marcar la diferencia.</div>
    <button class="btn btn-secondary" data-action="open-suggest">Enviar una sugerencia</button>
  </div>
  `;
}


function lawMenuView(){
  const law = STATE.lawId;
  const s = lawStats(law);
  const scopeIds = questionsForLaw(law).map(q=>q.id);
  const flaggedCount = Object.keys(STATE.storage.flags).filter(id => scopeIds.includes(id)).length;
  const isHard = law === 'hard';
  const isFailed = law === 'failed';
  const isGlossary = law === 'glossary';
  const isSaved = law === 'saved';
  const headHtml = isHard
    ? `<div class="num" style="color:var(--red);"><span class="ref-card red" style="width:22px; height:30px; display:inline-block; vertical-align:middle;"></span></div>
       <div><div class="name">Sala VAR <span class="hard-tag">Modo difícil</span></div><div class="stat">${s.completionPct}% completado ${s.attempted>0 ? '· '+accuracyBadge(s.accuracyPct)+' acierto' : ''}</div></div>`
    : isFailed
    ? `<div class="num" style="color:var(--yellow-ink);"><span class="ref-card yellow" style="width:22px; height:30px; display:inline-block; vertical-align:middle;"></span></div>
       <div><div class="name">Sala de Repaso <span class="hard-tag" style="background:rgba(91,67,0,0.14); color:var(--yellow-ink);">Preguntas falladas</span></div><div class="stat">${s.total>0 ? 'Tienes preguntas pendientes de repasar' : 'Nada pendiente'}</div></div>`
    : isGlossary
    ? `<div class="num">G</div>
       <div><div class="name">Preguntas Glosario <span class="mono" style="font-size:11px; color:var(--muted); font-weight:500;">IFAB</span></div><div class="stat">${s.completionPct}% completado ${s.attempted>0 ? '· '+accuracyBadge(s.accuracyPct)+' acierto' : ''}</div></div>`
    : isSaved
    ? `<div class="num">📚</div>
       <div><div class="name">Preguntas Guardadas <span class="hard-tag" style="background:rgba(22,24,29,0.08); color:var(--pitch);">Guardadas por ti</span></div><div class="stat">${s.total>0 ? s.total+' pregunta(s) guardadas' : 'Nada guardado todavía'}</div></div>`
    : `<div class="num">${law}</div>
       <div><div class="name">${esc(LAW_NAMES[law])}</div><div class="stat">${s.completionPct}% completado ${s.attempted>0 ? '· '+accuracyBadge(s.accuracyPct)+' acierto' : ''}</div></div>`;
  const backAction = isSaved ? 'academia' : 'home';
  const backLabel = isSaved ? '&larr; Mi Academia' : '&larr; Todas las reglas';
  if(isFailed && s.total===0){
    return `
    <button class="backbtn" data-action="${backAction}">${backLabel}</button>
    <div class="big-law-head">${headHtml}</div>
    <div class="empty-state">¡Nada pendiente! No tienes ninguna pregunta fallada ahora mismo. Sigue haciendo tests y, si fallas alguna, aparecerá aquí para que la repases.</div>
    `;
  }
  if(isSaved && s.total===0){
    return `
    <button class="backbtn" data-action="${backAction}">${backLabel}</button>
    <div class="big-law-head">${headHtml}</div>
    <div class="empty-state">Todavía no has guardado ninguna pregunta. Pulsa "📚 Guardar en Mi Lista" durante un test para añadirla aquí.</div>
    `;
  }
  const scopeOf = isHard?' del banco de difíciles':isFailed?' de tus falladas':isGlossary?' del glosario':isSaved?' de tu lista':' de esta regla';
  return `
  <button class="backbtn" data-action="${backAction}">${backLabel}</button>
  <div class="big-law-head">
    ${headHtml}
  </div>
  <div class="menu-list">
    <button class="menu-item" data-action="start-quiz" data-law="${law}" data-mode="short">
      <div class="menu-item-icon">⚡</div>
      <div style="flex:1; min-width:0;">
        <div class="title" style="font-size:16px;">Test rápido</div>
        <div style="font-size:12.5px; color:var(--ink); font-weight:600; margin-top:3px;">Empieza a practicar en segundos.</div>
        <div class="desc">Responde 10 preguntas aleatorias${scopeOf} sin necesidad de configurar ninguna opción.</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px; flex-shrink:0;">
        <span class="menu-item-tag" style="background:#FFF1E8; color:var(--accent-dark);">Más utilizado</span>
        <span class="menu-item-arrow-circle">›</span>
      </div>
    </button>
    <button class="menu-item" data-action="start-quiz" data-law="${law}" data-mode="study25">
      <div class="menu-item-icon">📚</div>
      <div style="flex:1; min-width:0;">
        <div class="title" style="font-size:16px;">Modo estudio</div>
        <div style="font-size:12.5px; color:var(--ink); font-weight:600; margin-top:3px;">Aprende mientras practicas.</div>
        <div class="desc">Realiza un test de 25 preguntas aleatorias${scopeOf}, con la explicación y la respuesta correcta después de cada una.</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px; flex-shrink:0;">
        <span class="menu-item-tag" style="background:#EAF7EF; color:var(--green-ok);">Recomendado</span>
        <span class="menu-item-arrow-circle">›</span>
      </div>
    </button>
    ${isSaved ? `<button class="menu-item" data-action="saved-browse">
      <div><div class="title">Ver tus guardadas</div><div class="desc">Repásalas de una en una, con la respuesta y explicación</div></div>
      <div class="arrow">›</div>
    </button>` : ''}
    <button class="menu-item" data-action="train-config-scoped" data-law="${law}">
      <div class="menu-item-icon">🎛️</div>
      <div style="flex:1; min-width:0;">
        <div class="title" style="font-size:16px;">Test personalizado</div>
        <div style="font-size:12.5px; color:var(--ink); font-weight:600; margin-top:3px;">Crea un entrenamiento a tu medida.</div>
        <div class="desc">Elige el número de preguntas, activa el cronómetro y selecciona el modo Estudio o Examen para adaptar la sesión a tus necesidades.</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px; flex-shrink:0;">
        <span class="menu-item-tag" style="background:rgba(22,24,29,0.08); color:var(--pitch);">Personalizable</span>
        <span class="menu-item-arrow-circle">›</span>
      </div>
    </button>
    ${flaggedCount>0 ? `<button class="menu-item" data-action="review-flagged" data-law="${law}">
      <div><div class="title">Revisar marcadas <span class="badge">${flaggedCount}</span></div><div class="desc">Preguntas que marcaste como posiblemente desactualizadas</div></div>
      <div class="arrow">›</div>
    </button>` : ''}
  </div>
  ${(!isHard && !isFailed && !isGlossary && !isSaved && s.attempted>0) ? `
  <div style="margin-top:20px;">
    <button class="btn btn-ghost" style="color:var(--red); border-color:#F0C4C4; font-size:12.5px; padding:8px 14px;" data-action="reset-law-progress" data-law="${law}">Reiniciar progreso de esta regla</button>
    <div style="font-size:12px; color:var(--muted); margin-top:8px;">Borra tus aciertos/fallos solo de esta regla. No afecta a las demás ni a tus puntos, rango, racha o insignias.</div>
  </div>
  ` : ''}
  `;
}

function pickQuestions(law, mode){
  let pool = law ? questionsForLaw(law) : allQuestions();
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
  STATE.view = 'quiz';
  render();
}

function isFailedQuestion(q){
  const p = STATE.storage.progress[q.id];
  return !!(p && p.correct === false);
}

function startTraining(opts){
  let pool = opts.scopeOverride ? questionsForLaw(opts.scopeOverride)
    : (opts.laws && opts.laws.length) ? allQuestions().filter(q => opts.laws.includes(q.rule)) : allQuestions().slice();
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
  return allQuestions().find(q=>q.id===qid);
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
        const q = allQuestions().find(x=>x.id===qid);
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
  const quiz = STATE.quiz;
  const q = currentQ();
  const total = quiz.qids.length;
  const pct = Math.round((quiz.idx)/total*100);
  const letters=['a','b','c','d'];
  const selectedLetter = quiz.answers[q.id] || null;
  const timedOut = !!(quiz.timedOut && quiz.timedOut[q.id]);
  const reveal = quiz.instantFeedback && (!!selectedLetter || timedOut);

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
      <span class="letter">${letter})</span>${esc(opt)}
    </button>`;
  }).join('');

  let feedback = '';
  if(reveal){
    const isOk = !timedOut && selectedLetter === q.correct;
    feedback = `<div class="card-feedback ${isOk?'ok':'bad'}">
      <div class="ref-card ${isOk?'yellow':'red'}"></div>
      <div class="msg">${timedOut ? '⏱ Se acabó el tiempo.' : (isOk? '¡Bien visto! Sigue así.' : 'Revisa esta jugada.')}
        <small>${isOk? 'Respuesta correcta.' : 'La respuesta correcta era la '+q.correct.toUpperCase()+').'}</small>
      </div>
    </div>
    ${(isLifeMode(quiz.mode) && quiz.hearts<=0) ? `<div style="margin-top:10px; padding:10px 12px; background:#FDECEC; border-radius:8px; font-size:13.5px; font-weight:700; color:var(--red);">${quiz.mode==='suddendeath' ? '💀 ¡Eliminado! Un fallo y se acabó.' : '💔 ¡Te has quedado sin corazones! Aquí termina el reto.'}</div>` : ''}
    ${q.explanation ? `<div style="margin-top:10px; padding:10px 12px; background:#FBF1F1; border-radius:8px; font-size:13px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}`;
  }
  const reportBtn = `<button class="flag-btn" data-action="report-question" data-qid="${q.id}">${STATE.reportedIds[q.id] ? '✓ Error reportado, ¡gracias!' : '🚩 Reportar un error en esta pregunta'}</button>`;
  const savedBtn = `<button class="flag-btn" data-action="toggle-saved" data-qid="${q.id}">${STATE.storage.saved[q.id] ? '✓ Guardada en tu Lista' : '📚 Guardar en Mi Lista'}</button>`;
  const actionLinksRow = `<div style="display:flex; gap:16px; flex-wrap:wrap;">${savedBtn}${reportBtn}</div>`;

  let topbar;
  if(quiz.mode==='training'){
    topbar = `<div class="quiz-topbar">
      <span class="qcount">Pregunta ${quiz.idx+1} / ${total} · Respondidas: ${Object.keys(quiz.answers).length}/${total}</span>
      ${quiz.timerMode==='total' ? `<span class="score mono" id="timer-display">${formatTime(quiz.remainingSec)}</span>` :
        quiz.timerMode==='perQuestion' ? `<span class="score mono" id="timer-display">⏱ ${formatTime(quiz.remainingSec)}</span>` :
        `<span class="score">Sin límite de tiempo</span>`}
    </div>`;
  } else if(isLifeMode(quiz.mode)){
    const maxLives = maxLivesFor(quiz.mode);
    topbar = `<div class="quiz-topbar">
      <span class="qcount">${quiz.combo>=2 ? '🔥 Racha: '+quiz.combo : 'Pregunta '+(quiz.idx+1)}</span>
      <span class="score" style="font-size:15px;">${quiz.mode==='suddendeath' ? (quiz.hearts>0?'💀':'☠️') : ('❤️'.repeat(quiz.hearts)+'🖤'.repeat(maxLives-quiz.hearts))}</span>
    </div>`;
  } else if(quiz.mode==='timeattack'){
    topbar = `<div class="quiz-topbar">
      <span class="qcount mono" id="timer-display" style="font-weight:700; font-size:16px;">⏱ ${formatTime(quiz.remainingSec)}</span>
      <span class="score">Aciertos: ${Object.keys(quiz.answers).filter(id=>{ const qq=allQuestions().find(x=>x.id===id); return qq && quiz.answers[id]===qq.correct; }).length}</span>
    </div>`;
  } else {
    topbar = `<div class="quiz-topbar">
      <span class="qcount">Pregunta ${quiz.idx+1} / ${total}</span>
      <span class="score">Aciertos: ${Object.keys(quiz.answers).filter(id=>{ const qq=allQuestions().find(x=>x.id===id); return qq && quiz.answers[id]===qq.correct; }).length}</span>
    </div>`;
  }

  let actions;
  if(quiz.mode==='training'){
    actions = `
      <button class="btn btn-ghost" data-action="quit-quiz">Salir</button>
      <button class="btn btn-secondary" data-action="prev-question" ${quiz.idx===0?'disabled':''}>Anterior</button>
      ${quiz.idx+1<total ? `<button class="btn btn-secondary" data-action="next-question">Siguiente</button>` : ''}
      <button class="btn btn-primary" data-action="finish-training">Finalizar examen</button>
    `;
  } else {
    const isGameOver = isLifeMode(quiz.mode) && quiz.hearts<=0;
    actions = `
      <button class="btn btn-ghost" data-action="quit-quiz">Salir</button>
      <button class="btn btn-secondary" data-action="prev-question" ${quiz.idx===0?'disabled':''}>Anterior</button>
      ${reveal ? `<button class="btn btn-primary" data-action="next-question">${isGameOver ? 'Ver resultado' : (quiz.idx+1<total?'Siguiente':'Ver resultado')}</button>` : ''}
    `;
  }

  return `
  ${topbar}
  <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
  <div class="qcard">
    <div class="qtag">${scopeLabel(q)}</div>
    <div class="qtext">${esc(q.question)}</div>
    ${optsHtml}
    ${feedback}
    ${quiz.mode!=='training' ? (reveal ? actionLinksRow : '') : actionLinksRow}
  </div>
  <div class="quiz-actions">${actions}</div>
  ${questionDots(quiz)}
  `;
}

function selectAnswer(letter){
  const quiz = STATE.quiz;
  const q = currentQ();
  quiz.answers[q.id] = letter;
  const correct = letter === q.correct;
  STATE.storage.progress[q.id] = { correct, ts: Date.now() };
  saveProgress();
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
    const q = allQuestions().find(x=>x.id===qid);
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
      const q = allQuestions().find(x=>x.id===qid);
      const sel = quiz.answers[qid];
      const ok = sel === (q ? q.correct : null);
      const cls = sel ? (ok ? 'ok' : 'bad') : '';
      return `<button class="q-dot ${cls}" data-action="toggle-review-detail" data-idx="${i}">${i+1}</button>`;
    }).join('')}
  </div>
  ${(STATE.reviewDetailIdx!==null && STATE.reviewDetailIdx!==undefined && scopeQids[STATE.reviewDetailIdx]) ? (function(){
    const qid = scopeQids[STATE.reviewDetailIdx];
    const q = allQuestions().find(x=>x.id===qid);
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
    <button class="btn btn-primary" data-action="home">Volver al inicio</button>
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
  const scopeOverride = cfg.scopeOverride;
  const scoped = scopeOverride ? questionsForLaw(scopeOverride) : (cfg.laws.length ? allQuestions().filter(q=>cfg.laws.includes(q.rule)) : allQuestions());
  const totalAvail = scoped.length;
  const failedAvail = scoped.filter(q => isFailedQuestion(q)).length;
  let chips = '';
  for(let i=1;i<=17;i++){
    const active = cfg.laws.includes(i);
    chips += `<button class="tab ${active?'active':''}" data-action="toggle-train-law" data-law="${i}">R${i}</button>`;
  }
  const scopeLabel = scopeOverride==='hard' ? 'Sala VAR' : scopeOverride==='failed' ? 'Sala de Repaso' : scopeOverride==='glossary' ? 'Preguntas Glosario' : scopeOverride==='saved' ? 'Preguntas Guardadas' : (typeof scopeOverride==='number') ? 'Regla '+scopeOverride+' · '+esc(LAW_NAMES[scopeOverride]) : null;
  const backAction = scopeOverride ? 'open-law' : 'home';
  return `
  <button class="backbtn" data-action="${backAction}" data-law="${scopeOverride||''}">&larr; ${scopeOverride ? scopeLabel : 'Inicio'}</button>
  <h2 style="margin-bottom:4px;">${scopeLabel ? 'Test personalizado · '+scopeLabel : 'Reglas de Juego <span class="mono" style="font-size:12px; color:var(--muted); font-weight:500;">IFAB</span>'}</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:18px; font-size:13.5px;">Elige cuántas preguntas quieres y cómo quieres el tiempo. Se genera un examen aleatorio y puedes moverte libremente entre preguntas hasta finalizarlo.</div>
  <div class="qcard">
    <label>Número de preguntas <span class="mono" style="color:var(--muted); text-transform:none; font-weight:500;">(máximo 50)</span></label>
    <input type="text" inputmode="numeric" id="cfg-count" value="${Math.min(cfg.count,50)}" maxlength="2">

    <label>Tipo de test</label>
    <div class="tabs">
      <button class="tab ${cfg.feedbackMode==='exam'?'active':''}" data-action="set-feedback-mode" data-fbmode="exam">Modo examen</button>
      <button class="tab ${cfg.feedbackMode==='study'?'active':''}" data-action="set-feedback-mode" data-fbmode="study">Modo estudio</button>
    </div>
    <div style="font-size:12px; color:var(--muted); margin-top:4px;">${cfg.feedbackMode==='study' ? 'Verás si aciertas y la solución al momento de responder cada pregunta.' : 'No sabrás los resultados hasta terminar todo el test, como en un examen real.'}</div>

    <label>Temporización</label>
    <div class="tabs">
      <button class="tab ${cfg.timerMode==='none'?'active':''}" data-action="set-timer-mode" data-mode="none">Sin límite</button>
      <button class="tab ${cfg.timerMode==='total'?'active':''}" data-action="set-timer-mode" data-mode="total">Tiempo total</button>
      <button class="tab ${cfg.timerMode==='perQuestion'?'active':''}" data-action="set-timer-mode" data-mode="perQuestion">Tiempo por pregunta</button>
    </div>
    ${cfg.timerMode==='total' ? `
      <label>Minutos para todo el examen</label>
      <input type="text" inputmode="numeric" id="cfg-minutes" value="${cfg.minutes}" maxlength="4">
    ` : ''}
    ${cfg.timerMode==='perQuestion' ? `
      <label>Segundos por pregunta</label>
      <input type="text" inputmode="numeric" id="cfg-seconds-per-q" value="${cfg.secondsPerQuestion}" maxlength="4">
      <div style="font-size:12px; color:var(--muted); margin-top:4px;">Si se acaba el tiempo de una pregunta, se pasa sola a la siguiente (sin responder si no elegiste nada).</div>
    ` : ''}

    ${scopeOverride ? '' : `
    <label>Reglas incluidas</label>
    <div class="tabs">
      <button class="tab ${cfg.laws.length===0?'active':''}" data-action="toggle-train-law" data-law="all">Todas</button>
      ${chips}
    </div>
    `}
    <div style="margin-top:20px;">
      <button class="btn btn-primary" data-action="generate-exam">Generar examen</button>
    </div>
  </div>
  `;
}

function savedBrowseView(){
  const ids = Object.keys(STATE.storage.saved);
  const letters=['a','b','c','d'];
  if(ids.length===0){
    return `<button class="backbtn" data-action="open-law" data-law="saved">&larr; Preguntas Guardadas</button>
    <div class="empty-state">Ya no te quedan preguntas guardadas.</div>`;
  }
  if(STATE.savedBrowseIdx >= ids.length) STATE.savedBrowseIdx = ids.length - 1;
  if(STATE.savedBrowseIdx < 0) STATE.savedBrowseIdx = 0;
  const id = ids[STATE.savedBrowseIdx];
  const q = allQuestions().find(x=>x.id===id);
  return `
  <button class="backbtn" data-action="open-law" data-law="saved">&larr; Preguntas Guardadas</button>
  <div class="sub" style="color:var(--muted); margin-bottom:10px; font-size:13px;">Pregunta ${STATE.savedBrowseIdx+1} de ${ids.length}</div>
  <div class="qcard" style="margin-bottom:14px;">
    <div class="qtag">${scopeLabel(q)}</div>
    <div class="qtext">${esc(q.question)}</div>
    ${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}
    ${q.explanation ? `<div style="margin-top:10px; padding:10px 12px; background:#FBF1F1; border-radius:8px; font-size:13px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
    <div style="margin-top:12px;">
      <button class="flag-btn" data-action="toggle-saved" data-qid="${q.id}">Quitar de Guardadas</button>
    </div>
  </div>
  <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
    <button class="btn btn-secondary" data-action="saved-browse-prev" ${STATE.savedBrowseIdx<=0?'disabled':''}>&larr; Anterior</button>
    <button class="btn btn-secondary" data-action="saved-browse-next" ${STATE.savedBrowseIdx>=ids.length-1?'disabled':''}>Siguiente &rarr;</button>
  </div>
  `;
}

function suggestFormView(){
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Buzón de sugerencias</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Ayúdanos a mejorar WEREF. Comparte tus ideas, propuestas o funcionalidades que te gustaría ver en la plataforma. Leemos todas las sugerencias y muchas de ellas terminan convirtiéndose en nuevas mejoras.</div>
  <div class="qcard">
    <label>Tu sugerencia</label>
    <textarea id="suggest-message" rows="6" style="resize:none; overflow-y:hidden;" placeholder="Ej: me gustaría que hubiera un modo..." maxlength="3000"></textarea>
    <button class="btn btn-primary" style="margin-top:14px;" data-action="send-suggestion">Enviar sugerencia</button>
  </div>
  `;
}

function suggestionsAdminView(){
  const list = STATE.suggestions || [];
  const pendingCount = list.filter(s=>s.status==='pending').length;
  const statusBadge = (status) => status==='done'
    ? ' <span class="badge" style="background:var(--green-ok); color:#fff;">Hecho</span>'
    : status==='planned'
    ? ' <span class="badge" style="background:var(--yellow); color:var(--yellow-ink);">Planificado</span>'
    : ' <span class="badge">Pendiente</span>';
  const rows = list.map(s => `
    <div class="qcard" style="margin-bottom:10px;">
      <div class="qtag">${new Date(s.created_at).toLocaleDateString('es-ES')} · ${esc(s.user_email || 'anónimo')}${statusBadge(s.status)}</div>
      <div class="qtext" style="font-size:14px; white-space:pre-wrap;">${esc(s.message)}</div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn ${s.status==='pending'?'btn-primary':'btn-ghost'}" style="padding:6px 12px; font-size:12.5px;" data-action="suggestion-status" data-id="${s.id}" data-status="pending">Pendiente</button>
        <button class="btn ${s.status==='planned'?'btn-primary':'btn-ghost'}" style="padding:6px 12px; font-size:12.5px;" data-action="suggestion-status" data-id="${s.id}" data-status="planned">Planificado</button>
        <button class="btn ${s.status==='done'?'btn-primary':'btn-ghost'}" style="padding:6px 12px; font-size:12.5px;" data-action="suggestion-status" data-id="${s.id}" data-status="done">Hecho</button>
        <button class="btn btn-ghost" style="padding:6px 12px; font-size:12.5px; color:var(--red);" data-action="suggestion-delete" data-id="${s.id}">Eliminar</button>
      </div>
    </div>
  `).join('');
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Sugerencias recibidas</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">${list.length} en total · ${pendingCount} pendientes</div>
  ${rows || '<div class="empty-state">Todavía no hay sugerencias.</div>'}
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
  const isGlossaryQ = q.domain === 'glossary';
  const lawOpts = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${q.rule===i?'selected':''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('');
  const tagLabel = isGlossaryQ ? 'Editando · Glosario IFAB' : 'Editando · Regla '+q.rule+' · '+esc(LAW_NAMES[q.rule]);
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
  const edit = domain==='glossary'
    ? { question, options:[a,b,c,d], correct, explanation, difficulty }
    : { rule: selectedNum, question, options:[a,b,c,d], correct, explanation, difficulty };
  STATE.storage.edits[qid] = edit;
  saveEdits();
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
  return list;
}

function databaseView(){
  const f = STATE.dbFilter;
  const pageSize = 15;
  const list = filteredDbList();
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  if(f.page > totalPages) f.page = totalPages;
  const startIdx = (f.page - 1) * pageSize;
  const pageItems = list.slice(startIdx, startIdx + pageSize);
  const letters = ['a','b','c','d'];

  const numberMap = {};
  allQuestions().forEach((q,i) => { numberMap[q.id] = i+1; });
  const dupIds = duplicateQuestionIds();

  const lawOptions = `<option value="all">Todas (todo el banco)</option>` +
    `<optgroup label="Reglas IFAB">` +
    Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${f.law==String(i)?'selected':''}>R${i} — ${esc(LAW_NAMES[i])}</option>`).join('') +
    `<option value="glossary" ${f.law==='glossary'?'selected':''}>Preguntas Glosario</option>` +
    `<option value="hard" ${f.law==='hard'?'selected':''}>Sala VAR (difíciles)</option>` +
    `</optgroup>`;

  let rows = pageItems.map(q => {
    if(STATE.editingId === q.id) return editFormHtml(q);
    const isReviewed = !!STATE.storage.reviewed[q.id];
    const reportCount = STATE.reports[q.id] || 0;
    return `<div class="qcard" style="margin-bottom:10px; ${reportCount>0?'border-color:#F0C4C4;':(isReviewed?'border-color:#BEE3CC;':'')}">
      <div class="qtag">
        <span class="mono" style="color:var(--muted); font-weight:700;">#${numberMap[q.id]}</span> ·
        ${scopeLabel(q)}
        ${q.difficulty==='hard' ? ' <span class="badge" style="background:var(--red); color:#fff;">Difícil</span>' : ''}
        ${STATE.storage.flags[q.id] ? ' <span class="badge">Marcada</span>' : ''}
        ${q.source==='user' ? ' <span class="badge" style="background:var(--pitch); color:#fff;">Tu pregunta</span>' : ''}
        ${isReviewed ? ' <span class="badge" style="background:var(--green-ok); color:#fff;">Revisada</span>' : ''}
        ${reportCount>0 ? ` <span class="badge" style="background:var(--red); color:#fff;">🚩 Reportada x${reportCount}</span>` : ''}
        ${dupIds.has(q.id) ? ' <span class="badge" style="background:#B87333; color:#fff;">Duplicada</span>' : ''}
      </div>
      <div class="qtext" style="font-size:14.5px;">${esc(q.question)}</div>
      ${q.options.map((o,i)=>`<div class="option ${letters[i]===q.correct?'reveal-correct':''}" style="cursor:default; padding:9px 12px;"><span class="letter">${letters[i]})</span>${esc(o)}</div>`).join('')}
      ${q.explanation ? `<div style="margin-top:8px; padding:8px 12px; background:#FBF1F1; border-radius:8px; font-size:12.5px;"><strong>Explicación:</strong> ${esc(q.explanation)}</div>` : ''}
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn ${isReviewed?'btn-secondary':'btn-primary'}" style="padding:7px 14px; font-size:13px;" data-action="toggle-reviewed" data-qid="${q.id}">${isReviewed ? '✓ Revisada' : 'Marcar como revisada'}</button>
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px;" data-action="edit-question" data-qid="${q.id}">Editar</button>
        <button class="btn btn-ghost" style="padding:7px 14px; font-size:13px; color:var(--red); border-color:#F0C4C4;" data-action="delete-question" data-qid="${q.id}">Eliminar</button>
        ${reportCount>0 ? `<button class="btn btn-ghost" style="padding:7px 14px; font-size:13px;" data-action="dismiss-reports" data-qid="${q.id}">Descartar reportes</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const reviewedCount = allQuestions().filter(q => STATE.storage.reviewed[q.id]).length;
  const reportedCount = Object.keys(STATE.reports).length;
  const dupTotal = dupIds.size;

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Base de datos</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">${allQuestions().length} preguntas en total · ${reviewedCount} revisadas · ${reportedCount} con reportes de usuarios · ${list.length} coinciden con el filtro</div>

  <div style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap;">
    <button class="btn btn-primary" data-action="add-from-db">+ Añadir pregunta nueva</button>
    <button class="btn btn-secondary" data-action="export-excel">📊 Exportar a Excel</button>
    <label class="btn btn-secondary" style="cursor:pointer; margin:0;">
      📥 Importar desde Excel
      <input type="file" id="import-excel-file" accept=".xlsx,.xls" style="display:none;">
    </label>
  </div>

  <div class="qcard" style="margin-bottom:14px;">
    <label>Buscar texto</label>
    <input type="text" id="db-search" placeholder="Busca por palabra en la pregunta o en las respuestas..." value="${esc(f.search)}" maxlength="100">
    <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
      <div style="flex:1; min-width:180px;">
        <label>Regla</label>
        <select id="db-law">${lawOptions}</select>
      </div>
      <div style="flex:1; min-width:140px;">
        <label>Dificultad</label>
        <select id="db-difficulty">
          <option value="all" ${f.difficulty==='all'?'selected':''}>Todas</option>
          <option value="normal" ${f.difficulty==='normal'?'selected':''}>Normal</option>
          <option value="hard" ${f.difficulty==='hard'?'selected':''}>Difícil</option>
        </select>
      </div>
      <div style="flex:1; min-width:140px;">
        <label>Revisión</label>
        <select id="db-review-status">
          <option value="all" ${f.reviewStatus==='all'?'selected':''}>Todas</option>
          <option value="pending" ${f.reviewStatus==='pending'?'selected':''}>Pendientes</option>
          <option value="reviewed" ${f.reviewStatus==='reviewed'?'selected':''}>Revisadas</option>
        </select>
      </div>
    </div>
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13.5px; margin-top:12px;">
      <input type="checkbox" id="db-flagged-only" style="width:auto;" ${f.flaggedOnly?'checked':''}> Mostrar solo las marcadas para revisar
    </label>
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13.5px; margin-top:8px;">
      <input type="checkbox" id="db-reported-only" style="width:auto;" ${f.reportedOnly?'checked':''}> Mostrar solo las reportadas por usuarios (${reportedCount})
    </label>
    <label style="display:flex; align-items:center; gap:8px; text-transform:none; font-size:13.5px; margin-top:8px;">
      <input type="checkbox" id="db-duplicates-only" style="width:auto;" ${f.duplicatesOnly?'checked':''}> Mostrar solo las duplicadas (${dupTotal})
    </label>
  </div>

  ${rows || '<div class="empty-state">Ninguna pregunta coincide con este filtro.</div>'}

  ${list.length>pageSize ? `
  <div style="display:flex; justify-content:center; align-items:center; gap:14px; margin-top:16px;">
    <button class="btn btn-ghost" data-action="db-prev-page" ${f.page<=1?'disabled':''}>&larr; Anterior</button>
    <span class="mono" style="font-size:13px; color:var(--muted);">Página ${f.page} / ${totalPages}</span>
    <button class="btn btn-ghost" data-action="db-next-page" ${f.page>=totalPages?'disabled':''}>Siguiente &rarr;</button>
  </div>` : ''}
  `;
}

function adminDashboardView(){
  const s = STATE.adminStats;

  if(s === null){
    return `
    <button class="backbtn" data-action="home">&larr; Inicio</button>
    <h2 style="margin-bottom:4px;">Panel de administración</h2>
    <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Estadísticas generales de la plataforma.</div>
    <div class="empty-state">Cargando estadísticas...</div>
    `;
  }

  if(s === false){
    return `
    <button class="backbtn" data-action="home">&larr; Inicio</button>
    <h2 style="margin-bottom:4px;">Panel de administración</h2>
    <div class="empty-state">No se pudieron cargar las estadísticas. <button class="btn btn-ghost" data-action="admin-dashboard-retry">Reintentar</button></div>
    `;
  }

  const statCards = [
    { label: 'Total usuarios', value: s.totalUsers },
    { label: 'Registrados hoy', value: s.registeredToday },
    { label: 'Esta semana', value: s.registeredWeek },
    { label: 'Este mes', value: s.registeredMonth },
    { label: 'Activos (30 días)', value: s.active },
    { label: 'Inactivos', value: s.inactive },
    { label: 'Bloqueados', value: s.blocked },
  ];
  const statsHtml = statCards.map(c => `<div class="lb-summary-stat"><div class="num">${c.value}</div><div class="label">${esc(c.label)}</div></div>`).join('');

  const maxCount = Math.max(1, ...s.chart.map(d => d.count));
  const chartHtml = s.chart.map(d => {
    const h = Math.max(3, Math.round(d.count / maxCount * 100));
    const label = formatEventDate(d.date);
    return `<div class="admin-chart-bar" style="height:${h}%;" title="${label}: ${d.count} registro${d.count===1?'':'s'}"></div>`;
  }).join('');

  const rowsHtml = s.lastTen.map(u => {
    const isSelf = typeof CURRENT_USER_EMAIL !== 'undefined' && u.email === CURRENT_USER_EMAIL;
    return `
    <tr>
      <td>${u.username ? esc(u.username) : '<span style="color:var(--muted);">—</span>'}</td>
      <td>${esc(u.email)}</td>
      <td class="mono">${formatEventDate(u.created_at.slice(0,10))}</td>
      <td>${u.blocked ? '<span class="badge" style="background:var(--red); color:#fff;">Bloqueado</span>' : '<span class="badge" style="background:var(--green-ok); color:#fff;">Activo</span>'}</td>
      <td>${isSelf ? '' : `<button class="btn btn-ghost" style="padding:5px 10px; font-size:12px; color:var(--red); border-color:#F0C4C4;" data-action="admin-delete-user" data-uid="${u.id}">Eliminar</button>`}</td>
    </tr>
  `;
  }).join('');

  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:4px;">Panel de administración</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px; font-size:13.5px;">Estadísticas generales de la plataforma.</div>

  <div class="lb-summary-row">${statsHtml}</div>

  <div class="section-title">Registros de los últimos 30 días</div>
  <div class="qcard" style="margin-bottom:20px;">
    ${s.totalUsers === 0 ? '<div class="empty-state">Todavía no hay usuarios registrados.</div>' : `<div class="admin-chart">${chartHtml}</div>`}
  </div>

  <div class="section-title">Últimos 10 usuarios registrados</div>
  <div class="qcard" style="overflow-x:auto;">
    <table class="stat-table">
      <tr><th>Usuario</th><th>Correo</th><th>Registro</th><th>Estado</th><th></th></tr>
      ${rowsHtml || '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Sin datos</td></tr>'}
    </table>
  </div>
  `;
}

function addQuestionView(){
  const isGlossaryContext = STATE.lawId === 'glossary';
  const lawSel = Array.from({length:17},(_,i)=>i+1).map(i=>`<option value="${i}" ${STATE.lawId===i?'selected':''}>Regla ${i} — ${esc(LAW_NAMES[i])}</option>`).join('');
  const backAction = STATE.cameFromDb ? 'database' : (STATE.lawId!=null ? 'open-law' : 'home');
  return `
  <button class="backbtn" data-action="${backAction}" data-law="${STATE.lawId!=null?STATE.lawId:''}">&larr; Volver</button>
  <h2>Añadir pregunta${isGlossaryContext?' · Glosario IFAB':''}</h2>
  <div class="qcard">
    ${isGlossaryContext ? `<div style="font-size:13px; color:var(--muted); margin-bottom:6px;">Se añadirá al glosario de términos de las Reglas de Juego (IFAB).</div>` : `
    <label>Regla</label>
    <select id="f-law">${lawSel}</select>
    `}
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
    <input type="hidden" id="f-domain" value="${isGlossaryContext?'glossary':'law'}">
    <div style="margin-top:18px; display:flex; gap:10px;">
      <button class="btn btn-primary" data-action="save-question">Guardar pregunta</button>
    </div>
  </div>
  `;
}

function saveNewQuestion(){
  const domain = document.getElementById('f-domain').value;
  const lawSelEl = document.getElementById('f-law');
  const selectedNum = lawSelEl ? parseInt(lawSelEl.value,10) : null;
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

  if(domain==='glossary'){
    const q = { domain:'glossary', rule:null, num: 'U'+(STATE.storage.glossaryQuestions.length+1), question, options:[a,b,c,d], correct, explanation, difficulty, id:'G'+Math.random().toString(36).slice(2,9), source:'user' };
    STATE.storage.glossaryQuestions.push(q);
    saveGlossaryQuestions();
    STATE.toast='Pregunta guardada en el Glosario.';
    if(STATE.cameFromDb){ STATE.view='database'; }
    else { STATE.lawId = 'glossary'; STATE.view='law'; }
  } else {
    const q = { domain:'law', rule: selectedNum, num: 'U'+(STATE.storage.userQuestions.length+1), question, options:[a,b,c,d], correct, explanation, difficulty, id:'U'+Math.random().toString(36).slice(2,9), source:'user' };
    STATE.storage.userQuestions.push(q);
    saveUserQuestions();
    STATE.toast='Pregunta guardada en la Regla '+selectedNum+'.';
    if(STATE.cameFromDb){ STATE.view='database'; }
    else { STATE.lawId = selectedNum; STATE.view='law'; }
  }
  render();
}

function statsView(){
  let rows='';
  for(let i=1;i<=17;i++){
    const s=lawStats(i);
    rows += `<tr><td class="mono">R${i}</td><td>${esc(LAW_NAMES[i])}</td><td class="mono">${s.completionPct}%</td><td>${s.attempted>0 ? accuracyBadge(s.accuracyPct) : '<span class="law-sub-muted">—</span>'}</td></tr>`;
  }
  const os = overallStats();
  const flaggedTotal = Object.keys(STATE.storage.flags).length;
  return `
  <button class="backbtn" data-action="home">&larr; Inicio</button>
  <h2 style="margin-bottom:6px;">Estadísticas</h2>
  <div class="sub" style="color:var(--muted); margin-bottom:16px;">Progreso: ${os.completionPct}% · Acierto sobre lo respondido: ${os.attempted>0 ? os.accuracyPct+'%' : '—'}</div>
  <div class="qcard">
    <table class="stat-table">
      <tr><th>Regla</th><th>Nombre</th><th>Progreso</th><th>Acierto</th></tr>
      ${rows}
    </table>
  </div>
  ${flaggedTotal>0 ? `<div class="section-title">Preguntas marcadas para revisar (${flaggedTotal})</div>
  <div style="display:flex; gap:10px; flex-wrap:wrap;">
    <button class="btn btn-secondary" data-action="flagged-list">Ver y corregir marcadas</button>
    <button class="btn btn-ghost" data-action="review-flagged">Practicarlas como test</button>
  </div>` : ''}
  `;
}

function exportExcel(){
  if(typeof XLSX === 'undefined'){ STATE.toast = 'No se pudo cargar la librería de Excel. Revisa tu conexión a internet.'; render(); return; }
  const rows = allQuestions().map((q,i) => ({
    'Número': i+1,
    'ID': q.id,
    'Ámbito': q.domain==='glossary' ? 'Glosario' : q.rule,
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
        const isGlossary = ambito.toLowerCase().startsWith('glos');
        const rule = isGlossary ? null : parseInt(ambito,10);

        if(!question || !a || !b || !c || !['a','b','c','d'].includes(correct)){ skipped++; return; }
        if(!isGlossary && (!rule || rule<1 || rule>17)){ skipped++; return; }

        if(id){
          const exists = allQuestions().find(q=>q.id===id);
          if(!exists){ skipped++; return; }
          const edit = isGlossary
            ? { question, options:[a,b,c,d], correct, explanation, difficulty }
            : { rule, question, options:[a,b,c,d], correct, explanation, difficulty };
          STATE.storage.edits[id] = edit;
          updated++;
        } else {
          const dedupeKey = questionDedupeKey({ question, options:[a,b,c,d] });
          if(seenKeys.has(dedupeKey)){ duplicates++; return; }
          seenKeys.add(dedupeKey);
          if(isGlossary){
            STATE.storage.glossaryQuestions.push({ domain:'glossary', rule:null, num:'X'+Math.random().toString(36).slice(2,9), question, options:[a,b,c,d], correct, explanation, difficulty, id:'G'+Math.random().toString(36).slice(2,9), source:'user' });
          } else {
            STATE.storage.userQuestions.push({ domain:'law', rule, num:'X'+Math.random().toString(36).slice(2,9), question, options:[a,b,c,d], correct, explanation, difficulty, id:'U'+Math.random().toString(36).slice(2,9), source:'user' });
          }
          added++;
        }
      });
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
    suggestMessage.addEventListener('input', autoGrow);
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
  const dailyGoalSelect = document.getElementById('daily-goal-select');
  if(dailyGoalSelect){ dailyGoalSelect.addEventListener('change', (e)=>{ STATE.storage.dailyGoal = parseInt(e.target.value,10); saveDailyGoal(); render(); }); }
}

function onAction(e){
  const el = e.currentTarget;
  const action = el.dataset.action;
  const rawLaw = el.dataset.law;
  const law = rawLaw ? ((rawLaw==='hard' || rawLaw==='failed' || rawLaw==='glossary' || rawLaw==='saved' || /^fed-\d+$/.test(rawLaw)) ? rawLaw : parseInt(rawLaw,10)) : null;

  if(action==='logout'){ stopTimer(); if(typeof handleLogout==='function') handleLogout(); }
  else if(action==='home'){ stopTimer(); STATE.view='home'; render(); }
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
      const num = parseInt(val,10);
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
  else if(action==='quit-quiz'){ stopTimer(); STATE.view='home'; render(); }
  else if(action==='add'){ STATE.cameFromDb = false; STATE.lawId = law || STATE.lawId; STATE.view='add'; render(); }
  else if(action==='add-from-db'){ STATE.cameFromDb = true; STATE.lawId = null; STATE.view='add'; render(); }
  else if(action==='save-question'){ saveNewQuestion(); }
  else if(action==='stats'){ STATE.view='stats'; render(); }
  else if(action==='database'){ if(!isDevUser()) return; STATE.editingId=null; STATE.view='database'; loadQuestionReports(); render(); }
  else if(action==='report-question'){ reportQuestion(el.dataset.qid); }
  else if(action==='dismiss-reports'){ if(!isDevUser()) return; dismissReports(el.dataset.qid); }
  else if(action==='achievements'){ STATE.view='achievements'; render(); }
  else if(action==='profile'){ STATE.view='profile'; STATE.profileData=null; render(); loadProfileData(); }
  else if(action==='profile-edit'){ STATE.view='profileEdit'; render(); }
  else if(action==='profile-save-edit'){ saveProfileEdit(); }
  else if(action==='streak-calendar'){ STATE.calendarYear = null; STATE.view='streakCalendar'; render(); }
  else if(action==='recent-performance'){ STATE.view='recentPerformance'; render(); }
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
  else if(action==='mybank-quit'){ myBankStopTimer(); STATE.view='myBank'; render(); }
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
      STATE.storage.deleted[qid] = true;
      saveDeleted();
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
  else if(action==='admin-dashboard'){ if(!isDevUser()) return; STATE.view = 'adminDashboard'; loadAdminStats(); render(); }
  else if(action==='admin-dashboard-retry'){ if(!isDevUser()) return; loadAdminStats(); }
  else if(action==='admin-delete-user'){ if(!isDevUser()) return; STATE.confirmDeleteUserId = el.dataset.uid; render(); }
  else if(action==='admin-cancel-delete-user'){ STATE.confirmDeleteUserId = null; render(); }
  else if(action==='admin-confirm-delete-user'){ if(!isDevUser()) return; deleteAdminUser(STATE.confirmDeleteUserId); }
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

