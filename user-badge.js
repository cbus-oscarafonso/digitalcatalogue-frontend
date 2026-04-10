// user-badge.js — renders the "Signed in as ..." block in the header.
// Injects into #userBadge. If a pre-fetched profile is passed, skips the query.
(function () {
  const ROLE_LABELS = {
    admin: "Admin",
    client_manager: "Client Manager",
    catalog_manager: "Catalog Manager",
    customer: "Customer",
    internal: "Internal",
  };

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function prettyRole(role) {
    if (ROLE_LABELS[role]) return ROLE_LABELS[role];
    if (!role) return "";
    return String(role)
      .split(/[_\s]+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  async function renderUserBadge(session, preloadedProfile) {
    const host = document.getElementById("userBadge");
    if (!host || !session) return;

    let prof = preloadedProfile;
    // Re-fetch if any required field is missing from the preloaded profile.
    const needsFetch = !prof
      || prof.requested_full_name === undefined
      || prof.customer_id === undefined
      || prof.role === undefined;

    if (needsFetch) {
      const { data } = await window.sb
        .from("profiles")
        .select("role, requested_full_name, customer_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      prof = data || {};
    }

    const name = prof.requested_full_name || session.user.email || "";
    const role = prof.role || "";

    let secondLine = "";
    if (role === "customer" && prof.customer_id) {
      const { data: cust } = await window.sb
        .from("customers")
        .select("name")
        .eq("id", prof.customer_id)
        .maybeSingle();
      secondLine = cust?.name || "";
    } else if (role) {
      secondLine = prettyRole(role);
    }

    host.innerHTML =
      `<div class="userBadgeLine1">Signed in as <strong>${esc(name)}</strong></div>` +
      `<div class="userBadgeLine2"><strong>${esc(secondLine)}</strong></div>`;
    host.style.display = "";
  }

  window.renderUserBadge = renderUserBadge;
})();
