#!/usr/bin/env python3
"""
Emotion & Culture Lab — static site builder.

Reads editable content (Markdown prose + YAML structured data) and renders it
through Jinja2 templates into a self-contained static site under dist/.

Content model (hybrid):
  content/pages/*.md      prose pages (YAML front-matter + Markdown body)
  content/news/*.md       news posts (front-matter + Markdown body)
  content/data/*.yml      structured data for list pages (people, publications…)

Output:
  dist/                   the static site (HTML + copied assets)

The weekly-journal SPA (journal/index.html + assets/app.js + data/) is copied
through unchanged by copy_journal(); its issue data is produced by the external
ECLab-News pipeline.

Usage:
  python3 build.py            # build into dist/
  python3 build.py --serve    # build, then serve dist/ on :8000
"""

from __future__ import annotations

import argparse
import datetime as dt
import html as html_lib
import itertools
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import markdown as md
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

# ── paths ────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.resolve()
CONTENT = ROOT / "content"
TEMPLATES = ROOT / "templates"
ASSETS = ROOT / "assets"
DIST = ROOT / "dist"

# Default accent (warm terracotta from the lab identity). Individual pages may
# override via front-matter `accent:`.
DEFAULT_ACCENT = "hsl(16, 64%, 46%)"

# Per-section accents — rainbow color scheme (ROYGBIV) for expressive design
ACCENTS = {
    "home": "#e4040f",                   # Logo red (matches --logo-red)
    "news": "hsl(25, 85%, 58%)",         # Orange
    "people": "hsl(42, 75%, 48%)",       # Yellow/Gold (deeper for contrast)
    "alumni": "hsl(42, 75%, 48%)",       # Yellow/Gold (same as members)
    "publications": "hsl(150, 55%, 42%)", # Green
    "resources": "hsl(185, 60%, 44%)",   # Cyan
    "courses": "hsl(220, 70%, 56%)",     # Blue
    "join-us": "hsl(250, 55%, 60%)",     # Indigo
    "contact": "hsl(280, 50%, 56%)",     # Purple
}

# Complementary accents for dual-tone expressive surfaces (M3 Expressive).
# Each complement is roughly opposite on the color wheel from its accent.
COMPLEMENTS = {
    "home": "#ff6e01",                   # Logo orange (matches --logo-orange)
    "news": "hsl(205, 85%, 58%)",        # Blue (opposite of orange)
    "people": "hsl(222, 75%, 48%)",      # Blue (opposite of yellow/gold)
    "alumni": "hsl(222, 75%, 48%)",      # Blue (opposite of yellow/gold)
    "publications": "hsl(330, 55%, 42%)", # Magenta (opposite of green)
    "resources": "hsl(5, 60%, 44%)",     # Red (opposite of cyan)
    "courses": "hsl(40, 70%, 56%)",      # Yellow (opposite of blue)
    "join-us": "hsl(70, 55%, 60%)",      # Yellow-green (opposite of indigo)
    "contact": "hsl(100, 50%, 56%)",     # Green (opposite of purple)
}

# Site-wide navigation. `children` render as a dropdown / submenu.
# Per the migration decisions: RESEARCH points straight to Publications, and the
# Weekly Journal is promoted to a dominant Home feature (still linkable in nav).
NAV = [
    {"label": "Home", "href": "/"},
    {"label": "News", "href": "/news/"},
    {
        "label": "People",
        "href": "/people/",
        "children": [
            {"label": "Lab Members", "href": "/people/"},
            {"label": "Alumni", "href": "/alumni/"},
        ],
    },
    {"label": "Research", "href": "/publications/"},
    {
        "label": "Resources",
        "href": "/resources/",
        "children": [
            {"label": "CEWD (Word)", "href": "/resources/cewd/"},
            {"label": "CDFED (Face)", "href": "/resources/cdfed/"},
            {"label": "CEPD (Prosody)", "href": "/resources/cepd/"},
            {"label": "CNVD (Vocalization)", "href": "/resources/cnvd/"},
        ],
    },
    {"label": "Courses", "href": "/courses/"},
    {"label": "Join Us", "href": "/join-us/"},
    {"label": "Contact", "href": "/contact/"},
    {"label": "Journal", "href": "/journal/"},
]

