/* Emotion & Culture Lab — shared site interactions
 * Theme toggle (persisted), mobile nav drawer, scroll progress bar.
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

  // ── priority-plus nav: show as many tabs as fit; overflow into "More" ──
  var nav = document.querySelector('.appbar-nav');
  var more = nav ? nav.querySelector('.nav-more') : null;
  var moreMenu = more ? more.querySelector('.nav-more-menu') : null;
  var moreBtn = more ? more.querySelector('.nav-more-btn') : null;

  if (nav && more && moreMenu) {
    // the original top-level items (everything except the More container)
    var allItems = Array.prototype.filter.call(nav.children, function (el) {
      return !el.classList.contains('nav-more');
    });

    var layoutNav = function () {
      // reset: move everything back into the nav before measuring
      moreMenu.innerHTML = '';
      more.hidden = true;
      allItems.forEach(function (el) {
        el.hidden = false;
        if (el.parentNode !== nav) nav.insertBefore(el, more);
      });

      // available width for the nav row
      var avail = nav.clientWidth;
      var moreW = 86; // reserve room for the "More" button
      var used = 0;
      var overflow = [];

      allItems.forEach(function (el) {
        used += el.offsetWidth + 2;
      });

      if (used <= avail) return; // everything fits

      // walk from the end, push items into overflow until the rest fits
      used += moreW;
      for (var i = allItems.length - 1; i >= 0 && used > avail; i--) {
        overflow.unshift(allItems[i]);
        used -= (allItems[i].offsetWidth + 2);
      }

      if (overflow.length) {
        more.hidden = false;
        overflow.forEach(function (el) {
          el.hidden = true;
          // build a flat link (or submenu group) inside the More menu
          var link = el.querySelector('.nav-link');
          var a = document.createElement('a');
          a.className = 'nav-subitem';
          a.href = link.getAttribute('href') || '#';
          a.textContent = link.textContent.trim();
          moreMenu.appendChild(a);
          // include children of dropdown items too
          var subs = el.querySelectorAll('.nav-subitem');
          Array.prototype.forEach.call(subs, function (s) {
            var c = document.createElement('a');
            c.className = 'nav-subitem nav-subitem--nested';
            c.href = s.getAttribute('href');
            c.textContent = s.textContent.trim();
            moreMenu.appendChild(c);
          });
        });
      }
    };

    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        var open = more.classList.toggle('open');
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (!more.contains(e.target)) {
          more.classList.remove('open');
          moreBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    var raf;
    window.addEventListener('resize', function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layoutNav);
    });
    layoutNav();
  }
})();
