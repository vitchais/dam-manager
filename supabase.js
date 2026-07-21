// ============================================================================
// supabase.js
// Inicializa a conexão com o Supabase para uso em todo o site.
//
// Este arquivo depende da biblioteca oficial @supabase/supabase-js, que é
// carregada via CDN em um <script> logo ANTES deste arquivo em index.html:
//
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase.js"></script>
//
// Depois de carregado, a variável global `supabaseClient` fica disponível
// para todo o restante do JavaScript do site (o <script> principal do
// index.html usa `supabaseClient.from('reservas')...` etc).
// ============================================================================

// TODO: troque pelos valores reais do seu projeto Supabase.
// Encontrados em: Painel do Supabase > Project Settings > API.
const SUPABASE_URL = 'https://sfrovrevzqrfrmmimpyl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Uw_kAW3iu2xH0FQXUNdPWA_deDzfXoI';

// A chave "anon" é pública por natureza (fica visível no navegador) — a
// segurança dos dados é garantida pelas políticas de Row Level Security
// (RLS) configuradas no banco, não por esta chave ser secreta.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
