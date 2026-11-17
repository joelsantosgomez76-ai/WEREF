/* ---------------- CABECERAS COMUNES ----------------
   Un solo componente para todas las pantallas, enganchado a render() (no toca la lógica de las pantallas):
   A) Apartados principales (Inicio, Crear test, League, Mi Academia): sin botón de volver. En móvil, barra fija con logo, racha y perfil.
   B) Pantallas interiores (las que traían un "← ..." suelto): botón volver real (44 px, solo el botón es clicable), título que aparece
      al hacer scroll, hueco para acciones y, en escritorio, migas de pan.
   Volver: si la pantalla anterior es de la app se usa history.back(); si se entró por URL, se va a la pantalla padre lógica.
   Durante un test (SHELL_FOCUS_VIEWS) no se usa: el test tiene su propia barra. */
const PH = { scrollBound: false };
const PH_MAIN_VIEWS = ['home', 'trainConfig', 'dailyChallenge', 'leaderboard', 'academia'];
const PH_FORCE_INTERIOR = ['result', 'myBankResult'];
const PH_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const PH_VIEW_LABELS = {
  home: 'Inicio', law: 'Regla', trainConfig: 'Crear test', dailyChallenge: 'WEREF League', leaderboard: 'WEREF League', academia: 'Mi Academia',
  stats: 'Estadísticas', achievements: 'Rango e insignias', recentPerformance: 'Rendimiento', streakCalendar: 'Racha', menu: 'Más',
  profile: 'Configuración', profileEdit: 'Editar cuenta', myDocs: 'Mis documentos', myDocsPreview: 'Documento', myBank: 'Mis propios test',
  myBankCategory: 'Categoría', myBankForm: 'Pregunta', myBankTrainConfig: 'Crear test propio', savedBrowse: 'Preguntas guardadas',
  result: 'Resultado', myBankResult: 'Resultado', suggestForm: 'Sugerencias', database: 'Base de datos', adminDashboard: 'Panel de administración', adminAnalytics: 'Analítica', suggestionsAdmin: 'Sugerencias'
};
const PH_SPECIAL_LAWS = { failed: 'Sala de Repaso', hard: 'Sala VAR', glossary: 'Glosario', saved: 'Preguntas guardadas', assistants: 'Árbitros asistentes' };

/* Nombre de una dirección del historial (#/regla/12 -> "Regla 12"). */
function phRouteLabel(route){
  const r = String(route || '');
  const simple = { '#/inicio': 'Inicio', '#/crear-test': 'Crear test', '#/league': 'WEREF League', '#/league/clasificacion': 'WEREF League', '#/academia': 'Mi Academia',
    '#/estadisticas': 'Estadísticas', '#/logros': 'Rango e insignias', '#/rendimiento': 'Rendimiento', '#/calendario': 'Racha', '#/mas': 'Más', '#/perfil': 'Configuración', '#/resultado': 'Resultado' };
  if(simple[r]) return simple[r];
  if(r.indexOf('#/regla/') === 0){ const k = r.slice(8); return /^\d+$/.test(k) ? 'Regla ' + k : (PH_SPECIAL_LAWS[k] || 'Regla'); }
  if(r.indexOf('#/v/') === 0) return PH_VIEW_LABELS[r.slice(4)] || '';
  return '';
}
/* Pantalla anterior de la app (solo si se puede reabrir desde su dirección). */
function phPrev(){
  const s = (typeof NAV !== 'undefined') ? NAV.stack : null;
  if(!s || s.length < 2) return null;
  const p = s[s.length - 2];
  return (typeof navParse === 'function' && navParse(p) && phRouteLabel(p)) ? p : null;
}
function phKebab(k){ return String(k).replace(/[A-Z]/g, m => '-' + m.toLowerCase()); }
function phDataAttrs(ds){ return Object.keys(ds || {}).map(k => `data-${phKebab(k)}="${esc(String(ds[k]))}"`).join(' '); }
function phInitials(){
  const n = String((typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) || (typeof CURRENT_USER_EMAIL !== 'undefined' && CURRENT_USER_EMAIL) || '?').trim();
  const words = n.split(/[\s._-]+/).filter(Boolean);
  return esc((words.length > 1 ? words[0].charAt(0) + words[1].charAt(0) : (words[0] || '?').charAt(0)).toUpperCase());
}

