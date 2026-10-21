// Funciones de autenticación compartidas por index.html (login/registro) y app.html (sesión activa).

const PASSWORD_POLICY_MESSAGE = 'La contraseña debe tener al menos 8 caracteres e incluir mayúsculas, minúsculas, números y un carácter especial.';

function isStrongPassword(password){
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password);
}

async function doRegister(email, password, metadata, captchaToken){
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: metadata || {}, captchaToken }
  });
  return { data, error };
}

async function isUsernameTaken(username){
  // Preferido: función del servidor que solo devuelve sí/no (no expone la lista de usuarios).
  try{
    const { data, error } = await supabaseClient.rpc('username_available', { p_username: username });
    if(!error && typeof data === 'boolean') return !data;
  }catch(e){}
  // Respaldo (si aún no se ha instalado supabase/security-hardening.sql).
  const escaped = username.replace(/[%_\\]/g, '\\$&');
  const { data } = await supabaseClient.from('usernames').select('username').ilike('username', escaped).maybeSingle();
  return !!data;
}

async function claimUsername(userId, username){
  const { error } = await supabaseClient.from('usernames').insert({ user_id: userId, username });
  return { error };
}

async function doGoogleLogin(){
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/app.html' }
  });
  return { error };
}

async function doPasswordReset(email, captchaToken){
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html',
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
