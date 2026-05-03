// ============================================================
// IndexedDB
// ============================================================
const DB_NAME='hinanoEditorDB',DB_STORE='editedVoices',REC_DB_NAME='hinanoRecorderDB',REC_STORE='tracks';
let recDb=null,editorDb=null;
function openEditorDB(){return new Promise((r,j)=>{const q=indexedDB.open(DB_NAME,1);q.onupgradeneeded=()=>q.result.createObjectStore(DB_STORE,{keyPath:'name'});q.onsuccess=()=>{editorDb=q.result;r()};q.onerror=()=>j(q.error)})}
function getEditedVoice(n){return new Promise((r,j)=>{const t=editorDb.transaction(DB_STORE,'readonly'),q=t.objectStore(DB_STORE).get(n);q.onsuccess=()=>r(q.result||null);q.onerror=()=>j(q.error)})}
function openRecDB(){return new Promise((r,j)=>{const q=indexedDB.open(REC_DB_NAME,1);q.onupgradeneeded=()=>q.result.createObjectStore(REC_STORE,{keyPath:'id',autoIncrement:true});q.onsuccess=()=>{recDb=q.result;r()};q.onerror=()=>j(q.error)})}
function saveTrackToDB(t){return new Promise((r,j)=>{const tx=recDb.transaction(REC_STORE,'readwrite');tx.objectStore(REC_STORE).add(t);tx.oncomplete=()=>r();tx.onerror=()=>j(tx.error)})}
function getAllTracks(){return new Promise((r,j)=>{const tx=recDb.transaction(REC_STORE,'readonly'),q=tx.objectStore(REC_STORE).getAll();q.onsuccess=()=>r(q.result||[]);q.onerror=()=>j(q.error)})}
function deleteTrackFromDB(id){return new Promise((r,j)=>{const tx=recDb.transaction(REC_STORE,'readwrite');tx.objectStore(REC_STORE).delete(id);tx.oncomplete=()=>r();tx.onerror=()=>j(tx.error)})}

// ============================================================
// Audio
// ============================================================
let audioCtx=null;
const PAD_KEYS=['1','2','3','4','q','w','e','r','a','s','d','f','z','x','c','v'];
const PAD_LABELS=['1','2','3','4','Q','W','E','R','A','S','D','F','Z','X','C','V'];
const padBuffers=new Array(16).fill(null);
const PAD_COLORS=['#ec4899','#f472b6','#a855f7','#8b5cf6','#3b82f6','#06b6d4','#10b981','#22c55e','#eab308','#f59e0b','#ef4444','#f97316','#6366f1','#14b8a6','#d946ef','#f43f5e'];

function getPadMap(){try{return JSON.parse(localStorage.getItem('padMap')||'{}')}catch{return{}}}

async function loadPadBuffers(){
  if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  const map=getPadMap();
  for(let i=0;i<16;i++){
    const a=map[i];if(!a){padBuffers[i]=null;continue}
    try{
      if(a.type==='edited'){const ed=await getEditedVoice(a.id);if(ed&&ed.wav){padBuffers[i]=await audioCtx.decodeAudioData(await ed.wav.arrayBuffer())}else padBuffers[i]=null}
      else{const r=await fetch(`./voice/${a.id}.mp3`);padBuffers[i]=await audioCtx.decodeAudioData(await r.arrayBuffer())}
    }catch{padBuffers[i]=null}
  }
}

const trackBufferCache=new Map();
async function getTrackBuffer(track){
  if(trackBufferCache.has(track.id)) return trackBufferCache.get(track.id);
  const ab=await track.wav.arrayBuffer();
  const buf=await audioCtx.decodeAudioData(ab);
  trackBufferCache.set(track.id,buf);
  return buf;
}

// ============================================================
// 状態
// ============================================================
let isRecording=false;
let isCountingIn=false;
let recordStartTime=0;
let recordEvents=[];
let loopDuration=0;
let metronomeOn=true;
let countInOn=true;
let scheduledSources=[];
let recAnimId=null;

let tracks=[];
let isPlayingPreview=false;
let previewSources=[];
let previewAnimId=null;
let previewStartTime=0;

