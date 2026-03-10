(async function () {
  const sb = window.sb;
  const requireAuth = window.requireAuth;
  const $ = (id) => document.getElementById(id);

  const msgEl = $("msg");
  const whoEl = $("whoami");
  const customersSelect = $("customersSelect");
  const newCustomerName = $("newCustomerName");
  const pendingTbody = $("pendingTbody");
  const activeTbody = $("activeTbody");

  let activeUsersData = [];
  let sortKey = "display_name";
  let sortDir = "asc";

  function setMsg(text, ok = false) {
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "green" : "#b91c1c";
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(d) {
    if (!d) return "";
    try { return new Date(d).toLocaleString(); } catch { return String(d); }
  }

  function makeDisplayName(fullName) {
    const s = String(fullName || "").trim();
    if (!s) return "";
    const parts = s.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return parts[0] + " " + parts[parts.length - 1];
  }

  // Customer code: 5 chars from name + 3 random
  function makeCustomerCode(name) {
    const cleaned = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const prefixLen = 5;
    const prefix = (cleaned.slice(0, prefixLen) || "CUST").padEnd(prefixLen, "X");
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    return `${prefix}${suffix}`;
  }

  // 0) Auth gate (DO NOT reveal page yet)
  const session = await requireAuth("login.html", { reveal: false });
  if (!session) return;

  const myUserId = session.user.id;
  whoEl.textContent = `Logged in as ${session.user.email || myUserId}`;

  // Ensure admin role (extra safety)
  const { data: myProf, error: myProfErr } = await sb
    .from("profiles")
    .select("role,status")
    .eq("user_id", myUserId)
    .maybeSingle();

  if (myProfErr || !myProf || String(myProf.role) !== "admin" || String(myProf.status) !== "active") {
    try { sessionStorage.setItem("authError", "blocked"); } catch {}
    await sb.auth.signOut().catch(() => {});
    window.location.replace("login.html");
    return;
  }

  // ✅ ONLY NOW reveal the page (prevents flash for non-admins)
  if (window.revealPage) window.revealPage();
  else document.documentElement.style.visibility = "visible"; // fallback (shouldn't be needed)

  async function loadCustomers() {
    customersSelect.innerHTML = `<option value="">Loading…</option>`;

    const { data, error } = await sb
      .from("customers")
      .select("id,name,code")
      .order("name", { ascending: true });

    if (error) {
      console.error("loadCustomers error:", error);
      customersSelect.innerHTML = `<option value="">(cannot load)</option>`;
      setMsg("Failed to load customers: " + error.message, false);
      return;
    }

    const opts = [`<option value="">— Select existing customer —</option>`];
    for (const c of data || []) {
      const label = c.name ? `${c.name} (${c.code || "NO_CODE"})` : (c.code || c.id);
      opts.push(`<option value="${esc(c.id)}">${esc(label)}</option>`);
    }
    customersSelect.innerHTML = opts.join("");
  }

  async function loadPending() {
    pendingTbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;

    const { data, error } = await sb
      .from("profiles")
      .select("user_id, requested_customer_name, requested_email, requested_full_name, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadPending error:", error);
      pendingTbody.innerHTML = `<tr><td colspan="5">Failed to load pending users: ${esc(error.message)}</td></tr>`;
      setMsg("Failed to load pending users: " + error.message, false);
      return;
    }

    if (!data || data.length === 0) {
      pendingTbody.innerHTML = `<tr><td colspan="5">No pending users 🎉</td></tr>`;
      return;
    }

    pendingTbody.innerHTML = data.map((p) => {
      const created = p.created_at ? formatDate(p.created_at) : "";
      const display = makeDisplayName(p.requested_full_name);
      const email = p.requested_email || "";

      return `
        <tr data-user-id="${esc(p.user_id)}">
          <td><span class="pill">pending</span></td>
          <td>
            <strong>${esc(display || "(no name)")}</strong><br>
            <span class="small">${esc(email || "(no email)")}</span><br>
            <span class="mono small">${esc(p.user_id)}</span>
          </td>
          <td>${esc(p.requested_customer_name || "")}</td>
          <td class="small">${esc(created)}</td>
          <td>
            <div class="actions">
              <button class="btn btn-primary" data-action="approve">Approve</button>
              <button class="btn btn-danger" data-action="reject">Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function ensureCustomerId() {
    const newName = newCustomerName.value.trim();
    const selectedId = customersSelect.value;

    if (newName) {
      const code = makeCustomerCode(newName);

      const { data, error } = await sb
        .from("customers")
        .insert([{ name: newName, code }])
        .select("id")
        .single();

      if (error) throw new Error("Creating customer failed: " + error.message);
      return data.id;
    }

    if (!selectedId) throw new Error("Select an existing customer OR type a new customer name.");
    return selectedId;
  }

  async function approveUser(userId) {
    const customerId = await ensureCustomerId();

    const payload = {
      status: "active",
      customer_id: customerId,
      approved_at: new Date().toISOString(),
      approved_by: myUserId
    };

    const { error } = await sb
      .from("profiles")
      .update(payload)
      .eq("user_id", userId)
      .eq("status", "pending");

    if (error) throw new Error("Approving user failed: " + error.message);
  }

  async function rejectUser(userId) {
    const { error } = await sb
      .from("profiles")
      .update({
        status: "rejected",
        approved_at: new Date().toISOString(),
        approved_by: myUserId
      })
      .eq("user_id", userId)
      .eq("status", "pending");

    if (error) throw new Error("Reject failed: " + error.message);
  }

  // --- ACTIVE USERS (with robust embed using FK constraint) ---
  async function loadActiveUsers() {
    activeTbody.innerHTML = `<tr><td colspan="8">Loading…</td></tr>`;

    // IMPORTANT: explicit embed via FK name (most robust)
    const sel =
      "user_id,role,requested_full_name,requested_email,customer_id,approved_at,approved_by,created_at," +
      "customer:customers!profiles_customer_id_fkey(id,name,code)";

    const { data, error } = await sb
      .from("profiles")
      .select(sel)
      .eq("status", "active");

    if (error) {
      console.error("loadActiveUsers error:", error);
      activeTbody.innerHTML = `<tr><td colspan="8">Error loading active users: ${esc(error.message)}</td></tr>`;
      return;
    }

    activeUsersData = (data || []).map((u) => {
      const display = makeDisplayName(u.requested_full_name);
      const c = u.customer;
      const customerLabel = c ? `${c.name} (${c.code})` : (u.customer_id ? String(u.customer_id) : "");

      return {
        user_id: u.user_id,
        display_name: display,
        email: u.requested_email,
        role: u.role,
        customer_label: customerLabel,
        created_at: u.created_at,
        approved_at: u.approved_at,
        approved_by: u.approved_by
      };
    });

    sortAndRenderActive();
  }

  function sortAndRenderActive() {
    const dir = sortDir === "asc" ? 1 : -1;

    activeUsersData.sort((a, b) => {
      const va = (a[sortKey] ?? "").toString().toLowerCase();
      const vb = (b[sortKey] ?? "").toString().toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

    renderActive();
  }

  function renderActive() {
    if (!activeUsersData.length) {
      activeTbody.innerHTML = `<tr><td colspan="8">No active users.</td></tr>`;
      return;
    }

    activeTbody.innerHTML = activeUsersData.map((u) => `
      <tr>
        <td><strong>${esc(u.display_name)}</strong></td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.role)}</td>
        <td>${esc(u.customer_label)}</td>
        <td class="small">${esc(formatDate(u.created_at))}</td>
        <td class="small">${esc(formatDate(u.approved_at))}</td>
        <td class="mono small">${esc(u.approved_by || "")}</td>
        <td class="mono small">${esc(u.user_id)}</td>
      </tr>
    `).join("");
  }

  // Events
  $("btnRefresh").addEventListener("click", async () => {
    setMsg("Refreshing…", true);
    await loadCustomers();
    await loadPending();
    await loadActiveUsers();
    setMsg("", true);
  });

  $("btnLogout").addEventListener("click", async () => {
    await sb.auth.signOut().catch(() => {});
    window.location.replace("login.html");
  });

  $("btnClearNew").addEventListener("click", () => {
    newCustomerName.value = "";
    setMsg("New customer cleared.", true);
  });

  pendingTbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const tr = btn.closest("tr[data-user-id]");
    if (!tr) return;

    const userId = tr.getAttribute("data-user-id");
    const action = btn.getAttribute("data-action");

    try {
      setMsg("Working…", true);

      if (action === "approve") {
        await approveUser(userId);
        setMsg("Approved.", true);
      } else if (action === "reject") {
        await rejectUser(userId);
        setMsg("Rejected.", true);
      }

      await loadCustomers();
      await loadPending();
      await loadActiveUsers();
      newCustomerName.value = "";
    } catch (err) {
      console.error(err);
      setMsg(String(err?.message || err), false);
    }
  });

  // Sort clicks for Active table headers
  document.querySelectorAll(".th-sort").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (!key) return;
      if (sortKey === key) sortDir = (sortDir === "asc") ? "desc" : "asc";
      else { sortKey = key; sortDir = "asc"; }
      sortAndRenderActive();
    });
  });

  // Initial load
  await loadCustomers();
  await loadPending();
  await loadActiveUsers();
})();