import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  remove,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/*
  A named app lets this module coexist with the Firebase app
  already initialized by phone.html and pc.html.
*/
const app = initializeApp(
  {
    databaseURL:
      "https://website-f5c09-default-rtdb.europe-west1.firebasedatabase.app/"
  },
  "daily-sheet-shared"
);

const db = getDatabase(app);
const themeRef = ref(db, "sheetTheme");
const eventsRef = ref(db, "sheetEvents");
const scribbleRef = ref(db, "sheetScribble");
const todosRef = ref(db, "todos");

const $ = id => document.getElementById(id);
const isPhone = document.body.classList.contains("phone-page");
const isPC = document.body.classList.contains("pc-page");

/* ---------- UK calendar dates ---------- */

function ukDateString() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const get = type => parts.find(part => part.type === type).value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateNumber(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function prettyDate(value) {
  return new Date(dateNumber(value)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

/*
  Annual 29 February events occur in the next leap year.
  Events never repeat before their original start date.
*/
function nextOccurrence(event, today) {
  if (!validDate(event.date)) return null;

  if (!event.repeat) {
    return event.date >= today ? event.date : null;
  }

  const [startYear, month, day] = event.date.split("-").map(Number);
  const currentYear = Number(today.slice(0, 4));
  const firstYear = Math.max(startYear, currentYear);

  for (let year = firstYear; year <= firstYear + 8; year++) {
    const candidate =
      `${year}-${String(month).padStart(2, "0")}` +
      `-${String(day).padStart(2, "0")}`;

    if (validDate(candidate) && candidate >= today) {
      return candidate;
    }
  }

  return null;
}

/* ---------- Shared theme ---------- */

let currentTheme = "light";

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";

  document.documentElement.classList.toggle(
    "sheet-dark",
    currentTheme === "dark"
  );

  const button = $("sheet-theme-toggle");

  if (button) {
    button.textContent =
      `Theme: ${currentTheme === "dark" ? "Dark" : "Light"}`;

    button.setAttribute(
      "aria-label",
      `Current theme is ${currentTheme}. Switch theme`
    );
  }
}

if (isPC) {
  const headerButtons = document.querySelector("header .flex.gap-2");

  if (headerButtons) {
    const button = document.createElement("button");
    button.id = "sheet-theme-toggle";
    button.type = "button";
    button.className = "eink-btn";
    button.textContent = "Theme: Light";

    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await set(
          themeRef,
          currentTheme === "dark" ? "light" : "dark"
        );
      } catch (error) {
        console.error(error);
        alert("Could not save the theme. Check Firebase access.");
      } finally {
        button.disabled = false;
      }
    });

    headerButtons.prepend(button);
  }
}

onValue(
  themeRef,
  snapshot => applyTheme(snapshot.val()),
  error => console.error("Could not load theme:", error)
);

/* ---------- Countdown events ---------- */

let events = [];
let countdownText = null;
let eventList = null;
let editingEventId = null;

function renderCountdown() {
  if (!countdownText) return;

  const today = ukDateString();

  const upcoming = events
    .map(event => ({
      ...event,
      nextDate: nextOccurrence(event, today)
    }))
    .filter(event => event.nextDate)
    .sort((a, b) =>
      a.nextDate.localeCompare(b.nextDate) ||
      a.name.localeCompare(b.name)
    );

  if (!upcoming.length) {
    countdownText.textContent = "No upcoming events";
    return;
  }

  const event = upcoming[0];
  const days = Math.round(
    (dateNumber(event.nextDate) - dateNumber(today)) / 86400000
  );

  countdownText.textContent =
    days === 0
      ? `${event.name} — Today`
      : `${event.name} — ${days} ${days === 1 ? "day" : "days"} to go`;
}

function resetEventForm() {
  editingEventId = null;
  $("event-form").reset();
  $("event-submit").textContent = "Add Event";
  $("event-cancel").hidden = true;
}

