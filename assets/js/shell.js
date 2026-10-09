/* ---------------- ESTRUCTURA DE LA APP: menú lateral (ordenador) y barra inferior (móvil) ----------------
   Envuelve cada pantalla con la navegación. Depende de app.js (STATE, isDevUser, computePoints, currentRank,
   LOGO_MARK, esc) y, si existe, de committee.js (COMMITTEE). */

const SHELL_FOCUS_VIEWS = ['quiz', 'myBankQuiz', 'committeeRun'];

const SHELL_ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  trophy: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>',
  folder: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  repeat: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  glossary: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  idea: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'
};

function shellIcon(name){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHELL_ICONS[name] || ''}</svg>`;
}

function shellSection(view){
  const v = String(view);
  if(v === 'home') return 'home';
  if(['law', 'trainConfig', 'result', 'flagged', 'add', 'suggestForm'].includes(v)) return 'reglas';
  if(['dailyChallenge', 'leaderboard'].includes(v)) return 'league';
  if(v === 'academia' || v === 'savedBrowse' || v.startsWith('myBank') || v.startsWith('myDocs')) return 'academia';
  if(['stats', 'recentPerformance', 'streakCalendar'].includes(v)) return 'stats';
  if(v === 'achievements') return 'logros';
  if(v.startsWith('committee')) return 'comite';
  if(v === 'database') return 'db';
  if(v === 'suggestionsAdmin') return 'sug';
  if(v === 'adminDashboard') return 'panel';
  if(v.startsWith('profile')) return 'config';
  if(v === 'menu') return 'more';
  return '';
}

function shellNavItems(){
  const st = (typeof COMMITTEE !== 'undefined') ? COMMITTEE.status : null;
  const academiaTotal = Object.keys(STATE.storage.saved || {}).length;
  const main = [
    { id: 'home', label: 'Inicio', icon: 'home', action: 'home' },
    { id: 'reglas', label: 'Reglas de Juego', icon: 'book', action: 'train-config' },
    { id: 'league', label: 'WEREF League', icon: 'trophy', action: 'dailyChallenge' },
    { id: 'academia', label: 'Mi Academia', icon: 'folder', action: 'academia', badge: academiaTotal || 0 },
    { id: 'stats', label: 'Estadísticas', icon: 'chart', action: 'stats' },
    { id: 'logros', label: 'Rango e insignias', icon: 'award', action: 'achievements' }
  ];
  if(st && (st.is_admin || st.is_member)) main.push({ id: 'comite', label: 'Formación Comité', icon: 'users', action: 'committee-open' });
  const admin = [];
  if(isDevUser()){
    const reports = Object.keys(STATE.reports || {}).length;
    const pending = (STATE.suggestions || []).filter(s => s.status === 'pending').length;
    admin.push({ id: 'db', label: 'Base de datos', icon: 'database', action: 'database', badge: reports, alert: true });
    admin.push({ id: 'sug', label: 'Sugerencias', icon: 'message', action: 'suggestions-admin', badge: pending, alert: true });
    admin.push({ id: 'panel', label: 'Panel de administración', icon: 'dashboard', action: 'admin-dashboard' });
  }
  return { main, admin };
}

function shellLink(it, active){
  const badge = it.badge ? `<span class="shell-badge ${it.alert ? 'alert' : ''}">${it.badge}</span>` : '';
  return `<button class="shell-link ${active === it.id ? 'active' : ''}" data-action="${it.action}">${shellIcon(it.icon)}<span>${it.label}</span>${badge}</button>`;
}

function shellFor(view, html){
  const active = shellSection(view);
  const { main, admin } = shellNavItems();
  const points = computePoints();
  const rank = currentRank(points);
  const name = (typeof CURRENT_USERNAME !== 'undefined' && CURRENT_USERNAME) ? CURRENT_USERNAME : 'Mi cuenta';
  const side = `
  <aside class="shell-side">
    <div class="shell-brand"><span class="mark">${LOGO_MARK}</span><span>WEREF</span></div>
    <nav class="shell-nav" aria-label="Navegación principal">${main.map(it => shellLink(it, active)).join('')}</nav>
    ${admin.length ? `<div class="shell-sep">Administración</div><nav class="shell-nav">${admin.map(it => shellLink(it, active)).join('')}</nav>` : ''}
    <div class="shell-spacer"></div>
    <button class="shell-user" data-action="achievements" title="Ver rango e insignias">
      <span class="shell-avatar">${esc(name.charAt(0).toUpperCase())}</span>
      <span class="shell-user-text"><strong>${esc(name)}</strong><small>${esc(rank.name)} · ${points} pts</small></span>
    </button>
    <div class="shell-foot">
      <button class="shell-link ${active === 'config' ? 'active' : ''}" data-action="profile">${shellIcon('settings')}<span>Configuración</span></button>
      <button class="shell-link" data-action="logout">${shellIcon('logout')}<span>Cerrar sesión</span></button>
    </div>
  </aside>`;
  const bottomItems = [
    { id: 'home', label: 'Inicio', icon: 'home', action: 'home' },
    { id: 'reglas', label: 'Reglas', icon: 'book', action: 'train-config' },
    { id: 'league', label: 'League', icon: 'trophy', action: 'dailyChallenge' },
    { id: 'academia', label: 'Academia', icon: 'folder', action: 'academia' },
    { id: 'more', label: 'Más', icon: 'more', action: 'menu' }
  ];
  const moreIds = ['stats', 'logros', 'comite', 'db', 'sug', 'panel', 'config'];
  const bottomActive = moreIds.includes(active) ? 'more' : active;
  const bottom = `<nav class="shell-bottom" aria-label="Navegación">${bottomItems.map(it =>
    `<button class="${bottomActive === it.id ? 'active' : ''}" data-action="${it.action}">${shellIcon(it.icon)}<span>${it.label}</span></button>`).join('')}</nav>`;
  const wide = String(view) === 'home';
  return `<div class="shell">${side}<main class="shell-main"><div class="shell-content ${wide ? 'wide' : ''}">${html}</div></main></div>${bottom}`;
}

/* "Más": todo lo que no cabe en la barra inferior del móvil */
function menuView(){
  const { main, admin } = shellNavItems();
  const extra = main.filter(it => ['stats', 'logros', 'comite'].includes(it.id));
  const row = it => `<button class="menu-row" data-action="${it.action}">
    <span class="menu-ic">${shellIcon(it.icon)}</span><span class="menu-label">${it.label}</span>
    ${it.badge ? `<span class="shell-badge ${it.alert ? 'alert' : ''}">${it.badge}</span>` : ''}
    <span class="menu-chev">${shellIcon('chevron')}</span></button>`;
  const flags = Object.keys(STATE.storage.flags || {}).length;
  return `
  <h2 style="margin-bottom:14px;">Más</h2>
  <div class="home-panel" style="padding:6px;">${extra.map(row).join('')}</div>
  ${flags ? `<div class="home-panel" style="padding:6px; margin-top:12px;">${row({ label: 'Preguntas marcadas', icon: 'flag', action: 'flagged-list', badge: flags })}</div>` : ''}
  ${admin.length ? `<div class="home-panel-title" style="margin:18px 4px 8px;">Administración</div><div class="home-panel" style="padding:6px;">${admin.map(row).join('')}</div>` : ''}
  <div class="home-panel" style="padding:6px; margin-top:12px;">
    ${row({ label: 'Configuración de la cuenta', icon: 'settings', action: 'profile' })}
    ${row({ label: 'Cerrar sesión', icon: 'logout', action: 'logout' })}
  </div>`;
}
