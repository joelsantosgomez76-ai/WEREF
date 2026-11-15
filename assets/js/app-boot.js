let CURRENT_USER_EMAIL = null;
let CURRENT_USER_ID = null;
let CURRENT_USERNAME = null;

function startApp(){
  // Si la carga de tus datos tarda más de 12 s, la pantalla de carga enseña en qué paso se ha quedado.
  setTimeout(function(){ if(!STATE.dataReady){ STATE.slowLoad = window.__stage || 'tus datos'; render(); } }, 12000);
  // Si la carga fallara, se marca igualmente como terminada para no dejar skeletons para siempre.
  Promise.resolve(loadStorage()).catch(function(e){ console.error('loadStorage', e); }).then(function(){ if(!STATE.dataReady){ STATE.dataReady = true; if(typeof navInit === 'function') navInit(); render(); } });
  if(typeof loadCommitteeStatus==="function") loadCommitteeStatus();
  if(typeof loadProfileNudge==="function") loadProfileNudge();
  if(typeof attCheckinFromLink==="function") attCheckinFromLink();
  if(typeof liveJoinFromLink==="function") liveJoinFromLink();
  if(isDevUser()){ loadQuestionReports(); loadSuggestions(); }
}

function showUsernamePrompt(){
  document.getElementById('app').innerHTML = `
    <div style="max-width:360px; margin:60px auto; padding:0 16px;">
      <h2 style="text-align:center; margin-bottom:6px;">Elige tu nombre de usuario</h2>
      <div style="text-align:center; color:var(--muted); font-size:13.5px; margin-bottom:20px;">Es el último paso para entrar. Este nombre no se podrá cambiar después.</div>
      <div class="qcard">
        <label for="setup-username">Nombre de usuario</label>
        <input type="text" id="setup-username" maxlength="32" autocomplete="username">
        <button type="button" class="btn btn-primary" style="width:100%; margin-top:14px;" id="setup-username-btn">Continuar</button>
        <div class="auth-error" id="setup-username-error" style="display:none;"></div>
      </div>
    </div>
  `;
  document.getElementById('setup-username-btn').addEventListener('click', async ()=>{
    const input = document.getElementById('setup-username');
    const errorEl = document.getElementById('setup-username-error');
    const btn = document.getElementById('setup-username-btn');
    const value = input.value.trim();
    errorEl.style.display = 'none';
    if(!value){
      errorEl.textContent = 'Escribe un nombre de usuario.';
      errorEl.style.display = 'block';
      return;
    }
    btn.disabled = true;
    if(await isUsernameTaken(value)){
      errorEl.textContent = 'Ese nombre de usuario ya está en uso. Elige otro.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      return;
    }
    const { error } = await claimUsername(CURRENT_USER_ID, value);
    if(error){
      errorEl.textContent = 'No se pudo guardar. Inténtalo de nuevo.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      return;
    }
    CURRENT_USERNAME = value;
    startApp();
  });
}

/* Pantalla del código de verificación (2FA). Devuelve una promesa que se resuelve cuando el código es correcto. */
async function mfaGate(){
  let need = false;
  try{
    const { data } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
    need = !!(data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
  }catch(e){ return; }
  if(!need) return;
  const listed = await supabaseClient.auth.mfa.listFactors();
  const factor = listed && listed.data && listed.data.totp && listed.data.totp[0];
  if(!factor) return;
  await new Promise(function(resolve){
    document.getElementById('app').innerHTML = `
      <div style="max-width:380px; margin:70px auto; padding:0 16px;">
        <h2 style="text-align:center; margin-bottom:6px;">Verificación en dos pasos</h2>
        <div style="text-align:center; color:var(--muted); font-size:13.5px; margin-bottom:20px;">Escribe el código de 6 números que muestra tu app de verificación.</div>
        <form class="qcard" id="mfa-form" autocomplete="off">
          <label for="mfa-gate-code">Código</label>
          <input type="text" id="mfa-gate-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" autofocus>
          <button type="submit" class="btn btn-primary" style="width:100%; margin-top:14px;" id="mfa-gate-btn">Verificar</button>
          <div class="auth-error" id="mfa-gate-error" style="display:none;"></div>
          <button type="button" class="btn btn-ghost" style="width:100%; margin-top:10px;" id="mfa-gate-out">Cerrar sesión</button>
        </form>
      </div>`;
    const form = document.getElementById('mfa-form'), err = document.getElementById('mfa-gate-error'), btn = document.getElementById('mfa-gate-btn');
    document.getElementById('mfa-gate-out').addEventListener('click', async function(){ try{ await supabaseClient.auth.signOut({ scope: 'local' }); }catch(e){} window.location.href = 'index.html'; });
    form.addEventListener('submit', async function(ev){
      ev.preventDefault();
      const code = document.getElementById('mfa-gate-code').value.replace(/\s/g, '');
      err.style.display = 'none';
      if(!/^\d{6}$/.test(code)){ err.textContent = 'Escribe los 6 números de tu app.'; err.style.display = 'block'; return; }
      btn.disabled = true;
      try{
        const ch = await supabaseClient.auth.mfa.challenge({ factorId: factor.id });
        if(ch.error) throw ch.error;
        const v = await supabaseClient.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code: code });
        if(v.error) throw v.error;
        resolve();
      }catch(e){
        err.textContent = 'Código incorrecto o caducado. Prueba con el siguiente.'; err.style.display = 'block'; btn.disabled = false;
      }
    });
  });
}

