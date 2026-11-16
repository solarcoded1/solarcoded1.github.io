import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  remove,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/* -------------------- Firebase setup -------------------- */

/*
  This module uses a named Firebase app so it can coexist with the
  default Firebase app initialized separately by phone.html and pc.html.
*/
const app = initializeApp(
  {
    databaseURL:
      "https://website-f5c09-default-rtdb.europe-west1.firebasedatabase.app/"
  },
  "daily-sheet-shared"
);

const database = getDatabase(app);

// Firebase locations used by shared site features.
const themeRef = ref(database, "sheetTheme");
const eventsRef = ref(database, "sheetEvents");
const scribbleRef = ref(database, "sheetScribble");
const todosRef = ref(database, "todos");

// Short helper for finding elements by ID.
const $ = id => document.getElementById(id);

// Identify which page loaded this shared module.
const isPhone = document.body.classList.contains("phone-page");
const isPC = document.body.classList.contains("pc-page");

/* -------------------- UK calendar date helpers -------------------- */

// Return today's date in UK time as YYYY-MM-DD.
function ukDateString() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const getPart = type => parts.find(part => part.type === type).value;

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

// Check that a date is a real calendar date in YYYY-MM-DD format.
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Convert a YYYY-MM-DD date to a UTC number for safe date arithmetic.
function dateNumber(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// Format a stored date for display, for example "12 Jun 2025".
function prettyDate(value) {
  return new Date(dateNumber(value)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

/*
  Find the next occurrence of an event.
  Annual events repeat after their original start date, including
  29 February events, which return on the next leap year.
*/
function nextOccurrence(event, today) {
  if (!validDate(event.date)) return null;

  // A one-off event has no occurrence after its date has passed.
  if (!event.repeat) {
    return event.date >= today ? event.date : null;
  }

  const [startYear, month, day] = event.date.split("-").map(Number);
  const currentYear = Number(today.slice(0, 4));
  const firstYear = Math.max(startYear, currentYear);

  // Search ahead far enough to find the next valid annual date.
  for (let year = firstYear; year <= firstYear + 8; year++) {
    const candidate =
      `${year}-${String(month).padStart(2, "0")}-` +
      `${String(day).padStart(2, "0")}`;

    if (validDate(candidate) && candidate >= today) {
      return candidate;
    }
  }

  return null;
}

/* -------------------- Shared colour theme -------------------- */

let currentTheme = "light";

// Apply the selected theme and update the PC theme button, if present.
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

// Add the theme toggle to the PC control panel.
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
        const nextTheme = currentTheme === "dark" ? "light" : "dark";
        await set(themeRef, nextTheme);
      } catch (error) {
        console.error("Could not save the theme:", error);
        alert("Could not save the theme. Check Firebase access.");
      } finally {
        button.disabled = false;
      }
    });

    headerButtons.prepend(button);
  }
}

// Keep the theme in sync across pages and devices.
onValue(
  themeRef,
  snapshot => applyTheme(snapshot.val()),
  error => console.error("Could not load the theme:", error)
);

/* -------------------- Countdown events -------------------- */

let events = [];
let countdownText = null;
let eventList = null;
let editingEventId = null;

// Find the next upcoming event and show its countdown on the phone.
function renderCountdown() {
  if (!countdownText) return;

  const today = ukDateString();

  const upcomingEvents = events
    .map(event => ({
      ...event,
      nextDate: nextOccurrence(event, today)
    }))
    .filter(event => event.nextDate)
    .sort((a, b) =>
      a.nextDate.localeCompare(b.nextDate) ||
      a.name.localeCompare(b.name)
    );

  if (upcomingEvents.length === 0) {
    countdownText.textContent = "No upcoming events";
    return;
  }

  const event = upcomingEvents[0];
  const daysRemaining = Math.round(
    (dateNumber(event.nextDate) - dateNumber(today)) / 86400000
  );

  countdownText.textContent = daysRemaining === 0
    ? `${event.name} — Today`
    : `${event.name} — ${daysRemaining} ${
        daysRemaining === 1 ? "day" : "days"
      } to go`;
}

// Clear the event form and leave edit mode.
function resetEventForm() {
  editingEventId = null;
  $("event-form").reset();
  $("event-submit").textContent = "Add Event";
  $("event-cancel").hidden = true;
}

// Build the PC event list with Edit and Delete buttons.
function renderEventList() {
  if (!eventList) return;

  eventList.replaceChildren();

  if (events.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "event-info";
    emptyItem.textContent = "No events added yet.";
    eventList.append(emptyItem);
    return;
  }

  const sortedEvents = [...events].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.name.localeCompare(b.name)
  );

  for (const event of sortedEvents) {
    const item = document.createElement("li");
    const info = document.createElement("div");
    info.className = "event-info";

    const name = document.createElement("strong");
    name.textContent = event.name;

    const details = document.createElement("small");
    const pastLabel =
      !event.repeat && event.date < ukDateString()
        ? " · Past"
        : "";

    details.textContent =
      `${prettyDate(event.date)}` +
      `${event.repeat ? " · Repeats yearly" : ""}${pastLabel}`;

    info.append(name, details);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "4px";

    // Load this event into the form for editing.
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

    // Delete the event from Firebase after confirmation.
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "sheet-button";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete "${event.name}"?`)) return;

      deleteButton.disabled = true;

      try {
        await remove(ref(database, `sheetEvents/${event.id}`));

        if (editingEventId === event.id) {
          resetEventForm();
        }
      } catch (error) {
        console.error("Could not delete the event:", error);
        alert("Could not delete the event. Check Firebase access.");
        deleteButton.disabled = false;
      }
    });

    actions.append(editButton, deleteButton);
    item.append(info, actions);
    eventList.append(item);
  }
}

// Add the countdown and Open Scribble button to the phone page.
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

// Add the event creation and editing panel to the PC sidebar.
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

    const submitButton = $("event-submit");
    submitButton.disabled = true;
    message.textContent = "Saving...";

    try {
      const eventRef = editingEventId
        ? ref(database, `sheetEvents/${editingEventId}`)
        : push(eventsRef);

      await set(eventRef, { name, date, repeat });

      resetEventForm();
      message.textContent = "Event saved.";
      $("event-name").focus();
    } catch (error) {
      console.error("Could not save the event:", error);
      message.textContent =
        "Could not save. Check your connection and Firebase rules.";
    } finally {
      submitButton.disabled = false;
    }
  });
}

// Create only the event interface needed by the current page.
if (isPhone) createPhoneCountdown();
if (isPC) createEventManager();

// Keep the local event list and phone countdown synced with Firebase.
onValue(
  eventsRef,
  snapshot => {
    const value = snapshot.val() || {};

    events = Object.entries(value)
      .map(([id, event]) => ({
        id,
        name: String(event?.name || ""),
        date: String(event?.date || ""),
        repeat: Boolean(event?.repeat)
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

/* -------------------- Shared daily scribble -------------------- */

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

// Create the saved drawing preview in the phone's forecast column.
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

// Add the scribble launch button to the PC sidebar.
function createPCScribblePanel() {
  const aside = document.querySelector("main aside");
  if (!aside) return;

  const panel = document



Write "continue" to complete the response