/* Barra fija de los apartados principales (solo móvil/tablet; en escritorio la barra lateral ya cumple esa función). */
function phTopBarHtml(){
  let streak = 0; try{ streak = computeStreak(); }catch(e){}
  const dias = streak === 1 ? 'día' : 'días';
  return `<header class="ph-top" role="banner">
    <span class="ph-logo"><span class="mark" aria-hidden="true">${LOGO_MARK}</span><b>WEREF</b></span>
    <span class="ph-sp"></span>
    <button type="button" class="ph-streak" data-action="streak-calendar" aria-label="Racha de ${streak} ${dias}. Abrir calendario">${shellIcon('flame')}<b>${streak}</b></button>
    <button type="button" class="ph-avatar" data-action="profile" aria-label="Abrir perfil y configuración">${phInitials()}</button>
  </header>`;
}

function phTitle(content, v){
  if(v === 'law' && typeof STATE.lawId === 'number') return 'Regla ' + STATE.lawId + ' · ' + ((typeof LAW_SHORT !== 'undefined' && LAW_SHORT[STATE.lawId]) || (typeof LAW_NAMES !== 'undefined' && LAW_NAMES[STATE.lawId]) || '');
  const h = content.querySelector('h1');
  const t = h ? h.textContent.replace(/\s+/g, ' ').trim() : '';
  return t || PH_VIEW_LABELS[v] || '';
}

function phEnhance(app){
  app.classList.remove('ph-main', 'ph-int');
  if(!app.classList.contains('has-shell')) return;
  const content = app.querySelector('.shell-content');
  if(!content) return;
  const v = String(STATE.view);
  const orig = content.querySelector('.backbtn');
  let main = PH_MAIN_VIEWS.includes(v);
  if(v === 'trainConfig' && STATE.trainCfg && (STATE.trainCfg.scopeOverride || STATE.ctFrom != null)) main = false;   // abierto desde una regla o sala: tiene padre

  if(main){
    if(orig) orig.remove();
    app.classList.add('ph-main');
    content.insertAdjacentHTML('afterbegin', phTopBarHtml());
    phBindScroll();
    return;
  }
  if(!orig && !PH_FORCE_INTERIOR.includes(v)) return;

  /* pantalla interior */
  const fb = orig ? Object.assign({}, orig.dataset) : { action: 'home' };
  let fbLabel = orig ? orig.textContent.replace(/^[\s←]+/, '').replace(/\s+/g, ' ').trim() : 'Inicio';
  if(!fbLabel) fbLabel = 'Inicio';
  const prev = phPrev();
  let label = prev ? phRouteLabel(prev) : fbLabel.replace(/^Volver a (la |el )?/i, '').replace(/^todas las reglas$/i, 'Reglas').replace(/^./, c => c.toUpperCase());
  if(/^volver$/i.test(label)) label = 'Atrás';
  const title = phTitle(content, v);
  /* migas: siempre según el padre lógico (el del botón original), no según el historial */
  const parentLabel = fbLabel.replace(/^Volver a (la |el )?/i, '').replace(/^todas las reglas$/i, 'Reglas').replace(/^./, c => c.toUpperCase());
  const genericBack = /^(volver|atrás)$/i.test(parentLabel);
  const crumbs = [{ label: 'Inicio', attrs: 'data-action="home"' }];
  if(fb.action === 'home' && /^reglas$/i.test(parentLabel)) crumbs.push({ label: 'Reglas', attrs: 'data-action="home"' });
  else if(fb.action !== 'home' && !genericBack && parentLabel !== title) crumbs.push({ label: parentLabel, attrs: phDataAttrs(fb) });
  const crumbsHtml = crumbs.map(c => `<button type="button" class="ph-crumb" ${c.attrs}>${esc(c.label)}</button><span class="ph-sep" aria-hidden="true">/</span>`).join('')
    + `<span class="ph-crumb cur" aria-current="page">${esc(title)}</span>`;
  const html = `<div class="ph ph-i">
    <nav class="ph-crumbs" aria-label="Ruta de navegación">${crumbsHtml}</nav>
    <div class="ph-bar">
      <button type="button" class="ph-back" data-action="ph-back" data-fb="${esc(JSON.stringify(fb))}" aria-label="${label === 'Atrás' ? 'Volver atrás' : 'Volver a ' + esc(label)}">${PH_ARROW}<span>${esc(label)}</span></button>
      <div class="ph-title" aria-hidden="true">${esc(title)}</div>
      <div class="ph-act"></div>
    </div>
  </div>`;
  if(orig) orig.insertAdjacentHTML('beforebegin', html); else content.insertAdjacentHTML('afterbegin', html);
  if(orig) orig.remove();
  app.classList.add('ph-int');
  /* acciones contextuales: en una regla, el menú ⋯ (con "reiniciar progreso") pasa a la cabecera */
  const act = content.querySelector('.ph-act');
  const menu = content.querySelector('.rp-menu');
  if(act && menu && v === 'law') act.appendChild(menu);
  phBindScroll();
}

