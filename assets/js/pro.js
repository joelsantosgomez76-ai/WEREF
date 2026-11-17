/* ---------------- WEREF PRO · PUERTA FALSA ----------------
   Sondeo de interés: no se cobra nada. Detrás de un interruptor (tabla app_flags) que enciende el maestro desde Analítica.
   Registra pro_interest (al abrir el aviso) y pro_email (al dejar el correo con consentimiento explícito).
   Depende de app.js (STATE, esc, render, shellIcon, supabaseClient) y analytics.js (anLog). */

const PRO_VERSION = 'v1';
const PRO_DEFAULT = {
  title: 'WEREF Pro',
  intro: 'Estamos valorando una versión de pago con más herramientas para preparar tu examen. Todavía no está disponible y no se cobra nada.',
  bullets: ['Tests sin límite diario', 'Seguimiento detallado de tu progreso por regla', 'Simulacros de examen con corrección comentada', 'Más espacio en Mi Academia para tus documentos'],
  note: 'No hay precio cerrado. Cuando esté listo te avisaremos y decidirás entonces.',
  button: 'Avísame cuando esté disponible'
};

async function loadFlags(){
  try{
    const { data, error } = await supabaseClient.rpc('get_app_flags');
    if(error) throw error;
    STATE.flags = (typeof data === 'string') ? JSON.parse(data) : (data || {});
  }catch(e){ if(!STATE.flags) STATE.flags = {}; }
  if(['home', 'achievements', 'adminAnalytics'].includes(String(STATE.view))) render();
}
function proOn(){ return !!(STATE.flags && STATE.flags.pro_door && STATE.flags.pro_door.enabled); }
function proText(){ const p = (STATE.flags && STATE.flags.pro_door && STATE.flags.pro_door.payload) || {}; return Object.assign({}, PRO_DEFAULT, p); }

/* Botón discreto (solo si el interruptor está encendido) */
function proButton(where){
  if(!proOn()) return '';
  return `<div class="pro-wrap"><button type="button" class="pro-btn" data-action="pro-open" data-where="${esc(where)}">${shellIcon('star')}<span>WEREF Pro</span></button></div>`;
}

