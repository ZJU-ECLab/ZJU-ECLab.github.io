-- Shared lab progress board.
-- Projects are shared: membership lives in project_members. Any member of a
-- project can add or delete progress; any member can invite or remove members
-- and delete the project. There is no per-user auth beyond the selected member.

create table if not exists projects (
  id text primary key,
  name text not null,
  status text not null default '文献调研中',
  start_date text not null,
  end_date text,
  created_by text not null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);

-- One row per (project, member). The project creator and the lab leader are
-- added here automatically by the Worker.
create table if not exists project_members (
  project_id text not null references projects(id) on delete cascade,
  member_id text not null,
  added_by text not null default '',
  created_at text not null default (datetime('now')),
  primary key (project_id, member_id)
);

create table if not exists progress_entries (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  author_id text not null default '',
  start_date text not null,
  end_date text not null,
  note text not null,
  created_at text not null default (datetime('now'))
);

create index if not exists idx_project_members_project on project_members(project_id);
create index if not exists idx_project_members_member on project_members(member_id);
create index if not exists idx_progress_entries_project on progress_entries(project_id);

-- Migration for an existing database that predates the status column. SQLite
-- ignores "add column" errors only via tooling, so run this once by hand if the
-- projects table already exists without a status column (it errors harmlessly if
-- the column is already present):
--   alter table projects add column status text not null default '文献调研中';
