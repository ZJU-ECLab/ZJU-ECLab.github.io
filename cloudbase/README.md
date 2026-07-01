# cloudbase/

Tencent CloudBase (腾讯云开发) backend for the `/progress/` board. Replaces the
retired Cloudflare Worker + D1 (unreachable from mainland China).

- `functions/progress-api/` — the cloud function (exposed via HTTP 网关).
- `cloudbaserc.json` — CloudBase CLI config. Set `envId` before deploying.

Full setup, deployment, data model, and limitations: see
[`../docs/progress-page.md`](../docs/progress-page.md).

Quick deploy:

```bash
npm i -g @cloudbase/cli
tcb login
# edit cloudbaserc.json -> "envId"
tcb fn deploy progress-api
```
