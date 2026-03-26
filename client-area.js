const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDateTime(iso) {
  if (!iso) return "(sem data)";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function renderOrdersSkeleton() {
  $("ordersList").innerHTML = "";
}

function createOrderRow({ label, subLabel, id, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "listRow";
  btn.dataset.id = id;

  const top = document.createElement("div");
  top.className = "listTop";
  top.textContent = label;

  const bottom = document.createElement("div");
  bottom.className = "listSub";
  bottom.textContent = subLabel;

  btn.append(top, bottom);
  btn.addEventListener("click", onClick);
  return btn;
}

function setSelectedRow(host, id) {
  host.querySelectorAll(".listRow").forEach(r =>
    r.classList.toggle("selected", r.dataset.id === id)
  );
}

async function main() {
  const ordersHost = $("ordersList");
  renderOrdersSkeleton();
  ordersHost.innerHTML = `<div class="listEmpty">A carregar…</div>`;

  // ── ORDERS from Supabase ──────────────────────────────────────────
  let allOrders = [];

  try {
    const { data, error } = await window.sb
      .from("order_requests")
      .select("id, created_at, content_text, catalog_id")
      .order("created_at", { ascending: false });

    if (error) throw error;

    allOrders = (data || []).map(row => ({
      id: row.id,
      createdAt: row.created_at,
      label: formatDateTime(row.created_at),
      subLabel: row.catalog_id ? `Catalog: ${row.catalog_id}` : "—",
      content: row.content_text || "",
    }));
  } catch (e) {
    console.error("Failed to load order_requests:", e);
    ordersHost.innerHTML = `<div class="listEmpty">Erro a carregar pedidos.</div>`;
    return;
  }

  ordersHost.innerHTML = "";

  if (!allOrders.length) {
    ordersHost.innerHTML = `<div class="listEmpty">Sem pedidos.</div>`;
  }

  const openOrder = (id) => {
    const hit = allOrders.find(x => x.id === id);
    if (!hit) return;
    setSelectedRow(ordersHost, id);
    $("txtViewer").textContent = hit.content || "Ficheiro vazio.";
  };

  for (const o of allOrders) {
    const row = createOrderRow({
      label: o.label,
      subLabel: o.subLabel,
      id: o.id,
      onClick: () => openOrder(o.id),
    });
    ordersHost.appendChild(row);
  }

  if (allOrders.length) openOrder(allOrders[0].id);

  // ── CATALOGUES from Supabase ──────────────────────────────────────
  const catHost = $("cataloguesList");
  catHost.innerHTML = `<div class="listEmpty">A carregar…</div>`;

  try {
    const { data: cats, error: catErr } = await window.sb
      .from("catalogs")
      .select("id, name, pai_code, description")
      .eq("status", "published")
      .order("name");

    catHost.innerHTML = "";

    if (catErr || !cats?.length) {
      catHost.innerHTML = `<div class="listEmpty">Sem catálogos disponíveis.</div>`;
    } else {
      cats.forEach((c, idx) => {
        const a = document.createElement("a");
        a.className = "listRow linkRow" + (idx === 0 ? " selected" : "");
        a.href = `interactive-catalog.html?catalog=${encodeURIComponent(c.pai_code)}`;
        a.innerHTML = `
          <div class="listTop">${escapeHtml(c.name)}</div>
          <div class="listSub">${escapeHtml(c.description || c.pai_code)}</div>
        `.trim();
        catHost.appendChild(a);
      });
    }
  } catch (e) {
    catHost.innerHTML = `<div class="listEmpty">Erro a carregar catálogos.</div>`;
  }
}

main().catch((e) => {
  console.error(e);
  const ordersHost = $("ordersList");
  if (ordersHost) ordersHost.innerHTML = `<div class="listEmpty">Erro a carregar client area.</div>`;
});
