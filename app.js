// CiNii Research + JAIRO Cloud 横断検索 + WebMCP 連携
// WebMCP: Early Preview (W3C Web Machine Learning CG, 2026-02 時点)
//   - 宣言的: <form toolname>, <input toolparamdescription>
//   - 命令的: navigator.modelContext.provideContext({ tools: [...] })

import { ciniiAdapter } from './sources/cinii.js';
import { jairoAdapter } from './sources/jairo.js';

const ADAPTERS = {
  cinii: ciniiAdapter,
  jairo: jairoAdapter,
};

const LOGICAL_FIELDS = [
  'q', 'title', 'publicationTitle', 'name', 'affiliation', 'description',
  'productYearFrom', 'productYearUntil', 'hasLinkToFullText',
  'languageType',
  'sortorder', 'resourceType', 'count', 'start',
];

let currentAbort = null;

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const form = $('#searchForm');
const statusEl = $('#status');
const resultsHeader = $('#resultsHeader');
const resultsEl = $('#results');
const paginationEl = $('#pagination');
const mcpStatusEl = $('#mcp-status');

// ---------- フォーム / パラメータ変換 ----------
function getFormParams(formEl) {
  const fd = new FormData(formEl);
  const params = {};
  for (const f of LOGICAL_FIELDS) {
    const v = fd.get(f);
    if (v !== null && String(v).trim() !== '') {
      params[f] = String(v).trim();
    }
  }
  const sources = fd.getAll('source').map(String);
  params.sources = sources.length > 0 ? sources : ['cinii'];
  return params;
}

function fillForm(params) {
  if (!params || typeof params !== 'object') return;
  for (const f of LOGICAL_FIELDS) {
    if (params[f] === undefined || params[f] === null) continue;
    const el = formEl(f);
    if (el) el.value = String(params[f]);
  }
  if (Array.isArray(params.sources)) {
    for (const cb of form.querySelectorAll('input[name="source"]')) {
      cb.checked = params.sources.includes(cb.value);
    }
  }
}

function formEl(name) {
  return form.elements.namedItem(name);
}

function normalizeArgs(args) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const f of LOGICAL_FIELDS) {
    if (args[f] !== undefined && args[f] !== null && String(args[f]).trim() !== '') {
      out[f] = String(args[f]).trim();
    }
  }
  if (Array.isArray(args.sources)) {
    out.sources = args.sources;
  } else if (typeof args.sources === 'string' && args.sources.trim() !== '') {
    out.sources = args.sources.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    out.sources = ['cinii'];
  }
  return out;
}

// ---------- 検索ディスパッチ ----------
function getEnabledAdapters(sources) {
  const result = [];
  for (const id of sources) {
    const a = ADAPTERS[id];
    if (!a) continue;
    if (!a.available) {
      result.push({ adapter: a, skipped: true });
    } else {
      result.push({ adapter: a, skipped: false });
    }
  }
  return result;
}

async function runSearch(params) {
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  renderStatus('検索中...', 'info');
  resultsEl.replaceChildren();
  resultsHeader.replaceChildren();
  paginationEl.replaceChildren();

  const targets = getEnabledAdapters(params.sources || ['cinii']);
  if (targets.length === 0) {
    renderStatus('検索対象ソースが選択されていません。', 'warn');
    return [];
  }

  const settled = await Promise.allSettled(
    targets.map(({ adapter, skipped }) =>
      skipped
        ? Promise.resolve({
            ok: false,
            source: adapter.id,
            error: adapter.unavailableReason || `${adapter.label} は現在無効です。`,
          })
        : adapter.search(params, { signal })
    )
  );

  const results = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      ok: false,
      source: targets[i].adapter.id,
      error: s.reason?.message || String(s.reason),
    };
  });

  renderResults(results, params);
  renderResultsHeader(results, params);
  renderPagination(results, params);
  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    renderStatus('', '');
  } else {
    const msg = results.map((r) => `${labelOf(r.source)}: ${r.error || '失敗'}`).join(' / ');
    renderStatus(`検索に失敗しました。${msg}`, 'error');
  }
  return results;
}

function labelOf(sourceId) {
  return ADAPTERS[sourceId]?.label || sourceId;
}

