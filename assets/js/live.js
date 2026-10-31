/* ---------------- Kahoot · juego de preguntas en directo para clase ----------------
   Panel de Formación → pestaña "En directo" (crear sala, abrirla, histórico) y, para el alumno,
   la entrada desde CTA BAGES (código o QR). Es un juego aparte: no toca la asistencia ni la clasificación.
   Toda la lógica y la seguridad viven en Supabase (supabase/committee-live.sql): el móvil del alumno
   nunca recibe la respuesta correcta antes de que acabe la pregunta.
   Depende de committee.js (COMMITTEE, cm*), attendance.js (attQrSvg) y app.js (esc, appConfirm). */

COMMITTEE.live = {
  games: null,          // admin: partidas (histórico)
  missing: false,       // falta ejecutar el SQL
  creating: false,
  draft: null,
  host: null,           // pantalla del proyector
  play: null,           // pantalla del alumno
  detail: null,         // resultados de una partida
  active: null,         // alumno: sala abierta ahora
  joinCode: ''
};
function lv(){ return COMMITTEE.live; }

const LV_COLORS = ['#E21B3C', '#1368CE', '#D89E00', '#26890C'];
const LV_LETTERS = ['a', 'b', 'c', 'd'];
const LV_SHAPES = [
  '<path d="M12 4 21 20H3z" fill="currentColor"/>',
  '<path d="m12 2 9 10-9 10-9-10z" fill="currentColor"/>',
  '<circle cx="12" cy="12" r="9" fill="currentColor"/>',
  '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>'
];
/* Los números de pregunta se cargan desde el servidor la primera vez; hasta entonces no se puede saber
   si un número existe (antes salía "no existe o se eliminó" para todos). */
function lvNumsReady(){ return !!(QNUM.ready || QNUM.failed); }
function lvNumsPreview(d){
  return lvNumsReady() ? cmNumsPreviewHtml(d) : `<div class="st-note">Cargando los números de las preguntas…</div>`;
}
async function liveEnsureNumbers(){
  try{ await qnumSync(); }catch(e){}
  for(let i = 0; i < 40 && QNUM.busy; i++) await new Promise(r => setTimeout(r, 150));   // si ya había otra carga en marcha, se espera
  if(lv().creating && STATE.view === 'committeeTraining') render();
}
function lvNum(q){ return questionNumber(q) || q.keepNum || null; }
function lvShape(i){ return `<svg viewBox="0 0 24 24" aria-hidden="true">${LV_SHAPES[i] || ''}</svg>`; }
function lvCode(c){ const s = String(c || ''); return s.length === 6 ? s.slice(0, 3) + ' ' + s.slice(3) : s; }
function lvErr(err){
  const m = String((err && (err.message || err.code)) || err || '');
  if(/game_not_found/.test(m)) return 'No hay ninguna sala abierta con ese código.';
  if(/not_joined/.test(m)) return 'Todavía no has entrado en esta sala.';
  if(/closed/.test(m)) return 'Se acabó el tiempo de esta pregunta.';
  if(/no_access/.test(m)) return 'Solo los árbitros del comité pueden jugar.';
  if(/bad_questions/.test(m)) return 'Revisa las preguntas: cada una necesita entre 2 y 4 opciones.';
  if(/not_draft/.test(m)) return 'Este borrador ya no se puede abrir o editar.';
  if(/live_open_draft|live_update_draft|p_draft|live_games_status_check/i.test(m)) return 'Falta ejecutar el SQL de borradores de Kahoot (committee-live-drafts.sql) en Supabase.';
  if(/live_games|live_players|live_questions|live_answers|live_create|live_state|live_join|PGRST20[25]|42P01|42883|schema cache/i.test(m)) return 'Falta ejecutar el SQL de Kahoot (committee-live.sql) en Supabase.';
  return cmErrText(err);
}
async function lvFetchAll(table, cols, gameId){
  const out = [];
  for(let from = 0; ; from += 1000){
    const r = await supabaseClient.from(table).select(cols).eq('game_id', gameId).range(from, from + 999);
    if(r.error) return { error: r.error, data: null };
    out.push.apply(out, r.data || []);
    if(!r.data || r.data.length < 1000) break;
  }
  return { error: null, data: out };
}

