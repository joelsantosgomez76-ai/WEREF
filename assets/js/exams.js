/* ---------------- CTA BAGES · Biblioteca de exámenes ----------------
   Panel de Formación → pestaña "Biblioteca": todos los exámenes en PDF de todas las temporadas.
   · Árbol a la izquierda (estado, temporadas y categorías con contadores), lista en el centro y
     panel de detalle con vista previa del PDF a la derecha.
   · Dos estados: Pendiente / En la app (pasado a la app / base de datos).
   · Búsqueda al momento, vistas guardadas, selección múltiple, arrastrar para mover o marcar,
     subida arrastrando PDF, atajos de teclado y sincronización entre cuentas de administración.
   Las categorías son las mismas de los miembros del comité (Configuración). Los PDF viven en un almacén
   privado de Supabase (solo administración). Seguridad: supabase/exams.sql. Novedades (notas,
   quién lo subió, tiempo real): supabase/exams-library.sql.
   Depende de committee.js (COMMITTEE, cm*) y de app.js (esc, appConfirm, storageGet/storageSet). */

COMMITTEE.exams = {
  seasons: null,         // exam_seasons
  files: null,           // exam_files
  missing: false,        // falta ejecutar exams.sql
  v2: true,              // false si aún falta exams-library.sql (sin notas ni preguntas)
  q: '',                 // búsqueda
  season: 'all',         // all / id de temporada
  cat: 'all',            // all / none / id de categoría
  status: 'all',         // all / pending / done
  quick: '',             // '' / week / nocat
  sortKey: 'date',       // title / cat / date / status
  sortDir: 'desc',
  limit: 60,             // filas pintadas (botón "Mostrar más")
  sel: new Set(),        // ids marcados con casilla
  lastSel: null,         // última casilla pulsada (para seleccionar un rango con Mayús)
  active: null,          // examen abierto en el panel de detalle
  prevId: null,          // examen cuya vista previa está en pantalla
  blobs: new Map(),      // vistas previas ya descargadas
  fresh: new Set(),      // recién subidos (resaltados)
  treeOpen: new Set(),   // temporadas desplegadas en el árbol
  views: [],             // vistas guardadas
  savingView: false,
  upOpen: null,          // panel de subida: null = automático (abierto si la biblioteca está vacía)
  manageOpen: false,     // panel de temporadas y categorías
  up: { season: '', cat: '', date: '', title: '' },
  newSeason: '',
  newCat: '',
  edit: null,            // { id, title, date, cat, season } edición dentro del panel
  busy: '',              // texto de progreso mientras se sube
  queue: [],             // cola de subida [{ name, state: wait/up/ok/err, msg }]
  pendingFiles: null,    // PDF soltados en la página que esperan temporada y categoría
  inflight: 0,           // escrituras en curso (para no pisarlas al sincronizar)
  rt: { started: false, ok: false, timer: null, ren: null, kb: false }
};

const EXAM_BUCKET = 'exams';
const EXAM_MAX_BYTES = 30 * 1024 * 1024;
const EXAM_PAGE = 60;

function exm(){ return COMMITTEE.exams; }

