// supabase-client.js
(() => {
  const SUPABASE_URL = "https://ytwwcrhtcsdpqeualnsx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_QdZJOKCMMhOa9Xgb1ab-ew_ZJFeVncA";

  if (!window.supabase) {
    console.error("Supabase JS not loaded before supabase-client.js");
    return;
  }

  // Single global client for the whole site
  window.sb = window.sb || window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,      // keep session across reloads
        autoRefreshToken: true,    // refresh JWT automatically
        detectSessionInUrl: false, // no magic redirect parsing
      }
    }
  );
})();