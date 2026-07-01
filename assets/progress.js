/* Shared lab progress board. Loaded only by /progress/. */
(function () {
  'use strict';

  var root = document.querySelector('[data-progress-app]');
  if (!root) return;

  var STORAGE_KEY = 'eclab-progress-v2';
  var ACTIVE_MEMBER_KEY = 'eclab-progress-active-member';
  var apiBase = root.getAttribute('data-api-base') || '/api/progress';
  var leaderId = root.getAttribute('data-leader-id') || '';

  // Selectable project status tags. The last one is the terminal "ended" state
  // and is also implied whenever a project has an endDate.
  var STATUSES = [
    '文献调研中',
    '实验设计中',
    '数据收集中',
    '数据分析中',
    '文章写作中',
    '投稿中',
    '已结束'
  ];
  var DEFAULT_STATUS = STATUSES[0];
  var ENDED_STATUS = STATUSES[STATUSES.length - 1];

  // Below this span (in days) a bar is too narrow to fit both the author name
  // chip and the note, so the chip is dropped and only the note is shown.
  var NARROW_BAR_DAYS = 3;

  var gate = root.querySelector('[data-progress-gate]');
  var workspace = root.querySelector('[data-workspace]');
  var storageStatus = root.querySelector('[data-storage-status]');
  var activeMemberSelect = root.querySelector('[data-active-member]');
  var memberSelect = root.querySelector('[data-member-select]');
  var viewAllBtn = root.querySelector('[data-view-all]');
  var changeUserBtn = root.querySelector('[data-change-user]');
  var currentUserTitle = root.querySelector('[data-current-user]');
  var editorName = root.querySelector('[data-editor-name]');
  var editorAvatar = root.querySelector('[data-editor-avatar]');
  var projectCreate = root.querySelector('[data-project-create]');
  var projectToggle = root.querySelector('[data-project-toggle]');
  var projectForm = root.querySelector('[data-project-form]');
  var projectCancel = root.querySelector('[data-project-cancel]');
  var board = root.querySelector('[data-progress-board]');
  var emptyState = root.querySelector('[data-empty-state]');
  var projectCount = root.querySelector('[data-project-count]');
  var toast = root.querySelector('[data-progress-toast]');
  var membersJson = root.querySelector('[data-progress-members]');

  var members = [];
  try {
    members = membersJson ? JSON.parse(membersJson.textContent || '[]') : [];
  } catch (_) {
    members = [];
  }

  var state = {
    activeMemberId: '',
    selectedMemberId: 'all',
    projects: [],
    sharedStorage: false,
    toastTimer: null,
    boardDayCount: 1,
    openPanels: {} // projectId -> 'progress' | 'members' | null
  };

  /* ---------- members ---------- */

  function findMember(id) {
    return Array.prototype.find.call(members, function (member) {
      return String(member.id) === String(id);
    });
  }

  function memberName(id) {
    if (String(id) === leaderId) {
      var lead = findMember(id);
      return lead ? (lead.name_zh || lead.name_en || lead.label) : '负责人';
    }
    var member = findMember(id);
    return member ? (member.name_zh || member.name_en || member.label) : '未知成员';
  }

  function memberLabel(id) {
    var member = findMember(id);
    return member ? (member.label || member.name_zh || member.name_en) : String(id);
  }

  // Stable per-member hue so each person's progress bars share one color.
  // Derived from the member's index in the roster (falls back to a hash).
  function memberHue(id) {
    var key = String(id);
    var index = -1;
    for (var i = 0; i < members.length; i++) {
      if (String(members[i].id) === key) { index = i; break; }
    }
    if (index === -1) {
      var hash = 0;
      for (var j = 0; j < key.length; j++) {
        hash = (hash * 31 + key.charCodeAt(j)) % 360;
      }
      return hash;
    }
    // Golden-angle spacing spreads adjacent members far apart on the wheel.
    return Math.round((index * 137.508) % 360);
  }

  function memberColor(id) {
    return 'hsl(' + memberHue(id) + ' 62% 45%)';
  }

  // First glyph for the identity avatar: a CJK char, or the first Latin letter.
  function avatarGlyph(name) {
    var text = String(name || '').trim();
    if (!text) return '?';
    return text.charAt(0).toUpperCase();
  }

  /* ---------- storage ---------- */

  function loadStore() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      state.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
      state.selectedMemberId = parsed.selectedMemberId || 'all';
      state.activeMemberId = localStorage.getItem(ACTIVE_MEMBER_KEY) || parsed.activeMemberId || '';
    } catch (_) {
      state.projects = [];
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        projects: state.projects,
        selectedMemberId: state.selectedMemberId,
        activeMemberId: state.activeMemberId
      }));
      if (state.activeMemberId) localStorage.setItem(ACTIVE_MEMBER_KEY, state.activeMemberId);
    } catch (_) {}
  }

  function setStorageStatus(message, shared) {
    state.sharedStorage = !!shared;
    if (!storageStatus) return;
    storageStatus.textContent = message;
    storageStatus.classList.toggle('progress-status-pill--ok', !!shared);
  }

  /* ---------- api ---------- */

  function apiPath(path) {
    return apiBase.replace(/\/+$/, '') + path;
  }

  function api(method, path, body) {
    var options = {
      method: method,
      headers: { 'Accept': 'application/json' }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(apiPath(path), options).then(function (response) {
      return response.text().then(function (text) {
        var data = {};
        if (text) {
          try { data = JSON.parse(text); }
          catch (_) { data = { message: text }; }
        }
        if (!response.ok) {
          throw new Error(data.message || data.error || ('请求失败：' + response.status));
        }
        return data;
      });
    });
  }

  function loadSharedProjects() {
    setStorageStatus('正在连接共享存储', false);
    return api('GET', '/projects').then(function (data) {
      state.projects = normalizeProjects(data.projects);
      setStorageStatus('共享存储已连接', true);
      saveStore();
      renderBoard();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      state.projects = normalizeProjects(state.projects);
      showToast('暂时无法连接共享存储，当前显示本机缓存。', true);
      renderBoard();
    });
  }

  function normalizeProjects(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (project) {
      var membersArr = Array.isArray(project.members) ? project.members.slice() : [];
      // Ensure the leader is always represented locally.
      if (leaderId && membersArr.indexOf(leaderId) === -1) membersArr.push(leaderId);
      if (project.createdBy && membersArr.indexOf(project.createdBy) === -1) {
        membersArr.push(project.createdBy);
      }
      return {
        id: project.id,
        name: project.name,
        status: normalizeStatus(project.status, project.endDate),
        startDate: project.startDate,
        endDate: project.endDate || null,
        createdBy: project.createdBy || '',
        members: membersArr,
        progress: Array.isArray(project.progress) ? project.progress.slice() : []
      };
    });
  }

  function normalizeStatus(status, endDate) {
    if (STATUSES.indexOf(status) !== -1) return status;
    return endDate ? ENDED_STATUS : DEFAULT_STATUS;
  }

  /* ---------- toast + workspace ---------- */

  function showToast(message, isError) {
    if (!toast) return;
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-error', !!isError);
    toast.hidden = false;
    state.toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, isError ? 5200 : 2600);
  }

  function showWorkspace(visible) {
    if (gate) gate.hidden = visible;
    if (workspace) workspace.hidden = !visible;
  }

  /* ---------- dates ---------- */

  function pad(value) { return value < 10 ? '0' + value : String(value); }

  function dateToISO(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseISO(value) {
    if (!value) return null;
    var parts = String(value).slice(0, 10).split('-');
    if (parts.length !== 3) return null;
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function todayISO() { return dateToISO(new Date()); }

  function addDays(date, days) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfWeek(date) {
    var day = date.getDay() || 7;
    return addDays(date, 1 - day);
  }

  function diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function formatDate(value) {
    var date = typeof value === 'string' ? parseISO(value) : value;
    if (!date) return '';
    return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
  }

  function formatShort(date) {
    // Deterministic MM/DD (no locale reordering into MM/DD/YYYY etc.).
    return pad(date.getMonth() + 1) + '/' + pad(date.getDate());
  }

  function formatDateRange(startDate, endDate) {
    if (!endDate || startDate === endDate) return formatDate(startDate);
    return formatDate(startDate) + ' 至 ' + formatDate(endDate);
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- membership helpers ---------- */

  function isProjectMember(project, memberId) {
    if (!memberId) return false;
    return (project.members || []).indexOf(String(memberId)) !== -1;
  }

  function canEdit(project) {
    return isProjectMember(project, state.activeMemberId);
  }

  /* ---------- viewer / heading ---------- */

  function fillViewerSelect() {
    if (!memberSelect) return;
    memberSelect.innerHTML = '';
    var all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部成员';
    memberSelect.appendChild(all);
    members.forEach(function (member) {
      var option = document.createElement('option');
      option.value = member.id;
      option.textContent = member.label || member.name_zh || member.name_en;
      memberSelect.appendChild(option);
    });
    memberSelect.value = state.selectedMemberId;
  }

  function setActiveMember(memberId) {
    state.activeMemberId = memberId;
    state.selectedMemberId = memberId || 'all';
    if (activeMemberSelect) activeMemberSelect.value = memberId;
    if (memberSelect) memberSelect.value = state.selectedMemberId;
    saveStore();
    showWorkspace(!!memberId);
    updateHeading();
    renderBoard();
  }

  function updateHeading() {
    var activeName = state.activeMemberId ? memberName(state.activeMemberId) : '未选择';
    if (editorName) editorName.textContent = activeName;
    if (editorAvatar) {
      if (state.activeMemberId) {
        editorAvatar.textContent = avatarGlyph(activeName);
        editorAvatar.style.setProperty('--avatar-color', memberColor(state.activeMemberId));
        editorAvatar.classList.add('is-set');
      } else {
        editorAvatar.textContent = '—';
        editorAvatar.style.removeProperty('--avatar-color');
        editorAvatar.classList.remove('is-set');
      }
    }
    if (!currentUserTitle) return;
    if (state.selectedMemberId === 'all') {
      currentUserTitle.textContent = '全部成员的课题进展';
      return;
    }
    currentUserTitle.textContent = memberName(state.selectedMemberId) + '参与的课题进展';
  }

  function visibleProjects() {
    if (state.selectedMemberId === 'all') return state.projects.slice();
    return state.projects.filter(function (project) {
      return isProjectMember(project, state.selectedMemberId);
    });
  }

  /* ---------- calendar window (day-accurate) ---------- */

  function projectEntries(project) {
    return Array.isArray(project.progress) ? project.progress : [];
  }

  function boardWindow(projects) {
    var today = new Date();
    var min = addDays(today, -42);
    var max = addDays(today, 14);
    projects.forEach(function (project) {
      var ps = parseISO(project.startDate);
      var pe = parseISO(project.endDate);
      if (ps && ps < min) min = ps;
      if (pe && pe > max) max = pe;
      projectEntries(project).forEach(function (entry) {
        var s = parseISO(entry.startDate);
        var e = parseISO(entry.endDate || entry.startDate);
        if (s && s < min) min = s;
        if (e && e > max) max = e;
      });
    });
    // Snap to whole weeks so week gridlines/labels line up cleanly.
    var start = startOfWeek(min);
    var end = addDays(startOfWeek(max), 6);
    return { start: start, end: end };
  }

  /* Per-day tick dates across [start, end]. The timeline is day-granular: every
     day is its own labelled cell, so even a 1–2 day entry gets a readable
     width. */
  function makeDayTicks(start, end) {
    var ticks = [];
    var cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cursor <= end) {
      ticks.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
      cursor = addDays(cursor, 1);
    }
    return ticks;
  }

  // Weekday abbreviations, indexed by Date#getDay() (0 = Sunday).
  var WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* Short weekday name (Mon, Tue, …) for a day cell's top line. */
  function weekdayShort(date) {
    return WEEKDAY_SHORT[date.getDay()];
  }

  /* True on the first day of an ISO week (Monday). */
  function isWeekStart(date) {
    return (date.getDay() || 7) === 1;
  }

  /* True on weekend days (Saturday / Sunday). */
  function isWeekend(date) {
    var d = date.getDay();
    return d === 0 || d === 6;
  }

  /* Day-accurate span of an entry, clamped to the grid [gridStart, dayCount). */
  function entrySpan(entry, gridStart, dayCount) {
    var s = parseISO(entry.startDate);
    var e = parseISO(entry.endDate || entry.startDate);
    if (!s) return null;
    if (!e || e < s) e = s;
    var startDay = diffDays(gridStart, s);
    var endDay = diffDays(gridStart, e) + 1; // inclusive end -> exclusive edge
    if (startDay < 0) startDay = 0;
    if (endDay > dayCount) endDay = dayCount;
    if (endDay <= 0 || startDay >= dayCount) return null;
    return { startDay: startDay, endDay: endDay };
  }

  /* Greedy interval scheduling on day spans, so overlapping bars stagger into
     separate tracks (rows). This is the first-paint fallback; the authoritative
     packing is the pixel-accurate stackBars() pass after render. */
  function layoutTracks(entries, gridStart, dayCount) {
    var placed = [];
    entries.forEach(function (entry) {
      var span = entrySpan(entry, gridStart, dayCount);
      if (span) placed.push({ entry: entry, span: span });
    });
    placed.sort(function (a, b) {
      return a.span.startDay - b.span.startDay || a.span.endDay - b.span.endDay;
    });
    var tracks = []; // each track holds the exclusive end-day of its last bar
    placed.forEach(function (item) {
      var trackIndex = -1;
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i] <= item.span.startDay) { trackIndex = i; break; }
      }
      if (trackIndex === -1) { trackIndex = tracks.length; tracks.push(item.span.endDay); }
      else { tracks[trackIndex] = item.span.endDay; }
      item.track = trackIndex;
    });
    return { placed: placed, trackCount: tracks.length };
  }

  /* ---------- render ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Build a small inline SVG icon. Using SVG guarantees perfect centering
  // (no font-metric drift like text glyphs).
  function svgIcon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var d = {
      close: [['5', '5', '19', '19'], ['19', '5', '5', '19']],
      plus: [['12', '5', '12', '19'], ['5', '12', '19', '12']]
    }[name] || [];
    d.forEach(function (coords) {
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', coords[0]);
      line.setAttribute('y1', coords[1]);
      line.setAttribute('x2', coords[2]);
      line.setAttribute('y2', coords[3]);
      svg.appendChild(line);
    });
    return svg;
  }

  function renderMemberChips(project) {
    var wrap = el('div', 'project-member-chips');
    (project.members || []).forEach(function (id) {
      var chip = el('span', 'member-chip');
      if (String(id) === leaderId) chip.classList.add('member-chip--leader');
      chip.appendChild(el('span', 'member-chip-name', memberName(id)));
      if (String(id) !== leaderId && canEdit(project)) {
        var remove = el('button', 'member-chip-remove');
        remove.type = 'button';
        remove.title = '移除成员';
        remove.setAttribute('aria-label', '移除 ' + memberName(id));
        remove.appendChild(svgIcon('close'));
        remove.addEventListener('click', function () { removeMember(project.id, id); });
        chip.appendChild(remove);
      }
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function renderMembersPanel(project) {
    var panel = el('div', 'project-panel project-panel--members');
    panel.appendChild(el('h4', 'project-panel-title', '课题成员'));
    panel.appendChild(renderMemberChips(project));

    var form = el('form', 'project-invite');
    var field = el('label', 'progress-field');
    field.appendChild(el('span', null, '邀请成员'));
    var select = document.createElement('select');
    var already = project.members || [];
    members.forEach(function (member) {
      if (already.indexOf(String(member.id)) !== -1) return;
      var option = document.createElement('option');
      option.value = member.id;
      option.textContent = member.label || member.name_zh || member.name_en;
      select.appendChild(option);
    });
    field.appendChild(select);
    form.appendChild(field);

    var submit = el('button', 'btn btn-filled', '邀请加入');
    submit.type = 'submit';
    if (!select.options.length) {
      submit.disabled = true;
      submit.textContent = '已全部加入';
    }
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (select.value) inviteMember(project.id, select.value);
    });
    panel.appendChild(form);
    return panel;
  }

  function renderProgressPanel(project) {
    var panel = el('div', 'project-panel project-panel--progress');
    panel.appendChild(el('h4', 'project-panel-title', '添加进展'));
    var form = el('form', 'project-progress-form');

    var dateRow = el('div', 'progress-date-row');
    var startField = el('label', 'progress-field');
    startField.appendChild(el('span', null, '开始日期'));
    var startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.required = true;
    startInput.value = dateToISO(addDays(new Date(), -13));
    startField.appendChild(startInput);

    var endField = el('label', 'progress-field');
    endField.appendChild(el('span', null, '结束日期'));
    var endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.required = true;
    endInput.value = todayISO();
    endField.appendChild(endInput);
    dateRow.appendChild(startField);
    dateRow.appendChild(endField);
    form.appendChild(dateRow);

    var noteField = el('label', 'progress-field');
    noteField.appendChild(el('span', null, '进展说明'));
    var note = document.createElement('textarea');
    note.rows = 4;
    note.required = true;
    note.maxLength = 2000;
    note.placeholder = '例如：完成实验材料修改、收集 12 名被试、下周计划……';
    noteField.appendChild(note);
    form.appendChild(noteField);

    var submit = el('button', 'btn btn-filled', '添加进展');
    submit.type = 'submit';
    form.appendChild(submit);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      addProgress(project.id, {
        startDate: startInput.value,
        endDate: endInput.value,
        note: note.value.trim()
      });
    });
    panel.appendChild(form);
    return panel;
  }

  function renderCalendar(project, ticks, gridStart, dayCount) {
    var calendar = el('div', 'project-calendar');
    calendar.style.setProperty('--day-count', String(dayCount));

    // Header: one cell per day showing its weekday name (Mon/Tue/…) above the
    // date. Mondays and weekends get a class hook for emphasis.
    var header = el('div', 'calendar-header');
    ticks.forEach(function (tick) {
      var offset = diffDays(gridStart, tick);
      if (offset < 0 || offset >= dayCount) return;
      var cell = el('span', 'calendar-tick');
      cell.style.setProperty('--day', String(offset));
      if (isWeekStart(tick)) cell.classList.add('calendar-tick--week');
      if (isWeekend(tick)) cell.classList.add('calendar-tick--weekend');
      cell.appendChild(el('span', 'calendar-tick-day', weekdayShort(tick)));
      cell.appendChild(el('span', 'calendar-tick-date', formatShort(tick)));
      header.appendChild(cell);
    });
    calendar.appendChild(header);

    // Body: per-day gridlines (Mondays emphasized) + overlaid bars.
    var body = el('div', 'calendar-body');

    var lines = el('div', 'calendar-lines');
    ticks.forEach(function (tick) {
      var offset = diffDays(gridStart, tick);
      if (offset < 0 || offset >= dayCount) return;
      var line = el('span', 'calendar-line');
      if (isWeekStart(tick)) line.classList.add('calendar-line--week');
      line.style.setProperty('--day', String(offset));
      lines.appendChild(line);
    });
    body.appendChild(lines);

    // Today marker.
    var todayOffset = diffDays(gridStart, new Date());
    if (todayOffset >= 0 && todayOffset <= dayCount) {
      var todayLine = el('span', 'calendar-today');
      todayLine.style.setProperty('--day', String(todayOffset));
      todayLine.title = '今天';
      body.appendChild(todayLine);
    }

    var layout = layoutTracks(projectEntries(project), gridStart, dayCount);
    var trackCount = Math.max(1, layout.trackCount);
    // Set on the calendar root so BOTH the body (which sizes its height from
    // the track count) and the bars layer inherit it. Custom properties only
    // cascade downward, so setting it on a child would leave the body at its
    // fallback of 1 track and clip taller stacks.
    calendar.style.setProperty('--track-count', String(trackCount));
    var bars = el('div', 'calendar-bars');
    var editable = canEdit(project);

    layout.placed.forEach(function (item) {
      var entry = item.entry;
      var bar = el('button', 'calendar-bar');
      bar.type = 'button';
      if (editable) bar.classList.add('calendar-bar--editable');
      var len = item.span.endDay - item.span.startDay;
      bar.style.setProperty('--start', String(item.span.startDay));
      bar.style.setProperty('--len', String(len));
      bar.style.setProperty('--track', String(item.track));
      if (entry.authorId) {
        bar.style.setProperty('--bar-color', memberColor(entry.authorId));
        bar.classList.add('calendar-bar--colored');
      }
      var who = entry.authorId ? memberName(entry.authorId) : '';
      bar.title = (who ? who + ' · ' : '') +
        formatDateRange(entry.startDate, entry.endDate || entry.startDate) +
        '：' + (entry.note || '');
      // Narrow bars (short spans) can't fit both a name chip and the note, and
      // the chip would eat all the width — drop the chip and show only the note.
      if (who && len >= NARROW_BAR_DAYS) {
        bar.appendChild(el('span', 'calendar-bar-who', who));
      } else if (who) {
        bar.classList.add('calendar-bar--narrow');
      }
      bar.appendChild(el('span', 'calendar-bar-note', entry.note || ''));
      bar.addEventListener('click', function () { openEntryDetail(project, entry); });
      bars.appendChild(bar);
    });
    body.appendChild(bars);

    if (!layout.placed.length) {
      body.appendChild(el('p', 'calendar-empty', '还没有进展记录。'));
    }
    calendar.appendChild(body);
    return calendar;
  }

  /* Pixel-accurate re-packing after bars are in the DOM.
     Bars now vary in both width (a readable min-width overrides very short date
     spans) and height (notes wrap up to --bar-max-lines). The day-based
     layoutTracks() used at render time can't see either, so re-pack here using
     the real rendered geometry: assign each bar to the first track whose last
     bar's right edge clears this bar's left edge, then position tracks
     vertically by the tallest bar in each preceding track. */
  function stackBars(calendar) {
    var barsLayer = calendar.querySelector('.calendar-bars');
    var body = calendar.querySelector('.calendar-body');
    if (!barsLayer || !body) return;
    var bars = Array.prototype.slice.call(barsLayer.querySelectorAll('.calendar-bar'));
    if (!bars.length) {
      body.style.removeProperty('--body-h');
      return;
    }

    var cs = window.getComputedStyle(calendar);
    var gap = parseFloat(cs.getPropertyValue('--bar-gap')) || 8;

    // Measure, then order left-to-right (ties: taller first for tighter packing).
    var items = bars.map(function (bar) {
      return {
        bar: bar,
        left: bar.offsetLeft,
        right: bar.offsetLeft + bar.offsetWidth,
        height: bar.offsetHeight
      };
    });
    items.sort(function (a, b) {
      return a.left - b.left || b.height - a.height;
    });

    var trackRight = [];  // last occupied right edge per track
    items.forEach(function (item) {
      var track = -1;
      for (var i = 0; i < trackRight.length; i++) {
        // Small epsilon so exactly-adjacent bars can share a track.
        if (trackRight[i] <= item.left + 1) { track = i; break; }
      }
      if (track === -1) { track = trackRight.length; trackRight.push(0); }
      trackRight[track] = item.right;
      item.track = track;
    });

    // Vertical offset of each track = sum of the tallest bar in every earlier
    // track (plus gaps). One row's height is that track's tallest bar.
    var trackHeight = [];
    items.forEach(function (item) {
      var h = trackHeight[item.track] || 0;
      if (item.height > h) trackHeight[item.track] = item.height;
    });
    var trackTop = [];
    var y = gap;
    for (var t = 0; t < trackHeight.length; t++) {
      trackTop[t] = y;
      y += (trackHeight[t] || 0) + gap;
    }

    items.forEach(function (item) {
      item.bar.style.setProperty('--top', trackTop[item.track] + 'px');
    });
    body.style.setProperty('--body-h', y + 'px');
  }

  function statusValue(project) {
    return normalizeStatus(project.status, project.endDate);
  }

  /* Editable project title. For members it renders as a button that swaps to an
     inline text field on click; for others it's a plain heading. */
  function renderProjectTitle(project) {
    if (!canEdit(project)) {
      return el('h3', 'project-title', project.name);
    }
    var btn = el('button', 'project-title project-title--editable', project.name);
    btn.type = 'button';
    btn.title = '点击重命名课题';
    btn.setAttribute('aria-label', '重命名课题：' + project.name);
    btn.addEventListener('click', function () {
      beginRenameProject(project, btn);
    });
    return btn;
  }

  function beginRenameProject(project, titleEl) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'project-title-input';
    input.value = project.name;
    input.maxLength = 120;
    input.setAttribute('aria-label', '课题名称');

    var done = false;
    function commit(save) {
      if (done) return;
      done = true;
      var next = input.value.trim();
      if (input.parentNode) input.parentNode.replaceChild(titleEl, input);
      if (save && next && next !== project.name) {
        renameProject(project.id, next);
      }
    }

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); commit(true); }
      else if (event.key === 'Escape') { event.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', function () { commit(true); });

    titleEl.parentNode.replaceChild(input, titleEl);
    input.focus();
    input.select();
  }

  function renderStatusControl(project) {
    var current = statusValue(project);
    var ended = current === ENDED_STATUS;

    if (canEdit(project)) {
      var wrap = el('span', 'project-status project-status--editable');
      wrap.setAttribute('data-ended', ended ? 'true' : 'false');
      var select = document.createElement('select');
      select.className = 'project-status-select';
      select.setAttribute('aria-label', '课题状态');
      STATUSES.forEach(function (status) {
        var option = document.createElement('option');
        option.value = status;
        option.textContent = status;
        if (status === current) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', function () {
        setStatus(project.id, select.value);
      });
      wrap.appendChild(select);
      wrap.appendChild(el('span', 'project-status-caret', '▾'));
      return wrap;
    }

    var pill = el('span', 'project-status', current);
    pill.setAttribute('data-ended', ended ? 'true' : 'false');
    return pill;
  }

  function renderProjectRow(project, ticks, gridStart, dayCount) {
    var row = el('article', 'project-row');
    if (project.endDate) row.classList.add('project-row--ended');

    var head = el('div', 'project-row-head');
    var info = el('div', 'project-row-info');
    var titleRow = el('div', 'project-title-row');
    titleRow.appendChild(renderProjectTitle(project));
    titleRow.appendChild(renderStatusControl(project));
    info.appendChild(titleRow);

    var dates = el('p', 'project-dates', '开始于 ' + formatDate(project.startDate));
    if (project.endDate) dates.textContent += ' · 结束于 ' + formatDate(project.endDate);
    info.appendChild(dates);
    info.appendChild(renderMemberChips(project));
    head.appendChild(info);

    // Per-row action buttons.
    var actions = el('div', 'project-row-actions');
    var editable = canEdit(project);
    var openPanel = state.openPanels[project.id];
    var ended = isEnded(project);

    if (editable && !ended) {
      actions.appendChild(makeActionBtn('添加进展', openPanel === 'progress', function () {
        togglePanel(project.id, 'progress');
      }));
    }
    if (editable) {
      actions.appendChild(makeActionBtn('成员', openPanel === 'members', function () {
        togglePanel(project.id, 'members');
      }));
      var del = makeActionBtn('删除', false, function () { deleteProject(project.id); });
      del.classList.add('project-action--danger');
      actions.appendChild(del);
    }
    head.appendChild(actions);
    row.appendChild(head);

    if (editable && openPanel === 'progress' && !ended) {
      row.appendChild(renderProgressPanel(project));
    } else if (editable && openPanel === 'members') {
      row.appendChild(renderMembersPanel(project));
    }

    var scroller = el('div', 'project-calendar-scroll');
    scroller.appendChild(renderCalendar(project, ticks, gridStart, dayCount));
    row.appendChild(scroller);
    return row;
  }

  function makeActionBtn(label, active, handler) {
    var btn = el('button', 'project-action', label);
    btn.type = 'button';
    if (active) btn.classList.add('is-active');
    btn.addEventListener('click', handler);
    return btn;
  }

  function togglePanel(projectId, panel) {
    state.openPanels[projectId] = state.openPanels[projectId] === panel ? null : panel;
    renderBoard();
  }

  function isOwnView() {
    return state.selectedMemberId === 'all' ||
      String(state.selectedMemberId) === String(state.activeMemberId);
  }

  function isEnded(project) {
    return !!project.endDate || project.status === ENDED_STATUS;
  }

  function sortedForBoard(projects) {
    // Active projects first, ended ones pushed to the bottom; stable otherwise.
    return projects
      .map(function (project, index) { return { project: project, index: index }; })
      .sort(function (a, b) {
        var ea = isEnded(a.project) ? 1 : 0;
        var eb = isEnded(b.project) ? 1 : 0;
        if (ea !== eb) return ea - eb;
        return a.index - b.index;
      })
      .map(function (item) { return item.project; });
  }

  function renderBoard() {
    if (!board) return;
    board.innerHTML = '';
    var projects = sortedForBoard(visibleProjects());
    var ownView = isOwnView();

    // The "new project" control only makes sense on your own / all view.
    if (projectCreate) projectCreate.hidden = !ownView;
    if (!ownView) toggleCreatePanel(false);

    if (projectCount) projectCount.textContent = projects.length + ' 个课题';

    // Only prompt to create a project when it's actionable (own/all view).
    if (emptyState) {
      if (projects.length) {
        emptyState.hidden = true;
      } else if (ownView) {
        emptyState.hidden = false;
        emptyState.textContent = '暂时还没有课题。点击上方"新建课题"创建第一个。';
      } else {
        emptyState.hidden = false;
        emptyState.textContent = memberName(state.selectedMemberId) + '还没有参与任何课题。';
      }
    }

    if (!projects.length) return;

    var range = boardWindow(projects);
    var ticks = makeDayTicks(range.start, range.end);
    var dayCount = diffDays(range.start, range.end) + 1;
    state.boardDayCount = dayCount;
    state.boardTodayOffset = diffDays(range.start, new Date());
    projects.forEach(function (project) {
      board.appendChild(renderProjectRow(project, ticks, range.start, dayCount));
    });
    // Re-pack bars using their real rendered size (variable width + height).
    // Deferred a frame so layout/fonts have settled before measuring.
    restackBoard();
    scrollToToday();
  }

  // Measure + re-stack every calendar's bars once the board is laid out.
  function restackBoard() {
    if (!board) return;
    var run = function () {
      var calendars = board.querySelectorAll('.project-calendar');
      Array.prototype.forEach.call(calendars, stackBars);
    };
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () { window.requestAnimationFrame(run); });
    } else {
      run();
    }
  }

  // Fixed day width (no time scaling): the timeline keeps a constant scale and
  // scrolls horizontally. On (re)render, bring today into view by default.
  function scrollToToday() {
    if (!board) return;
    var todayOffset = state.boardTodayOffset;
    if (typeof todayOffset !== 'number' || todayOffset < 0) return;
    var scrollers = board.querySelectorAll('.project-calendar-scroll');
    Array.prototype.forEach.call(scrollers, function (scroller) {
      var calendar = scroller.querySelector('.project-calendar');
      if (!calendar) return;
      var dayW = parseFloat(window.getComputedStyle(calendar).getPropertyValue('--day-w')) || 44;
      var todayX = todayOffset * dayW;
      // Center today in the visible strip (clamped by the browser).
      scroller.scrollLeft = Math.max(0, todayX - scroller.clientWidth / 2);
    });
  }

  /* ---------- entry detail dialog (view / edit / delete) ---------- */

  var entryDialog = null;

  function closeEntryDialog() {
    if (entryDialog && entryDialog.open) entryDialog.close();
  }

  // A single reusable <dialog>. Rebuilt per open so it always reflects the
  // latest entry and edit permissions.
  function openEntryDetail(project, entry) {
    if (!entryDialog) {
      entryDialog = document.createElement('dialog');
      entryDialog.className = 'entry-dialog';
      // Backdrop click closes the dialog.
      entryDialog.addEventListener('click', function (event) {
        if (event.target === entryDialog) closeEntryDialog();
      });
      document.body.appendChild(entryDialog);
    }
    entryDialog.innerHTML = '';
    entryDialog.appendChild(buildEntryView(project, entry));
    if (typeof entryDialog.showModal === 'function') {
      entryDialog.showModal();
    } else {
      entryDialog.setAttribute('open', '');
    }
  }

  // Read-only view of an entry, with Edit / Delete for members.
  function buildEntryView(project, entry) {
    var wrap = el('div', 'entry-dialog-body');

    var head = el('div', 'entry-dialog-head');
    var who = entry.authorId ? memberName(entry.authorId) : '未署名';
    var avatar = el('span', 'entry-dialog-avatar', (who || '·').slice(0, 1));
    if (entry.authorId) {
      avatar.style.background = memberColor(entry.authorId);
    }
    head.appendChild(avatar);
    var meta = el('div', 'entry-dialog-meta');
    meta.appendChild(el('span', 'entry-dialog-who', who));
    meta.appendChild(el('span', 'entry-dialog-range',
      formatDateRange(entry.startDate, entry.endDate || entry.startDate)));
    head.appendChild(meta);
    wrap.appendChild(head);

    wrap.appendChild(el('p', 'entry-dialog-note', entry.note || '（无说明）'));

    var actions = el('div', 'entry-dialog-actions');
    if (canEdit(project)) {
      var editBtn = el('button', 'btn btn-filled', '编辑');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () {
        entryDialog.innerHTML = '';
        entryDialog.appendChild(buildEntryEdit(project, entry));
      });
      var delBtn = el('button', 'btn btn-text entry-dialog-delete', '删除');
      delBtn.type = 'button';
      delBtn.addEventListener('click', function () {
        if (window.confirm('确认删除此进展？此操作不可撤销。')) {
          closeEntryDialog();
          deleteEntry(project.id, entry.id);
        }
      });
      actions.appendChild(delBtn);
      actions.appendChild(editBtn);
    }
    var closeBtn = el('button', 'btn btn-text', '关闭');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', closeEntryDialog);
    actions.appendChild(closeBtn);
    wrap.appendChild(actions);
    return wrap;
  }

  // Edit form for an entry (dates + note), with Save / Cancel.
  function buildEntryEdit(project, entry) {
    var form = el('form', 'entry-dialog-body entry-dialog-form');

    var dateRow = el('div', 'progress-date-row');
    var startField = el('label', 'progress-field');
    startField.appendChild(el('span', null, '开始日期'));
    var startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.required = true;
    startInput.value = entry.startDate;
    startField.appendChild(startInput);

    var endField = el('label', 'progress-field');
    endField.appendChild(el('span', null, '结束日期'));
    var endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.required = true;
    endInput.value = entry.endDate || entry.startDate;
    endField.appendChild(endInput);
    dateRow.appendChild(startField);
    dateRow.appendChild(endField);
    form.appendChild(dateRow);

    var noteField = el('label', 'progress-field');
    noteField.appendChild(el('span', null, '进展说明'));
    var note = document.createElement('textarea');
    note.rows = 5;
    note.required = true;
    note.maxLength = 2000;
    note.value = entry.note || '';
    noteField.appendChild(note);
    form.appendChild(noteField);

    var actions = el('div', 'entry-dialog-actions');
    var save = el('button', 'btn btn-filled', '保存');
    save.type = 'submit';
    var cancel = el('button', 'btn btn-text', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', function () {
      entryDialog.innerHTML = '';
      entryDialog.appendChild(buildEntryView(project, entry));
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var payload = {
        startDate: startInput.value,
        endDate: endInput.value,
        note: note.value.trim()
      };
      if (!payload.startDate || !payload.endDate || !payload.note) return;
      if (parseISO(payload.startDate) > parseISO(payload.endDate)) {
        showToast('开始日期不能晚于结束日期。', true);
        return;
      }
      closeEntryDialog();
      updateEntry(project.id, entry.id, payload);
    });
    return form;
  }

  /* ---------- actions ---------- */

  function findProject(projectId) {
    return Array.prototype.find.call(state.projects, function (item) {
      return String(item.id) === String(projectId);
    });
  }

  function toggleCreatePanel(open) {
    if (!projectForm || !projectToggle) return;
    var show = open == null ? projectForm.hidden : open;
    projectForm.hidden = !show;
    projectToggle.setAttribute('aria-expanded', String(show));
    projectToggle.classList.toggle('is-open', show);
    if (show) {
      var startInput = projectForm.elements.startDate;
      if (startInput && !startInput.value) startInput.value = todayISO();
      var nameInput = projectForm.elements.name;
      if (nameInput) nameInput.focus();
    }
  }

  function createProject(event) {
    event.preventDefault();
    if (!state.activeMemberId) { showToast('请先选择自己的名字。', true); return; }
    var name = projectForm.elements.name.value.trim();
    var startDate = projectForm.elements.startDate.value;
    if (!name || !startDate) return;

    var localMembers = [state.activeMemberId];
    if (leaderId && leaderId !== state.activeMemberId) localMembers.push(leaderId);
    var localProject = {
      id: uid('project'),
      name: name,
      status: DEFAULT_STATUS,
      startDate: startDate,
      endDate: null,
      createdBy: state.activeMemberId,
      members: localMembers,
      progress: []
    };

    function finish(project) {
      var normalized = normalizeProjects([project])[0];
      state.projects.unshift(normalized);
      state.selectedMemberId = state.activeMemberId;
      if (memberSelect) memberSelect.value = state.selectedMemberId;
      projectForm.reset();
      toggleCreatePanel(false);
      saveStore();
      updateHeading();
      renderBoard();
      showToast('课题已新建。');
    }

    api('POST', '/projects', {
      memberId: state.activeMemberId,
      name: name,
      startDate: startDate
    }).then(function (data) {
      setStorageStatus('共享存储已连接', true);
      finish(data.project || localProject);
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish(localProject);
      showToast('共享存储暂时不可用，课题已先保存在本机。', true);
    });
  }

  function addProgress(projectId, payload) {
    if (!state.activeMemberId) { showToast('请先选择自己的名字。', true); return; }
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }
    if (!payload.startDate || !payload.endDate || !payload.note) return;
    if (parseISO(payload.startDate) > parseISO(payload.endDate)) {
      showToast('开始日期不能晚于结束日期。', true);
      return;
    }

    var localEntry = {
      id: uid('progress'),
      projectId: projectId,
      authorId: state.activeMemberId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      note: payload.note
    };

    function finish(entry) {
      project.progress = project.progress || [];
      project.progress.push(entry);
      state.openPanels[projectId] = null;
      saveStore();
      renderBoard();
      showToast('进展已添加。');
    }

    api('POST', '/entries', {
      memberId: state.activeMemberId,
      projectId: projectId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      note: payload.note
    }).then(function (data) {
      setStorageStatus('共享存储已连接', true);
      finish(data.entry || localEntry);
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish(localEntry);
      showToast('共享存储暂时不可用，进展已先保存在本机。', true);
    });
  }

  function deleteEntry(projectId, entryId) {
    var project = findProject(projectId);
    if (!project) return;

    function finish() {
      project.progress = (project.progress || []).filter(function (entry) {
        return String(entry.id) !== String(entryId);
      });
      saveStore();
      renderBoard();
      showToast('进展已删除。');
    }

    api('DELETE', '/entries/' + encodeURIComponent(entryId), {
      memberId: state.activeMemberId
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，删除已先保存在本机。', true);
    });
  }

  function updateEntry(projectId, entryId, payload) {
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }
    if (!payload.startDate || !payload.endDate || !payload.note) return;

    function finish() {
      var list = project.progress || [];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(entryId)) {
          list[i].startDate = payload.startDate;
          list[i].endDate = payload.endDate;
          list[i].note = payload.note;
          break;
        }
      }
      saveStore();
      renderBoard();
      showToast('进展已更新。');
    }

    api('PATCH', '/entries/' + encodeURIComponent(entryId), {
      memberId: state.activeMemberId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      note: payload.note
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，修改已先保存在本机。', true);
    });
  }

  function inviteMember(projectId, inviteId) {
    var project = findProject(projectId);
    if (!project) return;

    function finish() {
      project.members = project.members || [];
      if (project.members.indexOf(String(inviteId)) === -1) {
        project.members.push(String(inviteId));
      }
      saveStore();
      renderBoard();
      showToast(memberName(inviteId) + ' 已加入课题。');
    }

    api('POST', '/projects/' + encodeURIComponent(projectId) + '/members', {
      memberId: state.activeMemberId,
      inviteId: inviteId
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，成员变更已先保存在本机。', true);
    });
  }

  function removeMember(projectId, targetId) {
    if (String(targetId) === leaderId) {
      showToast('负责人不能被移出课题。', true);
      return;
    }
    var project = findProject(projectId);
    if (!project) return;
    if (!window.confirm('确认将 ' + memberName(targetId) + ' 移出该课题吗？')) return;

    function finish() {
      project.members = (project.members || []).filter(function (id) {
        return String(id) !== String(targetId);
      });
      saveStore();
      renderBoard();
      showToast('成员已移出课题。');
    }

    api('DELETE', '/projects/' + encodeURIComponent(projectId) +
      '/members/' + encodeURIComponent(targetId), {
      memberId: state.activeMemberId
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，成员变更已先保存在本机。', true);
    });
  }

  function renameProject(projectId, name) {
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }
    name = String(name || '').trim();
    if (!name || name === project.name) return;

    function finish() {
      project.name = name;
      saveStore();
      renderBoard();
      showToast('课题名称已更新。');
    }

    api('PATCH', '/projects/' + encodeURIComponent(projectId) + '/name', {
      memberId: state.activeMemberId,
      name: name
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，名称已先保存在本机。', true);
    });
  }

  function setStatus(projectId, status) {
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }
    if (STATUSES.indexOf(status) === -1) return;
    if (project.status === status) return;

    function finish() {
      project.status = status;
      if (status === ENDED_STATUS) {
        if (!project.endDate) project.endDate = todayISO();
      } else {
        project.endDate = null;
      }
      state.openPanels[projectId] = null;
      saveStore();
      renderBoard();
      showToast('状态已更新为「' + status + '」。');
    }

    api('PATCH', '/projects/' + encodeURIComponent(projectId) + '/status', {
      memberId: state.activeMemberId,
      status: status
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，状态已先保存在本机。', true);
    });
  }

  function deleteProject(projectId) {
    var project = findProject(projectId);
    if (!project) return;
    if (!window.confirm('确认永久删除课题「' + project.name + '」及其全部进展吗？此操作不可撤销。')) {
      return;
    }

    function finish() {
      state.projects = state.projects.filter(function (item) {
        return String(item.id) !== String(projectId);
      });
      delete state.openPanels[projectId];
      saveStore();
      renderBoard();
      showToast('课题已删除。');
    }

    api('DELETE', '/projects/' + encodeURIComponent(projectId), {
      memberId: state.activeMemberId
    }).then(function () {
      setStorageStatus('共享存储已连接', true);
      finish();
    }).catch(function () {
      setStorageStatus('离线本机模式', false);
      finish();
      showToast('共享存储暂时不可用，删除已先保存在本机。', true);
    });
  }

  /* ---------- events ---------- */

  function bindEvents() {
    if (activeMemberSelect) {
      activeMemberSelect.addEventListener('change', function () {
        setActiveMember(activeMemberSelect.value);
      });
    }
    if (memberSelect) {
      memberSelect.addEventListener('change', function () {
        state.selectedMemberId = memberSelect.value || 'all';
        saveStore();
        updateHeading();
        renderBoard();
      });
    }
    if (viewAllBtn) {
      viewAllBtn.addEventListener('click', function () {
        state.selectedMemberId = 'all';
        if (memberSelect) memberSelect.value = 'all';
        saveStore();
        updateHeading();
        renderBoard();
      });
    }
    if (changeUserBtn) {
      changeUserBtn.addEventListener('click', function () {
        showWorkspace(false);
        if (activeMemberSelect) { activeMemberSelect.value = ''; activeMemberSelect.focus(); }
      });
    }
    if (projectToggle) {
      projectToggle.addEventListener('click', function () { toggleCreatePanel(); });
    }
    if (projectCancel) {
      projectCancel.addEventListener('click', function () { toggleCreatePanel(false); });
    }
    if (projectForm) projectForm.addEventListener('submit', createProject);

    // Bar widths (rem-based min-width) and wrap points change with viewport
    // width, so re-measure and re-stack on resize.
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(restackBoard, 150);
    });
  }

  /* ---------- boot ---------- */

  loadStore();
  state.projects = normalizeProjects(state.projects);
  fillViewerSelect();
  bindEvents();
  if (activeMemberSelect && state.activeMemberId) activeMemberSelect.value = state.activeMemberId;
  if (memberSelect) memberSelect.value = state.selectedMemberId;
  showWorkspace(!!state.activeMemberId);
  updateHeading();
  renderBoard();
  loadSharedProjects();
})();
