/* ---------------- ANALÍTICA ----------------
   1) Registro de eventos de uso (RPC log_event, con lista blanca en el servidor; nada de datos personales).
   2) Pantalla #/admin/analitica (solo maestro con 2FA): lee agregados con analytics_overview / analytics_options. Los grupos de menos de
      5 usuarios los oculta el servidor. Gráficos con Chart.js alojado en /assets/js/vendor.
   Depende de app.js (STATE, esc, render, isMaster, shellIcon, todayKeyISO, supabaseClient). */

/* ---------- 1 · Eventos ---------- */
const AN_LAST = { view: '', quiz: null };
function anLog(event, props){
  try{
    if(typeof supabaseClient === 'undefined' || typeof CURRENT_USER_ID === 'undefined' || !CURRENT_USER_ID) return;
    Promise.resolve(supabaseClient.rpc('log_event', { p_event: event, p_props: props || {} })).catch(() => {});
  }catch(e){}
}
/* Se llama tras cada pintado: pantalla vista y test empezado (sin datos personales: solo el nombre interno de la pantalla y el modo). */
function anAfterRender(){
  try{
    const v = String(STATE.view);
    if(!STATE.dataReady || !v) return;
    if(v !== AN_LAST.view){ AN_LAST.view = v; anLog('view', { screen: v }); }
    if(v === 'quiz' && STATE.quiz && AN_LAST.quiz !== STATE.quiz){
      AN_LAST.quiz = STATE.quiz;
      const m = String(STATE.quiz.mode || '');
      if(['hearts', 'suddendeath', 'timeattack'].includes(m)) anLog('league_played', { mode: m });
      anLog('test_started', { mode: m });
    }
  }catch(e){}
  anDraw();
}

/* ---------- 2 · Pantalla ---------- */
const AN_SIT = { aspirante: 'Aspirante', en_activo: 'En activo', otro: 'Otro' };
function anS(){
  if(!STATE.an){
    STATE.an = { preset: 30, from: '', to: '', pais: '', fed: '', sit: '', canal: '', data: null, opts: null, loading: false, error: false, price: 4.99, conv: 5 };
    try{ const p = JSON.parse(localStorage.getItem('weref_an_sc') || 'null'); if(p){ STATE.an.price = p.price; STATE.an.conv = p.conv; } }catch(e){}
  }
  return STATE.an;
}
const anFmtN = (n) => String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const anVal = (v) => (typeof v === 'string') ? v : (v == null ? '—' : anFmtN(v));
function anDay(iso, withYear){ const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('es-ES', withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }); }

function anRange(){
  const s = anS(), today = todayKeyISO();
  if(s.preset === 0 && s.from && s.to && s.from <= s.to) return { from: s.from, to: s.to };
  const n = s.preset === 7 || s.preset === 90 ? s.preset : 30;
  const d = new Date(); d.setDate(d.getDate() - (n - 1));
  return { from: todayKeyISO(d), to: today };
}

async function loadAnalytics(force){
  if(typeof isMaster !== 'function' || !isMaster()) return;
  const s = anS(); s.loading = true; s.error = false;
  if(force) s.data = null;
  render();
  try{
    if(!s.opts){
      const o = await supabaseClient.rpc('analytics_options');
      if(o.error) throw o.error;
      s.opts = (typeof o.data === 'string') ? JSON.parse(o.data) : o.data;
    }
    const r = anRange();
    const { data, error } = await supabaseClient.rpc('analytics_overview', { p_from: r.from, p_to: r.to, p_pais: s.pais || null, p_fed: s.fed || null, p_sit: s.sit || null, p_canal: s.canal || null });
    if(error) throw error;
    s.data = (typeof data === 'string') ? JSON.parse(data) : data;
  }catch(e){ console.warn('analytics_overview', e); s.error = true; s.data = null; }
  s.loading = false;
  render();
}