function proClose(){ const m = document.getElementById('pro-modal'); if(m) m.remove(); document.removeEventListener('keydown', proKey); }
function proKey(e){ if(e.key === 'Escape') proClose(); }
function proOpen(where){
  proClose();
  if(typeof anLog === 'function') anLog('pro_interest', { where: where === 'logros' ? 'logros' : 'home' });
  const t = proText();
  const email = (typeof CURRENT_USER_EMAIL !== 'undefined' && CURRENT_USER_EMAIL) ? CURRENT_USER_EMAIL : '';
  const m = document.createElement('div');
  m.id = 'pro-modal'; m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal-card pro-card" role="dialog" aria-modal="true" aria-labelledby="pro-t">
    <div id="pro-form">
      <p class="pro-eyebrow">Próximamente</p>
      <h3 id="pro-t">${esc(t.title)}</h3>
      <p class="pro-intro">${esc(t.intro)}</p>
      <ul class="pro-list">${(t.bullets || []).map(b => `<li>${shellIcon('check')}<span>${esc(b)}</span></li>`).join('')}</ul>
      <p class="pro-note">${esc(t.note)}</p>
      <label class="pro-l" for="pro-email">Tu correo</label>
      <input id="pro-email" type="email" inputmode="email" autocomplete="email" maxlength="254" value="${esc(email)}" placeholder="tucorreo@ejemplo.com">
      <label class="pro-consent"><input id="pro-consent" type="checkbox"><span>Acepto que WEREF guarde este correo solo para avisarme cuando WEREF Pro esté disponible. Puedo retirar mi consentimiento cuando quiera. Más información en la <a href="/politica-privacidad/" target="_blank" rel="noopener">política de privacidad</a>.</span></label>
      <p class="pro-err" id="pro-err" role="alert" hidden></p>
      <div class="pro-actions"><button type="button" class="btn btn-primary" id="pro-send" disabled>${esc(t.button)}</button><button type="button" class="btn btn-secondary" data-close>Ahora no</button></div>
    </div></div>`;
  m.addEventListener('click', (e) => {
    if(e.target === m || e.target.closest('[data-close]')){ proClose(); return; }
    if(e.target.closest('#pro-send')) proSend();
  });
  m.addEventListener('change', (e) => { if(e.target.id === 'pro-consent'){ const b = document.getElementById('pro-send'); if(b) b.disabled = !e.target.checked; } });
  document.addEventListener('keydown', proKey);
  document.body.appendChild(m);
  const f = document.getElementById('pro-email'); if(f) f.focus();
}
async function proSend(){
  const em = document.getElementById('pro-email'), ck = document.getElementById('pro-consent'), er = document.getElementById('pro-err'), b = document.getElementById('pro-send');
  const email = ((em && em.value) || '').trim();
  const fail = (msg) => { if(er){ er.textContent = msg; er.hidden = false; } if(b) b.disabled = !(ck && ck.checked); };
  if(!ck || !ck.checked) return fail('Para guardar tu correo necesitamos tu consentimiento.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Revisa el correo: no parece válido.');
  if(b) b.disabled = true; if(er) er.hidden = true;
  try{
    const { error } = await supabaseClient.rpc('pro_waitlist_join', { p_email: email, p_consent: true, p_version: PRO_VERSION });
    if(error) throw error;
    const box = document.getElementById('pro-form');
    if(box) box.innerHTML = `<div class="pro-ok">${shellIcon('check')}<h3>¡Apuntado!</h3><p>Te avisaremos cuando WEREF Pro esté disponible. Gracias por ayudarnos a decidir.</p><button type="button" class="btn btn-primary" data-close>Cerrar</button></div>`;
  }catch(e){ fail('No se pudo guardar. Inténtalo de nuevo en un momento.'); }
}

/* ---------- Interruptor y textos en el panel de Analítica (solo maestro) ---------- */
function proAdminCard(){
  const on = proOn(), t = proText(), s = STATE.an || {};
  return `<div class="an-pro-sw">
    <div class="an-pro-sw-h"><div><h3>Puerta falsa de «WEREF Pro»</h3><small>${on ? 'Encendida: los usuarios ven el botón en Inicio y en Rango e insignias.' : 'Apagada: nadie ve nada.'} No cobra nada.</small></div>
      <button type="button" class="an-switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-action="an-pro-toggle" aria-label="Activar la puerta falsa de WEREF Pro"><i></i></button></div>
    <details class="an-pro-ed" ${s.proEdit ? 'open' : ''}><summary>Editar los textos</summary>
      <label>Título<input id="an-pro-title" type="text" maxlength="400" value="${esc(t.title)}"></label>
      <label>Introducción<textarea id="an-pro-intro" rows="3" maxlength="400">${esc(t.intro)}</textarea></label>
      <label>Qué incluiría (una línea por punto, máximo 8)<textarea id="an-pro-bullets" rows="5">${esc((t.bullets || []).join('\n'))}</textarea></label>
      <label>Nota<input id="an-pro-note" type="text" maxlength="400" value="${esc(t.note)}"></label>
      <label>Texto del botón<input id="an-pro-button" type="text" maxlength="400" value="${esc(t.button)}"></label>
      <button type="button" class="btn btn-primary" data-action="an-pro-save">Guardar textos</button></details></div>`;
}
async function proAdminSave(payload, enabled, okMsg){
  try{
    const { error } = await supabaseClient.rpc('set_app_flag', { p_key: 'pro_door', p_enabled: enabled, p_payload: payload });
    if(error) throw error;
    await loadFlags();
    STATE.toast = okMsg;
  }catch(e){ STATE.toast = 'No se pudo guardar. ¿Has ejecutado el SQL de la puerta falsa y entrado con 2FA?'; }
  render();
}
function proAction(action, el){
  if(action === 'pro-open') proOpen(el.dataset.where);
  else if(action === 'an-pro-toggle'){ proAdminSave(null, !proOn(), !proOn() ? 'Puerta falsa de Pro: encendida.' : 'Puerta falsa de Pro: apagada.'); }
  else if(action === 'an-pro-save'){
    const g = (id) => (document.getElementById(id) || {}).value || '';
    const bullets = g('an-pro-bullets').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 8);
    proAdminSave({ title: g('an-pro-title').trim() || PRO_DEFAULT.title, intro: g('an-pro-intro').trim(), bullets, note: g('an-pro-note').trim(), button: g('an-pro-button').trim() || PRO_DEFAULT.button }, null, 'Textos guardados.');
  }
}
