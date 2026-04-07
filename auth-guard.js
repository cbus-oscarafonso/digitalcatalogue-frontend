// auth-guard.js

window.revealPage = function revealPage() {
  document.documentElement.style.visibility = "visible";
};

/** Wait up to ~2 s for window.sb to be populated by supabase-client.js */
async function _waitForSb(maxMs = 2000) {
  if (window.sb && window.sb.auth) return true;
  const interval = 30;
  let elapsed = 0;
  return new Promise((resolve) => {
    const t = setInterval(() => {
      elapsed += interval;
      if (window.sb && window.sb.auth) { clearInterval(t); resolve(true); return; }
      if (elapsed >= maxMs)            { clearInterval(t); resolve(false); }
    }, interval);
  });
}

window.requireAuth = async function requireAuth(redirectTo = "login.html", opts = {}) {
  const { reveal = true } = opts;
  const returnTo = location.pathname.split("/").pop() + location.hash;

  // Wait for Supabase client to be ready before failing closed
  const sbReady = await _waitForSb();
  if (!sbReady) {
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    window.location.replace(redirectTo);
    return null;
  }

  const { data, error } = await window.sb.auth.getSession();

  if (error || !data.session) {
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    window.location.replace(redirectTo);
    return null;
  }

  // ✅ approval gate via profiles.status
  try {
    const userId = data.session.user?.id;

    const { data: prof, error: pErr } = await window.sb
      .from("profiles")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      try { sessionStorage.setItem("authError", "blocked"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace(redirectTo);
      return null;
    }

    if (!prof) {
      try { sessionStorage.setItem("authError", "profile_missing"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace(redirectTo);
      return null;
    }

    const status = String(prof.status || "").toLowerCase();
    if (status !== "active") {
      try { sessionStorage.setItem("authError", status || "blocked"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace(redirectTo);
      return null;
    }
  } catch {
    try { sessionStorage.setItem("authError", "blocked"); } catch {}
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    await window.sb.auth.signOut().catch(() => {});
    window.location.replace(redirectTo);
    return null;
  }

  // sessão OK + aprovado
  if (reveal) window.revealPage();
  return data.session;
};

// Handle BFCache (back/forward)
window.addEventListener("pageshow", async (e) => {
  if (!e.persisted) return;

  const returnTo = location.pathname.split("/").pop() + location.hash;

  const sbReady = await _waitForSb();
  if (!sbReady) {
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    window.location.replace("login.html");
    return;
  }

  const { data } = await window.sb.auth.getSession();
  if (!data.session) {
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    window.location.replace("login.html");
    return;
  }

  // Re-run approval gate after BFCache restore
  try {
    const userId = data.session.user?.id;

    const { data: prof } = await window.sb
      .from("profiles")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    // Note: check !prof BEFORE reading status to avoid false "active" on null
    if (!prof) {
      try { sessionStorage.setItem("authError", "profile_missing"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace("login.html");
      return;
    }

    const status = String(prof.status || "").toLowerCase();

    if (status !== "active") {
      try { sessionStorage.setItem("authError", status || "blocked"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace("login.html");
      return;
    }
  } catch {
    try { sessionStorage.setItem("authError", "blocked"); } catch {}
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    await window.sb.auth.signOut().catch(() => {});
    window.location.replace("login.html");
    return;
  }

  // Não revelamos aqui automaticamente — cada página decide.
  // A maioria das páginas chama requireAuth() ao carregar e isso revela.
});
