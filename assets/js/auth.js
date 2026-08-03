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
