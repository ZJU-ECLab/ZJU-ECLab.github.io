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

  // ── M3 Expressive — 3D tilt cards ──
  (function initTiltCards() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.querySelectorAll('.tilt-card').forEach(function(card) {
      card.addEventListener('pointermove', function(e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width - 0.5;
        var y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty('--tilt-x', (-y * 8).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', (x * 8).toFixed(2) + 'deg');
      });
      card.addEventListener('pointerleave', function() {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      });
    });
  })();

  // ── Moodboard connector lines ──
  (function initConnectors() {
    var svg = document.querySelector('.moodboard-connectors');
    if (!svg) return;
    var moodboard = svg.closest('.hero-moodboard');
    if (!moodboard) return;

    function updateLines() {
      var rect = moodboard.getBoundingClientRect();
      var lines = svg.querySelectorAll('.connector-line');
      lines.forEach(function(line) {
        var fromId = line.getAttribute('data-from');
        var toClass = line.getAttribute('data-to');
        var fromEl = document.getElementById(fromId);
        var toEl = moodboard.querySelector('.' + toClass);
        if (!fromEl || !toEl) return;

        var fromRect = fromEl.getBoundingClientRect();
        var toRect = toEl.getBoundingClientRect();

        var x1 = fromRect.left + fromRect.width / 2 - rect.left;
        var y1 = fromRect.top + fromRect.height / 2 - rect.top;
        var x2 = toRect.left + toRect.width / 2 - rect.left;
        var y2 = toRect.top + toRect.height / 2 - rect.top;

        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
      });
    }

    updateLines();
    window.addEventListener('resize', updateLines);
  })();

  // ── M3 Expressive — Hero scroll exit (JS fallback) ──
  (function initHeroScrollExit() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var canvas = document.querySelector('.hero-canvas');
    var inner = document.querySelector('.hero-inner');
    if (!canvas || !inner) return;

    // Check if CSS scroll-timeline is supported
    if (CSS && CSS.supports && CSS.supports('animation-timeline', 'scroll()')) return;

    var ticking = false;
    window.addEventListener('scroll', function() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function() {
        var scrollY = window.scrollY;
        var maxScroll = 400; // px of scroll to complete the effect
        var t = Math.min(scrollY / maxScroll, 1);
        // Ease out
        t = 1 - Math.pow(1 - t, 3);
        canvas.style.opacity = (1 - t).toFixed(3);
        canvas.style.transform = 'scale(' + (1 - t * 0.25).toFixed(3) + ') translateY(' + (-t * 80).toFixed(1) + 'px)';
        canvas.style.filter = 'blur(' + (t * 20).toFixed(1) + 'px)';
        inner.style.opacity = (1 - t).toFixed(3);
        inner.style.transform = 'translateY(' + (-t * 40).toFixed(1) + 'px) scale(' + (1 - t * 0.04).toFixed(3) + ')';
        ticking = false;
      });
    }, { passive: true });
  })();

  // ── M3 Expressive — Emoticon hover interaction ──
  (function initEmoticonHover() {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var field = document.getElementById('emoticon-field');
    if (!field) return;

    var ticking = false;
    field.addEventListener('pointermove', function(e) {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function() {
        var emoticons = field.querySelectorAll('.floating-emoticon');
        var mx = e.clientX, my = e.clientY;
        emoticons.forEach(function(em) {
          var rect = em.getBoundingClientRect();
          var cx = rect.left + rect.width / 2;
          var cy = rect.top + rect.height / 2;
          var dist = Math.hypot(mx - cx, my - cy);
          if (dist < 120) {
            em.classList.add('hovered');
          } else {
            em.classList.remove('hovered');
          }
        });
        ticking = false;
      });
    });
    field.addEventListener('pointerleave', function() {
      field.querySelectorAll('.floating-emoticon.hovered').forEach(function(em) {
        em.classList.remove('hovered');
      });
    });
  })();

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

  // ── M3 Expressive back-to-top FAB ──
  (function initBackToTop() {
    var fab = document.getElementById('back-to-top');
    if (!fab) return;

    var SHOW_THRESHOLD = 300; // px scrolled before showing
    var shown = false;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function setVisible(visible) {
      if (visible === shown) return;
      shown = visible;
      if (visible) {
        fab.hidden = false;
        fab.classList.remove('fab-exit');
        if (!reduceMotion) {
          fab.classList.add('fab-enter');
        }
      } else {
        fab.classList.remove('fab-enter');
        if (reduceMotion) {
          fab.hidden = true;
        } else {
          fab.classList.add('fab-exit');
        }
      }
    }

    fab.addEventListener('animationend', function (e) {
      if (e.animationName === 'fab-spring-out') {
        fab.hidden = true;
        fab.classList.remove('fab-exit');
      }
    });

    fab.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        setVisible(window.scrollY > SHOW_THRESHOLD);
        ticking = false;
      });
    }, { passive: true });

    // Initial check in case page loads scrolled (e.g. browser restore)
    if (window.scrollY > SHOW_THRESHOLD) setVisible(true);
  })();

  // ── orbit emoticon cycling (cycle through facial expressions) ──
  (function cycleOrbitEmoticon() {
    var container = document.getElementById('orbit-emoticon');
    if (!container) return;
    
    var imgs = container.querySelectorAll('.orbit-emoticon-img');
    if (imgs.length < 2) return;
    
    var TOTAL = 20;
    var currentIndex = 1;
    var activeIndex = 0; // which img element is currently visible

    function nextEmoticon() {
      currentIndex = (currentIndex % TOTAL) + 1;
      var name = 'emoticon-' + (currentIndex < 10 ? '0' + currentIndex : currentIndex) + '.webp';
      var nextImg = imgs[1 - activeIndex]; // the hidden one

      // Preload into the hidden img
      nextImg.onload = function() {
        // Crossfade: hide current, show next
        imgs[activeIndex].style.opacity = '0';
        nextImg.style.opacity = '1';
        activeIndex = 1 - activeIndex;
      };
      nextImg.src = '/assets/img/emoticons/' + name;
    }
    
    setInterval(nextEmoticon, 3500);
  })();

  // ── dropdown menu positioning (portal pattern for blur effect) ──
  (function initDropdownPortals() {
    var navItems = document.querySelectorAll('.nav-item.has-children');
    if (!navItems.length) return;
    
    var openSubmenu = null;
    var closeTimer = null;
    
    function positionSubmenu(navItem, submenu) {
      var navLink = navItem.querySelector('.nav-link');
      if (!navLink) return;
      
      var linkRect = navLink.getBoundingClientRect();
      
      // Get submenu width without it being visible (to avoid layout shift)
      var wasOpen = submenu.classList.contains('open');
      if (!wasOpen) {
        // Temporarily make it visible off-screen to measure
        submenu.style.visibility = 'hidden';
        submenu.style.opacity = '1';
        submenu.style.display = 'flex';
      }
      var submenuWidth = submenu.offsetWidth;
      if (!wasOpen) {
        submenu.style.visibility = '';
        submenu.style.opacity = '';
        submenu.style.display = '';
      }
      
      // Position below the nav link, centered horizontally
      var left = linkRect.left + (linkRect.width / 2) - (submenuWidth / 2);
      var top = linkRect.bottom + 12;  // Increased gap from 6px to 12px
      
      // Keep within viewport bounds
      var rightEdge = left + submenuWidth;
      if (rightEdge > window.innerWidth - 14) {
        left = window.innerWidth - submenuWidth - 14;
      }
      if (left < 14) left = 14;
      
      submenu.style.left = left + 'px';
      submenu.style.top = top + 'px';
    }
    
    function showSubmenu(navItem, submenu) {
      // Close any other open submenu
      if (openSubmenu && openSubmenu !== submenu) {
        openSubmenu.classList.remove('open');
        var prevNavItem = Array.prototype.find.call(navItems, function(item) {
          return item.querySelector('.nav-submenu') === openSubmenu;
        });
        if (prevNavItem) prevNavItem.classList.remove('submenu-open');
      }
      
      clearTimeout(closeTimer);
      // Position once when opening, not on every hover
      if (!submenu.classList.contains('open')) {
        positionSubmenu(navItem, submenu);
      }
      submenu.classList.add('open');
      navItem.classList.add('submenu-open');
      openSubmenu = submenu;
    }
    
    function hideSubmenu(navItem, submenu, immediate) {
      clearTimeout(closeTimer);
      if (immediate) {
        submenu.classList.remove('open');
        navItem.classList.remove('submenu-open');
        if (openSubmenu === submenu) openSubmenu = null;
      } else {
        // Delay to allow moving from link to submenu
        closeTimer = setTimeout(function() {
          submenu.classList.remove('open');
          navItem.classList.remove('submenu-open');
          if (openSubmenu === submenu) openSubmenu = null;
        }, 150);
      }
    }
    
    navItems.forEach(function(navItem) {
      var submenu = navItem.querySelector('.nav-submenu');
      var navLink = navItem.querySelector('.nav-link');
      if (!submenu || !navLink) return;
      
      // Move submenu to body (portal pattern to escape appbar's backdrop-filter)
      document.body.appendChild(submenu);
      
      // Show on hover
      navLink.addEventListener('mouseenter', function() {
        showSubmenu(navItem, submenu);
      });
      
      // Hide when leaving link (with delay)
      navLink.addEventListener('mouseleave', function() {
        hideSubmenu(navItem, submenu, false);
      });
      
      // Keep open when hovering submenu
      submenu.addEventListener('mouseenter', function() {
        clearTimeout(closeTimer);
      });
      
      // Hide when leaving submenu
      submenu.addEventListener('mouseleave', function() {
        hideSubmenu(navItem, submenu, false);
      });
      
      // Show on focus (keyboard navigation)
      navLink.addEventListener('focus', function() {
        showSubmenu(navItem, submenu);
      });
      
      // Keep open when focusing items in submenu
      submenu.addEventListener('focusin', function() {
        clearTimeout(closeTimer);
        showSubmenu(navItem, submenu);
      });
      
      // Hide when focus leaves both link and submenu
      submenu.addEventListener('focusout', function(e) {
        // Check if focus is moving outside both navLink and submenu
        setTimeout(function() {
          if (!navLink.matches(':focus') && !submenu.contains(document.activeElement)) {
            hideSubmenu(navItem, submenu, true);
          }
        }, 0);
      });
      
      navLink.addEventListener('blur', function() {
        // Check if focus is moving to submenu
        setTimeout(function() {
          if (!submenu.contains(document.activeElement)) {
            hideSubmenu(navItem, submenu, true);
          }
        }, 0);
      });
      
      // Reposition on scroll/resize
      var repositionHandler = function() {
        if (submenu.classList.contains('open')) {
          positionSubmenu(navItem, submenu);
        }
      };
      window.addEventListener('scroll', repositionHandler, { passive: true });
      window.addEventListener('resize', repositionHandler);
    });
    
    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && openSubmenu) {
        openSubmenu.classList.remove('open');
        var navItem = Array.prototype.find.call(navItems, function(item) {
          return item.querySelector('.nav-submenu') === openSubmenu;
        });
        if (navItem) navItem.classList.remove('submenu-open');
        openSubmenu = null;
      }
    });
    
    // Close when clicking outside
    document.addEventListener('click', function(e) {
      if (!openSubmenu) return;
      var clickedNavItem = e.target.closest('.nav-item.has-children');
      var clickedSubmenu = e.target.closest('.nav-submenu');
      if (!clickedNavItem && !clickedSubmenu) {
        openSubmenu.classList.remove('open');
        var navItem = Array.prototype.find.call(navItems, function(item) {
          return item.querySelector('.nav-submenu') === openSubmenu;
        });
        if (navItem) navItem.classList.remove('submenu-open');
        openSubmenu = null;
      }
    });
  })();
})();
