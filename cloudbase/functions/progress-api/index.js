'use strict';

// ECLab shared progress board — CloudBase (腾讯云开发) cloud function.
//
// This is a direct port of the former Cloudflare Worker (worker/src/index.js).
// It is exposed over CloudBase "HTTP 网关" (formerly "HTTP 访问服务"; renamed by
// Tencent in June 2026), so the static site calls it with plain fetch() exactly
// like it called the Worker.
//
// Runtime: Nodejs (CloudBase 云函数). Entry: exports.main(event, context).
// The HTTP 网关 passes the request as `event` (path, httpMethod, headers, body,
// isBase64Encoded, queryStringParameters) and expects a { statusCode, headers,
// body } return value.
//
// Data lives in three collections that mirror the old D1 tables:
//   projects          — one doc per project
//   project_members   — one doc per (project, member)
//   progress_entries  — one doc per progress entry
// Each doc keeps its own string `id` field (project-<uuid> / progress-<uuid>)
// so the client keeps keying on `id`, independent of CloudBase's own `_id`.

const tcb = require('@cloudbase/node-sdk');
const crypto = require('crypto');

const app = tcb.init({ env: process.env.CLOUDBASE_ENV || tcb.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

const COL_PROJECTS = 'projects';
const COL_MEMBERS = 'project_members';
const COL_ENTRIES = 'progress_entries';

// Lab leader is auto-added to every project. Overridable via env LEADER_ID.
const DEFAULT_LEADER_ID = 'xia-fang';

// Allowed project status tags. The last one is the terminal "ended" state and
// is also implied whenever a project has an end_date.
const STATUSES = [
  '文献调研中',
  '实验设计中',
  '数据收集中',
  '数据分析中',
  '文章写作中',
  '投稿中',
  '已结束'
];
const DEFAULT_STATUS = STATUSES[0];
const ENDED_STATUS = STATUSES[STATUSES.length - 1];

// Strip this prefix off event.path. Set to your HTTP 网关 trigger path (触发
// 路径), e.g. if the trigger path is "/progress-api", requests arrive as
// "/progress-api/api/progress". Configurable via env HTTP_PATH_PREFIX.
const HTTP_PATH_PREFIX = (process.env.HTTP_PATH_PREFIX || '').replace(/\/+$/, '');

/* ---------- response helpers (Lambda-proxy shape) ---------- */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function reply(statusCode, data) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(data)
  };
}

function json(data, status = 200) { return reply(status, data); }
function notFound(message) { return reply(404, { error: 'not_found', message: message || 'API route not found.' }); }
function badRequest(message) { return reply(400, { error: 'bad_request', message }); }
function forbidden(message) { return reply(403, { error: 'forbidden', message: message || 'Not a member of this project.' }); }
function methodNotAllowed() { return reply(405, { error: 'method_not_allowed', message: 'Method not allowed.' }); }

/* ---------- validation helpers (unchanged from Worker) ---------- */

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function leaderId() {
  return (process.env.LEADER_ID ? String(process.env.LEADER_ID) : DEFAULT_LEADER_ID).trim();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------- row -> client shape ---------- */

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status || DEFAULT_STATUS,
    startDate: row.start_date,
    endDate: row.end_date || null,
    createdBy: row.created_by,
    members: [],
    progress: []
  };
}

function entryFromRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    authorId: row.author_id,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note
  };
}

/* ---------- DB helpers ---------- */