let isPlayingAll=false;
let allPlaySources=[];
let allPlayAnimId=null;
let allPlayStartTime=0;

// ============================================================
// Settings
// ============================================================
function getSettings(){
  const bpm=parseInt(document.getElementById('bpmInput').value)||120;
  const bars=parseInt(document.getElementById('barsInput').value)||4;
  const beats=parseInt(document.getElementById('beatsInput').value)||4;
  const beatSec=60/bpm;
  loopDuration=beatSec*beats*bars;
  document.getElementById('loopDurDisplay').textContent=loopDuration.toFixed(2)+'s';
  return{bpm,bars,beats,beatSec};
}

// ============================================================
// タイムライン Canvas
// ============================================================
function drawTimeline(canvas,duration,bpm,beats,events,playheadPos,isSmall){
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const rect=canvas.getBoundingClientRect();
  canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height;
  ctx.clearRect(0,0,w,h);
  if(duration<=0)duration=1;

  const beatSec=60/bpm;
  const barSec=beatSec*beats;
  const totalBars=Math.ceil(duration/barSec);
  const totalBeats=Math.ceil(duration/beatSec);

  ctx.fillStyle='rgba(255,248,245,1)';ctx.fillRect(0,0,w,h);

  for(let bar=0;bar<totalBars;bar++){
    const x1=Math.max(0,(bar*barSec/duration)*w);
    const x2=Math.min(w,((bar+1)*barSec/duration)*w);
    ctx.fillStyle=bar%2===0?'rgba(252,231,243,0.3)':'rgba(240,220,200,0.15)';
    ctx.fillRect(x1,0,x2-x1,h);
  }

  ctx.strokeStyle='rgba(212,168,124,0.2)';ctx.lineWidth=1;
  for(let i=1;i<totalBeats;i++){const x=(i*beatSec/duration)*w;if(x>w)break;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}

  ctx.strokeStyle='rgba(92,58,46,0.5)';ctx.lineWidth=isSmall?1.5:2;
  for(let i=0;i<=totalBars;i++){const x=(i*barSec/duration)*w;if(x>w+1)break;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}

  ctx.fillStyle='rgba(92,58,46,0.6)';ctx.font=`bold ${isSmall?'8':'11'}px 'Zen Maru Gothic',sans-serif`;ctx.textAlign='left';
  for(let i=0;i<totalBars;i++){const x=(i*barSec/duration)*w+3;if(x>w-10)break;ctx.fillText(`${i+1}`,x,isSmall?8:12)}

  if(events&&events.length){
    const dotR=isSmall?3:5;const map=getPadMap();
    events.forEach(ev=>{
      const x=(ev.time/duration)*w;const y=h/2;
      ctx.beginPath();ctx.arc(x,y,dotR,0,Math.PI*2);ctx.fillStyle=PAD_COLORS[ev.padIndex%PAD_COLORS.length];ctx.fill();
      if(!isSmall&&map[ev.padIndex]){ctx.fillStyle='rgba(61,31,23,0.7)';ctx.font="bold 8px 'Zen Maru Gothic',sans-serif";ctx.textAlign='center';ctx.fillText(PAD_LABELS[ev.padIndex],x,y-dotR-3)}
    });
  }

  if(typeof playheadPos==='number'&&playheadPos>=0){
    const px=Math.min(playheadPos*w,w);
    ctx.strokeStyle='#e53e3e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();
    ctx.fillStyle='#e53e3e';
    ctx.beginPath();ctx.moveTo(px-4,0);ctx.lineTo(px+4,0);ctx.lineTo(px,6);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(px-4,h);ctx.lineTo(px+4,h);ctx.lineTo(px,h-6);ctx.closePath();ctx.fill();
  }
}

// ============================================================
// メトロノーム
// ============================================================
function scheduleMetronome(startTime,duration,bpm,beatsPerBar){
  const beatSec=60/bpm;const total=Math.ceil(duration/beatSec);
  for(let i=0;i<total;i++){
    const t=startTime+i*beatSec;if(t>startTime+duration+0.5)break;
    const isDown=(i%beatsPerBar===0);
    const osc=audioCtx.createOscillator();const g=audioCtx.createGain();
    osc.type='triangle';osc.frequency.value=isDown?1200:800;
    g.gain.setValueAtTime(isDown?0.35:0.2,t);g.gain.linearRampToValueAtTime(0,t+0.06);
    osc.connect(g);g.connect(audioCtx.destination);osc.start(t);osc.stop(t+0.08);
    scheduledSources.push(osc);
  }
}

