'use strict';

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

// ═══════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════
const G         = 100;       // gravitational constant
const SOFT2     = 10 * 10;   // softening² to prevent singularity
const TRAIL_MAX = 500;       // max trail points per body
const DT        = 0.05;      // physics timestep per substep
const BASE_SUBS = 5;         // substeps per frame at speed ×1
const VEL_SCALE = 0.10;      // pixel-drag → velocity unit

const PALETTE = [
  '#ff6b6b','#ffd93d','#6bcb77','#4d96ff',
  '#ff9f40','#c56bff','#40e0d0','#ff6bcd','#f0f0f0','#ff922b'
];
let _pIdx = 0;
const nextColor = () => PALETTE[_pIdx++ % PALETTE.length];

// ═══════════════════════════════════════════════════════════
//  Body
// ═══════════════════════════════════════════════════════════
class Body {
  constructor(x, y, vx = 0, vy = 0, mass = 100) {
    this.id    = ++Body._uid;
    this.x = x;  this.y = y;
    this.vx = vx; this.vy = vy;
    this.mass  = mass;
    this.color = nextColor();
    this.label = 'Body ' + this.id;  // user-editable name
    this.trail = [];
    this.ax = 0; this.ay = 0;
  }
  get radius() { return Math.max(4, Math.cbrt(this.mass) * 1.8); }
  get name()   { return this.label; }
}
Body._uid = 0;

// ═══════════════════════════════════════════════════════════
//  Simulation state
// ═══════════════════════════════════════════════════════════
let bodies       = [];
let running      = false;
let mergeEnabled = true;
let substepCount = BASE_SUBS;
let selected     = null;
let rafId        = null;
let simTime      = 0;
let trailTick    = 0;
let stars        = [];
let drag         = null; // { type:'new'|'body', body?, sx, sy, cx, cy }
let panDrag      = null; // { sx, sy, startPanX, startPanY, moved }
let camera       = { panX: 0, panY: 0, zoom: 1 };

// ═══════════════════════════════════════════════════════════
//  Canvas setup
// ═══════════════════════════════════════════════════════════
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

function resize() {
  canvas.width  = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  buildStars();
  if (!running) render();
}
new ResizeObserver(resize).observe(canvas.parentElement);

function buildStars() {
  stars = [];
  const n = Math.ceil(canvas.width * canvas.height / 4000);
  for (let i = 0; i < n; i++)
    stars.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height,
                 r: Math.random()*1.0+0.3, a: Math.random()*0.55+0.2 });
}

// ═══════════════════════════════════════════════════════════
//  Physics  (Velocity Verlet — 2nd-order symplectic)
// ═══════════════════════════════════════════════════════════
function computeAccels() {
  for (const b of bodies) { b.ax = 0; b.ay = 0; }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;
      const d2 = dx*dx + dy*dy + SOFT2;
      const d  = Math.sqrt(d2);
      const f  = G / d2;
      const ux = dx/d, uy = dy/d;
      bodies[i].ax += f * ux * bodies[j].mass;
      bodies[i].ay += f * uy * bodies[j].mass;
      bodies[j].ax -= f * ux * bodies[i].mass;
      bodies[j].ay -= f * uy * bodies[i].mass;
    }
  }
}

function physicsStep(dt) {
  // Step 1: update positions using current v and a
  const hdt2 = 0.5 * dt * dt;
  for (const b of bodies) {
    b.x += b.vx * dt + b.ax * hdt2;
    b.y += b.vy * dt + b.ay * hdt2;
  }
  // Step 2: save old accelerations, compute new ones
  const axOld = bodies.map(b => b.ax);
  const ayOld = bodies.map(b => b.ay);
  computeAccels();
  // Step 3: update velocities with average acceleration
  for (let i = 0; i < bodies.length; i++) {
    bodies[i].vx += 0.5 * (axOld[i] + bodies[i].ax) * dt;
    bodies[i].vy += 0.5 * (ayOld[i] + bodies[i].ay) * dt;
  }
}

function recordTrail() {
  for (const b of bodies) {
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > TRAIL_MAX) b.trail.shift();
  }
}