/* ---------- utilidades ---------- */
function examToday(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function examFmtDate(d){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; }
function examFmtShort(d){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] : '—'; }
function examFmtDateTime(iso){
  try{ return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' }); }
  catch(e){ return ''; }
}
function examFmtSize(n){
  if(!Number.isFinite(n) || n <= 0) return '—';
  if(n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}
/* Los títulos de los exámenes van siempre en mayúsculas. */
function examUpper(s){ return String(s == null ? '' : s).toLocaleUpperCase('es'); }
function examUuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function examMe(){ return (typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) ? String(CURRENT_USERNAME) : 'Administración'; }
function examErr(err){
  const m = String((err && (err.message || err.code)) || err || '');
  if(/exam_seasons|exam_files|Bucket not found|PGRST20[25]|42P01|schema cache/i.test(m)) return 'Falta ejecutar el SQL de exámenes en Supabase.';
  if(/23505|duplicate/i.test(m)) return 'Ya existe una temporada con ese nombre.';
  if(/exceeded|too large|413|maximum allowed/i.test(m)) return 'El archivo es demasiado grande (máximo 30 MB).';
  return cmErrText(err);
}
function examById(id){ return (exm().files || []).find(x => x.id === id); }
function examSeasonName(id){ const s = (exm().seasons || []).find(x => x.id === id); return s ? s.name : '—'; }
/* Cambia toda la pantalla sin perder el punto donde estabas. */
function examRender(){ const y = window.scrollY; render(); window.scrollTo(0, y); }
/* Repinta árbol, resumen y lista (no toca el buscador, los filtros ni el panel). */
function examRefresh(){
  examPruneSel();
  const t = document.getElementById('ex-tree'); if(t) t.innerHTML = examTreeHtml();
  const c = document.getElementById('ex-chips'); if(c) c.innerHTML = examChipsHtml();
  const s = document.getElementById('ex-summary'); if(s) s.innerHTML = examSummaryHtml();
  const r = document.getElementById('ex-results'); if(r) r.innerHTML = examResultsHtml();
}
async function examChunks(ids, fn){
  for(let i = 0; i < ids.length; i += 100){
    const r = await fn(ids.slice(i, i + 100));
    if(r && r.error) return r;
  }
  return { error: null };
}
/* Escritura a Supabase contando las que están en curso (la sincronización espera a que terminen). */
async function examWrite(promise){
  const X = exm(); X.inflight++;
  try{ return await promise; } finally { X.inflight--; }
}

/* ---------- carga ---------- */
async function examLoad(){
  const X = exm();
  X.fresh = new Set();
  try{
    const [s, f, probe] = await Promise.all([
      supabaseClient.from('exam_seasons').select('*').order('name', { ascending: false }),
      supabaseClient.from('exam_files').select('*').order('exam_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      supabaseClient.from('exam_files').select('notes,created_by_name,in_app_by_name,updated_at').limit(1)
    ]);
    if(s.error || f.error){ X.seasons = []; X.files = []; X.missing = true; return; }
    X.missing = false;
    X.v2 = !probe.error;
    X.seasons = s.data || [];
    X.files = f.data || [];
  }catch(e){ X.seasons = []; X.files = []; X.missing = true; }
  const ids = new Set(X.files.map(e => e.id));
  X.sel.forEach(id => { if(!ids.has(id)) X.sel.delete(id); });
  if(X.active && !ids.has(X.active)) X.active = null;
  if(X.season !== 'all' && !X.seasons.some(s => s.id === X.season)) X.season = 'all';
  if(!X.viewsLoaded) await examLoadViews();
  examStartSync();
}

/* ---------- vistas guardadas (se guardan en tu cuenta, no en el navegador) ---------- */
async function examLoadViews(){
  const X = exm();
  X.viewsLoaded = true;
  try{
    const raw = typeof storageGet === 'function' ? await storageGet('exam_views') : null;
    const arr = raw ? JSON.parse(raw) : [];
    X.views = Array.isArray(arr) ? arr.filter(v => v && v.name) : [];
  }catch(e){ X.views = []; }
}
function examSaveViews(){
  try{ if(typeof storageSet === 'function') storageSet('exam_views', JSON.stringify(exm().views)); }catch(e){}
}

/* ---------- sincronización entre cuentas: Realtime + comprobación periódica de respaldo ---------- */
function examStartSync(){
  const X = exm();
  if(X.rt.started) return;
  X.rt.started = true;
  try{
    const ch = supabaseClient.channel('weref-exams');
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'exam_files' }, examRemoteFile);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'exam_seasons' }, () => { examSilentReload(); });
    ch.subscribe((st) => { X.rt.ok = (st === 'SUBSCRIBED'); });
  }catch(e){ X.rt.ok = false; }
  document.addEventListener('visibilitychange', () => { if(!document.hidden) examPoll(); });
  examPollSchedule();
}
function examRemoteFile(p){
  const X = exm();
  if(!X.files) return;
  try{
    if(p.eventType === 'DELETE'){
      const id = p.old && p.old.id; if(!id) return;
      X.files = X.files.filter(e => e.id !== id); X.sel.delete(id);
      if(X.active === id){ X.active = null; }
    } else if(p.new && p.new.id){
      const i = X.files.findIndex(e => e.id === p.new.id);
      if(i >= 0) X.files[i] = Object.assign({}, X.files[i], p.new, { _hay: null });
      else X.files.push(Object.assign({}, p.new));
    } else return;
    examRemoteRefresh();
  }catch(e){}
}
function examRemoteRefresh(){
  const X = exm();
  clearTimeout(X.rt.ren);
  X.rt.ren = setTimeout(() => {
    if(!document.getElementById('ex-lib')) return;
    examRefresh();
    const a = document.activeElement;
    const typingInPanel = a && a.closest && a.closest('#ex-detail') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if(!typingInPanel) examPanelSync();
  }, 250);
}
async function examSilentReload(){
  const X = exm();
  if(X.inflight || !X.files) return;
  const [s, f] = await Promise.all([
    supabaseClient.from('exam_seasons').select('*').order('name', { ascending: false }),
    supabaseClient.from('exam_files').select('*').order('exam_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  ]);
  if(s.error || f.error || X.inflight) return;
  const sig = (arr) => arr.map(e => [e.id, e.updated_at || '', e.in_app ? 1 : 0, e.title, e.category_id || '', e.season_id, e.exam_date || '', e.notes || ''].join('|')).sort().join('\n');
  const changed = sig(f.data || []) !== sig(X.files) || (s.data || []).length !== (X.seasons || []).length;
  if(!changed) return;
  X.seasons = s.data || [];
  X.files = f.data || [];
  if(X.active && !X.files.some(e => e.id === X.active)) X.active = null;
  examRemoteRefresh();
}
async function examPoll(){
  const X = exm();
  if(document.hidden || !document.getElementById('ex-lib')) return;
  try{ await examSilentReload(); }catch(e){}
}
function examPollSchedule(){
  const X = exm();
  clearTimeout(X.rt.timer);
  X.rt.timer = setTimeout(async () => { await examPoll(); examPollSchedule(); }, X.rt.ok ? 120000 : 30000);
}

/* ---------- temporadas ---------- */
function examCurrentSeasonId(){
  const list = exm().seasons || [];
  const cur = cmCurrentSeason();
  const hit = list.find(s => String(s.name).indexOf(cur) === 0);
  return hit ? hit.id : (list[0] ? list[0].id : '');
}
function examUpSeason(){
  const X = exm();
  return (X.up.season && (X.seasons || []).some(s => s.id === X.up.season)) ? X.up.season : examCurrentSeasonId();
}
function examNextSeasonName(){
  const have = new Set((exm().seasons || []).map(s => String(s.name).trim().toLowerCase()));
  let y = parseInt(cmCurrentSeason(), 10);
  for(let i = 0; i < 6; i++, y++){
    const name = y + '/' + (y + 1);
    if(!have.has(name)) return name;
  }
  return '';
}

/* ---------- búsqueda, filtros, contadores y orden ---------- */
function examHay(e){
  if(!e._hay){
    const cat = cmCatById(e.category_id);
    e._hay = cmPlain([e.title, e.file_name, e.notes, cat ? cat.name : '', examSeasonName(e.season_id), examFmtDate(e.exam_date), e.exam_date || '', e.in_app ? 'en la app' : 'pendiente'].join(' '));
  }
  return e._hay;
}
function examF(over){
  const X = exm();
  const f = Object.assign({ q: X.q, season: X.season, cat: X.cat, status: X.status, quick: X.quick }, over || {});
  f.terms = cmPlain(f.q).split(/\s+/).filter(Boolean);
  return f;
}
function examMatch(e, f){
  if(f.season !== 'all' && e.season_id !== f.season) return false;
  if(f.cat === 'none'){ if(e.category_id) return false; }
  else if(f.cat !== 'all' && e.category_id !== f.cat) return false;
  if(f.status === 'done' && !e.in_app) return false;
  if(f.status === 'pending' && e.in_app) return false;
  if(f.quick === 'week' && !(Date.now() - Date.parse(e.created_at) < 7 * 86400000)) return false;
  if(f.quick === 'nocat' && e.category_id) return false;
  if(f.terms.length){ const h = examHay(e); for(let i = 0; i < f.terms.length; i++) if(h.indexOf(f.terms[i]) < 0) return false; }
  return true;
}
/* Cuántos exámenes salen si se cambia solo una parte de los filtros (así los contadores del árbol son fieles). */
function examCount(over){ const f = examF(over); return (exm().files || []).filter(e => examMatch(e, f)).length; }
function examExists(sid, cid){
  return (exm().files || []).some(e => e.season_id === sid && (cid === 'none' ? !e.category_id : e.category_id === cid));
}
function examVisible(){
  const X = exm();
  const f = examF();
  const list = (X.files || []).filter(e => examMatch(e, f));
  const key = X.sortKey, dir = X.sortDir;
  const val = (e) => {
    if(key === 'status') return e.in_app ? 1 : 0;
    if(key === 'title') return cmPlain(e.title);
    if(key === 'cat') return cmCatRank(e.category_id);
    return e.exam_date || null;
  };
  list.sort((a, b) => {
    const va = val(a), vb = val(b);
    const na = va === null || va === '', nb = vb === null || vb === '';
    if(na !== nb) return na ? 1 : -1;
    let r = 0;
    if(!na) r = (typeof va === 'number' && typeof vb === 'number') ? va - vb : (typeof va === 'string' && typeof vb === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : 0);
    if(r !== 0) return dir === 'desc' ? -r : r;
    return cmCollate(a.title, b.title);
  });
  return list;
}
function examFiltersActive(){
  const X = exm();
  return !!(X.q.trim() || X.season !== 'all' || X.cat !== 'all' || X.status !== 'all' || X.quick);
}
/* La selección es siempre de lo que se ve: si un filtro esconde un examen, deja de estar seleccionado
   (así "Eliminar" o "Mover" nunca tocan nada que no estés viendo). */
function examPruneSel(){
  const X = exm();
  if(!X.sel.size) return;
  const vis = new Set(examVisible().map(e => e.id));
  X.sel.forEach(id => { if(!vis.has(id)) X.sel.delete(id); });
}
/* Pone al día casillas, filas marcadas y barra de acciones sin repintar la lista (no se pierde el foco). */
function examSyncSelection(){
  const X = exm();
  document.querySelectorAll('#ex-results [data-ex-sel]').forEach(c => {
    const on = X.sel.has(c.dataset.exSel);
    c.checked = on;
    const tr = c.closest('tr'); if(tr) tr.classList.toggle('picked', on);
  });
  const bar = document.getElementById('ex-bulkbar'); if(bar) bar.innerHTML = examBulkHtml();
  const all = document.querySelector('#ex-results [data-ex-selall]');
  if(all){ const list = examVisible(); all.checked = list.length > 0 && list.every(e => X.sel.has(e.id)); }
}

/* ---------- piezas: árbol, chips, resumen ---------- */
function examTreeHtml(){
  const ic = (n) => shellIcon(n);
  const X = exm();
  const seasons = X.seasons || [];
  const cats = COMMITTEE.categories || [];
  const stNode = (s, label, icon) => `<button type="button" class="ex-tn ${X.status === s ? 'on' : ''}" data-exa="t-status" data-s="${s}" data-drop-status="${s}">${ic(icon)}<span>${label}</span><em>${examCount({ status: s })}</em></button>`;
  let h = `<div class="ex-tsec">Estado</div>
    ${stNode('all', 'Todos', 'folder')}${stNode('pending', 'Pendientes', 'clock')}${stNode('done', 'En la app', 'check')}
    <div class="ex-tsec">Temporadas</div>
    <button type="button" class="ex-tn ${X.season === 'all' && X.cat === 'all' ? 'on' : ''}" data-exa="t-season" data-id="all">${ic('book')}<span>Todas las temporadas</span><em>${examCount({ season: 'all', cat: 'all' })}</em></button>`;
  seasons.forEach(s => {
    const open = X.treeOpen.has(s.id) || X.season === s.id;
    const sOn = X.season === s.id && X.cat === 'all';
    h += `<div class="ex-tgroup">
      <div class="ex-tn-row">
        <button type="button" class="ex-tx" data-exa="t-toggle" data-id="${esc(s.id)}" aria-label="${open ? 'Plegar' : 'Desplegar'} ${esc(s.name)}" aria-expanded="${open ? 'true' : 'false'}"><span class="${open ? 'open' : ''}">${ic('chevron')}</span></button>
        <button type="button" class="ex-tn ${sOn ? 'on' : ''}" data-exa="t-season" data-id="${esc(s.id)}" data-drop-season="${esc(s.id)}"><span>${esc(s.name)}</span><em>${examCount({ season: s.id, cat: 'all' })}</em></button>
      </div>`;
    if(open){
      cats.forEach(c => {
        if(!examExists(s.id, c.id)) return;
        h += `<button type="button" class="ex-tn sub ${X.season === s.id && X.cat === c.id ? 'on' : ''}" data-exa="t-cat" data-id="${esc(s.id)}" data-cat="${esc(c.id)}" data-drop-season="${esc(s.id)}" data-drop-cat="${esc(c.id)}"><i class="ex-dot" style="--c:${esc(c.color)}"></i><span>${esc(c.name)}</span><em>${examCount({ season: s.id, cat: c.id })}</em></button>`;
      });
      if(examExists(s.id, 'none')) h += `<button type="button" class="ex-tn sub ${X.season === s.id && X.cat === 'none' ? 'on' : ''}" data-exa="t-cat" data-id="${esc(s.id)}" data-cat="none" data-drop-season="${esc(s.id)}" data-drop-cat="none"><i class="ex-dot" style="--c:#9AA0A6"></i><span>Sin categoría</span><em>${examCount({ season: s.id, cat: 'none' })}</em></button>`;
    }
    h += `</div>`;
  });
  return h;
}
function examChipsHtml(){
  const ic = (n) => shellIcon(n);
  const X = exm();
  const chip = (on, attrs, label, extra) => `<span class="ex-chipwrap"><button type="button" class="ex-qchip ${on ? 'on' : ''}" ${attrs}>${label}</button>${extra || ''}</span>`;
  let h = chip(X.quick === 'week', 'data-exa="quick" data-k="week"', 'Subidos esta semana') + chip(X.quick === 'nocat', 'data-exa="quick" data-k="nocat"', 'Sin categoría');
  X.views.forEach((v, i) => { h += chip(false, `data-exa="view-apply" data-i="${i}"`, `${ic('star')} ${esc(v.name)}`, `<button type="button" class="ex-qx" data-exa="view-del" data-i="${i}" title="Quitar la vista" aria-label="Quitar la vista ${esc(v.name)}">×</button>`); });
  if(X.savingView) h += `<span class="ex-saveview"><input type="text" id="ex-viewname" data-ex-viewname maxlength="40" placeholder="Nombre de la vista" autocomplete="off"><button type="button" class="btn btn-primary" data-exa="view-save">Guardar</button><button type="button" class="btn btn-ghost" data-exa="view-cancel">Cancelar</button></span>`;
  else if(examFiltersActive()) h += `<button type="button" class="ex-qchip add" data-exa="view-start">${ic('plus')} Guardar esta vista</button>`;
  return h;
}
function examSummaryHtml(){
  const all = exm().files || [];
  const done = all.filter(e => e.in_app).length;
  const pct = all.length ? Math.round(done / all.length * 100) : 0;
  return `<div class="ex-sumline"><span><b>${all.length}</b> en la biblioteca</span><span class="ok"><b>${done}</b> en la app</span><span class="bad"><b>${all.length - done}</b> pendientes</span></div>
    <div class="ex-sum-bar" title="${pct}% ya está en la app"><i style="width:${pct}%"></i><em>${pct}% en la app</em></div>`;
}

/* ---------- lista ---------- */
function examStatusPill(e){
  const ic = (n) => shellIcon(n);
  return `<button type="button" class="ex-toggle ${e.in_app ? 'on' : ''}" data-exa="pill" data-id="${e.id}" aria-pressed="${e.in_app ? 'true' : 'false'}" title="${e.in_app ? 'Pulsa para marcarlo como pendiente' : 'Pulsa cuando ya esté pasado a la app / base de datos'}">${ic(e.in_app ? 'check' : 'clock')}<span>${e.in_app ? 'En la app' : 'Pendiente'}</span></button>`;
}
function examRowHtml(e){
  const X = exm();
  const cat = cmCatById(e.category_id);
  const picked = X.sel.has(e.id);
  const title = examUpper(e.title);
  const meta = [examSeasonName(e.season_id), examFmtSize(e.file_size)];
  return `<tr class="ex-tr ${e.in_app ? 'done' : ''} ${X.fresh.has(e.id) ? 'fresh' : ''} ${picked ? 'picked' : ''} ${X.active === e.id ? 'active' : ''}" data-id="${e.id}" draggable="true">
    <td class="ex-c-sel"><input type="checkbox" data-ex-sel="${e.id}" ${picked ? 'checked' : ''} aria-label="Seleccionar ${esc(title)}"></td>
    <td class="ex-c-title"><strong title="${esc(title)}">${esc(title)}</strong><small>${meta.map(esc).join(' · ')}${X.v2 && e.notes ? ` · <span class="ex-hasnote">${shellIcon('message')} nota</span>` : ''}</small></td>
    <td class="ex-c-cat" data-label="Categoría">${cat ? `<span class="rkt-cat" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>` : '<span class="mb-none">—</span>'}</td>
    <td class="ex-c-date" data-label="Fecha">${esc(examFmtDate(e.exam_date))}</td>
    <td class="ex-c-state">${examStatusPill(e)}</td>
  </tr>`;
}
function examBulkHtml(){
  const ic = (n) => shellIcon(n);
  const X = exm();
  if(!X.sel.size) return '';
  const catOpts = '<option value="">Mover a categoría…</option><option value="none">Sin categoría</option>' + (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  return `<div class="ex-bulk">
    <strong>${X.sel.size} ${X.sel.size === 1 ? 'seleccionado' : 'seleccionados'}</strong>
    <button type="button" class="btn btn-primary" data-exa="bulk-in">${ic('check')} Marcar en la app</button>
    <button type="button" class="btn btn-ghost" data-exa="bulk-out">${ic('clock')} Marcar pendiente</button>
    <select id="ex-bulk-cat" aria-label="Mover a categoría">${catOpts}</select>
    <button type="button" class="btn btn-ghost" data-exa="bulk-move">Mover</button>
    <button type="button" class="btn btn-ghost danger" data-exa="bulk-delete">${ic('trash')} Eliminar</button>
    <button type="button" class="btn btn-ghost" data-exa="bulk-clear">Quitar selección</button>
  </div>`;
}
function examResultsHtml(){
  const ic = (n) => shellIcon(n);
  const X = exm();
  const list = examVisible();
  const total = (X.files || []).length;
  const head = `<div class="ex-bar">
    <small class="ex-count">${list.length === total ? total + (total === 1 ? ' examen' : ' exámenes') : list.length + ' de ' + total + ' exámenes'}</small>
    ${examFiltersActive() ? `<button type="button" class="btn btn-ghost ex-clear" data-exa="clear">${ic('trash')} Limpiar filtros</button>` : ''}
  </div>`;
  if(!list.length){
    return head + `<div id="ex-bulkbar"></div><div class="ac-empty" style="padding:26px 14px;">${ic('file')}<strong>${total ? 'Ningún examen con esos filtros' : 'Todavía no hay exámenes en la biblioteca'}</strong><span>${total ? 'Prueba a quitar algún filtro o a cambiar la búsqueda.' : 'Arrastra aquí los PDF o pulsa «Subir».'}</span></div>`;
  }
  const key = X.sortKey, dir = X.sortDir;
  const th = (k, label, cls) => `<th class="${cls || ''}"><button type="button" class="mb-sortbtn ${key === k ? 'on' : ''}" data-exa="sort" data-key="${k}">${label}<span class="mb-arrow">${key === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const allPicked = list.every(e => X.sel.has(e.id));
  const shown = list.slice(0, X.limit);
  return head + `<div id="ex-bulkbar">${examBulkHtml()}</div><div class="ex-tablewrap"><table class="ex-table">
    <thead><tr class="ex-th">
      <th class="ex-c-sel"><input type="checkbox" data-ex-selall ${allPicked ? 'checked' : ''} aria-label="Seleccionar los ${list.length} que cumplen los filtros" title="Seleccionar los ${list.length} que cumplen los filtros"></th>
      ${th('title', 'Nombre', 'ex-c-title')}${th('cat', 'Categoría', 'ex-c-cat')}${th('date', 'Fecha', 'ex-c-date')}${th('status', 'Estado', 'ex-c-state')}
    </tr></thead>
    <tbody>${shown.map(examRowHtml).join('')}</tbody>
  </table></div>
  ${list.length > shown.length ? `<div class="ex-more"><button type="button" class="btn btn-ghost" data-exa="more">Mostrar más (${list.length - shown.length} restantes)</button></div>` : ''}`;
}

/* ---------- panel de detalle (vista previa + datos + notas) ---------- */
function examPanelHeadHtml(e){
  const ic = (n) => shellIcon(n);
  const list = examVisible();
  const i = list.findIndex(x => x.id === e.id);
  return `<div class="ex-d-top">
    <div class="ex-d-nav">
      <button type="button" class="tx-icon" data-exa="d-prev" ${i <= 0 ? 'disabled' : ''} title="Examen anterior (↑)" aria-label="Examen anterior">${ic('up')}</button>
      <button type="button" class="tx-icon" data-exa="d-next" ${i < 0 || i >= list.length - 1 ? 'disabled' : ''} title="Examen siguiente (↓)" aria-label="Examen siguiente">${ic('down')}</button>
      <small>${i >= 0 ? (i + 1) + ' de ' + list.length : ''}</small>
    </div>
    <button type="button" class="tx-icon" data-exa="d-close" title="Cerrar (Esc)" aria-label="Cerrar el detalle">✕</button>
  </div>
  <h3 class="ex-d-title">${esc(examUpper(e.title))}</h3>`;
}
function examPanelBodyHtml(e){
  const ic = (n) => shellIcon(n);
  const X = exm();
  const cat = cmCatById(e.category_id);
  if(X.edit && X.edit.id === e.id){
    const catOpts = '<option value="">Sin categoría</option>' + (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}" ${X.edit.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const seasonOpts = (X.seasons || []).map(s => `<option value="${esc(s.id)}" ${X.edit.season === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<div class="ex-d-form">
      <label for="ex-e-title">Título</label><input type="text" id="ex-e-title" data-ex-edit="title" value="${esc(examUpper(X.edit.title))}" maxlength="160" autocomplete="off">
      <label for="ex-e-season">Temporada</label><select id="ex-e-season" data-ex-edit="season">${seasonOpts}</select>
      <label for="ex-e-cat">Categoría</label><select id="ex-e-cat" data-ex-edit="cat">${catOpts}</select>
      <label for="ex-e-date">Fecha</label><input type="date" id="ex-e-date" data-ex-edit="date" value="${esc(X.edit.date)}">
      <div class="ex-edit-actions">
        <button type="button" class="btn btn-primary" data-exa="save" data-id="${e.id}">${ic('check')} Guardar</button>
        <button type="button" class="btn btn-ghost" data-exa="cancel">Cancelar</button>
      </div>
    </div>`;
  }
  const kv = (k, v) => `<div class="ex-kv"><span>${k}</span><span>${v}</span></div>`;
  const who = (name, when) => (name ? esc(name) : '—') + (when ? ' · ' + esc(examFmtDateTime(when)) : '');
  return `<div class="ex-d-seg" role="group" aria-label="Estado del examen">
      <button type="button" class="ex-seg-btn ${!e.in_app ? 'on' : ''}" data-exa="set-pending" data-id="${e.id}">${ic('clock')} Pendiente</button>
      <button type="button" class="ex-seg-btn ok ${e.in_app ? 'on' : ''}" data-exa="set-done" data-id="${e.id}">${ic('check')} En la app</button>
    </div>
    <div class="ex-d-kv">
      ${kv('Categoría', cat ? `<span class="rkt-cat" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>` : 'Sin categoría')}
      ${kv('Temporada', esc(examSeasonName(e.season_id)))}
      ${kv('Fecha del examen', esc(examFmtDate(e.exam_date)))}
      ${kv('Archivo', esc(e.file_name || 'PDF') + ' · ' + esc(examFmtSize(e.file_size)))}
      ${X.v2 ? kv('Subido por', who(e.created_by_name, e.created_at)) : kv('Subido el', esc(examFmtDateTime(e.created_at)))}
      ${X.v2 && e.in_app ? kv('Pasado a la app', who(e.in_app_by_name, e.in_app_at)) : ''}
    </div>
    ${X.v2 ? `<div class="ex-d-block">
      <label for="ex-notes">Notas <small id="ex-saved" class="ex-saved"></small></label>
      <textarea id="ex-notes" data-ex-notes rows="3" maxlength="2000" placeholder="Por ejemplo: revisar la pregunta 12">${esc(e.notes || '')}</textarea>
    </div>` : `<div class="st-note">Para añadir notas y ver quién subió cada examen falta ejecutar el SQL <b>exams-library.sql</b> en Supabase.</div>`}
    <div class="ex-d-actions">
      <button type="button" class="btn btn-primary" data-exa="expand" data-id="${e.id}">${ic('eye')} Ver PDF</button>
      <button type="button" class="btn btn-ghost" data-exa="download" data-id="${e.id}">${ic('download')} Descargar</button>
      <button type="button" class="btn btn-ghost" data-exa="edit" data-id="${e.id}">${ic('pencil')} Editar</button>
      <button type="button" class="btn btn-ghost danger" data-exa="delete" data-id="${e.id}">${ic('trash')} Eliminar</button>
    </div>`;
}
/* Pone al día el panel. La vista previa solo se vuelve a cargar si cambia el examen. */
function examPanelSync(){
  const X = exm();
  const lay = document.getElementById('ex-layout'), box = document.getElementById('ex-detail');
  if(!lay || !box) return;
  const e = X.active ? examById(X.active) : null;
  if(!e){
    X.active = null; X.prevId = null;
    lay.classList.remove('has-panel'); box.classList.remove('open'); document.body.classList.remove('ex-panel-open');
    return;
  }
  lay.classList.add('has-panel'); box.classList.add('open'); document.body.classList.add('ex-panel-open');
  const h = document.getElementById('ex-d-head'); if(h) h.innerHTML = examPanelHeadHtml(e);
  const b = document.getElementById('ex-d-body'); if(b) b.innerHTML = examPanelBodyHtml(e);
  const pv = document.getElementById('ex-prev');
  if(pv && (X.prevId !== e.id || !pv.firstElementChild)) examLoadPreview(e);
}
function examSetActive(id){
  const X = exm();
  if(X.active === id){ examPanelSync(); return; }
  X.active = id; X.edit = null;
  document.querySelectorAll('#ex-results tr.ex-tr').forEach(tr => tr.classList.toggle('active', tr.dataset.id === id));
  examPanelSync();
}
function examClosePanel(){
  const X = exm();
  X.active = null; X.edit = null;
  document.querySelectorAll('#ex-results tr.ex-tr.active').forEach(tr => tr.classList.remove('active'));
  examPanelSync();
}
function examMoveActive(delta){
  const X = exm();
  const list = examVisible();
  if(!list.length) return;
  let i = list.findIndex(e => e.id === X.active);
  i = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + delta));
  if(i >= X.limit){ X.limit = i + EXAM_PAGE; examRefresh(); }
  examSetActive(list[i].id);
  const tr = document.querySelector(`#ex-results tr.ex-tr[data-id="${list[i].id}"]`);
  if(tr && tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest' });
}

/* ---------- vista previa del PDF ---------- */
/* El PDF se descarga con tu sesión y se muestra desde la propia página: así se ve dentro del panel
   y el enlace no se puede compartir. Se guardan en memoria los últimos para no repetir descargas. */
async function examBlobUrl(e){
  const c = exm().blobs;
  if(c.has(e.id)){ const u = c.get(e.id); c.delete(e.id); c.set(e.id, u); return u; }
  const r = await supabaseClient.storage.from(EXAM_BUCKET).download(e.file_path);
  if(r.error || !r.data) throw (r.error || new Error('download'));
  const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
  c.set(e.id, url);
  while(c.size > 6){ const k = c.keys().next().value; try{ URL.revokeObjectURL(c.get(k)); }catch(err){} c.delete(k); }
  return url;
}
function examForgetBlob(id){
  const c = exm().blobs;
  if(c.has(id)){ try{ URL.revokeObjectURL(c.get(id)); }catch(err){} c.delete(id); }
}
function examCanEmbed(){
  return navigator.pdfViewerEnabled !== false && !(window.matchMedia && window.matchMedia('(max-width:760px)').matches);
}
/* Visor grande: el PDF a casi toda la pantalla. */
async function examExpand(id){
  const e = examById(id); if(!e) return;
  if(!examCanEmbed()){ await examDownload(id); return; }      // en móvil no hay visor incrustado: se descarga con su nombre
  examCloseViewer();
  const v = document.createElement('div');
  v.id = 'ex-viewer'; v.className = 'ex-viewer';
  v.innerHTML = `<div class="ex-viewer-bar"><strong>${esc(examUpper(e.title))}</strong>
    <button type="button" class="btn btn-ghost" data-v="download">${shellIcon('download')} Descargar</button>
    <button type="button" class="btn btn-primary" data-v="close" aria-label="Cerrar el visor">✕ Cerrar</button></div>
    <div class="ex-viewer-body"><div class="ex-prev-msg">${shellIcon('clock')}<strong>Cargando el PDF...</strong></div></div>`;
  v.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-v]');
    if(b && b.dataset.v === 'close') examCloseViewer();
    else if(b && b.dataset.v === 'download') examDownload(id, b);
    else if(ev.target === v) examCloseViewer();
  });
  document.body.appendChild(v);
  try{
    const url = await examBlobUrl(e);
    const body = v.querySelector('.ex-viewer-body');
    if(body) body.innerHTML = `<iframe class="ex-frame" src="${url}#toolbar=0&navpanes=0&view=FitH" title="${esc(examUpper(e.title))}"></iframe>`;
  }catch(err){
    const body = v.querySelector('.ex-viewer-body');
    if(body) body.innerHTML = `<div class="ex-prev-msg">${shellIcon('flag')}<strong>No se pudo cargar el PDF</strong></div>`;
  }
}
function examCloseViewer(){ const v = document.getElementById('ex-viewer'); if(v) v.remove(); }
async function examLoadPreview(e){
  const X = exm();
  const box = document.getElementById('ex-prev'); if(!box) return;
  const ic = (n) => shellIcon(n);
  X.prevId = e.id;
  const canEmbed = examCanEmbed();
  if(!canEmbed){
    box.innerHTML = `<div class="ex-prev-msg">${ic('file')}<strong>Vista previa no disponible aquí</strong><span>Abre el PDF para verlo.</span></div>`;
    return;
  }
  box.innerHTML = `<div class="ex-prev-msg">${ic('clock')}<strong>Cargando el PDF...</strong></div>`;
  try{
    const url = await examBlobUrl(e);
    if(X.active !== e.id || X.prevId !== e.id) return;
    box.innerHTML = `<iframe class="ex-frame" src="${url}#toolbar=0&navpanes=0&view=FitH" title="Vista previa de ${esc(examUpper(e.title))}"></iframe>
      <button type="button" class="ex-expand" data-exa="expand" data-id="${e.id}" title="Ver el PDF a pantalla grande" aria-label="Ampliar la vista previa">${ic('eye')} Ampliar</button>`;
  }catch(err){
    if(X.prevId !== e.id) return;
    box.innerHTML = `<div class="ex-prev-msg">${ic('flag')}<strong>No se pudo cargar el PDF</strong><button type="button" class="btn btn-ghost" data-exa="prev-retry" data-id="${e.id}">Reintentar</button></div>`;
  }
}
/* Nombre del archivo al descargar: el mismo título que se ve en la app (en mayúsculas). */
function examFileName(e){
  const base = examUpper(e.title).replace(/["<>*?\u0000-\u001f]/g, '').replace(/[\\/:|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  return (base || 'EXAMEN') + '.pdf';
}
async function examDownload(id, btn){
  const e = examById(id); if(!e) return;
  const label = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.textContent = 'Descargando...'; }
  try{
    const url = await examBlobUrl(e);
    const a = document.createElement('a');
    a.href = url; a.download = examFileName(e); a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
  }catch(err){ cmToast('No se pudo descargar el PDF. ' + examErr(err)); }
  finally{ if(btn && document.body.contains(btn)){ btn.disabled = false; btn.innerHTML = label; } }
}

/* ---------- pestaña ---------- */
function examQueueHtml(){
  const X = exm();
  if(!X.queue.length) return '';
  const mark = { wait: '○', up: '◔', ok: '✓', err: '✕' };
  return `<div class="ex-queue" id="ex-queue">${X.queue.map(q => `<div class="ex-q ${q.state}"><b>${mark[q.state] || '○'}</b><span>${esc(q.name)}</span><small>${esc(q.msg || ({ wait: 'En cola', up: 'Subiendo...', ok: 'Subido', err: 'Error' })[q.state])}</small></div>`).join('')}
    ${X.busy ? '' : `<button type="button" class="btn btn-ghost" data-action="committee-exam-queue-clear">Limpiar lista</button>`}</div>`;
}
function examTab(){
  const ic = (n) => shellIcon(n);
  const X = exm();
  if(X.files === null) return `<div class="ac-empty">${ic('clock')}<strong>Cargando...</strong></div>`;
  if(X.missing) return `<div class="tc-card"><div class="st-note">Para guardar los exámenes falta ejecutar una vez el SQL <b>exams.sql</b> en Supabase (SQL Editor).</div></div>`;
  const cats = COMMITTEE.categories || [];
  const seasons = X.seasons || [];
  const noSeasons = !seasons.length;
  const upOpen = !noSeasons && (X.upOpen === null ? !(X.files || []).length : X.upOpen);
  const manageOpen = noSeasons || X.manageOpen;
  const sugg = examNextSeasonName();
  const counts = {}, seasonCounts = {};
  (X.files || []).forEach(e => { if(e.category_id) counts[e.category_id] = (counts[e.category_id] || 0) + 1; seasonCounts[e.season_id] = (seasonCounts[e.season_id] || 0) + 1; });

  const upSeason = examUpSeason();
  const upPanel = upOpen ? `
  <div class="tc-card ex-panel">
    <div class="tc-card-head"><span class="tc-step">${ic('fileplus')}</span><div><h3>Subir exámenes</h3><small>Elige temporada y categoría, y arrastra los PDF o pulsa para elegirlos (máximo 30 MB cada uno). También puedes soltarlos en cualquier parte de la biblioteca.</small></div></div>
    <div class="ex-upload">
      <div><label for="ex-up-season">Temporada</label><select id="ex-up-season" data-cm-field="exams.up.season">${seasons.map(s => `<option value="${esc(s.id)}" ${s.id === upSeason ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div><label for="ex-up-cat">Categoría</label><select id="ex-up-cat" data-cm-field="exams.up.cat"><option value="">Sin categoría</option>${cats.map(c => `<option value="${esc(c.id)}" ${X.up.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label for="ex-up-date">Fecha del examen</label><input type="date" id="ex-up-date" data-cm-field="exams.up.date" value="${esc(X.up.date || examToday())}"></div>
      <div><label for="ex-up-title">Título <small class="cm-opt">(opcional, con un solo PDF)</small></label><input type="text" id="ex-up-title" data-cm-field="exams.up.title" value="${esc(X.up.title)}" maxlength="160" placeholder="Si lo dejas vacío, el nombre del archivo" autocomplete="off"></div>
    </div>
    <label class="ex-drop" id="ex-drop">
      <input type="file" id="ex-file" accept="application/pdf,.pdf" multiple ${X.busy ? 'disabled' : ''}>
      <span class="ex-drop-ic">${ic('fileplus')}</span>
      <strong id="ex-drop-text">Arrastra aquí los PDF o pulsa para elegirlos</strong>
      <small id="ex-drop-names">Con varios PDF, cada uno usa el nombre de su archivo como título.</small>
    </label>
    <div class="ex-up-actions">
      <button class="btn btn-primary" data-action="committee-exam-upload" ${X.busy ? 'disabled' : ''}>${ic('fileplus')} Subir</button>
    </div>
    ${examQueueHtml()}
  </div>` : '';

  const managePanel = manageOpen ? `
  <div class="tc-card ex-panel">
    <div class="tc-card-head"><span class="tc-step">${ic('folder')}</span><div><h3>Temporadas y categorías</h3><small>Las categorías son las mismas de los miembros del comité (también se editan en Configuración).</small></div></div>
    <div class="ex-manage">
      <div>
        <label for="ex-new-season" style="margin-top:0;">Nueva temporada</label>
        <div class="cs-add-row">
          <input type="text" id="ex-new-season" data-cm-field="exams.newSeason" value="${esc(X.newSeason)}" maxlength="40" placeholder="${esc(sugg || 'Ej.: 2026/2027')}" autocomplete="off">
          <button class="btn btn-primary" data-action="committee-exam-season-add">${ic('plus')} Crear</button>
        </div>
        ${seasons.length ? `<div class="ex-chiplist">${seasons.map(s => `<span class="ex-chip">${esc(s.name)} <em>${seasonCounts[s.id] || 0}</em>${seasonCounts[s.id] ? '' : `<button type="button" class="ex-chip-x" data-action="committee-exam-season-delete" data-id="${esc(s.id)}" title="Eliminar la temporada vacía" aria-label="Eliminar la temporada ${esc(s.name)}">×</button>`}</span>`).join('')}</div>` : ''}
      </div>
      <div>
        <label for="ex-new-cat" style="margin-top:0;">Nueva categoría</label>
        <div class="cs-add-row">
          <input type="text" id="ex-new-cat" data-cm-field="exams.newCat" value="${esc(X.newCat)}" maxlength="60" placeholder="Ej.: Juvenil" autocomplete="off">
          <button class="btn btn-primary" data-action="committee-exam-cat-add">${ic('plus')} Crear</button>
        </div>
        ${cats.length ? `<div class="ex-chiplist">${cats.map(c => `<span class="rkt-cat" style="--c:${esc(c.color)}">${esc(c.name)} · ${counts[c.id] || 0}</span>`).join('')}</div>` : ''}
      </div>
    </div>
    ${noSeasons ? `<div class="st-note" style="margin-top:12px;">Crea la primera temporada${sugg ? ' (por ejemplo ' + esc(sugg) + ')' : ''} para empezar a subir exámenes.</div>` : ''}
  </div>` : '';

  const seasonSel = `<option value="all" ${X.season === 'all' ? 'selected' : ''}>Todas las temporadas</option>` + seasons.map(s => `<option value="${esc(s.id)}" ${X.season === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const catSel = `<option value="all" ${X.cat === 'all' ? 'selected' : ''}>Todas las categorías</option><option value="none" ${X.cat === 'none' ? 'selected' : ''}>Sin categoría</option>` + cats.map(c => `<option value="${esc(c.id)}" ${X.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  return `
  <div id="ex-lib">
    <div class="ex-dropveil" aria-hidden="true"><div>${ic('fileplus')}<strong>Suelta los PDF para subirlos</strong><span>Se subirán a la temporada y categoría que tengas abiertas.</span></div></div>
    <div class="tx-toolbar">
      <div><div class="lg-section-head" style="margin:0;"><h2>Biblioteca de exámenes</h2><span id="ex-busy" class="ex-busy">${esc(X.busy)}</span></div></div>
      <div class="cm-actions">
        ${noSeasons ? '' : `<button class="btn ${upOpen ? 'btn-ghost' : 'btn-primary'}" data-action="committee-exam-panel-up">${ic('fileplus')} ${upOpen ? 'Cerrar subida' : 'Subir exámenes'}</button>`}
        ${noSeasons ? '' : `<button class="btn btn-ghost" data-action="committee-exam-panel-manage">${ic('folder')} Temporadas y categorías</button>`}
      </div>
    </div>
    ${upPanel}${managePanel}
    ${noSeasons ? '' : `
    <div id="ex-summary" class="ex-summary">${examSummaryHtml()}</div>
    <div class="ex-searchrow">
      <input type="text" id="ex-q" value="${esc(X.q)}" placeholder="Buscar en toda la biblioteca: título, categoría, temporada, fecha o notas..." aria-label="Buscar exámenes" autocomplete="off">
      <select id="ex-f-season" class="ex-mfilter" aria-label="Filtrar por temporada">${seasonSel}</select>
      <select id="ex-f-cat" class="ex-mfilter" aria-label="Filtrar por categoría">${catSel}</select>
    </div>
    <div class="ex-chips" id="ex-chips">${examChipsHtml()}</div>
    <div class="ex-hint">Atajos: <kbd>/</kbd> buscar · <kbd>↑</kbd><kbd>↓</kbd> moverte · <kbd>espacio</kbd> seleccionar · <kbd>D</kbd> marcar en la app · <kbd>Esc</kbd> cerrar</div>
    <div class="ex-layout ${X.active ? 'has-panel' : ''}" id="ex-layout">
      <nav class="ex-tree" id="ex-tree" aria-label="Estados, temporadas y categorías">${examTreeHtml()}</nav>
      <div class="ex-main"><div id="ex-results">${examResultsHtml()}</div></div>
      <aside class="ex-detail ${X.active ? 'open' : ''}" id="ex-detail" aria-label="Detalle del examen">
        <div id="ex-d-head"></div>
        <div id="ex-prev" class="ex-prev"></div>
        <div id="ex-d-body"></div>
      </aside>
    </div>`}
  </div>`;
}

/* ---------- escrituras ---------- */
/* Cambia datos de un examen: se ve al instante y se deshace si el servidor lo rechaza. */
async function examPatch(id, patch, quiet){
  const e = examById(id); if(!e) return false;
  const prev = {};
  Object.keys(patch).forEach(k => { prev[k] = e[k]; });
  Object.assign(e, patch); e._hay = null;
  const r = await examWrite(supabaseClient.from('exam_files').update(patch).eq('id', id));
  if(r.error){
    Object.assign(e, prev); e._hay = null;
    if(!quiet) examRefresh();
    cmToast(examErr(r.error));
    return false;
  }
  return true;
}
/* Marca varios (o uno) como "en la app" / "pendiente". */
async function examSetInApp(ids, on){
  const items = ids.map(examById).filter(e => e && !!e.in_app !== on);
  if(!items.length) return;
  const stamp = on ? new Date().toISOString() : null;
  const me = examMe();
  const prev = items.map(e => ({ e, in_app: e.in_app, in_app_at: e.in_app_at, by: e.in_app_by_name }));
  items.forEach(e => { e.in_app = on; e.in_app_at = stamp; e._hay = null; if(exm().v2) e.in_app_by_name = on ? me : null; });
  examRefresh(); examPanelSync();
  const patch = { in_app: on, in_app_at: stamp };
  if(exm().v2) patch.in_app_by_name = on ? me : null;
  const r = await examChunks(items.map(e => e.id), (chunk) => examWrite(supabaseClient.from('exam_files').update(patch).in('id', chunk)));
  if(r.error){
    prev.forEach(p => { p.e.in_app = p.in_app; p.e.in_app_at = p.in_app_at; p.e.in_app_by_name = p.by; p.e._hay = null; });
    examRefresh(); examPanelSync();
    cmToast(examErr(r.error));
  }
}
async function examDeleteMany(ids){
  const items = ids.map(examById).filter(Boolean);
  if(!items.length) return false;
  const rm = await supabaseClient.storage.from(EXAM_BUCKET).remove(items.map(e => e.file_path));
  if(rm.error){ cmToast(examErr(rm.error)); return false; }
  const r = await examChunks(items.map(e => e.id), (chunk) => examWrite(supabaseClient.from('exam_files').delete().in('id', chunk)));
  if(r.error){ cmToast(examErr(r.error)); return false; }
  items.forEach(e => { exm().sel.delete(e.id); examForgetBlob(e.id); if(exm().active === e.id) exm().active = null; });
  return true;
}
/* Mueve varios de categoría y/o temporada (desde la barra de selección o arrastrando al árbol). */
async function examMove(ids, change){
  const X = exm();
  const items = ids.map(examById).filter(Boolean);
  if(!items.length) return;
  const patch = {};
  if('category_id' in change) patch.category_id = change.category_id;
  if('season_id' in change) patch.season_id = change.season_id;
  const r = await examChunks(items.map(e => e.id), (chunk) => examWrite(supabaseClient.from('exam_files').update(patch).in('id', chunk)));
  if(r.error){ cmToast(examErr(r.error)); return; }
  items.forEach(e => { Object.assign(e, patch); e._hay = null; });
  STATE.toast = items.length + (items.length === 1 ? ' examen movido.' : ' exámenes movidos.');
  examRender();
}

/* ---------- subida ---------- */
function examQueueRender(){
  const el = document.getElementById('ex-queue');
  if(el) el.outerHTML = examQueueHtml();
  const b = document.getElementById('ex-busy'); if(b) b.textContent = exm().busy;
}
async function examUploadFiles(files, ctx){
  const X = exm();
  const sid = ctx.season;
  if(!sid){ cmToast('Crea primero una temporada.'); return; }
  if(!files.length){ cmToast('Elige uno o varios PDF.'); return; }
  const notPdf = files.find(f => f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name));
  if(notPdf){ cmToast('«' + notPdf.name + '» no es un PDF.'); return; }
  const big = files.find(f => f.size > EXAM_MAX_BYTES);
  if(big){ cmToast('«' + big.name + '» pesa más de 30 MB.'); return; }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.date) ? ctx.date : examToday();
  const cat = ctx.cat || null;
  const single = files.length === 1 ? String(ctx.title || '').trim() : '';
  let ok = 0, lastErr = null;
  const paths = [];
  X.queue = files.map(f => ({ name: f.name, state: 'wait', msg: '' }));
  X.busy = 'Subiendo 0 de ' + files.length + '...';
  examRender();
  for(let i = 0; i < files.length; i++){
    const f = files[i], q = X.queue[i];
    q.state = 'up'; X.busy = 'Subiendo ' + (i + 1) + ' de ' + files.length + '...'; examQueueRender();
    const path = sid + '/' + examUuid() + '.pdf';
    const up = await supabaseClient.storage.from(EXAM_BUCKET).upload(path, f, { contentType: 'application/pdf', upsert: false });
    if(up.error){ q.state = 'err'; q.msg = examErr(up.error); lastErr = up.error; examQueueRender(); continue; }
    const title = examUpper((single || f.name.replace(/\.pdf$/i, '')).trim()).slice(0, 160) || 'EXAMEN';
    const row = { season_id: sid, category_id: cat, title, exam_date: date, file_path: path, file_name: f.name, file_size: f.size };
    if(X.v2) row.created_by_name = examMe();
    const ins = await examWrite(supabaseClient.from('exam_files').insert(row));
    if(ins.error){
      await supabaseClient.storage.from(EXAM_BUCKET).remove([path]);
      q.state = 'err'; q.msg = examErr(ins.error); lastErr = ins.error; examQueueRender(); continue;
    }
    q.state = 'ok'; paths.push(path); ok++; examQueueRender();
  }
  X.busy = '';
  if(ok){
    X.up.title = '';
    // para que se vea lo recién subido: sin filtros que lo escondan y resaltado
    X.q = ''; X.status = 'all'; X.quick = '';
    if(X.season !== 'all' && X.season !== sid) X.season = 'all';
    if(X.cat !== 'all' && X.cat !== (cat || 'none')) X.cat = 'all';
  }
  await examLoad();
  X.fresh = new Set((X.files || []).filter(e => paths.indexOf(e.file_path) >= 0).map(e => e.id));
  const failed = files.length - ok;
  STATE.toast = failed ? ((ok ? ok + ' subido' + (ok === 1 ? '' : 's') + '. ' : '') + failed + ' con error. ' + examErr(lastErr)) : (ok === 1 ? 'Examen subido.' : ok + ' exámenes subidos.');
  examRender();
}
async function examUpload(){
  const X = exm();
  const inp = document.getElementById('ex-file');
  const files = inp ? Array.from(inp.files || []) : [];
  await examUploadFiles(files, { season: examUpSeason(), cat: X.up.cat, date: X.up.date, title: X.up.title });
}
/* PDF soltados sobre la biblioteca: si hay temporada y categoría abiertas se suben directos; si no, se pide elegirlas. */
async function examDropped(files){
  const X = exm();
  files = files.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if(!files.length){ cmToast('Solo se pueden subir archivos PDF.'); return; }
  if(X.season !== 'all' && X.cat !== 'all'){
    await examUploadFiles(files, { season: X.season, cat: X.cat === 'none' ? null : X.cat, date: X.up.date, title: '' });
    return;
  }
  X.pendingFiles = files; X.upOpen = true;
  if(X.season !== 'all') X.up.season = X.season;
  if(X.cat !== 'all') X.up.cat = X.cat === 'none' ? '' : X.cat;
  STATE.toast = 'Elige temporada y categoría y pulsa «Subir».';
  examRender();
}

/* ---------- acciones ---------- */
async function examOnAction(action, el){
  const X = exm();
  if(!isDevUser()) return;
  const id = el && el.dataset ? el.dataset.id : '';
  const a = action.replace('committee-exam-', '');
  if(a === 'upload'){ await examUpload(); }
  else if(a === 'queue-clear'){ X.queue = []; examRender(); }
  else if(a === 'expand'){ await examExpand(id); }
  else if(a === 'download'){ await examDownload(id, el); }
  else if(a === 'prev-retry'){ const e = examById(id); if(e) examLoadPreview(e); }
  else if(a === 'pill'){ const e = examById(id); if(e) await examSetInApp([e.id], !e.in_app); }
  else if(a === 'set-done'){ await examSetInApp([id], true); }
  else if(a === 'set-pending'){ await examSetInApp([id], false); }
  else if(a === 't-status'){ X.status = el.dataset.s; X.limit = EXAM_PAGE; examRefresh(); }
  else if(a === 't-season'){
    X.season = id; X.cat = 'all'; X.limit = EXAM_PAGE;
    if(id !== 'all') X.treeOpen.add(id);
    examRefresh();
  }
  else if(a === 't-cat'){ X.season = id; X.cat = el.dataset.cat; X.treeOpen.add(id); X.limit = EXAM_PAGE; examRefresh(); }
  else if(a === 't-toggle'){
    const open = X.treeOpen.has(id) || X.season === id;
    if(open){ X.treeOpen.delete(id); if(X.season === id){ X.season = 'all'; X.cat = 'all'; } } else X.treeOpen.add(id);
    examRefresh();
  }
  else if(a === 'quick'){ X.quick = X.quick === el.dataset.k ? '' : el.dataset.k; X.limit = EXAM_PAGE; examRefresh(); }
  else if(a === 'view-start'){ X.savingView = true; examRefresh(); const i = document.getElementById('ex-viewname'); if(i) i.focus(); }
  else if(a === 'view-cancel'){ X.savingView = false; examRefresh(); }
  else if(a === 'view-save'){
    const i = document.getElementById('ex-viewname');
    const name = i ? i.value.trim() : '';
    if(!name){ cmToast('Ponle un nombre a la vista.'); return; }
    X.views.push({ name, q: X.q, season: X.season, cat: X.cat, status: X.status, quick: X.quick, sortKey: X.sortKey, sortDir: X.sortDir });
    X.savingView = false; examSaveViews(); examRefresh();
  }
  else if(a === 'view-apply'){
    const v = X.views[parseInt(el.dataset.i, 10)]; if(!v) return;
    X.q = v.q || ''; X.cat = v.cat || 'all'; X.status = v.status || 'all'; X.quick = v.quick || '';
    X.season = (v.season === 'all' || (X.seasons || []).some(s => s.id === v.season)) ? v.season : 'all';
    X.sortKey = v.sortKey || 'date'; X.sortDir = v.sortDir || 'desc'; X.limit = EXAM_PAGE;
    examRender();
  }
  else if(a === 'view-del'){ X.views.splice(parseInt(el.dataset.i, 10), 1); examSaveViews(); examRefresh(); }
  else if(a === 'sort'){
    const k = el.dataset.key;
    if(X.sortKey === k) X.sortDir = X.sortDir === 'asc' ? 'desc' : 'asc';
    else { X.sortKey = k; X.sortDir = k === 'date' ? 'desc' : 'asc'; }
    examRefresh();
  }
  else if(a === 'more'){ X.limit += EXAM_PAGE; examRefresh(); }
  else if(a === 'clear'){ X.q = ''; X.season = 'all'; X.cat = 'all'; X.status = 'all'; X.quick = ''; X.limit = EXAM_PAGE; examRender(); }
  else if(a === 'd-close'){ examClosePanel(); }
  else if(a === 'd-prev'){ examMoveActive(-1); }
  else if(a === 'd-next'){ examMoveActive(1); }
  else if(a === 'edit'){
    const e = examById(id); if(!e) return;
    X.edit = { id: e.id, title: e.title, date: e.exam_date || '', cat: e.category_id || '', season: e.season_id };
    examPanelSync();
    const t = document.getElementById('ex-e-title'); if(t){ t.focus(); t.select(); }
  }
  else if(a === 'cancel'){ X.edit = null; examPanelSync(); }
  else if(a === 'save'){
    const e = examById(id); if(!e || !X.edit) return;
    const title = X.edit.title.trim();
    if(!title){ cmToast('Escribe un título.'); return; }
    const patch = { title: examUpper(title).slice(0, 160), exam_date: X.edit.date || null, category_id: X.edit.cat || null, season_id: X.edit.season || e.season_id };
    X.edit = null;
    if(await examPatch(id, patch)){ examRefresh(); examPanelSync(); }
    else examPanelSync();
  }
  else if(a === 'delete'){
    const e = examById(id); if(!e) return;
    const ok = await appConfirm({ title: 'Eliminar el examen', message: `Se borrará «${examUpper(e.title)}» y su PDF. No se puede deshacer.`, confirmText: 'Eliminar', danger: true });
    if(!ok) return;
    if(!(await examDeleteMany([e.id]))) return;
    await examLoad();
    STATE.toast = 'Examen eliminado.'; examRender();
  }
  else if(a === 'bulk-in'){ await examSetInApp(Array.from(X.sel), true); }
  else if(a === 'bulk-out'){ await examSetInApp(Array.from(X.sel), false); }
  else if(a === 'bulk-clear'){ X.sel.clear(); examSyncSelection(); }
  else if(a === 'bulk-move'){
    const s = document.getElementById('ex-bulk-cat');
    const v = s ? s.value : '';
    if(!v){ cmToast('Elige a qué categoría moverlos.'); return; }
    await examMove(Array.from(X.sel), { category_id: v === 'none' ? null : v });
  }
  else if(a === 'bulk-delete'){
    const ids = Array.from(X.sel); if(!ids.length) return;
    const ok = await appConfirm({ title: 'Eliminar los seleccionados', message: `Se borrarán ${ids.length} ${ids.length === 1 ? 'examen y su PDF' : 'exámenes y sus PDF'}. No se puede deshacer.`, confirmText: 'Eliminar', danger: true });
    if(!ok) return;
    const done = await examDeleteMany(ids);
    await examLoad();
    STATE.toast = done ? (ids.length === 1 ? 'Examen eliminado.' : ids.length + ' exámenes eliminados.') : 'No se pudieron eliminar todos.'; examRender();
  }
  else if(a === 'panel-up'){ X.upOpen = !(X.upOpen === null ? !(X.files || []).length : X.upOpen); examRender(); }
  else if(a === 'panel-manage'){ X.manageOpen = !X.manageOpen; examRender(); }
  else if(a === 'season-add'){
    const name = (X.newSeason.trim() || examNextSeasonName()).trim();
    if(!name){ cmToast('Escribe el nombre de la temporada.'); return; }
    const r = await examWrite(supabaseClient.from('exam_seasons').insert({ name }).select().single());
    if(r.error){ cmToast(examErr(r.error)); return; }
    X.newSeason = '';
    await examLoad();
    X.up.season = r.data.id;
    STATE.toast = 'Temporada ' + name + ' creada.'; examRender();
  }
  else if(a === 'season-delete'){
    const s = (X.seasons || []).find(x => x.id === id); if(!s) return;
    const n = (X.files || []).filter(e => e.season_id === s.id).length;
    if(n){ cmToast('La temporada ' + s.name + ' tiene ' + n + (n === 1 ? ' examen' : ' exámenes') + '. Elimínalos antes de borrarla.'); return; }
    const ok = await appConfirm({ title: 'Eliminar la temporada', message: `Se borrará la temporada ${s.name}, que está vacía.`, confirmText: 'Eliminar', danger: true });
    if(!ok) return;
    const r = await examWrite(supabaseClient.from('exam_seasons').delete().eq('id', s.id));
    if(r.error){ cmToast(examErr(r.error)); return; }
    if(X.up.season === s.id) X.up.season = '';
    await examLoad();
    STATE.toast = 'Temporada eliminada.'; examRender();
  }
  else if(a === 'cat-add'){
    const name = X.newCat.trim();
    if(!name){ cmToast('Escribe el nombre de la categoría.'); return; }
    const cats = COMMITTEE.categories || [];
    const pos = cats.reduce((mx, c) => Math.max(mx, c.position || 0), 0) + 1;
    const color = CM_CAT_COLORS[cats.length % CM_CAT_COLORS.length];
    const r = await supabaseClient.from('committee_member_categories').insert({ name, color, position: pos }).select().single();
    if(r.error){
      cmToast(/duplicate|23505/i.test((r.error.message || '') + (r.error.code || '')) ? 'Ya existe una categoría con ese nombre.' : cmErrText(r.error));
      return;
    }
    X.newCat = '';
    X.up.cat = r.data.id;
    await cmLoadCategories();
    STATE.toast = 'Categoría creada.'; examRender();
  }
}

/* ---------- eventos tras pintar ---------- */
function examIsTyping(){
  const a = document.activeElement;
  return !!(a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable));
}
function examKeydown(ev){
  const X = exm();
  if(!document.getElementById('ex-lib') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key;
  if(document.getElementById('ex-viewer')){ if(k === 'Escape'){ ev.preventDefault(); examCloseViewer(); } return; }
  if(document.querySelector('.modal-backdrop')) return;
  if(k === 'Escape'){
    if(examIsTyping()){ document.activeElement.blur(); return; }
    if(X.active){ examClosePanel(); ev.preventDefault(); } else if(X.sel.size){ X.sel.clear(); examSyncSelection(); }
    return;
  }
  if(examIsTyping()) return;
  if(k === '/'){ const q = document.getElementById('ex-q'); if(q){ ev.preventDefault(); q.focus(); q.select(); } }
  else if(k === 'ArrowDown' || k === 'j'){ ev.preventDefault(); examMoveActive(1); }
  else if(k === 'ArrowUp' || k === 'k'){ ev.preventDefault(); examMoveActive(-1); }
  else if((k === ' ' || k === 'x') && X.active){
    ev.preventDefault();
    if(X.sel.has(X.active)) X.sel.delete(X.active); else X.sel.add(X.active);
    examSyncSelection();
  }
  else if((k === 'd' || k === 'D') && X.active){ const e = examById(X.active); if(e){ ev.preventDefault(); examSetInApp([e.id], !e.in_app); } }
  else if(k === 'Enter' && X.active){ examPanelSync(); }
}
function examAfterRender(){
  const X = exm();
  const lib = document.getElementById('ex-lib');
  if(!lib) return;
  if(!X.rt.kb){ X.rt.kb = true; document.addEventListener('keydown', examKeydown); }

  // clics: botones de la lista, el árbol y el panel (se atienden desde aquí porque esas zonas se repintan solas)
  lib.addEventListener('click', (ev) => {
    const t = ev.target;
    if(t.dataset && t.dataset.exSel){
      // Mayús + casilla: selecciona todo el rango entre la última casilla pulsada y esta
      if(ev.shiftKey && X.lastSel && X.lastSel !== t.dataset.exSel){
        const ids = examVisible().map(e => e.id);
        const a = ids.indexOf(X.lastSel), b = ids.indexOf(t.dataset.exSel);
        if(a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(i => { if(t.checked) X.sel.add(i); else X.sel.delete(i); });
      }
      X.lastSel = t.dataset.exSel;
      return;
    }
    const b = t.closest('[data-exa]');
    if(b && lib.contains(b)){ ev.preventDefault(); examOnAction('committee-exam-' + b.dataset.exa, b); return; }
    const tr = t.closest('tr.ex-tr');
    if(tr && lib.contains(tr) && !t.closest('input,button,a,select,label')) examSetActive(tr.dataset.id);
  });
  lib.addEventListener('change', (ev) => {
    const t = ev.target;
    if(t.dataset && t.dataset.exSel){
      if(t.checked) X.sel.add(t.dataset.exSel); else X.sel.delete(t.dataset.exSel);
      examSyncSelection();
    } else if(t.hasAttribute && t.hasAttribute('data-ex-selall')){
      const list = examVisible();
      if(t.checked) list.forEach(e => X.sel.add(e.id)); else list.forEach(e => X.sel.delete(e.id));
      examSyncSelection();
    } else if(t.dataset && t.dataset.exEdit && X.edit){
      X.edit[t.dataset.exEdit] = t.value;
    }
  });
  lib.addEventListener('input', (ev) => {
    const t = ev.target;
    if(t.dataset && t.dataset.exEdit && X.edit) X.edit[t.dataset.exEdit] = t.value;
    else if(t.dataset && t.dataset.exNotes !== undefined && X.active){
      const id = X.active, v = t.value;
      const sv = document.getElementById('ex-saved'); if(sv) sv.textContent = 'Guardando...';
      clearTimeout(X.rt.notesT);
      X.rt.notesT = setTimeout(async () => {
        const ok = await examPatch(id, { notes: v.trim() ? v : null }, true);
        const s2 = document.getElementById('ex-saved'); if(s2) s2.textContent = ok ? 'Guardado' : 'No se pudo guardar';
      }, 700);
    }
  });
  lib.addEventListener('keydown', (ev) => {
    if(ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.exViewname !== undefined){ ev.preventDefault(); examOnAction('committee-exam-view-save', ev.target); }
  });
  const q = document.getElementById('ex-q');
  if(q) q.addEventListener('input', () => { X.q = q.value; X.limit = EXAM_PAGE; examRefresh(); });
  const fs = document.getElementById('ex-f-season');
  if(fs) fs.addEventListener('change', () => { X.season = fs.value; X.cat = 'all'; X.limit = EXAM_PAGE; examRefresh(); });
  const fc = document.getElementById('ex-f-cat');
  if(fc) fc.addEventListener('change', () => { X.cat = fc.value; X.limit = EXAM_PAGE; examRefresh(); });

  // zona de subida: muestra qué archivos hay elegidos
  const file = document.getElementById('ex-file');
  const showNames = () => {
    const names = file ? Array.from(file.files || []).map(f => f.name) : [];
    const t = document.getElementById('ex-drop-text'), n = document.getElementById('ex-drop-names');
    if(t) t.textContent = names.length ? (names.length === 1 ? '1 PDF listo para subir' : names.length + ' PDF listos para subir') : 'Arrastra aquí los PDF o pulsa para elegirlos';
    if(n) n.textContent = names.length ? names.join(' · ') : 'Con varios PDF, cada uno usa el nombre de su archivo como título.';
  };
  if(file){
    file.addEventListener('change', showNames);
    if(X.pendingFiles){
      try{ const dt = new DataTransfer(); X.pendingFiles.forEach(f => dt.items.add(f)); file.files = dt.files; }catch(e){}
      X.pendingFiles = null; showNames();
    }
  }
  const drop = document.getElementById('ex-drop');
  if(drop){
    ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, () => drop.classList.add('over')));
    ['dragleave', 'drop'].forEach(n => drop.addEventListener(n, () => drop.classList.remove('over')));
  }

  // arrastrar PDF desde el escritorio sobre cualquier parte de la biblioteca
  let depth = 0;
  const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf('Files') >= 0;
  lib.addEventListener('dragenter', (ev) => { if(hasFiles(ev) && !ev.target.closest('#ex-drop')){ depth++; lib.classList.add('ex-dropping'); } });
  lib.addEventListener('dragleave', (ev) => { if(hasFiles(ev)){ depth = Math.max(0, depth - 1); if(!depth) lib.classList.remove('ex-dropping'); } });
  lib.addEventListener('dragover', (ev) => {
    if(hasFiles(ev) && !ev.target.closest('#ex-drop')){ ev.preventDefault(); return; }
    // arrastrar exámenes de la lista sobre el árbol
    const node = ev.target.closest('[data-drop-status],[data-drop-season]');
    if(node && ev.dataTransfer && Array.from(ev.dataTransfer.types || []).indexOf('application/x-exam-ids') >= 0){
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
      lib.querySelectorAll('.ex-tn.over').forEach(n => { if(n !== node) n.classList.remove('over'); });
      node.classList.add('over');
    }
  });
  lib.addEventListener('drop', (ev) => {
    depth = 0; lib.classList.remove('ex-dropping');
    lib.querySelectorAll('.ex-tn.over').forEach(n => n.classList.remove('over'));
    if(hasFiles(ev)){
      if(ev.target.closest('#ex-drop')) return;
      ev.preventDefault();
      examDropped(Array.from(ev.dataTransfer.files || []));
      return;
    }
    const raw = ev.dataTransfer && ev.dataTransfer.getData('application/x-exam-ids');
    const node = ev.target.closest('[data-drop-status],[data-drop-season]');
    if(!raw || !node) return;
    ev.preventDefault();
    let ids = []; try{ ids = JSON.parse(raw); }catch(e){}
    if(!ids.length) return;
    if(node.dataset.dropStatus){ if(node.dataset.dropStatus !== 'all') examSetInApp(ids, node.dataset.dropStatus === 'done'); return; }
    const change = { season_id: node.dataset.dropSeason };
    if(node.dataset.dropCat !== undefined) change.category_id = node.dataset.dropCat === 'none' ? null : node.dataset.dropCat;
    examMove(ids, change);
  });
  // arrastrar filas hacia el árbol (mover de categoría / temporada o marcar como en la app)
  lib.addEventListener('dragstart', (ev) => {
    const tr = ev.target.closest && ev.target.closest('tr.ex-tr'); if(!tr) return;
    const id = tr.dataset.id;
    const ids = X.sel.has(id) ? Array.from(X.sel) : [id];
    ev.dataTransfer.setData('application/x-exam-ids', JSON.stringify(ids));
    ev.dataTransfer.setData('text/plain', ids.length + (ids.length === 1 ? ' examen' : ' exámenes'));
    ev.dataTransfer.effectAllowed = 'move';
    lib.classList.add('ex-dragging');
  });
  lib.addEventListener('dragend', () => { lib.classList.remove('ex-dragging'); lib.querySelectorAll('.ex-tn.over').forEach(n => n.classList.remove('over')); });

  examPanelSync();
}