function stopScheduled(){scheduledSources.forEach(s=>{try{s.stop()}catch{}});scheduledSources=[]}

// ============================================================
// パッド
// ============================================================
function renderRecPads(){
  const grid=document.getElementById('recPadGrid');grid.innerHTML='';
  const map=getPadMap();
  for(let i=0;i<16;i++){
    const pad=document.createElement('div'),a=map[i];
    pad.className=`rec-pad${a?' rec-pad-assigned':''}`;pad.dataset.index=i;
    pad.innerHTML=`<span class="rec-pad-key">${PAD_LABELS[i]}</span><span class="rec-pad-label">${a?a.label:''}</span>`;
    pad.addEventListener('click',()=>{if(a&&padBuffers[i])triggerRecPad(i)});
    grid.appendChild(pad);
  }
}

function triggerRecPad(index){
  const buf=padBuffers[index];if(!buf)return;
  const vol=document.getElementById('volumeSlider');
  const src=audioCtx.createBufferSource();src.buffer=buf;
  const g=audioCtx.createGain();g.gain.value=vol?vol.value/100:0.8;
  src.connect(g);g.connect(audioCtx.destination);src.start();
  const pads=document.querySelectorAll('.rec-pad');
  if(pads[index]){pads[index].classList.add('rec-pad-active');setTimeout(()=>pads[index].classList.remove('rec-pad-active'),150)}

  // 録音中（カウントインではなく本録音中）のみ記録
  if(isRecording&&!isCountingIn){
    const time=audioCtx.currentTime-recordStartTime;
    if(time>=0&&time<=loopDuration) recordEvents.push({time,padIndex:index});
  }
}

document.addEventListener('keydown',e=>{
  if(document.activeElement.tagName==='INPUT')return;
  if(e.code==='Space'){e.preventDefault();toggleRecording();return}
  const i=PAD_KEYS.indexOf(e.key.toLowerCase());
  if(i!==-1){e.preventDefault();triggerRecPad(i)}
});

// ============================================================
// 録音（カウントイン対応、固定長）
// ============================================================
function toggleRecording(){
  if(isRecording||isCountingIn) stopRecording();
  else startRecording();
}

async function startRecording(){
  if(!audioCtx)return;
  await audioCtx.resume();
  const{bpm,bars,beats,beatSec}=getSettings();
  if(loopDuration<=0)return;

  recordEvents=[];

  const countInDuration=countInOn?(beatSec*beats):0; // 1小節分

  if(countInOn){
    // カウントインフェーズ
    isCountingIn=true;
    isRecording=true;
    updateRecUI();
    setStatus('カウントイン...');

    const countInStart=audioCtx.currentTime;
    if(metronomeOn) scheduleMetronome(countInStart,countInDuration,bpm,beats);

    // カウントインのアニメーション
    const canvas=document.getElementById('recTimeline');
    const countInBeats=beats;
    function countTick(){
      if(!isCountingIn)return;
      const elapsed=audioCtx.currentTime-countInStart;
      const beatNum=Math.floor(elapsed/beatSec)+1;
      setStatus(`カウントイン... ${Math.min(beatNum,countInBeats)} / ${countInBeats}`);
      // タイムラインは空のまま表示
      drawTimeline(canvas,loopDuration,bpm,beats,[],null,false);
      if(elapsed<countInDuration) recAnimId=requestAnimationFrame(countTick);
    }
    recAnimId=requestAnimationFrame(countTick);

    // カウントイン終了後に本録音開始
    setTimeout(()=>{
      isCountingIn=false;
      setStatus('');
      beginActualRecording(bpm,bars,beats,beatSec);
    },countInDuration*1000);
  }else{
    isRecording=true;
    updateRecUI();
    beginActualRecording(bpm,bars,beats,beatSec);
  }
}

