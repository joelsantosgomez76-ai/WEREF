/* WEREF · componente de acceso. Lo usan las páginas /entrar/, /registro/, /recuperar-contrasena/, /verifica-tu-correo/
   y el modal de la portada. Necesita supabase-init.js y auth.js. */
(function(){
  'use strict';
  var HC_SITEKEY = '0f20c5a4-5778-4826-bea2-d9c65116a0e4';
  var CAPTCHA_FAIL = 'No se pudo completar la verificación de seguridad. Inténtalo de nuevo.';
  var VERIFY_KEY = 'weref_verify_email';
  var REQS = [
    { t: 'Al menos 8 caracteres', f: function(p){ return p.length >= 8; } },
    { t: 'Una minúscula', f: function(p){ return /[a-z]/.test(p); } },
    { t: 'Una mayúscula', f: function(p){ return /[A-Z]/.test(p); } },
    { t: 'Un número', f: function(p){ return /\d/.test(p); } },
    { t: 'Un carácter especial', f: function(p){ return /[^A-Za-z0-9]/.test(p); } }
  ];
  var ICONS = {
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 14l4-4 4 4 5-6"/></svg>'
  };
  var GOOGLE = '<svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.1 29.5 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.4 0 10.3-1.9 14.1-5.1l-6.5-5.5C29.5 36.4 26.9 37 24 37c-5.3 0-9.7-3.3-11.3-7.9l-6.5 5C9.6 40.6 16.2 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.7 5.5-7 6.4l6.5 5.5C38.5 37.4 40 33.5 40 29c0-.7-.1-1.4-.4-2.5z"/></svg>';
  var LOGO = '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="10" width="18" height="26" rx="4" fill="#0F1013" stroke="#fff" stroke-width="2" transform="rotate(-14 14 23)"/><rect x="25" y="12" width="18" height="26" rx="4" fill="#FF6A2B" transform="rotate(14 34 25)"/></svg>';

  function esc(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(root, sel){ return root.querySelector(sel); }
  function maxBirth(){ var d = new Date(); d.setFullYear(d.getFullYear() - 14); return d.toISOString().slice(0, 10); }

  /* ---- hCaptcha invisible, cargado solo cuando hace falta ---- */
  var hc = { ready: false, loading: false, widget: null, host: null };
  window.onWerefHcLoad = function(){ hc.ready = true; };
  function loadHc(){
    if(hc.loading) return; hc.loading = true;
    var s = document.createElement('script'); s.src = 'https://js.hcaptcha.com/1/api.js?onload=onWerefHcLoad&render=explicit'; s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  function captcha(host){
    loadHc();
    return new Promise(function(resolve){
      var n = 0;
      (function wait(){
        if(hc.ready && typeof hcaptcha !== 'undefined'){
          try{
            if(hc.widget === null || hc.host !== host){ host.innerHTML = ''; hc.widget = hcaptcha.render(host, { sitekey: HC_SITEKEY, size: 'invisible' }); hc.host = host; }
            hcaptcha.execute(hc.widget, { async: true }).then(function(r){ resolve(r && r.response ? r.response : null); }, function(){ resolve(null); });
          }catch(e){ resolve(null); }
          return;
        }
        if(++n > 100) return resolve(null);
        setTimeout(wait, 100);
      })();
    });
  }

  /* ---- piezas de interfaz ---- */
  function aside(){
    return '<aside class="au-aside" aria-hidden="true"><a class="au-brand" href="/" tabindex="-1">' + LOGO + 'WEREF</a>' +
      '<h2>Tu formación arbitral, en un solo lugar</h2><ul>' +
      '<li><span>' + ICONS.book + '</span><div><b>+2.000 preguntas</b><small>Las 17 Reglas de Juego IFAB</small></div></li>' +
      '<li><span>' + ICONS.trophy + '</span><div><b>WEREF League</b><small>Compite y sube en la clasificación</small></div></li>' +
      '<li><span>' + ICONS.chart + '</span><div><b>Estadísticas</b><small>Descubre tus puntos débiles</small></div></li></ul>' +
      '<p>100% gratis · Tu progreso siempre contigo</p></aside>';
  }
  function passwordField(id, label, autocomplete, withMeter){
    return '<div class="au-field" data-f="' + id + '"><label for="' + id + '">' + label + '</label><div class="au-pw"><input type="password" id="' + id + '" autocomplete="' + autocomplete + '" maxlength="128" required>' +
      '<button type="button" class="au-eye" data-eye="' + id + '" aria-label="Mostrar contraseña">Ver</button></div>' +
      (withMeter ? '<div class="au-meter" data-s="0" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><p class="au-meter-t" data-mt>Escribe una contraseña segura</p><ul class="au-reqs">' + REQS.map(function(r){ return '<li>' + r.t + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="au-msg bad" data-m="' + id + '" hidden></p></div>';
  }
  function field(id, label, type, extra){
    return '<div class="au-field" data-f="' + id + '"><label for="' + id + '">' + label + '</label><input type="' + type + '" id="' + id + '" ' + (extra || '') + '><p class="au-msg" data-m="' + id + '" hidden></p></div>';
  }

  function viewHtml(mode, o){
    var body = '';
    if(mode === 'login'){
      body = '<h1 class="au-title">Iniciar sesión</h1><p class="au-sub">Entra para seguir con tu formación arbitral</p>' +
        '<button type="button" class="au-google" data-google>' + GOOGLE + 'Continuar con Google</button><p class="au-or">o con tu correo</p>' +
        '<form data-form novalidate>' + field('au-email', 'Correo electrónico', 'email', 'autocomplete="email" maxlength="254" required') + passwordField('au-pass', 'Contraseña', 'current-password', false) +
        '<div class="au-row-sp"><label class="au-check" style="margin:0"><input type="checkbox" id="au-remember" checked><span>Mantener la sesión iniciada</span></label><button type="button" class="au-link" data-go="recover">¿Olvidaste tu contraseña?</button></div>' +
        '<div class="au-hc-box" data-hc></div><button type="submit" class="au-submit"><span class="au-spin" aria-hidden="true"></span><span data-st>Entrar</span></button><div data-status></div></form>' +
        '<p class="au-note">Protegido por hCaptcha · <a href="https://www.hcaptcha.com/privacy" target="_blank" rel="noopener">Privacidad</a> · <a href="https://www.hcaptcha.com/terms" target="_blank" rel="noopener">Términos</a></p>' +
        '<div class="au-switch">¿Todavía no tienes cuenta? <button type="button" class="au-link" data-go="register">Regístrate</button></div>';
    } else if(mode === 'register'){
      body = '<h1 class="au-title">Crear cuenta</h1><p class="au-sub">Cuatro datos y empiezas. Es gratis y sin tarjeta.</p>' +
        '<button type="button" class="au-google" data-google>' + GOOGLE + 'Continuar con Google</button><p class="au-or">o con tu correo</p>' +
        '<form data-form novalidate>' + field('au-email', 'Correo electrónico', 'email', 'autocomplete="email" maxlength="254" required') +
        passwordField('au-pass', 'Contraseña', 'new-password', true) +
        field('au-user', 'Nombre de usuario', 'text', 'autocomplete="username" maxlength="32" autocapitalize="none" spellcheck="false" required') +
        field('au-birth', 'Fecha de nacimiento', 'date', 'autocomplete="bday" max="' + maxBirth() + '" required') +
        '<label class="au-check"><input type="checkbox" id="au-terms"><span>He leído y acepto los <a href="/terminos-de-uso/" target="_blank" rel="noopener">Términos de Uso</a> y la <a href="/politica-privacidad/" target="_blank" rel="noopener">Política de Privacidad</a>. <span class="au-req" title="Obligatorio">*</span></span></label><p class="au-msg bad" data-m="au-terms" hidden></p>' +
        '<label class="au-check opt"><input type="checkbox" id="au-news"><span>Quiero recibir novedades de WEREF: cambios en las reglas, nuevas funciones y consejos para el examen.</span></label>' +
        '<div class="au-hc-box" data-hc></div><button type="submit" class="au-submit"><span class="au-spin" aria-hidden="true"></span><span data-st>Crear cuenta</span></button><div data-status></div></form>' +
        '<p class="au-note">Protegido por hCaptcha · <a href="https://www.hcaptcha.com/privacy" target="_blank" rel="noopener">Privacidad</a> · <a href="https://www.hcaptcha.com/terms" target="_blank" rel="noopener">Términos</a></p>' +
        '<div class="au-switch">¿Ya tienes cuenta? <button type="button" class="au-link" data-go="login">Inicia sesión</button></div>';
    } else if(mode === 'recover'){
      body = '<h1 class="au-title">Recuperar contraseña</h1><p class="au-sub">Te enviaremos un enlace a tu correo para crear una nueva contraseña.</p>' +
        '<form data-form novalidate>' + field('au-email', 'Correo electrónico', 'email', 'autocomplete="email" maxlength="254" required') +
        '<div class="au-hc-box" data-hc></div><button type="submit" class="au-submit"><span class="au-spin" aria-hidden="true"></span><span data-st>Enviar enlace</span></button><div data-status></div></form>' +
        '<div class="au-switch"><button type="button" class="au-link" data-go="login">Volver a iniciar sesión</button></div>';
    } else if(mode === 'newpass'){
      body = '<h1 class="au-title">Nueva contraseña</h1><p class="au-sub">Elige una contraseña segura para tu cuenta.</p>' +
        '<form data-form novalidate>' + passwordField('au-pass', 'Nueva contraseña', 'new-password', true) + passwordField('au-pass2', 'Repite la contraseña', 'new-password', false) +
        '<button type="submit" class="au-submit"><span class="au-spin" aria-hidden="true"></span><span data-st>Guardar contraseña</span></button><div data-status></div></form>';
    } else if(mode === 'complete'){
      body = '<h1 class="au-title">Un último paso</h1><p class="au-sub">Para terminar de crear tu cuenta necesitamos ' + (o.needUser && o.needBirth ? 'tu nombre de usuario y tu fecha de nacimiento' : (o.needUser ? 'tu nombre de usuario' : 'tu fecha de nacimiento')) + '.</p>' +
        '<form data-form novalidate>' +
        (o.needUser ? field('au-user', 'Nombre de usuario', 'text', 'autocomplete="username" maxlength="32" autocapitalize="none" spellcheck="false" required') : '') +
        (o.needBirth ? field('au-birth', 'Fecha de nacimiento', 'date', 'autocomplete="bday" max="' + maxBirth() + '" required') : '') +
        '<button type="submit" class="au-submit"><span class="au-spin" aria-hidden="true"></span><span data-st>Continuar</span></button><div data-status></div></form>' +
        '<div class="au-switch"><button type="button" class="au-link" data-logout>Cerrar sesión</button></div>';
    } else if(mode === 'welcome'){
      body = '<h1 class="au-title">¡Cuenta verificada!</h1><p class="au-sub">Tu correo está confirmado. Ya puedes empezar a entrenar.</p><a class="au-submit" href="' + esc(o.redirect || '/app.html') + '" style="text-decoration:none">Ir a mi cuenta</a>';
    } else if(mode === 'verify'){
      body = '<div class="au-verify"><h1 class="au-title">Revisa tu correo</h1><p class="au-sub">Te hemos enviado un enlace para activar tu cuenta a:</p><span class="au-mail">' + esc(o.email || 'tu correo') + '</span>' +
        '<ol class="au-steps"><li data-n="1">Abre el correo de WEREF (mira también en spam o promociones).</li><li data-n="2">Pulsa el botón «Confirmar mi correo».</li><li data-n="3">Responde unas preguntas rápidas y haz tu primer test.</li></ol>' +
        '<div class="au-hc-box" data-hc></div><button type="button" class="au-ghost" data-resend disabled>Reenviar correo</button><div data-status></div>' +
        '<div class="au-switch">¿Te has equivocado de correo? <button type="button" class="au-link" data-change>Cambiar el correo</button></div></div>';
    }
    return body;
  }

  /* ---- montaje ---- */
  function mount(root, opts){
    opts = opts || {};
    var st = { mode: opts.mode || 'login', redirect: safeRedirect(opts.redirect, '/app.html'), email: opts.email || '' };
    var userTimer = null, userSeq = 0, userOk = null, resendTimer = null;

    function render(mode, extra){
      st.mode = mode; var o = extra || {};
      clearInterval(resendTimer);
      root.innerHTML = '<div class="au"><div class="au-card" role="' + (opts.modal ? 'dialog' : 'region') + '" aria-label="Acceso a WEREF">' + aside() +
        '<div class="au-main">' + (opts.modal ? '<button type="button" class="au-close" data-close aria-label="Cerrar">&times;</button>' : (opts.backLink ? '<a class="au-back" href="/">Volver a la web</a>' : '')) +
        '<div class="au-body">' + viewHtml(mode, o) + '</div></div></div></div>';
      wire(mode, o);
    }

    function setMsg(id, text, kind){
      var m = root.querySelector('[data-m="' + id + '"]'), f = root.querySelector('[data-f="' + id + '"]');
      if(!m) return;
      if(!text){ m.hidden = true; m.innerHTML = ''; if(f){ f.classList.remove('is-bad', 'is-ok'); } return; }
      m.className = 'au-msg ' + (kind || 'bad'); m.innerHTML = text; m.hidden = false;
      if(f){ f.classList.toggle('is-bad', kind === 'bad' || !kind); f.classList.toggle('is-ok', kind === 'ok'); }
    }
    function status(html, kind){ var s = root.querySelector('[data-status]'); if(s) s.innerHTML = html ? '<div class="' + (kind === 'ok' ? 'au-ok' : 'au-err') + '" role="alert">' + html + '</div>' : ''; }
    function busy(on, label){ var b = root.querySelector('.au-submit'); if(!b) return; b.disabled = on; b.classList.toggle('is-loading', on); var s = b.querySelector('[data-st]'); if(on){ b.dataset.l = s.textContent; s.textContent = label || 'Un momento…'; } else if(b.dataset.l){ s.textContent = b.dataset.l; } }
    function val(id){ var e = root.querySelector('#' + id); return e ? e.value : ''; }
    function emailOk(v){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
    function userRule(v){ return /^[A-Za-z0-9_.-]{3,32}$/.test(v); }
    function hcHost(){ return root.querySelector('[data-hc]'); }

    function go(url){ window.location.href = url; }
    function afterSession(){
      accountMissing().then(function(miss){
        if(miss.username || miss.birthdate) render('complete', { needUser: miss.username, needBirth: miss.birthdate });
        else go(st.redirect);
      }, function(){ go(st.redirect); });
    }

    function wire(mode, o){
      var form = root.querySelector('[data-form]');
      [].forEach.call(root.querySelectorAll('[data-go]'), function(b){ b.addEventListener('click', function(){ var m = b.getAttribute('data-go'); if(opts.pages && !opts.modal){ var q = st.redirect !== '/app.html' ? '?redirect=' + encodeURIComponent(st.redirect) : ''; go(opts.pages[m] + q); } else render(m); }); });
      var cl = root.querySelector('[data-close]'); if(cl) cl.addEventListener('click', function(){ if(opts.onClose) opts.onClose(); });
      [].forEach.call(root.querySelectorAll('[data-eye]'), function(b){ b.addEventListener('click', function(){ var i = root.querySelector('#' + b.getAttribute('data-eye')); var show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? 'Ocultar' : 'Ver'; b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña'); }); });
      var g = root.querySelector('[data-google]');
      if(g) g.addEventListener('click', function(){ var rem = root.querySelector('#au-remember'); setWerefRememberSession(rem ? rem.checked : true); doGoogleLogin(st.redirect !== '/app.html' ? st.redirect : '').then(function(r){ if(r && r.error) status(esc(authErrorMessage(r.error))); }); });
      var lo = root.querySelector('[data-logout]'); if(lo) lo.addEventListener('click', function(){ supabaseClient.auth.signOut().then(function(){ go('/'); }); });
      if(st.email){ var em = root.querySelector('#au-email'); if(em && !em.value) em.value = st.email; }

      /* contraseña en vivo (indicador + requisitos) */
      var pw = root.querySelector('#au-pass');
      if(pw && root.querySelector('.au-reqs')){
        pw.addEventListener('input', function(){
          var v = pw.value, ok = 0, lis = root.querySelectorAll('.au-reqs li');
          REQS.forEach(function(r, i){ var y = r.f(v); if(y) ok++; lis[i].classList.toggle('ok', y); });
          var score = v ? Math.max(1, ok - (v.length < 8 ? 1 : 0)) : 0;
          root.querySelector('.au-meter').setAttribute('data-s', String(score));
          root.querySelector('[data-mt]').textContent = !v ? 'Escribe una contraseña segura' : (score <= 2 ? 'Contraseña débil' : (score < 5 ? 'Casi: te falta algo' : 'Contraseña segura'));
          if(ok === 5) setMsg('au-pass', '');
        });
      }
      /* disponibilidad del usuario en vivo (solo con la función del servidor) */
      var ue = root.querySelector('#au-user');
      if(ue){
        ue.addEventListener('input', function(){
          clearTimeout(userTimer); userOk = null; var v = ue.value.trim();
          if(!v){ setMsg('au-user', ''); return; }
          if(!userRule(v)){ setMsg('au-user', 'Entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.', 'bad'); return; }
          setMsg('au-user', 'Comprobando…', 'info');
          var seq = ++userSeq;
          userTimer = setTimeout(function(){ usernameAvailability(v).then(function(ok){ if(seq !== userSeq) return; userOk = ok; if(ok === true) setMsg('au-user', 'Disponible', 'ok'); else if(ok === false) setMsg('au-user', 'Ese nombre de usuario ya está en uso. Prueba con otro.', 'bad'); else setMsg('au-user', 'No hemos podido comprobarlo ahora; lo verificaremos al continuar.', 'info'); }); }, 400);
        });
      }
      var be = root.querySelector('#au-birth');
      if(be) be.addEventListener('change', function(){ var p = birthdateProblem(be.value); setMsg('au-birth', p, p ? 'bad' : ''); });
      var em2 = root.querySelector('#au-email');
      if(em2 && mode === 'register') em2.addEventListener('blur', function(){ if(em2.value && !emailOk(em2.value.trim())) setMsg('au-email', 'Escribe un correo válido.', 'bad'); else setMsg('au-email', ''); });

      if(form){ form.addEventListener('submit', function(e){ e.preventDefault(); submit(mode, o); }); }
      if(mode === 'verify') wireVerify();
    }

    function submit(mode, o){
      status('');
      var email = val('au-email').trim(), pass = val('au-pass');
      if(mode === 'login'){
        var bad = false;
        if(!emailOk(email)){ setMsg('au-email', 'Escribe un correo válido.', 'bad'); bad = true; } else setMsg('au-email', '');
        if(!pass){ setMsg('au-pass', 'Escribe tu contraseña.', 'bad'); bad = true; } else setMsg('au-pass', '');
        if(bad) return;
        var rem = root.querySelector('#au-remember'); setWerefRememberSession(rem ? rem.checked : true);
        busy(true, 'Entrando…');
        captcha(hcHost()).then(function(tok){
          if(!tok){ busy(false); status(esc(CAPTCHA_FAIL)); return; }
          return doLogin(email, pass, tok).then(function(r){
            if(r.error){ busy(false); var m = r.error.message || ''; if(/not confirmed/i.test(m)){ try{ sessionStorage.setItem(VERIFY_KEY, email); }catch(x){} status('Tu correo todavía no está confirmado. <button type="button" class="au-link" data-v>Reenviar el correo de confirmación</button>'); var vb = root.querySelector('[data-v]'); if(vb) vb.addEventListener('click', function(){ go('/verifica-tu-correo/'); }); } else status(esc(authErrorMessage(r.error))); return; }
            afterSession();
          });
        }).catch(function(){ busy(false); status('Ha ocurrido un error. Inténtalo de nuevo.'); });
      } else if(mode === 'register'){
        var errs = 0;
        function chk(cond, id, text){ if(!cond){ setMsg(id, text, 'bad'); errs++; } }
        chk(emailOk(email), 'au-email', 'Escribe un correo válido.'); if(emailOk(email)) setMsg('au-email', '');
        var okPass = REQS.every(function(r){ return r.f(pass); }); chk(okPass, 'au-pass', 'La contraseña todavía no cumple todos los requisitos.'); if(okPass) setMsg('au-pass', '');
        var uname = val('au-user').trim(); chk(userRule(uname) && userOk !== false, 'au-user', userOk === false ? 'Ese nombre de usuario ya está en uso. Prueba con otro.' : 'Elige un nombre de usuario de 3 a 32 caracteres.');
        var bp = birthdateProblem(val('au-birth')); chk(!bp, 'au-birth', bp);
        var terms = root.querySelector('#au-terms'); chk(terms.checked, 'au-terms', 'Para crear la cuenta tienes que aceptar los Términos de Uso y la Política de Privacidad.'); if(terms.checked) setMsg('au-terms', '');
        if(errs){ var f1 = root.querySelector('.is-bad input, [data-m="au-terms"]:not([hidden])'); if(f1 && f1.focus) f1.focus(); return; }
        busy(true, 'Creando tu cuenta…');
        usernameAvailability(uname).then(function(av){
          if(av === false){ busy(false); setMsg('au-user', 'Ese nombre de usuario ya está en uso. Prueba con otro.', 'bad'); return; }
          return captcha(hcHost()).then(function(tok){
            if(!tok){ busy(false); status(esc(CAPTCHA_FAIL)); return; }
            var meta = { username: uname, birthdate: val('au-birth'), terms_version: WEREF_TERMS_VERSION, terms_accepted_at: new Date().toISOString(), marketing_opt_in: root.querySelector('#au-news').checked };
            return doRegister(email, pass, meta, tok).then(function(r){
              if(r.error){ busy(false); var m = r.error.message || '';
                if(/already|registered|exists/i.test(m)) setMsg('au-email', 'Ya existe una cuenta con este correo. <button type="button" class="au-link" data-login>¿Quieres iniciar sesión?</button>', 'bad');
                else if(/Database error/i.test(m)) status('No se ha podido crear la cuenta. Comprueba que tienes 14 años o más y que los datos son correctos.');
                else status(esc(authErrorMessage(r.error)));
                var lb = root.querySelector('[data-login]'); if(lb) lb.addEventListener('click', function(){ st.email = email; if(opts.pages && !opts.modal) go(opts.pages.login + '?email=' + encodeURIComponent(email)); else render('login'); });
                return; }
              var u = r.data && r.data.user;
              if(u && u.identities && u.identities.length === 0){ busy(false); setMsg('au-email', 'Ya existe una cuenta con este correo. <button type="button" class="au-link" data-login>¿Quieres iniciar sesión?</button>', 'bad'); var lb2 = root.querySelector('[data-login]'); if(lb2) lb2.addEventListener('click', function(){ if(opts.pages && !opts.modal) go(opts.pages.login + '?email=' + encodeURIComponent(email)); else render('login'); }); return; }
              if(r.data && r.data.session && u){ claimUsername(u.id, uname).then(function(){ go('/bienvenida/'); }); return; }
              try{ sessionStorage.setItem(VERIFY_KEY, email); sessionStorage.setItem('weref_signup_evt', '1'); }catch(x){}
              go('/verifica-tu-correo/');
            });
          });
        }).catch(function(){ busy(false); status('Ha ocurrido un error. Inténtalo de nuevo.'); });
      } else if(mode === 'recover'){
        if(!emailOk(email)){ setMsg('au-email', 'Escribe un correo válido.', 'bad'); return; } setMsg('au-email', '');
        busy(true, 'Enviando…');
        captcha(hcHost()).then(function(tok){
          if(!tok){ busy(false); status(esc(CAPTCHA_FAIL)); return; }
          return doPasswordReset(email, tok).then(function(r){ busy(false); if(r.error){ status(esc(authErrorMessage(r.error))); return; } status('Si ese correo tiene una cuenta, te hemos enviado un enlace para restablecer la contraseña. Revisa también el spam.', 'ok'); });
        }).catch(function(){ busy(false); status('Ha ocurrido un error. Inténtalo de nuevo.'); });
      } else if(mode === 'newpass'){
        var p1 = val('au-pass'), p2 = val('au-pass2'), er = 0;
        if(!REQS.every(function(r){ return r.f(p1); })){ setMsg('au-pass', 'La contraseña todavía no cumple todos los requisitos.', 'bad'); er++; }
        if(p1 !== p2){ setMsg('au-pass2', 'Las contraseñas no coinciden.', 'bad'); er++; } else setMsg('au-pass2', '');
        if(er) return;
        busy(true, 'Guardando…');
        supabaseClient.auth.updateUser({ password: p1 }).then(function(r){ if(r.error){ busy(false); status(esc(authErrorMessage(r.error))); return; } status('Contraseña actualizada. Te llevamos a tu cuenta…', 'ok'); setTimeout(function(){ go('/app.html'); }, 1200); });
      } else if(mode === 'complete'){
        var e2 = 0, un = o.needUser ? val('au-user').trim() : '', bd = o.needBirth ? val('au-birth') : '';
        if(o.needUser){ if(!userRule(un) || userOk === false){ setMsg('au-user', userOk === false ? 'Ese nombre de usuario ya está en uso. Prueba con otro.' : 'Elige un nombre de usuario de 3 a 32 caracteres.', 'bad'); e2++; } }
        if(o.needBirth){ var bp2 = birthdateProblem(bd); if(bp2){ setMsg('au-birth', bp2, 'bad'); e2++; } }
        if(e2) return;
        busy(true, 'Guardando…');
        supabaseClient.auth.getUser().then(function(ur){
          var uid = ur.data && ur.data.user && ur.data.user.id; if(!uid){ busy(false); status('Tu sesión ha caducado. Vuelve a iniciar sesión.'); return; }
          var jobs = [];
          if(o.needBirth) jobs.push(supabaseClient.from('profiles_onboarding').upsert({ user_id: uid, birth_date: bd }, { onConflict: 'user_id' }));
          if(o.needUser) jobs.push(claimUsername(uid, un));
          return Promise.all(jobs).then(function(res){
            var bad = res.filter(function(x){ return x && x.error; })[0];
            if(bad){ busy(false); var m = bad.error.message || ''; status(/14 años/.test(m) ? 'WEREF es para personas de 14 años o más.' : (/duplicate|unique/i.test(m) ? 'Ese nombre de usuario ya está en uso. Prueba con otro.' : 'No se ha podido guardar. Inténtalo de nuevo.')); return; }
            go(st.redirect);
          });
        });
      }
    }

    function wireVerify(){
      var mail = st.email, btn = root.querySelector('[data-resend]'), left = 0;
      function tick(){ if(left > 0){ btn.disabled = true; btn.textContent = 'Reenviar correo (' + left + ' s)'; left--; } else { clearInterval(resendTimer); btn.disabled = !mail; btn.textContent = 'Reenviar correo'; } }
      function arm(){ left = 60; clearInterval(resendTimer); tick(); resendTimer = setInterval(tick, 1000); }
      arm();
      btn.addEventListener('click', function(){
        btn.disabled = true; status('');
        captcha(hcHost()).then(function(tok){
          if(!tok){ status(esc(CAPTCHA_FAIL)); arm(); return; }
          return supabaseClient.auth.resend({ type: 'signup', email: mail, options: { emailRedirectTo: window.location.origin + '/bienvenida/', captchaToken: tok } }).then(function(r){
            if(r.error){ status(esc(authErrorMessage(r.error))); } else status('Correo reenviado a <b>' + esc(mail) + '</b>.', 'ok');
            arm();
          });
        });
      });
      root.querySelector('[data-change]').addEventListener('click', function(){ go('/registro/' + (mail ? '?email=' + encodeURIComponent(mail) : '')); });
    }

    /* modo inicial */
    if(st.mode === 'verify'){ render('verify', { email: st.email }); }
    else render(st.mode, opts.extra);
    return { render: render };
  }

  function openModal(mode){
    var back = document.createElement('div'); back.className = 'au-backdrop'; back.setAttribute('role', 'presentation');
    var host = document.createElement('div'); back.appendChild(host); document.body.appendChild(back);
    document.documentElement.style.overflow = 'hidden';
    function close(){ document.removeEventListener('keydown', onKey); back.remove(); document.documentElement.style.overflow = ''; }
    function onKey(e){ if(e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    mount(host, { mode: mode, modal: true, redirect: location.pathname.indexOf('/app') === 0 ? '/app.html' : '/app.html', onClose: close, pages: null });
    var first = host.querySelector('input'); if(first) setTimeout(function(){ first.focus(); }, 50);
  }

  window.AuthUI = { mount: mount, openModal: openModal };
})();
