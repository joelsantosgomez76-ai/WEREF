// Adaptador que implementa el mismo contrato que esperaba window.storage en la app
// (get(key) -> {value:string}|null, set(key, value:string)), pero respaldado por la
// tabla user_data de Supabase en vez del almacenamiento de Claude. Cada fila queda
// filtrada al usuario logueado gracias a las políticas de Row Level Security.
//
// La identidad se toma de la sesión guardada en el navegador (getSession), que no hace ninguna
// consulta al servidor: antes cada lectura y cada guardado pedían primero getUser() por internet,
// y al abrir la app eso se multiplicaba por cada dato que se carga (la web iba más lenta, sobre todo en el móvil).

async function currentUserId(){
  try{
    const { data } = await supabaseClient.auth.getSession();
    return (data && data.session && data.session.user && data.session.user.id) || null;
  }catch(e){ return null; }
}

window.storage = {
  async get(key){
    const uid = await currentUserId();
    if(!uid) return null;
    const { data, error } = await supabaseClient
      .from('user_data')
      .select('value')
      .eq('user_id', uid)
      .eq('key', key)
      .maybeSingle();
    if(error || !data) return null;
    return { value: JSON.stringify(data.value) };
  },

  async set(key, value){
    const uid = await currentUserId();
    if(!uid) return;
    let parsed;
    try{ parsed = JSON.parse(value); }catch(e){ parsed = value; }
    await supabaseClient
      .from('user_data')
      .upsert({ user_id: uid, key, value: parsed, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
  }
};
