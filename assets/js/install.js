/* ---------------- Aviso para instalar WeRef en el móvil ----------------
   Tarjeta en Inicio (solo móvil, solo si la app aún no está instalada) y una fila en "Más".
   - Android con Chrome: el botón instala con el aviso del propio sistema.
   - iPhone / iPad y el resto: una hoja con los pasos (Compartir → Añadir a pantalla de inicio).
   Se puede cerrar con la ✕ y vuelve a salir a los 21 días; la fila de "Más" siempre está. */

const INSTALL = { deferred: null, KEY: 'weref_install_hide', DAYS: 21 };

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  INSTALL.deferred = e;
  if(typeof STATE !== 'undefined' && (STATE.view === 'home' || STATE.view === 'menu') && typeof render === 'function') render();
});
window.addEventListener('appinstalled', () => {
  INSTALL.deferred = null;
  try{ localStorage.setItem(INSTALL.KEY, 'installed'); }catch(e){}
  installSheetClose();
  if(typeof STATE !== 'undefined' && typeof render === 'function') render();
});

function installStandalone(){
  try{ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }catch(e){ return false; }
}
function installPlatform(){
  const ua = navigator.userAgent || '';
  if(/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if(/Android/i.test(ua)) return 'android';
  return 'other';
}
function installAvailable(){                    // ¿tiene sentido ofrecerlo en este dispositivo?
  return installPlatform() !== 'other' && !installStandalone();
}
function installHidden(){
  try{
    const v = localStorage.getItem(INSTALL.KEY);
    if(v === 'installed') return true;
    return !!v && (Date.now() - Number(v)) < INSTALL.DAYS * 86400000;
  }catch(e){ return false; }
}
function installIcon(name){
  const s = {
    share: '<path d="M12 15V3"/><path d="m8 7 4-4 4 4"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/>',
    addhome: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    dots: '<circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    tap: '<path d="m5 12 4.5 4.5L19 7"/>'
  }[name] || '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`;
}

/* Tarjeta de Inicio */
function installBannerHtml(){
  if(!installAvailable() || installHidden()) return '';
  const direct = !!INSTALL.deferred;
  return `<section class="inst-banner" aria-label="Instalar la app">
    <button type="button" class="inst-x" data-action="install-dismiss" aria-label="Ahora no">✕</button>
    <div class="inst-top">
      <img class="inst-icon" src="assets/icon-192.png?v=2" width="56" height="56" alt="">
      <div class="inst-text">
        <div class="inst-eyebrow">Mejor en tu móvil</div>
        <h3>Instala WeRef en tu pantalla de inicio</h3>
      </div>
    </div>
    <ul class="inst-perks">
      <li>${installIcon('tap')}Abre al instante</li>
      <li>${installIcon('tap')}Pantalla completa</li>
      <li>${installIcon('tap')}Sin descargar nada</li>
    </ul>
    <div class="inst-actions">
      <button type="button" class="btn btn-yellow" data-action="install-open">${installIcon(direct ? 'download' : 'addhome')} ${direct ? 'Instalar app' : 'Cómo instalarla'}</button>
      <button type="button" class="inst-later" data-action="install-dismiss">Ahora no</button>
    </div>
  </section>`;
}
/* Fila del menú "Más" */
function installMenuRow(){
  if(!installAvailable()) return '';
  return `<div class="home-panel" style="padding:6px; margin-top:12px;">
    <button class="menu-row" data-action="install-open">
      <span class="menu-ic">${installIcon('addhome')}</span><span class="menu-label">Instalar la app en el móvil</span>
      <span class="menu-chev">${shellIcon('chevron')}</span></button>
  </div>`;
}

/* Hoja con los pasos */
function installSheetClose(){
  const s = document.getElementById('inst-sheet');
  if(s){ s.classList.remove('show'); setTimeout(() => s.remove(), 200); }
  document.removeEventListener('keydown', installSheetKey, true);
}
function installSheetKey(e){ if(e.key === 'Escape'){ e.preventDefault(); installSheetClose(); } }
function installSheetOpen(){
  installSheetClose();
  const plat = installPlatform();
  const ua = navigator.userAgent || '';
  const notSafari = plat === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const steps = plat === 'ios' ? [
    ['share', 'Pulsa <b>Compartir</b>', 'El botón del cuadrado con una flecha hacia arriba, en la barra de abajo de Safari.'],
    ['addhome', 'Elige <b>Añadir a pantalla de inicio</b>', 'Desliza hacia abajo en el menú hasta encontrarlo.'],
    ['tap', 'Pulsa <b>Añadir</b>', 'WeRef aparece en tu pantalla de inicio como una app más.']
  ] : [
    ['dots', 'Abre el <b>menú</b> del navegador', 'Los tres puntos de arriba a la derecha.'],
    ['download', 'Pulsa <b>Instalar aplicación</b>', 'O «Añadir a pantalla de inicio», según tu navegador.'],
    ['tap', 'Confirma con <b>Instalar</b>', 'WeRef aparece en tu pantalla de inicio como una app más.']
  ];
  const el = document.createElement('div');
  el.id = 'inst-sheet'; el.className = 'inst-sheet';
  el.innerHTML = `<div class="inst-card" role="dialog" aria-modal="true" aria-labelledby="inst-title">
      <div class="inst-grab" aria-hidden="true"></div>
      <img class="inst-bigicon" src="assets/icon-192.png?v=2" width="72" height="72" alt="">
      <h3 id="inst-title">Instala WeRef en tu ${plat === 'ios' ? 'iPhone' : 'móvil'}</h3>
      <p class="inst-sub">Son 3 pasos y tarda menos de 10 segundos.</p>
      <ol class="inst-steps">
        ${steps.map((s, i) => `<li><span class="inst-n">${i + 1}</span><span class="inst-sic">${installIcon(s[0])}</span><div><strong>${s[1]}</strong><small>${s[2]}</small></div></li>`).join('')}
      </ol>
      ${notSafari ? `<div class="inst-note">Si no ves esa opción, abre <b>we-ref.com</b> en Safari y repite los pasos.</div>` : ''}
      <button type="button" class="btn btn-primary inst-ok" data-inst="close">Entendido</button>
    </div>`;
  el.addEventListener('click', (e) => { if(e.target === el || e.target.closest('[data-inst="close"]')) installSheetClose(); });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  document.addEventListener('keydown', installSheetKey, true);
}

async function installOnAction(action){
  if(action === 'install-dismiss'){
    try{ localStorage.setItem(INSTALL.KEY, String(Date.now())); }catch(e){}
    render();
  }
  else if(action === 'install-open'){
    if(INSTALL.deferred){
      const p = INSTALL.deferred;
      try{
        p.prompt();
        const r = await p.userChoice;
        INSTALL.deferred = null;
        if(r && r.outcome === 'accepted'){ try{ localStorage.setItem(INSTALL.KEY, 'installed'); }catch(e){} }
        render();
      }catch(e){ installSheetOpen(); }
    } else {
      installSheetOpen();
    }
  }
}
