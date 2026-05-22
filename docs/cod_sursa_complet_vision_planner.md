# Cod sursa complet - Vision Planner

Acest fisier reuneste codul sursa si fisierele text/configuratiile principale ale proiectului, pentru consultare rapida de catre juriu.

Nu sunt incluse aici fisierele binare PNG ale iconitelor PWA, deoarece acestea se prezinta separat ca fisiere din proiect. Ele exista in `public/icons/`.

## Lista fisierelor incluse

- `server.js`
- `package.json`
- `render.yaml`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `public/sw.js`
- `public/manifest.webmanifest`
- `public/icons/icon.svg`
- `scripts/generate-icons.js`
- `data/events.json`
- `ProiectInfo.cpp`
- `README.md`

## server.js

~~~~javascript
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  randomBytes,
  randomUUID,
  pbkdf2Sync,
  timingSafeEqual,
  createHash,
} = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");
const USE_DATABASE = Boolean(process.env.DATABASE_URL);
const SESSION_COOKIE = "vp_session";
const SESSION_TTL_DAYS = 14;
const PASSWORD_ITERATIONS = 310000;
const PASSWORD_KEY_LENGTH = 32;
const AI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

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

let pgPool;
let databaseReady = false;
let lastNotificationSweep = 0;
const rateBuckets = new Map();

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

function emptyExtendedState() {
  return {
    users: [],
    teams: [],
    teamMembers: [],
    sessions: [],
    notifications: [],
    members: [],
    tasks: [],
  };
}

function extendState(state) {
  const extended = {
    ...emptyExtendedState(),
    ...state,
  };

  extended.users = Array.isArray(extended.users) ? extended.users.map(normalizeUser).filter((user) => user.email) : [];
  extended.teams = Array.isArray(extended.teams) ? extended.teams.map(normalizeTeam).filter((team) => team.name) : [];
  extended.teamMembers = Array.isArray(extended.teamMembers) ? extended.teamMembers.map(normalizeTeamMember) : [];
  extended.sessions = Array.isArray(extended.sessions) ? extended.sessions.map(normalizeSession) : [];
  extended.notifications = Array.isArray(extended.notifications) ? extended.notifications.map(normalizeNotification) : [];
  extended.members = Array.isArray(extended.members) ? extended.members.map(normalizeMember) : [];
  extended.tasks = Array.isArray(extended.tasks) ? extended.tasks.map(normalizeTaskForStorage) : [];
  return extended;
}

function makeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createInviteCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, "sha256").toString("hex");
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") {
    return false;
  }

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], "hex");
  const actual = pbkdf2Sync(String(password), salt, iterations, expected.length, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionExpiry() {
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  return expires.toISOString();
}

function parseCookies(request) {
  const cookies = {};
  const header = request.headers.cookie || "";
  for (const item of header.split(";")) {
    const [rawKey, ...rawValue] = item.trim().split("=");
    if (!rawKey) {
      continue;
    }
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
}

function createCookie(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  }

  return parts.join("; ");
}

function getClientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function enforceRateLimit(request, key, limit = 80, windowMs = 60_000) {
  const bucketKey = `${getClientIp(request)}:${key}`;
  const now = Date.now();
  const bucket = rateBuckets.get(bucketKey) || { count: 0, resetAt: now + windowMs };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);

  if (bucket.count > limit) {
    throw makeError(429, "Prea multe cereri. Incearca din nou putin mai tarziu.");
  }

  if (rateBuckets.size > 1000) {
    for (const [storedKey, storedBucket] of rateBuckets) {
      if (storedBucket.resetAt <= now) {
        rateBuckets.delete(storedKey);
      }
    }
  }
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    ...(process.env.NODE_ENV === "production" ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    ...extra,
  };
}

async function readState() {
  if (USE_DATABASE) {
    return readDatabaseState();
  }

  return readJsonState();
}

async function writeState(state) {
  if (USE_DATABASE) {
    await writeDatabaseState(state);
    return;
  }

  await writeJsonState(state);
}

async function readJsonState(seedIfMissing = true) {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return extendState({
      users: Array.isArray(parsed.users) ? parsed.users : [],
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      teamMembers: Array.isArray(parsed.teamMembers) ? parsed.teamMembers : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      members: Array.isArray(parsed.members) ? parsed.members.map(normalizeMember) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTaskForStorage) : [],
    });
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    if (!seedIfMissing) {
      throw error;
    }

    const seed = createSeedState();
    await writeJsonState(seed);
    return seed;
  }
}

async function writeJsonState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const extended = extendState(state);
  const sortedState = {
    users: extended.users.sort((a, b) => a.email.localeCompare(b.email)),
    teams: extended.teams.sort((a, b) => a.name.localeCompare(b.name)),
    teamMembers: extended.teamMembers.sort((a, b) => a.teamId.localeCompare(b.teamId) || a.userId.localeCompare(b.userId)),
    sessions: extended.sessions,
    notifications: extended.notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    members: extended.members.sort((a, b) => a.name.localeCompare(b.name)),
    tasks: sortTasksCalendar(extended.tasks),
  };
  await fs.writeFile(DATA_FILE, `${JSON.stringify(sortedState, null, 2)}\n`, "utf8");
}

function shouldUseSsl(connectionString) {
  if (process.env.PGSSLMODE === "disable") {
    return false;
  }

  try {
    const parsed = new URL(connectionString);
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return false;
    }
  } catch {
    return process.env.NODE_ENV === "production";
  }

  return process.env.NODE_ENV === "production" || process.env.RENDER === "true";
}

function getDatabasePool() {
  if (pgPool) {
    return pgPool;
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch (error) {
    throw new Error("Lipseste dependenta 'pg'. Ruleaza npm install sau redeploy pe Render.");
  }

  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    ssl: shouldUseSsl(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  });

  return pgPool;
}

