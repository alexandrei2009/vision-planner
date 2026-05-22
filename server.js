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
