// ===== 畢業門檻（簡化版）=====
const graduationRules = [
  { requirement: "國文", type: "必修", credits: 4 },
  { requirement: "人生哲學", type: "必修", credits: 4 },
  { requirement: "大學入門", type: "必修", credits: 2 },

  { requirement: "人文與藝術通識領域", type: "選修", credits: 4 },
  { requirement: "自然與科技通識領域", type: "選修", credits: 4 },
  { requirement: "社會科學通識領域", type: "選修", credits: 4 }
];

// ===== 成績解析 =====
function parseGrades(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let current = null;
  const result = [];

  for (const line of lines) {
    const isCourse = /^\S+\s*\/\s*\d{3}-[12]/.test(line);

    if (!isCourse) {
      const parts = line.split(/\s+/);

      if (parts.length >= 3) {
        const last = parts[parts.length - 1];
        const hasType = ['學年課', '學期課'].includes(last);

        let credits, requirement, courseType = null;

        if (hasType) {
          credits = parseInt(parts[parts.length - 2], 10);
          requirement = parts.slice(1, parts.length - 2).join(' ');
          courseType = last;
        } else {
          credits = parseInt(last, 10);
          requirement = parts.slice(1, parts.length - 1).join(' ');
        }

        if (!isNaN(credits)) {
          current = { requirement, credits, courseType };
        }
      }
      continue;
    }

    const parts = line.split(/\s+/);
    const name = parts.slice(3, parts.length - 1).join(' ');

    let score = null;
    let status = "pending";

    if (!line.includes('未評定')) {
      score = parseInt(parts[parts.length - 1], 10);
      status = score >= 60 ? "pass" : "fail";
    }

    result.push({
      requirement: current?.requirement,
      name,
      score,
      status,
      credits: current?.credits || 0,
      courseType: current?.courseType || null
    });
  }

  return result;
}

// ===== 分組 =====
function group(data) {
  const map = {};

  data.forEach(i => {
    if (!map[i.requirement]) {
      map[i.requirement] = { earned: 0 };
    }

    if (i.status === "pass") {
      let earned = i.credits;

      // 學年課：單筆算一半
      if (i.courseType === "學年課") {
        earned = i.credits / 2;
      }

      map[i.requirement].earned += earned;
    }
  });

  return map;
}

// ===== 規則比對 =====
function evaluate(grouped) {
  return graduationRules.map(rule => {
    let earned = grouped[rule.requirement]?.earned || 0;

    // 上限不能超過需求學分
    if (earned > rule.credits) {
      earned = rule.credits;
    }

    const remain = Math.max(0, rule.credits - earned);

    return {
      ...rule,
      earned,
      remain,
      done: earned >= rule.credits
    };
  });
}

// ===== 畫面 =====
function render(parsed, result) {
  const passed = parsed.filter(i => i.status === "pass");
  const failed = parsed.filter(i => i.status === "fail");
  const pending = parsed.filter(i => i.status === "pending");

  document.getElementById('summary').innerHTML = `
    通過 ${passed.length} / 未通過 ${failed.length} / 未評定 ${pending.length}
  `;

  document.getElementById('passedList').innerHTML =
    passed.length
      ? passed.map(i => `<li>${i.name} (${i.score})</li>`).join('')
      : '<li>無</li>';

  document.getElementById('failedList').innerHTML =
    failed.length
      ? failed.map(i => `<li>${i.name} (${i.score})</li>`).join('')
      : '<li>無</li>';

  document.getElementById('pendingList').innerHTML =
    pending.length
      ? pending.map(i => `<li>${i.name}</li>`).join('')
      : '<li>無</li>';

  let total = 0;
  let doneCredits = 0;

  document.getElementById('requirementSummary').innerHTML =
    result.map(r => {
      total += r.credits;
      doneCredits += r.earned;

      return `
        <li>
          ${r.requirement}（${r.type}）：
          ${r.done
            ? `✅ 已完成（${r.earned} / ${r.credits}）`
            : `❌ 還差 ${r.remain}（${r.earned} / ${r.credits}）`}
        </li>
      `;
    }).join('');

  const canGraduate = result.every(r => r.done);

  document.getElementById('finalResult').innerHTML = `
    <h2>${canGraduate ? "🎉 可以畢業" : "❌ 尚未達畢業條件"}</h2>
    <p>學分：${doneCredits} / ${total}</p>
  `;
}

// ===== 主流程 =====
function handle() {
  const text = document.getElementById('input').value;

  const parsed = parseGrades(text);
  const grouped = group(parsed);
  const result = evaluate(grouped);

  render(parsed, result);
}