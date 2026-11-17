/* ---------------- GAMIFICACIÓN · pantalla #/logros y celebraciones ----------------
   El cliente SOLO muestra lo que calcula el servidor (RPC get_gamification; los puntos, rangos e insignias se conceden en
   finish_test y en los disparadores de la base de datos). Aquí no se calcula nada de puntos.
   Depende de app.js (STATE, esc, render, shellIcon) y de shell.js (SHELL_ICONS). */

const GM_ROMAN = ['', 'I', 'II', 'III'];
const GM_ABBR = ['Apr', 'Reg', 'Pre', 'Ter', 'Seg', 'Pri', 'Éli', 'Int'];
const GM_FAMILY_ICON = { primer_pitido: 'zap', constancia: 'flame', precision: 'target', coronas: 'award', maestro: 'book', corrector: 'repeat', league: 'trophy', var: 'eye', ocultas: 'star' };
const GM_FAMILY_NAME = { primer_pitido: 'Primer pitido', constancia: 'Constancia', precision: 'Precisión', coronas: 'Coronas', maestro: 'Maestro de regla', corrector: 'Corrector', league: 'League', var: 'VAR', ocultas: 'Oculta' };
const GM_TIER_NAME = ['', 'Bronce', 'Plata', 'Oro'];
const GM_UNIT = { streak_max: 'días', perfect: 'tests', crowns: 'coronas', rules4: 'reglas', cleared: 'preguntas', hard: 'preguntas', run: 'aciertos seguidos', rule11: 'coronas' };
const GM_NO_RENDER_VIEWS = ['quiz', 'myBankQuiz', 'committeeRun', 'committeePreview', 'committeeLiveHost', 'committeeLivePlay'];
const gmN = (n) => String(Math.round(Number(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function gamiFallback(){
  return { points: 0, crowns: 0, crowns_max: 68, streak: 0, error: true,
    rank: { ord: 1, key: 'aprendiz', name: 'Aprendiz', sub: 1, sub_from: 0, sub_to: 100, next: null }, ranks: [], badges: [], recent: [], pending: { rank_up: null, badges: [] } };
}

/* Lee del servidor lo que enseñan Inicio, el menú y #/logros. Si falla, la app sigue con ceros (nunca se queda cargando). */
async function loadGami(){
  if(STATE.gamiBusy) return;
  STATE.gamiBusy = true;
  try{
    const { data, error } = await supabaseClient.rpc('get_gamification');
    if(error) throw error;
    STATE.gami = (typeof data === 'string') ? JSON.parse(data) : data;
  }catch(e){
    console.warn('get_gamification', e);
    if(!STATE.gami) STATE.gami = gamiFallback();
  }
  STATE.gamiBusy = false;
  if(!GM_NO_RENDER_VIEWS.includes(String(STATE.view))) render();
}

function gamiCounts(){
  const b = (STATE.gami && STATE.gami.badges) || [];
  return { earned: b.filter(x => x.earned_at).length, total: b.length };
}

/* ---------- piezas gráficas (SVG propio, sin emojis) ---------- */
function gamiShield(ord, sub, px){
  const pips = [1, 2, 3].map(i => `<circle class="${i <= sub ? 'on' : ''}" cx="${17 + (i - 1) * 7}" cy="43" r="2.3"/>`).join('');
  return `<svg class="gm-shield" viewBox="0 0 48 58" width="${px}" height="${Math.round(px * 58 / 48)}" role="img" aria-label="Rango ${ord}, subnivel ${GM_ROMAN[sub] || ''}">
    <path class="body" d="M24 3 43 10v18c0 12-9 21-19 25C14 49 5 40 5 28V10Z"/>
    <path class="inner" d="M24 8 38 13v15c0 9-6 16-14 20-8-4-14-11-14-20V13Z"/>
    <text x="24" y="33" text-anchor="middle">${ord}</text>${pips}
  </svg>`;
}
function gamiMedal(def, state, px){
  const icon = GM_FAMILY_ICON[def.family] || 'award';
  const inner = state === 'hidden'
    ? '<text x="32" y="42" text-anchor="middle" class="q">?</text>'
    : `<svg x="19" y="19" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${(typeof SHELL_ICONS !== 'undefined' && SHELL_ICONS[state === 'locked' ? icon : icon]) || ''}</svg>`;
  return `<svg class="gm-medal t${def.tier} ${state}" viewBox="0 0 64 64" width="${px}" height="${px}" aria-hidden="true">
    <circle class="disc" cx="32" cy="32" r="28"/><circle class="ring" cx="32" cy="32" r="28"/><g class="ico">${inner}</g></svg>`;
}
function gamiBadgeState(b){ return b.earned_at ? 'earned' : (b.hidden ? 'hidden' : 'locked'); }
function gamiBadgeLabel(b){ return b.name + (b.tier ? ' · ' + GM_TIER_NAME[b.tier] : ''); }
function gamiProgText(b){
  if(b.metric === 'league_best') return b.cur == null ? 'Aún sin clasificar' : 'Tu mejor puesto: n.º ' + gmN(b.cur);
  const u = GM_UNIT[b.metric] ? ' ' + GM_UNIT[b.metric] : '';
  return gmN(Math.min(b.cur || 0, b.target)) + '/' + gmN(b.target) + u;
}
function gamiDate(ts){
  const d = new Date(ts); if(isNaN(d)) return '';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
function gamiAgo(ts){
  const d = new Date(ts), n = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()), b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const k = Math.round((b - a) / 86400000);
  return k <= 0 ? 'hoy' : k === 1 ? 'ayer' : 'hace ' + k + ' días';
}
function gamiReasonText(m){
  const n = m.n || 1, plural = n !== 1;
  switch(m.reason){
    case 'first_correct': return plural ? n + ' primeros aciertos' : 'Primer acierto';
    case 'repeat_correct': return plural ? n + ' aciertos repetidos' : 'Acierto repetido';
    case 'test_pass': return plural ? n + ' tests aprobados' : 'Test aprobado';
    case 'test_perfect': return plural ? n + ' tests perfectos' : 'Test perfecto';
    case 'crown': return plural ? n + ' coronas conseguidas' : 'Corona conseguida';
    case 'streak_day': return 'Día de racha';
    case 'migracion_aciertos': return 'Aciertos acumulados hasta hoy';
    case 'migracion_tests': return 'Tests acumulados hasta hoy';
    case 'migracion_coronas': return 'Coronas acumuladas hasta hoy';
    case 'migracion_racha': return 'Racha acumulada hasta hoy';
    default: return 'Puntos';
  }
}

/* ---------- rango actual / siguiente (lo usan Inicio, el menú lateral y el perfil) ---------- */
function gamiNext(){
  const g = STATE.gami; if(!g || !g.rank) return null;
  const r = g.rank;
  if(!r.next && r.sub >= 3) return null;
  const name = r.sub < 3 ? r.name + ' ' + GM_ROMAN[r.sub + 1] : (r.next ? r.next.name + ' I' : r.name);
  const remaining = Math.max(0, r.sub_to - g.points);
  const crowns = r.sub >= 3 && r.next ? r.next.need_crowns : 0;
  const span = Math.max(1, r.sub_to - r.sub_from);
  const pct = Math.max(0, Math.min(100, Math.round((g.points - r.sub_from) / span * 100)));
  const hint = remaining > 0 ? 'faltan ' + gmN(remaining) + ' pts' : (crowns > 0 ? 'faltan ' + crowns + (crowns === 1 ? ' corona' : ' coronas') : 'casi');
  return { name, remaining, crowns, progressPct: pct, hint };
}

/* ---------- panel inferior (escala completa / detalle de insignia) ---------- */
function gamiCloseSheet(){ const s = document.getElementById('gm-sheet'); if(s) s.remove(); document.removeEventListener('keydown', gamiSheetKey); }
function gamiSheetKey(e){ if(e.key === 'Escape') gamiCloseSheet(); }
function gamiOpenSheet(title, html){
  gamiCloseSheet();
  const back = document.createElement('div');
  back.id = 'gm-sheet'; back.className = 'gm-sheet-back';
  back.innerHTML = `<div class="gm-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><span class="gm-grab" aria-hidden="true"></span>${html}
    <button type="button" class="btn btn-secondary gm-sheet-x">Cerrar</button></div>`;
  back.addEventListener('click', (e) => { if(e.target === back || e.target.closest('.gm-sheet-x')) gamiCloseSheet(); });
  document.addEventListener('keydown', gamiSheetKey);
  document.body.appendChild(back);
  const x = back.querySelector('.gm-sheet-x'); if(x) x.focus();
}
function gamiLadderSheet(){
  const g = STATE.gami; if(!g) return;
  const rows = g.ranks.map(r => {
    const cur = r.ord === g.rank.ord;
    const req = gmN(r.min_points) + ' pts' + (r.min_crowns ? ' · ' + r.min_crowns + ' coronas' : '');
    return `<li class="gm-lad ${r.reached ? 'on' : ''} ${cur ? 'cur' : ''}">
      <span class="gm-lad-sh">${gamiShield(r.ord, cur ? g.rank.sub : (r.reached ? 3 : 0), 30)}</span>
      <span class="gm-lad-t"><strong>${esc(r.name)}</strong><small>${req}</small></span>
      <span class="gm-lad-st">${cur ? '<em>Tu rango</em>' : r.reached ? shellIcon('check') : shellIcon('lock')}</span></li>`;
  }).join('');
  gamiOpenSheet('Escala de rangos', `<h3>Escala de rangos</h3>
    <p class="gm-sheet-p">Para subir de rango hay que cumplir los <b>puntos Y las coronas</b>. Dentro de cada rango hay tres subniveles (I, II y III).</p>
    <ol class="gm-lad-list">${rows}</ol>
    <p class="gm-note">Categorías inspiradas en el arbitraje español. No oficiales.</p>`);
}
function gamiBadgeSheet(id){
  const g = STATE.gami; if(!g) return;
  const b = g.badges.find(x => x.id === id); if(!b) return;
  const st = gamiBadgeState(b);
  const prog = st === 'hidden' ? '<p class="gm-sheet-p">Insignia oculta: sigue jugando para descubrirla.</p>'
    : st === 'earned' ? `<p class="gm-sheet-ok">${shellIcon('check')} Conseguida el ${esc(gamiDate(b.earned_at))}</p>`
    : (b.metric === 'league_best' ? `<p class="gm-sheet-p">${esc(gamiProgText(b))}</p>`
      : `<div class="gm-bar light"><i style="width:${Math.min(100, Math.round((b.cur || 0) / b.target * 100))}%"></i></div><p class="gm-sheet-p">${esc(gamiProgText(b))}</p>`);
  gamiOpenSheet(b.name, `<div class="gm-det"><div class="gm-det-medal">${gamiMedal(b, st, 96)}</div>
    <p class="gm-det-fam">${esc(GM_FAMILY_NAME[b.family] || '')}${b.tier ? ' · ' + GM_TIER_NAME[b.tier] : ''}</p>
    <h3>${esc(b.name)}</h3><p class="gm-sheet-p">${esc(b.descr)}</p>${prog}</div>`);
}

/* ---------- pantalla #/logros ---------- */
function gamiView(){
  const g = STATE.gami;
  if(!g) return '<button class="backbtn" data-action="home">&larr; Inicio</button><div class="skel-wrap" role="status" aria-label="Cargando"><span class="skel skel-title"></span><span class="skel skel-block"></span></div>';
  const r = g.rank, nx = gamiNext();
  const crownsNote = nx && nx.crowns > 0 ? `<p class="gm-warn">${shellIcon('lock')} Te faltan ${nx.crowns} ${nx.crowns === 1 ? 'corona' : 'coronas'} para ser ${esc(r.next.name)}</p>` : '';
  const hero = `<section class="gm-hero">
    <div class="gm-hero-row">${gamiShield(r.ord, r.sub, 76)}
      <div class="gm-hero-t"><div class="gm-eyebrow">Tu rango</div><h1>${esc(r.name)} ${GM_ROMAN[r.sub]}</h1></div></div>
    ${nx ? `<div class="gm-bar"><i style="width:${nx.progressPct}%"></i></div>
      <p class="gm-prog"><b>${gmN(g.points)}</b> / ${gmN(r.sub_to)} pts${nx.remaining > 0 ? ' · faltan ' + gmN(nx.remaining) : ''}</p>${crownsNote}`
      : `<p class="gm-prog"><b>${gmN(g.points)}</b> pts · ¡Has alcanzado el rango máximo!</p>`}
    <div class="gm-chips"><span><b>${gmN(g.points)}</b> puntos</span><span><b>${g.crowns}/${g.crowns_max}</b> coronas</span><span><b>${g.streak}</b> ${g.streak === 1 ? 'día' : 'días'} de racha</span></div>
  </section>`;
  const steps = g.ranks.map((x, i) => `<span class="gm-step ${x.ord < r.ord ? 'on' : ''} ${x.ord === r.ord ? 'cur' : ''} ${x.ord > r.ord ? 'off' : ''}">
      <i>${x.ord > r.ord ? shellIcon('lock') : esc(GM_ABBR[i] || '')}</i><small>${x.ord > r.ord ? esc(GM_ABBR[i] || '') : ''}</small></span>`).join('');
  const ladder = `<button type="button" class="gm-ladder" data-action="gami-ladder" aria-label="Ver la escala de rangos completa">
    <span class="gm-ladder-h"><b>Escala de rangos</b><em>Ver requisitos ${shellIcon('award')}</em></span><span class="gm-steps">${steps}</span></button>`;
  const almost = g.badges.filter(b => !b.earned_at && !b.hidden && b.metric !== 'league_best' && b.cur != null && b.cur > 0 && b.cur < b.target)
    .sort((a, b) => (b.cur / b.target) - (a.cur / a.target)).slice(0, 3);
  const almostHtml = almost.length ? `<section class="gm-card"><h2>Casi las tienes</h2><ul class="gm-almost">${almost.map(b => `<li><button type="button" class="gm-alm" data-action="gami-badge" data-id="${esc(b.id)}">
      <span class="gm-alm-m">${gamiMedal(b, 'locked', 44)}</span>
      <span class="gm-alm-t"><strong>${esc(gamiBadgeLabel(b))}</strong><span class="gm-bar light"><i style="width:${Math.round(b.cur / b.target * 100)}%"></i></span><small>${esc(gamiProgText(b))}</small></span></button></li>`).join('')}</ul></section>` : '';
  const grid = g.badges.map(b => { const st = gamiBadgeState(b);
    return `<button type="button" class="gm-badge ${st}" data-action="gami-badge" data-id="${esc(b.id)}" aria-label="${esc(st === 'hidden' ? 'Insignia oculta' : gamiBadgeLabel(b) + (st === 'earned' ? ', conseguida' : ', bloqueada'))}">
      ${gamiMedal(b, st, 64)}<span>${esc(st === 'hidden' ? '?' : b.name)}</span></button>`; }).join('');
  const c = gamiCounts();
  const badges = `<section class="gm-card"><h2>Insignias <small>${c.earned} de ${c.total}</small></h2><div class="gm-grid">${grid}</div></section>`;
  const recent = g.recent.length ? `<section class="gm-card"><h2>Últimos movimientos</h2><ul class="gm-recent">${g.recent.map(m =>
    `<li><b>+${gmN(m.points)}</b><span>${esc(gamiReasonText(m))}</span><small>${esc(gamiAgo(m.ts))}</small></li>`).join('')}</ul></section>` : '';
  return `<button class="backbtn" data-action="home">&larr; Inicio</button>
    <div class="gm">
      <div class="gm-col gm-left">${hero}${ladder}${almostHtml}${recent}<p class="gm-note">Categorías inspiradas en el arbitraje español. No oficiales.</p>${typeof proButton === 'function' ? proButton('logros') : ''}</div>
      <div class="gm-col gm-right">${badges}</div>
    </div>`;
}

/* ---------- celebraciones (subir de rango / nueva insignia) ---------- */
function gamiAck(){
  if(STATE.gami) STATE.gami.pending = { rank_up: null, badges: [] };
  try{ Promise.resolve(supabaseClient.rpc('gami_ack')).catch(() => {}); }catch(e){}
}
function gamiAfterRender(){
  const g = STATE.gami;
  if(!g || g.error || STATE.gamiCelebrating || document.getElementById('gm-cele')) return;
  if(GM_NO_RENDER_VIEWS.includes(String(STATE.view))) return;
  const p = g.pending || {}, queue = [];
  if(p.rank_up && p.rank_up.new_rank) queue.push({ kind: 'rank' });
  (p.badges || []).forEach(id => { const b = g.badges.find(x => x.id === id); if(b) queue.push({ kind: 'badge', badge: b }); });
  if(!queue.length){
    if(p.rank_up){ const lab = g.rank.name + ' ' + GM_ROMAN[g.rank.sub]; gamiAck(); setTimeout(() => { STATE.toast = '¡Subes a ' + lab + '!'; render(); }, 0); }
    else if((p.badges || []).length) gamiAck();
    return;
  }
  STATE.gamiCelebrating = true;
  gamiCelebrate(queue, 0);
}
function gamiCelebrate(queue, i){
  const old = document.getElementById('gm-cele'); if(old) old.remove();
  const g = STATE.gami, it = queue[i];
  if(!it){ STATE.gamiCelebrating = false; gamiAck(); return; }
  const isRank = it.kind === 'rank';
  const title = isRank ? '¡Subes de rango!' : '¡Nueva insignia!';
  const name = isRank ? g.rank.name + ' ' + GM_ROMAN[g.rank.sub] : it.badge.name;
  const sub = isRank ? (nxtText()) : it.badge.descr + (it.badge.tier ? ' · ' + GM_TIER_NAME[it.badge.tier] : '');
  function nxtText(){ const n = gamiNext(); return n ? 'Siguiente: ' + n.name + ' (' + n.hint + ')' : 'Has alcanzado el rango máximo'; }
  const art = isRank ? gamiShield(g.rank.ord, g.rank.sub, 132) : gamiMedal(it.badge, 'earned', 132);
  const back = document.createElement('div');
  back.id = 'gm-cele'; back.className = 'gm-cele-back';
  back.innerHTML = `<div class="gm-cele" role="dialog" aria-modal="true" aria-labelledby="gm-cele-t">
    <div class="gm-cele-art"><span class="gm-rays" aria-hidden="true"></span>${art}</div>
    <p class="gm-cele-eyebrow" id="gm-cele-t">${title}</p><h2>${esc(name)}</h2><p class="gm-cele-sub">${esc(sub)}</p>
    <div class="gm-cele-actions"><button type="button" class="btn btn-primary" data-next>${i + 1 < queue.length ? 'Siguiente' : 'Continuar'}</button>
      <button type="button" class="btn btn-secondary" data-share>Compartir imagen</button></div></div>`;
  back.addEventListener('click', (e) => {
    if(e.target.closest('[data-next]')){ gamiCelebrate(queue, i + 1); }
    else if(e.target.closest('[data-share]')){ gamiShare(it, name, sub); }
  });
  document.body.appendChild(back);
  const nb = back.querySelector('[data-next]'); if(nb) nb.focus();
}

/* Imagen para compartir (se dibuja aquí mismo: no sale ningún dato de la app) */
async function gamiShare(it, name, sub){
  try{
    const g = STATE.gami, W = 1080, H = 1350;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    try{ await document.fonts.load('700 96px Oswald'); await document.fonts.load('600 36px "Work Sans"'); }catch(e){}
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#26272D'); bg.addColorStop(1, '#101114');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const glow = x.createRadialGradient(W / 2, 560, 40, W / 2, 560, 520); glow.addColorStop(0, 'rgba(255,201,60,.28)'); glow.addColorStop(1, 'rgba(255,201,60,0)');
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.fillStyle = '#FFC93C'; x.font = '700 54px Oswald, sans-serif'; x.fillText('WEREF', W / 2, 130);
    if(it.kind === 'rank'){
      const s = 13; x.save(); x.translate(W / 2 - 24 * s, 330); x.scale(s, s);
      const body = new Path2D('M24 3 43 10v18c0 12-9 21-19 25C14 49 5 40 5 28V10Z'), inner = new Path2D('M24 8 38 13v15c0 9-6 16-14 20-8-4-14-11-14-20V13Z');
      x.fillStyle = '#17181C'; x.fill(body); x.lineWidth = 1.6; x.strokeStyle = '#FFC93C'; x.stroke(body);
      x.fillStyle = '#26272D'; x.fill(inner);
      x.fillStyle = '#FFC93C'; x.font = '700 22px Oswald, sans-serif'; x.fillText(String(g.rank.ord), 24, 33);
      for(let i = 1; i <= 3; i++){ x.beginPath(); x.arc(17 + (i - 1) * 7, 43, 2.3, 0, 7); x.fillStyle = i <= g.rank.sub ? '#FFC93C' : 'rgba(255,201,60,.25)'; x.fill(); }
      x.restore();
    } else {
      const b = it.badge, ring = b.tier === 1 ? '#C4915F' : b.tier === 2 ? '#B4BAC3' : '#FFC93C';
      x.beginPath(); x.arc(W / 2, 560, 250, 0, 7); x.fillStyle = '#FFF6D6'; x.fill(); x.lineWidth = 24; x.strokeStyle = ring; x.stroke();
      const icon = GM_FAMILY_ICON[b.family] || 'award';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="300" height="300" fill="none" stroke="#17181C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SHELL_ICONS[icon] || ''}</svg>`;
      await new Promise((ok) => { const im = new Image(); im.onload = () => { x.drawImage(im, W / 2 - 150, 410, 300, 300); ok(); }; im.onerror = ok; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    }
    x.fillStyle = '#B9B7B0'; x.font = '600 40px "Work Sans", sans-serif'; x.fillText(it.kind === 'rank' ? 'HE SUBIDO DE RANGO' : 'NUEVA INSIGNIA', W / 2, 930);
    x.fillStyle = '#FFFFFF'; x.font = '700 104px Oswald, sans-serif'; x.fillText(name, W / 2, 1040, W - 120);
    x.fillStyle = '#B9B7B0'; x.font = '500 34px "Work Sans", sans-serif'; x.fillText(String(sub).slice(0, 60), W / 2, 1105, W - 140);
    x.fillStyle = '#8B8982'; x.font = '500 28px "Work Sans", sans-serif'; x.fillText('we-ref.com · Categorías inspiradas en el arbitraje español. No oficiales.', W / 2, 1270, W - 80);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    if(!blob) throw new Error('sin imagen');
    const file = new File([blob], 'weref-logro.png', { type: 'image/png' });
    if(navigator.canShare && navigator.canShare({ files: [file] })){ await navigator.share({ files: [file], title: 'WEREF' }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'weref-logro.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }catch(e){ if(!(e && e.name === 'AbortError')){ STATE.toast = 'No se pudo preparar la imagen.'; render(); } }
}

function gamiAction(action, el){
  if(action === 'gami-ladder') gamiLadderSheet();
  else if(action === 'gami-badge') gamiBadgeSheet(el.dataset.id);
}
