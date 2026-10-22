// Explain the Model: three interactive explainers (GitHub Pages route, static files only).
// Every number shown comes from outputs/<dataset>.json or the helpers in m10.js.
import * as m10 from "./m10.js";

const LABELS = { glucose: "Fasting glucose", sbp: "Blood pressure", fev1: "Lung function (FEV₁)" };
const SECTIONS = {
  linear: { title: "Push & Pull", sub: "linear regression" },
  forest: { title: "Wisdom of the Forest", sub: "random forest" },
  boosting: { title: "One Correction at a Time", sub: "gradient boosting" },
};
const ORDER = ["linear", "forest", "boosting"];
const state = { key: "glucose", person: "P1", values: null, sel: null, nTrees: 10, round: 1, stop: null, lr02: false };

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v, d = 1) => (v >= 0 ? "+" : "−") + fmt(Math.abs(v), d);
const short = (label) => label.replace(/\s*\(.*?\)/g, "").trim();
const featureOf = (b, name) => b.features.find((f) => f.name === name);
const sdev = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
const coefFmt = (c) => { const a = Math.abs(c); return signed(c, a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3); };
const valFmt = (v) => fmt(v, Number.isInteger(v) ? 0 : 1);

function section() {
  const s = location.hash.slice(1);
  return ORDER.includes(s) ? s : "linear";
}

// ---- Setup, header and routing ----------------------------------------------
let renderToken = 0;

async function setup() {
  $("dataset").innerHTML = m10.DATASETS.map((k) => `<option value="${k}">${LABELS[k]}</option>`).join("");
  $("dataset").onchange = async (e) => { state.key = e.target.value; state.person = "P1"; state.values = null; state.sel = null; state.stop = null; await loadPeople(); render(); };
  $("person").onchange = (e) => setPerson(e.target.value);
  window.onhashchange = () => { window.scrollTo(0, 0); render(); };
  await loadPeople();
  render();
}

function setPerson(id) {
  state.person = id; state.values = null; state.sel = null;
  $("person").value = id;
  render();
}

async function loadPeople() {
  const b = await m10.loadBundle(state.key);
  $("person").innerHTML = b.people.map((p) => `<option value="${p.id}">${p.label}: ${p.description} (${p.why_chosen})</option>`).join("");
  $("person").value = state.person;
  $("context").textContent = `${b.target_label} (${b.units}), predicted from ${b.features.length - b.categorical_groups.reduce((n, g) => n + g.levels.filter((l) => l.column).length - 1, 0)} features. ` +
    `${fmt(b.n_train, 0)} training people fit the models; ${fmt(b.n_validation, 0)} validation people were held back to check them.`;
}