# Quick-nav cards for the homepage: every top-level section accessible at a glance.
QUICK_NAV = [
    {"label": "News", "href": "/news/", "icon": "news",
     "desc": "Latest updates from the lab"},
    {"label": "People", "href": "/people/", "icon": "people",
     "desc": "Meet our team"},
    {"label": "Research", "href": "/publications/", "icon": "research",
     "desc": "Our publications"},
    {"label": "Resources", "href": "/resources/", "icon": "resources",
     "desc": "Open datasets & tools"},
    {"label": "Courses", "href": "/courses/", "icon": "courses",
     "desc": "Teaching & workshops"},
    {"label": "Join Us", "href": "/join-us/", "icon": "join",
     "desc": "Open positions"},
    {"label": "Contact", "href": "/contact/", "icon": "contact",
     "desc": "Get in touch"},
    {"label": "Journal", "href": "/journal/", "icon": "journal",
     "desc": "Weekly literature digest"},
]

SITE = {
    "name": "Emotion & Culture Lab",
    "subtitle": "Emotion & Culture Lab · Zhejiang University",
    "wechat": "emotionculturelab",
    "email": "x.fang@zju.edu.cn",
    "nav": NAV,
    "quick_nav": QUICK_NAV,
    "default_accent": DEFAULT_ACCENT,
}

# ── front-matter parsing ───────────────────────────────────────────────────────
_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


@dataclass
class Document:
    """A parsed Markdown document: front-matter meta + rendered HTML body."""
    meta: dict = field(default_factory=dict)
    html: str = ""
    source: Path | None = None


def parse_markdown(path: Path) -> Document:
    """Split YAML front-matter from Markdown body and render the body to HTML."""
    raw = path.read_text(encoding="utf-8")
    meta: dict = {}
    body = raw
    m = _FM_RE.match(raw)
    if m:
        meta = yaml.safe_load(m.group(1)) or {}
        body = m.group(2)
    renderer = md.Markdown(
        extensions=["extra", "sane_lists", "smarty", "attr_list"],
        output_format="html5",
    )
    html = renderer.convert(body)
    return Document(meta=meta, html=html, source=path)


def load_yaml(path: Path) -> dict | list:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


# ── inline markdown (authors/venue: **bold**, *italics*) ─────────────────────
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")
_LINK_RE = re.compile(r"\[(.+?)\]\((.+?)\)")


def inline_md(text: str) -> Markup:
    """Render a tiny inline-markdown subset safely.

    Supports **bold**, *italic*, [text](url), and a literal escaped asterisk
    (``\\*``). Everything is HTML-escaped first, so input data can't inject markup.
    """
    if text is None:
        return Markup("")
    s = html_lib.escape(str(text))
    # protect escaped asterisks before emphasis parsing
    s = s.replace("\\*", "\u0001")
    s = _LINK_RE.sub(r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = _BOLD_RE.sub(r"<strong>\1</strong>", s)
    s = _ITALIC_RE.sub(r"<em>\1</em>", s)
    s = s.replace("\u0001", "*")
    return Markup(s)


def initials(name: str) -> str:
    """Two-letter initials from a name, for the photo fallback avatar."""
    if not name:
        return "?"
    parts = [p for p in re.split(r"\s+", str(name).strip()) if p]
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


# ── jinja env ──────────────────────────────────────────────────────────────────
def make_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    # Render trusted Markdown-produced HTML without escaping.
    env.filters["safe_html"] = lambda s: s
    env.filters["inline_md"] = inline_md
    env.filters["initials"] = initials
    return env


# ── build steps ─────────────────────────────────────────────────────────────
def clean_dist() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)


def copy_assets() -> None:
    """Copy the shared asset tree (CSS, JS, images, fonts) into dist/assets."""
    if ASSETS.exists():
        shutil.copytree(ASSETS, DIST / "assets")


def copy_static() -> None:
    """Copy root static files Pages needs: .nojekyll, CNAME (if present)."""
    # .nojekyll disables Jekyll processing on the published output.
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    cname = ROOT / "CNAME"
    if cname.exists():
        shutil.copy2(cname, DIST / "CNAME")
        print("  copied CNAME")


