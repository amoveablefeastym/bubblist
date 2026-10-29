const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);

const CATS = ['work', 'study', 'life', 'admin'];
const WEEK = 'week'; // the Week tab's key, alongside day keys like '2026-10-28'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => iso(new Date());
const tomorrow = () => iso(addDays(new Date(), 1));
const thisWeek = () => { const d = new Date(); return iso(addDays(d, -((d.getDay() + 6) % 7))); }; // Monday
const daysFromToday = (s) => Math.round((parse(s) - parse(today())) / 86400000);
const shortDate = (s) => { const d = parse(s); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };

// Times are stored as 'HH:MM' (24h) and shown in the system's 12/24-hour style.
const HOUR12 = new Intl.DateTimeFormat([], { hour: 'numeric' }).resolvedOptions().hour12;
function formatTime(t) {
  const [h, m] = t.split(':').map(Number);
  if (!HOUR12) return t;
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
}
// A time frame shows as '9:30–11:00 am', or '11:30 am–1:00 pm' across noon.
function formatRange(time, end) {
  if (!end) return formatTime(time);
  if (!HOUR12) return `${time}–${end}`;
  const sameHalf = (time < '12:00') === (end < '12:00');
  return `${sameHalf ? formatTime(time).slice(0, -3) : formatTime(time)}–${formatTime(end)}`;
}
// '1h', '1.5h', '45m' between two 'HH:MM' times.
function duration(time, end) {
  const mins = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)));
  return mins < 60 ? `${mins}m` : `${+(mins / 60).toFixed(2)}h`;
}

// Reads one clock reading like '9', '9:45', '945', '9:45pm', '9p', '21:30'.
function parseClock(input) {
  const m = input.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  const half = m[3] ? m[3][0] : null;
  if (min > 59 || h > 23 || (half && (h < 1 || h > 12))) return null;
  return { h, min, half };
}
function to24({ h, min }, half) {
  let hh = h;
  if (half === 'p' && h !== 12) hh += 12;
  if (half === 'a' && h === 12) hh = 0;
  return `${pad(hh)}:${pad(min)}`;
}
function parseTime(input) {
  const c = parseClock(input);
  return c ? to24(c, c.half) : null;
}
// A single time or a range like '2-3:30pm', '9am–11', '10 to 12'.
// Returns { time, end? } in 'HH:MM', or null.
function parseTimeFrame(input) {
  const parts = input.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  if (parts.length === 1) {
    const time = parseTime(input);
    return time ? { time } : null;
  }
  if (parts.length !== 2) return null;
  const a = parseClock(parts[0]);
  const b = parseClock(parts[1]);
  if (!a || !b) return null;
  const end = to24(b, b.half);
  let time = to24(a, a.half);
  // '2-3:30pm': the start borrows the end's am/pm, unless that would put it after the end.
  if (!a.half && b.half && a.h <= 12) {
    time = to24(a, b.half);
    if (time >= end) time = to24(a, b.half === 'p' ? 'a' : 'p');
  }
  return end > time ? { time, end } : null;
}
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const gripIcon = '<svg viewBox="0 0 8 14"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>';

// Task shapes:
//   for a day:     { id, text, cat, due: 'YYYY-MM-DD', done }
//   for a week:    { id, text, cat, week: 'YYYY-MM-DD' (Monday), done }
//   every day:     { id, text, cat, repeat: 'daily',  start: day,  doneOn: { day: true } }
//   some weekdays: { id, text, cat, repeat: 'days', days: [1, 3, 5] (0 = Sun), start: day, doneOn: { day: true } }
//   every week:    { id, text, cat, repeat: 'weekly', start: week, doneOn: { week: true } }
let state = { tasks: [], days: [], collapsed: {}, lastCat: 'work' };
let selected = today();
// Repeat for the next task added: null, 'daily', an array of weekdays (day
// tabs), or 'weekly' (Week tab).
let addRepeat = null;
let addTime = null; // { time, end? } for the next task added, or null
let drag = null;
let confirmDay = null; // day tab waiting for a second click to delete
let confirmTimer;

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.save(state), 150);
}

function update() {
  save();
  render();
}

function migrate(saved) {
  const t = today();
  const wk = thisWeek();
  const next = { tasks: [], days: [], collapsed: {}, lastCat: 'work', ...(saved || {}) };
  if (saved && Array.isArray(saved.sections)) {
    // First version: fixed Today / This Week / Later sections.
    next.tasks = saved.sections.flatMap((s) => s.tasks.map((x) => ({ ...x, due: t })));
    delete next.sections;
  }
  next.tasks = next.tasks
    .map((x) => ({ cat: 'life', ...x, ...(!x.repeat && !x.week && !x.due ? { due: t } : {}) }))
    // Finished one-offs from past days or weeks have nowhere to show; let them go.
    .filter((x) => !(x.done && ((x.due && x.due < t) || (x.week && x.week < wk))));
  if (!CATS.includes(next.lastCat)) next.lastCat = 'work';
  return next;
}

