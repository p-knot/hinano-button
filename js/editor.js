// ============================================================
// IndexedDB
// ============================================================
const DB_NAME = 'hinanoEditorDB';
const DB_STORE = 'editedVoices';
let db = null;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE, { keyPath: 'name' });
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
function saveEditedVoice(name, wav, s) {
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({ name, wav, settings: s, date: Date.now() });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function getAllEditedVoices() {
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const r = tx.objectStore(DB_STORE).getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
function deleteEditedVoice(name) {
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(name);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// ============================================================
// AudioContext & 状態
// ============================================================
let audioCtx = null;
let originalBuffer = null;
let renderedBuffer = null;
let sourceNode = null;
let isPlaying = false;
let playStartTime = 0;
let animFrameId = null;
let currentVoiceId = null;
let currentVoiceLabel = null;

// トリムドラッグ状態
let draggingHandle = null; // 'start' | 'end' | null

const defaultSettings = {
  trimStart: 0, trimEnd: 1,
  volume: 1.0, playbackRate: 1.0, reverse: false,
  reverb: false, reverbAmount: 0.5,
  delay: false, delayTime: 0.3, delayFeedback: 0.4,
  distortion: false, distortionAmount: 50,
  filterType: 'off', filterFreq: 1000,
};
let settings = { ...defaultSettings };

// ============================================================
// 音声読み込み
// ============================================================
async function loadVoice(voiceId, voiceLabel) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  stopPreview();
  currentVoiceId = voiceId;
  currentVoiceLabel = voiceLabel;
  settings = { ...defaultSettings };
  renderedBuffer = null;
  updateAllSliders();

  const status = document.getElementById('editorStatus');
  status.textContent = '読み込み中...';
  try {
    const res = await fetch(`./voice/${voiceId}.mp3`);
    const buf = await res.arrayBuffer();
    originalBuffer = await audioCtx.decodeAudioData(buf);
    status.textContent = `${voiceLabel} を読み込みました`;
    document.getElementById('editorTitle').textContent = voiceLabel;
    drawWaveform();
    enableControls(true);
  } catch (e) {
    status.textContent = '読み込みに失敗しました';
    console.error(e);
  }
}

// ============================================================
// トリム済みバッファ（逆再生対応修正）
// ============================================================
function getTrimmedBuffer() {
  if (!originalBuffer) return null;
  const s = Math.floor(settings.trimStart * originalBuffer.length);
  const e = Math.floor(settings.trimEnd * originalBuffer.length);
  const len = e - s;
  if (len <= 0) return null;

  const buf = audioCtx.createBuffer(originalBuffer.numberOfChannels, len, originalBuffer.sampleRate);
  for (let ch = 0; ch < originalBuffer.numberOfChannels; ch++) {
    const src = originalBuffer.getChannelData(ch);
    const dst = buf.getChannelData(ch);
    if (settings.reverse) {
      for (let i = 0; i < len; i++) dst[i] = src[e - 1 - i];
    } else {
      // copyToChannel or manual copy
      for (let i = 0; i < len; i++) dst[i] = src[s + i];
    }
  }
  return buf;
}

// ============================================================
// 波形描画
// ============================================================
function drawWaveform(playheadPos) {
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  if (!originalBuffer) return;

  const useRendered = !!renderedBuffer;
  const data = useRendered ? renderedBuffer.getChannelData(0) : originalBuffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const mid = h / 2;

  const trimL = useRendered ? 0 : settings.trimStart * w;
  const trimR = useRendered ? w : settings.trimEnd * w;

  // 背景
  if (!useRendered) {
    ctx.fillStyle = 'rgba(92,58,46,0.1)';
    ctx.fillRect(0, 0, trimL, h);
    ctx.fillRect(trimR, 0, w - trimR, h);
  }
  ctx.fillStyle = 'rgba(244,114,182,0.06)';
  ctx.fillRect(trimL, 0, trimR - trimL, h);

  // 波形
  for (let i = 0; i < w; i++) {
    let min = 1, max = -1;
    const ss = Math.floor(i * data.length / w);
    const se = Math.min(ss + step, data.length);
    for (let j = ss; j < se; j++) {
      if (data[j] < min) min = data[j];
      if (data[j] > max) max = data[j];
    }
    if (!useRendered && i >= trimL && i <= trimR) {
      min = Math.max(-1, Math.min(1, min * settings.volume));
      max = Math.max(-1, Math.min(1, max * settings.volume));
    }
    ctx.strokeStyle = (!useRendered && (i < trimL || i > trimR)) ? 'rgba(180,154,142,0.35)' : '#f472b6';
    ctx.beginPath();
    ctx.moveTo(i, mid + min * mid);
    ctx.lineTo(i, mid + max * mid);
    ctx.stroke();
  }

  // トリムハンドル
  if (!useRendered) {
    // ライン
    ctx.fillStyle = '#db2777';
    ctx.fillRect(trimL - 1.5, 0, 3, h);
    ctx.fillRect(trimR - 1.5, 0, 3, h);

    // つまみ（上下に三角）
    drawHandle(ctx, trimL, h, '#db2777');
    drawHandle(ctx, trimR, h, '#db2777');
  }

  // 再生ヘッド
  if (typeof playheadPos === 'number' && playheadPos >= 0) {
    const px = useRendered ? playheadPos * w : trimL + playheadPos * (trimR - trimL);
    ctx.strokeStyle = '#e53e3e';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.fillStyle = '#e53e3e';
    ctx.beginPath(); ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px - 5, h); ctx.lineTo(px + 5, h); ctx.lineTo(px, h - 7); ctx.closePath(); ctx.fill();
  }
}

function drawHandle(ctx, x, h, color) {
  ctx.fillStyle = color;
  // 上の三角
  ctx.beginPath(); ctx.moveTo(x - 6, 0); ctx.lineTo(x + 6, 0); ctx.lineTo(x, 10); ctx.closePath(); ctx.fill();
  // 下の三角
  ctx.beginPath(); ctx.moveTo(x - 6, h); ctx.lineTo(x + 6, h); ctx.lineTo(x, h - 10); ctx.closePath(); ctx.fill();
}

// ============================================================
// 波形ドラッグでトリム
// ============================================================
function setupWaveformDrag() {
  const canvas = document.getElementById('waveformCanvas');

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    return x / rect.width;
  }

  function hitTest(pos) {
    const threshold = 0.02;
    if (Math.abs(pos - settings.trimStart) < threshold) return 'start';
    if (Math.abs(pos - settings.trimEnd) < threshold) return 'end';
    return null;
  }

  // マウス
  canvas.addEventListener('mousedown', e => {
    if (!originalBuffer || renderedBuffer) return;
    const pos = getPos(e);
    draggingHandle = hitTest(pos);
    if (draggingHandle) { e.preventDefault(); canvas.style.cursor = 'ew-resize'; }
  });
  window.addEventListener('mousemove', e => {
    if (!draggingHandle) return;
    e.preventDefault();
    const pos = Math.max(0, Math.min(1, getPos(e)));
    applyDrag(pos);
  });
  window.addEventListener('mouseup', () => {
    if (draggingHandle) { draggingHandle = null; document.getElementById('waveformCanvas').style.cursor = ''; }
  });

  // ホバーでカーソル変更
  canvas.addEventListener('mousemove', e => {
    if (draggingHandle || !originalBuffer || renderedBuffer) return;
    const pos = getPos(e);
    canvas.style.cursor = hitTest(pos) ? 'ew-resize' : '';
  });

  // タッチ
  canvas.addEventListener('touchstart', e => {
    if (!originalBuffer || renderedBuffer) return;
    const pos = getPos(e);
    draggingHandle = hitTest(pos);
    if (draggingHandle) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (!draggingHandle) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const pos = Math.max(0, Math.min(1, x / rect.width));
    applyDrag(pos);
  }, { passive: false });
  canvas.addEventListener('touchend', () => { draggingHandle = null; });
}