/* Chart.js se carga solo al abrir esta pantalla */
let AN_CHART_LOADING = null, AN_CHART = null;
function anEnsureChart(){
  if(typeof Chart !== 'undefined') return Promise.resolve(true);
  if(AN_CHART_LOADING) return AN_CHART_LOADING;
  AN_CHART_LOADING = new Promise((ok) => {
    const sc = document.createElement('script'); sc.src = 'assets/js/vendor/chart-4.4.1.umd.js'; sc.onload = () => ok(typeof Chart !== 'undefined'); sc.onerror = () => { AN_CHART_LOADING = null; ok(false); };
    document.head.appendChild(sc);
  });
  return AN_CHART_LOADING;
}
function anDraw(){
  const cv = document.getElementById('an-chart');
  if(AN_CHART){ try{ AN_CHART.destroy(); }catch(e){} AN_CHART = null; }
  if(!cv || String(STATE.view) !== 'adminAnalytics') return;
  const d = anS().data; if(!d || d.hidden || !d.daily) return;
  anEnsureChart().then((ok) => {
    const cv2 = document.getElementById('an-chart');
    if(!ok || !cv2) return;
    if(AN_CHART){ try{ AN_CHART.destroy(); }catch(e){} }
    const css = getComputedStyle(document.documentElement);
    const ink = (css.getPropertyValue('--c-ink') || '#17181C').trim(), yel = (css.getPropertyValue('--c-action') || '#FFC93C').trim(), muted = (css.getPropertyValue('--c-muted') || '#6B6A66').trim(), line = (css.getPropertyValue('--c-line') || '#E7E5E2').trim();
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    AN_CHART = new Chart(cv2.getContext('2d'), {
      data: {
        labels: d.daily.map(x => anDay(x.d)),
        datasets: [
          { type: 'bar', label: 'Registros', data: d.daily.map(x => x.reg), backgroundColor: yel, borderRadius: 3, yAxisID: 'yR', order: 2, maxBarThickness: 18 },
          { type: 'line', label: 'Activos diarios', data: d.daily.map(x => x.dau), borderColor: ink, backgroundColor: ink, borderWidth: 2.2, pointRadius: d.daily.length > 45 ? 0 : 2.5, tension: .25, yAxisID: 'yA', order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: calm ? false : { duration: 350 }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, color: muted, font: { size: 12 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: 7, maxRotation: 0, font: { size: 11 } } },
          yA: { position: 'left', beginAtZero: true, grid: { color: line }, ticks: { color: muted, precision: 0, font: { size: 11 } }, title: { display: true, text: 'Activos', color: muted, font: { size: 11 } } },
          yR: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { color: muted, precision: 0, font: { size: 11 } }, title: { display: true, text: 'Registros', color: muted, font: { size: 11 } } }
        }
      }
    });
  });
}

