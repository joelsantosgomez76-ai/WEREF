/* ---------------- MI PREPARACIÓN (#/preparacion) ----------------
   Examen, racha con objetivo y comodín, plan de la semana, calendario de un mes y próximos eventos.
   El cliente solo muestra lo que calcula el servidor (RPC get_prep, get_prep_month, get_prep_day, get_prep_heat, set_daily_goal);
   los eventos son del propio usuario (tabla user_events con RLS).
   Depende de app.js (STATE, esc, render, onAction, shellIcon, todayKeyISO, LAW_SHORT, appConfirm, supabaseClient) y gami.js (gmN). */

const PP_KIND = {
  examen_teorico: { label: 'Examen teórico', icon: 'book', dot: 'exam' },
  prueba_fisica: { label: 'Prueba física', icon: 'zap', dot: 'phys' },
  comite: { label: 'Reunión de comité', icon: 'users', dot: 'meet' },
  otro: { label: 'Otro', icon: 'calendar', dot: 'other' }
};
const PP_WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const PP_MODE = { short: 'Test rápido', study25: 'Modo estudio', training: 'Test personalizado', daily: 'Reto del día', failed_rule: 'Sala de Repaso', hearts: 'League · Corazones', suddendeath: 'League · Muerte Súbita', timeattack: 'League · Contrarreloj' };
const PP_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function ppS(){ return STATE.pp || (STATE.pp = { month: '', months: {}, heat: null, busy: false }); }
const ppPl = (n, s, p) => n + ' ' + (n === 1 ? s : p);
function ppParse(iso){ const p = String(iso).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function ppDateLong(iso){ return capFirst(ppParse(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })); }
function ppDateShort(iso){ return capFirst(ppParse(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })); }
function ppMonthKey(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
function ppDaysLeftText(n){ return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : 'en ' + n + ' días'; }

/* ---------- carga ---------- */
async function loadPrep(){
  const s = ppS();
  try{
    const { data, error } = await supabaseClient.rpc('get_prep');
    if(error) throw error;
    STATE.prep = (typeof data === 'string') ? JSON.parse(data) : data; STATE.prepErr = false;
  }catch(e){ console.warn('get_prep', e); STATE.prepErr = true; }
  if(String(STATE.view) === 'prep'){ await ppLoadMonth(s.month || ppMonthKey(new Date()), true); if(window.innerWidth >= 1024) ppLoadHeat(); }
  if(['home', 'prep'].includes(String(STATE.view))) render();
}
async function ppLoadMonth(key, silent){
  const s = ppS(); s.month = key;
  try{
    const { data, error } = await supabaseClient.rpc('get_prep_month', { p_month: key });
    if(error) throw error;
    s.months[key] = (typeof data === 'string') ? JSON.parse(data) : data;
  }catch(e){ console.warn('get_prep_month', e); s.months[key] = s.months[key] || { days: [], events: [], error: true }; }
  if(!silent) render();
}
async function ppLoadHeat(){
  try{
    const { data, error } = await supabaseClient.rpc('get_prep_heat'); if(error) throw error;
    ppS().heat = (typeof data === 'string') ? JSON.parse(data) : data;
    if(String(STATE.view) === 'prep') render();
  }catch(e){ ppS().heat = []; }
}

/* ---------- piezas ---------- */
function ppTaskTitle(t){
  const rn = t.rule ? 'Regla ' + t.rule : '', nm = t.rule && typeof LAW_SHORT !== 'undefined' ? LAW_SHORT[t.rule] : '';
  const lvl = t.rule ? ((STATE.storage.crownLevels || {})[t.rule] || 0) : 0;
  switch(t.kind){
    case 'corona': return t.done ? `Corona ${lvl} en ${rn}` : `Corona ${Math.min(4, lvl + 1)} en ${rn}${nm ? ' · ' + nm : ''}`;
    case 'simulacro': return t.target > 1 ? `Simulacro de 25 preguntas (${t.target} veces)` : 'Simulacro de 25 preguntas';
    case 'regla': return `${rn}${nm ? ' · ' + nm : ''}: ${t.target} preguntas`;
    case 'repaso': return `Sala de Repaso: supera ${t.target} preguntas`;
    case 'constancia': return `Cumple tu objetivo ${t.target} ${t.target === 1 ? 'día' : 'días'}`;
    case 'nuevas': return `Aprende ${t.target} preguntas nuevas`;
    default: return 'Tarea';
  }
}
function ppExamCard(p){
  const ex = p.exam, ic = shellIcon;
  const weak = (p.weak || []).map(w => `Regla ${w.rule}${typeof LAW_SHORT !== 'undefined' && LAW_SHORT[w.rule] ? ' · ' + LAW_SHORT[w.rule] : ''} (${w.mastery} %)`);
  const weakTxt = weak.length ? `<p class="pp-weak">${ic('target')}<span>Lo que más te falta: <b>${esc(weak.join(' y '))}</b></span></p>` : '';
  if(!ex){
    return `<section class="pp-card pp-exam none"><div class="pp-eyebrow">Próximo examen</div><h2>Añade la fecha de tu examen</h2>
      <p class="pp-sub">Con la fecha te preparamos una cuenta atrás, una previsión y un plan para cada semana.</p>
      <div class="pp-prep-row"><div class="pp-bar"><i style="width:${Math.round(p.prep || 0)}%"></i></div><span><b>${Math.round(p.prep || 0)} %</b> preparado</span></div>${weakTxt}
      <button type="button" class="btn btn-primary pp-cta" data-action="pp-add" data-kind="examen_teorico">Añadir mi examen</button></section>`;
  }
  const k = PP_KIND[ex.kind] || PP_KIND.otro, big = ex.days_left === 0 ? 'Hoy' : ex.days_left === 1 ? 'Mañana' : ex.days_left;
  const fc = ex.forecast;
  let forecast;
  if(fc == null) forecast = 'Todavía no hay datos suficientes para prever tu resultado.';
  else if(fc >= 90) forecast = `A este ritmo llegarás al <b>${Math.round(fc)} %</b>. ¡Vas por buen camino!`;
  else forecast = `A este ritmo llegarás al <b>${Math.round(fc)} %</b>.` + (ex.needed_per_day > 0 ? ` Necesitas unas <b>${ex.needed_per_day} preguntas nuevas al día</b> para llegar al 90 %.` : '');
  return `<section class="pp-card pp-exam"><div class="pp-eyebrow">${esc(k.label)}${ex.title && ex.title !== 'Examen' && !String(ex.title).toLowerCase().startsWith(k.label.toLowerCase()) ? ' · ' + esc(ex.title) : ''}</div>
    <div class="pp-count"><b>${esc(String(big))}</b>${typeof big === 'number' ? `<span>${big === 1 ? 'día' : 'días'}</span>` : ''}</div>
    <p class="pp-date">${esc(ppDateLong(ex.date))}${ex.time ? ' · ' + esc(String(ex.time).slice(0, 5)) : ''}</p>
    <div class="pp-prep-row"><div class="pp-bar" role="progressbar" aria-valuenow="${Math.round(p.prep || 0)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(p.prep || 0)}%"></i></div><span><b>${Math.round(p.prep || 0)} %</b> preparado</span></div>
    <p class="pp-forecast">${forecast}</p>${weakTxt}</section>`;
}
function ppStreakCard(p){
  const s = p.streak, ic = shellIcon, pct = Math.min(100, Math.round(s.today_answered / s.goal * 100));
  const wk = (s.week || []).map((d, i) => `<span class="pp-wd ${d.state}" title="${esc(d.state === 'saver' ? 'Salvado por el comodín' : '')}"><i>${d.state === 'met' ? ic('check') : d.state === 'saver' ? ic('shield') : ''}</i><small>${PP_WD[i]}</small></span>`).join('');
  const goals = [10, 20, 30].map(g => `<button type="button" class="pp-chip ${s.goal === g ? 'on' : ''}" data-action="pp-goal" data-v="${g}" aria-pressed="${s.goal === g}">${g}</button>`).join('');
  return `<section class="pp-card pp-streak"><div class="pp-streak-top">
      <div class="pp-streak-n"><span class="pp-flame">${ic('flame')}</span><b>${s.current}</b><span>${s.current === 1 ? 'día de racha' : 'días de racha'}</span></div>
      <span class="pp-joker ${s.saver_available ? 'on' : ''}">${ic('shield')}${s.saver_available ? '1 comodín' : 'Comodín usado'}</span></div>
    <div class="pp-week" role="img" aria-label="Semana actual">${wk}</div>
    <div class="pp-today"><div class="pp-today-t"><span>Hoy</span><b>${s.today_met ? 'Objetivo cumplido' : s.today_answered + ' de ' + s.goal + ' preguntas'}</b></div>
      <div class="pp-bar ${s.today_met ? 'ok' : ''}"><i style="width:${s.today_met ? 100 : pct}%"></i></div></div>
    <div class="pp-goalrow"><span>Objetivo diario</span><div class="pp-chips" role="group" aria-label="Objetivo diario">${goals}<small>preguntas</small></div></div>
    <p class="pp-best">Mejor racha: <b>${ppPl(s.best, 'día', 'días')}</b></p></section>`;
}
function ppPlanCard(p){
  const plan = p.plan || [];
  if(!plan.length) return '';
  const done = plan.filter(t => t.done).length;
  return `<section class="pp-card"><h2>Plan de esta semana <small>${done} de ${plan.length}</small></h2><ul class="pp-plan">${plan.map(t => {
    const pc = Math.min(100, Math.round(t.cur / t.target * 100));
    return `<li><button type="button" class="pp-task ${t.done ? 'done' : ''}" data-action="pp-task" data-kind="${esc(t.kind)}" data-rule="${t.rule == null ? '' : t.rule}">
      <span class="pp-task-c">${t.done ? shellIcon('check') : ''}</span>
      <span class="pp-task-t"><strong>${esc(ppTaskTitle(t))}</strong>${t.done ? '<small>Hecho</small>' : `<span class="pp-bar thin"><i style="width:${pc}%"></i></span><small>${t.cur} de ${t.target}</small>`}</span>
      <span class="pp-task-go" aria-hidden="true">${t.done ? '' : '›'}</span></button></li>`; }).join('')}</ul></section>`;
}
function ppCalendar(){
  const s = ppS(), key = s.month || ppMonthKey(new Date()), first = ppParse(key), md = s.months[key];
  const today = todayKeyISO(), daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7, by = {}, evs = {};
  ((md && md.days) || []).forEach(d => { by[String(d.day).slice(0, 10)] = d; });
  ((md && md.events) || []).forEach(e => { const k = String(e.date).slice(0, 10); (evs[k] = evs[k] || []).push(e); });
  let cells = PP_WD.map(l => `<div class="pp-cwd">${l}</div>`).join('') + '<div class="pp-cell empty"></div>'.repeat(lead);
  for(let d = 1; d <= daysIn; d++){
    const iso = key.slice(0, 8) + String(d).padStart(2, '0'), x = by[iso], n = x ? x.answered : 0;
    const lv = n > 30 ? 3 : n > 10 ? 2 : n > 0 ? 1 : 0, e = evs[iso] || [];
    const dots = e.slice(0, 3).map(v => `<i class="dot ${(PP_KIND[v.kind] || PP_KIND.otro).dot}"></i>`).join('');
    cells += `<button type="button" class="pp-cell lv${lv} ${iso === today ? 'today' : ''} ${x && x.saver ? 'saver' : ''}" data-action="pp-day" data-day="${iso}" aria-label="${esc(ppDateLong(iso))}: ${n} preguntas${e.length ? ', ' + e.length + ' evento(s)' : ''}"><b>${d}</b><span class="dots">${dots}</span></button>`;
  }
  const mname = PP_MONTHS[first.getMonth()] + ' ' + first.getFullYear();
  return `<section class="pp-card pp-cal"><div class="pp-cal-h"><button type="button" class="pp-nav" data-action="pp-month" data-dm="-1" aria-label="Mes anterior">‹</button>
      <h2>${esc(mname)}</h2><button type="button" class="pp-nav" data-action="pp-month" data-dm="1" aria-label="Mes siguiente">›</button></div>
    <div class="pp-grid ${md ? '' : 'loading'}" id="pp-grid">${cells}</div>
    <div class="pp-legend"><span>Menos</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><span>Más</span></div></section>`;
}
function ppEvents(p){
  const list = p.events || [], ic = shellIcon;
  const rows = list.map(e => { const k = PP_KIND[e.kind] || PP_KIND.otro;
    return `<li class="pp-ev"><span class="pp-ev-ic ${k.dot}">${ic(k.icon)}</span>
      <span class="pp-ev-t"><strong>${esc(e.title)}</strong><small>${esc(ppDateShort(e.date))}${e.time ? ' · ' + esc(String(e.time).slice(0, 5)) : ''} · ${esc(ppDaysLeftText(e.days_left))}</small></span>
      <span class="pp-ev-a"><button type="button" data-action="pp-cal" data-id="${esc(e.id)}" aria-label="Añadir a mi calendario">${ic('calendar')}</button><button type="button" data-action="pp-edit" data-id="${esc(e.id)}" aria-label="Editar">${ic('pencil')}</button><button type="button" data-action="pp-del" data-id="${esc(e.id)}" aria-label="Borrar">${ic('trash')}</button></span></li>`; }).join('');
  return `<section class="pp-card"><h2>Próximos eventos <button type="button" class="btn btn-secondary pp-add" data-action="pp-add" data-kind="otro">Añadir evento</button></h2>
    ${rows ? `<ul class="pp-evl">${rows}</ul>` : '<p class="pp-empty">No tienes eventos próximos. Añade exámenes, pruebas físicas o reuniones para tenerlos a mano.</p>'}</section>`;
}
function ppHeat(){
  const h = ppS().heat; if(!h) return '';
  const map = {}; h.forEach(x => { map[String(x.day).slice(0, 10)] = x.answered; });
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const start = new Date(t); start.setDate(t.getDate() - ((t.getDay() + 6) % 7) - 52 * 7);
  let cells = '';
  for(let w = 0; w < 53; w++) for(let d = 0; d < 7; d++){
    const day = new Date(start); day.setDate(start.getDate() + w * 7 + d);
    if(day > t){ cells += '<i class="x"></i>'; continue; }
    const iso = todayKeyISO(day), n = map[iso] || 0, lv = n > 30 ? 3 : n > 10 ? 2 : n > 0 ? 1 : 0;
    cells += `<i class="lv${lv}" title="${esc(ppDateShort(iso))}: ${n} preguntas"></i>`;
  }
  return `<section class="pp-card pp-heat"><h2>El último año</h2><div class="pp-heat-g" aria-hidden="true">${cells}</div><p class="pp-foot">Cada cuadro es un día; cuanto más amarillo, más preguntas.</p></section>`;
}

function prepView(){
  const p = STATE.prep, back = '<button class="backbtn" data-action="home">&larr; Inicio</button>';
  const head = `<header class="pp-head"><h1>Mi preparación</h1><p>Tu examen, tu racha y tu plan de la semana.</p></header>`;
  if(!p){
    if(STATE.prepErr) return back + head + `<div class="pp-card pp-msg"><strong>No se pudo cargar tu preparación</strong><p>Comprueba tu conexión e inténtalo de nuevo.</p><button class="btn btn-primary" data-action="pp-reload">Reintentar</button></div>`;
    const b = (h) => `<span class="skel" style="display:block;height:${h}px;border-radius:14px;"></span>`;
    return back + head + `<div class="pp"><div class="pp-col"><div class="pp-card">${b(18)}<div style="height:12px"></div>${b(70)}<div style="height:12px"></div>${b(12)}</div><div class="pp-card">${b(90)}</div><div class="pp-card">${b(120)}</div></div></div>`;
  }
  return back + head + `<div class="pp"><div class="pp-col">${ppExamCard(p)}${ppStreakCard(p)}${ppPlanCard(p)}</div><div class="pp-col">${ppCalendar()}${ppEvents(p)}${ppHeat()}</div></div>`;
}

/* ---------- hojas inferiores ---------- */
function ppClose(){ const s = document.getElementById('pp-sheet'); if(s) s.remove(); document.removeEventListener('keydown', ppKey); }
function ppKey(e){ if(e.key === 'Escape') ppClose(); }
function ppSheet(label, html, onClick){
  ppClose();
  const back = document.createElement('div'); back.id = 'pp-sheet'; back.className = 'gm-sheet-back';
  back.innerHTML = `<div class="gm-sheet pp-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><span class="gm-grab" aria-hidden="true"></span>${html}</div>`;
  back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('[data-pp-close]')){ ppClose(); return; } if(onClick) onClick(e); });
  document.addEventListener('keydown', ppKey); document.body.appendChild(back);
  const f = back.querySelector('input,select,textarea,button'); if(f && f.tagName !== 'BUTTON') f.focus();
  return back;
}
function ppFindEvent(id){ const p = STATE.prep; const all = ((p && p.events) || []).concat(...Object.values(ppS().months).map(m => (m && m.events) || [])); return all.find(e => e.id === id) || null; }