function applyDrag(pos) {
  if (draggingHandle === 'start') {
    settings.trimStart = Math.min(pos, settings.trimEnd - 0.01);
    settings.trimStart = Math.max(0, settings.trimStart);
  } else if (draggingHandle === 'end') {
    settings.trimEnd = Math.max(pos, settings.trimStart + 0.01);
    settings.trimEnd = Math.min(1, settings.trimEnd);
  }
  renderedBuffer = null;
  updateTrimDisplay();
  drawWaveform();
}

function updateTrimDisplay() {
  document.getElementById('trimStart').value = settings.trimStart * 100;
  document.getElementById('trimEnd').value = settings.trimEnd * 100;
  document.getElementById('trimStartVal').textContent = Math.round(settings.trimStart * 100) + '%';
  document.getElementById('trimEndVal').textContent = Math.round(settings.trimEnd * 100) + '%';
}

// ============================================================
// 再生ヘッドアニメーション
// ============================================================
function startPlayheadAnimation(duration) {
  cancelAnimationFrame(animFrameId);
  function tick() {
    if (!isPlaying) { drawWaveform(); return; }
    const elapsed = (audioCtx.currentTime - playStartTime) * settings.playbackRate;
    const progress = Math.min(elapsed / duration, 1);
    drawWaveform(progress);
    if (progress < 1) animFrameId = requestAnimationFrame(tick);
  }
  animFrameId = requestAnimationFrame(tick);
}

