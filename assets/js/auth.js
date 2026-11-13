// Funciones de autenticación compartidas por index.html (login/registro) y app.html (sesión activa).

const PASSWORD_POLICY_MESSAGE = 'La contraseña debe tener al menos 8 caracteres e incluir mayúsculas, minúsculas, números y un carácter especial.';

function isStrongPassword(password){
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password);
}

async function doRegister(email, password, metadata, captchaToken){
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: metadata || {}, captchaToken, emailRedirectTo: window.location.origin + '/bienvenida/' }
  });
  return { data, error };
}

// Devuelve true (libre), false (ocupado) o null (no se ha podido comprobar). Solo usa la funcion del servidor.
async function usernameAvailability(username){
  try{
    const { data, error } = await supabaseClient.rpc('username_available', { p_username: username });
    if(!error && typeof data === 'boolean') return data;
  }catch(e){}
  return null;
}
async function isUsernameTaken(username){
  const ok = await usernameAvailability(username);
  return ok === false;
}
async function claimUsername(userId, username){
  const { error } = await supabaseClient.from('usernames').insert({ user_id: userId, username });
  return { error };
}

async function doGoogleLogin(redirect){
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/entrar/?google=1' + (redirect ? '&redirect=' + encodeURIComponent(redirect) : '') }
  });
  return { error };
}

async function doPasswordReset(email, captchaToken){
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/recuperar-contrasena/',
    captchaToken
  });
  return { error };
}

async function doLogin(email, password, captchaToken){
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password, options: { captchaToken } });
  return { data, error };
}

async function getCurrentSession(){
  const { data, error } = await supabaseClient.auth.getSession();
  if(error) return null;
  return data.session;
}

async function handleLogout(){
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

function authErrorMessage(error){
  if(!error) return '';
  const msg = error.message || '';
  if(msg.includes('already registered') || msg.includes('already exists')) return 'Ya existe una cuenta con ese correo. Inicia sesión.';
  if(msg.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos.';
  if(msg.includes('Password should be at least') || msg.includes('Password should contain')) return PASSWORD_POLICY_MESSAGE;
  if(msg.includes('Unable to validate email') || msg.includes('invalid')) return 'Introduce un correo electrónico válido.';
  return msg || 'Ha ocurrido un error. Inténtalo de nuevo.';
}

/* Comprobación de nombre y apellidos (registro, perfil y la pantalla que se pide a los miembros del comité).
   Devuelve un mensaje si algo no cuadra, o '' si está bien. */
function nameProblem(first, last){
  const f = String(first || '').trim(), l = String(last || '').trim();
  const letters = (s) => s.replace(/[^\p{L}]/gu, '');
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if(letters(f).length < 2) return 'Escribe tu nombre.';
  if(letters(l).length < 2) return 'Escribe tus apellidos.';
  if(norm(f) === norm(l)) return 'El nombre y los apellidos no pueden ser iguales: cada uno va en su casilla.';
  return '';
}

/* ---- Utilidades del flujo de acceso (paginas /entrar/, /registro/, ... y modal) ---- */
const WEREF_TERMS_VERSION = '2026-11';

// Solo rutas internas ("/algo"): evita redirecciones a otros sitios.
function safeRedirect(value, fallback){
  try{
    const v = String(value || '');
    if(v.charAt(0) === '/' && v.charAt(1) !== '/' && v.indexOf('\\') < 0) return v;
  }catch(e){}
  return fallback || '/app.html';
}

// Mensaje si la fecha no vale o la persona tiene menos de 14 anos; '' si esta bien.
function birthdateProblem(value){
  if(!value) return 'Escribe tu fecha de nacimiento.';
  const d = new Date(value + 'T00:00:00');
  if(isNaN(d.getTime()) || d.getFullYear() < 1900) return 'La fecha de nacimiento no es válida.';
  const limit = new Date(); limit.setFullYear(limit.getFullYear() - 14); limit.setHours(23, 59, 59, 999);
  if(d > limit) return 'WEREF es para personas de 14 años o más. Si eres menor, no puedes crear una cuenta.';
  return '';
}

// Con Google puede faltar el usuario o la fecha de nacimiento. Devuelve { username, birthdate } de lo que falta.
async function accountMissing(){
  const out = { username: false, birthdate: false };
  const { data: ur } = await supabaseClient.auth.getUser();
  const user = ur && ur.user; if(!user) return out;
  const meta = user.user_metadata || {};
  const { data: un } = await supabaseClient.from('usernames').select('username').eq('user_id', user.id).maybeSingle();
  if(!un){
    // si el usuario se guardo al registrarse (cuenta aun sin sesion), se reclama ahora
    const pending = String(meta.username || '').trim();
    let claimed = false;
    if(pending){ const r = await claimUsername(user.id, pending); claimed = !r.error; }
    if(!claimed) out.username = true;
  }
  const { data: po } = await supabaseClient.from('profiles_onboarding').select('birth_date').eq('user_id', user.id).maybeSingle();
  if(!(po && po.birth_date)){
    if(meta.birthdate && !birthdateProblem(meta.birthdate)){
      await supabaseClient.from('profiles_onboarding').upsert({ user_id: user.id, birth_date: meta.birthdate }, { onConflict: 'user_id' });
    } else out.birthdate = true;
  }
  return out;
}