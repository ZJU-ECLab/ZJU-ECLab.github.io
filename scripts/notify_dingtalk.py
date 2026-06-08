#!/usr/bin/env python3
"""Send a DingTalk group notification for a newly published issue."""

import json
import sys
import time
import hmac
import hashlib
import base64
import urllib.request
import urllib.parse


def build_message(issue_path: str) -> tuple[str, str]:
    """Return (title, markdown body) extracted from an issue JSON file."""
    d = json.load(open(issue_path, encoding="utf-8"))
    label = d.get("label", "")
    title = d.get("title") or label
    start = d.get("start", "")
    end = d.get("end", "")
    count = d.get("count", len(d.get("articles", []) or []))
    arts = d.get("articles", []) or []
    rec = sum(1 for a in arts if a.get("recommended"))
    url = f"https://zju-eclab.github.io/#/issue/{label}"

    lines = [f"### 📰 {title} 已发布", "", f"**{title}** 已发布到在线版《东西情报》。"]
    lines.append("")
    if start and end:
        lines.append(f"- 时间范围：{start} – {end}")
    lines.append(f"- 收录文献：{count} 篇")
    if rec:
        lines.append(f"- 推荐文献：{rec} 篇")
    lines.append(f"- [👉 点击在线阅读]({url})")
    return title, "\n".join(lines)


def sign_webhook(webhook_base: str, secret: str) -> str:
    """Compute the signed DingTalk webhook URL (加签)."""
    timestamp = str(int(time.time() * 1000))
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(hmac_code).decode("utf-8"))
    return f"{webhook_base}&timestamp={timestamp}&sign={sign}"


def send(webhook_url: str, msg_title: str, msg_body: str) -> None:
    """POST a markdown message to a DingTalk webhook and exit on failure."""
    payload = json.dumps({
        "msgtype": "markdown",
        "markdown": {"title": msg_title, "text": msg_body},
    }).encode("utf-8")

    req = urllib.request.Request(
        webhook_url, data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read().decode("utf-8"))
        if result.get("errcode") != 0:
            print(f"⚠️ DingTalk API error: {result}", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"❌ Failed to send DingTalk notification: {e}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <issue.json> <webhook_base_url> <secret>",
              file=sys.stderr)
        sys.exit(1)

    issue_path, webhook_base, secret = sys.argv[1], sys.argv[2], sys.argv[3]
    title, body = build_message(issue_path)
    url = sign_webhook(webhook_base, secret)
    send(url, title, body)
    print(f"✅ DingTalk notification sent for {title}")


if __name__ == "__main__":
    main()