// How a repeat reads: 'daily', 'weekdays', 'every mon', 'mon, wed, fri'.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const dayAbbr = (d) => DAYS[d].slice(0, 3).toLowerCase();
function repeatLabel(repeat, days) {
  if (repeat !== 'days') return repeat;
  const set = DAY_ORDER.filter((d) => days.includes(d));
  if (set.length === 7) return 'daily';
  if (set.join() === '1,2,3,4,5') return 'weekdays';
  if (set.join() === '6,0') return 'weekends';
  if (set.length === 1) return `every ${dayAbbr(set[0])}`;
  return set.map(dayAbbr).join(', ');
}

// Repeating tasks track completion per day (daily, weekdays) or per week (weekly).
const doneKey = (view) => (view === WEEK ? thisWeek() : view);
const isDone = (task, view) => (task.repeat ? !!(task.doneOn && task.doneOn[doneKey(view)]) : task.done);

function tasksFor(view) {
  if (view === WEEK) {
    const wk = thisWeek();
    return state.tasks.filter((x) => x.repeat === 'weekly'
      // Unfinished tasks from past weeks roll forward into this one.
      || (x.week && (x.week === wk || (x.week < wk && !x.done))));
  }
  const t = today();
  const dow = parse(view).getDay();
  // Daily tasks show on every day tab, whichever day they were added on;
  // weekday repeats show on the days they're set for.
  return state.tasks.filter((x) => x.repeat === 'daily'
    || (x.repeat === 'days' && x.days.includes(dow))
    // Unfinished tasks from past days roll forward into today.
    || (x.due && (x.due === view || (view === t && x.due < t && !x.done))));
}

function dayTabs() {
  const t = today();
  const days = new Set([t, tomorrow()]);
  state.days.filter((d) => d > t).forEach((d) => days.add(d));
  state.tasks.filter((x) => x.due > t).forEach((x) => days.add(x.due));
  return [...days].sort();
}

function tabLabel(view) {
  if (view === WEEK) return 'Week';
  if (view === today()) return 'Today';
  if (view === tomorrow()) return 'Tomorrow';
  const d = parse(view);
  return daysFromToday(view) < 7 ? `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}` : shortDate(view);
}

function deleteDay(day) {
  state.days = state.days.filter((d) => d !== day);
  state.tasks = state.tasks.filter((x) => x.due !== day);
  if (selected === day) selected = today();
  update();
}

