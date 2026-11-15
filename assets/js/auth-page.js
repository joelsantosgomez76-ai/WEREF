(function(){
  var mode = document.body.getAttribute('data-mode');
  var q = new URLSearchParams(location.search);
  var redirect = safeRedirect(q.get('redirect'), '/app.html');
  var root = document.getElementById('au-root');
  var pages = { login: '/entrar/', register: '/registro/', recover: '/recuperar-contrasena/' };
  function mount(m, extra){ var o = { mode: m, redirect: redirect, email: q.get('email') || '', backLink: true, pages: pages }; for(var k in (extra || {})) o[k] = extra[k]; return AuthUI.mount(root, o); }
  function completeOrGo(){
    return accountMissing().then(function(miss){
      if(miss.username || miss.birthdate){ mount('complete', { extra: { needUser: miss.username, needBirth: miss.birthdate } }); }
      else window.location.href = redirect;
    });
  }
  getCurrentSession().then(function(session){
    if(mode === 'login'){ if(session) return completeOrGo(); mount('login'); }
    else if(mode === 'register'){ if(session) return completeOrGo(); mount('register'); }
    else if(mode === 'recover'){
      var rec = /type=recovery|access_token/.test(location.hash) || q.get('code');
      if(rec){ mount('newpass'); supabaseClient.auth.onAuthStateChange(function(){}); } else mount('recover');
    }
    else if(mode === 'verify'){
      var mail = q.get('email') || ''; try{ mail = mail || sessionStorage.getItem('weref_verify_email') || ''; }catch(e){}
      if(session && session.user && session.user.email_confirmed_at){ window.location.href = '/bienvenida/'; return; }
      mount('verify', { email: mail });
    }
    else if(mode === 'welcome'){
      if(!session){ window.location.href = '/entrar/?redirect=' + encodeURIComponent('/bienvenida/'); return; }
      if(q.get('perfil')){ AuthUI.onboard(root, { redirect: redirect }); return; }   // cuestionario opcional (desde el aviso de la app)
      supabaseClient.rpc('touch_milestone', { p_name: 'email_verified' }).then(function(){}, function(){});
      accountMissing().then(function(miss){
        if(miss.username || miss.birthdate){ mount('complete', { extra: { needUser: miss.username, needBirth: miss.birthdate } }); }
        else window.location.href = redirect;   // sin onboarding: al verificar el correo se entra directo a la app
      });
    }
  });
})();