async function getProjectDoc(projectId) {
  const res = await db.collection(COL_PROJECTS).where({ id: projectId }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function isMember(projectId, memberId) {
  if (!memberId) return false;
  const res = await db.collection(COL_MEMBERS)
    .where({ project_id: projectId, member_id: memberId }).limit(1).get();
  return !!(res.data && res.data.length);
}

async function addMember(projectId, memberId, addedBy) {
  // Emulate "insert or ignore": skip if the pair already exists.
  const existing = await db.collection(COL_MEMBERS)
    .where({ project_id: projectId, member_id: memberId }).limit(1).get();
  if (existing.data && existing.data.length) return;
  await db.collection(COL_MEMBERS).add({
    project_id: projectId,
    member_id: memberId,
    added_by: addedBy || '',
    created_at: new Date().toISOString()
  });
}

/* ---------- handlers (ported 1:1 from the Worker) ---------- */

async function listProjects() {
  const [projectRes, memberRes, entryRes] = await Promise.all([
    db.collection(COL_PROJECTS).limit(1000).get(),
    db.collection(COL_MEMBERS).limit(1000).get(),
    db.collection(COL_ENTRIES).limit(1000).get()
  ]);

  const projectRows = (projectRes.data || []).slice().sort((a, b) => {
    // Active first (null end_date sorts as far-future), newest start first.
    const ae = a.end_date || '9999-12-31';
    const be = b.end_date || '9999-12-31';
    if (ae !== be) return be < ae ? -1 : 1;
    return (b.start_date || '') < (a.start_date || '') ? -1 : 1;
  });

  const projects = projectRows.map(projectFromRow);
  const byId = new Map(projects.map((project) => [project.id, project]));

  for (const row of memberRes.data || []) {
    const project = byId.get(row.project_id);
    if (project) project.members.push(row.member_id);
  }
  const entryRows = (entryRes.data || []).slice().sort((a, b) => {
    return (b.start_date || '') < (a.start_date || '') ? -1 : 1;
  });
  for (const row of entryRows) {
    const project = byId.get(row.project_id);
    if (project) project.progress.push(entryFromRow(row));
  }
  return json({ projects });
}

async function createProject(body) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const name = cleanText(body.name, 120);
  const startDate = cleanText(body.startDate, 10);
  if (!memberId) return badRequest('memberId is required.');
  if (!name) return badRequest('Project name is required.');
  if (!isDate(startDate)) return badRequest('startDate must be YYYY-MM-DD.');

  const id = makeId('project');
  await db.collection(COL_PROJECTS).add({
    id,
    name,
    status: DEFAULT_STATUS,
    start_date: startDate,
    end_date: null,
    created_by: memberId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  await addMember(id, memberId, memberId);
  const leader = leaderId();
  if (leader && leader !== memberId) await addMember(id, leader, 'system');

  const members = leader && leader !== memberId ? [memberId, leader] : [memberId];
  return json({
    project: {
      id, name, status: DEFAULT_STATUS, startDate,
      endDate: null, createdBy: memberId, members, progress: []
    }
  }, 201);
}

async function endProject(body, projectId) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const endDate = cleanText(body.endDate, 10);
  if (!memberId) return badRequest('memberId is required.');
  if (!isDate(endDate)) return badRequest('endDate must be YYYY-MM-DD.');
  if (!(await isMember(projectId, memberId))) return forbidden();

  const doc = await getProjectDoc(projectId);
  if (!doc) return notFound('Project not found.');
  await db.collection(COL_PROJECTS).doc(doc._id).update({
    end_date: endDate, status: ENDED_STATUS, updated_at: new Date().toISOString()
  });
  return json({ ok: true, status: ENDED_STATUS, endDate });
}

async function setProjectStatus(body, projectId) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const status = cleanText(body.status, 40);
  if (!memberId) return badRequest('memberId is required.');
  if (STATUSES.indexOf(status) === -1) return badRequest('Unknown status.');
  if (!(await isMember(projectId, memberId))) return forbidden();

  const doc = await getProjectDoc(projectId);
  if (!doc) return notFound('Project not found.');

  const ended = status === ENDED_STATUS;
  const endDate = ended ? todayISO() : null;
  await db.collection(COL_PROJECTS).doc(doc._id).update({
    status, end_date: endDate, updated_at: new Date().toISOString()
  });
  return json({ ok: true, status, endDate });
}

async function renameProject(body, projectId) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const name = cleanText(body.name, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!name) return badRequest('Project name is required.');
  if (!(await isMember(projectId, memberId))) return forbidden();

  const doc = await getProjectDoc(projectId);
  if (!doc) return notFound('Project not found.');
  await db.collection(COL_PROJECTS).doc(doc._id).update({
    name, updated_at: new Date().toISOString()
  });
  return json({ ok: true, name });
}

async function deleteProject(body, projectId) {
  const memberId = cleanText(body && body.memberId, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!(await isMember(projectId, memberId))) return forbidden();

  const doc = await getProjectDoc(projectId);
  if (!doc) return notFound('Project not found.');

  // No FK cascade in a document DB — remove children explicitly.
  await db.collection(COL_PROJECTS).doc(doc._id).remove();
  await db.collection(COL_MEMBERS).where({ project_id: projectId }).remove();
  await db.collection(COL_ENTRIES).where({ project_id: projectId }).remove();
  return json({ ok: true });
}

async function addProjectMember(body, projectId) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const inviteId = cleanText(body.inviteId, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!inviteId) return badRequest('inviteId is required.');
  if (!(await isMember(projectId, memberId))) return forbidden();

  const doc = await getProjectDoc(projectId);
  if (!doc) return notFound('Project not found.');

  await addMember(projectId, inviteId, memberId);
  return json({ ok: true, memberId: inviteId });
}

async function removeProjectMember(body, projectId, targetId) {
  const memberId = cleanText(body && body.memberId, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!(await isMember(projectId, memberId))) return forbidden();
  if (targetId === leaderId()) {
    return badRequest('The lab leader cannot be removed from a project.');
  }

  await db.collection(COL_MEMBERS)
    .where({ project_id: projectId, member_id: targetId }).remove();
  return json({ ok: true });
}

async function createProgressEntry(body) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const projectId = cleanText(body.projectId, 160);
  const startDate = cleanText(body.startDate, 10);
  const endDate = cleanText(body.endDate, 10);
  const note = cleanText(body.note, 2000);
  if (!memberId) return badRequest('memberId is required.');
  if (!projectId) return badRequest('projectId is required.');
  if (!isDate(startDate) || !isDate(endDate)) return badRequest('Dates must be YYYY-MM-DD.');
  if (startDate > endDate) return badRequest('startDate must be before endDate.');
  if (!note) return badRequest('note is required.');
  if (!(await isMember(projectId, memberId))) return forbidden();

  const doc = await getProjectDoc(projectId);
  if (!doc) return notFound('Project not found.');

  const id = makeId('progress');
  await db.collection(COL_ENTRIES).add({
    id,
    project_id: projectId,
    author_id: memberId,
    start_date: startDate,
    end_date: endDate,
    note,
    created_at: new Date().toISOString()
  });
  return json({ entry: { id, projectId, authorId: memberId, startDate, endDate, note } }, 201);
}