/* ---------- piezas de la pantalla ---------- */
function anDelta(v, p, pp){
  if(v == null || p == null) return '<span class="an-d none">Sin comparación</span>';
  const diff = v - p;
  if(pp){ return diff === 0 ? '<span class="an-d eq">= 0 pp</span>' : `<span class="an-d ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲ +' : '▼ −'}${Math.abs(diff)} pp</span>`; }
  if(p === 0) return v === 0 ? '<span class="an-d eq">= 0</span>' : `<span class="an-d up">▲ nuevo</span>`;
  const pct = Math.round(diff / p * 100);
  return pct === 0 ? '<span class="an-d eq">= 0 %</span>' : `<span class="an-d ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲ +' : '▼ −'}${Math.abs(pct)} %</span>`;
}
function anKpi(label, k, unit, pp){
  const v = k ? k.v : null, p = k ? k.p : null;
  return `<div class="an-kpi"><small>${esc(label)}</small><b>${v == null ? '—' : anFmtN(v) + (unit || '')}</b>${anDelta(v, p, pp)}</div>`;
}
function anSelect(id, label, list, cur, mapLabel){
  const opts = ['<option value="">Todos</option>'].concat((list || []).map(v => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(mapLabel ? (mapLabel[v] || v) : v)}</option>`));
  if(cur && !(list || []).includes(cur)) opts.push(`<option value="${esc(cur)}" selected>${esc(mapLabel ? (mapLabel[cur] || cur) : cur)}</option>`);
  return `<label class="an-f"><span>${esc(label)}</span><select id="${id}">${opts.join('')}</select></label>`;
}
function anSkeleton(){
  const b = (h) => `<span class="skel" style="display:block;height:${h}px;border-radius:14px;"></span>`;
  return `<div class="an-kpis">${[1, 2, 3, 4, 5, 6].map(() => `<div class="an-kpi">${b(12)}<div style="height:8px"></div>${b(30)}</div>`).join('')}</div>
    <div class="an-card">${b(16)}<div style="height:12px"></div>${b(230)}</div><div class="an-card">${b(16)}<div style="height:12px"></div>${b(120)}</div>`;
}
function anCountries(d, cur){
  const list = d.countries || [];
  if(!list.length) return '<p class="an-empty">Todavía no hay ningún país con 5 o más usuarios. Se irán mostrando a medida que más gente complete el perfil.</p>';
  const mx = Math.max(1, ...list.map(c => c.mau));
  return `<ul class="an-cl">${list.map(c => `<li><button type="button" class="an-c ${cur === c.pais ? 'on' : ''}" data-action="an-pais" data-v="${esc(c.pais)}" aria-pressed="${cur === c.pais}">
      <span class="an-c-n">${esc(c.pais)}</span><span class="an-c-bar"><i style="width:${Math.max(3, Math.round(c.mau / mx * 100))}%"></i></span>
      <span class="an-c-v"><b>${anFmtN(c.mau)}</b> activos 30 d · ${anFmtN(c.reg)} reg.</span></button></li>`).join('')}</ul>`;
}
function anRetention(d){
  const rows = d.retention || [];
  if(!rows.length) return '<p class="an-empty">Aún no hay cohortes que mostrar.</p>';
  const cell = (v) => v == null ? '<td class="na">—</td>' : `<td style="background:rgba(255,201,60,${(0.12 + Math.min(100, v) / 100 * 0.78).toFixed(2)})"><b>${v}</b> %</td>`;
  return `<div class="an-table-w"><table class="an-ret"><thead><tr><th>Semana de registro</th><th>Usuarios</th><th>D1</th><th>D7</th><th>D30</th></tr></thead><tbody>${rows.slice().reverse().map(r =>
    `<tr class="${r.n == null ? 'small' : ''}"><th scope="row">${esc(anDay(r.cohort))}</th><td>${r.n == null ? '&lt;5' : r.n}</td>${cell(r.d1)}${cell(r.d7)}${cell(r.d30)}</tr>`).join('')}</tbody></table></div>
    <p class="an-foot">D1: activo el día siguiente · D7: activo en la segunda semana (días 7 a 13) · D30: activo entre los días 30 y 36. «—» = aún no se puede medir.</p>`;
}
function anFunnel(d){
  const f = d.funnel || {};
  const steps = [['Se registra', f.registrados], ['Verifica el correo', f.verificados], ['Completa el onboarding', f.onboarding], ['Hace su primer test', f.primer_test], ['Vuelve en la 2.ª semana', f.vuelve]];
  const base = typeof f.registrados === 'number' ? f.registrados : 0;
  return `<ol class="an-fn">${steps.map((st, i) => {
    const v = st[1], num = typeof v === 'number';
    const pct = base > 0 && num ? Math.round(v / base * 100) : null;
    const prev = i > 0 ? steps[i - 1][1] : null;
    const conv = i > 0 && num && typeof prev === 'number' && prev > 0 ? Math.round(v / prev * 100) : null;
    return `<li><span class="an-fn-t"><strong>${esc(st[0])}</strong><small>${conv != null ? conv + ' % del paso anterior' : (i === 0 ? 'Base del periodo' : '')}${i === 4 && f.elegibles != null ? ' · de ' + esc(anVal(f.elegibles)) + ' con 2 semanas cumplidas' : ''}</small></span>
      <span class="an-fn-bar"><i style="width:${num ? Math.max(3, pct == null ? 0 : pct) : 4}%"></i></span><span class="an-fn-v">${esc(anVal(v))}</span></li>`; }).join('')}</ol>`;
}
function anPro(d, s){
  const p = d.pro || {};
  const base = d.kpis && d.kpis.mau ? d.kpis.mau.v : 0;
  const stat = (label, v) => `<div class="an-ps"><b>${esc(anVal(v))}</b><small>${esc(label)}</small></div>`;
  const scen = (conv) => `<div class="an-sc"><small>${conv} %</small><b>${anFmtN(base * conv / 100 * s.price)} €</b><em>${anFmtN(base * conv / 100)} suscr.</em></div>`;
  return `<div class="an-pro">${stat('Usuarios intensivos (3+ días activos a la semana)', p.intensivos)}${stat('Con examen en menos de 60 días', p.examen_60)}${stat('Clics en «WEREF Pro»', p.pro_clics)}${stat('Correos dejados en la lista de espera', p.pro_correos)}</div>
    <div class="an-calc"><h3>Calculadora de escenarios</h3>
      <div class="an-calc-in"><label><span>Precio al mes (€)</span><input id="an-price" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(String(s.price))}"></label>
        <label><span>Conversión de activos (%)</span><input id="an-conv" type="number" inputmode="decimal" min="0" max="100" step="0.5" value="${esc(String(s.conv))}"></label></div>
      <div class="an-calc-out" id="an-calc-out" aria-live="polite">${anCalcHtml(base, s)}</div>
      <div class="an-scs">${scen(2)}${scen(5)}${scen(10)}</div>
      <p class="an-foot">Base: ${anFmtN(base)} usuarios activos en 30 días. Estimación orientativa con el precio indicado, no una previsión.</p></div>`;
}
function anCalcHtml(base, s){
  const payers = base * (Number(s.conv) || 0) / 100, m = payers * (Number(s.price) || 0);
  return `<div><small>Suscriptores estimados</small><b>${anFmtN(payers)}</b></div><div><small>Ingresos al mes</small><b>${anFmtN(m)} €</b></div><div><small>Ingresos al año</small><b>${anFmtN(m * 12)} €</b></div>`;
}

function adminAnalyticsView(){
  const s = anS(), d = s.data, ic = (n) => shellIcon(n);
  const r = anRange(), o = s.opts || {};
  const chip = (n, label) => `<button type="button" class="an-chip ${s.preset === n ? 'on' : ''}" data-action="an-preset" data-v="${n}" aria-pressed="${s.preset === n}">${label}</button>`;
  const hasFilter = !!(s.pais || s.fed || s.sit || s.canal);
  const filters = `<section class="an-filters" aria-label="Filtros">
    <div class="an-chips" role="group" aria-label="Periodo">${chip(7, '7 días')}${chip(30, '30 días')}${chip(90, '90 días')}${chip(0, 'Personalizado')}</div>
    ${s.preset === 0 ? `<div class="an-dates"><label><span>Desde</span><input type="date" id="an-from" value="${esc(s.from || r.from)}" max="${esc(todayKeyISO())}"></label><label><span>Hasta</span><input type="date" id="an-to" value="${esc(s.to || r.to)}" max="${esc(todayKeyISO())}"></label></div>` : ''}
    <div class="an-sel">${anSelect('an-pais', 'País', o.pais, s.pais)}${anSelect('an-fed', 'Federación', o.federacion, s.fed)}${anSelect('an-sit', 'Situación', o.situacion, s.sit, AN_SIT)}${anSelect('an-canal', 'Canal', o.canal, s.canal)}</div>
    ${hasFilter ? '<button type="button" class="btn btn-ghost an-reset" data-action="an-reset">Quitar filtros</button>' : ''}</section>`;
  const head = `<button class="backbtn" data-action="admin-dashboard">&larr; Panel de administración</button>
    <header class="an-head"><div><h1>Analítica</h1><p>Crecimiento, retención y uso de WEREF. Solo datos agregados: los grupos de menos de 5 usuarios no se muestran.</p></div>
      <button type="button" class="btn btn-ghost an-refresh" data-action="an-refresh">${ic('repeat')} Actualizar</button></header>`;
  let body;
  if(s.loading && !d) body = anSkeleton();
  else if(s.error) body = `<div class="an-card an-msg"><strong>No se pudieron cargar los datos</strong><p>Comprueba que has entrado con la verificación en dos pasos y que el SQL de la analítica está ejecutado.</p><button class="btn btn-primary" data-action="an-refresh">Reintentar</button></div>`;
  else if(!d) body = anSkeleton();
  else if(d.hidden) body = `<div class="an-card an-msg">${ic('lock')}<strong>Grupo demasiado pequeño</strong><p>Este filtro agrupa a menos de 5 usuarios. Por privacidad no se muestra nada. Prueba con un periodo o filtros más amplios.</p><button class="btn btn-primary" data-action="an-reset">Quitar filtros</button></div>`;
  else {
    const k = d.kpis || {}, today = todayKeyISO(), toLabel = d.range && d.range.to === today ? 'hoy' : anDay(d.range.to);
    body = `<p class="an-range">${esc(anDay(d.range.from, true))} – ${esc(anDay(d.range.to, true))} · ${d.range.days} días · ${anFmtN(d.users)} usuarios en este filtro</p>
      <div class="an-kpis">${anKpi('Activos ' + toLabel, k.dau)}${anKpi('Activos 7 días', k.wau)}${anKpi('Activos 30 días', k.mau)}${anKpi('Ratio diario / mensual', k.ratio, ' %', true)}${anKpi('Registros del periodo', k.registros)}${anKpi('Retención D7', k.d7, ' %', true)}</div>
      <section class="an-card"><h2>Activos diarios y registros</h2><div class="an-chart"><canvas id="an-chart" role="img" aria-label="Gráfico de activos diarios y registros por día"></canvas></div></section>
      <div class="an-two">
        <section class="an-card"><h2>Países</h2>${anCountries(d, s.pais)}</section>
        <section class="an-card"><h2>Embudo</h2>${anFunnel(d)}</section>
      </div>
      <section class="an-card"><h2>Retención por cohorte semanal</h2>${anRetention(d)}</section>
      <section class="an-card"><h2>Señales de pago</h2>${anPro(d, s)}</section>
      <p class="an-priv">${ic('lock')} Analítica interna de uso. Solo agregados; sin listados de usuarios ni exportaciones.</p>`;
  }
  return head + `<div class="an ${s.loading && d ? 'busy' : ''}">${filters}${body}</div>`;
}

/* ---------- acciones y campos ---------- */
function anAction(action, el){
  const s = anS();
  if(action === 'an-preset'){ s.preset = parseInt(el.dataset.v, 10) || 0; if(s.preset === 0 && !s.from){ const r = anRange(); s.from = r.from; s.to = r.to; } loadAnalytics(); }
  else if(action === 'an-pais'){ s.pais = (s.pais === el.dataset.v) ? '' : el.dataset.v; loadAnalytics(); }
  else if(action === 'an-reset'){ s.pais = s.fed = s.sit = s.canal = ''; loadAnalytics(); }
  else if(action === 'an-refresh'){ loadAnalytics(true); }
}
document.addEventListener('change', (e) => {
  const t = e.target; if(!t || String(STATE.view) !== 'adminAnalytics') return;
  const s = anS();
  if(t.id === 'an-pais'){ s.pais = t.value; loadAnalytics(); }
  else if(t.id === 'an-fed'){ s.fed = t.value; loadAnalytics(); }
  else if(t.id === 'an-sit'){ s.sit = t.value; loadAnalytics(); }
  else if(t.id === 'an-canal'){ s.canal = t.value; loadAnalytics(); }
  else if(t.id === 'an-from' || t.id === 'an-to'){ s[t.id === 'an-from' ? 'from' : 'to'] = t.value; if(s.from && s.to && s.from <= s.to) loadAnalytics(); }
});
document.addEventListener('input', (e) => {
  const t = e.target; if(!t || (t.id !== 'an-price' && t.id !== 'an-conv')) return;
  const s = anS(); const v = parseFloat(String(t.value).replace(',', '.'));
  if(t.id === 'an-price') s.price = isNaN(v) ? 0 : Math.max(0, v); else s.conv = isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
  try{ localStorage.setItem('weref_an_sc', JSON.stringify({ price: s.price, conv: s.conv })); }catch(err){}
  const out = document.getElementById('an-calc-out'), base = s.data && s.data.kpis && s.data.kpis.mau ? s.data.kpis.mau.v : 0;
  if(out) out.innerHTML = anCalcHtml(base, s);
});
