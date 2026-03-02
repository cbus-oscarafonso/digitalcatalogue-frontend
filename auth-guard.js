// auth-guard.js
const SUPABASE_URL = "https://ytwwcrhtcsdpqeualnsx.supabase.co";
const SUPABASE_KEY = "sb_publishable_QdZJOKCMMhOa9Xgb1ab-ew_ZJFeVncA";

window.sb = window.sb || window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function getMyProfile() {
  // returns { data, error }
  return await window.sb
    .from("profiles")
    .select("status, customer_id, role")
    .eq("user_id", (await window.sb.auth.getUser()).data.user?.id || "")
    .maybeSingle();
}

function setReturnTo() {
  const returnTo = location.pathname.split("/").pop() + location.hash;
  try { sessionStorage.setItem("returnTo", returnTo); } catch {}
}

function redirectLogin(reason, redirectTo) {
  try { sessionStorage.setItem("authError", reason); } catch {}
  setReturnTo();
  window.location.replace(redirectTo);
}

window.requireAuth = async function requireAuth(redirectTo = "login.html") {
  const { data, error } = await window.sb.auth.getSession();

  if (error || !data.session) {
    redirectLogin("no_session", redirectTo);
    return null;
  }

  // ✅ session exists -> check profile status
  const { data: prof, error: perr } = await window.sb
    .from("profiles")
    .select("status, customer_id")
    .eq("user_id", data.session.user.id)
    .maybeSingle();

  // If no profile row, treat as pending (should be rare now due to trigger)
  if (perr || !prof) {
    redirectLogin("pending", redirectTo);
    return null;
  }

  const status = String(prof.status || "").toLowerCase();

  if (status !== "active" || !prof.customer_id) {
    // pending / blocked / missing customer
    redirectLogin(status === "pending" ? "pending" : "blocked", redirectTo);
    return null;
  }

  // ✅ all good → show UI
  document.documentElement.style.visibility = "visible";
  return data.session;
};

// BFCache protection: re-check when coming back via back/forward cache
window.addEventListener("pageshow", async () => {
  const { data } = await window.sb.auth.getSession();
  if (!data.session) {
    redirectLogin("no_session", "login.html");
    return;
  }

  const { data: prof } = await window.sb
    .from("profiles")
    .select("status, customer_id")
    .eq("user_id", data.session.user.id)
    .maybeSingle();

  const status = String(prof?.status || "").toLowerCase();
  if (!prof || status !== "active" || !prof.customer_id) {
    redirectLogin(status === "pending" ? "pending" : "blocked", "login.html");
  }
});