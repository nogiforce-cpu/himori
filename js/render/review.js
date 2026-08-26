import { getBurnLogs, getWoodAdditions, getAnshinHistory, getSplitLogs, getChecks } from '../store.js';
import { weekRange, formatWeekLabel, weeklyStats, summaryText, daysBetween, isOffSeason, overallCheckState } from '../derive.js';
import { state } from '../state.js';
import { openSplitLogSheet } from './sheets.js';

// 「推移」だけ見せても、今どの水準なのか・どれだけ動いたのかが伝わりにくいという
// 指摘を受け、目盛り線・始点と終点の数値ラベル・終点の強調・面の塗りを加えて、
// パッと見て「今どのくらいで、どう動いたか」が分かるようにする。
function chartSvg(points, range) {
  const W = 280;
  const H = 70;
  const PAD_L = 26;
  const PAD_R = 30;
  const TOP = 8;
  const BOTTOM = 50;
  if (!points || points.length === 0) {
    return `<text x="140" y="38" fill="var(--muted)" font-size="11" text-anchor="middle">この週のデータはまだありません</text>`;
  }
  const start = new Date(range.start + 'T00:00:00');
  const yFor = (score) => TOP + (1 - score / 100) * (BOTTOM - TOP);
  const coords = points.map((p) => {
    const d = new Date(p.date + 'T00:00:00');
    const dayIdx = Math.round((d - start) / 86400000);
    const x = PAD_L + (dayIdx / 6) * (W - PAD_L - PAD_R);
    return { x, y: yFor(p.score), score: p.score };
  });

  const gridY = yFor(50);
  const grid = `
    <line x1="${PAD_L}" y1="${yFor(100)}" x2="${W - PAD_R}" y2="${yFor(100)}" stroke="var(--muted)" stroke-width="0.6" opacity="0.3"/>
    <line x1="${PAD_L}" y1="${gridY}" x2="${W - PAD_R}" y2="${gridY}" stroke="var(--muted)" stroke-width="0.6" opacity="0.3" stroke-dasharray="2 2"/>
    <line x1="${PAD_L}" y1="${yFor(0)}" x2="${W - PAD_R}" y2="${yFor(0)}" stroke="var(--muted)" stroke-width="0.6" opacity="0.3"/>
    <text x="${PAD_L - 4}" y="${yFor(100) + 3}" text-anchor="end" font-size="8" fill="var(--muted)">100</text>
    <text x="${PAD_L - 4}" y="${gridY + 3}" text-anchor="end" font-size="8" fill="var(--muted)">50</text>
    <text x="${PAD_L - 4}" y="${yFor(0) + 3}" text-anchor="end" font-size="8" fill="var(--muted)">0</text>
  `;

  if (coords.length === 1) {
    return `${grid}<circle cx="${coords[0].x}" cy="${coords[0].y}" r="3.5" fill="#9AC46A"/>
      <text x="${coords[0].x}" y="${coords[0].y - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="#9AC46A">${coords[0].score}%</text>`;
  }

  const pointsAttr = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaAttr = `${PAD_L},${yFor(0)} ${pointsAttr} ${coords[coords.length - 1].x},${yFor(0)}`;
  const last = coords[coords.length - 1];
  const first = coords[0];
  return `
    ${grid}
    <polygon points="${areaAttr}" fill="#9AC46A" opacity="0.12"/>
    <polyline points="${pointsAttr}" fill="none" stroke="#9AC46A" stroke-width="2"/>
    <circle cx="${first.x}" cy="${first.y}" r="2.5" fill="#9AC46A" opacity="0.6"/>
    <circle cx="${last.x}" cy="${last.y}" r="4" fill="#9AC46A"/>
    <text x="${last.x}" y="${last.y - 9 < TOP ? last.y + 16 : last.y - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="#9AC46A">${last.score}%</text>
  `;
}

export function render() {
  const range = weekRange(state.weekOffset);
  document.getElementById('review-week-label').textContent = formatWeekLabel(range);

  const burnLogs = getBurnLogs();
  const stats = weeklyStats(range, {
    burnLogs,
    woodAdditions: getWoodAdditions(),
    anshinHistory: getAnshinHistory(),
    splitLogs: getSplitLogs(),
    checks: getChecks(),
  });

  // ホームの「ひとこと」と同じ太さ・大きさにして、数字より先に文章が主役として
  // 目に入るようにする(以前は本文と同じ弱いウェイトで、下のstat-gridの太字の数字の
  // 方が視覚的に目立ってしまっていた)。
  document.getElementById('review-summary').innerHTML = `
    <div class="label-sm" style="margin-bottom:6px">今週のまとめ</div>
    <div style="font-size:calc(14px * var(--font-scale));font-weight:600;line-height:1.7">${summaryText(stats, isOffSeason(burnLogs))}</div>
  `;

  const deltaColor = stats.anshinDelta > 0 ? 'var(--green)' : stats.anshinDelta < 0 ? 'var(--red)' : 'var(--cream)';
  const deltaText = stats.anshinDelta == null ? '' : `(週初比${stats.anshinDelta > 0 ? '+' : ''}${stats.anshinDelta}%)`;
  const currentScoreText = stats.currentScore == null ? '―' : `${stats.currentScore}%`;
  document.getElementById('review-stats').innerHTML = `
    <div class="stat-card"><div class="label-sm">焚いた回数</div><div class="n">${stats.burnCount}回</div><div class="l">今週</div></div>
    <div class="stat-card"><div class="label-sm">使った薪</div><div class="n">${stats.usedVolumeM3}m³</div><div class="l">今週</div></div>
    <div class="stat-card"><div class="label-sm">薪の充足率</div><div class="n" style="color:${deltaColor}">${currentScoreText}</div><div class="l">${deltaText}</div></div>
  `;

  const splitNoteEl = document.getElementById('review-split-note');
  splitNoteEl.innerHTML =
    stats.splitCount > 0
      ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span class="label-sm">この週の薪割り</span><span style="font-size:calc(13px * var(--font-scale));font-weight:700">${stats.splitCount}回${stats.splitVolumeM3 > 0 ? `・${stats.splitVolumeM3}m³` : ''}${stats.splitVolumeUnknown ? '(量不明あり)' : ''}</span></div>`
      : '';

  document.getElementById('review-chart').innerHTML = chartSvg(stats.trendPoints, range);

  document.getElementById('review-checks').innerHTML = stats.checksInWeek.length
    ? stats.checksInWeek
        .map((c) => {
          const state = overallCheckState(c.items);
          const label = state === 'good' ? '良好' : state === 'attention' ? '要注意' : '異常あり';
          return `<div class="history-row"><span>${c.date}(${daysBetween(c.date)}日前) チェック</span><span class="label-sm">${label}</span></div>`;
        })
        .join('')
    : `<div class="empty">今週のチェック記録はまだありません。</div>`;
}

export function weekPrev() {
  state.weekOffset -= 1;
  render();
}
export function weekNext() {
  state.weekOffset = Math.min(0, state.weekOffset + 1);
  render();
}
export function openSplitLog() {
  openSplitLogSheet(() => render());
}
