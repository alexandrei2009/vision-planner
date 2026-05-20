const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");

const PRIORITIES = ["critica", "mare", "medie", "mica"];
const STATUSES = ["planificat", "in-lucru", "finalizat", "blocat"];
const PRIORITY_ORDER = {
  critica: 0,
  mare: 1,
  medie: 2,
  mica: 3,
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createSeedState() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return {
    members: [
      { id: randomUUID(), name: "Ioana Pop", role: "Coordonare" },
      { id: randomUUID(), name: "Andrei Ionescu", role: "Logistica" },
      { id: randomUUID(), name: "Mara Stan", role: "Design" },
      { id: randomUUID(), name: "Victor Ene", role: "Financiar" },
    ],
    tasks: [
      {
        id: randomUUID(),
        title: "Concept eveniment",
        description: "Stabilire tema, public tinta si obiective.",
        startDate: toDateInput(start),
        deadline: toDateInput(addDays(start, 4)),
        participants: 4,
        budget: 1200,
        priority: "mare",
        assignee: "Ioana Pop",
        status: "in-lucru",
      },
      {
        id: randomUUID(),
        title: "Rezervare locatie",
        description: "Confirmare sala, program si costuri.",
        startDate: toDateInput(addDays(start, 2)),
        deadline: toDateInput(addDays(start, 9)),
        participants: 2,
        budget: 4500,
        priority: "critica",
        assignee: "Andrei Ionescu",
        status: "planificat",
      },
      {
        id: randomUUID(),
        title: "Materiale vizuale",
        description: "Afise, program si continut pentru social media.",
        startDate: toDateInput(addDays(start, 5)),
        deadline: toDateInput(addDays(start, 14)),
        participants: 3,
        budget: 1800,
        priority: "medie",
        assignee: "Mara Stan",
        status: "planificat",
      },
      {
        id: randomUUID(),
        title: "Confirmare furnizori",
        description: "Sunet, lumini, catering si transport.",
        startDate: toDateInput(addDays(start, 10)),
        deadline: toDateInput(addDays(start, 18)),
        participants: 2,
        budget: 6200,
        priority: "mare",
        assignee: "Victor Ene",
        status: "planificat",
      },
      {
        id: randomUUID(),
        title: "Ziua evenimentului",
        description: "Coordonare acces, program si echipe pe teren.",
        startDate: toDateInput(addDays(start, 21)),
        deadline: toDateInput(addDays(start, 21)),
        participants: 10,
        budget: 3000,
        priority: "critica",
        assignee: "Ioana Pop",
        status: "planificat",
      },
    ],
  };
}

function makeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readState() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      members: Array.isArray(parsed.members) ? parsed.members.map(normalizeMember) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTaskForStorage) : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    const seed = createSeedState();
    await writeState(seed);
    return seed;
  }
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const sortedState = {
    members: state.members.map(normalizeMember).sort((a, b) => a.name.localeCompare(b.name)),
    tasks: sortTasksCalendar(state.tasks.map(normalizeTaskForStorage)),
  };
  await fs.writeFile(DATA_FILE, `${JSON.stringify(sortedState, null, 2)}\n`, "utf8");
}

function normalizeMember(member) {
  return {
    id: String(member.id || randomUUID()),
    name: String(member.name || "").trim(),
    role: String(member.role || "").trim(),
  };
}

function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && toDateInput(date) === value;
}

function normalizeTaskForStorage(task) {
  const fallbackDate = toDateInput(new Date());
  const startDate = isIsoDate(task.startDate) ? task.startDate : isIsoDate(task.deadline) ? task.deadline : fallbackDate;
  const deadline = isIsoDate(task.deadline) ? task.deadline : startDate;

  return {
    id: String(task.id || randomUUID()),
    title: String(task.title || "Task fara nume").trim(),
    description: String(task.description || "").trim(),
    startDate,
    deadline,
    participants: Math.max(0, Math.round(parseNumber(task.participants, 0))),
    budget: Math.max(0, parseNumber(task.budget, 0)),
    priority: PRIORITIES.includes(task.priority) ? task.priority : "medie",
    assignee: String(task.assignee || "").trim(),
    status: STATUSES.includes(task.status) ? task.status : "planificat",
  };
}

