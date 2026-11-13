/* WEREF · página de contacto: validación en línea, motivo, hCaptcha invisible y envío a Supabase. */
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };
  var HCAPTCHA_SITEKEY = '0f20c5a4-5778-4826-bea2-d9c65116a0e4';
  var MOTIVOS = { error: 'Error en una pregunta', sugerencia: 'Sugerencia', cuenta: 'Problema con mi cuenta', privacidad: 'Privacidad y datos', colaboraciones: 'Colaboraciones' };
  var f = {
    form: $('ct-form'), name: $('ct-name'), email: $('ct-email'), motivo: $('ct-motivo'), ref: $('ct-ref'), refRow: $('ct-ref-row'),
    message: $('ct-message'), website: $('ct-website'), privacy: $('ct-privacy'), submit: $('ct-submit'), status: $('ct-status'), card: $('ct-card')
  };
  if(!f.form) return;

  /* motivo: tarjetas de la izquierda, select y campo "regla o pregunta" */
  function syncRef(){ f.refRow.hidden = f.motivo.value !== 'error'; }
  f.motivo.addEventListener('change', syncRef);
  [].forEach.call(document.querySelectorAll('.ct-reason'), function(b){
    b.addEventListener('click', function(){
      f.motivo.value = b.getAttribute('data-motivo'); syncRef(); clearErr(f.motivo);
      [].forEach.call(document.querySelectorAll('.ct-reason'), function(x){ x.classList.toggle('is-on', x === b); });
      f.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function(){ (f.name.value ? f.message : f.name).focus({ preventScroll: true }); }, 350);
    });
  });
  /* desde la app: ?motivo=error&pregunta=ID */
  try{
    var q = new URLSearchParams(location.search), m = q.get('motivo'), p = q.get('pregunta');
    if(m && MOTIVOS[m]){ f.motivo.value = m; syncRef(); }
    if(p){ f.motivo.value = 'error'; syncRef(); f.ref.value = ('Pregunta ' + p.replace(/[^A-Za-z0-9 _.\-]/g, '')).slice(0, 200); }
  }catch(e){}

  /* validación en línea */
  var msgs = { 'ct-name': 'Escribe tu nombre.', 'ct-email': 'Escribe un correo válido.', 'ct-motivo': 'Elige un motivo.', 'ct-message': 'Cuéntanos tu mensaje.', 'ct-privacy': 'Debes confirmar que has leído la Política de Privacidad.' };
  function errEl(el){ return f.form.querySelector('.ct-err[data-for="' + el.id + '"]'); }
  function setErr(el, text){ var e = errEl(el); if(e){ e.textContent = text; e.hidden = false; } el.setAttribute('aria-invalid', 'true'); }
  function clearErr(el){ var e = errEl(el); if(e){ e.hidden = true; } el.removeAttribute('aria-invalid'); }
  function valid(el){
    if(el === f.email) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim());
    if(el === f.privacy) return el.checked;
    return el.value.trim() !== '';
  }
  function check(el){ if(valid(el)){ clearErr(el); return true; } setErr(el, msgs[el.id]); return false; }
  [f.name, f.email, f.motivo, f.message].forEach(function(el){
    el.addEventListener('blur', function(){ if(el.value.trim() !== '' || el.getAttribute('aria-invalid')) check(el); });
    el.addEventListener('input', function(){ if(el.getAttribute('aria-invalid') && valid(el)) clearErr(el); });
  });
  f.privacy.addEventListener('change', function(){ if(f.privacy.checked) clearErr(f.privacy); });

  /* hCaptcha: se descarga solo cuando hace falta, en modo invisible */
  var hcReady = false, hcLoading = false, hcWidget = null;
  window.onHcaptchaApiLoad = function(){ hcReady = true; };
  function loadHc(){
    if(hcLoading) return; hcLoading = true;
    var s = document.createElement('script');
    s.src = 'https://js.hcaptcha.com/1/api.js?onload=onHcaptchaApiLoad&render=explicit'; s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function(ev){ window.addEventListener(ev, loadHc, { once: true, passive: true }); });
  function captcha(){
    loadHc();
    return new Promise(function(resolve){
      var tries = 0;
      (function wait(){
        if(hcReady && typeof hcaptcha !== 'undefined'){
          try{
            if(hcWidget === null){ hcWidget = hcaptcha.render('ct-hcaptcha', { sitekey: HCAPTCHA_SITEKEY, size: 'invisible' }); }
            hcaptcha.execute(hcWidget, { async: true }).then(function(r){ resolve(r && r.response ? r.response : null); }, function(){ resolve(null); });
          }catch(e){ resolve(null); }
          return;
        }
        if(++tries > 100) return resolve(null);
        setTimeout(wait, 100);
      })();
    });
  }

  function showStatus(text, withMail){
    f.status.innerHTML = '';
    f.status.appendChild(document.createTextNode(text + ' '));
    if(withMail){ var a = document.createElement('a'); a.href = 'mailto:info@we-ref.com'; a.textContent = 'info@we-ref.com'; f.status.appendChild(a); f.status.appendChild(document.createTextNode('.')); }
    f.status.hidden = false;
  }
  function loading(on){ f.submit.disabled = on; f.submit.classList.toggle('is-loading', on); f.submit.querySelector('.ct-submit-t').textContent = on ? 'Enviando…' : 'Enviar mensaje'; }

  f.form.addEventListener('submit', function(e){
    e.preventDefault();
    f.status.hidden = true;
    if(f.website.value.trim() !== '') return;               // trampa para bots
    var ok = [f.name, f.email, f.motivo, f.message, f.privacy].map(check).every(Boolean);
    if(!ok){ var first = f.form.querySelector('[aria-invalid]'); if(first) first.focus(); return; }
    loading(true);
    captcha().then(function(token){
      if(!token){ loading(false); showStatus('No se pudo completar la verificación de seguridad. Inténtalo de nuevo o escríbenos a', true); return; }
      var row = { name: f.name.value.trim(), email: f.email.value.trim(), message: f.message.value.trim(), motivo: f.motivo.value, referencia: (f.motivo.value === 'error' ? f.ref.value.trim() : '') || null };
      return supabaseClient.from('contact_messages').insert(row).then(function(res){
        var err = res && res.error;
        if(err && (err.code === 'PGRST204' || /motivo|referencia|column/i.test(err.message || ''))){
          // la base de datos aún no tiene las columnas nuevas: se envía el motivo dentro del mensaje
          var prefix = '[Motivo: ' + MOTIVOS[f.motivo.value] + ']' + (row.referencia ? ' [Referencia: ' + row.referencia + ']' : '') + '\n\n';
          return supabaseClient.from('contact_messages').insert({ name: row.name, email: row.email, message: (prefix + row.message).slice(0, 3000) });
        }
        return res;
      }).then(function(res){
        if(res && res.error) throw res.error;
        var mail = f.email.value.trim();
        f.card.innerHTML = '';
        var box = document.createElement('div'); box.className = 'ct-ok'; box.setAttribute('role', 'status');
        var h = document.createElement('p'); h.className = 'ct-ok-t'; h.textContent = 'Recibido';
        var p = document.createElement('p'); p.textContent = 'Te responderemos a ' + mail + ' en 48-72 h.';
        var a = document.createElement('a'); a.className = 'btn btn-line'; a.href = '/'; a.textContent = 'Volver al inicio';
        box.appendChild(h); box.appendChild(p); box.appendChild(a); f.card.appendChild(box);
        f.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }).catch(function(){
      loading(false);
      showStatus('No se ha podido enviar el mensaje. Inténtalo de nuevo en unos minutos o escríbenos a', true);
    });
  });
})();
