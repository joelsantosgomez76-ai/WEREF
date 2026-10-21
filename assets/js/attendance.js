/* ---------------- CTA BAGES · Asistencia a las clases presenciales ----------------
   Panel de Formación → pestaña "Asistencia" (el administrador crea la clase y marca a los presentes,
   a mano o con un QR que cambia solo) y, para el alumno, su asistencia dentro de "Mi rendimiento".
   Solo se guardan los PRESENTES: quien no tiene fila en committee_attendance, no ha venido.
   Toda la seguridad vive en Supabase (supabase/committee-attendance.sql).
   Depende de committee.js (COMMITTEE, cm*) y de app.js (esc, appConfirm, accuracyBadge). */

COMMITTEE.att = {
  sessions: null,        // admin: committee_sessions
  set: new Set(),        // 'sessionId|userId' de cada presente
  missing: false,        // falta ejecutar el SQL
  threshold: 75,         // % mínimo de asistencia
  season: null,
  open: null,            // id de la clase abierta para pasar lista
  rollQ: '',
  rollSortKey: 'surname',
  rollSortDir: 'asc',
  rollFilter: 'all',     // all / here / absent
  rollCat: 'all',
  info: new Map(),       // 'sessionId|userId' -> {method, at}
  newDate: '',
  sortKey: 'surname',
  sortDir: 'asc',
  filters: { last: '', first: '', cat: 'all', low: false },
  mySessions: null,      // alumno: sus clases
  mySet: new Set()
};

function att(){ return COMMITTEE.att; }