// ============================================================
// エフェクトチェーン構築
// ============================================================
function buildEffectChain(ctx, source) {
  let last = source;
  const g = ctx.createGain(); g.gain.value = settings.volume; last.connect(g); last = g;
  if (settings.distortion) {
    const d = ctx.createWaveShaper(); d.curve = makeDistCurve(settings.distortionAmount); d.oversample = '4x'; last.connect(d); last = d;
  }
  if (settings.filterType !== 'off') {
    const f = ctx.createBiquadFilter(); f.type = settings.filterType; f.frequency.value = settings.filterFreq; last.connect(f); last = f;
  }
  if (settings.delay) {
    const dG = ctx.createGain(); dG.gain.value = 1;
    const wG = ctx.createGain(); wG.gain.value = settings.delayFeedback;
    const dl = ctx.createDelay(5.0); dl.delayTime.value = settings.delayTime;
    const fb = ctx.createGain(); fb.gain.value = settings.delayFeedback;
    last.connect(dG); last.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wG);
    const m = ctx.createGain(); dG.connect(m); wG.connect(m); last = m;
  }
  if (settings.reverb) {
    const dG = ctx.createGain(); dG.gain.value = 1 - settings.reverbAmount;
    const wG = ctx.createGain(); wG.gain.value = settings.reverbAmount;
    const len = ctx.sampleRate * 2;
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2); }
    const cv = ctx.createConvolver(); cv.buffer = imp;
    last.connect(dG); last.connect(cv); cv.connect(wG);
    const m = ctx.createGain(); dG.connect(m); wG.connect(m); last = m;
  }
  return last;
}

function makeDistCurve(amount) {
  const n = 44100, c = new Float32Array(n), d = Math.PI / 180;
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((3 + amount) * x * 20 * d) / (Math.PI + amount * Math.abs(x)); }
  return c;
}

// ============================================================
// プレビュー再生
// ============================================================
async function playPreview() {
  stopPreview();
  const buffer = getTrimmedBuffer();
  if (!buffer) return;

  const hasHeavy = settings.reverb || settings.delay || settings.distortion || settings.filterType !== 'off';
  if (hasHeavy) {
    document.getElementById('editorStatus').textContent = 'エフェクト適用中...';
    renderedBuffer = await renderOffline(buffer);
    document.getElementById('editorStatus').textContent = '';
  } else { renderedBuffer = null; }

  isPlaying = true; updatePlayBtn();

  const playBuf = renderedBuffer || buffer;
  const rate = renderedBuffer ? 1 : settings.playbackRate;

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = playBuf;
  sourceNode.playbackRate.value = rate;

  if (renderedBuffer) {
    const vol = audioCtx.createGain(); vol.gain.value = 1;
    sourceNode.connect(vol); vol.connect(audioCtx.destination);
  } else {
    const last = buildEffectChain(audioCtx, sourceNode);
    last.connect(audioCtx.destination);
  }

  playStartTime = audioCtx.currentTime;
  sourceNode.onended = () => { isPlaying = false; updatePlayBtn(); drawWaveform(); };
  sourceNode.start();
  startPlayheadAnimation(playBuf.duration);
  drawWaveform(0);
}