/* ====================== Panel de Formación · pestaña "En directo" ====================== */
async function liveLoadGames(){
  const L = lv();
  try{
    const r = await supabaseClient.from('live_games').select('*, live_players(count)').order('created_at', { ascending: false });
    if(r.error){ L.games = []; L.missing = true; return; }
    L.missing = false;
    L.games = (r.data || []).map(g => Object.assign({}, g, { players: (g.live_players && g.live_players[0]) ? g.live_players[0].count : 0 }));
  }catch(e){ L.games = []; L.missing = true; }
}
function liveGameCard(g){
  const ic = (n) => shellIcon(n);
  const draft = g.status === 'draft';
  const active = !draft && g.status !== 'finished' && (Date.now() - Date.parse(g.created_at)) < 12 * 3600000;
  const chip = draft ? '<span class="cm-chip draft">Borrador</span>' : active ? '<span class="cm-chip open">En curso</span>' : '<span class="cm-chip closed">Terminada</span>';
  const actions = draft
    ? `<button class="btn btn-primary" data-action="committee-live-open-draft" data-gid="${g.id}" ${g.question_count ? '' : 'disabled'}>${ic('play')} Abrir sala</button>
       <button class="btn btn-ghost" data-action="committee-live-edit" data-gid="${g.id}">${ic('pencil')} Editar</button>`
    : `${active ? `<button class="btn btn-primary" data-action="committee-live-open" data-gid="${g.id}">${ic('play')} Abrir sala</button>` : `<button class="btn btn-primary" data-action="committee-live-detail" data-gid="${g.id}">${ic('chart')} Resultados</button>`}
       ${active ? `<button class="btn btn-ghost" data-action="committee-live-detail" data-gid="${g.id}">${ic('chart')} Resultados</button>` : ''}
       <button class="btn btn-ghost" data-action="committee-live-repeat" data-gid="${g.id}">${ic('repeat')} Repetir</button>`;
  return `<article class="lv-gcard ${draft ? 'is-draft' : ''}">
    <div class="lv-gtop"><div><strong>${esc(g.title)}</strong><small>${draft ? 'Guardado el ' : ''}${esc(cmFmtDate(g.created_at))}</small></div>${chip}</div>
    <ul class="lv-gmeta"><li>${ic('book')}<span>${g.question_count} ${g.question_count === 1 ? 'pregunta' : 'preguntas'}</span></li>${draft ? '' : `<li>${ic('users')}<span>${g.players} ${g.players === 1 ? 'jugador' : 'jugadores'}</span></li>`}<li>${ic('timer')}<span>${g.seconds} s por pregunta</span></li></ul>
    <div class="lv-gactions">
      ${actions}
      <button class="tx-icon danger" data-action="committee-live-delete" data-gid="${g.id}" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>
    </div>
  </article>`;
}
function liveTab(){
  const ic = (n) => shellIcon(n);
  const L = lv();
  if(L.games === null) return `<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  if(L.missing) return `<div class="tc-card"><div class="st-note">Para usar Kahoot falta ejecutar una vez el SQL <b>committee-live.sql</b> en Supabase (SQL Editor).</div></div>`;
  if(L.creating) return liveCreateForm();
  const drafts = L.games.filter(g => g.status === 'draft');
  const played = L.games.filter(g => g.status !== 'draft');
  return `
  <div class="lv-intro">
    <div class="lv-intro-ic">${ic('zap')}</div>
    <div class="lv-intro-t"><h3>Kahoot</h3><p>Preguntas en directo para clase: proyectas la pantalla, los alumnos contestan desde el móvil y ves el resultado al instante. Puedes prepararlo en borrador y abrirlo el día de la clase. Es un juego aparte: no cuenta para la asistencia ni para la clasificación.</p></div>
    <button class="btn btn-yellow" data-action="committee-live-new">${ic('plus')} Nuevo Kahoot</button>
  </div>
  ${drafts.length ? `<div class="lg-section-head" style="margin-top:18px;"><h2>Borradores <em class="cm-count">${drafts.length}</em></h2><span>Preparados, todavía sin abrir en clase</span></div><div class="lv-glist">${drafts.map(liveGameCard).join('')}</div>` : ''}
  <div class="lg-section-head" style="margin-top:18px;"><h2>Histórico <em class="cm-count">${played.length}</em></h2><span>Partidas anteriores: pulsa para revisarlas</span></div>
  ${played.length ? `<div class="lv-glist">${played.map(liveGameCard).join('')}</div>` : `<div class="ac-empty">${ic('zap')}<strong>Todavía no has hecho ninguna partida</strong><span>Crea tu primer Kahoot con «Nuevo Kahoot».</span></div>`}`;
}

/* ---------- crear una sala ---------- */
function liveNewDraft(){ return { title: '', seconds: '20', numsText: '', selected: [], numsReport: null, copyTest: '', editId: null, ruleSel: '', ruleCount: 'all', ruleHard: false, ruleReport: null }; }

/* ---------- elegir preguntas por regla de la Base de datos ---------- */
/* Preguntas que se pueden jugar (sin las retiradas del juego) de una regla, del Glosario o del Reglament FCF. */
function lvRuleQuestions(sel, hardOnly){
  const m = /^r:(\d+)$/.exec(sel || '');
  return allQuestionsAdmin().filter(q => {
    if(q.draft) return false;
    if(m ? !(q.domain === 'law' && q.rule === parseInt(m[1], 10)) : q.domain !== sel) return false;
    return !hardOnly || q.difficulty === 'hard';
  });
}
function lvRuleOptions(d){
  const all = allQuestionsAdmin().filter(q => !q.draft);
  const n = (f) => all.filter(f).length;
  let h = '<option value="">Elige una regla…</option>';
  for(let r = 1; r <= 17; r++){
    const c = n(q => q.domain === 'law' && q.rule === r);
    h += `<option value="r:${r}" ${d.ruleSel === 'r:' + r ? 'selected' : ''} ${c ? '' : 'disabled'}>Regla ${r} · ${esc(LAW_NAMES[r] || '')} (${c})</option>`;
  }
  const g = n(q => q.domain === 'glossary'), f = n(q => q.domain === 'fcf');
  h += `<option value="glossary" ${d.ruleSel === 'glossary' ? 'selected' : ''} ${g ? '' : 'disabled'}>Glosario IFAB (${g})</option>`;
  h += `<option value="fcf" ${d.ruleSel === 'fcf' ? 'selected' : ''} ${f ? '' : 'disabled'}>Reglament General FCF (${f})</option>`;
  return h;
}
function lvRuleLabel(sel){
  const m = /^r:(\d+)$/.exec(sel || '');
  if(m) return 'Regla ' + m[1];
  return sel === 'glossary' ? 'Glosario IFAB' : sel === 'fcf' ? 'Reglament General FCF' : '';
}
function lvRuleReportHtml(rep){
  if(!rep) return '';
  const ic = (n) => shellIcon(n);
  if(!rep.available) return `<div class="cm-nums-rep warn">${ic('flag')}<span>No hay preguntas ${rep.hard ? 'difíciles ' : ''}en <b>${esc(rep.label)}</b>.</span></div>`;
  return `${rep.added ? `<div class="cm-nums-rep ok">${ic('check')}<span>Añadidas <b>${rep.added}</b> ${rep.added === 1 ? 'pregunta' : 'preguntas'} de <b>${esc(rep.label)}</b>${rep.random ? ' elegidas al azar' : ''}.</span></div>` : ''}
    ${rep.already ? `<div class="cm-nums-rep warn">${ic('flag')}<span>${rep.already} de <b>${esc(rep.label)}</b> ya ${rep.already === 1 ? 'estaba' : 'estaban'} en el juego${rep.added ? '' : ' y no hay más que añadir'}.</span></div>` : ''}`;
}
function liveItemsHtml(d){
  const ic = (n) => shellIcon(n);
  if(!d.selected.length) return `<div class="st-note" style="margin-top:12px;">Todavía no hay preguntas. Elige una regla arriba, escribe los números de la Base de datos (los que ves con #) o copia las de un test.</div>`;
  return `<div class="lv-qlist">${d.selected.map((q, i) => `<div class="lv-qrow">
      <span class="lv-qn">${i + 1}</span>
      ${lvNum(q) ? `<span class="db-q-num">#${lvNum(q)}</span>` : ''}
      <span class="lv-qt">${esc(q.question)}</span>
      <span class="lv-qbtns">
        <button class="tx-icon" data-action="committee-live-q-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${ic('up')}</button>
        <button class="tx-icon" data-action="committee-live-q-down" data-i="${i}" ${i === d.selected.length - 1 ? 'disabled' : ''} aria-label="Bajar">${ic('down')}</button>
        <button class="tx-icon danger" data-action="committee-live-q-del" data-i="${i}" aria-label="Quitar">${ic('trash')}</button>
      </span></div>`).join('')}</div>`;
}
function liveCreateForm(){
  const ic = (n) => shellIcon(n);
  const d = lv().draft || (lv().draft = liveNewDraft());
  const rep = d.numsReport;
  const repHtml = rep ? `${rep.added ? `<div class="cm-nums-rep ok">${ic('check')}<span>Añadidas <b>${rep.added}</b> ${rep.added === 1 ? 'pregunta' : 'preguntas'}.</span></div>` : ''}
      ${rep.already.length ? `<div class="cm-nums-rep warn">${ic('flag')}<span>Ya estaban: <b>${rep.already.join(', ')}</b>.</span></div>` : ''}
      ${rep.missing.length ? `<div class="cm-nums-rep bad">${ic('flag')}<span>No existen: <b>${rep.missing.join(', ')}</b>.</span></div>` : ''}
      ${rep.draft.length ? `<div class="cm-nums-rep bad">${ic('flag')}<span>Retirada del juego: <b>${rep.draft.join(', ')}</b>.</span></div>` : ''}` : '';
  const tests = (COMMITTEE.tests || []).filter(t => t.question_count);
  return `
  <button class="backbtn" data-action="committee-live-cancel">&larr; Volver a Kahoot</button>
  <div class="tc-card" style="margin-bottom:14px;">
    <div class="tc-card-head"><span class="tc-step">1</span><div><h3>${d.editId ? 'Editar borrador' : 'Nuevo Kahoot'}</h3><small>Ponle un nombre y elige cuánto tiempo tendrán</small></div></div>
    <label for="lv-title">Nombre de la partida</label>
    <input type="text" id="lv-title" data-cm-field="live.draft.title" value="${esc(d.title)}" maxlength="120" placeholder="Ej.: Repaso Regla 11" autocomplete="off">
    <label for="lv-secs">Tiempo por pregunta</label>
    <select id="lv-secs" data-cm-field="live.draft.seconds">${[10, 15, 20, 30, 45, 60, 90].map(s => `<option value="${s}" ${String(d.seconds) === String(s) ? 'selected' : ''}>${s} segundos</option>`).join('')}</select>
  </div>
  <div class="tc-card" style="margin-bottom:14px;">
    <div class="tc-card-head"><span class="tc-step">2</span><div><h3>Preguntas</h3><small>Elige una regla de la Base de datos, escribe sus números o copia un test</small></div></div>
    <div class="lv-rule">
      <label for="lv-rule-sel" style="margin-top:0;">Por regla</label>
      <div class="lv-rule-row">
        <select id="lv-rule-sel" data-cm-field="live.draft.ruleSel" aria-label="Regla de la Base de datos">${lvRuleOptions(d)}</select>
        <select id="lv-rule-count" data-cm-field="live.draft.ruleCount" aria-label="Cuántas preguntas">
          <option value="all" ${d.ruleCount === 'all' ? 'selected' : ''}>Todas</option>
          ${[5, 10, 15, 20, 25, 30, 40, 50].map(n => `<option value="${n}" ${String(d.ruleCount) === String(n) ? 'selected' : ''}>${n} al azar</option>`).join('')}
        </select>
        <label class="lv-rule-hard"><input type="checkbox" data-cm-field="live.draft.ruleHard" ${d.ruleHard ? 'checked' : ''}> Solo difíciles</label>
        <button class="btn btn-primary" data-action="committee-live-add-rule">${ic('plus')} Añadir regla</button>
      </div>
      ${lvRuleReportHtml(d.ruleReport)}
    </div>
    <label for="lv-nums">O por números</label>
    <textarea id="lv-nums" rows="3" placeholder="Ej.: 12, 45, 87, 120-125, 301" autocomplete="off">${esc(d.numsText)}</textarea>
    <div id="lv-nums-preview" style="margin-top:8px;">${lvNumsPreview(d)}</div>
    <div class="lv-addrow">
      <button class="btn btn-primary" data-action="committee-live-add">${ic('plus')} Añadir al juego</button>
      ${tests.length ? `<select id="lv-copy" data-cm-field="live.draft.copyTest" aria-label="Copiar de un test"><option value="">Copiar las preguntas de un test…</option>${tests.map(t => `<option value="${t.id}" ${d.copyTest === t.id ? 'selected' : ''}>${esc(t.title)} (${t.question_count})</option>`).join('')}</select>
        <button class="btn btn-ghost" data-action="committee-live-copy">${ic('copy')} Copiar</button>` : ''}
    </div>
    ${repHtml}
    <div class="lg-section-head" style="margin:18px 0 8px;"><h2 style="font-size:17px;">En el juego <em class="cm-count">${d.selected.length}</em></h2></div>
    ${liveItemsHtml(d)}
  </div>
  <div class="lv-saverow">
    <button class="btn btn-ghost lv-draftbtn" data-action="committee-live-save-draft" ${d.saving ? 'disabled' : ''}>${ic('file')} ${d.editId ? 'Guardar cambios' : 'Guardar como borrador'}</button>
    <button class="btn btn-yellow lv-create" data-action="committee-live-create" ${d.saving ? 'disabled' : ''}>${ic('zap')} ${d.saving ? 'Guardando...' : (d.editId ? 'Guardar y abrir la sala' : 'Crear y abrir la sala')}</button>
  </div>
  <p class="lv-draftnote">Un borrador no abre ninguna sala: lo dejas preparado y lo abres el día de la clase desde la lista.</p>`;
}
/* Guarda la partida: como borrador (open = false) o creándola y abriendo la sala (open = true) */
async function liveSaveGame(open){
  const d = lv().draft;
  if(!d || d.saving) return;
  const title = String(d.title || '').trim();
  if(!title){ cmToast('Ponle un nombre a la partida.'); return; }
  if(!d.selected.length){ cmToast('Añade al menos una pregunta.'); return; }
  d.saving = true; render();
  const secs = parseInt(d.seconds, 10) || 20;
  const payload = d.selected.map(q => ({ question: q.question, options: (q.options || []).slice(0, 4), correct: q.correct, rule: q.rule || null, explanation: q.explanation || '', qnum: lvNum(q) || null }));
  let id = d.editId, err = null;
  if(d.editId){
    const r = await supabaseClient.rpc('live_update_draft', { p_game: id, p_title: title, p_seconds: secs, p_questions: payload });
    err = r.error;
    if(!err && open){ const o = await supabaseClient.rpc('live_open_draft', { p_game: id }); err = o.error; }
  } else {
    const args = { p_title: title, p_seconds: secs, p_questions: payload };
    if(!open) args.p_draft = true;                       // abrir sin borrador funciona aunque falte el SQL de borradores
    const r = await supabaseClient.rpc('live_create', args);
    err = r.error || (!r.data ? { message: 'No se ha podido guardar. Inténtalo de nuevo.' } : null);
    id = r.data && r.data.id;
  }
  d.saving = false;
  if(err){ render(); cmToast(err.code === undefined && err.message ? err.message : lvErr(err)); return; }
  lv().creating = false; lv().draft = null;
  await liveLoadGames();
  if(open) liveOpenHost(id);
  else { STATE.toast = 'Borrador guardado.'; render(); window.scrollTo(0, 0); }
}

/* ====================== Pantalla del proyector (formador) ====================== */
function liveHostStop(){
  const H = lv().host; if(!H) return;
  H.running = false; clearTimeout(H.poll); clearInterval(H.tick);
  document.removeEventListener('keydown', liveHostKey, true);
  window.removeEventListener('resize', liveFitSoon);
}
function liveHostKey(e){
  if(!lv().host || STATE.view !== 'committeeLiveHost') return;
  if(['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target.tagName || ''))) return;
  if(e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight'){ e.preventDefault(); liveHostNext(); }
}
function liveOpenHost(id){
  liveHostStop();
  lv().host = { id, data: null, offset: 0, running: true, sig: '', err: null, busy: false, revealedCur: -2 };
  STATE.view = 'committeeLiveHost'; render(); window.scrollTo(0, 0);
  document.addEventListener('keydown', liveHostKey, true);
  window.addEventListener('resize', liveFitSoon);
  const H = lv().host;
  H.tick = setInterval(liveHostTick, 250);
  liveHostPoll();
}
async function liveHostPoll(){
  const H = lv().host;
  if(!H || !H.running || STATE.view !== 'committeeLiveHost'){ liveHostStop(); return; }
  clearTimeout(H.poll);
  const r = await supabaseClient.rpc('live_host_state', { p_game: H.id });
  if(!H.running || lv().host !== H) return;
  if(r.error){ H.err = lvErr(r.error); } else {
    H.err = null; H.data = r.data; H.offset = r.data.now - Date.now();
    const d = r.data;
    // todos han contestado: pasar a resultado sin esperar
    if(d.phase === 'question' && d.player_count > 0 && d.answered >= d.player_count && H.revealedCur !== d.cur){
      H.revealedCur = d.cur;
      supabaseClient.rpc('live_host_reveal', { p_game: H.id, p_pos: d.cur }).then(() => { H.poll = setTimeout(liveHostPoll, 150); });
    }
  }
  const d = H.data;
  const sig = JSON.stringify([H.err, d && [d.phase, d.cur, d.answered, d.player_count, (d.names || []).length, (d.top || []).map(t => t.score).join(',')]]);
  if(sig !== H.sig){ H.sig = sig; render(); liveFitSoon(); }
  H.poll = setTimeout(liveHostPoll, 1000);
}
function liveRemaining(src){
  if(!src.data || src.data.phase !== 'question' || !src.data.q_started) return null;
  return src.data.q_started + src.data.seconds * 1000 - (Date.now() + src.offset);
}
function liveHostTick(){
  const H = lv().host; if(!H) return;
  const rem = liveRemaining(H);
  if(rem === null) return;
  const n = document.getElementById('lv-timer-n'), b = document.getElementById('lv-tbar');
  if(n) n.textContent = Math.max(0, Math.ceil(rem / 1000));
  if(b) b.style.width = Math.max(0, Math.min(100, rem / (H.data.seconds * 1000) * 100)) + '%';
  if(rem <= 0 && !H.expiredPoll){ H.expiredPoll = true; setTimeout(() => { H.expiredPoll = false; liveHostPoll(); }, 250); }
}
async function liveHostNext(){
  const H = lv().host; if(!H || H.busy || !H.data) return;
  H.busy = true;
  const r = await supabaseClient.rpc('live_host_next', { p_game: H.id });
  H.busy = false;
  if(r.error){ cmToast(lvErr(r.error)); return; }
  liveHostPoll();
}
function liveOpts(q, revealed, counts, total){
  return (q.options || []).map((o, i) => {
    const L = LV_LETTERS[i];
    const cls = ['lv-opt']; if(revealed) cls.push(q.correct === L ? 'right' : 'dim');
    const n = counts ? (counts[L] || 0) : 0;
    const pct = revealed && total ? Math.round(n / total * 100) : 0;
    return `<div class="${cls.join(' ')}" style="--c:${LV_COLORS[i]}">
      <span class="lv-opt-badge"><span class="lv-opt-ic">${lvShape(i)}</span></span>
      <span class="lv-opt-t">${esc(o)}</span>
      ${revealed ? `<span class="lv-opt-res"><b>${n}</b><small>${pct}%</small></span>` : ''}
      ${revealed && q.correct === L ? `<span class="lv-opt-tick">${shellIcon('check')}</span>` : ''}
      ${revealed ? `<span class="lv-opt-bar"><i style="width:${pct}%"></i></span>` : ''}
    </div>`;
  }).join('');
}

/* Podio con animación lenta: primero el 3.º, luego el 2.º y al final el ganador, con confeti.
   startedAt = momento en que se mostró el podio; los retrasos se descuentan para que, si la pantalla se
   repinta, la animación continúe donde iba en vez de empezar otra vez. */
function livePodium(list, startedAt){
  const t = (list || []).slice(0, 3);
  if(!t.length) return { html: '', ends: 0 };
  const n = t.length;
  const el = startedAt ? (Date.now() - startedAt) / 1000 : 99;
  const delayOf = (idx) => (n - 1 - idx) * 2.3 + 0.6 + (idx === 0 ? 0.4 : 0);
  const names = ['¡El ganador!', '2.º puesto', '3.er puesto'];
  const order = [1, 0, 2].filter(i => t[i]);
  const cols = order.map(idx => { const p = t[idx];
    return `<div class="lv-pod p${idx + 1}" style="--d:${(delayOf(idx) - el).toFixed(2)}s">
      ${idx === 0 ? `<div class="lv-crown">${shellIcon('trophy')}</div>` : ''}
      <div class="lv-pod-n">${esc(p.name)}</div><div class="lv-pod-s">${p.score}</div>
      <div class="lv-pod-b"><span>${idx + 1}</span></div></div>`; }).join('');
  const caps = t.map((p, idx) => idx).reverse().map(idx =>
    `<div class="lv-cap ${idx === 0 ? 'last' : ''}" style="--d:${(delayOf(idx) - el - 0.3).toFixed(2)}s">${names[idx]}</div>`).join('');
  const wd = delayOf(0) + 1.0 - el;
  const colors = ['#FFC93C', '#FF6A2B', '#6EE7A0', '#7CB4FF', '#FF8A9C', '#FFFFFF'];
  const confetti = Array.from({ length: 40 }, (_, i) =>
    `<i style="left:${(i * 37 + 11) % 100}%; --c:${colors[i % colors.length]}; --cd:${(wd + (i % 10) * 0.13).toFixed(2)}s; --cs:${(3.2 + (i % 5) * 0.5).toFixed(1)}s; --r:${(i * 53) % 360}deg"></i>`).join('');
  return { done: (delayOf(0) + 3 - el) <= 0, html: `<div class="lv-podwrap"><div class="lv-caps">${caps}</div><div class="lv-podium">${cols}</div><div class="lv-confetti" aria-hidden="true">${confetti}</div></div>`, ends: delayOf(0) + 2.4 - el };
}

/* Ajusta el tamaño del texto para que la pregunta y TODAS las respuestas quepan siempre en la pantalla del proyector,
   sin tener que desplazarla (solo en pantallas grandes). */
function liveFitHost(){
  if(innerWidth < 900) return;
  const s = document.querySelector('.lv-screen.lv-fit');
  if(!s) return;
  const stage = s.querySelector('.lv-stage'); if(!stage) return;
  let k = 1; stage.style.setProperty('--fs', '1');
  const over = () => stage.scrollHeight > stage.clientHeight + 1 || s.scrollHeight > s.clientHeight + 1 ||
    Array.from(s.querySelectorAll('.lv-opt, .lv-qcard')).some(e => e.scrollHeight > e.clientHeight + 1);
  for(let i = 0; i < 60 && k > 0.3 && over(); i++){ k -= 0.03; stage.style.setProperty('--fs', k.toFixed(2)); }
}
function liveFitSoon(){ liveFitHost(); requestAnimationFrame(liveFitHost); }

function liveHostView(){
  const ic = (n) => shellIcon(n);
  const H = lv().host;
  const exit = `<button class="lv-x" data-action="committee-live-host-exit">${ic('up')}<span>Salir</span></button>`;
  if(!H || !H.data) return `<div class="lv-screen lv-host"><div class="lv-bar">${exit}</div><div class="lv-center"><div class="lv-spin"></div><p>${H && H.err ? esc(H.err) : 'Conectando con la sala...'}</p></div></div>`;
  const d = H.data, ph = d.phase;
  let body = '', primary = '';
  if(ph === 'lobby'){
    const url = location.origin + '/app.html?sala=' + d.code;
    let qr = '';
    try{ qr = attQrSvg(url); }catch(e){}
    body = `<div class="lv-lobby">
        <div class="lv-join-box">
          <div class="lv-step">Entra en <b>we-ref.com</b> → CTA BAGES → <b>Kahoot</b> y escribe el código</div>
          <div class="lv-bigcode">${esc(lvCode(d.code))}</div>
          <div class="lv-or">o escanea con la cámara</div>
          <div class="lv-qr">${qr}</div>
        </div>
        <div class="lv-who"><h3>${d.player_count} ${d.player_count === 1 ? 'jugador' : 'jugadores'}</h3>
          <div class="lv-chips">${(d.names || []).map(n => `<span class="lv-chip">${esc(n)}</span>`).join('') || '<span class="lv-wait">Esperando a que entren los alumnos…</span>'}</div></div>
      </div>`;
    primary = `<button class="btn btn-yellow lv-main" data-action="committee-live-host-next">${ic('play')} Empezar</button>`;
  } else if(ph === 'question' || ph === 'reveal'){
    const q = d.question || {};
    const rev = ph === 'reveal';
    const rem = liveRemaining(H);
    const timer = rev ? '' : `<span class="lv-timer"><span id="lv-timer-n">${rem === null ? d.seconds : Math.max(0, Math.ceil(rem / 1000))}</span></span>`;
    const head = `<div class="lv-qhead"><span class="lv-qcount">Pregunta ${d.cur + 1} de ${d.total}</span>${q.rule ? `<span class="lv-qrule">Regla ${q.rule}</span>` : ''}
        ${rev ? '' : `<span class="lv-answered">${d.answered} / ${d.player_count} han respondido</span>`}${timer}</div>
      ${rev ? '' : `<div class="lv-tbar"><i id="lv-tbar" style="width:${rem === null ? 100 : Math.max(0, Math.min(100, rem / (d.seconds * 1000) * 100))}%"></i></div>`}`;
    const main = `<div class="lv-qmain">
        <div class="lv-qcard"><h1 class="lv-q">${esc(q.question)}</h1></div>
        <div class="lv-opts n${(q.options || []).length}">${liveOpts(q, rev, d.counts, d.answered)}</div>
        ${rev && q.explanation ? `<div class="lv-expl">${ic('idea')}<span>${esc(q.explanation)}</span></div>` : ''}
      </div>`;
    const side = rev ? `<aside class="lv-side"><div class="lv-top"><h3>Clasificación</h3>${(d.top || []).map(t => `<div class="lv-trow"><span class="lv-tpos">${t.rank}</span><span class="lv-tname">${esc(t.name)}</span><b>${t.score}</b></div>`).join('')}</div></aside>` : '';
    body = `<div class="lv-qwrap ${rev ? 'rev' : ''}"><div class="lv-qtop">${head}</div>${main}${side}</div>`;
    primary = rev
      ? `<button class="btn btn-yellow lv-main" data-action="committee-live-host-next">${d.cur + 1 >= d.total ? 'Ver resultados finales' : 'Siguiente pregunta'} →</button>`
      : `<button class="btn btn-yellow lv-main" data-action="committee-live-host-next">Mostrar resultado</button>`;
  } else {
    if(!H.podiumStart) H.podiumStart = Date.now();
    const pod = livePodium(d.all, H.podiumStart);
    body = `<div class="lv-final ${pod.done ? 'done' : ''}"><h1>¡Partida terminada!</h1><p>${esc(d.title)}</p>
        ${pod.html}
        <div class="lv-top lv-all" style="animation-delay:${Math.max(0, pod.ends).toFixed(2)}s"><h3>Clasificación final</h3>${(d.all || []).map(t => `<div class="lv-trow"><span class="lv-tpos">${t.rank}</span><span class="lv-tname">${esc(t.name)}</span><b>${t.score}</b></div>`).join('')}</div></div>`;
    primary = `<button class="btn btn-yellow lv-main" data-action="committee-live-host-detail">${ic('chart')} Ver resultados completos</button>`;
  }
  const fit = (ph === 'question' || ph === 'reveal') ? ' lv-fit' : '';
  return `<div class="lv-screen lv-host lv-ph-${ph}${fit}">
    <div class="lv-bar">${exit}<div class="lv-title">${esc(d.title)}</div>${ph === 'lobby' ? '' : `<span class="lv-codepill">Código ${esc(lvCode(d.code))}</span>`}</div>
    <div class="lv-stage">${H.err ? `<div class="lv-err">${esc(H.err)}</div>` : ''}${body}</div>
    <div class="lv-foot">${ph === 'finished' ? '' : `<button class="btn btn-ghost lv-endbtn" data-action="committee-live-host-end">Terminar partida</button>`}${primary}</div>
  </div>`;
}

/* ====================== Pantalla del alumno ====================== */
function livePlayStop(){
  const P = lv().play; if(!P) return;
  P.running = false; clearTimeout(P.poll); clearInterval(P.tick);
}
async function liveJoin(code, silent){
  const c = String(code || '').replace(/\D/g, '');
  if(c.length !== 6){ if(!silent) cmToast('El código tiene 6 números.'); return false; }
  const r = await supabaseClient.rpc('live_join', { p_code: c });
  if(r.error){ if(silent) return r.error; cmToast(lvErr(r.error)); return false; }
  livePlayStop();
  lv().play = { id: r.data.id, data: null, offset: 0, running: true, sig: '', err: null, sending: false };
  STATE.view = 'committeeLivePlay'; render(); window.scrollTo(0, 0);
  const P = lv().play;
  P.tick = setInterval(livePlayTick, 250);
  livePlayPoll();
  return true;
}
async function livePlayPoll(){
  const P = lv().play;
  if(!P || !P.running || STATE.view !== 'committeeLivePlay'){ livePlayStop(); return; }
  clearTimeout(P.poll);
  const r = await supabaseClient.rpc('live_state', { p_game: P.id });
  if(!P.running || lv().play !== P) return;
  if(r.error){
    const m = String(r.error.message || '');
    if(/game_not_found|not_joined/.test(m)){ livePlayStop(); lv().play = null; STATE.view = 'committee'; STATE.toast = 'La sala ya no está disponible.'; render(); return; }
    P.err = 'Reconectando…';
  } else {
    P.err = null; P.data = r.data; P.offset = r.data.now - Date.now();
    if(P.lastCur !== r.data.cur){ P.lastCur = r.data.cur; P.pending = null; }   // pregunta nueva: nada elegido todavía
  }
  const d = P.data;
  const sig = JSON.stringify([P.err, d && [d.phase, d.cur, d.mine, d.score, d.rank, d.player_count, P.pending]]);
  if(sig !== P.sig){ P.sig = sig; render(); }
  P.poll = setTimeout(livePlayPoll, d && d.phase === 'question' ? 900 : 1300);
}
function livePlayTick(){
  const P = lv().play; if(!P) return;
  const rem = liveRemaining(P);
  if(rem === null) return;
  const n = document.getElementById('lv-ptimer'), b = document.getElementById('lv-pbar');
  if(n) n.textContent = Math.max(0, Math.ceil(rem / 1000));
  if(b) b.style.width = Math.max(0, Math.min(100, rem / (P.data.seconds * 1000) * 100)) + '%';
  if(rem <= 0 && !P.expiredPoll){ P.expiredPoll = true; setTimeout(() => { P.expiredPoll = false; livePlayPoll(); }, 300); }
}
async function liveAnswer(choice){
  const P = lv().play; if(!P || !P.data || P.sending) return;
  const d = P.data;
  if(d.phase !== 'question' || !d.question || d.mine) return;
  P.sending = true; P.pending = choice; P.sig = ''; render();
  const r = await supabaseClient.rpc('live_answer', { p_game: P.id, p_pos: d.question.pos, p_choice: choice });
  P.sending = false;
  if(r.error){ P.pending = null; cmToast(lvErr(r.error)); }
  P.sig = '';
  livePlayPoll();
}
function livePlayView(){
  const ic = (n) => shellIcon(n);
  const P = lv().play;
  const exit = `<button class="lv-x" data-action="committee-live-play-exit">${ic('up')}<span>Salir</span></button>`;
  if(!P || !P.data) return `<div class="lv-screen lv-play"><div class="lv-bar">${exit}</div><div class="lv-center"><div class="lv-spin"></div><p>${P && P.err ? esc(P.err) : 'Entrando en la sala…'}</p></div></div>`;
  const d = P.data, ph = d.phase;
  let body = '';
  if(ph === 'lobby'){
    body = `<div class="lv-center lv-pwait"><div class="lv-ok">${ic('check')}</div><h2>¡Estás dentro!</h2><p class="lv-pname">${esc(d.name)}</p>
      <p>Mira la pantalla del proyector.<br>La partida empezará en cuanto el formador lo decida.</p><div class="lv-pcount">${d.player_count} ${d.player_count === 1 ? 'jugador' : 'jugadores'} en la sala</div></div>`;
  } else if(ph === 'question' && d.question){
    const q = d.question, sel = d.mine ? d.mine.choice : P.pending;
    const rem = liveRemaining(P);
    body = `<div class="lv-pq">
        <div class="lv-pmeta"><span>Pregunta ${d.cur + 1} de ${d.total}</span><span class="lv-ptimer-wrap">${ic('timer')}<b id="lv-ptimer">${rem === null ? d.seconds : Math.max(0, Math.ceil(rem / 1000))}</b></span></div>
        <div class="lv-tbar"><i id="lv-pbar" style="width:${rem === null ? 100 : Math.max(0, Math.min(100, rem / (d.seconds * 1000) * 100))}%"></i></div>
        <h2 class="lv-pqt">${esc(q.question)}</h2>
        <div class="lv-pans">${(q.options || []).map((o, i) => `<button class="lv-ans ${sel === LV_LETTERS[i] ? 'sel' : ''} ${sel && sel !== LV_LETTERS[i] ? 'dim' : ''}" style="--c:${LV_COLORS[i]}" data-action="committee-live-answer" data-choice="${LV_LETTERS[i]}" ${sel ? 'disabled' : ''}><span class="lv-opt-ic">${lvShape(i)}</span><span class="lv-opt-t">${esc(o)}</span></button>`).join('')}</div>
        ${sel ? `<div class="lv-sent">${ic('check')} Respuesta enviada. Espera a que acabe el tiempo.</div>` : ''}
      </div>`;
  } else if(ph === 'reveal' && d.question){
    const q = d.question, mine = d.mine;
    const ok = mine && mine.correct;
    body = `<div class="lv-pq lv-prev">
        <div class="lv-res ${mine ? (ok ? 'good' : 'bad') : 'none'}">
          <div class="lv-res-ic">${ic(mine ? (ok ? 'check' : 'flag') : 'clock')}</div>
          <h2>${mine ? (ok ? '¡Correcta!' : 'Incorrecta') : 'No has respondido'}</h2>
          ${mine && ok ? `<div class="lv-pts">+${mine.points} puntos</div>` : ''}
        </div>
        <div class="lv-pmeta" style="margin-top:14px;"><span>Respuesta correcta</span></div>
        <div class="lv-pans">${(q.options || []).map((o, i) => LV_LETTERS[i] === q.correct ? `<div class="lv-ans right" style="--c:${LV_COLORS[i]}"><span class="lv-opt-ic">${lvShape(i)}</span><span class="lv-opt-t">${esc(o)}</span></div>` : '').join('')}</div>
        ${q.explanation ? `<div class="lv-expl">${ic('idea')}<span>${esc(q.explanation)}</span></div>` : ''}
        <div class="lv-me"><div><small>Tu puntuación</small><b>${d.score}</b></div><div><small>Tu puesto</small><b>${d.rank}º<em> de ${d.player_count}</em></b></div></div>
        <div class="lv-top"><h3>Clasificación</h3>${(d.top || []).map(t => `<div class="lv-trow"><span class="lv-tpos">${t.rank}</span><span class="lv-tname">${esc(t.name)}</span><b>${t.score}</b></div>`).join('')}</div>
        <p class="lv-wait" style="text-align:center;">Siguiente pregunta en cuanto el formador continúe…</p>
      </div>`;
  } else {
    if(!P.podiumStart) P.podiumStart = Date.now();
    const pod = livePodium(d.top, P.podiumStart);
    body = `<div class="lv-pq lv-pfinal ${pod.done ? 'done' : ''}"><div class="lv-trophy">${ic('trophy')}</div><h2>¡Partida terminada!</h2>
        <div class="lv-me big"><div><small>Tu puesto</small><b>${d.rank}º<em> de ${d.player_count}</em></b></div><div><small>Puntos</small><b>${d.score}</b></div></div>
        ${pod.html}
        <div class="lv-top"><h3>Clasificación</h3>${(d.top || []).map(t => `<div class="lv-trow"><span class="lv-tpos">${t.rank}</span><span class="lv-tname">${esc(t.name)}</span><b>${t.score}</b></div>`).join('')}</div>
        <button class="btn btn-yellow lv-main" data-action="committee-live-play-exit">Salir</button></div>`;
  }
  return `<div class="lv-screen lv-play lv-ph-${ph}"><div class="lv-bar">${exit}<div class="lv-title">${esc(d.title)}</div></div><div class="lv-stage">${P.err ? `<div class="lv-err">${esc(P.err)}</div>` : ''}${body}</div></div>`;
}

/* Tarjeta de CTA BAGES: entrar en una sala con el código */
function liveJoinCard(){
  const ic = (n) => shellIcon(n);
  const L = lv();
  const a = L.active;
  return `<section class="lv-joincard">
    <div class="lv-jc-ic">${ic('zap')}</div>
    <div class="lv-jc-t"><strong>Kahoot</strong><span>${a ? `Hay una sala abierta: <b>${esc(a.title)}</b>` : 'Entra con el código que verás en el proyector'}</span></div>
    <div class="lv-jc-f">
      <input type="text" id="lv-join-code" inputmode="numeric" pattern="[0-9]*" maxlength="7" placeholder="Código" value="${esc(L.joinCode || (a ? lvCode(a.code) : ''))}" autocomplete="off" aria-label="Código de la sala">
      <button class="btn btn-yellow" data-action="committee-live-join">Unirme</button>
    </div>
  </section>`;
}
async function liveCheckActive(){
  try{
    const r = await supabaseClient.rpc('live_active');
    lv().active = (r && !r.error && r.data) ? r.data : null;
  }catch(e){ lv().active = null; }
}
/* El alumno escanea el QR del proyector: app.html?sala=CÓDIGO */
async function liveJoinFromLink(){
  let code = null;
  try{ code = new URLSearchParams(location.search).get('sala'); }catch(e){}
  try{
    if(!code) code = sessionStorage.getItem('weref_live');
    sessionStorage.removeItem('weref_live');
  }catch(e){}
  if(!code) return;
  try{ history.replaceState(null, '', location.pathname); }catch(e){}
  const res = await liveJoin(code, true);
  if(res !== true && typeof attShowCheckinResult === 'function'){
    attShowCheckinResult(false, 'No se ha podido entrar', res && res.message ? lvErr(res) : 'Revisa el código de la sala.');
  }
}

/* ====================== Resultados e histórico de una partida ====================== */
async function liveOpenDetail(gid){
  const L = lv();
  L.detail = { id: gid, loading: true };
  STATE.view = 'committeeLiveDetail'; render(); window.scrollTo(0, 0);
  const [g, qs, ps, as] = await Promise.all([
    supabaseClient.from('live_games').select('*').eq('id', gid).maybeSingle(),
    supabaseClient.from('live_questions').select('*').eq('game_id', gid).order('pos'),
    supabaseClient.from('live_players').select('*').eq('game_id', gid).order('score', { ascending: false }),
    lvFetchAll('live_answers', 'pos,user_id,choice,correct,points,ms', gid)
  ]);
  if(g.error || !g.data){ L.detail = { id: gid, error: 'No se ha podido cargar la partida.' }; render(); return; }
  L.detail = { id: gid, game: g.data, questions: qs.data || [], players: ps.data || [], answers: as.data || [] };
  render();
}
function liveDetailStats(D){
  const byQ = {}; D.answers.forEach(a => { (byQ[a.pos] = byQ[a.pos] || []).push(a); });
  const nameOf = {}; D.players.forEach(p => { nameOf[p.user_id] = p.name; });
  const perQ = D.questions.map(q => {
    const arr = byQ[q.pos] || [];
    const counts = {}; arr.forEach(a => { counts[a.choice] = (counts[a.choice] || 0) + 1; });
    const right = arr.filter(a => a.correct).length;
    return { q, arr, counts, right, pct: arr.length ? Math.round(right / arr.length * 100) : null,
             failed: arr.filter(a => !a.correct).map(a => nameOf[a.user_id] || '—'),
             avgMs: arr.length ? Math.round(arr.reduce((s, a) => s + a.ms, 0) / arr.length / 100) / 10 : null };
  });
  const correctOf = {}; D.answers.forEach(a => { if(a.correct) correctOf[a.user_id] = (correctOf[a.user_id] || 0) + 1; });
  const ranking = D.players.map((p, i) => ({ p, correct: correctOf[p.user_id] || 0 }));
  let rank = 0, prev = null;
  ranking.forEach((r, i) => { if(r.p.score !== prev){ rank = i + 1; prev = r.p.score; } r.rank = rank; });
  const tot = D.answers.length, ok = D.answers.filter(a => a.correct).length;
  return { perQ, ranking, avgPct: tot ? Math.round(ok / tot * 100) : null };
}
function liveDetailView(){
  const ic = (n) => shellIcon(n);
  const D = lv().detail;
  const back = `<button class="backbtn" data-action="committee-live-back">&larr; Volver a Kahoot</button>`;
  if(!D || D.loading) return `${back}<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  if(D.error) return `${back}<div class="ac-empty">${ic('flag')}<strong>${esc(D.error)}</strong></div>`;
  const g = D.game, s = liveDetailStats(D);
  const active = g.status !== 'finished';
  const rankHtml = s.ranking.length ? s.ranking.map(r => `<div class="lv-rrow ${r.rank <= 3 ? 'top' + r.rank : ''}">
      <span class="lv-rpos">${r.rank}</span><span class="lv-rname">${esc(r.p.name)}</span>
      <span class="lv-rok">${r.correct}/${D.questions.length} aciertos</span><b>${r.p.score}</b></div>`).join('') : `<div class="st-note">Nadie jugó esta partida.</div>`;
  const qHtml = s.perQ.map(x => {
    const q = x.q, n = x.arr.length;
    return `<details class="lv-dq">
      <summary><span class="lv-qn">${q.pos + 1}</span><span class="lv-qt">${esc(q.question)}</span>${x.pct !== null ? accuracyBadge(x.pct) : '<span class="mb-none">—</span>'}</summary>
      <div class="lv-dq-body">
        ${(q.options || []).map((o, i) => { const L = LV_LETTERS[i]; const c = x.counts[L] || 0; const pc = n ? Math.round(c / n * 100) : 0;
          return `<div class="lv-dopt ${q.correct === L ? 'right' : ''}"><span class="lv-dletter" style="background:${LV_COLORS[i]}">${L.toUpperCase()}</span><span class="lv-dtext">${esc(o)}</span><span class="lv-dcount">${c}</span><span class="lv-dbar"><i style="width:${pc}%"></i></span></div>`; }).join('')}
        <div class="lv-dmeta">${n} ${n === 1 ? 'respuesta' : 'respuestas'}${x.avgMs !== null ? ` · tiempo medio ${x.avgMs} s` : ''}${q.rule ? ` · Regla ${q.rule}` : ''}${q.qnum ? ` · #${q.qnum}` : ''}</div>
        ${x.failed.length ? `<div class="lv-failed"><strong>Han fallado:</strong> ${x.failed.map(esc).join(', ')}</div>` : ''}
        ${q.explanation ? `<div class="lv-expl">${ic('idea')}<span>${esc(q.explanation)}</span></div>` : ''}
      </div></details>`; }).join('');
  return `
  ${back}
  <section class="lg-hero ac-hero">
    <div class="lg-hero-main"><div class="home-eyebrow">Kahoot · ${esc(cmFmtDate(g.created_at))}</div><h1>${esc(g.title)}</h1>
      <div class="ac-hero-actions">
        ${active ? `<button class="btn btn-yellow" data-action="committee-live-open" data-gid="${g.id}">${ic('play')} Abrir sala</button>` : ''}
        <button class="btn btn-glass" data-action="committee-live-repeat" data-gid="${g.id}">${ic('repeat')} Repetir</button>
        <button class="btn btn-glass" data-action="committee-live-export">${ic('download')} Exportar</button>
      </div></div>
    <div class="lg-hero-stats cm-hero-stats">
      <div class="lg-stat"><b>${D.players.length}</b><span>Jugadores</span></div>
      <div class="lg-stat"><b>${D.questions.length}</b><span>Preguntas</span></div>
      <div class="lg-stat"><b>${s.avgPct !== null ? s.avgPct + '%' : '—'}</b><span>Acierto</span></div>
    </div>
  </section>
  <div class="tc-card" style="margin-bottom:14px;">
    <div class="tc-card-head"><span class="tc-step">${ic('trophy')}</span><div><h3>Clasificación</h3><small>Puntos por acertar, más rápido = más puntos</small></div></div>
    <div class="lv-rlist">${rankHtml}</div>
  </div>
  <div class="tc-card">
    <div class="tc-card-head"><span class="tc-step">${ic('book')}</span><div><h3>Preguntas</h3><small>Pulsa una para ver qué contestó la clase</small></div></div>
    ${qHtml || '<div class="st-note">Esta partida no tiene preguntas.</div>'}
  </div>`;
}

/* ====================== Acciones ====================== */
async function liveOnAction(action, el){
  const L = lv();
  if(!isDevUser() && !/^committee-live-(join|answer|play-exit)$/.test(action)) return;
  if(action === 'committee-live-new'){ L.draft = liveNewDraft(); L.creating = true; render(); window.scrollTo(0, 0); liveEnsureNumbers(); }
  else if(action === 'committee-live-cancel'){ L.creating = false; L.draft = null; render(); }
  else if(action === 'committee-live-add'){
    const d = L.draft; if(!d) return;
    if(!lvNumsReady()){ await liveEnsureNumbers(); }
    if(!lvNumsReady()){ cmToast('Todavía se están cargando los números de las preguntas. Inténtalo en unos segundos.'); return; }
    cmAddByNumbers(d);
    d.numsText = ''; render();
  }
  else if(action === 'committee-live-add-rule'){
    const d = L.draft; if(!d) return;
    if(!d.ruleSel){ cmToast('Elige primero una regla.'); return; }
    const all = lvRuleQuestions(d.ruleSel, d.ruleHard);
    const label = lvRuleLabel(d.ruleSel);
    const inGame = new Set(d.selected.map(q => q.id));
    const seen = new Set(d.selected.map(q => normalizeQuestionText(q.question)));
    const fresh = all.filter(q => !inGame.has(q.id) && !seen.has(normalizeQuestionText(q.question)));
    const want = d.ruleCount === 'all' ? fresh.length : Math.min(parseInt(d.ruleCount, 10) || 0, fresh.length);
    const random = d.ruleCount !== 'all' && want < fresh.length;
    let pick;
    if(random) pick = shuffle(fresh.slice()).slice(0, want);
    else pick = fresh.slice().sort((a, b) => (lvNum(a) || 1e9) - (lvNum(b) || 1e9));    // todas: en el orden de la Base de datos
    pick.forEach(q => d.selected.push(q));
    d.ruleReport = { label, hard: !!d.ruleHard, available: all.length, added: pick.length, already: all.length - fresh.length, random };
    render();
  }
  else if(action === 'committee-live-copy'){
    const d = L.draft; if(!d || !d.copyTest){ cmToast('Elige primero un test.'); return; }
    const r = await supabaseClient.from('committee_test_questions').select('*').eq('test_id', d.copyTest).order('pos');
    if(r.error){ cmToast(cmErrText(r.error)); return; }
    const seen = new Set(d.selected.map(q => normalizeQuestionText(q.question)));
    let added = 0;
    (r.data || []).forEach(x => { const k = normalizeQuestionText(x.question); if(seen.has(k)) return; seen.add(k); d.selected.push({ id: 'cp' + x.id, question: x.question, options: x.options, correct: x.correct, rule: x.rule || null, explanation: x.explanation || '' }); added++; });
    d.numsReport = { added, already: [], missing: [], draft: [], total: added };
    render();
  }
  else if(action === 'committee-live-q-up' || action === 'committee-live-q-down'){
    const d = L.draft; if(!d) return;
    const i = parseInt(el.dataset.i, 10), j = action.endsWith('up') ? i - 1 : i + 1;
    if(j < 0 || j >= d.selected.length) return;
    const t = d.selected[i]; d.selected[i] = d.selected[j]; d.selected[j] = t; render();
  }
  else if(action === 'committee-live-q-del'){ const d = L.draft; if(!d) return; d.selected.splice(parseInt(el.dataset.i, 10), 1); render(); }
  else if(action === 'committee-live-create'){ await liveSaveGame(true); }
  else if(action === 'committee-live-save-draft'){ await liveSaveGame(false); }
  else if(action === 'committee-live-open'){ liveOpenHost(el.dataset.gid); }
  else if(action === 'committee-live-open-draft'){
    const r = await supabaseClient.rpc('live_open_draft', { p_game: el.dataset.gid });
    if(r.error){ cmToast(lvErr(r.error)); return; }
    await liveLoadGames();
    liveOpenHost(el.dataset.gid);
  }
  else if(action === 'committee-live-edit'){
    const gid = el.dataset.gid;
    const [g, qs] = await Promise.all([supabaseClient.from('live_games').select('*').eq('id', gid).maybeSingle(), supabaseClient.from('live_questions').select('*').eq('game_id', gid).order('pos')]);
    if(g.error || qs.error || !g.data){ cmToast('No se ha podido cargar el borrador.'); return; }
    L.draft = Object.assign(liveNewDraft(), { editId: gid, title: g.data.title, seconds: String(g.data.seconds), selected: (qs.data || []).map(q => ({ id: 'rp' + q.pos, question: q.question, options: q.options, correct: q.correct, rule: q.rule, explanation: q.explanation || '', keepNum: q.qnum || null })) });
    L.creating = true; render(); window.scrollTo(0, 0); liveEnsureNumbers();
  }
  else if(action === 'committee-live-host-next'){ await liveHostNext(); }
  else if(action === 'committee-live-host-end'){
    const H = L.host; if(!H) return;
    const ok = await appConfirm({ title: 'Terminar la partida', message: 'Se cerrará la sala y se mostrará la clasificación final. No se puede reabrir.', confirmText: 'Terminar', danger: true });
    if(!ok) return;
    const r = await supabaseClient.rpc('live_host_end', { p_game: H.id });
    if(r.error){ cmToast(lvErr(r.error)); return; }
    liveHostPoll();
  }
  else if(action === 'committee-live-host-exit'){
    liveHostStop(); L.host = null; COMMITTEE.tab = 'live'; STATE.view = 'committeeTraining'; render(); await liveLoadGames(); cmRefresh();
  }
  else if(action === 'committee-live-host-detail'){ const id = L.host && L.host.id; liveHostStop(); L.host = null; if(id) liveOpenDetail(id); }
  else if(action === 'committee-live-detail'){ liveOpenDetail(el.dataset.gid); }
  else if(action === 'committee-live-back'){ L.detail = null; COMMITTEE.tab = 'live'; STATE.view = 'committeeTraining'; render(); await liveLoadGames(); cmRefresh(); }
  else if(action === 'committee-live-repeat'){
    const gid = el.dataset.gid;
    const [g, qs] = await Promise.all([supabaseClient.from('live_games').select('*').eq('id', gid).maybeSingle(), supabaseClient.from('live_questions').select('*').eq('game_id', gid).order('pos')]);
    if(g.error || qs.error || !g.data){ cmToast('No se ha podido cargar la partida.'); return; }
    L.draft = Object.assign(liveNewDraft(), { title: g.data.title, seconds: String(g.data.seconds), selected: (qs.data || []).map(q => ({ id: 'rp' + q.pos, question: q.question, options: q.options, correct: q.correct, rule: q.rule, explanation: q.explanation || '', keepNum: q.qnum || null })) });
    L.creating = true; COMMITTEE.tab = 'live'; STATE.view = 'committeeTraining'; render(); window.scrollTo(0, 0); liveEnsureNumbers();
  }
  else if(action === 'committee-live-delete'){
    const g = (L.games || []).find(x => x.id === el.dataset.gid); if(!g) return;
    const ok = await appConfirm({ title: 'Eliminar la partida', message: `Se borrará «${g.title}» con todas sus respuestas. No se puede deshacer.`, confirmText: 'Eliminar', danger: true });
    if(!ok) return;
    const r = await supabaseClient.from('live_games').delete().eq('id', g.id);
    if(r.error){ cmToast(lvErr(r.error)); return; }
    await liveLoadGames(); STATE.toast = 'Partida eliminada.'; render();
  }
  else if(action === 'committee-live-export'){
    const D = L.detail; if(!D || !D.game) return;
    const s = liveDetailStats(D);
    cmExport(s.ranking.map(r => ({ 'Posición': r.rank, 'Nombre': r.p.name, 'Puntos': r.p.score, 'Aciertos': r.correct, 'Preguntas': D.questions.length })), 'Kahoot', 'kahoot_' + String(D.game.title).replace(/[^\w]+/g, '_') + '.xlsx');
  }
  else if(action === 'committee-live-join'){
    const inp = document.getElementById('lv-join-code');
    const code = inp ? inp.value : L.joinCode;
    L.joinCode = code;
    await liveJoin(code);
  }
  else if(action === 'committee-live-answer'){ await liveAnswer(el.dataset.choice); }
  else if(action === 'committee-live-play-exit'){
    livePlayStop(); L.play = null; STATE.view = 'committee'; render(); window.scrollTo(0, 0);
    liveCheckActive().then(() => cmRefresh());
  }
}

/* eventos tras pintar */
function liveAfterRender(){
  const ta = document.getElementById('lv-nums');
  if(ta) ta.addEventListener('input', () => {
    const d = lv().draft; if(!d) return;
    d.numsText = ta.value;
    const pv = document.getElementById('lv-nums-preview'); if(pv) pv.innerHTML = lvNumsPreview(d);
  });
  const jc = document.getElementById('lv-join-code');
  if(jc) jc.addEventListener('input', () => { lv().joinCode = jc.value; });
}