function doMerges() {
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const dx   = bodies[j].x - bodies[i].x;
        const dy   = bodies[j].y - bodies[i].y;
        const rSum = bodies[i].radius + bodies[j].radius;
        if (dx*dx + dy*dy < rSum * rSum * 0.5) {
          const a = bodies[i], b = bodies[j];
          const m = a.mass + b.mass;
          // Bigger body absorbs smaller
          const big = a.mass >= b.mass ? a : b;
          const sml = big === a ? b : a;
          big.x  = (a.x*a.mass + b.x*b.mass) / m;
          big.y  = (a.y*a.mass + b.y*b.mass) / m;
          big.vx = (a.vx*a.mass + b.vx*b.mass) / m;
          big.vy = (a.vy*a.mass + b.vy*b.mass) / m;
          big.mass = m;
          bodies.splice(bodies.indexOf(sml), 1);
          if (selected === sml) { selected = null; updateEditor(); }
          updateBodyList();
          changed = true;
          break outer;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  Simulation loop
// ═══════════════════════════════════════════════════════════
function loop() {
  if (!running) return;
  for (let i = 0; i < substepCount; i++) {
    physicsStep(DT);
    trailTick++;
    if (trailTick % 2 === 0) recordTrail();
  }
  if (mergeEnabled) doMerges();
  simTime += DT * substepCount;
  render();
  updateEditorLive();
  updateStats();
  rafId = requestAnimationFrame(loop);
}

function startSim() {
  if (running) return;
  running = true;
  computeAccels();
  updatePlayBtn();
  rafId = requestAnimationFrame(loop);
}

function pauseSim() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  updatePlayBtn();
}

function toggleSim() { running ? pauseSim() : startSim(); }

// ═══════════════════════════════════════════════════════════
//  Rendering
// ═══════════════════════════════════════════════════════════
function render() {
  const W = canvas.width, H = canvas.height;

  // Background (screen space)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = cssVar('--sim-canvas-bg');
  ctx.fillRect(0, 0, W, H);

  // Stars (fixed to screen — no camera transform)
  ctx.save();
  for (const s of stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle   = cssVar('--sim-star');
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // World-space objects — apply camera transform
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, camera.panX, camera.panY);

  // Trails
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap  = 'round';
  for (const b of bodies) renderTrail(b);
  ctx.restore();

  // Bodies
  for (const b of bodies) renderBody(b);

  // Velocity arrow while dragging to place new body
  if (drag && drag.type === 'new') renderArrow();

  // Restore to screen space
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Minimap (screen space)
  renderMinimap();
}

function renderTrail(b) {
  const t = b.trail;
  if (t.length < 2) return;
  // Downsample for performance; keep at most 180 drawn segments
  const step = Math.max(1, Math.floor(t.length / 180));
  for (let i = step; i < t.length; i += step) {
    const frac = i / t.length;
    ctx.globalAlpha = frac * 0.88;
    ctx.strokeStyle = b.color;
    ctx.lineWidth   = Math.max(0.4, frac * b.radius * 0.5);
    ctx.beginPath();
    ctx.moveTo(t[i - step].x, t[i - step].y);
    ctx.lineTo(t[i].x, t[i].y);
    ctx.stroke();
  }
}

function renderBody(b) {
  const r = b.radius;

  // Outer glow
  const glow = ctx.createRadialGradient(b.x, b.y, r * 0.5, b.x, b.y, r * 4);
  glow.addColorStop(0, hex2rgba(b.color, 0.35));
  glow.addColorStop(1, hex2rgba(b.color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r * 4, 0, Math.PI * 2);
  ctx.fill();

  // Sphere with highlight
  const sphere = ctx.createRadialGradient(b.x - r * 0.25, b.y - r * 0.3, 0, b.x, b.y, r);
  sphere.addColorStop(0,   '#ffffff');
  sphere.addColorStop(0.3, b.color);
  sphere.addColorStop(1,   darken(b.color, 0.45));
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();

  // Selection ring
  if (b === selected) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, r + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Name label above the body
  if (b.label) {
    ctx.save();
    ctx.font         = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = b.y - r - 8;
    // Shadow for readability over any background
    ctx.globalAlpha  = 0.65;
    ctx.fillStyle    = '#000000';
    ctx.fillText(b.label, b.x + 1, labelY + 1);
    // Coloured text
    ctx.globalAlpha  = 0.92;
    ctx.fillStyle    = b.color;
    ctx.fillText(b.label, b.x, labelY);
    ctx.restore();
  }
}

function renderArrow() {
  const { sx, sy, cx, cy } = drag;
  const dx = cx - sx, dy = cy - sy;
  const len = Math.hypot(dx, dy);
  if (len < 5) return;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#90c0ff';
  ctx.fillStyle   = '#90c0ff';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Arrowhead
  const ang = Math.atan2(dy, dx);
  const hs  = 11;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - hs * Math.cos(ang - 0.42), cy - hs * Math.sin(ang - 0.42));
  ctx.lineTo(cx - hs * Math.cos(ang + 0.42), cy - hs * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();

  // Velocity label
  ctx.globalAlpha = 0.75;
  ctx.fillStyle   = '#c0d8ff';
  ctx.font        = '11px monospace';
  ctx.fillText('v = ' + (len * VEL_SCALE).toFixed(2), cx + 10, cy - 8);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
//  Color helpers
// ═══════════════════════════════════════════════════════════
function hex2rgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return 'rgba(' + (n>>16) + ',' + ((n>>8)&0xff) + ',' + (n&0xff) + ',' + a + ')';
}
function darken(hex, f) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n>>16)      ) * f);
  const g = Math.round(((n>>8 )&0xff ) * f);
  const b = Math.round(((n    )&0xff ) * f);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// ═══════════════════════════════════════════════════════════