async function render() {
  const token = ++renderToken;
  const s = section();
  document.querySelectorAll("nav a").forEach((a) => {
    const on = a.hash === "#" + s;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.title = `${SECTIONS[s].title} (${SECTIONS[s].sub}) · Explain the Model`;
  const b = await m10.loadBundle(state.key);
  if (token !== renderToken) return;
  const person = b.people.find((p) => p.id === state.person);
  if (!state.values) state.values = { ...person.values };
  const draw = { linear: renderLinear, forest: renderForest, boosting: renderBoosting }[s];
  draw(b, person);
  $("section").insertAdjacentHTML("beforeend", pager(s));
}

function pager(s) {
  const i = ORDER.indexOf(s);
  const link = (k, dir) => (k < 0 || k >= ORDER.length ? "<span></span>" : `<a href="#${ORDER[k]}">${dir === "prev" ? "← " : ""}${SECTIONS[ORDER[k]].title}${dir === "next" ? " →" : ""}</a>`);
  return `<div class="next">${link(i - 1, "prev")}${link(i + 1, "next")}</div>`;
}

// ---- Shared bits ----------------------------------------------------------
function personLine(b, person, values = person.values) {
  const groups = b.categorical_groups;
  const grouped = new Set(groups.flatMap((g) => g.levels.filter((l) => l.column).map((l) => l.column)));
  const bits = [
    ...groups.map((g) => `${g.label}: ${m10.categoryOf(b, g.name, values)}`),
    ...b.features.filter((f) => !grouped.has(f.name)).map((f) => `${short(f.label)}: ${valFmt(values[f.name])} ${f.units}`),
  ];
  return `<p class="who"><b>${person.label}</b> <span class="chip">${person.why_chosen}</span><br>${bits.join(" · ")}</p>`;
}

function goalBox(text) { return `<div class="goal"><b>After this section you can:</b> ${text}</div>`; }

function niceTicks(lo, hi, n = 5) {
  const raw = (hi - lo) / n || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) ticks.push(Math.round(t / step) * step);
  return { ticks, dec: step >= 1 ? 0 : Math.ceil(-Math.log10(step)) };
}

// Generic line chart (inline SVG) with labelled axes.
// opts: xs, series[{y, color, dash, name}], xlabel, ylabel, xScale ("linear"|"sqrt"), xTicks, hlines[{y,label,color}],
// vlines[{x,label,color,dash,row}], points[{x,y,color,label}], label (aria-label)
function lineChart(o) {
  const W = 720, H = 280, ml = 66, mr = 16, mt = 34, mb = 48;
  const xs = o.xs, x0 = xs[0], x1 = xs[xs.length - 1];
  const sx = (v) => {
    const t = o.xScale === "sqrt" ? Math.sqrt(v - x0) / Math.sqrt(x1 - x0) : (v - x0) / (x1 - x0);
    return ml + t * (W - ml - mr);
  };
  const ys = [...o.series.flatMap((s) => s.y), ...(o.hlines || []).map((h) => h.y), ...(o.points || []).map((p) => p.y)];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const sy = (v) => H - mb - ((v - lo) / (hi - lo)) * (H - mt - mb);
  const { ticks, dec } = niceTicks(lo, hi, 5);
  const path = (s) => s.y.map((v, i) => `${i ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  let legendX = ml;
  const legend = o.series.map((s) => {
    const g = `<line x1="${legendX}" x2="${legendX + 22}" y1="12" y2="12" stroke="${s.color}" stroke-width="3" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/><text x="${legendX + 27}" y="16">${s.name}</text>`;
    legendX += 27 + s.name.length * 5.8 + 18;
    return g;
  }).join("");
  const anchor = (x) => (x < W * 0.55 ? ["start", x + 4] : ["end", x - 4]);
  return `<div class="scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label}">
    ${legend}
    ${ticks.map((t) => `<line class="grid" x1="${ml}" x2="${W - mr}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${ml - 6}" y="${sy(t) + 4}" text-anchor="end">${fmt(t, dec)}</text>`).join("")}
    <line class="axis" x1="${ml}" x2="${W - mr}" y1="${H - mb}" y2="${H - mb}"/><line class="axis" x1="${ml}" x2="${ml}" y1="${mt}" y2="${H - mb}"/>
    ${o.xTicks.map((t) => `<line class="axis" x1="${sx(t)}" x2="${sx(t)}" y1="${H - mb}" y2="${H - mb + 4}"/><text x="${sx(t)}" y="${H - mb + 16}" text-anchor="middle">${t}</text>`).join("")}
    <text x="${(ml + W - mr) / 2}" y="${H - 6}" text-anchor="middle" class="strong">${o.xlabel}</text>
    <text transform="translate(14 ${(mt + H - mb) / 2}) rotate(-90)" text-anchor="middle" class="strong">${o.ylabel}</text>
    ${(o.hlines || []).map((h) => `<line x1="${ml}" x2="${W - mr}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color || "var(--good)"}" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${W - mr - 2}" y="${sy(h.y) - 4}" text-anchor="end" style="fill:${h.color || "var(--good)"}">${h.label}</text>`).join("")}
    ${(o.vlines || []).map((v) => { const [a, tx] = anchor(sx(v.x)); return `<line x1="${sx(v.x)}" x2="${sx(v.x)}" y1="${mt}" y2="${H - mb}" stroke="${v.color || "var(--fg)"}" stroke-width="1.5" ${v.dash ? `stroke-dasharray="${v.dash}"` : ""}/><text x="${tx}" y="${mt + 11 + (v.row || 0) * 13}" text-anchor="${a}" style="fill:${v.color || "var(--fg)"}">${v.label}</text>`; }).join("")}
    ${o.series.map((s) => `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="2.2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"/>`).join("")}
    ${(o.points || []).map((p) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5" fill="${p.color || "var(--fg)"}" stroke="var(--bg)" stroke-width="1.5"><title>${p.label}</title></circle>`).join("")}
  </svg></div>`;
}

// Dot strip: one dot per value along an axis in target units, stacked where they would overlap.
// opts: values, lo, hi, r, on(i), tag(i), markers[{v,label,color,dash,row}], xlabel, label
function stripPlot(o) {
  const W = 720, ml = 20, mr = 20, r = o.r || 5, gap = 1.5, rows = Math.max(0, ...o.markers.map((m) => m.row)) + 1;
  const top = 12 + rows * 15;
  const sx = (v) => ml + ((v - o.lo) / (o.hi - o.lo)) * (W - ml - mr);
  const placed = [];
  const level = o.values.map((v) => {
    const px = sx(v);
    for (let l = 0; ; l++) {
      const row = placed[l] || (placed[l] = []);
      if (row.every((q) => Math.abs(q - px) >= 2 * r + gap)) { row.push(px); return l; }
    }
  });
  const base = top + placed.length * (2 * r + gap) + 10;
  const H = base + 44;
  const { ticks, dec } = niceTicks(o.lo, o.hi, 6);
  const anchor = (x) => (x < W * 0.55 ? ["start", x + 5] : ["end", x - 5]);
  return `<div class="scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label}">
    ${ticks.map((t) => `<line class="grid" x1="${sx(t)}" x2="${sx(t)}" y1="${top}" y2="${base}"/><text x="${sx(t)}" y="${base + 15}" text-anchor="middle">${fmt(t, dec)}</text>`).join("")}
    <line class="axis" x1="${ml}" x2="${W - mr}" y1="${base}" y2="${base}"/>
    <text x="${W / 2}" y="${base + 36}" text-anchor="middle" class="strong">${o.xlabel}</text>
    ${o.values.map((v, i) => {
      const cx = sx(v), cy = base - r - level[i] * (2 * r + gap) - 1, t = o.tag ? o.tag(i) : null;
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${t ? r + 3 : r}" fill="${o.on(i) ? "var(--dot)" : "none"}" stroke="${o.on(i) ? "var(--bg)" : "var(--dot-off)"}" stroke-width="${o.on(i) ? 1 : 1.2}" opacity="${o.on(i) ? 0.95 : 0.75}"><title>${o.title ? o.title(i) : fmt(v)}</title></circle>` +
        (t ? `<text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" style="fill:${o.on(i) ? "var(--bg)" : "var(--fg)"};font-size:9px;font-weight:700">${t}</text>` : "");
    }).join("")}
    ${o.markers.map((m) => { const [a, tx] = anchor(sx(m.v)); return `<line x1="${sx(m.v)}" x2="${sx(m.v)}" y1="${top - 4}" y2="${base}" stroke="${m.color}" stroke-width="2" ${m.dash ? `stroke-dasharray="${m.dash}"` : ""}/><text x="${tx}" y="${10 + m.row * 15}" text-anchor="${a}" class="strong" style="fill:${m.color}">${m.label}</text>`; }).join("")}
  </svg></div>`;
}

// ============================================================================
// 1. Push & Pull (linear regression)
// ============================================================================
function renderLinear(b, person) {
  const u = b.units, lin = b.linear, groups = b.categorical_groups;
  const grouped = new Set(groups.flatMap((g) => g.levels.filter((l) => l.column).map((l) => l.column)));
  const numeric = b.features.filter((f) => !grouped.has(f.name));
  const unedited = () => b.features.every((f) => Math.abs(state.values[f.name] - person.values[f.name]) < 1e-9);
  const step = (f) => (f.name === "age" ? 1 : 0.1);

  $("section").innerHTML = `
    <h2>Push &amp; Pull</h2>
    ${goalBox("rebuild a prediction from a <b>starting point</b> plus <b>one signed push per feature</b>, and tell a <b>coefficient</b> (the model's rule) apart from <b>one person's push</b>.")}
    <p class="terms"><b>Linear regression</b> predicts ${b.target_label.toLowerCase()} with one straight-line rule: every feature has a <b>coefficient</b>, the change in the prediction for
      1 more unit of that feature, other features held fixed. <b>Feature</b> = an input about the person. All numbers are in ${u}.</p>
    ${personLine(b, person)}
    <div class="cols">
      <div class="card inputs" aria-label="Edit this person's values">
        <h3>Change the person</h3>
        <p class="note">Drag, type or choose, and watch the prediction update.</p>
        ${numeric.map((f) => {
          const s = b.feature_stats[f.name];
          return `<div class="row"><label for="in-${f.name}"><span>${short(f.label)}</span><span>${f.units}</span></label>
            <div class="pair"><input type="range" id="rg-${f.name}" aria-label="${short(f.label)} slider" min="${s.min}" max="${s.max}" step="${step(f)}" value="${state.values[f.name]}">
            <input type="number" id="in-${f.name}" step="any" value="${valFmt(state.values[f.name])}"></div>
            <div class="avg">training average ${fmt(s.train_mean, f.name === "age" ? 1 : 2)} ${f.units}; people in the data: ${valFmt(s.min)} to ${valFmt(s.max)}</div>
            <div class="avg" id="warn-${f.name}" style="color:var(--warn)"></div></div>`;
        }).join("")}
        ${groups.map((g) => `<div class="row"><label for="g-${g.name}"><span>${g.label}</span></label>
          <select id="g-${g.name}" data-g="${g.name}">${g.levels.map((lv) => `<option ${lv.label === m10.categoryOf(b, g.name, state.values) ? "selected" : ""}>${lv.label}</option>`).join("")}</select>
          <div class="avg">one menu, one push. The model's reference group is ${g.reference}.</div></div>`).join("")}
        <button id="reset">Reset to ${person.label}</button>
      </div>
      <div>
        <div class="card" id="lin-main"></div>
      </div>
    </div>
    <div class="card" id="lin-explain"></div>
    <div class="card" id="lin-general"></div>
    <div id="lin-miss"></div>
    <p class="note">These are associations in a survey sample, not causes: the model does not say that changing one value would change a person's ${b.target_label.toLowerCase()}.</p>`;

  numeric.forEach((f) => {
    const rg = $("rg-" + f.name), nb = $("in-" + f.name), s = b.feature_stats[f.name];
    const set = (v) => {
      state.values[f.name] = v;
      $("warn-" + f.name).textContent = v < s.min || v > s.max ? `Outside the ${valFmt(s.min)}–${valFmt(s.max)} range seen in the data: the line keeps going, but no such people trained it.` : "";
      update();
    };
    rg.oninput = () => { nb.value = valFmt(Number(rg.value)); set(Number(rg.value)); };
    nb.onchange = () => { if (nb.value === "" || isNaN(Number(nb.value))) { nb.value = valFmt(state.values[f.name]); return; } rg.value = nb.value; set(Number(nb.value)); };
  });
  document.querySelectorAll("[data-g]").forEach((el) => (el.onchange = () => { Object.assign(state.values, m10.categoryInputs(b, el.dataset.g, el.value)); update(); }));
  $("reset").onclick = () => { state.values = null; state.sel = null; render(); };

  function items(ex) {
    const out = groups.map((g) => ({
      key: g.name, label: g.label, kind: "group", g, push: ex.groupedPushes[g.name], valueText: m10.categoryOf(b, g.name, state.values),
    }));
    numeric.forEach((f) => out.push({ key: f.name, label: short(f.label), kind: "num", f, push: ex.groupedPushes[f.name], valueText: `${valFmt(state.values[f.name])} ${f.units}` }));
    return out.sort((a, c) => Math.abs(c.push) - Math.abs(a.push));
  }

  function update() {
    const ex = m10.linearExplain(b, state.values);
    const list = items(ex);
    if (!state.sel || !list.some((i) => i.key === state.sel)) state.sel = list[0].key;
    const total = ex.prediction - ex.baseline;
    const showObs = unedited();
    // waterfall geometry
    const pts = [ex.baseline]; let run = ex.baseline;
    const stops = list.map((i) => { const from = run; run += i.push; pts.push(run); return [from, run]; });
    const all = showObs ? [...pts, person.observed] : pts;
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (v) => ((v - lo) / (hi - lo)) * 100;
    const { ticks, dec } = niceTicks(lo, hi, 5);
    const guide = `<i class="guide" style="left:${X(ex.baseline)}%"></i>`;
    const biggestUp = list.filter((i) => i.push > 0).sort((a, c) => c.push - a.push)[0];
    const biggestDown = list.filter((i) => i.push < 0).sort((a, c) => a.push - c.push)[0];
    const rows = list.map((i, n) => {
      const [a, c] = stops[n];
      return `<div class="r pick ${i.key === state.sel ? "sel" : ""}" data-sel="${i.key}" tabindex="0" role="button" aria-label="${i.label}: push ${signed(i.push)} ${u}. Show how it is calculated.">
        <div class="lab"><b>${i.label}</b>${i === biggestUp ? '<span class="badge up">largest push up</span>' : ""}${i === biggestDown ? '<span class="badge down">largest push down</span>' : ""}<small>${i.valueText}</small></div>
        <div class="track">${guide}<span class="bar ${i.push >= 0 ? "up" : "down"}" style="left:${Math.min(X(a), X(c))}%;width:${Math.abs(X(c) - X(a))}%"></span></div>
        <div class="val ${i.push >= 0 ? "up" : "down"}">${i.push >= 0 ? "▲" : "▼"} ${signed(i.push)}<br><small class="note">total ${fmt(c)}</small></div></div>`;
    }).join("");
    $("lin-main").innerHTML = `
      <h3>The prediction, built from a starting point and pushes</h3>
      <div class="eq" aria-live="polite">
        <div class="box"><small>Starting point (the prediction for a person with every feature at the training average)</small><strong>${fmt(ex.baseline)} ${u}</strong></div>
        <div class="op">+</div>
        <div class="box"><small>All ${list.length} pushes added together</small><strong class="${total >= 0 ? "up" : "down"}">${signed(total)} ${u}</strong></div>
        <div class="op">=</div>
        <div class="box final"><small>Prediction</small><strong>${fmt(ex.prediction)} ${u}</strong></div>
      </div>
      <div class="legend"><span><i style="background:var(--up)"></i>pushes the prediction up (▲)</span><span><i style="background:var(--down)"></i>pushes it down (▼)</span>
        <span><i style="background:var(--fg);width:4px"></i>starting point and prediction</span>${showObs ? '<span><i class="sw-obs"></i>observed (measured) value</span>' : ""}</div>
      <div class="wf" role="group" aria-label="Waterfall: starting point, then one push per feature, then the prediction">
        <div class="r"><div class="lab"><b>Starting point</b><small>average person</small></div><div class="track">${guide}<span class="mark" style="left:${X(ex.baseline)}%"></span></div><div class="val">${fmt(ex.baseline)}</div></div>
        ${rows}
        <div class="r"><div class="lab"><b>Prediction</b><small>starting point + pushes</small></div><div class="track">${guide}<span class="mark final" style="left:${X(ex.prediction)}%"></span></div><div class="val">${fmt(ex.prediction)}</div></div>
        ${showObs ? `<div class="r"><div class="lab"><b>Observed</b><small>what was actually measured</small></div><div class="track">${guide}<span class="obs" style="left:${X(person.observed)}%"></span></div><div class="val">${fmt(person.observed)}</div></div>` : ""}
        <div class="axis"><div></div><div class="ticks">${ticks.map((t) => `<span style="left:${X(t)}%">${fmt(t, dec)}</span>`).join("")}</div><div></div></div>
        <div class="axis"><div></div><div class="axislabel">${b.target_label.split(" (")[0]} (${u}). The axis does not start at zero, so bar lengths show pushes. Dashed line = starting point.</div><div></div></div>
      </div>
      <p class="note">Click a row to see how its push is calculated. Totals are rounded to one decimal.</p>`;
    document.querySelectorAll("[data-sel]").forEach((el) => {
      const pick = () => { state.sel = el.dataset.sel; update(); };
      el.onclick = pick; el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
    });
    explain(ex, list);
    general(ex, list);
    miss(ex, showObs);
  }

  // Coefficient (the model's rule) versus push (this person)
  function explain(ex, list) {
    const it = list.find((i) => i.key === state.sel);
    let body;
    if (it.kind === "num") {
      const f = it.f, c = lin.coefficients[f.name], avg = lin.reference[f.name], v = state.values[f.name], d = v - avg;
      body = `<div class="stats">
        <div class="stat"><small>1. Coefficient: the model's rule, the same for every person</small><strong>${coefFmt(c)} ${u}</strong><small>per 1 ${f.units} of ${it.label.toLowerCase()}, other features held fixed</small></div>
        <div class="stat"><small>2. This person's gap from the training average</small><strong>${signed(d, 2)} ${f.units}</strong><small>${valFmt(v)} − ${fmt(avg, 2)} (average)</small></div>
        <div class="stat hl"><small>3. This person's push = coefficient × gap</small><strong class="${it.push >= 0 ? "up" : "down"}">${signed(it.push, 2)} ${u}</strong><small>${coefFmt(c)} × ${signed(d, 2)} = ${signed(c * d, 2)}</small></div></div>
        <p>If this person's ${it.label} were exactly average, the push would be 0 even though the coefficient stays ${coefFmt(c)} ${u} per ${f.units}. Edit the value on the left to see it.</p>`;
    } else {
      const g = it.g, cur = m10.categoryOf(b, g.name, state.values);
      const lv = g.levels.filter((l) => l.column);
      body = `<p>${g.label} is a category, so the model stores one 0/1 column per group (1 = the person is in that group). The <b>reference group</b> (${g.reference}) is only how the columns are coded:
        each coefficient compares a group with ${g.reference}, other features held fixed. The <b>push</b> is measured from the <i>training average mix</i> instead, so even a person in the reference group gets a small push.</p>
        <table><tr><th>Group</th><th class="num">Coefficient (vs ${g.reference})</th><th class="num">This person (1 = in group)</th><th class="num">Share of training people</th><th class="num">Contribution</th></tr>
        ${lv.map((l) => { const c = lin.coefficients[l.column], x = state.values[l.column], sh = lin.reference[l.column]; return `<tr class="${l.label === cur ? "sel" : ""}"><td>${l.label}</td><td class="num">${coefFmt(c)} ${u}</td><td class="num">${x}</td><td class="num">${fmt(sh * 100, 0)}%</td><td class="num">${coefFmt(c * (x - sh))} ${u}</td></tr>`; }).join("")}
        <tr><td>${g.reference} (reference)</td><td class="num">0 (by definition)</td><td class="num">${lv.every((l) => state.values[l.column] === 0) ? 1 : 0}</td><td class="num">${fmt((1 - lv.reduce((s, l) => s + lin.reference[l.column], 0)) * 100, 0)}%</td><td class="num">—</td></tr>
        <tr><th colspan="4">This person's ${g.label.toLowerCase()} push (${cur})</th><th class="num ${it.push >= 0 ? "up" : "down"}">${signed(it.push, 2)} ${u}</th></tr></table>`;
    }
    $("lin-explain").innerHTML = `<h3>Coefficient vs push: ${it.label}</h3>${body}`;
  }

  // One person's pushes versus overall importance
  function general(ex, list) {
    const eff = lin.typical_effect_per_sd;
    const gen = numeric.map((f) => ({ f, e: eff[f.name] })).sort((a, c) => Math.abs(c.e) - Math.abs(a.e));
    const maxE = Math.max(...gen.map((g) => Math.abs(g.e))), maxP = Math.max(...list.map((i) => Math.abs(i.push)));
    const topP = list[0], topG = gen[0];
    $("lin-general").innerHTML = `<h3>One person's pushes ≠ which feature matters most overall</h3>
      <p>A push answers: <i>for this person, how far did this feature move the prediction from the starting point?</i> It is large only when the person is far from average on that feature.
        <b>Typical effect per SD</b> answers a different question: <i>across people, how much does the prediction change when this feature differs from average by a typical amount (one standard deviation)?</i></p>
      <table><tr><th>Feature</th><th class="num">Overall: typical effect of 1 SD (${u})</th><th></th><th class="num">This person's push (${u})</th><th></th></tr>
      ${gen.map((g) => { const p = ex.groupedPushes[g.f.name]; return `<tr><td>${short(g.f.label)} <span class="note">(1 SD = ${fmt(b.feature_stats[g.f.name].train_sd, 1)} ${g.f.units})</span></td>
        <td class="num">${signed(g.e)}</td><td style="width:20%"><div class="bars"><div class="fill alt" style="width:${(Math.abs(g.e) / maxE) * 100}%"></div></div></td>
        <td class="num ${p >= 0 ? "up" : "down"}">${signed(p)}</td><td style="width:20%"><div class="bars"><div class="fill" style="width:${(Math.abs(p) / maxP) * 100}%;background:var(--${p >= 0 ? "up" : "down"})"></div></div></td></tr>`; }).join("")}</table>
      <p class="note">${groups.map((g) => g.label).join(" and ")} are categories, so they have no "1 SD" and are left out of the overall column.</p>
      <p>${topP.label === topG.f.label.replace(/\s*\(.*?\)/g, "") || topP.key === topG.f.name
        ? `Here the same feature, <b>${topG.f.name === topP.key ? short(topG.f.label) : topP.label}</b>, has both the largest push for this person and the largest typical effect overall.`
        : `For this person the largest push comes from <b>${topP.label}</b> (${signed(topP.push)} ${u}), but across people the largest typical effect belongs to <b>${short(topG.f.label)}</b> (${signed(topG.e)} ${u} per SD). Try editing ${short(topG.f.label).toLowerCase()} to see its push grow.`}</p>`;
  }

  function miss(ex, showObs) {
    if (!showObs) { $("lin-miss").innerHTML = `<div class="callout">You've edited this person, so there is no measured value to compare with. Use "Reset" to return to ${person.label}.</div>`; return; }
    const diff = person.observed - ex.prediction, rmse = lin.rmse.validation;
    const big = Math.abs(diff) > 2 * rmse;
    $("lin-miss").innerHTML = `<div class="${big ? "callout" : "card"}"><b>How close is the line for ${person.label}?</b> Predicted ${fmt(ex.prediction)} ${u}, observed ${fmt(person.observed)} ${u}: a miss of ${signed(diff)} ${u}.
      On all validation people the line's typical error (RMSE) is ${fmt(rmse)} ${u}.${big ? ` This miss is more than twice that.
      ${b.id === "fev1" || b.name.includes("lung") ? "A straight line has one age coefficient, but lungs grow through childhood and then slowly shrink, so one slope cannot fit both. This is the model, not a bug." : "A straight line has one coefficient per feature, so it cannot bend to follow patterns that rise and then fall. This is the model, not a bug."}` : ""}</div>`;
  }

  update();
}

// ============================================================================
// 2. Wisdom of the Forest (random forest)
// ============================================================================
function renderForest(b, person) {
  const u = b.units, rf = b.forest, P = rf.people[person.id], trees = P.tree_predictions, N = rf.n_trees;
  const k0 = Math.min(Math.max(1, state.nTrees), N);
  const uniq = rf.bootstrap_unique_training_rows;
  const meanUniq = uniq.reduce((a, c) => a + c, 0) / uniq.length;
  const lo = Math.min(...trees, person.observed), hi = Math.max(...trees, person.observed), padr = (hi - lo) * 0.04;
  const sd = sdev(trees);
  const rootCount = {};
  rf.root_split.forEach((s) => { (rootCount[s.feature] ||= []).push(s.threshold); });
  const roots = Object.entries(rootCount).sort((a, c) => c[1].length - a[1].length);
  const topRoot = roots[0];
  const dis = b.people.find((p) => /disagree/.test(p.why_chosen)), agr = b.people.find((p) => /agree/.test(p.why_chosen) && !/disagree/.test(p.why_chosen));

  const stepText = (s) => {
    const f = featureOf(b, s.feature), val = person.values[s.feature], lab = short(f.label);
    if (f.binary) return `Is the person in group "${lab}"? <b>${s.goes === ">" ? "Yes" : "No"}</b>`;
    return `Is ${lab} ≤ ${Number(s.threshold.toFixed(2))} (${f.units})? <b>${s.goes === "≤" ? "Yes" : "No"}</b> <span class="note">(${valFmt(val)})</span>`;
  };
  const treeCard = (t, i) => `<div class="tree"><b>Tree ${i + 1}</b>, ${t.steps.length} questions
      <ol>${t.steps.slice(0, 3).map((s) => `<li>${stepText(s)}</li>`).join("")}</ol>
      ${t.steps.length > 3 ? `<details style="margin:4px 0;padding:0 8px"><summary style="padding:2px 0;font-weight:500">the other ${t.steps.length - 3} questions</summary><ol start="4">${t.steps.slice(3).map((s) => `<li>${stepText(s)}</li>`).join("")}</ol></details>` : ""}
      Its guess: <span class="leaf">${fmt(t.leaf_value)} ${u}</span></div>`;

  $("section").innerHTML = `
    <h2>Wisdom of the Forest</h2>
    ${goalBox("explain how <b>varied trees</b> combine by <b>averaging</b>, and tell <b>disagreement between trees</b> apart from <b>real uncertainty</b> about a prediction.")}
    <p class="terms"><b>Decision tree</b> = a flowchart of yes/no questions about a person's features that ends in one guess (in ${u}).
      <b>Random forest</b> = ${N} slightly different trees. For a person, <b>every tree makes its own guess and the forest's prediction is the average of all ${N} guesses</b>.</p>
    ${personLine(b, person)}
    <p class="who">Observed (measured) value for this person: <b>${fmt(person.observed)} ${u}</b>.
      <span class="btns" style="display:inline-flex;margin-left:8px">${dis ? `<button id="jump-dis">Show a person the trees disagree on most</button>` : ""}${agr ? `<button id="jump-agr">…and one they agree on</button>` : ""}</span></p>

    <div class="card">
      <h3>Every dot is one tree's guess for this person</h3>
      <p class="note">Choose how many trees to include, in a fixed order (tree 1, tree 2, …). Filled dots are included in the average; hollow dots are left out. Numbered dots are trees 1–5, opened below.</p>
      <div class="slider"><label for="ntrees"><b>Trees included:</b></label><input id="ntrees" type="range" min="1" max="${N}" value="${k0}"><output id="ntrees-value" for="ntrees">${k0}</output><span>of ${N}</span></div>
      <div class="btns" id="tree-presets">${[1, 5, 10, 25, 50, N].map((n) => `<button data-n="${n}">${n === 1 ? "1 tree" : n === N ? `All ${N}` : `${n} trees`}</button>`).join("")}</div>
      <div id="forest-results"></div>
    </div>

    <div class="card">
      <h3>Why does the average settle down?</h3>
      <div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div><p class="note"><b>For this person:</b> the average of the first n trees as n grows.</p><div id="run-chart"></div></div>
        <div><p class="note"><b>For all ${fmt(b.n_validation, 0)} validation people:</b> typical error of a forest with n trees.</p><div id="rmse-chart"></div></div>
      </div>
      <p id="rmse-caption"></p>
    </div>

    <div class="card">
      <h3>Why the trees differ</h3>
      <p>If every tree learned from the same people and could ask about the same features, they'd all be identical. Two random choices make them differ:</p>
      <ol>
        <li><b>Each tree learns from its own random sample of people.</b> It draws ${fmt(rf.n_training_rows, 0)} people from the training data <i>with replacement</i> (a "bootstrap sample"), so some people appear twice and some not at all.
          Each tree saw only ${fmt(Math.min(...uniq), 0)} to ${fmt(Math.max(...uniq), 0)} different people (on average ${fmt((meanUniq / rf.n_training_rows) * 100, 0)}% of the training people).</li>
        <li><b>At each question a tree may look at only ${rf.features_tried_per_split} of the ${rf.n_features} features,</b> chosen at random for that question.</li>
      </ol>
      <p><b>What it does:</b> the ${N} trees don't even ask the same first question.</p>
      <div class="bars" role="group" aria-label="First question of each tree">${roots.map(([f, th]) => `<div class="b"><span>${short(featureOf(b, f).label)}</span><div><div class="fill" style="width:${(th.length / N) * 100}%"></div></div><span>${th.length} trees</span></div>`).join("")}</div>
      <p class="note">Even trees that start with the same feature use different cut-offs: for ${short(featureOf(b, topRoot[0]).label)}, from ${Number(Math.min(...topRoot[1]).toFixed(2))} to ${Number(Math.max(...topRoot[1]).toFixed(2))} ${featureOf(b, topRoot[0]).units}.</p>
      <h3 style="margin-top:12px">Trees 1–5 for ${person.label}</h3>
      <div class="tree-cards">${P.traced_trees.map(treeCard).join("")}</div>
    </div>

    <div class="card">
      <h3>Disagreement between trees is not uncertainty</h3>
      <p>When trees <b>disagree</b>, their guesses are spread out. That describes the trees. It is <b>not a confidence interval or prediction interval</b>: nothing says the real value lies between the lowest and highest guess, or how likely any value is.
        Compare the spread with how far the forest's average actually was from the observed value:</p>
      <div class="scroll"><table><tr><th>Person</th><th class="num">Trees' lowest to highest guess (${u})</th><th class="num">Disagreement (SD of guesses, ${u})</th><th class="num">Forest prediction (${u})</th><th class="num">Observed (${u})</th><th class="num">Forest missed by (${u})</th></tr>
      ${b.people.map((p) => { const t = rf.people[p.id].tree_predictions; return `<tr class="pick ${p.id === person.id ? "sel" : ""}" data-p="${p.id}" tabindex="0" role="button" aria-label="Show ${p.label}"><td>${p.label}<br><span class="note">${p.description}; ${p.why_chosen}</span></td>
        <td class="num">${fmt(Math.min(...t))} to ${fmt(Math.max(...t))}</td><td class="num">${fmt(sdev(t))}</td><td class="num">${fmt(rf.people[p.id].prediction)}</td><td class="num">${fmt(p.observed)}</td><td class="num">${fmt(Math.abs(rf.people[p.id].prediction - p.observed))}</td></tr>`; }).join("")}</table></div>
      <p class="note">Click a row to look at that person. Compare the last two columns with the third: a wide spread doesn't tell you how big the miss will be.</p>
    </div>

    <h3>Common questions</h3>
    <details><summary>Why do the trees disagree?</summary><p>Each tree learned from a different sample of people and was allowed to ask about different features, so each draws different boundaries. For a person near those boundaries, the trees land in different groups and give different guesses.</p></details>
    <details><summary>Why is the average steadier than one tree?</summary><p>One tree's guess leans on the quirks of its own sample. Other trees have different quirks, so their errors point in different directions and partly cancel in the average.
      Across the validation people the typical error (RMSE) falls from ${fmt(rf.validation_rmse_by_trees[0])} ${u} for one tree to ${fmt(rf.validation_rmse_by_trees[N - 1])} ${u} for all ${N}. Use the slider to see where it settles for ${person.label}.</p></details>
    <details><summary>Isn't the spread of guesses a confidence interval?</summary><p>No. The spread only shows how much the trees disagree with each other. A confidence or prediction interval would come with a stated chance of covering the real value; this spread does not.</p></details>
    <details><summary>Why can't the forest predict above the highest value it saw?</summary><p>Each tree ends in a group of training people and guesses their average outcome, and the forest averages those guesses. An average can't be higher than the highest training outcome (${fmt(rf.training_target_range[1])} ${u}) or lower than the lowest (${fmt(rf.training_target_range[0])} ${u}), so the forest can't predict beyond that range, even for a person who truly is beyond it.</p></details>`;

  const update = (k) => {
    state.nTrees = k;
    $("ntrees-value").textContent = k;
    const part = k < N, avg = m10.runningAverage(trees, k);
    const markers = [{ v: avg, label: part ? `Partial forest: average of first ${k} trees ${fmt(avg)}` : `Forest prediction: average of all ${N} trees ${fmt(avg)}`, color: "var(--fg)", row: 0 }];
    if (part) markers.push({ v: P.prediction, label: `All ${N} trees ${fmt(P.prediction)}`, color: "var(--muted)", dash: "5 4", row: 1 });
    markers.push({ v: person.observed, label: `Observed ${fmt(person.observed)}`, color: "var(--good)", dash: "2 3", row: 2 });
    $("forest-results").innerHTML = `
      ${stripPlot({ values: trees, lo: lo - padr, hi: hi + padr, r: 5, on: (i) => i < k, tag: (i) => (i < 5 ? i + 1 : null), title: (i) => `Tree ${i + 1} guesses ${fmt(trees[i])} ${u}`, markers, xlabel: `Guess for this person (${u})`, label: `Dot strip of ${N} tree guesses for ${person.label}, with the average of the first ${k} trees` })}
      <div class="stats">
        <div class="stat hl"><small>${part ? `Partial forest: average of the first ${k} of ${N} trees` : `Whole forest: average of all ${N} trees (the forest's prediction)`}</small><strong>${fmt(avg)} ${u}</strong></div>
        <div class="stat"><small>Forest prediction (average of all ${N} trees)</small><strong>${fmt(P.prediction)} ${u}</strong></div>
        <div class="stat"><small>Tree 1 alone</small><strong>${fmt(trees[0])} ${u}</strong></div>
        <div class="stat"><small>Disagreement: lowest to highest of the ${N} guesses (SD ${fmt(sd)} ${u})</small><strong>${fmt(Math.min(...trees))} to ${fmt(Math.max(...trees))} ${u}</strong></div>
      </div>
      ${part ? `<p class="note"><b>Partial forest:</b> only ${k} of the ${N} trees are averaged, so this is not the forest's prediction yet.</p>` : ""}`;
    const xs = trees.map((_, i) => i + 1);
    $("run-chart").innerHTML = lineChart({
      xs, series: [{ y: xs.map((n) => m10.runningAverage(trees, n)), color: "var(--accent)", name: "average of the first n trees" }],
      hlines: [{ y: person.observed, label: "observed", color: "var(--good)" }], vlines: [{ x: k, label: part ? "partial forest" : "whole forest", dash: "4 3" }],
      xlabel: "Number of trees averaged (n)", ylabel: `Average prediction (${u})`, xTicks: [1, 10, 25, 50, 75, 100], label: `Running average of tree guesses for ${person.label}`,
    });
    $("rmse-chart").innerHTML = lineChart({
      xs, series: [{ y: rf.validation_rmse_by_trees, color: "var(--down)", name: "validation RMSE" }],
      points: [{ x: k, y: rf.validation_rmse_by_trees[k - 1], color: "var(--fg)", label: `${k} trees: RMSE ${fmt(rf.validation_rmse_by_trees[k - 1])} ${u}` }],
      xlabel: "Number of trees averaged (n)", ylabel: `Typical error, RMSE (${u})`, xTicks: [1, 10, 25, 50, 75, 100], label: "Validation RMSE of the partial forest by number of trees",
    });
    $("rmse-caption").innerHTML = `RMSE (root mean squared error) is a typical size of the miss, in ${u}. ${part ? "Partial forest" : "Whole forest"} of ${k}: <b>${fmt(rf.validation_rmse_by_trees[k - 1])} ${u}</b>.
      One tree alone: ${fmt(rf.validation_rmse_by_trees[0])} ${u}. All ${N} trees: ${fmt(rf.validation_rmse_by_trees[N - 1])} ${u}.`;
  };
  $("ntrees").oninput = (e) => update(Number(e.target.value));
  document.querySelectorAll("#tree-presets [data-n]").forEach((el) => (el.onclick = () => { $("ntrees").value = el.dataset.n; update(Number(el.dataset.n)); }));
  document.querySelectorAll("tr[data-p]").forEach((el) => {
    el.onclick = () => setPerson(el.dataset.p);
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPerson(el.dataset.p); } };
  });
  if (dis) $("jump-dis").onclick = () => setPerson(dis.id);
  if (agr) $("jump-agr").onclick = () => setPerson(agr.id);
  update(k0);
}

// ============================================================================
// 3. One Correction at a Time (gradient boosting)
// ============================================================================
function renderBoosting(b, person) {
  const u = b.units, gb = b.boosting, p = gb.people[person.id], M = p.corrections.length, lr = gb.learning_rate;
  const best = gb.best_validation_round;
  const trn = gb.rmse.train, val = gb.rmse.validation;
  const lowTrain = trn.indexOf(Math.min(...trn));
  const c02 = gb.comparison_learning_rate_0_02;
  const rs = gb.residual_snapshots, snaps = rs.rounds;
  const r0 = Math.min(Math.max(0, state.round), M);
  const closer = p.corrections.reduce((n, _, i) => n + (Math.abs(person.observed - p.staged[i + 1]) < Math.abs(person.observed - p.staged[i]) ? 1 : 0), 0);
  const resid = (r) => rs.observed.map((o, i) => o - rs.predictions[String(r)][i]);
  const allRes = snaps.flatMap((r) => resid(r));
  const rLo = Math.min(...allRes), rHi = Math.max(...allRes), rPad = (rHi - rLo) * 0.03;
  const xs = Array.from({ length: M + 1 }, (_, i) => i);
  const xTicks = [0, 1, 10, 25, 50, 100, 200, 300, 400, 500];

  $("section").innerHTML = `
    <h2>One Correction at a Time</h2>
    ${goalBox("explain how boosting adds <b>one small correction per round</b>, and use <b>validation error</b> to choose when to stop.")}
    <p class="terms"><b>Gradient boosting</b> builds a prediction in <b>rounds</b>. It starts with the training average, then each round adds one small decision tree that corrects part of what is still wrong.
      <b>Residual</b> = observed − predicted for a training person. <b>Validation people</b> = ${fmt(b.n_validation, 0)} people held out from fitting, used to decide when to stop. All numbers are in ${u}.</p>
    ${personLine(b, person)}
    <p class="who">Observed (measured) value for this person: <b>${fmt(person.observed)} ${u}</b>.</p>

    <div class="card">
      <h3>Step through the rounds</h3>
      <div class="slider"><label for="round"><b>Round:</b></label><input id="round" type="range" min="0" max="${M}" value="${r0}"><output id="round-value" for="round">${r0}</output><span>of ${M}</span></div>
      <div class="btns" id="round-btns">
        <button data-d="-1" aria-label="previous round">◀ Previous</button><button data-d="1" aria-label="next round">Next ▶</button>
        ${[[0, "Round 0"], [1, "Round 1"], [10, "Round 10"], [best, `Best on validation: ${best}`], [M, `Round ${M}`]].map(([n, l]) => `<button data-r="${n}">${l}</button>`).join("")}
      </div>
      <div id="bo-step" aria-live="polite"></div>
      <h3 style="margin-top:14px">This person's prediction, round by round</h3>
      <div id="bo-path"></div>
    </div>

    <div class="card">
      <h3>What each tree is fitted to: the training residuals</h3>
      <p>Each new tree is trained to predict what the model so far still gets wrong on the <b>training</b> people: their residuals. The dots below are the residuals of ${rs.observed.length} training people (a sample) after round <span id='res-round'></span>; the next tree is fitted to these.
        As rounds go by, the dots crowd toward 0.</p>
      <div id="bo-resid"></div>
    </div>

    <div class="card">
      <h3>When should it stop? Training error vs validation error</h3>
      <p><b>RMSE</b> (root mean squared error) is a typical size of the miss, in ${u}. <b>Training error</b> is measured on the people the trees were fitted to; <b>validation error</b> on people they never saw.</p>
      <label><input type="checkbox" id="lr02" ${state.lr02 ? "checked" : ""}> Also show a separately fitted model with learning rate 0.02 (it learns more slowly)</label>
      <div id="bo-error"></div>
      <p id="bo-error-text"></p>
    </div>

    <div class="card">
      <h3>Pick your stopping round</h3>
      <p>Move the slider above to the round where you would stop, then press the button. The app compares it with the round that has the lowest <i>validation</i> error, and with the round that has the lowest <i>training</i> error.</p>
      <div class="btns"><button class="primary" id="stop-btn"></button></div>
      <div id="bo-stop"></div>
    </div>

    <h3>Common questions</h3>
    <details><summary>Why start at the average?</summary><p>With no information about a person, the average training outcome (${fmt(gb.init)} ${u}) is the single number that makes the typical squared miss smallest. Every later tree then only has to fix what is left over.</p></details>
    <details><summary>Why are the corrections so small?</summary><p>Each tree's output is scaled by the learning rate (${lr}) before it is added, so no single tree can overcorrect. For ${person.label}, tree 1 adds ${signed(p.corrections[0], 2)} ${u}. The corrections shown here already include that scaling, so they are added exactly as given.
      A smaller rate (0.02) means even smaller steps and more rounds to get as far.</p></details>
    <details><summary>Why does training error keep falling when validation error doesn't?</summary><p>Later trees start fitting quirks of the training people, such as noise that won't repeat for anyone else. That lowers training error but not validation error. Here, training RMSE falls from ${fmt(trn[0])} to ${fmt(trn[M])} ${u} over ${M} rounds, while validation RMSE bottoms out at ${fmt(gb.best_validation_rmse)} ${u} (round ${best}) and ends at ${fmt(val[M])} ${u}.</p></details>
    <details><summary>Does every round improve every person?</summary><p>No. Each tree improves the training people on average, but any one person can move the wrong way. For ${person.label}, ${closer} of ${M} rounds moved the prediction closer to the observed value, and ${M - closer} moved it further away or left it where it was.</p></details>
    <details><summary>Why "validation", not "test"?</summary><p>The validation people were not used to fit any tree, but they were used to choose the stopping round. So the error at that round is a bit flattering: it is a validation-based choice, not a test result. An honest final score needs a separate test set that never influenced any decision.</p></details>`;

  const rowOf = (label, r) => `<tr><td>${label}</td><td class="num">${r}</td><td class="num">${fmt(trn[r])}</td><td class="num">${fmt(val[r])}</td></tr>`;

  const updateStop = () => {
    $("stop-btn").textContent = `Use round ${state.round} as my stopping round`;
    const S = state.stop;
    if (S === null) { $("bo-stop").innerHTML = `<p class="note">No stopping round chosen yet.</p>`; return; }
    const diff = val[S] - val[best];
    $("bo-stop").innerHTML = `<table><tr><th>Choice</th><th class="num">Round</th><th class="num">Training RMSE (${u})</th><th class="num">Validation RMSE (${u})</th></tr>
      ${rowOf("<b>Your stopping round</b>", S)}${rowOf("Lowest validation error", best)}${rowOf("Lowest training error", lowTrain)}${rowOf("Final round", M)}</table>
      <p>${S === best ? `You picked the round with the lowest validation error.` : `At your round the validation error is ${fmt(val[S] - val[best])} ${u} ${diff > 0 ? "higher" : "lower"} than at the best round (${best}).`}
        ${lowTrain !== best ? `The round with the lowest <i>training</i> error (round ${lowTrain}) has validation error ${fmt(val[lowTrain])} ${u}, ${fmt(val[lowTrain] - val[best])} ${u} worse than the best round: training error keeps improving by fitting the training people ever more closely, not by getting better on new people.` : ""}</p>
      <p class="note">The best round is a validation-based choice, not a test result: the validation people helped choose it, so its error is slightly optimistic.</p>`;
  };

  const update = (k) => {
    state.round = k;
    $("round-value").textContent = k;
    $("res-round").textContent = "";
    // step panel
    const prev = k > 0 ? p.staged[k - 1] : null, cur = p.staged[k];
    $("bo-step").innerHTML = k === 0
      ? `<div class="eq"><div class="box final"><small>Round 0: the average outcome of the training people. No trees yet.</small><strong>${fmt(gb.init)} ${u}</strong></div></div>
         <p>Everyone starts from the same prediction. Observed for this person: ${fmt(person.observed)} ${u}, so the model is ${fmt(Math.abs(person.observed - cur))} ${u} ${person.observed > cur ? "too low" : "too high"}. Step forward to watch trees correct it.</p>`
      : `<div class="eq"><div class="box"><small>Prediction after round ${k - 1}</small><strong>${fmt(prev)} ${u}</strong></div><div class="op">+</div>
         <div class="box"><small>Correction from tree ${k} (already includes the learning rate)</small><strong class="${p.corrections[k - 1] >= 0 ? "up" : "down"}">${signed(p.corrections[k - 1], 2)} ${u}</strong></div><div class="op">=</div>
         <div class="box final"><small>Prediction after round ${k}</small><strong>${fmt(cur)} ${u}</strong></div></div>
         <p>Tree ${k} was fitted to the training residuals left after round ${k - 1}, not to ${person.label}, who was held out. It is applied to this person like any new person.
           Distance from the observed value (${fmt(person.observed)} ${u}): ${fmt(Math.abs(person.observed - prev))} → ${fmt(Math.abs(person.observed - cur))} ${u},
           ${Math.abs(person.observed - cur) < Math.abs(person.observed - prev) ? '<b style="color:var(--good)">closer ✓</b>' : '<b style="color:var(--warn)">not closer ✗</b>'}.</p>`;
    $("bo-path").innerHTML = lineChart({
      xs, xScale: "sqrt", xTicks, series: [{ y: p.staged, color: "var(--accent)", name: "prediction after each round" }],
      hlines: [{ y: person.observed, label: "observed", color: "var(--good)" }],
      vlines: [{ x: k, label: `round ${k}`, dash: "4 3", row: 0 }, ...(best !== k ? [{ x: best, label: `lowest validation error: round ${best}`, color: "var(--muted)", dash: "2 3", row: 1 }] : [])],
      xlabel: "Round (number of trees added). The axis is stretched near 0 so early rounds are visible.", ylabel: `Prediction (${u})`, label: `Prediction for ${person.label} by round`,
    });
    // residuals at the latest recorded round not after k
    const r = Math.max(...snaps.filter((s) => s <= k));
    const res = resid(r);
    $("res-round").textContent = r;
    $("bo-resid").innerHTML = stripPlot({
      values: res, lo: rLo - rPad, hi: rHi + rPad, r: 2.6, on: () => true,
      title: (i) => `Training person ${i + 1}: residual ${signed(res[i])} ${u}`, markers: [{ v: 0, label: "0 = no miss", color: "var(--good)", row: 0 }],
      xlabel: `Residual = observed − predicted (${u}) after round ${r}`, label: `Residuals of training people after round ${r}`,
    }) + `<p class="note">Showing the residuals after round ${r}${r !== k ? ` (rounds are only recorded at ${snaps.join(", ")}; this is the latest one up to round ${k})` : ""}. Typical size (RMS): ${fmt(Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length))} ${u}. Sample of ${res.length} training people.</p>`;
    // error chart
    const series = [
      { y: trn, color: "var(--muted)", name: "training RMSE" },
      { y: val, color: "var(--accent)", name: "validation RMSE" },
    ];
    if (state.lr02) series.push({ y: c02.rmse.validation, color: "var(--good)", dash: "6 4", name: "validation RMSE, learning rate 0.02" });
    const vl = [{ x: k, label: `round ${k}`, dash: "4 3", row: 0 }];
    if (state.stop !== null && state.stop !== k) vl.push({ x: state.stop, label: `your stop: ${state.stop}`, color: "var(--warn)", dash: "6 3", row: 1 });
    $("bo-error").innerHTML = lineChart({
      xs, xScale: "sqrt", xTicks, series, vlines: vl,
      points: [{ x: best, y: gb.best_validation_rmse, color: "var(--accent)", label: `Lowest validation RMSE: ${fmt(gb.best_validation_rmse)} ${u} at round ${best}` }],
      xlabel: "Round (number of trees added). The axis is stretched near 0 so early rounds are visible.", ylabel: `Error, RMSE (${u})`, label: "Training and validation RMSE by round",
    });
    $("bo-error-text").innerHTML = `At round ${k}: training RMSE <b>${fmt(trn[k])} ${u}</b>, validation RMSE <b>${fmt(val[k])} ${u}</b>.
      Lowest validation RMSE: <b>${fmt(gb.best_validation_rmse)} ${u} at round ${best}</b> (the dot).
      ${state.lr02 ? `<br>Learning rate 0.02 (separately fitted): lowest validation RMSE ${fmt(c02.best_validation_rmse)} ${u} at round ${c02.best_validation_round}.` : ""}`;
    updateStop();
  };

  $("round").oninput = (e) => update(Number(e.target.value));
  const go = (n) => { const v = Math.min(M, Math.max(0, n)); $("round").value = v; update(v); };
  document.querySelectorAll("#round-btns [data-r]").forEach((el) => (el.onclick = () => go(Number(el.dataset.r))));
  document.querySelectorAll("#round-btns [data-d]").forEach((el) => (el.onclick = () => go(state.round + Number(el.dataset.d))));
  $("stop-btn").onclick = () => { state.stop = state.round; update(state.round); };
  $("lr02").onchange = (e) => { state.lr02 = e.target.checked; update(state.round); };
  update(r0);
}

setup();
