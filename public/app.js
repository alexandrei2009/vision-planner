const state = {
  user: null,
  teams: [],
  activeTeamId: "",
  tasks: [],
  members: [],
  notifications: [],
  aiSuggestions: [],
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

const priorityShortLabels = {
  critica: "C",
  mare: "Ma",
  medie: "M",
  mica: "Mi",
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
  authScreen: document.querySelector("#authScreen"),
  appShell: document.querySelector("#appShell"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  loginEmailInput: document.querySelector("#loginEmailInput"),
  loginPasswordInput: document.querySelector("#loginPasswordInput"),
  registerNameInput: document.querySelector("#registerNameInput"),
  registerEmailInput: document.querySelector("#registerEmailInput"),
  registerPasswordInput: document.querySelector("#registerPasswordInput"),
  registerTeamInput: document.querySelector("#registerTeamInput"),
  registerInviteInput: document.querySelector("#registerInviteInput"),
  authMessage: document.querySelector("#authMessage"),
  teamSelect: document.querySelector("#teamSelect"),
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
  participantsInput: document.querySelector("#participantsInput"),
  budgetInput: document.querySelector("#budgetInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  deleteTaskButton: document.querySelector("#deleteTaskButton"),
  aiButton: document.querySelector("#aiButton"),
  aiPanel: document.querySelector("#aiPanel"),
  aiProvider: document.querySelector("#aiProvider"),
  aiResults: document.querySelector("#aiResults"),
  createAiTasksButton: document.querySelector("#createAiTasksButton"),
  newTaskButton: document.querySelector("#newTaskButton"),
  installButton: document.querySelector("#installButton"),
  notificationButton: document.querySelector("#notificationButton"),
  notificationCount: document.querySelector("#notificationCount"),
  notificationPanel: document.querySelector("#notificationPanel"),
  notificationList: document.querySelector("#notificationList"),
  markAllReadButton: document.querySelector("#markAllReadButton"),
  logoutButton: document.querySelector("#logoutButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  teamForm: document.querySelector("#teamForm"),
  teamNameInput: document.querySelector("#teamNameInput"),
  inviteCodeText: document.querySelector("#inviteCodeText"),
  copyInviteButton: document.querySelector("#copyInviteButton"),
  joinTeamForm: document.querySelector("#joinTeamForm"),
  joinCodeInput: document.querySelector("#joinCodeInput"),
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
      "X-Requested-With": "VisionPlanner",
      ...(state.activeTeamId ? { "X-Team-Id": state.activeTeamId } : {}),
      ...(options.headers || {}),
    },
    credentials: "same-origin",
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
  const [taskPayload, memberPayload, notificationPayload] = await Promise.all([
    api(`/api/tasks?${buildTaskQuery()}`),
    api("/api/members"),
    api("/api/notifications"),
  ]);

  state.tasks = taskPayload.tasks;
  state.summary = taskPayload.summary;
  state.members = memberPayload.members;
  state.notifications = notificationPayload.notifications;
  elements.notificationCount.textContent = notificationPayload.unreadCount;
  render();
}

async function loadMe() {
  const payload = await api("/api/me");
  state.user = payload.user;
  state.teams = payload.teams;
  state.activeTeamId = state.activeTeamId || payload.activeTeam?.id || payload.teams[0]?.id || "";
  showApp();
}

function showApp() {
  elements.authScreen.classList.add("is-hidden");
  elements.appShell.classList.remove("is-hidden");
}

function showAuth() {
  elements.appShell.classList.add("is-hidden");
  elements.authScreen.classList.remove("is-hidden");
}

function showMessage(text, type = "success") {
  const target = elements.appShell.classList.contains("is-hidden") ? elements.authMessage : elements.message;
  target.textContent = text;
  target.classList.toggle("is-error", type === "error");
  target.classList.add("is-visible");

  window.clearTimeout(showMessage.timeout);
  showMessage.timeout = window.setTimeout(() => {
    target.classList.remove("is-visible", "is-error");
  }, 3200);
}

function render() {
  renderTeams();
  renderMemberInputs();
  renderSummary();
  renderGantt();
  renderCalendar();
  renderTeamBoard();
  renderNotifications();
  updateFormMode();
  updateViews();
}

function renderTeams() {
  const activeTeam = state.teams.find((team) => team.id === state.activeTeamId) || state.teams[0];
  elements.teamSelect.innerHTML = "";
  for (const team of state.teams) {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    elements.teamSelect.append(option);
  }
  if (activeTeam) {
    state.activeTeamId = activeTeam.id;
    elements.teamSelect.value = activeTeam.id;
    elements.teamNameInput.value = activeTeam.name;
    elements.inviteCodeText.textContent = activeTeam.inviteCode || "-";
  }
}

function renderMemberInputs() {
  const selectedFilter = elements.memberFilter.value;
  elements.memberFilter.innerHTML = '<option value="">Toti</option>';
  elements.assigneeInput.innerHTML = '<option value="">Nealocat</option>';

  for (const member of state.members) {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    elements.memberFilter.append(option);

    const assigneeOption = document.createElement("option");
    assigneeOption.value = member.id;
    assigneeOption.textContent = `${member.name} (${member.email})`;
    elements.assigneeInput.append(assigneeOption);
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
    const isCompactBar = duration <= 2;
    bar.className = `gantt-bar priority-${task.priority}${isCompactBar ? " is-compact" : ""}${state.selectedId === task.id ? " is-selected" : ""}`;
    bar.style.gridColumn = `${startOffset + 2} / span ${duration}`;
    bar.style.gridRow = "1";
    bar.setAttribute("aria-label", `${task.title} - ${priorityLabels[task.priority]} - ${statusLabels[task.status]}`);
    bar.innerHTML = `<span>${escapeHtml(isCompactBar ? priorityShortLabels[task.priority] : `${priorityLabels[task.priority]} - ${statusLabels[task.status]}`)}</span>`;
    bar.title = `${task.title} - ${priorityLabels[task.priority]} - ${statusLabels[task.status]} - ${task.startDate} - ${task.deadline}`;
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
    const memberTasks = state.tasks.filter((task) => (member.id === "unassigned" ? !task.assigneeId : task.assigneeId === member.id));
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

function renderNotifications() {
  elements.notificationList.innerHTML = "";

  if (!state.notifications.length) {
    elements.notificationList.innerHTML = '<div class="notification-empty">Nu ai notificari.</div>';
    return;
  }

  for (const notification of state.notifications) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `notification-item${notification.readAt ? "" : " is-unread"}`;
    item.innerHTML = `<strong>${escapeHtml(notification.title)}</strong><span>${escapeHtml(notification.body)}</span><small>${new Date(notification.createdAt).toLocaleString("ro-RO")}</small>`;
    item.addEventListener("click", async () => {
      try {
        await api(`/api/notifications/${notification.id}`, { method: "POST" });
        notification.readAt = new Date().toISOString();
        renderNotifications();
        const unread = state.notifications.filter((entry) => !entry.readAt).length;
        elements.notificationCount.textContent = unread;
      } catch (error) {
        showMessage(error.message, "error");
      }
    });
    elements.notificationList.append(item);
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
  elements.assigneeInput.value = "";
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
  elements.assigneeInput.value = task.assigneeId || "";
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
    assigneeId: elements.assigneeInput.value,
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

async function saveTeamName(event) {
  event.preventDefault();
  const name = elements.teamNameInput.value.trim();

  if (!name) {
    showMessage("Numele echipei este obligatoriu.", "error");
    return;
  }

  try {
    const payload = await api(`/api/teams/${state.activeTeamId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    state.teams = payload.teams;
    await loadData();
    showMessage("Numele echipei a fost salvat.");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function joinTeam(event) {
  event.preventDefault();
  const inviteCode = elements.joinCodeInput.value.trim();
  if (!inviteCode) {
    showMessage("Introdu codul de invitatie.", "error");
    return;
  }

  try {
    const payload = await api("/api/teams/join", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    });
    state.teams = payload.teams;
    state.activeTeamId = payload.team.id;
    elements.joinTeamForm.reset();
    resetForm();
    await loadData();
    showMessage("Te-ai alaturat echipei.");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function login(event) {
  event.preventDefault();
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: elements.loginEmailInput.value,
        password: elements.loginPasswordInput.value,
      }),
    });
    state.user = payload.user;
    state.teams = payload.teams;
    state.activeTeamId = payload.activeTeam?.id || payload.teams[0]?.id || "";
    showApp();
    resetForm();
    await loadData();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function register(event) {
  event.preventDefault();
  try {
    const payload = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: elements.registerNameInput.value,
        email: elements.registerEmailInput.value,
        password: elements.registerPasswordInput.value,
        teamName: elements.registerTeamInput.value,
        inviteCode: elements.registerInviteInput.value,
      }),
    });
    state.user = payload.user;
    state.teams = payload.teams;
    state.activeTeamId = payload.activeTeam?.id || payload.teams[0]?.id || "";
    showApp();
    resetForm();
    await loadData();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
  }
  state.user = null;
  state.teams = [];
  state.activeTeamId = "";
  showAuth();
}

async function generateSubtasks() {
  const payload = readTaskForm();
  if (!payload.title) {
    showMessage("Scrie mai intai titlul taskului.", "error");
    return;
  }

  elements.aiPanel.classList.remove("is-hidden");
  elements.aiResults.innerHTML = '<div class="notification-empty">Generez subtaskuri...</div>';
  elements.createAiTasksButton.disabled = true;

  try {
    const result = await api("/api/ai/subtasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.aiSuggestions = result.subtasks || [];
    elements.aiProvider.textContent = result.provider === "openai" ? "OpenAI" : "Planificare locala";
    renderAiSuggestions();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

function renderAiSuggestions() {
  elements.aiResults.innerHTML = "";
  if (!state.aiSuggestions.length) {
    elements.aiResults.innerHTML = '<div class="notification-empty">Nu am gasit subtaskuri.</div>';
    return;
  }

  for (const subtask of state.aiSuggestions) {
    const item = document.createElement("article");
    item.className = "ai-result";
    item.innerHTML = `<strong>${escapeHtml(subtask.title)}</strong><span>${escapeHtml(subtask.description || "")}</span><small>${escapeHtml(priorityLabels[subtask.priority] || "Medie")} - ${escapeHtml(subtask.deadline || "")}</small>`;
    elements.aiResults.append(item);
  }
  elements.createAiTasksButton.disabled = false;
}

async function createAiTasks() {
  if (!state.aiSuggestions.length) {
    return;
  }

  try {
    for (const subtask of state.aiSuggestions) {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...subtask,
          assigneeId: elements.assigneeInput.value,
          participants: 1,
          status: "planificat",
        }),
      });
    }
    state.aiSuggestions = [];
    elements.aiPanel.classList.add("is-hidden");
    await loadData();
    showMessage("Subtaskurile au fost create.");
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
  elements.loginForm.addEventListener("submit", login);
  elements.registerForm.addEventListener("submit", register);
  elements.loginTab.addEventListener("click", () => {
    elements.loginTab.classList.add("is-active");
    elements.registerTab.classList.remove("is-active");
    elements.loginForm.classList.remove("is-hidden");
    elements.registerForm.classList.add("is-hidden");
  });
  elements.registerTab.addEventListener("click", () => {
    elements.registerTab.classList.add("is-active");
    elements.loginTab.classList.remove("is-active");
    elements.registerForm.classList.remove("is-hidden");
    elements.loginForm.classList.add("is-hidden");
  });
  elements.teamSelect.addEventListener("change", async () => {
    state.activeTeamId = elements.teamSelect.value;
    resetForm();
    await loadData();
  });
  elements.searchInput.addEventListener("input", reload);
  elements.priorityFilter.addEventListener("change", reload);
  elements.memberFilter.addEventListener("change", reload);
  elements.monthInput.addEventListener("change", reload);
  elements.sortInput.addEventListener("change", reload);
  elements.taskForm.addEventListener("submit", saveTask);
  elements.deleteTaskButton.addEventListener("click", deleteSelectedTask);
  elements.aiButton.addEventListener("click", generateSubtasks);
  elements.createAiTasksButton.addEventListener("click", createAiTasks);
  elements.teamForm.addEventListener("submit", saveTeamName);
  elements.joinTeamForm.addEventListener("submit", joinTeam);
  elements.newTaskButton.addEventListener("click", resetForm);
  elements.clearSelectionButton.addEventListener("click", resetForm);
  elements.logoutButton.addEventListener("click", logout);
  elements.copyInviteButton.addEventListener("click", async () => {
    const code = elements.inviteCodeText.textContent;
    await navigator.clipboard.writeText(code);
    showMessage("Codul de invitatie a fost copiat.");
  });
  elements.notificationButton.addEventListener("click", () => {
    elements.notificationPanel.classList.toggle("is-hidden");
  });
  elements.markAllReadButton.addEventListener("click", async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" });
      state.notifications = state.notifications.map((notification) => ({
        ...notification,
        readAt: notification.readAt || new Date().toISOString(),
      }));
      elements.notificationCount.textContent = "0";
      renderNotifications();
    } catch (error) {
      showMessage(error.message, "error");
    }
  });

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
    await loadMe();
    await loadData();
  } catch (error) {
    showAuth();
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
