# CloudBase phone login for the progress board

The `/progress/` page stores shared data in Tencent CloudBase and requires a
verified lab-member login. Members sign in with a phone number and SMS code.
The browser calls `progress-api` through the authenticated CloudBase Web SDK,
so the function receives the caller's verified CloudBase UUID instead of
trusting a browser-supplied member ID.

```
Browser (/progress/)
  phone + SMS code ──▶ CloudBase Auth
                           │ verified UUID
  callFunction(progress-api)
              │
    member_identities (admin-only)
              │ member_id
    projects · project_members · progress_entries · project_plans
```

## Identity flow

First login:

1. The member requests an SMS code and signs in through CloudBase Auth.
2. The browser sends the same normalized phone number to `progress-api`.
3. The function asks CloudBase's admin Auth API for the platform-injected UUID's
   account and requires its normalized phone to match the login claim. A reverse
   phone lookup remains as a compatibility fallback.
4. The verified phone is matched against `member_identities.phone_e164`.
5. The function saves the UUID in `auth_uid` and returns the roster `member_id`.

Returning login state:

1. CloudBase restores the locally persisted login state.
2. The function resolves the saved `auth_uid` without another identity choice.

The browser never receives the private identity collection and never chooses
the acting member. Signing out is the only way to change accounts.

## Files

| Path | Role |
|------|------|
| `assets/progress.js` | SMS login, persisted session handling, authenticated function calls, todo plans, timeline deadlines, and board UI |
| `cloudbase/functions/progress-api/index.js` | Server-side phone verification, member resolution, and authenticated board/plan operations |
| `cloudbase/functions/progress-api/package.json` | Pinned CloudBase Node SDK dependency |
| `cloudbase/cloudbaserc.json` | Function deployment settings |
| `content/pages/progress.md` | Public env ID, region, function name, and Web SDK script |
| `content/data/members.yml` | Public roster names/slugs only—never phone numbers |

## One-time CloudBase console setup

The current environment is `eclab-progress-d9gm1x6ro276d951a` in Shanghai.

### 1. Enable SMS login

Console → **身份认证 → 登录方式** → enable **短信验证码登录**.

Current environment audit (2026-07-16): SMS login is enabled and verified in
production.

SMS login is supported only in the Shanghai region. Sends are rate-limited and
use the CloudBase SMS quota.

### 2. Confirm Web safe domains

Console → **环境配置 → 安全来源 / 安全域名** must include every origin that will
load `/progress/`, including the production domain `zju-eclab.github.io`. Add
`localhost:8000` when testing locally. Safe-domain
changes can take about 10 minutes to apply.

Current environment audit (2026-07-16): `zju-eclab.github.io` is already
present and is the only required production origin. Add localhost only if
needed.

### 3. Configure the private identity collection

These five collections are used:

- `projects`
- `project_members`
- `progress_entries`
- `project_plans`
- `member_identities`

Set every collection to **仅管理端可读写 (ADMINONLY)**. In particular,
`member_identities` must never be readable through the browser SDK.

Current environment audit (2026-07-16): the existing progress and identity
collections are `ADMINONLY`. Keep `project_plans` at the same level.

Create one `member_identities` document per roster member:

```json
{
  "member_id": "roster-slug-from-members-yml",
  "phone_e164": "+8613800000000",
  "auth_uid": "",
  "created_at": "2026-07-16T00:00:00.000Z"
}
```

Rules:

- `phone_e164` uses compact E.164 form: `+86` followed by the 11 digits, with
  no spaces or punctuation.
- `member_id` must exactly match an `id` in `content/data/members.yml`.
- Leave `auth_uid` empty initially. The function fills it after verified login.
- Never add phone numbers to `members.yml`, a template, JavaScript, or generated
  HTML.

### 4. Require login for client function calls

Console → **云函数 → 权限控制** must require a non-anonymous user. The current
environment already has this rule:

```json
{
  "*": {
    "invoke": "auth != null && auth.loginType != 'ANONYMOUS'"
  }
}
```

The function also checks the injected UUID and private identity mapping.

### 5. Deploy the updated function

```bash
npm i -g @cloudbase/cli
tcb login
cd cloudbase
tcb fn deploy progress-api
```

The site uses authenticated `callFunction`, so the old HTTP gateway mapping is
not required by `/progress/`. It may remain temporarily for rollback, but
unauthenticated HTTP requests are rejected by the function.

## Function routes

The browser sends the existing HTTP-like route shape inside an authenticated
`callFunction` event. All routes require a mapped CloudBase user.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/progress/auth/me` | Resolve/enroll the current verified phone user |
| GET | `/api/progress` | List projects with members, entries, and plans |
| POST | `/api/progress` | Create a project |
| POST | `/api/progress/entries` | Add a progress entry |
| PATCH | `/api/progress/entries/:id` | Edit an entry |
| DELETE | `/api/progress/entries/:id` | Delete an entry |
| POST | `/api/progress/plans` | Add a todo plan with a deadline |
| PATCH | `/api/progress/plans/:id` | Complete or reopen a plan |
| DELETE | `/api/progress/plans/:id` | Delete a plan |
| PATCH | `/api/progress/projects/:id/status` | Change status |
| PATCH | `/api/progress/projects/:id/name` | Rename a project |
| PATCH | `/api/progress/projects/:id` | End a project |
| DELETE | `/api/progress/projects/:id` | Delete project and children |
| POST | `/api/progress/projects/:id/members` | Invite a member |
| DELETE | `/api/progress/projects/:id/members/:memberId` | Remove a member |

Mutation bodies no longer contain the acting `memberId`. The function derives
it exclusively from verified CloudBase identity.

## Data model

**`member_identities`** (private): `member_id`, `phone_e164`, `auth_uid`,
`created_at`, `updated_at`.

**`projects`**: `id`, `name`, `status`, `start_date`, `end_date`, `created_by`,
`created_at`, `updated_at`.

**`project_members`**: `project_id`, `member_id`, `added_by`, `created_at`.

**`progress_entries`**: `id`, `project_id`, `author_id`, `start_date`,
`end_date`, `note`, `created_at`, optional `updated_at`.

**`project_plans`**: `id`, `project_id`, `author_id`, `deadline`, `text`,
`completed`, `completed_at`, `created_at`, optional `updated_at`.

The lab leader (`LEADER_ID`, default `xia-fang`) is auto-added to each project
and cannot be removed.

## Verification

After console setup and deployment:

1. Open `/progress/` in a private browser window.
2. Enter a phone that exists in `member_identities` and request a code.
3. Sign in and confirm the toolbar shows the automatically matched member and
   only an **退出登录** identity action.
4. Create or edit a small test entry, refresh, and confirm it persisted.
5. Add a plan and confirm its deadline marker appears on the timeline; complete
   and reopen it, then refresh to confirm both states persist.
6. Sign out and log in with the same phone again.
7. Try a phone not in `member_identities`; access must be denied.

## Operational notes

- CloudBase Auth persists Web login locally for up to 30 days until sign-out.
- Failed writes are not applied to the local cache. If CloudBase is unavailable,
  cached board data is displayed read-only.
- Project/member/entry/plan listing loads up to 1000 documents per collection.
- The old HTTP gateway and Cloudflare Worker are no longer part of the active
  authenticated browser path.