function beginActualRecording(bpm,bars,beats,beatSec){
  recordStartTime=audioCtx.currentTime;

  // メトロノーム（録音区間分）
  if(metronomeOn) scheduleMetronome(recordStartTime,loopDuration,bpm,beats);

  // タイムラインアニメーション
  const canvas=document.getElementById('recTimeline');
  function tick(){
    if(!isRecording)return;
    const elapsed=audioCtx.currentTime-recordStartTime;
    const progress=Math.min(elapsed/loopDuration,1);
    drawTimeline(canvas,loopDuration,bpm,beats,recordEvents,progress,false);
    document.getElementById('recTimeDisplay').textContent=Math.max(0,loopDuration-elapsed).toFixed(1)+'s';
    if(progress<1) recAnimId=requestAnimationFrame(tick);
  }
  recAnimId=requestAnimationFrame(tick);

  // 自動停止
  setTimeout(()=>{if(isRecording&&!isCountingIn)finishRecording()},loopDuration*1000+100);
}

async function finishRecording(){
  isRecording=false;isCountingIn=false;
  stopScheduled();cancelAnimationFrame(recAnimId);
  updateRecUI();

  const{bpm,bars,beats}=getSettings();
  const canvas=document.getElementById('recTimeline');
  drawTimeline(canvas,loopDuration,bpm,beats,recordEvents,null,false);
  document.getElementById('recTimeDisplay').textContent='';

  if(recordEvents.length===0){setStatus('何も録音されなかったよ');return}

  setStatus('保存中...');
  const sampleRate=audioCtx.sampleRate;
  let maxEnd=loopDuration;
  recordEvents.forEach(ev=>{const buf=padBuffers[ev.padIndex];if(buf){const end=ev.time+buf.duration;if(end>maxEnd)maxEnd=end}});

  const offCtx=new OfflineAudioContext(2,Math.ceil(maxEnd*sampleRate),sampleRate);
  recordEvents.forEach(ev=>{const buf=padBuffers[ev.padIndex];if(!buf)return;const src=offCtx.createBufferSource();src.buffer=buf;src.connect(offCtx.destination);src.start(ev.time)});

  try{
    const rendered=await offCtx.startRendering();
    const wav=audioBufferToWav(rendered);
    await saveTrackToDB({wav,events:recordEvents,duration:loopDuration,maxDuration:maxEnd,bpm,bars,beats,date:Date.now(),muted:false,volume:1.0});
    trackBufferCache.clear();
    await loadTrackList();
    setStatus('');
  }catch(e){setStatus('保存に失敗しました');console.error(e)}
}

function stopRecording(){
  if(isCountingIn){
    // カウントイン中に停止 → キャンセル
    isCountingIn=false;isRecording=false;
    stopScheduled();cancelAnimationFrame(recAnimId);
    updateRecUI();setStatus('');
    return;
  }
  if(isRecording) finishRecording();
}

// ============================================================
// 全トラック再生
// ============================================================
async function playAllTracks(){
  stopAllPlayback();
  if(!tracks.length)return;

  isPlayingAll=true;updateAllPlayBtn();

  const vol=document.getElementById('volumeSlider');
  const masterVol=vol?vol.value/100:0.8;
  let maxDur=0;

  for(const track of tracks){
    if(track.muted)continue;
    const dur=track.maxDuration||track.duration||0;
    if(dur>maxDur)maxDur=dur;
    try{
      const buf=await getTrackBuffer(track);
      const src=audioCtx.createBufferSource();src.buffer=buf;
      const g=audioCtx.createGain();g.gain.value=masterVol*(track.volume||1);
      src.connect(g);g.connect(audioCtx.destination);src.start();
      allPlaySources.push(src);
    }catch{}
  }

  if(maxDur===0){isPlayingAll=false;updateAllPlayBtn();return}

  allPlayStartTime=audioCtx.currentTime;
  const{bpm,beats}=getSettings();

  // 各トラックのタイムラインにヘッドアニメーション
  function tick(){
    if(!isPlayingAll)return;
    const elapsed=audioCtx.currentTime-allPlayStartTime;
    const progress=Math.min(elapsed/maxDur,1);

    // 全トラックのキャンバスを更新
    tracks.forEach(track=>{
      if(track.muted)return;
      const c=document.getElementById(`trackTimeline${track.id}`);
      if(c){
        const dur=track.duration||1;
        const p=Math.min(elapsed/dur,1);
        drawTimeline(c,dur,track.bpm||bpm,track.beats||beats,track.events||[],p,true);
      }
    });

    document.getElementById('allPlayTime').textContent=elapsed.toFixed(1)+'s / '+maxDur.toFixed(1)+'s';

    if(progress<1) allPlayAnimId=requestAnimationFrame(tick);
    else{
      isPlayingAll=false;updateAllPlayBtn();
      document.getElementById('allPlayTime').textContent='';
      // ヘッドなしで再描画
      tracks.forEach(track=>{
        const c=document.getElementById(`trackTimeline${track.id}`);
        if(c) drawTimeline(c,track.duration||1,track.bpm||bpm,track.beats||beats,track.events||[],null,true);
      });
    }
  }
  allPlayAnimId=requestAnimationFrame(tick);
}