// ---------- レンダリング ----------
function renderStatus(message, kind) {
  statusEl.textContent = message || '';
  statusEl.dataset.kind = kind || '';
}

function renderResultsHeader(results, params) {
  if (results.length === 0) return;
  const parts = [];
  let totalSum = 0;
  for (const r of results) {
    if (r.ok) {
      totalSum += r.total || 0;
      parts.push(`${labelOf(r.source)}: ${r.total ?? 0}件`);
    } else {
      parts.push(`${labelOf(r.source)}: -`);
    }
  }
  const start = Number(params.start) || 1;
  const count = Number(params.count) || 20;
  const div = document.createElement('div');
  div.className = 'results-header';
  div.textContent = `${parts.join(' / ')}（${start} 件目から最大 ${count} 件、合計 ${totalSum} 件）`;
  resultsHeader.replaceChildren(div);
}

function renderResults(results, _params) {
  resultsEl.replaceChildren();
  for (const r of results) {
    const section = document.createElement('section');
    section.className = 'source-section';
    section.dataset.source = r.source;

    const h = document.createElement('h2');
    h.className = 'source-title';
    h.textContent = labelOf(r.source);
    section.appendChild(h);

    if (!r.ok) {
      const msg = document.createElement('p');
      msg.className = 'source-error';
      msg.textContent = r.error || '検索に失敗しました。';
      section.appendChild(msg);
      resultsEl.appendChild(section);
      continue;
    }

    if (!r.items || r.items.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'source-empty';
      msg.textContent = '該当する結果はありませんでした。';
      section.appendChild(msg);
      resultsEl.appendChild(section);
      continue;
    }

    const ul = document.createElement('ul');
    ul.className = 'result-list';
    for (const item of r.items) {
      ul.appendChild(renderItem(item));
    }
    section.appendChild(ul);
    resultsEl.appendChild(section);
  }
}

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'result-item';

  const titleEl = document.createElement('a');
  titleEl.className = 'result-title';
  titleEl.href = item.link || item.id || '#';
  titleEl.target = '_blank';
  titleEl.rel = 'noopener noreferrer';
  titleEl.textContent = item.title || '(タイトル不明)';
  li.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  const metaParts = [];
  if (item.creators && item.creators.length > 0) {
    metaParts.push(item.creators.slice(0, 5).join(', ') + (item.creators.length > 5 ? ' 他' : ''));
  }
  if (item.publication) metaParts.push(item.publication);
  if (item.year) metaParts.push(item.year);
  if (item.hasFullText) metaParts.push('本文あり');
  meta.textContent = metaParts.join(' / ');
  li.appendChild(meta);

  if (item.description) {
    const desc = document.createElement('p');
    desc.className = 'result-desc';
    desc.textContent = item.description.length > 240
      ? item.description.slice(0, 240) + '…'
      : item.description;
    li.appendChild(desc);
  }

  return li;
}

function renderPagination(results, params) {
  paginationEl.replaceChildren();
  if (!results.some((r) => r.ok)) return;

  const start = Number(params.start) || 1;
  const count = Number(params.count) || 20;
  const maxTotal = Math.max(0, ...results.filter((r) => r.ok).map((r) => r.total || 0));

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = '← 前へ';
  prev.disabled = start <= 1;
  prev.addEventListener('click', () => {
    const next = Math.max(1, start - count);
    formEl('start').value = String(next);
    runSearch(getFormParams(form));
  });
  paginationEl.appendChild(prev);

  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `${start} 〜 ${start + count - 1} 件目`;
  paginationEl.appendChild(info);

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = '次へ →';
  next.disabled = start + count - 1 >= maxTotal;
  next.addEventListener('click', () => {
    const nextStart = start + count;
    formEl('start').value = String(nextStart);
    runSearch(getFormParams(form));
  });
  paginationEl.appendChild(next);
}

// ---------- WebMCP 検出と命令的 API ----------
// 仕様変更履歴: 2026-03-05 に provideContext() / clearContext() が仕様から削除。
// 現行は registerTool() （+ AbortController で解除）が主。
// 後方互換として provideContext があればそれも使えるようにフォールバック。
function getRegistrationApi() {
  const mc = navigator?.modelContext;
  if (!mc) return null;
  if (typeof mc.registerTool === 'function') {
    return { kind: 'registerTool', mc };
  }
  if (typeof mc.provideContext === 'function') {
    return { kind: 'provideContext', mc };
  }
  return null;
}

