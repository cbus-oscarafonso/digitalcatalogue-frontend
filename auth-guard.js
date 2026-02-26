// auth-guard.js
const SUPABASE_URL = "https://ytwwcrhtcsdpqeualnsx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QdZJOKCMMhOa9Xgb1ab-ew_ZJFeVncA";

window.sb = window.sb || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.requireAuth = async function requireAuth(redirectTo = "login.html") {
  const { data, error } = await window.sb.auth.getSession();

  if (error || !data.session) {
    // IMPORTANT: replace prevents "Back" from bypassing auth
    window.location.replace(redirectTo);
    return null;
  }

  return data.session;
};

// IMPORTANT: handle back/forward cache (BFCache)
window.addEventListener("pageshow", async () => {
  // if this page is using BFCache, re-check session
  const { data } = await window.sb.auth.getSession();
  if (!data.session) {
    window.location.replace("login.html");
  }
});