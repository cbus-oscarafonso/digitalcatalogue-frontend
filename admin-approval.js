(async function () {
  const sb = window.sb;
  const requireAuth = window.requireAuth;
  const $ = (id) => document.getElementById(id);

  const pendingTbody = $("pendingTbody");
  const activeTbody = $("activeTbody");

  let activeUsersData = [];
  let currentSortKey = null;
  let currentSortDir = "asc";

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function formatDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleString();
  }

  function makeDisplayName(fullName) {
    const s = String(fullName || "").trim();
    if (!s) return "";
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0] + " " + parts[parts.length - 1];
  }

  // Auth guard
  const session = await requireAuth("login.html");
  if (!session) return;

  document.documentElement.style.visibility = "visible";

  // Load Pending
  async function loadPending() {
    const { data, error } = await sb
      .from("profiles")
      .select("user_id, requested_full_name, requested_email, requested_customer_name, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      pendingTbody.innerHTML = `<tr><td colspan="4">Error loading.</td></tr>`;
      return;
    }

    if (!data.length) {
      pendingTbody.innerHTML = `<tr><td colspan="4">No pending users 🎉</td></tr>`;
      return;
    }

    pendingTbody.innerHTML = data.map(p => `
      <tr>
        <td>
          <strong>${esc(makeDisplayName(p.requested_full_name))}</strong><br>
          <span class="small">${esc(p.requested_email)}</span><br>
          <span class="mono small">${esc(p.user_id)}</span>
        </td>
        <td>${esc(p.requested_customer_name)}</td>
        <td class="small">${formatDate(p.created_at)}</td>
        <td>
          <button class="btn btn-primary" onclick="approve('${p.user_id}')">Approve</button>
          <button class="btn btn-danger" onclick="reject('${p.user_id}')">Reject</button>
        </td>
      </tr>
    `).join("");
  }

  // Load Active
  async function loadActive() {
    const { data, error } = await sb
      .from("profiles")
      .select(`
        user_id,
        role,
        requested_full_name,
        requested_email,
        customer_id,
        approved_at,
        approved_by,
        created_at,
        customers ( name, code )
      `)
      .eq("status", "active");

    if (error) {
      activeTbody.innerHTML = `<tr><td colspan="8">Error loading.</td></tr>`;
      return;
    }

    activeUsersData = data.map(u => ({
      user_id: u.user_id,
      display_name: makeDisplayName(u.requested_full_name),
      email: u.requested_email,
      role: u.role,
      customer_name: u.customers ? `${u.customers.name} (${u.customers.code})` : "",
      created_at: u.created_at,
      approved_at: u.approved_at,
      approved_by: u.approved_by
    }));

    renderActive();
  }

  function renderActive() {
    if (!activeUsersData.length) {
      activeTbody.innerHTML = `<tr><td colspan="8">No active users.</td></tr>`;
      return;
    }

    activeTbody.innerHTML = activeUsersData.map(u => `
      <tr>
        <td><strong>${esc(u.display_name)}</strong></td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.role)}</td>
        <td>${esc(u.customer_name)}</td>
        <td class="small">${formatDate(u.created_at)}</td>
        <td class="small">${formatDate(u.approved_at)}</td>
        <td class="mono small">${esc(u.approved_by || "")}</td>
        <td class="mono small">${esc(u.user_id)}</td>
      </tr>
    `).join("");
  }

  function sortActive(key) {
    if (currentSortKey === key) {
      currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
    } else {
      currentSortKey = key;
      currentSortDir = "asc";
    }

    activeUsersData.sort((a, b) => {
      const va = (a[key] || "").toString().toLowerCase();
      const vb = (b[key] || "").toString().toLowerCase();
      if (va < vb) return currentSortDir === "asc" ? -1 : 1;
      if (va > vb) return currentSortDir === "asc" ? 1 : -1;
      return 0;
    });

    renderActive();
  }

  document.querySelectorAll("th[data-key]").forEach(th => {
    th.addEventListener("click", () => {
      sortActive(th.dataset.key);
    });
  });

  // Approve / Reject exposed globally
  window.approve = async function (userId) {
    await sb.from("profiles").update({ status: "active" }).eq("user_id", userId);
    await loadPending();
    await loadActive();
  };

  window.reject = async function (userId) {
    await sb.from("profiles").update({ status: "rejected" }).eq("user_id", userId);
    await loadPending();
    await loadActive();
  };

  $("btnRefresh").onclick = async () => {
    await loadPending();
    await loadActive();
  };

  $("btnLogout").onclick = async () => {
    await sb.auth.signOut();
    window.location.replace("login.html");
  };

  await loadPending();
  await loadActive();
})();