function renderTabs() {
  const nav = $('tabs');
  const t = today();
  const tm = tomorrow();
  nav.replaceChildren();

  for (const view of [WEEK, ...dayTabs()]) {
    const tab = document.createElement('button');
    tab.className = 'tab' + (view === selected ? ' active' : '') + (view === WEEK ? ' week' : '');
    tab.dataset.view = view;
    tab.textContent = confirmDay === view ? 'Delete?' : tabLabel(view);
    tab.onclick = () => { selected = view; confirmDay = null; render(); };

    if (view !== WEEK && view !== t && view !== tm) {
      if (confirmDay === view) {
        tab.classList.add('confirm');
        tab.title = 'Deletes this day and its tasks';
        tab.onclick = () => { confirmDay = null; deleteDay(view); };
      } else {
        const x = document.createElement('span');
        x.className = 'x';
        x.textContent = '×';
        x.title = 'Delete this day';
        x.onclick = (e) => {
          e.stopPropagation();
          if (!state.tasks.some((task) => task.due === view)) return deleteDay(view);
          confirmDay = view;
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(() => { confirmDay = null; renderTabs(); }, 3000);
          renderTabs();
        };
        tab.append(x);
      }
    }

    nav.append(tab);
    if (view === selected) requestAnimationFrame(() => tab.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  }

  const add = document.createElement('button');
  add.className = 'tab add';
  add.dataset.view = 'pick'; // dropping a task here asks which day to move it to
  add.textContent = '+';
  add.title = 'Add another day';
  add.onclick = () => openPicker(add, (day) => {
    if (day > tomorrow() && !state.days.includes(day)) state.days.push(day);
    selected = day;
    update();
    $('new').focus();
  });
  nav.append(add);
}

function moveTask(id, cat, beforeId) {
  const i = state.tasks.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [task] = state.tasks.splice(i, 1);
  task.cat = cat;

  let at = beforeId ? state.tasks.findIndex((x) => x.id === beforeId) : -1;
  if (at < 0) {
    // Land right after the section's last visible task.
    const last = tasksFor(selected).filter((x) => x.cat === cat).at(-1);
    at = last ? state.tasks.indexOf(last) + 1 : state.tasks.length;
  }
  state.tasks.splice(at, 0, task);
}

/* Dragging: a lifted copy follows the cursor. The list itself never changes
   during the drag; instead every row is measured once at the start and the
   rows below the drop point slide down (with a CSS transition) to open a gap.
   Because targets come from that fixed snapshot, nothing jitters. */

const DRAG_EASE = 'transform .22s cubic-bezier(.2,.8,.2,1)';

function startDrag(li, task, e) {
  const main = $('sections');
  const box = main.getBoundingClientRect();
  const rect = li.getBoundingClientRect();
  const toContent = (top) => top - box.top + main.scrollTop;
  const h = rect.height;
  const origTop = toContent(rect.top);

  // Section headings and visible rows in document order, positioned as if the
  // dragged row were already gone.
  const items = [...main.querySelectorAll('.section-head, .task')]
    .filter((el) => el !== li && el.offsetParent !== null)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const top = toContent(r.top);
      const below = top > origTop;
      el.style.transition = DRAG_EASE;
      return { el, below, top: below ? top - h : top, height: r.height, head: el.classList.contains('section-head'), section: el.closest('section') };
    });

  const ghost = li.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = `${rect.width}px`;
  ghost.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  document.body.append(ghost);

  const slot = document.createElement('div');
  slot.className = 'drop-slot';
  slot.style.height = `${h}px`;
  main.append(slot);

  li.classList.add('lifted');
  document.body.classList.add('dragging');
  // Repeating tasks belong to every day/week, so day tabs don't take them.
  document.body.classList.toggle('drag-repeat', !!task.repeat);
  ghost.style.transformOrigin = `${e.clientX - rect.left}px ${e.clientY - rect.top}px`;
  drag = {
    task, li, ghost, slot, items, h,
    scale: 1.02,
    dx: e.clientX - rect.left,
    dy: e.clientY - rect.top,
    x: rect.left, y: rect.top, // where the ghost is drawn (eased toward the cursor)
    tx: rect.left, ty: rect.top, // where the cursor wants it
    px: e.clientX, py: e.clientY,
    tab: null,
    target: null,
  };
  updateTarget();
  drag.frame = requestAnimationFrame(tickDrag);
}

function tickDrag() {
  if (!drag) return;
  drag.x += (drag.tx - drag.x) * 0.55;
  drag.y += (drag.ty - drag.y) * 0.55;
  // Shrink toward a day tab while hovering it, as if being tucked into it.
  drag.scale += ((drag.tab ? 0.7 : 1.02) - drag.scale) * 0.3;
  drag.ghost.style.transform = `translate(${drag.x}px, ${drag.y}px) scale(${drag.scale})`;

  // Scroll gently while the cursor rests near the top or bottom edge.
  const main = $('sections');
  const box = main.getBoundingClientRect();
  const edge = 36;
  let speed = 0;
  if (drag.py < box.top + edge) speed = -Math.ceil((box.top + edge - drag.py) / 6);
  else if (drag.py > box.bottom - edge) speed = Math.ceil((drag.py - (box.bottom - edge)) / 6);
  if (speed && !drag.tab) {
    const before = main.scrollTop;
    main.scrollTop += speed;
    if (main.scrollTop !== before) updateTarget();
  }

  drag.frame = requestAnimationFrame(tickDrag);
}

function moveDrag(x, y) {
  drag.tx = x - drag.dx;
  drag.ty = y - drag.dy;
  drag.px = x;
  drag.py = y;

  // Repeating tasks belong to every day/week, so they can't be moved to a tab.
  const el = document.elementFromPoint(x, y);
  const tab = el && !drag.task.repeat ? el.closest('.tab[data-view]') : null;
  if (tab !== drag.tab) {
    if (drag.tab) drag.tab.classList.remove('drop');
    if (tab) tab.classList.add('drop');
    drag.tab = tab;
  }
  updateTarget();
}

