/* ECLab News — client-side SPA
 * Renders the journal site from JSON data:
 *   data/manifest.json          → landing page (issues grouped by year)
 *   data/issues/<label>.json    → one weekly issue (index + details + filtering)
 * Grouping logic mirrors ECLab-News/src/render.py; the interaction model
 * (tabs, filtering, scroll-spy, sliding indicator) mirrors pandoc/template.html.
 */
(function () {
  'use strict';

  var DATA_BASE = 'data/';
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
  window.addEventListener('scroll', function () {
    if (!pb) return;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    pb.style.width = (h > 0 ? window.scrollY / h * 100 : 0) + '%';
  }, { passive: true });

  // ── view teardown ───────────────────────────────────────────────────────────

  function teardownIssue() {
    if (issueController) { issueController.destroy(); issueController = null; }
    if (sidebar) { sidebar.hidden = true; sidebar.classList.remove('open'); }
    if (overlay) overlay.classList.remove('open');
    if (tocToggle) { tocToggle.hidden = true; tocToggle.classList.remove('visible'); }
  }

  function showState(msg, isError) {
    content.innerHTML = '';
    content.appendChild(el('div', { class: 'state-msg' + (isError ? ' error' : ''), text: msg }));
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

  // ── landing page ──────────────────────────────────────────────────────────

  function renderHome() {
    setAccent(DEFAULT_ACCENT);
    document.title = '东西情报 · ECLab News';
    if (headerTitle) headerTitle.textContent = '东西情报';
    showState('加载中…');
    loadManifest().then(function (m) {
      var issues = (m.issues || []).slice();
      content.innerHTML = '';

      content.appendChild(el('div', { class: 'landing-intro', html:
        '《东西情报》是<strong>浙江大学情绪和文化实验室</strong>创办的文献汇编，' +
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
        var group = el('div', { class: 'year-group' });
        group.appendChild(el('div', { class: 'year-heading', text: y + ' 年' }));
        var grid = el('div', { class: 'issue-grid' });
        byYear[y].forEach(function (it) { grid.appendChild(issueCard(it)); });
        group.appendChild(grid);
        content.appendChild(group);
      });
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
      content.appendChild(detailCard(article, i + 1, recSet));
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
    card.appendChild(el('h3', { text: index + '. ' + articleTitle(article) }));
    if (isRec) {
      card.appendChild(el('p', {}, [el('span', { class: 'rec-flag', text: '⭐ 推荐阅读' })]));
    }
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

  // ── issue interactions (ported from template.html) ──────────────────────────

  function wireIssueInteractions() {
    var tocTitle = document.getElementById('toc-title');
    var nav = document.getElementById('toc-nav');
    var viewToggle = document.getElementById('view-toggle');
    var hideToggle = document.getElementById('hide-toggle');
    var viewPillThumb = document.getElementById('view-pill-thumb');
    var hidePillThumb = document.getElementById('hide-pill-thumb');
    var viewPills = viewToggle.querySelectorAll('.sidebar-pill');
    var hidePills = hideToggle.querySelectorAll('.sidebar-pill');

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
    if (tocTitle) tocTitle.textContent = '关键词 · Keywords';

    function movePillThumb(thumb, activeBtn, row) {
      if (!thumb || !activeBtn) return;
      var rowRect = row.getBoundingClientRect();
      var btnRect = activeBtn.getBoundingClientRect();
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
      seen.push(DETAILS_KEY);
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
        window.addEventListener('scrollend', function () { programmatic = false; }, { once: true });
      }
      function onSettle() {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () { programmatic = false; window.removeEventListener('scroll', onSettle); }, 140);
      }
      on(window, 'scroll', onSettle, { passive: true });
    }
    function scrollToKey(key) {
      if (key === DETAILS_KEY) { scrollToTarget(document.getElementById('文献详情')); return; }
      var selector = '.category-section[' + attr() + '="' + CSS.escape(key) + '"]';
      var found = null;
      activeSections().forEach(function (v) { if (!found) found = v.querySelector(selector); });
      scrollToTarget(found);
    }
    ['wheel', 'touchstart', 'keydown'].forEach(function (e) {
      on(window, e, function () { programmatic = false; }, { passive: true });
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
      if (tocTitle) tocTitle.textContent = view === 'keywords' ? '关键词 · Keywords' : '期刊 · Journals';
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
      });
    });

    function spy() {
      if (programmatic || hideMode || !nav) return;
      var line = 90, a = attr(), current = null;
      activeSections().forEach(function (view) {
        view.querySelectorAll('.category-section[' + a + ']').forEach(function (s) {
          if (s.style.display !== 'none' && s.getBoundingClientRect().top <= line) current = s.getAttribute(a);
        });
      });
      var details = document.getElementById('文献详情');
      if (details && details.getBoundingClientRect().top <= line) current = DETAILS_KEY;
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = DETAILS_KEY;
      if (current !== currentCategory) setActive(current);
    }
    on(window, 'scroll', spy, { passive: true });

    // Clickable tags in the index
    content.querySelectorAll('.tag[data-tag]').forEach(function (tag) {
      on(tag, 'click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var tagValue = this.getAttribute('data-tag');
        var isRec = this.classList.contains('tag-rec');
        var isJournal = this.classList.contains('tag-journal');
        var targetView = isRec ? currentView : (isJournal ? 'journals' : 'keywords');
        function activateAndScroll() { setActive(tagValue); if (hideMode) applyFilter(); scrollToKey(tagValue); }
        if (targetView !== currentView) {
          viewPills.forEach(function (x) { x.classList.remove('active'); });
          viewPills.forEach(function (b) {
            if (b.getAttribute('data-view') === targetView) { b.classList.add('active'); movePillThumb(viewPillThumb, b, viewToggle); }
          });
          switchView(targetView, activateAndScroll);
        } else { activateAndScroll(); }
      });
    });

    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { moveIndicator(currentCategory, false); }); ro.observe(nav); }
    on(window, 'resize', function () {
      moveIndicator(currentCategory, false);
      var av = Array.prototype.find.call(viewPills, function (b) { return b.classList.contains('active'); });
      if (av) { viewPillThumb.classList.add('no-spring'); movePillThumb(viewPillThumb, av, viewToggle); void viewPillThumb.offsetWidth; viewPillThumb.classList.remove('no-spring'); }
      var ah = Array.prototype.find.call(hidePills, function (b) { return b.classList.contains('active'); });
      if (ah) { hidePillThumb.classList.add('no-spring'); movePillThumb(hidePillThumb, ah, hideToggle); void hidePillThumb.offsetWidth; hidePillThumb.classList.remove('no-spring'); }
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

    // Mobile toggle
    function toggleSidebar() { sidebar.classList.toggle('open'); if (overlay) overlay.classList.toggle('open'); }
    function closeSidebar() { sidebar.classList.remove('open'); if (overlay) overlay.classList.remove('open'); }
    on(tocToggle, 'click', toggleSidebar);
    if (overlay) on(overlay, 'click', closeSidebar);

    return {
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
  var themeBtn = document.getElementById('theme-toggle');

  function getPreferredTheme() {
    var stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') return stored;
    return 'light'; // default to light mode
  }

  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    if (themeBtn) themeBtn.setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
  }

  applyTheme(getPreferredTheme());

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('theme', next); } catch (_) {}
      // trigger M3-style rotation spin
      themeBtn.classList.remove('spinning');
      void themeBtn.offsetWidth; // force reflow to restart animation
      themeBtn.classList.add('spinning');
    });
    themeBtn.addEventListener('animationend', function () {
      themeBtn.classList.remove('spinning');
    });
  }

  // ── boot ────────────────────────────────────────────────────────────────────

  window.addEventListener('hashchange', route);
  route();
})();
