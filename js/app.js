// ============================================================
// プレイヤー
// ============================================================
const player = new Audio();
let currentBtn = null;
player.volume = 0.8;

player.addEventListener('ended', () => {
  if (currentBtn) currentBtn.classList.remove('is-playing');
  currentBtn = null;
});

function playVoice(voiceId, btnEl) {
  if (currentBtn) currentBtn.classList.remove('is-playing');
  player.pause();
  player.src = `./voice/${voiceId}.mp3`;
  player.play().catch(() => {});
  currentBtn = btnEl;
  btnEl.classList.add('is-playing');

  const popup = document.getElementById('linkPopup');
  const popupUrl = document.getElementById('linkPopupUrl');
  const link = `${location.origin}${location.pathname}#${voiceId}`;
  popupUrl.textContent = 'リンクをコピー';
  popupUrl.onclick = () => {
    navigator.clipboard.writeText(link).then(() => {
      popupUrl.textContent = 'コピーしました！';
      setTimeout(() => { popupUrl.textContent = 'リンクをコピー'; }, 1500);
    });
  };
  popup.classList.add('is-visible');
}

// ============================================================
// 音量コントロール
// ============================================================
const volumeSlider = document.getElementById('volumeSlider');
const volumeIcon = document.getElementById('volumeIcon');

volumeSlider.addEventListener('input', () => {
  player.volume = volumeSlider.value / 100;
  updateVolumeIcon();
});

function updateVolumeIcon() {
  const v = volumeSlider.value;
  let p = '';
  if (v == 0) {
    p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  } else if (v < 50) {
    p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
  } else {
    p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  }
  volumeIcon.innerHTML = p;
}

volumeIcon.addEventListener('click', () => {
  if (volumeSlider.value > 0) {
    volumeSlider.dataset.prev = volumeSlider.value;
    volumeSlider.value = 0;
  } else {
    volumeSlider.value = volumeSlider.dataset.prev || 80;
  }
  player.volume = volumeSlider.value / 100;
  updateVolumeIcon();
});

// ============================================================
// ボタン生成ヘルパー
// ============================================================
function createVoiceBtn(v) {
  const btn = document.createElement('button');
  btn.className = 'voice-btn';
  btn.dataset.voice = v.id;
  btn.dataset.label = v.label;
  btn.dataset.tags = (v.tags || []).join(',');

  const s = document.createElement('span');
  s.textContent = v.label;
  btn.appendChild(s);

  const fav = document.createElement('button');
  const favActive = isFav(v.id);
  fav.className = `fav-toggle${favActive ? ' is-fav' : ''}`;
  fav.innerHTML = `<svg viewBox="0 0 24 24" fill="${favActive ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  fav.addEventListener('click', (e) => {
    e.stopPropagation();
    const now = toggleFav(v.id);
    fav.classList.toggle('is-fav', now);
    fav.querySelector('svg').setAttribute('fill', now ? 'currentColor' : 'none');
    // お気に入りフィルター中なら再描画
    if (currentTag === 'fav') renderCurrentView();
  });
  btn.appendChild(fav);

  btn.addEventListener('click', () => playVoice(v.id, btn));
  return btn;
}

// ============================================================
// グループ表示（通常・カテゴリフィルター）
// ============================================================
function renderGrouped(data, query, tagFilter) {
  const container = document.getElementById('voiceContainer');
  container.innerHTML = '';

  let cardIndex = 0;
  let hasAny = false;

  data.forEach(movie => {
    const visibleVoices = movie.voices.filter(v => {
      const matchSearch = !query || v.label.toLowerCase().includes(query);
      const matchTag = tagFilter === 'all' || (v.tags || []).includes(tagFilter);
      return matchSearch && matchTag;
    });

    if (!visibleVoices.length) return;
    hasAny = true;

    const card = document.createElement('div');
    card.className = 'movie-card';
    card.style.animationDelay = `${cardIndex * 0.04}s`;
    card.dataset.date = movie.date;
    card.innerHTML = `<div class="movie-card-header"><div class="movie-card-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></div><h2 class="movie-card-title"><a href="${movie.url}" target="_blank">${movie.movie}</a></h2><span class="movie-card-date">${movie.date}</span></div>`;

    const grid = document.createElement('div');
    grid.className = 'button-grid';

    visibleVoices.forEach(v => {
      grid.appendChild(createVoiceBtn(v));
    });

    card.appendChild(grid);
    container.appendChild(card);
    cardIndex++;
  });

  if (!hasAny) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔇</div><div>見つからなかった…</div></div>';
  }
}

// ============================================================
// フラット表示（お気に入り専用）
// ============================================================
function renderFavFlat(data, query) {
  const container = document.getElementById('voiceContainer');
  container.innerHTML = '';

  const favIds = getFavs();
  if (!favIds.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💝</div><div>お気に入りがまだないよ！<br>ハートを押して追加してね</div></div>';
    return;
  }

  const favVoices = [];
  data.forEach(movie => {
    movie.voices.forEach(v => {
      if (favIds.includes(v.id)) {
        const matchSearch = !query || v.label.toLowerCase().includes(query);
        if (matchSearch) favVoices.push(v);
      }
    });
  });

  if (!favVoices.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔇</div><div>見つからなかった…</div></div>';
    return;
  }

  const card = document.createElement('div');
  card.className = 'movie-card';
  card.style.animationDelay = '0s';

  const header = document.createElement('div');
  header.className = 'movie-card-header';
  header.innerHTML = `<div class="movie-card-icon" style="background:linear-gradient(135deg,#e53e3e,#f472b6)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div><h2 class="movie-card-title"><span>お気に入り（${favVoices.length}件）</span></h2>`;

  const grid = document.createElement('div');
  grid.className = 'button-grid';

  favVoices.forEach(v => {
    grid.appendChild(createVoiceBtn(v));
  });

  card.appendChild(header);
  card.appendChild(grid);
  container.appendChild(card);
}

// ============================================================
// 表示切替の統合関数
// ============================================================
let currentTag = 'all';
let sortDesc = true;

function renderCurrentView() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();

  const sorted = [...voiceData].sort((a, b) => {
    return sortDesc
      ? (b.date || '').localeCompare(a.date || '')
      : (a.date || '').localeCompare(b.date || '');
  });

  if (currentTag === 'fav') {
    renderFavFlat(sorted, query);
  } else {
    renderGrouped(sorted, query, currentTag);
  }
}

// ============================================================
// イベントリスナー
// ============================================================
document.getElementById('searchInput').addEventListener('input', renderCurrentView);

document.getElementById('filterRow').addEventListener('click', e => {
  const c = e.target.closest('.filter-chip');
  if (!c) return;
  document.querySelectorAll('.filter-chip').forEach(x => x.classList.remove('is-active'));
  c.classList.add('is-active');
  currentTag = c.dataset.tag;
  renderCurrentView();
});

document.getElementById('sortBtn').addEventListener('click', () => {
  sortDesc = !sortDesc;
  document.getElementById('sortBtn').classList.toggle('desc', sortDesc);
  renderCurrentView();
});

document.getElementById('linkPopupClose').addEventListener('click', () => {
  document.getElementById('linkPopup').classList.remove('is-visible');
});

// ============================================================
// 初期化
// ============================================================
renderCurrentView();
