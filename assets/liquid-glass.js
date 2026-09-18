/* Header Liquid Glass. A capsule-shaped displacement map bends the live
 * backdrop at the rim; the DOM labels never pass through the filter.
 * No page snapshots, dependencies, or animation loop. */
(function () {
  'use strict';

  var appbar = document.getElementById('site-appbar');
  var glass = appbar && appbar.querySelector('.appbar-glass');
  var filter = document.getElementById('appbar-refraction');
  var map = document.getElementById('appbar-refraction-map');
  if (!glass || !filter || !map) return;

  // Experiment here: displacement is twice the maximum bend in CSS pixels.
  var DISPLACEMENT = 32;
  var BEVEL = 16;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var solidSurface = window.matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)');
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  // CSS.supports checks syntax, not whether an SVG backdrop filter renders.
  // Chromium implements this path. Safari/WebKit and Firefox use CSS frost.
  // Exclude iOS browsers, which use WebKit despite their browser branding.
  var canRefract = /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) &&
    !/iPad|iPhone|iPod/.test(navigator.userAgent) &&
    window.CSS && CSS.supports('backdrop-filter', 'url("#appbar-refraction")');

  var mapWidth = 0;
  var mapHeight = 0;
  var mapRevision = 0;
  var resizeFrame = 0;

  function rebuildLens() {
    resizeFrame = 0;
    if (!canRefract || solidSurface.matches) {
      appbar.classList.remove('glass-refracts');
      mapWidth = 0;
      mapRevision++;
      return;
    }

    var rect = glass.getBoundingClientRect();
    var width = Math.ceil(rect.width);
    var height = Math.ceil(rect.height);
    if (!width || !height || (width === mapWidth && height === mapHeight)) return;
    mapWidth = width;
    mapHeight = height;
    var revision = ++mapRevision;

    try {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext('2d');
      if (!context) return;
      var pixels = context.createImageData(width, height);
      var radius = height / 2;
      var bevel = Math.min(BEVEL, radius);

      for (var y = 0; y < height; y++) {
        for (var x = 0; x < width; x++) {
          // Distance and outward normal from the capsule's central spine.
          // The two semicircular ends therefore bend in both axes.
          var spineX = Math.max(radius, Math.min(width - radius, x + 0.5));
          var nx = x + 0.5 - spineX;
          var ny = y + 0.5 - radius;
          var distance = Math.sqrt(nx * nx + ny * ny);
          var depth = radius - distance;
          var bend = 0;
          if (depth >= 0 && depth < bevel && distance > 0) {
            // A smooth bevel concentrates the lensing at the glass edge,
            // leaving the center calm enough to sit behind navigation.
            bend = Math.pow(1 - depth / bevel, 2);
          }
          var offset = (y * width + x) * 4;
          pixels.data[offset] = Math.round(127.5 - (distance ? nx / distance : 0) * bend * 127.5);
          pixels.data[offset + 1] = Math.round(127.5 - (distance ? ny / distance : 0) * bend * 127.5);
          pixels.data[offset + 2] = 128;
          pixels.data[offset + 3] = 255;
        }
      }

      context.putImageData(pixels, 0, 0);
      var dataUrl = canvas.toDataURL('image/png');
      var decoded = new Image();
      decoded.onload = function () {
        if (revision !== mapRevision || solidSurface.matches) return;
        // Allow enough input around the rim for displaced source pixels.
        var padding = DISPLACEMENT / 2 + 4;
        filter.setAttribute('x', -padding);
        filter.setAttribute('y', -padding);
        filter.setAttribute('width', rect.width + padding * 2);
        filter.setAttribute('height', rect.height + padding * 2);
        filter.querySelector('feDisplacementMap').setAttribute('scale', DISPLACEMENT);
        map.setAttribute('width', rect.width);
        map.setAttribute('height', rect.height);
        map.setAttribute('href', dataUrl);
        appbar.classList.add('glass-refracts');
      };
      decoded.onerror = function () {
        if (revision === mapRevision) appbar.classList.remove('glass-refracts');
      };
      decoded.src = dataUrl;
    } catch (_) {
      // Canvas can be unavailable under stricter browser privacy settings.
      appbar.classList.remove('glass-refracts');
    }
  }

  function scheduleLens() {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(rebuildLens);
  }

  if (canRefract) {
    if ('ResizeObserver' in window) {
      new ResizeObserver(scheduleLens).observe(glass);
    } else {
      window.addEventListener('resize', scheduleLens, { passive: true });
    }
    solidSurface.addEventListener('change', scheduleLens);
    scheduleLens();
  }

  // Light follows the pointer without moving the bar or its hit targets.
  var lightFrame = 0;
  var pointerX = 0;
  var pointerY = 0;

  function resetLight() {
    cancelAnimationFrame(lightFrame);
    lightFrame = 0;
    appbar.style.removeProperty('--glass-pointer-x');
    appbar.style.removeProperty('--glass-pointer-y');
  }

  appbar.addEventListener('pointermove', function (event) {
    if (!finePointer.matches || reduceMotion.matches || solidSurface.matches) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (lightFrame) return;
    lightFrame = requestAnimationFrame(function () {
      lightFrame = 0;
      var rect = appbar.getBoundingClientRect();
      appbar.style.setProperty('--glass-pointer-x', (pointerX - rect.left).toFixed(1) + 'px');
      appbar.style.setProperty('--glass-pointer-y', (pointerY - rect.top).toFixed(1) + 'px');
    });
  }, { passive: true });
  appbar.addEventListener('pointerleave', resetLight);
  appbar.addEventListener('pointercancel', resetLight);
  reduceMotion.addEventListener('change', resetLight);
  finePointer.addEventListener('change', resetLight);
  solidSurface.addEventListener('change', resetLight);
})();