async function updateProgressEntry(body, entryId) {
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const startDate = cleanText(body.startDate, 10);
  const endDate = cleanText(body.endDate, 10);
  const note = cleanText(body.note, 2000);
  if (!memberId) return badRequest('memberId is required.');
  if (!isDate(startDate) || !isDate(endDate)) return badRequest('Dates must be YYYY-MM-DD.');
  if (startDate > endDate) return badRequest('startDate must be before endDate.');
  if (!note) return badRequest('note is required.');

  const res = await db.collection(COL_ENTRIES).where({ id: entryId }).limit(1).get();
  const entry = res.data && res.data[0];
  if (!entry) return notFound('Progress entry not found.');
  if (!(await isMember(entry.project_id, memberId))) return forbidden();

  await db.collection(COL_ENTRIES).doc(entry._id).update({
    start_date: startDate, end_date: endDate, note, updated_at: new Date().toISOString()
  });
  return json({
    entry: {
      id: entryId,
      projectId: entry.project_id,
      authorId: entry.author_id,
      startDate, endDate, note
    }
  });
}

async function deleteProgressEntry(body, entryId) {
  const memberId = cleanText(body && body.memberId, 120);
  if (!memberId) return badRequest('memberId is required.');

  const res = await db.collection(COL_ENTRIES).where({ id: entryId }).limit(1).get();
  const entry = res.data && res.data[0];
  if (!entry) return notFound('Progress entry not found.');
  if (!(await isMember(entry.project_id, memberId))) return forbidden();

  await db.collection(COL_ENTRIES).doc(entry._id).remove();
  return json({ ok: true });
}

/* ---------- HTTP event parsing ---------- */

function parseBody(event) {
  if (!event || event.body == null || event.body === '') return null;
  let raw = event.body;
  if (event.isBase64Encoded) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) { return null; }
  }
  if (typeof raw === 'object') return raw; // already parsed by the platform
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function requestPath(event) {
  let path = (event && (event.path || (event.requestContext && event.requestContext.path))) || '/';
  if (HTTP_PATH_PREFIX && path.indexOf(HTTP_PATH_PREFIX) === 0) {
    path = path.slice(HTTP_PATH_PREFIX.length) || '/';
  }
  return path.replace(/\/+$/, '') || '/';
}

function requestMethod(event) {
  const m = (event && (event.httpMethod || (event.requestContext && event.requestContext.httpMethod))) || 'GET';
  return String(m).toUpperCase();
}

async function route(event) {
  const path = requestPath(event);
  const method = requestMethod(event);
  const body = (method === 'GET' || method === 'OPTIONS') ? null : parseBody(event);

  if (method === 'OPTIONS') return { statusCode: 204, headers: JSON_HEADERS, body: '' };

  if (path === '/api/progress' || path === '/api/progress/projects') {
    if (method === 'GET') return listProjects();
    if (method === 'POST') return createProject(body);
    return methodNotAllowed();
  }

  if (path === '/api/progress/entries') {
    if (method === 'POST') return createProgressEntry(body);
    return methodNotAllowed();
  }

  const entryMatch = path.match(/^\/api\/progress\/entries\/([^/]+)$/);
  if (entryMatch) {
    if (method === 'PATCH') return updateProgressEntry(body, decodeURIComponent(entryMatch[1]));
    if (method === 'DELETE') return deleteProgressEntry(body, decodeURIComponent(entryMatch[1]));
    return methodNotAllowed();
  }

  const nameMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/name$/);
  if (nameMatch) {
    if (method === 'PATCH') return renameProject(body, decodeURIComponent(nameMatch[1]));
    return methodNotAllowed();
  }

  const statusMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/status$/);
  if (statusMatch) {
    if (method === 'PATCH') return setProjectStatus(body, decodeURIComponent(statusMatch[1]));
    return methodNotAllowed();
  }

  const memberMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch) {
    if (method === 'DELETE') {
      return removeProjectMember(body,
        decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]));
    }
    return methodNotAllowed();
  }

  const membersMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/members$/);
  if (membersMatch) {
    if (method === 'POST') return addProjectMember(body, decodeURIComponent(membersMatch[1]));
    return methodNotAllowed();
  }

  const projectMatch = path.match(/^\/api\/progress\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1]);
    if (method === 'PATCH') return endProject(body, id);
    if (method === 'DELETE') return deleteProject(body, id);
    return methodNotAllowed();
  }

  return notFound();
}

exports.main = async function (event) {
  try {
    return await route(event);
  } catch (error) {
    return reply(500, {
      error: 'server_error',
      message: error && error.message ? error.message : 'Unexpected error.'
    });
  }
};
