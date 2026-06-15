window.MD_ELITE_SUPABASE = Object.freeze({
  url: "https://vcfekkkuacusktcqaxkr.supabase.co",
  publishableKey: "sb_publishable_O4_Zi71OyjRnRVLuIV6v-w_OvL0saWF"
});

function createMdEliteClient() {
  const config = window.MD_ELITE_SUPABASE;

  if (!window.supabase) {
    throw new Error("No se pudo cargar la libreria de Supabase.");
  }

  if (!config.url.startsWith("https://") || config.publishableKey.startsWith("__")) {
    throw new Error("Falta configurar la URL o la publishable key de Supabase.");
  }

  return window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}
