const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

// Lab leader is auto-added to every project. Overridable via [vars] LEADER_ID.
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function notFound(message) {
  return json({ error: 'not_found', message: message || 'API route not found.' }, 404);
}

function badRequest(message) {
  return json({ error: 'bad_request', message }, 400);
}

function forbidden(message) {
  return json({ error: 'forbidden', message: message || 'Not a member of this project.' }, 403);
}

function methodNotAllowed() {
  return json({ error: 'method_not_allowed', message: 'Method not allowed.' }, 405);
}

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

function leaderId(env) {
  return (env && env.LEADER_ID ? String(env.LEADER_ID) : DEFAULT_LEADER_ID).trim();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status || DEFAULT_STATUS,
    startDate: row.start_date,
    endDate: row.end_date,
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

async function isMember(env, projectId, memberId) {
  if (!memberId) return false;
  const row = await env.DB.prepare(
    'select 1 as ok from project_members where project_id = ? and member_id = ?'
  ).bind(projectId, memberId).first();
  return !!row;
}

async function addMember(env, projectId, memberId, addedBy) {
  await env.DB.prepare(
    `insert or ignore into project_members (project_id, member_id, added_by)
     values (?, ?, ?)`
  ).bind(projectId, memberId, addedBy || '').run();
}

async function listProjects(env) {
  const [projectRows, memberRows, entryRows] = await Promise.all([
    env.DB.prepare(
      `select id, name, status, start_date, end_date, created_by
       from projects
       order by coalesce(end_date, '9999-12-31') desc, start_date desc, created_at desc`
    ).all(),
    env.DB.prepare(
      'select project_id, member_id from project_members'
    ).all(),
    env.DB.prepare(
      `select id, project_id, author_id, start_date, end_date, note
       from progress_entries
       order by start_date desc, created_at desc`
    ).all()
  ]);

  const projects = (projectRows.results || []).map(projectFromRow);
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const row of memberRows.results || []) {
    const project = byId.get(row.project_id);
    if (project) project.members.push(row.member_id);
  }
  for (const row of entryRows.results || []) {
    const project = byId.get(row.project_id);
    if (project) project.progress.push(entryFromRow(row));
  }
  return json({ projects });
}

async function createProject(request, env) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body.');

  const memberId = cleanText(body.memberId, 120);
  const name = cleanText(body.name, 120);
  const startDate = cleanText(body.startDate, 10);
  if (!memberId) return badRequest('memberId is required.');
  if (!name) return badRequest('Project name is required.');
  if (!isDate(startDate)) return badRequest('startDate must be YYYY-MM-DD.');

  const id = makeId('project');
  await env.DB.prepare(
    `insert into projects (id, name, status, start_date, created_by)
     values (?, ?, ?, ?, ?)`
  ).bind(id, name, DEFAULT_STATUS, startDate, memberId).run();

  // Creator and lab leader are always members.
  await addMember(env, id, memberId, memberId);
  const leader = leaderId(env);
  if (leader && leader !== memberId) await addMember(env, id, leader, 'system');

  const members = leader && leader !== memberId ? [memberId, leader] : [memberId];
  return json({
    project: {
      id, name, status: DEFAULT_STATUS, startDate,
      endDate: null, createdBy: memberId, members, progress: []
    }
  }, 201);
}

async function endProject(request, env, projectId) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const endDate = cleanText(body.endDate, 10);
  if (!memberId) return badRequest('memberId is required.');
  if (!isDate(endDate)) return badRequest('endDate must be YYYY-MM-DD.');
  if (!(await isMember(env, projectId, memberId))) return forbidden();

  const result = await env.DB.prepare(
    `update projects
     set end_date = ?, status = ?, updated_at = datetime('now')
     where id = ?`
  ).bind(endDate, ENDED_STATUS, projectId).run();
  if (!result.meta || result.meta.changes === 0) return notFound('Project not found.');
  return json({ ok: true, status: ENDED_STATUS, endDate });
}

async function setProjectStatus(request, env, projectId) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const status = cleanText(body.status, 40);
  if (!memberId) return badRequest('memberId is required.');
  if (STATUSES.indexOf(status) === -1) return badRequest('Unknown status.');
  if (!(await isMember(env, projectId, memberId))) return forbidden();

  // Setting the terminal status ends the project; any other status re-opens it.
  const ended = status === ENDED_STATUS;
  const endDate = ended ? new Date().toISOString().slice(0, 10) : null;
  const result = await env.DB.prepare(
    `update projects
     set status = ?, end_date = ?, updated_at = datetime('now')
     where id = ?`
  ).bind(status, endDate, projectId).run();
  if (!result.meta || result.meta.changes === 0) return notFound('Project not found.');
  return json({ ok: true, status, endDate });
}