//  Minimap
// ═══════════════════════════════════════════════════════════
const MM = { w: 168, h: 116, margin: 12, pad: 8, radius: 7 };
let mmState = null; // cached each frame for click hit-testing

function mmRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);      ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

function renderMinimap() {
  const W = canvas.width, H = canvas.height;
  const mx = W - MM.w - MM.margin;
  const my = H - MM.h - MM.margin;

  // World bounds: union of all body positions and current viewport
  const vpL = (0 - camera.panX) / camera.zoom, vpR = (W - camera.panX) / camera.zoom;
  const vpT = (0 - camera.panY) / camera.zoom, vpB = (H - camera.panY) / camera.zoom;

  let wL = vpL, wR = vpR, wT = vpT, wB = vpB;
  for (const b of bodies) {
    wL = Math.min(wL, b.x); wR = Math.max(wR, b.x);
    wT = Math.min(wT, b.y); wB = Math.max(wB, b.y);
  }
  const ex = (wR - wL) * 0.06, ey = (wB - wT) * 0.06;
  wL -= ex; wR += ex; wT -= ey; wB += ey;

  const rangeX = wR - wL || 1, rangeY = wB - wT || 1;
  const innerW = MM.w - MM.pad * 2, innerH = MM.h - MM.pad * 2;
  const scl    = Math.min(innerW / rangeX, innerH / rangeY);

  const wCX = (wL + wR) / 2, wCY = (wT + wB) / 2;
  const ocx  = mx + MM.w / 2,  ocy = my + MM.h / 2;

  const toSX = wx => ocx + (wx - wCX) * scl;
  const toSY = wy => ocy + (wy - wCY) * scl;

  mmState = { mx, my, wCX, wCY, scl, ocx, ocy };

  ctx.save();

  // Background panel
  ctx.fillStyle   = 'rgba(4,4,18,0.88)';
  ctx.strokeStyle = '#252742';
  ctx.lineWidth   = 1;
  mmRoundRect(mx, my, MM.w, MM.h, MM.radius);
  ctx.fill();
  ctx.stroke();

  // Clip content to panel interior
  mmRoundRect(mx + 1, my + 1, MM.w - 2, MM.h - 2, MM.radius - 1);
  ctx.clip();

  // Viewport rectangle
  const vx1 = toSX(vpL), vy1 = toSY(vpT);
  const vx2 = toSX(vpR), vy2 = toSY(vpB);
  ctx.fillStyle   = 'rgba(74,158,255,0.07)';
  ctx.strokeStyle = 'rgba(74,158,255,0.6)';
  ctx.lineWidth   = 1;
  ctx.fillRect(vx1, vy1, vx2 - vx1, vy2 - vy1);
  ctx.strokeRect(vx1, vy1, vx2 - vx1, vy2 - vy1);

  // Bodies
  for (const b of bodies) {
    const bx = toSX(b.x), by = toSY(b.y);
    const r  = Math.max(1.5, Math.min(b.radius * scl * 0.9, 5));
    // Subtle glow
    ctx.globalAlpha = 0.3;
    ctx.fillStyle   = b.color;
    ctx.beginPath();
    ctx.arc(bx, by, r * 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Solid dot
    ctx.globalAlpha = 0.95;
    ctx.fillStyle   = b.color;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // "MINIMAP" label
  ctx.globalAlpha  = 0.32;
  ctx.fillStyle    = '#c0cce0';
  ctx.font         = '8px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('MINIMAP', mx + 6, my + 4);

  ctx.restore();
}


function canvasXY(e) {
  const r = canvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) * (canvas.width  / r.width);
  const sy = (e.clientY - r.top)  * (canvas.height / r.height);
  return {
    x: (sx - camera.panX) / camera.zoom,
    y: (sy - camera.panY) / camera.zoom
  };
}

function screenCoords(e) {
  const r = canvas.getBoundingClientRect();
  return {
    sx: (e.clientX - r.left) * (canvas.width  / r.width),
    sy: (e.clientY - r.top)  * (canvas.height / r.height)
  };
}

function bodyAt(x, y) {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b  = bodies[i];
    const dx = x - b.x, dy = y - b.y;
    if (dx*dx + dy*dy <= (b.radius + 6) ** 2) return b;
  }
  return null;
}

