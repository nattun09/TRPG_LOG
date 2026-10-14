/* =========================================================
 * TRPGログ 追加機能
 *  1) 探索者の詳細に「出演した卓」の一覧を出す
 *  2) 今日が誕生日の探索者のお知らせ
 *  3) お気に入りのしるし（このブラウザに保存）
 *
 * index.html の最後（</body> の直前）で読み込みます。
 * 並べ替えなどでページの中身が作り直されても、MutationObserver で付け直します。
 * ========================================================= */
(function () {
  'use strict';

  const STORE_KEY = 'trpgLogMarks';       // お気に入り
  const SHOWN_KEY = 'trpgBdayShown';       // 全画面のお祝いを出した日
  const FALLBACK_THUMB = 'favicon/favicon.png';
  const BDAY_RE = /誕生日[:：]\s*(\d{1,2})\s*[\/月]\s*(\d{1,2})/;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- 小さなヘルパー ---------- */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // 値が変わるときだけ書き換える（無駄なDOM変更で監視が空回りしないように）
  function setCls(node, cls, on) {
    if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
  }
  function setText(node, t) {
    if (node.textContent !== t) node.textContent = t;
  }
  function setData(node, k, v) {
    if (node.dataset[k] !== v) node.dataset[k] = v;
  }
  function normTag(t) { // ひらがな/カタカナの違いと空白を無視して比較
    return String(t || '').trim().toLowerCase().replace(/\s+/g, '')
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  function splitTags(s) {
    return String(s || '').split(',').map(t => t.trim()).filter(Boolean);
  }
  // <span>タイトル<br>サブ</span> を分ける
  function splitSpan(span) {
    let title = '', sub = '', seenBr = false;
    if (!span) return { title, sub };
    Array.from(span.childNodes).forEach(n => {
      if (n.nodeName === 'BR') { seenBr = true; return; }
      const t = n.textContent;
      if (seenBr) sub += (sub ? ' ' : '') + t.trim(); else title += t;
    });
    return { title: title.trim(), sub };
  }
  function descText(desc) { // <br>区切りのHTMLをテキスト化（DOMParserなので何も実行されない）
    const html = String(desc || '').replace(/<br\s*\/?>/gi, '\n');
    return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  }
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  function todayJST() {
    const o = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(p => { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day };
  }
  const dateKey = t => t.y + '-' + String(t.m).padStart(2, '0') + '-' + String(t.d).padStart(2, '0');

  /* ---------- お気に入りの保存 ---------- */
  const store = { fav: {} };
  function loadStore() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      store.fav = (s && s.fav) || {};
    } catch (e) { store.fav = {}; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても表示は動く */ }
  }
  function toggleFav(key) {
    if (!key) return;
    if (store.fav[key]) delete store.fav[key]; else store.fav[key] = 1;
    saveStore();
  }
  loadStore();

  /* ---------- ページの中身のスナップショット ----------
   * 並べ替えでDOMが作り直されても使えるよう、読み込み時点の内容を控えておく */
  const snap = { text: [], yt: [], room: [], charaTags: new Map(), charaThumb: new Map(), keys: new Set() };

  const cardKey = (kind, a, title) => kind + '|' + (a.getAttribute('href') || title || '');
  const ytKey = title => 'yt|' + String(title || '').trim();

  function takeSnapshot() {
    snap.text = []; snap.yt = []; snap.room = []; snap.keys = new Set();

    $$('#text .image-link').forEach(a => {
      const s = splitSpan($('span', a));
      const key = cardKey('tx', a, s.title);
      if (snap.keys.has(key)) return;
      snap.keys.add(key);
      snap.text.push({
        kind: 'tx', key, title: s.title, sub: s.sub, href: a.getAttribute('href') || '',
        thumb: ($('img', a) || {}).src ? $('img', a).getAttribute('src') : '',
        tags: a.dataset.tags || '', date: a.dataset.date || ''
      });
    });

    $$('#cocoforia .image-link').forEach(a => {
      const title = a.dataset.room || splitSpan($('span', a)).title;
      const key = cardKey('rm', a, title);
      if (snap.keys.has(key)) return;
      snap.keys.add(key);
      snap.room.push({
        kind: 'rm', key, title, sub: '', href: a.getAttribute('href') || '',
        thumb: $('img', a) ? $('img', a).getAttribute('src') : '',
        tags: a.dataset.tags || '', date: ''
      });
    });

    const vd = (typeof videoData !== 'undefined') ? videoData : {};
    $$('#youtube .category').forEach(cat => {
      const vids = vd[cat.dataset.category] || [];
      $$('.video-links button', cat).forEach((b, i) => {
        const title = b.textContent.trim();
        const key = ytKey(title);
        if (snap.keys.has(key)) return;
        snap.keys.add(key);
        snap.yt.push({
          kind: 'yt', key, title, sub: '', src: (vids[i] && vids[i].src) || '',
          tags: b.dataset.tags || '', date: b.dataset.date || ''
        });
      });
    });

    $$('#chara .image-link').forEach(a => {
      const name = ($('span', a) || {}).textContent;
      if (!name) return;
      const n = name.trim();
      const set = snap.charaTags.get(n) || new Set();
      splitTags(a.dataset.tags).forEach(t => set.add(normTag(t)));
      snap.charaTags.set(n, set);
      const src = $('img', a) && $('img', a).getAttribute('src');
      if (src && !snap.charaThumb.has(n)) snap.charaThumb.set(n, src);
    });
  }

  /* ---------- 共通：探索者タブを開いて詳細を出す ---------- */
  function openChara(name) {
    const tab = $('.tab-button[data-tab="chara"]');
    if (tab && !tab.classList.contains('active')) tab.click();
    if (typeof window.updateCharaDetail === 'function') window.updateCharaDetail(name);
  }
  function charaThumb(name) {
    if (snap.charaThumb.has(name)) return snap.charaThumb.get(name);
    const data = (typeof charaStats !== 'undefined') ? charaStats[name] : null;
    const img = data && (Array.isArray(data.image) ? data.image[0] : data.image);
    return img || '';
  }

  /* =========================================================
   * 1) 出演した卓
   * ========================================================= */
  let lastChara = null;
  const SHOW_FIRST = 5;

  function openYouTube(title) {
    const tab = $('.tab-button[data-tab="youtube"]');
    if (tab && !tab.classList.contains('active')) tab.click();
    const find = () => $$('#youtube .video-links button').find(b => b.textContent.trim() === title);
    let pill = find();
    if (!pill) { // 「最新順」表示のときはカテゴリ表示に戻す
      const icon = $('#sortIcon'), tg = $('#sortToggleBtn');
      if (tg && icon && /⬇/.test(icon.textContent)) { tg.click(); pill = find(); }
    }
    if (pill) {
      pill.click();
      const cat = pill.closest('.category') || pill;
      cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function openAppearance(it) {
    if (it.kind === 'tx') {
      if (it.href) window.open(it.href, '_blank', 'noopener');
    } else if (it.kind === 'yt') {
      openYouTube(it.title);
    } else {
      // 部屋は既存の「開きますか？」確認を通す
      const a = $$('#cocoforia .image-link').find(x => x.getAttribute('href') === it.href);
      if (a) a.click(); else if (it.href) window.open(it.href, '_blank', 'noopener');
    }
  }

  function ytThumb(src) {
    const m = String(src || '').match(/\/embed\/([\w-]{11})/);
    return m ? 'https://i.ytimg.com/vi/' + m[1] + '/mqdefault.jpg' : '';
  }

  function appearRow(it) {
    const btn = el('button', 'appear-item');
    btn.type = 'button';

    const thumb = it.kind === 'yt' ? ytThumb(it.src) : (it.thumb || '');
    if (thumb) {
      const img = el('img', 'appear-thumb');
      img.src = thumb; img.alt = ''; img.loading = 'lazy';
      img.onerror = () => { img.onerror = null; img.src = FALLBACK_THUMB; };
      btn.appendChild(img);
    } else {
      btn.appendChild(el('div', 'appear-thumb appear-thumb-fb', it.kind === 'yt' ? '▶' : '🏠'));
    }

    const body = el('div', 'appear-body');
    body.appendChild(el('div', 'appear-name', it.title));
    const meta = [it.date, it.sub].filter(Boolean).join('　');
    if (meta) body.appendChild(el('div', 'appear-meta', meta));
    btn.appendChild(body);

    const marks = el('div', 'appear-marks');
    if (store.fav[it.key]) marks.appendChild(el('b', 'm-fav', '♥'));
    btn.appendChild(marks);

    btn.addEventListener('click', () => openAppearance(it));
    return btn;
  }

  function appearGroup(title, list) {
    const wrap = el('div', 'appear-group');
    wrap.appendChild(el('div', 'appear-group-title', title + '（' + list.length + '）'));
    const rows = el('div', 'appear-rows');
    list.forEach((it, i) => {
      const r = appearRow(it);
      if (i >= SHOW_FIRST) r.hidden = true;
      rows.appendChild(r);
    });
    wrap.appendChild(rows);
    if (list.length > SHOW_FIRST) {
      const more = el('button', 'appear-more', 'もっと見る（残り' + (list.length - SHOW_FIRST) + '件）');
      more.type = 'button';
      let open = false;
      more.addEventListener('click', () => {
        open = !open;
        Array.from(rows.children).forEach((r, i) => { if (i >= SHOW_FIRST) r.hidden = !open; });
        more.textContent = open ? '閉じる' : 'もっと見る（残り' + (list.length - SHOW_FIRST) + '件）';
      });
      wrap.appendChild(more);
    }
    return wrap;
  }

  function charaTagSet(name) {
    if (snap.charaTags.has(name)) return snap.charaTags.get(name);
    const set = new Set();
    const a = $$('#chara .image-link').find(x => (($('span', x) || {}).textContent || '').trim() === name);
    if (a) splitTags(a.dataset.tags).forEach(t => set.add(normTag(t)));
    return set;
  }

  function renderAppearances(name, keepOpen) {
    const host = $('#charaDetail');
    if (!host) return;
    let box = $('#charaAppearances');
    const wasOpen = !!(box && keepOpen && lastChara === name && box.open);
    lastChara = name;
    if (!box) {
      box = el('details', 'appear');
      box.id = 'charaAppearances';
      const row = $('.chara-bottom-row', host);
      if (row) row.insertAdjacentElement('afterend', box); else host.appendChild(box);
    }
    box.innerHTML = '';
    box.open = wasOpen; // 探索者を切り替えたら閉じた状態に戻す

    const tags = charaTagSet(name);
    const match = it => splitTags(it.tags).some(t => tags.has(normTag(t)));
    const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
    const tx = snap.text.filter(match).sort(byDate);
    const yt = snap.yt.filter(match).sort(byDate);
    const rm = snap.room.filter(match);
    const total = tx.length + yt.length + rm.length;

    const head = el('summary', 'appear-head');
    head.appendChild(el('span', 'appear-head-title', '出演した卓'));
    head.appendChild(el('span', 'appear-count', String(total)));
    head.appendChild(el('span', 'appear-arrow', '▾'));
    box.appendChild(head);

    const inner = el('div', 'appear-inner');
    box.appendChild(inner);
    if (!tags.size) {
      inner.appendChild(el('div', 'appear-empty', 'この探索者にはタグが設定されていないため、卓を紐づけられません。'));
      return;
    }
    if (!total) {
      inner.appendChild(el('div', 'appear-empty', 'まだ出演した卓は登録されていません。'));
      return;
    }
    if (tx.length) inner.appendChild(appearGroup('テキセ', tx));
    if (yt.length) inner.appendChild(appearGroup('YouTube', yt));
    if (rm.length) inner.appendChild(appearGroup('部屋', rm));
  }

  // 探索者の詳細を開くたびに一覧を作り直す
  function hookCharaDetail() {
    const orig = window.updateCharaDetail;
    if (typeof orig !== 'function' || orig.__extrasHooked) return;
    const wrapped = function (name) {
      const r = orig.apply(this, arguments);
      try {
        if (typeof charaStats !== 'undefined' && charaStats[name]) renderAppearances(name);
      } catch (e) { console.error(e); }
      return r;
    };
    wrapped.__extrasHooked = true;
    window.updateCharaDetail = wrapped;
  }

  /* =========================================================
   * 2) 今日が誕生日の探索者のお知らせ
   * ========================================================= */
  function birthdaysToday() {
    if (typeof charaStats === 'undefined') return [];
    const t = todayJST();
    const out = [];
    Object.keys(charaStats).forEach(name => {
      const m = descText((charaStats[name] || {}).description).match(BDAY_RE);
      if (!m) return;
      const mm = +m[1], dd = +m[2];
      const hit = (mm === t.m && dd === t.d) ||
        (mm === 2 && dd === 29 && !isLeap(t.y) && t.m === 2 && t.d === 28); // 2/29生まれは平年だと2/28
      if (hit) out.push(name);
    });
    return out;
  }

  /* ----- 紙吹雪＋花火（canvas） ----- */
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function startConfetti(host) {
    if (reduceMotion()) return () => {};
    const cv = el('canvas', 'bday-confetti');
    host.appendChild(cv);
    const ctx = cv.getContext('2d');
    let W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const colors = ['#ff4d6d', '#ffd60a', '#ffb703', '#06d6a0', '#4cc9f0', '#9b5de5', '#f15bb5', '#ffffff', '#ffe08a'];
    const gold = ['#fff3b0', '#ffd60a', '#ffb703', '#f4a300', '#ffffff'];
    const parts = [], sparks = [], rockets = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = a => a[(Math.random() * a.length) | 0];

    function confetti(x, y, n, angle, spread, power) {
      for (let i = 0; i < n; i++) {
        const ang = angle + rnd(-spread, spread), v = rnd(power * 0.4, power);
        parts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, w: rnd(6, 12), h: rnd(4, 8),
          rot: rnd(0, 6.28), vr: rnd(-0.3, 0.3), c: pick(i % 3 ? colors : gold), life: 0, max: rnd(170, 280), circle: Math.random() < 0.25 });
      }
    }
    function rain(n) {
      for (let i = 0; i < n; i++) {
        parts.push({ x: rnd(0, W), y: -10, vx: rnd(-1, 1), vy: rnd(1.5, 4), w: rnd(6, 11), h: rnd(4, 7),
          rot: rnd(0, 6.28), vr: rnd(-0.2, 0.2), c: pick(colors), life: 0, max: rnd(220, 340), circle: Math.random() < 0.25 });
      }
    }
    function explode(x, y) {
      const hue = pick(colors), n = 70 + ((Math.random() * 40) | 0), ring = Math.random() < 0.4;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * 6.283 + rnd(-0.05, 0.05), v = ring ? 5.2 : rnd(1.5, 6.5);
        sparks.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, c: Math.random() < 0.3 ? '#fff6c8' : hue, life: 0, max: rnd(45, 80) });
      }
    }
    function launch() {
      rockets.push({ x: rnd(W * 0.12, W * 0.88), y: H, vy: -rnd(9, 13), ty: rnd(H * 0.12, H * 0.45) });
    }
    const cannons = () => {
      confetti(0, H, 80, -Math.PI / 3, 0.5, 22);
      confetti(W, H, 80, -Math.PI * 2 / 3, 0.5, 22);
    };
    cannons();
    const timers = [setTimeout(cannons, 800), setTimeout(() => confetti(W / 2, H * 0.4, 140, 0, Math.PI, 15), 1500)];
    const iv = setInterval(() => { launch(); if (Math.random() < 0.5) launch(); }, 650);
    const iv2 = setInterval(cannons, 4500);
    launch();

    let raf = 0, stopped = false;
    function frame() {
      if (stopped) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      if (Math.random() < 0.7) rain(2);

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++; p.vy += 0.22; p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        if (p.life > p.max || p.y > H + 20) { parts.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, (p.max - p.life) / 40);
        ctx.fillStyle = p.c;
        if (p.circle) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.2, 0, 6.28); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        ctx.restore();
      }

      ctx.globalCompositeOperation = 'lighter';
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy; r.vy *= 0.985;
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.arc(r.x, r.y, 2.4, 0, 6.28); ctx.fill();
        if (r.y <= r.ty || r.vy > -2) { explode(r.x, r.y); rockets.splice(i, 1); }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life++; s.vy += 0.07; s.vx *= 0.975; s.vy *= 0.975; s.x += s.vx; s.y += s.vy;
        if (s.life > s.max) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, 1 - s.life / s.max);
        ctx.fillStyle = s.c;
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, 6.28); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout); clearInterval(iv); clearInterval(iv2);
      window.removeEventListener('resize', resize);
      cv.remove();
    };
  }

  // 全画面のお祝い（その日の最初の1回だけ）
  function showBirthdayBanner() {
    const names = birthdaysToday();
    if (!names.length) return;
    const today = dateKey(todayJST());
    try { if (localStorage.getItem(SHOWN_KEY) === today) return; } catch (e) { /* 無視 */ }
    try { localStorage.setItem(SHOWN_KEY, today); } catch (e) { /* 無視 */ }

    const ov = el('div', 'bday-overlay');
    ov.id = 'bdayOverlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', '誕生日のお祝い');

    ov.appendChild(el('div', 'bday-rays'));
    ov.appendChild(el('div', 'bday-glow'));

    // 風船と飾り
    const deco = ['🎈', '🎈', '🎈', '🎈', '🎁', '🎈', '🎉', '🎈', '🎊', '🎈', '✨', '🎈'];
    for (let i = 0; i < 20; i++) {
      const bl = el('span', 'bday-balloon', deco[i % deco.length]);
      bl.style.left = (2 + (i * 53) % 96) + '%';
      bl.style.animationDelay = (-(i * 1.1) % 11) + 's';
      bl.style.animationDuration = (7 + (i % 6)) + 's';
      bl.style.fontSize = (1.8 + (i % 4) * 0.7) + 'rem';
      ov.appendChild(bl);
    }
    // きらきら
    for (let i = 0; i < 26; i++) {
      const st = el('span', 'bday-star', i % 3 ? '✦' : '✧');
      st.style.left = ((i * 37) % 100) + '%';
      st.style.top = ((i * 61) % 100) + '%';
      st.style.animationDelay = (-(i * 0.37) % 3) + 's';
      st.style.fontSize = (0.7 + (i % 5) * 0.35) + 'rem';
      ov.appendChild(st);
    }

    const stage = el('div', 'bday-stage');
    stage.appendChild(el('div', 'bday-crown', '👑'));
    stage.appendChild(el('div', 'bday-eyebrow', '★ ☆ ★  TODAY IS  ★ ☆ ★'));
    const hb = el('div', 'bday-title');
    const line = (txt, cls) => {
      const row = el('div', 'bday-title-row ' + cls);
      txt.split('').forEach((ch, i) => {
        const sp = el('span', null, ch);
        sp.style.animationDelay = (i * 0.07) + 's';
        row.appendChild(sp);
      });
      hb.appendChild(row);
    };
    line('HAPPY', 'r1');
    line('BIRTHDAY!', 'r2');
    stage.appendChild(hb);

    const list = el('div', 'bday-list');
    names.forEach(n => {
      const item = el('button', 'bday-person-big');
      item.type = 'button';
      const src = charaThumb(n);
      const av = el('div', 'bday-avatar');
      av.appendChild(el('div', 'bday-avatar-ring'));
      if (src) { const img = el('img'); img.src = src; img.alt = ''; av.appendChild(img); }
      else av.appendChild(el('div', 'bday-avatar-fb', '🎂'));
      av.appendChild(el('span', 'bday-avatar-cake', '🎂'));
      item.appendChild(av);
      item.appendChild(el('div', 'bday-name', n));
      item.appendChild(el('div', 'bday-sub', 'お誕生日おめでとう！'));
      item.addEventListener('click', e => { e.stopPropagation(); close(); openChara(n); });
      list.appendChild(item);
    });
    stage.appendChild(list);
    stage.appendChild(el('div', 'bday-hint', 'タップして閉じる'));
    ov.appendChild(stage);

    const x = el('button', 'bday-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', '閉じる');
    ov.appendChild(x);
    document.body.appendChild(ov);

    const stopFx = startConfetti(ov);
    function close() {
      stopFx();
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 350);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', close);
  }

  /* =========================================================
   * 3) お気に入り
   * ========================================================= */
  let filterMode = 'all'; // all | fav
  let filterBar = null;

  function ensureActions(a) {
    if ($(':scope > .lf-actions', a)) return;
    const box = el('div', 'lf-actions');
    const b = el('i', 'lf-act lf-act-fav');
    b.setAttribute('role', 'button');
    b.setAttribute('tabindex', '0');
    b.setAttribute('aria-label', 'お気に入り');
    b.title = 'お気に入り';
    box.appendChild(b);
    a.appendChild(box);
  }

  function ensureYtBar(host, afterNode) {
    let bar = $(':scope > .lf-ytbar', host);
    if (bar) return bar;
    bar = el('div', 'lf-ytbar');
    const b = el('button', 'lf-chip');
    b.type = 'button';
    bar.appendChild(b);
    if (afterNode && afterNode.parentNode === host) afterNode.insertAdjacentElement('afterend', bar);
    else host.appendChild(bar);
    return bar;
  }

  function syncBar(bar, key) {
    setData(bar, 'lfKey', key);
    const fav = !!store.fav[key];
    const f = $('.lf-chip', bar);
    setText(f, fav ? '♥ お気に入り中' : '♡ お気に入り');
    setCls(f, 'on', fav);
  }

  function activePill(cat) {
    return $('.video-links button.active', cat) || $('.video-links button', cat);
  }

  function decorate() {
    // テキセ・部屋のカード
    [['text', 'tx'], ['cocoforia', 'rm']].forEach(([id, kind]) => {
      const root = document.getElementById(id);
      if (!root) return;
      $$('.image-link', root).forEach(a => {
        const title = id === 'cocoforia' ? (a.dataset.room || splitSpan($('span', a)).title) : splitSpan($('span', a)).title;
        const key = cardKey(kind, a, title);
        setData(a, 'lfKey', key);
        ensureActions(a);
        setCls(a, 'lf-fav', !!store.fav[key]);
      });
    });

    // YouTube：カテゴリ表示
    $$('#youtube .category').forEach(cat => {
      $$('.video-links button', cat).forEach(b => {
        const key = ytKey(b.textContent);
        setCls(b, 'lf-fav', !!store.fav[key]);
      });
      const pill = activePill(cat);
      if (!pill) return;
      const bar = ensureYtBar(cat, $('.carousel', cat));
      syncBar(bar, ytKey(pill.textContent));
    });

    // YouTube：最新順表示
    $$('#youtube .video-wrapper').forEach(w => {
      const t = w.children[1] && w.children[1].firstElementChild;
      const title = t ? t.textContent.trim() : '';
      if (!title) return;
      const key = ytKey(title);
      setData(w, 'lfKey', key);
      setCls(w, 'lf-fav', !!store.fav[key]);
      syncBar(ensureYtBar(w, null), key);
    });
  }

  /* ----- 絞り込み（すべて / お気に入り） ----- */
  const passes = key => filterMode === 'all' ? true : !!store.fav[key];

  function applyFilter() {
    const active = $('.tab-content.active');
    const activeId = active ? active.id : 'chara';

    // 前回の「該当なし」表示を消す
    $$('.lf-empty').forEach(n => n.remove());

    const visibleCount = { text: 0, cocoforia: 0, youtube: 0 };

    ['text', 'cocoforia'].forEach(id => {
      const root = document.getElementById(id);
      if (!root) return;
      $$('.image-link', root).forEach(a => {
        const ok = passes(a.dataset.lfKey);
        setCls(a, 'lf-hide', !ok);
        if (ok) visibleCount[id]++;
      });
      $$('.category-title', root).forEach(t => {
        const g = t.nextElementSibling;
        if (!g || !g.classList.contains('link-grid')) return;
        const any = $$('.image-link', g).some(a => !a.classList.contains('lf-hide'));
        setCls(t, 'lf-hide', !any);
        setCls(g, 'lf-hide', !any);
      });
    });

    const yt = document.getElementById('youtube');
    if (yt) {
      $$('.category', yt).forEach(cat => {
        let any = false;
        $$('.video-links button', cat).forEach(b => {
          const ok = passes(ytKey(b.textContent));
          setCls(b, 'lf-hide', !ok);
          if (ok) any = true;
        });
        setCls(cat, 'lf-hide', !any);
        if (any) visibleCount.youtube++;
      });
      $$('.video-wrapper', yt).forEach(w => {
        const ok = passes(w.dataset.lfKey);
        setCls(w, 'lf-hide', !ok);
        if (ok) visibleCount.youtube++;
      });
    }

    if (filterMode !== 'all' && visibleCount[activeId] === 0 && document.getElementById(activeId)) {
      const msg = el('div', 'lf-empty', 'お気に入りはまだありません。カードの ♡ を押すと追加できます。');
      document.getElementById(activeId).insertBefore(msg, document.getElementById(activeId).firstChild);
    }

    if (filterBar) {
      filterBar.style.display = (activeId === 'chara') ? 'none' : '';
    }
  }

  function updateFilterCounts() {
    if (!filterBar) return;
    const favN = Array.from(snap.keys).filter(k => store.fav[k]).length;
    setText($('[data-mode="fav"] .n', filterBar), String(favN));
    $$('button', filterBar).forEach(b => setCls(b, 'active', b.dataset.mode === filterMode));
  }

  function buildFilterBar() {
    const search = $('#searchBox');
    if (!search || !search.parentElement) return;
    filterBar = el('div', 'lf-filter');
    [['all', 'すべて'], ['fav', '♥ お気に入り']].forEach(([mode, label]) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.dataset.mode = mode;
      if (mode !== 'all') b.appendChild(el('span', 'n', '0'));
      b.addEventListener('click', () => { filterMode = mode; refresh(); });
      filterBar.appendChild(b);
    });
    search.parentElement.insertAdjacentElement('afterend', filterBar);
  }

  /* ----- クリック処理（DOMが作り直されても効くよう document で受ける） ----- */
  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const editing = document.body.classList.contains('edit-mode');

    const act = t.closest('.lf-act');
    if (act) {
      if (editing) return;
      e.preventDefault();
      e.stopPropagation();
      const card = act.closest('.image-link');
      if (card) { toggleFav(card.dataset.lfKey); refresh(); }
      return;
    }

    const chip = t.closest('.lf-chip');
    if (chip) {
      e.preventDefault();
      e.stopPropagation();
      const bar = chip.closest('.lf-ytbar');
      if (bar) { toggleFav(bar.dataset.lfKey); refresh(); }
      return;
    }

    if (editing) return;

    // YouTube：再生中の動画が変わるので、お気に入りバーの表示を合わせる
    if (t.closest('#youtube .video-links button, #youtube .video-toc a, #youtube .carousel-controls button')) {
      setTimeout(refresh, 0);
    }
  }

  /* ---------- 画面更新・監視 ---------- */
  const observers = [];
  let busy = false;
  function refresh() {
    busy = true;
    try {
      decorate();
      applyFilter();
      updateFilterCounts();
      const box = $('#charaAppearances');
      const detail = $('#charaDetail');
      if (box && lastChara && detail && detail.style.display !== 'none') renderAppearances(lastChara, true);
    } catch (e) {
      console.error(e);
    }
    observers.forEach(o => o.takeRecords()); // 自分の変更では再実行しない
    busy = false;
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; refresh(); });
  }

  /* ---------- スタイル ---------- */
  function injectStyle() {
    const css = `
/* ===== 出演した卓 ===== */
.appear{max-width:420px;margin:1.4rem auto 0;padding:0 1rem;text-align:left}
.appear-head{display:flex;align-items:center;gap:.5rem;font-weight:700;font-size:.95rem;border-left:4px solid var(--primary);padding:.35rem .55rem;cursor:pointer;list-style:none;user-select:none;border-radius:0 var(--radius-sm) var(--radius-sm) 0;transition:background-color .15s ease}
.appear-head::-webkit-details-marker{display:none}
.appear-head:hover{background:var(--primary-softer)}
.appear-arrow{margin-left:auto;color:var(--text-muted);transition:transform .2s ease}
.appear[open] .appear-arrow{transform:rotate(180deg)}
.appear-inner{padding-top:.2rem}
.appear-count{background:var(--primary-soft);color:var(--primary-dark);border-radius:999px;font-size:.72rem;padding:.05rem .6rem}
.appear-empty{font-size:.8rem;color:var(--text-muted);padding:.4rem .2rem}
.appear-group-title{font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.8rem 0 .3rem}
.appear-rows{display:flex;flex-direction:column;gap:.35rem}
.appear-item{display:flex;align-items:center;gap:.65rem;width:100%;box-sizing:border-box;padding:.4rem .6rem .4rem .45rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font-family:inherit;text-align:left;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
.appear-item[hidden]{display:none}
.appear-item:hover,.appear-item:focus-visible{transform:translateY(-1px);box-shadow:var(--shadow-sm);border-color:var(--primary);outline:none}
/* 探索者タブの外枠に .image-link が付いているため、カード用の img 指定を打ち消す */
#charaDetail .appear-thumb{flex:0 0 auto;width:38px;height:38px;aspect-ratio:auto;border-radius:8px;object-fit:cover;background:var(--surface-soft);border:1px solid var(--border);box-shadow:none;transform:none}
#charaDetail .appear-item:hover .appear-thumb{transform:none;box-shadow:none}
.appear-thumb-fb{display:flex;align-items:center;justify-content:center;font-size:1rem;color:var(--primary-dark)}
.appear-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:.1rem}
.appear-name{font-size:.85rem;font-weight:700;line-height:1.3;word-break:break-word}
.appear-meta{font-size:.7rem;color:var(--text-muted)}
.appear-marks{flex:0 0 auto;display:flex;gap:.25rem}
.appear-marks b{font-size:.78rem;font-weight:700}
.appear-marks .m-fav{color:var(--primary)}
.appear-more{display:block;margin:.4rem auto 0;border:1px solid var(--border);background:var(--surface);color:var(--primary-dark);border-radius:999px;padding:.3rem .9rem;font-size:.75rem;font-weight:700;font-family:inherit;cursor:pointer}
.appear-more:hover{background:var(--primary);color:#fff;border-color:var(--primary)}

/* ===== 今日の誕生日（全画面） ===== */
.bday-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box;overflow:hidden;cursor:pointer;background:radial-gradient(ellipse at 50% 38%,#7a1f6b 0%,#3a0f4f 45%,#14082b 100%);animation:bdayFadeIn .5s ease both}
.bday-overlay.out{animation:bdayFadeOut .35s ease both}
.bday-rays{position:absolute;left:50%;top:38%;width:230vmax;height:230vmax;margin:-115vmax 0 0 -115vmax;pointer-events:none;background:repeating-conic-gradient(from 0deg,rgba(255,214,102,.28) 0deg 7deg,transparent 7deg 18deg);-webkit-mask-image:radial-gradient(circle,#000 0,transparent 50%);mask-image:radial-gradient(circle,#000 0,transparent 50%);animation:bdaySpin 40s linear infinite}
.bday-glow{position:absolute;left:50%;top:38%;width:70vmin;height:70vmin;margin:-35vmin 0 0 -35vmin;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(255,226,140,.5),rgba(255,160,60,.18) 45%,transparent 70%);animation:bdayPulse 2.4s ease-in-out infinite}
.bday-confetti{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3}
.bday-balloon{position:absolute;bottom:-5rem;z-index:1;pointer-events:none;animation:bdayFloat 9s linear infinite;filter:drop-shadow(0 6px 8px rgba(0,0,0,.35))}
.bday-star{position:absolute;z-index:1;pointer-events:none;color:#ffe9a8;text-shadow:0 0 8px #ffd60a,0 0 16px #ffb703;animation:bdayTwinkle 1.6s ease-in-out infinite}
.bday-stage{position:relative;z-index:4;width:100%;max-width:520px;text-align:center;animation:bdayPop .9s cubic-bezier(.2,1.4,.4,1) both}
.bday-crown{font-size:3.6rem;line-height:1;filter:drop-shadow(0 0 14px rgba(255,214,102,.95));animation:bdayBounce 1.1s ease-in-out infinite}
.bday-eyebrow{margin:.3rem 0 .2rem;font-size:.82rem;font-weight:900;letter-spacing:.3em;color:#ffe9a8;text-shadow:0 0 10px rgba(255,214,102,.9)}
.bday-title{font-weight:900;line-height:1.05;margin:.1rem 0 .6rem}
.bday-title-row{white-space:nowrap}
.bday-title-row span{display:inline-block;color:transparent;background:linear-gradient(180deg,#fffbe0 0%,#ffe066 35%,#ffb703 60%,#c77700 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:1px rgba(120,60,0,.45);filter:drop-shadow(0 0 10px rgba(255,200,60,.85)) drop-shadow(0 3px 0 rgba(90,40,0,.55));animation:bdayWave 1.5s ease-in-out infinite}
.bday-title-row.r1{font-size:clamp(2.4rem,13vw,4.4rem);letter-spacing:.08em}
.bday-title-row.r2{font-size:clamp(2.1rem,11.5vw,3.9rem);letter-spacing:.02em}
.bday-title-row span:nth-child(odd){background-image:linear-gradient(180deg,#fff,#ffd6e8 35%,#ff6fa5 65%,#c2185b 100%)}
.bday-list{display:flex;flex-wrap:wrap;justify-content:center;gap:1.4rem;margin:1.1rem 0 .8rem}
.bday-person-big{display:flex;flex-direction:column;align-items:center;gap:.3rem;border:0;background:transparent;font-family:inherit;color:#fff;cursor:pointer;max-width:100%;padding:.2rem}
.bday-avatar{position:relative;width:clamp(130px,38vw,180px);aspect-ratio:1/1}
.bday-avatar-ring{position:absolute;inset:-9px;border-radius:50%;background:conic-gradient(#ff4d6d,#ffd60a,#06d6a0,#4cc9f0,#9b5de5,#ff4d6d);animation:bdaySpin 3s linear infinite;box-shadow:0 0 30px rgba(255,214,102,.95),0 0 70px rgba(255,120,160,.6)}
.bday-avatar img,.bday-avatar-fb{position:relative;display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:center top;background:#fff;border:5px solid #fff;box-sizing:border-box}
.bday-avatar-fb{display:flex;align-items:center;justify-content:center;font-size:4rem}
.bday-avatar-cake{position:absolute;right:-12px;bottom:-8px;font-size:2.4rem;filter:drop-shadow(0 3px 5px rgba(0,0,0,.4));animation:bdayBounce 1s ease-in-out infinite}
.bday-name{margin-top:.7rem;font-size:1.7rem;font-weight:900;max-width:300px;word-break:break-word;text-shadow:0 0 14px rgba(255,214,102,.95),0 2px 0 rgba(0,0,0,.4)}
.bday-sub{font-size:1rem;font-weight:800;color:#ffd6e8;letter-spacing:.1em;text-shadow:0 0 10px rgba(255,100,160,.8)}
.bday-person-big:hover .bday-name{text-decoration:underline}
.bday-hint{margin-top:.8rem;font-size:.75rem;color:rgba(255,255,255,.6);letter-spacing:.15em}
.bday-x{position:absolute;top:.6rem;right:.8rem;z-index:5;width:2.4rem;height:2.4rem;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:1.5rem;line-height:1;cursor:pointer;backdrop-filter:blur(4px)}
.bday-x:hover{background:rgba(255,255,255,.32)}
@keyframes bdayBounce{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-8px) rotate(6deg)}}
@keyframes bdayTwinkle{0%,100%{opacity:1;transform:scale(1) rotate(0)}50%{opacity:.25;transform:scale(1.5) rotate(25deg)}}
@keyframes bdayFadeIn{from{opacity:0}to{opacity:1}}
@keyframes bdayFadeOut{from{opacity:1}to{opacity:0}}
@keyframes bdayFloat{0%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-60vh) rotate(8deg)}100%{transform:translateY(-130vh) rotate(-8deg)}}
@keyframes bdayPop{0%{transform:scale(.2) rotate(-8deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}
@keyframes bdayWave{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes bdaySpin{to{transform:rotate(360deg)}}
@keyframes bdayPulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.1);opacity:1}}

/* ===== お気に入り ===== */
#text .image-link,#cocoforia .image-link{position:relative}
.lf-actions{position:absolute;top:5px;right:5px;display:flex;gap:4px;z-index:3}
.lf-act{width:26px;height:26px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--border);background:rgba(255,255,255,.93);box-shadow:var(--shadow-sm);color:#b9a9ae;font-style:normal;font-size:14px;line-height:1;cursor:pointer;transition:transform .15s ease,background-color .15s ease,color .15s ease}
.lf-act-fav::before{content:'♡'}
.lf-act:hover,.lf-act:focus-visible{transform:scale(1.12);outline:none}
.lf-fav .lf-act-fav{background:var(--primary);border-color:var(--primary);color:#fff}
.lf-fav .lf-act-fav::before{content:'♥'}

.video-links button.lf-fav::before{content:'♥ ';color:var(--primary)}
.video-links button.lf-fav.active::before,.video-links button.lf-fav:hover::before{color:#fff}
#youtube .category{scroll-margin-top:90px}

.lf-ytbar{display:flex;justify-content:flex-end;align-items:center;gap:.4rem;margin-top:.6rem}
.lf-chip{border:1px solid var(--border);background:var(--surface);color:var(--text-muted);border-radius:999px;padding:.25rem .8rem;font-size:.75rem;font-weight:700;font-family:inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
.lf-chip:hover{border-color:var(--primary);color:var(--primary-dark)}
.lf-chip.on{background:var(--primary);border-color:var(--primary);color:#fff}

.lf-filter{display:flex;justify-content:center;flex-wrap:wrap;gap:.4rem;max-width:400px;margin:-6px auto 16px}
.lf-filter button{border:1px solid var(--border);background:var(--surface);color:var(--text-muted);border-radius:999px;padding:.3rem .85rem;font-size:.78rem;font-weight:700;font-family:inherit;cursor:pointer;transition:background-color .15s ease,color .15s ease,border-color .15s ease}
.lf-filter button .n{margin-left:.35rem;font-size:.68rem;opacity:.75}
.lf-filter button:hover{border-color:var(--primary);color:var(--primary-dark)}
.lf-filter button.active{background:var(--primary);border-color:var(--primary);color:#fff}
.lf-hide{display:none !important}
.lf-empty{text-align:center;color:var(--text-muted);font-size:.85rem;padding:1.5rem 1rem}

/* 編集モード中は、カードを押すと編集フォームが開くので、しるしのボタンは隠す */
body.edit-mode .lf-actions,body.edit-mode .lf-ytbar{display:none}

@media (prefers-reduced-motion: reduce){
  .bday-overlay,.bday-overlay *{animation:none !important}
  .bday-balloon,.bday-rays{display:none}
}
`;
    const s = document.createElement('style');
    s.id = 'extras-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- 起動 ---------- */
  function start() {
    injectStyle();
    takeSnapshot();           // 並べ替えで中身が作り直される前の内容を控える
    hookCharaDetail();
    buildFilterBar();
    showBirthdayBanner();

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('lf-act')) {
        e.preventDefault();
        e.target.click();
      }
    });
    // タブを切り替えたら絞り込みバーの表示を合わせる
    $$('.tab-button').forEach(b => b.addEventListener('click', () => setTimeout(refresh, 0)));
    // 別のタブ（ブラウザ）で変更されたときも反映
    window.addEventListener('storage', e => { if (e.key === STORE_KEY) { loadStore(); refresh(); } });

    ['text', 'youtube', 'cocoforia'].forEach(id => {
      const root = document.getElementById(id);
      if (!root) return;
      const mo = new MutationObserver(() => { if (!busy) schedule(); });
      mo.observe(root, { childList: true, subtree: true });
      observers.push(mo);
    });

    refresh();
  }

  // 本体スクリプトの DOMContentLoaded 処理（元のHTMLの控え取りなど）が終わってから動かす
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
