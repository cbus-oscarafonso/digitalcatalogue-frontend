(async function () {
  const sb = window.sb;
  const requireAuth = window.requireAuth;
  const $ = (id) => document.getElementById(id);

  function on(elOrId, eventName, handler) {
    const el = typeof elOrId === "string" ? $(elOrId) : elOrId;
    if (!el) {
      console.warn(`[admin-approval] Missing element for event binding: ${typeof elOrId === "string" ? "#" + elOrId : "(element ref)"}`);
      return null;
    }
    el.addEventListener(eventName, handler);
    return el;
  }

  const sortIndicator = $("sortIndicator");
  const whoEl = $("whoami");

  // toast() / toast.error() / toast.success() provided globally by toast.js.

  // ── User-exists modal ─────────────────────────────────────────────────────

  const ROLE_LABELS = {
    admin:           "Administrator",
    client_manager:  "Client Manager",
    catalog_manager: "Catalog Manager",
    internal:        "Internal User",
    customer:        "Customer",
  };

  function showUserExistsModal({ status, role, customer }) {
    const roleLabel = ROLE_LABELS[role] || role || "unknown role";
    let msg = `A user with this email already exists in the system with status <strong>${status}</strong> and role <strong>${roleLabel}</strong>`;
    if (role === "customer" && customer) {
      msg += ` (customer: <strong>${_esc(customer)}</strong>)`;
    }
    msg += ".<br><br>You cannot send a new invite to an existing user.";
    $("userExistsMessage").innerHTML = msg;
    $("userExistsModal").hidden = false;
  }

  function _esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  on("btnUserExistsDismiss", "click", () => { $("userExistsModal").hidden = true; });
  on("userExistsBackdrop",   "click", () => { $("userExistsModal").hidden = true; });

  // ── Element references ────────────────────────────────────────────────────

  const pendingDecisionPanel  = $("pendingDecisionPanel");
  const existingChoiceCard    = $("existingChoiceCard");
  const newChoiceCard         = $("newChoiceCard");

  const customersSelect               = $("customersSelect");
  const customerSuggestDropdownPending = $("customerSuggestDropdownPending");
  const newCustomerNamePending        = $("newCustomerNamePending");
  const customerNotesPending          = $("customerNotesPending");
  const countrySearchPending          = $("countrySearchPending");
  const countryDropdownPending        = $("countryDropdownPending");

  const newCustomerNameStandalone  = $("newCustomerNameStandalone");
  const customerNotesStandalone    = $("customerNotesStandalone");
  const countrySearchStandalone    = $("countrySearchStandalone");
  const countryDropdownStandalone  = $("countryDropdownStandalone");

  const pendingTbody         = $("pendingTbody");
  const pendingInternalTbody = $("pendingInternalTbody");
  const activeTbody          = $("activeTbody");

  const existingCustomerSearchStandalone   = $("existingCustomerSearchStandalone");
  const existingCustomerDropdownStandalone = $("existingCustomerDropdownStandalone");
  const existingCustomerDetailsStandalone  = $("existingCustomerDetailsStandalone");
  const existingCustomerCodeStandalone     = $("existingCustomerCodeStandalone");
  const existingCustomerNameStandalone     = $("existingCustomerNameStandalone");
  const existingCustomerCountryStandalone  = $("existingCustomerCountryStandalone");
  const existingCustomerNotesStandalone    = $("existingCustomerNotesStandalone");
  const btnEditExistingCustomerNotes       = $("btnEditExistingCustomerNotes");
  const btnCancelExistingCustomerNotes     = $("btnCancelExistingCustomerNotes");

  // Invite panel elements
  const inviteRoleCheck       = $("inviteRoleCheck");
  const inviteRoleSelect      = $("inviteRoleSelect");
  const inviteCustomerSection = $("inviteCustomerSection");
  const inviteExistingCard    = $("inviteExistingChoiceCard");
  const inviteNewCard         = $("inviteNewChoiceCard");
  const inviteCustomersSelect = $("inviteCustomersSelect");
  const inviteCustomerDropdown = $("inviteCustomerDropdown");
  const inviteNewCustomerName = $("inviteNewCustomerName");
  const inviteCustomerNotes   = $("inviteCustomerNotes");
  const inviteCountrySearch   = $("inviteCountrySearch");
  const inviteCountryDropdown = $("inviteCountryDropdown");

  // Internal roles config
  const INTERNAL_ROLES = [
    { value: "internal",        label: "General" },
    { value: "client_manager",  label: "Client Manager" },
    { value: "catalog_manager", label: "Catalog Manager" }
  ];

  let activeUsersData = [];
  let sortKey = "approved_at";
  let sortDir = "desc";

  let countriesData = [];
  let customersData = [];

  // ── Helpers ──────────────────────────────────────────────────────────────

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
      approved_at:    "Date of approval",
      display_name:   "User",
      role:           "Role",
      customer_label: "Customer"
    };
    const arrow = sortDir === "asc" ? "↑" : "↓";
    if (sortIndicator) {
      sortIndicator.textContent = `Sorted by: ${labelMap[sortKey]} ${arrow}`;
    }
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

  function normalizeName(s) {
    return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function roleLabelForValue(value) {
    const found = INTERNAL_ROLES.find(r => r.value === value);
    return found ? found.label : (value || "");
  }

  // ── Country picker factory ───────────────────────────────────────────────

  function createCountryPicker(inputEl, dropdownEl) {
    let selectedCode = "";
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
        dropdownEl.innerHTML = `<div class="pickerEmpty">No countries found.</div>`;
        activeIndex = -1;
        return;
      }

      dropdownEl.innerHTML = filteredCountries.map((c, idx) => `
        <div class="pickerOption ${idx === activeIndex ? "active" : ""}" data-idx="${idx}">
          <div class="pickerCode">${esc(c.code)}</div>
          <div class="pickerName">${esc(c.name)}</div>
        </div>
      `).join("");
    }

    function open() { if (!enabled) return; dropdownEl.classList.add("open"); }
    function close() { dropdownEl.classList.remove("open"); activeIndex = -1; }

    function clear() {
      selectedCode = "";
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

    function getSelectedCode() { return selectedCode; }

    function selectCountry(country) {
      selectedCode = country.code;
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
      const activeEl = dropdownEl.querySelector(`.pickerOption[data-idx="${activeIndex}"]`);
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    }

    on(inputEl, "focus", () => { if (!enabled) return; render(inputEl.value); open(); });
    on(inputEl, "click", () => { if (!enabled) return; render(inputEl.value); open(); });
    on(inputEl, "input", () => {
      if (!enabled) return;
      selectedCode = "";
      activeIndex = -1;
      render(inputEl.value);
      open();
    });

    on(inputEl, "keydown", (e) => {
      if (!enabled) return;
      if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); moveSelection(-1); return; }
      if (e.key === "Enter") {
        if (!dropdownEl.classList.contains("open")) return;
        e.preventDefault();
        if (activeIndex >= 0 && filteredCountries[activeIndex]) selectCountry(filteredCountries[activeIndex]);
        else if (filteredCountries.length === 1) selectCountry(filteredCountries[0]);
        return;
      }
      if (e.key === "Escape") close();
    });

    on(dropdownEl, "mousedown", (e) => {
      const opt = e.target.closest(".pickerOption");
      if (!opt) return;
      const idx = Number(opt.getAttribute("data-idx"));
      if (!Number.isNaN(idx) && filteredCountries[idx]) selectCountry(filteredCountries[idx]);
    });

    document.addEventListener("click", (e) => {
      if (e.target !== inputEl && !dropdownEl.contains(e.target)) close();
    });

    return { render, clear, setEnabled, getSelectedCode };
  }

  // ── Customer autocomplete factory ────────────────────────────────────────

  function createCustomerAutocomplete(inputEl, dropdownEl, onPicked) {
    let selectedId = "";
    let filteredCustomers = [];
    let activeIndex = -1;
    let enabled = true;

    function render(query = "") {
      const q = normalizeName(query);
      filteredCustomers = customersData.filter(c => {
        const name = normalizeName(c.name);
        const code = String(c.code || "").toLowerCase();
        return !q || name.includes(q) || code.includes(q);
      });

      if (!filteredCustomers.length) {
        dropdownEl.innerHTML = `<div class="pickerEmpty">No existing customers</div>`;
        activeIndex = -1;
        return;
      }

      dropdownEl.innerHTML = filteredCustomers.map((c, idx) => `
        <div class="pickerOption ${idx === activeIndex ? "active" : ""}" data-idx="${idx}">
          <div class="pickerCode">${esc(c.code)}</div>
          <div class="pickerName">${esc(c.name)}</div>
        </div>
      `).join("");
    }

    function open() { if (!enabled) return; dropdownEl.classList.add("open"); }
    function close() { dropdownEl.classList.remove("open"); activeIndex = -1; }

    function clear() {
      selectedId = "";
      inputEl.value = "";
      activeIndex = -1;
      render("");
      close();
      if (onPicked) onPicked(null);
    }

    function getSelectedId() { return selectedId; }

    function setEnabled(v) {
      enabled = !!v;
      inputEl.disabled = !enabled;
      if (!enabled) clear();
    }

    function selectCustomer(customer) {
      selectedId = customer.id;
      inputEl.value = customer.name;
      close();
      if (onPicked) onPicked(customer);
    }

    function moveSelection(dir) {
      if (!filteredCustomers.length) return;
      if (!dropdownEl.classList.contains("open")) open();
      activeIndex += dir;
      if (activeIndex < 0) activeIndex = filteredCustomers.length - 1;
      if (activeIndex >= filteredCustomers.length) activeIndex = 0;
      render(inputEl.value);
      const activeEl = dropdownEl.querySelector(`.pickerOption[data-idx="${activeIndex}"]`);
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    }

    on(inputEl, "focus", () => { if (!enabled) return; render(inputEl.value); open(); });
    on(inputEl, "click", () => { if (!enabled) return; render(inputEl.value); open(); });
    on(inputEl, "input", () => {
      if (!enabled) return;
      selectedId = "";
      render(inputEl.value);
      open();
      if (onPicked) onPicked(null);
    });

    on(inputEl, "keydown", (e) => {
      if (!enabled) return;
      if (e.key === "ArrowDown") { e.preventDefault(); moveSelection(1); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); moveSelection(-1); return; }
      if (e.key === "Enter") {
        if (!dropdownEl.classList.contains("open")) return;
        e.preventDefault();
        if (activeIndex >= 0 && filteredCustomers[activeIndex]) selectCustomer(filteredCustomers[activeIndex]);
        else if (filteredCustomers.length === 1) selectCustomer(filteredCustomers[0]);
        return;
      }
      if (e.key === "Escape") close();
    });

    on(dropdownEl, "mousedown", (e) => {
      const opt = e.target.closest(".pickerOption");
      if (!opt) return;
      const idx = Number(opt.getAttribute("data-idx"));
      if (!Number.isNaN(idx) && filteredCustomers[idx]) selectCustomer(filteredCustomers[idx]);
    });

    document.addEventListener("click", (e) => {
      if (e.target !== inputEl && !dropdownEl.contains(e.target)) close();
    });

    return { render, clear, setEnabled, getSelectedId };
  }

  // ── Pickers init ─────────────────────────────────────────────────────────

  const pendingCountryPicker    = createCountryPicker(countrySearchPending,  countryDropdownPending);
  const standaloneCountryPicker = createCountryPicker(countrySearchStandalone, countryDropdownStandalone);
  const inviteCountryPicker     = createCountryPicker(inviteCountrySearch,   inviteCountryDropdown);

  const pendingExistingCustomerPicker = createCustomerAutocomplete(
    customersSelect,
    customerSuggestDropdownPending,
    (customer) => {
      if (customer) {
        newCustomerNamePending.value = "";
        customerNotesPending.value   = "";
        pendingCountryPicker.clear();
      }
      setPendingModeUI();
    }
  );

  let selectedExistingStandaloneCustomer = null;
  let existingStandaloneNotesEditMode    = false;
  let existingStandaloneOriginalNotes    = "";

  const existingStandaloneCustomerPicker = createCustomerAutocomplete(
    existingCustomerSearchStandalone,
    existingCustomerDropdownStandalone,
    (customer) => {
      selectedExistingStandaloneCustomer = customer || null;
      existingStandaloneNotesEditMode    = false;

      if (!customer) {
        existingCustomerDetailsStandalone.classList.add("hidden");
        existingCustomerCodeStandalone.value    = "";
        existingCustomerNameStandalone.value    = "";
        existingCustomerCountryStandalone.value = "";
        existingCustomerNotesStandalone.value   = "";
        existingCustomerNotesStandalone.disabled = true;
        btnEditExistingCustomerNotes.textContent = "Edit notes";
        btnCancelExistingCustomerNotes.classList.add("hidden");
        return;
      }

      fillExistingStandaloneCustomerDetails(customer);
    }
  );

  // Invite customer picker — selection drives the "existing" card mode
  let inviteSelectedCustomer = null; // { id, name, code }

  const inviteExistingCustomerPicker = createCustomerAutocomplete(
    inviteCustomersSelect,
    inviteCustomerDropdown,
    (customer) => {
      inviteSelectedCustomer = customer || null;
      setInviteCustomerModeUI();
    }
  );

  // ── Pending client users UI mode ─────────────────────────────────────────

  function setPendingModeUI() {
    const existingSelected = !!pendingExistingCustomerPicker.getSelectedId() || !!customersSelect.value.trim();
    const newName = newCustomerNamePending.value.trim();
    const newMode = !!newName;

    if (existingSelected) {
      newChoiceCard.classList.add("is-disabled");
      newCustomerNamePending.disabled = true;
      customerNotesPending.disabled   = true;
      pendingCountryPicker.setEnabled(false);
    } else {
      newChoiceCard.classList.remove("is-disabled");
      newCustomerNamePending.disabled = false;
      customerNotesPending.disabled   = !newMode;
      pendingCountryPicker.setEnabled(newMode);
    }

    if (newMode) {
      existingChoiceCard.classList.add("is-disabled");
      pendingExistingCustomerPicker.setEnabled(false);
    } else {
      existingChoiceCard.classList.remove("is-disabled");
      pendingExistingCustomerPicker.setEnabled(true);
    }
  }

  function clearPendingChoice() {
    pendingExistingCustomerPicker.clear();
    newCustomerNamePending.value = "";
    customerNotesPending.value   = "";
    pendingCountryPicker.clear();
    setPendingModeUI();
    toast.success("Pending approval choice cleared.");
  }

  // ── Invite panel UI mode ──────────────────────────────────────────────────

  function setInviteCustomerModeUI() {
    const existingSelected = !!inviteSelectedCustomer;
    const newName = inviteNewCustomerName.value.trim();
    const newMode = !!newName;

    if (existingSelected) {
      inviteNewCard.classList.add("is-disabled");
      inviteNewCustomerName.disabled = true;
      inviteCustomerNotes.disabled   = true;
      inviteCountryPicker.setEnabled(false);
    } else {
      inviteNewCard.classList.remove("is-disabled");
      inviteNewCustomerName.disabled = false;
      inviteCustomerNotes.disabled   = !newMode;
      inviteCountryPicker.setEnabled(newMode);
    }

    if (newMode) {
      inviteExistingCard.classList.add("is-disabled");
      inviteExistingCustomerPicker.setEnabled(false);
    } else {
      inviteExistingCard.classList.remove("is-disabled");
      inviteExistingCustomerPicker.setEnabled(true);
    }
  }

  function clearInviteCustomer() {
    inviteExistingCustomerPicker.clear();
    inviteSelectedCustomer         = null;
    inviteNewCustomerName.value    = "";
    inviteCustomerNotes.value      = "";
    inviteCountryPicker.clear();
    setInviteCustomerModeUI();
  }

  function clearInvite() {
    $("inviteEmail").value = "";
    inviteRoleCheck.checked = false;
    inviteRoleSelect.value    = "";
    inviteRoleSelect.disabled = true;
    inviteCustomerSection.classList.add("hidden");
    clearInviteCustomer();
  }

  // ── Standalone customer (Customers panel) ────────────────────────────────

  function clearStandaloneCreate() {
    newCustomerNameStandalone.value = "";
    customerNotesStandalone.value   = "";
    standaloneCountryPicker.clear();

    existingStandaloneCustomerPicker.clear();
    selectedExistingStandaloneCustomer = null;
    existingStandaloneOriginalNotes    = "";
    existingCustomerDetailsStandalone.classList.add("hidden");
    existingCustomerCodeStandalone.value    = "";
    existingCustomerNameStandalone.value    = "";
    existingCustomerCountryStandalone.value = "";
    existingCustomerNotesStandalone.value   = "";
    existingCustomerNotesStandalone.disabled = true;
    btnEditExistingCustomerNotes.textContent = "Edit notes";
    btnCancelExistingCustomerNotes.classList.add("hidden");

    toast.success("Standalone customer form cleared.");
  }

  // ── Data loaders ─────────────────────────────────────────────────────────

  async function loadCountries() {
    const { data, error } = await sb
      .from("countries")
      .select("code,name")
      .order("name", { ascending: true });

    if (error) {
      console.error("loadCountries error:", error);
      toast.error("Failed to load countries: " + error.message);
      return;
    }
    countriesData = data || [];
    pendingCountryPicker.render("");
    standaloneCountryPicker.render("");
    inviteCountryPicker.render("");
  }

  async function loadCustomers() {
    const { data, error } = await sb
      .from("customers")
      .select("id,name,code")
      .order("name", { ascending: true });

    if (error) {
      console.error("loadCustomers error:", error);
      toast.error("Failed to load customers: " + error.message);
      return;
    }
    customersData = data || [];
    pendingExistingCustomerPicker.render("");
    existingStandaloneCustomerPicker.render("");
    inviteExistingCustomerPicker.render("");
  }

  function checkCustomerDuplicate(name) {
    const needle = normalizeName(name);
    return customersData.some(c => normalizeName(c.name) === needle);
  }

  async function fetchCustomerFull(customerId) {
    const { data, error } = await sb
      .from("customers")
      .select("id,name,code,country,notes")
      .eq("id", customerId)
      .single();

    if (error) throw new Error("Failed to load customer details: " + error.message);
    return data;
  }

  // ── loadPending – client users only (role = 'customer') ──────────────────

  async function loadPending() {
    pendingTbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;

    const { data, error } = await sb
      .from("profiles")
      .select("user_id, role, requested_customer_name, requested_email, requested_full_name, created_at")
      .eq("status", "pending")
      .eq("role", "customer")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadPending error:", error);
      pendingTbody.innerHTML = `<tr><td colspan="5">Failed to load pending users: ${esc(error.message)}</td></tr>`;
      toast.error("Failed to load pending users: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      pendingDecisionPanel.classList.add("hidden");
      pendingTbody.innerHTML = `<tr><td colspan="5">No pending client users 🎉</td></tr>`;
      return;
    }

    pendingDecisionPanel.classList.remove("hidden");

    pendingTbody.innerHTML = data.map((p) => {
      const created = p.created_at ? formatDate(p.created_at) : "";
      const display = makeDisplayName(p.requested_full_name);
      const email   = p.requested_email || "";

      return `
        <tr data-user-id="${esc(p.user_id)}" data-panel="client">
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
              <button class="btn primary" data-action="approve">Approve</button>
              <button class="btn btn-danger" data-action="reject">Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ── loadPendingInternal – internal roles only ────────────────────────────

  const INTERNAL_ROLE_VALUES = INTERNAL_ROLES.map(r => r.value);

  async function loadPendingInternal() {
    pendingInternalTbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;

    const { data, error } = await sb
      .from("profiles")
      .select("user_id, role, requested_email, requested_full_name, created_at")
      .eq("status", "pending")
      .in("role", INTERNAL_ROLE_VALUES)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadPendingInternal error:", error);
      pendingInternalTbody.innerHTML = `<tr><td colspan="5">Failed to load pending internal users: ${esc(error.message)}</td></tr>`;
      toast.error("Failed to load pending internal users: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      pendingInternalTbody.innerHTML = `<tr><td colspan="5">No pending internal users 🎉</td></tr>`;
      return;
    }

    pendingInternalTbody.innerHTML = data.map((p) => {
      const created     = p.created_at ? formatDate(p.created_at) : "";
      const display     = makeDisplayName(p.requested_full_name);
      const email       = p.requested_email || "";
      const currentRole = p.role || "internal";

      const roleOptions = INTERNAL_ROLES.map(r =>
        `<option value="${esc(r.value)}" ${r.value === currentRole ? "selected" : ""}>${esc(r.label)}</option>`
      ).join("");

      return `
        <tr data-user-id="${esc(p.user_id)}" data-panel="internal">
          <td><span class="pill">pending</span></td>
          <td>
            <strong>${esc(display || "(no name)")}</strong><br>
            <span class="small">${esc(email || "(no email)")}</span><br>
            <span class="mono small">${esc(p.user_id)}</span>
          </td>
          <td>
            <select class="roleSelectInline" data-user-id="${esc(p.user_id)}">
              ${roleOptions}
            </select>
          </td>
          <td class="small">${esc(created)}</td>
          <td>
            <div class="actions">
              <button class="btn primary" data-action="approve">Approve</button>
              <button class="btn btn-danger" data-action="reject">Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ── Approve / reject ─────────────────────────────────────────────────────

  async function createCustomerRecord({ name, countryCode, notes }) {
    const cleanName    = String(name || "").trim().replace(/\s+/g, " ");
    const cleanCountry = String(countryCode || "").trim();

    if (!cleanName)    throw new Error("Customer name is required.");
    if (!cleanCountry) throw new Error("Country is required.");
    if (checkCustomerDuplicate(cleanName)) throw new Error("A customer with this name already exists.");

    const code = makeCustomerCode(cleanName);
    const { data, error } = await sb
      .from("customers")
      .insert([{ name: cleanName, code, country: cleanCountry, notes: String(notes || "").trim() || null }])
      .select("id")
      .single();

    if (error) throw new Error("Creating customer failed: " + error.message);
    return data.id;
  }

  async function resolvePendingCustomerId() {
    const selectedId = pendingExistingCustomerPicker.getSelectedId();
    const newName    = newCustomerNamePending.value.trim();
    const notes      = customerNotesPending.value.trim();
    const countryCode = pendingCountryPicker.getSelectedCode();

    const usingExisting = !!selectedId;
    const usingNew      = !!newName;

    if (usingExisting && usingNew) throw new Error("Choose one option only: use existing customer OR create new customer.");
    if (!usingExisting && !usingNew) throw new Error("Choose one option: select an existing customer OR create a new customer.");
    if (usingExisting) return selectedId;

    return await createCustomerRecord({ name: newName, countryCode, notes });
  }

  async function approveClientUser(userId) {
    const customerId = await resolvePendingCustomerId();

    const { error } = await sb
      .from("profiles")
      .update({
        status:      "active",
        customer_id: customerId,
        approved_at: new Date().toISOString(),
        approved_by: myUserId
      })
      .eq("user_id", userId)
      .eq("status", "pending");

    if (error) throw new Error("Approving user failed: " + error.message);
  }

  async function approveInternalUser(userId, role) {
    const { error } = await sb
      .from("profiles")
      .update({
        status:      "active",
        role:        role,
        approved_at: new Date().toISOString(),
        approved_by: myUserId
      })
      .eq("user_id", userId)
      .eq("status", "pending");

    if (error) throw new Error("Approving internal user failed: " + error.message);
  }

  async function rejectUser(userId) {
    const { error } = await sb
      .from("profiles")
      .update({
        status:      "rejected",
        approved_at: new Date().toISOString(),
        approved_by: myUserId
      })
      .eq("user_id", userId)
      .eq("status", "pending");

    if (error) throw new Error("Reject failed: " + error.message);
  }

  // ── Active users ─────────────────────────────────────────────────────────

  async function loadActiveUsers() {
    activeTbody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;

    const sel =
      "user_id,role,requested_full_name,requested_email,customer_id,approved_at,approved_by,created_at," +
      "customer:customers!profiles_customer_id_fkey(id,name,code)";

    const { data, error } = await sb
      .from("profiles")
      .select(sel)
      .eq("status", "active");

    if (error) {
      console.error("loadActiveUsers error:", error);
      activeTbody.innerHTML = `<tr><td colspan="7">Error loading active users: ${esc(error.message)}</td></tr>`;
      return;
    }

    const rows = data || [];
    const approverIds = [...new Set(rows.map(u => u.approved_by).filter(Boolean))];
    let approverNameMap = {};

    if (approverIds.length) {
      const { data: approvers, error: approversError } = await sb
        .from("profiles")
        .select("user_id,requested_full_name")
        .in("user_id", approverIds);

      if (!approversError) {
        approverNameMap = Object.fromEntries(
          (approvers || []).map(a => [a.user_id, makeDisplayName(a.requested_full_name || "")])
        );
      }
    }

    activeUsersData = rows.map((u) => {
      const display = makeDisplayName(u.requested_full_name);
      const c = u.customer;
      const customerLabel = c ? `${c.name} (${c.code})` : (u.customer_id ? String(u.customer_id) : "");
      const approverName  = approverNameMap[u.approved_by] || "";

      return {
        user_id:       u.user_id,
        display_name:  display,
        email:         u.requested_email,
        role:          u.role,
        customer_label: customerLabel,
        created_at:    u.created_at,
        approved_at:   u.approved_at,
        approver_name: approverName
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
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
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
      activeTbody.innerHTML = `<tr><td colspan="7">No active users.</td></tr>`;
      return;
    }

    activeTbody.innerHTML = activeUsersData.map((u) => `
      <tr>
        <td><strong>${esc(u.display_name)}</strong></td>
        <td>${esc(u.email)}</td>
        <td>${esc(u.role)}</td>
        <td>${esc(u.customer_label)}</td>
        <td class="small">${esc(formatDate(u.created_at))}</td>
        <td class="small">
          ${esc(formatDate(u.approved_at))}
          ${u.approver_name ? `<div class="small">${esc(u.approver_name)}</div>` : ""}
        </td>
        <td class="mono small">${esc(u.user_id)}</td>
      </tr>
    `).join("");
  }

  // ── Existing customer notes helpers ──────────────────────────────────────

  function setExistingStandaloneNotesEditMode(editing) {
    existingStandaloneNotesEditMode = !!editing;
    existingCustomerNotesStandalone.disabled = !editing;
    btnEditExistingCustomerNotes.textContent = editing ? "Save notes" : "Edit notes";
    btnCancelExistingCustomerNotes.classList.toggle("hidden", !editing);
  }

  async function fillExistingStandaloneCustomerDetails(customer) {
    const full = await fetchCustomerFull(customer.id);
    selectedExistingStandaloneCustomer = full;
    existingStandaloneOriginalNotes    = full.notes || "";
    existingCustomerCodeStandalone.value    = full.code    || "";
    existingCustomerNameStandalone.value    = full.name    || "";
    existingCustomerCountryStandalone.value = full.country || "";
    existingCustomerNotesStandalone.value   = full.notes   || "";
    existingCustomerDetailsStandalone.classList.remove("hidden");
    setExistingStandaloneNotesEditMode(false);
  }

  async function saveExistingStandaloneCustomerNotes() {
    if (!selectedExistingStandaloneCustomer?.id) throw new Error("No existing customer selected.");
    const newNotes = existingCustomerNotesStandalone.value.trim();

    const { error } = await sb
      .from("customers")
      .update({ notes: newNotes || null })
      .eq("id", selectedExistingStandaloneCustomer.id);

    if (error) throw new Error("Failed to save notes: " + error.message);

    existingStandaloneOriginalNotes = newNotes;
    selectedExistingStandaloneCustomer.notes = newNotes;
    await loadCustomers();
    setExistingStandaloneNotesEditMode(false);
    toast.success("Customer notes saved.");
  }

  function cancelExistingStandaloneCustomerNotesEdit() {
    existingCustomerNotesStandalone.value = existingStandaloneOriginalNotes || "";
    setExistingStandaloneNotesEditMode(false);
  }

  // ── Invite: send ─────────────────────────────────────────────────────────

  async function sendInvite() {
    const email       = ($("inviteEmail").value || "").trim();
    const roleChecked = inviteRoleCheck.checked;
    const role        = roleChecked ? inviteRoleSelect.value : null;

    if (!email) throw new Error("Please enter an email address.");
    if (roleChecked && !role) throw new Error("Please select a role.");

    let customerId   = null;
    let customerName = null;

    if (role === "customer") {
      const selectedId = inviteExistingCustomerPicker.getSelectedId();
      const newName    = inviteNewCustomerName.value.trim();

      if (!selectedId && !newName) {
        throw new Error("Please select an existing customer or create a new one for this user.");
      }

      if (selectedId) {
        // Existing customer
        customerId   = selectedId;
        const cust   = customersData.find(c => c.id === selectedId);
        customerName = cust ? cust.name : "";
      } else {
        // Create new customer first, then invite
        toast.success("Creating customer…");
        customerId   = await createCustomerRecord({
          name:        newName,
          countryCode: inviteCountryPicker.getSelectedCode(),
          notes:       inviteCustomerNotes.value.trim()
        });
        customerName = newName;
        await loadCustomers();
      }
    }

    toast.success("Sending invitation…");

    const redirectTo = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}/accept-invite.html`;

    const { data, error } = await window.sb.functions.invoke("invite-user", {
      body: {
        email,
        role:          role || undefined,
        customer_id:   customerId   || undefined,
        customer_name: customerName || undefined,
        redirect_to:   redirectTo,
      }
    });

    if (error) {
      // FunctionsHttpError — try to get the body
      let msg = error.message || "Unknown error";
      try {
        const body = await error.context?.json?.();
        if (body?.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }

    if (data?.exists) {
      showUserExistsModal(data);
      return;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    toast.success(`Invitation sent to ${email}.`);
    clearInvite();

    // Refresh tables so any new pending row appears
    await loadPending();
    await loadPendingInternal();
    await loadActiveUsers();
  }

  // ── Auth guard ───────────────────────────────────────────────────────────

  const session = await requireAuth("login.html", { reveal: false });
  if (!session) return;

  const myUserId = session.user.id;
  if (whoEl) {
    whoEl.textContent = `Logged in as ${session.user.email || myUserId}`;
  }

  const { data: myProf, error: myProfErr } = await sb
    .from("profiles")
    .select("role, status, requested_full_name, customer_id")
    .eq("user_id", myUserId)
    .maybeSingle();

  if (myProfErr || !myProf || !["admin", "client_manager", "catalog_manager"].includes(myProf.role) || String(myProf.status) !== "active") {
    try { sessionStorage.setItem("authError", "blocked"); } catch { }
    await sb.auth.signOut().catch(() => { });
    window.location.replace("login.html");
    return;
  }

  if (window.revealPage) window.revealPage();
  else document.documentElement.style.visibility = "visible";

  if (typeof setupNavTabs === "function") setupNavTabs(myProf.role, "adminarea");
  window.renderUserBadge?.(session, myProf);

  if (myProf.role === "catalog_manager") {
    document.querySelectorAll(".adminPanel[data-panel-pending], .adminPanel[data-panel-active]")
      .forEach(el => el.style.display = "none");
    Array.from(inviteRoleSelect.options).forEach(opt => {
      if (opt.value && !["catalog_manager", "internal"].includes(opt.value)) opt.remove();
    });
  }

  // Show Admin option in invite role select only for admins
  if (myProf.role === "admin") {
    const adminOpt = document.createElement("option");
    adminOpt.value       = "admin";
    adminOpt.textContent = "Admin";
    // Insert as first option after the placeholder
    inviteRoleSelect.insertBefore(adminOpt, inviteRoleSelect.options[1]);
  }

  // ── Event listeners ──────────────────────────────────────────────────────

  on("btnRefresh", "click", async () => {
    toast.success("Refreshing…");
    await loadCustomers();
    await loadCountries();
    await loadPending();
    await loadPendingInternal();
    await loadActiveUsers();
    setPendingModeUI();
  });

  on("btnLogout", "click", async () => {
    await sb.auth.signOut().catch(() => { });
    window.location.replace("login.html");
  });

  on("btnClearPendingChoice", "click", clearPendingChoice);
  on("btnClearStandaloneCustomer", "click", clearStandaloneCreate);

  // Invite panel listeners
  on(inviteRoleCheck, "change", () => {
    const checked = inviteRoleCheck.checked;
    inviteRoleSelect.disabled = !checked;
    if (!checked) {
      inviteRoleSelect.value = "";
      inviteCustomerSection.classList.add("hidden");
      clearInviteCustomer();
    }
  });

  on(inviteRoleSelect, "change", () => {
    const role = inviteRoleSelect.value;
    if (role === "customer") {
      inviteCustomerSection.classList.remove("hidden");
    } else {
      inviteCustomerSection.classList.add("hidden");
      clearInviteCustomer();
    }
  });

  on(inviteNewCustomerName, "input", () => {
    if (inviteNewCustomerName.value.trim()) {
      inviteExistingCustomerPicker.clear();
      inviteSelectedCustomer = null;
    } else {
      inviteCustomerNotes.value = "";
      inviteCountryPicker.clear();
    }
    setInviteCustomerModeUI();
  });

  on(inviteNewCustomerName, "blur", () => {
    const name = inviteNewCustomerName.value.trim();
    if (name.length >= 3 && checkCustomerDuplicate(name)) {
      toast.error("Warning: a customer with this name already exists.");
    }
  });

  on("btnClearInviteCustomer", "click", () => {
    clearInviteCustomer();
    toast.success("Customer choice cleared.");
  });

  on("btnClearInvite", "click", () => {
    clearInvite();
    toast.success("Invite form cleared.");
  });

  on("btnSendInvite", "click", async () => {
    const btn = $("btnSendInvite");
    btn.disabled = true;
    try {
      await sendInvite();
    } catch (err) {
      console.error(err);
      toast.error(String(err?.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  on(newCustomerNamePending, "input", () => {
    if (newCustomerNamePending.value.trim()) {
      pendingExistingCustomerPicker.clear();
    } else {
      customerNotesPending.value = "";
      pendingCountryPicker.clear();
    }
    setPendingModeUI();
  });

  on("btnCreateStandaloneCustomer", "click", async () => {
    try {
      toast.success("Creating customer…");
      await createCustomerRecord({
        name:        newCustomerNameStandalone.value.trim(),
        countryCode: standaloneCountryPicker.getSelectedCode(),
        notes:       customerNotesStandalone.value.trim()
      });
      await loadCustomers();
      await loadActiveUsers();
      clearStandaloneCreate();
      toast.success("Customer created.");
    } catch (err) {
      console.error(err);
      toast.error(String(err?.message || err));
    }
  });

  on(btnEditExistingCustomerNotes, "click", async () => {
    try {
      if (!selectedExistingStandaloneCustomer?.id) {
        toast.error("Select an existing customer first.");
        return;
      }

      if (!existingStandaloneNotesEditMode) {
        existingStandaloneOriginalNotes = existingCustomerNotesStandalone.value || "";
        setExistingStandaloneNotesEditMode(true);
        toast.success("Editing notes…");
        existingCustomerNotesStandalone.focus();
        return;
      }

      toast.success("Saving notes…");
      await saveExistingStandaloneCustomerNotes();
    } catch (err) {
      console.error(err);
      toast.error(String(err?.message || err));
    }
  });

  on(btnCancelExistingCustomerNotes, "click", () => {
    cancelExistingStandaloneCustomerNotesEdit();
  });

  on(existingCustomerSearchStandalone, "input", () => {
    existingStandaloneCustomerPicker.render(existingCustomerSearchStandalone.value);
  });

  on(newCustomerNameStandalone, "input", () => {
    const name = newCustomerNameStandalone.value.trim();
    if (!name) return;
    if (checkCustomerDuplicate(name)) toast.error("Warning: a customer with this name already exists.");
  });

  on(newCustomerNameStandalone, "blur", async () => {
    const name = newCustomerNameStandalone.value.trim();
    if (!name || name.length < 3) return;
    if (checkCustomerDuplicate(name)) toast.error("Warning: a customer with this name already exists.");
  });

  // Click handler for pending client users table (delegated)
  on(pendingTbody, "click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const tr = btn.closest("tr[data-user-id]");
    if (!tr) return;

    const userId = tr.getAttribute("data-user-id");
    const action = btn.getAttribute("data-action");

    try {
      toast.success("Working…");

      if (action === "approve") {
        await approveClientUser(userId);
        toast.success("Approved.");
        await loadCustomers();
        await loadActiveUsers();
        clearPendingChoice();
      } else if (action === "reject") {
        await rejectUser(userId);
        toast.success("Rejected.");
      }

      await loadPending();
    } catch (err) {
      console.error(err);
      toast.error(String(err?.message || err));
    }
  });

  on(pendingInternalTbody, "click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const tr = btn.closest("tr[data-user-id]");
    if (!tr) return;

    const userId = tr.getAttribute("data-user-id");
    const action = btn.getAttribute("data-action");

    try {
      toast.success("Working…");

      if (action === "approve") {
        const roleSelect = tr.querySelector(`.roleSelectInline[data-user-id="${userId}"]`);
        const role = roleSelect ? roleSelect.value : "internal";
        await approveInternalUser(userId, role);
        toast.success("Approved.");
      } else if (action === "reject") {
        await rejectUser(userId);
        toast.success("Rejected.");
      }

      await loadPendingInternal();
      await loadActiveUsers();
    } catch (err) {
      console.error(err);
      toast.error(String(err?.message || err));
    }
  });

  document.querySelectorAll(".th-sort").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (!key) return;
      if (sortKey === key) sortDir = (sortDir === "asc") ? "desc" : "asc";
      else { sortKey = key; sortDir = (key === "approved_at") ? "desc" : "asc"; }
      sortAndRenderActive();
    });
  });

  on("activeSortSelect", "change", (e) => {
    sortKey = e.target.value;
    sortDir = (sortKey === "approved_at") ? "desc" : "asc";
    sortAndRenderActive();
  });


  // ── Vehicles (existing) ───────────────────────────────────────────────────

  async function loadVehicles() {
    const tbody = $("vehiclesTbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;
    const { data, error } = await sb
      .from("vehicles")
      .select("pep_code,model,production_year,vin,cobus_bus_no,motor_no,customer:customers!vehicles_customer_id_fkey(name)")
      .order("created_at", { ascending: false });
    if (error) { tbody.innerHTML = `<tr><td colspan="7">Error: ${esc(error.message)}</td></tr>`; return; }
    if (!data?.length) { tbody.innerHTML = `<tr><td colspan="7">No vehicles.</td></tr>`; return; }
    tbody.innerHTML = data.map(v => `<tr>
      <td class="mono">${esc(v.pep_code||"")}</td>
      <td>${esc(v.model||"")}</td>
      <td>${esc(v.production_year||"")}</td>
      <td class="mono small">${esc(v.vin||"")}</td>
      <td>${esc(v.cobus_bus_no||"")}</td>
      <td>${esc(v.motor_no||"")}</td>
      <td>${esc(v.customer?.name||"")}</td>
    </tr>`).join("");
  }

  // ── Vehicles input table ──────────────────────────────────────────────────

  const VEHICLE_FIELDS = ["pep_code","model","production_year","vin","cobus_bus_no","motor_no"];

  function customerSelectHtml(selectedId = "") {
    const opts = customersData.map(c =>
      `<option value="${esc(c.id)}" ${c.id === selectedId ? "selected" : ""}>${esc(c.name)}</option>`
    ).join("");
    return `<select class="vc-customer" style="width:100%;min-width:140px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:500 13px 'Rubik',sans-serif;">
      <option value="">— none —</option>${opts}
    </select>`;
  }

  function addVehicleInputRow(data = {}) {
    const tbody = $("vehiclesInputTbody");
    const tr = document.createElement("tr");
    tr.innerHTML = VEHICLE_FIELDS.map(f => `
      <td><input type="${f==="production_year"?"number":"text"}" class="vc-${f}"
        value="${esc(String(data[f]||""))}"
        placeholder="${f.replace(/_/g," ")}"
        style="width:100%;min-width:90px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:500 13px 'Rubik',sans-serif;" /></td>
    `).join("") +
    `<td>${customerSelectHtml(data.customer_id||"")}</td>
    <td><button type="button" class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="this.closest('tr').remove()">✕</button></td>`;
    tbody.appendChild(tr);
  }

  function clearVehicleInputTable() {
    $("vehiclesInputTbody").innerHTML = "";
    addVehicleInputRow();
  }

  function getVehicleInputRows() {
    return Array.from($("vehiclesInputTbody").querySelectorAll("tr")).map(tr => ({
      pep_code:        tr.querySelector(".vc-pep_code")?.value.trim() || null,
      model:           tr.querySelector(".vc-model")?.value.trim() || null,
      production_year: tr.querySelector(".vc-production_year")?.value ? Number(tr.querySelector(".vc-production_year").value) : null,
      vin:             tr.querySelector(".vc-vin")?.value.trim() || null,
      cobus_bus_no:    tr.querySelector(".vc-cobus_bus_no")?.value.trim() || null,
      motor_no:        tr.querySelector(".vc-motor_no")?.value.trim() || null,
      customer_id:     tr.querySelector(".vc-customer")?.value || null,
    }));
  }

  // ── CSV loader ────────────────────────────────────────────────────────────

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    // Skip Excel sep= directive line if present
    const dataLines = lines[0].startsWith("sep=") ? lines.slice(1) : lines;
    if (dataLines.length < 2) return [];
    const headers = dataLines[0].split(";").map(h => h.trim().toLowerCase().replace(/\s+/g,"_"));
    return dataLines.slice(1).map(line => {
      const vals = line.split(";").map(v => v.trim().replace(/^"|"$/g,""));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || "");
      return obj;
    });
  }

  on("btnLoadVehiclesCsv", "click", () => $("vehiclesCsvInput").click());

  $("vehiclesCsvInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { toast.error("No data found in CSV."); return; }

    $("vehiclesInputTbody").innerHTML = "";
    rows.forEach(r => addVehicleInputRow(r));

    // Check for rows without customer_id
    const missing = rows.filter(r => !r.customer_id || !customersData.find(c => c.id === r.customer_id));
    if (missing.length) openVehicleCustomerModal(missing.length);

    e.target.value = "";
  });

  // ── Customer assignment modal ─────────────────────────────────────────────

  function openVehicleCustomerModal(missingCount) {
    const tbody = $("vehicleCustomerModalTbody");
    const assignAllSel = $("vehicleCustomerAssignAll");

    // Populate assign-all dropdown
    assignAllSel.innerHTML = `<option value="">— select customer —</option>` +
      customersData.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");

    // Build rows for vehicles missing customer
    const inputRows = Array.from($("vehiclesInputTbody").querySelectorAll("tr"));
    const missingRows = inputRows.filter(tr => !tr.querySelector(".vc-customer")?.value);

    tbody.innerHTML = missingRows.map((tr, idx) => {
      const pep = tr.querySelector(".vc-pep_code")?.value || "";
      const vin = tr.querySelector(".vc-vin")?.value || "";
      const customerOpts = customersData.map(c =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
      return `<tr data-row-idx="${idx}">
        <td style="padding:8px;font-size:13px;">${esc(pep)||esc(vin)||"(no id)"}</td>
        <td style="padding:8px;">
          <select class="modal-vc-customer" style="width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:500 13px 'Rubik',sans-serif;">
            <option value="">— none —</option>${customerOpts}
          </select>
        </td>
      </tr>`;
    }).join("");

    // Store reference to actual input rows for confirm
    $("vehicleCustomerModal")._missingRows = missingRows;
    $("vehicleCustomerModal").hidden = false;
  }

  on("btnAssignAllCustomer", "click", () => {
    const val = $("vehicleCustomerAssignAll").value;
    if (!val) return;
    $("vehicleCustomerModalTbody").querySelectorAll(".modal-vc-customer")
      .forEach(sel => sel.value = val);
  });

  on("btnVehicleCustomerConfirm", "click", () => {
    const modal = $("vehicleCustomerModal");
    const missingRows = modal._missingRows || [];
    const modalSelects = $("vehicleCustomerModalTbody").querySelectorAll(".modal-vc-customer");
    missingRows.forEach((tr, idx) => {
      const sel = tr.querySelector(".vc-customer");
      if (sel && modalSelects[idx]) sel.value = modalSelects[idx].value;
    });
    modal.hidden = true;
  });

  on("btnVehicleCustomerCancel", "click", () => { $("vehicleCustomerModal").hidden = true; });
  on("vehicleCustomerBackdrop", "click", () => { $("vehicleCustomerModal").hidden = true; });

  // ── Confirm & insert ──────────────────────────────────────────────────────

  on("btnAddVehiclesToDb", "click", () => {
    const rows = getVehicleInputRows();
    const valid = rows.filter(r => r.pep_code || r.vin || r.model);
    if (!valid.length) { toast.error("No vehicles to add."); return; }
    $("vehicleConfirmMessage").textContent = `Add ${valid.length} new vehicle${valid.length > 1 ? "s" : ""} to the database?`;
    $("vehicleConfirmModal").hidden = false;
  });

  on("btnVehicleConfirmCancel", "click", () => { $("vehicleConfirmModal").hidden = true; });
  on("vehicleConfirmBackdrop",  "click", () => { $("vehicleConfirmModal").hidden = true; });

  on("btnVehicleConfirmYes", "click", async () => {
    $("vehicleConfirmModal").hidden = true;
    const rows = getVehicleInputRows().filter(r => r.pep_code || r.vin || r.model);
    const btn = $("btnAddVehiclesToDb");
    btn.disabled = true;
    try {
      const { error } = await sb.from("vehicles").insert(rows);
      if (error) throw new Error(error.message);
      toast.success(`${rows.length} vehicle${rows.length > 1 ? "s" : ""} added.`);
      clearVehicleInputTable();
      await loadVehicles();
    } catch (err) {
      toast.error(String(err?.message || err));
    } finally {
      btn.disabled = false;
    }
  });

  on("btnAddVehicleRow",  "click", () => addVehicleInputRow());
  on("btnClearVehicles",  "click", () => { clearVehicleInputTable(); toast.success("Cleared."); });

  // ── Init ─────────────────────────────────────────────────────────────────

  pendingCountryPicker.setEnabled(false);
  customerNotesPending.disabled = true;
  inviteCountryPicker.setEnabled(false);

  await loadCustomers();
  await loadCountries();
  await loadPending();
  await loadPendingInternal();
  await loadActiveUsers();
  await loadVehicles();
  clearVehicleInputTable();
  setPendingModeUI();
  setInviteCustomerModeUI();
  updateSortIndicator();
})();