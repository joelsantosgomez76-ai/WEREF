// Adaptador que implementa el mismo contrato que esperaba window.storage en la app
// (get(key) -> {value:string}|null, set(key, value:string)), pero respaldado por la
// tabla user_data de Supabase en vez del almacenamiento de Claude. Cada fila queda
// filtrada al usuario logueado gracias a las políticas de Row Level Security.

window.storage = {
  async get(key){
    const { data: { user } } = await supabaseClient.auth.getUser();
    if(!user) return null;
    const { data, error } = await supabaseClient
      .from('user_data')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', key)
      .maybeSingle();
    if(error || !data) return null;
    return { value: JSON.stringify(data.value) };
  },

  async set(key, value){
    const { data: { user } } = await supabaseClient.auth.getUser();
    if(!user) return;
    let parsed;
    try{ parsed = JSON.parse(value); }catch(e){ parsed = value; }
    await supabaseClient
      .from('user_data')
      .upsert({ user_id: user.id, key, value: parsed, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
  }
};