async function ensureDatabase() {
  if (databaseReady) {
    return;
  }

  const pool = getDatabasePool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      owner_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (team_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_id TEXT,
      task_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_date DATE NOT NULL,
      deadline DATE NOT NULL,
      participants INTEGER NOT NULL DEFAULT 0 CHECK (participants >= 0),
      budget NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
      priority TEXT NOT NULL CHECK (priority IN ('critica', 'mare', 'medie', 'mica')),
      assignee TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('planificat', 'in-lucru', 'finalizat', 'blocat')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team_id TEXT;");
  await pool.query("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id TEXT;");

  await pool.query("CREATE INDEX IF NOT EXISTS idx_tasks_dates ON tasks (start_date, deadline);");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee);");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks (team_id);");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at);");

  const countResult = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM members) AS members,
      (SELECT COUNT(*)::int FROM tasks) AS tasks;
  `);

  const counts = countResult.rows[0] || { members: 0, tasks: 0 };
  if (counts.members === 0 && counts.tasks === 0) {
    let seed;
    try {
      seed = await readJsonState(false);
    } catch {
      seed = createSeedState();
    }
    await writeDatabaseState(seed, { skipEnsure: true });
  }

  databaseReady = true;
}

async function readDatabaseState() {
  await ensureDatabase();
  const pool = getDatabasePool();
  const [usersResult, teamsResult, teamMembersResult, sessionsResult, notificationsResult, membersResult, tasksResult] = await Promise.all([
    pool.query(`
      SELECT
        id,
        name,
        email,
        password_hash AS "passwordHash",
        created_at::text AS "createdAt"
      FROM users
      ORDER BY email ASC;
    `),
    pool.query(`
      SELECT
        id,
        name,
        invite_code AS "inviteCode",
        owner_id AS "ownerId",
        created_at::text AS "createdAt"
      FROM teams
      ORDER BY name ASC;
    `),
    pool.query(`
      SELECT
        team_id AS "teamId",
        user_id AS "userId",
        role,
        joined_at::text AS "joinedAt"
      FROM team_members;
    `),
    pool.query(`
      SELECT
        id,
        user_id AS "userId",
        token_hash AS "tokenHash",
        expires_at::text AS "expiresAt",
        created_at::text AS "createdAt"
      FROM sessions
      WHERE expires_at > NOW();
    `),
    pool.query(`
      SELECT
        id,
        team_id AS "teamId",
        user_id AS "userId",
        task_id AS "taskId",
        type,
        title,
        body,
        dedupe_key AS "dedupeKey",
        read_at::text AS "readAt",
        created_at::text AS "createdAt"
      FROM notifications
      ORDER BY created_at DESC;
    `),
    pool.query("SELECT id, name, role FROM members ORDER BY name ASC;"),
    pool.query(`
      SELECT
        id,
        team_id AS "teamId",
        title,
        description,
        start_date::text AS "startDate",
        deadline::text AS deadline,
        participants,
        budget::float AS budget,
        priority,
        assignee_id AS "assigneeId",
        assignee,
        status
      FROM tasks
      ORDER BY start_date ASC, deadline ASC, title ASC;
    `),
  ]);

  return extendState({
    users: usersResult.rows,
    teams: teamsResult.rows,
    teamMembers: teamMembersResult.rows,
    sessions: sessionsResult.rows,
    notifications: notificationsResult.rows,
    members: membersResult.rows.map(normalizeMember),
    tasks: tasksResult.rows.map(normalizeTaskForStorage),
  });
}

async function writeDatabaseState(state, options = {}) {
  if (!options.skipEnsure) {
    await ensureDatabase();
  }

  const pool = getDatabasePool();
  const client = await pool.connect();
  const extended = extendState(state);
  const users = extended.users.filter((user) => user.email);
  const teams = extended.teams.filter((team) => team.name);
  const teamMembers = extended.teamMembers;
  const sessions = extended.sessions.filter((session) => session.expiresAt > new Date().toISOString());
  const notifications = extended.notifications;
  const members = extended.members.filter((member) => member.name);
  const tasks = sortTasksCalendar(extended.tasks);

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM notifications;");
    await client.query("DELETE FROM sessions;");
    await client.query("DELETE FROM tasks;");
    await client.query("DELETE FROM team_members;");
    await client.query("DELETE FROM teams;");
    await client.query("DELETE FROM users;");
    await client.query("DELETE FROM members;");

    for (const user of users) {
      await client.query(
        `
          INSERT INTO users (id, name, email, password_hash, created_at)
          VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              email = EXCLUDED.email,
              password_hash = EXCLUDED.password_hash;
        `,
        [user.id, user.name, user.email, user.passwordHash, user.createdAt || null],
      );
    }

    for (const team of teams) {
      await client.query(
        `
          INSERT INTO teams (id, name, invite_code, owner_id, created_at)
          VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              invite_code = EXCLUDED.invite_code,
              owner_id = EXCLUDED.owner_id;
        `,
        [team.id, team.name, team.inviteCode, team.ownerId, team.createdAt || null],
      );
    }

    for (const member of teamMembers) {
      await client.query(
        `
          INSERT INTO team_members (team_id, user_id, role, joined_at)
          VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
          ON CONFLICT (team_id, user_id) DO UPDATE
          SET role = EXCLUDED.role;
        `,
        [member.teamId, member.userId, member.role, member.joinedAt || null],
      );
    }

    for (const session of sessions) {
      await client.query(
        `
          INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
          VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
          ON CONFLICT (id) DO UPDATE
          SET token_hash = EXCLUDED.token_hash,
              expires_at = EXCLUDED.expires_at;
        `,
        [session.id, session.userId, session.tokenHash, session.expiresAt, session.createdAt || null],
      );
    }

    for (const member of members) {
      await client.query(
        `
          INSERT INTO members (id, name, role)
          VALUES ($1, $2, $3)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              role = EXCLUDED.role;
        `,
        [member.id, member.name, member.role],
      );
    }

    for (const task of tasks) {
      await client.query(
        `
          INSERT INTO tasks (
            id,
            team_id,
            title,
            description,
            start_date,
            deadline,
            participants,
            budget,
            priority,
            assignee_id,
            assignee,
            status,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          ON CONFLICT (id) DO UPDATE
          SET team_id = EXCLUDED.team_id,
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              start_date = EXCLUDED.start_date,
              deadline = EXCLUDED.deadline,
              participants = EXCLUDED.participants,
              budget = EXCLUDED.budget,
              priority = EXCLUDED.priority,
              assignee_id = EXCLUDED.assignee_id,
              assignee = EXCLUDED.assignee,
              status = EXCLUDED.status,
              updated_at = NOW();
        `,
        [
          task.id,
          task.teamId,
          task.title,
          task.description,
          task.startDate,
          task.deadline,
          task.participants,
          task.budget,
          task.priority,
          task.assigneeId,
          task.assignee,
          task.status,
        ],
      );
    }

    for (const notification of notifications) {
      await client.query(
        `
          INSERT INTO notifications (
            id,
            team_id,
            user_id,
            task_id,
            type,
            title,
            body,
            dedupe_key,
            read_at,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, COALESCE($10::timestamptz, NOW()))
          ON CONFLICT (dedupe_key) DO UPDATE
          SET title = EXCLUDED.title,
              body = EXCLUDED.body,
              read_at = COALESCE(notifications.read_at, EXCLUDED.read_at);
        `,
        [
          notification.id,
          notification.teamId,
          notification.userId || null,
          notification.taskId || null,
          notification.type,
          notification.title,
          notification.body,
          notification.dedupeKey,
          notification.readAt || null,
          notification.createdAt || null,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeMember(member) {
  return {
    id: String(member.id || randomUUID()),
    name: String(member.name || "").trim(),
    role: String(member.role || "").trim(),
  };
}

function normalizeUser(user) {
  return {
    id: String(user.id || randomUUID()),
    name: String(user.name || "").trim(),
    email: normalizeEmail(user.email),
    passwordHash: String(user.passwordHash || user.password_hash || ""),
    createdAt: String(user.createdAt || user.created_at || new Date().toISOString()),
  };
}

function normalizeTeam(team) {
  return {
    id: String(team.id || randomUUID()),
    name: String(team.name || "Echipa noua").trim(),
    inviteCode: String(team.inviteCode || team.invite_code || createInviteCode()).trim().toUpperCase(),
    ownerId: String(team.ownerId || team.owner_id || ""),
    createdAt: String(team.createdAt || team.created_at || new Date().toISOString()),
  };
}

function normalizeTeamMember(member) {
  return {
    teamId: String(member.teamId || member.team_id || ""),
    userId: String(member.userId || member.user_id || ""),
    role: String(member.role || "member"),
    joinedAt: String(member.joinedAt || member.joined_at || new Date().toISOString()),
  };
}

function normalizeSession(session) {
  return {
    id: String(session.id || randomUUID()),
    userId: String(session.userId || session.user_id || ""),
    tokenHash: String(session.tokenHash || session.token_hash || ""),
    expiresAt: String(session.expiresAt || session.expires_at || getSessionExpiry()),
    createdAt: String(session.createdAt || session.created_at || new Date().toISOString()),
  };
}

function normalizeNotification(notification) {
  return {
    id: String(notification.id || randomUUID()),
    teamId: String(notification.teamId || notification.team_id || ""),
    userId: String(notification.userId || notification.user_id || ""),
    taskId: String(notification.taskId || notification.task_id || ""),
    type: String(notification.type || "info"),
    title: String(notification.title || "").trim(),
    body: String(notification.body || "").trim(),
    dedupeKey: String(notification.dedupeKey || notification.dedupe_key || randomUUID()),
    readAt: notification.readAt || notification.read_at ? String(notification.readAt || notification.read_at) : "",
    createdAt: String(notification.createdAt || notification.created_at || new Date().toISOString()),
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
    teamId: String(task.teamId || task.team_id || ""),
    title: String(task.title || "Task fara nume").trim(),
    description: String(task.description || "").trim(),
    startDate,
    deadline,
    participants: Math.max(0, Math.round(parseNumber(task.participants, 0))),
    budget: Math.max(0, parseNumber(task.budget, 0)),
    priority: PRIORITIES.includes(task.priority) ? task.priority : "medie",
    assigneeId: String(task.assigneeId || task.assignee_id || ""),
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
      && (!assignee || task.assigneeId === assignee || task.assignee === assignee)
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

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function getUserTeams(state, userId) {
  return state.teamMembers
    .filter((member) => member.userId === userId)
    .map((member) => {
      const team = state.teams.find((item) => item.id === member.teamId);
      if (!team) {
        return null;
      }
      return {
        id: team.id,
        name: team.name,
        inviteCode: team.inviteCode,
        role: member.role,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getTeamUsers(state, teamId) {
  return state.teamMembers
    .filter((member) => member.teamId === teamId)
    .map((member) => {
      const user = state.users.find((item) => item.id === member.userId);
      if (!user) {
        return null;
      }
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSessionFromRequest(state, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const now = new Date().toISOString();
  const session = state.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > now);
  if (!session) {
    return null;
  }

  const user = state.users.find((item) => item.id === session.userId);
  if (!user) {
    return null;
  }

  return { session, user };
}

function requireSession(state, request) {
  const context = getSessionFromRequest(state, request);
  if (!context) {
    throw makeError(401, "Trebuie sa fii autentificat.");
  }
  return context;
}

function getCurrentTeam(state, userId, request, url) {
  const teams = getUserTeams(state, userId);
  if (!teams.length) {
    throw makeError(403, "Nu esti membru in nicio echipa.");
  }

  const requestedTeamId = String(request.headers["x-team-id"] || url.searchParams.get("teamId") || "");
  if (!requestedTeamId) {
    return { team: teams[0], teams };
  }

  const team = teams.find((item) => item.id === requestedTeamId);
  if (!team) {
    throw makeError(403, "Nu ai acces la aceasta echipa.");
  }
  return { team, teams };
}

function serializeMe(state, user, activeTeamId = "") {
  const teams = getUserTeams(state, user.id);
  const activeTeam = teams.find((team) => team.id === activeTeamId) || teams[0] || null;
  return {
    user: publicUser(user),
    teams,
    activeTeam,
  };
}

function uniqueInviteCode(state) {
  let code = createInviteCode();
  while (state.teams.some((team) => team.inviteCode === code)) {
    code = createInviteCode();
  }
  return code;
}

function createTeamForUser(state, user, name) {
  const team = normalizeTeam({
    id: randomUUID(),
    name: String(name || `${user.name} - echipa`).trim(),
    inviteCode: uniqueInviteCode(state),
    ownerId: user.id,
  });
  state.teams.push(team);
  state.teamMembers.push(normalizeTeamMember({
    teamId: team.id,
    userId: user.id,
    role: "owner",
  }));

  return team;
}

function getAssigneeName(state, teamId, assigneeId, fallback = "") {
  if (!assigneeId) {
    return fallback;
  }
  const user = getTeamUsers(state, teamId).find((member) => member.id === assigneeId);
  return user ? user.name : fallback;
}

function prepareTaskForTeam(state, teamId, payload, existingTask = {}) {
  const task = validateTaskPayload({
    ...payload,
    id: existingTask.id || payload.id,
    teamId,
  }, existingTask);
  const assigneeId = String(payload.assigneeId || payload.assignee_id || task.assigneeId || "");
  const assignee = getAssigneeName(state, teamId, assigneeId, String(payload.assignee || task.assignee || ""));

  return {
    ...task,
    teamId,
    assigneeId,
    assignee,
  };
}

function addNotification(state, notification) {
  const item = normalizeNotification({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...notification,
  });
  if (!item.teamId || !item.title || !item.body || !item.dedupeKey) {
    return null;
  }
  if (state.notifications.some((existing) => existing.dedupeKey === item.dedupeKey)) {
    return null;
  }
  state.notifications.push(item);
  return item;
}

function notifyAssignee(state, task, previousAssigneeId = "") {
  if (!task.assigneeId || task.assigneeId === previousAssigneeId) {
    return;
  }

  addNotification(state, {
    teamId: task.teamId,
    userId: task.assigneeId,
    taskId: task.id,
    type: "assigned",
    title: "Task nou atribuit",
    body: `Ai primit taskul "${task.title}" cu deadline ${task.deadline}.`,
    dedupeKey: `assigned:${task.id}:${task.assigneeId}:${Date.now()}`,
  });
}

function notifyDeadlineStatus(state, task, oldStatus) {
  const today = toDateInput(new Date());
  if (task.deadline >= today || task.status === oldStatus) {
    return;
  }

  for (const member of getTeamUsers(state, task.teamId)) {
    addNotification(state, {
      teamId: task.teamId,
      userId: member.id,
      taskId: task.id,
      type: "deadline_status",
      title: "Status dupa deadline",
      body: `Taskul "${task.title}" este acum "${task.status}". Responsabil: ${task.assignee || "nealocat"}.`,
      dedupeKey: `deadline-status:${task.id}:${task.status}:${member.id}`,
    });
  }
}

function sweepNotifications(state) {
  const now = Date.now();
  if (now - lastNotificationSweep < 60_000) {
    return false;
  }
  lastNotificationSweep = now;

  const today = toDateInput(new Date());
  const tomorrow = toDateInput(addDays(new Date(), 1));

  for (const task of state.tasks) {
    if (!task.teamId || task.status === "finalizat") {
      continue;
    }

    if (task.deadline === tomorrow && task.assigneeId) {
      addNotification(state, {
        teamId: task.teamId,
        userId: task.assigneeId,
        taskId: task.id,
        type: "deadline_24h",
        title: "Deadline in 24 de ore",
        body: `Taskul "${task.title}" are deadline maine.`,
        dedupeKey: `deadline24:${task.id}:${task.deadline}:${task.assigneeId}`,
      });
    }

    if (task.deadline < today) {
      for (const member of getTeamUsers(state, task.teamId)) {
        addNotification(state, {
          teamId: task.teamId,
          userId: member.id,
          taskId: task.id,
          type: "overdue",
          title: "Task dupa deadline",
          body: `Taskul "${task.title}" este "${task.status}". Responsabil: ${task.assignee || "nealocat"}.`,
          dedupeKey: `overdue:${task.id}:${task.deadline}:${task.status}:${member.id}`,
        });
      }
    }
  }

  return true;
}

function fallbackSubtasks(payload) {
  const title = String(payload.title || "Task").trim() || "Task";
  const deadline = isIsoDate(payload.deadline) ? payload.deadline : toDateInput(addDays(new Date(), 7));
  const startDate = isIsoDate(payload.startDate) ? payload.startDate : toDateInput(new Date());
  return [
    {
      title: `Clarifica obiectivul pentru ${title}`,
      description: "Stabileste rezultatul asteptat, criteriile de finalizare si persoanele implicate.",
      startDate,
      deadline: startDate,
      priority: payload.priority || "medie",
      budget: 0,
    },
    {
      title: `Pregateste resursele pentru ${title}`,
      description: "Aduna informatiile, materialele, bugetul si dependintele necesare.",
      startDate,
      deadline,
      priority: payload.priority || "medie",
      budget: 0,
    },
    {
      title: `Executa si verifica ${title}`,
      description: "Imparte executia in pasi concreti, verifica progresul si marcheaza blocajele.",
      startDate,
      deadline,
      priority: payload.priority || "medie",
      budget: 0,
    },
  ];
}

function extractResponseText(responsePayload) {
  if (responsePayload.output_text) {
    return responsePayload.output_text;
  }

  const chunks = [];
  for (const item of responsePayload.output || []) {
    for (const content of item.content || []) {
      if (content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n");
}

async function generateAiSubtasks(payload) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "fallback",
      subtasks: fallbackSubtasks(payload),
    };
  }

  const prompt = {
    task: {
      title: payload.title,
      description: payload.description,
      startDate: payload.startDate,
      deadline: payload.deadline,
      priority: payload.priority,
      budget: payload.budget,
    },
    outputRules: "Returneaza strict JSON valid cu cheia subtasks. Maxim 6 subtaskuri. Fiecare subtask are title, description, startDate, deadline, priority, budget.",
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      instructions: "Esti un asistent de project management pentru organizare de evenimente. Imparti taskurile complexe in subtaskuri clare, scurte, actionabile si realiste. Raspunzi doar cu JSON valid.",
      input: JSON.stringify(prompt),
    }),
  });

  if (!response.ok) {
    return {
      provider: "fallback",
      subtasks: fallbackSubtasks(payload),
    };
  }

  const responsePayload = await response.json();
  const text = extractResponseText(responsePayload).trim();
  try {
    const parsed = JSON.parse(text);
    const subtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
    return {
      provider: "openai",
      subtasks: subtasks.slice(0, 6).map((subtask) => ({
        title: String(subtask.title || "Subtask").trim(),
        description: String(subtask.description || "").trim(),
        startDate: isIsoDate(subtask.startDate) ? subtask.startDate : payload.startDate,
        deadline: isIsoDate(subtask.deadline) ? subtask.deadline : payload.deadline,
        priority: PRIORITIES.includes(subtask.priority) ? subtask.priority : payload.priority,
        budget: Math.max(0, parseNumber(subtask.budget, 0)),
      })),
    };
  } catch {
    return {
      provider: "fallback",
      subtasks: fallbackSubtasks(payload),
    };
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

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response) {
  response.writeHead(204, securityHeaders({ "Cache-Control": "no-store" }));
  response.end();
}

async function handleApi(request, response, url) {
  const state = await readState();
  const path = url.pathname;
  const segments = url.pathname.split("/").filter(Boolean);
  const resource = segments[1];
  const id = segments[2];
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);

  enforceRateLimit(request, resource || "api", resource === "auth" ? 20 : 120);

  if (isMutation && request.headers["x-requested-with"] !== "VisionPlanner") {
    throw makeError(403, "Cerere respinsa.");
  }

  if (path === "/api/auth/register" && request.method === "POST") {
    const payload = await readJsonRequest(request);
    const name = String(payload.name || "").trim();
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");
    const teamName = String(payload.teamName || "").trim();
    const inviteCode = String(payload.inviteCode || "").trim().toUpperCase();

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
      throw makeError(400, "Completeaza nume, email valid si o parola de minimum 8 caractere.");
    }
    if (state.users.some((user) => user.email === email)) {
      throw makeError(409, "Exista deja un cont cu acest email.");
    }

    const hadUsers = state.users.length > 0;
    const user = normalizeUser({
      id: randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
    });
    state.users.push(user);

    let team;
    if (inviteCode) {
      team = state.teams.find((item) => item.inviteCode === inviteCode);
      if (!team) {
        throw makeError(404, "Codul de invitatie nu exista.");
      }
      state.teamMembers.push(normalizeTeamMember({ teamId: team.id, userId: user.id, role: "member" }));
    } else {
      team = createTeamForUser(state, user, teamName || `${name} Team`);
    }

    if (!hadUsers) {
      for (const task of state.tasks) {
        if (!task.teamId) {
          task.teamId = team.id;
        }
      }
    }

    const token = createSessionToken();
    state.sessions.push(normalizeSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: getSessionExpiry(),
    }));
    await writeState(state);
    sendJson(response, 201, serializeMe(state, user, team.id), {
      "Set-Cookie": createCookie(SESSION_COOKIE, token, { expires: getSessionExpiry() }),
    });
    return;
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const payload = await readJsonRequest(request);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");
    const user = state.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw makeError(401, "Email sau parola gresita.");
    }

    const token = createSessionToken();
    state.sessions = state.sessions.filter((session) => session.expiresAt > new Date().toISOString());
    state.sessions.push(normalizeSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: getSessionExpiry(),
    }));
    await writeState(state);
    sendJson(response, 200, serializeMe(state, user), {
      "Set-Cookie": createCookie(SESSION_COOKIE, token, { expires: getSessionExpiry() }),
    });
    return;
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    const context = getSessionFromRequest(state, request);
    if (context) {
      state.sessions = state.sessions.filter((session) => session.id !== context.session.id);
      await writeState(state);
    }
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": createCookie(SESSION_COOKIE, "", { maxAge: 0 }),
    });
    return;
  }

  if (path === "/api/me" && request.method === "GET") {
    const { user } = requireSession(state, request);
    const activeTeamId = String(request.headers["x-team-id"] || url.searchParams.get("teamId") || "");
    sendJson(response, 200, serializeMe(state, user, activeTeamId));
    return;
  }

  const { user } = requireSession(state, request);
  const { team, teams } = getCurrentTeam(state, user.id, request, url);

  if (sweepNotifications(state)) {
    await writeState(state);
  }

  if (resource === "teams") {
    if (request.method === "GET" && !id) {
      sendJson(response, 200, { teams, activeTeam: team });
      return;
    }

    if (request.method === "POST" && !id) {
      const payload = await readJsonRequest(request);
      const newTeam = createTeamForUser(state, user, payload.name);
      await writeState(state);
      sendJson(response, 201, { team: newTeam, teams: getUserTeams(state, user.id) });
      return;
    }

    if (id === "join" && request.method === "POST") {
      const payload = await readJsonRequest(request);
      const inviteCode = String(payload.inviteCode || "").trim().toUpperCase();
      const joinedTeam = state.teams.find((item) => item.inviteCode === inviteCode);
      if (!joinedTeam) {
        throw makeError(404, "Codul de invitatie nu exista.");
      }
      const exists = state.teamMembers.some((member) => member.teamId === joinedTeam.id && member.userId === user.id);
      if (!exists) {
        state.teamMembers.push(normalizeTeamMember({ teamId: joinedTeam.id, userId: user.id, role: "member" }));
        addNotification(state, {
          teamId: joinedTeam.id,
          userId: joinedTeam.ownerId,
          type: "team_join",
          title: "Membru nou in echipa",
          body: `${user.name} s-a alaturat echipei "${joinedTeam.name}".`,
          dedupeKey: `team-join:${joinedTeam.id}:${user.id}`,
        });
      }
      await writeState(state);
      sendJson(response, 200, { team: joinedTeam, teams: getUserTeams(state, user.id) });
      return;
    }

    if (id === team.id && request.method === "PATCH") {
      const payload = await readJsonRequest(request);
      const name = String(payload.name || "").trim();
      if (!name) {
        throw makeError(400, "Numele echipei este obligatoriu.");
      }
      const storedTeam = state.teams.find((item) => item.id === team.id);
      storedTeam.name = name;
      await writeState(state);
      sendJson(response, 200, { team: storedTeam, teams: getUserTeams(state, user.id) });
      return;
    }
  }

  if (resource === "tasks") {
    const teamTasks = state.tasks.filter((task) => task.teamId === team.id);

    if (request.method === "GET" && !id) {
      sendJson(response, 200, {
        tasks: applyTaskFilters(teamTasks, url.searchParams),
        summary: createSummary(teamTasks, String(url.searchParams.get("month") || getCurrentMonth())),
      });
      return;
    }

    if (request.method === "POST" && !id) {
      const payload = await readJsonRequest(request);
      const task = prepareTaskForTeam(state, team.id, { ...payload, id: randomUUID() });
      state.tasks.push(task);
      notifyAssignee(state, task);
      await writeState(state);
      sendJson(response, 201, { task });
      return;
    }

    const taskIndex = state.tasks.findIndex((task) => task.id === id && task.teamId === team.id);
    if (taskIndex === -1) {
      throw makeError(404, "Taskul nu a fost gasit.");
    }

    if (request.method === "GET") {
      sendJson(response, 200, { task: state.tasks[taskIndex] });
      return;
    }

    if (request.method === "PUT") {
      const payload = await readJsonRequest(request);
      const previous = state.tasks[taskIndex];
      const task = prepareTaskForTeam(state, team.id, payload, previous);
      state.tasks[taskIndex] = task;
      notifyAssignee(state, task, previous.assigneeId);
      notifyDeadlineStatus(state, task, previous.status);
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
      sendJson(response, 200, { members: getTeamUsers(state, team.id) });
      return;
    }

    if (request.method === "POST" && !id) {
      throw makeError(400, "Membrii reali se adauga prin codul de invitatie al echipei.");
      return;
    }

    if (request.method === "DELETE" && id) {
      const membership = state.teamMembers.find((item) => item.teamId === team.id && item.userId === id);
      if (!membership) {
        throw makeError(404, "Membrul nu a fost gasit.");
      }
      if (membership.role === "owner") {
        throw makeError(400, "Ownerul echipei nu poate fi scos.");
      }
      state.teamMembers = state.teamMembers.filter((item) => !(item.teamId === team.id && item.userId === id));
      for (const task of state.tasks) {
        if (task.teamId === team.id && task.assigneeId === id) {
          task.assigneeId = "";
          task.assignee = "";
        }
      }
      await writeState(state);
      sendNoContent(response);
      return;
    }
  }

  if (resource === "summary" && request.method === "GET") {
    const teamTasks = state.tasks.filter((task) => task.teamId === team.id);
    sendJson(response, 200, {
      summary: createSummary(teamTasks, String(url.searchParams.get("month") || getCurrentMonth())),
    });
    return;
  }

  if (resource === "notifications") {
    if (request.method === "GET" && !id) {
      const notifications = state.notifications
        .filter((notification) => notification.teamId === team.id && (!notification.userId || notification.userId === user.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 80);
      sendJson(response, 200, {
        notifications,
        unreadCount: notifications.filter((notification) => !notification.readAt).length,
      });
      return;
    }

    if (id === "read-all" && request.method === "POST") {
      const now = new Date().toISOString();
      for (const notification of state.notifications) {
        if (notification.teamId === team.id && (!notification.userId || notification.userId === user.id)) {
          notification.readAt = notification.readAt || now;
        }
      }
      await writeState(state);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (id && request.method === "POST") {
      const notification = state.notifications.find((item) => item.id === id && item.teamId === team.id && (!item.userId || item.userId === user.id));
      if (!notification) {
        throw makeError(404, "Notificarea nu a fost gasita.");
      }
      notification.readAt = new Date().toISOString();
      await writeState(state);
      sendJson(response, 200, { notification });
      return;
    }
  }

  if (resource === "ai" && id === "subtasks" && request.method === "POST") {
    const payload = await readJsonRequest(request);
    const task = normalizeTaskForStorage({
      title: payload.title,
      description: payload.description,
      startDate: payload.startDate,
      deadline: payload.deadline,
      priority: payload.priority,
      budget: payload.budget,
      teamId: team.id,
    });
    if (!task.title || task.title === "Task fara nume") {
      throw makeError(400, "Ai nevoie de un titlu pentru task.");
    }
    const result = await generateAiSubtasks(task);
    sendJson(response, 200, result);
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
      ...securityHeaders({
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
        "Cache-Control": "no-cache",
      }),
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      const indexPath = path.join(PUBLIC_DIR, "index.html");
      const body = await fs.readFile(indexPath);
      response.writeHead(200, {
        ...securityHeaders({
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        }),
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
~~~~

## package.json

~~~~json
{
  "name": "vision-planner",
  "version": "1.0.0",
  "private": true,
  "description": "Organizator de evenimente cu Gantt, calendar, echipa, prioritati si bugete.",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "check": "node --check server.js && node --check public/app.js && node --check scripts/generate-icons.js",
    "generate:icons": "node scripts/generate-icons.js"
  },
  "dependencies": {
    "pg": "^8.16.0"
  },
  "engines": {
    "node": ">=20"
  }
}
~~~~

## render.yaml

~~~~yaml
databases:
  - name: vision-planner-db
    plan: free
    databaseName: vision_planner
    user: vision_planner

services:
  - type: web
    name: vision-planner
    runtime: node
    plan: free
    buildCommand: npm install --omit=dev
    startCommand: npm start
    healthCheckPath: /healthz
    autoDeploy: true
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        fromDatabase:
          name: vision-planner-db
          property: connectionString
~~~~

## public/index.html

~~~~html
<!doctype html>
<html lang="ro">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#101820">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Vision Planner">
    <title>Vision Planner</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="stylesheet" href="/styles.css?v=4">
  </head>
  <body>
    <section id="authScreen" class="auth-screen">
      <div class="auth-panel">
        <div class="auth-brand">
          <span class="brand-mark" aria-hidden="true">VP</span>
          <div>
            <h1>Vision Planner</h1>
            <p>Conturi, echipe si planificare colaborativa</p>
          </div>
        </div>

        <div class="auth-tabs" role="tablist" aria-label="Autentificare">
          <button id="loginTab" class="tab-button is-active" type="button">Login</button>
          <button id="registerTab" class="tab-button" type="button">Cont nou</button>
        </div>

        <div id="authMessage" class="message" aria-live="polite"></div>

        <form id="loginForm" class="auth-form">
          <label>
            <span>Email</span>
            <input id="loginEmailInput" type="email" autocomplete="email" required>
          </label>
          <label>
            <span>Parola</span>
            <input id="loginPasswordInput" type="password" autocomplete="current-password" required>
          </label>
          <button class="primary-button" type="submit">Intra in cont</button>
        </form>

        <form id="registerForm" class="auth-form is-hidden">
          <label>
            <span>Nume</span>
            <input id="registerNameInput" type="text" autocomplete="name" required>
          </label>
          <label>
            <span>Email</span>
            <input id="registerEmailInput" type="email" autocomplete="email" required>
          </label>
          <label>
            <span>Parola</span>
            <input id="registerPasswordInput" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <label>
            <span>Numele echipei</span>
            <input id="registerTeamInput" type="text" placeholder="ex. Echipa InfoEducatie">
          </label>
          <label>
            <span>Cod invitatie</span>
            <input id="registerInviteInput" type="text" placeholder="optional">
          </label>
          <button class="primary-button" type="submit">Creeaza cont</button>
        </form>
      </div>
    </section>

    <div id="appShell" class="app-shell is-hidden">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">VP</span>
          <div>
            <h1>Vision Planner</h1>
            <p id="rangeLabel">Calendar</p>
          </div>
        </div>

        <div class="top-actions">
          <label class="compact-field team-switcher">
            <span>Echipa</span>
            <select id="teamSelect"></select>
          </label>

          <label class="search-field">
            <span class="sr-only">Cautare</span>
            <input id="searchInput" type="search" placeholder="Cauta task, membru, detaliu">
          </label>

          <label class="compact-field">
            <span>Prioritate</span>
            <select id="priorityFilter">
              <option value="">Toate</option>
              <option value="critica">Critica</option>
              <option value="mare">Mare</option>
              <option value="medie">Medie</option>
              <option value="mica">Mica</option>
            </select>
          </label>

          <label class="compact-field">
            <span>Responsabil</span>
            <select id="memberFilter">
              <option value="">Toti</option>
            </select>
          </label>

          <div class="segmented" role="tablist" aria-label="Vizualizare">
            <button class="tab-button is-active" type="button" data-view="gantt">Gantt</button>
            <button class="tab-button" type="button" data-view="calendar">Calendar</button>
            <button class="tab-button" type="button" data-view="team">Echipa</button>
          </div>

          <button id="installButton" class="secondary-button install-button" type="button" hidden>Instaleaza</button>
          <button id="notificationButton" class="secondary-button notification-button" type="button">Notificari <span id="notificationCount">0</span></button>
          <button id="logoutButton" class="secondary-button" type="button">Logout</button>
          <button id="newTaskButton" class="primary-button" type="button">Task nou</button>
        </div>
      </header>

      <main class="workspace-layout">
        <aside class="editor-panel">
          <form id="taskForm" class="task-form">
            <div class="form-head">
              <div>
                <h2 id="formTitle">Task nou</h2>
                <p id="formMode">Planificare</p>
              </div>
              <button id="clearSelectionButton" class="icon-button" type="button" title="Curata selectia" aria-label="Curata selectia">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12"></path>
                </svg>
              </button>
            </div>

            <input id="taskId" type="hidden">

            <label>
              <span>Titlu</span>
              <input id="titleInput" name="title" type="text" required maxlength="80">
            </label>

            <div class="form-grid">
              <label>
                <span>Start</span>
                <input id="startInput" name="startDate" type="date" required>
              </label>
              <label>
                <span>Deadline</span>
                <input id="deadlineInput" name="deadline" type="date" required>
              </label>
            </div>

            <div class="form-grid">
              <label>
                <span>Prioritate</span>
                <select id="priorityInput" name="priority">
                  <option value="critica">Critica</option>
                  <option value="mare">Mare</option>
                  <option value="medie">Medie</option>
                  <option value="mica">Mica</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select id="statusInput" name="status">
                  <option value="planificat">Planificat</option>
                  <option value="in-lucru">In lucru</option>
                  <option value="finalizat">Finalizat</option>
                  <option value="blocat">Blocat</option>
                </select>
              </label>
            </div>

            <label>
              <span>Responsabil</span>
              <select id="assigneeInput" name="assignee">
                <option value="">Nealocat</option>
              </select>
            </label>

            <div class="form-grid">
              <label>
                <span>Membri</span>
                <input id="participantsInput" name="participants" type="number" min="0" step="1">
              </label>
              <label>
                <span>Buget</span>
                <input id="budgetInput" name="budget" type="number" min="0" step="50">
              </label>
            </div>

            <label>
              <span>Detalii</span>
              <textarea id="descriptionInput" name="description" rows="4"></textarea>
            </label>

            <div class="form-actions">
              <button class="primary-button" type="submit">Salveaza</button>
              <button id="aiButton" class="secondary-button" type="button">AI</button>
              <button id="deleteTaskButton" class="danger-button" type="button">Sterge</button>
            </div>
          </form>

          <section id="aiPanel" class="ai-panel is-hidden">
            <div class="form-head">
              <div>
                <h2>AI subtaskuri</h2>
                <p id="aiProvider">Asistent planificare</p>
              </div>
            </div>
            <div id="aiResults" class="ai-results"></div>
            <button id="createAiTasksButton" class="secondary-button" type="button" disabled>Creeaza subtaskurile</button>
          </section>

          <section class="team-editor">
            <h2>Echipa</h2>
            <form id="teamForm" class="member-form">
              <label>
                <span>Nume echipa</span>
                <input id="teamNameInput" type="text" maxlength="80">
              </label>
              <button class="secondary-button" type="submit">Salveaza nume</button>
            </form>
            <div class="invite-box">
              <span>Cod invitatie</span>
              <strong id="inviteCodeText">-</strong>
              <button id="copyInviteButton" class="secondary-button" type="button">Copiaza</button>
            </div>
            <form id="joinTeamForm" class="member-form">
              <label>
                <span>Alatura-te unei echipe</span>
                <input id="joinCodeInput" type="text" maxlength="20" placeholder="Cod invitatie">
              </label>
              <button class="secondary-button" type="submit">Intra in echipa</button>
            </form>
          </section>
        </aside>

        <section class="main-panel">
          <div id="message" class="message" aria-live="polite"></div>

          <section id="summaryStrip" class="summary-strip" aria-label="Rezumat"></section>

          <section id="ganttView" class="view-panel is-visible">
            <div class="panel-toolbar">
              <div>
                <h2>Planificare Gantt</h2>
                <p id="ganttCount">0 taskuri</p>
              </div>
              <div class="panel-tools">
                <label class="compact-field">
                  <span>Luna</span>
                  <input id="monthInput" type="month">
                </label>
                <label class="compact-field">
                  <span>Sortare</span>
                  <select id="sortInput">
                    <option value="calendar">Calendar</option>
                    <option value="priority">Prioritate</option>
                    <option value="budget">Buget</option>
                    <option value="participants">Membri</option>
                  </select>
                </label>
              </div>
            </div>
            <div id="ganttChart" class="gantt-chart" aria-label="Gantt"></div>
          </section>

          <section id="calendarView" class="view-panel">
            <div class="panel-toolbar">
              <div>
                <h2>Calendar deadlineuri</h2>
                <p id="calendarCount">0 intrari</p>
              </div>
            </div>
            <div id="calendarGrid" class="calendar-grid" aria-label="Calendar"></div>
          </section>

          <section id="teamView" class="view-panel">
            <div class="panel-toolbar">
              <div>
                <h2>Alocare echipa</h2>
                <p id="teamCount">0 membri</p>
              </div>
            </div>
            <div id="teamBoard" class="team-board" aria-label="Echipa"></div>
          </section>
        </section>
      </main>

      <aside id="notificationPanel" class="notification-panel is-hidden">
        <div class="notification-head">
          <h2>Notificari</h2>
          <button id="markAllReadButton" class="secondary-button" type="button">Citite</button>
        </div>
        <div id="notificationList" class="notification-list"></div>
      </aside>
    </div>

    <script src="/app.js?v=4" defer></script>
  </body>
</html>
~~~~

## public/app.js

~~~~javascript
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
~~~~

## public/styles.css

~~~~css
:root {
  color-scheme: light;
  --bg: #f6f7f3;
  --surface: #ffffff;
  --surface-2: #eef2f4;
  --ink: #1b1f23;
  --muted: #64707d;
  --line: #d9e0e4;
  --line-strong: #b9c5cc;
  --accent: #1f7a5a;
  --accent-strong: #155d44;
  --blue: #2563eb;
  --amber: #c77800;
  --red: #c24134;
  --teal: #0f766e;
  --shadow: 0 18px 44px rgba(27, 31, 35, 0.08);
  --radius: 8px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: var(--bg);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.app-shell {
  min-height: 100vh;
}

.is-hidden {
  display: none !important;
}

.auth-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #101820;
}

.auth-panel {
  display: grid;
  gap: 16px;
  width: min(460px, 100%);
  padding: 22px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.auth-brand h1,
.auth-brand p {
  margin: 0;
}

.auth-brand h1 {
  font-size: 1.3rem;
}

.auth-brand p {
  color: var(--muted);
  font-size: 0.88rem;
}

.auth-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.auth-tabs .tab-button {
  color: var(--muted);
  border-right-color: var(--line);
}

.auth-tabs .tab-button.is-active {
  background: #101820;
  color: #ffffff;
}

.auth-form {
  display: grid;
  gap: 12px;
}

.auth-form label {
  display: grid;
  gap: 6px;
}

.auth-form label span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.auth-form input {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 11px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  background: #101820;
  color: #ffffff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 210px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  background: #e9b44c;
  color: #101820;
  font-weight: 900;
}

.brand h1,
.brand p,
.panel-toolbar h2,
.panel-toolbar p,
.form-head h2,
.form-head p,
.team-editor h2 {
  margin: 0;
}

.brand h1 {
  font-size: 1.1rem;
  line-height: 1.1;
}

.brand p,
.panel-toolbar p,
.form-head p {
  color: var(--muted);
  font-size: 0.85rem;
}

.topbar .brand p {
  color: rgba(255, 255, 255, 0.66);
}

.top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: 1;
  flex-wrap: wrap;
}

.team-switcher {
  min-width: 190px;
}

.search-field input,
.compact-field input,
.compact-field select,
.task-form input,
.task-form select,
.task-form textarea,
.member-form input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;
  color: var(--ink);
  outline: none;
  min-height: 40px;
  padding: 9px 11px;
}

.topbar input,
.topbar select {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.topbar input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.topbar .secondary-button {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.18);
}

.install-button[hidden] {
  display: none;
}

.topbar select option {
  color: var(--ink);
}

.search-field {
  min-width: min(340px, 100%);
}

.compact-field {
  display: grid;
  gap: 4px;
  min-width: 132px;
}

.compact-field span,
.task-form label span,
.member-form label span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.topbar .compact-field span {
  color: rgba(255, 255, 255, 0.7);
}

.segmented {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.tab-button {
  min-height: 40px;
  padding: 0 14px;
  border: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.76);
  font-weight: 800;
}

.tab-button:last-child {
  border-right: 0;
}

.tab-button.is-active {
  background: #ffffff;
  color: #101820;
}

.primary-button,
.secondary-button,
.danger-button,
.icon-button {
  border-radius: 8px;
  min-height: 40px;
  border: 1px solid transparent;
  font-weight: 800;
}

.primary-button {
  background: var(--accent);
  color: #ffffff;
  padding: 0 16px;
}

.primary-button:hover {
  background: var(--accent-strong);
}

.secondary-button {
  background: #ffffff;
  color: var(--ink);
  border-color: var(--line);
  padding: 0 14px;
}

.danger-button {
  background: #fff2ee;
  color: var(--red);
  border-color: #f0c5bb;
  padding: 0 14px;
}

.icon-button {
  display: grid;
  place-items: center;
  width: 40px;
  padding: 0;
  background: #ffffff;
  color: var(--muted);
  border-color: var(--line);
}

.icon-button svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.workspace-layout {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  min-height: calc(100vh - 79px);
}

.editor-panel {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 18px;
  background: #ffffff;
  border-right: 1px solid var(--line);
}

.task-form,
.team-editor {
  display: grid;
  gap: 14px;
}

.form-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.form-head h2,
.team-editor h2 {
  font-size: 1rem;
}

.task-form label,
.member-form label {
  display: grid;
  gap: 6px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.task-form textarea {
  resize: vertical;
  min-height: 96px;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.form-actions .primary-button {
  flex: 1;
}

.team-editor {
  border-top: 1px solid var(--line);
  padding-top: 18px;
}

.member-form,
.ai-panel {
  display: grid;
  gap: 10px;
}

.invite-box {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfc;
}

.invite-box span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.invite-box strong {
  font-size: 1.15rem;
  letter-spacing: 0;
}

.ai-panel {
  border-top: 1px solid var(--line);
  padding-top: 18px;
}

.ai-results {
  display: grid;
  gap: 8px;
}

.ai-result {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfc;
}

.ai-result strong,
.ai-result span,
.ai-result small {
  overflow-wrap: anywhere;
}

.ai-result span,
.ai-result small {
  color: var(--muted);
  font-size: 0.78rem;
}

.main-panel {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
  padding: 18px;
}

.message {
  display: none;
  border-radius: 8px;
  padding: 11px 14px;
  background: #e7f4ed;
  color: #155d44;
  border: 1px solid #b8ddc9;
  font-weight: 700;
}

.message.is-error {
  display: block;
  background: #fff2ee;
  color: var(--red);
  border-color: #f0c5bb;
}

.message.is-visible {
  display: block;
}

.notification-button span {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  margin-left: 6px;
  border-radius: 999px;
  background: #e9b44c;
  color: #101820;
  font-size: 0.75rem;
}

.notification-panel {
  position: fixed;
  top: 92px;
  right: 18px;
  z-index: 20;
  display: grid;
  gap: 12px;
  width: min(420px, calc(100vw - 28px));
  max-height: calc(100vh - 120px);
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: var(--shadow);
}

.notification-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.notification-head h2 {
  margin: 0;
  font-size: 1rem;
}

.notification-list {
  display: grid;
  gap: 8px;
}

.notification-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--line);
  border-left: 5px solid var(--line-strong);
  border-radius: 8px;
  background: #ffffff;
  text-align: left;
}

.notification-item.is-unread {
  border-left-color: var(--accent);
  background: #f1fbf6;
}

.notification-item span,
.notification-item small,
.notification-empty {
  color: var(--muted);
  font-size: 0.78rem;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(130px, 1fr));
  gap: 10px;
}

.summary-tile {
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  box-shadow: var(--shadow);
}

.summary-tile span {
  display: block;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.summary-tile strong {
  display: block;
  margin-top: 5px;
  font-size: 1.35rem;
  line-height: 1;
}

.view-panel {
  display: none;
  min-width: 0;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.view-panel.is-visible {
  display: block;
}

.panel-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--line);
}

.panel-toolbar h2 {
  font-size: 1rem;
}

.panel-tools {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.gantt-chart {
  overflow: auto;
  padding: 0 0 12px;
}

.gantt-empty,
.calendar-empty,
.team-empty {
  padding: 34px 16px;
  color: var(--muted);
  text-align: center;
  font-weight: 800;
}

.gantt-grid {
  min-width: 780px;
}

.gantt-row,
.gantt-header {
  display: grid;
  grid-auto-rows: minmax(44px, auto);
  align-items: stretch;
}

.gantt-header {
  position: sticky;
  top: 0;
  z-index: 4;
  background: #ffffff;
  border-bottom: 1px solid var(--line);
}

.gantt-corner,
.gantt-day,
.gantt-label,
.gantt-cell {
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.gantt-corner,
.gantt-label {
  position: sticky;
  left: 0;
  z-index: 3;
  background: #ffffff;
}

.gantt-corner {
  display: flex;
  align-items: center;
  padding: 0 14px;
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 900;
}

.gantt-day {
  display: grid;
  place-items: center;
  min-width: 36px;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 800;
  padding: 6px 2px;
  text-align: center;
}

.gantt-day.is-weekend,
.gantt-cell.is-weekend {
  background: #f4f6f7;
}

.gantt-label {
  display: grid;
  align-content: center;
  gap: 3px;
  padding: 8px 12px;
}

.gantt-label strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 0.88rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gantt-label span {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gantt-track {
  display: grid;
  grid-column: 2 / -1;
  grid-row: 1;
}

.gantt-cell {
  min-height: 52px;
}

.gantt-bar {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  align-self: center;
  min-height: 30px;
  margin: 0 4px;
  border: 0;
  border-radius: 8px;
  color: #ffffff;
  text-align: left;
  padding: 0 10px;
  overflow: hidden;
  box-shadow: 0 8px 18px rgba(27, 31, 35, 0.18);
}

.gantt-bar.is-compact {
  justify-content: center;
  min-width: 30px;
  padding: 0;
  text-align: center;
}

.gantt-bar span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 900;
}

.gantt-bar.is-compact span {
  font-size: 0.72rem;
  line-height: 1;
}

.gantt-bar.is-selected {
  outline: 3px solid rgba(31, 122, 90, 0.32);
  outline-offset: 2px;
}

.priority-critica {
  background: var(--red);
}

.priority-mare {
  background: var(--amber);
}

.priority-medie {
  background: var(--blue);
}

.priority-mica {
  background: var(--teal);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(110px, 1fr));
  gap: 1px;
  background: var(--line);
  border-radius: 0 0 8px 8px;
  overflow: hidden;
}

.calendar-weekday,
.calendar-day {
  background: #ffffff;
}

.calendar-weekday {
  padding: 10px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 900;
  text-align: center;
}

.calendar-day {
  min-height: 132px;
  padding: 9px;
  display: grid;
  align-content: start;
  gap: 7px;
}

.calendar-day.is-outside {
  background: #f7f8f9;
}

.calendar-date {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 900;
}

.calendar-date .today {
  color: var(--accent);
}

.calendar-chip,
.team-task {
  border: 1px solid var(--line);
  border-left-width: 5px;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px;
  text-align: left;
  width: 100%;
}

.calendar-chip strong,
.team-task strong {
  display: block;
  color: var(--ink);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.calendar-chip span,
.team-task span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.calendar-chip.priority-critica,
.team-task.priority-critica {
  border-left-color: var(--red);
  background: #fff7f5;
}

.calendar-chip.priority-mare,
.team-task.priority-mare {
  border-left-color: var(--amber);
  background: #fff9ed;
}

.calendar-chip.priority-medie,
.team-task.priority-medie {
  border-left-color: var(--blue);
  background: #f2f6ff;
}

.calendar-chip.priority-mica,
.team-task.priority-mica {
  border-left-color: var(--teal);
  background: #effafa;
}

.team-board {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  padding: 16px;
}

.member-column {
  display: grid;
  align-content: start;
  gap: 10px;
  min-height: 180px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfc;
  padding: 12px;
}

.member-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.member-head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.member-head p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.member-budget {
  color: var(--accent-strong);
  font-size: 0.78rem;
  font-weight: 900;
  white-space: nowrap;
}

@media (max-width: 1120px) {
  .topbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .top-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .workspace-layout {
    grid-template-columns: 1fr;
  }

  .editor-panel {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 720px) {
  .topbar,
  .main-panel,
  .editor-panel {
    padding: 14px;
  }

  .top-actions,
  .form-actions,
  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .search-field,
  .compact-field,
  .primary-button,
  .danger-button,
  .secondary-button,
  .segmented,
  .panel-tools {
    width: 100%;
  }

  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .tab-button {
    border-right: 1px solid rgba(255, 255, 255, 0.12);
  }

  .summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .calendar-grid {
    grid-template-columns: repeat(7, minmax(92px, 1fr));
    overflow-x: auto;
  }
}

@media (max-width: 480px) {
  .form-grid,
  .summary-strip {
    grid-template-columns: 1fr;
  }
}
~~~~

## public/sw.js

~~~~javascript
const CACHE_NAME = "vision-planner-v4";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=4",
  "/app.js?v=4",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/index.html")),
    );
    return;
  }

  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return caches.match(event.request);
      }
    }),
  );
});
~~~~

## public/manifest.webmanifest

~~~~json
{
  "name": "Vision Planner",
  "short_name": "Vision",
  "description": "Planificator de evenimente cu Gantt, calendar, echipa, prioritati si bugete.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#f6f7f3",
  "theme_color": "#101820",
  "categories": ["productivity", "business", "utilities"],
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/maskable-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
~~~~

## public/icons/icon.svg

~~~~xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#101820"/>
  <rect x="64" y="64" width="384" height="384" rx="84" fill="#e9b44c"/>
  <path d="M138 154h52l64 190 64-190h52L280 386h-52L138 154Z" fill="#101820"/>
  <path d="M314 154h64c54 0 88 30 88 78s-34 78-88 78h-20v76h-44V154Zm44 40v76h20c28 0 43-14 43-38s-15-38-43-38h-20Z" fill="#101820"/>
</svg>
~~~~

## scripts/generate-icons.js

~~~~javascript
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "icons");

const COLORS = {
  background: [16, 24, 32, 255],
  gold: [233, 180, 76, 255],
  ink: [16, 24, 32, 255],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function setPixel(buffer, size, x, y, color) {
  if (x < 0 || x >= size || y < 0 || y >= size) {
    return;
  }

  const index = (y * size + x) * 4;
  buffer[index] = color[0];
  buffer[index + 1] = color[1];
  buffer[index + 2] = color[2];
  buffer[index + 3] = color[3];
}

function fillRect(buffer, size, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPixel(buffer, size, col, row, color);
    }
  }
}

function fillRoundedRect(buffer, size, x, y, width, height, radius, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const left = col < x + radius;
      const right = col >= x + width - radius;
      const top = row < y + radius;
      const bottom = row >= y + height - radius;

      if ((left || right) && (top || bottom)) {
        const cx = left ? x + radius : x + width - radius - 1;
        const cy = top ? y + radius : y + height - radius - 1;
        const dx = col - cx;
        const dy = row - cy;
        if (dx * dx + dy * dy > radius * radius) {
          continue;
        }
      }

      setPixel(buffer, size, col, row, color);
    }
  }
}

function drawThickLine(buffer, size, x1, y1, x2, y2, thickness, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const radius = Math.floor(thickness / 2);

  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + (dx * step) / steps);
    const y = Math.round(y1 + (dy * step) / steps);
    fillRect(buffer, size, x - radius, y - radius, thickness, thickness, color);
  }
}

function drawIcon(size, maskable = false) {
  const pixels = Buffer.alloc(size * size * 4);
  fillRect(pixels, size, 0, 0, size, size, COLORS.background);

  const pad = Math.round(size * (maskable ? 0.16 : 0.12));
  fillRoundedRect(
    pixels,
    size,
    pad,
    pad,
    size - pad * 2,
    size - pad * 2,
    Math.round(size * 0.16),
    COLORS.gold,
  );

  const stroke = Math.max(10, Math.round(size * 0.065));
  drawThickLine(pixels, size, Math.round(size * 0.29), Math.round(size * 0.32), Math.round(size * 0.42), Math.round(size * 0.71), stroke, COLORS.ink);
  drawThickLine(pixels, size, Math.round(size * 0.56), Math.round(size * 0.32), Math.round(size * 0.42), Math.round(size * 0.71), stroke, COLORS.ink);

  const pX = Math.round(size * 0.59);
  const pY = Math.round(size * 0.31);
  const pW = Math.round(size * 0.19);
  const pH = Math.round(size * 0.42);
  const bar = Math.round(size * 0.055);
  fillRect(pixels, size, pX, pY, bar, pH, COLORS.ink);
  fillRect(pixels, size, pX, pY, pW, bar, COLORS.ink);
  fillRect(pixels, size, pX, pY + Math.round(size * 0.2), pW, bar, COLORS.ink);
  fillRect(pixels, size, pX + pW - bar, pY, bar, Math.round(size * 0.25), COLORS.ink);

  return encodePng(size, size, pixels);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(OUT_DIR, "icon-192.png"), drawIcon(192)),
    fs.writeFile(path.join(OUT_DIR, "icon-512.png"), drawIcon(512)),
    fs.writeFile(path.join(OUT_DIR, "maskable-192.png"), drawIcon(192, true)),
    fs.writeFile(path.join(OUT_DIR, "maskable-512.png"), drawIcon(512, true)),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
~~~~

## data/events.json

~~~~json
{
  "members": [
    {
      "id": "member-andrei",
      "name": "Andrei Ionescu",
      "role": "Logistica"
    },
    {
      "id": "member-ioana",
      "name": "Ioana Pop",
      "role": "Coordonare"
    },
    {
      "id": "member-mara",
      "name": "Mara Stan",
      "role": "Design"
    },
    {
      "id": "member-victor",
      "name": "Victor Ene",
      "role": "Financiar"
    }
  ],
  "tasks": [
    {
      "id": "task-concept",
      "title": "Concept eveniment",
      "description": "Stabilire tema, public tinta si obiective.",
      "startDate": "2026-05-20",
      "deadline": "2026-05-24",
      "participants": 4,
      "budget": 1200,
      "priority": "mare",
      "assignee": "Ioana Pop",
      "status": "in-lucru"
    },
    {
      "id": "task-locatie",
      "title": "Rezervare locatie",
      "description": "Confirmare sala, program si costuri.",
      "startDate": "2026-05-22",
      "deadline": "2026-05-29",
      "participants": 2,
      "budget": 4500,
      "priority": "critica",
      "assignee": "Andrei Ionescu",
      "status": "planificat"
    },
    {
      "id": "task-vizual",
      "title": "Materiale vizuale",
      "description": "Afise, program si continut pentru social media.",
      "startDate": "2026-05-25",
      "deadline": "2026-06-03",
      "participants": 3,
      "budget": 1800,
      "priority": "medie",
      "assignee": "Mara Stan",
      "status": "planificat"
    },
    {
      "id": "task-furnizori",
      "title": "Confirmare furnizori",
      "description": "Sunet, lumini, catering si transport.",
      "startDate": "2026-05-30",
      "deadline": "2026-06-07",
      "participants": 2,
      "budget": 6200,
      "priority": "mare",
      "assignee": "Victor Ene",
      "status": "planificat"
    },
    {
      "id": "task-eveniment",
      "title": "Ziua evenimentului",
      "description": "Coordonare acces, program si echipe pe teren.",
      "startDate": "2026-06-10",
      "deadline": "2026-06-10",
      "participants": 10,
      "budget": 3000,
      "priority": "critica",
      "assignee": "Ioana Pop",
      "status": "planificat"
    }
  ]
}
~~~~

## ProiectInfo.cpp

~~~~cpp
#include <iostream>
#include <fstream>
#include <cstring>
using namespace std;
struct eveniment
{
    char nume[101];
    int zi, luna, an;
    int nrParticipanti;
    double sumaBani;
    eveniment *urm;
};

eveniment *creeazaEveniment(char nume[], int zi, int luna, int an,int nrParticipanti, double sumaBani)
{
    eveniment *nou = new eveniment;
    strcpy(nou->nume, nume);
    nou->zi = zi;
    nou->luna = luna;
    nou->an = an;
    nou->nrParticipanti = nrParticipanti;
    nou->sumaBani = sumaBani;
    nou->urm = NULL;
    return nou;
}

int comparaDate(int zi1, int luna1, int an1, int zi2, int luna2, int an2)
{
    if (an1 < an2)
        return -1;
    if (an1 > an2)
        return 1;

    if (luna1 < luna2)
        return -1;
    if (luna1 > luna2)
        return 1;

    if (zi1 < zi2)
        return -1;
    if (zi1 > zi2)
        return 1;

    return 0;
}

int vineInainteCalendaristic(eveniment *a, eveniment *b)
{
    int comparatie = comparaDate(a->zi, a->luna, a->an, b->zi, b->luna, b->an);

    if (comparatie < 0)
        return 1;
    return 0;
}

void afiseazaUnEveniment(eveniment *p, ofstream &fout)
{
    fout << p->nume << " - " << p->zi << "." << p->luna << "." << p->an<< ", participanti: " << p->nrParticipanti<< ", suma: " << p->sumaBani << "\n";
}

void adaugaEvenimentLaFinal(eveniment *&prim, char nume[], int zi, int luna, int an,int nrParticipanti, double sumaBani)
{
    eveniment *nou = creeazaEveniment(nume, zi, luna, an, nrParticipanti, sumaBani);

    if (prim == NULL)
    {
        prim = nou;
        return;
    }

    eveniment *p = prim;
    while (p->urm != NULL)
        p = p->urm;

    p->urm = nou;
}

void insereazaNodCalendaristic(eveniment *&prim, eveniment *nou)
{
    if (nou == NULL)
        return;

    if (prim == NULL || vineInainteCalendaristic(nou, prim))
    {
        nou->urm = prim;
        prim = nou;
        return;
    }

    insereazaNodCalendaristic(prim->urm, nou);
}

void adaugaEvenimentOrdonat(eveniment *&prim, char nume[], int zi, int luna, int an, int nrParticipanti, double sumaBani)
{
    eveniment *nou = creeazaEveniment(nume, zi, luna, an, nrParticipanti, sumaBani);
    insereazaNodCalendaristic(prim, nou);
}

void ordoneazaCalendaristicRecursiv(eveniment *&prim)
{
    if (prim == NULL || prim->urm == NULL)
        return;

    eveniment *primul = prim;
    prim = prim->urm;
    primul->urm = NULL;

    ordoneazaCalendaristicRecursiv(prim);
    insereazaNodCalendaristic(prim, primul);
}

eveniment *cautaEvenimentRecursiv(eveniment *p, char nume[])
{
    if (p == NULL)
        return NULL;

    if (strcmp(p->nume, nume) == 0)
        return p;

    return cautaEvenimentRecursiv(p->urm, nume);
}

eveniment *scoateNodDupaNume(eveniment *&prim, char nume[])
{
    if (prim == NULL)
        return NULL;

    if (strcmp(prim->nume, nume) == 0)
    {
        eveniment *gasit = prim;
        prim = prim->urm;
        gasit->urm = NULL;
        return gasit;
    }

    eveniment *anterior = prim;
    eveniment *p = prim->urm;

    while (p != NULL && strcmp(p->nume, nume) != 0)
    {
        anterior = p;
        p = p->urm;
    }

    if (p == NULL)
        return NULL;

    anterior->urm = p->urm;
    p->urm = NULL;
    return p;
}

int stergeEveniment(eveniment *&prim, char nume[])
{
    eveniment *gasit = scoateNodDupaNume(prim, nume);

    if (gasit == NULL)
        return 0;

    delete gasit;
    return 1;
}

void afiseazaListaRecursiv(eveniment *p, ofstream &fout)
{
    if (p == NULL)
        return;

    afiseazaUnEveniment(p, fout);
    afiseazaListaRecursiv(p->urm, fout);
}

void afiseazaEvenimenteDinLunaRecursiv(eveniment *p, int luna,ofstream &fout, int &gasit)
{
    if (p == NULL)
        return;

    if (p->luna == luna)
    {
        gasit = 1;
        afiseazaUnEveniment(p, fout);
    }

    afiseazaEvenimenteDinLunaRecursiv(p->urm, luna, fout, gasit);
}

int modificaNrParticipanti(eveniment *prim, char nume[], int nrNou)
{
    eveniment *gasit = cautaEvenimentRecursiv(prim, nume);

    if (gasit == NULL)
        return 0;

    gasit->nrParticipanti = nrNou;
    return 1;
}

int modificaSumaBani(eveniment *prim, char nume[], double sumaNoua)
{
    eveniment *gasit = cautaEvenimentRecursiv(prim, nume);

    if (gasit == NULL)
        return 0;

    gasit->sumaBani = sumaNoua;
    return 1;
}

int modificaData(eveniment *&prim, char nume[], int ziNoua, int lunaNoua, int anNou)
{
    eveniment *gasit = scoateNodDupaNume(prim, nume);

    if (gasit == NULL)
        return 0;

    gasit->zi = ziNoua;
    gasit->luna = lunaNoua;
    gasit->an = anNou;
    gasit->urm = NULL;

    insereazaNodCalendaristic(prim, gasit);
    return 1;
}

int modificaInformatii(eveniment *&prim, char numeVechi[], char numeNou[], int ziNoua, int lunaNoua, int anNou,int nrNou, double sumaNoua)
{
    eveniment *gasit = scoateNodDupaNume(prim, numeVechi);

    if (gasit == NULL)
        return 0;

    strcpy(gasit->nume, numeNou);
    gasit->zi = ziNoua;
    gasit->luna = lunaNoua;
    gasit->an = anNou;
    gasit->nrParticipanti = nrNou;
    gasit->sumaBani = sumaNoua;
    gasit->urm = NULL;

    insereazaNodCalendaristic(prim, gasit);
    return 1;
}

double sumaTotalaRecursiv(eveniment *p)
{
    if (p == NULL)
        return 0;

    return p->sumaBani + sumaTotalaRecursiv(p->urm);
}

double sumaLunaRecursiv(eveniment *p, int luna)
{
    if (p == NULL)
        return 0;

    if (p->luna == luna)
        return p->sumaBani + sumaLunaRecursiv(p->urm, luna);

    return sumaLunaRecursiv(p->urm, luna);
}

eveniment *copiazaListaRecursiv(eveniment *p)
{
    if (p == NULL)
        return NULL;

    eveniment *copie = creeazaEveniment(p->nume, p->zi, p->luna, p->an,p->nrParticipanti, p->sumaBani);
    copie->urm = copiazaListaRecursiv(p->urm);
    return copie;
}

int vineInainteDupaParticipanti(eveniment *a, eveniment *b)
{
    if (a->nrParticipanti < b->nrParticipanti)
        return 1;
    if (a->nrParticipanti > b->nrParticipanti)
        return 0;

    return vineInainteCalendaristic(a, b);
}

void insereazaNodDupaParticipantiRecursiv(eveniment *&prim, eveniment *nou)
{
    if (nou == NULL)
        return;

    if (prim == NULL || vineInainteDupaParticipanti(nou, prim))
    {
        nou->urm = prim;
        prim = nou;
        return;
    }

    insereazaNodDupaParticipantiRecursiv(prim->urm, nou);
}

void ordoneazaDupaParticipantiRecursiv(eveniment *&prim)
{
    if (prim == NULL || prim->urm == NULL)
        return;

    eveniment *primul = prim;
    prim = prim->urm;
    primul->urm = NULL;

    ordoneazaDupaParticipantiRecursiv(prim);
    insereazaNodDupaParticipantiRecursiv(prim, primul);
}

int numaraEvenimenteRecursiv(eveniment *p)
{
    if (p == NULL)
        return 0;

    return 1 + numaraEvenimenteRecursiv(p->urm);
}

void salveazaListaInInput(eveniment *prim)
{
    ofstream foutInput("input.txt");

    foutInput << numaraEvenimenteRecursiv(prim) << "\n";

    while (prim != NULL)
    {
        foutInput << prim->nume << " " << prim->zi << " " << prim->luna << " " << prim->an << " " << prim->nrParticipanti << " "<< prim->sumaBani << "\n";
        prim = prim->urm;
    }

    foutInput << 0 << "\n";
    foutInput.close();
}

void stergeToataLista(eveniment *&prim)
{
    while (prim != NULL)
    {
        eveniment *p = prim;
        prim = prim->urm;
        delete p;
    }
}

void afiseazaAjutor(ofstream &fout)
{
    fout << "Comenzi disponibile:\n";
    fout << "ADAUGA nume zi luna an nrParticipanti suma\n";
    fout << "ADAUGA_ORDONAT nume zi luna an nrParticipanti suma\n";
    fout << "ADAUGA_FINAL nume zi luna an nrParticipanti suma\n";
    fout << "STERGE nume\n";
    fout << "CAUTA nume\n";
    fout << "AFISEAZA_CALENDAR\n";
    fout << "AFISEAZA_LUNA luna\n";
    fout << "MODIFICA_PARTICIPANTI nume nrNou\n";
    fout << "MODIFICA_DATA nume ziNoua lunaNoua anNou\n";
    fout << "ORDONEAZA_PERSOANE\n";
    fout << "MODIFICA_SUMA nume sumaNoua\n";
    fout << "SUMA_TOTALA\n";
    fout << "SUMA_LUNA luna\n";
    fout << "MODIFICA_INFO numeVechi numeNou zi luna an nrParticipanti suma\n";
}

void proceseazaComanda(eveniment *&prim, char comanda[], ifstream &fin, ofstream &fout)
{
    if (strcmp(comanda, "AJUTOR") == 0)
    {
        afiseazaAjutor(fout);
    }
    else if (strcmp(comanda, "ADAUGA") == 0 || strcmp(comanda, "ADAUGA_ORDONAT") == 0)
    {
        char nume[101];
        int zi, luna, an, nrParticipanti;
        double sumaBani;

        fin >> nume >> zi >> luna >> an >> nrParticipanti >> sumaBani;
        adaugaEvenimentOrdonat(prim, nume, zi, luna, an, nrParticipanti, sumaBani);
        fout << "Evenimentul " << nume << " a fost adaugat calendaristic.\n";
    }
    else if (strcmp(comanda, "ADAUGA_FINAL") == 0)
    {
        char nume[101];
        int zi, luna, an, nrParticipanti;
        double sumaBani;

        fin >> nume >> zi >> luna >> an >> nrParticipanti >> sumaBani;
        adaugaEvenimentLaFinal(prim, nume, zi, luna, an, nrParticipanti, sumaBani);
        fout << "Evenimentul " << nume << " a fost adaugat la final.\n";
    }
    else if (strcmp(comanda, "STERGE") == 0)
    {
        char nume[101];
        fin >> nume;

        if (stergeEveniment(prim, nume))
            fout << "Evenimentul " << nume << " a fost sters.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "CAUTA") == 0)
    {
        char nume[101];
        fin >> nume;

        eveniment *gasit = cautaEvenimentRecursiv(prim, nume);

        if (gasit == NULL)
            fout << "Nu exista.\n";
        else
        {
            fout << "Eveniment gasit: " << gasit->nume << " - " << gasit->zi << "." << gasit->luna << "." << gasit->an << ", participanti: " << gasit->nrParticipanti << "\n";
        }
    }
    else if (strcmp(comanda, "AFISEAZA_CALENDAR") == 0 || strcmp(comanda, "AFISEAZA") == 0)
    {
        ordoneazaCalendaristicRecursiv(prim);

        if (prim == NULL)
            fout << "Nu exista evenimente.\n";
        else
            afiseazaListaRecursiv(prim, fout);
    }
    else if (strcmp(comanda, "AFISEAZA_LUNA") == 0)
    {
        int luna, gasit = 0;
        fin >> luna;

        afiseazaEvenimenteDinLunaRecursiv(prim, luna, fout, gasit);

        if (gasit == 0)
            fout << "Nu exista evenimente in luna " << luna << ".\n";
    }
    else if (strcmp(comanda, "MODIFICA_PARTICIPANTI") == 0)
    {
        char nume[101];
        int nrNou;
        fin >> nume >> nrNou;

        if (modificaNrParticipanti(prim, nume, nrNou))
            fout << "Numarul de participanti pentru " << nume << " a fost modificat.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "MODIFICA_DATA") == 0)
    {
        char nume[101];
        int ziNoua, lunaNoua, anNou;
        fin >> nume >> ziNoua >> lunaNoua >> anNou;

        if (modificaData(prim, nume, ziNoua, lunaNoua, anNou))
            fout << "Data pentru " << nume << " a fost modificata.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "ORDONEAZA_PERSOANE") == 0)
    {
        eveniment *copie = copiazaListaRecursiv(prim);
        ordoneazaDupaParticipantiRecursiv(copie);

        if (copie == NULL)
            fout << "Nu exista evenimente.\n";
        else
            afiseazaListaRecursiv(copie, fout);

        stergeToataLista(copie);
    }
    else if (strcmp(comanda, "MODIFICA_SUMA") == 0)
    {
        char nume[101];
        double sumaNoua;
        fin >> nume >> sumaNoua;

        if (modificaSumaBani(prim, nume, sumaNoua))
            fout << "Suma pentru " << nume << " a fost modificata.\n";
        else
            fout << "Nu exista.\n";
    }
    else if (strcmp(comanda, "SUMA_TOTALA") == 0)
    {
        fout << "Suma totala este: " << sumaTotalaRecursiv(prim) << "\n";
    }
    else if (strcmp(comanda, "SUMA_LUNA") == 0)
    {
        int luna;
        fin >> luna;

        fout << "Suma pentru luna " << luna << " este: "
             << sumaLunaRecursiv(prim, luna) << "\n";
    }
    else if (strcmp(comanda, "MODIFICA_INFO") == 0)
    {
        char numeVechi[101], numeNou[101];
        int ziNoua, lunaNoua, anNou, nrNou;
        double sumaNoua;

        fin >> numeVechi >> numeNou >> ziNoua >> lunaNoua >> anNou >> nrNou >> sumaNoua;

        if (modificaInformatii(prim, numeVechi, numeNou, ziNoua, lunaNoua, anNou, nrNou, sumaNoua))
            fout << "Informatiile pentru " << numeVechi << " au fost modificate.\n";
        else
            fout << "Nu exista.\n";
    }
    else
    {
        fout << "Comanda necunoscuta: " << comanda << "\n";
    }
}

int main()
{
    ifstream fin("input.txt");
    ofstream fout("output.txt");

    eveniment *prim = NULL;
    int n, i;

    if (!fin)
    {
        fout << "Nu se poate deschide fisierul input.txt.\n";
        return 0;
    }

    if (!(fin >> n))
    {
        fout << "Fisierul de intrare nu contine numarul de evenimente.\n";
        return 0;
    }

    for (i = 1; i <= n; i++)
    {
        char nume[101];
        int zi, luna, an, nrParticipanti;
        double sumaBani;

        if (fin >> nume >> zi >> luna >> an >> nrParticipanti >> sumaBani)
            adaugaEvenimentOrdonat(prim, nume, zi, luna, an, nrParticipanti, sumaBani);
        else
        {
            fout << "Nu s-au putut citi toate evenimentele.\n";
            break;
        }
    }

    int nrComenzi = 0;
    if (!(fin >> nrComenzi))
        nrComenzi = 0;

    for (i = 1; i <= nrComenzi; i++)
    {
        char comanda[51];
        fin >> comanda;

        fout << "\n[" << i << "] " << comanda << "\n";
        proceseazaComanda(prim, comanda, fin, fout);
    }

    ordoneazaCalendaristicRecursiv(prim);

    fin.close();
    fout.close();

    salveazaListaInInput(prim);
    stergeToataLista(prim);

    return 0;
}
~~~~

## README.md

~~~~markdown
# Vision Planner

Aplicatie web pentru organizarea evenimentelor, pornita de la logica din `ProiectInfo.cpp`.

## Rulare

```bash
node server.js
```

Apoi deschide `http://localhost:3000`.

## Instalare ca aplicatie

Aplicatia este pregatita ca PWA. Dupa ce este deschisa pe `localhost` sau pe un link `https`, browserul poate afisa optiunea de instalare. Cand browserul permite, apare si butonul `Instaleaza` in bara de sus.

## Publicare pe web

Proiectul include `package.json` si `render.yaml`, deci poate fi publicat ca serviciu Node pe Render.

Setari principale:

- Build Command: `npm install --omit=dev`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Blueprint-ul creeaza si o baza de date PostgreSQL `vision-planner-db`, apoi seteaza automat `DATABASE_URL` pentru serviciul web.

## AI si securitate

AI-ul pentru impartirea taskurilor in subtaskuri foloseste `OPENAI_API_KEY` daca este setat in Render. Fara aceasta variabila, aplicatia foloseste un fallback local de planificare.

Aplicatia include conturi cu sesiuni HTTP-only, parole hash-uite cu PBKDF2, rate limiting simplu, validari pe API si security headers. Firewall-ul de retea ramane o setare de platforma in Render.

## Ce include

- backend JavaScript pe Node.js
- persistenta PostgreSQL pe Render, cu fallback JSON local
- conturi, echipe, coduri de invitatie si date separate pe echipa
- notificari in aplicatie pentru asignari, deadline in 24h si taskuri dupa deadline
- asistent AI optional pentru subtaskuri
- API REST pentru taskuri si membri
- persistenta locala in `data/events.json`
- vizualizare Gantt, calendar si alocare pe echipa
- prioritati, deadlineuri, bugete, participanti si statusuri
~~~~
