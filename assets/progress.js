/* Shared lab progress board. Loaded only by /progress/. */
(function () {
  'use strict';

  var root = document.querySelector('[data-progress-app]');
  if (!root) return;

  var STORAGE_KEY = 'eclab-progress-v3';
  var envId = root.getAttribute('data-cloudbase-env') || '';
  var region = root.getAttribute('data-cloudbase-region') || 'ap-shanghai';
  var functionName = root.getAttribute('data-cloudbase-function') || 'progress-api';
  var leaderId = root.getAttribute('data-leader-id') || '';
  var cloudApp = null;
  var auth = null;
  var verificationInfo = null;
  var countdownTimer = null;

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
  var STATUS_ICONS = {
    '文献调研中': 'reading_article',
    '实验设计中': 'experiment_design',
    '数据收集中': 'collect_data',
    '数据分析中': 'analysis',
    '文章写作中': 'writing',
    '投稿中': 'submit',
    '已结束': 'done'
  };
  var CATPPUCCIN_MEMBER_COLORS = [
    '#8839ef', // Latte mauve
    '#40a02b', // Latte green
    '#fe640b', // Latte peach
    '#1e66f5', // Latte blue
    '#ea76cb', // Latte pink
    '#179299', // Latte teal
    '#d20f39', // Latte red
    '#04a5e5', // Latte sky
    '#df8e1d', // Latte yellow
    '#7287fd', // Latte lavender
    '#e64553', // Latte maroon
    '#209fb5', // Latte sapphire
    '#dd7878', // Latte flamingo
    '#dc8a78'  // Latte rosewater
  ];
  var CATPPUCCIN_MOCHA_BASE = '#1e1e2e';
  var GUIDE_STORAGE_KEY = 'eclab-progress-guide-v1-complete';
  var GUIDE_PROJECT_ID = '__progress-guide-project__';
  var GUIDE_ID_PREFIX = '__progress-guide-';

  // Below this span (in days) a bar is too narrow to fit both the author name
  // chip and the note, so the chip is dropped and only the note is shown.
  var NARROW_BAR_DAYS = 3;

  var gate = root.querySelector('[data-progress-gate]');
  var workspace = root.querySelector('[data-workspace]');
  var phoneLoginForm = root.querySelector('[data-phone-login]');
  var sendCodeBtn = root.querySelector('[data-send-code]');
  var loginStatus = root.querySelector('[data-login-status]');
  var memberSelect = root.querySelector('[data-member-select]');
  var viewMineBtn = root.querySelector('[data-view-mine]');
  var signOutBtn = root.querySelector('[data-sign-out]');
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
  var projectLayout = root.querySelector('[data-progress-layout]');
  var projectRail = root.querySelector('[data-project-rail]');
  var projectNav = root.querySelector('[data-project-nav]');
  var projectNavToggle = root.querySelector('[data-project-nav-toggle]');
  var projectNavToggleLabel = root.querySelector('[data-project-nav-toggle-label]');
  var projectNavClose = root.querySelector('[data-project-nav-close]');
  var projectNavScrim = root.querySelector('[data-project-nav-scrim]');
  var guideLaunch = root.querySelector('[data-guide-launch]');
  var guideLayer = root.querySelector('[data-guide-layer]');
  var guideCard = root.querySelector('[data-guide-card]');
  var guideStepLabel = root.querySelector('[data-guide-step-label]');
  var guideTitle = root.querySelector('[data-guide-title]');
  var guideDescription = root.querySelector('[data-guide-description]');
  var guideMeter = root.querySelector('[data-guide-meter]');
  var guideMeterBar = root.querySelector('[data-guide-meter-bar]');
  var guideSkip = root.querySelector('[data-guide-skip]');
  var guideBack = root.querySelector('[data-guide-back]');
  var guideNext = root.querySelector('[data-guide-next]');
  var toast = root.querySelector('[data-progress-toast]');
  var membersJson = root.querySelector('[data-progress-members]');
  var projectNavObserver = null;
  var projectNavVisibility = {};
  var projectRailPositionFrame = null;

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
    toastTimer: null,
    boardDayCount: 1,
    activeProjectId: '',
    openPanels: {} // projectId -> 'progress' | 'plan' | 'members' | null
  };

  var guide = {
    active: false,
    step: 0,
    project: null,
    highlight: null,
    lastFocus: null,
    previousProjectId: ''
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

  function memberColor(id) {
    var key = String(id);
    var index = -1;
    for (var i = 0; i < members.length; i++) {
      if (String(members[i].id) === key) { index = i; break; }
    }
    if (index < 0) {
      index = 0;
      for (var j = 0; j < key.length; j++) {
        index = (index * 31 + key.charCodeAt(j)) % (CATPPUCCIN_MEMBER_COLORS.length * 2);
      }
    }
    var color = CATPPUCCIN_MEMBER_COLORS[index % CATPPUCCIN_MEMBER_COLORS.length];
    if (index >= CATPPUCCIN_MEMBER_COLORS.length) {
      return 'color-mix(in srgb, ' + color + ' 72%, ' + CATPPUCCIN_MOCHA_BASE + ')';
    }
    return color;
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
    } catch (_) {
      state.projects = [];
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        projects: state.projects,
        selectedMemberId: state.selectedMemberId
      }));
    } catch (_) {}
  }

  /* ---------- api ---------- */

  function isGuideIdentifier(value) {
    return String(value || '').indexOf(GUIDE_ID_PREFIX) === 0 ||
      String(value || '') === GUIDE_PROJECT_ID;
  }

  function api(method, path, body) {
    if (String(path || '').indexOf(GUIDE_ID_PREFIX) !== -1 ||
        isGuideIdentifier(path) ||
        (body && (isGuideIdentifier(body.projectId) || isGuideIdentifier(body.id)))) {
      return Promise.reject(new Error('演示课题不会上传到共享存储。'));
    }
    if (!cloudApp) return Promise.reject(new Error('CloudBase SDK 尚未初始化。'));
    return cloudApp.callFunction({
      name: functionName,
      data: {
        httpMethod: method,
        path: '/api/progress' + path,
        body: body || null
      }
    }).then(function (response) {
      var proxy = response && response.result ? response.result : response;
      var data = {};
      if (proxy && proxy.body) {
        try { data = typeof proxy.body === 'string' ? JSON.parse(proxy.body) : proxy.body; }
        catch (_) { data = { message: String(proxy.body) }; }
      }
      var status = Number(proxy && proxy.statusCode) || 200;
      if (status < 200 || status >= 300) {
        var error = new Error(data.message || data.error || ('请求失败：' + status));
        error.status = status;
        error.code = data.error || '';
        throw error;
      }
      return data;
    });
  }

  /* ---------- CloudBase phone authentication ---------- */

  function setLoginStatus(message, isError) {
    if (!loginStatus) return;
    loginStatus.textContent = message || '';
    loginStatus.classList.toggle('is-error', !!isError);
  }

  function setLoginBusy(busy) {
    if (sendCodeBtn) sendCodeBtn.disabled = !!busy || !!countdownTimer;
    if (phoneLoginForm) {
      var submit = phoneLoginForm.querySelector('[type="submit"]');
      if (submit) submit.disabled = !!busy || !verificationInfo;
    }
  }

  function normalizePhone(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (/^1\d{10}$/.test(digits)) return '+86' + digits;
    if (/^861\d{10}$/.test(digits)) return '+' + digits;
    return '';
  }

  function authErrorMessage(error, fallback) {
    if (!error) return fallback;
    var message = typeof error === 'string' ? error :
      (error.message || error.error_description || error.msg ||
        error.error || error.code || '');
    var details = [message, error && error.code, error && error.error_description]
      .filter(Boolean).join(' ').toLowerCase();
    if (details.indexOf('verification code does not match') !== -1 ||
        details.indexOf('invalid verification code') !== -1 ||
        details.indexOf('无效的验证码') !== -1 ||
        details.indexOf('验证码不匹配') !== -1) {
      return '验证码不正确，请重新输入。';
    }
    return message || fallback;
  }

  function resolveMember(phone) {
    return api('POST', '/auth/me', { phone: phone || '' }).then(function (data) {
      var member = findMember(data.memberId);
      if (!member) throw new Error('登录账号关联了未知的成员记录。');
      return data;
    });
  }

  function openMemberSession(data) {
    setActiveMember(data.memberId);
    setLoginStatus('');
    return loadSharedProjects().then(function () {
      maybeStartGuide();
    });
  }

  function sendPhoneCode() {
    if (!auth || !phoneLoginForm) return;
    var phone = normalizePhone(phoneLoginForm.elements.phone.value);
    if (!phone) {
      setLoginStatus('请输入正确的中国大陆手机号。', true);
      return;
    }

    setLoginBusy(true);
    setLoginStatus('正在发送验证码…');
    auth.getVerification({ phone_number: phone }).then(function (info) {
      verificationInfo = info;
      var code = phoneLoginForm.elements.code;
      var submit = phoneLoginForm.querySelector('[type="submit"]');
      if (code) { code.disabled = false; code.focus(); }
      if (submit) submit.disabled = false;
      setLoginStatus('验证码已发送，请查看短信。');

      var remaining = 60;
      if (sendCodeBtn) {
        sendCodeBtn.disabled = true;
        sendCodeBtn.textContent = remaining + ' 秒后重发';
      }
      countdownTimer = window.setInterval(function () {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(countdownTimer);
          countdownTimer = null;
          if (sendCodeBtn) { sendCodeBtn.disabled = false; sendCodeBtn.textContent = '重新发送'; }
          return;
        }
        if (sendCodeBtn) sendCodeBtn.textContent = remaining + ' 秒后重发';
      }, 1000);
    }).catch(function (error) {
      setLoginStatus(authErrorMessage(error, '验证码发送失败。'), true);
    }).then(function () {
      setLoginBusy(false);
    });
  }

  function completePhoneLogin(event) {
    event.preventDefault();
    if (!auth || !phoneLoginForm || !verificationInfo) return;
    var phone = normalizePhone(phoneLoginForm.elements.phone.value);
    var code = String(phoneLoginForm.elements.code.value || '').trim();
    if (!phone || !/^\d{6}$/.test(code)) {
      setLoginStatus('请输入手机号和 6 位验证码。', true);
      return;
    }

    setLoginBusy(true);
    setLoginStatus('正在验证手机号…');
    var signedIn = false;
    auth.signInWithSms({
      verificationInfo: verificationInfo,
      verificationCode: code,
      phoneNum: phone
    }).then(function () {
      signedIn = true;
      return resolveMember(phone);
    }).then(function (memberData) {
      verificationInfo = null;
      if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      if (sendCodeBtn) sendCodeBtn.textContent = '获取验证码';
      phoneLoginForm.reset();
      return openMemberSession(memberData);
    }).catch(function (error) {
      // A rejected SMS code does not invalidate the verification request. Keep
      // the input enabled so the member can correct the code immediately.
      if (!signedIn) {
        var retryInput = phoneLoginForm.elements.code;
        if (retryInput) {
          retryInput.value = '';
          retryInput.disabled = false;
          retryInput.focus();
        }
        setLoginStatus(authErrorMessage(error, '登录失败，请检查验证码后重试。'), true);
        return;
      }
      return auth.signOut().catch(function () {}).then(function () {
        verificationInfo = null;
        var codeInput = phoneLoginForm.elements.code;
        var submit = phoneLoginForm.querySelector('[type="submit"]');
        if (codeInput) { codeInput.value = ''; codeInput.disabled = true; }
        if (submit) submit.disabled = true;
        setLoginStatus(authErrorMessage(error, '手机号未匹配到实验室成员。'), true);
      });
    }).then(function () {
      setLoginBusy(false);
    });
  }

  function signOut() {
    if (!auth) return;
    auth.signOut().catch(function () {}).then(function () {
      if (guide.active) endGuide(false, false);
      state.activeMemberId = '';
      state.selectedMemberId = 'all';
      state.openPanels = {};
      setProjectNavOpen(false, false);
      showWorkspace(false);
      verificationInfo = null;
      if (countdownTimer) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
      if (sendCodeBtn) { sendCodeBtn.disabled = false; sendCodeBtn.textContent = '获取验证码'; }
      if (phoneLoginForm) {
        phoneLoginForm.reset();
        var code = phoneLoginForm.elements.code;
        var submit = phoneLoginForm.querySelector('[type="submit"]');
        if (code) code.disabled = true;
        if (submit) submit.disabled = true;
      }
      setLoginStatus('已退出登录。');
      updateHeading();
    });
  }

  function loadSharedProjects() {
    return api('GET', '/projects').then(function (data) {
      state.projects = normalizeProjects(data.projects);
      saveStore();
      renderBoard();
    }).catch(function () {
      state.projects = normalizeProjects(state.projects);
      showToast('暂时无法连接共享存储，当前仅显示本机缓存。', true);
      renderBoard();
    });
  }

  function handleWriteError(error, fallbackMessage) {
    showToast((error && error.message) || fallbackMessage, true);
  }

  function normalizeProjects(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (project) {
      var membersArr = Array.isArray(project.members) ? project.members.slice() : [];
      // project.members comes from project_members. createdBy is audit metadata
      // and must not restore access after the creator leaves the project.
      if (leaderId && membersArr.indexOf(leaderId) === -1) membersArr.push(leaderId);
      return {
        id: project.id,
        name: project.name,
        status: normalizeStatus(project.status, project.endDate),
        startDate: project.startDate,
        endDate: project.endDate || null,
        createdBy: project.createdBy || '',
        members: membersArr,
        progress: Array.isArray(project.progress) ? project.progress.slice() : [],
        plans: Array.isArray(project.plans) ? project.plans.map(function (plan) {
          return {
            id: plan.id,
            projectId: plan.projectId || project.id,
            authorId: plan.authorId || '',
            deadline: plan.deadline,
            text: plan.text || '',
            completed: !!plan.completed,
            completedAt: plan.completedAt || null
          };
        }) : []
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

  /* ---------- first-use guide ---------- */

  var GUIDE_STEPS = [
    {
      target: 'toolbar',
      title: '选择查看范围',
      description: '这里显示当前查看范围。你可以选择一位成员，查看这位成员参与的课题；点击“我的课题”可随时返回自己的课题列表。'
    },
    {
      target: 'navigation',
      title: '快速找到课题',
      description: '左侧目录列出当前范围内的课题，点击课题名称即可跳转。屏幕较窄时，点击右下角的“课题导航”按钮打开目录。'
    },
    {
      target: 'overview',
      title: '查看和修改基本信息',
      description: '这里集中显示课题名称、当前阶段和参与成员。点击课题名称或当前阶段可进行修改；点击任一成员姓名，可查看这位成员参与的课题。'
    },
    {
      target: 'actions',
      title: '更新课题内容',
      description: '点击“添加进展”记录已经完成的工作，点击“添加计划”安排下一步任务；需要调整参与人员时，点击“成员”。'
    },
    {
      target: 'plans',
      title: '管理计划',
      description: '每项计划都会显示截止日期。任务完成后，勾选左侧方框，完成情况会立即更新。'
    },
    {
      target: 'timeline',
      title: '查看进展时间线',
      description: '进展会按日期排列，不同记录者使用不同颜色。点击一条进展可查看或修改内容；点击“回到今天”可快速定位当前日期。'
    },
    {
      target: 'guide',
      title: '指南到这里结束',
      description: '点击“完成”即可关闭指南，示例课题也会随之移除。以后需要再次查看时，点击页面上方的问号按钮。'
    }
  ];

  function isGuideProject(project) {
    return !!project && String(project.id) === GUIDE_PROJECT_ID;
  }

  function guideMembers() {
    var ids = [];
    var viewingMemberId = state.selectedMemberId && state.selectedMemberId !== 'all' ?
      state.selectedMemberId : state.activeMemberId;
    function append(id) {
      if (id && ids.indexOf(String(id)) === -1) ids.push(String(id));
    }

    append(viewingMemberId);
    if (leaderId) append(leaderId);
    if (!ids.length && state.activeMemberId) append(state.activeMemberId);
    return ids;
  }

  function makeGuideProject() {
    var membersForGuide = guideMembers();
    var authorA = membersForGuide[0] || state.activeMemberId || leaderId;
    var authorB = membersForGuide[1] || authorA;
    var today = new Date();

    return {
      id: GUIDE_PROJECT_ID,
      name: '示例课题：界面导览',
      status: '数据收集中',
      startDate: dateToISO(addDays(today, -20)),
      endDate: null,
      createdBy: state.activeMemberId || '',
      members: membersForGuide,
      progress: [
        {
          id: GUIDE_ID_PREFIX + 'entry-1',
          authorId: authorA,
          startDate: dateToISO(addDays(today, -16)),
          endDate: dateToISO(addDays(today, -12)),
          note: '确认研究问题与样本范围'
        },
        {
          id: GUIDE_ID_PREFIX + 'entry-2',
          authorId: authorB,
          startDate: dateToISO(addDays(today, -9)),
          endDate: dateToISO(addDays(today, -4)),
          note: '完成第一轮数据整理'
        }
      ],
      plans: [
        {
          id: GUIDE_ID_PREFIX + 'plan-1',
          projectId: GUIDE_PROJECT_ID,
          authorId: authorA,
          deadline: dateToISO(addDays(today, 6)),
          text: '安排本周的讨论与任务分工',
          completed: false,
          completedAt: null
        },
        {
          id: GUIDE_ID_PREFIX + 'plan-2',
          projectId: GUIDE_PROJECT_ID,
          authorId: authorB,
          deadline: dateToISO(addDays(today, 12)),
          text: '整理本轮进展为简短汇报',
          completed: false,
          completedAt: null
        }
      ]
    };
  }

  function guideTarget(step) {
    if (step.target === 'toolbar') return root.querySelector('.progress-toolbar');
    if (step.target === 'navigation') return projectRail;
    if (step.target === 'guide') return guideLaunch;
    var demo = projectRowById(GUIDE_PROJECT_ID);
    if (!demo) return null;
    if (step.target === 'overview') return demo.querySelector('.project-row-head');
    if (step.target === 'actions') return demo.querySelector('.project-row-actions');
    if (step.target === 'plans') return demo.querySelector('.project-plans');
    if (step.target === 'timeline') return demo.querySelector('.project-timeline');
    return demo;
  }

  function clearGuideHighlight() {
    if (!guide.highlight) return;
    guide.highlight.classList.remove('progress-guide-highlight');
    guide.highlight.classList.remove('progress-guide-highlight--static');
    guide.highlight = null;
  }

  function scrollGuideTargetIntoView(target) {
    if (!target || target === projectRail) return;
    target.scrollIntoView({ block: 'center', behavior: 'auto' });
  }

  function positionGuideCard(target) {
    if (!guideCard) return;
    var useTop = false;
    if (target && target !== projectRail && target !== guideLaunch) {
      var rect = target.getBoundingClientRect();
      useTop = rect.top > window.innerHeight * 0.48;
    }
    guideCard.classList.toggle('is-top', useTop);
  }

  function renderGuideStep(stepIndex) {
    if (!guide.active || !guideLayer) return;
    guide.step = Math.max(0, Math.min(stepIndex, GUIDE_STEPS.length - 1));
    var step = GUIDE_STEPS[guide.step];
    var navigationStep = step.target === 'navigation';

    clearGuideHighlight();
    if (navigationStep && usesProjectNavDrawer()) setProjectNavOpen(true, false);
    else setProjectNavOpen(false, false);

    if (guideStepLabel) guideStepLabel.textContent = '第 ' + (guide.step + 1) + ' 步，共 ' + GUIDE_STEPS.length + ' 步';
    if (guideTitle) guideTitle.textContent = step.title;
    if (guideDescription) guideDescription.textContent = step.description;
    if (guideMeter) guideMeter.setAttribute('aria-valuenow', String(guide.step + 1));
    if (guideMeterBar) guideMeterBar.style.width = ((guide.step + 1) / GUIDE_STEPS.length * 100) + '%';
    if (guideBack) guideBack.disabled = guide.step === 0;
    if (guideNext) guideNext.textContent = guide.step === GUIDE_STEPS.length - 1 ? '完成' : '下一步';

    window.requestAnimationFrame(function () {
      if (!guide.active) return;
      var target = guideTarget(step);
      scrollGuideTargetIntoView(target);
      window.requestAnimationFrame(function () {
        if (!guide.active || target !== guideTarget(step)) return;
        if (target) {
          target.classList.add('progress-guide-highlight');
          if (window.getComputedStyle(target).position === 'static') {
            target.classList.add('progress-guide-highlight--static');
          }
          guide.highlight = target;
        }
        positionGuideCard(target);
        if (guideNext) guideNext.focus();
      });
    });
  }

  function rememberGuideCompletion() {
    try { localStorage.setItem(GUIDE_STORAGE_KEY, '1'); } catch (_) {}
  }

  function endGuide(remember, returnFocus) {
    if (!guide.active) return;
    var focusTarget = guide.lastFocus || guideLaunch;
    clearGuideHighlight();
    guide.active = false;
    guide.project = null;
    delete state.openPanels[GUIDE_PROJECT_ID];
    state.activeProjectId = guide.previousProjectId;
    guide.previousProjectId = '';
    if (guideLayer) guideLayer.hidden = true;
    setProjectNavOpen(false, false);
    if (remember) rememberGuideCompletion();
    renderBoard();

    if (returnFocus && focusTarget && document.contains(focusTarget)) {
      window.requestAnimationFrame(function () { focusTarget.focus(); });
    }
  }

  function startGuide() {
    if (!state.activeMemberId || guide.active || !guideLayer || !guideCard) return;
    guide.active = true;
    guide.step = 0;
    guide.project = makeGuideProject();
    guide.lastFocus = document.activeElement;
    guide.previousProjectId = state.activeProjectId;
    state.activeProjectId = GUIDE_PROJECT_ID;
    guideLayer.hidden = false;
    renderBoard();
    renderGuideStep(0);
  }

  function maybeStartGuide() {
    try {
      if (localStorage.getItem(GUIDE_STORAGE_KEY) === '1') return;
    } catch (_) {}
    window.setTimeout(startGuide, 450);
  }

  function trapGuideFocus(event) {
    if (!guideCard || event.key !== 'Tab') return;
    var controls = guideCard.querySelectorAll('button:not([disabled]), [href], input, select, textarea');
    var focusable = Array.prototype.filter.call(controls, function (node) {
      return !node.hidden && node.offsetParent !== null;
    });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ---------- membership helpers ---------- */

  function isProjectMember(project, memberId) {
    if (!memberId) return false;
    return (project.members || []).indexOf(String(memberId)) !== -1;
  }

  function canEdit(project) {
    if (isGuideProject(project)) return guide.active;
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
      currentUserTitle.textContent = '全部成员';
    } else if (String(state.selectedMemberId) === String(state.activeMemberId)) {
      currentUserTitle.textContent = '我的课题';
    } else {
      currentUserTitle.textContent = memberName(state.selectedMemberId) + '的课题';
    }
    if (viewMineBtn) {
      var showingMine = String(state.selectedMemberId) === String(state.activeMemberId);
      viewMineBtn.classList.toggle('is-selected', showingMine);
      viewMineBtn.setAttribute('aria-pressed', showingMine ? 'true' : 'false');
    }
  }

  function visibleProjects() {
    var projects = state.selectedMemberId === 'all' ? state.projects.slice() : state.projects.filter(function (project) {
      return isProjectMember(project, state.selectedMemberId);
    });
    if (guide.active && guide.project) projects.unshift(guide.project);
    return projects;
  }

  function selectMemberView(memberId, scroll) {
    state.selectedMemberId = memberId || 'all';
    if (memberSelect) memberSelect.value = state.selectedMemberId;
    setProjectNavOpen(false, false);
    saveStore();
    updateHeading();
    renderBoard();

    if (scroll && projectLayout) {
      projectLayout.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
    }
  }

  function projectRowById(projectId) {
    if (!board) return null;
    var rows = board.querySelectorAll('[data-project-id]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-project-id') === String(projectId)) return rows[i];
    }
    return null;
  }

  function usesProjectNavDrawer() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 1040px)').matches);
  }

  function syncFixedProjectRail() {
    projectRailPositionFrame = null;
    if (!projectRail || !projectLayout) return;
    if (usesProjectNavDrawer() || projectRail.hidden) {
      projectRail.style.removeProperty('--project-rail-left');
      projectRail.style.removeProperty('--project-rail-top');
      return;
    }
    var layoutRect = projectLayout.getBoundingClientRect();
    if (!layoutRect.width) return;
    var rootStyle = window.getComputedStyle(root);
    var appbarHeight = parseFloat(rootStyle.getPropertyValue('--appbar-h')) || 68;
    projectRail.style.setProperty('--project-rail-left', layoutRect.left + 'px');
    projectRail.style.setProperty('--project-rail-top',
      Math.max(appbarHeight + 16, layoutRect.top) + 'px');
  }

  function scheduleProjectRailPosition() {
    if (projectRailPositionFrame) return;
    if (window.requestAnimationFrame) {
      projectRailPositionFrame = window.requestAnimationFrame(syncFixedProjectRail);
    } else {
      syncFixedProjectRail();
    }
  }

  function setProjectNavOpen(open, returnFocus) {
    open = !!open && usesProjectNavDrawer();
    if (projectRail) projectRail.classList.toggle('is-open', open);
    if (projectNavToggle) {
      projectNavToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      projectNavToggle.setAttribute('aria-label', open ? '关闭课题导航' : '打开课题导航');
      projectNavToggle.title = open ? '关闭课题导航' : '打开课题导航';
    }
    if (projectNavToggleLabel) projectNavToggleLabel.textContent = open ? '关闭导航' : '课题导航';
    if (projectNavScrim) projectNavScrim.hidden = !open;
    if (!open && returnFocus && projectNavToggle) {
      try { projectNavToggle.focus({ preventScroll: true }); }
      catch (_) { projectNavToggle.focus(); }
    }
  }

  function keepProjectNavItemVisible(item) {
    if (!projectNav || !item) return;
    if (usesProjectNavDrawer() && (!projectRail || !projectRail.classList.contains('is-open'))) {
      return;
    }
    var navRect = projectNav.getBoundingClientRect();
    var itemRect = item.getBoundingClientRect();
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var options = { behavior: reducedMotion ? 'auto' : 'smooth' };

    if (itemRect.top >= navRect.top && itemRect.bottom <= navRect.bottom) return;
    options.top = projectNav.scrollTop + itemRect.top - navRect.top -
      (projectNav.clientHeight - itemRect.height) / 2;

    if (typeof projectNav.scrollTo === 'function') projectNav.scrollTo(options);
    else projectNav.scrollTop = options.top;
  }

  function setActiveProjectNavigation(projectId, reveal) {
    if (!projectNav) return;
    var key = String(projectId || '');
    state.activeProjectId = key;
    var currentItem = null;
    var items = projectNav.querySelectorAll('[data-project-nav-id]');
    Array.prototype.forEach.call(items, function (item) {
      var current = item.getAttribute('data-project-nav-id') === key;
      item.classList.toggle('is-current', current);
      if (current) {
        item.setAttribute('aria-current', 'location');
        currentItem = item;
      } else {
        item.removeAttribute('aria-current');
      }
    });
    if (reveal) keepProjectNavItemVisible(currentItem);
  }

  function renderProjectNavigation(projects) {
    var hasProjects = projects.length > 0;
    if (projectLayout) projectLayout.classList.toggle('has-no-projects', !hasProjects);
    if (projectRail) projectRail.hidden = !hasProjects;
    if (projectNavToggle) projectNavToggle.hidden = !hasProjects;
    scheduleProjectRailPosition();
    if (!projectNav) return;
    projectNav.innerHTML = '';

    if (!hasProjects) {
      setProjectNavOpen(false, false);
      state.activeProjectId = '';
      if (projectNavObserver) projectNavObserver.disconnect();
      projectNavObserver = null;
      return;
    }

    var activeExists = projects.some(function (project) {
      return String(project.id) === String(state.activeProjectId);
    });
    if (!activeExists) state.activeProjectId = String(projects[0].id);

    projects.forEach(function (project) {
      var status = statusValue(project);
      var item = el('button', 'progress-project-nav-item');
      item.type = 'button';
      item.setAttribute('data-project-nav-id', String(project.id));
      if (isGuideProject(project)) item.classList.add('progress-project-nav-item--guide');

      var marker = svgIcon(statusIconName(status));
      marker.classList.add('progress-project-nav-marker');
      item.appendChild(marker);
      var copy = el('span', 'progress-project-nav-copy');
      copy.appendChild(el('span', 'progress-project-nav-name', project.name));
      copy.appendChild(el('span', 'progress-project-nav-status', status));
      item.appendChild(copy);

      item.addEventListener('click', function () {
        var row = projectRowById(project.id);
        if (!row) return;
        var reducedMotion = window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setActiveProjectNavigation(project.id, false);
        if (usesProjectNavDrawer()) {
          row.setAttribute('tabindex', '-1');
          try { row.focus({ preventScroll: true }); }
          catch (_) { row.focus(); }
          setProjectNavOpen(false, false);
        }
        row.scrollIntoView({
          behavior: reducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
      projectNav.appendChild(item);
    });

    setActiveProjectNavigation(state.activeProjectId, false);
  }

  function observeProjectNavigation() {
    if (projectNavObserver) projectNavObserver.disconnect();
    projectNavObserver = null;
    projectNavVisibility = {};
    if (!board || !projectNav || !window.IntersectionObserver) return;

    var rows = board.querySelectorAll('[data-project-id]');
    if (!rows.length) return;
    projectNavObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var id = entry.target.getAttribute('data-project-id');
        projectNavVisibility['project:' + id] = entry.isIntersecting;
      });

      var target = null;
      var targetDistance = Infinity;
      Array.prototype.forEach.call(rows, function (row) {
        var id = row.getAttribute('data-project-id');
        if (!projectNavVisibility['project:' + id]) return;
        var distance = Math.abs(row.getBoundingClientRect().top - window.innerHeight * 0.18);
        if (distance < targetDistance) {
          target = id;
          targetDistance = distance;
        }
      });
      if (target !== null) setActiveProjectNavigation(target, true);
    }, {
      root: null,
      rootMargin: '-18% 0px -62% 0px',
      threshold: 0
    });

    Array.prototype.forEach.call(rows, function (row) {
      projectNavObserver.observe(row);
    });
  }

  /* ---------- calendar window (day-accurate) ---------- */

  function projectEntries(project) {
    return Array.isArray(project.progress) ? project.progress : [];
  }

  function projectPlans(project) {
    return Array.isArray(project.plans) ? project.plans : [];
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
      projectPlans(project).forEach(function (plan) {
        var deadline = parseISO(plan.deadline);
        if (deadline && deadline < min) min = deadline;
        if (deadline && deadline > max) max = deadline;
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

  // Compact Chinese weekday labels, indexed by Date#getDay() (0 = Sunday).
  var WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* Short weekday label for a day cell's top line. */
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

  // Google Material Icons path data, kept inline so the page remains self-contained.
  function svgIcon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('class', 'progress-material-icon');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var icons = {
      add: ['0 0 24 24', 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'],
      school: ['0 -960 960 960', 'M840-120v-480L520-760 200-600v240h-80v-280l400-200 400 200v520h-80ZM520-320 280-440v160l240 120 240-120v-160L520-320Z'],
      close: ['0 0 24 24', 'm18.3 5.71-1.41-1.42L12 9.17 7.11 4.29 5.7 5.71l4.89 4.88-4.89 4.89 1.41 1.41L12 12l4.89 4.89 1.41-1.41-4.89-4.89z'],
      analysis: ['0 -960 960 960', 'M291.5-468.5Q280-457 280-440v120q0 17 11.5 28.5T320-280q17 0 28.5-11.5T360-320v-120q0-17-11.5-28.5T320-480q-17 0-28.5 11.5Zm320-200Q600-657 600-640v320q0 17 11.5 28.5T640-280q17 0 28.5-11.5T680-320v-320q0-17-11.5-28.5T640-680q-17 0-28.5 11.5Zm-160 280Q440-377 440-360v40q0 17 11.5 28.5T480-280q17 0 28.5-11.5T520-320v-40q0-17-11.5-28.5T480-400q-17 0-28.5 11.5ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm308.5-292Q520-503 520-520t-11.5-28.5Q497-560 480-560t-28.5 11.5Q440-537 440-520t11.5 28.5Q463-480 480-480t28.5-12Z'],
      arrow_drop_down: ['0 -960 960 960', 'M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z'],
      calendar: ['0 -960 960 960', 'M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-40q0-17 11.5-28.5T280-880q17 0 28.5 11.5T320-840v40h320v-40q0-17 11.5-28.5T680-880q17 0 28.5 11.5T720-840v40h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Z'],
      chart: ['0 -960 960 960', 'M97-280q0-17 13-30l213-213q23-23 57-23t57 23l103 103 256-289q11-13 28.5-13t29.5 12q11 11 11.5 26.5T855-656L596-364q-23 26-57 27.5T480-360L380-460 170-250q-13 13-30 13t-30-13q-13-13-13-30Z'],
      checklist: ['0 -960 960 960', 'm221-313 142-142q12-12 28-11.5t28 12.5q11 12 11 28t-11 28L250-228q-12 12-28 12t-28-12l-86-86q-11-11-11-28t11-28q11-11 28-11t28 11l57 57Zm0-320 142-142q12-12 28-11.5t28 12.5q11 12 11 28t-11 28L250-548q-12 12-28 12t-28-12l-86-86q-11-11-11-28t11-28q11-11 28-11t28 11l57 57Zm339 353q-17 0-28.5-11.5T520-320q0-17 11.5-28.5T560-360h280q17 0 28.5 11.5T880-320q0 17-11.5 28.5T840-280H560Zm0-320q-17 0-28.5-11.5T520-640q0-17 11.5-28.5T560-680h280q17 0 28.5 11.5T880-640q0 17-11.5 28.5T840-600H560Z'],
      collect_data: ['0 -960 960 960', 'M200-120q-51 0-72.5-45.5T138-250l222-270v-240h-40q-17 0-28.5-11.5T280-800q0-17 11.5-28.5T320-840h320q17 0 28.5 11.5T680-800q0 17-11.5 28.5T640-760h-40v240l222 270q32 39 10.5 84.5T760-120H200Zm80-120h400L544-400H416L280-240Z'],
      delete: ['0 -960 960 960', 'M280-120q-33 0-56.5-23.5T200-200v-520q-17 0-28.5-11.5T160-760q0-17 11.5-28.5T200-800h160q0-17 11.5-28.5T400-840h160q17 0 28.5 11.5T600-800h160q17 0 28.5 11.5T800-760q0 17-11.5 28.5T760-720v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM428.5-291.5Q440-303 440-320v-280q0-17-11.5-28.5T400-640q-17 0-28.5 11.5T360-600v280q0 17 11.5 28.5T400-280q17 0 28.5-11.5Zm160 0Q600-303 600-320v-280q0-17-11.5-28.5T560-640q-17 0-28.5 11.5T520-600v280q0 17 11.5 28.5T560-280q17 0 28.5-11.5Z'],
      done: ['0 -960 960 960', 'M70-438q-12-12-11.5-28T71-494q12-11 28-11.5t28 11.5l142 142 14 14 14 14q12 12 11.5 28T296-268q-12 11-28 11.5T240-268L70-438Zm424 85 340-340q12-12 28-11.5t28 12.5q11 12 11.5 28T890-636L522-268q-12 12-28 12t-28-12L296-438q-11-11-11-27.5t11-28.5q12-12 28.5-12t28.5 12l141 141Zm169-282L522-494q-11 11-27.5 11T466-494q-12-12-12-28.5t12-28.5l141-141q11-11 27.5-11t28.5 11q12 12 12 28.5T663-635Z'],
      edit: ['0 -960 960 960', 'M200-200h57l391-391-57-57-391 391v57Zm-40 80q-17 0-28.5-11.5T120-160v-97q0-16 6-30.5t17-25.5l505-504q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L313-143q-11 11-25.5 17t-30.5 6h-97Z'],
      experiment_design: ['0 -960 960 960', 'm352-522 86-87-56-57-16 16q-11 11-27.5 11.5T310-650q-12-12-12-28.5t12-28.5l15-15-45-45-87 87 159 158Zm328 329 87-87-45-45-16 15q-12 12-28 12t-28-12q-12-12-12-28t12-28l15-16-57-56-86 86 158 159ZM160-120q-17 0-28.5-11.5T120-160v-113q0-8 3-15.5t9-13.5l163-163-173-173q-17-17-17-42t17-42l116-116q17-17 42-16.5t42 17.5l174 173 151-152q12-12 27-18t31-6q16 0 31 6t27 18l53 54q12 12 18 27t6 31q0 16-6 30.5T816-647L665-495l173 173q17 17 17 42t-17 42L722-122q-17 17-42 17t-42-17L465-295 302-132q-6 6-13.5 9t-15.5 3H160Zm40-80h56l392-391-57-57-391 392v56Z'],
      members: ['0 -960 960 960', 'M40-272q0-34 17.5-62.5T104-378q62-31 126-46.5T360-440q66 0 130 15.5T616-378q29 15 46.5 43.5T680-272v32q0 33-23.5 56.5T600-160H120q-33 0-56.5-23.5T40-240v-32Zm800 112H738q11-18 16.5-38.5T760-240v-40q0-44-24.5-84.5T666-434q51 6 96 20.5t84 35.5q36 20 55 44.5t19 53.5v40q0 33-23.5 56.5T840-160ZM247-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm466 0q-47 47-113 47-11 0-28-2.5t-28-5.5q27-32 41.5-71t14.5-81q0-42-14.5-81T544-792q14-5 28-6.5t28-1.5q66 0 113 47t47 113q0 66-47 113ZM120-240h480v-32q0-11-5.5-20T580-306q-54-27-109-40.5T360-360q-56 0-111 13.5T140-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q440-607 440-640t-23.5-56.5Q393-720 360-720t-56.5 23.5Q280-673 280-640t23.5 56.5Q327-560 360-560t56.5-23.5Z'],
      reading_article: ['0 -960 960 960', 'M270-80q-45 0-77.5-30.5T160-186v-558q0-38 23.5-68t61.5-38l300-59q37-8 66 16t29 62v477q0 29-18 51.5T576-275l-315 63q-9 2-15 9.5t-6 16.5q0 11 9 18.5t21 7.5h450v-600q0-17 11.5-28.5T760-800q17 0 28.5 11.5T800-760v600q0 33-23.5 56.5T720-80H270Zm90-233 200-39v-478l-200 39v478Zm-80 16v-478l-15 3q-11 2-18 9.5t-7 18.5v457q5-2 10.5-3.5T261-293l19-4Z'],
      submit: ['0 -960 960 960', 'M240-160q-33 0-56.5-23.5T160-240v-80q0-17 11.5-28.5T200-360q17 0 28.5 11.5T240-320v80h480v-80q0-17 11.5-28.5T760-360q17 0 28.5 11.5T800-320v80q0 33-23.5 56.5T720-160H240Zm200-486-75 75q-12 12-28.5 11.5T308-572q-11-12-11.5-28t11.5-28l144-144q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l144 144q12 12 11.5 28T652-572q-12 12-28.5 12.5T595-571l-75-75v286q0 17-11.5 28.5T480-320q-17 0-28.5-11.5T440-360v-286Z'],
      writing: ['0 -960 960 960', 'M160 0q-33 0-56.5-23.5T80-80q0-33 23.5-56.5T160-160h640q33 0 56.5 23.5T880-80q0 33-23.5 56.5T800 0H160Zm80-320h56l312-311-29-29-28-28-311 312v56Zm-80 40v-113q0-8 3-15.5t9-13.5l436-435q11-11 25.5-17t30.5-6q16 0 31 6t27 18l55 56q12 11 17.5 26t5.5 31q0 15-5.5 29.5T777-687L342-252q-6 6-13.5 9t-15.5 3H200q-17 0-28.5-11.5T160-280Z']
    };
    var icon = icons[name] || icons.chart;
    svg.setAttribute('viewBox', icon[0]);
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', icon[1]);
    svg.appendChild(path);
    return svg;
  }

  function renderMemberChips(project, removable) {
    var wrap = el('div', 'project-member-chips');
    wrap.classList.add(removable ? 'project-member-chips--editable' : 'project-member-chips--summary');
    var projectMembers = project.members || [];
    var memberIds = projectMembers.filter(function (id) {
      return String(id) !== String(leaderId);
    });
    if (projectMembers.some(function (id) { return String(id) === String(leaderId); })) {
      memberIds.push(leaderId);
    }
    memberIds.forEach(function (id) {
      var chip = el('span', 'member-chip');
      if (String(id) === leaderId) chip.classList.add('member-chip--leader');
      var target = el('button', 'member-chip-target');
      target.type = 'button';
      target.setAttribute('aria-label', '查看' + memberName(id) + '的课题');
      var avatar = el('span', 'member-chip-avatar', avatarGlyph(memberName(id)));
      avatar.style.setProperty('--member-color', memberColor(id));
      avatar.setAttribute('aria-hidden', 'true');
      target.appendChild(avatar);
      target.appendChild(el('span', 'member-chip-name', memberName(id)));
      target.addEventListener('click', function () { selectMemberView(id, true); });
      if (String(id) === leaderId) {
        target.title = '课题负责人，查看方霞的课题';
      }
      chip.appendChild(target);
      if (removable && String(id) !== leaderId && canEdit(project)) {
        var remove = el('button', 'member-chip-remove');
        remove.type = 'button';
        remove.title = '移除成员';
        remove.setAttribute('aria-label', '移除 ' + memberName(id));
        remove.appendChild(svgIcon('close'));
        remove.addEventListener('click', function () { removeMember(project.id, id); });
        var removeSlot = el('span', 'member-chip-remove-slot');
        removeSlot.appendChild(remove);
        chip.appendChild(removeSlot);
      }
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function renderMembersPanel(project) {
    var panel = el('div', 'project-panel project-panel--members');
    panel.appendChild(el('h4', 'project-panel-title', '课题成员'));
    panel.appendChild(renderMemberChips(project, true));

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
    var selectControl = el('span', 'project-member-select');
    select.className = 'project-member-select-input';
    selectControl.appendChild(select);
    var selectCaret = svgIcon('arrow_drop_down');
    selectCaret.classList.add('project-member-select-caret');
    selectControl.appendChild(selectCaret);
    field.appendChild(selectControl);
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
    note.placeholder = '例如：收数据，编写实验程序……';
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

  function renderPlanPanel(project) {
    var panel = el('div', 'project-panel project-panel--plan');
    panel.appendChild(el('h4', 'project-panel-title', '添加计划'));
    var form = el('form', 'project-plan-form');

    var textField = el('label', 'progress-field');
    textField.appendChild(el('span', null, '计划内容'));
    var textInput = document.createElement('textarea');
    textInput.rows = 3;
    textInput.required = true;
    textInput.maxLength = 500;
    textInput.placeholder = '例如：完成预实验并整理反馈';
    textField.appendChild(textInput);
    form.appendChild(textField);

    var deadlineField = el('label', 'progress-field project-plan-deadline-field');
    deadlineField.appendChild(el('span', null, '截止日期'));
    var deadlineInput = document.createElement('input');
    deadlineInput.type = 'date';
    deadlineInput.required = true;
    deadlineInput.value = dateToISO(addDays(new Date(), 7));
    deadlineField.appendChild(deadlineInput);
    form.appendChild(deadlineField);

    var submit = el('button', 'btn btn-filled', '添加计划');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      addPlan(project.id, {
        deadline: deadlineInput.value,
        text: textInput.value.trim()
      });
    });
    panel.appendChild(form);
    return panel;
  }

  function sortedPlans(project) {
    return projectPlans(project).slice().sort(function (a, b) {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function renderPlanList(project) {
    var plans = sortedPlans(project);
    var editable = canEdit(project);
    if (!plans.length) return null;

    var section = el('section', 'project-plans');
    var head = el('div', 'project-plans-head');
    head.appendChild(el('h4', 'project-plans-title', '计划'));
    var completedCount = plans.filter(function (plan) { return plan.completed; }).length;
    head.appendChild(el('span', 'project-plans-summary',
      completedCount + ' / ' + plans.length + ' 已完成'));
    section.appendChild(head);

    var list = el('ul', 'project-plan-list');
    plans.forEach(function (plan) {
      var item = el('li', 'project-plan-item');
      item.id = 'plan-' + String(plan.id).replace(/[^a-zA-Z0-9_-]/g, '');
      if (plan.completed) item.classList.add('is-completed');
      var overdue = !plan.completed && plan.deadline < todayISO();
      if (overdue) item.classList.add('is-overdue');

      var label = el('label', 'project-plan-toggle');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!plan.completed;
      checkbox.disabled = !editable;
      checkbox.setAttribute('aria-label',
        (plan.completed ? '重新打开计划：' : '完成计划：') + plan.text);
      checkbox.addEventListener('change', function () {
        checkbox.disabled = true;
        setPlanCompleted(project.id, plan.id, checkbox.checked);
      });
      label.appendChild(checkbox);
      label.appendChild(el('span', 'project-plan-check', ''));

      var content = el('span', 'project-plan-content');
      content.appendChild(el('span', 'project-plan-text', plan.text));
      var deadline = el('time', 'project-plan-deadline',
        (overdue ? '已逾期 · ' : '截止 ') + formatDate(plan.deadline));
      deadline.dateTime = plan.deadline;
      content.appendChild(deadline);
      label.appendChild(content);
      item.appendChild(label);

      if (editable) {
        var remove = el('button', 'project-plan-delete');
        remove.type = 'button';
        remove.title = '删除计划';
        remove.setAttribute('aria-label', '删除计划：' + plan.text);
        remove.appendChild(svgIcon('close'));
        remove.addEventListener('click', function () {
          if (window.confirm('确认删除计划「' + plan.text + '」吗？')) {
            deletePlan(project.id, plan.id);
          }
        });
        item.appendChild(remove);
      }
      list.appendChild(item);
    });
    section.appendChild(list);
    return section;
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

    // Plan deadlines occupy their own marker layer. Plans sharing a deadline
    // collapse into one marker with a count so they never obscure each other.
    var plansByDeadline = {};
    projectPlans(project).forEach(function (plan) {
      if (!parseISO(plan.deadline)) return;
      if (!plansByDeadline[plan.deadline]) plansByDeadline[plan.deadline] = [];
      plansByDeadline[plan.deadline].push(plan);
    });
    var deadlineLayer = el('div', 'calendar-deadlines');
    Object.keys(plansByDeadline).forEach(function (deadline) {
      var offset = diffDays(gridStart, parseISO(deadline));
      if (offset < 0 || offset >= dayCount) return;
      var duePlans = plansByDeadline[deadline];
      var marker = el('button', 'calendar-deadline');
      marker.type = 'button';
      marker.style.setProperty('--day', String(offset));
      var allCompleted = duePlans.every(function (plan) { return plan.completed; });
      var overdue = !allCompleted && deadline < todayISO();
      if (allCompleted) marker.classList.add('is-completed');
      if (overdue) marker.classList.add('is-overdue');
      marker.title = '计划截止 ' + formatDate(deadline) + '：' + duePlans.map(function (plan) {
        return (plan.completed ? '✓ ' : '') + plan.text;
      }).join('；');
      marker.setAttribute('aria-label', '查看 ' + formatDate(deadline) + ' 截止的计划');
      marker.appendChild(el('span', 'calendar-deadline-diamond', ''));
      if (duePlans.length > 1) {
        marker.appendChild(el('span', 'calendar-deadline-count', String(duePlans.length)));
      }
      marker.addEventListener('click', function () {
        openPlanDeadlineDetail(project, duePlans, deadline);
      });
      deadlineLayer.appendChild(marker);
    });
    body.appendChild(deadlineLayer);

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
      bar.setAttribute('aria-label', (editable ? '查看或编辑进展：' : '查看进展：') + bar.title);
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

  function statusIconName(status) {
    return STATUS_ICONS[status] || STATUS_ICONS[DEFAULT_STATUS];
  }

  /* Editable project title. For members it renders as a button that swaps to an
     inline text field on click; for others it's a plain heading. */
  function renderProjectTitle(project) {
    if (!canEdit(project)) {
      return el('h3', 'project-title', project.name);
    }
    var btn = el('button', 'project-title project-title--editable');
    btn.type = 'button';
    btn.title = '点击重命名课题';
    btn.setAttribute('aria-label', '重命名课题：' + project.name);
    btn.appendChild(el('span', 'project-title-text', project.name));
    btn.appendChild(svgIcon('edit'));
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
      var statusIcon = svgIcon(statusIconName(current));
      statusIcon.classList.add('project-status-icon');
      wrap.appendChild(statusIcon);
      wrap.appendChild(el('span', 'project-status-label', current));
      var caret = svgIcon('arrow_drop_down');
      caret.classList.add('project-status-caret');
      wrap.appendChild(caret);
      var select = document.createElement('select');
      select.className = 'project-status-select';
      select.setAttribute('aria-label', '设置「' + project.name + '」的课题状态');
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
      return wrap;
    }

    var pill = el('span', 'project-status');
    pill.setAttribute('data-ended', ended ? 'true' : 'false');
    var pillIcon = svgIcon(statusIconName(current));
    pillIcon.classList.add('project-status-icon');
    pill.appendChild(pillIcon);
    pill.appendChild(el('span', 'project-status-label', current));
    return pill;
  }

  function renderProjectFacts(project) {
    var facts = el('div', 'project-facts');
    var entries = projectEntries(project);
    var openPlans = projectPlans(project).filter(function (plan) { return !plan.completed; });
    facts.appendChild(el('span', 'project-fact', entries.length + ' 条进展'));
    facts.appendChild(el('span', 'project-fact', openPlans.length + ' 项待办'));

    var latest = '';
    entries.forEach(function (entry) {
      var date = entry.endDate || entry.startDate || '';
      if (date > latest) latest = date;
    });
    if (latest) facts.appendChild(el('span', 'project-fact', '最近更新 ' + formatDate(latest)));
    return facts;
  }

  function renderProjectRow(project, ticks, gridStart, dayCount) {
    var row = el('article', 'project-row');
    row.setAttribute('data-project-id', String(project.id));
    if (isEnded(project)) row.classList.add('project-row--ended');
    if (isGuideProject(project)) row.classList.add('project-row--guide-demo');

    var head = el('div', 'project-row-head');
    var info = el('div', 'project-row-info');
    var titleRow = el('div', 'project-title-row');
    titleRow.appendChild(renderProjectTitle(project));
    titleRow.appendChild(renderStatusControl(project));
    if (isGuideProject(project)) {
      var demoBadge = el('span', 'project-demo-badge');
      demoBadge.appendChild(svgIcon('school'));
      demoBadge.appendChild(el('span', null, '演示'));
      titleRow.appendChild(demoBadge);
    }
    info.appendChild(titleRow);

    var dates = el('p', 'project-dates', '开始于 ' + formatDate(project.startDate));
    if (project.endDate) dates.textContent += ' · 结束于 ' + formatDate(project.endDate);
    var meta = el('div', 'project-meta');
    meta.appendChild(dates);
    meta.appendChild(renderProjectFacts(project));
    info.appendChild(meta);
    info.appendChild(renderMemberChips(project, false));
    head.appendChild(info);

    // Per-row action buttons.
    var actions = el('div', 'project-row-actions');
    var editable = canEdit(project);
    var openPanel = state.openPanels[project.id];
    var ended = isEnded(project);

    if (editable && !ended) {
      var progressAction = makeActionBtn('添加进展', 'chart', openPanel === 'progress', function () {
        togglePanel(project.id, 'progress');
      });
      progressAction.classList.add('project-action--primary');
      actions.appendChild(progressAction);
      actions.appendChild(makeActionBtn('添加计划', 'checklist', openPanel === 'plan', function () {
        togglePanel(project.id, 'plan');
      }));
    }
    if (editable) {
      actions.appendChild(makeActionBtn('成员', 'members', openPanel === 'members', function () {
        togglePanel(project.id, 'members');
      }));
      var del = makeActionBtn('删除课题', 'delete', false, function () {
        deleteProject(project.id);
      }, true);
      del.classList.add('project-action--danger');
      actions.appendChild(del);
    }
    head.appendChild(actions);
    row.appendChild(head);

    if (editable && openPanel === 'progress' && !ended) {
      row.appendChild(renderProgressPanel(project));
    } else if (editable && openPanel === 'plan' && !ended) {
      row.appendChild(renderPlanPanel(project));
    } else if (editable && openPanel === 'members') {
      row.appendChild(renderMembersPanel(project));
    }

    var planList = renderPlanList(project);
    if (planList) {
      row.classList.add('project-row--has-plans');
      row.appendChild(planList);
    }

    var timeline = el('section', 'project-timeline');
    var timelineHead = el('div', 'project-timeline-head');
    var timelineTitle = el('span', 'project-timeline-title');
    timelineTitle.appendChild(el('span', 'project-timeline-title-text', '进展时间线'));
    timelineTitle.appendChild(el('span', 'project-timeline-count',
      projectEntries(project).length + ' 条记录'));
    timelineHead.appendChild(timelineTitle);

    var timelineTools = el('div', 'project-timeline-tools');
    var legend = el('div', 'project-timeline-legend');
    var todayLegend = el('span', 'project-legend-item');
    todayLegend.appendChild(el('span', 'project-legend-today', ''));
    todayLegend.appendChild(el('span', null, '今天'));
    legend.appendChild(todayLegend);
    var deadlineLegend = el('span', 'project-legend-item');
    deadlineLegend.appendChild(el('span', 'project-legend-deadline', ''));
    deadlineLegend.appendChild(el('span', null, '计划截止'));
    legend.appendChild(deadlineLegend);
    timelineTools.appendChild(legend);

    var todayButton = el('button', 'project-today-button');
    todayButton.type = 'button';
    todayButton.appendChild(svgIcon('calendar'));
    todayButton.appendChild(el('span', null, '回到今天'));
    timelineTools.appendChild(todayButton);
    timelineHead.appendChild(timelineTools);
    timeline.appendChild(timelineHead);

    var scroller = el('div', 'project-calendar-scroll');
    scroller.appendChild(renderCalendar(project, ticks, gridStart, dayCount));
    todayButton.addEventListener('click', function () {
      scrollScrollerToToday(scroller, true);
    });
    timeline.appendChild(scroller);
    row.appendChild(timeline);
    return row;
  }

  function makeActionBtn(label, iconName, active, handler, iconOnly) {
    var btn = el('button', 'project-action');
    btn.type = 'button';
    if (iconName) btn.appendChild(svgIcon(iconName));
    if (!iconOnly) btn.appendChild(el('span', null, label));
    if (iconOnly) {
      btn.classList.add('project-action--icon');
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
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

    if (projectCount) {
      projectCount.textContent = guide.active ?
        Math.max(0, projects.length - 1) + ' 个课题 · 1 个演示' :
        projects.length + ' 个课题';
    }

    // Only prompt to create a project when it's actionable (own/all view).
    if (emptyState) {
      if (projects.length) {
        emptyState.hidden = true;
      } else if (ownView) {
        emptyState.hidden = false;
        emptyState.textContent = '暂时还没有课题。';
      } else {
        emptyState.hidden = false;
        emptyState.textContent = memberName(state.selectedMemberId) + '还没有参与任何课题。';
      }
    }

    renderProjectNavigation(projects);
    if (!projects.length) return;

    var range = boardWindow(projects);
    var ticks = makeDayTicks(range.start, range.end);
    var dayCount = diffDays(range.start, range.end) + 1;
    state.boardDayCount = dayCount;
    state.boardTodayOffset = diffDays(range.start, new Date());
    projects.forEach(function (project) {
      board.appendChild(renderProjectRow(project, ticks, range.start, dayCount));
    });
    observeProjectNavigation();
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
  function scrollScrollerToToday(scroller, smooth) {
    var todayOffset = state.boardTodayOffset;
    if (!scroller || typeof todayOffset !== 'number' || todayOffset < 0) return;
    var calendar = scroller.querySelector('.project-calendar');
    if (!calendar) return;
    var dayW = parseFloat(window.getComputedStyle(calendar).getPropertyValue('--day-w')) || 44;
    var target = Math.max(0, todayOffset * dayW - scroller.clientWidth / 2);
    if (smooth && typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ left: target, behavior: 'smooth' });
    } else {
      scroller.scrollLeft = target;
    }
  }

  function scrollToToday() {
    if (!board) return;
    var scrollers = board.querySelectorAll('.project-calendar-scroll');
    Array.prototype.forEach.call(scrollers, function (scroller) {
      scrollScrollerToToday(scroller, false);
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
      avatar.style.setProperty('--member-color', memberColor(entry.authorId));
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

  /* ---------- plan deadline dialog ---------- */

  var planDialog = null;

  function closePlanDialog() {
    if (planDialog && planDialog.open) planDialog.close();
  }

  function openPlanDeadlineDetail(project, plans, deadline) {
    if (!planDialog) {
      planDialog = document.createElement('dialog');
      planDialog.className = 'entry-dialog plan-dialog';
      planDialog.addEventListener('click', function (event) {
        if (event.target === planDialog) closePlanDialog();
      });
      document.body.appendChild(planDialog);
    }

    planDialog.innerHTML = '';
    var wrap = el('div', 'entry-dialog-body plan-dialog-body');
    wrap.appendChild(el('h3', 'plan-dialog-title', '计划截止 · ' + formatDate(deadline)));
    wrap.appendChild(el('p', 'plan-dialog-project', project.name));

    var list = el('ul', 'plan-dialog-list');
    plans.forEach(function (plan) {
      var item = el('li', 'plan-dialog-item');
      if (plan.completed) item.classList.add('is-completed');
      item.appendChild(el('span', 'plan-dialog-status', plan.completed ? '已完成' : '待完成'));
      item.appendChild(el('p', 'plan-dialog-text', plan.text));
      list.appendChild(item);
    });
    wrap.appendChild(list);

    var actions = el('div', 'entry-dialog-actions');
    var close = el('button', 'btn btn-filled', '关闭');
    close.type = 'button';
    close.addEventListener('click', closePlanDialog);
    actions.appendChild(close);
    wrap.appendChild(actions);
    planDialog.appendChild(wrap);

    if (typeof planDialog.showModal === 'function') {
      planDialog.showModal();
    } else {
      planDialog.setAttribute('open', '');
    }
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
    if (!state.activeMemberId) { showToast('请先使用手机号登录。', true); return; }
    var name = projectForm.elements.name.value.trim();
    var startDate = projectForm.elements.startDate.value;
    if (!name || !startDate) return;

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
      name: name,
      startDate: startDate
    }).then(function (data) {
      finish(data.project);
    }).catch(function (error) {
      handleWriteError(error, '课题创建失败。');
    });
  }

  function addProgress(projectId, payload) {
    if (!state.activeMemberId) { showToast('请先使用手机号登录。', true); return; }
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }
    if (!payload.startDate || !payload.endDate || !payload.note) return;
    if (parseISO(payload.startDate) > parseISO(payload.endDate)) {
      showToast('开始日期不能晚于结束日期。', true);
      return;
    }

    function finish(entry) {
      project.progress = project.progress || [];
      project.progress.push(entry);
      state.openPanels[projectId] = null;
      saveStore();
      renderBoard();
      showToast('进展已添加。');
    }

    api('POST', '/entries', {
      projectId: projectId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      note: payload.note
    }).then(function (data) {
      finish(data.entry);
    }).catch(function (error) {
      handleWriteError(error, '进展添加失败。');
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

    api('DELETE', '/entries/' + encodeURIComponent(entryId)).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '进展删除失败。');
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
      startDate: payload.startDate,
      endDate: payload.endDate,
      note: payload.note
    }).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '进展更新失败。');
    });
  }

  function addPlan(projectId, payload) {
    if (!state.activeMemberId) { showToast('请先使用手机号登录。', true); return; }
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }
    if (!payload.deadline || !payload.text) return;

    function finish(plan) {
      project.plans = project.plans || [];
      project.plans.push(plan);
      state.openPanels[projectId] = null;
      saveStore();
      renderBoard();
      showToast('计划已添加。');
    }

    api('POST', '/plans', {
      projectId: projectId,
      deadline: payload.deadline,
      text: payload.text
    }).then(function (data) {
      finish(data.plan);
    }).catch(function (error) {
      handleWriteError(error, '计划添加失败。');
    });
  }

  function setPlanCompleted(projectId, planId, completed) {
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }

    function finish(planData) {
      var plans = project.plans || [];
      for (var i = 0; i < plans.length; i++) {
        if (String(plans[i].id) === String(planId)) {
          plans[i].completed = !!completed;
          plans[i].completedAt = planData.completedAt || null;
          break;
        }
      }
      saveStore();
      renderBoard();
      showToast(completed ? '计划已完成。' : '计划已重新打开。');
    }

    api('PATCH', '/plans/' + encodeURIComponent(planId), {
      completed: !!completed
    }).then(function (data) {
      finish(data.plan);
    }).catch(function (error) {
      renderBoard();
      handleWriteError(error, '计划状态更新失败。');
    });
  }

  function deletePlan(projectId, planId) {
    var project = findProject(projectId);
    if (!project) return;
    if (!canEdit(project)) { showToast('你不是该课题的成员。', true); return; }

    function finish() {
      project.plans = (project.plans || []).filter(function (plan) {
        return String(plan.id) !== String(planId);
      });
      saveStore();
      renderBoard();
      showToast('计划已删除。');
    }

    api('DELETE', '/plans/' + encodeURIComponent(planId)).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '计划删除失败。');
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
      inviteId: inviteId
    }).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '成员添加失败。');
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
      '/members/' + encodeURIComponent(targetId)).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '成员移除失败。');
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
      name: name
    }).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '课题名称更新失败。');
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
      status: status
    }).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '课题状态更新失败。');
    });
  }

  function deleteProject(projectId) {
    var project = findProject(projectId);
    if (!project) return;
    if (!window.confirm('确认永久删除课题「' + project.name +
        '」及其全部进展和计划吗？此操作不可撤销。')) {
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

    api('DELETE', '/projects/' + encodeURIComponent(projectId)).then(function () {
      finish();
    }).catch(function (error) {
      handleWriteError(error, '课题删除失败。');
    });
  }

  /* ---------- events ---------- */

  function bindEvents() {
    if (sendCodeBtn) sendCodeBtn.addEventListener('click', sendPhoneCode);
    if (phoneLoginForm) phoneLoginForm.addEventListener('submit', completePhoneLogin);
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
    if (memberSelect) {
      memberSelect.addEventListener('change', function () {
        selectMemberView(memberSelect.value || 'all', false);
      });
    }
    if (viewMineBtn) {
      viewMineBtn.addEventListener('click', function () {
        selectMemberView(state.activeMemberId || 'all', false);
      });
    }
    if (guideLaunch) guideLaunch.addEventListener('click', startGuide);
    if (guideSkip) {
      guideSkip.addEventListener('click', function () { endGuide(true, true); });
    }
    if (guideBack) {
      guideBack.addEventListener('click', function () { renderGuideStep(guide.step - 1); });
    }
    if (guideNext) {
      guideNext.addEventListener('click', function () {
        if (guide.step >= GUIDE_STEPS.length - 1) endGuide(true, true);
        else renderGuideStep(guide.step + 1);
      });
    }
    if (projectToggle) {
      projectToggle.addEventListener('click', function () { toggleCreatePanel(); });
    }
    if (projectCancel) {
      projectCancel.addEventListener('click', function () { toggleCreatePanel(false); });
    }
    if (projectForm) projectForm.addEventListener('submit', createProject);
    if (projectNavToggle) {
      projectNavToggle.addEventListener('click', function () {
        var open = projectRail && projectRail.classList.contains('is-open');
        setProjectNavOpen(!open, false);
        if (!open && projectNav) {
          window.requestAnimationFrame(function () {
            keepProjectNavItemVisible(
              projectNav.querySelector('[data-project-nav-id].is-current') ||
              projectNav.querySelector('[data-project-nav-id]')
            );
          });
        }
      });
    }
    if (projectNavClose) {
      projectNavClose.addEventListener('click', function () {
        setProjectNavOpen(false, true);
      });
    }
    if (projectNavScrim) {
      projectNavScrim.addEventListener('click', function () {
        setProjectNavOpen(false, true);
      });
    }
    document.addEventListener('keydown', function (event) {
      if (guide.active) {
        if (event.key === 'Escape') {
          event.preventDefault();
          endGuide(true, true);
        } else {
          trapGuideFocus(event);
        }
        return;
      }
      if (event.key === 'Escape' && projectRail && projectRail.classList.contains('is-open')) {
        setProjectNavOpen(false, true);
      }
    });

    // Bar widths (rem-based min-width) and wrap points change with viewport
    // width, so re-measure and re-stack on resize.
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        if (!usesProjectNavDrawer()) setProjectNavOpen(false, false);
        scheduleProjectRailPosition();
        restackBoard();
      }, 150);
    });
    window.addEventListener('scroll', scheduleProjectRailPosition, { passive: true });
  }

  function bootAuthentication() {
    if (!envId) {
      setLoginStatus('页面缺少 CloudBase 环境配置。', true);
      return;
    }
    if (!window.cloudbase) {
      setLoginStatus('CloudBase 登录组件加载失败，请刷新页面。', true);
      return;
    }

    try {
      cloudApp = window.cloudbase.init({ env: envId, region: region });
      auth = cloudApp.auth({ persistence: 'local' });
    } catch (error) {
      setLoginStatus(error.message || 'CloudBase 初始化失败。', true);
      return;
    }

    if (!auth.hasLoginState()) {
      setLoginStatus('请输入手机号并获取验证码。');
      return;
    }

    setLoginBusy(true);
    setLoginStatus('正在恢复登录状态…');
    resolveMember('').then(openMemberSession).catch(function (error) {
      return auth.signOut().catch(function () {}).then(function () {
        setLoginStatus(error.message || '登录状态无效，请重新使用手机号登录。', true);
      });
    }).then(function () {
      setLoginBusy(false);
    });
  }

  /* ---------- boot ---------- */

  loadStore();
  state.projects = normalizeProjects(state.projects);
  fillViewerSelect();
  bindEvents();
  if (memberSelect) memberSelect.value = state.selectedMemberId;
  showWorkspace(false);
  updateHeading();
  renderBoard();
  bootAuthentication();
})();