// Work out where the row would land, then slide everything to show it.
function updateTarget() {
  const { items, h } = drag;
  const main = $('sections');
  const cy = drag.py - main.getBoundingClientRect().top + main.scrollTop;

  let index; // items from this index on move down to open the gap
  let slotTop;
  if (drag.tab) {
    index = items.findIndex((it) => it.below); // back to the original spot
    if (index < 0) index = items.length;
    drag.target = null;
  } else {
    const heads = items.filter((it) => it.head);
    const head = heads.reduce((found, hd) => (hd.top <= cy ? hd : found), heads[0]);
    const rows = items.filter((it) => !it.head && it.section === head.section);
    const before = head.section.classList.contains('collapsed') ? null : rows.find((r) => cy < r.top + r.height / 2);
    const nextHead = heads[heads.indexOf(head) + 1];
    index = before ? items.indexOf(before) : nextHead ? items.indexOf(nextHead) : items.length;
    const last = rows.at(-1);
    slotTop = before ? before.top : last ? last.top + last.height : head.top + head.height;
    drag.target = { cat: head.section.dataset.cat, beforeId: before ? before.el.dataset.id : null };
  }

  items.forEach((it, i) => {
    const dy = (it.below ? -h : 0) + (i >= index ? h : 0);
    it.el.style.transform = dy ? `translateY(${dy}px)` : '';
  });
  drag.slot.style.opacity = drag.target ? '1' : '0';
  if (slotTop !== undefined) drag.slot.style.transform = `translateY(${slotTop}px)`;
}

function endDrag() {
  const { task, ghost, slot, tab, target } = drag;
  cancelAnimationFrame(drag.frame);
  drag = null;
  document.body.classList.remove('dragging', 'drag-repeat');

  const finish = () => { ghost.remove(); update(); };
  const moveTo = (view) => {
    delete task.due;
    delete task.week;
    if (view === WEEK) task.week = thisWeek();
    else task.due = view;
  };

  if (tab) {
    const view = tab.dataset.view;
    if (view !== 'pick') moveTo(view);
    // Fly into the tab and fade.
    const r = tab.getBoundingClientRect();
    ghost.style.transition = 'opacity .2s ease, transform .2s cubic-bezier(.4,0,.2,1)';
    ghost.style.transformOrigin = '0 0';
    ghost.style.opacity = '0';
    ghost.style.transform = `translate(${r.left + r.width / 2 - 10}px, ${r.top + r.height / 2 - 6}px) scale(.15)`;
    setTimeout(() => {
      finish();
      // Dropped on "+": choose any day for it.
      if (view === 'pick') {
        openPicker(document.querySelector('.tab.add'), (day) => {
          if (day > tomorrow() && !state.days.includes(day)) state.days.push(day);
          moveTo(day);
          update();
        });
      }
    }, 200);
    return;
  }

  moveTask(task.id, target.cat, target.beforeId);

  // Settle the ghost into the gap before swapping back to the real row.
  const r = slot.getBoundingClientRect();
  ghost.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease';
  ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
  ghost.style.boxShadow = 'none';
  setTimeout(finish, 200);
}

function armDrag(li, task, e) {
  if (e.button !== 0 || drag || e.target.closest('button') || li.querySelector('[contenteditable="true"]')) return;
  const sx = e.clientX;
  const sy = e.clientY;
  const pointerId = e.pointerId;

  const onMove = (ev) => {
    if (!drag) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      $('shell').setPointerCapture(pointerId);
      startDrag(li, task, ev);
    }
    moveDrag(ev.clientX, ev.clientY);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (drag) endDrag();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/* Tasks */

function setDone(task, done) {
  if (task.repeat) {
    task.doneOn = task.doneOn || {};
    if (done) task.doneOn[doneKey(selected)] = true;
    else delete task.doneOn[doneKey(selected)];
  } else {
    task.done = done;
  }
}

/* Confetti: pieces burst upward, then flutter and tumble down under gravity. */

const CONFETTI_COLORS = ['#ff8fa3', '#ffc75f', '#7bdff2', '#b8a1ff', '#8ce99a', '#ffb38a', '#f9f871'];
const confetti = { parts: [], frame: 0, last: 0 };

function celebrate(x, y, { count = 40, spread = 75, speed = 9 } = {}) {
  for (let i = 0; i < count; i++) {
    const angle = (-90 + (Math.random() - 0.5) * 2 * spread) * (Math.PI / 180);
    const v = speed * (0.45 + Math.random() * 0.75);
    confetti.parts.push({
      x, y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      w: 4 + Math.random() * 4,
      h: 6 + Math.random() * 6,
      round: Math.random() < 0.3,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      phase: Math.random() * Math.PI * 2,
      age: 0,
      life: 70 + Math.random() * 50,
    });
  }
  if (!confetti.frame) {
    confetti.last = performance.now();
    confetti.frame = requestAnimationFrame(drawConfetti);
  }
}

function drawConfetti(now) {
  const canvas = $('confetti');
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);

  const dt = Math.min((now - confetti.last) / 16.67, 3);
  confetti.last = now;

  confetti.parts = confetti.parts.filter((p) => p.age < p.life && p.y < innerHeight + 20);
  for (const p of confetti.parts) {
    p.age += dt;
    p.vy += 0.28 * dt;
    p.vx *= Math.pow(0.985, dt);
    p.vy *= Math.pow(0.985, dt);
    p.x += (p.vx + Math.sin(p.age * 0.15 + p.phase) * 0.8) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;

    ctx.save();
    ctx.globalAlpha = Math.min(1, (p.life - p.age) / 25);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, Math.cos(p.age * 0.2 + p.phase)); // the flip of a tumbling piece
    ctx.fillStyle = p.color;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }

  if (confetti.parts.length) {
    confetti.frame = requestAnimationFrame(drawConfetti);
  } else {
    confetti.frame = 0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
}