canvas.addEventListener('mousedown', e => {
  if (e.button === 1) {   // middle click → fit all
    e.preventDefault();
    fitAll();
    return;
  }
  if (e.button === 2) {   // right click → start pan
    const { sx, sy } = screenCoords(e);
    panDrag = { sx, sy, startPanX: camera.panX, startPanY: camera.panY, moved: false };
    canvas.classList.add('grabbing');
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  // Minimap click → pan camera to that world position
  const { sx, sy } = screenCoords(e);
  if (mmState && sx >= mmState.mx && sx <= mmState.mx + MM.w &&
                 sy >= mmState.my && sy <= mmState.my + MM.h) {
    const wx = mmState.wCX + (sx - mmState.ocx) / mmState.scl;
    const wy = mmState.wCY + (sy - mmState.ocy) / mmState.scl;
    camera.panX = canvas.width  / 2 - wx * camera.zoom;
    camera.panY = canvas.height / 2 - wy * camera.zoom;
    if (!running) render();
    return;
  }
  const { x, y } = canvasXY(e);
  const hit = bodyAt(x, y);
  if (hit) {
    selectBody(hit);
    if (!running) {
      drag = { type: 'body', body: hit, sx: x, sy: y, cx: x, cy: y };
      canvas.classList.add('grabbing');
    }
  } else {
    selectBody(null);
    drag = { type: 'new', sx: x, sy: y, cx: x, cy: y };
  }
});

canvas.addEventListener('mousemove', e => {
  if (panDrag) {
    const { sx, sy } = screenCoords(e);
    const dx = sx - panDrag.sx, dy = sy - panDrag.sy;
    if (Math.hypot(dx, dy) > 3) panDrag.moved = true;
    camera.panX = panDrag.startPanX + dx;
    camera.panY = panDrag.startPanY + dy;
    if (!running) render();
    return;
  }
  if (!drag) return;
  const { x, y } = canvasXY(e);
  drag.cx = x; drag.cy = y;
  if (drag.type === 'body') {
    drag.body.x = x;
    drag.body.y = y;
    drag.body.trail = [];
    updateEditorLive();
  }
  if (!running) render();
});

canvas.addEventListener('mouseup', e => {
  if (e.button === 2) {
    if (panDrag && !panDrag.moved) {
      const { x, y } = canvasXY(e);
      const b = bodyAt(x, y);
      if (b) deleteBody(b);
    }
    panDrag = null;
    canvas.classList.remove('grabbing');
    return;
  }
  if (!drag) return;
  const { x, y } = canvasXY(e);
  if (drag.type === 'new') {
    const dx  = x - drag.sx, dy = y - drag.sy;
    const b   = new Body(drag.sx, drag.sy, dx * VEL_SCALE, dy * VEL_SCALE, 100);
    bodies.push(b);
    selectBody(b);
    updateBodyList();
    if (!running) render();
  }
  drag = null;
  canvas.classList.remove('grabbing');
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const { sx, sy } = screenCoords(e);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const wx = (sx - camera.panX) / camera.zoom;
  const wy = (sy - camera.panY) / camera.zoom;
  camera.zoom = Math.max(0.02, Math.min(100, camera.zoom * factor));
  camera.panX = sx - wx * camera.zoom;
  camera.panY = sy - wy * camera.zoom;
  if (!running) render();
}, { passive: false });

canvas.addEventListener('mouseleave', () => {
  if (drag && drag.type === 'new') { drag = null; if (!running) render(); }
  if (panDrag) panDrag = null;
  canvas.classList.remove('grabbing');
});

// ═══════════════════════════════════════════════════════════
//  Body management
// ═══════════════════════════════════════════════════════════
function deleteBody(b) {
  const i = bodies.indexOf(b);
  if (i >= 0) bodies.splice(i, 1);
  if (selected === b) { selected = null; updateEditor(); }
  updateBodyList();
  if (!running) render();
}

function confirmDeleteBody(b) {
  PortfolioUI.confirm('Delete body "' + (b.name || 'unnamed') + '"?',
    { okText: 'Delete', danger: true }).then(ok => { if (ok) deleteBody(b); });
}

function selectBody(b) {
  selected = b;
  updateBodyList();
  updateEditor();
}

function clearAll() {
  if (bodies.length === 0) return;
  PortfolioUI.confirm('Remove all ' + bodies.length + ' bodies?',
    { okText: 'Clear', danger: true }).then(ok => {
    if (!ok) return;
    pauseSim();
    bodies = []; selected = null; simTime = 0; trailTick = 0;
    camera.panX = 0; camera.panY = 0; camera.zoom = 1;
    updateBodyList(); updateEditor(); updateStats(); render();
    PortfolioUI.toast('Scene cleared', { type: 'success' });
  });
}

function resetSim() {
  pauseSim();
  simTime = 0; trailTick = 0;
  for (const b of bodies) b.trail = [];
  updateStats(); render();
}

// ═══════════════════════════════════════════════════════════
//  UI updates
// ═══════════════════════════════════════════════════════════
function updatePlayBtn() {
  const btn = document.getElementById('btn-play');
  btn.innerHTML = running ? '&#9646;&#9646; Pause' : '&#9654; Play';
}

function onSpeed(v) {
  substepCount = BASE_SUBS * v;
  document.getElementById('speed-lbl').textContent = v + '\u00d7';
}

function updateBodyList() {
  const list = document.getElementById('body-list');
  document.getElementById('body-count').textContent = bodies.length;
  document.getElementById('s-n').textContent        = bodies.length;
  list.innerHTML = '';
  for (const b of bodies) {
    const row = document.createElement('div');
    row.className = 'brow' + (b === selected ? ' sel' : '');
    const safeName = String(b.name == null ? '' : b.name)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    row.innerHTML =
      '<div class="bdot" style="background:' + b.color + '"></div>' +
      '<div class="bname">' + safeName + '</div>' +
      '<div class="bmass">' + fmtMass(b.mass) + '</div>' +
      '<button class="bdel" data-action="delete-body" data-body-id="' + b.id + '">&#215;</button>';
    row.addEventListener('click', e => { if (!e.target.closest('.bdel')) selectBody(b); });
    list.appendChild(row);
  }
}

function deleteBodyById(id) {
  const b = bodies.find(b => b.id === id);
  if (b) confirmDeleteBody(b);
}

function fmtMass(m) {
  if (m >= 1e6) return (m / 1e6).toFixed(1) + 'M';
  if (m >= 1e3) return (m / 1e3).toFixed(1) + 'k';
  return m.toFixed(0);
}

function updateEditor() {
  const ec = document.getElementById('econtent');
  if (!selected) {
    ec.innerHTML = '<div class="no-sel">Click a body on canvas<br>or in the list to edit</div>';
    return;
  }
  const b = selected;
  ec.innerHTML =
    '<div class="field">' +
      '<div class="flbl">Name</div>' +
      '<input type="text" id="f-name" data-editor="name" value="' + b.label + '" maxlength="24" style="flex:1;background:var(--field);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 7px;font-size:12px;min-width:0;">' +
    '</div>' +
    '<div class="field">' +
      '<div class="flbl">Color</div>' +
      '<input type="color" data-editor="color" value="' + b.color + '">' +
    '</div>'+
    '<div class="field">' +
      '<div class="flbl">Mass</div>' +
      '<input type="number" id="f-mass" data-editor="mass" value="' + b.mass.toFixed(1) + '" min="1" max="9999999" step="10">' +
    '</div>' +
    '<div class="field">' +
      '<div class="flbl">X</div>' +
      '<input type="number" id="f-x" data-editor="x" value="' + b.x.toFixed(1) + '" step="1">' +
    '</div>' +
    '<div class="field">' +
      '<div class="flbl">Y</div>' +
      '<input type="number" id="f-y" data-editor="y" value="' + b.y.toFixed(1) + '" step="1">' +
    '</div>' +
    '<div class="field">' +
      '<div class="flbl">Vel X</div>' +
      '<input type="number" id="f-vx" data-editor="vx" value="' + b.vx.toFixed(3) + '" step="0.5">' +
    '</div>' +
    '<div class="field">' +
      '<div class="flbl">Vel Y</div>' +
      '<input type="number" id="f-vy" data-editor="vy" value="' + b.vy.toFixed(3) + '" step="0.5">' +
    '</div>' +
    '<button class="danger" id="del-body">&#8855; Delete Body</button>';
}

function updateEditorLive() {
  if (!selected) return;
  const b   = selected;
  const fx  = document.getElementById('f-x');
  const fy  = document.getElementById('f-y');
  const fvx = document.getElementById('f-vx');
  const fvy = document.getElementById('f-vy');
  const fm  = document.getElementById('f-mass');
  if (fx  && document.activeElement !== fx)  fx.value  = b.x.toFixed(1);
  if (fy  && document.activeElement !== fy)  fy.value  = b.y.toFixed(1);
  if (fvx && document.activeElement !== fvx) fvx.value = b.vx.toFixed(3);
  if (fvy && document.activeElement !== fvy) fvy.value = b.vy.toFixed(3);
  if (fm  && document.activeElement !== fm)  fm.value  = b.mass.toFixed(1);
  // keep body list mass updated
  updateBodyList();
}

function selName(v)  { if (selected) { selected.label = v; updateBodyList(); if (!running) render(); } }
function selColor(v) { if (selected) { selected.color = v; updateBodyList(); if (!running) render(); } }
function selMass(v)  { if (selected && v > 0) { selected.mass = v; if (!running) render(); } }
function selXY(ax,v) { if (selected) { selected[ax] = v; if (!running) render(); } }
function selV(ax,v)  { if (selected) selected['v' + ax] = v; }

function updateStats() {
  document.getElementById('s-t').textContent = simTime.toFixed(0);
  let ke = 0;
  for (const b of bodies) ke += 0.5 * b.mass * (b.vx*b.vx + b.vy*b.vy);
  document.getElementById('s-ke').textContent = ke >= 1e6
    ? (ke/1e6).toFixed(2)+'M' : ke >= 1e3 ? (ke/1e3).toFixed(1)+'k' : ke.toFixed(0);
}

// ═══════════════════════════════════════════════════════════
//  Presets
// ═══════════════════════════════════════════════════════════
function loadPreset(name) {
  if (!name) return;
  pauseSim();
  bodies = []; selected = null; simTime = 0; trailTick = 0;
  _pIdx = 0;
  camera.panX = 0; camera.panY = 0; camera.zoom = 1;
  const cx = canvas.width / 2, cy = canvas.height / 2;

  switch (name) {

    case 'binary': {
      // Two equal masses in circular orbit
      const M = 500, d = 150;
      const v = Math.sqrt(G * M / (4 * d));   // v = sqrt(GM/4d)
      const b1 = new Body(cx - d, cy,  0, -v, M);
      const b2 = new Body(cx + d, cy,  0,  v, M);
      b1.label = 'Star A'; b2.label = 'Star B';
      bodies.push(b1, b2);
      break;
    }

    case 'threebody': {
      // Equal masses at vertices of equilateral triangle
      const M = 300, R = 160;
      const L = R * Math.sqrt(3);              // side length
      const v = Math.sqrt(G * M / L);          // circular orbit speed
      const angles = [Math.PI/2, Math.PI/2 + 2*Math.PI/3, Math.PI/2 + 4*Math.PI/3];
      const threeNames = ['Alpha', 'Beta', 'Gamma'];
      for (let i = 0; i < angles.length; i++) {
        const ang = angles[i];
        const b = new Body(
          cx + R * Math.cos(ang), cy + R * Math.sin(ang),
          v  * Math.cos(ang + Math.PI/2),
          v  * Math.sin(ang + Math.PI/2),
          M
        );
        b.label = threeNames[i];
        bodies.push(b);
      }
      break;
    }

    case 'figure8': {
      // Chenciner-Montgomery figure-8 three-body orbit
      // Scaled for G=100, m=50: position scale L, velocity scale sqrt(G*m/L)
      const m = 50, L = 150;
      const VS = Math.sqrt(G * m / L);         // ~= 5.77
      const x1 = 0.97000436 * L, y1 = -0.24308753 * L;
      const vxM = 0.93240737 * VS, vyM = 0.86473146 * VS;
      // v1=v3 = (-vxM/2, -vyM/2),  v2 = (vxM, vyM)
      const f8names = ['P', 'Q', 'R'];
      const f8bodies = [
        new Body(cx + x1,  cy + y1, -vxM / 2, -vyM / 2, m),
        new Body(cx,       cy,       vxM,       vyM,     m),
        new Body(cx - x1,  cy - y1, -vxM / 2, -vyM / 2, m)
      ];
      f8bodies.forEach((b, i) => { b.label = f8names[i]; bodies.push(b); });
      break;
    }

    case 'solar': {
      // All 8 planets in circular orbits.
      // Keys to stability:
      //  1. Planets spread at even angles so gravitational forces on the star cancel.
      //  2. Planet masses are tiny relative to the star (~1%) so perturbations stay small.
      //  3. Correct two-body orbital speed: v = sqrt(G*(Ms+m)/r).
      //  4. Star gets a counter-kick so total system momentum = 0.
      const Ms = 2000;
      const star = new Body(cx, cy, 0, 0, Ms);
      star.color = '#ffd93d';
      star.label = 'Sun';
      bodies.push(star);

      // Radii compressed to fit canvas; masses << star mass for stability.
      // Angles evenly spread (≈45° apart) so the star's net kick is near zero.
      const planets = [
        { r:  65, m: 1, color: '#b09070', label: 'Mercury', angle: 0            },
        { r:  98, m: 2, color: '#ffe090', label: 'Venus',   angle: Math.PI*0.25 },
        { r: 135, m: 2, color: '#4d96ff', label: 'Earth',   angle: Math.PI*0.5  },
        { r: 178, m: 1, color: '#e05030', label: 'Mars',    angle: Math.PI*0.75 },
        { r: 250, m: 8, color: '#d09060', label: 'Jupiter', angle: Math.PI*1.0  },
        { r: 320, m: 6, color: '#e8d880', label: 'Saturn',  angle: Math.PI*1.25 },
        { r: 385, m: 3, color: '#80d8e8', label: 'Uranus',  angle: Math.PI*1.5  },
        { r: 445, m: 3, color: '#3060e0', label: 'Neptune', angle: Math.PI*1.75 },
      ];

      let starVx = 0, starVy = 0;
      for (const p of planets) {
        const v  = Math.sqrt(G * (Ms + p.m) / p.r);
        const vx = -v * Math.sin(p.angle);
        const vy =  v * Math.cos(p.angle);
        const b  = new Body(cx + p.r * Math.cos(p.angle), cy + p.r * Math.sin(p.angle), vx, vy, p.m);
        b.color  = p.color;
        b.label  = p.label;
        bodies.push(b);
        starVx  -= p.m * vx / Ms;
        starVy  -= p.m * vy / Ms;
      }
      star.vx = starVx;
      star.vy = starVy;
      break;
    }

    case 'earthmoon': {
      // Sun + Earth in circular orbit + Moon orbiting Earth
      const Ms = 2000, Me = 2, Mm = 0.025;
      const rE = 135;   // Earth–Sun distance (pixels)
      const rM = 22;    // Moon–Earth distance (pixels)

      const sun = new Body(cx, cy, 0, 0, Ms);
      sun.color = '#ffd93d'; sun.label = 'Sun';

      // Earth at (cx + rE, cy), orbiting counterclockwise
      const vE = Math.sqrt(G * (Ms + Me) / rE);
      const earth = new Body(cx + rE, cy, 0, vE, Me);
      earth.color = '#4d96ff'; earth.label = 'Earth';

      // Moon at (cx + rE + rM, cy), orbiting Earth counterclockwise
      const vMrel = Math.sqrt(G * (Me + Mm) / rM);
      const moon = new Body(cx + rE + rM, cy, 0, vE + vMrel, Mm);
      moon.color = '#c8c8c8'; moon.label = 'Moon';

      // Counter-kick Sun so total momentum = 0
      sun.vy = -(Me * vE + Mm * (vE + vMrel)) / Ms;

      bodies.push(sun, earth, moon);
      break;
    }

    case 'chaos': {
      for (let i = 0; i < 8; i++) {
        const ang  = (i / 8) * Math.PI * 2;
        const r    = 80 + Math.random() * 150;
        const spd  = (Math.random() - 0.5) * 18;
        bodies.push(new Body(
          cx + r * Math.cos(ang), cy + r * Math.sin(ang),
          spd * Math.cos(ang + Math.PI/2),
          spd * Math.sin(ang + Math.PI/2),
          30 + Math.random() * 250
        ));
      }
      break;
    }
  }

  updateBodyList(); updateEditor(); updateStats(); render(); updatePlayBtn();
}

// ═══════════════════════════════════════════════════════════
//  Camera helpers
// ═══════════════════════════════════════════════════════════
function fitAll() {
  const W = canvas.width, H = canvas.height;
  if (bodies.length === 0) {
    camera.panX = 0; camera.panY = 0; camera.zoom = 1;
    if (!running) render();
    return;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of bodies) {
    const pad = b.radius * 5; // include glow footprint
    minX = Math.min(minX, b.x - pad); maxX = Math.max(maxX, b.x + pad);
    minY = Math.min(minY, b.y - pad); maxY = Math.max(maxY, b.y + pad);
  }
  const margin = 48;
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  camera.zoom = Math.min((W - margin * 2) / rangeX, (H - margin * 2) / rangeY, 20);
  camera.panX = W / 2 - ((minX + maxX) / 2) * camera.zoom;
  camera.panY = H / 2 - ((minY + maxY) / 2) * camera.zoom;
  if (!running) render();
}

// ═══════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════
function bindSimulatorEvents() {
  document.getElementById('btn-play').addEventListener('click', toggleSim);
  document.getElementById('btn-reset').addEventListener('click', resetSim);
  document.getElementById('btn-clear').addEventListener('click', clearAll);
  document.getElementById('speed-sl').addEventListener('input', e => onSpeed(+e.target.value));
  document.getElementById('merge-cb').addEventListener('change', e => { mergeEnabled = e.target.checked; });
  document.getElementById('preset-select').addEventListener('change', e => {
    loadPreset(e.target.value);
    e.target.value = '';
  });

  document.getElementById('body-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete-body"]');
    if (!btn) return;
    e.stopPropagation();
    deleteBodyById(+btn.dataset.bodyId);
  });

  const editor = document.getElementById('econtent');
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('change', onEditorInput);
  editor.addEventListener('click', e => {
    if (e.target.id === 'del-body' && selected) confirmDeleteBody(selected);
  });

  // Keyboard shortcuts (ignore while typing in inputs)
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); toggleSim(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetSim(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      confirmDeleteBody(selected);
    }
  });
}

function onEditorInput(e) {
  const field = e.target.dataset.editor;
  if (!field) return;
  if (field === 'name') selName(e.target.value);
  else if (field === 'color') selColor(e.target.value);
  else if (field === 'mass') selMass(+e.target.value);
  else if (field === 'x' || field === 'y') selXY(field, +e.target.value);
  else if (field === 'vx') selV('x', +e.target.value);
  else if (field === 'vy') selV('y', +e.target.value);
}

PortfolioTheme.init({ onChange: () => { if (!running && canvas.width) render(); } });
bindSimulatorEvents();
window.addEventListener('load', () => { resize(); loadPreset('solar'); });
