// CiNii Research OpenSearch v2 アダプタ
// 仕様: https://support.nii.ac.jp/ja/cir/r_opensearch

const ENDPOINT_BASE = 'https://cir.nii.ac.jp/opensearch/v2';

const RESOURCE_TYPES = [
  'all', 'articles', 'books', 'data', 'dissertations',
  'projects', 'researchers', 'projectsAndProducts'
];

const SUPPORTED_PARAMS = [
  'q', 'title', 'publicationTitle', 'name', 'affiliation', 'description',
  'productYearFrom', 'productYearUntil', 'hasLinkToFullText',
  'languageType',
  'sortorder', 'count', 'start'
];

function getAppId() {
  try {
    return localStorage.getItem('cinii.appid') || '';
  } catch {
    return '';
  }
}

function buildURL(params) {
  const resourceType = RESOURCE_TYPES.includes(params.resourceType)
    ? params.resourceType
    : 'all';
  const url = new URL(`${ENDPOINT_BASE}/${resourceType}`);
  url.searchParams.set('format', 'json');

  for (const key of SUPPORTED_PARAMS) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    const s = String(value).trim();
    if (s === '') continue;
    url.searchParams.set(key, s);
  }

  const appid = getAppId();
  if (appid) url.searchParams.set('appid', appid);

  return url.toString();
}

// JSON-LD のキー揺れを吸収するヘルパ
function pickString(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (typeof first === 'string') return first;
      if (first && typeof first['@value'] === 'string') return first['@value'];
      if (first && typeof first.name === 'string') return first.name;
    }
    if (v && typeof v === 'object') {
      if (typeof v['@value'] === 'string') return v['@value'];
      if (typeof v.name === 'string') return v.name;
    }
  }
  return '';
}

function pickArray(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (Array.isArray(v)) return v;
    if (v !== undefined && v !== null) return [v];
  }
  return [];
}

function extractCreators(item) {
  const list = pickArray(item, 'dc:creator', 'creator', 'foaf:maker');
  return list.map(c => {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object') {
      return c['foaf:name'] || c.name || c['@value'] || c['@id'] || '';
    }
    return '';
  }).filter(Boolean);
}

function extractYear(item) {
  const date = pickString(item, 'prism:publicationDate', 'dc:date', 'dcterms:issued', 'date');
  const m = date && date.match(/(\d{4})/);
  return m ? m[1] : '';
}

function extractURL(value, fallback = '') {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return extractURL(value[0], fallback);
  if (typeof value === 'object') {
    return value['@id'] || value.url || value.href || fallback;
  }
  return fallback;
}

function normalizeItem(item) {
  const id = extractURL(item['@id'] || item.id, '') || extractURL(item.link, '');
  const title = pickString(item, 'title', 'dc:title');
  const creators = extractCreators(item);
  const publication = pickString(item, 'prism:publicationName', 'publicationName', 'dc:publisher');
  const year = extractYear(item);
  const description = pickString(item, 'description', 'dc:description');
  const link = extractURL(item.link, id);
  const hasFullText = Boolean(item['cir:hasLinkToFullText'] || item.hasLinkToFullText);

  return {
    source: 'cinii',
    id,
    title,
    creators,
    publication,
    year,
    description,
    link,
    hasFullText,
    raw: item,
  };
}

function pickInt(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return 0;
}

async function search(params, { signal } = {}) {
  const url = buildURL(params);
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    return {
      ok: false,
      source: 'cinii',
      url,
      error: `ネットワークエラー: ${e.message}`,
    };
  }

  if (!res.ok) {
    let hint = '';
    if (res.status === 401 || res.status === 403) {
      hint = ' （appid が必要な可能性があります。フッタの「appid を設定する」から登録してください）';
    }
    return {
      ok: false,
      source: 'cinii',
      url,
      status: res.status,
      error: `HTTP ${res.status} ${res.statusText}${hint}`,
    };
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    return {
      ok: false,
      source: 'cinii',
      url,
      error: `JSON パースに失敗: ${e.message}`,
    };
  }

  const rawItems = pickArray(json, 'items');
  const items = rawItems.map(normalizeItem);
  const total = pickInt(json, 'opensearch:totalResults', 'totalResults');
  const startIdx = pickInt(json, 'opensearch:startIndex', 'startIndex');
  const perPage = pickInt(json, 'opensearch:itemsPerPage', 'itemsPerPage');

  return {
    ok: true,
    source: 'cinii',
    url,
    total,
    start: startIdx || Number(params.start) || 1,
    perPage: perPage || items.length,
    items,
    raw: json,
  };
}

export const ciniiAdapter = {
  id: 'cinii',
  label: 'CiNii Research',
  available: true,
  resourceTypes: RESOURCE_TYPES,
  supportedFields: [
    'q', 'title', 'publicationTitle', 'name', 'affiliation', 'description',
    'productYearFrom', 'productYearUntil', 'hasLinkToFullText',
    'languageType',
    'sortorder', 'resourceType', 'count', 'start',
  ],
  buildURL,
  search,
  normalizeItem,
};