async function deleteProject(request, env, projectId) {
  const body = await readJson(request);
  const memberId = cleanText(body && body.memberId, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!(await isMember(env, projectId, memberId))) return forbidden();

  const result = await env.DB.prepare('delete from projects where id = ?').bind(projectId).run();
  // Rely on FK cascade for members + entries. Delete defensively if cascade is off.
  await env.DB.prepare('delete from project_members where project_id = ?').bind(projectId).run();
  await env.DB.prepare('delete from progress_entries where project_id = ?').bind(projectId).run();
  if (!result.meta || result.meta.changes === 0) return notFound('Project not found.');
  return json({ ok: true });
}

async function addProjectMember(request, env, projectId) {
  const body = await readJson(request);
  if (!body) return badRequest('Invalid JSON body.');
  const memberId = cleanText(body.memberId, 120);
  const inviteId = cleanText(body.inviteId, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!inviteId) return badRequest('inviteId is required.');
  if (!(await isMember(env, projectId, memberId))) return forbidden();

  const project = await env.DB.prepare('select id from projects where id = ?').bind(projectId).first();
  if (!project) return notFound('Project not found.');

  await addMember(env, projectId, inviteId, memberId);
  return json({ ok: true, memberId: inviteId });
}

async function removeProjectMember(request, env, projectId, targetId) {
  const body = await readJson(request);
  const memberId = cleanText(body && body.memberId, 120);
  if (!memberId) return badRequest('memberId is required.');
  if (!(await isMember(env, projectId, memberId))) return forbidden();
  if (targetId === leaderId(env)) {
    return badRequest('The lab leader cannot be removed from a project.');
  }

  await env.DB.prepare(
    'delete from project_members where project_id = ? and member_id = ?'
  ).bind(projectId, targetId).run();
  return json({ ok: true });
}

async function createProgressEntry(request, env) {
  const body = await readJson(request);
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
  if (!(await isMember(env, projectId, memberId))) return forbidden();

  const project = await env.DB.prepare(
    'select id, end_date from projects where id = ?'
  ).bind(projectId).first();
  if (!project) return notFound('Project not found.');

  const id = makeId('progress');
  await env.DB.prepare(
    `insert into progress_entries (id, project_id, author_id, start_date, end_date, note)
     values (?, ?, ?, ?, ?, ?)`
  ).bind(id, projectId, memberId, startDate, endDate, note).run();

  return json({ entry: { id, projectId, authorId: memberId, startDate, endDate, note } }, 201);
}

async function deleteProgressEntry(request, env, entryId) {
  const body = await readJson(request);
  const memberId = cleanText(body && body.memberId, 120);
  if (!memberId) return badRequest('memberId is required.');

  const entry = await env.DB.prepare(
    'select id, project_id from progress_entries where id = ?'
  ).bind(entryId).first();
  if (!entry) return notFound('Progress entry not found.');
  if (!(await isMember(env, entry.project_id, memberId))) return forbidden();

  await env.DB.prepare('delete from progress_entries where id = ?').bind(entryId).run();
  return json({ ok: true });
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('origin');
  if (origin) headers.set('access-control-allow-origin', origin);
  headers.set('vary', 'Origin');
  headers.set('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handle(request, env) {
  if (!env.DB) {
    return json({ error: 'missing_db', message: 'D1 binding DB is not configured.' }, 500);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  if (path === '/api/progress' || path === '/api/progress/projects') {
    if (method === 'GET') return listProjects(env);
    if (method === 'POST') return createProject(request, env);
    return methodNotAllowed();
  }

  if (path === '/api/progress/entries') {
    if (method === 'POST') return createProgressEntry(request, env);
    return methodNotAllowed();
  }

  const entryMatch = path.match(/^\/api\/progress\/entries\/([^/]+)$/);
  if (entryMatch) {
    if (method === 'DELETE') return deleteProgressEntry(request, env, decodeURIComponent(entryMatch[1]));
    return methodNotAllowed();
  }

  const statusMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/status$/);
  if (statusMatch) {
    if (method === 'PATCH') return setProjectStatus(request, env, decodeURIComponent(statusMatch[1]));
    return methodNotAllowed();
  }

  const memberMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch) {
    if (method === 'DELETE') {
      return removeProjectMember(request, env,
        decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]));
    }
    return methodNotAllowed();
  }

  const membersMatch = path.match(/^\/api\/progress\/projects\/([^/]+)\/members$/);
  if (membersMatch) {
    if (method === 'POST') return addProjectMember(request, env, decodeURIComponent(membersMatch[1]));
    return methodNotAllowed();
  }

  const projectMatch = path.match(/^\/api\/progress\/projects\/([^/]+)$/);
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1]);
    if (method === 'PATCH') return endProject(request, env, id);
    if (method === 'DELETE') return deleteProject(request, env, id);
    return methodNotAllowed();
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    try {
      return withCors(await handle(request, env), request);
    } catch (error) {
      return withCors(json({
        error: 'server_error',
        message: error && error.message ? error.message : 'Unexpected error.'
      }, 500), request);
    }
  }
};
