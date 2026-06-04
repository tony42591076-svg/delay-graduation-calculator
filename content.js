(function () {
  'use strict';

  const GUIDE_PATH = '/Student/GuidePage';
  const STUDENT_PATH = '/Student/';
  const LOGIN_PATH = '/Student/Account/Login';
  const STUDENT_URL = 'https://learningcounseling.fju.edu.tw/Student/';
  const TAB_NAMES = ['全人/校定', '必修', '必選', '其它'];

  function getAction() {
    return new URL(location.href).searchParams.get('bridge_action') || '';
  }

  function cleanText(text = '') {
    return text.replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function log(...args) {
    console.log('[FJU Diagnosis Bridge]', ...args);
  }

  function getText(el) {
    return cleanText(el?.innerText || el?.textContent || '');
  }

  function findClickableByText(patterns) {
    const els = Array.from(document.querySelectorAll('a, button, .nav-link, .dropdown-item, .btn'));
    return els.find(el => patterns.some(pattern => pattern.test(getText(el))));
  }

  function getActiveTabName() {
    const activeEl =
      document.querySelector('.nav-link.active') ||
      document.querySelector('.nav-item .nav-link.active') ||
      document.querySelector('.nav-item.active .nav-link') ||
      document.querySelector('.nav-item.active') ||
      document.querySelector('.active');

    return activeEl ? cleanText(activeEl.innerText) : '';
  }

  function getActiveTabPane() {
    return (
      document.querySelector('.tab-pane.show.active') ||
      document.querySelector('.tab-pane.active') ||
      document.querySelector('.tab-content .active') ||
      document
    );
  }

  function parseHeader(text) {
    const cleaned = cleanText(text);

    const trailingNoteMatch = cleaned.match(/\s+([A-Z])$/);
    const note = trailingNoteMatch ? trailingNoteMatch[1] : '';
    const normalized = trailingNoteMatch ? cleaned.replace(/\s+[A-Z]$/, '') : cleaned;

    const categoryPatterns = [
      '院系必修',
      '院系必選',
      '校訂',
      '全人',
      '必修',
      '必選',
      '其它'
    ];

    const categoryRegex = categoryPatterns.join('|');

    const match = normalized.match(
      new RegExp(`^(${categoryRegex})\\s+(.+?)\\s+(\\d+)(?:\\s+(學年課|學期課))?$`)
    );

    if (!match) {
      return {
        raw: cleaned,
        categoryLabel: '',
        sectionName: '',
        requiredCredits: null,
        courseType: '',
        note
      };
    }

    return {
      raw: cleaned,
      categoryLabel: cleanText(match[1]),
      sectionName: cleanText(match[2]),
      requiredCredits: Number(match[3]),
      courseType: cleanText(match[4] || ''),
      note
    };
  }

  function parseCourseLine(text) {
    const cleaned = cleanText(text);

    let match = cleaned.match(
      /^(\S+)\s*\/\s*(\d{3}-\d)\s+(.+?)\s+(\d+)\s+(未評定成績|\d+)(?:\s+(.*))?$/
    );

    if (match) {
      return {
        raw: cleaned,
        courseCode: cleanText(match[1]),
        semester: cleanText(match[2]),
        courseName: cleanText(match[3]),
        credits: Number(match[4]),
        score: cleanText(match[5]),
        flags: match[6] ? cleanText(match[6]).split(/\s+/).filter(Boolean) : []
      };
    }

    match = cleaned.match(
      /^(\S+)\s*\/\s*(\d{3}-\d)\s+(.+?)\s+(未評定成績|\d+)$/
    );

    if (match) {
      return {
        raw: cleaned,
        courseCode: cleanText(match[1]),
        semester: cleanText(match[2]),
        courseName: cleanText(match[3]),
        score: cleanText(match[4]),
        flags: []
      };
    }

    return {
      raw: cleaned,
      courseCode: '',
      semester: '',
      courseName: '',
      score: '',
      flags: []
    };
  }

  function isLooseCourseRow(text) {
    const parsed = parseCourseLine(text);
    return !!(parsed.courseCode && parsed.semester && parsed.courseName);
  }

  function dedupeLooseCourses(courses) {
    const map = new Map();

    for (const course of courses) {
      const key = [
        course.courseCode || '',
        course.semester || '',
        course.courseName || '',
        String(course.credits ?? ''),
        course.score || ''
      ].join('||');

      if (!map.has(key)) {
        map.set(key, course);
      }
    }

    return Array.from(map.values());
  }

  function getMeta() {
    const bodyText = document.body.innerText || '';
    const majorMatch = bodyText.match(/主修\s*(.+?)(?=\n|姓名)/);
    const nameMatch = bodyText.match(/姓名\s*([^\s]+)/);
    const yearMatch = bodyText.match(/學籍年[:：]?\s*(\d+)/);

    return {
      major: majorMatch ? cleanText(majorMatch[1]) : '',
      name: nameMatch ? cleanText(nameMatch[1]) : '',
      schoolYear: yearMatch ? cleanText(yearMatch[1]) : '',
      activeTab: getActiveTabName()
    };
  }

  function extractLineTexts(item) {
    return (item.innerText || '')
      .split('\n')
      .map(cleanText)
      .filter(Boolean);
  }

  function extractLooseCoursesFromActivePane() {
    const root = getActiveTabPane();
    const text = root.innerText || '';
    const lines = text
      .split('\n')
      .map(cleanText)
      .filter(Boolean);

    const looseCourses = lines
      .filter(isLooseCourseRow)
      .map(parseCourseLine);

    return dedupeLooseCourses(looseCourses);
  }

  function getBlocksAndLooseCourses(tabName) {
    const root = getActiveTabPane();
    const items = Array.from(root.querySelectorAll('li.list-group-item, div.list-group-item'));
    const blocks = [];
    let looseCourses = [];

    if (tabName === '其它') {
      looseCourses = extractLooseCoursesFromActivePane();
      return { blocks, looseCourses };
    }

    items.forEach((item, index) => {
      const headerEl = item.querySelector('div.mt-0.mb-1.text-break');
      const courseEls = Array.from(item.querySelectorAll('div.small.text-muted.text-nowrap'));
      const lineTexts = extractLineTexts(item);
      const fullText = cleanText(item.innerText || '');
      const firstLine = lineTexts[0] || '';

      if (headerEl) {
        const headerText = cleanText(headerEl.innerText || firstLine);
        const header = parseHeader(headerText);

        if (!header.sectionName) return;

        let courseTexts = [];

        if (courseEls.length > 0) {
          courseTexts = courseEls
            .map(el => cleanText(el.innerText))
            .filter(Boolean);
        } else {
          courseTexts = lineTexts.slice(1).filter(isLooseCourseRow);
        }

        const courses = courseTexts.map(parseCourseLine);

        blocks.push({
          index,
          ...header,
          courses
        });

        return;
      }

      if (isLooseCourseRow(fullText)) {
        looseCourses.push({
          index,
          ...parseCourseLine(fullText)
        });
      }
    });

    looseCourses = dedupeLooseCourses(looseCourses);
    return { blocks, looseCourses };
  }

  function findTabElement(tabName) {
    const candidates = Array.from(
      document.querySelectorAll('.nav-link, .nav-item .nav-link, a, button')
    );

    return candidates.find(el => cleanText(el.innerText) === tabName);
  }

  async function switchToTab(tabName) {
    const current = getActiveTabName();
    if (current === tabName) return true;

    const tabEl = findTabElement(tabName);
    if (!tabEl) {
      log('找不到分頁：', tabName);
      return false;
    }

    tabEl.click();
    await sleep(1200);

    if (getActiveTabName() !== tabName) {
      tabEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(1200);
    }

    const ok = getActiveTabName() === tabName;
    log('切換分頁結果', { target: tabName, current: getActiveTabName(), ok });
    return ok;
  }

  function scoreToNum(score) {
    const n = Number(score);
    return Number.isFinite(n) ? n : null;
  }

  function estimateCredits(data) {
    let earned = 0;
    let pending = 0;

    for (const tabName of Object.keys(data.tabs || {})) {
      const tab = data.tabs[tabName];

      for (const block of (tab.blocks || [])) {
        const req = Number(block.requiredCredits);

        if (!Number.isFinite(req) || req <= 0) continue;

        const courses = block.courses || [];

        if (!courses.length) {
          pending += req;
          continue;
        }

        let passed = false;

        if (block.courseType === '學年課') {
          passed = courses.every(c => {
            const s = scoreToNum(c.score);
            return s !== null && s >= 60;
          });
        } else {
          passed = courses.some(c => {
            const s = scoreToNum(c.score);
            return s !== null && s >= 60;
          });
        }

        if (passed) earned += req;
        else pending += req;
      }

      for (const course of (tab.looseCourses || [])) {
        const credits = Number(course.credits);
        const score = scoreToNum(course.score);
        const flags = course.flags || [];

        if (!Number.isFinite(credits) || credits <= 0) continue;
        if (flags.includes('重複') || flags.includes('未完成')) continue;

        if (score !== null && score >= 60) earned += credits;
        else pending += credits;
      }
    }

    return {
      estimatedEarnedCredits: earned,
      pendingCredits: pending
    };
  }

  async function collectAllData() {
    const result = {
      title: document.title,
      url: location.href,
      capturedAt: new Date().toISOString(),
      meta: getMeta(),
      tabs: {}
    };

    const originalTab = getActiveTabName();

    for (const tabName of TAB_NAMES) {
      const ok = await switchToTab(tabName);

      if (!ok) {
        result.tabs[tabName] = {
          error: '找不到分頁或切換失敗',
          blocks: [],
          looseCourses: []
        };
        continue;
      }

      await sleep(900);

      const parsed = getBlocksAndLooseCourses(tabName);
      result.tabs[tabName] = {
        tabName,
        blocks: parsed.blocks,
        looseCourses: parsed.looseCourses
      };

      log(`分頁 ${tabName} 抓取完成`, {
        blocks: parsed.blocks.length,
        looseCourses: parsed.looseCourses.length
      });
    }

    if (originalTab && TAB_NAMES.includes(originalTab)) {
      await switchToTab(originalTab);
    }

    result.summary = estimateCredits(result);
    return result;
  }

  async function sendDataToOpener() {
    if (!window.opener) {
      log('沒有 opener，無法回傳資料');
      return;
    }

    const data = await collectAllData();
    log('準備送資料回 opener', data);

    window.opener.postMessage(
      {
        type: 'FJU_DIAGNOSIS_DATA',
        payload: data
      },
      '*'
    );

    log('資料已送出');
  }

  async function waitUntilLeaveLoginPage(maxWaitMs = 180000) {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      if (location.pathname !== LOGIN_PATH) {
        return true;
      }
      await sleep(1000);
    }

    return false;
  }

  async function performLogoutFlow() {
    log('進入 logout 模式');
    await sleep(1500);

    let logoutTrigger = findClickableByText([
      /登出系統/,
      /^登出$/,
      /logout/i
    ]);

    if (!logoutTrigger) {
      const userMenuTrigger = document.querySelector('.fa-cog, .fa-user, .dropdown-toggle');
      if (userMenuTrigger) {
        userMenuTrigger.click();
        await sleep(800);
        logoutTrigger = findClickableByText([
          /登出系統/,
          /^登出$/,
          /logout/i
        ]);
      }
    }

    if (logoutTrigger) {
      log('找到登出入口，準備點擊');
      logoutTrigger.click();
      await sleep(800);
    } else {
      log('找不到明顯的登出入口，可能本來就未登入或頁面結構不同');
    }

    const confirmBtn = findClickableByText([
      /^登出$/,
      /確認登出/,
      /logout/i
    ]);

    if (confirmBtn) {
      log('找到登出確認按鈕，準備點擊');
      confirmBtn.click();
      await sleep(1500);
    }

    if (window.opener) {
      window.opener.postMessage(
        {
          type: 'FJU_LOGOUT_DONE'
        },
        '*'
      );
    }

    await sleep(500);
    window.close();
  }

  async function init() {
    log('content script 啟動：', location.href);

    const action = getAction();

    if (action === 'logout') {
      if (
        location.pathname === GUIDE_PATH ||
        location.pathname === STUDENT_PATH ||
        (location.pathname.startsWith('/Student/') && location.pathname !== LOGIN_PATH)
      ) {
        await performLogoutFlow();
        return;
      }
    }

    if (location.pathname === LOGIN_PATH) {
      log('目前在登入頁，等待使用者登入完成...');
      const leftLogin = await waitUntilLeaveLoginPage();

      if (!leftLogin) {
        log('等待登入逾時，停止此次同步');
        return;
      }

      log('已離開登入頁，新的位置：', location.href);
    }

    if (location.pathname === GUIDE_PATH) {
      log('目前在 GuidePage，準備同頁跳轉到 Student/');
      await sleep(1200);
      location.href = STUDENT_URL;
      return;
    }

    if (
      location.pathname === STUDENT_PATH ||
      (location.pathname.startsWith('/Student/') && location.pathname !== LOGIN_PATH)
    ) {
      log('已進入 Student 頁，準備抓資料');
      await sleep(2200);
      await sendDataToOpener();
    }
  }

  init();
})();