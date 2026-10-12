(() => {
  "use strict";

  // ======================================================== configuración
  const ORDER = ["tin", "lead", "silver", "copper", "zinc", "aluminium", "gold"];
  const OZ_PER_KG = 32.1507466;
  const ALLOYS = [
    { id: "sn63", name: "Sn63/Pb37", c: { tin: 63, lead: 37 } },
    { id: "sn60", name: "Sn60/Pb40", c: { tin: 60, lead: 40 } },
    { id: "sn50", name: "Sn50/Pb50", c: { tin: 50, lead: 50 } },
    { id: "sn40", name: "Sn40/Pb60", c: { tin: 40, lead: 60 } },
    { id: "sncu", name: "Sn99.3/Cu0.7", c: { tin: 99.3, copper: 0.7 } },
    { id: "sac305", name: "SAC305 (Sn96.5/Ag3/Cu0.5)", c: { tin: 96.5, silver: 3, copper: 0.5 } },
    { id: "sac0307", name: "SAC0307 (Sn99/Ag0.3/Cu0.7)", c: { tin: 99, silver: 0.3, copper: 0.7 } },
    { id: "custom", name: "Personalizada", c: null },
  ];
  const COMP_KEYS = [["tin", "Sn %"], ["lead", "Pb %"], ["copper", "Cu %"], ["silver", "Ag %"]];
  const BASES = [["last", "Último cierre"], ["mtd", "Promedio mes en curso"], ["prev", "Promedio mes anterior"]];
  const VIEWS = { precios: "Precios", promedios: "Promedios", calc: "Calculadoras", alertas: "Alertas" };
  const DEMO = new URLSearchParams(location.search).has("demo");
  const $ = (id) => document.getElementById(id);

  const S = {
    metal: get("metal", "tin"), days: Number(get("days", 66)), cur: get("cur", "USD"),
    view: get("view", "precios"), mode: get("mode", "precio"), avgMetal: get("avgMetal", "tin"),
  };
  let DATA = null, ALERTS = null;

  // ======================================================== utilidades
  function get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
  function set(k, v) { S[k] = v; try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
  const getJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const setJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };

  const DEC = { "USD/t": 0, "USD/oz": 2, "MXN/kg": 2, "USD/kg": 3, t: 0, "%": 2, MXN: 0, USD: 0, FIX: 4 };
  function fmt(v, unit, dec) {
    if (v == null || !isFinite(v)) return "—";
    const d = dec ?? DEC[unit] ?? 2;
    return v.toLocaleString("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  const sign = (v, s) => (v > 0 ? "+" : "") + s;
  const pct = (v) => v == null || !isFinite(v) ? "—" : sign(v, fmt(v, "%") + "%");
  const fmtDate = (iso, o = { day: "numeric", month: "short", year: "numeric" }) =>
    new Date(iso + "T12:00:00").toLocaleDateString("es-MX", o);
  const monthName = (ym) => new Date(ym + "-15T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "numeric" });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const svgEl = (tag, a = {}) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const ym = (d) => d.slice(0, 7);
  const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
  const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toLocaleDateString("en-CA").slice(0, 7); };
  const avg = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

  // ======================================================== datos
  const metal = (k) => DATA?.metals?.[k];
  const isLME = (k) => metal(k)?.kind === "lme" || metal(k)?.unit === "USD/t";
  function series(k) {
    const m = metal(k);
    if (!m) return [];
    return m.history.map((r) => ({ date: r.date, v: r.cash ?? r.close, m3: r.m3 ?? null, stock: r.stock ?? null })).filter((r) => r.v != null);
  }
  const FX = () => DATA?.fx?.usdmxn?.history || [];
  function fxAt(date) {
    const h = FX();
    let lo = 0, hi = h.length - 1, best = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (h[mid].date <= date) { best = h[mid].fix; lo = mid + 1; } else hi = mid - 1; }
    return best;
  }
  const lastFx = () => { const h = FX(); return h.length ? h[h.length - 1] : null; };
  const usdKg = (k, v) => v == null ? null : isLME(k) ? v / 1000 : v * OZ_PER_KG;
  // Valor en la moneda elegida
  function disp(k, v, date) {
    if (S.cur === "MXN") { const fx = fxAt(date); return { v: fx ? usdKg(k, v) * fx : null, unit: "MXN/kg" }; }
    return { v, unit: metal(k).unit };
  }
  function lastChange(s) {
    if (s.length < 2) return null;
    const a = s[s.length - 2].v, b = s[s.length - 1].v;
    return { abs: b - a, pct: ((b - a) / a) * 100 };
  }
  function monthly(k) {
    const by = new Map();
    for (const r of series(k)) {
      const key = ym(r.date);
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(r);
    }
    return [...by.entries()].map(([month, rows]) => {
      const fxs = rows.map((r) => fxAt(r.date)).filter(Boolean);
      const mxn = rows.map((r) => { const fx = fxAt(r.date); return fx ? usdKg(k, r.v) * fx : null; }).filter((x) => x != null);
      return { month, n: rows.length, cash: avg(rows.map((r) => r.v)), m3: avg(rows.map((r) => r.m3).filter((x) => x != null)), fix: avg(fxs), mxn: avg(mxn), last: rows[rows.length - 1].date };
    }).sort((a, b) => a.month < b.month ? 1 : -1);
  }
  // Precio base de un metal en USD/kg y el FIX correspondiente
  function basePrice(k, base) {
    if (base === "last") {
      const s = series(k); const r = s[s.length - 1];
      return r ? { usdkg: usdKg(k, r.v), fx: fxAt(r.date), label: "cierre " + fmtDate(r.date, { day: "numeric", month: "short" }) } : null;
    }
    const target = base === "mtd" ? thisMonth() : prevMonth();
    const m = monthly(k).find((x) => x.month === target);
    return m ? { usdkg: usdKg(k, m.cash), fx: m.fix, label: "prom. " + monthName(target) + ` (${m.n} días)` } : null;
  }

  // ======================================================== carga
  async function load(force = false) {
    $("refresh").classList.add("spin");
    const before = DATA?.updated;
    try {
      if (DEMO) { DATA = demoData(); ALERTS = { reglas: [{ metal: "tin", tipo: "movimiento", valor: 3 }, { metal: "lead", tipo: "baja", valor: 1900 }] }; }
      else {
        // Siempre directo al servidor (sin caché del navegador ni del service worker)
        const r = await fetch("data/prices.json?t=" + Date.now(), { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        DATA = await r.json();
        try { const a = await fetch("alerts.json?t=" + Date.now(), { cache: "no-store" }); ALERTS = a.ok ? await a.json() : null; } catch { /* sin alertas */ }
      }
      if (!metal(S.metal)) S.metal = ORDER.find((k) => metal(k)) || "tin";
      render();
      if (force) toast(DATA.updated !== before ? "Precios actualizados." :
        `Sin cambios: el servidor tiene los datos del ${fmtStamp(DATA.updated)}; los precios se generan de lunes a viernes a las 12:10 y 16:10 (hora CDMX).`);
    } catch (e) {
      $("updated").textContent = "No se pudieron cargar los precios";
      banner("Sin conexión o sin datos todavía. Si acabas de publicar la app, corre la acción “Actualizar precios” en GitHub.");
      if (force) toast("No se pudo conectar con el servidor (" + (e.message || "sin conexión") + ").");
    } finally { $("refresh").classList.remove("spin"); }
  }
  const fmtStamp = (iso) => iso ? new Date(iso).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  let toastT;
  function toast(t) { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (e.hidden = true), 6000); }
  // Última corrida programada (L–V 18:10 y 22:10 UTC) con 2 h de margen por retrasos de GitHub
  function lastScheduledRun() {
    const t = new Date(Date.now() - 2 * 3600e3);
    for (let i = 0; i < 8; i++) {
      const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - i));
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      for (const h of [22, 18]) { const run = new Date(d.getTime() + (h * 60 + 10) * 60e3); if (run <= t) return run; }
    }
    return null;
  }
  function banner(t) { $("banner").textContent = t; $("banner").hidden = !t; }

  // ======================================================== render general
  function render() {
    if (!DATA) return;
    const upd = DATA.updated ? new Date(DATA.updated) : null;
    const fx = lastFx();
    $("updated").textContent = (upd ? "Act. " + upd.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—") +
      (fx ? ` · FIX ${fmt(fx.fix, "FIX")}` : "");
    const notes = [];
    if (DEMO) notes.push("MODO DEMO: datos simulados, no son precios reales.");
    if (!Object.keys(DATA.metals || {}).length) notes.push("Todavía no hay precios. En GitHub, abre Actions → “Actualizar precios” → Run workflow.");
    else if (DATA.errors?.length) notes.push("Algunas fuentes no respondieron en la última actualización; se muestran los últimos datos guardados.");
    const due = lastScheduledRun();
    if (!DEMO && upd && due && upd < due) notes.push(`La actualización automática no ha corrido desde el ${fmtStamp(DATA.updated)}; en GitHub revisa la pestaña Actions: si la última ejecución está en rojo, ábrela para ver el error.`);
    if (S.cur === "MXN" && !fx) notes.push("Aún no hay tipo de cambio; los precios en MXN aparecerán tras la próxima actualización.");
    banner(notes.join(" "));

    document.querySelectorAll("#cur button").forEach((b) => b.classList.toggle("on", b.dataset.cur === S.cur));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === S.view));
    for (const v in VIEWS) $("view-" + v).hidden = v !== S.view;
    $("title").textContent = VIEWS[S.view];
    $("cur").hidden = S.view === "calc" || S.view === "alertas";

    if (S.view === "precios") { renderList(); renderDetail(); }
    if (S.view === "promedios") renderAverages();
    if (S.view === "calc") { renderAlloy(); renderScrap(); }
    if (S.view === "alertas") renderAlerts();

    const srcs = ORDER.filter(metal).map((k) => `${metal(k).name}: ${metal(k).source}`);
    if (DATA.fx?.usdmxn) srcs.push(`Tipo de cambio: ${DATA.fx.usdmxn.source}`);
    $("foot").textContent = "Cierres diarios. Metales LME: Cash-Settlement en USD/t. Plata y oro en USD/oz troy. MXN/kg = USD/kg × tipo de cambio del mismo día. " +
      srcs.join(" · ") + ". Uso informativo; no sustituye la cotización oficial de LME.";
  }

  // ======================================================== PRECIOS
  function renderList() {
    const box = $("list");
    box.replaceChildren();
    for (const k of ORDER) {
      const m = metal(k);
      if (!m) continue;
      const s = series(k), last = s[s.length - 1], ch = lastChange(s);
      const cls = !ch ? "flat" : ch.abs > 0 ? "up" : ch.abs < 0 ? "down" : "flat";
      const d = last ? disp(k, last.v, last.date) : { v: null, unit: m.unit };
      const b = el("button", "row" + (k === S.metal ? " on" : ""));
      const left = el("div"); left.append(el("div", "name", m.name), el("div", "meta", last ? `${d.unit} · ${fmtDate(last.date, { day: "numeric", month: "short" })}` : "sin datos"));
      const right = el("div"); right.append(el("div", "price", fmt(d.v, d.unit)), el("div", "chg " + cls, ch ? `${ch.abs > 0 ? "▲" : ch.abs < 0 ? "▼" : "■"} ${pct(ch.pct)}` : ""));
      b.append(left, right);
      b.addEventListener("click", () => { set("metal", k); renderList(); renderDetail(); });
      box.append(b);
    }
  }

  function renderDetail() {
    const k = S.metal, m = metal(k);
    if (!m) return;
    const lme = isLME(k);
    if (!lme && S.mode !== "precio") S.mode = "precio";
    $("mode").hidden = !lme;
    document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.mode));
    document.querySelectorAll("#range button").forEach((b) => b.classList.toggle("on", Number(b.dataset.days) === S.days));

    const all = series(k), s = all.slice(-S.days);
    const unitNow = S.cur === "MXN" ? "MXN/kg" : m.unit;
    $("d-name").textContent = m.name;

    // Gráfica según modo
    if (S.mode === "spread") {
      const pts = s.filter((r) => r.m3 != null).map((r) => ({ date: r.date, v: disp(k, r.v - r.m3, r.date).v }));
      $("d-meta").textContent = `Cash menos 3 meses, ${unitNow} · positivo = backwardation`;
      drawChart(pts, unitNow, "bars");
    } else if (S.mode === "stock") {
      const pts = s.filter((r) => r.stock != null).map((r) => ({ date: r.date, v: r.stock }));
      $("d-meta").textContent = "Toneladas en bodegas LME";
      drawChart(pts, "t", "line");
    } else {
      const pts = s.map((r) => ({ date: r.date, v: disp(k, r.v, r.date).v })).filter((p) => p.v != null);
      $("d-meta").textContent = `${unitNow} · ${m.source}`;
      drawChart(pts, unitNow, "line");
    }

    // Estadísticas
    const st = $("stats");
    st.replaceChildren();
    const item = (label, value, small) => {
      const d = el("div"), dd = el("dd", null, value);
      if (small) dd.append(el("small", null, " " + small));
      d.append(el("dt", null, label), dd); st.append(d);
    };
    if (!s.length) return;
    const last = s[s.length - 1], ch = lastChange(all);
    const L = (v) => disp(k, v, last.date).v;
    const vals = s.map((r) => disp(k, r.v, r.date).v).filter((v) => v != null);
    const first = vals[0];

    item(lme ? "Cash" : "Cierre", fmt(L(last.v), unitNow));
    if (ch) item("Cambio diario", sign(ch.abs, fmt(S.cur === "MXN" ? L(last.v) - L(last.v - ch.abs) : ch.abs, unitNow)), pct(ch.pct));
    if (lme && last.m3 != null) {
      item("3 meses", fmt(L(last.m3), unitNow));
      const sp = last.v - last.m3;
      item("Spread cash–3M", sign(sp, fmt(L(sp), unitNow)), sp > 0 ? "backwardation" : sp < 0 ? "contango" : "");
    }
    if (lme && last.stock != null) {
      const prevStock = all.length > 1 ? all[all.length - 2].stock : null;
      item("Inventario LME", fmt(last.stock, "t"), prevStock != null ? `t (${sign(last.stock - prevStock, fmt(last.stock - prevStock, "t"))})` : "t");
    }
    const mtd = monthly(k).find((x) => x.month === thisMonth());
    if (mtd) item("Promedio del mes", fmt(S.cur === "MXN" ? mtd.mxn : mtd.cash, unitNow), `${mtd.n} días`);
    item("Máx. del periodo", fmt(Math.max(...vals), unitNow));
    item("Mín. del periodo", fmt(Math.min(...vals), unitNow));
    item("Var. del periodo", pct(((vals[vals.length - 1] - first) / first) * 100), "desde " + fmtDate(s[0].date, { day: "numeric", month: "short" }));
    if (S.cur === "USD") item("Por kg", fmt(usdKg(k, last.v), "USD/kg"), "USD/kg");
  }

  // Gráfica SVG propia (línea o barras), sin librerías
  function drawChart(pts, unit, kind) {
    const svg = $("chart"), wrap = $("chart-wrap"), tip = $("tip");
    svg.replaceChildren(); tip.hidden = true;
    wrap.querySelector(".empty")?.remove();
    if (pts.length < 2) {
      svg.style.display = "none";
      wrap.append(el("div", "empty", kind === "bars" || unit === "t" ? "Sin datos de 3 meses o inventario para este periodo." : "Aún no hay suficiente historial para graficar."));
      return;
    }
    svg.style.display = "";
    const W = Math.max(280, wrap.clientWidth), H = 230, pad = { l: 4, r: 62, t: 14, b: 24 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
    const vals = pts.map((p) => p.v);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (kind === "bars") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const py = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1; lo -= kind === "bars" && lo === 0 ? 0 : py; hi += py;
    const iw = W - pad.l - pad.r, n = pts.length;
    const x = (i) => pad.l + (kind === "bars" ? (i + 0.5) / n : i / (n - 1)) * iw;
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

    const g = svgEl("g", { class: "grid" }), ax = svgEl("g", { class: "axis" });
    for (const t of niceTicks(lo, hi, 4)) {
      g.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t) }));
      const tx = svgEl("text", { x: W - pad.r + 6, y: y(t) + 4 }); tx.textContent = fmt(t, unit, Math.abs(hi - lo) < 10 ? 2 : 0); ax.append(tx);
    }
    const nx = Math.min(4, n);
    for (let j = 0; j < nx; j++) {
      const i = Math.round((j / (nx - 1)) * (n - 1));
      const tx = svgEl("text", { x: x(i), y: H - 6, "text-anchor": j === 0 ? "start" : j === nx - 1 ? "end" : "middle" });
      tx.textContent = fmtDate(pts[i].date, S.days > 300 ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
      ax.append(tx);
    }
    svg.append(g, ax);

    if (kind === "bars") {
      const bw = Math.max(1, iw / n - (n > 120 ? 0 : 1));
      const bars = svgEl("g");
      pts.forEach((p, i) => {
        const y0 = y(0), y1 = y(p.v);
        bars.append(svgEl("rect", { class: "bar" + (p.v < 0 ? " neg" : ""), x: x(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)) }));
      });
      svg.append(bars, svgEl("line", { class: "zero", x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) }));
    } else {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      svg.append(svgEl("path", { d: `${d}L${x(n - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`, class: "area" }), svgEl("path", { d, class: "line" }));
    }

    const cross = svgEl("line", { class: "cross", y1: pad.t, y2: H - pad.b, visibility: "hidden" });
    const dot = svgEl("circle", { class: "dot", r: 4, visibility: "hidden" });
    svg.append(cross, dot);
    const move = (cx) => {
      const rect = svg.getBoundingClientRect(), px = ((cx - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(n - 1, kind === "bars" ? Math.floor(((px - pad.l) / iw) * n) : Math.round(((px - pad.l) / iw) * (n - 1))));
      const X = x(i), Y = y(pts[i].v);
      cross.setAttribute("x1", X); cross.setAttribute("x2", X); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X); dot.setAttribute("cy", Y); dot.setAttribute("visibility", kind === "bars" ? "hidden" : "visible");
      tip.textContent = `${fmtDate(pts[i].date)} · ${kind === "bars" ? sign(pts[i].v, fmt(pts[i].v, unit)) : fmt(pts[i].v, unit)} ${unit}`;
      tip.hidden = false;
      const left = (X / W) * rect.width, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(rect.width - tw, left - tw / 2)) + "px";
    };
    const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
    svg.onpointermove = (e) => move(e.clientX);
    svg.onpointerdown = (e) => move(e.clientX);
    svg.onpointerleave = hide;
    svg.onpointerup = (e) => { if (e.pointerType !== "mouse") setTimeout(hide, 1500); };
  }
  function niceTicks(lo, hi, count) {
    const span = hi - lo, mag = Math.pow(10, Math.floor(Math.log10(span / count)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(6));
    return out;
  }

  // ======================================================== PROMEDIOS
  function renderAverages() {
    if (!metal(S.avgMetal)) S.avgMetal = ORDER.find(metal) || "tin";
    const chips = $("avg-metal");
    chips.replaceChildren();
    for (const k of ORDER) {
      if (!metal(k)) continue;
      const b = el("button", k === S.avgMetal ? "on" : "", metal(k).name);
      b.addEventListener("click", () => { set("avgMetal", k); renderAverages(); });
      chips.append(b);
    }
    const k = S.avgMetal, m = metal(k), lme = isLME(k);
    const rows = monthly(k);
    const mxn = S.cur === "MXN";
    const unit = mxn ? "MXN/kg" : m.unit;
    const val = (r) => mxn ? r.mxn : r.cash;

    const kp = $("avg-kpis");
    kp.replaceChildren();
    const card = (label, r, extra) => {
      const c = el("div", "kpi");
      c.append(el("div", "lbl", label), el("div", "val", r ? fmt(val(r), unit) : "—"), el("div", "ex", r ? extra(r) : "sin datos"));
      kp.append(c);
    };
    const cur = rows.find((r) => r.month === thisMonth()), prev = rows.find((r) => r.month === prevMonth());
    card(`Mes en curso · ${monthName(thisMonth())}`, cur, (r) => `${unit} · ${r.n} días al ${fmtDate(r.last, { day: "numeric", month: "short" })}`);
    card(`Mes anterior · ${monthName(prevMonth())}`, prev, (r) => `${unit} · ${r.n} días` + (cur && prev ? ` · cambio ${pct((val(cur) - val(prev)) / val(prev) * 100)}` : ""));

    const t = $("avg-table");
    t.replaceChildren();
    const head = el("tr");
    const cols = ["Mes", `Cash ${m.unit}`].concat(lme ? [`3M ${m.unit}`] : [], ["FIX prom.", "MXN/kg", "Días"]);
    cols.forEach((c) => head.append(el("th", null, c)));
    const thead = el("thead"); thead.append(head); t.append(thead);
    const tb = el("tbody");
    for (const r of rows.slice(0, 13)) {
      const tr = el("tr", r.month === thisMonth() ? "cur" : "");
      tr.append(el("td", null, monthName(r.month) + (r.month === thisMonth() ? " *" : "")), el("td", null, fmt(r.cash, m.unit)));
      if (lme) tr.append(el("td", null, fmt(r.m3, m.unit)));
      tr.append(el("td", null, fmt(r.fix, "FIX")), el("td", null, fmt(r.mxn, "MXN/kg")), el("td", null, String(r.n)));
      tb.append(tr);
    }
    t.append(tb);
  }

  // ======================================================== CALCULADORAS
  const CALC = Object.assign({ preset: "sn63", comp: { tin: 63, lead: 37, copper: 0, silver: 0 }, aBase: "last", merma: 2, conv: 0, sMat: "tin", sBase: "last", cont: 95, pay: 85, kg: 1000 }, getJSON("calc") || {});
  const saveCalc = () => setJSON("calc", CALC);
  let calcBuilt = false;

  function buildCalc() {
    if (calcBuilt) return; calcBuilt = true;
    for (const sel of document.querySelectorAll(".base-select")) BASES.forEach(([v, t]) => sel.append(new Option(t, v)));
    ALLOYS.forEach((a) => $("a-preset").append(new Option(a.name, a.id)));
    const comp = $("a-comp");
    COMP_KEYS.forEach(([k, lbl]) => {
      const l = el("label", null, lbl), i = el("input");
      Object.assign(i, { type: "number", step: "0.1", inputMode: "decimal", id: "c-" + k });
      i.addEventListener("input", () => { CALC.comp[k] = Number(i.value) || 0; CALC.preset = matchPreset(); $("a-preset").value = CALC.preset; saveCalc(); renderAlloy(); });
      l.append(i); comp.append(l);
    });
    $("a-preset").addEventListener("change", (e) => {
      CALC.preset = e.target.value;
      const a = ALLOYS.find((x) => x.id === CALC.preset);
      if (a.c) CALC.comp = Object.assign({ tin: 0, lead: 0, copper: 0, silver: 0 }, a.c);
      saveCalc(); renderAlloy();
    });
    const bind = (id, key, fn, num = true) => $(id).addEventListener(num ? "input" : "change", (e) => { CALC[key] = num ? Number(e.target.value) || 0 : e.target.value; saveCalc(); fn(); });
    bind("a-base", "aBase", renderAlloy, false); bind("a-merma", "merma", renderAlloy); bind("a-conv", "conv", renderAlloy);
    // Materiales de scrap: metales y aleaciones
    const og1 = el("optgroup"); og1.label = "Metal";
    ["tin", "lead", "copper", "zinc", "aluminium", "silver"].forEach((k) => og1.append(new Option(metal(k)?.name || k, k)));
    const og2 = el("optgroup"); og2.label = "Aleación (soldadura)";
    ALLOYS.filter((a) => a.c).forEach((a) => og2.append(new Option(a.name, "alloy:" + a.id)));
    $("s-mat").append(og1, og2);
    bind("s-mat", "sMat", renderScrap, false); bind("s-base", "sBase", renderScrap, false);
    bind("s-cont", "cont", renderScrap); bind("s-pay", "pay", renderScrap); bind("s-kg", "kg", renderScrap);
    // valores iniciales
    $("a-preset").value = CALC.preset; $("a-base").value = CALC.aBase; $("a-merma").value = CALC.merma; $("a-conv").value = CALC.conv;
    $("s-mat").value = CALC.sMat; $("s-base").value = CALC.sBase; $("s-cont").value = CALC.cont; $("s-pay").value = CALC.pay; $("s-kg").value = CALC.kg;
  }
  function matchPreset() {
    const c = CALC.comp;
    const a = ALLOYS.find((x) => x.c && COMP_KEYS.every(([k]) => Math.abs((x.c[k] || 0) - (c[k] || 0)) < 1e-9));
    return a ? a.id : "custom";
  }
  // Costo de metal por kg de una composición: {usdkg, fx, parts[], missing[]}
  function alloyCost(comp, base) {
    let usdkg = 0, fx = null; const parts = [], missing = [];
    for (const [k, p] of Object.entries(comp)) {
      if (!p) continue;
      const bp = basePrice(k, base);
      if (!bp) { missing.push(metal(k)?.name || k); continue; }
      fx = fx ?? bp.fx;
      const contrib = (p / 100) * bp.usdkg;
      usdkg += contrib; parts.push({ k, p, price: bp.usdkg, contrib, label: bp.label });
    }
    return { usdkg, fx, parts, missing };
  }

  function renderAlloy() {
    buildCalc();
    COMP_KEYS.forEach(([k]) => { const i = $("c-" + k); if (document.activeElement !== i) i.value = CALC.comp[k] || 0; });
    const box = $("a-result");
    box.replaceChildren();
    const total = COMP_KEYS.reduce((s, [k]) => s + (CALC.comp[k] || 0), 0);
    const r = alloyCost(CALC.comp, CALC.aBase);
    if (r.missing.length) box.append(el("div", "warn", `Sin precio para: ${r.missing.join(", ")} con esta base.`));
    if (Math.abs(total - 100) > 0.01) box.append(el("div", "warn", `La composición suma ${fmt(total, "%")}% (debería ser 100%).`));
    if (!r.parts.length) return;
    const withMerma = r.usdkg / (1 - Math.min(99, CALC.merma) / 100);
    const final = withMerma + CALC.conv;
    const big = el("div", "big", fmt(final, "USD/kg", 3)); big.append(el("small", null, " USD/kg"));
    box.append(el("div", "sub", `Costo total por kg (metal + merma + conversión) · base: ${r.parts[0].label}`), big,
      el("div", "alt", `${r.fx ? fmt(final * r.fx, "MXN/kg") + " MXN/kg · " : ""}${fmt(final * 1000, "USD/t")} USD/t${r.fx ? " · FIX " + fmt(r.fx, "FIX") : ""}`));
    const t = el("table", "tbl"), h = el("tr");
    ["Metal", "%", "USD/kg", "Aporta USD/kg"].forEach((c) => h.append(el("th", null, c)));
    const th = el("thead"); th.append(h); t.append(th);
    const tb = el("tbody");
    for (const p of r.parts) {
      const tr = el("tr");
      tr.append(el("td", null, metal(p.k).name), el("td", null, fmt(p.p, "%", 1)), el("td", null, fmt(p.price, "USD/kg")), el("td", null, fmt(p.contrib, "USD/kg")));
      tb.append(tr);
    }
    const add = (label, v) => { const tr = el("tr"); tr.append(el("td", null, label), el("td"), el("td"), el("td", null, fmt(v, "USD/kg"))); tb.append(tr); };
    add("Metal contenido", r.usdkg);
    add(`Merma ${fmt(CALC.merma, "%", 1)}%`, withMerma - r.usdkg);
    add("Conversión", CALC.conv);
    t.append(tb);
    const w = el("div", "table-wrap"); w.append(t); box.append(w);
  }

  function renderScrap() {
    buildCalc();
    const box = $("s-result");
    box.replaceChildren();
    let usdkg, fx, label;
    if (CALC.sMat.startsWith("alloy:")) {
      const a = ALLOYS.find((x) => x.id === CALC.sMat.slice(6));
      const r = alloyCost(a.c, CALC.sBase);
      if (r.missing.length) { box.append(el("div", "warn", `Sin precio para: ${r.missing.join(", ")} con esta base.`)); return; }
      usdkg = r.usdkg; fx = r.fx; label = `${a.name}: valor del metal contenido`;
    } else {
      const bp = basePrice(CALC.sMat, CALC.sBase);
      if (!bp) { box.append(el("div", "warn", "Sin precio para este metal con esta base.")); return; }
      usdkg = bp.usdkg; fx = bp.fx; label = `${metal(CALC.sMat)?.name} ${bp.label}`;
    }
    const perKg = usdkg * (CALC.cont / 100) * (CALC.pay / 100);
    const lot = perKg * CALC.kg;
    const big = el("div", "big", fmt(perKg, "USD/kg", 3)); big.append(el("small", null, " USD/kg a pagar"));
    box.append(el("div", "sub", `Base: ${label} = ${fmt(usdkg, "USD/kg")} USD/kg (${fmt(usdkg * 1000, "USD/t")} USD/t)`), big,
      el("div", "alt", `${fx ? fmt(perKg * fx, "MXN/kg") + " MXN/kg · " : ""}${fmt(perKg * 1000, "USD/t")} USD/t`));
    const kp = el("div", "kpis");
    const mk = (l, v, ex) => { const c = el("div", "kpi"); c.append(el("div", "lbl", l), el("div", "val", v), el("div", "ex", ex)); kp.append(c); };
    mk("Valor del lote USD", fmt(lot, "USD"), `${fmt(CALC.kg, "t")} kg`);
    mk("Valor del lote MXN", fx ? fmt(lot * fx, "MXN") : "—", fx ? `FIX ${fmt(fx, "FIX")}` : "sin tipo de cambio");
    box.append(kp);
  }

  // ======================================================== ALERTAS
  let alertsBuilt = false;
  function renderAlerts() {
    if (!alertsBuilt) {
      alertsBuilt = true;
      ORDER.forEach((k) => $("al-metal").append(new Option(metal(k)?.name || k, k)));
      ["al-metal", "al-tipo", "al-valor"].forEach((id) => $(id).addEventListener("input", updateRule));
      $("al-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText($("al-json").textContent); $("al-copy").textContent = "¡Copiada!"; }
        catch { $("al-copy").textContent = "Selecciona y copia el texto"; }
        setTimeout(() => ($("al-copy").textContent = "Copiar regla"), 1800);
      });
      const h = location.hostname;
      if (h.endsWith(".github.io")) {
        const repo = location.pathname.split("/").filter(Boolean)[0] || h;
        $("al-edit").href = `https://github.com/${h.split(".")[0]}/${repo}/edit/main/alerts.json`;
      } else $("al-edit").hidden = true;
    }
    updateRule();

    const box = $("al-list");
    box.replaceChildren();
    const rules = ALERTS?.reglas || [];
    if (!rules.length) { box.append(el("p", "sub", "No hay alertas configuradas.")); return; }
    for (const r of rules) {
      const m = metal(r.metal);
      if (!m) continue;
      const s = series(r.metal), last = s[s.length - 1], ch = lastChange(s);
      const row = el("div", "alert-row");
      let desc, status = "";
      if (r.tipo === "movimiento") {
        desc = `${m.name}: movimiento diario ≥ ${fmt(r.valor, "%", 1)}%`;
        if (ch) status = `Último cierre ${pct(ch.pct)}`;
      } else {
        desc = `${m.name} ${r.tipo === "sube" ? "sube por encima de" : "baja por debajo de"} ${fmt(r.valor, m.unit)} ${m.unit}`;
        if (last) status = `Último ${fmt(last.v, m.unit)} · a ${pct(((r.valor - last.v) / last.v) * 100)} del umbral`;
      }
      row.append(el("div", null, desc), el("div", "st", status));
      box.append(row);
    }
  }
  function updateRule() {
    const tipo = $("al-tipo").value;
    const k = $("al-metal").value;
    $("al-label").textContent = tipo === "movimiento" ? "Porcentaje (%)" : `Precio (${metal(k)?.unit || "USD"})`;
    const v = Number($("al-valor").value) || 0;
    $("al-json").textContent = JSON.stringify({ metal: k, tipo, valor: v });
  }

  // ======================================================== demo
  function demoData() {
    const days = []; const d = new Date(); d.setDate(d.getDate() - 560);
    while (days.length < 400) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) days.push(d.toISOString().slice(0, 10)); }
    const walk = (start, vol) => { let v = start; return days.map(() => (v *= 1 + (Math.random() - 0.49) * vol)); };
    const lme = (start, vol, stock) => { let st = stock; return walk(start, vol).map((v, i) => ({ date: days[i], cash: Math.round(v), m3: Math.round(v * (1 + (Math.random() - 0.55) * 0.012)), stock: Math.round((st = Math.max(stock * 0.2, st + (Math.random() - 0.5) * stock * 0.03))) })); };
    const pm = (start, vol) => walk(start, vol).map((v, i) => ({ date: days[i], close: +v.toFixed(2) }));
    const M = (name, kind, unit, history) => ({ name, kind, unit, source: "DEMO", history });
    return {
      updated: new Date().toISOString(), errors: [],
      metals: {
        tin: M("Estaño", "lme", "USD/t", lme(30000, 0.018, 4000)), lead: M("Plomo", "lme", "USD/t", lme(2000, 0.014, 200000)),
        copper: M("Cobre", "lme", "USD/t", lme(9500, 0.014, 150000)), zinc: M("Zinc", "lme", "USD/t", lme(2700, 0.015, 200000)),
        aluminium: M("Aluminio", "lme", "USD/t", lme(2500, 0.013, 500000)),
        silver: M("Plata", "precious", "USD/oz", pm(30, 0.018)), gold: M("Oro", "precious", "USD/oz", pm(2400, 0.009)),
      },
      fx: { usdmxn: { name: "USD/MXN", source: "DEMO", history: walk(18.5, 0.006).map((v, i) => ({ date: days[i], fix: +v.toFixed(4) })) } },
    };
  }

  // ======================================================== eventos
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { set("view", b.dataset.view); render(); scrollTo(0, 0); } });
  $("cur").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { set("cur", b.dataset.cur); render(); } });
  $("range").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { set("days", Number(b.dataset.days)); renderDetail(); } });
  $("mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { set("mode", b.dataset.mode); renderDetail(); } });
  $("refresh").addEventListener("click", () => load(true));
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => DATA && S.view === "precios" && renderDetail(), 150); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(true); });

  if ("serviceWorker" in navigator && !DEMO) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  load();
})();
