// auth-guard.js
window.requireAuth = async function requireAuth(redirectTo = "login.html") {
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

  // ✅ NEW: approval gate via profiles.status
  try {
    const userId = data.session.user?.id;

    const { data: prof, error: pErr } = await window.sb
      .from("profiles")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      // Treat as blocked (RLS/policy etc.)
      try { sessionStorage.setItem("authError", "blocked"); } catch {}
      try { sessionStorage.setItem("returnTo", returnTo); } catch {}
      await window.sb.auth.signOut().catch(() => {});
      window.location.replace(redirectTo);
      return null;
    }

    if (!prof) {
      // Profile row missing (or hidden)
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
    // Fail closed if anything unexpected happens
    try { sessionStorage.setItem("authError", "blocked"); } catch {}
    try { sessionStorage.setItem("returnTo", returnTo); } catch {}
    await window.sb.auth.signOut().catch(() => {});
    window.location.replace(redirectTo);
    return null;
  }

  // sessão OK + aprovado
  document.documentElement.style.visibility = "visible";
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

  document.documentElement.style.visibility = "visible";
});