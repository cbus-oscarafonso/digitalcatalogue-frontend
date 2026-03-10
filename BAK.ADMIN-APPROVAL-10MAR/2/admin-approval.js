(async function () {
  const sb = window.sb;
  const requireAuth = window.requireAuth;
  const $ = (id) => document.getElementById(id);

  const sortIndicator = $("sortIndicator");
  const customerSuggestDropdown = $("customerSuggestDropdown");
  const customerSuggestDropdownPending = $("customerSuggestDropdownPending");


  const msgEl = $("msg");
  const whoEl = $("whoami");
  const msgCreateCustomer = $("msgCreateCustomer");

  const pendingDecisionPanel = $("pendingDecisionPanel");
  const existingChoiceCard = $("existingChoiceCard");
  const newChoiceCard = $("newChoiceCard");

  const customersSelect = $("customersSelect");
  const newCustomerNamePending = $("newCustomerNamePending");
  const customerNotesPending = $("customerNotesPending");
  const countrySearchPending = $("countrySearchPending");
  const countryDropdownPending = $("countryDropdownPending");

  const newCustomerNameStandalone = $("newCustomerNameStandalone");
  const customerNotesStandalone = $("customerNotesStandalone");
  const countrySearchStandalone = $("countrySearchStandalone");
  const countryDropdownStandalone = $("countryDropdownStandalone");

  const pendingTbody = $("pendingTbody");
  const activeTbody = $("activeTbody");

  let activeUsersData = [];
  let sortKey = "approved_at";
  let sortDir = "asc";

  let countriesData = [];

  function setMsg(text, ok = false) {
    msgEl.textContent = text || "";
    msgEl.style.color = ok ? "green" : "#b91c1c";
  }

  function setCreateCustomerMsg(text, ok = false) {
    if (!msgCreateCustomer) return;
    msgCreateCustomer.textContent = text || "";
    msgCreateCustomer.style.color = ok ? "green" : "#b91c1c";
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function updateSortIndicator() {
    const labelMap = {
      approved_at: "Date of approval",
      display_name: "User",
      role: "Role",
      customer_label: "Customer"
    };

    const arrow = sortDir === "asc" ? "↑" : "↓";

    sortIndicator.textContent =
      `Sorted by: ${labelMap[sortKey]} ${arrow}`;
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

  function makeCustomerCode(name) {
    const cleaned = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const prefixLen = 5;
    const prefix = (cleaned.slice(0, prefixLen) || "CUST").padEnd(prefixLen, "X");
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    return `${prefix}${suffix}`;
  }

  function createCountryPicker(inputEl, dropdownEl) {
    let selectedCode = "";
    let selectedName = "";
    let filteredCountries = [];
    let activeIndex = -1;
    let enabled = true;

    function render(query = "") {
      const q = String(query || "").trim().toLowerCase();

      filteredCountries = countriesData.filter(c => {
        const code = String(c.code || "").toLowerCase();
        const name = String(c.name || "").toLowerCase();
        return !q || code.includes(q) || name.includes(q);
      });

      if (!filteredCountries.length) {
        dropdownEl.innerHTML = `<div class="countryEmpty">No countries found.</div>`;
        activeIndex = -1;
        return;
      }

      dropdownEl.innerHTML = filteredCountries.map((c, idx) => `
        <div class="countryOption ${idx === activeIndex ? "active" : ""}" data-idx="${idx}">
          <div class="countryCode">${esc(c.code)}</div>
          <div class="countryName">${esc(c.name)}</div>
        </div>
      `).join("");
    }

    function open() {
      if (!enabled) return;
      dropdownEl.classList.add("open");
    }

    function close() {
      dropdownEl.classList.remove("open");
      activeIndex = -1;
    }

    function clear() {
      selectedCode = "";
      selectedName = "";
      inputEl.value = "";
      activeIndex = -1;
      render("");
      close();
    }

    function setEnabled(v) {
      enabled = !!v;
      inputEl.disabled = !enabled;
      if (!enabled) clear();
    }

    function getSelectedCode() {
      return selectedCode;
    }

    function selectCountry(country) {
      selectedCode = country.code;
      selectedName = country.name;
      inputEl.value = `${country.code}  ${country.name}`;
      close();
    }

    function moveSelection(dir) {
      if (!filteredCountries.length) return;
      if (!dropdownEl.classList.contains("open")) open();

      activeIndex += dir;
      if (activeIndex < 0) activeIndex = filteredCountries.length - 1;
      if (activeIndex >= filteredCountries.length) activeIndex = 0;

      render(inputEl.value);

      const activeEl = dropdownEl.querySelector(`.countryOption[data-idx="${activeIndex}"]`);
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    }

    inputEl.addEventListener("focus", () => {
      if (!enabled) return;
      render(inputEl.value);
      open();
    });

    inputEl.addEventListener("click", () => {
      if (!enabled) return;
      render(inputEl.value);
      open();
    });

    inputEl.addEventListener("input", () => {
      if (!enabled) return;
      selectedCode = "";
      selectedName = "";
      activeIndex = -1;
      render(inputEl.value);
      open();
    });

    inputEl.addEventListener("keydown", (e) => {
      if (!enabled) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection(1);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(-1);
        return;
      }

      if (e.key === "Enter") {
        if (!dropdownEl.classList.contains("open")) return;
        e.preventDefault();

        if (activeIndex >= 0 && filteredCountries[activeIndex]) {
          selectCountry(filteredCountries[activeIndex]);
        } else if (filteredCountries.length === 1) {
          selectCountry(filteredCountries[0]);
        }
        return;
      }

      if (e.key === "Escape") {
        close();
      }
    });

    dropdownEl.addEventListener("mousedown", (e) => {
      const opt = e.target.closest(".countryOption");
      if (!opt) return;

      const idx = Number(opt.getAttribute("data-idx"));
      if (!Number.isNaN(idx) && filteredCountries[idx]) {
        selectCountry(filteredCountries[idx]);
      }
    });

    document.addEventListener("click", (e) => {
      if (e.target !== inputEl && !dropdownEl.contains(e.target)) {
        close();
      }
    });

    return {
      render,
      open,
      close,
      clear,
      setEnabled,
      getSelectedCode
    };
  }

  const pendingCountryPicker = createCountryPicker(countrySearchPending, countryDropdownPending);
  const standaloneCountryPicker = createCountryPicker(countrySearchStandalone, countryDropdownStandalone);

  function setPendingModeUI() {
    const existingSelected = !!customersSelect.value;
    const newName = newCustomerNamePending.value.trim();
    const newMode = !!newName;

    if (existingSelected) {
      newChoiceCard.classList.add("is-disabled");
      newCustomerNamePending.disabled = true;
      customerNotesPending.disabled = true;
      pendingCountryPicker.setEnabled(false);
    } else {
      newChoiceCard.classList.remove("is-disabled");
      newCustomerNamePending.disabled = false;
      customerNotesPending.disabled = !newMode;
      pendingCountryPicker.setEnabled(newMode);
    }

    if (newMode) {
      existingChoiceCard.classList.add("is-disabled");
      customersSelect.disabled = true;
    } else {
      existingChoiceCard.classList.remove("is-disabled");
      customersSelect.disabled = false;
    }
  }

  function clearPendingChoice() {
    customersSelect.value = "";
    newCustomerNamePending.value = "";
    customerNotesPending.value = "";
    pendingCountryPicker.clear();
    setPendingModeUI();
    setMsg("Pending approval choice cleared.", true);
  }

  function clearStandaloneCreate() {
    newCustomerNameStandalone.value = "";
    customerNotesStandalone.value = "";
    standaloneCountryPicker.clear();
    setMsg("Standalone customer form cleared.", true);
  }

  async function loadCountries() {
    const { data, error } = await sb
      .from("countries")
      .select("code,name")
      .order("name", { ascending: true });

    if (error) {
      console.error("loadCountries error:", error);
      setMsg("Failed to load countries: " + error.message, false);
      return;
    }

    countriesData = data || [];
    pendingCountryPicker.render("");
    standaloneCountryPicker.render("");
  }

  async function searchCustomers(query) {

    const { data, error } = await sb
      .from("customers")
      .select("id,name,code")
      .ilike("name", `%${query}%`)
      .limit(8);

    if (error) {
      console.error(error);
      return [];
    }

    return data || [];
  }

  async function showCustomerSuggestions() {

    const q = newCustomerNameStandalone.value.trim();

    if (q.length < 2) {
      customerSuggestDropdown.innerHTML = "";
      customerSuggestDropdown.classList.remove("open");
      return;
    }

    const results = await searchCustomers(q);

    if (!results.length) {
      customerSuggestDropdown.innerHTML =
        `<div class="countryEmpty">No existing customers</div>`;
      customerSuggestDropdown.classList.add("open");
      return;
    }

    customerSuggestDropdown.innerHTML = results.map(c => `
    <div class="countryOption" data-id="${c.id}" data-name="${esc(c.name)}">
      <div class="countryCode">${esc(c.code)}</div>
      <div class="countryName">${esc(c.name)}</div>
    </div>
  `).join("");

    customerSuggestDropdown.classList.add("open");
  }

  async function createCustomerRecord({ name, countryCode, notes }) {

    const duplicate = await checkCustomerDuplicate(cleanName);

    if (duplicate) {
      throw new Error("A customer with this name already exists.");
    }
    const cleanName = String(name || "").trim();
    const cleanCountry = String(countryCode || "").trim();

    if (!cleanName) throw new Error("Customer name is required.");
    if (!cleanCountry) throw new Error("Country is required.");

    const code = makeCustomerCode(cleanName);

    const { data, error } = await sb
      .from("customers")
      .insert([{
        name: cleanName,
        code,
        country: cleanCountry,
        notes: String(notes || "").trim() || null
      }])
      .select("id")
      .single();

    if (error) throw new Error("Creating customer failed: " + error.message);
    return data.id;
  }

  async function resolvePendingCustomerId() {
    const selectedId = customersSelect.value;
    const newName = newCustomerNamePending.value.trim();
    const notes = customerNotesPending.value.trim();
    const countryCode = pendingCountryPicker.getSelectedCode();

    const usingExisting = !!selectedId;
    const usingNew = !!newName;

    if (usingExisting && usingNew) {
      throw new Error("Choose one option only: use existing customer OR create new customer.");
    }

    if (!usingExisting && !usingNew) {
      throw new Error("Choose one option: select an existing customer OR create a new customer.");
    }

    if (usingExisting) {
      return selectedId;
    }

    return await createCustomerRecord({
      name: newName,
      countryCode,
      notes
    });
  }

  // 0) Auth gate
  const session = await requireAuth("login.html", { reveal: false });
  if (!session) return;

  const myUserId = session.user.id;
  whoEl.textContent = `Logged in as ${session.user.email || myUserId}`;

  const { data: myProf, error: myProfErr } = await sb
    .from("profiles")
    .select("role,status")
    .eq("user_id", myUserId)
    .maybeSingle();

  if (myProfErr || !myProf || String(myProf.role) !== "admin" || String(myProf.status) !== "active") {
    try { sessionStorage.setItem("authError", "blocked"); } catch { }
    await sb.auth.signOut().catch(() => { });
    window.location.replace("login.html");
    return;
  }

  if (window.revealPage) window.revealPage();
  else document.documentElement.style.visibility = "visible";

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
      pendingDecisionPanel.classList.add("hidden");
      pendingTbody.innerHTML = `<tr><td colspan="5">No pending users 🎉</td></tr>`;
      return;
    }

    pendingDecisionPanel.classList.remove("hidden");

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

  async function approveUser(userId) {
    const customerId = await resolvePendingCustomerId();

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

  async function loadActiveUsers() {
    activeTbody.innerHTML = `<tr><td colspan="8">Loading…</td></tr>`;

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
      let va = a[sortKey];
      let vb = b[sortKey];

      if (sortKey === "approved_at") {
        va = new Date(va || 0);
        vb = new Date(vb || 0);
      } else {
        va = (va ?? "").toString().toLowerCase();
        vb = (vb ?? "").toString().toLowerCase();
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

    renderActive();

    updateSortIndicator();
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
    await loadCountries();
    await loadPending();
    await loadActiveUsers();
    setPendingModeUI();
    setMsg("", true);
  });

  $("btnLogout").addEventListener("click", async () => {
    await sb.auth.signOut().catch(() => { });
    window.location.replace("login.html");
  });

  $("btnClearPendingChoice").addEventListener("click", clearPendingChoice);
  $("btnClearStandaloneCustomer").addEventListener("click", clearStandaloneCreate);

  customersSelect.addEventListener("change", () => {
    if (customersSelect.value) {
      newCustomerNamePending.value = "";
      customerNotesPending.value = "";
      pendingCountryPicker.clear();
    }
    setPendingModeUI();
  });

  newCustomerNamePending.addEventListener("input", () => {
    if (newCustomerNamePending.value.trim()) {
      customersSelect.value = "";
    } else {
      customerNotesPending.value = "";
      pendingCountryPicker.clear();
    }
    setPendingModeUI();
  });

  $("btnCreateStandaloneCustomer").addEventListener("click", async () => {
    try {
      setCreateCustomerMsg("Creating customer…", true);

      await createCustomerRecord({
        name: newCustomerNameStandalone.value.trim(),
        countryCode: standaloneCountryPicker.getSelectedCode(),
        notes: customerNotesStandalone.value.trim()
      });

      await loadCustomers();
      await loadActiveUsers();
      clearStandaloneCreate();
      setCreateCustomerMsg("Customer created.", true);
    } catch (err) {
      console.error(err);
      setCreateCustomerMsg(String(err?.message || err), false);
    }
  });

  newCustomerNameStandalone.addEventListener("input", showCustomerSuggestions);

  customersSelect.addEventListener("input", async () => {

    const q = customersSelect.value.trim();

    if (q.length < 2) {
      customerSuggestDropdownPending.innerHTML = "";
      customerSuggestDropdownPending.classList.remove("open");
      return;
    }

    const results = await searchCustomers(q);

    customerSuggestDropdownPending.innerHTML = results.map(c => `
    <div class="countryOption" data-name="${esc(c.name)}">
      <div class="countryCode">${esc(c.code)}</div>
      <div class="countryName">${esc(c.name)}</div>
    </div>
  `).join("");

    customerSuggestDropdownPending.classList.add("open");

  });

  newCustomerNameStandalone.addEventListener("blur", async () => {

    const name = newCustomerNameStandalone.value.trim();

    if (!name) return;
    if (name.length < 3) return;

    const duplicate = await checkCustomerDuplicate(name);

    if (duplicate) {
      setCreateCustomerMsg(
        "Warning: a customer with this name already exists.",
        false
      );
    }

  });


  customerSuggestDropdown.addEventListener("mousedown", (e) => {

    const opt = e.target.closest(".countryOption");
    if (!opt) return;

    const name = opt.getAttribute("data-name");

    newCustomerNameStandalone.value = name;

    customerSuggestDropdown.classList.remove("open");

    setCreateCustomerMsg(
      "Existing customer selected from suggestions.",
      true
    );

  });

  customerSuggestDropdownPending.addEventListener("mousedown", (e) => {

    const opt = e.target.closest(".countryOption");
    if (!opt) return;

    const name = opt.getAttribute("data-name");

    customersSelect.value = name;

    customerSuggestDropdownPending.classList.remove("open");

  });


  document.addEventListener("click", (e) => {

    if (
      e.target !== newCustomerNameStandalone &&
      !customerSuggestDropdown.contains(e.target)
    ) {
      customerSuggestDropdown.classList.remove("open");
    }

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
      clearPendingChoice();
    } catch (err) {
      console.error(err);
      setMsg(String(err?.message || err), false);
    }
  });

  document.querySelectorAll(".th-sort").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (!key) return;
      if (sortKey === key) sortDir = (sortDir === "asc") ? "desc" : "asc";
      else { sortKey = key; sortDir = "asc"; }
      sortAndRenderActive();
    });
  });

  $("activeSortSelect").addEventListener("change", (e) => {
    sortKey = e.target.value;

    if (sortKey === "approved_at") {
      sortDir = "desc";
    } else {
      sortDir = "asc";
    }

    sortAndRenderActive();
  });

  // Initial load
  pendingCountryPicker.setEnabled(false);
  customerNotesPending.disabled = true;

  await loadCustomers();
  await loadCountries();
  await loadPending();
  await loadActiveUsers();
  setPendingModeUI();

  updateSortIndicator();
})();