// ============================================================
// パッド設定
// ============================================================
const PAD_KEYS = ['1','2','3','4','q','w','e','r','a','s','d','f','z','x','c','v'];
const PAD_LABELS = ['1','2','3','4','Q','W','E','R','A','S','D','F','Z','X','C','V'];
const padAudios = new Array(16).fill(null);

// ============================================================
// IndexedDB（エディター保存済みボイス読み込み用）
// ============================================================
const DB_NAME = 'hinanoEditorDB';
const DB_STORE = 'editedVoices';
let sbDb = null;

function openSbDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'name' });
    req.onsuccess = () => { sbDb = req.result; resolve(sbDb); };
    req.onerror = () => reject(req.error);
  });
}
function getAllEditedVoices() {
  return new Promise((resolve, reject) => {
    const tx = sbDb.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function getEditedVoice(name) {
  return new Promise((resolve, reject) => {
    const tx = sbDb.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// お気に入り管理
// ============================================================
function getFavs() {
  try { return JSON.parse(localStorage.getItem('favVoices') || '[]'); } catch { return []; }
}
function setFavs(f) { localStorage.setItem('favVoices', JSON.stringify(f)); }
function toggleFav(id) {
  const f = getFavs(); const i = f.indexOf(id);
  if (i === -1) f.push(id); else f.splice(i, 1);
  setFavs(f); return i === -1;
}
function isFav(id) { return getFavs().includes(id); }

// ============================================================
// パッド配置管理
// ============================================================
function getPadMap() {
  try { return JSON.parse(localStorage.getItem('padMap') || '{}'); } catch { return {}; }
}
function savePadMap(m) { localStorage.setItem('padMap', JSON.stringify(m)); }
function assignPad(i, id, label, type) {
  const m = getPadMap();
  m[i] = { id, label, type: type || 'original' };
  savePadMap(m);
}
function unassignPad(i) { const m = getPadMap(); delete m[i]; savePadMap(m); }

// ============================================================
// お気に入りボイス取得
// ============================================================
function getFavVoices() {
  const ids = getFavs();
  const r = [];
  voiceData.forEach(m => m.voices.forEach(v => {
    if (ids.includes(v.id)) r.push({ id: v.id, label: v.label, movie: m.movie, type: 'original' });
  }));
  return r;
}

// ============================================================
// お気に入りリスト描画
// ============================================================
function renderFavList() {
  const list = document.getElementById('favList');
  const empty = document.getElementById('favEmpty');
  list.innerHTML = '';
  const favs = getFavVoices();

  if (!favs.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  favs.forEach(v => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    item.draggable = true;
    item.dataset.voiceId = v.id;
    item.dataset.voiceLabel = v.label;
    item.dataset.voiceType = 'original';

    item.innerHTML = `
      <div class="fav-item-content">
        <span class="fav-item-label">${v.label}</span>
        <span class="fav-item-movie">${v.movie}</span>
      </div>
      <button class="fav-heart is-fav" data-id="${v.id}" title="お気に入り解除">
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>`;

    // ハートつけ外し
    item.querySelector('.fav-heart').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFav(v.id);
      renderFavList();
    });

    // ドラッグ
    setupDrag(item, v.id, v.label, 'original');
    list.appendChild(item);
  });
}

// ============================================================
// 編集済みボイスリスト描画
// ============================================================
async function renderEditedList() {
  const list = document.getElementById('editedList');
  const empty = document.getElementById('editedEmpty');
  if (!list) return;
  list.innerHTML = '';

  const items = await getAllEditedVoices();
  if (!items.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'fav-item edited-item';
    el.draggable = true;
    el.dataset.voiceId = item.name;
    el.dataset.voiceLabel = item.name;
    el.dataset.voiceType = 'edited';

    el.innerHTML = `
      <div class="fav-item-content">
        <span class="fav-item-label">${item.name}</span>
        <span class="fav-item-movie">編集済み: ${item.settings.sourceLabel || ''}</span>
      </div>`;

    setupDrag(el, item.name, item.name, 'edited');
    list.appendChild(el);
  });
}

// ============================================================
// ドラッグ共通セットアップ
// ============================================================
function setupDrag(item, voiceId, voiceLabel, type) {
  // PC
  item.addEventListener('dragstart', e => {
    e.dataTransfer.setData('voiceId', voiceId);
    e.dataTransfer.setData('voiceLabel', voiceLabel);
    e.dataTransfer.setData('voiceType', type);
    e.dataTransfer.effectAllowed = 'copy';
    item.classList.add('is-dragging');
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('is-dragging');
    document.querySelectorAll('.pad').forEach(p => p.classList.remove('pad-drop-target'));
  });

  // モバイル
  let touchTimer = null, touchDragging = false, ghostEl = null;
  item.addEventListener('touchstart', e => {
    touchTimer = setTimeout(() => {
      touchDragging = true; item.classList.add('is-dragging');
      ghostEl = document.createElement('div');
      ghostEl.className = 'drag-ghost'; ghostEl.textContent = voiceLabel;
      document.body.appendChild(ghostEl);
      const t = e.touches[0];
      ghostEl.style.left = t.clientX + 'px'; ghostEl.style.top = t.clientY + 'px';
    }, 300);
  }, { passive: true });
  item.addEventListener('touchmove', e => {
    if (!touchDragging) { clearTimeout(touchTimer); return; }
    e.preventDefault();
    const t = e.touches[0];
    if (ghostEl) { ghostEl.style.left = t.clientX + 'px'; ghostEl.style.top = t.clientY + 'px'; }
    document.querySelectorAll('.pad').forEach(p => {
      const r = p.getBoundingClientRect();
      p.classList.toggle('pad-drop-target', t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom);
    });
  }, { passive: false });
  item.addEventListener('touchend', e => {
    clearTimeout(touchTimer);
    if (touchDragging) {
      const t = e.changedTouches[0];
      document.querySelectorAll('.pad').forEach(p => {
        const r = p.getBoundingClientRect();
        if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) {
          assignPad(parseInt(p.dataset.index), voiceId, voiceLabel, type);
          renderPads();
        }
        p.classList.remove('pad-drop-target');
      });
      item.classList.remove('is-dragging');
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      touchDragging = false;
    }
  });
}

// ============================================================
// パッド描画
// ============================================================
async function renderPads() {
  const grid = document.getElementById('padGrid'); grid.innerHTML = '';
  const map = getPadMap();

  for (let i = 0; i < 16; i++) {
    const pad = document.createElement('div');
    const a = map[i];
    pad.className = `pad${a ? ' pad-assigned' : ''}`;
    pad.dataset.index = i;
    pad.innerHTML = `<span class="pad-key">${PAD_LABELS[i]}</span><span class="pad-label">${a ? a.label : ''}</span>${a ? '<button class="pad-remove" title="解除">✕</button>' : ''}`;

    // Audio準備
    if (a) {
      if (a.type === 'edited') {
        try {
          const edited = await getEditedVoice(a.id);
          if (edited && edited.wav) {
            const url = URL.createObjectURL(edited.wav);
            padAudios[i] = new Audio(url);
          } else { padAudios[i] = null; }
        } catch { padAudios[i] = null; }
      } else {
        padAudios[i] = new Audio(`./voice/${a.id}.mp3`);
      }
    } else { padAudios[i] = null; }

    // ドロップ受付
    pad.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; pad.classList.add('pad-drop-target'); });
    pad.addEventListener('dragleave', () => pad.classList.remove('pad-drop-target'));
    pad.addEventListener('drop', e => {
      e.preventDefault(); pad.classList.remove('pad-drop-target');
      const id = e.dataTransfer.getData('voiceId');
      const label = e.dataTransfer.getData('voiceLabel');
      const type = e.dataTransfer.getData('voiceType') || 'original';
      if (id) { assignPad(i, id, label, type); renderPads(); }
    });

    // クリック
    pad.addEventListener('click', e => {
      if (e.target.classList.contains('pad-remove')) { unassignPad(i); renderPads(); return; }
      if (a) triggerPad(i);
    });
    grid.appendChild(pad);
  }
}

