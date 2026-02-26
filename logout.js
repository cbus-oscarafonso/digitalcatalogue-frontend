window.__logout_loaded__ = Date.now();
console.log("logout.js loaded", window.__logout_loaded__);

(async () => {
  // garante que existe sb e que a página está autenticada
  const session = await window.requireAuth("login.html");
  if (!session) return;

  const btn = document.getElementById("btnLogout");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      await window.sb.auth.signOut();
    } catch {}
    window.location.replace("login.html");
  });
})();