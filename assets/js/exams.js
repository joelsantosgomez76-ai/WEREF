/* ---------------- CTA BAGES · Biblioteca de exámenes ----------------
   Panel de Formación → pestaña "Exámenes": una sola lista con todos los exámenes en PDF de todas las
   temporadas. Se busca al momento, se filtra por temporada, categoría y estado, y se marca cuáles ya están
   pasados a la app / base de datos. Se pueden marcar varios a la vez. Las categorías son las mismas de los
   miembros del comité (Configuración). Los PDF viven en un almacén privado de Supabase (solo administración).
   Toda la seguridad está en supabase/exams.sql.
   Depende de committee.js (COMMITTEE, cm*) y de app.js (esc, appConfirm). */

COMMITTEE.exams = {
  seasons: null,         // exam_seasons
  files: null,           // exam_files
  missing: false,        // falta ejecutar el SQL
  q: '',                 // búsqueda
  season: 'all',         // filtro: all / id de temporada
  cat: 'all',            // filtro: all / none / id de categoría
  status: 'all',         // filtro: all / pending / done
  sortKey: 'date',       // status / title / cat / season / date / size
  sortDir: 'desc',
  limit: 60,             // filas que se pintan (hay botón "Mostrar más")
  sel: new Set(),        // ids seleccionados
  fresh: new Set(),      // ids recién subidos (se resaltan)
  upOpen: null,          // panel de subida: null = automático (abierto si la biblioteca está vacía)
  manageOpen: false,     // panel de temporadas y categorías
  up: { season: '', cat: '', date: '', title: '' },
  newSeason: '',
  newCat: '',
  edit: null,            // { id, title, date, cat, season }
  busy: ''               // texto de progreso mientras se sube
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
function examErr(err){
  const m = String((err && (err.message || err.code)) || err || '');
  if(/exam_seasons|exam_files|Bucket not found|PGRST20[25]|42P01|schema cache/i.test(m)) return 'Falta ejecutar el SQL de exámenes (exams.sql) en Supabase.';
  if(/23505|duplicate/i.test(m)) return 'Ya existe una temporada con ese nombre.';
  if(/exceeded|too large|413|maximum allowed/i.test(m)) return 'El archivo es demasiado grande (máximo 30 MB).';
  return cmErrText(err);
}
/* Cambia toda la pantalla sin perder el punto donde estabas. */
function examRender(){ const y = window.scrollY; render(); window.scrollTo(0, y); }
/* Cambia solo el resumen y la lista (no toca el buscador ni los filtros: no se pierde lo que se escribe). */
function examRefresh(){
  examPruneSel();
  const s = document.getElementById('ex-summary'); if(s) s.innerHTML = examSummaryHtml();
  const r = document.getElementById('ex-results'); if(r) r.innerHTML = examResultsHtml();
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
function examSeasonName(id){ const s = (exm().seasons || []).find(x => x.id === id); return s ? s.name : '—'; }
function examById(id){ return (exm().files || []).find(x => x.id === id); }
async function examChunks(ids, fn){
  for(let i = 0; i < ids.length; i += 100){
    const r = await fn(ids.slice(i, i + 100));
    if(r && r.error) return r;
  }
  return { error: null };
}

/* ---------- carga ---------- */
async function examLoad(){
  const X = exm();
  X.fresh = new Set();
  try{
    const [s, f] = await Promise.all([
      supabaseClient.from('exam_seasons').select('*').order('name', { ascending: false }),
      supabaseClient.from('exam_files').select('*').order('exam_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    ]);
    if(s.error || f.error){ X.seasons = []; X.files = []; X.missing = true; return; }
    X.missing = false;
    X.seasons = s.data || [];
    X.files = f.data || [];
  }catch(e){ X.seasons = []; X.files = []; X.missing = true; }
  const ids = new Set(X.files.map(e => e.id));
  X.sel.forEach(id => { if(!ids.has(id)) X.sel.delete(id); });
  if(X.season !== 'all' && !X.seasons.some(s => s.id === X.season)) X.season = 'all';
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

/* ---------- búsqueda, filtros y orden ---------- */
function examHay(e){
  const cat = cmCatById(e.category_id);
  return cmPlain([e.title, e.file_name, cat ? cat.name : '', examSeasonName(e.season_id), examFmtDate(e.exam_date), e.exam_date || ''].join(' '));
}
/* Lo que cumple buscador + temporada + categoría (sin mirar el estado, para poder contar los estados). */
function examBase(){
  const X = exm();
  const terms = cmPlain(X.q).split(/\s+/).filter(Boolean);
  return (X.files || []).filter(e => {
    if(X.season !== 'all' && e.season_id !== X.season) return false;
    if(X.cat === 'none' && e.category_id) return false;
    if(X.cat !== 'all' && X.cat !== 'none' && e.category_id !== X.cat) return false;
    if(terms.length){ const hay = examHay(e); if(!terms.every(t => hay.indexOf(t) >= 0)) return false; }
    return true;
  });
}
function examVisible(){
  const X = exm();
  const list = examBase().filter(e => X.status === 'all' || (X.status === 'done' ? e.in_app : !e.in_app));
  const key = X.sortKey, dir = X.sortDir;
  const val = (e) => {
    if(key === 'status') return e.in_app ? 1 : 0;
    if(key === 'title') return cmPlain(e.title);
    if(key === 'cat') return cmCatRank(e.category_id);
    if(key === 'season') return cmPlain(examSeasonName(e.season_id));
    if(key === 'size') return e.file_size || null;
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
  return !!(X.q.trim() || X.season !== 'all' || X.cat !== 'all' || X.status !== 'all');
}

/* ---------- piezas de la lista ---------- */
function examSummaryHtml(){
  const X = exm();
  const all = X.files || [];
  const done = all.filter(e => e.in_app).length, pending = all.length - done;
  const pct = all.length ? Math.round(done / all.length * 100) : 0;
  return `<div class="ex-summary">
    <button type="button" class="ex-sum" data-exa="status" data-s="all"><b>${all.length}</b><span>en la biblioteca</span></button>
    <button type="button" class="ex-sum ok" data-exa="status" data-s="done"><b>${done}</b><span>en la app</span></button>
    <button type="button" class="ex-sum bad" data-exa="status" data-s="pending"><b>${pending}</b><span>pendientes</span></button>
    <div class="ex-sum-bar" title="${pct}% ya está en la app"><i style="width:${pct}%"></i><em>${pct}% en la app</em></div>
  </div>`;
}
function examEditRowHtml(e){
  const ic = (n) => shellIcon(n);
  const X = exm();
  const catOpts = '<option value="">Sin categoría</option>' + (COMMITTEE.categories || []).map(c => `<option value="${esc(c.id)}" ${X.edit.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const seasonOpts = (X.seasons || []).map(s => `<option value="${esc(s.id)}" ${X.edit.season === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<tr class="ex-editrow"><td colspan="8">
    <div class="ex-edit">
      <div><label for="ex-e-title">Título</label><input type="text" id="ex-e-title" data-ex-edit="title" value="${esc(examUpper(X.edit.title))}" maxlength="160" autocomplete="off"></div>
      <div><label for="ex-e-season">Temporada</label><select id="ex-e-season" data-ex-edit="season">${seasonOpts}</select></div>
      <div><label for="ex-e-cat">Categoría</label><select id="ex-e-cat" data-ex-edit="cat">${catOpts}</select></div>
      <div><label for="ex-e-date">Fecha</label><input type="date" id="ex-e-date" data-ex-edit="date" value="${esc(X.edit.date)}"></div>
    </div>
    <div class="ex-edit-actions">
      <button type="button" class="btn btn-primary" data-exa="save" data-id="${e.id}">${ic('check')} Guardar</button>
      <button type="button" class="btn btn-ghost" data-exa="cancel">Cancelar</button>
    </div>
  </td></tr>`;
}
function examRowHtml(e){
  const ic = (n) => shellIcon(n);
  const X = exm();
  if(X.edit && X.edit.id === e.id) return examEditRowHtml(e);
  const cat = cmCatById(e.category_id);
  const picked = X.sel.has(e.id);
  const title = examUpper(e.title);
  return `<tr class="ex-tr ${e.in_app ? 'done' : ''} ${X.fresh.has(e.id) ? 'fresh' : ''} ${picked ? 'picked' : ''}">
    <td class="ex-c-sel"><input type="checkbox" data-ex-sel="${e.id}" ${picked ? 'checked' : ''} aria-label="Seleccionar ${esc(title)}"></td>
    <td class="ex-c-state"><button type="button" class="ex-toggle ${e.in_app ? 'on' : ''}" data-exa="toggle" data-id="${e.id}" aria-pressed="${e.in_app ? 'true' : 'false'}" title="${e.in_app ? 'Pulsa para marcarlo como pendiente' : 'Pulsa cuando ya esté pasado a la app / base de datos'}">${ic(e.in_app ? 'check' : 'clock')}<span>${e.in_app ? 'En la app' : 'Pendiente'}</span></button></td>
    <td class="ex-c-title"><strong title="${esc(title)}">${esc(title)}</strong>${e.in_app && e.in_app_at ? `<small>En la app desde el ${esc(examFmtDateTime(e.in_app_at))}</small>` : ''}</td>
    <td data-label="Categoría">${cat ? `<span class="rkt-cat" style="--c:${esc(cat.color)}">${esc(cat.name)}</span>` : '<span class="mb-none">—</span>'}</td>
    <td data-label="Temporada">${esc(examSeasonName(e.season_id))}</td>
    <td data-label="Fecha">${esc(examFmtDate(e.exam_date))}</td>
    <td data-label="Tamaño">${esc(examFmtSize(e.file_size))}</td>
    <td class="ex-c-act">
      <button type="button" class="btn btn-ghost" data-exa="view" data-id="${e.id}">${ic('eye')} Ver PDF</button>
      <button type="button" class="tx-icon" data-exa="edit" data-id="${e.id}" title="Editar título, fecha, categoría o temporada" aria-label="Editar">${ic('pencil')}</button>
      <button type="button" class="tx-icon danger" data-exa="delete" data-id="${e.id}" title="Eliminar examen" aria-label="Eliminar examen">${ic('trash')}</button>
    </td>
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
  const base = examBase();
  const nDone = base.filter(e => e.in_app).length, nPend = base.length - nDone;
  const list = examVisible();
  const seg = (k, label, n) => `<button type="button" class="db-status ${X.status === k ? 'active' : ''}" data-exa="status" data-s="${k}">${label}<em>${n}</em></button>`;
  const head = `<div class="ex-bar">
    <div class="ex-seg">${seg('all', 'Todos', base.length)}${seg('pending', 'Pendientes', nPend)}${seg('done', 'En la app', nDone)}</div>
    <small class="ex-count">${list.length === (X.files || []).length ? list.length + (list.length === 1 ? ' examen' : ' exámenes') : list.length + ' de ' + (X.files || []).length + ' exámenes'}</small>
    ${examFiltersActive() ? `<button type="button" class="btn btn-ghost ex-clear" data-exa="clear">${ic('trash')} Limpiar filtros</button>` : ''}
  </div>`;
  if(!list.length){
    const any = (X.files || []).length;
    return head + `<div id="ex-bulkbar"></div>` + `<div class="ac-empty" style="padding:26px 14px;">${ic('file')}<strong>${any ? 'Ningún examen con esos filtros' : 'Todavía no hay exámenes en la biblioteca'}</strong><span>${any ? 'Prueba a quitar algún filtro o a cambiar la búsqueda.' : 'Sube el primero con el botón «Subir exámenes».'}</span></div>`;
  }
  const key = X.sortKey, dir = X.sortDir;
  const th = (k, label) => `<th><button type="button" class="mb-sortbtn ${key === k ? 'on' : ''}" data-exa="sort" data-key="${k}">${label}<span class="mb-arrow">${key === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
  const allPicked = list.every(e => X.sel.has(e.id));
  const shown = list.slice(0, X.limit);
  return head + `<div id="ex-bulkbar">${examBulkHtml()}</div>` + `<div class="ex-tablewrap"><table class="ex-table">
    <thead><tr class="ex-th">
      <th class="ex-c-sel"><input type="checkbox" data-ex-selall ${allPicked ? 'checked' : ''} aria-label="Seleccionar los ${list.length} que cumplen los filtros" title="Seleccionar los ${list.length} que cumplen los filtros"></th>
      ${th('status', 'Estado')}${th('title', 'Título')}${th('cat', 'Categoría')}${th('season', 'Temporada')}${th('date', 'Fecha')}${th('size', 'Tamaño')}<th></th>
    </tr></thead>
    <tbody>${shown.map(examRowHtml).join('')}</tbody>
  </table></div>
  ${list.length > shown.length ? `<div class="ex-more"><button type="button" class="btn btn-ghost" data-exa="more">Mostrar más (${list.length - shown.length} restantes)</button></div>` : ''}`;
}

/* ---------- pestaña ---------- */
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

  const seasonFilter = `<option value="all" ${X.season === 'all' ? 'selected' : ''}>Todas las temporadas</option>` + seasons.map(s => `<option value="${esc(s.id)}" ${X.season === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  const catFilter = `<option value="all" ${X.cat === 'all' ? 'selected' : ''}>Todas las categorías</option><option value="none" ${X.cat === 'none' ? 'selected' : ''}>Sin categoría</option>` + cats.map(c => `<option value="${esc(c.id)}" ${X.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  const upSeason = examUpSeason();
  const upPanel = upOpen ? `
  <div class="tc-card ex-panel">
    <div class="tc-card-head"><span class="tc-step">${ic('fileplus')}</span><div><h3>Subir exámenes</h3><small>Elige temporada y categoría, y arrastra los PDF o pulsa para elegirlos (máximo 30 MB cada uno).</small></div></div>
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
      <span class="ex-busy" id="ex-busy">${esc(X.busy)}</span>
    </div>
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

  return `
  <div id="ex-lib">
    <div class="tx-toolbar">
      <div><div class="lg-section-head" style="margin:0;"><h2>Biblioteca de exámenes</h2><span>Busca, filtra y marca los que ya están en la app</span></div></div>
      <div class="cm-actions">
        ${noSeasons ? '' : `<button class="btn ${upOpen ? 'btn-ghost' : 'btn-primary'}" data-action="committee-exam-panel-up">${ic('fileplus')} ${upOpen ? 'Cerrar subida' : 'Subir exámenes'}</button>`}
        ${noSeasons ? '' : `<button class="btn btn-ghost" data-action="committee-exam-panel-manage">${ic('folder')} Temporadas y categorías</button>`}
      </div>
    </div>
    ${upPanel}${managePanel}
    ${noSeasons ? '' : `
    <div id="ex-summary">${examSummaryHtml()}</div>
    <div class="ex-filters">
      <input type="text" id="ex-q" value="${esc(X.q)}" placeholder="Buscar por título, categoría, temporada o fecha..." aria-label="Buscar exámenes" autocomplete="off">
      <select id="ex-f-season" aria-label="Filtrar por temporada">${seasonFilter}</select>
      <select id="ex-f-cat" aria-label="Filtrar por categoría">${catFilter}</select>
    </div>
    <div id="ex-results">${examResultsHtml()}</div>`}
  </div>`;
}

/* ---------- acciones ---------- */
async function examUpload(){
  const X = exm();
  const sid = examUpSeason();
  if(!sid){ cmToast('Crea primero una temporada.'); return; }
  const inp = document.getElementById('ex-file');
  const files = inp ? Array.from(inp.files || []) : [];
  if(!files.length){ cmToast('Elige uno o varios PDF.'); return; }
  const notPdf = files.find(f => f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name));
  if(notPdf){ cmToast('«' + notPdf.name + '» no es un PDF.'); return; }
  const big = files.find(f => f.size > EXAM_MAX_BYTES);
  if(big){ cmToast('«' + big.name + '» pesa más de 30 MB.'); return; }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(X.up.date) ? X.up.date : examToday();
  const cat = X.up.cat || null;
  const single = files.length === 1 ? X.up.title.trim() : '';
  let ok = 0, lastErr = null;
  const failed = [], paths = [];
  X.busy = 'Subiendo 1 de ' + files.length + '...';
  examRender();
  for(let i = 0; i < files.length; i++){
    const f = files[i];
    const label = document.getElementById('ex-busy');
    if(label) label.textContent = 'Subiendo ' + (i + 1) + ' de ' + files.length + '...';
    const path = sid + '/' + examUuid() + '.pdf';
    const up = await supabaseClient.storage.from(EXAM_BUCKET).upload(path, f, { contentType: 'application/pdf', upsert: false });
    if(up.error){ failed.push(f.name); lastErr = up.error; continue; }
    const title = examUpper((single || f.name.replace(/\.pdf$/i, '')).trim()).slice(0, 160) || 'EXAMEN';
    const ins = await supabaseClient.from('exam_files').insert({
      season_id: sid, category_id: cat, title, exam_date: date,
      file_path: path, file_name: f.name, file_size: f.size
    });
    if(ins.error){
      await supabaseClient.storage.from(EXAM_BUCKET).remove([path]);
      failed.push(f.name); lastErr = ins.error; continue;
    }
    paths.push(path); ok++;
  }
  X.busy = '';
  if(ok){
    X.up.title = '';
    // para que se vea lo recién subido: sin filtros que lo escondan y resaltado
    X.q = ''; X.status = 'all';
    if(X.season !== 'all' && X.season !== sid) X.season = 'all';
    if(X.cat !== 'all' && X.cat !== (cat || 'none')) X.cat = 'all';
  }
  await examLoad();
  X.fresh = new Set((X.files || []).filter(e => paths.indexOf(e.file_path) >= 0).map(e => e.id));
  if(failed.length){
    STATE.toast = (ok ? ok + ' subido' + (ok === 1 ? '' : 's') + '. ' : '') + 'No se pudo subir: ' + failed.join(', ') + '. ' + examErr(lastErr);
  } else {
    STATE.toast = ok === 1 ? 'Examen subido.' : ok + ' exámenes subidos.';
  }
  examRender();
}

async function examView(id){
  const e = examById(id); if(!e) return;
  const w = window.open('', '_blank');          // se abre ya, antes de esperar, para que el navegador no lo bloquee
  const r = await supabaseClient.storage.from(EXAM_BUCKET).createSignedUrl(e.file_path, 300);
  if(r.error || !r.data || !r.data.signedUrl){ if(w) w.close(); cmToast('No se pudo abrir el PDF. ' + examErr(r.error)); return; }
  if(w) w.location.href = r.data.signedUrl; else window.open(r.data.signedUrl, '_blank');
}

/* Marca varios (o uno) como "en la app" / "pendiente": se ve al instante y se deshace si falla. */
async function examSetInApp(ids, on){
  const items = ids.map(examById).filter(e => e && e.in_app !== on);     // solo los que cambian de estado
  if(!items.length) return;
  const stamp = on ? new Date().toISOString() : null;
  const prev = items.map(e => ({ e, in_app: e.in_app, in_app_at: e.in_app_at }));
  items.forEach(e => { e.in_app = on; e.in_app_at = stamp; });
  examRefresh();
  const r = await examChunks(items.map(e => e.id), (chunk) => supabaseClient.from('exam_files').update({ in_app: on, in_app_at: stamp }).in('id', chunk));
  if(r.error){
    prev.forEach(p => { p.e.in_app = p.in_app; p.e.in_app_at = p.in_app_at; });
    examRefresh();
    cmToast(examErr(r.error));
  }
}

async function examDeleteMany(ids){
  const items = ids.map(examById).filter(Boolean);
  if(!items.length) return false;
  const rm = await supabaseClient.storage.from(EXAM_BUCKET).remove(items.map(e => e.file_path));
  if(rm.error){ cmToast(examErr(rm.error)); return false; }
  const r = await examChunks(items.map(e => e.id), (chunk) => supabaseClient.from('exam_files').delete().in('id', chunk));
  if(r.error){ cmToast(examErr(r.error)); return false; }
  items.forEach(e => exm().sel.delete(e.id));
  return true;
}

async function examOnAction(action, el){
  const X = exm();
  if(!isDevUser()) return;
  const id = el && el.dataset ? el.dataset.id : '';
  const a = action.replace('committee-exam-', '');
  if(a === 'upload'){ await examUpload(); }
  else if(a === 'view'){ await examView(id); }
  else if(a === 'toggle'){ const e = examById(id); if(e) await examSetInApp([e.id], !e.in_app); }
  else if(a === 'status'){ X.status = (el.dataset.s === X.status && X.status !== 'all') ? 'all' : el.dataset.s; X.limit = EXAM_PAGE; examRefresh(); }
  else if(a === 'sort'){
    const k = el.dataset.key;
    if(X.sortKey === k) X.sortDir = X.sortDir === 'asc' ? 'desc' : 'asc';
    else { X.sortKey = k; X.sortDir = (k === 'date' || k === 'size') ? 'desc' : 'asc'; }
    examRefresh();
  }
  else if(a === 'more'){ X.limit += EXAM_PAGE; examRefresh(); }
  else if(a === 'clear'){ X.q = ''; X.season = 'all'; X.cat = 'all'; X.status = 'all'; X.limit = EXAM_PAGE; examRender(); }
  else if(a === 'edit'){
    const e = examById(id); if(!e) return;
    X.edit = { id: e.id, title: e.title, date: e.exam_date || '', cat: e.category_id || '', season: e.season_id };
    examRefresh();
    const t = document.getElementById('ex-e-title'); if(t){ t.focus(); t.select(); }
  }
  else if(a === 'cancel'){ X.edit = null; examRefresh(); }
  else if(a === 'save'){
    const e = examById(id); if(!e || !X.edit) return;
    const title = X.edit.title.trim();
    if(!title){ cmToast('Escribe un título.'); return; }
    const patch = { title: examUpper(title).slice(0, 160), exam_date: X.edit.date || null, category_id: X.edit.cat || null, season_id: X.edit.season || e.season_id };
    const r = await supabaseClient.from('exam_files').update(patch).eq('id', e.id);
    if(r.error){ cmToast(examErr(r.error)); return; }
    Object.assign(e, patch);
    X.edit = null;
    STATE.toast = 'Examen actualizado.'; examRender();
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
  else if(a === 'bulk-clear'){ X.sel.clear(); examRefresh(); }
  else if(a === 'bulk-move'){
    const s = document.getElementById('ex-bulk-cat');
    const v = s ? s.value : '';
    if(!v){ cmToast('Elige a qué categoría moverlos.'); return; }
    const cat = v === 'none' ? null : v;
    const ids = Array.from(X.sel);
    const r = await examChunks(ids, (chunk) => supabaseClient.from('exam_files').update({ category_id: cat }).in('id', chunk));
    if(r.error){ cmToast(examErr(r.error)); return; }
    ids.forEach(i => { const e = examById(i); if(e) e.category_id = cat; });
    STATE.toast = ids.length + (ids.length === 1 ? ' examen movido.' : ' exámenes movidos.'); examRender();
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
    const r = await supabaseClient.from('exam_seasons').insert({ name }).select().single();
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
    const r = await supabaseClient.from('exam_seasons').delete().eq('id', s.id);
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
function examAfterRender(){
  const X = exm();
  const lib = document.getElementById('ex-lib');
  if(!lib) return;
  // botones de la lista y del resumen (la lista se repinta sin tocar el resto, por eso se atiende desde aquí)
  lib.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-exa]');
    if(!b || !lib.contains(b)) return;
    ev.preventDefault();
    examOnAction('committee-exam-' + b.dataset.exa, b);
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
  });
  const q = document.getElementById('ex-q');
  if(q) q.addEventListener('input', () => { X.q = q.value; X.limit = EXAM_PAGE; examRefresh(); });
  const fs = document.getElementById('ex-f-season');
  if(fs) fs.addEventListener('change', () => { X.season = fs.value; X.limit = EXAM_PAGE; examRefresh(); });
  const fc = document.getElementById('ex-f-cat');
  if(fc) fc.addEventListener('change', () => { X.cat = fc.value; X.limit = EXAM_PAGE; examRefresh(); });
  // zona de subida: muestra qué archivos hay elegidos
  const file = document.getElementById('ex-file');
  if(file) file.addEventListener('change', () => {
    const names = Array.from(file.files || []).map(f => f.name);
    const t = document.getElementById('ex-drop-text'), n = document.getElementById('ex-drop-names');
    if(t) t.textContent = names.length ? (names.length === 1 ? '1 PDF listo para subir' : names.length + ' PDF listos para subir') : 'Arrastra aquí los PDF o pulsa para elegirlos';
    if(n) n.textContent = names.length ? names.join(' · ') : 'Con varios PDF, cada uno usa el nombre de su archivo como título.';
  });
  const drop = document.getElementById('ex-drop');
  if(drop){
    ['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, () => drop.classList.add('over')));
    ['dragleave', 'drop'].forEach(n => drop.addEventListener(n, () => drop.classList.remove('over')));
  }
}