function stopAllPlayback(){
  allPlaySources.forEach(s=>{try{s.stop()}catch{}});
  allPlaySources=[];cancelAnimationFrame(allPlayAnimId);
  isPlayingAll=false;updateAllPlayBtn();
}

function updateAllPlayBtn(){
  const btn=document.getElementById('allPlayBtn');
  if(!btn)return;
  btn.textContent=isPlayingAll?'⏹ 停止':'▶ 全トラック再生';
  btn.classList.toggle('playing',isPlayingAll);
}

// ============================================================
// WAV
// ============================================================
function audioBufferToWav(buf){
  const nc=buf.numberOfChannels,sr=buf.sampleRate,ba=nc*2,dl=buf.length*ba,tl=44+dl;
  const ab=new ArrayBuffer(tl),v=new DataView(ab);
  const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  ws(0,'RIFF');v.setUint32(4,tl-8,true);ws(8,'WAVE');ws(12,'fmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nc,true);
  v.setUint32(24,sr,true);v.setUint32(28,sr*ba,true);v.setUint16(32,ba,true);
  v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,dl,true);
  const chs=[];for(let c=0;c<nc;c++)chs.push(buf.getChannelData(c));
  let off=44;
  for(let i=0;i<buf.length;i++)for(let c=0;c<nc;c++){
    let s=Math.max(-1,Math.min(1,chs[c][i]));
    v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true);off+=2;
  }
  return new Blob([ab],{type:'audio/wav'});
}

// ============================================================
// トラックリスト
// ============================================================
async function loadTrackList(){
  tracks=await getAllTracks();
  renderTrackListUI();
}

