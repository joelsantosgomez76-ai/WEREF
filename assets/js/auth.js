// Funciones de autenticación compartidas por index.html (login/registro) y app.html (sesión activa).

async function doRegister(email, password){
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  return { data, error };
}

async function doLogin(email, password){
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
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
  if(msg.includes('Password should be at least')) return 'La contraseña debe tener al menos 6 caracteres.';
  if(msg.includes('Unable to validate email') || msg.includes('invalid')) return 'Introduce un correo electrónico válido.';
  return msg || 'Ha ocurrido un error. Inténtalo de nuevo.';
}