function renderTask(task) {
  const done = isDone(task, selected);
  const li = document.createElement('li');
  li.className = 'task' + (done ? ' done' : '');
  li.dataset.id = task.id;
  li.addEventListener('pointerdown', (e) => armDrag(li, task, e));

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.innerHTML = gripIcon;

  const check = document.createElement('button');
  check.className = 'check';
  const toggle = () => {
    if (li.classList.contains('completing')) return;
    if (done) {
      setDone(task, false);
      update();
      return;
    }
    li.classList.add('completing');
    const r = check.getBoundingClientRect();
    celebrate(r.left + r.width / 2, r.top + r.height / 2);

    // Finishing the last open task on this tab gets a bigger show.
    const view = selected;
    const lastOne = tasksFor(view).every((x) => x === task || isDone(x, view));
    if (lastOne) {
      setTimeout(() => {
        celebrate(innerWidth * 0.25, innerHeight * 0.35, { count: 60, spread: 50, speed: 13 });
        celebrate(innerWidth * 0.75, innerHeight * 0.35, { count: 60, spread: 50, speed: 13 });
      }, 220);
    }
    setTimeout(() => { setDone(task, true); update(); }, 650);
  };
  check.onclick = toggle;

  // Clicking the text crosses it out too (a drag starts only once the pointer moves).
  const label = document.createElement('span');
  label.className = 'label';
  const ink = document.createElement('span');
  ink.className = 'ink';
  ink.textContent = task.text;
  label.append(ink);
  label.onclick = () => { if (label.contentEditable !== 'true') toggle(); };

  const edit = document.createElement('button');
  edit.className = 'del edit';
  edit.title = 'Edit';
  edit.textContent = '✎';
  edit.onclick = () => startEdit(label, task);

  const del = document.createElement('button');
  del.className = 'del';
  del.title = task.repeat ? `Delete (repeats ${task.repeat})` : 'Delete';
  del.textContent = '×';
  del.onclick = () => { state.tasks = state.tasks.filter((x) => x !== task); update(); };

  const setTime = (anchor) => openTimePicker(anchor, task.time ? { time: task.time, end: task.end } : null, (frame) => {
    delete task.time;
    delete task.end;
    if (frame) Object.assign(task, frame);
    update();
  });

  li.append(grip, check, label);
  if (task.time) {
    const time = document.createElement('button');
    time.className = 'time';
    time.title = 'Change time';
    time.textContent = formatRange(task.time, task.end);
    time.onclick = () => setTime(time);
    li.append(time);
  }
  const rolled = (task.due && task.due < selected) || (task.week && task.week < thisWeek());
  if (task.repeat === 'daily' || task.repeat === 'days') {
    // Click the repeat label to change which days it repeats on.
    const tag = document.createElement('button');
    tag.className = 'tag';
    tag.title = 'Change repeat';
    tag.textContent = `(${repeatLabel(task.repeat, task.days)})`;
    tag.onclick = () => openRepeatPicker(tag, task.repeat === 'days' ? task.days : 'daily', (repeat) => {
      setTaskRepeat(task, repeat);
      update();
    });
    li.append(tag);
  } else if (task.repeat || rolled) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = task.repeat ? `(${task.repeat})` : `(from ${shortDate(task.due || task.week)})`;
    li.append(tag);
  }
  if (!task.time) {
    const clock = document.createElement('button');
    clock.className = 'del clock';
    clock.title = 'Add a time';
    clock.textContent = '◷';
    clock.onclick = () => setTime(clock);
    li.append(clock);
  }
  li.append(edit, del);
  return li;
}

