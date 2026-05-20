const state = {
  tasks: [],
  members: [],
  summary: null,
  selectedId: "",
  view: "gantt",
};

const priorityLabels = {
  critica: "Critica",
  mare: "Mare",
  medie: "Medie",
  mica: "Mica",
};

const statusLabels = {
  planificat: "Planificat",
  "in-lucru": "In lucru",
  finalizat: "Finalizat",
  blocat: "Blocat",
};

const weekDays = ["Lun", "Mar", "Mie", "Joi", "Vin", "Sam", "Dum"];
const monthFormatter = new Intl.DateTimeFormat("ro-RO", { month: "short" });
const moneyFormatter = new Intl.NumberFormat("ro-RO", {
  style: "currency",
  currency: "RON",
  maximumFractionDigits: 0,
});

const elements = {
  searchInput: document.querySelector("#searchInput"),
  priorityFilter: document.querySelector("#priorityFilter"),
  memberFilter: document.querySelector("#memberFilter"),
  monthInput: document.querySelector("#monthInput"),
  sortInput: document.querySelector("#sortInput"),
  rangeLabel: document.querySelector("#rangeLabel"),
  message: document.querySelector("#message"),
  summaryStrip: document.querySelector("#summaryStrip"),
  ganttChart: document.querySelector("#ganttChart"),
  ganttCount: document.querySelector("#ganttCount"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarCount: document.querySelector("#calendarCount"),
  teamBoard: document.querySelector("#teamBoard"),
  teamCount: document.querySelector("#teamCount"),
  taskForm: document.querySelector("#taskForm"),
  taskId: document.querySelector("#taskId"),
  formTitle: document.querySelector("#formTitle"),
  formMode: document.querySelector("#formMode"),
  titleInput: document.querySelector("#titleInput"),
  startInput: document.querySelector("#startInput"),
  deadlineInput: document.querySelector("#deadlineInput"),
  priorityInput: document.querySelector("#priorityInput"),
  statusInput: document.querySelector("#statusInput"),
  assigneeInput: document.querySelector("#assigneeInput"),
  memberList: document.querySelector("#memberList"),
  participantsInput: document.querySelector("#participantsInput"),
  budgetInput: document.querySelector("#budgetInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  deleteTaskButton: document.querySelector("#deleteTaskButton"),
  newTaskButton: document.querySelector("#newTaskButton"),
  installButton: document.querySelector("#installButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  memberForm: document.querySelector("#memberForm"),
  memberNameInput: document.querySelector("#memberNameInput"),
  memberRoleInput: document.querySelector("#memberRoleInput"),
};

let deferredInstallPrompt = null;

function todayInput() {
  return toInputDate(new Date());
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  return new Date(`${value}T00:00:00`);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function daysBetween(start, end) {
  const ms = parseDate(end).getTime() - parseDate(start).getTime();
  return Math.round(ms / 86400000);
}

function getMonthValue() {
  return elements.monthInput.value || todayInput().slice(0, 7);
}

function debounce(callback, delay = 220) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Eroare de server.");
  }
  return payload;
}

function buildTaskQuery() {
  const params = new URLSearchParams();
  const search = elements.searchInput.value.trim();
  const priority = elements.priorityFilter.value;
  const assignee = elements.memberFilter.value;
  const month = getMonthValue();
  const sort = elements.sortInput.value;

  if (search) params.set("search", search);
  if (priority) params.set("priority", priority);
  if (assignee) params.set("assignee", assignee);
  if (month) params.set("month", month);
  if (sort) params.set("sort", sort);
  return params.toString();
}

async function loadData() {
  const [taskPayload, memberPayload] = await Promise.all([
    api(`/api/tasks?${buildTaskQuery()}`),
    api("/api/members"),
  ]);

  state.tasks = taskPayload.tasks;
  state.summary = taskPayload.summary;
  state.members = memberPayload.members;
  render();
}

function showMessage(text, type = "success") {
  elements.message.textContent = text;
  elements.message.classList.toggle("is-error", type === "error");
  elements.message.classList.add("is-visible");

  window.clearTimeout(showMessage.timeout);
  showMessage.timeout = window.setTimeout(() => {
    elements.message.classList.remove("is-visible", "is-error");
  }, 3200);
}

function render() {
  renderMemberInputs();
  renderSummary();
  renderGantt();
  renderCalendar();
  renderTeamBoard();
  updateFormMode();
  updateViews();
}

function renderMemberInputs() {
  const selectedFilter = elements.memberFilter.value;
  elements.memberFilter.innerHTML = '<option value="">Toti</option>';
  elements.memberList.innerHTML = "";

  for (const member of state.members) {
    const option = document.createElement("option");
    option.value = member.name;
    option.textContent = member.name;
    elements.memberFilter.append(option);

    const dataOption = document.createElement("option");
    dataOption.value = member.name;
    elements.memberList.append(dataOption);
  }

  elements.memberFilter.value = selectedFilter;
}

function renderSummary() {
  const summary = state.summary || {
    totalTasks: 0,
    finishedTasks: 0,
    totalBudget: 0,
    monthBudget: 0,
    upcomingDeadlines: 0,
  };

  const tiles = [
    ["Taskuri", summary.totalTasks],
    ["Finalizate", summary.finishedTasks],
    ["Buget total", moneyFormatter.format(summary.totalBudget)],
    ["Deadline 7 zile", summary.upcomingDeadlines],
  ];

  elements.summaryStrip.innerHTML = "";
  for (const [label, value] of tiles) {
    const tile = document.createElement("article");
    tile.className = "summary-tile";
    tile.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    elements.summaryStrip.append(tile);
  }
}

function getVisibleRange(tasks) {
  const month = getMonthValue();
  const monthStart = parseDate(`${month}-01`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);

  if (!tasks.length) {
    return {
      start: toInputDate(monthStart),
      end: toInputDate(monthEnd),
    };
  }

  const min = tasks.map((task) => task.startDate).reduce((a, b) => (a < b ? a : b));
  const max = tasks.map((task) => task.deadline).reduce((a, b) => (a > b ? a : b));
  const rangeStart = addDays(parseDate(min), -1);
  const rangeEnd = addDays(parseDate(max), 2);

  return {
    start: toInputDate(rangeStart),
    end: toInputDate(rangeEnd),
  };
}

function listDays(start, end) {
  const days = [];
  let cursor = parseDate(start);
  const last = parseDate(end);

  while (cursor <= last) {
    days.push(toInputDate(cursor));
    cursor = addDays(cursor, 1);
  }

  return days;
}

function isWeekend(value) {
  const day = parseDate(value).getDay();
  return day === 0 || day === 6;
}

function renderGantt() {
  const tasks = state.tasks;
  elements.ganttCount.textContent = `${tasks.length} taskuri`;
  const range = getVisibleRange(tasks);
  const days = listDays(range.start, range.end);
  const columns = `240px repeat(${days.length}, minmax(36px, 1fr))`;
  const monthName = monthFormatter.format(parseDate(`${getMonthValue()}-01`));
  elements.rangeLabel.textContent = `${monthName} ${getMonthValue().slice(0, 4)}`;

  if (!tasks.length) {
    elements.ganttChart.innerHTML = '<div class="gantt-empty">Nu exista taskuri in filtrul curent.</div>';
    return;
  }

  const grid = document.createElement("div");
  grid.className = "gantt-grid";

  const header = document.createElement("div");
  header.className = "gantt-header";
  header.style.gridTemplateColumns = columns;
  header.innerHTML = '<div class="gantt-corner">Task</div>';

  for (const day of days) {
    const date = parseDate(day);
    const cell = document.createElement("div");
    cell.className = `gantt-day${isWeekend(day) ? " is-weekend" : ""}`;
    cell.innerHTML = `<span>${date.getDate()}</span><span>${monthFormatter.format(date)}</span>`;
    header.append(cell);
  }
  grid.append(header);

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "gantt-row";
    row.style.gridTemplateColumns = columns;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "gantt-label";
    label.innerHTML = `<strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.assignee || "Nealocat")} - ${moneyFormatter.format(task.budget)}</span>`;
    label.addEventListener("click", () => selectTask(task.id));
    row.append(label);

    const track = document.createElement("div");
    track.className = "gantt-track";
    track.style.gridTemplateColumns = `repeat(${days.length}, minmax(36px, 1fr))`;

    for (const day of days) {
      const cell = document.createElement("div");
      cell.className = `gantt-cell${isWeekend(day) ? " is-weekend" : ""}`;
      track.append(cell);
    }
    row.append(track);

    const startOffset = Math.max(0, daysBetween(range.start, task.startDate));
    const duration = Math.max(1, daysBetween(task.startDate, task.deadline) + 1);
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = `gantt-bar priority-${task.priority}${state.selectedId === task.id ? " is-selected" : ""}`;
    bar.style.gridColumn = `${startOffset + 2} / span ${duration}`;
    bar.style.gridRow = "1";
    bar.innerHTML = `<span>${escapeHtml(priorityLabels[task.priority])} - ${escapeHtml(statusLabels[task.status])}</span>`;
    bar.title = `${task.title} - ${task.startDate} - ${task.deadline}`;
    bar.addEventListener("click", () => selectTask(task.id));
    row.append(bar);

    grid.append(row);
  }

  elements.ganttChart.replaceChildren(grid);
}

function renderCalendar() {
  const month = getMonthValue();
  const monthStart = parseDate(`${month}-01`);
  const firstGridDate = addDays(monthStart, -((monthStart.getDay() + 6) % 7));
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const lastGridDate = addDays(monthEnd, 6 - ((monthEnd.getDay() + 6) % 7));
  const today = todayInput();
  const days = listDays(toInputDate(firstGridDate), toInputDate(lastGridDate));
  elements.calendarCount.textContent = `${state.tasks.length} intrari`;
  elements.calendarGrid.innerHTML = "";

  for (const weekDay of weekDays) {
    const head = document.createElement("div");
    head.className = "calendar-weekday";
    head.textContent = weekDay;
    elements.calendarGrid.append(head);
  }

  for (const day of days) {
    const date = parseDate(day);
    const cell = document.createElement("div");
    cell.className = `calendar-day${day.slice(0, 7) !== month ? " is-outside" : ""}`;
    const matching = state.tasks.filter((task) => task.startDate <= day && task.deadline >= day);
    const dateHead = document.createElement("div");
    dateHead.className = "calendar-date";
    dateHead.innerHTML = `<span class="${day === today ? "today" : ""}">${date.getDate()}</span><span>${matching.length || ""}</span>`;
    cell.append(dateHead);

    for (const task of matching.slice(0, 4)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `calendar-chip priority-${task.priority}`;
      chip.innerHTML = `<strong>${escapeHtml(task.title)}</strong><span>${task.deadline === day ? "Deadline" : escapeHtml(task.assignee || "Nealocat")}</span>`;
      chip.addEventListener("click", () => selectTask(task.id));
      cell.append(chip);
    }

    if (matching.length > 4) {
      const more = document.createElement("span");
      more.className = "calendar-more";
      more.textContent = `+${matching.length - 4}`;
      cell.append(more);
    }

    elements.calendarGrid.append(cell);
  }
}

function renderTeamBoard() {
  const members = [...state.members];
  const unassignedTasks = state.tasks.filter((task) => !task.assignee);
  if (unassignedTasks.length) {
    members.push({ id: "unassigned", name: "Nealocat", role: "" });
  }

  elements.teamCount.textContent = `${members.length} membri`;
  elements.teamBoard.innerHTML = "";

  if (!members.length) {
    elements.teamBoard.innerHTML = '<div class="team-empty">Nu exista membri.</div>';
    return;
  }

  for (const member of members) {
    const memberTasks = state.tasks.filter((task) => (member.id === "unassigned" ? !task.assignee : task.assignee === member.name));
    const budget = memberTasks.reduce((sum, task) => sum + task.budget, 0);
    const column = document.createElement("article");
    column.className = "member-column";

    const head = document.createElement("div");
    head.className = "member-head";
    head.innerHTML = `<div><h3>${escapeHtml(member.name)}</h3><p>${escapeHtml(member.role || `${memberTasks.length} taskuri`)}</p></div><span class="member-budget">${moneyFormatter.format(budget)}</span>`;
    column.append(head);

    for (const task of memberTasks) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `team-task priority-${task.priority}`;
      card.innerHTML = `<strong>${escapeHtml(task.title)}</strong><span>${task.startDate} - ${task.deadline} - ${moneyFormatter.format(task.budget)}</span>`;
      card.addEventListener("click", () => selectTask(task.id));
      column.append(card);
    }

    elements.teamBoard.append(column);
  }
}