function validateTaskPayload(payload, existingTask = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw makeError(400, "Datele trimise nu sunt valide.");
  }

  const task = normalizeTaskForStorage({
    ...existingTask,
    ...payload,
    id: existingTask.id || payload.id,
  });

  if (!task.title) {
    throw makeError(400, "Titlul este obligatoriu.");
  }

  if (!isIsoDate(task.startDate) || !isIsoDate(task.deadline)) {
    throw makeError(400, "Datele trebuie sa fie in format YYYY-MM-DD.");
  }

  if (task.startDate > task.deadline) {
    throw makeError(400, "Data de start trebuie sa fie inainte de deadline.");
  }

  return task;
}

function sortTasksCalendar(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.startDate !== b.startDate) {
      return a.startDate.localeCompare(b.startDate);
    }
    if (a.deadline !== b.deadline) {
      return a.deadline.localeCompare(b.deadline);
    }
    return a.title.localeCompare(b.title);
  });
}

function sortTasks(tasks, sortBy) {
  const sorted = [...tasks];

  if (sortBy === "priority") {
    sorted.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return priorityDiff || a.deadline.localeCompare(b.deadline);
    });
    return sorted;
  }

  if (sortBy === "participants") {
    sorted.sort((a, b) => a.participants - b.participants || a.deadline.localeCompare(b.deadline));
    return sorted;
  }

  if (sortBy === "budget") {
    sorted.sort((a, b) => b.budget - a.budget || a.deadline.localeCompare(b.deadline));
    return sorted;
  }

  return sortTasksCalendar(sorted);
}

function taskOverlapsMonth(task, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return true;
  }

  const start = `${month}-01`;
  const monthStart = new Date(`${start}T00:00:00`);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const end = toDateInput(monthEnd);
  return task.startDate <= end && task.deadline >= start;
}

function applyTaskFilters(tasks, query) {
  const search = String(query.get("search") || "").trim().toLowerCase();
  const priority = String(query.get("priority") || "");
  const status = String(query.get("status") || "");
  const assignee = String(query.get("assignee") || "");
  const month = String(query.get("month") || "");
  const sortBy = String(query.get("sort") || "calendar");

  const filtered = tasks.filter((task) => {
    const haystack = `${task.title} ${task.description} ${task.assignee}`.toLowerCase();
    return (!search || haystack.includes(search))
      && (!priority || task.priority === priority)
      && (!status || task.status === status)
      && (!assignee || task.assignee === assignee)
      && taskOverlapsMonth(task, month);
  });

  return sortTasks(filtered, sortBy);
}

function getCurrentMonth() {
  return toDateInput(new Date()).slice(0, 7);
}

function createSummary(tasks, month = getCurrentMonth()) {
  const now = toDateInput(new Date());
  const nextWeek = toDateInput(addDays(new Date(), 7));
  const monthTasks = tasks.filter((task) => taskOverlapsMonth(task, month));
  const emptyPriority = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0]));
  const emptyStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  const perMember = {};

  for (const task of tasks) {
    emptyPriority[task.priority] += 1;
    emptyStatus[task.status] += 1;
    const key = task.assignee || "Nealocat";
    if (!perMember[key]) {
      perMember[key] = { tasks: 0, budget: 0 };
    }
    perMember[key].tasks += 1;
    perMember[key].budget += task.budget;
  }

  return {
    totalTasks: tasks.length,
    finishedTasks: tasks.filter((task) => task.status === "finalizat").length,
    totalBudget: tasks.reduce((sum, task) => sum + task.budget, 0),
    monthBudget: monthTasks.reduce((sum, task) => sum + task.budget, 0),
    upcomingDeadlines: tasks.filter((task) => task.deadline >= now && task.deadline <= nextWeek).length,
    byPriority: emptyPriority,
    byStatus: emptyStatus,
    perMember,
  };
}

