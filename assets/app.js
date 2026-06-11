/* ECLab News — client-side SPA
 * Renders the journal site from JSON data:
 *   data/manifest.json          → landing page (issues grouped by year)
 *   data/issues/<label>.json    → one weekly issue (index + details + filtering)
 * Grouping logic mirrors ECLab-News/src/render.py; the interaction model
 * (tabs, filtering, scroll-spy, sliding indicator) mirrors pandoc/template.html.
 */
(function () {
  'use strict';

  // Journal data lives under /journal/data/, pushed there by the external
  // ECLab-News pipeline. Absolute path so it resolves correctly whether the
  // journal shell is served from /journal/ or previewed from the repo root.
  var DATA_BASE = '/journal/data/';
  var REC_KEY = '⭐ 推荐阅读';
  var DETAILS_KEY = '文献详情';
  // Homepage accent: extracted from the ECLab logo's dominant warm hue (~22°),
  // saturated for use as a UI accent. Issue pages override this with their own
  // accent_color from the data; this is the static default + home-page color.
  var DEFAULT_ACCENT = 'hsl(22, 55%, 43%)';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var content = document.getElementById('content');
  var sidebar = document.getElementById('toc-sidebar');
  var overlay = document.getElementById('toc-overlay');
  var tocToggle = document.getElementById('toc-toggle');
  var headerTitle = document.getElementById('header-title');

  var manifestCache = null;
  var issueController = null; // teardown for the active issue view's listeners

  // ── helpers ───────────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'dataset') Object.keys(attrs[k]).forEach(function (d) { node.dataset[d] = attrs[k][d]; });
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function val(article, key, placeholder) {
    var v = (article[key] == null ? '' : String(article[key])).trim();
    return v && v !== '0' ? v : placeholder;
  }

  function upperOrCapitalize(s) {
    if (!s) return s;
    return s.toUpperCase() === s ? s : (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
  }

  function articleKey(a) {
    return (val(a, 'doi', '').toLowerCase()) || (val(a, 'title', '').toLowerCase());
  }

  function articleTitle(a) { return val(a, 'title', '标题信息缺失'); }

  function articleUrl(a) {
    var u = val(a, 'url', '');
    var doi = val(a, 'doi', '');
    return u || (doi ? 'https://doi.org/' + doi : '');
  }

  function publicationInfo(a) {
    var pub = val(a, 'publish_info', '');
    if (pub) return pub;
    return val(a, 'journal', '期刊信息缺失');
  }

  function articleCategories(a) {
    var text = val(a, 'category', '') || val(a, 'matched_keywords', '');
    var out = [];
    text.split(',').forEach(function (item) {
      var t = item.trim();
      if (t) out.push(upperOrCapitalize(t));
    });
    return out;
  }

  function escapeText(s) { return s == null ? '' : String(s); }

  // ── grouping (mirrors render.py / articles.py) ──────────────────────────────

  function uniqueArticles(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      var k = articleKey(r);
      if (!k || seen[k]) return;
      seen[k] = true; out.push(r);
    });
    return out;
  }

  function recommendedArticles(rows) {
    var seen = {}, out = [];
    rows.forEach(function (r) {
      if (!r.recommended) return;
      var k = articleKey(r);
      if (!k || seen[k]) return;
      seen[k] = true; out.push(r);
    });
    return out;
  }

  function categorizeArticles(rows) {
    var map = {}, seen = {};
    rows.forEach(function (r) {
      if (!val(r, 'title', '')) return;
      var cats = articleCategories(r);
      if (!cats.length) cats = ['Uncategorized'];
      cats.forEach(function (cat) {
        var key = cat + '\u0000' + articleKey(r);
        if (seen[key]) return;
        seen[key] = true;
        (map[cat] = map[cat] || []).push(r);
      });
    });
    var keys = Object.keys(map).filter(function (k) { return k !== 'Uncategorized'; });
    keys.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    if (map.Uncategorized) keys.push('Uncategorized');
    return keys.map(function (k) { return { name: k, articles: map[k] }; });
  }

  function categorizeByJournal(rows) {
    var map = {}, seen = {};
    rows.forEach(function (r) {
      if (!val(r, 'title', '')) return;
      var journal = val(r, 'journal', 'Unknown Journal');
      var k = articleKey(r);
      if (!k || seen[k]) return;
      seen[k] = true;
      (map[journal] = map[journal] || []).push(r);
    });
    return Object.keys(map).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    }).map(function (k) { return { name: k, articles: map[k] }; });
  }

  // ── data loading ────────────────────────────────────────────────────────────

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function loadManifest() {
    if (manifestCache) return Promise.resolve(manifestCache);
    return fetchJSON(DATA_BASE + 'manifest.json').then(function (m) {
      manifestCache = m; return m;
    });
  }

  // ── accent ────────────────────────────────────────────────────────────────

  function setAccent(color) {
    document.documentElement.style.setProperty('--accent', color || DEFAULT_ACCENT);
  }

  // ── progress bar ────────────────────────────────────────────────────────────

  var pb = document.getElementById('progress-bar');
  function updateProgress() {
    if (!pb) return;
    // In issue view the content card scrolls internally; on the home page the
    // window scrolls. Track whichever is the active scroll container.
    var h, pos;
    if (document.body.classList.contains('issue-view')) {
      h = content.scrollHeight - content.clientHeight;
      pos = content.scrollTop;
    } else {
      h = document.documentElement.scrollHeight - window.innerHeight;
      pos = window.scrollY;
    }
    pb.style.width = (h > 0 ? pos / h * 100 : 0) + '%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  if (content) content.addEventListener('scroll', updateProgress, { passive: true });

  var appbar = document.getElementById('issue-appbar');
  var appbarTitle = document.getElementById('appbar-title');
  var appbarDrawerBtn = document.getElementById('appbar-drawer');
  var issueSearch = document.getElementById('issue-search');
  var searchClear = document.getElementById('search-clear');

  // ── view teardown ───────────────────────────────────────────────────────────

  function teardownIssue() {
    if (issueController) { issueController.destroy(); issueController = null; }
    if (sidebar) { sidebar.hidden = true; sidebar.classList.remove('open'); }
    if (overlay) overlay.classList.remove('open');
    if (tocToggle) { tocToggle.hidden = true; tocToggle.classList.remove('visible'); }
    // hide issue appbar, restore home header
    if (appbar) appbar.hidden = true;
    document.body.classList.remove('issue-view');
    document.body.classList.remove('sidebar-collapsed');
    document.body.classList.remove('hide-selected');
    document.body.classList.remove('view-journals');
    if (issueSearch) { issueSearch.value = ''; applySearch(''); }
  }

  function showState(msg, isError) {
    content.innerHTML = '';
    if (isError) {
      content.appendChild(el('div', { class: 'state-msg error', text: msg }));
      return;
    }
    // M3 Expressive contained loading indicator: a morphing shape + label
    var wrap = el('div', { class: 'state-msg loading-state' });
    wrap.appendChild(el('div', { class: 'm3-loader', 'aria-hidden': 'true' }));
    wrap.appendChild(el('div', { class: 'loading-label', text: msg }));
    content.appendChild(wrap);
  }

  // ── router ──────────────────────────────────────────────────────────────────

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h) return { route: 'home' };
    var parts = h.split('/');
    if (parts[0] === 'issue' && parts[1]) return { route: 'issue', label: decodeURIComponent(parts[1]) };
    return { route: 'home' };
  }

  function route() {
    teardownIssue();
    window.scrollTo(0, 0);
    var r = parseHash();
    if (r.route === 'issue') renderIssue(r.label);
    else renderHome();
  }

  // Wrap a route change in the View Transitions API for an M3 shared-axis feel
  // (CSS in style.css drives the slide+fade). Falls back to a plain swap where
  // the API is unavailable or motion is reduced.
  function navigate() {
    if (reduceMotion || !document.startViewTransition) { route(); return; }
    var next = parseHash().route;
    document.documentElement.dataset.vtTo = next;
    var vt = document.startViewTransition(route);
    vt.finished.then(function () {
      delete document.documentElement.dataset.vtTo;
    }).catch(function () {
      delete document.documentElement.dataset.vtTo;
    });
  }

  // ── landing page ──────────────────────────────────────────────────────────

  function renderHome() {
    setAccent(DEFAULT_ACCENT);
    document.title = '东西情报 · ECLab News';
    if (headerTitle) headerTitle.textContent = '东西情报';
    showState('加载中…');
    loadManifest().then(function (m) {
      var issues = (m.issues || []).slice();
      content.innerHTML = '';

      content.appendChild(el('div', { class: 'landing-intro reveal', html:
        '《东西情报》是<a class="intro-link" href="/">浙江大学情绪和文化实验室</a>创办的文献汇编，' +
        '收集情绪心理学领域每周的最新文章与科研进展，按关键词与期刊分类并配以中文概要。' }));

      if (!issues.length) {
        content.appendChild(el('div', { class: 'state-msg', text: '暂无期刊。' }));
        return;
      }

      // Featured = newest issue
      var featured = issues[0];
      content.appendChild(featuredCard(featured));

      // Group all issues by year (including the featured one)
      var byYear = {};
      issues.forEach(function (it) {
        var y = it.year || (it.start ? it.start.slice(0, 4) : '其他');
        (byYear[y] = byYear[y] || []).push(it);
      });
      Object.keys(byYear).sort(function (a, b) { return String(b).localeCompare(String(a)); }).forEach(function (y) {
        var group = el('div', { class: 'year-group reveal' });
        group.appendChild(el('div', { class: 'year-heading', text: y + ' 年' }));
        var grid = el('div', { class: 'issue-grid' });
        byYear[y].forEach(function (it) { grid.appendChild(issueCard(it)); });
        group.appendChild(grid);
        content.appendChild(group);
      });
      // Content was appended asynchronously after the manifest resolved, so the
      // reveal observer set up at boot never saw these nodes. Re-run it now.
      initReveal();
    }).catch(function (err) {
      showState('无法加载期刊列表：' + err.message, true);
    });
  }

  function issueMetaLine(it) {
    var range = it.start && it.end ? it.start + ' – ' + it.end : '';
    var bits = [];
    if (range) bits.push(range);
    if (it.count != null) bits.push(it.count + ' 篇');
    if (it.recommended_count) bits.push('推荐 ' + it.recommended_count);
    return bits.join(' · ');
  }

  function featuredCard(it) {
    var a = el('a', { class: 'featured-issue', href: '#/issue/' + encodeURIComponent(it.label) });
    a.appendChild(el('span', { class: 'featured-badge', text: '最新一期' }));
    a.appendChild(el('div', { class: 'featured-title', text: it.title || it.label }));
    a.appendChild(el('div', { class: 'featured-meta', text: issueMetaLine(it) }));
    return a;
  }

  function issueCard(it) {
    var a = el('a', { class: 'issue-card', href: '#/issue/' + encodeURIComponent(it.label) });
    a.appendChild(el('div', { class: 'ic-title', text: it.title || it.label }));
    a.appendChild(el('div', { class: 'ic-meta', text: issueMetaLine(it) }));
    return a;
  }

  // ── issue view ──────────────────────────────────────────────────────────

  function renderIssue(label) {
    showState('加载中…');
    fetchJSON(DATA_BASE + 'issues/' + encodeURIComponent(label) + '.json')
      .then(function (issue) {
        setAccent(issue.accent_color || DEFAULT_ACCENT);
        document.title = (issue.title || label) + ' · ECLab News';
        if (headerTitle) headerTitle.textContent = issue.project || '东西情报';
        if (appbarTitle) appbarTitle.textContent = issue.project || '东西情报';
        // swap to issue app-bar layout
        if (appbar) appbar.hidden = false;
        document.body.classList.add('issue-view');
        buildIssueDOM(issue);
        issueController = wireIssueInteractions();
      })
      .catch(function (err) {
        showState('无法加载这一期（' + label + '）：' + err.message, true);
      });
  }

  function tagsFor(article, isRec) {
    var frag = document.createDocumentFragment();
    if (isRec) {
      frag.appendChild(el('span', { class: 'tag tag-rec', dataset: { tag: REC_KEY }, text: REC_KEY }));
    }
    var journal = val(article, 'journal', '');
    if (journal) {
      frag.appendChild(el('span', { class: 'tag tag-journal', dataset: { tag: journal }, text: journal }));
    }
    articleCategories(article).forEach(function (kw) {
      frag.appendChild(el('span', { class: 'tag tag-keyword', dataset: { tag: kw }, text: kw }));
    });
    return frag;
  }

  function indexItem(article, anchors, recSet) {
    var anchor = anchors[articleKey(article)] || '';
    var isRec = recSet[val(article, 'doi', '').toLowerCase()] === true;
    var item = el('div', { class: 'article-index-item', dataset: { anchor: anchor } });
    if (isRec) item.dataset.recommended = 'true';

    var titleWrap = el('div', { class: 'article-index-title' });
    var link = el('a', { href: '#' + anchor, text: articleTitle(article) });
    link.addEventListener('click', function (e) {
      e.preventDefault();
      scrollToAnchor(anchor);
    });
    titleWrap.appendChild(link);

    var tagsWrap = el('div', { class: 'article-index-tags' });
    tagsWrap.appendChild(tagsFor(article, isRec));

    var summary = el('div', { class: 'article-index-summary', text: val(article, 'summary', '摘要或总结缺失') });

    item.appendChild(titleWrap);
    item.appendChild(tagsWrap);
    item.appendChild(summary);
    return item;
  }

  function articleList(articles, anchors, recSet) {
    var frag = document.createDocumentFragment();
    articles.forEach(function (a) { frag.appendChild(indexItem(a, anchors, recSet)); });
    return frag;
  }

  function buildIssueDOM(issue) {
    var rows = (issue.articles || []).filter(function (r) {
      return String(r.summary || '').trim() !== '0';
    });
    var list = uniqueArticles(rows);
    var anchors = {};
    list.forEach(function (a, i) {
      anchors[articleKey(a)] = 'article-' + (i + 1);
    });
    var keywordCats = categorizeArticles(rows);
    var journalCats = categorizeByJournal(rows);
    var recommended = recommendedArticles(rows);
    var recSet = {};
    recommended.forEach(function (a) { recSet[val(a, 'doi', '').toLowerCase()] = true; });

    content.innerHTML = '';

    // Back link + title
    var back = el('a', { class: 'back-link', href: '#/', text: '← 返回所有期刊' });
    content.appendChild(back);
    content.appendChild(el('div', { class: 'issue-title', text: issue.title || issue.label }));
    var metaBits = [];
    if (issue.start && issue.end) metaBits.push(issue.start + ' – ' + issue.end);
    metaBits.push(list.length + ' 篇文献');
    if (recommended.length) metaBits.push('推荐 ' + recommended.length + ' 篇');
    content.appendChild(el('div', { class: 'issue-meta', text: metaBits.join(' · ') }));

    content.appendChild(el('h2', { class: 'section-h', text: '索引' }));

    // Keyword index
    var kwSection = el('div', { class: 'index-section', dataset: { view: 'keywords' } });
    if (recommended.length) kwSection.appendChild(categorySection(REC_KEY, recommended, 'keywords', anchors, recSet, true));
    keywordCats.forEach(function (c) {
      kwSection.appendChild(categorySection(c.name, c.articles, 'keywords', anchors, recSet, false));
    });
    content.appendChild(kwSection);

    // Journal index (hidden initially)
    var jnSection = el('div', { class: 'index-section', dataset: { view: 'journals' } });
    jnSection.style.display = 'none';
    if (recommended.length) jnSection.appendChild(categorySection(REC_KEY, recommended, 'journals', anchors, recSet, true));
    journalCats.forEach(function (c) {
      jnSection.appendChild(categorySection('📖 ' + c.name, c.articles, 'journals', anchors, recSet, false, c.name));
    });
    content.appendChild(jnSection);

    content.appendChild(el('hr'));

    // Details
    var details = el('h2', { class: 'section-h', id: '文献详情', text: '文献详情' });
    content.appendChild(details);
    list.forEach(function (article, i) {
      var card = detailCard(article, i + 1, recSet);
      // cap stagger index so long issues don't pile up long delays
      card.style.setProperty('--enter-i', Math.min(i, 8));
      content.appendChild(card);
    });
  }

  function categorySection(label, articles, view, anchors, recSet, isRec, journalName) {
    var attrs = { class: 'category-section' };
    var section = el('div', attrs);
    if (view === 'keywords') section.dataset.category = label;
    else section.dataset.journal = journalName != null ? journalName : label;
    var heading = isRec ? label : (view === 'keywords' ? '关键词：' + label : label);
    section.appendChild(el('h3', { class: 'category-h', text: heading }));
    section.appendChild(articleList(articles, anchors, recSet));
    return section;
  }

  function detailCard(article, index, recSet) {
    var anchor = 'article-' + index;
    var isRec = recSet[val(article, 'doi', '').toLowerCase()] === true;
    var card = el('div', { class: 'article-card', id: anchor });
    // click anywhere on the card (except real links) scrolls it to the top
    card.addEventListener('click', function (e) {
      if (e.target.closest('a')) return; // don't hijack link clicks
      scrollToAnchor(anchor);
    });
    card.appendChild(el('h3', { text: index + '. ' + articleTitle(article) }));
    // tag row (recommended + journal + keywords), mirrors the index; clickable
    var tagsWrap = el('div', { class: 'article-index-tags article-card-tags' });
    tagsWrap.appendChild(tagsFor(article, isRec));
    card.appendChild(tagsWrap);
    card.appendChild(fieldP('作者', val(article, 'authors', '作者信息缺失')));

    var link = articleUrl(article);
    var linkP = el('p', {}, [el('strong', { text: '链接' })]);
    if (link) linkP.appendChild(el('a', { href: link, target: '_blank', rel: 'noopener', text: link }));
    else linkP.appendChild(document.createTextNode('链接缺失'));
    card.appendChild(linkP);

    card.appendChild(fieldP('发表信息', publicationInfo(article)));
    card.appendChild(fieldP('关键词', val(article, 'keywords', '关键词缺失')));

    var abs = el('p', { class: 'abstract' }, [el('strong', { text: '摘要' })]);
    abs.appendChild(document.createTextNode(val(article, 'abstract', '摘要缺失')));
    card.appendChild(abs);
    return card;
  }

  function fieldP(label, text) {
    return el('p', {}, [el('strong', { text: label }), document.createTextNode(escapeText(text))]);
  }

  function scrollToAnchor(anchor) {
    var target = document.getElementById(anchor);
    if (!target) return;
    target.scrollIntoView(reduceMotion ? { block: 'start' } : { behavior: 'smooth', block: 'start' });
  }

  // ── search ──────────────────────────────────────────────────────────────────

  // Highlight all occurrences of `query` in text nodes inside `node`.
  function highlightNode(node, query) {
    if (node.nodeType === 3) { // text node
      var idx = node.nodeValue.toLowerCase().indexOf(query);
      if (idx === -1) return;
      var mark = document.createElement('mark');
      mark.className = 'search-hl';
      var after = node.splitText(idx);
      after.splitText(query.length);
      mark.appendChild(after.cloneNode(true));
      after.parentNode.replaceChild(mark, after);
    } else if (node.nodeType === 1 && node.nodeName !== 'MARK') {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) { highlightNode(c, query); });
    }
  }

  // Remove all <mark class="search-hl"> highlights from node.
  function clearHighlights(node) {
    var marks = node.querySelectorAll('mark.search-hl');
    marks.forEach(function (m) {
      var parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
  }

  function applySearch(q) {
    var query = q.trim().toLowerCase();
    var cards = content.querySelectorAll('.article-card');
    var indexSections = content.querySelectorAll('.index-section');
    var sectionH = content.querySelectorAll('h2.section-h');
    var hr = content.querySelector('hr');
    if (!cards.length) return;

    cards.forEach(function (c) { clearHighlights(c); });
    var oldTagSec = content.querySelector('.search-tag-section');
    if (oldTagSec) oldTagSec.parentNode.removeChild(oldTagSec);
    var oldNoResult = content.querySelector('.search-no-result');
    if (oldNoResult) oldNoResult.parentNode.removeChild(oldNoResult);

    if (!query) {
      cards.forEach(function (c) { c.style.display = ''; });
      indexSections.forEach(function (s) { s.style.display = ''; });
      sectionH.forEach(function (h) {
        h.style.display = '';
        if (h.id === '文献详情') h.textContent = '文献详情'; // reset from "搜索结果"
      });
      if (hr) hr.style.display = '';
      if (searchClear) searchClear.hidden = true;
      return;
    }

    if (searchClear) searchClear.hidden = false;
    indexSections.forEach(function (s) { s.style.display = 'none'; });
    if (hr) hr.style.display = 'none';
    sectionH.forEach(function (h) { h.style.display = 'none'; });

    // collect matching tags (keyword categories and journals)
    var matchedTags = [], seenTags = {};
    content.querySelectorAll('.category-section').forEach(function (cs) {
      var cat = cs.getAttribute('data-category') || cs.getAttribute('data-journal');
      if (cat && !seenTags[cat] && cat.toLowerCase().indexOf(query) !== -1) {
        seenTags[cat] = true;
        matchedTags.push({
          cat: cat,
          cls: cs.getAttribute('data-journal') ? 'tag tag-journal' : 'tag tag-keyword',
          isJournal: !!cs.getAttribute('data-journal')
        });
      }
    });

    var any = false;
    cards.forEach(function (c) {
      var match = c.textContent.toLowerCase().indexOf(query) !== -1;
      c.style.display = match ? '' : 'none';
      if (match) { any = true; highlightNode(c, query); }
    });

    // Show "搜索结果" heading
    var detailsH = Array.prototype.find.call(
      content.querySelectorAll('h2.section-h'), function (h) { return h.id === '文献详情'; });
    if (detailsH) {
      detailsH.style.display = '';
      detailsH.textContent = '搜索结果';
    }

    // Build tag section AFTER heading (not before)
    if (matchedTags.length && detailsH) {
      var tagSec = el('div', { class: 'search-tag-section' });
      var tagsWrap = el('div', { class: 'article-index-tags' });
      matchedTags.forEach(function (t) {
        var tagEl = el('span', { class: t.cls, dataset: { tag: t.cat }, text: t.cat });
        // Prevent the search input from blurring (which would tear down these
        // chips via applySearch('') before the click can fire and navigate).
        tagEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
        tagEl.addEventListener('click', function (e) {
          e.preventDefault();
          // clear search to restore normal index view
          if (issueSearch) issueSearch.value = '';
          applySearch('');
          // navigate directly via the controller after clearing search
          var targetView = t.isJournal ? 'journals' : 'keywords';
          setTimeout(function () {
            if (issueController && issueController.navigateToTag) {
              issueController.navigateToTag(t.cat, targetView);
            }
          }, 50);
        });
        tagsWrap.appendChild(tagEl);
      });
      tagSec.appendChild(tagsWrap);
      // Insert after the heading
      detailsH.parentNode.insertBefore(tagSec, detailsH.nextSibling);
    }

    if (!any) {
      content.appendChild(el('div', { class: 'state-msg search-no-result', text: '未找到匹配文献' }));
    }

    // Scroll to top of results when search is active
    if (query && detailsH) {
      detailsH.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  if (issueSearch) {
    issueSearch.addEventListener('input', function () { applySearch(this.value); });
    issueSearch.addEventListener('search', function () { applySearch(this.value); });
    // blur: restore normal view but keep query in bar
    issueSearch.addEventListener('blur', function () {
      var q = this.value.trim();
      if (q) applySearch('');
    });
    // focus: re-apply preserved query immediately
    issueSearch.addEventListener('focus', function () {
      var q = this.value.trim();
      if (q) applySearch(q);
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', function () {
      if (issueSearch) { issueSearch.value = ''; issueSearch.focus(); }
      applySearch('');
    });
  }

  // ── issue interactions (ported from template.html) ──────────────────────────

  function wireIssueInteractions() {
    var nav = document.getElementById('toc-nav');
    var viewToggle = document.getElementById('view-toggle');
    var hideToggle = document.getElementById('hide-toggle');
    var viewPillThumb = document.getElementById('view-pill-thumb');
    var hidePillThumb = document.getElementById('hide-pill-thumb');
    var viewPills = viewToggle.querySelectorAll('.sidebar-pill');
    var hidePills = hideToggle.querySelectorAll('.sidebar-pill');
    var railView = document.getElementById('rail-view');
    var railHide = document.getElementById('rail-hide');
    var railDetails = document.getElementById('rail-details');
    var detailsLink = document.getElementById('details-link');

    var keywordSections = content.querySelectorAll('.index-section[data-view="keywords"]');
    var journalSections = content.querySelectorAll('.index-section[data-view="journals"]');

    var currentView = 'keywords';
    var currentCategory = null;
    var hideMode = false;

    var navTrack = null, kwUl = null, jnUl = null, linkByKey = {};
    var indicator = el('div', { class: 'toc-indicator' });
    var listeners = [];

    function on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      listeners.push([target, type, fn, opts]);
    }

    // Reset sidebar to default pill state
    sidebar.hidden = false;
    tocToggle.hidden = false;
    tocToggle.classList.add('visible');
    viewPills.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === 'keywords'); });
    hidePills.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-hide') === 'false'); });

    // Keep the icon rail in sync with the segmented switches
    function syncRail() {
      document.body.classList.toggle('view-journals', currentView === 'journals');
      document.body.classList.toggle('hide-selected', hideMode);
    }
    syncRail();

    function movePillThumb(thumb, activeBtn, row) {
      if (!thumb || !activeBtn) return;
      var rowRect = row.getBoundingClientRect();
      var btnRect = activeBtn.getBoundingClientRect();
      // Some Android WebViews (e.g. DuckDuckGo) can report 0-width rects while
      // the panel is animating/off-screen. Ignore those so we don't shrink the
      // thumb to 0 and leave the active pill's white text on a bare background;
      // the CSS default width keeps it visible until a real measurement lands.
      if (btnRect.width === 0 || rowRect.width === 0) return;
      thumb.style.width = btnRect.width + 'px';
      thumb.style.transform = 'translateX(' + (btnRect.left - rowRect.left - 3) + 'px)';
    }
    function initPillThumb(thumb, row, activeBtn) {
      if (!thumb || !activeBtn) return;
      thumb.classList.add('no-spring');
      movePillThumb(thumb, activeBtn, row);
      void thumb.offsetWidth;
      thumb.classList.remove('no-spring');
    }

    function fadeSection(node, show) {
      node.classList.remove('panel-fade-in', 'panel-fade-out');
      if (show) { node.style.display = ''; node.classList.add('panel-fade-in'); }
      else {
        node.classList.add('panel-fade-out');
        var d = reduceMotion ? 0 : 200;
        setTimeout(function () { node.style.display = 'none'; node.classList.remove('panel-fade-out'); }, d);
      }
    }

    function attr() { return currentView === 'keywords' ? 'data-category' : 'data-journal'; }
    function activeSections() { return currentView === 'keywords' ? keywordSections : journalSections; }
    function activeNavUl() { return currentView === 'keywords' ? kwUl : jnUl; }

    function buildNavList(view) {
      var ul = el('ul', { 'data-nav-view': view });
      var a = view === 'keywords' ? 'data-category' : 'data-journal';
      var viewSections = view === 'keywords' ? keywordSections : journalSections;
      var seen = [];
      viewSections.forEach(function (s) {
        s.querySelectorAll('.category-section[' + a + ']').forEach(function (cs) {
          var v = cs.getAttribute(a);
          if (v && seen.indexOf(v) === -1) seen.push(v);
        });
      });
      seen.sort(function (x, y) {
        if (x === REC_KEY) return -1;
        if (y === REC_KEY) return 1;
        return x.toLowerCase().localeCompare(y.toLowerCase());
      });
      seen.forEach(function (cat) {
        var li = el('li');
        var link = el('a', { href: '#', text: cat, 'data-filter': cat });
        on(link, 'click', function (e) { e.preventDefault(); onNavClick(cat); });
        li.appendChild(link);
        ul.appendChild(li);
        if (view === currentView) linkByKey[cat] = link;
      });
      return ul;
    }

    function updateNavTrackPosition() {
      if (!navTrack) return;
      navTrack.style.transform = currentView === 'keywords' ? 'translateX(0)' : 'translateX(-50%)';
    }

    function syncLinkByKey() {
      linkByKey = {};
      var ul = activeNavUl();
      if (!ul) return;
      ul.querySelectorAll('a[data-filter]').forEach(function (a) {
        linkByKey[a.getAttribute('data-filter')] = a;
      });
      indicator.classList.add('no-anim');
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(0)';
      activeNavUl().appendChild(indicator);
      void indicator.offsetWidth;
      indicator.classList.remove('no-anim');
    }

    function moveIndicator(key, animate) {
      var link = key ? linkByKey[key] : null;
      if (!link) { indicator.style.opacity = '0'; return; }
      var li = link.parentElement;
      var wasHidden = indicator.style.opacity === '' || indicator.style.opacity === '0';
      // When the pill is hidden (or animation is suppressed), snap straight to the
      // target position/size with no transition, then just fade it in — this avoids
      // the "appear at top then slide/stack into place" glitch.
      if (!animate || reduceMotion || wasHidden) {
        indicator.classList.add('no-anim');
        indicator.style.transform = 'translateY(' + li.offsetTop + 'px)';
        indicator.style.height = li.offsetHeight + 'px';
        void indicator.offsetWidth;
        indicator.classList.remove('no-anim');
        indicator.style.opacity = '1';
        return;
      }
      indicator.style.opacity = '1';
      indicator.style.transform = 'translateY(' + li.offsetTop + 'px)';
      indicator.style.height = li.offsetHeight + 'px';
    }

    function setActive(key, animate) {
      currentCategory = key;
      [kwUl, jnUl].forEach(function (ul) {
        if (!ul) return;
        ul.querySelectorAll('a[data-filter]').forEach(function (a) {
          var on2 = a.getAttribute('data-filter') === key;
          a.classList.toggle('active', on2);
          if (on2) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
        });
      });
      // permanent 文献详情 footer link (rail icon stays un-highlighted)
      var detailsActive = key === DETAILS_KEY;
      if (detailsLink) detailsLink.classList.toggle('active', detailsActive);
      moveIndicator(key, animate !== false);
    }

    function applyFilter() {
      var filterCat = (currentCategory === DETAILS_KEY) ? null : currentCategory;
      activeSections().forEach(function (view) {
        view.querySelectorAll('.category-section').forEach(function (s) {
          var key = s.getAttribute(attr());
          var shouldShow = !hideMode || !filterCat || key === filterCat;
          var wasHidden = s.style.display === 'none';
          if (shouldShow) {
            s.style.display = '';
            if (wasHidden && !reduceMotion) { s.classList.remove('fade-in'); void s.offsetWidth; s.classList.add('fade-in'); }
          } else { s.style.display = 'none'; s.classList.remove('fade-in'); }
        });
      });
    }

    // programmatic scroll guard
    var programmatic = false, settleTimer = null;
    function scrollToTarget(node) {
      if (!node) return;
      if (reduceMotion) { node.scrollIntoView({ block: 'start' }); return; }
      programmatic = true;
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if ('onscrollend' in window) {
        content.addEventListener('scrollend', function () { programmatic = false; }, { once: true });
      }
      function onSettle() {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () { programmatic = false; content.removeEventListener('scroll', onSettle); }, 140);
      }
      on(content, 'scroll', onSettle, { passive: true });
    }
    function scrollToKey(key) {
      if (key === DETAILS_KEY) { scrollToTarget(document.getElementById('文献详情')); return; }
      var selector = '.category-section[' + attr() + '="' + CSS.escape(key) + '"]';
      var found = null;
      activeSections().forEach(function (v) { if (!found) found = v.querySelector(selector); });
      scrollToTarget(found);
    }
    ['wheel', 'touchstart', 'keydown'].forEach(function (e) {
      on(content, e, function () { programmatic = false; }, { passive: true });
    });

    function onNavClick(cat) {
      if (hideMode && cat === currentCategory && cat !== DETAILS_KEY) { setActive(null); applyFilter(); return; }
      setActive(cat);
      if (cat !== DETAILS_KEY) applyFilter();
      scrollToKey(cat);
    }

    function switchView(view, onComplete) {
      if (view === currentView) { if (onComplete) onComplete(); return; }
      var oldSections = activeSections();
      currentView = view;
      var newSections = activeSections();
      oldSections.forEach(function (s) { fadeSection(s, false); });
      newSections.forEach(function (s) {
        fadeSection(s, true);
        s.querySelectorAll('.category-section').forEach(function (cs) { cs.style.display = ''; });
        s.querySelectorAll('.article-index-item').forEach(function (it) { it.style.display = ''; });
      });
      updateNavTrackPosition();
      syncLinkByKey();
      currentCategory = null;
      hideMode = false;
      hidePills.forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-hide') === 'false'); });
      if (hidePills[0]) movePillThumb(hidePillThumb, hidePills[0], hideToggle);
      syncRail();
      setActive(null, false);
      var delay = reduceMotion ? 0 : 210;
      setTimeout(function () { if (onComplete) onComplete(); requestAnimationFrame(spy); }, delay);
    }

    viewPills.forEach(function (btn) {
      on(btn, 'click', function () {
        var view = this.getAttribute('data-view');
        if (view === currentView) return;
        viewPills.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        movePillThumb(viewPillThumb, this, viewToggle);
        switchView(view);
      });
    });

    hidePills.forEach(function (btn) {
      on(btn, 'click', function () {
        var wantHide = this.getAttribute('data-hide') === 'true';
        if (wantHide === hideMode) return;
        hidePills.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        movePillThumb(hidePillThumb, this, hideToggle);
        hideMode = wantHide;
        if (!hideMode) setActive(null);
        applyFilter();
        syncRail();
      });
    });

    // ── Icon rail: act directly on the same state as the segmented switches ──
    function selectView(view) {
      if (view === currentView) return;
      viewPills.forEach(function (b) {
        var match = b.getAttribute('data-view') === view;
        b.classList.toggle('active', match);
        if (match) movePillThumb(viewPillThumb, b, viewToggle);
      });
      switchView(view);
      syncRail();
    }
    function setHideMode(want) {
      if (want === hideMode) return;
      hidePills.forEach(function (b) {
        var match = (b.getAttribute('data-hide') === 'true') === want;
        b.classList.toggle('active', match);
        if (match) movePillThumb(hidePillThumb, b, hideToggle);
      });
      hideMode = want;
      if (!hideMode) setActive(null);
      applyFilter();
      syncRail();
    }
    if (railView) on(railView, 'click', function () {
      selectView(currentView === 'keywords' ? 'journals' : 'keywords');
    });
    if (railHide) on(railHide, 'click', function () { setHideMode(!hideMode); });
    // permanent 文献详情 entry (footer link + rail icon): jump to the details section
    function goToDetails() { onNavClick(DETAILS_KEY); }
    if (detailsLink) on(detailsLink, 'click', goToDetails);
    if (railDetails) on(railDetails, 'click', goToDetails);

    function spy() {
      if (programmatic || hideMode || !nav) return;
      // threshold sits just inside the content card's top edge, so the section
      // whose heading has just scrolled to the top is the one marked active
      var line = content.getBoundingClientRect().top + 48, a = attr(), current = null;
      activeSections().forEach(function (view) {
        view.querySelectorAll('.category-section[' + a + ']').forEach(function (s) {
          if (s.style.display !== 'none' && s.getBoundingClientRect().top <= line) current = s.getAttribute(a);
        });
      });
      var details = document.getElementById('文献详情');
      if (details && details.getBoundingClientRect().top <= line) current = DETAILS_KEY;
      // bottom of the scroll container ⇒ details
      if (content.scrollTop + content.clientHeight >= content.scrollHeight - 2) current = DETAILS_KEY;
      if (current !== currentCategory) {
        setActive(current);
        scrollNavToTag(current);
      }
    }
    on(content, 'scroll', spy, { passive: true });

    // Scroll the sidebar nav so the given tag is visible.
    // Uses getBoundingClientRect + nav.scrollTo to avoid reflows that break the
    // nav-track transform (scrollIntoView caused that issue).
    function scrollNavToTag(key) {
      if (!key || key === DETAILS_KEY || !linkByKey[key]) return;
      var linkRect = linkByKey[key].getBoundingClientRect();
      var navRect = nav.getBoundingClientRect();
      var linkRelTop = linkRect.top - navRect.top + nav.scrollTop;
      var linkRelBottom = linkRelTop + linkRect.height;
      if (linkRelTop < nav.scrollTop) {
        nav.scrollTo({ top: linkRelTop, behavior: reduceMotion ? 'auto' : 'smooth' });
      } else if (linkRelBottom > nav.scrollTop + nav.clientHeight) {
        nav.scrollTo({ top: linkRelBottom - nav.clientHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }

    // Navigate to a category/journal: switch view if needed, activate it, scroll.
    // Also syncs the view pill + rail. Reused by index tags and search-result chips.
    function navigateToTag(tagValue, targetView) {
      if (!targetView) targetView = currentView;
      function activateAndScroll() { setActive(tagValue); if (hideMode) applyFilter(); scrollToKey(tagValue); scrollNavToTag(tagValue); }
      if (targetView !== currentView) {
        viewPills.forEach(function (b) {
          var match = b.getAttribute('data-view') === targetView;
          b.classList.toggle('active', match);
          if (match) movePillThumb(viewPillThumb, b, viewToggle);
        });
        switchView(targetView, function () { syncRail(); activateAndScroll(); });
      } else { activateAndScroll(); }
    }

    // Clickable tags in the index
    content.querySelectorAll('.tag[data-tag]').forEach(function (tag) {
      on(tag, 'click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var tagValue = this.getAttribute('data-tag');
        var isRec = this.classList.contains('tag-rec');
        var isJournal = this.classList.contains('tag-journal');
        var targetView = isRec ? currentView : (isJournal ? 'journals' : 'keywords');
        navigateToTag(tagValue, targetView);
      });
    });

    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { moveIndicator(currentCategory, false); }); ro.observe(nav); }
    // Re-measure both pill thumbs against the buttons' *current* width. Used on
    // resize and whenever the panel becomes visible (expand / drawer open), so a
    // thumb measured while the panel was collapsed (width 0) gets corrected.
    function repositionPillThumbs() {
      var av = Array.prototype.find.call(viewPills, function (b) { return b.classList.contains('active'); });
      if (av) { viewPillThumb.classList.add('no-spring'); movePillThumb(viewPillThumb, av, viewToggle); void viewPillThumb.offsetWidth; viewPillThumb.classList.remove('no-spring'); }
      var ah = Array.prototype.find.call(hidePills, function (b) { return b.classList.contains('active'); });
      if (ah) { hidePillThumb.classList.add('no-spring'); movePillThumb(hidePillThumb, ah, hideToggle); void hidePillThumb.offsetWidth; hidePillThumb.classList.remove('no-spring'); }
    }
    on(window, 'resize', function () {
      moveIndicator(currentCategory, false);
      if (!document.body.classList.contains('sidebar-collapsed')) repositionPillThumbs();
    });
    // When the panel finishes expanding (its width transition ends), the pills
    // have their final width — re-measure so the thumb isn't left narrow.
    var sidebarPanel = document.getElementById('sidebar-panel');
    if (sidebarPanel) on(sidebarPanel, 'transitionend', function (e) {
      if (e.propertyName !== 'width') return;
      if (document.body.classList.contains('sidebar-collapsed')) return; // collapse: skip
      // expand complete: reposition thumbs with CSS transition so they animate
      // from their old (collapsed) size to the correct target width
      var av = Array.prototype.find.call(viewPills, function (b) { return b.classList.contains('active'); });
      if (av) movePillThumb(viewPillThumb, av, viewToggle);
      var ah = Array.prototype.find.call(hidePills, function (b) { return b.classList.contains('active'); });
      if (ah) movePillThumb(hidePillThumb, ah, hideToggle);
      moveIndicator(currentCategory, false);
    });

    // Build nav
    nav.innerHTML = '';
    navTrack = el('div', { class: 'nav-track' });
    kwUl = buildNavList('keywords');
    jnUl = buildNavList('journals');
    navTrack.appendChild(kwUl);
    navTrack.appendChild(jnUl);
    activeNavUl().appendChild(indicator);
    nav.appendChild(navTrack);
    navTrack.classList.add('no-spring');
    updateNavTrackPosition();
    void navTrack.offsetWidth;
    navTrack.classList.remove('no-spring');
    requestAnimationFrame(function () { moveIndicator(currentCategory, false); });
    requestAnimationFrame(spy);
    requestAnimationFrame(function () {
      var av = Array.prototype.find.call(viewPills, function (b) { return b.classList.contains('active'); });
      initPillThumb(viewPillThumb, viewToggle, av);
      var ah = Array.prototype.find.call(hidePills, function (b) { return b.classList.contains('active'); });
      initPillThumb(hidePillThumb, hideToggle, ah);
    });

    // ── Sidebar toggle: wide (inline collapse) vs narrow (overlay drawer) ──
    // Wide (>900px): toggle body.sidebar-collapsed to hide/show the panel (rail stays)
    // Narrow (≤900px): toggle .open on sidebar + overlay (entire drawer slides in)
    var isNarrow = window.matchMedia('(max-width: 900px)');
    
    function toggleSidebar() {
      if (isNarrow.matches) {
        // narrow: overlay drawer
        var opening = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('open');
        // the drawer's pills only get a reliable measurement once it's on-screen;
        // re-measure the thumbs so the active pill highlight isn't missing/narrow
        if (opening) requestAnimationFrame(function () {
          repositionPillThumbs();
          moveIndicator(currentCategory, false);
        });
      } else {
        // wide: inline collapse
        document.body.classList.toggle('sidebar-collapsed');
      }
    }
    function closeSidebar() {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      document.body.classList.remove('sidebar-collapsed');
    }
    
    // Initialize: wide → expanded (no class), narrow → closed
    if (isNarrow.matches) {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
    
    on(tocToggle, 'click', toggleSidebar);
    if (appbarDrawerBtn) on(appbarDrawerBtn, 'click', toggleSidebar);
    if (overlay) on(overlay, 'click', closeSidebar);

    return {
      navigateToTag: navigateToTag,
      destroy: function () {
        listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
        listeners = [];
        if (ro) ro.disconnect();
        if (nav) nav.innerHTML = '';
      }
    };
  }

  // ── theme (dark / light) ──────────────────────────────────────────────────

  var html = document.documentElement;
  var themeBtns = document.querySelectorAll('.theme-toggle');

  function getPreferredTheme() {
    var stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return 'light';
  }

  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    var label = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
    themeBtns.forEach(function (b) { b.setAttribute('aria-label', label); });
  }

  applyTheme(getPreferredTheme());

  themeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('theme', next); } catch (_) {}
      btn.classList.remove('spinning');
      void btn.offsetWidth;
      btn.classList.add('spinning');
    });
    btn.addEventListener('animationend', function () {
      btn.classList.remove('spinning');
    });
  });

  // ── M3 Expressive scroll-reveal (IntersectionObserver) ──
  function initReveal() {
    if (reduceMotion) {
      document.querySelectorAll('.reveal, .reveal-stagger').forEach(function (el) {
        el.classList.add('revealed');
      });
      return;
    }
    var revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
    if (!revealEls.length) return;
    if (!('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('revealed'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    revealEls.forEach(function (el) { observer.observe(el); });
  }

  // Run reveal on initial load and after each route change
  initReveal();
  var origRoute = route;
  route = function () {
    origRoute();
    requestAnimationFrame(initReveal);
  };

  // ── M3 Expressive back-to-top FAB ──
  (function initBackToTop() {
    var fab = document.getElementById('back-to-top');
    if (!fab) return;

    var SHOW_THRESHOLD = 300;
    var shown = false;

    function getScrollPos() {
      if (document.body.classList.contains('issue-view')) {
        return content ? content.scrollTop : 0;
      }
      return window.scrollY || 0;
    }

    function setVisible(visible) {
      if (visible === shown) return;
      shown = visible;
      if (visible) {
        fab.hidden = false;
        fab.classList.remove('fab-exit');
        if (!reduceMotion) fab.classList.add('fab-enter');
      } else {
        fab.classList.remove('fab-enter');
        if (reduceMotion) { fab.hidden = true; }
        else { fab.classList.add('fab-exit'); }
      }
    }

    fab.addEventListener('animationend', function (e) {
      if (e.animationName === 'fab-spring-out') {
        fab.hidden = true;
        fab.classList.remove('fab-exit');
      }
    });

    fab.addEventListener('click', function () {
      var behavior = reduceMotion ? 'auto' : 'smooth';
      if (document.body.classList.contains('issue-view')) {
        if (content) content.scrollTo({ top: 0, behavior: behavior });
      } else {
        window.scrollTo({ top: 0, behavior: behavior });
      }
    });

    function check() { setVisible(getScrollPos() > SHOW_THRESHOLD); }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { check(); ticking = false; });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    if (content) content.addEventListener('scroll', onScroll, { passive: true });

    // Re-check after route changes (scroll position resets)
    var prevOrigRoute = origRoute;
    var origRoute2 = route;
    route = function () {
      origRoute2();
      requestAnimationFrame(function () { setVisible(false); check(); });
    };

    // Initial check
    if (getScrollPos() > SHOW_THRESHOLD) setVisible(true);
  })();

  // ── boot ────────────────────────────────────────────────────────────────────

  window.addEventListener('hashchange', navigate);
  route();
})();