/* Sombra de la barra y título al hacer scroll (una sola vez para toda la app). */
function phBindScroll(){
  if(!PH.scrollBound){
    PH.scrollBound = true;
    let raf = 0;
    PH.update = function(){
      raf = 0;
      const root = document.documentElement, y = window.scrollY || 0;
      root.classList.toggle('ph-scrolled', y > 6);
      const h = document.querySelector('.shell-content h1');
      root.classList.toggle('ph-title-on', h ? h.getBoundingClientRect().bottom < 64 : y > 80);
    };
    window.addEventListener('scroll', function(){ if(!raf) raf = requestAnimationFrame(PH.update); }, { passive: true });
  }
  PH.update();
}

/* Acciones del componente (las llama onAction para todo lo que empieza por "ph-"). */
function phAction(action, el){
  if(action === 'ph-back'){
    if(phPrev() && typeof NAV !== 'undefined' && NAV.ready){ history.back(); return; }
    let fb = {}; try{ fb = JSON.parse(el.dataset.fb || '{}'); }catch(e){}
    if(fb.action) onAction({ currentTarget: { dataset: fb } });
    else { STATE.view = 'home'; render(); }
  }
  else if(action === 'ph-league-info') phLeagueInfo();
}

/* "Cómo funciona" de la League: reglas de puntuación de cada modo. */
function phLeagueInfo(){
  const old = document.getElementById('ph-info'); if(old) old.remove();
  const lastFocus = document.activeElement;
  const m = document.createElement('div');
  m.id = 'ph-info'; m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal-card ph-info-card" role="dialog" aria-modal="true" aria-labelledby="ph-info-t">
    <h3 id="ph-info-t">Cómo funciona la League</h3>
    <dl class="ph-info-list">
      <div><dt>${shellIcon('heart')} Corazones</dt><dd>Tienes 3 vidas y cada fallo te quita una. La partida acaba al perder las 3. Tu puntuación son tus aciertos. No hay límite de tiempo.</dd></div>
      <div><dt>${shellIcon('zap')} Muerte Súbita</dt><dd>Una sola vida: la partida acaba en tu primer fallo. Tu puntuación son los aciertos seguidos.</dd></div>
      <div><dt>${shellIcon('timer')} Contrarreloj</dt><dd>Tienes 60 segundos. Cada acierto suma 1 punto y cada fallo resta 0,5 (nunca bajas de 0).</dd></div>
    </dl>
    <p class="ph-info-note">En cada modo cuenta tu <b>mejor puntuación</b>. Gana puesto quien tiene más puntos y, si hay empate, queda primero quien lo consiguió antes. Se muestran los 25 primeros y tu posición.</p>
    <button type="button" class="btn btn-primary" data-ph-close="1">Entendido</button>
  </div>`;
  const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); try{ if(lastFocus && lastFocus.focus) lastFocus.focus(); }catch(e){} };
  const onKey = (e) => { if(e.key === 'Escape'){ e.preventDefault(); close(); } };
  m.addEventListener('click', (e) => { if(e.target === m || e.target.closest('[data-ph-close]')) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(m);
  m.querySelector('[data-ph-close]').focus();
}
