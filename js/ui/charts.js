// Documentary charts (SVG): horizontal bars for comparisons, columns for yearly series,
// lines for long time series and a timeline for milestones. Animated reveal, hover tooltips,
// a legend for two or more series, and a data-table view. Palette: the validated dark-surface
// categorical slots (surface #1a1a19), assigned in fixed order.

const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const nf = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-GB');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmt(v, ds) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  if (/%/.test(ds.unit || '')) return `${v}%`;
  return Math.abs(v) >= 10000 ? nf.format(v) : full.format(v);
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const isTime = (cats) => cats.length > 2 && cats.every((c) => /^\d{4}/.test(String(c)));

export function renderChart(el, ds, { animate = true } = {}) {
  el.classList.add('chart');
  const series = ds.series || [];
  const legend = series.length >= 2 ? `<div class="chart-legend">${series.map((s, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  el.innerHTML = `
    <div class="chart-head"><h3>${esc(ds.title)}</h3><p>${esc(ds.subtitle || '')}</p></div>
    ${legend}
    <div class="chart-body"></div>
    <p class="chart-take">${esc(ds.takeaway || '')}</p>
    <details class="chart-table"><summary>Data table</summary>${table(ds)}</details>
    <p class="chart-src">Source: ${(ds.sources || []).map((s) => esc(s.label)).join('; ')}${ds.note ? ` <span class="chart-note" title="${esc(ds.note)}">ⓘ notes</span>` : ''}</p>
    <div class="chart-tip hidden"></div>`;
  const body = el.querySelector('.chart-body');
  const tip = el.querySelector('.chart-tip');
  if (ds.chart === 'milestones') return milestones(body, ds, animate);
  if (ds.chart === 'line') return line(body, ds, tip, animate);
  if (isTime(ds.categories || [])) return columns(body, ds, tip, animate);
  return bars(body, ds, tip, animate);
}

function table(ds) {
  if (ds.chart === 'milestones') return `<table>${(ds.items || []).map((i) => `<tr><th>${esc(i.date)}</th><td>${esc(i.label)}</td></tr>`).join('')}</table>`;
  const s = ds.series || [];
  return `<table><tr><th></th>${s.map((x) => `<th>${esc(x.name)}</th>`).join('')}</tr>${(ds.categories || []).map((c, i) => `<tr><th>${esc(c)}</th>${s.map((x) => `<td>${fmt(x.values[i], ds)}</td>`).join('')}</tr>`).join('')}</table>`;
}

function hoverTip(tip, host) {
  return {
    show(html, x, y) { tip.innerHTML = html; tip.classList.remove('hidden'); const r = host.getBoundingClientRect(); const w = tip.offsetWidth; tip.style.left = Math.min(r.width - w - 4, Math.max(4, x - w / 2)) + 'px'; tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px'; },
    hide() { tip.classList.add('hidden'); },
  };
}

// Horizontal bars (stacked when chart is bar-stacked, grouped when several series).
function bars(body, ds, tipEl, animate) {
  const cats = ds.categories || [], S = ds.series || [];
  const stacked = ds.chart === 'bar-stacked';
  const totals = cats.map((_, i) => (stacked ? S.reduce((a, s) => a + (s.values[i] || 0), 0) : Math.max(...S.map((s) => s.values[i] || 0))));
  const max = niceMax(Math.max(...totals));
  const barH = Math.min(22, stacked || S.length === 1 ? 22 : Math.max(8, 44 / S.length));
  const rowH = stacked || S.length === 1 ? barH + 12 : barH * S.length + 2 * (S.length - 1) + 14;
  const labelW = 150, valueW = 70, W = 640, H = cats.length * rowH + 24;
  const plotW = W - labelW - valueW;
  const x = (v) => (v / max) * plotW;
  let marks = '';
  cats.forEach((c, i) => {
    const y0 = 8 + i * rowH;
    marks += `<text class="cat" x="${labelW - 10}" y="${y0 + (rowH - 12) / 2 + 4}" text-anchor="end">${esc(c)}</text>`;
    if (stacked) {
      let acc = 0;
      S.forEach((s, k) => {
        const v = s.values[i] || 0, w = Math.max(0, x(v) - (k < S.length - 1 ? 2 : 0));
        const last = k === S.length - 1 || S.slice(k + 1).every((t) => !t.values[i]);
        marks += `<rect class="mk" data-i="${i}" data-k="${k}" x="${labelW + x(acc)}" y="${y0}" width="${w}" height="${barH}" rx="${last ? 4 : 0}" fill="${SERIES[k]}" style="--w:${w}"/>`;
        if (last && w > 4) marks += `<rect x="${labelW + x(acc)}" y="${y0}" width="${Math.min(4, w)}" height="${barH}" fill="${SERIES[k]}" class="mk-sq" style="--w:${Math.min(4, w)}"/>`;
        acc += v;
      });
      marks += `<text class="val" x="${labelW + x(totals[i]) + 6}" y="${y0 + barH / 2 + 4}">${fmt(totals[i], ds)}</text>`;
    } else {
      S.forEach((s, k) => {
        const v = s.values[i] || 0, w = x(v);
        const y = y0 + k * (barH + 2);
        marks += `<path class="mk" data-i="${i}" data-k="${k}" d="${roundedBar(labelW, y, w, barH)}" fill="${SERIES[k]}"/>`;
        if (S.length === 1 || cats.length <= 4) marks += `<text class="val" x="${labelW + w + 6}" y="${y + barH / 2 + 4}">${fmt(v, ds)}</text>`;
      });
    }
  });
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line class="grid" x1="${labelW + f * plotW}" x2="${labelW + f * plotW}" y1="0" y2="${H - 18}"/><text class="tick" x="${labelW + f * plotW}" y="${H - 4}" text-anchor="middle">${fmt(max * f, ds)}</text>`).join('');
  body.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${animate ? 'anim' : ''}" role="img" aria-label="${esc(ds.title)}">${grid}${marks}</svg>`;
  wireHover(body, ds, tipEl, (i, k) => `<b>${esc(cats[i])}</b><br>${S.length > 1 ? `<i style="background:${SERIES[k]}"></i>${esc(S[k].name)}: ` : ''}${fmt(S[k].values[i], ds)} ${esc(ds.unit || '')}`);
  if (animate) growBars(body);
}