def copy_journal() -> None:
    """Copy the self-contained weekly-journal SPA to /journal/.

    The journal is a standalone SPA: its shell (journal/index.html), its data
    (journal/data/), and its scripts/styles (assets/app.js + assets/style.css,
    copied with the rest of assets/). Its issue data under journal/data/ is
    pushed there by the external ECLab-News pipeline, which we leave untouched.
    app.js fetches from the absolute /journal/data/.
    """
    journal_src = ROOT / "journal"
    if not journal_src.exists():
        return
    shutil.copytree(journal_src, DIST / "journal")
    print("  built  /journal/  (weekly journal SPA)")
    data_dir = DIST / "journal" / "data"
    if data_dir.exists():
        n = sum(1 for _ in data_dir.rglob("*.json"))
        print(f"  copied /journal/data/  ({n} json files)")


def write_page(rel_url: str, html: str) -> None:
    """Write `html` to a clean-URL location: '/about/' -> dist/about/index.html."""
    rel = rel_url.strip("/")
    out = DIST / "index.html" if rel == "" else DIST / rel / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")


def page_url(rel: Path) -> str:
    """Map a content/pages path to a clean URL.

    home.md          -> /
    contact.md       -> /contact/
    resources.md     -> /resources/
    resources/cdfed  -> /resources/cdfed/
    """
    parts = rel.with_suffix("").parts
    if parts == ("home",):
        return "/"
    return "/" + "/".join(parts) + "/"


def build_pages(env: Environment) -> None:
    """Render every Markdown page under content/pages (recursively)."""
    pages_dir = CONTENT / "pages"
    # Pre-read latest journal issue for the home page
    latest_journal_href = None
    latest_journal_title = None
    manifest_path = ROOT / "journal" / "data" / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        issues = manifest.get("issues", [])
        if issues:
            latest = issues[0]
            latest_journal_href = f"/journal/#/issue/{latest['label']}"
            # Format a short date label from the issue label (e.g. "2026-06-01_2026-06-07" → "Jun 1–7, 2026")
            try:
                start_str, end_str = latest["label"].split("_")
                start = dt.date.fromisoformat(start_str)
                end = dt.date.fromisoformat(end_str)
                if start.month == end.month:
                    latest_journal_title = f"{start.strftime('%b')} {start.day}–{end.day}, {start.year}"
                else:
                    latest_journal_title = f"{start.strftime('%b %d')} – {end.strftime('%b %d')}, {start.year}"
            except Exception:
                latest_journal_title = latest.get("title", "")

    for src in sorted(pages_dir.rglob("*.md")):
        rel = src.relative_to(pages_dir)
        doc = parse_markdown(src)
        slug = doc.meta.get("slug", rel.with_suffix("").as_posix())
        template = env.get_template(doc.meta.get("template", "page.html"))
        url = page_url(rel)
        ctx = dict(
            site=SITE,
            page=doc.meta,
            content=doc.html,
            accent=doc.meta.get("accent", ACCENTS.get(slug, DEFAULT_ACCENT)),
            complement=COMPLEMENTS.get(slug, ACCENTS.get(slug, DEFAULT_ACCENT)),
        )
        if slug == "home" and latest_journal_href:
            ctx["latest_journal_href"] = latest_journal_href
            ctx["latest_journal_title"] = latest_journal_title
        html = template.render(**ctx)
        write_page(url, html)
        print(f"  built  {url}  ({slug})")


def build_data_page(env: Environment, *, template: str, data_file: str,
                    url: str, title: str, slug: str, transform=None) -> None:
    """Render a structured (YAML-driven) list page."""
    data = load_yaml(CONTENT / "data" / data_file)
    if transform:
        data = transform(data)
    tmpl = env.get_template(template)
    html = tmpl.render(
        site=SITE,
        page={"title": title, "slug": slug},
        data=data,
        accent=ACCENTS.get(slug, DEFAULT_ACCENT),
        complement=COMPLEMENTS.get(slug, ACCENTS.get(slug, DEFAULT_ACCENT)),
    )
    write_page(url, html)
    print(f"  built  {url}  ({slug})")


def _group_publications(data: dict) -> dict:
    """Attach a year-grouped view (newest first) for the template."""
    items = data.get("items", [])
    ordered = sorted(items, key=lambda p: p.get("year", 0), reverse=True)
    by_year = [
        (year, list(group))
        for year, group in itertools.groupby(ordered, key=lambda p: p.get("year"))
    ]
    data["by_year"] = by_year
    data["total"] = len(items)
    return data