function renderTrackListUI(){
  const list=document.getElementById('trackList');list.innerHTML='';
  // 全再生ボタンの表示
  const allPlayWrap=document.getElementById('allPlayWrap');
  if(!tracks.length){
    list.innerHTML='<div class="track-empty">トラックがまだないよ。録音してみよう！</div>';
    if(allPlayWrap)allPlayWrap.style.display='none';
    return;
  }
  if(allPlayWrap)allPlayWrap.style.display='';

  const{bpm:curBpm,beats:curBeats}=getSettings();

  tracks.forEach((track,idx)=>{
    const el=document.createElement('div');
    el.className=`track-item${track.muted?' track-muted':''}`;
    const canvasId=`trackTimeline${track.id}`;
    const dur=track.duration||1;
    const tBpm=track.bpm||curBpm;
    const tBeats=track.beats||curBeats;
    const beatSec=60/tBpm;
    const bars=Math.round(dur/(beatSec*tBeats));

    el.innerHTML=`
      <div class="track-header">
        <span class="track-num">Track ${idx+1}</span>
        <span class="track-info">${tBpm}BPM / ${bars}小節 / ${tBeats}拍子</span>
        <span class="track-dur">${dur.toFixed(1)}s</span>
        <span class="track-date">${new Date(track.date).toLocaleString('ja-JP',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
      </div>
      <canvas class="track-timeline-canvas" id="${canvasId}"></canvas>
      <div class="track-controls">
        <button class="track-btn track-play-btn" title="再生/停止">▶</button>
        <button class="track-btn track-restart-btn" title="最初から">⏮</button>
        <button class="track-btn track-mute-btn${track.muted?' btn-active':''}" title="ミュート">M</button>
        <input type="range" class="track-vol" min="0" max="100" value="${Math.round((track.volume||1)*100)}" title="音量">
        <button class="track-btn track-delete-btn" title="削除">✕</button>
      </div>`;

    list.appendChild(el);

    requestAnimationFrame(()=>{
      const c=document.getElementById(canvasId);
      if(c)drawTimeline(c,dur,tBpm,tBeats,track.events||[],null,true);
    });

    // 再生状態
    let thisPlaying=false;
    let thisSrc=null;
    let thisAnimId=null;
    let thisOffset=0;        // 一時停止位置（秒）
    let thisGainNode=null;
    const playBtn=el.querySelector('.track-play-btn');
    const playDur=track.maxDuration||dur;
    const cvs=el.querySelector('.track-timeline-canvas');

    function playThisTrackFrom(offset){
      // 既存再生を止める（UIリセットなし）
      if(thisSrc){try{thisSrc.stop()}catch{}}
      thisSrc=null;cancelAnimationFrame(thisAnimId);
      previewSources=previewSources.filter(s=>s!==thisSrc);

      isPlayingPreview=true;thisPlaying=true;
      thisOffset=offset;
      playBtn.textContent='⏸';

      getTrackBuffer(track).then(buf=>{
        thisSrc=audioCtx.createBufferSource();thisSrc.buffer=buf;
        thisGainNode=audioCtx.createGain();const vol=document.getElementById('volumeSlider');
        thisGainNode.gain.value=(vol?vol.value/100:0.8)*(track.volume||1);
        thisSrc.connect(thisGainNode);thisGainNode.connect(audioCtx.destination);
        previewStartTime=audioCtx.currentTime-offset;
        thisSrc.start(0,offset);
        previewSources.push(thisSrc);

        function animTick(){
          if(!thisPlaying)return;
          const elapsed=audioCtx.currentTime-previewStartTime;
          const progress=Math.min(elapsed/playDur,1);
          thisOffset=elapsed;
          const c=document.getElementById(canvasId);
          if(c)drawTimeline(c,dur,tBpm,tBeats,track.events||[],progress,true);
          if(progress<1)thisAnimId=requestAnimationFrame(animTick);
          else pauseThisTrack(0);// 終了時は先頭に戻す
        }
        thisAnimId=requestAnimationFrame(animTick);
        thisSrc.onended=()=>{
          if(thisPlaying) pauseThisTrack(0);// 自然終了→先頭に
        };
      });
    }

    function pauseThisTrack(resetTo){
      const elapsed=audioCtx.currentTime-previewStartTime;
      thisOffset=(typeof resetTo==='number')?resetTo:Math.min(elapsed,playDur);
      if(thisSrc){try{thisSrc.stop()}catch{}}
      thisSrc=null;thisPlaying=false;isPlayingPreview=false;
      cancelAnimationFrame(thisAnimId);
      playBtn.textContent='▶';
      // ヘッドを停止位置に表示
      const c=document.getElementById(canvasId);
      const progress=thisOffset/playDur;
      if(c)drawTimeline(c,dur,tBpm,tBeats,track.events||[],progress>0?progress:null,true);
    }

    // 再生/一時停止トグル
    playBtn.addEventListener('click',()=>{
      if(thisPlaying) pauseThisTrack();
      else playThisTrackFrom(thisOffset);
    });

    // 最初から
    el.querySelector('.track-restart-btn').addEventListener('click',()=>{
      pauseThisTrack(0);
      playThisTrackFrom(0);
    });

    // Canvasクリック/ドラッグでシーク
    function seekFromEvent(e){
      const rect=cvs.getBoundingClientRect();
      const x=(e.clientX||( e.touches&&e.touches[0].clientX)||0)-rect.left;
      const ratio=Math.max(0,Math.min(1,x/rect.width));
      const seekTime=ratio*playDur;
      if(thisPlaying){
        playThisTrackFrom(seekTime);
      }else{
        thisOffset=seekTime;
        const c=document.getElementById(canvasId);
        if(c)drawTimeline(c,dur,tBpm,tBeats,track.events||[],ratio,true);
      }
    }

    let isDraggingSeek=false;
    cvs.style.cursor='pointer';
    cvs.addEventListener('mousedown',e=>{isDraggingSeek=true;seekFromEvent(e)});
    window.addEventListener('mousemove',e=>{if(isDraggingSeek)seekFromEvent(e)});
    window.addEventListener('mouseup',()=>{isDraggingSeek=false});
    cvs.addEventListener('touchstart',e=>{isDraggingSeek=true;seekFromEvent(e)},{passive:true});
    cvs.addEventListener('touchmove',e=>{if(isDraggingSeek){e.preventDefault();seekFromEvent(e)}},{passive:false});
    cvs.addEventListener('touchend',()=>{isDraggingSeek=false});

    el.querySelector('.track-mute-btn').addEventListener('click',()=>{track.muted=!track.muted;renderTrackListUI()});
    el.querySelector('.track-vol').addEventListener('input',e=>{track.volume=parseInt(e.target.value)/100});
    el.querySelector('.track-delete-btn').addEventListener('click',async()=>{
      await deleteTrackFromDB(track.id);trackBufferCache.delete(track.id);await loadTrackList();
    });
  });
}

