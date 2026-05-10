// JAIRO Cloud OpenSearch アダプタ（スタブ）
// 仕様確定後に buildURL / search / normalizeItem を実装し、available を true にする

const UNAVAILABLE_REASON =
  'JAIRO Cloud OpenSearch API はメンテナンス中のため未対応。復旧後に有効化予定です。';

export const jairoAdapter = {
  id: 'jairo',
  label: 'JAIRO Cloud',
  available: false,
  unavailableReason: UNAVAILABLE_REASON,

  // 復旧後に確定。CiNii と同じ supportedFields の一部を実装する想定
  supportedFields: [
    'q', 'title', 'publicationTitle', 'name', 'affiliation', 'description',
    'productYearFrom', 'productYearUntil', 'hasLinkToFullText',
    'count', 'start',
  ],

  buildURL(_params) {
    throw new Error('jairoAdapter.buildURL is not implemented yet');
  },

  async search(_params, _opts = {}) {
    return {
      ok: false,
      source: 'jairo',
      error: UNAVAILABLE_REASON,
    };
  },

  normalizeItem(_rawItem) {
    return null;
  },
};