function detectWebMCP() {
  const hasModelContext =
    typeof navigator !== 'undefined' && 'modelContext' in navigator;
  const reg = getRegistrationApi();
  const hasTesting =
    typeof navigator !== 'undefined' && 'modelContextTesting' in navigator;
  const supported = !!reg;

  if (mcpStatusEl) {
    mcpStatusEl.replaceChildren();
    mcpStatusEl.dataset.supported = supported ? 'true' : 'false';

    const main = document.createElement('span');
    main.textContent = supported
      ? `WebMCP: このブラウザで利用可能（${reg.kind}() で searchPaper を登録します）`
      : 'WebMCP: 未対応（フォーム検索は動作）';
    mcpStatusEl.appendChild(main);

    const detail = document.createElement('span');
    detail.className = 'mcp-detail';
    const hasRegister = !!(navigator.modelContext?.registerTool);
    const hasProvide = !!(navigator.modelContext?.provideContext);
    detail.textContent =
      ` [modelContext: ${hasModelContext ? 'yes' : 'no'}` +
      ` / registerTool: ${hasRegister ? 'yes' : 'no'}` +
      ` / provideContext: ${hasProvide ? 'yes' : 'no'}` +
      ` / modelContextTesting: ${hasTesting ? 'yes' : 'no'}]`;
    mcpStatusEl.appendChild(detail);

    if (!supported) {
      const hint = document.createElement('div');
      hint.className = 'mcp-hint';
      hint.innerHTML =
        'Chrome 146+ で <code>chrome://flags/#enable-webmcp-testing</code> ' +
        '（<b>WebMCP for testing</b>）を Enabled にして Relaunch、' +
        'その後このページを開き直してください。';
      mcpStatusEl.appendChild(hint);
    }
  }
  return supported;
}

function summarizeForAgent(results) {
  return results.map((r) => {
    if (!r.ok) return { source: r.source, ok: false, error: r.error };
    return {
      source: r.source,
      ok: true,
      total: r.total,
      items: (r.items || []).slice(0, 20).map((item) => ({
        title: item.title,
        creators: item.creators,
        publication: item.publication,
        year: item.year,
        link: item.link,
        hasFullText: item.hasFullText,
        description: item.description ? item.description.slice(0, 240) : '',
      })),
    };
  });
}