function stopPreview(){
  previewSources.forEach(s=>{try{s.stop()}catch{}});
  previewSources=[];cancelAnimationFrame(previewAnimId);isPlayingPreview=false;
}

// ============================================================
// UI
// ============================================================
function updateRecUI(){
  const recording=isRecording||isCountingIn;
  document.getElementById('recStartBtn').disabled=recording;
  document.getElementById('recStopBtn').disabled=!recording;
  document.getElementById('recStartBtn').textContent=recording?'⏺ 録音中...':'⏺ 録音開始';
  document.getElementById('recStartBtn').classList.toggle('recording',recording);
}
function setStatus(msg){document.getElementById('recStatus').textContent=msg}

function setupVolumeControl(){
  const vs=document.getElementById('volumeSlider'),vi=document.getElementById('volumeIcon');
  vs.addEventListener('input',()=>updateVolIcon());
  vi.addEventListener('click',()=>{if(vs.value>0){vs.dataset.prev=vs.value;vs.value=0}else{vs.value=vs.dataset.prev||80}updateVolIcon()});
}
function updateVolIcon(){
  const v=document.getElementById('volumeSlider').value;let p='';
  if(v==0)p='<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
  else if(v<50)p='<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
  else p='<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  document.getElementById('volumeIcon').innerHTML=p;
}

// ============================================================
// 初期化
// ============================================================
async function initRecorder(){
  await openEditorDB();await openRecDB();
  if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  setStatus('読み込み中...');
  await loadPadBuffers();renderRecPads();setStatus('');
  const{bpm,bars,beats}=getSettings();

  const c=document.getElementById('recTimeline');
  drawTimeline(c,loopDuration,bpm,beats,[],null,false);

  await loadTrackList();

  document.getElementById('recStartBtn').addEventListener('click',()=>startRecording());
  document.getElementById('recStopBtn').addEventListener('click',()=>stopRecording());
  document.getElementById('allPlayBtn').addEventListener('click',()=>{if(isPlayingAll)stopAllPlayback();else playAllTracks()});

  ['bpmInput','barsInput','beatsInput'].forEach(id=>{
    document.getElementById(id).addEventListener('input',()=>{
      const s=getSettings();
      drawTimeline(document.getElementById('recTimeline'),loopDuration,s.bpm,s.beats,[],null,false);
    });
  });

  document.getElementById('metronomeToggle').addEventListener('click',()=>{
    metronomeOn=!metronomeOn;document.getElementById('metronomeToggle').classList.toggle('is-on',metronomeOn);
  });
  document.getElementById('countInToggle').addEventListener('click',()=>{
    countInOn=!countInOn;document.getElementById('countInToggle').classList.toggle('is-on',countInOn);
  });

  window.addEventListener('resize',()=>{
    const s=getSettings();
    drawTimeline(document.getElementById('recTimeline'),loopDuration,s.bpm,s.beats,[],null,false);
  });
  setupVolumeControl();updateRecUI();
}
initRecorder();
