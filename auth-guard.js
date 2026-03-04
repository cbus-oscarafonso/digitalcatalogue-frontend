// auth-guard.js

window.revealPage = function revealPage() {
  document.documentElement.style.visibility = "visible";
};

window.requireAuth = async function requireAuth(redirectTo = "login.html", opts = {}) {
  const { reveal = true } = opts;
  const returnTo = location.pathname.split("/").pop() + location.hash;

  // Safety: if Supabase client isn't ready, fail closed
  if (!window.sb || !window.sb.auth) {
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

  if (!window.sb || !window.sb.auth) {
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

    const status = String(prof?.status || "").toLowerCase();

    if (!prof) {
      try { sessionStorage.setItem("authError", "profile_missing"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace("login.html");
      return;
    }

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