async function renderOffline(buffer) {
  const extra = (settings.delay ? settings.delayTime * 4 : 0) + (settings.reverb ? 2 : 0);
  const dur = buffer.duration / settings.playbackRate + extra;
  const oc = new OfflineAudioContext(buffer.numberOfChannels, Math.ceil(dur * buffer.sampleRate), buffer.sampleRate);
  const src = oc.createBufferSource(); src.buffer = buffer; src.playbackRate.value = settings.playbackRate;
  const last = buildEffectChain(oc, src); last.connect(oc.destination); src.start();
  return oc.startRendering();
}

function stopPreview() {
  if (sourceNode) { try { sourceNode.stop(); } catch {} sourceNode.disconnect(); sourceNode = null; }
  isPlaying = false; cancelAnimationFrame(animFrameId); updatePlayBtn();
}
function updatePlayBtn() {
  const b = document.getElementById('playBtn');
  b.textContent = isPlaying ? '⏹ 停止' : '▶ プレビュー';
  b.classList.toggle('playing', isPlaying);
}

// ============================================================
// 保存
// ============================================================
async function renderAndSave() {
  const name = document.getElementById('saveName').value.trim();
  if (!name) { alert('保存名を入力してください'); document.getElementById('saveName').focus(); return; }
  const buffer = getTrimmedBuffer(); if (!buffer) return;
  const status = document.getElementById('editorStatus');
  status.textContent = '保存中...';
  try {
    const rendered = await renderOffline(buffer);
    const wav = audioBufferToWav(rendered);
    await saveEditedVoice(name, wav, { ...settings, sourceId: currentVoiceId, sourceLabel: currentVoiceLabel });
    status.textContent = `「${name}」を保存しました！`;
    loadSavedList();
  } catch (e) { status.textContent = '保存に失敗しました'; console.error(e); }
}