function ppEventSheet(ev, kind, date){
  const e = ev || { kind: kind || 'otro', title: '', date: date || todayKeyISO(), time: '', note: '' };
  const opts = Object.keys(PP_KIND).map(k => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${PP_KIND[k].label}</option>`).join('');
  const b = ppSheet(ev ? 'Editar evento' : 'Añadir evento', `<h3>${ev ? 'Editar evento' : 'Añadir evento'}</h3>
    <label class="pp-f"><span>Tipo</span><select id="pp-k">${opts}</select></label>
    <label class="pp-f"><span>Título</span><input id="pp-t" type="text" maxlength="80" value="${esc(e.title || '')}" placeholder="Ej.: Examen teórico CTA"></label>
    <div class="pp-f2"><label class="pp-f"><span>Fecha</span><input id="pp-d" type="date" value="${esc(String(e.date).slice(0, 10))}"></label>
      <label class="pp-f"><span>Hora (opcional)</span><input id="pp-h" type="time" value="${esc(e.time ? String(e.time).slice(0, 5) : '')}"></label></div>
    <label class="pp-f"><span>Nota (opcional)</span><textarea id="pp-n" rows="2" maxlength="300">${esc(e.note || '')}</textarea></label>
    <p class="pp-err" id="pp-e" role="alert" hidden></p>
    <div class="pp-sa"><button type="button" class="btn btn-primary" data-pp="save">Guardar</button><button type="button" class="btn btn-secondary" data-pp-close>Cancelar</button></div>`,
    (x) => { if(x.target.closest('[data-pp="save"]')) ppSaveEvent(ev ? ev.id : null); });
  return b;
}
async function ppSaveEvent(id){
  const g = (i) => (document.getElementById(i) || {}).value || '', er = document.getElementById('pp-e');
  const kind = g('pp-k'), date = g('pp-d'), time = g('pp-h'), note = g('pp-n').trim();
  let title = g('pp-t').trim();
  const fail = (m) => { if(er){ er.textContent = m; er.hidden = false; } };
  if(!date) return fail('Elige una fecha.');
  if(!title) title = (PP_KIND[kind] || PP_KIND.otro).label;
  const row = { kind, title, event_date: date, event_time: time || null, note: note || null };
  try{
    const r = id ? await supabaseClient.from('user_events').update(row).eq('id', id) : await supabaseClient.from('user_events').insert(Object.assign({ user_id: CURRENT_USER_ID }, row));
    if(r.error) throw r.error;
    ppClose(); STATE.toast = id ? 'Evento actualizado.' : 'Evento guardado.';
    await loadPrep(); await ppLoadMonth(ppS().month || ppMonthKey(new Date()), true); render();
  }catch(e){
    const m = String((e && e.message) || '');
    fail(/limite_eventos/.test(m) ? 'Has llegado al límite de 50 eventos. Borra alguno para añadir otro.' : /fecha_no_valida/.test(m) ? 'Esa fecha no es válida.' : 'No se pudo guardar. Inténtalo de nuevo.');
  }
}
async function ppDeleteEvent(id){
  const ev = ppFindEvent(id);
  const ok = await appConfirm({ title: '¿Borrar este evento?', message: ev ? `Se borrará «${ev.title}».` : 'Se borrará el evento.', confirmText: 'Borrar', cancelText: 'Cancelar', icon: 'trash' });
  if(!ok) return;
  try{
    const r = await supabaseClient.from('user_events').delete().eq('id', id); if(r.error) throw r.error;
    STATE.toast = 'Evento borrado.'; await loadPrep(); await ppLoadMonth(ppS().month || ppMonthKey(new Date()), true); render();
  }catch(e){ STATE.toast = 'No se pudo borrar. Inténtalo de nuevo.'; render(); }
}

/* Calendario: archivo .ics y enlace a Google Calendar */
function ppIcsText(v){ return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function ppStamp(iso, time, addDay){
  const d = ppParse(iso); if(addDay) d.setDate(d.getDate() + addDay);
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return time ? ymd + 'T' + String(time).slice(0, 5).replace(':', '') + '00' : ymd;
}
function ppCalMenu(id){
  const e = ppFindEvent(id); if(!e) return;
  const t = e.time ? String(e.time).slice(0, 5) : '';
  const endT = t ? String(Math.min(23, parseInt(t.slice(0, 2), 10) + 1)).padStart(2, '0') + t.slice(2) : '';
  const dates = t ? ppStamp(e.date, t) + '/' + ppStamp(e.date, endT) : ppStamp(e.date) + '/' + ppStamp(e.date, null, 1);
  const g = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.title) + '&dates=' + dates + (e.note ? '&details=' + encodeURIComponent(e.note) : '');
  ppSheet('Añadir a mi calendario', `<h3>Añadir a mi calendario</h3><p class="gm-sheet-p">${esc(e.title)} · ${esc(ppDateShort(e.date))}${t ? ' · ' + esc(t) : ''}</p>
    <div class="pp-sa"><a class="btn btn-primary" href="${esc(g)}" target="_blank" rel="noopener">Google Calendar</a>
    <button type="button" class="btn btn-secondary" data-pp="ics">Descargar archivo .ics (Apple, Outlook…)</button>
    <button type="button" class="btn btn-secondary" data-pp-close>Cerrar</button></div>`,
    (x) => { if(x.target.closest('[data-pp="ics"]')) ppDownloadIcs(e); });
}
function ppDownloadIcs(e){
  const t = e.time ? String(e.time).slice(0, 5) : '';
  const endT = t ? String(Math.min(23, parseInt(t.slice(0, 2), 10) + 1)).padStart(2, '0') + t.slice(2) : '';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WEREF//Mi preparacion//ES', 'BEGIN:VEVENT', 'UID:' + e.id + '@we-ref.com', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'];
  if(t){ lines.push('DTSTART:' + ppStamp(e.date, t), 'DTEND:' + ppStamp(e.date, endT)); }
  else { lines.push('DTSTART;VALUE=DATE:' + ppStamp(e.date), 'DTEND;VALUE=DATE:' + ppStamp(e.date, null, 1)); }
  lines.push('SUMMARY:' + ppIcsText(e.title)); if(e.note) lines.push('DESCRIPTION:' + ppIcsText(e.note));
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'weref-evento.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* Hoja de un día */
async function ppDaySheet(iso){
  const b = ppSheet(ppDateLong(iso), `<h3>${esc(ppDateLong(iso))}</h3><div class="pp-dl"><span class="skel" style="display:block;height:16px;width:60%;border-radius:8px;"></span></div>`);
  try{
    const { data, error } = await supabaseClient.rpc('get_prep_day', { p_day: iso }); if(error) throw error;
    const d = (typeof data === 'string') ? JSON.parse(data) : data;
    const status = d.met ? '<span class="pp-pill ok">Objetivo cumplido</span>' : d.saver ? '<span class="pp-pill saver">Día salvado por el comodín</span>' : (d.answered > 0 ? '<span class="pp-pill">No llegaste al objetivo</span>' : '');
    const tests = (d.tests || []).map(t => `<li><span>${esc(PP_MODE[t.mode] || 'Test')}</span><b>${t.score}/${t.total} · ${t.pct} %</b></li>`).join('');
    const evs = (d.events || []).map(e => { const k = PP_KIND[e.kind] || PP_KIND.otro; return `<li><span class="pp-ev-ic ${k.dot}">${shellIcon(k.icon)}</span><span>${esc(e.title)}${e.time ? ' · ' + esc(String(e.time).slice(0, 5)) : ''}</span></li>`; }).join('');
    const box = b.querySelector('.pp-dl'); if(!box) return;
    box.outerHTML = `<div class="pp-dsum"><b>${d.answered}</b><span>${d.answered === 1 ? 'pregunta' : 'preguntas'} ese día</span>${status}</div>
      ${tests ? `<h4>Tests</h4><ul class="pp-dlist">${tests}</ul>` : (d.answered ? '' : '<p class="gm-sheet-p">No estudiaste este día.</p>')}
      ${evs ? `<h4>Eventos</h4><ul class="pp-dlist ev">${evs}</ul>` : ''}
      <div class="pp-sa"><button type="button" class="btn btn-primary" data-pp="add">Añadir evento</button><button type="button" class="btn btn-secondary" data-pp-close>Cerrar</button></div>`;
    b.addEventListener('click', (x) => { if(x.target.closest('[data-pp="add"]')){ ppEventSheet(null, 'otro', iso); } });
  }catch(e){ const box = b.querySelector('.pp-dl'); if(box) box.innerHTML = '<p class="gm-sheet-p">No se pudo cargar este día.</p>'; }
}

/* ---------- acciones ---------- */
function ppTaskGo(kind, rule){
  const go = (data) => onAction({ currentTarget: { dataset: data } });
  if(kind === 'corona' || kind === 'regla') go({ action: 'start-quiz', law: String(rule), mode: 'study25' });
  else if(kind === 'repaso') go({ action: 'open-law', law: 'failed' });
  else if(kind === 'simulacro'){ try{ Object.assign(STATE.trainCfg, { count: 25, timerMode: 'none', feedbackMode: 'exam', scopeOverride: null }); }catch(e){} go({ action: 'train-config' }); }
  else go({ action: 'start-daily-goal', count: '10' });
}
async function ppAction(action, el){
  const s = ppS();
  if(action === 'pp-reload'){ STATE.prepErr = false; render(); loadPrep(); }
  else if(action === 'pp-add') ppEventSheet(null, el.dataset.kind);
  else if(action === 'pp-edit'){ const e = ppFindEvent(el.dataset.id); if(e) ppEventSheet(e); }
  else if(action === 'pp-del') ppDeleteEvent(el.dataset.id);
  else if(action === 'pp-cal') ppCalMenu(el.dataset.id);
  else if(action === 'pp-day') ppDaySheet(el.dataset.day);
  else if(action === 'pp-task') ppTaskGo(el.dataset.kind, parseInt(el.dataset.rule, 10) || null);
  else if(action === 'pp-month'){ const d = ppParse(s.month || ppMonthKey(new Date())); d.setMonth(d.getMonth() + (parseInt(el.dataset.dm, 10) || 0)); await ppLoadMonth(ppMonthKey(d)); }
  else if(action === 'pp-goal'){
    const v = parseInt(el.dataset.v, 10);
    try{ const r = await supabaseClient.rpc('set_daily_goal', { p_goal: v }); if(r.error) throw r.error; STATE.toast = 'Objetivo diario: ' + v + ' preguntas.'; await loadPrep(); }
    catch(e){ STATE.toast = 'No se pudo cambiar el objetivo.'; render(); }
  }
}
/* Deslizar el calendario para cambiar de mes */
let PP_TOUCH = null;
document.addEventListener('touchstart', (e) => { const g = e.target.closest && e.target.closest('#pp-grid'); PP_TOUCH = g ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if(!PP_TOUCH) return; const t = e.changedTouches[0], dx = t.clientX - PP_TOUCH.x, dy = t.clientY - PP_TOUCH.y; PP_TOUCH = null;
  if(Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5){ const d = ppParse(ppS().month || ppMonthKey(new Date())); d.setMonth(d.getMonth() + (dx < 0 ? 1 : -1)); ppLoadMonth(ppMonthKey(d)); }
}, { passive: true });