function startEdit(label, task) {
  label.contentEditable = 'true';
  label.focus();
  document.getSelection().selectAllChildren(label);
  const finish = (commit) => {
    label.onblur = null;
    const text = label.textContent.trim();
    if (commit && !text) state.tasks = state.tasks.filter((x) => x !== task);
    else if (commit) task.text = text;
    update();
  };
  label.onblur = () => finish(true);
  label.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  };
}

function renderSection(cat, tasks) {
  const node = $('section-tpl').content.firstElementChild.cloneNode(true);
  const collapsed = !!state.collapsed[cat];
  node.dataset.cat = cat;
  node.classList.toggle('collapsed', collapsed);
  node.querySelector('.name').textContent = cat;
  const open = tasks.filter((x) => !isDone(x, selected)).length;
  node.querySelector('.count').textContent = collapsed && open ? `· ${open}` : '';
  node.querySelector('.section-head').onclick = () => {
    state.collapsed[cat] = !collapsed;
    update();
  };
  node.querySelector('.tasks').append(...tasks.map(renderTask));
  return node;
}

function renderComposer() {
  const cats = $('cats');
  cats.replaceChildren(...CATS.map((cat) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt' + (cat === state.lastCat ? ' on' : '');
    b.textContent = cat;
    b.onclick = () => {
      state.lastCat = cat;
      save();
      renderComposer();
      $('new').focus();
    };
    return b;
  }));
  // A repeat chosen on one kind of tab doesn't carry over to the other.
  if (selected === WEEK ? addRepeat && addRepeat !== 'weekly' : addRepeat === 'weekly') addRepeat = null;
  if (selected === WEEK) {
    $('repeat').textContent = 'weekly';
    $('repeat').title = 'Repeat every week';
  } else {
    $('repeat').textContent = !addRepeat ? 'repeat'
      : addRepeat === 'daily' ? 'daily' : repeatLabel('days', addRepeat);
    $('repeat').title = 'Repeat every day, or on certain days';
  }
  $('repeat').classList.toggle('on', !!addRepeat);
  $('time').textContent = addTime ? formatRange(addTime.time, addTime.end) : 'time';
  $('time').classList.toggle('on', !!addTime);
  $('time-clear').hidden = !addTime;
}

