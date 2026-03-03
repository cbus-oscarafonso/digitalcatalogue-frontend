(async function () {
  const sb = window.sb;
  const requireAuth = window.requireAuth;
  const $ = (id) => document.getElementById(id);

  const msgEl = $("msg");
  const whoEl = $("whoami");
  const customersSelect = $("customersSelect");
  const newCustomerName = $("newCustomerName");
  const tbody = $("pendingTbody");

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

  // 0) Auth gate (session + active). Role gate is here:
  const session = await requireAuth("login.html");
  if (!session) return;

  const myUserId = session.user.id;
  whoEl.textContent = `Logged in as ${session.user.email || myUserId}`;

  // Ensure admin role (extra safety; auth-guard checks active but not role)
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

  document.documentElement.style.visibility = "visible";

  async function loadCustomers() {
    customersSelect.innerHTML = `<option value="">Loading…</option>`;
    const { data, error } = await sb
      .from("customers")
      .select("id,name")
      .order("name", { ascending: true });

    if (error) {
      customersSelect.innerHTML = `<option value="">(cannot load)</option>`;
      setMsg("Failed to load customers (RLS or schema).", false);
      return;
    }

    const opts = [`<option value="">— Select existing customer —</option>`];
    for (const c of data || []) {
      opts.push(`<option value="${esc(c.id)}">${esc(c.name ?? c.id)}</option>`);
    }
    customersSelect.innerHTML = opts.join("");
  }

  async function loadPending() {
    tbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;

    const { data, error } = await sb
      .from("profiles")
      .select("user_id, requested_customer_name, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      tbody.innerHTML = `<tr><td colspan="5">Failed to load pending users.</td></tr>`;
      setMsg("Failed to load pending profiles. Check admin SELECT policy on profiles.", false);
      return;
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No pending users 🎉</td></tr>`;
      setMsg("", true);
      return;
    }

    tbody.innerHTML = data.map((p) => {
      const created = p.created_at ? new Date(p.created_at).toLocaleString() : "";
      return `
        <tr data-user-id="${esc(p.user_id)}">
          <td><span class="pill">pending</span></td>
          <td class="mono">${esc(p.user_id)}</td>
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
      // Create new customer
      const { data, error } = await sb
        .from("customers")
        .insert([{ name: newName }])
        .select("id")
        .single();

      if (error) {
        throw new Error("Creating customer failed: " + error.message);
      }
      return data.id;
    }

    if (!selectedId) {
      throw new Error("Select an existing customer OR type a new customer name.");
    }

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
      .eq("status", "pending"); // safety

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

  // Events
  $("btnRefresh").addEventListener("click", async () => {
    setMsg("Refreshing…", true);
    await loadCustomers();
    await loadPending();
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

  tbody.addEventListener("click", async (e) => {
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

      // Refresh list (and customers in case we created a new one)
      await loadCustomers();
      await loadPending();
    } catch (err) {
      console.error(err);
      setMsg(String(err?.message || err), false);
    }
  });

  // Initial load
  await loadCustomers();
  await loadPending();
})();