import { getBurnLogs, getWoodAdditions, getAnshinHistory, getSplitLogs, getChecks } from '../store.js';
import { weekRange, formatWeekLabel, weeklyStats, summaryText, daysBetween, isOffSeason } from '../derive.js';
import { state } from '../state.js';
import { openSplitLogSheet } from './sheets.js';

function chartSvg(points, range) {
  if (!points || points.length === 0) {
    return `<text x="140" y="38" fill="var(--muted)" font-size="11" text-anchor="middle">この週のデータはまだありません</text>`;
  }
  const start = new Date(range.start + 'T00:00:00');
  const coords = points.map((p) => {
    const d = new Date(p.date + 'T00:00:00');
    const dayIdx = Math.round((d - start) / 86400000);
    const x = (dayIdx / 6) * 280;
    const y = 66 - (p.score / 100) * 60;
    return { x, y };
  });
  if (coords.length === 1) {
    return `<circle cx="${coords[0].x}" cy="${coords[0].y}" r="3.5" fill="#9AC46A"/>`;
  }
  const pointsAttr = coords.map((c) => `${c.x},${c.y}`).join(' ');
  return `<polyline points="${pointsAttr}" fill="none" stroke="#9AC46A" stroke-width="2"/>`;
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

  document.getElementById('review-summary').innerHTML = `
    <div class="label-sm" style="margin-bottom:6px">今週のまとめ</div>
    <div style="font-size:calc(13px * var(--font-scale));line-height:1.7">${summaryText(stats, isOffSeason(burnLogs))}</div>
  `;

  const deltaColor = stats.anshinDelta > 0 ? 'var(--green)' : stats.anshinDelta < 0 ? 'var(--red)' : 'var(--cream)';
  const deltaText = stats.anshinDelta == null ? '―' : `${stats.anshinDelta > 0 ? '+' : ''}${stats.anshinDelta}%`;
  document.getElementById('review-stats').innerHTML = `
    <div class="stat-card"><div class="label-sm">焚いた回数</div><div class="n">${stats.burnCount}回</div><div class="l">今週</div></div>
    <div class="stat-card"><div class="label-sm">使った薪</div><div class="n">${stats.usedVolumeM3}m³</div><div class="l">今週</div></div>
    <div class="stat-card"><div class="label-sm">充足率の変化</div><div class="n" style="color:${deltaColor}">${deltaText}</div><div class="l">週初比</div></div>
  `;

  const splitNoteEl = document.getElementById('review-split-note');
  splitNoteEl.innerHTML =
    stats.splitCount > 0
      ? `<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span class="label-sm">この週の薪割り</span><span style="font-size:calc(13px * var(--font-scale));font-weight:700">${stats.splitCount}回${stats.splitVolumeM3 > 0 ? `・${stats.splitVolumeM3}m³` : ''}${stats.splitVolumeUnknown ? '(量不明あり)' : ''}</span></div>`
      : '';

  document.getElementById('review-chart').innerHTML = chartSvg(stats.trendPoints, range);

  document.getElementById('review-checks').innerHTML = stats.checksInWeek.length
    ? stats.checksInWeek
        .map(
          (c) =>
            `<div class="history-row"><span>${c.date}(${daysBetween(c.date)}日前) チェック</span><span class="label-sm">${Object.values(c.items).every((v) => v === 'good') ? '良好' : '異常あり'}</span></div>`
        )
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
