(async () => {
  const btn = document.getElementById("btnLogout");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      await window.sb.auth.signOut();
    } catch {}

    window.location.replace("login.html");
  });
})();