(function () {
  'use strict';

  const GUIDE_PATH = '/Student/GuidePage';
  const STUDENT_PATH = '/Student/';
  const STUDENT_URL = 'https://learningcounseling.fju.edu.tw/Student/';
  const TAB_NAMES = ['全人/校定', '必修', '必選', '其它'];

  function cleanText(text = '') {
    return text.replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function log(...args) {
    console.log('[FJU Diagnosis Bridge]', ...args);
  }

  function getActiveTabName() {
    const activeEl =
      document.querySelector('.nav-link.active') ||
      document.querySelector('.nav-item .active') ||
      document.querySelector('.active');

    return activeEl ? cleanText(activeEl.innerText) : '';
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

    const normalMatch = cleaned.match(/^(\S+)\s*\/\s*(\d{3}-\d)\s+(.+?)\s+(\d+|未評定成績)$/);
    if (normalMatch) {
      return {
        raw: cleaned,
        courseCode: cleanText(normalMatch[1]),
        semester: cleanText(normalMatch[2]),
        courseName: cleanText(normalMatch[3]),
        score: cleanText(normalMatch[4])
      };
    }

    const looseMatch = cleaned.match(/^(\S+)\s*\/\s*(\d{3}-\d)\s+(.+?)\s+(\d+)\s+(\d+|未評定成績)(?:\s+(.*))?$/);
    if (looseMatch) {
      return {
        raw: cleaned,
        courseCode: cleanText(looseMatch[1]),
        semester: cleanText(looseMatch[2]),
        courseName: cleanText(looseMatch[3]),
        credits: Number(looseMatch[4]),
        score: cleanText(looseMatch[5]),
        flags: looseMatch[6] ? cleanText(looseMatch[6]).split(/\s+/).filter(Boolean) : []
      };
    }

    return {
      raw: cleaned,
      courseCode: '',
      semester: '',
      courseName: '',
      score: ''
    };
  }

  function isLooseCourseRow(text) {
    const cleaned = cleanText(text);
    return /^\S+\s*\/\s*\d{3}-\d\s+.+?\s+\d+\s+(\d+|未評定成績)(?:\s+.*)?$/.test(cleaned);
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

  function getBlocksAndLooseCourses() {
    const items = Array.from(document.querySelectorAll('li.list-group-item'));
    const blocks = [];
    const looseCourses = [];

    items.forEach((item, index) => {
      const headerEl = item.querySelector('div.mt-0.mb-1.text-break');
      const courseEls = Array.from(item.querySelectorAll('div.small.text-muted.text-nowrap'));
      const fullText = cleanText(item.innerText || '');
      const firstLine = cleanText((item.innerText || '').split('\n')[0] || '');

      if (!headerEl && courseEls.length === 0 && isLooseCourseRow(firstLine)) {
        looseCourses.push({
          index,
          ...parseCourseLine(firstLine)
        });
        return;
      }

      const headerText = headerEl ? cleanText(headerEl.innerText) : firstLine;
      const header = parseHeader(headerText);

      if (!header.sectionName) {
        if (isLooseCourseRow(fullText)) {
          looseCourses.push({
            index,
            ...parseCourseLine(fullText)
          });
        }
        return;
      }

      const courses = courseEls
        .map(el => cleanText(el.innerText))
        .filter(Boolean)
        .map(parseCourseLine);

      blocks.push({
        index,
        ...header,
        courses
      });
    });

    return { blocks, looseCourses };
  }

  function findTabElement(tabName) {
    const candidates = Array.from(document.querySelectorAll('a, button, li, .nav-link, .nav-item'));
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
    await sleep(900);

    if (getActiveTabName() !== tabName) {
      await sleep(900);
    }

    return getActiveTabName() === tabName;
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

      await sleep(500);

      const parsed = getBlocksAndLooseCourses();
      result.tabs[tabName] = {
        tabName,
        blocks: parsed.blocks,
        looseCourses: parsed.looseCourses
      };
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

  async function init() {
    log('content script 啟動：', location.href);

    if (location.pathname === GUIDE_PATH) {
      log('目前在 GuidePage，準備同頁跳轉到 Student/');
      await sleep(1200);
      location.href = STUDENT_URL;
      return;
    }

    if (location.pathname === STUDENT_PATH || location.pathname.startsWith('/Student/')) {
      log('已進入 Student 頁，準備抓資料');
      await sleep(1800);
      await sendDataToOpener();
    }
  }

  init();
})();