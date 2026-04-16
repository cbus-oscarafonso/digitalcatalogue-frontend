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

  const whoEl = $("whoami");

  // toast() / toast.error() / toast.success() provided globally by toast.js.

  // ── User-exists modal ─────────────────────────────────────────────────────

  const ROLE_LABELS = {
    admin: "Administrator",
    client_manager: "Client Manager",
    catalog_manager: "Catalog Manager",
    internal: "Internal User",
    customer: "Customer",
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
  on("userExistsBackdrop", "click", () => { $("userExistsModal").hidden = true; });

  // ── Element references ────────────────────────────────────────────────────

  const pendingDecisionPanel = $("pendingDecisionPanel");
  const existingChoiceCard = $("existingChoiceCard");
  const newChoiceCard = $("newChoiceCard");

  const customersSelect = $("customersSelect");
  const customerSuggestDropdownPending = $("customerSuggestDropdownPending");
  const newCustomerNamePending = $("newCustomerNamePending");
  const customerNotesPending = $("customerNotesPending");
  const countrySearchPending = $("countrySearchPending");
  const countryDropdownPending = $("countryDropdownPending");

  const newCustomerNameStandalone = $("newCustomerNameStandalone");
  const customerNotesStandalone = $("customerNotesStandalone");
  const countrySearchStandalone = $("countrySearchStandalone");
  const countryDropdownStandalone = $("countryDropdownStandalone");

  const pendingTbody = $("pendingTbody");
  const pendingInternalTbody = $("pendingInternalTbody");
  const activeTbody = $("activeTbody");

  const existingCustomerSearchStandalone = null; // replaced by customers table
  const existingCustomerDropdownStandalone = null;
  const existingCustomerDetailsStandalone = null;
  const existingCustomerCodeStandalone = null;
  const existingCustomerNameStandalone = null;
  const existingCustomerCountryStandalone = null;
  const existingCustomerNotesStandalone = null;
  const btnEditExistingCustomerNotes = null;
  const btnCancelExistingCustomerNotes = null;

  // Invite panel elements
  const inviteRoleCheck = $("inviteRoleCheck");
  const inviteRoleSelect = $("inviteRoleSelect");
  const inviteCustomerSection = $("inviteCustomerSection");
  const inviteExistingCard = $("inviteExistingChoiceCard");
  const inviteNewCard = $("inviteNewChoiceCard");
  const inviteCustomersSelect = $("inviteCustomersSelect");
  const inviteCustomerDropdown = $("inviteCustomerDropdown");
  const inviteNewCustomerName = $("inviteNewCustomerName");
  const inviteCustomerNotes = $("inviteCustomerNotes");
  const inviteCountrySearch = $("inviteCountrySearch");
  const inviteCountryDropdown = $("inviteCountryDropdown");

  // Internal roles config
  const INTERNAL_ROLES = [
    { value: "internal", label: "General" },
    { value: "client_manager", label: "Client Manager" },
    { value: "catalog_manager", label: "Catalog Manager" }
  ];

  let activeUsersData = [];
  let sortKey = "approved_at";
  let sortDir = "desc";
  let vehiclesData = [];
  let vehiclesSortKey = "created_at";
  let vehiclesSortDir = "desc";
  let customersTableData = [];
  let customersSortKey = "name";
  let customersSortDir = "asc";

  // Change tracking: Map<id, {field -> {old, new, oldLabel?, newLabel?}}>
  const pendingChanges = {
    users: new Map(),
    vehicles: new Map(),
    customers: new Map(),
  };
  // Rows currently in edit mode
  const editingRows = {
    users: new Set(),
    vehicles: new Set(),
    customers: new Set(),
  };

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

  function getApprovablePendingRolesForApprover(approverRole) {
    if (approverRole === "admin") return ["customer", "internal", "client_manager", "catalog_manager"];
    if (approverRole === "client_manager") return ["customer", "internal", "client_manager"];
    if (approverRole === "catalog_manager") return ["internal", "catalog_manager"];
    return [];
  }

  function canApprovePendingRole(approverRole, pendingRole) {
    return getApprovablePendingRolesForApprover(approverRole).includes(pendingRole);
  }

  function getAssignableInternalRolesForApprover(approverRole) {
    if (approverRole === "admin") return INTERNAL_ROLES.map(r => r.value);
    if (approverRole === "client_manager") return ["internal", "client_manager"];
    if (approverRole === "catalog_manager") return ["internal", "catalog_manager"];
    return [];
  }

  function getInvitableRolesForApprover(approverRole) {
    if (approverRole === "admin") return ["admin", "client_manager", "catalog_manager", "internal", "customer"];
    if (approverRole === "client_manager") return ["client_manager", "internal", "customer"];
    if (approverRole === "catalog_manager") return ["catalog_manager", "internal"];
    return [];
  }

  function restrictInviteRoleOptionsForCurrentUser(approverRole) {
    const allowedRoles = getInvitableRolesForApprover(approverRole);
    Array.from(inviteRoleSelect.options).forEach(opt => {
      if (opt.value && !allowedRoles.includes(opt.value)) opt.remove();
    });
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
      if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); return; }
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
      if (e.key === "ArrowUp") { e.preventDefault(); moveSelection(-1); return; }
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

  const pendingCountryPicker = createCountryPicker(countrySearchPending, countryDropdownPending);
  const standaloneCountryPicker = createCountryPicker(countrySearchStandalone, countryDropdownStandalone);
  const inviteCountryPicker = createCountryPicker(inviteCountrySearch, inviteCountryDropdown);

  const pendingExistingCustomerPicker = createCustomerAutocomplete(
    customersSelect,
    customerSuggestDropdownPending,
    (customer) => {
      if (customer) {
        newCustomerNamePending.value = "";
        customerNotesPending.value = "";
        pendingCountryPicker.clear();
      }
      setPendingModeUI();
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
      pendingExistingCustomerPicker.setEnabled(false);
    } else {
      existingChoiceCard.classList.remove("is-disabled");
      pendingExistingCustomerPicker.setEnabled(true);
    }
  }

  function clearPendingChoice() {
    pendingExistingCustomerPicker.clear();
    newCustomerNamePending.value = "";
    customerNotesPending.value = "";
    pendingCountryPicker.clear();
    setPendingModeUI();
    toast.success("Pending approval choice cleared.");
  }

  // ── Invite panel UI mode (tab-based) ────────────────────────────────────

  function setInviteCustomerModeUI() {
    // With tabs, only manage country picker + notes enabled state in "new" tab
    const newName = inviteNewCustomerName.value.trim();
    inviteCountryPicker.setEnabled(!!newName);
    if (inviteCustomerNotes) inviteCustomerNotes.disabled = !newName;
  }

  function clearInviteCustomer() {
    inviteExistingCustomerPicker.clear();
    inviteSelectedCustomer = null;
    inviteNewCustomerName.value = "";
    if (inviteCustomerNotes) inviteCustomerNotes.value = "";
    inviteCountryPicker.clear();
    // Reset to first tab
    const wrap = document.querySelector('#inviteCustomerSection .custTabsWrap');
    if (wrap) {
      wrap.querySelectorAll('.custTab').forEach((t, i) => t.classList.toggle('active', i === 0));
      wrap.querySelectorAll('.custTabPane').forEach((p, i) => p.classList.toggle('active', i === 0));
    }
    setInviteCustomerModeUI();
  }

  function clearInvite() {
    $("inviteEmail").value = "";
    inviteRoleCheck.checked = false;
    inviteRoleSelect.value = "";
    inviteRoleSelect.disabled = true;
    inviteCustomerSection.classList.add("hidden");
    clearInviteCustomer();
  }

  // ── Standalone customer (Customers panel) ────────────────────────────────

  function clearStandaloneCreate() {
    newCustomerNameStandalone.value = "";
    customerNotesStandalone.value = "";
    standaloneCountryPicker.clear();
    toast.success("Customer form cleared.");
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
      .select("id,name,code,country,notes")
      .order("name", { ascending: true });

    if (error) {
      console.error("loadCustomers error:", error);
      toast.error("Failed to load customers: " + error.message);
      return;
    }
    customersData = data || [];
    pendingExistingCustomerPicker.render("");
    inviteExistingCustomerPicker.render("");
    renderCustomersTable();
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
      .eq("status", "pending_approval")
      .eq("role", "customer")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadPending error:", error);
      pendingTbody.innerHTML = `<tr><td colspan="5">Failed to load pending users: ${esc(error.message)}</td></tr>`;
      toast.error("Failed to load pending users: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      pendingTbody.innerHTML = `<tr><td colspan="5">No pending client users 🎉</td></tr>`;
      return;
    }

    // Build customer <option> list and country <option> list once
    const custOpts = customersData.map(c =>
      `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.code)})</option>`).join("");
    const countryOpts = countriesData.map(c =>
      `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name)}</option>`).join("");

    pendingTbody.innerHTML = data.map((p) => {
      const created = p.created_at ? formatDate(p.created_at) : "";
      const display = makeDisplayName(p.requested_full_name);
      const email = p.requested_email || "";
      const uid = esc(p.user_id);
      const canAct = canApprovePendingRole(myProf.role, 'customer');

      return `
        <tr data-user-id="${uid}" data-panel="client">
          <td><span class="pill">pending</span></td>
          <td>
            <strong>${esc(display || "(no name)")}</strong><br>
            <span class="small">${esc(email || "(no email)")}</span>
          </td>
          <td>${esc(p.requested_customer_name || "")}</td>
          <td class="small">${esc(created)}</td>
          <td>
            <div class="actions">
              <button class="btn primary" data-action="approve" ${!canAct ? 'disabled title="Your role cannot approve client users"' : ''}>Approve</button>
              <button class="btn btn-danger" data-action="reject" ${!canAct ? 'disabled title="Your role cannot reject client users"' : ''}>Reject</button>
            </div>
          </td>
        </tr>
        <tr class="pendingAssignRow" data-assign-for="${uid}">
          <td colspan="5">
            <div class="pendingAssignInner">
              <div class="custTabs">
                <button type="button" class="custTab active" data-tab-target="pExist_${uid}">Existing customer</button>
                <button type="button" class="custTab" data-tab-target="pNew_${uid}">New customer</button>
              </div>
              <div class="custTabContent">
                <div id="pExist_${uid}" class="custTabPane active">
                  <select class="p-cust-select" data-user-id="${uid}">
                    <option value="">— select customer —</option>${custOpts}
                  </select>
                </div>
                <div id="pNew_${uid}" class="custTabPane">
                  <div class="pendingNewRow">
                    <div><label>Name</label><input type="text" class="p-cust-name" data-user-id="${uid}" placeholder="Customer name…" /></div>
                    <div><label>Country</label><select class="p-cust-country" data-user-id="${uid}"><option value="">— select —</option>${countryOpts}</select></div>
                    <div><label>Notes</label><input type="text" class="p-cust-notes" data-user-id="${uid}" placeholder="Optional" /></div>
                  </div>
                </div>
              </div>
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
      .eq("status", "pending_approval")
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
      const created = p.created_at ? formatDate(p.created_at) : "";
      const display = makeDisplayName(p.requested_full_name);
      const email = p.requested_email || "";
      const currentRole = p.role || "internal";

      const allowedRoleValues = getAssignableInternalRolesForApprover(myProf.role);
      const roleOptions = INTERNAL_ROLES
        .filter(r => allowedRoleValues.includes(r.value))
        .map(r => `<option value="${esc(r.value)}" ${r.value === currentRole ? "selected" : ""}>${esc(r.label)}</option>`)
        .join("");

      return `
        <tr data-user-id="${esc(p.user_id)}" data-panel="internal" data-pending-role="${esc(currentRole)}">
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
              ${(() => {
          const canAct = canApprovePendingRole(myProf.role, currentRole);
          return `
                  <button class="btn primary" data-action="approve" ${!canAct ? 'disabled title="Your role cannot approve this user"' : ''}>Approve</button>
                  <button class="btn btn-danger" data-action="reject" ${!canAct ? 'disabled title="Your role cannot reject this user"' : ''}>Reject</button>
                `;
        })()}
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ── Approve / reject ─────────────────────────────────────────────────────

  async function createCustomerRecord({ name, countryCode, notes }) {
    const cleanName = String(name || "").trim().replace(/\s+/g, " ");
    const cleanCountry = String(countryCode || "").trim();

    if (!cleanName) throw new Error("Customer name is required.");
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
    const newName = newCustomerNamePending.value.trim();
    const notes = customerNotesPending.value.trim();
    const countryCode = pendingCountryPicker.getSelectedCode();

    const usingExisting = !!selectedId;
    const usingNew = !!newName;

    if (usingExisting && usingNew) throw new Error("Choose one option only: use existing customer OR create new customer.");
    if (!usingExisting && !usingNew) throw new Error("Choose one option: select an existing customer OR create a new customer.");
    if (usingExisting) return selectedId;

    return await createCustomerRecord({ name: newName, countryCode, notes });
  }

  // Resolve customer from inline pending row
  async function resolveInlineCustomerId(userId) {
    const assignRow = document.querySelector(`tr.pendingAssignRow[data-assign-for="${userId}"]`);
    if (!assignRow) throw new Error("Customer assignment row not found.");
    const activeTab = assignRow.querySelector('.custTab.active');
    const isExisting = activeTab?.dataset.tabTarget?.startsWith('pExist_');

    if (isExisting) {
      const sel = assignRow.querySelector('.p-cust-select');
      if (!sel?.value) throw new Error("Please select an existing customer.");
      return sel.value;
    } else {
      const name = assignRow.querySelector('.p-cust-name')?.value.trim();
      const country = assignRow.querySelector('.p-cust-country')?.value.trim();
      const notes = assignRow.querySelector('.p-cust-notes')?.value.trim();
      if (!name) throw new Error("Please enter a customer name.");
      if (!country) throw new Error("Please select a country.");
      return await createCustomerRecord({ name, countryCode: country, notes });
    }
  }

  async function approveClientUser(userId, customerId) {
    if (!canApprovePendingRole(myProf.role, "customer")) {
      throw new Error("Your role cannot approve customer requests.");
    }

    if (!customerId) throw new Error("No customer assigned.");

    const { error } = await sb
      .from("profiles")
      .update({
        status: "active",
        customer_id: customerId,
        approved_at: new Date().toISOString(),
        approved_by: myUserId
      })
      .eq("user_id", userId)
      .eq("status", "pending_approval")

    if (error) throw new Error("Approving user failed: " + error.message);
  }

  async function approveInternalUser(userId, role, pendingRole) {
    if (!canApprovePendingRole(myProf.role, pendingRole)) {
      throw new Error("Your role cannot approve this pending role.");
    }

    const allowedTargetRoles = getAssignableInternalRolesForApprover(myProf.role);
    if (!allowedTargetRoles.includes(role)) {
      throw new Error("Your role cannot assign that target role.");
    }

    const { error } = await sb
      .from("profiles")
      .update({
        status: "active",
        role: role,
        approved_at: new Date().toISOString(),
        approved_by: myUserId
      })
      .eq("user_id", userId)
      .eq("status", "pending_approval")

    if (error) throw new Error("Approving internal user failed: " + error.message);
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
      .eq("status", "pending_approval")

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
      const approverName = approverNameMap[u.approved_by] || "";

      return {
        user_id: u.user_id,
        display_name: display,
        email: u.requested_email,
        role: u.role,
        raw_customer_id: u.customer_id || "",
        customer_label: customerLabel,
        created_at: u.created_at,
        approved_at: u.approved_at,
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

  // ── Invite: send ─────────────────────────────────────────────────────────

  async function sendInvite() {
    const email = ($("inviteEmail").value || "").trim();
    const roleChecked = inviteRoleCheck.checked;
    const role = roleChecked ? inviteRoleSelect.value : null;

    if (!email) throw new Error("Please enter an email address.");
    if (roleChecked && !role) throw new Error("Please select a role.");

    let customerId = null;
    let customerName = null;

    if (role === "customer") {
      const activeTab = document.querySelector('#inviteCustomerSection .custTab.active');
      const isExistingTab = activeTab?.dataset.tabTarget === 'inviteTabExisting';

      if (isExistingTab) {
        const selectedId = inviteExistingCustomerPicker.getSelectedId();
        if (!selectedId) throw new Error("Please select an existing customer.");
        customerId = selectedId;
        const cust = customersData.find(c => c.id === selectedId);
        customerName = cust ? cust.name : "";
      } else {
        const newName = inviteNewCustomerName.value.trim();
        if (!newName) throw new Error("Please enter a name for the new customer.");
        toast.success("Creating customer…");
        customerId = await createCustomerRecord({
          name: newName,
          countryCode: inviteCountryPicker.getSelectedCode(),
          notes: (inviteCustomerNotes ? inviteCustomerNotes.value.trim() : "")
        });
        customerName = newName;
        await loadCustomers();
      }
    }

    toast.success("Sending invitation…");

    const redirectTo = "https://cbus-oscarafonso.github.io/digitalcatalogue-frontend/accept-invite.html";

    const { data, error } = await window.sb.functions.invoke("invite-user", {
      body: {
        email,
        role: role || undefined,
        customer_id: customerId || undefined,
        customer_name: customerName || undefined,
        redirect_to: redirectTo,
      }
    });

    if (error) {
      // FunctionsHttpError — try to get the body
      let msg = error.message || "Unknown error";
      try {
        const body = await error.context?.json?.();
        if (body?.error) msg = body.error;
      } catch { }
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

  // ── Change tracking ───────────────────────────────────────────────────────

  function trackChange(type, id, field, oldVal, newVal, oldLabel, newLabel) {
    if (!pendingChanges[type].has(id)) pendingChanges[type].set(id, {});
    const changes = pendingChanges[type].get(id);
    if (String(newVal) === String(oldVal)) {
      delete changes[field];
      if (Object.keys(changes).length === 0) pendingChanges[type].delete(id);
    } else {
      changes[field] = { old: oldVal, new: newVal, oldLabel: oldLabel ?? oldVal, newLabel: newLabel ?? newVal };
    }
    updatePendingBar();
  }

  function countPendingChanges() {
    let n = 0;
    for (const map of Object.values(pendingChanges)) {
      for (const fields of map.values()) n += Object.keys(fields).length;
    }
    return n;
  }

  function hasUnsavedChanges() {
    return countPendingChanges() > 0;
  }

  window.addEventListener("beforeunload", (e) => {
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  function updatePendingBar() {
    const bar = $("pendingChangesBar");
    const msg = $("pendingChangesMsg");
    if (!bar) return;
    const n = countPendingChanges();
    if (n === 0) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    msg.textContent = `${n} unsaved change${n !== 1 ? "s" : ""}`;
  }

  function buildChangeSummary() {
    const FIELD_LABELS = {
      requested_full_name: "Name", role: "Role", customer_id: "Customer",
      pep_code: "PEP Code", model: "Model", production_year: "Year",
      vin: "VIN", cobus_bus_no: "Bus No.", motor_no: "Motor No.",
      name: "Name", country: "Country", notes: "Notes",
    };

    let html = "";

    if (pendingChanges.users.size) {
      html += `<p style="font-weight:700;margin:0 0 8px;color:#003764;">Active Users</p><ul style="margin:0 0 16px;padding-left:18px;">`;
      for (const [userId, fields] of pendingChanges.users) {
        const u = activeUsersData.find(x => x.user_id === userId);
        const name = u ? esc(u.display_name) : esc(userId.slice(0, 8));
        for (const [field, change] of Object.entries(fields)) {
          html += `<li style="font-size:13px;margin-bottom:4px;"><strong>${name}</strong> — ${FIELD_LABELS[field] || field}: <span style="color:#6b7280">${esc(String(change.oldLabel))}</span> → <span style="color:#003764;font-weight:600">${esc(String(change.newLabel))}</span></li>`;
        }
      }
      html += `</ul>`;
    }

    if (pendingChanges.vehicles.size) {
      html += `<p style="font-weight:700;margin:0 0 8px;color:#003764;">Vehicles</p><ul style="margin:0 0 16px;padding-left:18px;">`;
      for (const [vehicleId, fields] of pendingChanges.vehicles) {
        const v = vehiclesData.find(x => x.id === vehicleId);
        const label = v ? esc(v.pep_code || v.vin || vehicleId.slice(0, 8)) : esc(vehicleId.slice(0, 8));
        for (const [field, change] of Object.entries(fields)) {
          html += `<li style="font-size:13px;margin-bottom:4px;"><strong>${label}</strong> — ${FIELD_LABELS[field] || field}: <span style="color:#6b7280">${esc(String(change.oldLabel))}</span> → <span style="color:#003764;font-weight:600">${esc(String(change.newLabel))}</span></li>`;
        }
      }
      html += `</ul>`;
    }

    if (pendingChanges.customers.size) {
      html += `<p style="font-weight:700;margin:0 0 8px;color:#003764;">Customers</p><ul style="margin:0 0 16px;padding-left:18px;">`;
      for (const [customerId, fields] of pendingChanges.customers) {
        const c = customersData.find(x => x.id === customerId);
        const label = c ? esc(c.name) : esc(customerId.slice(0, 8));
        for (const [field, change] of Object.entries(fields)) {
          html += `<li style="font-size:13px;margin-bottom:4px;"><strong>${label}</strong> — ${FIELD_LABELS[field] || field}: <span style="color:#6b7280">${esc(String(change.oldLabel))}</span> → <span style="color:#003764;font-weight:600">${esc(String(change.newLabel))}</span></li>`;
        }
      }
      html += `</ul>`;
    }

    return html;
  }

  async function savePendingChanges() {
    const btn = $("btnSaveConfirmYes");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    let anyError = false;

    // Save user changes
    for (const [userId, fields] of pendingChanges.users) {
      const update = {};
      for (const [field, change] of Object.entries(fields)) update[field] = change.new || null;
      const { error } = await sb.from("profiles").update(update).eq("user_id", userId);
      if (error) { toast.error(`Failed to save user changes: ${error.message}`); anyError = true; }
    }

    // Save vehicle changes
    for (const [vehicleId, fields] of pendingChanges.vehicles) {
      const update = {};
      for (const [field, change] of Object.entries(fields)) update[field] = change.new || null;
      const { error } = await sb.from("vehicles").update(update).eq("id", vehicleId);
      if (error) { toast.error(`Failed to save vehicle changes: ${error.message}`); anyError = true; }
    }

    // Save customer changes
    for (const [customerId, fields] of pendingChanges.customers) {
      const update = {};
      for (const [field, change] of Object.entries(fields)) update[field] = change.new || null;
      const { error } = await sb.from("customers").update(update).eq("id", customerId);
      if (error) { toast.error(`Failed to save customer changes: ${error.message}`); anyError = true; }
    }

    $("saveConfirmModal").hidden = true;
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }

    if (!anyError) {
      pendingChanges.users.clear();
      pendingChanges.vehicles.clear();
      pendingChanges.customers.clear();
      editingRows.users.clear();
      editingRows.vehicles.clear();
      editingRows.customers.clear();
      updatePendingBar();
      toast.success("Changes saved.");
      await loadCustomers();
      await loadActiveUsers();
      await loadVehicles();
    }
  }

  function discardAllChanges() {
    pendingChanges.users.clear();
    pendingChanges.vehicles.clear();
    pendingChanges.customers.clear();
    editingRows.users.clear();
    editingRows.vehicles.clear();
    editingRows.customers.clear();
    updatePendingBar();
    sortAndRenderActive();
    sortAndRenderVehicles();
    renderCustomersTable();
    toast.success("All changes discarded.");
  }

  // ── Sort helpers ──────────────────────────────────────────────────────────

  function sortArrow(tableKey, colKey, currentSortKey, currentSortDir) {
    const isSorted = currentSortKey === colKey;
    const arrow = isSorted ? (currentSortDir === "asc" ? "↑" : "↓") : "↕";
    const cls = isSorted ? "adminSortArrow" : "adminSortArrow inactive";
    return `<span class="${cls}">${arrow}</span>`;
  }

  function updateSortHeaders(tableId, currentSortKey, currentSortDir) {
    document.querySelectorAll(`.adminSortTh[data-table="${tableId}"]`).forEach(th => {
      const key = th.dataset.key;
      const isSorted = key === currentSortKey;
      th.classList.toggle("sorted", isSorted);
      const arrowEl = th.querySelector(".adminSortArrow");
      if (arrowEl) {
        arrowEl.textContent = isSorted ? (currentSortDir === "asc" ? "↑" : "↓") : "↕";
        arrowEl.classList.toggle("inactive", !isSorted);
      }
    });
  }

  // ── renderActive (updated: sort headers, edit column) ────────────────────

  function renderActive() {
    const isAdmin = window.__myRole === "admin";
    const colCount = isAdmin ? 8 : 7;

    if (!activeUsersData.length) {
      activeTbody.innerHTML = `<tr><td colspan="${colCount}">No active users.</td></tr>`;
      return;
    }

    activeTbody.innerHTML = activeUsersData.map((u) => {
      const isEditing = editingRows.users.has(u.user_id);
      const changes = pendingChanges.users.get(u.user_id) || {};

      const nameVal = changes.requested_full_name?.new ?? u.display_name;
      const roleVal = changes.role?.new ?? u.role;
      const customerVal = changes.customer_id?.new ?? (u.raw_customer_id || "");

      if (isEditing) {
        const roleOpts = Object.entries(ROLE_LABELS).map(([v, l]) =>
          `<option value="${esc(v)}" ${v === roleVal ? "selected" : ""}>${esc(l)}</option>`
        ).join("");
        const custOpts = `<option value="">— none —</option>` + customersData.map(c =>
          `<option value="${esc(c.id)}" ${c.id === customerVal ? "selected" : ""}>${esc(c.name)}</option>`
        ).join("");

        return `<tr class="editingRow" data-user-id="${esc(u.user_id)}">
          <td><input class="editInput" data-type="users" data-id="${esc(u.user_id)}" data-field="requested_full_name" data-orig="${esc(u.display_name)}" value="${esc(nameVal)}"></td>
          <td>${esc(u.email)}</td>
          <td><select class="editSelect" data-type="users" data-id="${esc(u.user_id)}" data-field="role" data-orig="${esc(u.role)}">${roleOpts}</select></td>
          <td><select class="editSelect" data-type="users" data-id="${esc(u.user_id)}" data-field="customer_id" data-orig="${esc(u.raw_customer_id || "")}">${custOpts}</select></td>
          <td class="small">${esc(formatDate(u.created_at))}</td>
          <td class="small">${esc(formatDate(u.approved_at))}${u.approver_name ? `<div class="small">${esc(u.approver_name)}</div>` : ""}</td>
          <td class="mono small">${esc(u.user_id)}</td>
          <td style="display:flex;gap:6px;align-items:center;">
            <label class="toggleSwitch" title="Stop editing"><input type="checkbox" data-toggle-type="users" data-toggle-id="${esc(u.user_id)}" checked><span class="toggleSlider"></span></label>
            <button class="btn btn-danger" style="padding:3px 8px;font-size:11px;" data-delete-user-id="${esc(u.user_id)}" data-delete-user-name="${esc(u.display_name)}" data-delete-user-email="${esc(u.email)}">Delete</button>
          </td>
        </tr>`;
      }

      return `<tr class="dataRow" data-user-id="${esc(u.user_id)}">
        <td><strong>${esc(nameVal)}</strong></td>
        <td>${esc(u.email)}</td>
        <td>${esc(ROLE_LABELS[roleVal] || roleVal)}</td>
        <td>${esc(changes.customer_id ? (customersData.find(c => c.id === changes.customer_id.new)?.name || "—") : u.customer_label)}</td>
        <td class="small">${esc(formatDate(u.created_at))}</td>
        <td class="small">${esc(formatDate(u.approved_at))}${u.approver_name ? `<div class="small">${esc(u.approver_name)}</div>` : ""}</td>
        <td class="mono small">${esc(u.user_id)}</td>
        ${isAdmin ? `<td><label class="toggleSwitch" title="${isEditing ? 'Stop editing' : 'Edit'}"><input type="checkbox" data-toggle-type="users" data-toggle-id="${esc(u.user_id)}"${isEditing ? ' checked' : ''}><span class="toggleSlider"></span></label></td>` : ""}
      </tr>`;
    }).join("");

    updateSortHeaders("users", sortKey, sortDir);
  }

  // ── loadVehicles (updated: add id, customer_id; store vehiclesData) ───────

  async function loadVehicles() {
    const tbody = $("vehiclesTbody");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8">Loading…</td></tr>`;
    const { data, error } = await sb
      .from("vehicles")
      .select("id,pep_code,model,production_year,vin,cobus_bus_no,motor_no,customer_id,customer:customers!vehicles_customer_id_fkey(id,name)")
      .order("created_at", { ascending: false });
    if (error) { tbody.innerHTML = `<tr><td colspan="8">Error: ${esc(error.message)}</td></tr>`; return; }

    vehiclesData = (data || []).map(v => ({
      id: v.id,
      pep_code: v.pep_code || "",
      model: v.model || "",
      production_year: v.production_year ?? "",
      vin: v.vin || "",
      cobus_bus_no: v.cobus_bus_no || "",
      motor_no: v.motor_no || "",
      customer_id: v.customer_id || "",
      customer_name: v.customer?.name || "",
    }));

    sortAndRenderVehicles();
  }

  function sortAndRenderVehicles() {
    const dir = vehiclesSortDir === "asc" ? 1 : -1;
    vehiclesData.sort((a, b) => {
      let va = a[vehiclesSortKey] ?? "";
      let vb = b[vehiclesSortKey] ?? "";
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    renderVehicles();
  }

  function renderVehicles() {
    const tbody = $("vehiclesTbody");
    if (!tbody) return;
    const canEdit = ["admin", "catalog_manager"].includes(window.__myRole);
    const colCount = canEdit ? 8 : 7;

    if (!vehiclesData.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}">No vehicles.</td></tr>`;
      updateSortHeaders("vehicles", vehiclesSortKey, vehiclesSortDir);
      return;
    }

    tbody.innerHTML = vehiclesData.map(v => {
      const isEditing = editingRows.vehicles.has(v.id);
      const changes = pendingChanges.vehicles.get(v.id) || {};

      const fields = ["pep_code", "model", "production_year", "vin", "cobus_bus_no", "motor_no"];
      const custVal = changes.customer_id?.new ?? v.customer_id;

      if (isEditing) {
        const custOpts = `<option value="">— none —</option>` + customersData.map(c =>
          `<option value="${esc(c.id)}" ${c.id === custVal ? "selected" : ""}>${esc(c.name)}</option>`
        ).join("");

        const editCells = fields.map(f => {
          const orig = v[f];
          const val = changes[f]?.new ?? orig;
          return `<td><input class="editInput" data-type="vehicles" data-id="${esc(v.id)}" data-field="${f}" data-orig="${esc(String(orig))}" value="${esc(String(val ?? ""))}"></td>`;
        }).join("");

        return `<tr class="editingRow" data-vehicle-id="${esc(v.id)}">
          ${editCells}
          <td><select class="editSelect" data-type="vehicles" data-id="${esc(v.id)}" data-field="customer_id" data-orig="${esc(v.customer_id)}">${custOpts}</select></td>
          <td><label class="toggleSwitch" title="Stop editing"><input type="checkbox" data-toggle-type="vehicles" data-toggle-id="${esc(v.id)}" checked><span class="toggleSlider"></span></label></td>
        </tr>`;
      }

      const displayCustomer = changes.customer_id
        ? (customersData.find(c => c.id === changes.customer_id.new)?.name || "—")
        : v.customer_name;

      return `<tr class="dataRow" data-vehicle-id="${esc(v.id)}">
        <td class="mono">${esc(changes.pep_code?.new ?? v.pep_code)}</td>
        <td>${esc(changes.model?.new ?? v.model)}</td>
        <td>${esc(changes.production_year?.new ?? v.production_year)}</td>
        <td class="mono small">${esc(changes.vin?.new ?? v.vin)}</td>
        <td>${esc(changes.cobus_bus_no?.new ?? v.cobus_bus_no)}</td>
        <td>${esc(changes.motor_no?.new ?? v.motor_no)}</td>
        <td>${esc(displayCustomer)}</td>
        ${canEdit ? `<td><label class="toggleSwitch" title="Edit"><input type="checkbox" data-toggle-type="vehicles" data-toggle-id="${esc(v.id)}"><span class="toggleSlider"></span></label></td>` : ""}
      </tr>`;
    }).join("");

    updateSortHeaders("vehicles", vehiclesSortKey, vehiclesSortDir);
  }

  // ── renderCustomersTable ──────────────────────────────────────────────────

  function renderCustomersTable() {
    const tbody = $("customersTbody");
    if (!tbody) return;
    const canEditCustomers = ["admin", "client_manager"].includes(window.__myRole);
    const colCount = canEditCustomers ? 5 : 4;

    const sorted = [...customersData].sort((a, b) => {
      const dir = customersSortDir === "asc" ? 1 : -1;
      const va = String(a[customersSortKey] || "").toLowerCase();
      const vb = String(b[customersSortKey] || "").toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });

    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}">No customers.</td></tr>`;
      updateSortHeaders("customers", customersSortKey, customersSortDir);
      return;
    }

    tbody.innerHTML = sorted.map(c => {
      const isEditing = editingRows.customers.has(c.id);
      const changes = pendingChanges.customers.get(c.id) || {};

      if (isEditing) {
        return `<tr class="customerRow" data-customer-id="${esc(c.id)}">
          <td><input class="editInput" data-type="customers" data-id="${esc(c.id)}" data-field="name" data-orig="${esc(c.name)}" value="${esc(changes.name?.new ?? c.name)}"></td>
          <td class="mono small">${esc(c.code)}</td>
          <td><input class="editInput" data-type="customers" data-id="${esc(c.id)}" data-field="country" data-orig="${esc(c.country || "")}" value="${esc(changes.country?.new ?? (c.country || ""))}"></td>
          <td><input class="editInput" data-type="customers" data-id="${esc(c.id)}" data-field="notes" data-orig="${esc(c.notes || "")}" value="${esc(changes.notes?.new ?? (c.notes || ""))}"></td>
          <td><label class="toggleSwitch" title="Stop editing"><input type="checkbox" data-toggle-type="customers" data-toggle-id="${esc(c.id)}" checked><span class="toggleSlider"></span></label></td>
        </tr>`;
      }

      return `<tr class="customerRow" data-customer-id="${esc(c.id)}">
        <td><strong>${esc(changes.name?.new ?? c.name)}</strong></td>
        <td class="mono small">${esc(c.code)}</td>
        <td>${esc(changes.country?.new ?? (c.country || ""))}</td>
        <td style="color:#6b7280;font-size:12px;">${esc(changes.notes?.new ?? (c.notes || ""))}</td>
        ${canEditCustomers ? `<td><label class="toggleSwitch" title="Edit"><input type="checkbox" data-toggle-type="customers" data-toggle-id="${esc(c.id)}"><span class="toggleSlider"></span></label></td>` : ""}
      </tr>`;
    }).join("");

    updateSortHeaders("customers", customersSortKey, customersSortDir);
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

  window.__myRole = myProf.role;

  if (typeof setupNavTabs === "function") setupNavTabs(myProf.role, "adminarea");
  window.renderUserBadge?.(session, myProf);

  // Show edit columns based on role
  if (myProf.role === "admin") {
    const activeEditCol = $("activeUsersEditColHeader");
    if (activeEditCol) activeEditCol.style.display = "";
  }
  if (["admin", "client_manager"].includes(myProf.role)) {
    const custEditCol = $("customersEditColHeader");
    if (custEditCol) custEditCol.style.display = "";
  }
  if (["admin", "catalog_manager"].includes(myProf.role)) {
    const vehicleEditCol = $("vehiclesEditColHeader");
    if (vehicleEditCol) vehicleEditCol.style.display = "";
  }

  if (myProf.role === "catalog_manager") {
    document.querySelectorAll(".adminPanel[data-panel-active]")
      .forEach(el => el.style.display = "none");
  }

  // Create Customer panel: only admin and client_manager
  if (!["admin", "client_manager"].includes(myProf.role)) {
    const createCustPanel = $("createCustomerPanel");
    if (createCustPanel) createCustPanel.style.display = "none";
  }

  // Load new vehicles subpanel: only admin and catalog_manager
  if (!["admin", "catalog_manager"].includes(myProf.role)) {
    const loadVehiclesPanel = $("loadVehiclesSubpanel");
    if (loadVehiclesPanel) loadVehiclesPanel.style.display = "none";
  }

  // Show Admin option in invite role select only for admins
  if (myProf.role === "admin") {
    const adminOpt = document.createElement("option");
    adminOpt.value = "admin";
    adminOpt.textContent = "Admin";
    // Insert as first option after the placeholder
    inviteRoleSelect.insertBefore(adminOpt, inviteRoleSelect.options[1]);
  }

  restrictInviteRoleOptionsForCurrentUser(myProf.role);

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
        name: newCustomerNameStandalone.value.trim(),
        countryCode: standaloneCountryPicker.getSelectedCode(),
        notes: customerNotesStandalone.value.trim()
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

      if (!canApprovePendingRole(myProf.role, "customer")) {
        throw new Error("Your role cannot act on customer requests.");
      }

      if (action === "approve") {
        const customerId = await resolveInlineCustomerId(userId);
        await approveClientUser(userId, customerId);
        toast.success("Approved.");
        await loadCustomers();
        await loadActiveUsers();
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

      const pendingRole = tr.getAttribute("data-pending-role") || "internal";
      if (!canApprovePendingRole(myProf.role, pendingRole)) {
        throw new Error("Your role cannot act on this pending request.");
      }

      if (action === "approve") {
        const roleSelect = tr.querySelector(`.roleSelectInline[data-user-id="${userId}"]`);
        const role = roleSelect ? roleSelect.value : "internal";
        await approveInternalUser(userId, role, pendingRole);
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

  // ── Delegated sort for all tables ────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const th = e.target.closest(".adminSortTh");
    if (!th) return;
    const table = th.dataset.table;
    const key = th.dataset.key;
    if (!table || !key) return;

    if (table === "users") {
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = key === "approved_at" ? "desc" : "asc"; }
      sortAndRenderActive();
    } else if (table === "vehicles") {
      if (vehiclesSortKey === key) vehiclesSortDir = vehiclesSortDir === "asc" ? "desc" : "asc";
      else { vehiclesSortKey = key; vehiclesSortDir = "asc"; }
      sortAndRenderVehicles();
    } else if (table === "customers") {
      if (customersSortKey === key) customersSortDir = customersSortDir === "asc" ? "desc" : "asc";
      else { customersSortKey = key; customersSortDir = "asc"; }
      renderCustomersTable();
    }
  });

  // ── Toggle switch handler (replaces edit button click) ───────────────────
  document.addEventListener('change', (e) => {
    const toggle = e.target;
    if (!toggle.matches('input[data-toggle-type]')) return;
    const type = toggle.dataset.toggleType;
    const id = toggle.dataset.toggleId;
    if (toggle.checked) {
      editingRows[type].add(id);
    } else {
      editingRows[type].delete(id);
      pendingChanges[type].delete(id);
      updatePendingBar();
    }
    if (type === "users") sortAndRenderActive();
    else if (type === "vehicles") renderVehicles();
    else if (type === "customers") renderCustomersTable();
  });

  // ── Tab switching handler (delegated) ───────────────────────────────────
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.custTab');
    if (!tab) return;
    e.stopPropagation();
    const targetId = tab.dataset.tabTarget;
    if (!targetId) return;

    // Find sibling tabs and panes
    const tabsContainer = tab.closest('.custTabs') || tab.parentElement;
    const wrap = tabsContainer.parentElement;
    const contentEl = wrap.querySelector('.custTabContent');

    // Deactivate all tabs and panes
    tabsContainer.querySelectorAll('.custTab').forEach(t => t.classList.remove('active'));
    if (contentEl) contentEl.querySelectorAll('.custTabPane').forEach(p => p.classList.remove('active'));

    // Activate clicked tab and target pane
    tab.classList.add('active');
    const pane = document.getElementById(targetId);
    if (pane) pane.classList.add('active');
  });

  // ── Customer row expansion ────────────────────────────────────────────────
  const expandedCustomers = new Set();

  async function toggleCustomerExpanded(customerId, tr) {
    const existingExpanded = tr.nextElementSibling;
    if (existingExpanded?.classList.contains('customerExpandedRow')) {
      existingExpanded.remove();
      tr.classList.remove('expanded');
      expandedCustomers.delete(customerId);
      return;
    }

    tr.classList.add('expanded');
    expandedCustomers.add(customerId);

    const colCount = tr.querySelectorAll('td').length;
    const expandedTr = document.createElement('tr');
    expandedTr.className = 'customerExpandedRow';
    expandedTr.innerHTML = `<td colspan="${colCount}"><div class="customerExpandedInner"><div class="expandLoading">Loading…</div></div></td>`;
    tr.after(expandedTr);

    try {
      // 1. Get vehicles for this customer
      const { data: vehicles } = await sb.from('vehicles').select('id').eq('customer_id', customerId);
      const vehicleIds = (vehicles || []).map(v => v.id);

      // 2. Get catalogs via vehicle_catalogs
      let catalogMap = new Map();
      if (vehicleIds.length) {
        const { data: vcs } = await sb
          .from('vehicle_catalogs')
          .select('catalog_id, catalogs(id, name, pai_code)')
          .in('vehicle_id', vehicleIds);
        for (const vc of (vcs || [])) {
          if (vc.catalogs && !catalogMap.has(vc.catalog_id)) {
            catalogMap.set(vc.catalog_id, vc.catalogs);
          }
        }
      }

      // 3. Get order requests for this customer
      const { data: orders } = await sb
        .from('order_requests')
        .select('id, created_at, content_text, catalog_id')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      // Group order requests by catalog_id
      const ordersByCatalog = new Map();
      const ordersNoCatalog = [];
      for (const o of (orders || [])) {
        if (o.catalog_id) {
          if (!ordersByCatalog.has(o.catalog_id)) ordersByCatalog.set(o.catalog_id, []);
          ordersByCatalog.get(o.catalog_id).push(o);
        } else {
          ordersNoCatalog.push(o);
        }
      }

      // Build table rows
      const allCatalogIds = new Set([...catalogMap.keys(), ...ordersByCatalog.keys()]);

      if (!allCatalogIds.size && !ordersNoCatalog.length) {
        expandedTr.querySelector('.customerExpandedInner').innerHTML =
          `<div style="color:#9ca3af;font-size:12px;">No catalogs or order requests found for this customer.</div>`;
        return;
      }

      function orderChips(orderList) {
        if (!orderList?.length) return '<span style="color:#9ca3af;font-size:11px;">—</span>';
        return orderList.map(o => {
          const dt = o.created_at ? new Date(o.created_at).toLocaleDateString('en-GB') : '';
          const shortId = o.id.slice(0, 8);
          return `<span class="orderReqChip" data-order-content="${esc(o.content_text || '')}" data-order-id="${esc(o.id)}">${esc(dt)} · ${esc(shortId)}…</span>`;
        }).join('');
      }

      let rows = '';
      for (const catalogId of allCatalogIds) {
        const cat = catalogMap.get(catalogId);
        const catOrders = ordersByCatalog.get(catalogId) || [];
        const catName = cat ? `${esc(cat.name)}<br><code style="font-size:10px;color:#6b7280">${esc(cat.pai_code)}</code>` : `<span style="color:#9ca3af">Unknown catalog</span>`;
        const goBtn = cat ? `<div class="catalogGoWrap" style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;">
          <button class="catalogGoBtn" data-pai="${esc(cat.pai_code)}" data-name="${esc(cat.name)}" title="Go to catalog">→</button>
          <div class="catalogGoBubble hidden" data-bubble-pai="${esc(cat.pai_code)}">Open catalog: ${esc(cat.name)} →</div>
        </div>` : '';
        rows += `<tr>
          <td>${catName}${goBtn}</td>
          <td>${orderChips(catOrders)}</td>
        </tr>`;
      }
      if (ordersNoCatalog.length) {
        rows += `<tr>
          <td><span style="color:#9ca3af;font-size:11px;">No catalog assigned</span></td>
          <td>${orderChips(ordersNoCatalog)}</td>
        </tr>`;
      }

      expandedTr.querySelector('.customerExpandedInner').innerHTML = `
        <table class="catalogOrdersTable">
          <colgroup><col style="width:40%"><col></colgroup>
          <thead><tr><th>Catalog</th><th>Order requests</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;

    } catch (err) {
      console.error('Customer expansion error:', err);
      expandedTr.querySelector('.customerExpandedInner').innerHTML =
        `<div style="color:#b91c1c;font-size:12px;">Error loading data: ${esc(String(err.message || err))}</div>`;
    }
  }

  // Delegated: catalog go button
  document.addEventListener('click', (e) => {
    const goBtn = e.target.closest('.catalogGoBtn');
    if (goBtn) {
      e.stopPropagation();
      const wrap = goBtn.closest('.catalogGoWrap');
      const bubble = wrap?.querySelector('.catalogGoBubble');
      if (bubble) bubble.classList.toggle('hidden');
      return;
    }
    const bubble = e.target.closest('.catalogGoBubble');
    if (bubble) {
      const pai = bubble.dataset.bubblePai;
      if (pai) window.open(`interactive-catalog.html?catalog=${encodeURIComponent(pai)}`, '_blank');
      return;
    }
    // Close any open bubbles when clicking elsewhere
    if (!e.target.closest('.catalogGoWrap')) {
      document.querySelectorAll('.catalogGoBubble:not(.hidden)').forEach(b => b.classList.add('hidden'));
    }
  });

  // Delegated: order request chip
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.orderReqChip');
    if (!chip) return;
    e.stopPropagation();
    const content = chip.dataset.orderContent || '';
    const id = chip.dataset.orderId || '';
    $('orderReqPopupTitle').textContent = `Order request · ${id.slice(0, 8)}…`;
    $('orderReqPopupContent').textContent = content;
    $('orderReqPopup').hidden = false;
  });
  on('btnOrderReqPopupClose', 'click', () => { $('orderReqPopup').hidden = true; });
  on('orderReqPopupBackdrop', 'click', () => { $('orderReqPopup').hidden = true; });

  on('orderReqPopupBackdrop', 'click', () => { $('orderReqPopup').hidden = true; });

  // ── User row expansion ────────────────────────────────────────────────────
  const expandedUsers = new Set();

  async function toggleUserExpanded(userId, tr) {
    const existingExpanded = tr.nextElementSibling;
    if (existingExpanded?.classList.contains('userExpandedRow')) {
      existingExpanded.remove();
      tr.classList.remove('expanded');
      expandedUsers.delete(userId);
      return;
    }
    tr.classList.add('expanded');
    expandedUsers.add(userId);
    const colCount = tr.querySelectorAll('td').length;
    const expandedTr = document.createElement('tr');
    expandedTr.className = 'userExpandedRow';
    expandedTr.innerHTML = `<td colspan="${colCount}" style="padding:0;background:#f8fafc;border-bottom:1px solid var(--line)"><div class="customerExpandedInner"><div class="expandLoading">Loading…</div></div></td>`;
    tr.after(expandedTr);

    try {
      const u = activeUsersData.find(x => x.user_id === userId);
      const customerId = u?.raw_customer_id;
      if (!customerId) {
        expandedTr.querySelector('.customerExpandedInner').innerHTML = `<div style="color:#9ca3af;font-size:12px;">No customer assigned to this user.</div>`;
        return;
      }
      const { data: vehicles } = await sb.from('vehicles').select('id,pep_code,model,production_year,vin,cobus_bus_no,motor_no').eq('customer_id', customerId);
      const vehicleIds = (vehicles || []).map(v => v.id);
      const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));
      let catalogMap = new Map();
      let vehiclesByCatalog = new Map();
      if (vehicleIds.length) {
        const { data: vcs } = await sb.from('vehicle_catalogs').select('vehicle_id,catalog_id,catalogs(id,name,pai_code)').in('vehicle_id', vehicleIds);
        for (const vc of (vcs || [])) {
          if (vc.catalogs && !catalogMap.has(vc.catalog_id)) catalogMap.set(vc.catalog_id, vc.catalogs);
          if (!vehiclesByCatalog.has(vc.catalog_id)) vehiclesByCatalog.set(vc.catalog_id, new Set());
          vehiclesByCatalog.get(vc.catalog_id).add(vc.vehicle_id);
        }
      }
      if (!catalogMap.size) {
        expandedTr.querySelector('.customerExpandedInner').innerHTML = `<div style="color:#9ca3af;font-size:12px;">No catalogs associated with this user's customer.</div>`;
        return;
      }
      let rows = '';
      for (const [catalogId, cat] of catalogMap) {
        const pepChips = [...(vehiclesByCatalog.get(catalogId) || [])].map(vid => {
          const v = vehicleMap.get(vid);
          if (!v) return '';
          const vData = esc(JSON.stringify({ pep_code: v.pep_code, model: v.model, production_year: v.production_year, vin: v.vin, cobus_bus_no: v.cobus_bus_no, motor_no: v.motor_no }));
          return `<span class="pepChip" data-vehicle-json="${vData}" data-pep="${esc(v.pep_code)}">${esc(v.pep_code || v.id.slice(0, 8))}</span>`;
        }).join('');
        rows += `<tr><td><strong>${esc(cat.name)}</strong><br><code style="font-size:10px;color:#6b7280">${esc(cat.pai_code)}</code><div class="catalogGoWrap" style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;"><button class="catalogGoBtn" data-pai="${esc(cat.pai_code)}" data-name="${esc(cat.name)}" title="Go to catalog">→</button><div class="catalogGoBubble hidden" data-bubble-pai="${esc(cat.pai_code)}">Open catalog: ${esc(cat.name)} →</div></div></td><td>${pepChips || '<span style="color:#9ca3af;font-size:11px;">—</span>'}</td></tr>`;
      }
      expandedTr.querySelector('.customerExpandedInner').innerHTML = `<table class="catalogOrdersTable"><colgroup><col style="width:40%"><col></colgroup><thead><tr><th>Catalog</th><th>Vehicles (PEP Code)</th></tr></thead><tbody>${rows}</tbody></table>`;
    } catch (err) {
      expandedTr.querySelector('.customerExpandedInner').innerHTML = `<div style="color:#b91c1c;font-size:12px;">Error: ${esc(String(err.message || err))}</div>`;
    }
  }

  // ── Vehicle row expansion ─────────────────────────────────────────────────
  const expandedVehicles = new Set();

  async function toggleVehicleExpanded(vehicleId, tr) {
    const existingExpanded = tr.nextElementSibling;
    if (existingExpanded?.classList.contains('vehicleExpandedRow')) {
      existingExpanded.remove();
      tr.classList.remove('expanded');
      expandedVehicles.delete(vehicleId);
      return;
    }
    tr.classList.add('expanded');
    expandedVehicles.add(vehicleId);
    const colCount = tr.querySelectorAll('td').length;
    const expandedTr = document.createElement('tr');
    expandedTr.className = 'vehicleExpandedRow';
    expandedTr.innerHTML = `<td colspan="${colCount}" style="padding:0;background:#f8fafc;border-bottom:1px solid var(--line)"><div class="customerExpandedInner"><div class="expandLoading">Loading…</div></div></td>`;
    tr.after(expandedTr);
    try {
      const { data: vcs } = await sb.from('vehicle_catalogs').select('catalog_id,catalogs(id,name,pai_code)').eq('vehicle_id', vehicleId);
      if (!vcs?.length) {
        expandedTr.querySelector('.customerExpandedInner').innerHTML = `<div style="color:#9ca3af;font-size:12px;">No catalogs associated with this vehicle.</div>`;
        return;
      }
      const rows = vcs.map(vc => {
        const cat = vc.catalogs;
        if (!cat) return '';
        const catName = `<strong>${esc(cat.name)}</strong><br><code style="font-size:10px;color:#6b7280">${esc(cat.pai_code)}</code>`;
        const goBtn = `<div class="catalogGoWrap" style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;">
          <button class="catalogGoBtn" data-pai="${esc(cat.pai_code)}" data-name="${esc(cat.name)}" title="Go to catalog">→</button>
          <div class="catalogGoBubble hidden" data-bubble-pai="${esc(cat.pai_code)}">Open catalog: ${esc(cat.name)} →</div>
        </div>`;
        return `<tr><td>${catName}${goBtn}</td></tr>`;
      }).join('');
      expandedTr.querySelector('.customerExpandedInner').innerHTML = `<table class="catalogOrdersTable"><colgroup><col></colgroup><thead><tr><th>Catalog</th></tr></thead><tbody>${rows}</tbody></table>`;
    } catch (err) {
      expandedTr.querySelector('.customerExpandedInner').innerHTML = `<div style="color:#b91c1c;font-size:12px;">Error: ${esc(String(err.message || err))}</div>`;
    }
  }

  // ── Vehicle detail popup (pep chip) ───────────────────────────────────────
  on('btnVehicleDetailClose', 'click', () => { $('vehicleDetailPopup').hidden = true; });
  on('vehicleDetailPopupBackdrop', 'click', () => { $('vehicleDetailPopup').hidden = true; });

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.pepChip');
    if (!chip) return;
    e.stopPropagation();
    try {
      const v = JSON.parse(chip.dataset.vehicleJson);
      $('vehicleDetailPopupTitle').textContent = `Vehicle · ${chip.dataset.pep || '—'}`;
      $('vehicleDetailTable').innerHTML = [
        ['PEP Code', v.pep_code], ['Model', v.model], ['Year', v.production_year],
        ['VIN', v.vin], ['Bus No.', v.cobus_bus_no], ['Motor No.', v.motor_no],
      ].map(([l, val]) => `<tr><td>${esc(l)}</td><td>${esc(String(val || '—'))}</td></tr>`).join('');
      $('vehicleDetailPopup').hidden = false;
    } catch { }
  });

  // ── Delegated row clicks to expand ───────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (e.target.closest('input[data-toggle-type]') || e.target.closest('.toggleSwitch') ||
      e.target.closest('.pepChip') || e.target.closest('.orderReqChip') ||
      e.target.closest('.catalogGoBtn') || e.target.closest('.catalogGoBubble')) return;

    const userTr = e.target.closest('tr.dataRow[data-user-id]');
    if (userTr) { toggleUserExpanded(userTr.dataset.userId, userTr); return; }

    const vehicleTr = e.target.closest('tr.dataRow[data-vehicle-id]');
    if (vehicleTr) { toggleVehicleExpanded(vehicleTr.dataset.vehicleId, vehicleTr); return; }

    const customerTr = e.target.closest('tr.customerRow[data-customer-id]');
    if (customerTr) { toggleCustomerExpanded(customerTr.dataset.customerId, customerTr); return; }
  });

  // ── Delete / suspend user ─────────────────────────────────────────────────
  let _deleteTargetId = null;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-user-id]');
    if (!btn) return;
    e.stopPropagation();
    _deleteTargetId = btn.dataset.deleteUserId;
    const name = btn.dataset.deleteUserName || '—';
    const email = btn.dataset.deleteUserEmail || '—';
    $('deleteUserMessage').innerHTML =
      `Are you sure you want to remove <strong>${esc(name)}</strong> (${esc(email)})?<br><br>` +
      `If this user has any activity in the system they will be <strong>suspended</strong> instead of permanently deleted.`;
    $('deleteUserModal').hidden = false;
  });

  on('btnDeleteUserCancel', 'click', () => { $('deleteUserModal').hidden = true; _deleteTargetId = null; });
  on('deleteUserBackdrop', 'click', () => { $('deleteUserModal').hidden = true; _deleteTargetId = null; });

  on('btnDeleteUserConfirm', 'click', async () => {
    if (!_deleteTargetId) return;
    const btn = $('btnDeleteUserConfirm');
    btn.disabled = true;
    btn.textContent = 'Working…';

    try {
      const { data, error } = await window.sb.functions.invoke('delete-or-suspend-user', {
        body: { target_user_id: _deleteTargetId },
      });

      if (error) {
        let msg = error.message || 'Unknown error';
        try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch { }
        throw new Error(msg);
      }

      $('deleteUserModal').hidden = false;
      _deleteTargetId = null;
      $('deleteUserModal').hidden = true;

      if (data?.action === 'deleted') {
        toast.success('User permanently deleted.');
      } else if (data?.action === 'suspended') {
        toast.success('User suspended — they have activity in the system and cannot be deleted.');
      }

      editingRows.users.clear();
      await loadActiveUsers();

    } catch (err) {
      toast.error(String(err?.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm';
    }
  });

  // ── Vehicle add-line placeholder ──────────────────────────────────────────
  function addVehicleAddPlaceholder() {
    const tbody = $('vehiclesInputTbody');
    const existing = tbody.querySelector('.vehicleAddRow');
    if (existing) existing.remove();
    const tr = document.createElement('tr');
    tr.className = 'vehicleAddRow';
    tr.innerHTML = `<td colspan="8">+ Add new line</td>`;
    tr.addEventListener('click', () => { addVehicleInputRow(); });
    tbody.appendChild(tr);
  }

  // ── Delegated inline edit change tracking ────────────────────────────────
  function handleEditChange(e) {
    const input = e.target.closest("[data-type][data-field]");
    if (!input) return;
    // For text inputs use 'input' event only; for selects use 'change' only
    if (input.tagName === "INPUT" && e.type === "change") return;
    if (input.tagName === "SELECT" && e.type === "input") return;
    const type = input.dataset.type;
    const id = input.dataset.id;
    const field = input.dataset.field;
    const orig = input.dataset.orig;
    const newVal = input.value;

    // Build labels for display
    let oldLabel = orig;
    let newLabel = newVal;
    if (field === "role") {
      oldLabel = ROLE_LABELS[orig] || orig;
      newLabel = ROLE_LABELS[newVal] || newVal;
    } else if (field === "customer_id") {
      oldLabel = customersData.find(c => c.id === orig)?.name || orig || "— none —";
      newLabel = customersData.find(c => c.id === newVal)?.name || newVal || "— none —";
    }

    trackChange(type, id, field, orig, newVal, oldLabel, newLabel);
  }

  document.addEventListener("input", handleEditChange);
  document.addEventListener("change", handleEditChange);

  // ── Pending changes bar buttons ───────────────────────────────────────────
  on("btnSaveChanges", "click", () => {
    const n = countPendingChanges();
    if (!n) return;
    $("saveConfirmBody").innerHTML = buildChangeSummary();
    $("saveConfirmModal").hidden = false;
  });

  on("btnDiscardChanges", "click", () => discardAllChanges());

  on("btnSaveConfirmCancel", "click", () => { $("saveConfirmModal").hidden = true; });
  on("saveConfirmBackdrop", "click", () => { $("saveConfirmModal").hidden = true; });
  on("btnSaveConfirmYes", "click", () => savePendingChanges());


  // ── Vehicles input table ──────────────────────────────────────────────────

  const VEHICLE_FIELDS = ["pep_code", "model", "production_year", "vin", "cobus_bus_no", "motor_no"];

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
      <td><input type="${f === "production_year" ? "number" : "text"}" class="vc-${f}"
        value="${esc(String(data[f] || ""))}"
        placeholder="${f.replace(/_/g, " ")}"
        style="width:100%;min-width:90px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;font:500 13px 'Rubik',sans-serif;" /></td>
    `).join("") +
      `<td>${customerSelectHtml(data.customer_id || "")}</td>
    <td><button type="button" class="btn btn-danger vc-remove" style="padding:4px 10px;font-size:12px;">✕</button></td>`;
    tbody.appendChild(tr);
    addVehicleAddPlaceholder();
  }

  function clearVehicleInputTable() {
    $("vehiclesInputTbody").innerHTML = "";
    addVehicleAddPlaceholder();
  }

  function getVehicleInputRows() {
    return Array.from($("vehiclesInputTbody").querySelectorAll("tr:not(.vehicleAddRow)")).map(tr => ({
      pep_code: tr.querySelector(".vc-pep_code")?.value.trim() || null,
      model: tr.querySelector(".vc-model")?.value.trim() || null,
      production_year: tr.querySelector(".vc-production_year")?.value ? Number(tr.querySelector(".vc-production_year").value) : null,
      vin: tr.querySelector(".vc-vin")?.value.trim() || null,
      cobus_bus_no: tr.querySelector(".vc-cobus_bus_no")?.value.trim() || null,
      motor_no: tr.querySelector(".vc-motor_no")?.value.trim() || null,
      customer_id: tr.querySelector(".vc-customer")?.value || null,
    }));
  }

  // ── CSV loader ────────────────────────────────────────────────────────────

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    // Detect separator: use sep= directive if present, otherwise auto-detect
    let sep = ";";
    let dataLines = lines;
    if (lines[0].startsWith("sep=")) {
      sep = lines[0].replace("sep=", "").trim() || ";";
      dataLines = lines.slice(1);
    } else {
      // Auto-detect: whichever of ; or , produces more columns in the header
      const semicolons = (lines[0].match(/;/g) || []).length;
      const commas = (lines[0].match(/,/g) || []).length;
      sep = commas > semicolons ? "," : ";";
    }
    if (dataLines.length < 2) return [];
    const headers = dataLines[0].split(sep).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return dataLines.slice(1)
      .filter(line => line.trim())
      .map(line => {
        const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ""));
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
    const inputRows = Array.from($("vehiclesInputTbody").querySelectorAll("tr:not(.vehicleAddRow)"));
    const missingRows = inputRows.filter(tr => !tr.querySelector(".vc-customer")?.value);

    tbody.innerHTML = missingRows.map((tr, idx) => {
      const pep = tr.querySelector(".vc-pep_code")?.value || "";
      const vin = tr.querySelector(".vc-vin")?.value || "";
      const customerOpts = customersData.map(c =>
        `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
      return `<tr data-row-idx="${idx}">
        <td style="padding:8px;font-size:13px;">${esc(pep) || esc(vin) || "(no id)"}</td>
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
  on("vehicleConfirmBackdrop", "click", () => { $("vehicleConfirmModal").hidden = true; });

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

  on("btnClearVehicles", "click", () => { clearVehicleInputTable(); toast.success("Cleared."); });

  // Delegated: vehicle input row remove
  $("vehiclesInputTbody")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".vc-remove");
    if (!btn) return;
    btn.closest("tr").remove();
    addVehicleAddPlaceholder();
  });

  function scrollToHashTarget() {
    const hash = window.location.hash;
    if (!hash) return;

    const target = document.querySelector(hash);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

  setTimeout(scrollToHashTarget, 80);
})();