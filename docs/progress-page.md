# CloudBase (腾讯云开发) backend for the progress board

The `/progress/` page stores shared data in a **Tencent CloudBase** cloud
function backed by CloudBase's document database. It replaces the former
Cloudflare Worker + D1 setup, which was unreachable from mainland China.

The static site (GitHub Pages) calls the function over **HTTP 网关** (formerly
**HTTP 访问服务**; Tencent renamed it in June 2026) with plain `fetch()`, so the
client (`assets/progress.js`) is provider-agnostic — it only needs the
`api_base` URL in `content/pages/progress.md`.

```
Browser (/progress/)
  progress.js ── fetch() ──▶ {envId}.{region}.app.tcloudbase.com/progress-api/api/progress
                                     │
                          cloudbase/functions/progress-api/index.js
                                     │ (@cloudbase/node-sdk)
                          CloudBase 云数据库: projects · project_members · progress_entries
  fallback: localStorage "eclab-progress-v2"
```

## Files

| Path | Role |
|------|------|
| `cloudbase/functions/progress-api/index.js` | The cloud function (port of the old Worker) |
| `cloudbase/functions/progress-api/package.json` | Function deps (`@cloudbase/node-sdk`) |
| `cloudbase/cloudbaserc.json` | CloudBase CLI project config (env id, function settings) |
| `content/pages/progress.md` | `api_base:` front-matter — the function's HTTP URL |

## One-time setup

### 1. Create an environment
1. Sign in to the CloudBase console (cloudbase.net / 腾讯云 → 云开发) and finish
   **实名认证**.
2. Create an environment. Pick the **按量计费** plan with the free quota, or the
   free 环境. Note the **环境 ID (envId)** — it looks like `eclab-xxxxxxx`.

### 2. Create the three collections
In **数据库 → 集合**, create three collections (empty is fine):
- `projects`
- `project_members`
- `progress_entries`

Set each collection's **权限设置 (ACL)** to **仅管理端可读写 (admin-only)**. The
cloud function uses the admin SDK, so it bypasses ACL; locking the collections
means the public Web SDK can't touch the data directly. Our data model has no
real per-user auth (any selected member can edit), matching the old design.

### 3. Deploy the function
Install the CLI and log in:

```bash
npm i -g @cloudbase/cli
tcb login
```

Edit `cloudbase/cloudbaserc.json` and set `"envId"` to your real env id. Then
from the `cloudbase/` directory:

```bash
cd cloudbase
tcb fn deploy progress-api
```

The `LEADER_ID` and `HTTP_PATH_PREFIX` env vars are set from `cloudbaserc.json`.
Keep `HTTP_PATH_PREFIX` in sync with the trigger path in the next step.

### 4. Enable the HTTP gateway (HTTP 网关)

> **Note:** This feature was called **HTTP 访问服务** before June 2026 and is now
> **HTTP 网关**. If you can't find the old name, look for "HTTP 网关".

1. Console → **环境 → HTTP 网关**, or go directly to
   <https://tcb.cloud.tencent.com/dev#/env/http-access>.
2. In the **「域名关联资源」** module, click **「新建」** and configure:
   - **关联资源类型**: 云函数 → select `progress-api`
   - **域名**: the default domain (or a 备案'd custom domain for production)
   - **触发路径**: `/progress-api`  ← must equal `HTTP_PATH_PREFIX`
3. The default domain looks like:
   `https://{envId}.{region}.app.tcloudbase.com`
   (e.g. `https://eclab-xxxxxxx.ap-shanghai.app.tcloudbase.com`)
4. Your full API base is therefore:
   `https://{envId}.{region}.app.tcloudbase.com/progress-api/api/progress`

> The default domain is rate-limited and meant for dev/testing. For production,
> bind a **备案'd custom domain** under **自定义域名** for full capability and
> stability.

### 5. Point the site at it
Edit `content/pages/progress.md` → `api_base:` to the full URL above (it must end
with `/api/progress`, no trailing slash). Then rebuild:

```bash
python3 build.py
```

### 6. (Optional) restrict origins
In the HTTP 网关 **跨域校验 (CORS)** settings you can limit allowed origins to
your GitHub Pages domain. CORS is handled at the gateway, not in the function.

## API surface (unchanged from the Worker)

All under `.../api/progress`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/progress` | List all projects w/ members + entries |
| POST | `/api/progress` | Create project |
| POST | `/api/progress/entries` | Add a progress entry |
| PATCH | `/api/progress/entries/:id` | Edit an entry (note + dates) |
| DELETE | `/api/progress/entries/:id` | Delete an entry |
| PATCH | `/api/progress/projects/:id/status` | Change status |
| PATCH | `/api/progress/projects/:id/name` | Rename a project |
| PATCH | `/api/progress/projects/:id` | End a project |
| DELETE | `/api/progress/projects/:id` | Delete project + children |
| POST | `/api/progress/projects/:id/members` | Invite a member |
| DELETE | `/api/progress/projects/:id/members/:memberId` | Remove a member |

Request bodies include `memberId` (the acting user) for membership checks, same
as before. IDs stay `project-<uuid>` / `progress-<uuid>`.

## Data model (document collections)

Mirrors the old D1 tables. Fields use the same snake_case names the Worker used.

**`projects`**: `id`, `name`, `status`, `start_date`, `end_date` (null while
active), `created_by`, `created_at`, `updated_at`.

**`project_members`**: `project_id`, `member_id`, `added_by`, `created_at`
(unique per (project, member) — enforced in code via an existence check).

**`progress_entries`**: `id`, `project_id`, `author_id`, `start_date`,
`end_date`, `note`, `created_at`.

The lab leader (`LEADER_ID`, default `xia-fang`) is auto-added to every project
and cannot be removed. Members come from the static `content/data/members.yml`
roster baked into the page — they are **not** stored in the database.

## Limitations

- **No real auth.** The "member" is whoever is selected in the dropdown. Anyone
  who can load `/progress/` can edit shared data. This matches the previous
  design and is acceptable for a small internal board.
- **No FK cascade** in a document DB — deleting a project explicitly removes its
  members and entries in the function.
- **listProjects** loads up to 1000 docs per collection (CloudBase page limit).
  Fine for a lab board; add pagination if you ever outgrow it.

## Retiring the old Cloudflare backend

The `worker/` directory (Cloudflare Worker + D1 schema) is no longer used. Keep
it for reference or delete it once CloudBase is confirmed working. Nothing in the
build or the site references it.
