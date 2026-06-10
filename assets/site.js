/* Emotion & Culture Lab — shared site interactions
 * Theme toggle (persisted), mobile nav drawer, scroll progress bar,
 * M3 Expressive scroll-reveal, appbar scroll state, button ripple.
 * Vanilla JS, no dependencies. */
(function () {
  'use strict';

  // Legacy journal links: the journal used to live at the site root with hash
  // routes like #/ or #/issue/<label>. It now lives at /journal/. If we land on
  // the lab home with such a hash, forward to the journal preserving the route.
  if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
    var h = window.location.hash;
    if (h && /^#\/?(issue\/|$)/.test(h.replace(/^#/, '#'))) {
      if (h === '#/' || h === '#' || /^#\/issue\//.test(h)) {
        window.location.replace('/journal/' + h);
        return;
      }
    }
  }

  var html = document.documentElement;

  // ── theme ──
  function preferredTheme() {
    try {
      var stored = localStorage.getItem('theme');
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (_) {}
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  applyTheme(preferredTheme());

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('theme', next); } catch (_) {}
      // M3 Expressive spinning animation (matches journal)
      themeBtn.classList.remove('spinning');
      void themeBtn.offsetWidth;
      themeBtn.classList.add('spinning');
    });
    themeBtn.addEventListener('animationend', function () {
      themeBtn.classList.remove('spinning');
    });
  }

  // ── mobile drawer ──
  var navToggle = document.getElementById('nav-toggle');
  var drawer = document.getElementById('mobile-drawer');
  var scrim = document.getElementById('drawer-scrim');

  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    if (scrim) scrim.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (navToggle) navToggle.addEventListener('click', function () {
    setDrawer(!drawer.classList.contains('open'));
  });
  if (scrim) scrim.addEventListener('click', function () { setDrawer(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setDrawer(false);
  });

  // ── scroll progress ──
  var pb = document.getElementById('progress-bar');
  if (pb) {
    var update = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      pb.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // ── appbar scroll state ──
  var appbar = document.getElementById('site-appbar');
  if (appbar) {
    var lastScrollY = 0;
    var appbarTick = false;
    window.addEventListener('scroll', function () {
      if (!appbarTick) {
        requestAnimationFrame(function () {
          appbar.classList.toggle('scrolled', window.scrollY > 20);
          appbarTick = false;
        });
        appbarTick = true;
      }
    }, { passive: true });
  }

  // ── M3 Expressive scroll-reveal (IntersectionObserver) ──
  (function initReveal() {
    // respect reduced motion — show everything immediately
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger').forEach(function (el) {
        el.classList.add('revealed');
      });
      return;
    }

    var revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .reveal-stagger');
    if (!revealEls.length) return;

    if (!('IntersectionObserver' in window)) {
      // fallback: show everything
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
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach(function (el) { observer.observe(el); });
  })();

  // ── button ripple position tracking ──
  document.querySelectorAll('.btn').forEach(function (btn) {
    btn.addEventListener('pointerdown', function (e) {
      var rect = btn.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width * 100);
      var y = ((e.clientY - rect.top) / rect.height * 100);
      btn.style.setProperty('--ripple-x', x + '%');
      btn.style.setProperty('--ripple-y', y + '%');
    });
  });

  // ── shared image lightbox (QR code, alumni photos, news images) ──
  (function initImageLightbox() {
    var box = document.getElementById('img-lightbox');
    if (!box) return;
    var fig = box.querySelector('.img-lightbox-fig');
    var bigImg = fig.querySelector('img');
    var cap = fig.querySelector('figcaption');
    var closeBtn = box.querySelector('.img-lightbox-close');
    var lastFocus = null;

    function open(src, caption, alt) {
      lastFocus = document.activeElement;
      bigImg.src = src;
      bigImg.alt = alt || caption || '';
      if (caption) { cap.textContent = caption; cap.hidden = false; }
      else { cap.textContent = ''; cap.hidden = true; }
      box.classList.add('open');
      box.setAttribute('aria-hidden', 'false');
      if (closeBtn) closeBtn.focus();
    }
    function close() {
      box.classList.remove('open');
      box.setAttribute('aria-hidden', 'true');
      bigImg.src = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    // Event delegation: any element with [data-zoomable] opens the lightbox.
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-zoomable]');
      if (!trigger) return;
      e.preventDefault();
      var src = trigger.getAttribute('data-zoomable');
      // If src is empty, fall back to a contained <img>.
      if (!src) {
        var inner = trigger.tagName === 'IMG' ? trigger : trigger.querySelector('img');
        if (inner) src = inner.currentSrc || inner.src;
      }
      if (!src) return;
      open(src, trigger.getAttribute('data-caption'), trigger.getAttribute('alt'));
    });

    if (closeBtn) closeBtn.addEventListener('click', close);
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target === fig) close();  // backdrop dismiss
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.classList.contains('open')) close();
    });

    // Tag inline content images (e.g. Markdown images in a news post body) so
    // they're zoomable too, without needing template changes.
    Array.prototype.forEach.call(
      document.querySelectorAll('.news-post-body img, .page-prose img'),
      function (img) {
        if (!img.hasAttribute('data-zoomable')) {
          img.setAttribute('data-zoomable', img.getAttribute('src') || '');
          img.classList.add('zoomable');
        }
      }
    );
  })();

  // ── M3 carousel (alumni past members) ──
  (function initCarousels() {
    var carousels = document.querySelectorAll('[data-carousel]');
    Array.prototype.forEach.call(carousels, function (root) {
      var track = root.querySelector('[data-carousel-track]');
      var prev = root.querySelector('[data-carousel-prev]');
      var next = root.querySelector('[data-carousel-next]');
      if (!track) return;

      function step() {
        // scroll by roughly one item width
        var item = track.querySelector('.carousel-item');
        return item ? item.getBoundingClientRect().width + 16 : track.clientWidth * 0.8;
      }
      function update() {
        var maxScroll = track.scrollWidth - track.clientWidth - 1;
        if (prev) prev.disabled = track.scrollLeft <= 0;
        if (next) next.disabled = track.scrollLeft >= maxScroll;
        // hide both buttons entirely if nothing overflows
        var overflows = track.scrollWidth > track.clientWidth + 2;
        if (prev) prev.hidden = !overflows;
        if (next) next.hidden = !overflows;
      }
      if (prev) prev.addEventListener('click', function () { track.scrollLeft -= step(); });
      if (next) next.addEventListener('click', function () { track.scrollLeft += step(); });
      track.addEventListener('scroll', function () {
        requestAnimationFrame(update);
      }, { passive: true });
      window.addEventListener('resize', function () { requestAnimationFrame(update); });
      // run after images may have changed layout
      update();
      window.addEventListener('load', update);
    });
  })();

  // ── scattered watercolor emoticons drifting over the banner + welcome ──
  (function initEmoticons() {
    var field = document.getElementById('emoticon-field');
    if (!field) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var TOTAL = 20; // emoticon-01..emoticon-20
    // Pick just a handful each load so it stays calm and uncluttered.
    var vw = window.innerWidth;
    var howMany = vw < 600 ? 4 : (vw < 980 ? 6 : 8);

    // Shuffle indices 1..20 and take the first `howMany`.
    var idx = [];
    for (var i = 1; i <= TOTAL; i++) idx.push(i);
    for (var s = idx.length - 1; s > 0; s--) {
      var j = Math.floor(Math.random() * (s + 1));
      var t = idx[s]; idx[s] = idx[j]; idx[j] = t;
    }
    var chosen = idx.slice(0, howMany);

    // Figure out where the welcome (intro) section sits inside the zone so we
    // can make any emoticon overlapping the welcome text extra-transparent.
    var zoneH = field.offsetHeight || 1;
    var intro = document.querySelector('.home-intro');
    var introTopPct = 100;
    if (intro) {
      // offsetTop is relative to the positioned .hero-zone wrapper
      introTopPct = (intro.offsetTop / zoneH) * 100;
    }

    // Distribute across vertical bands so they don't clump.
    var bands = howMany;
    chosen.forEach(function (n, k) {
      var node = document.createElement('div');
      node.className = 'floating-emoticon';

      // Position: spread vertically across the zone; bias left/right gutters
      // so they frame the content rather than cover it.
      var topPct = (k + 0.5) / bands * 100 + (Math.random() * 8 - 4);
      var edgeBias = Math.random() < 0.5 ? 0 : 1;
      var leftPct = edgeBias
        ? 72 + Math.random() * 22      // right gutter
        : 3 + Math.random() * 17;      // left gutter
      // occasionally allow a centered one for variety
      if (Math.random() < 0.15) leftPct = 30 + Math.random() * 40;

      var size = 40 + Math.random() * 44;           // 40–84px
      var rot = (Math.random() * 28 - 14);          // -14..14deg
      var dx = (Math.random() * 26 - 13);           // drift x
      var dy = (-10 - Math.random() * 22);          // drift up
      var dur = 14 + Math.random() * 12;            // 14–26s
      var delay = Math.random() * -8;               // desync

      // Comfortable, low opacity overall; even fainter over the welcome text.
      var overWelcome = topPct >= introTopPct - 4;
      var opacity = overWelcome
        ? 0.14 + Math.random() * 0.10   // 0.14–0.24 beneath welcome text
        : 0.34 + Math.random() * 0.22;  // 0.34–0.56 around the banner

      node.style.top = topPct.toFixed(2) + '%';
      node.style.left = leftPct.toFixed(2) + '%';
      node.style.setProperty('--em-size', size.toFixed(0) + 'px');
      node.style.setProperty('--em-opacity', opacity.toFixed(2));
      node.style.setProperty('--em-rot', rot.toFixed(1) + 'deg');
      node.style.setProperty('--em-dx', dx.toFixed(1) + 'px');
      node.style.setProperty('--em-dy', dy.toFixed(1) + 'px');
      node.style.setProperty('--em-dur', dur.toFixed(1) + 's');
      node.style.setProperty('--em-delay', (delay).toFixed(1) + 's');
      if (reduce) {
        node.style.animation = 'none';
        node.style.opacity = opacity.toFixed(2);
        node.style.transform = 'rotate(' + rot.toFixed(1) + 'deg)';
      }

      var img = document.createElement('img');
      var name = 'emoticon-' + (n < 10 ? '0' + n : n) + '.webp';
      img.src = '/assets/img/emoticons/' + name;
      img.alt = '';
      img.loading = 'lazy';
      node.appendChild(img);
      field.appendChild(node);
    });

    // Gentle cursor parallax — emoticons lean toward the pointer, giving the
    // page a living, emotive feel. Skipped under reduced-motion / touch.
    if (!reduce && window.matchMedia('(pointer: fine)').matches) {
      var nodes = Array.prototype.slice.call(field.children);
      var depths = nodes.map(function () { return 6 + Math.random() * 18; });
      var ticking = false;
      window.addEventListener('pointermove', function (e) {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var cx = window.innerWidth / 2;
          var cy = window.innerHeight / 2;
          var nx = (e.clientX - cx) / cx;   // -1..1
          var ny = (e.clientY - cy) / cy;
          nodes.forEach(function (n, i) {
            var d = depths[i];
            n.style.setProperty('--em-px', (nx * d).toFixed(1) + 'px');
            n.style.setProperty('--em-py', (ny * d).toFixed(1) + 'px');
          });
          ticking = false;
        });
      }, { passive: true });
    }
  })();
})();