function roundedBar(x, y, w, h) {
  if (w <= 0) return `M${x} ${y}h0v${h}h0z`;
  const r = Math.min(4, w, h / 2);
  return `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}z`;
}

// Vertical columns for yearly series (grouped by year).
function columns(body, ds, tipEl, animate) {
  const cats = ds.categories, S = ds.series;
  const max = niceMax(Math.max(...S.flatMap((s) => s.values.map((v) => v || 0))));
  const W = 640, H = 300, left = 52, bottom = 26, top = 10;
  const plotW = W - left - 10, plotH = H - bottom - top;
  const band = plotW / cats.length;
  const bw = Math.min(24, (band * 0.7) / S.length - 2);
  const y = (v) => top + plotH - (v / max) * plotH;
  let marks = '';
  cats.forEach((c, i) => {
    const gx = left + i * band + (band - (bw + 2) * S.length) / 2;
    S.forEach((s, k) => {
      const v = s.values[i] || 0, h = (v / max) * plotH;
      const x0 = gx + k * (bw + 2);
      const r = Math.min(4, bw / 2, h);
      marks += `<path class="mk col" data-i="${i}" data-k="${k}" d="M${x0} ${top + plotH}v-${Math.max(0, h - r)}a${r} ${r} 0 0 1 ${r} -${r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${Math.max(0, h - r)}z" fill="${SERIES[k]}"/>`;
    });
    marks += `<text class="tick" x="${left + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>`;
  });
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line class="grid" x1="${left}" x2="${W - 10}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="tick" x="${left - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt(max * f, ds)}</text>`).join('');
  body.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${animate ? 'anim' : ''}" role="img" aria-label="${esc(ds.title)}">${grid}${marks}</svg>`;
  wireHover(body, ds, tipEl, (i, k) => `<b>${esc(cats[i])}</b><br>${S.length > 1 ? `<i style="background:${SERIES[k]}"></i>${esc(S[k].name)}: ` : ''}${fmt(S[k].values[i], ds)} ${esc(ds.unit || '')}`);
  if (animate) body.querySelectorAll('.mk').forEach((m, n) => { m.style.transformOrigin = `0 ${top + plotH}px`; m.style.animationDelay = `${n * 40}ms`; });
}