function audioBufferToWav(buf) {
  const nc = buf.numberOfChannels, sr = buf.sampleRate, ba = nc * 2, dl = buf.length * ba, tl = 44 + dl;
  const ab = new ArrayBuffer(tl), v = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); v.setUint32(4,tl-8,true); ws(8,'WAVE'); ws(12,'fmt '); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,nc,true); v.setUint32(24,sr,true);
  v.setUint32(28,sr*ba,true); v.setUint16(32,ba,true); v.setUint16(34,16,true);
  ws(36,'data'); v.setUint32(40,dl,true);
  const chs = []; for (let c = 0; c < nc; c++) chs.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < buf.length; i++) for (let c = 0; c < nc; c++) {
    let s = Math.max(-1, Math.min(1, chs[c][i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ============================================================
// 保存済みリスト
// ============================================================
async function loadSavedList() {
  const list = document.getElementById('savedList'); list.innerHTML = '';
  const items = await getAllEditedVoices();
  if (!items.length) { list.innerHTML = '<div class="saved-empty">保存済みボイスはまだないよ</div>'; return; }
  items.sort((a, b) => b.date - a.date);
  items.forEach(item => {
    const el = document.createElement('div'); el.className = 'saved-item';
    el.innerHTML = `<span class="saved-item-name">${item.name}</span><span class="saved-item-source">${item.settings.sourceLabel||''}</span><div class="saved-item-actions"><button class="saved-play" title="再生">▶</button><button class="saved-delete" title="削除">✕</button></div>`;
    el.querySelector('.saved-play').addEventListener('click', () => {
      const url = URL.createObjectURL(item.wav); const a = new Audio(url);
      const s = document.getElementById('volumeSlider'); a.volume = s ? s.value / 100 : 0.8;
      a.play(); a.onended = () => URL.revokeObjectURL(url);
    });
    el.querySelector('.saved-delete').addEventListener('click', async () => {
      if (confirm(`「${item.name}」を削除しますか？`)) { await deleteEditedVoice(item.name); loadSavedList(); }
    });
    list.appendChild(el);
  });
}

// ============================================================
// UI更新
// ============================================================
function updateAllSliders() {
  document.getElementById('trimStart').value = settings.trimStart * 100;
  document.getElementById('trimEnd').value = settings.trimEnd * 100;
  document.getElementById('trimStartVal').textContent = Math.round(settings.trimStart * 100) + '%';
  document.getElementById('trimEndVal').textContent = Math.round(settings.trimEnd * 100) + '%';
  document.getElementById('volumeRange').value = settings.volume * 100;
  document.getElementById('volumeVal').textContent = Math.round(settings.volume * 100) + '%';
  document.getElementById('pitchRange').value = settings.playbackRate * 100;
  document.getElementById('pitchVal').textContent = settings.playbackRate.toFixed(2) + 'x';
  document.getElementById('reverseToggle').classList.toggle('is-on', settings.reverse);
  document.getElementById('reverbToggle').classList.toggle('is-on', settings.reverb);
  document.getElementById('reverbRange').value = settings.reverbAmount * 100;
  document.getElementById('reverbRange').disabled = !settings.reverb;
  document.getElementById('delayToggle').classList.toggle('is-on', settings.delay);
  document.getElementById('delayTimeRange').value = settings.delayTime * 100;
  document.getElementById('delayFbRange').value = settings.delayFeedback * 100;
  document.getElementById('delayTimeRange').disabled = !settings.delay;
  document.getElementById('delayFbRange').disabled = !settings.delay;
  document.getElementById('distToggle').classList.toggle('is-on', settings.distortion);
  document.getElementById('distRange').value = settings.distortionAmount;
  document.getElementById('distRange').disabled = !settings.distortion;
  document.getElementById('filterSelect').value = settings.filterType;
  document.getElementById('filterFreqRange').value = settings.filterFreq;
  document.getElementById('filterFreqVal').textContent = settings.filterFreq + 'Hz';
  document.getElementById('filterFreqRange').disabled = settings.filterType === 'off';
}
function enableControls(on) {
  document.querySelectorAll('.editor-controls input, .editor-controls select, .editor-controls button').forEach(el => el.disabled = !on);
  ['trimStart','trimEnd','playBtn','saveBtn','saveName'].forEach(id => document.getElementById(id).disabled = !on);
}

// ============================================================
// イベントリスナー
// ============================================================
function setupEditorEvents() {
  // スライダートリム（波形ドラッグの補助として残す）
  document.getElementById('trimStart').addEventListener('input', e => {
    let v = parseInt(e.target.value);
    const ev = parseInt(document.getElementById('trimEnd').value);
    if (v >= ev) v = ev - 1; if (v < 0) v = 0; e.target.value = v;
    settings.trimStart = v / 100; renderedBuffer = null;
    document.getElementById('trimStartVal').textContent = v + '%';
    drawWaveform();
  });
  document.getElementById('trimEnd').addEventListener('input', e => {
    let v = parseInt(e.target.value);
    const sv = parseInt(document.getElementById('trimStart').value);
    if (v <= sv) v = sv + 1; if (v > 100) v = 100; e.target.value = v;
    settings.trimEnd = v / 100; renderedBuffer = null;
    document.getElementById('trimEndVal').textContent = v + '%';
    drawWaveform();
  });

  // 音量
  document.getElementById('volumeRange').addEventListener('input', e => {
    settings.volume = e.target.value / 100;
    document.getElementById('volumeVal').textContent = Math.round(settings.volume * 100) + '%';
    renderedBuffer = null; drawWaveform();
  });
  // ピッチ
  document.getElementById('pitchRange').addEventListener('input', e => {
    settings.playbackRate = e.target.value / 100;
    document.getElementById('pitchVal').textContent = settings.playbackRate.toFixed(2) + 'x';
  });
  // 逆再生
  document.getElementById('reverseToggle').addEventListener('click', () => {
    settings.reverse = !settings.reverse;
    document.getElementById('reverseToggle').classList.toggle('is-on', settings.reverse);
    renderedBuffer = null; drawWaveform();
  });
  // リバーブ
  document.getElementById('reverbToggle').addEventListener('click', () => {
    settings.reverb = !settings.reverb;
    document.getElementById('reverbToggle').classList.toggle('is-on', settings.reverb);
    document.getElementById('reverbRange').disabled = !settings.reverb;
  });
  document.getElementById('reverbRange').addEventListener('input', e => { settings.reverbAmount = e.target.value / 100; });
  // ディレイ
  document.getElementById('delayToggle').addEventListener('click', () => {
    settings.delay = !settings.delay;
    document.getElementById('delayToggle').classList.toggle('is-on', settings.delay);
    document.getElementById('delayTimeRange').disabled = !settings.delay;
    document.getElementById('delayFbRange').disabled = !settings.delay;
  });
  document.getElementById('delayTimeRange').addEventListener('input', e => { settings.delayTime = e.target.value / 100; });
  document.getElementById('delayFbRange').addEventListener('input', e => { settings.delayFeedback = e.target.value / 100; });
  // ディストーション
  document.getElementById('distToggle').addEventListener('click', () => {
    settings.distortion = !settings.distortion;
    document.getElementById('distToggle').classList.toggle('is-on', settings.distortion);
    document.getElementById('distRange').disabled = !settings.distortion;
  });
  document.getElementById('distRange').addEventListener('input', e => { settings.distortionAmount = parseInt(e.target.value); });
  // フィルター
  document.getElementById('filterSelect').addEventListener('change', e => {
    settings.filterType = e.target.value;
    document.getElementById('filterFreqRange').disabled = settings.filterType === 'off';
  });
  document.getElementById('filterFreqRange').addEventListener('input', e => {
    settings.filterFreq = parseInt(e.target.value);
    document.getElementById('filterFreqVal').textContent = e.target.value + 'Hz';
  });

  document.getElementById('playBtn').addEventListener('click', () => { if (isPlaying) stopPreview(); else playPreview(); });
  document.getElementById('resetBtn').addEventListener('click', () => {
    settings = { ...defaultSettings }; renderedBuffer = null; updateAllSliders(); drawWaveform();
  });
  document.getElementById('saveBtn').addEventListener('click', renderAndSave);

  // ヘッダー音量
  const vs = document.getElementById('volumeSlider'), vi = document.getElementById('volumeIcon');
  vs.addEventListener('input', () => updateHeaderVolIcon());
  vi.addEventListener('click', () => {
    if (vs.value > 0) { vs.dataset.prev = vs.value; vs.value = 0; } else { vs.value = vs.dataset.prev || 80; }
    updateHeaderVolIcon();
  });

  window.addEventListener('resize', () => drawWaveform());

  // 波形ドラッグ
  setupWaveformDrag();
}

function updateHeaderVolIcon() {
  const v = document.getElementById('volumeSlider').value; let p = '';
  if (v == 0) p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  else if (v < 50) p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
  else p = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  document.getElementById('volumeIcon').innerHTML = p;
}

// ============================================================
// ボイス選択リスト
// ============================================================
function renderVoiceSelector() {
  const list = document.getElementById('voiceSelectorList'); list.innerHTML = '';
  let favIds; try { favIds = JSON.parse(localStorage.getItem('favVoices') || '[]'); } catch { favIds = []; }
  const fv = [];
  voiceData.forEach(m => m.voices.forEach(v => { if (favIds.includes(v.id)) fv.push({ id: v.id, label: v.label, movie: m.movie }); }));
  if (!fv.length) { list.innerHTML = '<div class="saved-empty">お気に入りがないよ！<br><a href="index.html" style="color:var(--pink-500)">ボイス一覧</a>で追加してね</div>'; return; }
  fv.forEach(v => {
    const btn = document.createElement('button'); btn.className = 'voice-select-btn';
    btn.innerHTML = `<span>${v.label}</span><span class="voice-select-movie">${v.movie}</span>`;
    btn.addEventListener('click', () => loadVoice(v.id, v.label));
    list.appendChild(btn);
  });
}

// ============================================================
// 初期化
// ============================================================
async function initEditor() {
  await openDB();
  renderVoiceSelector();
  loadSavedList();
  setupEditorEvents();
  enableControls(false);
}
initEditor();
