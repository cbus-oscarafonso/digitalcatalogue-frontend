// auth-guard.js
const SUPABASE_URL = "https://ytwwcrhtcsdpqeualnsx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QdZJOKCMMhOa9Xgb1ab-ew_ZJFeVncA";

window.sb = window.sb || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.requireAuth = async function requireAuth(redirectTo = "login.html") {
  const { data, error } = await window.sb.auth.getSession();
  if (error || !data.session) {
    window.location.href = redirectTo;
    return null;
  }
  return data.session;
};