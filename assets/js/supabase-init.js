// Datos públicos del proyecto de Supabase (Project Settings -> API).
// Son claves públicas (seguras para el navegador): toda la seguridad real la ponen
// las políticas de Row Level Security y las funciones del servidor.
const SUPABASE_URL = 'https://czirvwezjwxubsuyafgx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yQKoAGw7lv9pNzBhhup9sw_HCXf4InQ';

/* ---- Sesión: "Mantener la sesión iniciada en este dispositivo" ----
   Con la opción activada (por defecto) la sesión se guarda en localStorage y sigue abierta
   al volver. Desactivada, se guarda en sessionStorage: se cierra al cerrar la pestaña/navegador.
   Es útil en ordenadores compartidos o públicos. */
const WEREF_REMEMBER_KEY = 'weref_remember_session';
function werefRememberSession(){
  try{ return localStorage.getItem(WEREF_REMEMBER_KEY) !== '0'; }catch(e){ return true; }
}
function setWerefRememberSession(value){
  try{ localStorage.setItem(WEREF_REMEMBER_KEY, value ? '1' : '0'); }catch(e){}
}
const werefAuthStorage = {
  getItem(key){
    try{ const s = sessionStorage.getItem(key); return s !== null ? s : localStorage.getItem(key); }catch(e){ return null; }
  },
  setItem(key, value){
    try{
      if(werefRememberSession()){ localStorage.setItem(key, value); sessionStorage.removeItem(key); }
      else { sessionStorage.setItem(key, value); localStorage.removeItem(key); }
    }catch(e){}
  },
  removeItem(key){
    try{ localStorage.removeItem(key); sessionStorage.removeItem(key); }catch(e){}
  }
};

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: werefAuthStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