def _format_date(value) -> str:
    """Render a YAML date (or ISO string) as 'June 27, 2025'."""
    if isinstance(value, (dt.date, dt.datetime)):
        return value.strftime("%B %-d, %Y")
    try:
        return dt.date.fromisoformat(str(value)).strftime("%B %-d, %Y")
    except (ValueError, TypeError):
        return str(value)


def build_news(env: Environment) -> None:
    """Render the news list and each individual post page."""
    news_dir = CONTENT / "news"
    if not news_dir.exists():
        return

    posts = []
    for src in news_dir.glob("*.md"):
        doc = parse_markdown(src)
        slug = doc.meta.get("slug", src.stem)
        doc.meta["slug"] = slug
        doc.meta["date_display"] = _format_date(doc.meta.get("date", ""))
        posts.append({
            "meta": doc.meta,
            "html": doc.html,
            "url": f"/news/{slug}/",
            "date": doc.meta.get("date", ""),
            "date_display": doc.meta["date_display"],
        })

    # newest first
    posts.sort(key=lambda p: str(p["date"]), reverse=True)

    # list page
    list_tmpl = env.get_template("news-list.html")
    write_page("/news/", list_tmpl.render(
        site=SITE,
        page={"title": "News", "slug": "news"},
        posts=posts,
        accent=ACCENTS["news"],
        complement=COMPLEMENTS["news"],
    ))
    print("  built  /news/  (news index)")

    # individual posts
    post_tmpl = env.get_template("news-post.html")
    for p in posts:
        write_page(p["url"], post_tmpl.render(
            site=SITE,
            page=p["meta"],
            content=p["html"],
            accent=ACCENTS["news"],
            complement=COMPLEMENTS["news"],
        ))
        print(f"  built  {p['url']}  (news post)")


def build_404(env: Environment) -> None:
    """Render dist/404.html — GitHub Pages serves it for missing paths."""
    html = env.get_template("404.html").render(
        site=SITE,
        page={"title": "Page not found", "slug": "404"},
        accent=DEFAULT_ACCENT,
    )
    (DIST / "404.html").write_text(html, encoding="utf-8")
    print("  built  /404.html")


# ── main ───────────────────────────────────────────────────────────────────────
def build() -> None:
    print("Building ECLab site → dist/")
    clean_dist()
    copy_assets()
    copy_static()
    env = make_env()
    build_pages(env)
    build_data_page(env, template="people.html", data_file="people.yml",
                    url="/people/", title="Lab Members", slug="people")
    build_data_page(env, template="alumni.html", data_file="alumni.yml",
                    url="/alumni/", title="Alumni", slug="alumni")
    build_data_page(env, template="publications.html", data_file="publications.yml",
                    url="/publications/", title="Publications", slug="publications",
                    transform=_group_publications)
    build_data_page(env, template="courses.html", data_file="courses.yml",
                    url="/courses/", title="Courses", slug="courses")
    build_news(env)
    build_404(env)
    copy_journal()
    missing = validate_assets()
    if missing:
        print(f"Done — but {missing} asset reference(s) are broken (see above).")
    else:
        print("Done.")


def validate_assets() -> int:
    """Fail loudly if any /assets/ reference in the built site has no file.

    Catches broken/renamed asset paths before they ship as missing images.
    """
    ref_re = re.compile(
        r'(?:src|href)="(/assets/[^"]+\.(?:jpg|jpeg|png|gif|webp|svg|pdf|docx|doc))"'
    )
    missing: set[str] = set()
    for html_file in DIST.rglob("*.html"):
        for ref in ref_re.findall(html_file.read_text(encoding="utf-8")):
            if not (DIST / ref.lstrip("/")).exists():
                missing.add(ref)
    if missing:
        print(f"\n  WARNING: {len(missing)} asset reference(s) have no file:")
        for m in sorted(missing):
            print(f"    {m}")
    return len(missing)


def serve() -> None:
    import http.server
    import socketserver

    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(
        *a, directory=str(DIST), **k
    )
    port = 8001
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"Serving dist/ at http://localhost:{port}  (Ctrl-C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Build the ECLab static site.")
    ap.add_argument("--serve", action="store_true", help="serve dist/ after building")
    args = ap.parse_args(argv)
    build()
    if args.serve:
        serve()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