function updateViews() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });

  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("is-visible", panel.id === `${state.view}View`);
  });
}

function updateFormMode() {
  const hasSelection = Boolean(state.selectedId);
  elements.formTitle.textContent = hasSelection ? "Editeaza task" : "Task nou";
  elements.formMode.textContent = hasSelection ? "Actualizare" : "Planificare";
  elements.deleteTaskButton.disabled = !hasSelection;
}

function resetForm() {
  state.selectedId = "";
  elements.taskForm.reset();
  const today = todayInput();
  elements.taskId.value = "";
  elements.startInput.value = today;
  elements.deadlineInput.value = today;
  elements.priorityInput.value = "medie";
  elements.statusInput.value = "planificat";
  elements.participantsInput.value = 1;
  elements.budgetInput.value = 0;
  updateFormMode();
  renderGantt();
}

function selectTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    return;
  }

  state.selectedId = task.id;
  elements.taskId.value = task.id;
  elements.titleInput.value = task.title;
  elements.startInput.value = task.startDate;
  elements.deadlineInput.value = task.deadline;
  elements.priorityInput.value = task.priority;
  elements.statusInput.value = task.status;
  elements.assigneeInput.value = task.assignee;
  elements.participantsInput.value = task.participants;
  elements.budgetInput.value = task.budget;
  elements.descriptionInput.value = task.description;
  updateFormMode();
  renderGantt();
}

