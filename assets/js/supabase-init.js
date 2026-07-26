// PEGA AQUÍ los datos de tu proyecto de Supabase (Project Settings -> API).
// Son claves públicas (seguras para el navegador) siempre que la tabla user_data
// tenga Row Level Security activado como se indica en las instrucciones.
const SUPABASE_URL = 'https://czirvwezjwxubsuyafgx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yQKoAGw7lv9pNzBhhup9sw_HCXf4InQ';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
