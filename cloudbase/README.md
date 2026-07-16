# cloudbase/

Tencent CloudBase (腾讯云开发) backend and authenticated member resolver for the
`/progress/` board. It replaces the retired Cloudflare Worker + D1 backend.

- `functions/progress-api/` — the authenticated cloud function, called through
  the CloudBase Web SDK.
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

Before deployment, enable SMS Auth, configure the private `member_identities`
collection, and require non-anonymous login for function invocation. The HTTP
gateway is no longer used by the browser page.