function renderEventList() {
  if (!eventList) return;

  eventList.replaceChildren();

  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "event-info";
    empty.textContent = "No events added yet.";
    eventList.append(empty);
    return;
  }

  const sorted = [...events].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.name.localeCompare(b.name)
  );

  for (const event of sorted) {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "event-info";

    const name = document.createElement("strong");
    name.textContent = event.name;

    const details = document.createElement("small");
    const past =
      !event.repeat && event.date < ukDateString()
        ? " · Past"
        : "";

    details.textContent =
      `${prettyDate(event.date)}` +
      `${event.repeat ? " · Repeats yearly" : ""}${past}`;

    info.append(name, details);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "4px";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "sheet-button";
    editButton.textContent = "Edit";

    editButton.addEventListener("click", () => {
      editingEventId = event.id;
      $("event-name").value = event.name;
      $("event-date").value = event.date;
      $("event-repeat").checked = event.repeat;
      $("event-submit").textContent = "Save Event";
      $("event-cancel").hidden = false;
      $("event-name").focus();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "sheet-button";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete "${event.name}"?`)) return;

      deleteButton.disabled = true;

      try {
        await remove(ref(db, `sheetEvents/${event.id}`));

        if (editingEventId === event.id) {
          resetEventForm();
        }
      } catch (error) {
        console.error(error);
        alert("Could not delete the event. Check Firebase access.");
        deleteButton.disabled = false;
      }
    });

    actions.append(editButton, deleteButton);
    li.append(info, actions);
    eventList.append(li);
  }
}

function createPhoneCountdown() {
  const main = document.querySelector(".app");
  if (!main) return;

  const bar = document.createElement("div");
  bar.className = "phone-bottom-bar";

  const countdown = document.createElement("section");
  countdown.className = "box phone-countdown";

  const label = document.createElement("div");
  label.className = "phone-countdown-title";
  label.textContent = "Days Until";

  countdownText = document.createElement("div");
  countdownText.className = "phone-countdown-value";
  countdownText.textContent = "Loading events...";

  countdown.append(label, countdownText);

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "sheet-button phone-scribble-button";
  openButton.textContent = "Open Scribble";
  openButton.addEventListener("click", openScribble);

  bar.append(countdown, openButton);
  main.append(bar);
}

function createEventManager() {
  const aside = document.querySelector("main aside");
  if (!aside) return;

  const panel = document.createElement("section");
  panel.className = "sheet-panel";

  panel.innerHTML = `
    <h2 class="sheet-heading">Days Until Events</h2>

    <form id="event-form" class="event-form">
      <div>
        <label class="sheet-label" for="event-name">Event</label>
        <input
          id="event-name"
          class="sheet-input"
          maxlength="100"
          placeholder="e.g. Birthday"
          required
        >
      </div>

      <div>
        <label class="sheet-label" for="event-date">Date</label>
        <input
          id="event-date"
          class="sheet-input"
          type="date"
          required
        >
      </div>

      <label class="event-repeat">
        <input id="event-repeat" type="checkbox">
        <span>Repeat every year</span>
      </label>

      <button id="event-submit" class="sheet-button" type="submit">
        Add Event
      </button>

      <button
        id="event-cancel"
        class="sheet-button"
        type="button"
        hidden
      >
        Cancel Edit
      </button>

      <p id="event-message" class="sheet-message" aria-live="polite"></p>
    </form>

    <ul id="event-list" class="event-list"></ul>
  `;

  aside.append(panel);
  eventList = $("event-list");

  $("event-cancel").addEventListener("click", resetEventForm);

  $("event-form").addEventListener("submit", async event => {
    event.preventDefault();

    const name = $("event-name").value.trim();
    const date = $("event-date").value;
    const repeat = $("event-repeat").checked;
    const message = $("event-message");

    if (!name || !validDate(date)) {
      message.textContent = "Please enter an event and a valid date.";
      return;
    }

    if (!repeat && date < ukDateString()) {
      message.textContent =
        "Choose today or a future date for a non-repeating event.";
      return;
    }

    const button = $("event-submit");
    button.disabled = true;
    message.textContent = "Saving...";

    try {
      const eventRef = editingEventId
        ? ref(db, `sheetEvents/${editingEventId}`)
        : push(eventsRef);

      await set(eventRef, { name, date, repeat });

      resetEventForm();
      message.textContent = "Event saved.";
      $("event-name").focus();
    } catch (error) {
      console.error(error);
      message.textContent =
        "Could not save. Check your connection and Firebase rules.";
    } finally {
      button.disabled = false;
    }
  });
}

if (isPhone) createPhoneCountdown();
if (isPC) createEventManager();

onValue(
  eventsRef,
  snapshot => {
    const value = snapshot.val() || {};

    events = Object.entries(value)
      .map(([id, event]) => ({
        id,
        name: String(event?.name || ""),
        date: String(event?.date || ""),
        repeat: !!event?.repeat
      }))
      .filter(event => event.name && validDate(event.date));

    renderCountdown();
    renderEventList();
  },
  error => {
    console.error("Could not load events:", error);

    if (countdownText) {
      countdownText.textContent = "Events unavailable";
    }
  }
);

/* ---------- Shared daily scribble ---------- */

let savedScribble = null;
let scribbleLoaded = false;
let editorDate = null;
let tool = "pen";
let drawing = false;
let activePointer = null;
let lastPoint = null;
let modal = null;
let canvas = null;
let context = null;
let previewImage = null;
let previewEmpty = null;
let previouslyFocused = null;

function createPhonePreview() {
  const columns = document.querySelectorAll(".app > .col");
  const secondColumn = columns[1];
  if (!secondColumn) return;

  const section = document.createElement("section");
  section.className = "box scribble-preview-box";

  section.innerHTML = `
    <div class="lbl font-semibold border-b border-ink pb-1 mb-1">
      Today's Scribble
    </div>

    <div class="scribble-preview-content">
      <img
        id="scribble-preview-image"
        alt="Today's saved scribble"
        hidden
      >
      <p id="scribble-preview-empty">Your scribble will appear here.</p>
    </div>
  `;

  secondColumn.append(section);
  previewImage = $("scribble-preview-image");
  previewEmpty = $("scribble-preview-empty");
}

function createPCScribblePanel() {
  const aside = document.querySelector("main aside");
  if (!aside) return;

  const panel = document.createElement("section");
  panel.className = "sheet-panel";

  panel.innerHTML = `
    <h2 class="sheet-heading">Today's Scribble</h2>
    <p class="sheet-message">
      Draw here or on your phone. Press Finish to share the drawing.
      It clears on the next UK calendar day.
    </p>
    <button id="pc-open-scribble" class="sheet-button" type="button">
      Open Scribble
    </button>
  `;

  aside.append(panel);
  $("pc-open-scribble").addEventListener("click", openScribble);
}

function createScribbleModal() {
  modal = document.createElement("div");
  modal.className = "scribble-overlay";
  modal.hidden = true;

  modal.innerHTML = `
    <div
      class="scribble-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scribble-title"
    >
      <div class="scribble-header">
        <h2 id="scribble-title">Today's Scribble</h2>
        <button id="scribble-finish" class="sheet-button" type="button">
          Finish
        </button>
      </div>

      <div class="scribble-workspace">
        <div class="scribble-canvas-area">
          <canvas
            id="scribble-canvas"
            width="1200"
            height="800"
            aria-label="Drawing canvas"
          ></canvas>
        </div>

        <div class="scribble-tools">
          <button
            id="scribble-pen"
            class="sheet-button active"
            type="button"
            aria-pressed="true"
          >Pen</button>

          <button
            id="scribble-rubber"
            class="sheet-button"
            type="button"
            aria-pressed="false"
          >Rubber</button>

          <button
            id="scribble-clear"
            class="sheet-button"
            type="button"
          >Clear</button>
        </div>
      </div>

      <div
        id="scribble-status"
        class="scribble-status"
        aria-live="polite"
      ></div>
    </div>
  `;

  document.body.append(modal);

  canvas = $("scribble-canvas");
  context = canvas.getContext("2d");

  $("scribble-pen").addEventListener("click", () => setTool("pen"));
  $("scribble-rubber").addEventListener("click", () => setTool("rubber"));

  $("scribble-clear").addEventListener("click", () => {
    if (confirm("Clear today's scribble?")) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      $("scribble-status").textContent =
        "Cleared. Press Finish to save.";
    }
  });

  $("scribble-finish").addEventListener("click", finishScribble);

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
}

function setTool(nextTool) {
  tool = nextTool;

  $("scribble-pen").classList.toggle("active", tool === "pen");
  $("scribble-rubber").classList.toggle("active", tool === "rubber");

  $("scribble-pen").setAttribute(
    "aria-pressed",
    String(tool === "pen")
  );

  $("scribble-rubber").setAttribute(
    "aria-pressed",
    String(tool === "rubber")
  );
}

function updatePreview() {
  if (!previewImage || !previewEmpty) return;

  const image =
    savedScribble?.date === ukDateString()
      ? savedScribble.image
      : null;

  if (image) {
    previewImage.src = image;
    previewImage.hidden = false;
    previewEmpty.hidden = true;
  } else {
    previewImage.removeAttribute("src");
    previewImage.hidden = true;
    previewEmpty.hidden = false;
  }
}

function loadImageIntoCanvas(imageData) {
  return new Promise((resolve, reject) => {
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!imageData) {
      resolve();
      return;
    }

    const image = new Image();

    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve();
    };

    image.onerror = reject;
    image.src = imageData;
  });
}

async function openScribble() {
  if (!modal) return;

  if (!scribbleLoaded) {
    alert(
      "The shared drawing has not loaded yet. " +
      "Check your connection and Firebase rules, then try again."
    );
    return;
  }

  previouslyFocused = document.activeElement;
  editorDate = ukDateString();
  modal.hidden = false;

  $("scribble-status").textContent = "Loading drawing...";
  $("scribble-finish").disabled = true;
  canvas.style.pointerEvents = "none";

  const image =
    savedScribble?.date === editorDate
      ? savedScribble.image
      : null;

  try {
    await loadImageIntoCanvas(image);

    $("scribble-status").textContent =
      "Draw with a mouse, finger, or compatible stylus.";
  } catch (error) {
    console.error(error);

    context.clearRect(0, 0, canvas.width, canvas.height);

    $("scribble-status").textContent =
      "The saved drawing could not be loaded.";
  } finally {
    $("scribble-finish").disabled = false;
    canvas.style.pointerEvents = "";
    setTool("pen");
    $("scribble-finish").focus();
  }
}

async function finishScribble() {
  if (editorDate !== ukDateString()) {
    alert(
      "The UK date changed while the editor was open. " +
      "The previous day's drawing cannot be saved into the new day."
    );

    modal.hidden = true;
    updatePreview();
    previouslyFocused?.focus();
    return;
  }

  const button = $("scribble-finish");
  button.disabled = true;
  $("scribble-status").textContent = "Saving...";

  try {
    const image = canvas.toDataURL("image/png");

    await set(scribbleRef, {
      date: editorDate,
      image
    });

    modal.hidden = true;
    previouslyFocused?.focus();
  } catch (error) {
    console.error(error);

    $("scribble-status").textContent =
      "Could not save. Check your connection and Firebase rules, " +
      "then try Finish again.";
  } finally {
    button.disabled = false;
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

function configureBrush() {
  context.lineCap = "round";
  context.lineJoin = "round";

  if (tool === "rubber") {
    context.globalCompositeOperation = "destination-out";
    context.lineWidth = 38;
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
  } else {
    context.globalCompositeOperation = "source-over";
    context.lineWidth = 4;
    context.strokeStyle = "#111";
    context.fillStyle = "#111";
  }
}

function pointerDown(event) {
  if (drawing) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  event.preventDefault();

  drawing = true;
  activePointer = event.pointerId;
  lastPoint = canvasPoint(event);
  canvas.setPointerCapture(event.pointerId);

  configureBrush();

  context.beginPath();
  context.arc(
    lastPoint.x,
    lastPoint.y,
    context.lineWidth / 2,
    0,
    Math.PI * 2
  );
  context.fill();

  $("scribble-status").textContent = "Press Finish to save.";
}

function pointerMove(event) {
  if (!drawing || event.pointerId !== activePointer) return;

  event.preventDefault();

  const point = canvasPoint(event);
  configureBrush();

  context.beginPath();
  context.moveTo(lastPoint.x, lastPoint.y);
  context.lineTo(point.x, point.y);
  context.stroke();

  lastPoint = point;
}

function pointerUp(event) {
  if (!drawing || event.pointerId !== activePointer) return;

  drawing = false;
  activePointer = null;
  lastPoint = null;

  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

async function clearOldScribble() {
  const today = ukDateString();

  try {
    await runTransaction(scribbleRef, current => {
      if (current && current.date && current.date < today) {
        return null;
      }

      return undefined;
    });
  } catch (error) {
    console.error("Could not clear yesterday's scribble:", error);
  }
}

if (isPhone || isPC) {
  createScribbleModal();

  if (isPhone) createPhonePreview();
  if (isPC) createPCScribblePanel();

  onValue(
    scribbleRef,
    snapshot => {
      savedScribble = snapshot.val();
      scribbleLoaded = true;
      updatePreview();

      /*
        Do not replace an open editor's canvas while the user draws.
        If both devices edit at once, the last Finish wins.
      */
    },
    error => {
      console.error("Could not load scribble:", error);
      scribbleLoaded = false;
    }
  );

  clearOldScribble();
}

/* ---------- PC task drag handles ---------- */

function installDragHandles() {
  const list = $("pc-todo-list");
  if (!list) return;

  let dragging = null;

  function addHandles() {
    const upButtons = list.querySelectorAll('button[data-a="up"]');

    upButtons.forEach(up => {
      const row = up.closest("li");
      const parentIndex = Number(up.dataset.i);
      const isSub = up.dataset.j !== undefined;
      const position = isSub
        ? Number(up.dataset.j)
        : parentIndex;

      if (!row) return;

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "drag-handle";
      handle.draggable = true;
      handle.textContent = "⋮⋮";
      handle.title = "Drag to reorder, or use Alt + Up / Down";
      handle.setAttribute(
        "aria-label",
        isSub ? "Reorder subtask" : "Reorder task"
      );

      handle.dataset.kind = isSub ? "sub" : "task";
      handle.dataset.parent = String(parentIndex);
      handle.dataset.position = String(position);

      const down = up.parentElement.querySelector(
        'button[data-a="down"]'
      );

      if (down) down.remove();
      up.remove();

      const rowContent = isSub ? row : row.firstElementChild;
      rowContent.prepend(handle);
    });
  }

  function getHandleRow(target, kind) {
    const row = target.closest("li");
    if (!row) return null;

    if (kind === "sub") {
      return row.querySelector(":scope > .drag-handle");
    }

    const taskRow = target.closest("#pc-todo-list > li");
    return taskRow?.querySelector(
      ":scope > div > .drag-handle"
    ) || null;
  }

  async function move(kind, parent, from, to) {
    if (from === to) return;

    try {
      await runTransaction(todosRef, current => {
        if (!current) return;

        const tasks = Array.isArray(current)
          ? current.slice()
          : Object.values(current);

        const array = kind === "task"
          ? tasks
          : tasks[parent]?.subtasks;

        if (!array) return;

        const items = Array.isArray(array)
          ? array.slice()
          : Object.values(array);

        if (
          from < 0 ||
          to < 0 ||
          from >= items.length ||
          to >= items.length
        ) {
          return;
        }

        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);

        if (kind === "task") {
          return items;
        }

        tasks[parent] = {
          ...tasks[parent],
          subtasks: items
        };

        return tasks;
      });
    } catch (error) {
      console.error(error);
      alert("Could not save the new task order. Check Firebase access.");
    }
  }

  function clearTargets() {
    list.querySelectorAll(".drag-target").forEach(element => {
      element.classList.remove("drag-target");
    });
  }

  list.addEventListener("dragstart", event => {
    const handle = event.target.closest(".drag-handle");
    if (!handle) return;

    dragging = {
      kind: handle.dataset.kind,
      parent: Number(handle.dataset.parent),
      position: Number(handle.dataset.position)
    };

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "daily-sheet-task");
  });

  list.addEventListener("dragover", event => {
    if (!dragging) return;

    const target = getHandleRow(event.target, dragging.kind);
    if (!target) return;

    if (
      dragging.kind === "sub" &&
      Number(target.dataset.parent) !== dragging.parent
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    clearTargets();
    target.closest("li").classList.add("drag-target");
  });

  list.addEventListener("drop", event => {
    if (!dragging) return;

    const target = getHandleRow(event.target, dragging.kind);
    if (!target) return;

    if (
      dragging.kind === "sub" &&
      Number(target.dataset.parent) !== dragging.parent
    ) {
      return;
    }

    event.preventDefault();

    const from = dragging.position;
    const to = Number(target.dataset.position);
    const kind = dragging.kind;
    const parent = dragging.parent;

    dragging = null;
    clearTargets();

    move(kind, parent, from, to);
  });

  list.addEventListener("dragend", () => {
    dragging = null;
    clearTargets();
  });

  /* Keyboard alternative: focus a handle and press Alt + Up/Down. */
  list.addEventListener("keydown", event => {
    const handle = event.target.closest(".drag-handle");

    if (
      !handle ||
      !event.altKey ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();

    const from = Number(handle.dataset.position);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);

    move(
      handle.dataset.kind,
      Number(handle.dataset.parent),
      from,
      to
    );
  });

  /*
    The existing PC script rebuilds task rows after Firebase updates.
    Add handles again whenever those rows are rebuilt.
  */
  const observer = new MutationObserver(addHandles);
  observer.observe(list, { childList: true, subtree: true });

  addHandles();
}

if (isPC) installDragHandles();

/* ---------- Date rollover ---------- */

let lastCalendarDate = ukDateString();

function checkCalendarDate() {
  const today = ukDateString();

  if (today !== lastCalendarDate) {
    lastCalendarDate = today;
    renderCountdown();
    renderEventList();
    updatePreview();

    if (isPhone || isPC) {
      clearOldScribble();
    }
  }
}

setInterval(checkCalendarDate, 30000);
document.addEventListener("visibilitychange", checkCalendarDate);
