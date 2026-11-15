/* WEREF · consentimiento de cookies (banner, "Configurar cookies" y carga condicionada de Google Tag Manager).
   Elección guardada en localStorage como weref_cookie_consent = { choice: 'all' | 'essential', date }.
   Caduca a los 12 meses. Si se retira el consentimiento, no se carga GTM y se borran las cookies _ga. */
(function(){
  'use strict';
  var KEY = 'weref_cookie_consent', OLD = 'werefCookieConsent', GTM_ID = 'GTM-K68T9Z8S';
  var MAX_AGE = 365 * 24 * 3600 * 1000;
  var banner = null;

  function read(){
    try{
      var v = JSON.parse(localStorage.getItem(KEY));
      if(v && (v.choice === 'all' || v.choice === 'essential') && v.date && (Date.now() - new Date(v.date).getTime()) < MAX_AGE) return v;
      var o = localStorage.getItem(OLD);               // elección antigua: se conserva solo hasta que se guarde la nueva
      if(!v && (o === 'all' || o === 'essential')) return null;   // sin fecha no se puede saber si es reciente: se vuelve a preguntar
    }catch(e){}
    return null;
  }
  function save(choice){
    try{ localStorage.setItem(KEY, JSON.stringify({ choice: choice, date: new Date().toISOString() })); localStorage.removeItem(OLD); }catch(e){}
  }
  function loadGTM(){
    if(window.__werefGtm) return; window.__werefGtm = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(s);
  }
  function deleteGa(){
    var host = location.hostname, parts = host.split('.'), domains = ['', host, '.' + host];
    if(parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    document.cookie.split(';').forEach(function(c){
      var n = c.split('=')[0].trim();
      if(n === '_ga' || n.indexOf('_ga_') === 0 || n === '_gid' || n === '_gat'){
        domains.forEach(function(d){ document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : ''); });
      }
    });
  }
  function apply(choice){
    save(choice);
    var wasOn = !!window.__werefGtm; if(choice === 'all') loadGTM(); else { deleteGa(); if(wasOn){ hide(); location.reload(); return; } }
    hide();
  }
  function hide(){ if(banner){ banner.hidden = true; } }

  function build(){
    banner = document.createElement('div');
    banner.className = 'ck'; banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-label', 'Preferencias de cookies'); banner.hidden = true;
    banner.innerHTML =
      '<div class="ck-in">' +
        '<div class="ck-main">' +
          '<p class="ck-t">Tu privacidad</p>' +
          '<p class="ck-d">Usamos cookies técnicas, necesarias para que la web funcione, y, solo si las aceptas, cookies analíticas (Google Analytics) para entender cómo se usa WEREF y mejorarlo. Más información en la <a href="/politica-cookies/">Política de Cookies</a>.</p>' +
          '<div class="ck-conf" hidden>' +
            '<p class="ck-row"><strong>Técnicas</strong><span>Siempre activas</span></p>' +
            '<label class="ck-row"><strong>Analíticas (Google Analytics)</strong><input type="checkbox" id="ck-an"></label>' +
          '</div>' +
        '</div>' +
        '<div class="ck-actions">' +
          '<button type="button" class="ck-btn" data-ck="reject">Rechazar</button>' +
          '<button type="button" class="ck-btn" data-ck="conf">Configurar</button>' +
          '<button type="button" class="ck-btn" data-ck="accept">Aceptar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    banner.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('[data-ck]') : null; if(!b) return;
      var a = b.getAttribute('data-ck'), conf = banner.querySelector('.ck-conf'), an = banner.querySelector('#ck-an');
      if(a === 'accept') apply('all');
      else if(a === 'reject') apply('essential');
      else if(conf.hidden){ conf.hidden = false; b.textContent = 'Guardar elección'; }
      else apply(an.checked ? 'all' : 'essential');
    });
  }
  function open(){
    if(!banner) build();
    var cur = read(), an = banner.querySelector('#ck-an'), conf = banner.querySelector('.ck-conf');
    an.checked = !!(cur && cur.choice === 'all'); conf.hidden = true;
    banner.querySelector('[data-ck="conf"]').textContent = 'Configurar';
    banner.hidden = false;
  }

  function init(){
    var v = read();
    if(v && v.choice === 'all') loadGTM();
    if(!v) open();
    document.addEventListener('click', function(e){
      var t = e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
      if(t){ e.preventDefault(); open(); }
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
