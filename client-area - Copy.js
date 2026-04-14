const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDateTime(iso) {
  if (!iso) return "(sem data)";
  try { return new Date(iso).toLocaleString("pt-PT"); } catch { return iso; }
}

// ── Sort state ────────────────────────────────────────────────────────────────
let sortCol = "created_at";
let sortDir = "desc"; // "asc" | "desc"

// ── Render orders table ───────────────────────────────────────────────────────
function renderOrdersTable(orders, isCustomer, onSelect, selectedId) {
  const host = $("ordersTableWrap");
  if (!host) return;

  const cols = isCustomer
    ? [
        { key: "id",         label: "ID" },
        { key: "created_at", label: "Created at" },
        { key: "catalog",    label: "Catalog" },
      ]
    : [
        { key: "id",         label: "ID" },
        { key: "created_at", label: "Created at" },
        { key: "catalog",    label: "Catalog" },
        { key: "customer",   label: "Customer" },
        { key: "user",       label: "User" },
      ];

  // Sort
  const sorted = [...orders].sort((a, b) => {
    let va = a[sortCol] ?? "";
    let vb = b[sortCol] ?? "";
    if (sortCol === "created_at") {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const arrow = (key) => {
    if (sortCol !== key) return `<span class="sortArrow inactive">↕</span>`;
    return `<span class="sortArrow">${sortDir === "asc" ? "↑" : "↓"}</span>`;
  };

  const headCells = cols.map(c =>
    `<th data-col="${c.key}" class="sortable${sortCol === c.key ? " sorted" : ""}">${escapeHtml(c.label)} ${arrow(c.key)}</th>`
  ).join("");

  const rows = sorted.map(o => {
    const shortId = o.id.slice(0, 8);
    const isSelected = o.id === selectedId;

    const cells = cols.map(c => {
      switch (c.key) {
        case "id":
          return `<td><span class="idCell" data-fullid="${escapeHtml(o.id)}" title="Clique para copiar UUID">${escapeHtml(shortId)}…</span></td>`;
        case "created_at":
          return `<td>${escapeHtml(formatDateTime(o.created_at))}</td>`;
        case "catalog":
          return `<td>${escapeHtml(o.catalog || "—")}</td>`;
        case "customer":
          return `<td>${escapeHtml(o.customer || "—")}</td>`;
        case "user":
          return `<td class="userCell"><span class="userName">${escapeHtml(o.user_name || "—")}</span><span class="userEmail">${escapeHtml(o.user_email || "")}</span></td>`;
        default:
          return `<td>—</td>`;
      }
    }).join("");

    return `<tr class="orderRow${isSelected ? " selected" : ""}" data-id="${escapeHtml(o.id)}">${cells}</tr>`;
  }).join("");

  host.innerHTML = `
    <table class="ordersTable">
      <thead><tr>${headCells}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols.length}" class="emptyCell">Sem pedidos.</td></tr>`}</tbody>
    </table>
  `;

  // Sort click
  host.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = col === "created_at" ? "desc" : "asc";
      }
      renderOrdersTable(orders, isCustomer, onSelect, window.__selectedOrderId);
    });
  });

  // Row select click
  host.querySelectorAll("tr.orderRow").forEach(tr => {
    tr.addEventListener("click", (e) => {
      // Don't trigger row select if clicking the ID copy cell
      if (e.target.closest(".idCell")) return;
      onSelect(tr.dataset.id);
    });
  });

  // ID copy click
  host.querySelectorAll(".idCell").forEach(span => {
    span.addEventListener("click", (e) => {
      e.stopPropagation();
      const full = span.dataset.fullid;
      navigator.clipboard.writeText(full).then(() => {
        const orig = span.textContent;
        span.textContent = "Copiado!";
        span.classList.add("copied");
        setTimeout(() => {
          span.textContent = orig;
          span.classList.remove("copied");
        }, 1200);
      });
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const role = window.__userRole || "";
  const isInternal = role === "internal";
  const isCustomer = role === "customer";

  // Hide entire orders panel for internal role
  const ordersPanel = $("ordersPanel");
  if (isInternal && ordersPanel) {
    ordersPanel.style.display = "none";
  }

  // ── ORDERS ────────────────────────────────────────────────────────────────
  if (!isInternal) {
    const ordersTableWrap = $("ordersTableWrap");
    if (ordersTableWrap) ordersTableWrap.innerHTML = `<div class="listEmpty">A carregar…</div>`;

    let allOrders = [];

    try {
      let query = window.sb
        .from("order_requests")
        .select(`
          id,
          created_at,
          content_text,
          catalog_id,
          customer_id,
          user_id,
          catalogs ( name ),
          customers ( name ),
          profiles ( requested_full_name, requested_email )
        `)
        .order("created_at", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      allOrders = (data || []).map(row => ({
        id: row.id,
        created_at: row.created_at,
        content: row.content_text || "",
        catalog: row.catalogs?.name || row.catalog_id || "—",
        customer: row.customers?.name || "—",
        user_name: row.profiles?.requested_full_name || "—",
        user_email: row.profiles?.requested_email || "",
      }));
    } catch (e) {
      console.error("Failed to load order_requests:", e);
      if (ordersTableWrap) ordersTableWrap.innerHTML = `<div class="listEmpty">Erro a carregar pedidos.</div>`;
      return;
    }

    window.__selectedOrderId = allOrders[0]?.id || null;

    const openOrder = (id) => {
      window.__selectedOrderId = id;
      const hit = allOrders.find(x => x.id === id);
      const viewer = $("txtViewer");
      if (viewer) viewer.textContent = hit?.content || "Ficheiro vazio.";
      renderOrdersTable(allOrders, isCustomer, openOrder, id);
    };

    renderOrdersTable(allOrders, isCustomer, openOrder, window.__selectedOrderId);

    if (allOrders.length) openOrder(allOrders[0].id);

    // Expose reload hook for post-send refresh (called by order modal in client-area.html)
    window.__reloadOrders = async () => {
      const ordersTableWrap = $("ordersTableWrap");
      if (ordersTableWrap) ordersTableWrap.innerHTML = `<div class="listEmpty">Loading…</div>`;
      await main();
    };
  }

  // ── CATALOGUES ────────────────────────────────────────────────────────────
  const catHost = $("cataloguesList");
  if (catHost) catHost.innerHTML = `<div class="listEmpty">A carregar…</div>`;

  try {
    const role = window.__userRole || "";
    const isDraftVisible = ["admin", "catalog_manager"].includes(role);

    const { data: cats, error: catErr } = await window.sb
      .from("catalogs")
      .select("id, name, pai_code, description, status")
      .in("status", isDraftVisible ? ["published", "draft"] : ["published"])
      .order("name");

    if (catHost) catHost.innerHTML = "";

    if (catErr || !cats?.length) {
      if (catHost) catHost.innerHTML = `<div class="listEmpty">Sem catálogos disponíveis.</div>`;
    } else {
      cats.forEach((c) => {
        const a = document.createElement("a");
        a.className = "listRow linkRow";
        a.href = `interactive-catalog.html?catalog=${encodeURIComponent(c.pai_code)}`;
        a.innerHTML = `
          <div class="listTop">${escapeHtml(c.name)}${c.status === "draft" ? ' <span class="draftBadge">draft</span>' : ""}</div>
          <div class="listSub">${escapeHtml(c.description || c.pai_code)}</div>
        `.trim();
        catHost.appendChild(a);
      });
    }
  } catch (e) {
    if ($("cataloguesList")) $("cataloguesList").innerHTML = `<div class="listEmpty">Erro a carregar catálogos.</div>`;
  }
}

main().catch((e) => {
  console.error(e);
  const w = $("ordersTableWrap");
  if (w) w.innerHTML = `<div class="listEmpty">Erro a carregar client area.</div>`;
});