(async function init(){
  const session = await getCurrentSession();
  if(!session){
    // Si venía de escanear el QR de asistencia, se guarda el código para registrarlo tras iniciar sesión.
    try{ const q = new URLSearchParams(location.search).get('asistencia'); if(q) sessionStorage.setItem('weref_checkin', q.slice(0, 64)); const s = new URLSearchParams(location.search).get('sala'); if(s) sessionStorage.setItem('weref_live', s.slice(0, 12)); }catch(e){}
    window.location.href = 'index.html';
    return;
  }
  CURRENT_USER_EMAIL = session.user.email;
  CURRENT_USER_ID = session.user.id;

  // Verificación en dos pasos: si la cuenta la tiene activada, antes de entrar hay que escribir el código de la app.
  await mfaGate();

  // Con Google (o si el usuario no se guardó al registrarse) puede faltar el usuario o la fecha de nacimiento:
  // se piden en un paso intermedio antes de entrar.
  try{
    const miss = await accountMissing();
    if(miss.username || miss.birthdate){ window.location.href = '/registro/?completar=1&redirect=' + encodeURIComponent('/app.html'); return; }
  }catch(e){}
  const { data: unameRow } = await supabaseClient.from('usernames').select('username').eq('user_id', CURRENT_USER_ID).maybeSingle();
  if(!unameRow){
    showUsernamePrompt();
    return;
  }
  CURRENT_USERNAME = unameRow.username;
  // Los miembros del comité necesitan nombre y apellidos bien separados (se ordenan por apellidos).
  try{
    const cs = await supabaseClient.rpc('committee_status');
    if(cs && !cs.error && cs.data && cs.data.is_member){
      const ur = await supabaseClient.auth.getUser();
      const meta = (ur && ur.data && ur.data.user && ur.data.user.user_metadata) || {};
      const first = Object.prototype.hasOwnProperty.call(meta, 'first_name') ? meta.first_name : meta.full_name;
      if(nameProblem(first, meta.last_name)){ showNamePrompt(first, meta.last_name); return; }
    }
  }catch(e){}
  startApp();
})();

/* Pantalla que se pide una sola vez a los miembros cuyo nombre o apellidos no están bien separados. */
function showNamePrompt(first, last){
  let f = String(first || '').trim(), l = String(last || '').trim();
  if(f && !l && /\s/.test(f)){            // todo el nombre en un campo: se propone una separación para que la revise
    const parts = f.split(/\s+/); f = parts.shift(); l = parts.join(' ');
  }
  const esc2 = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  document.getElementById('app').innerHTML = `
    <div style="max-width:380px; margin:50px auto; padding:0 16px;">
      <h2 style="text-align:center; margin-bottom:6px;">Completa tu nombre</h2>
      <div style="text-align:center; color:var(--muted); font-size:13.5px; margin-bottom:20px;">Para el comité necesitamos tu nombre y tus apellidos, cada uno en su casilla. Revisa que estén bien.</div>
      <div class="qcard">
        <label for="np-first">Nombre</label>
        <input type="text" id="np-first" maxlength="100" autocomplete="given-name" value="${esc2(f)}">
        <label for="np-last">Apellidos</label>
        <input type="text" id="np-last" maxlength="100" autocomplete="family-name" value="${esc2(l)}">
        <button type="button" class="btn btn-primary" style="width:100%; margin-top:14px;" id="np-btn">Guardar y continuar</button>
        <div class="auth-error" id="np-error" style="display:none;"></div>
      </div>
    </div>`;
  const go = async () => {
    const fi = document.getElementById('np-first').value.trim(), la = document.getElementById('np-last').value.trim();
    const errEl = document.getElementById('np-error'), btn = document.getElementById('np-btn');
    errEl.style.display = 'none';
    const msg = nameProblem(fi, la);
    if(msg){ errEl.textContent = msg; errEl.style.display = 'block'; return; }
    btn.disabled = true;
    const { error } = await supabaseClient.auth.updateUser({ data: { first_name: fi, full_name: fi, last_name: la } });
    if(error){ errEl.textContent = 'No se pudo guardar. Inténtalo de nuevo.'; errEl.style.display = 'block'; btn.disabled = false; return; }
    startApp();
  };
  document.getElementById('np-btn').addEventListener('click', go);
  document.getElementById('np-last').addEventListener('keydown', (e) => { if(e.key === 'Enter') go(); });
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  if(event === 'SIGNED_OUT'){
    window.location.href = 'index.html';
  }
});