function registerWebMCPTool() {
  const reg = getRegistrationApi();
  if (!reg) return;

  const description =
    'CiNii Research と JAIRO Cloud（復旧次第）を横断して論文・書籍・研究データ等を ' +
    'OpenSearch v2 で検索する。ページ内の検索フォームと同じパラメータを受け付ける。';

  const inputSchema = {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'フリーワード（タイトル・本文・著者などを横断）' },
      title: { type: 'string', description: 'タイトルに含まれる語' },
      publicationTitle: { type: 'string', description: '刊行物（雑誌名・書籍名）に含まれる語' },
      name: { type: 'string', description: '著者・編者などの人物名' },
      affiliation: { type: 'string', description: '著者の所属機関名' },
      description: { type: 'string', description: '注記・抄録（abstract）に含まれる語' },
      productYearFrom: { type: 'string', description: '出版年（開始）。YYYY または YYYYMM' },
      productYearUntil: { type: 'string', description: '出版年（終了）。YYYY または YYYYMM' },
      hasLinkToFullText: {
        type: 'string',
        enum: ['', 'true', 'false'],
        description: '本文ありで絞る場合 "true"、本文なしのみなら "false"、未指定なら空',
      },
      languageType: {
        type: 'string',
        description:
          '資料の言語種別。ISO-639-1 コード（例: ja=日本語, en=英語, zh=中国語, ko=韓国語, fr=仏語, de=独語, es=西語）。複数指定はカンマ区切りで OR。例: "ja,en"。researchers 検索では非対応。',
      },
      resourceType: {
        type: 'string',
        enum: ciniiAdapter.resourceTypes,
        description: 'CiNii の検索種別。all=横断, articles=論文, books=書籍, data=研究データ, dissertations=博士論文, projects=研究プロジェクト, researchers=研究者',
      },
      sortorder: {
        type: 'string',
        enum: ['0', '1', '4', '5'],
        description: 'ソート順。0=新しい順, 1=古い順, 4=関連度（既定）, 5=五十音順',
      },
      count: { type: 'string', description: '1ページの件数（1〜200）' },
      start: { type: 'string', description: '開始位置（1始まり）' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['cinii', 'jairo'] },
        description: '検索対象ソース。省略時は ["cinii"]。JAIRO は復旧後に有効化',
      },
    },
    required: [],
  };

  const tool = {
    name: 'searchPaper',
    description,
    inputSchema,
    async execute(args) {
      const params = normalizeArgs(args);
      fillForm(params);
      const results = await runSearch(params);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(summarizeForAgent(results), null, 2),
          },
        ],
      };
    },
  };

  if (reg.kind === 'registerTool') {
    // 現行仕様 (2026-03 以降): 1ツールずつ登録。
    // ページリロード時に前回の登録が残っているケースに備え、まず解除を試みる。
    if (typeof reg.mc.unregisterTool === 'function') {
      try { reg.mc.unregisterTool(tool.name); } catch (_) { /* 未登録なら無視 */ }
    }
    try {
      reg.mc.registerTool(tool);
    } catch (e) {
      if (e && e.name === 'InvalidStateError' &&
          /Duplicate tool name/i.test(e.message || '')) {
        // 既に同名ツールが登録済み（前のページから引き継がれた等）。
        // 解除手段が無いため、登録不能として扱うがフォーム検索は動作する。
        console.warn('searchPaper は既に登録済みです。今回の登録はスキップします:', e.message);
      } else {
        throw e;
      }
    }
  } else if (reg.kind === 'provideContext') {
    // 旧仕様の後方互換
    reg.mc.provideContext({ tools: [tool] });
  }
}

// ---------- appid 設定 UI ----------
function wireAppIdSettings() {
  const input = $('#appidInput');
  const saveBtn = $('#appidSave');
  const clearBtn = $('#appidClear');
  if (!input || !saveBtn) return;

  try {
    input.value = localStorage.getItem('cinii.appid') || '';
  } catch { /* localStorage 不可 */ }

  saveBtn.addEventListener('click', () => {
    try {
      const v = input.value.trim();
      if (v === '') {
        localStorage.removeItem('cinii.appid');
      } else {
        localStorage.setItem('cinii.appid', v);
      }
      renderStatus('appid を保存しました。', 'info');
    } catch (e) {
      renderStatus(`appid 保存に失敗: ${e.message}`, 'error');
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem('cinii.appid');
        input.value = '';
        renderStatus('appid を削除しました。', 'info');
      } catch (e) {
        renderStatus(`appid 削除に失敗: ${e.message}`, 'error');
      }
    });
  }
}

// ---------- 起動 ----------
function init() {
  // 無効ソース (jairo) のチェックボックスは disabled、ラベルにも理由を表示
  for (const cb of form.querySelectorAll('input[name="source"]')) {
    const a = ADAPTERS[cb.value];
    if (a && !a.available) {
      cb.disabled = true;
      cb.checked = false;
      const label = cb.closest('label');
      if (label && a.unavailableReason && !label.dataset.reasonAttached) {
        label.title = a.unavailableReason;
        const note = document.createElement('span');
        note.className = 'source-note';
        note.textContent = '（復旧待ち）';
        label.appendChild(note);
        label.dataset.reasonAttached = 'true';
      }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // 検索条件が変わったら start をリセット
    if (e.submitter && e.submitter.dataset?.keepStart !== 'true') {
      // 通常検索ボタン押下時は 1 から
    }
    runSearch(getFormParams(form));
  });

  // 「最初から」ボタン
  const resetStart = $('#resetStart');
  if (resetStart) {
    resetStart.addEventListener('click', () => {
      formEl('start').value = '1';
      runSearch(getFormParams(form));
    });
  }

  wireAppIdSettings();
  detectWebMCP();
  try {
    registerWebMCPTool();
  } catch (e) {
    console.warn('WebMCP ツール登録に失敗:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