/* ---------- fechas (class_date es 'YYYY-MM-DD', se trata como texto para no depender de la zona horaria) ---------- */
function attToday(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function attFmtDate(d){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; }
function attTitle(s){ return 'Classe ' + attFmtDate(s.class_date); }
function attSeasonOf(s){ return cmSeasonOfMonth(String(s.class_date).slice(0, 7)); }
function attAddedDay(m){
  if(!m.added_at) return '0000-00-00';
  try{ return new Date(m.added_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); }catch(e){ return String(m.added_at).slice(0, 10); }
}
function attSeasons(list){
  return Array.from(new Set((list || []).map(attSeasonOf).concat([cmCurrentSeason()]))).sort().reverse();
}
function attCurSeason(){
  const A = att();
  const seasons = attSeasons(A.sessions);
  return seasons.includes(A.season) ? A.season : cmCurrentSeason();
}
function attErr(err){
  const m = String((err && (err.message || err.code)) || err || '');
  if(/not_today/.test(m)) return 'El QR solo se puede abrir el mismo día de la clase.';
  if(/invalid_code/.test(m)) return 'El código ha caducado. Escanea de nuevo el QR que se ve en la pantalla.';
  if(/23505|duplicate/i.test(m)) return 'Ya existe una clase en esa fecha.';
  if(/committee_sessions|committee_attendance|committee_checkin|PGRST20[25]|42P01|42883|schema cache/i.test(m)) return 'Falta ejecutar el SQL de asistencia (committee-attendance.sql) en Supabase.';
  return cmErrText(err);
}

/* ---------- carga ---------- */
/* Lectura paginada: Supabase devuelve como máximo 1000 filas por consulta. */
async function attFetchAll(table, cols){
  const out = [];
  for(let from = 0; ; from += 1000){
    const r = await supabaseClient.from(table).select(cols).range(from, from + 999);
    if(r.error) return { error: r.error, data: null };
    out.push.apply(out, r.data || []);
    if(!r.data || r.data.length < 1000) break;
  }
  return { error: null, data: out };
}
async function cmLoadAttendance(){
  const A = att();
  try{
    const [s, r, cfg] = await Promise.all([
      supabaseClient.from('committee_sessions').select('*').order('class_date', { ascending: false }),
      attFetchAll('committee_attendance', 'session_id,user_id,method,marked_at'),
      supabaseClient.from('committee_settings').select('attendance_threshold').eq('id', 1).maybeSingle()
    ]);
    if(s.error || r.error){ A.sessions = []; A.set = new Set(); A.missing = true; return; }
    A.missing = false;
    A.sessions = s.data || [];
    A.set = new Set((r.data || []).map(x => x.session_id + '|' + x.user_id));
    A.info = new Map((r.data || []).map(x => [x.session_id + '|' + x.user_id, { method: x.method, at: x.marked_at }]));
    if(cfg && !cfg.error && cfg.data && Number.isFinite(cfg.data.attendance_threshold)) A.threshold = cfg.data.attendance_threshold;
  }catch(e){ A.sessions = []; A.set = new Set(); A.missing = true; }
}
async function cmLoadMyAttendance(){
  const A = att();
  try{
    const [s, r] = await Promise.all([
      supabaseClient.from('committee_sessions').select('*').order('class_date', { ascending: false }),
      supabaseClient.from('committee_attendance').select('session_id,user_id')
    ]);
    if(s.error || r.error){ A.mySessions = []; A.mySet = new Set(); return; }
    A.mySessions = s.data || [];
    A.mySet = new Set((r.data || []).map(x => x.session_id));
    const cfg = await supabaseClient.from('committee_settings').select('attendance_threshold').eq('id', 1).maybeSingle();
    if(cfg && !cfg.error && cfg.data && Number.isFinite(cfg.data.attendance_threshold)) A.threshold = cfg.data.attendance_threshold;
  }catch(e){ A.mySessions = []; A.mySet = new Set(); }
}

/* ---------- cálculos ---------- */
function attSeasonSessions(season){
  return (att().sessions || []).filter(s => attSeasonOf(s) === season).slice().sort((a, b) => a.class_date.localeCompare(b.class_date));
}
/* Una clase cuenta para quien ya era miembro ese día (o ya consta como presente). */
function attMemberStats(m, season){
  const A = att();
  const start = attAddedDay(m);
  const list = attSeasonSessions(season).filter(s => s.class_date >= start || A.set.has(s.id + '|' + m.user_id));
  const dots = list.map(s => ({ s, on: A.set.has(s.id + '|' + m.user_id) }));
  const got = dots.filter(d => d.on).length;
  return { total: list.length, got, pct: list.length ? Math.round(got / list.length * 100) : null, dots };
}
function attSessionCount(s){
  const A = att();
  const members = COMMITTEE.members || [];
  const elig = members.filter(m => s.class_date >= attAddedDay(m) || A.set.has(s.id + '|' + m.user_id));
  const here = elig.filter(m => A.set.has(s.id + '|' + m.user_id)).length;
  return { here, total: elig.length, pct: elig.length ? Math.round(here / elig.length * 100) : 0 };
}
function attRows(){
  const A = att();
  const season = attCurSeason();
  const f = A.filters;
  const has = (v, q) => { const t = cmPlain(q).trim(); return !t || cmPlain(v).includes(t); };
  const all = (COMMITTEE.members || []).map(m => ({ m, p: cmNameParts(m), s: attMemberStats(m, season) }));
  const list = all.filter(e => has(e.p.last, f.last) && has(e.p.first, f.first)
    && (f.cat === 'all' || (f.cat === 'none' ? !e.m.category_id : e.m.category_id === f.cat))
    && (!f.low || (e.s.pct !== null && e.s.pct < A.threshold)));
  const key = A.sortKey, dir = A.sortDir;
  const val = (e) => {
    if(key === 'surname') return (e.p.last || e.p.first) ? cmPlain(e.p.last || e.p.first) : null;
    if(key === 'name') return (e.p.first || e.p.last) ? cmPlain(e.p.first || e.p.last) : null;
    if(key === 'cat'){ const c = cmCatById(e.m.category_id); return c ? cmPlain(c.name) : null; }
    if(key === 'got') return e.s.total ? e.s.got : null;
    if(key === 'pct') return e.s.pct;
    return null;
  };
  list.sort((a, b) => {
    const va = val(a), vb = val(b);
    const na = va === null || va === '', nb = vb === null || vb === '';
    if(na !== nb) return na ? 1 : -1;
    let r = 0;
    if(!na) r = (typeof va === 'number' && typeof vb === 'number') ? va - vb : cmCollate(va, vb);
    if(r !== 0) return dir === 'desc' ? -r : r;
    return cmCollate(a.p.last || a.p.first || a.m.email, b.p.last || b.p.first || b.m.email) || cmCollate(a.p.first, b.p.first);
  });
  return { list, all, season };
}

/* ---------- pestaña Asistencia (administrador) ---------- */
function attPctBadge(pct){
  if(pct === null) return '<span class="mb-none">—</span>';
  const low = pct < att().threshold;
  return `<span class="acc-badge" style="background:${low ? '#FDECEC' : '#EAF7EF'}; color:${low ? 'var(--red)' : 'var(--green-ok)'};">${pct}%</span>`;
}
function attBodyHtml(){
  const { list, all } = attRows();
  if(!all.length) return `<tr><td colspan="5" class="mb-empty">Todavía no hay árbitros.</td></tr>`;
  if(!list.length) return `<tr><td colspan="5" class="mb-empty">Nadie coincide con esos filtros.</td></tr>`;
  return list.map(e => {
    const cat = cmCatById(e.m.category_id);
    const low = e.s.pct !== null && e.s.pct < att().threshold;
    return `<tr class="at-trow ${low ? 'low' : ''}" data-uid="${e.m.user_id}" title="Ver en qué fechas vino" tabindex="0">
      <td class="at-c-last"><strong>${esc(e.p.last || e.p.first || e.m.username || e.m.email || '—')}</strong></td>
      <td>${e.p.last ? esc(e.p.first || '—') : '<span class="mb-none">—</span>'}</td>
      <td>${cat ? `<span class="rkt-cat" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>` : '<span class="mb-none">—</span>'}</td>
      <td class="rkt-c-num" data-label="Asistidas">${e.s.total ? e.s.got + '/' + e.s.total : '<span class="mb-none">—</span>'}</td>
      <td data-label="Asistencia">${attPctBadge(e.s.pct)}</td>
    </tr>`;
  }).join('');
}
function attCountText(){
  const { list, all } = attRows();
  return list.length === all.length ? `${all.length} ${all.length === 1 ? 'árbitro' : 'árbitros'}` : `${list.length} de ${all.length} árbitros`;
}
function attClassRow(s){
  const ic = (n) => shellIcon(n);
  const c = attSessionCount(s);
  const mo = CM_MONTHS[parseInt(s.class_date.slice(5, 7), 10) - 1] || '';
  const today = s.class_date === attToday();
  return `<div class="at-class ${today ? 'today' : ''}">
    <div class="at-date"><b>${esc(s.class_date.slice(8, 10))}</b><span>${esc(mo.slice(0, 3))}</span></div>
    <div class="at-main">
      <strong>${esc(attTitle(s))}${today ? ' <em class="at-now">Hoy</em>' : ''}</strong>
      <small>${c.here} de ${c.total} ${c.total === 1 ? 'árbitro' : 'árbitros'} presentes</small>
      <div class="at-bar"><i style="width:${c.pct}%"></i></div>
    </div>
    <div class="at-actions">
      <button class="btn btn-primary" data-action="committee-att-open" data-sid="${s.id}">${ic('check')} Pasar lista</button>
      ${today ? `<button class="btn btn-yellow" data-action="committee-att-qr" data-sid="${s.id}">${ic('qr')} QR</button>` : ''}
      <button class="tx-icon danger" data-action="committee-att-delete" data-sid="${s.id}" title="Eliminar clase" aria-label="Eliminar clase">${ic('trash')}</button>
    </div>
  </div>`;
}
function attTab(){
  const ic = (n) => shellIcon(n);
  const A = att();
  if(A.sessions === null) return `<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  if(A.missing) return `<div class="tc-card"><div class="st-note">Para llevar la asistencia falta ejecutar una vez el SQL <b>committee-attendance.sql</b> en Supabase (SQL Editor).</div></div>`;
  if(A.open) return attRollView();
  const season = attCurSeason();
  const seasons = attSeasons(A.sessions);
  const sess = attSeasonSessions(season);
  const rows = attRows();
  const withData = rows.all.filter(e => e.s.total);
  const sumGot = withData.reduce((s, e) => s + e.s.got, 0), sumTot = withData.reduce((s, e) => s + e.s.total, 0);
  const avg = sumTot ? Math.round(sumGot / sumTot * 100) : null;
  const lowN = withData.filter(e => e.s.pct < A.threshold).length;
  const f = A.filters;
  const key = A.sortKey, dir = A.sortDir;
  const th = (k, label) => `<th><button class="mb-sortbtn ${key === k ? 'on' : ''}" data-action="committee-att-sort" data-key="${k}">${label}<span class="mb-arrow">${key === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const catOpts = `<option value="all" ${f.cat === 'all' ? 'selected' : ''}>Todas</option><option value="none" ${f.cat === 'none' ? 'selected' : ''}>Sin categoría</option>` +
    (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const list = A.sessions.filter(s => attSeasonOf(s) === season);
  return `
  <div class="tx-toolbar">
    <div class="rk-period">
      <label for="at-season">Temporada</label>
      <select id="at-season" data-cm-field="att.season" data-cm-rerender>${seasons.map(s => `<option value="${esc(s)}" ${s === season ? 'selected' : ''}>${cmSeasonLabel(s)}</option>`).join('')}</select>
    </div>
  </div>
  <div class="home-kpis at-kpis">
    <div class="kpi"><div class="kpi-top">${ic('calendar')} Clases</div><div class="kpi-val">${sess.length}</div><div class="kpi-sub">en la temporada ${cmSeasonLabel(season)}</div></div>
    <div class="kpi"><div class="kpi-top">${ic('users')} Asistencia media</div><div class="kpi-val">${avg !== null ? avg + '<small>%</small>' : '—'}</div><div class="kpi-sub">de todos los árbitros</div></div>
    <div class="kpi"><div class="kpi-top">${ic('flag')} Bajo el mínimo</div><div class="kpi-val" ${lowN ? 'style="color:var(--red);"' : ''}>${lowN}</div><div class="kpi-sub">por debajo del ${A.threshold}%</div></div>
    <div class="kpi"><div class="kpi-top">${ic('target')} Mínimo exigido</div><div class="kpi-val">${A.threshold}<small>%</small></div><div class="kpi-sub">se cambia en Configuración</div></div>
  </div>
  <div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('calendar')}</span><div><h3>Clases</h3><small>Crea la clase y pasa lista. Quien no esté marcado cuenta como que no ha venido.</small></div></div>
    <div class="at-new">
      <label for="at-new-date" style="margin:0;">Fecha de la clase</label>
      <input type="date" id="at-new-date" data-cm-field="att.newDate" value="${esc(A.newDate || attToday())}">
      <button class="btn btn-primary" data-action="committee-att-create">${ic('plus')} Crear clase</button>
    </div>
    ${list.length ? `<div class="at-classes">${list.map(attClassRow).join('')}</div>` : `<div class="ac-empty" style="padding:22px 14px;">${ic('calendar')}<strong>Todavía no hay clases en esta temporada</strong><span>Crea la primera con la fecha del día.</span></div>`}
  </div>
  <div class="tc-card mb-listcard" id="at-table">
    <div class="tc-card-head"><span class="tc-step">${ic('chart')}</span><div><h3>Seguimiento</h3><small id="at-count">${attCountText()}</small></div>
      <div class="cm-actions">
        <button class="btn btn-ghost ${f.low ? 'on' : ''}" data-action="committee-att-low">${ic('flag')} Bajo el mínimo${lowN ? ' (' + lowN + ')' : ''}</button>
        <button class="btn btn-ghost" data-action="committee-att-clear-filters">${ic('trash')} Limpiar filtros</button>
        <button class="btn btn-ghost" data-action="committee-att-export">${ic('download')} Exportar</button>
      </div>
    </div>
    <div class="st-note" style="margin-bottom:12px;">Pulsa sobre un árbitro para ver en qué fechas vino: en verde los días que vino y en rojo los días que no.</div>
    <div class="mb-tablewrap">
      <table class="at-table">
        <thead>
          <tr class="rkt-th">${th('surname', 'Apellidos')}${th('name', 'Nombre')}${th('cat', 'Categoría')}${th('got', 'Asistidas')}${th('pct', '%')}</tr>
          <tr class="rkt-filters">
            <th><input class="mb-f" data-col="last" type="text" value="${esc(f.last)}" placeholder="Apellidos" aria-label="Filtrar por apellidos" autocomplete="off"></th>
            <th><input class="mb-f" data-col="first" type="text" value="${esc(f.first)}" placeholder="Nombre" aria-label="Filtrar por nombre" autocomplete="off"></th>
            <th><select class="mb-f" data-col="cat" aria-label="Filtrar por categoría">${catOpts}</select></th>
            <th></th><th></th>
          </tr>
        </thead>
        <tbody id="at-body">${attBodyHtml()}</tbody>
      </table>
    </div>
  </div>`;
}

/* ---------- calendario de asistencia de un árbitro (al pulsar su fila en Seguimiento) ---------- */
let ATT_CAL = null;
function attCalBounds(season){
  const y = parseInt(season, 10);
  return { min: y * 12 + 6, max: (y + 1) * 12 + 5 };       // julio … junio
}
function attCalBody(){
  const c = ATT_CAL;
  const m = (COMMITTEE.members || []).find(x => x.user_id === c.uid);
  if(!m) return '';
  const ic = (n) => shellIcon(n);
  const st = attMemberStats(m, c.season);
  const here = {}; st.dots.forEach(d => { here[d.s.class_date] = d.on; });
  const other = {}; attSeasonSessions(c.season).forEach(s => { if(!(s.class_date in here)) other[s.class_date] = true; });
  const b = attCalBounds(c.season);
  const y = Math.floor(c.idx / 12), mo = c.idx % 12;
  const first = new Date(y, mo, 1);
  const start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  const todayIso = attToday();
  let cells = '';
  for(let i = 0; i < 42; i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const p = n => String(n).padStart(2, '0');
    const iso = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    if(i >= 35 && d.getMonth() !== mo) break;
    const cls = ['ac-cal-day'];
    let title = '';
    if(d.getMonth() !== mo) cls.push('out');
    else if(iso in here){ cls.push(here[iso] ? 'yes' : 'no'); title = attFmtDate(iso) + ' · ' + (here[iso] ? 'Vino' : 'No vino'); }
    else if(other[iso]){ cls.push('other'); title = attFmtDate(iso) + ' · Clase anterior a su alta'; }
    if(iso === todayIso) cls.push('today');
    cells += `<div class="${cls.join(' ')}" ${title ? `title="${esc(title)}"` : ''}>${d.getDate()}</div>`;
  }
  const cat = cmCatById(m.category_id);
  return `
    <button type="button" class="tx-icon ac-cal-x" data-cal="close" aria-label="Cerrar">✕</button>
    <div class="ac-cal-head">
      <h3>${esc(cmSurnameName(m))}</h3>
      <div class="ac-cal-meta">
        ${cat ? `<span class="rkt-cat" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>` : ''}
        <span>Temporada ${cmSeasonLabel(c.season)}</span>
        <span>·</span>
        ${st.total ? `<span><b style="color:var(--ink);">${st.got} de ${st.total}</b> clases</span>${attPctBadge(st.pct)}` : '<span>Todavía no hay clases</span>'}
      </div>
    </div>
    <div class="ac-cal-nav">
      <button type="button" data-cal="prev" aria-label="Mes anterior" ${c.idx <= b.min ? 'disabled' : ''}>‹</button>
      <b>${DB_MONTHS[mo]} ${y}</b>
      <button type="button" data-cal="next" aria-label="Mes siguiente" ${c.idx >= b.max ? 'disabled' : ''}>›</button>
    </div>
    <div class="ac-cal-dow"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div class="ac-cal-grid">${cells}</div>
    <div class="ac-cal-legend"><span><i></i>Vino</span><span><i class="no"></i>No vino</span></div>`;
}
function attCloseCal(){
  const ov = document.getElementById('att-cal-ov'); if(ov) ov.remove();
  if(ATT_CAL){ document.removeEventListener('keydown', ATT_CAL.onKey, true); ATT_CAL = null; }
}
function attOpenMemberCal(uid){
  const A = att();
  attCloseCal();
  const season = attCurSeason();
  const sess = attSeasonSessions(season).filter(s => s.class_date <= attToday());
  const b = attCalBounds(season);
  let idx;
  if(sess.length){ const d = sess[sess.length - 1].class_date; idx = parseInt(d.slice(0, 4), 10) * 12 + parseInt(d.slice(5, 7), 10) - 1; }
  else { const n = new Date(); idx = n.getFullYear() * 12 + n.getMonth(); }
  idx = Math.max(b.min, Math.min(b.max, idx));
  const onKey = (e) => { if(e.key === 'Escape'){ e.preventDefault(); attCloseCal(); } };
  ATT_CAL = { uid, season, idx, onKey };
  const ov = document.createElement('div');
  ov.id = 'att-cal-ov'; ov.className = 'modal-backdrop';
  ov.innerHTML = `<div class="ac-cal-card" role="dialog" aria-modal="true">${attCalBody()}</div>`;
  ov.addEventListener('click', (e) => {
    if(e.target === ov) return attCloseCal();
    const t = e.target.closest('[data-cal]'); if(!t || !ATT_CAL) return;
    if(t.dataset.cal === 'close') return attCloseCal();
    const bb = attCalBounds(ATT_CAL.season);
    if(t.dataset.cal === 'prev') ATT_CAL.idx = Math.max(bb.min, ATT_CAL.idx - 1);
    if(t.dataset.cal === 'next') ATT_CAL.idx = Math.min(bb.max, ATT_CAL.idx + 1);
    ov.firstChild.innerHTML = attCalBody();
  });
  document.body.appendChild(ov);
  document.addEventListener('keydown', onKey, true);
}

/* ---------- pasar lista ---------- */
function attRollMembers(){
  const A = att(), sid = A.open;
  const all = (COMMITTEE.members || []).map(m => {
    const key = sid + '|' + m.user_id;
    return { m, on: A.set.has(key), info: A.info.get(key) || null, cat: cmCatById(m.category_id), p: cmNameParts(m) };
  });
  const q = cmPlain(A.rollQ).trim();
  const list = all.filter(e => (!q || cmPlain(cmSurnameName(e.m) + ' ' + (e.m.email || '')).includes(q))
    && (A.rollFilter === 'all' || (A.rollFilter === 'here' ? e.on : !e.on))
    && (A.rollCat === 'all' || (A.rollCat === 'none' ? !e.m.category_id : e.m.category_id === A.rollCat)));
  const key = A.rollSortKey, dir = A.rollSortDir;
  const val = (e) => {
    if(key === 'cat') return e.cat ? cmPlain(e.cat.name) : null;
    if(key === 'reg') return e.on && e.info && e.info.at ? Date.parse(e.info.at) : null;
    if(key === 'state') return e.on ? 1 : 0;
    return (e.p.last || e.p.first) ? cmPlain(e.p.last || e.p.first) : null;
  };
  list.sort((a, b) => {
    const va = val(a), vb = val(b);
    const na = va === null, nb = vb === null;
    if(na !== nb) return na ? 1 : -1;
    let r = 0;
    if(!na) r = (typeof va === 'number' && typeof vb === 'number') ? va - vb : cmCollate(va, vb);
    if(r !== 0) return dir === 'desc' ? -r : r;
    return cmCollate(cmSurnameName(a.m), cmSurnameName(b.m));
  });
  const here = all.filter(e => e.on).length;
  return { all, list, here, absent: all.length - here };
}
function attFmtTime(iso){
  try{ return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }catch(e){ return ''; }
}
function attRollList(){
  const { list, all } = attRollMembers();
  if(!all.length) return `<div class="mb-empty" style="padding:22px;">Todavía no hay árbitros en Miembros.</div>`;
  if(!list.length) return `<div class="mb-empty" style="padding:22px;">Nadie coincide con esos filtros.</div>`;
  return list.map((e, i) => {
    const m = e.m;
    let h = 0; const seed = cmSurnameName(m); for(let k = 0; k < seed.length; k++) h = (h * 31 + seed.charCodeAt(k)) % 360;
    const reg = e.on && e.info && e.info.at
      ? `<span class="at-reg" title="${esc(cmFmtDate(e.info.at))}"><b>${esc(attFmtTime(e.info.at))}</b><i class="${e.info.method === 'qr' ? 'qr' : ''}">${e.info.method === 'qr' ? 'QR' : 'Manual'}</i></span>`
      : '<span class="mb-none">—</span>';
    return `<button type="button" class="at-row ${e.on ? 'on' : ''}" data-uid="${m.user_id}" aria-pressed="${e.on}">
      <span class="at-num">${i + 1}</span>
      <span class="at-person"><span class="lg-avatar mb-av" style="--h:${h};">${esc(cmInitials(m))}</span><strong>${esc(cmSurnameName(m))}</strong></span>
      <span class="at-c-cat">${e.cat ? `<span class="rkt-cat" style="--c:${esc(e.cat.color)}">${esc(e.cat.name)}</span>` : '<span class="mb-none">—</span>'}</span>
      <span class="at-c-reg">${reg}</span>
      <span class="at-c-st"><span class="at-state ${e.on ? 'on' : ''}">${e.on ? shellIcon('check') + 'Ha venido' : 'No ha venido'}</span></span>
    </button>`;
  }).join('');
}
function attRollView(){
  const ic = (n) => shellIcon(n);
  const A = att();
  const s = (A.sessions || []).find(x => x.id === A.open);
  if(!s){ A.open = null; return ''; }
  const today = s.class_date === attToday();
  const { all, here, absent } = attRollMembers();
  const pct = all.length ? Math.round(here / all.length * 100) : 0;
  const key = A.rollSortKey, dir = A.rollSortDir;
  const th = (k, label, cls) => `<span class="${cls || ''}"><button type="button" class="mb-sortbtn ${key === k ? 'on' : ''}" data-action="committee-att-rsort" data-key="${k}">${label}<span class="mb-arrow">${key === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></span>`;
  const chip = (k, label, id, n) => `<button type="button" class="db-status ${A.rollFilter === k ? 'active' : ''}" data-action="committee-att-rfilter" data-f="${k}">${label}<em id="${id}">${n}</em></button>`;
  const catOpts = `<option value="all" ${A.rollCat === 'all' ? 'selected' : ''}>Todas las categorías</option><option value="none" ${A.rollCat === 'none' ? 'selected' : ''}>Sin categoría</option>` +
    (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}" ${A.rollCat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const hero = cmHero('Asistencia · Pasar lista', esc(attTitle(s)),
    'Toca a cada árbitro que esté en clase. Quien no esté marcado cuenta como falta. Se guarda al momento.',
    today ? `<button class="btn btn-yellow" data-action="committee-att-qr" data-sid="${s.id}">${ic('qr')} Mostrar QR</button>` : '',
    `<div class="lg-hero-stats cm-hero-stats">
      <div class="lg-stat"><b id="at-st-here">${here}</b><span>Han venido</span></div>
      <div class="lg-stat"><b id="at-st-abs">${absent}</b><span>No han venido</span></div>
      <div class="lg-stat"><b id="at-st-pct">${pct}%</b><span>Asistencia</span></div>
    </div>`);
  return `
  <button class="backbtn" data-action="committee-att-close">&larr; Volver a Asistencia</button>
  ${hero}
  <div class="tc-card at-roll" id="at-roll">
    <div class="at-toolbar">
      <div class="ac-search at-tsearch">${ic('search')}<input type="text" id="at-roll-q" placeholder="Buscar por apellidos o nombre" value="${esc(A.rollQ)}" autocomplete="off" aria-label="Buscar árbitro"></div>
      <select id="at-roll-cat" class="at-catsel" aria-label="Filtrar por categoría">${catOpts}</select>
    </div>
    <div class="db-status-group at-chips">
      ${chip('all', 'Todos', 'at-n-all', all.length)}${chip('here', 'Han venido', 'at-n-here', here)}${chip('absent', 'No han venido', 'at-n-abs', absent)}
    </div>
    <div class="at-rolltable">
      <div class="at-rl-head"><span>#</span>${th('surname', 'Árbitro')}${th('cat', 'Categoría', 'at-c-cat')}${th('reg', 'Registro', 'at-c-reg')}${th('state', 'Asistencia', 'at-c-st')}</div>
      <div class="at-rolllist" id="at-roll-list">${attRollList()}</div>
    </div>
  </div>`;
}
function attRollRefresh(){
  const l = document.getElementById('at-roll-list'); if(l) l.innerHTML = attRollList();
  const { all, here, absent } = attRollMembers();
  const set = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  set('at-st-here', here); set('at-st-abs', absent); set('at-st-pct', (all.length ? Math.round(here / all.length * 100) : 0) + '%');
  set('at-n-all', all.length); set('at-n-here', here); set('at-n-abs', absent);
}
async function attToggle(uid){
  const A = att(); const sid = A.open; if(!sid) return;
  const key = sid + '|' + uid;
  const was = A.set.has(key);
  const prevInfo = A.info.get(key);
  if(was){ A.set.delete(key); A.info.delete(key); }
  else { A.set.add(key); A.info.set(key, { method: 'manual', at: new Date().toISOString() }); }
  attRollRefresh();
  const r = was
    ? await supabaseClient.from('committee_attendance').delete().eq('session_id', sid).eq('user_id', uid)
    : await supabaseClient.from('committee_attendance').insert({ session_id: sid, user_id: uid, method: 'manual' });
  if(r.error){
    if(was){ A.set.add(key); if(prevInfo) A.info.set(key, prevInfo); } else { A.set.delete(key); A.info.delete(key); }
    attRollRefresh();
    cmToast(attErr(r.error));
  }
}

/* ---------- QR ---------- */
function attQrSvg(text){
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(); let d = '';
  for(let r = 0; r < n; r++) for(let c = 0; c < n; c++) if(qr.isDark(r, c)) d += 'M' + c + ',' + r + 'h1v1h-1z';
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Código QR de asistencia"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0B0F1A"/></svg>`;
}
let ATT_QR = null;
function attCloseQr(){
  if(!ATT_QR) return;
  clearInterval(ATT_QR.t1); clearInterval(ATT_QR.t2);
  document.removeEventListener('keydown', ATT_QR.onKey, true);
  const ov = document.getElementById('att-qr-ov'); if(ov) ov.remove();
  const sid = ATT_QR.sid;
  ATT_QR = null;
  document.body.classList.remove('at-noscroll');
  supabaseClient.rpc('committee_checkin_close', { p_session: sid }).then(() => {}, () => {});
  if(cmInCommittee()) render();
}
async function attQrPoll(){
  if(!ATT_QR) return;
  if(!document.getElementById('att-qr-ov') || !cmInCommittee()){ attCloseQr(); return; }
  const A = att(), sid = ATT_QR.sid;
  const r = await supabaseClient.from('committee_attendance').select('user_id,marked_at,method').eq('session_id', sid).order('marked_at', { ascending: false });
  if(r.error || !ATT_QR) return;
  Array.from(A.set).forEach(k => { if(k.startsWith(sid + '|')){ A.set.delete(k); A.info.delete(k); } });
  (r.data || []).forEach(x => { A.set.add(sid + '|' + x.user_id); A.info.set(sid + '|' + x.user_id, { method: x.method, at: x.marked_at }); });
  if(A.open === sid) attRollRefresh();
  const s = (A.sessions || []).find(x => x.id === sid); if(!s) return;
  const c = attSessionCount(s);
  const cnt = document.getElementById('att-qr-count'); if(cnt) cnt.innerHTML = `<b>${c.here}</b><span> / ${c.total} presentes</span>`;
  const bar = document.getElementById('att-qr-bar'); if(bar) bar.style.width = c.pct + '%';
  const byId = {}; (COMMITTEE.members || []).forEach(m => { byId[m.user_id] = m; });
  const last = document.getElementById('att-qr-last');
  if(last) last.innerHTML = (r.data || []).slice(0, 8).map(x => `<li>${shellIcon('check')}<span>${esc(byId[x.user_id] ? cmSurnameName(byId[x.user_id]) : 'Árbitro')}</span></li>`).join('') || '<li class="none">Todavía no ha escaneado nadie</li>';
}
async function attQrRotate(){
  if(!ATT_QR) return;
  if(!document.getElementById('att-qr-ov') || !cmInCommittee()){ attCloseQr(); return; }
  const box = document.getElementById('att-qr-box'), msg = document.getElementById('att-qr-msg');
  const r = await supabaseClient.rpc('committee_checkin_token', { p_session: ATT_QR.sid });
  if(!ATT_QR) return;
  if(r.error || !r.data || !r.data.token){
    if(box) box.innerHTML = '';
    if(msg) msg.textContent = attErr(r.error || 'error');
    return;
  }
  if(msg) msg.textContent = 'El código cambia solo cada pocos segundos. Cada persona debe escanearlo desde su móvil, con su sesión de we-ref.com.';
  const url = location.origin + '/app.html?asistencia=' + encodeURIComponent(r.data.token);
  if(box) box.innerHTML = attQrSvg(url);
}
async function attOpenQr(sid){
  const A = att();
  const s = (A.sessions || []).find(x => x.id === sid); if(!s) return;
  if(s.class_date !== attToday()){ cmToast('El QR solo se puede abrir el mismo día de la clase.'); return; }
  if(typeof qrcode !== 'function'){ cmToast('No se pudo cargar el generador de QR. Recarga la página.'); return; }
  if(ATT_QR) attCloseQr();
  const ov = document.createElement('div');
  ov.id = 'att-qr-ov'; ov.className = 'at-ov';
  ov.innerHTML = `<div class="at-ov-in">
      <button type="button" class="btn btn-ghost at-ov-close" data-qr="close">✕ Cerrar</button>
      <div class="at-ov-head"><span>Asistencia</span><h2>${esc(attTitle(s))}</h2></div>
      <div class="at-ov-grid">
        <div class="at-ov-qr"><div id="att-qr-box" class="at-qrbox"></div><p id="att-qr-msg" class="at-qrmsg">Generando el código...</p></div>
        <div class="at-ov-side">
          <div class="at-ov-count" id="att-qr-count"><b>0</b><span> presentes</span></div>
          <div class="at-ov-bar"><i id="att-qr-bar" style="width:0%"></i></div>
          <h3>Han llegado</h3>
          <ul class="at-ov-last" id="att-qr-last"><li class="none">Todavía no ha escaneado nadie</li></ul>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  document.body.classList.add('at-noscroll');
  ov.addEventListener('click', (e) => { if(e.target.closest('[data-qr="close"]')) attCloseQr(); });
  const onKey = (e) => { if(e.key === 'Escape'){ e.preventDefault(); attCloseQr(); } };
  document.addEventListener('keydown', onKey, true);
  ATT_QR = { sid, onKey, t1: setInterval(attQrRotate, 25000), t2: setInterval(attQrPoll, 4000) };
  await attQrRotate();
  attQrPoll();
}

/* ---------- acciones del administrador ---------- */
async function attOnAction(action, el){
  const A = att();
  if(!isDevUser()) return;
  if(action === 'committee-att-create'){
    const d = A.newDate || attToday();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){ cmToast('Elige la fecha de la clase.'); return; }
    const r = await supabaseClient.from('committee_sessions').insert({ class_date: d }).select().single();
    if(r.error){ cmToast(attErr(r.error)); return; }
    await cmLoadAttendance();
    A.season = attSeasonOf(r.data);
    STATE.toast = 'Clase creada: ' + attTitle(r.data); render();
  }
  else if(action === 'committee-att-open'){ A.open = el.dataset.sid; A.rollQ = ''; A.rollFilter = 'all'; A.rollCat = 'all'; A.rollSortKey = 'surname'; A.rollSortDir = 'asc'; render(); window.scrollTo(0, 0); }
  else if(action === 'committee-att-close'){ A.open = null; render(); await cmLoadAttendance(); cmRefresh(); }
  else if(action === 'committee-att-delete'){
    const s = (A.sessions || []).find(x => x.id === el.dataset.sid); if(!s) return;
    const ok = await appConfirm({ title: 'Eliminar la clase', message: `Se borrará ${attTitle(s)} y la asistencia que has marcado en ella. No se puede deshacer.`, confirmText: 'Eliminar', danger: true });
    if(!ok) return;
    const r = await supabaseClient.from('committee_sessions').delete().eq('id', s.id);
    if(r.error){ cmToast(attErr(r.error)); return; }
    await cmLoadAttendance();
    STATE.toast = 'Clase eliminada.'; render();
  }
  else if(action === 'committee-att-qr'){ attOpenQr(el.dataset.sid); }
  else if(action === 'committee-att-rsort'){
    const k = el.dataset.key;
    if(A.rollSortKey === k) A.rollSortDir = A.rollSortDir === 'asc' ? 'desc' : 'asc';
    else { A.rollSortKey = k; A.rollSortDir = k === 'state' ? 'desc' : 'asc'; }
    render();
  }
  else if(action === 'committee-att-rfilter'){ A.rollFilter = el.dataset.f; render(); }
  else if(action === 'committee-att-sort'){
    const k = el.dataset.key;
    if(A.sortKey === k) A.sortDir = A.sortDir === 'asc' ? 'desc' : 'asc';
    else { A.sortKey = k; A.sortDir = (k === 'got' || k === 'pct') ? 'desc' : 'asc'; }
    render();
  }
  else if(action === 'committee-att-low'){ A.filters.low = !A.filters.low; render(); }
  else if(action === 'committee-att-clear-filters'){ A.filters = { last: '', first: '', cat: 'all', low: false }; render(); }
  else if(action === 'committee-att-export'){
    const { list, season } = attRows();
    const sess = attSeasonSessions(season);
    const rows = list.map(e => {
      const row = { 'Apellidos': e.p.last || '', 'Nombre': e.p.first || '', 'Categoría': (cmCatById(e.m.category_id) || {}).name || '' };
      sess.forEach(s => {
        const counts = e.s.dots.find(d => d.s.id === s.id);
        row[attFmtDate(s.class_date)] = counts ? (counts.on ? 'SÍ' : 'NO') : '—';
      });
      row['Asistidas'] = e.s.got; row['Clases'] = e.s.total; row['% asistencia'] = e.s.pct === null ? '' : e.s.pct;
      return row;
    });
    cmExport(rows, 'Asistencia', 'asistencia_' + cmSeasonLabel(season).replace('/', '-') + '.xlsx');
  }
}

/* ---------- eventos tras pintar ---------- */
function attAfterRender(){
  const A = att();
  const tbl = document.getElementById('at-table');
  if(tbl){
    const refresh = () => {
      const b = document.getElementById('at-body'); if(b) b.innerHTML = attBodyHtml();
      const c = document.getElementById('at-count'); if(c) c.textContent = attCountText();
    };
    tbl.addEventListener('input', (ev) => {
      const t = ev.target;
      if(t.classList && t.classList.contains('mb-f') && t.tagName === 'INPUT'){ A.filters[t.dataset.col] = t.value; refresh(); }
    });
    tbl.addEventListener('click', (ev) => {
      const row = ev.target.closest('.at-trow');
      if(row) attOpenMemberCal(row.dataset.uid);
    });
    tbl.addEventListener('keydown', (ev) => {
      if(ev.key !== 'Enter') return;
      const row = ev.target.closest && ev.target.closest('.at-trow');
      if(row){ ev.preventDefault(); attOpenMemberCal(row.dataset.uid); }
    });
    tbl.addEventListener('change', (ev) => {
      const t = ev.target;
      if(t.classList && t.classList.contains('mb-f') && t.tagName === 'SELECT'){ A.filters[t.dataset.col] = t.value; refresh(); }
    });
  }
  const roll = document.getElementById('at-roll');
  if(roll){
    roll.addEventListener('click', (ev) => {
      const row = ev.target.closest('.at-row');
      if(row) attToggle(row.dataset.uid);
    });
    const q = document.getElementById('at-roll-q');
    if(q) q.addEventListener('input', () => { A.rollQ = q.value; attRollRefresh(); });
    const cs = document.getElementById('at-roll-cat');
    if(cs) cs.addEventListener('change', () => { A.rollCat = cs.value; attRollRefresh(); });
  }
  const th = document.getElementById('at-threshold');
  if(th) th.addEventListener('change', async () => {
    let v = parseInt(th.value, 10);
    if(!Number.isFinite(v)) v = 75;
    v = Math.max(0, Math.min(100, v));
    th.value = v;
    const r = await supabaseClient.from('committee_settings').update({ attendance_threshold: v }).eq('id', 1);
    if(r.error){ cmToast(attErr(r.error)); return; }
    A.threshold = v;
    STATE.toast = 'Mínimo de asistencia guardado: ' + v + '%.'; render();
  });
}

/* Tarjeta de Configuración */
function attSettingsCard(){
  const ic = (n) => shellIcon(n);
  return `<div class="tc-card" style="margin-top:16px;">
      <div class="tc-card-head"><span class="tc-step">${ic('calendar')}</span><div><h3>Asistencia a clases</h3><small>Porcentaje mínimo de asistencia en la temporada</small></div></div>
      <div class="cs-add-row" style="align-items:center;">
        <label for="at-threshold" style="margin:0;">Mínimo exigido (%)</label>
        <input type="number" id="at-threshold" min="0" max="100" step="1" value="${att().threshold}" style="max-width:120px;">
      </div>
      <div class="st-note" style="margin-top:12px;">Quien baje de este porcentaje aparece en rojo en Asistencia, y el alumno lo ve también en su rendimiento.</div>
    </div>`;
}

/* ---------- vista del alumno (dentro de "Mi rendimiento") ---------- */
function attPerfHtml(who, season){
  const ic = (n) => shellIcon(n);
  const A = att();
  let sessions, has, label;
  if(who){                                   // el administrador mira a un árbitro
    if(A.sessions === null || A.missing) return '';
    const st = attMemberStats(who, season);
    sessions = st.dots.map(d => d.s); has = (s) => st.dots.find(d => d.s.id === s.id).on;
  } else {
    if(A.mySessions === null) return '';
    sessions = A.mySessions.filter(s => attSeasonOf(s) === season).slice().sort((a, b) => a.class_date.localeCompare(b.class_date));
    has = (s) => A.mySet.has(s.id);
  }
  if(!sessions.length) return '';
  const got = sessions.filter(has).length;
  const pct = Math.round(got / sessions.length * 100);
  const low = pct < A.threshold;
  const list = sessions.slice().reverse().map(s => {
    const on = has(s);
    return `<div class="mp-row at-mrow ${on ? '' : 'none'}">
      <div class="mp-row-main"><strong>${esc(attTitle(s))}</strong></div>
      <span class="cm-chip ${on ? 'open' : 'closed'}">${on ? 'Presente' : 'No asististe'}</span>
    </div>`;
  }).join('');
  return `
  <div class="lg-section-head" style="margin:6px 0 10px;"><h2>Asistencia a clases</h2><span>Clases presenciales de la temporada ${cmSeasonLabel(season)}</span></div>
  <div class="home-kpis at-mkpis" style="margin-bottom:16px;">
    <div class="kpi"><div class="kpi-top">${ic('calendar')} Asistencias</div><div class="kpi-val">${got}<small> / ${sessions.length}</small></div><div class="kpi-sub">clases a las que has venido</div></div>
    <div class="kpi"><div class="kpi-top">${ic('target')} Asistencia</div><div class="kpi-val" style="color:${low ? 'var(--red)' : 'var(--green-ok)'};">${pct}<small>%</small></div><div class="kpi-sub">${low ? 'por debajo del mínimo (' + A.threshold + '%)' : 'mínimo exigido: ' + A.threshold + '%'}</div></div>
  </div>
  <div class="tc-card" style="margin-bottom:16px;">
    <div class="tc-card-head"><span class="tc-step">${ic('list')}</span><div><h3>Tus clases</h3><small>Las más recientes primero</small></div></div>
    <div class="mp-list">${list}</div>
  </div>`;
}

/* ---------- el alumno escanea el QR: app.html?asistencia=CÓDIGO ---------- */
function attShowCheckinResult(ok, title, text){
  const prev = document.getElementById('att-result'); if(prev) prev.remove();
  const modal = document.createElement('div');
  modal.id = 'att-result'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-card qz-confirm" role="alertdialog" aria-modal="true">
      <span class="qz-confirm-ic ${ok ? 'ok' : 'danger'}">${shellIcon(ok ? 'check' : 'flag')}</span>
      <h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="qz-confirm-actions"><button type="button" class="btn btn-primary" data-dlg="ok">Aceptar</button></div>
    </div>`;
  modal.addEventListener('click', (e) => { if(e.target === modal || e.target.closest('[data-dlg]')) modal.remove(); });
  document.body.appendChild(modal);
}
async function attCheckinFromLink(){
  let token = null;
  try{ token = new URLSearchParams(location.search).get('asistencia'); }catch(e){}
  try{
    if(!token) token = sessionStorage.getItem('weref_checkin');
    sessionStorage.removeItem('weref_checkin');
  }catch(e){}
  if(!token) return;
  try{ history.replaceState(null, '', location.pathname); }catch(e){}
  const r = await supabaseClient.rpc('committee_checkin', { p_token: String(token).slice(0, 64) });
  if(r.error){
    const m = String(r.error.message || '');
    if(/no_access/.test(m)) attShowCheckinResult(false, 'No se ha podido registrar', 'Tu cuenta no está dada de alta en CTA BAGES. Díselo a quien da la clase.');
    else attShowCheckinResult(false, 'No se ha podido registrar', attErr(r.error));
    return;
  }
  const d = r.data || {};
  attShowCheckinResult(true, d.already ? 'Ya estabas registrado' : 'Asistencia registrada', (d.already ? 'Tu asistencia a la ' : 'Te hemos marcado como presente en la ') + 'Classe ' + attFmtDate(d.class_date) + '.');
  if(typeof cmLoadMyAttendance === 'function') cmLoadMyAttendance().then(() => cmRefresh());
}
