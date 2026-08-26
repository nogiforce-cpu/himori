// event-row(写真/アイコン + 本文 + 補足)のHTML化。ホーム「薪のある日々」・カレンダーの
// 日別詳細など、共通の出来事アダプター(derive.js buildLivingWithWoodEvents)の出力を
// 同じ見た目で並べる画面同士でこの関数を共有する。
// e.woodType が付いている(薪追加イベントで樹種が分かっている)場合は樹種詳細へ、
// e.type==='maintenance'(メンテナンス記録)の場合は愛機詳細へ、行全体をタップして
// 進めるようにする。e.returnType/e.returnDate は「詳細画面を閉じた時にどこへ戻るか」を
// 伝えるための軽量な戻り先情報で、呼び出し元(home.js/calendar.js)が自分の文脈に応じて
// 付与する。app.jsのグローバルなdata-action委譲がこれを読み取り、適切な戻り先コールバックを
// 組み立てる(historyは使わない)。
function returnAttrs(e) {
  const returnType = e.returnType ? ` data-return-type="${e.returnType}"` : '';
  const returnDate = e.returnDate ? ` data-return-date="${e.returnDate}"` : '';
  return `${returnType}${returnDate}`;
}

export function eventRowHtml(e, subLine = '') {
  const thumb = e.photo
    ? `<div class="thumb"><img src="${e.photo.uri}" alt=""></div>`
    : e.img
      ? `<div class="thumb icon"><img src="${e.img}" alt=""></div>`
      : `<div class="thumb icon"><svg class="icon" viewBox="0 0 24 24" style="${e.iconColor ? `color:${e.iconColor}` : ''}"><use href="${e.icon}"/></svg></div>`;
  let clickAttrs = '';
  if (e.woodType) {
    clickAttrs = ` data-action="open-woodtype-detail" data-name="${e.woodType}"${returnAttrs(e)} style="cursor:pointer"`;
  } else if (e.type === 'maintenance') {
    clickAttrs = ` data-action="open-stove-detail"${returnAttrs(e)} style="cursor:pointer"`;
  }
  return `
    <div class="event-row"${clickAttrs}>
      ${thumb}
      <div class="text">
        <div>${e.text}</div>
        ${subLine ? `<div class="label-sm">${subLine}</div>` : ''}
      </div>
    </div>
  `;
}
