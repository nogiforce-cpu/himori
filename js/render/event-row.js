// event-row(写真/アイコン + 本文 + 補足)のHTML化。ホーム「薪のある日々」・カレンダーの
// 日別詳細など、共通の出来事アダプター(derive.js buildLivingWithWoodEvents)の出力を
// 同じ見た目で並べる画面同士でこの関数を共有する。
// e.woodType が付いている(薪追加イベントで樹種が分かっている)場合は、行全体をタップして
// その樹種の詳細(樹種コレクション)へ進めるようにする。
export function eventRowHtml(e, subLine = '') {
  const thumb = e.photo
    ? `<div class="thumb"><img src="${e.photo.uri}" alt=""></div>`
    : e.img
      ? `<div class="thumb icon"><img src="${e.img}" alt=""></div>`
      : `<div class="thumb icon"><svg class="icon" viewBox="0 0 24 24" style="${e.iconColor ? `color:${e.iconColor}` : ''}"><use href="${e.icon}"/></svg></div>`;
  const clickAttrs = e.woodType ? ` data-action="open-woodtype-detail" data-name="${e.woodType}" style="cursor:pointer"` : '';
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
