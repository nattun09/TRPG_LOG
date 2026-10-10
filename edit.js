/* =========================================================
 * TRPGログ 編集機能
 *  - 追加/編集した内容は data/custom.json（オーバーレイ）に保存し、
 *    ページ読み込み時に既存コンテンツへ反映します。
 *  - 保存先: GitHubトークンがあれば GitHub へコミット（全員に反映）、
 *            無ければこのブラウザ(localStorage)のみ。
 * ========================================================= */
(function () {
  'use strict';

  var PASSWORD = 'monakamo';
  var LS_OVERLAY = 'trpgOverlayLocal';
  var LS_GH = 'trpgGhConfig';
  var SS_EDIT = 'trpgEditMode';
  var DEFAULT_GH = { repo: 'nattun09/TRPG_LOG', branch: 'main', dataPath: 'data/custom.json', imageDir: 'image', token: '' };
  var STAT_KEYS = ['STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU'];
  var PROFILE_FIELDS = [['age', '年齢'], ['gender', '性別'], ['height', '身長'], ['birthday', '誕生日'], ['job', '職業'], ['origin', '出身'], ['relation', '関係']];
  var FALLBACK_THUMB = 'favicon/favicon.png';

  /* ---------- 共通ヘルパー ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function isData(v) { return typeof v === 'string' && v.indexOf('data:image/') === 0; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- オーバーレイデータ ---------- */
  function emptyOv() { return { v: 1, chara: {}, text: [], youtube: [], room: [] }; }
  function normOv(o) {
    var r = emptyOv();
    if (!o || typeof o !== 'object') return r;
    if (o.chara && typeof o.chara === 'object' && !Array.isArray(o.chara)) r.chara = o.chara;
    ['text', 'youtube', 'room'].forEach(function (k) { if (Array.isArray(o[k])) r[k] = o[k]; });
    return r;
  }
  function mergeOv(a, b) {
    var r = emptyOv();
    [a, b].forEach(function (o) {
      Object.keys(o.chara).forEach(function (id) {
        var c = o.chara[id], p = r.chara[id];
        if (!p || (c.at || 0) >= (p.at || 0)) r.chara[id] = c;
      });
      ['text', 'youtube', 'room'].forEach(function (k) {
        o[k].forEach(function (it) {
          var i = r[k].findIndex(function (x) { return x.id === it.id; });
          if (i < 0) r[k].push(it);
          else if ((it.at || 0) >= (r[k][i].at || 0)) r[k][i] = it;
        });
      });
    });
    ['text', 'youtube', 'room'].forEach(function (k) { r[k].sort(function (x, y) { return (x.at || 0) - (y.at || 0); }); });
    return r;
  }
  function readRemoteSync() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', 'data/custom.json?t=' + Date.now(), false);
      x.send(null);
      if ((x.status >= 200 && x.status < 300) || (x.status === 0 && x.responseText)) return normOv(JSON.parse(x.responseText));
    } catch (e) { /* 無ければ空 */ }
    return emptyOv();
  }
  function readLocal() {
    try {
      var s = localStorage.getItem(LS_OVERLAY);
      return s ? normOv(JSON.parse(s)) : emptyOv();
    } catch (e) { return emptyOv(); }
  }
  // GitHub保存モードでは、ローカルのキャッシュは反映待ち用に15分だけ使う
  function pruneLocal(o) {
    if (!getGh().token) return o;
    var lim = Date.now() - 15 * 60 * 1000;
    var r = emptyOv();
    Object.keys(o.chara).forEach(function (id) { if ((o.chara[id].at || 0) >= lim) r.chara[id] = o.chara[id]; });
    ['text', 'youtube', 'room'].forEach(function (k) { r[k] = o[k].filter(function (x) { return (x.at || 0) >= lim; }); });
    return r;
  }
  function getGh() {
    var c = {};
    try { c = JSON.parse(localStorage.getItem(LS_GH) || '{}') || {}; } catch (e) { c = {}; }
    var r = {};
    Object.keys(DEFAULT_GH).forEach(function (k) { r[k] = (c[k] != null && c[k] !== '') ? c[k] : DEFAULT_GH[k]; });
    return r;
  }

  /* ---------- DOM反映 ---------- */
  function gridChains(root) {
    var out = [];
    Array.prototype.forEach.call(root.children, function (t) {
      if (!t.classList || !t.classList.contains('category-title')) return;
      var g = t.nextElementSibling;
      if (g && g.classList.contains('link-grid')) out.push({ title: t, grid: g, name: t.textContent.trim() });
    });
    return out;
  }
  function ensureGrid(root, name, beforeEl, extraClass) {
    var c = gridChains(root).filter(function (x) { return x.name === name; })[0];
    if (c) return c.grid;
    var t = el('div', 'category-title', name);
    var g = el('div', 'link-grid' + (extraClass ? ' ' + extraClass : ''));
    if (beforeEl && beforeEl.parentNode === root) { root.insertBefore(t, beforeEl); root.insertBefore(g, beforeEl); }
    else { root.appendChild(t); root.appendChild(g); }
    return g;
  }
  function cardName(card) {
    var s = card.querySelector('span');
    return s ? s.textContent.trim() : '';
  }
  function rekey(obj, oldK, newK, val) {
    var ents = Object.keys(obj).map(function (k) { return [k, obj[k]]; });
    ents.forEach(function (e) { delete obj[e[0]]; });
    ents.forEach(function (e) {
      if (e[0] === oldK) obj[newK] = val;
      else if (e[0] !== newK) obj[e[0]] = e[1];
    });
  }
  function splitSpan(span) {
    var title = '', sub = '', seenBr = false;
    Array.prototype.forEach.call(span.childNodes, function (n) {
      if (n.nodeName === 'BR') { seenBr = true; return; }
      var t = n.textContent;
      if (seenBr) sub += (sub ? ' ' : '') + t.trim(); else title += t;
    });
    return { title: title.trim(), sub: sub };
  }
  function uniqueId(used, id) {
    var r = id, n = 2;
    while (used[r]) r = id + '#' + (n++);
    used[r] = 1;
    return r;
  }
  // 既存コンテンツ（HTML直書き）に編集用IDを振る
  function tagOrigCards() {
    var used = {};
    var root = document.getElementById('chara');
    if (root) {
      gridChains(root).forEach(function (c) {
        Array.prototype.forEach.call(c.grid.querySelectorAll('.image-link'), function (a) {
          a.dataset.editId = uniqueId(used, 'orig:' + cardName(a));
          a.dataset.cat = c.name;
        });
      });
    }
    [['text', 'text'], ['cocoforia', 'room']].forEach(function (p) {
      var r = document.getElementById(p[0]);
      if (!r) return;
      gridChains(r).forEach(function (c) {
        Array.prototype.forEach.call(c.grid.querySelectorAll('.image-link'), function (a) {
          var sp = a.querySelector('span');
          var t = sp ? splitSpan(sp).title : '';
          a.dataset.editId = uniqueId(used, 'orig:' + p[1] + ':' + (a.getAttribute('href') || '') + '|' + t);
          a.dataset.cat = c.name;
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#youtube .category'), function (cat) {
      var key = cat.dataset.category;
      ytButtons(cat).forEach(function (b) {
        b.dataset.editId = uniqueId(used, 'orig:youtube:' + key + '|' + b.textContent.trim());
      });
    });
  }
  function charaEntry(rec) {
    var imgs = (rec.images || []).filter(Boolean);
    var stats = {};
    STAT_KEYS.forEach(function (k) { stats[k] = Number((rec.stats || {})[k]) || 0; });
    return {
      image: imgs.length > 1 ? imgs : (imgs[0] || rec.thumb),
      url: rec.url || '',
      description: rec.description || '',
      stats: stats
    };
  }
  function applyChara(ov, stats) {
    var root = document.getElementById('chara');
    var recs = Object.keys(ov.chara).map(function (k) { return ov.chara[k]; }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
    recs.forEach(function (rec) {
      var card = Array.prototype.filter.call(root.querySelectorAll('.image-link'), function (a) { return a.dataset.editId === rec.id; })[0];
      if (rec.deleted) {
        if (card) { delete stats[cardName(card)]; card.remove(); }
        return;
      }
      var oldName = card ? cardName(card) : null;
      if (!card) {
        card = el('a', 'image-link');
        card.target = '_blank';
        card.appendChild(document.createElement('img'));
        card.appendChild(document.createElement('span'));
      }
      var grid = ensureGrid(root, rec.category, root.querySelector('#iconPicker'));
      if (card.parentNode !== grid) grid.insertBefore(card, grid.firstChild); // カテゴリの先頭に追加
      card.dataset.editId = rec.id;
      card.dataset.cat = rec.category;
      card.dataset.tags = rec.tags || '';
      card.querySelector('img').src = rec.thumb || FALLBACK_THUMB;
      card.querySelector('span').textContent = rec.name;
      var entry = charaEntry(rec);
      if (oldName && oldName !== rec.name) rekey(stats, oldName, rec.name, entry);
      else stats[rec.name] = entry;
    });
  }
  function makeLinkCard(rec, withRoom) {
    var a = el('a', 'image-link');
    a.target = '_blank';
    a.href = rec.url || '#';
    a.dataset.tags = rec.tags || '';
    a.dataset.editId = rec.id;
    a.dataset.cat = rec.category || '';
    var img = document.createElement('img');
    img.src = rec.thumb || FALLBACK_THUMB;
    var sp = document.createElement('span');
    if (withRoom) {
      a.dataset.room = rec.title;
      sp.textContent = rec.title;
    } else {
      sp.appendChild(document.createTextNode(rec.title));
      if (rec.sub) { sp.appendChild(document.createElement('br')); sp.appendChild(document.createTextNode(rec.sub)); }
      if (rec.date) a.dataset.date = rec.date;
    }
    a.appendChild(img);
    a.appendChild(sp);
    return a;
  }
  function placeCard(root, rec, extraClass, atTop, withRoom) {
    var card = Array.prototype.filter.call(root.querySelectorAll('.image-link'), function (a) { return a.dataset.editId === rec.id; })[0];
    if (rec.deleted) { if (card) card.remove(); return; }
    var grid = ensureGrid(root, rec.category, null, extraClass);
    var nc = makeLinkCard(rec, withRoom);
    if (card && card.parentNode === grid) card.replaceWith(nc);
    else {
      if (card) card.remove();
      if (atTop) grid.insertBefore(nc, grid.firstChild); else grid.appendChild(nc);
    }
  }
  function applyText(rec) { placeCard(document.getElementById('text'), rec, null, true, false); }
  function applyRoom(rec) { placeCard(document.getElementById('cocoforia'), rec, 'cocoforia-grid', false, true); }

  /* --- YouTube --- */
  function ytButtons(cat) { return Array.prototype.slice.call(cat.querySelectorAll('.video-links button')); }
  function ytLi(cat, title) {
    var as = cat.querySelectorAll('.video-toc li a');
    for (var i = 0; i < as.length; i++) if (as[i].textContent.trim() === title) return as[i].parentNode;
    return null;
  }
  function ytSetPlaylist(cat, url) {
    if (!url) return;
    var link = cat.querySelector('a.playlist-link');
    if (!link) {
      link = el('a', 'playlist-link', ' ▶ プレイリスト');
      link.target = '_blank';
      link.rel = 'noopener';
      cat.querySelector('.category-title').after(link);
    }
    link.href = url;
  }
  function ytGetCat(rec, videoData) {
    var root = document.getElementById('youtube');
    var key = rec.categoryKey;
    if (!key) return null;
    var cat = root.querySelector('.category[data-category="' + key + '"]');
    if (!cat) {
      // VOIDなど他のシリーズカテゴリと同じ構成（タイトル → プレイリスト → 動画 → ボタン → 目次）
      cat = el('div', 'category');
      cat.dataset.category = key;
      cat.innerHTML =
        '<div class="category-title"></div>' +
        '<div class="carousel"><iframe allowfullscreen></iframe><div class="carousel-controls">' +
        '<button class="prev" aria-label="前の動画">&lt;</button><button class="next" aria-label="次の動画">&gt;</button></div></div>' +
        '<div class="video-links"></div>';
      cat.querySelector('.category-title').textContent = rec.categoryName || key;
      var first = root.querySelector('.category');
      if (first) first.after(cat); else root.appendChild(cat);
      videoData[key] = [];
    }
    if (!videoData[key]) videoData[key] = [];
    ytSetPlaylist(cat, rec.playlist);
    return cat;
  }
  function ytInsert(cat, rec, videoData) {
    var key = cat.dataset.category;
    var links = cat.querySelector('.video-links');
    var ul = cat.querySelector('.video-toc ul');
    var btn = el('button', null, rec.title);
    btn.dataset.tags = rec.tags || '';
    btn.dataset.date = rec.date || '';
    btn.dataset.editId = rec.id;
    var li = null;
    if (ul) { // 目次(video-toc)があるカテゴリにだけ目次項目を足す。新規カテゴリには目次を作らない
      li = document.createElement('li');
      var a = el('a', null, rec.title);
      a.href = '#';
      li.appendChild(a);
    }
    var item = { src: rec.src, title: rec.title };
    if (rec.pos === 'top') { links.prepend(btn); if (ul) ul.prepend(li); videoData[key].unshift(item); }
    else { links.appendChild(btn); if (ul) ul.appendChild(li); videoData[key].push(item); }
    return btn;
  }
  function ytRemove(btn, li, videoData) {
    var cat = btn.closest('.category');
    var key = cat.dataset.category;
    var idx = ytButtons(cat).indexOf(btn);
    if (li) li.remove();
    btn.remove();
    if (videoData[key] && idx >= 0) videoData[key].splice(idx, 1);
    if (!ytButtons(cat).length) { cat.remove(); delete videoData[key]; } // 空のカテゴリは消す（初期化の不具合防止）
  }
  function applyYouTube(rec, videoData) {
    var root = document.getElementById('youtube');
    var btn = null;
    Array.prototype.forEach.call(root.querySelectorAll('.video-links button'), function (b) { if (b.dataset.editId === rec.id) btn = b; });
    var oldCat = btn ? btn.closest('.category') : null;
    var oldLi = btn ? ytLi(oldCat, btn.textContent.trim()) : null;
    if (rec.deleted) { if (btn) ytRemove(btn, oldLi, videoData); return; }
    var cat = ytGetCat(rec, videoData);
    if (!cat) return;
    if (btn && oldCat === cat && (!rec.pos || rec.pos === 'keep')) {
      var key = cat.dataset.category;
      var idx = ytButtons(cat).indexOf(btn);
      btn.textContent = rec.title;
      btn.dataset.tags = rec.tags || '';
      btn.dataset.date = rec.date || '';
      if (oldLi && oldLi.querySelector('a')) oldLi.querySelector('a').textContent = rec.title;
      if (idx >= 0) videoData[key][idx] = { src: rec.src, title: rec.title };
      return;
    }
    ytInsert(cat, rec, videoData);
    if (btn) ytRemove(btn, oldLi, videoData);
  }

  function applyOverlay(ctx) {
    var ov = mergeOv(readRemoteSync(), pruneLocal(readLocal()));
    window.__trpgOverlay = ov;
    try { tagOrigCards(); } catch (e) { console.error(e); }
    try { applyChara(ov, ctx.charaStats); } catch (e) { console.error(e); }
    ov.text.forEach(function (r) { try { applyText(r); } catch (e) { console.error(e); } });
    ov.room.forEach(function (r) { try { applyRoom(r); } catch (e) { console.error(e); } });
    ov.youtube.forEach(function (r) { try { applyYouTube(r, ctx.videoData); } catch (e) { console.error(e); } });
  }

  /* ---------- GitHub 保存 ---------- */
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b64) { return decodeURIComponent(escape(atob(b64.replace(/\s/g, '')))); }
  function ghHeaders(gh) { return { 'Authorization': 'Bearer ' + gh.token, 'Accept': 'application/vnd.github+json' }; }
  function ghUrl(gh, path) { return 'https://api.github.com/repos/' + gh.repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/'); }
  function ghError(res, body) {
    var e = new Error('GitHub: ' + res.status + ' ' + ((body && body.message) || ''));
    e.status = res.status;
    return e;
  }
  async function ghGet(gh, path) {
    var res = await fetch(ghUrl(gh, path) + '?ref=' + encodeURIComponent(gh.branch), { headers: ghHeaders(gh), cache: 'no-store' });
    if (res.status === 404) return null;
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw ghError(res, body);
    return body;
  }
  async function ghPut(gh, path, b64, message, sha) {
    var payload = { message: message, content: b64, branch: gh.branch };
    if (sha) payload.sha = sha;
    var res = await fetch(ghUrl(gh, path), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(gh)),
      body: JSON.stringify(payload)
    });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw ghError(res, body);
    return body;
  }
  async function remoteCommit(mutate, gh) {
    for (var i = 0; i < 3; i++) {
      var cur = await ghGet(gh, gh.dataPath);
      var ov = cur && cur.content ? normOv(JSON.parse(b64dec(cur.content))) : emptyOv();
      ov = mutate(ov);
      try {
        await ghPut(gh, gh.dataPath, b64enc(JSON.stringify(ov, null, 1)), 'edit: update site data', cur && cur.sha);
        return;
      } catch (e) {
        if (e.status === 409 || e.status === 422) continue;
        throw e;
      }
    }
    throw new Error('保存が競合しました。もう一度お試しください');
  }
  async function uploadDataUrl(gh, dataUrl, hint) {
    var m = dataUrl.match(/^data:image\/(\w+);base64,(.*)$/);
    if (!m) throw new Error('画像データが不正です');
    var ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    var slug = String(hint || 'img').replace(/[^\w\-]+/g, '') || 'img';
    var path = gh.imageDir.replace(/\/+$/, '') + '/' + slug + '-' + Date.now().toString(36) + '.' + ext;
    await ghPut(gh, path, m[2], 'edit: add image', null);
    return path;
  }
  async function toRemoteRecord(kind, rec, gh) {
    var r = JSON.parse(JSON.stringify(rec));
    if (r.deleted) return r;
    var hint = uid('i');
    if (isData(r.thumb)) r.thumb = await uploadDataUrl(gh, r.thumb, hint + 't');
    if (kind === 'chara' && Array.isArray(r.images)) {
      for (var i = 0; i < r.images.length; i++) {
        if (isData(r.images[i])) r.images[i] = await uploadDataUrl(gh, r.images[i], hint + 'b' + i);
      }
    }
    return r;
  }
  function addRec(ov, kind, rec) {
    if (kind === 'chara') ov.chara[rec.id] = rec;
    else {
      var i = ov[kind].findIndex(function (x) { return x.id === rec.id; });
      if (i < 0) ov[kind].push(rec); else ov[kind][i] = rec;
    }
    return ov;
  }
  async function persist(kind, rec) {
    var gh = getGh();
    rec.at = Date.now();
    var remoteRec = gh.token ? await toRemoteRecord(kind, rec, gh) : rec;
    // ローカル（このブラウザ）
    var loc = addRec(readLocal(), kind, rec);
    try { localStorage.setItem(LS_OVERLAY, JSON.stringify(loc)); }
    catch (e) {
      if (!gh.token) throw new Error('このブラウザの保存容量が足りません。画像を小さくするか、GitHub保存を設定してください');
    }
    if (gh.token) await remoteCommit(function (ov) { return addRec(ov, kind, remoteRec); }, gh);
  }

  /* ---------- UI部品 ---------- */
  function injectStyle() {
    var css = [
      '.te-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:none;align-items:center;gap:.5rem;background:#fff;border:1px solid var(--border);border-radius:999px;box-shadow:var(--shadow-md);padding:.4rem .7rem;z-index:9000;max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center}',
      'body.edit-mode .te-bar{display:flex}',
      '.te-status{color:var(--text-muted);font-size:.72rem;font-weight:700}',
      '.te-btn{border:1px solid var(--border);background:#fff;color:var(--text-muted);border-radius:999px;padding:.4rem .9rem;font-weight:700;font-family:inherit;cursor:pointer;font-size:.8rem}',
      '.te-btn:hover{border-color:var(--primary);color:var(--primary-dark)}',
      '.te-btn.primary{background:var(--primary);border-color:var(--primary);color:#fff}',
      '.te-btn.danger{color:#c0392b;border-color:#e8b4ae}',
      '.te-btn:disabled{opacity:.5;cursor:default}',
      '.te-overlay{position:fixed;inset:0;background:rgba(61,51,54,.45);z-index:10001;display:flex;overflow-y:auto;padding:16px}',
      '.te-modal{background:#fff;border-radius:16px;box-shadow:var(--shadow-lg);width:100%;max-width:560px;padding:18px 18px 14px;margin:auto;border:1px solid var(--border)}',
      '.te-modal-title{font-weight:700;font-size:1.05rem;margin-bottom:.8rem}',
      '.te-field{display:block;margin:0 0 .75rem}',
      '.te-label{display:block;font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:.2rem}',
      '.te-hint{display:block;font-size:.7rem;color:var(--text-faint);margin-top:.15rem}',
      '.te-input{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;padding:.5rem .7rem;font-size:16px;font-family:inherit;background:#fff;color:var(--text)}',
      '.te-input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}',
      'textarea.te-input{min-height:4.5em;resize:vertical}',
      '.te-cat{display:flex;flex-direction:column;gap:.4rem}',
      '.te-imgrow{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}',
      '.te-imgrow .te-input{flex:1 1 160px;min-width:0}',
      '.te-prev{width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border);background:var(--surface-soft)}',
      '.te-mini{border:1px solid var(--border);background:#fff;border-radius:999px;padding:.25rem .7rem;font-size:.72rem;font-family:inherit;cursor:pointer;color:var(--text-muted)}',
      '.te-listrow{border:1px dashed var(--border);border-radius:10px;padding:.5rem;margin-bottom:.5rem}',
      '.te-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}',
      '.te-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}',
      '.te-grid4 .te-label{text-align:center;margin-bottom:.1rem}',
      '.te-kinds{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.9rem}',
      '.te-kinds .te-btn.active{background:var(--primary);border-color:var(--primary);color:#fff}',
      '.te-section{font-size:.8rem;font-weight:700;color:var(--primary-dark);margin:.9rem 0 .4rem;border-left:3px solid var(--primary);padding-left:.5rem}',
      '.te-error{color:#c0392b;font-size:.8rem;font-weight:700;min-height:1.2em;margin:.3rem 0}',
      '.te-foot{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:.5rem}',
      '.te-note{font-size:.75rem;color:var(--text-muted);line-height:1.6;margin:0 0 .8rem}',
      '.te-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#3d3336;color:#fff;padding:.6rem 1.1rem;border-radius:999px;font-size:.85rem;z-index:10002;font-weight:700}',
      '.te-tags{margin-top:.35rem;border:1px solid var(--border);border-radius:10px;padding:.35rem .6rem}',
      '.te-tags summary{cursor:pointer;font-size:.78rem;font-weight:700;color:var(--primary-dark)}',
      '.te-tags .te-input{margin:.4rem 0}',
      '.te-tagbox{display:flex;flex-wrap:wrap;gap:.3rem;max-height:9rem;overflow-y:auto;padding-bottom:.3rem}',
      '.te-chip{border:1px solid var(--border);background:#fff;color:var(--text-muted);border-radius:999px;padding:.2rem .65rem;font-size:.75rem;font-family:inherit;cursor:pointer}',
      '.te-chip.on{background:var(--primary);border-color:var(--primary);color:#fff}',
      'body.edit-mode #youtube .video-links button{border-style:dashed;border-color:var(--primary)}',
      'body.edit-mode #chara .image-link,body.edit-mode #text .image-link,body.edit-mode #cocoforia .image-link{cursor:pointer;position:relative}',
      'body.edit-mode #chara .image-link img,body.edit-mode #text .image-link img,body.edit-mode #cocoforia .image-link img{outline:2px dashed var(--primary);outline-offset:2px}',
      'body.edit-mode #chara .image-link::after,body.edit-mode #text .image-link::after,body.edit-mode #cocoforia .image-link::after{content:"✎";position:absolute;top:4px;right:4px;background:var(--primary);color:#fff;width:22px;height:22px;border-radius:50%;font-size:12px;display:flex;align-items:center;justify-content:center;pointer-events:none}'
    ].join('\n');
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
  function toast(msg) {
    var t = el('div', 'te-toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function openModal(title, content) {
    var ov = el('div', 'te-overlay');
    var box = el('div', 'te-modal');
    box.appendChild(el('div', 'te-modal-title', title));
    box.appendChild(content);
    ov.appendChild(box);
    document.body.appendChild(ov);
    return { close: function () { ov.remove(); } };
  }
  function field(label, input, hint) {
    var w = el('label', 'te-field');
    w.appendChild(el('span', 'te-label', label));
    w.appendChild(input);
    if (hint) w.appendChild(el('small', 'te-hint', hint));
    return w;
  }
  function textInput(val, ph, type) {
    var i = el('input', 'te-input');
    i.type = type || 'text';
    i.value = val == null ? '' : val;
    if (ph) i.placeholder = ph;
    return i;
  }
  function categoryPicker(options, currentValue, onChange) {
    var wrap = el('div', 'te-cat');
    var sel = el('select', 'te-input');
    options.forEach(function (o) {
      var op = el('option', null, o.label);
      op.value = o.value;
      sel.appendChild(op);
    });
    var on = el('option', null, '＋ 新しいカテゴリを作る');
    on.value = '__new__';
    sel.appendChild(on);
    var ni = textInput('', '新しいカテゴリ名');
    ni.style.display = 'none';
    function getVal() {
      if (sel.value === '__new__') return { isNew: true, value: null, name: ni.value.trim() };
      var o = options.filter(function (x) { return x.value === sel.value; })[0];
      return { isNew: false, value: sel.value, name: o ? o.label : sel.value };
    }
    sel.addEventListener('change', function () { ni.style.display = sel.value === '__new__' ? '' : 'none'; if (onChange) onChange(getVal()); });
    if (currentValue != null && options.some(function (o) { return o.value === currentValue; })) sel.value = currentValue;
    wrap.appendChild(sel);
    wrap.appendChild(ni);
    return {
      el: wrap,
      get: function () {
        if (sel.value === '__new__') return { isNew: true, value: null, name: ni.value.trim() };
        var o = options.filter(function (x) { return x.value === sel.value; })[0];
        return { isNew: false, value: sel.value, name: o ? o.label : sel.value };
      }
    };
  }
  function resizeToDataURL(file, max) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var s = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * s));
          c.height = Math.max(1, Math.round(img.height * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var d = c.toDataURL('image/webp', 0.86);
          if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.88);
          resolve(d);
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }
  function imageField(label, value, maxDim, hint) {
    var state = { v: value || '' };
    var wrap = el('div', 'te-field');
    if (label) wrap.appendChild(el('span', 'te-label', label));
    var row = el('div', 'te-imgrow');
    var prev = el('img', 'te-prev');
    var txt = textInput('', 'image/xxx.webp または画像のURL');
    var file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.style.maxWidth = '100%';
    var clr = el('button', 'te-mini', '✕');
    clr.type = 'button';
    function refresh() {
      if (isData(state.v)) { txt.value = '（アップロードした画像）'; txt.readOnly = true; }
      else { txt.readOnly = false; txt.value = state.v; }
      prev.src = state.v || '';
      prev.style.display = state.v ? '' : 'none';
    }
    txt.addEventListener('input', function () {
      if (txt.readOnly) return;
      state.v = txt.value.trim();
      prev.src = state.v;
      prev.style.display = state.v ? '' : 'none';
    });
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      resizeToDataURL(f, maxDim).then(function (d) { state.v = d; refresh(); }).catch(function () { alert('画像を読み込めませんでした'); });
    });
    clr.addEventListener('click', function () { state.v = ''; file.value = ''; refresh(); });
    row.appendChild(prev);
    row.appendChild(txt);
    row.appendChild(clr);
    wrap.appendChild(row);
    wrap.appendChild(file);
    wrap.appendChild(el('small', 'te-hint', hint || 'パス/URLを入力するか、ファイルを選択（自動で縮小します）'));
    refresh();
    return { el: wrap, get: function () { return state.v; } };
  }
  function imageListField(label, values, maxDim) {
    var wrap = el('div', 'te-field');
    wrap.appendChild(el('span', 'te-label', label));
    var list = el('div');
    var rows = [];
    function add(v) {
      var f = imageField(null, v, maxDim);
      var row = el('div', 'te-listrow');
      row.appendChild(f.el);
      var rm = el('button', 'te-mini', 'この画像を削除');
      rm.type = 'button';
      rm.addEventListener('click', function () { row.remove(); rows.splice(rows.indexOf(f), 1); });
      row.appendChild(rm);
      list.appendChild(row);
      rows.push(f);
    }
    values.forEach(add);
    var ab = el('button', 'te-mini', '＋ 画像を追加（差分など）');
    ab.type = 'button';
    ab.addEventListener('click', function () { add(''); });
    wrap.appendChild(list);
    wrap.appendChild(ab);
    return { el: wrap, get: function () { return rows.map(function (r) { return r.get(); }).filter(Boolean); } };
  }

  /* ---------- カテゴリ一覧（初期状態のスナップショット） ---------- */
  var cats = { chara: [], text: [], room: [], youtube: [] };
  var allTags = [];
  function computeCats() {
    function names(id) {
      var r = document.getElementById(id);
      return r ? gridChains(r).map(function (c) { return { value: c.name, label: c.name }; }) : [];
    }
    cats.chara = names('chara');
    cats.text = names('text');
    cats.room = names('cocoforia');
    cats.youtube = Array.prototype.map.call(document.querySelectorAll('#youtube .category'), function (c) {
      var t = c.querySelector('.category-title');
      var best = null;
      ytButtons(c).forEach(function (b) { if (!best || (b.dataset.date || '') >= (best.dataset.date || '')) best = b; });
      var pl = c.querySelector('a.playlist-link');
      return {
        value: c.dataset.category,
        label: t ? t.textContent.trim() : c.dataset.category,
        latestTitle: best ? best.textContent.trim() : '',
        latestTags: best ? (best.dataset.tags || '') : '',
        playlist: pl ? (pl.getAttribute('href') || '') : ''
      };
    });
    var set = {};
    Array.prototype.forEach.call(document.querySelectorAll('#chara .image-link, #text .image-link, #cocoforia .image-link, #youtube .video-links button'), function (e) {
      (e.dataset.tags || '').split(',').forEach(function (t) { t = t.trim(); if (t) set[t] = 1; });
    });
    allTags = Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
  }

  /* ---------- フォーム ---------- */
  function parseDesc(html) {
    var out = { extra: [] };
    var ta = document.createElement('textarea');
    String(html || '').split(/<br\s*\/?>/i).forEach(function (part) {
      ta.innerHTML = part;
      var t = ta.value.trim();
      if (!t) return;
      var m = t.match(/^([^：:]+)[：:]\s*(.*)$/);
      if (!m) { out.extra.push(t); return; }
      var key = null;
      PROFILE_FIELDS.forEach(function (f) { if (f[1] === m[1].trim()) key = f[0]; });
      if (key && out[key] === undefined) out[key] = m[2];
      else out.extra.push(t);
    });
    return out;
  }
  function buildDesc(p) {
    var lines = [];
    PROFILE_FIELDS.forEach(function (f) {
      var v = (p[f[0]] || '').trim();
      if (v) lines.push(esc(f[1] + '：' + v));
    });
    (p.extra || '').split(/\r?\n/).forEach(function (l) { l = l.trim(); if (l) lines.push(esc(l)); });
    return lines.join('<br>');
  }

  function buildCharaForm(card) {
    var stats = (typeof charaStats !== 'undefined') ? charaStats : {};
    var name = card ? cardName(card) : '';
    var data = card ? (stats[name] || {}) : {};
    var imgs = data.image ? (Array.isArray(data.image) ? data.image.slice() : [data.image]) : [];
    var thumb = card ? (card.querySelector('img').getAttribute('src') || '') : '';
    var prof = parseDesc(data.description);
    var wrap = el('div');

    var cat = categoryPicker(cats.chara, card ? card.dataset.cat : (cats.chara[0] && cats.chara[0].value));
    wrap.appendChild(field('カテゴリ', cat.el));
    var fName = textInput(name, '例: 中出 孕');
    wrap.appendChild(field('名前（一覧に表示される名前）', fName));
    var fThumb = imageField('アイコン画像（一覧用）', thumb, 512);
    wrap.appendChild(fThumb.el);
    var fBody = imageListField('全身立ち絵（複数可・空でもOK）', imgs, 1400);
    wrap.appendChild(fBody.el);
    var fUrl = textInput(data.url || '', 'https://iachara.com/view/…');
    wrap.appendChild(field('キャラシURL', fUrl));
    var fTags = tagField('タグ', card ? (card.dataset.tags || '') : '', '検索やYouTube/テキセとの連動に使われます');
    wrap.appendChild(fTags.el);

    wrap.appendChild(el('div', 'te-section', 'プロフィール'));
    var pin = {};
    var g = el('div', 'te-grid2');
    PROFILE_FIELDS.forEach(function (f) {
      pin[f[0]] = textInput(prof[f[0]] || '', f[0] === 'birthday' ? '例: 7/13' : '');
      g.appendChild(field(f[1], pin[f[0]]));
    });
    wrap.appendChild(g);
    var fExtra = el('textarea', 'te-input');
    fExtra.value = prof.extra.join('\n');
    fExtra.placeholder = '1行ずつ「ラベル：内容」 例: 関係：ラビとルームメイト';
    wrap.appendChild(field('その他（1行1項目）', fExtra));

    wrap.appendChild(el('div', 'te-section', '能力値'));
    var sg = el('div', 'te-grid4');
    var sin = {};
    STAT_KEYS.forEach(function (k) {
      var w = el('div');
      w.appendChild(el('span', 'te-label', k));
      var i = textInput((data.stats && data.stats[k] != null) ? data.stats[k] : 0, '', 'number');
      i.min = 0; i.max = 99;
      sin[k] = i;
      w.appendChild(i);
      sg.appendChild(w);
    });
    wrap.appendChild(sg);

    return {
      el: wrap,
      isEdit: !!card,
      collect: function () {
        var c = cat.get();
        if (!c.name) return { error: 'カテゴリを入力してください' };
        var nm = fName.value.trim();
        if (!nm) return { error: '名前を入力してください' };
        if (Object.keys(stats).some(function (k) { return k === nm && k !== name; })) return { error: '同じ名前の探索者がすでにいます' };
        var th = fThumb.get();
        if (!th) return { error: 'アイコン画像を設定してください' };
        var p = {};
        PROFILE_FIELDS.forEach(function (f) { p[f[0]] = pin[f[0]].value; });
        p.extra = fExtra.value;
        var st = {};
        STAT_KEYS.forEach(function (k) { st[k] = Math.max(0, Math.min(99, Number(sin[k].value) || 0)); });
        return {
          kind: 'chara',
          rec: {
            id: card ? card.dataset.editId : uid('c-'),
            category: c.name, name: nm, thumb: th, images: fBody.get(),
            url: fUrl.value.trim(), tags: fTags.get(),
            description: buildDesc(p), stats: st
          }
        };
      },
      deleteRec: card ? function () { return { id: card.dataset.editId, deleted: true }; } : null,
      label: name
    };
  }

  function tagField(label, value, hint) {
    var wrap = el('div', 'te-field');
    wrap.appendChild(el('span', 'te-label', label));
    var input = textInput(value, 'カンマ区切り 例: 旭,遥啓');
    wrap.appendChild(input);
    var det = el('details', 'te-tags');
    det.appendChild(el('summary', null, 'タグから選ぶ（タップで追加／解除）'));
    var filter = textInput('', 'タグを絞り込み…');
    det.appendChild(filter);
    var box = el('div', 'te-tagbox');
    var chips = allTags.map(function (t) {
      var c = el('button', 'te-chip', t);
      c.type = 'button';
      c.addEventListener('click', function () {
        var cur = parse();
        var i = cur.indexOf(t);
        if (i >= 0) cur.splice(i, 1); else cur.push(t);
        input.value = cur.join(',');
        sync();
      });
      box.appendChild(c);
      return c;
    });
    det.appendChild(box);
    wrap.appendChild(det);
    if (hint) wrap.appendChild(el('small', 'te-hint', hint));
    function parse() { return input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
    function sync() {
      var cur = parse();
      chips.forEach(function (c) { c.classList.toggle('on', cur.indexOf(c.textContent) >= 0); });
    }
    input.addEventListener('input', sync);
    filter.addEventListener('input', function () {
      var kw = filter.value.trim().toLowerCase();
      chips.forEach(function (c) { c.style.display = (!kw || c.textContent.toLowerCase().indexOf(kw) >= 0) ? '' : 'none'; });
    });
    sync();
    return {
      el: wrap,
      get: function () { return parse().join(','); },
      set: function (v) { input.value = v || ''; sync(); }
    };
  }

  function readLinkCard(card) {
    var sp = card.querySelector('span');
    var s = sp ? splitSpan(sp) : { title: '', sub: '' };
    var im = card.querySelector('img');
    return {
      title: card.dataset.room || s.title,
      sub: s.sub,
      url: card.getAttribute('href') || '',
      thumb: im ? (im.getAttribute('src') || '') : '',
      tags: card.dataset.tags || '',
      date: card.dataset.date || '',
      cat: card.dataset.cat
    };
  }

  function buildTextForm(card) {
    var d = card ? readLinkCard(card) : {};
    var wrap = el('div');
    var cat = categoryPicker(cats.text, card ? d.cat : (cats.text[0] && cats.text[0].value));
    wrap.appendChild(field('カテゴリ', cat.el));
    var fTitle = textInput(d.title || '', '例: ネコ忍者の襲撃！');
    wrap.appendChild(field('タイトル', fTitle));
    var fSub = textInput(d.sub || '', '例: つばぽち');
    wrap.appendChild(field('サブ表示（2行目・任意）', fSub, 'ペア名など'));
    var fUrl = textInput(d.url || '', 'https://nattun09.github.io/TRPG_LOG/…/log_export.html');
    wrap.appendChild(field('ログのURL', fUrl));
    var fThumb = imageField('サムネイル画像', d.thumb || '', 900, '未設定ならサイトのアイコンを使います');
    wrap.appendChild(fThumb.el);
    var fTags = tagField('タグ（PC名）', d.tags || '');
    wrap.appendChild(fTags.el);
    var fDate = textInput(d.date || todayStr(), '', 'date');
    wrap.appendChild(field('日付', fDate));
    return {
      el: wrap,
      collect: function () {
        var c = cat.get();
        if (!c.name) return { error: 'カテゴリを入力してください' };
        if (!fTitle.value.trim()) return { error: 'タイトルを入力してください' };
        if (!fUrl.value.trim()) return { error: 'ログのURLを入力してください' };
        return {
          kind: 'text',
          rec: {
            id: card ? card.dataset.editId : uid('t-'), category: c.name, title: fTitle.value.trim(), sub: fSub.value.trim(),
            url: fUrl.value.trim(), thumb: fThumb.get(), tags: fTags.get(), date: fDate.value || todayStr()
          }
        };
      },
      deleteRec: card ? function () { return { id: card.dataset.editId, deleted: true }; } : null,
      label: d.title
    };
  }

  function playlistId(v) {
    v = (v || '').trim();
    var m = v.match(/[?&]list=([\w-]+)/);
    if (m) return m[1];
    return /^[\w-]+$/.test(v) ? v : '';
  }
  function ytSrc(v) {
    v = (v || '').trim();
    var m;
    if ((m = v.match(/[?&]list=([\w-]+)/)) && !/[?&]v=/.test(v) && !/youtu\.be\//.test(v)) return 'https://www.youtube.com/embed/videoseries?list=' + m[1];
    if ((m = v.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/))) return 'https://www.youtube.com/embed/' + m[1];
    if (/^[\w-]{11}$/.test(v)) return 'https://www.youtube.com/embed/' + v;
    return '';
  }
  function buildYouTubeForm(btn) {
    var edit = !!btn;
    var vd = (typeof videoData !== 'undefined') ? videoData : {};
    var key = null, item = {};
    if (edit) {
      var cat0 = btn.closest('.category');
      key = cat0.dataset.category;
      item = (vd[key] || [])[ytButtons(cat0).indexOf(btn)] || {};
    }
    var info0 = edit ? (cats.youtube.filter(function (x) { return x.value === key; })[0] || {}) : {};
    var wrap = el('div');
    var fTitle = textInput(edit ? btn.textContent.trim() : '', '例: 海も枯れるまで（前編）_つきしの');
    var fTags = tagField('タグ（PC名）', edit ? (btn.dataset.tags || '') : '');
    var fPlaylist = textInput(edit ? playlistId(info0.playlist) : '', 'PLxxxxxxxxxxxx');
    function fill(c) {
      var info = !c.isNew && cats.youtube.filter(function (x) { return x.value === c.value; })[0];
      fTitle.value = info ? info.latestTitle : '';
      fTags.set(info ? info.latestTags : '');
      fPlaylist.value = info ? playlistId(info.playlist) : '';
    }
    var cat = categoryPicker(cats.youtube, edit ? key : (cats.youtube[0] && cats.youtube[0].value), function (c) { if (!edit) fill(c); });
    wrap.appendChild(field('カテゴリ（動画シリーズ）', cat.el, edit ? 'カテゴリを変えると別のシリーズへ移動します' : '選ぶと、そのカテゴリの最新動画のタイトル・タグが入ります'));
    var fUrl = textInput(edit ? (item.src || '') : '', 'https://www.youtube.com/watch?v=…');
    wrap.appendChild(field('YouTubeのURL', fUrl, 'watch / youtu.be / embed 形式、または動画ID'));
    wrap.appendChild(field('タイトル', fTitle));
    wrap.appendChild(fTags.el);
    wrap.appendChild(field('プレイリストID（任意）', fPlaylist, 'list= の後ろのID（PL…）だけでOK。入力するとカテゴリに「▶ プレイリスト」ボタンが付きます'));
    var fDate = textInput(edit ? (btn.dataset.date || todayStr()) : todayStr(), '', 'date');
    wrap.appendChild(field('日付', fDate));
    var fPos = el('select', 'te-input');
    var posOpts = edit ? [['keep', '今の位置のまま'], ['top', 'カテゴリの先頭へ'], ['end', 'カテゴリの末尾へ']] : [['end', 'カテゴリの末尾'], ['top', 'カテゴリの先頭']];
    posOpts.forEach(function (o) {
      var op = el('option', null, o[1]); op.value = o[0]; fPos.appendChild(op);
    });
    wrap.appendChild(field('並び位置', fPos));
    if (!edit) fill(cat.get());
    return {
      el: wrap,
      collect: function () {
        var c = cat.get();
        if (!c.name) return { error: 'カテゴリを入力してください' };
        var src = ytSrc(fUrl.value);
        if (!src) return { error: 'YouTubeのURLを正しく入力してください' };
        if (!fTitle.value.trim()) return { error: 'タイトルを入力してください' };
        var plRaw = fPlaylist.value.trim();
        var plId = playlistId(plRaw);
        if (plRaw && !plId) return { error: 'プレイリストIDを正しく入力してください（例: PLxxxxxxxx）' };
        var pl = plId ? 'https://www.youtube.com/playlist?list=' + plId : '';
        return {
          kind: 'youtube',
          rec: {
            id: edit ? btn.dataset.editId : uid('y-'),
            categoryKey: c.isNew ? uid('custom-') : c.value,
            categoryName: c.name,
            title: fTitle.value.trim(), src: src, tags: fTags.get(), playlist: pl,
            date: fDate.value || todayStr(), pos: fPos.value
          }
        };
      },
      deleteRec: edit ? function () { return { id: btn.dataset.editId, deleted: true }; } : null,
      label: edit ? btn.textContent.trim() : ''
    };
  }

  function buildRoomForm(card) {
    var d = card ? readLinkCard(card) : {};
    var wrap = el('div');
    var cat = categoryPicker(cats.room, card ? d.cat : (cats.room[0] && cats.room[0].value));
    wrap.appendChild(field('カテゴリ', cat.el));
    var fTitle = textInput(d.title || '', '例: 蛇の恋_あさはる');
    wrap.appendChild(field('部屋名', fTitle));
    var fUrl = textInput(d.url || '', 'https://ccfolia.com/rooms/…');
    wrap.appendChild(field('ココフォリアのURL', fUrl));
    var fThumb = imageField('サムネイル画像', d.thumb || '', 900, '未設定ならサイトのアイコンを使います');
    wrap.appendChild(fThumb.el);
    var fTags = tagField('タグ', d.tags || '');
    wrap.appendChild(fTags.el);
    return {
      el: wrap,
      collect: function () {
        var c = cat.get();
        if (!c.name) return { error: 'カテゴリを入力してください' };
        if (!fTitle.value.trim()) return { error: '部屋名を入力してください' };
        if (!fUrl.value.trim()) return { error: 'URLを入力してください' };
        return {
          kind: 'room',
          rec: {
            id: card ? card.dataset.editId : uid('r-'), category: c.name, title: fTitle.value.trim(),
            url: fUrl.value.trim(), thumb: fThumb.get(), tags: fTags.get()
          }
        };
      },
      deleteRec: card ? function () { return { id: card.dataset.editId, deleted: true }; } : null,
      label: d.title
    };
  }

  /* ---------- ダイアログ ---------- */
  async function runSave(btns, errEl, job) {
    btns.forEach(function (b) { b.disabled = true; });
    errEl.textContent = '保存中…';
    try {
      await job();
      toast('保存しました');
      setTimeout(function () { location.reload(); }, 900);
    } catch (e) {
      console.error(e);
      errEl.textContent = '保存に失敗しました: ' + (e.message || e);
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  function openFormDialog(kind, target) {
    var body = el('div');
    var tabs = el('div', 'te-kinds');
    var holder = el('div');
    var err = el('div', 'te-error');
    var foot = el('div', 'te-foot');
    var current = null;
    var modal;

    var kinds = [['chara', '探索者'], ['text', 'テキセ'], ['youtube', 'YouTube'], ['room', '部屋']];
    var builders = {
      chara: function () { return buildCharaForm(target); },
      text: function () { return buildTextForm(target); },
      youtube: function () { return buildYouTubeForm(target); },
      room: function () { return buildRoomForm(target); }
    };
    var kindBtns = {};

    function show(k) {
      Object.keys(kindBtns).forEach(function (x) { kindBtns[x].classList.toggle('active', x === k); });
      holder.innerHTML = '';
      current = builders[k]();
      holder.appendChild(current.el);
      err.textContent = '';
      delBtn.style.display = (current.deleteRec) ? '' : 'none';
    }
    if (!target) {
      kinds.forEach(function (k) {
        var b = el('button', 'te-btn', k[1]);
        b.type = 'button';
        b.addEventListener('click', function () { show(k[0]); });
        kindBtns[k[0]] = b;
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
    } else {
      kindBtns[kind] = el('button');
    }
    body.appendChild(holder);
    body.appendChild(err);

    var cancel = el('button', 'te-btn', 'キャンセル');
    cancel.type = 'button';
    var delBtn = el('button', 'te-btn danger', '削除');
    delBtn.type = 'button';
    var save = el('button', 'te-btn primary', target ? '更新する' : '追加する');
    save.type = 'button';
    foot.appendChild(delBtn);
    foot.appendChild(cancel);
    foot.appendChild(save);
    body.appendChild(foot);

    cancel.addEventListener('click', function () { modal.close(); });
    save.addEventListener('click', function () {
      var r = current.collect();
      if (r.error) { err.textContent = r.error; return; }
      runSave([save, cancel, delBtn], err, function () { return persist(r.kind, r.rec); });
    });
    delBtn.addEventListener('click', function () {
      if (!current.deleteRec) return;
      if (!confirm('「' + current.label + '」を削除しますか？')) return;
      runSave([save, cancel, delBtn], err, function () { return persist(current.kindName || kind, current.deleteRec()); });
    });

    var names = { chara: '探索者', text: 'テキセ', youtube: 'YouTube動画', room: '部屋' };
    modal = openModal(target ? names[kind] + 'を編集' : '追加', body);
    show(kind);
  }

  function activeKind() {
    var t = document.querySelector('.tab-content.active');
    var id = t ? t.id : 'chara';
    return { chara: 'chara', text: 'text', youtube: 'youtube', cocoforia: 'room' }[id] || 'chara';
  }

  function askPassword() {
    return new Promise(function (resolve) {
      var body = el('div');
      var inp = textInput('', 'パスワード', 'password');
      inp.autocomplete = 'off';
      body.appendChild(inp);
      var err = el('div', 'te-error');
      body.appendChild(err);
      var foot = el('div', 'te-foot');
      var no = el('button', 'te-btn', 'キャンセル');
      var ok = el('button', 'te-btn primary', '編集モードにする');
      foot.appendChild(no); foot.appendChild(ok);
      body.appendChild(foot);
      var m = openModal('パスワードを入力', body);
      setTimeout(function () { inp.focus(); }, 0);
      function submit() {
        if (inp.value === PASSWORD) { m.close(); resolve(true); }
        else { err.textContent = 'パスワードが違います'; inp.select(); }
      }
      ok.addEventListener('click', submit);
      no.addEventListener('click', function () { m.close(); resolve(false); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });
  }

  function openSettings(onChange) {
    var gh = getGh();
    var body = el('div');
    body.appendChild(el('p', 'te-note',
      'サイトの全員に反映するには、GitHubの「Fine-grained personal access token」を作成し（対象リポジトリのContents: Read and write）、下に貼り付けてください。' +
      'トークンはこのブラウザにだけ保存されます。未設定の場合、追加・編集内容はこのブラウザでしか見えません。'));
    var fRepo = textInput(gh.repo, 'owner/repo');
    var fBranch = textInput(gh.branch, 'main');
    var fData = textInput(gh.dataPath, 'data/custom.json');
    var fImg = textInput(gh.imageDir, 'image/uploads');
    var fToken = textInput(gh.token, 'github_pat_…', 'password');
    body.appendChild(field('リポジトリ', fRepo));
    body.appendChild(field('ブランチ', fBranch));
    body.appendChild(field('データファイルのパス', fData));
    body.appendChild(field('画像のアップロード先', fImg));
    body.appendChild(field('アクセストークン', fToken));
    var foot = el('div', 'te-foot');
    var clear = el('button', 'te-btn danger', 'トークンを削除');
    var cancel = el('button', 'te-btn', '閉じる');
    var save = el('button', 'te-btn primary', '保存');
    foot.appendChild(clear); foot.appendChild(cancel); foot.appendChild(save);
    body.appendChild(foot);
    var m = openModal('保存先設定', body);
    function write(token) {
      try {
        localStorage.setItem(LS_GH, JSON.stringify({
          repo: fRepo.value.trim(), branch: fBranch.value.trim(), dataPath: fData.value.trim(),
          imageDir: fImg.value.trim(), token: token
        }));
      } catch (e) { alert('設定を保存できませんでした'); }
      m.close();
      onChange();
    }
    save.addEventListener('click', function () { write(fToken.value.trim()); });
    clear.addEventListener('click', function () { fToken.value = ''; write(''); });
    cancel.addEventListener('click', function () { m.close(); });
  }

  /* ---------- 初期化 ---------- */
  function init() {
    injectStyle();
    computeCats();

    var toggle = document.getElementById('editToggle');
    var bar = el('div', 'te-bar');
    var status = el('span', 'te-status');
    var add = el('button', 'te-btn primary', '＋ 追加');
    var set = el('button', 'te-btn', '⚙ 保存先');
    var end = el('button', 'te-btn', '編集を終了');
    [add, set, end, status].forEach(function (b) { bar.appendChild(b); });
    document.body.appendChild(bar);

    function refreshStatus() {
      status.textContent = getGh().token ? '保存先: GitHub（全員に反映）' : '保存先: この端末のみ';
    }
    function setEdit(on) {
      document.body.classList.toggle('edit-mode', on);
      if (toggle) { toggle.classList.toggle('active', on); toggle.setAttribute('aria-pressed', String(on)); }
      try { if (on) sessionStorage.setItem(SS_EDIT, '1'); else sessionStorage.removeItem(SS_EDIT); } catch (e) { /* noop */ }
      refreshStatus();
    }
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (document.body.classList.contains('edit-mode')) { setEdit(false); return; }
        askPassword().then(function (ok) { if (ok) setEdit(true); });
      });
    }
    end.addEventListener('click', function () { setEdit(false); });
    add.addEventListener('click', function () { openFormDialog(activeKind(), null); });
    set.addEventListener('click', function () { openSettings(refreshStatus); });

    // 編集モード中は探索者アイコンのクリックで編集フォームを開く（既存の詳細表示より先に捕捉）
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('edit-mode')) return;
      if (!e.target.closest) return;
      var sels = [['chara', '#chara .image-link'], ['text', '#text .image-link'], ['room', '#cocoforia .image-link'], ['youtube', '#youtube .video-links button']];
      for (var i = 0; i < sels.length; i++) {
        var t = e.target.closest(sels[i][1]);
        if (!t) continue;
        e.preventDefault();
        e.stopPropagation();
        openFormDialog(sels[i][0], t);
        return;
      }
    }, true);

    var restore = false;
    try { restore = sessionStorage.getItem(SS_EDIT) === '1'; } catch (e) { /* noop */ }
    setEdit(restore);
  }

  window.TRPGEdit = { applyOverlay: applyOverlay };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