// ============================================================
// 再生
// ============================================================
function triggerPad(index) {
  const audio = padAudios[index];
  if (!audio) return;
  const s = document.getElementById('volumeSlider');
  audio.volume = s ? s.value / 100 : 0.8;
  audio.currentTime = 0;
  audio.play().catch(() => {});
  const pads = document.querySelectorAll('.pad');
  const pad = pads[index];
  if (pad) { pad.classList.add('pad-active'); setTimeout(() => pad.classList.remove('pad-active'), 200); }
}

// キーボード
document.addEventListener('keydown', e => {
  if (document.activeElement.tagName === 'INPUT') return;
  const i = PAD_KEYS.indexOf(e.key.toLowerCase());
  if (i !== -1) { e.preventDefault(); triggerPad(i); }
});

// 検索
document.getElementById('favSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.fav-item').forEach(item => {
    item.style.display = (!q || item.dataset.voiceLabel.toLowerCase().includes(q)) ? '' : 'none';
  });
});

// ============================================================
// 音量コントロール
// ============================================================
const volumeSlider = document.getElementById('volumeSlider');
const volumeIcon = document.getElementById('volumeIcon');
volumeSlider.addEventListener('input', () => updateVolumeIcon());
function updateVolumeIcon() {
  const v = volumeSlider.value; let p = '';
  if (v == 0) p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  else if (v < 50) p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
  else p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  volumeIcon.innerHTML = p;
}
volumeIcon.addEventListener('click', () => {
  if (volumeSlider.value > 0) { volumeSlider.dataset.prev = volumeSlider.value; volumeSlider.value = 0; }
  else { volumeSlider.value = volumeSlider.dataset.prev || 80; }
  updateVolumeIcon();
});

// ============================================================
// 初期化
// ============================================================
async function initSoundboard() {
  await openSbDB();
  renderFavList();
  await renderEditedList();
  await renderPads();
}
initSoundboard();
