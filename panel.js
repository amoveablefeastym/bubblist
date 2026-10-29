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
// Accepts '9', '9:45', '945', '9:45pm', '9p', '21:30'. Returns 'HH:MM' or null.
function parseTime(input) {
  const m = input.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] && (h < 1 || h > 12)) return null;
  if (m[3] && m[3][0] === 'p' && h !== 12) h += 12;
  if (m[3] && m[3][0] === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const gripIcon = '<svg viewBox="0 0 8 14"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>';

// Task shapes:
//   for a day:     { id, text, cat, due: 'YYYY-MM-DD', done }
//   for a week:    { id, text, cat, week: 'YYYY-MM-DD' (Monday), done }
//   every day:     { id, text, cat, repeat: 'daily',  start: day,  doneOn: { day: true } }
//   every week:    { id, text, cat, repeat: 'weekly', start: week, doneOn: { week: true } }
let state = { tasks: [], days: [], collapsed: {}, lastCat: 'work' };
let selected = today();
let addRepeat = false;
let addTime = null; // 'HH:MM' for the next task added, or null
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

// Repeating tasks track completion per day (daily) or per week (weekly).
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
  // Daily tasks show on every day tab, whichever day they were added on.
  return state.tasks.filter((x) => x.repeat === 'daily'
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
  drag = {
    task, li, ghost, slot, items, h,
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
  drag.ghost.style.transform = `translate(${drag.x}px, ${drag.y}px) scale(1.02)`;

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
  document.body.classList.remove('dragging');

  const finish = () => { ghost.remove(); update(); };

  if (tab) {
    const view = tab.dataset.view;
    delete task.due;
    delete task.week;
    if (view === WEEK) task.week = thisWeek();
    else task.due = view;
    ghost.style.transition = 'opacity .15s ease, transform .15s ease';
    ghost.style.opacity = '0';
    ghost.style.transform += ' scale(.9)';
    setTimeout(finish, 150);
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

  const setTime = (anchor) => openTimePicker(anchor, task.time, (time) => {
    if (time) task.time = time;
    else delete task.time;
    update();
  });

  li.append(grip, check, label);
  if (task.time) {
    const time = document.createElement('button');
    time.className = 'time';
    time.title = 'Change time';
    time.textContent = formatTime(task.time);
    time.onclick = () => setTime(time);
    li.append(time);
  }
  const rolled = (task.due && task.due < selected) || (task.week && task.week < thisWeek());
  if (task.repeat || rolled) {
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
  $('repeat').textContent = selected === WEEK ? 'weekly' : 'daily';
  $('repeat').title = selected === WEEK ? 'Repeat every week' : 'Repeat every day';
  $('repeat').classList.toggle('on', addRepeat);
  $('time').textContent = addTime ? formatTime(addTime) : 'time';
  $('time').classList.toggle('on', !!addTime);
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

/* Time picker: half-hour slots, scrolled to around now, plus a field for an exact time */

function openTimePicker(anchor, current, onPick) {
  const picker = $('picker');
  const slots = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 30]) slots.push(`${pad(h)}:${pad(m)}`);

  picker.innerHTML = `
    <input class="time-entry" placeholder="type a time, e.g. 9:45pm" spellcheck="false">
    <div class="slots">
      ${current ? '<button data-time="" class="clear">no time</button>' : ''}
      ${slots.map((s) => `<button data-time="${s}" class="${s === current ? 'is-picked' : ''}">${formatTime(s)}</button>`).join('')}
    </div>`;

  const pick = (time) => { closePicker(); onPick(time); };
  picker.onclick = (e) => {
    const b = e.target.closest('button[data-time]');
    if (b) pick(b.dataset.time || null);
  };
  const entry = picker.querySelector('.time-entry');
  entry.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const time = parseTime(entry.value);
    if (time) pick(time);
    else entry.classList.add('invalid');
  };
  entry.oninput = () => entry.classList.remove('invalid');

  showPopover(anchor);
  // Start the list near the chosen time, or near now.
  const near = current || nowTime();
  const slot = [...picker.querySelectorAll('.slots button[data-time]')].find((b) => b.dataset.time && b.dataset.time >= near.slice(0, 3) + (near.slice(3) < '30' ? '00' : '30'));
  if (slot) picker.querySelector('.slots').scrollTop = slot.offsetTop - picker.querySelector('.slots').offsetTop - 30;
  entry.focus();
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
  const base = { id: uid(), text, cat: state.lastCat, ...(addTime ? { time: addTime } : {}) };
  let task;
  if (selected === WEEK) {
    task = addRepeat
      ? { ...base, repeat: 'weekly', start: thisWeek(), doneOn: {} }
      : { ...base, week: thisWeek(), done: false };
  } else {
    task = addRepeat
      ? { ...base, repeat: 'daily', start: selected, doneOn: {} }
      : { ...base, due: selected, done: false };
  }
  // A timed task goes in before the first later-timed task in its section.
  const later = addTime && tasksFor(selected).find((x) => x.cat === task.cat && x.time > addTime);
  if (later) state.tasks.splice(state.tasks.indexOf(later), 0, task);
  else state.tasks.push(task);
  state.collapsed[state.lastCat] = false;
  addTime = null;
  $('new').value = '';
  update();
  $('new').focus();
};
$('repeat').onclick = () => {
  addRepeat = !addRepeat;
  renderComposer();
  $('new').focus();
};
$('time').onclick = () => openTimePicker($('time'), addTime, (time) => {
  addTime = time;
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

api.on('panel:shown', (side) => {
  const shell = $('shell');
  shell.classList.remove('enter-left', 'enter-right');
  void shell.offsetWidth;
  // Slide in from the bubble's side.
  shell.classList.add(side === 'right' ? 'enter-right' : 'enter-left');
  selected = today(); // always open on today
  addRepeat = false;
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