function readTaskForm() {
  return {
    title: elements.titleInput.value.trim(),
    startDate: elements.startInput.value,
    deadline: elements.deadlineInput.value,
    priority: elements.priorityInput.value,
    status: elements.statusInput.value,
    assignee: elements.assigneeInput.value.trim(),
    participants: Number(elements.participantsInput.value || 0),
    budget: Number(elements.budgetInput.value || 0),
    description: elements.descriptionInput.value.trim(),
  };
}

async function saveTask(event) {
  event.preventDefault();
  const payload = readTaskForm();
  const id = elements.taskId.value;

  try {
    if (id) {
      await api(`/api/tasks/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      showMessage("Task actualizat.");
    } else {
      const result = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      state.selectedId = result.task.id;
      elements.taskId.value = result.task.id;
      showMessage("Task adaugat.");
    }

    await loadData();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function deleteSelectedTask() {
  const id = elements.taskId.value;
  if (!id) {
    return;
  }

  try {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    resetForm();
    await loadData();
    showMessage("Task sters.");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function addMember(event) {
  event.preventDefault();
  const name = elements.memberNameInput.value.trim();
  const role = elements.memberRoleInput.value.trim();

  if (!name) {
    showMessage("Numele membrului este obligatoriu.", "error");
    return;
  }

  try {
    await api("/api/members", {
      method: "POST",
      body: JSON.stringify({ name, role }),
    });
    elements.memberForm.reset();
    await loadData();
    showMessage("Membru adaugat.");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  const reload = debounce(() => loadData().catch((error) => showMessage(error.message, "error")));
  elements.searchInput.addEventListener("input", reload);
  elements.priorityFilter.addEventListener("change", reload);
  elements.memberFilter.addEventListener("change", reload);
  elements.monthInput.addEventListener("change", reload);
  elements.sortInput.addEventListener("change", reload);
  elements.taskForm.addEventListener("submit", saveTask);
  elements.deleteTaskButton.addEventListener("click", deleteSelectedTask);
  elements.memberForm.addEventListener("submit", addMember);
  elements.newTaskButton.addEventListener("click", resetForm);
  elements.clearSelectionButton.addEventListener("click", resetForm);

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      updateViews();
    });
  });
}

async function init() {
  const today = todayInput();
  elements.monthInput.value = today.slice(0, 7);
  resetForm();
  bindEvents();

  try {
    await loadData();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  elements.installButton.hidden = true;
});

init();