function render() {
  if (selected !== WEEK && !dayTabs().includes(selected)) selected = today();
  if (selected === WEEK) {
    const wk = thisWeek();
    $('date').textContent = `${shortDate(wk)} – ${shortDate(iso(addDays(parse(wk), 6)))}, this week`;
  } else {
    const d = parse(selected);
    $('date').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${DAYS[d.getDay()]}`;
  }
  renderTabs();

  const tasks = tasksFor(selected);
  const scroll = $('sections').scrollTop;
  $('sections').replaceChildren(...CATS.map((cat) => renderSection(cat, tasks.filter((x) => x.cat === cat))));
  $('sections').scrollTop = scroll;

  renderComposer();

  const t = today();
  api.setCount(tasksFor(t).filter((x) => !isDone(x, t)).length);
}

/* Date picker for adding a day */

let pickerMonth;

function openPicker(anchor, onPick) {
  const picker = $('picker');
  pickerMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const draw = () => {
    const t = today();
    const taken = new Set(dayTabs());
    const y = pickerMonth.getFullYear();
    const m = pickerMonth.getMonth();
    const lead = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    let cells = '<span></span>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const s = iso(new Date(y, m, d));
      const cls = [s === t && 'is-today', taken.has(s) && 'is-taken'].filter(Boolean).join(' ');
      cells += `<button data-date="${s}" class="${cls}" ${s < t ? 'disabled' : ''}>${d}</button>`;
    }
    picker.innerHTML = `
      <div class="month">
        <button data-nav="-1">‹</button><span>${MONTHS[m]} ${y}</span><button data-nav="1">›</button>
      </div>
      <div class="dow">${'SMTWTFS'.split('').map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="grid">${cells}</div>`;
  };

  picker.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.nav) {
      pickerMonth.setMonth(pickerMonth.getMonth() + Number(b.dataset.nav));
      draw();
      return;
    }
    closePicker();
    onPick(b.dataset.date);
  };

  draw();
  showPopover(anchor);
}

/* Time picker, in two steps: pick a start (half-hour slots, or type a time or a
   whole range), then optionally an end. `current` and the picked value are
   { time, end? } or null. */

const HALF_HOURS = [];
for (let h = 0; h < 24; h++) for (const m of [0, 30]) HALF_HOURS.push(`${pad(h)}:${pad(m)}`);

function openTimePicker(anchor, current, onPick) {
  const picker = $('picker');
  const pick = (value) => { closePicker(); onPick(value); };

  const scrollNear = (time) => {
    const list = picker.querySelector('.slots');
    const target = time.slice(0, 3) + (time.slice(3) < '30' ? '00' : '30');
    const slot = [...list.querySelectorAll('button[data-time]')].find((b) => b.dataset.time >= target);
    if (slot) list.scrollTop = slot.offsetTop - list.offsetTop - 30;
  };

  const stepStart = () => {
    picker.innerHTML = `
      <input class="time-entry" placeholder="a time or range, e.g. 2-3:30pm" spellcheck="false">
      ${current ? `<button data-clear class="remove-time">× remove time <span>(${formatRange(current.time, current.end)})</span></button>` : ''}
      <div class="slots">
        ${HALF_HOURS.map((s) => `<button data-time="${s}" class="${current && s === current.time ? 'is-picked' : ''}">${formatTime(s)}</button>`).join('')}
      </div>`;
    picker.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-clear')) pick(null);
      else if (b.dataset.time) stepEnd(b.dataset.time);
    };
    const entry = picker.querySelector('.time-entry');
    entry.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!entry.value.trim() && current) return pick(null); // Enter on an empty field clears the time
      const frame = parseTimeFrame(entry.value);
      if (frame) pick(frame);
      else entry.classList.add('invalid');
    };
    entry.oninput = () => entry.classList.remove('invalid');
    scrollNear(current ? current.time : nowTime());
    entry.focus();
  };

  const stepEnd = (time) => {
    const ends = HALF_HOURS.filter((s) => s > time).concat(time < '23:59' ? ['23:59'] : []);
    picker.innerHTML = `
      <div class="time-step">
        <button data-back title="Change start">‹</button>
        <span>from ${formatTime(time)} until…</span>
      </div>
      <input class="time-entry" placeholder="type an end time" spellcheck="false">
      <div class="slots">
        <button data-only class="clear">no end time</button>
        ${ends.map((s) => `<button data-end="${s}" class="${current && s === current.end ? 'is-picked' : ''}">${formatTime(s)} <span class="dur">${duration(time, s)}</span></button>`).join('')}
      </div>`;
    picker.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-back')) stepStart();
      else if (b.hasAttribute('data-only')) pick({ time });
      else if (b.dataset.end) pick({ time, end: b.dataset.end });
    };
    const entry = picker.querySelector('.time-entry');
    entry.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const end = parseTime(entry.value);
      if (end && end > time) pick({ time, end });
      else entry.classList.add('invalid');
    };
    entry.oninput = () => entry.classList.remove('invalid');
    entry.focus();
  };

  stepStart();
  showPopover(anchor);
  scrollNear(current ? current.time : nowTime());
}

// Place the shared popover next to its anchor, flipping above when there's no room below.
function showPopover(anchor) {
  const picker = $('picker');
  picker.hidden = false;
  const shell = $('shell').getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  picker.style.left = `${Math.max(12, Math.min(a.right - shell.left - picker.offsetWidth, shell.width - picker.offsetWidth - 12))}px`;
  let top = a.bottom - shell.top + 6;
  if (top + picker.offsetHeight > shell.height - 8) top = a.top - shell.top - picker.offsetHeight - 6;
  picker.style.top = `${Math.max(8, top)}px`;
}

function closePicker() {
  $('picker').hidden = true;
}

document.addEventListener('pointerdown', (e) => {
  if (!$('picker').hidden && !e.target.closest('#picker')) closePicker();
}, true);

/* Composer */

$('composer').onsubmit = (e) => {
  e.preventDefault();
  const text = $('new').value.trim();
  if (!text) return;
  const base = { id: uid(), text, cat: state.lastCat, ...addTime };
  let task;
  if (selected === WEEK) {
    task = addRepeat
      ? { ...base, repeat: 'weekly', start: thisWeek(), doneOn: {} }
      : { ...base, week: thisWeek(), done: false };
  } else if (addRepeat === 'daily') {
    task = { ...base, repeat: 'daily', start: selected, doneOn: {} };
  } else if (Array.isArray(addRepeat)) {
    task = { ...base, repeat: 'days', days: addRepeat, start: selected, doneOn: {} };
  } else {
    task = { ...base, due: selected, done: false };
  }
  // A timed task goes in before the first later-timed task in its section.
  const later = addTime && tasksFor(selected).find((x) => x.cat === task.cat && x.time > addTime.time);
  if (later) state.tasks.splice(state.tasks.indexOf(later), 0, task);
  else state.tasks.push(task);
  state.collapsed[state.lastCat] = false;
  addTime = null;
  $('new').value = '';
  update();
  $('new').focus();
};
$('repeat').onclick = () => {
  const done = (repeat) => {
    addRepeat = repeat;
    renderComposer();
    $('new').focus();
  };
  if (selected === WEEK) done(addRepeat ? null : 'weekly');
  else openRepeatPicker($('repeat'), addRepeat, done);
};

// Change an existing task's repeat. Turning it off keeps it as a one-off on
// the day being viewed.
function setTaskRepeat(task, repeat) {
  if (!repeat) {
    const done = isDone(task, selected);
    for (const key of ['repeat', 'days', 'start', 'doneOn']) delete task[key];
    task.due = selected;
    task.done = done;
  } else if (repeat === 'daily') {
    task.repeat = 'daily';
    delete task.days;
  } else {
    task.repeat = 'days';
    task.days = repeat;
  }
}

/* Repeat picker: every day, or any set of weekdays. `current` and the picked
   value are null, 'daily', or an array of weekdays (0 = Sun). */

function openRepeatPicker(anchor, current, onPick) {
  const picker = $('picker');
  const pick = (repeat) => { closePicker(); onPick(repeat); };
  // Start from the current days, or the weekday of the tab being viewed.
  let chosen = current === 'daily' ? [...DAY_ORDER]
    : Array.isArray(current) ? [...current]
    : [parse(selected).getDay()];

  const draw = () => {
    picker.innerHTML = `
      <div class="repeat-title">repeat</div>
      <button data-daily class="repeat-row ${current === 'daily' ? 'is-picked' : ''}">every day</button>
      <div class="weekdays">
        ${DAY_ORDER.map((d) => `<button data-day="${d}" class="${chosen.includes(d) ? 'on' : ''}" title="${DAYS[d]}">${DAYS[d][0]}</button>`).join('')}
      </div>
      <div class="repeat-presets">
        <button data-set="1,2,3,4,5">weekdays</button>
        <button data-set="6,0">weekends</button>
      </div>
      <div class="repeat-actions">
        <button data-none>don't repeat</button>
        <button data-apply class="apply" ${chosen.length ? '' : 'disabled'}>repeat ${chosen.length ? repeatLabel('days', chosen) : '…'}</button>
      </div>`;
  };

  const apply = (days) => pick(days.length === 7 ? 'daily' : days.length ? DAY_ORDER.filter((d) => days.includes(d)) : null);

  picker.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-daily')) return pick('daily');
    if (b.hasAttribute('data-none')) return pick(null);
    if (b.hasAttribute('data-apply')) return apply(chosen);
    if (b.dataset.set) return apply(b.dataset.set.split(',').map(Number));
    if (b.dataset.day) {
      const d = Number(b.dataset.day);
      chosen = chosen.includes(d) ? chosen.filter((x) => x !== d) : [...chosen, d];
      draw();
    }
  };

  draw();
  showPopover(anchor);
}
$('time-clear').onclick = () => {
  addTime = null;
  renderComposer();
  $('new').focus();
};
$('time').onclick = () => openTimePicker($('time'), addTime, (frame) => {
  addTime = frame;
  renderComposer();
  $('new').focus();
});
// Keep focus in the entry line when picking options, so they stay visible.
document.querySelector('.options').addEventListener('mousedown', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('picker').hidden) closePicker();
  else api.hidePanel();
});

/* Resize handles on the edges away from the bubble; the main process does the
   actual resizing by following the cursor. */

for (const handle of document.querySelectorAll('.resize')) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    api.resizeStart(handle.dataset.edge);
  });
  const end = () => {
    if (!document.body.classList.contains('resizing')) return;
    document.body.classList.remove('resizing');
    api.resizeEnd();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('lostpointercapture', end);
}

api.on('panel:shown', (side) => {
  // side is where the bubble sits; the resize handles go on the other side.
  document.body.dataset.outer = side === 'right' ? 'left' : 'right';
  const shell = $('shell');
  shell.classList.remove('enter-left', 'enter-right');
  void shell.offsetWidth;
  // Slide in from the bubble's side.
  shell.classList.add(side === 'right' ? 'enter-right' : 'enter-left');
  selected = today(); // always open on today
  addRepeat = null;
  addTime = null;
  confirmDay = null;
  closePicker();
  render();
  $('new').focus();
});

api.load().then((saved) => {
  state = migrate(saved);
  save();
  render();
});