function line(body, ds, tipEl, animate) {
  const cats = ds.categories, S = ds.series;
  const max = niceMax(Math.max(...S.flatMap((s) => s.values.map((v) => v || 0))));
  const W = 640, H = 300, left = 56, right = S.length <= 4 ? 120 : 16, bottom = 28, top = 12;
  const plotW = W - left - right, plotH = H - top - bottom;
  const x = (i) => left + (cats.length === 1 ? plotW / 2 : (i / (cats.length - 1)) * plotW);
  const y = (v) => top + plotH - (v / max) * plotH;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line class="grid" x1="${left}" x2="${left + plotW}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="tick" x="${left - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt(max * f, ds)}</text>`).join('');
  const every = Math.max(1, Math.ceil(cats.length / 8));
  const xt = cats.map((c, i) => (i % every === 0 || i === cats.length - 1 ? `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(c)}</text>` : '')).join('');
  let paths = '', ends = '';
  S.forEach((s, k) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v || 0).toFixed(1)}`).join('');
    if (S.length === 1) paths += `<path d="${d}L${x(cats.length - 1)} ${y(0)}L${x(0)} ${y(0)}z" fill="${SERIES[k]}" opacity="0.1"/>`;
    paths += `<path class="ln" d="${d}" fill="none" stroke="${SERIES[k]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>`;
    const li = s.values.length - 1;
    ends += `<circle cx="${x(li)}" cy="${y(s.values[li] || 0)}" r="4" fill="${SERIES[k]}" stroke="#1a1a19" stroke-width="2"/>`;
    if (S.length <= 4) ends += `<text class="val" x="${x(li) + 8}" y="${y(s.values[li] || 0) + 4}">${esc(S.length > 1 ? s.name : fmt(s.values[li], ds))}</text>`;
  });
  // Peak label for single series.
  if (S.length === 1) {
    const v = S[0].values; let pi = 0; v.forEach((q, i) => { if ((q || 0) > (v[pi] || 0)) pi = i; });
    ends += `<circle cx="${x(pi)}" cy="${y(v[pi])}" r="4" fill="${SERIES[0]}" stroke="#1a1a19" stroke-width="2"/><text class="val" x="${x(pi)}" y="${y(v[pi]) - 10}" text-anchor="middle">${esc(cats[pi])}: ${fmt(v[pi], ds)}</text>`;
  }
  body.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${animate ? 'anim' : ''}" role="img" aria-label="${esc(ds.title)}">${grid}${xt}${paths}${ends}<line class="xhair hidden" y1="${top}" y2="${top + plotH}"/><rect class="hit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/></svg>`;
  const svg = body.querySelector('svg'), hit = body.querySelector('.hit'), xh = body.querySelector('.xhair');
  const tip = hoverTip(tipEl, body.parentElement);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = (ev.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(cats.length - 1, Math.round((sx - left) / plotW * (cats.length - 1))));
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.classList.remove('hidden');
    const host = body.parentElement.getBoundingClientRect();
    tip.show(`<b>${esc(cats[i])}</b>${S.map((s, k) => `<br><i style="background:${SERIES[k]}"></i>${esc(s.name)}: ${fmt(s.values[i], ds)}`).join('')}`, r.left - host.left + x(i) / W * r.width, r.top - host.top + 20);
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { tip.hide(); xh.classList.add('hidden'); });
}

function milestones(body, ds, animate) {
  body.innerHTML = `<ol class="milestones ${animate ? 'anim' : ''}">${(ds.items || []).map((it, i) => `<li style="animation-delay:${i * 0.35}s"><time>${esc(it.date)}</time><span>${esc(it.label)}</span></li>`).join('')}</ol>`;
}

function wireHover(body, ds, tipEl, html) {
  const tip = hoverTip(tipEl, body.parentElement);
  body.querySelectorAll('.mk').forEach((m) => {
    const on = (ev) => {
      const host = body.parentElement.getBoundingClientRect();
      const r = m.getBoundingClientRect();
      tip.show(html(+m.dataset.i, +m.dataset.k), r.left - host.left + r.width / 2, r.top - host.top);
      m.classList.add('hl');
    };
    m.addEventListener('pointerenter', on);
    m.addEventListener('pointerdown', on);
    m.addEventListener('pointerleave', () => { tip.hide(); m.classList.remove('hl'); });
  });
}

function growBars(body) {
  body.querySelectorAll('.mk, .mk-sq').forEach((m, n) => { m.style.animationDelay = `${Math.floor(n / 2) * 45}ms`; });
}