function addAssigneeAsMember(state, assignee) {
  const name = String(assignee || "").trim();
  if (!name) {
    return;
  }

  const exists = state.members.some((member) => member.name.toLowerCase() === name.toLowerCase());
  if (!exists) {
    state.members.push({ id: randomUUID(), name, role: "" });
  }
}

async function readJsonRequest(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) {
      throw makeError(413, "Cererea este prea mare.");
    }
  }

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw makeError(400, "JSON invalid.");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
  response.writeHead(204, { "Cache-Control": "no-store" });
  response.end();
}

async function handleApi(request, response, url) {
  const state = await readState();
  const segments = url.pathname.split("/").filter(Boolean);
  const resource = segments[1];
  const id = segments[2];

  if (resource === "tasks") {
    if (request.method === "GET" && !id) {
      sendJson(response, 200, {
        tasks: applyTaskFilters(state.tasks, url.searchParams),
        summary: createSummary(state.tasks, String(url.searchParams.get("month") || getCurrentMonth())),
      });
      return;
    }

    if (request.method === "POST" && !id) {
      const payload = await readJsonRequest(request);
      const task = validateTaskPayload({ ...payload, id: randomUUID() });
      state.tasks.push(task);
      addAssigneeAsMember(state, task.assignee);
      await writeState(state);
      sendJson(response, 201, { task });
      return;
    }

    const taskIndex = state.tasks.findIndex((task) => task.id === id);
    if (taskIndex === -1) {
      throw makeError(404, "Taskul nu a fost gasit.");
    }

    if (request.method === "GET") {
      sendJson(response, 200, { task: state.tasks[taskIndex] });
      return;
    }

    if (request.method === "PUT") {
      const payload = await readJsonRequest(request);
      const task = validateTaskPayload(payload, state.tasks[taskIndex]);
      state.tasks[taskIndex] = task;
      addAssigneeAsMember(state, task.assignee);
      await writeState(state);
      sendJson(response, 200, { task });
      return;
    }

    if (request.method === "DELETE") {
      state.tasks.splice(taskIndex, 1);
      await writeState(state);
      sendNoContent(response);
      return;
    }
  }

  if (resource === "members") {
    if (request.method === "GET" && !id) {
      sendJson(response, 200, { members: state.members });
      return;
    }

    if (request.method === "POST" && !id) {
      const payload = await readJsonRequest(request);
      const member = normalizeMember({ id: randomUUID(), ...payload });
      if (!member.name) {
        throw makeError(400, "Numele membrului este obligatoriu.");
      }
      const duplicate = state.members.some((item) => item.name.toLowerCase() === member.name.toLowerCase());
      if (duplicate) {
        throw makeError(409, "Membrul exista deja.");
      }
      state.members.push(member);
      await writeState(state);
      sendJson(response, 201, { member });
      return;
    }

    if (request.method === "DELETE" && id) {
      const member = state.members.find((item) => item.id === id);
      if (!member) {
        throw makeError(404, "Membrul nu a fost gasit.");
      }
      state.members = state.members.filter((item) => item.id !== id);
      for (const task of state.tasks) {
        if (task.assignee === member.name) {
          task.assignee = "";
        }
      }
      await writeState(state);
      sendNoContent(response);
      return;
    }
  }

  if (resource === "summary" && request.method === "GET") {
    sendJson(response, 200, {
      summary: createSummary(state.tasks, String(url.searchParams.get("month") || getCurrentMonth())),
    });
    return;
  }

  throw makeError(404, "Ruta API nu exista.");
}

async function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw makeError(403, "Acces interzis.");
  }

  try {
    const body = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      const indexPath = path.join(PUBLIC_DIR, "index.html");
      const body = await fs.readFile(indexPath);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      response.end(body);
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok", app: "Vision Planner" });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      throw makeError(405, "Metoda nu este permisa.");
    }

    await serveStatic(request, response, url);
  } catch (error) {
    const status = error.status || 500;
    sendJson(response, status, {
      error: error.message || "Eroare interna.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Vision Planner running at http://localhost:${PORT}`);
});
