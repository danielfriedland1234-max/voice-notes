// Voice Notes: main app logic.
(() => {
  const $ = id => document.getElementById(id);
  const VERSION = self.APP_VERSION;
  const MODEL_SIZES = { base: '80 MB', tiny: '45 MB' };

  const state = {
    busy: false,          // true while recording or transcribing (we don't auto-reload then)
    recording: false,
    pendingReload: false,
    openId: null,
    lastAudio: null,      // kept so "Try again" works if transcription fails
    appendTo: null,       // id of the transcript being continued (null = make a new one)
  };

  // ---------- Settings (stored in this browser only) ----------
  const settings = {
    get mode() { return read('mode', 'private'); },
    set mode(v) { write('mode', v); },
    get model() { return read('model', 'base'); },
    set model(v) { write('model', v); },
    isDownloaded(m) { return read('downloaded-' + m, '') === '1'; },
    markDownloaded(m) { write('downloaded-' + m, '1'); },
  };
  function read(k, d) { try { return localStorage.getItem('vn-' + k) || d; } catch { return d; } }
  function write(k, v) { try { localStorage.setItem('vn-' + k, v); } catch {} }

  // ---------- Small helpers ----------
  const fmtDate = iso => new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2500);
  }
  function setStatus(msg) { $('status').textContent = msg || ''; }
  function setProgress(fraction) {
    $('progress').hidden = fraction == null;
    if (fraction != null) $('progress-bar').style.width = Math.round(fraction * 100) + '%';
  }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {}
  }

  function setBusy(b) {
    state.busy = b;
    keepAwake(b);
    if (!b && state.pendingReload) location.reload();
  }

  // ---------- Screens ----------
  function show(view) {
    for (const v of ['home', 'detail', 'settings']) $(v).hidden = v !== view;
    window.scrollTo(0, 0);
  }
  // Use browser history so the phone's Back button closes a screen instead of the app.
  function go(view, id) {
    history.pushState({ view, id }, '');
    render(view, id);
  }
  function render(view, id) {
    if (view === 'detail') openDetail(id);
    else if (view === 'settings') { renderSettings(); show('settings'); }
    else {
      state.openId = null;
      if (!state.busy) state.appendTo = null;
      placeRecorder(false);
      show('home');
      renderList();
    }
  }

  // The record button normally sits on the home screen. When continuing a
  // transcript it moves into the transcript screen so the text stays in view.
  const recorderInDetail = () => $('recorder').parentElement.id === 'detail-recorder-slot';
  function placeRecorder(inDetail) {
    $(inDetail ? 'detail-recorder-slot' : 'home-recorder-slot').append($('recorder'));
    $('recorder').classList.toggle('compact', inDetail);
    $('continue').hidden = inDetail;
    if (!state.recording) setRecordingUI(false);
  }
  window.addEventListener('popstate', e => {
    const s = e.state || {};
    render(s.view || 'home', s.id);
  });

  // ---------- Transcript list ----------
  async function renderList() {
    const items = await DB.all();
    const list = $('list');
    list.textContent = '';
    for (const it of items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'item';
      const d = document.createElement('span');
      d.className = 'item-date';
      d.textContent = fmtDate(it.createdAt);
      const t = document.createElement('span');
      t.className = 'item-text';
      t.textContent = it.text || '(empty)';
      btn.append(d, t);
      btn.onclick = () => go('detail', it.id);
      li.append(btn);
      list.append(li);
    }
    $('empty').hidden = items.length > 0;
  }

  // ---------- Detail screen ----------
  let saveTimer;
  async function openDetail(id) {
    const it = await DB.get(id);
    if (!it) { render('home'); return; }
    state.openId = id;
    $('detail-date').textContent = fmtDate(it.createdAt);
    $('detail-text').value = it.text;
    $('save-state').textContent = it.updatedAt !== it.createdAt ? 'Edited ' + fmtDate(it.updatedAt) : '';
    placeRecorder(state.busy && state.appendTo === id);
    show('detail');
  }

  // "Continue recording": record more and add it to the end of this transcript.
  $('continue').onclick = async () => {
    await saveDetailNow();
    state.appendTo = state.openId;
    placeRecorder(true);
    startRecording();
  };
  async function saveDetailNow() {
    clearTimeout(saveTimer);
    if (!state.openId) return;
    const it = await DB.get(state.openId);
    if (!it || it.text === $('detail-text').value) return;
    it.text = $('detail-text').value;
    it.updatedAt = new Date().toISOString();
    await DB.put(it);
    $('save-state').textContent = 'Saved';
  }
  $('detail-text').addEventListener('input', () => {
    $('save-state').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDetailNow, 600);
  });
  $('detail-text').addEventListener('blur', saveDetailNow);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = $('detail-text');
      ta.focus(); ta.select();
      document.execCommand('copy');
    }
    toast('Copied');
  }
  $('copy').onclick = () => copyText($('detail-text').value);
  $('share').onclick = async () => {
    const text = $('detail-text').value;
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (e) { if (e.name !== 'AbortError') copyText(text); }
    } else {
      copyText(text);
    }
  };
  $('delete').onclick = async () => {
    if (!confirm('Delete this transcript? This cannot be undone.')) return;
    clearTimeout(saveTimer);
    await DB.remove(state.openId);
    state.openId = null;
    toast('Deleted');
    history.back();
  };
  $('back').onclick = () => { saveDetailNow(); history.back(); };

  // ---------- Settings screen ----------
  const hasFastMode = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  function renderSettings() {
    for (const r of document.querySelectorAll('input[name=mode]')) {
      r.checked = r.value === settings.mode;
      if (r.value === 'fast' && !hasFastMode) {
        r.disabled = true;
        r.nextElementSibling.lastChild.textContent = ' Not available in this browser.';
      }
    }
    for (const r of document.querySelectorAll('input[name=model]')) r.checked = r.value === settings.model;
  }
  for (const r of document.querySelectorAll('input[name=mode]')) r.onchange = () => { settings.mode = r.value; updateHome(); };
  for (const r of document.querySelectorAll('input[name=model]')) r.onchange = () => { settings.model = r.value; updateHome(); preloadModel(); };
  $('open-settings').onclick = () => go('settings');
  $('settings-back').onclick = () => history.back();

  function updateHome() {
    const priv = settings.mode === 'private' || !hasFastMode;
    $('mode-badge').textContent = priv ? '🔒 Private mode: stays on this phone' : '⚡ Fast mode: voice is sent to Google';
    $('model-size').textContent = MODEL_SIZES[settings.model];
    $('model-card').hidden = !priv || settings.isDownloaded(settings.model);
  }

  // ---------- Whisper (private mode) ----------
  let worker = null;
  let workerResolve = null, workerReject = null;
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('whisper-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        setStatus(settings.isDownloaded(settings.model)
          ? `Loading speech model… ${Math.round((data.loaded / data.total) * 100)}%`
          : `Downloading speech model… ${Math.round(data.loaded / 1048576)} of ${Math.round(data.total / 1048576)} MB`);
        setProgress(data.loaded / data.total);
      } else if (data.type === 'ready') {
        settings.markDownloaded(data.model);
        setProgress(null);
        updateHome();
        if (!state.busy) setStatus('Speech model ready');
      } else if (data.type === 'working') {
        startProcessingTimer();
      } else if (data.type === 'result') {
        workerResolve && workerResolve(data.text);
      } else if (data.type === 'error') {
        setProgress(null);
        if (workerReject) workerReject(new Error(data.message));
        else setStatus('Could not load the speech model. Check your internet connection and try again.');
      }
    };
    worker.onerror = e => {
      if (workerReject) workerReject(new Error(e.message || 'Worker failed to start'));
      else setStatus('Could not start the speech model. Check your internet connection.');
      worker = null;
    };
    return worker;
  }

  function preloadModel() {
    getWorker().postMessage({ type: 'load', model: settings.model });
  }
  $('download-model').onclick = () => {
    $('download-model').disabled = true;
    setStatus('Starting download…');
    preloadModel();
  };

  let processingTimer;
  function startProcessingTimer() {
    const start = Date.now();
    clearInterval(processingTimer);
    const tick = () => setStatus(`Turning speech into text… ${Math.round((Date.now() - start) / 1000)}s`);
    tick();
    processingTimer = setInterval(tick, 1000);
  }

  function whisperTranscribe(audio) {
    return new Promise((resolve, reject) => {
      workerResolve = resolve;
      workerReject = reject;
      // Send a copy so the original stays available for "Try again".
      const copy = audio.slice();
      getWorker().postMessage({ type: 'transcribe', model: settings.model, audio: copy, id: newId() }, [copy.buffer]);
    }).finally(() => {
      workerResolve = workerReject = null;
      clearInterval(processingTimer);
    });
  }

  // Convert a recording into 16 kHz mono samples, the format Whisper expects.
  async function decodeTo16k(blob) {
    const buf = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    try {
      const audio = await ctx.decodeAudioData(buf);
      if (audio.numberOfChannels === 1) return audio.getChannelData(0);
      const a = audio.getChannelData(0), b = audio.getChannelData(1);
      const mono = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) mono[i] = (a[i] + b[i]) / 2;
      return mono;
    } finally {
      ctx.close();
    }
  }

  function cleanWhisperText(t) {
    return applyVoiceCommands(t.replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)\]/gi, '').replace(/\s+/g, ' '));
  }

  // Spoken commands: saying "new line" starts a new line.
  // "Buy milk. New line. Call the dentist." becomes "Buy milk.\nCall the dentist."
  function applyVoiceCommands(t) {
    return t
      .replace(/[,;:]?[ \t]*\bnew[ -]?line\b[ \t.,;:!?]*/gi, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n([a-z])/g, (m, c) => '\n' + c.toUpperCase()) // capital letter after a new line
      .replace(/^[ \t]+|[ \t]+$/g, '');
  }

  // ---------- Recording ----------
  let media = null, recorder = null, chunks = [], timer = null, startedAt = 0;
  let recognition = null, finals = [], interim = '';

  function setRecordingUI(on) {
    $('record').classList.toggle('recording', on);
    $('record').setAttribute('aria-label', on ? 'Stop recording' : 'Start recording');
    if (!on) $('record-label').textContent = recorderInDetail() ? 'Tap to record more' : 'Tap to record';
  }

  function startTimer() {
    startedAt = Date.now();
    const tick = () => ($('record-label').textContent = '● ' + fmtTime((Date.now() - startedAt) / 1000) + ' – tap to stop');
    tick();
    timer = setInterval(tick, 500);
  }

  async function startRecording() {
    $('retry').hidden = true;
    state.lastAudio = null;
    const priv = settings.mode === 'private' || !hasFastMode;
    try {
      if (priv) await startWhisperRecording();
      else startFastRecording();
    } catch (e) {
      setBusy(false);
      setRecordingUI(false);
      state.recording = false;
      setStatus(e.name === 'NotAllowedError'
        ? 'Microphone blocked. Tap the icon left of the address bar, allow the microphone, then try again.'
        : 'Could not start recording: ' + e.message);
      return;
    }
    state.recording = true;
    setBusy(true);
    setRecordingUI(true);
    startTimer();
  }

  async function startWhisperRecording() {
    media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    chunks = [];
    recorder = new MediaRecorder(media);
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.start(1000);
    setStatus(settings.isDownloaded(settings.model) ? 'Listening…' : 'Listening… (the speech model will download in the background)');
    preloadModel(); // gets the model ready while you talk
  }

  async function stopWhisperRecording() {
    await new Promise(r => { recorder.onstop = r; recorder.stop(); });
    media.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType });
    recorder = media = null;
    setStatus('Preparing audio…');
    const audio = await decodeTo16k(blob);
    state.lastAudio = audio;
    await transcribeAndSave(audio);
  }

  async function transcribeAndSave(audio) {
    $('record').disabled = true;
    $('retry').hidden = true;
    setBusy(true);
    if (!settings.isDownloaded(settings.model)) setStatus('Waiting for the speech model to download…');
    try {
      const text = cleanWhisperText(await whisperTranscribe(audio));
      state.lastAudio = null;
      setStatus('');
      if (!text) { state.appendTo = null; toast('No speech heard. Try again closer to the mic.'); return; }
      await saveResult(text, 'private', audio.length / 16000);
    } catch (e) {
      setStatus('Something went wrong: ' + e.message + '. Your recording is kept, tap "Try again".');
      $('retry').hidden = false;
    } finally {
      setProgress(null);
      $('record').disabled = false;
      setBusy(false);
      // Done (unless it failed and "Try again" is showing): put the record button back.
      if (!state.lastAudio && recorderInDetail()) placeRecorder(false);
    }
  }
  $('retry').onclick = () => state.lastAudio && transcribeAndSave(state.lastAudio);

  // Fast mode: the browser's built-in recogniser (audio is sent to Google).
  function startFastRecording() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    finals = []; interim = '';
    recognition = new SR();
    recognition.lang = (navigator.language || '').startsWith('en') ? navigator.language : 'en-US';
    recognition.interimResults = true;
    // One phrase per session, restarted automatically. This avoids repeated
    // words that Android Chrome produces in "continuous" mode.
    recognition.continuous = false;
    recognition.onresult = e => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      showLive();
    };
    recognition.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setStatus('Microphone blocked. Allow the microphone for this site and try again.');
        stopRecording();
      } else if (e.error === 'network') {
        setStatus('Fast mode needs an internet connection. Switch to Private mode in Settings to work offline.');
        stopRecording();
      }
    };
    recognition.onend = () => {
      if (interim) { finals.push(interim.trim()); interim = ''; }
      if (state.recording && recognition) { try { recognition.start(); } catch {} }
      else if (recognitionDone) { recognitionDone(); recognitionDone = null; }
    };
    recognition.start();
    $('live-text').hidden = false;
    $('live-text').textContent = '';
    setStatus('Listening…');
  }
  function showLive() {
    $('live-text').textContent = applyVoiceCommands([...finals, interim].filter(Boolean).join(' '));
  }
  let recognitionDone = null;
  async function stopFastRecording() {
    const rec = recognition;
    await new Promise(r => {
      recognitionDone = r;
      try { rec.stop(); } catch { r(); }
      setTimeout(r, 2500); // don't hang if the browser never says it's finished
    });
    recognition = null;
    $('live-text').hidden = true;
    const text = applyVoiceCommands(finals.filter(Boolean).join(' ').replace(/\s+/g, ' '));
    setStatus('');
    if (!text) state.appendTo = null, toast('No speech heard. Try again.');
    else await saveResult(text, 'fast', (Date.now() - startedAt) / 1000);
    if (recorderInDetail()) placeRecorder(false);
  }

  async function stopRecording() {
    if (!state.recording) return;
    state.recording = false;
    clearInterval(timer);
    setRecordingUI(false);
    try {
      if (recorder) await stopWhisperRecording();
      else if (recognition) await stopFastRecording();
    } catch (e) {
      setStatus('Could not process the recording: ' + e.message);
    } finally {
      if (!$('record').disabled) setBusy(false);
    }
  }

  $('record').onclick = () => {
    if (state.recording) return stopRecording();
    if (!recorderInDetail()) state.appendTo = null; // home screen = new transcript
    startRecording();
  };

  // Save the result: add it to the transcript being continued, or make a new one.
  async function saveResult(text, mode, seconds) {
    const id = state.appendTo;
    state.appendTo = null;
    const it = id && await DB.get(id);
    if (!it) return saveNew(text, mode, seconds);
    const onScreen = state.openId === id && !$('detail').hidden;
    if (onScreen) { clearTimeout(saveTimer); it.text = $('detail-text').value; } // include any unsaved edits
    const before = it.text.replace(/[ \t]+$/, '');
    // Join with a space, unless either side is already a new line.
    const joiner = !before || before.endsWith('\n') || text.startsWith('\n') ? '' : ' ';
    it.text = before + joiner + text;
    it.updatedAt = new Date().toISOString();
    it.seconds = (it.seconds || 0) + Math.round(seconds);
    await DB.put(it);
    toast('Added to transcript');
    if (onScreen) {
      const ta = $('detail-text');
      ta.value = it.text;
      ta.scrollTop = ta.scrollHeight;
      $('save-state').textContent = 'Saved';
    } else {
      go('detail', id);
    }
  }

  async function saveNew(text, mode, seconds) {
    // A new transcript starts with a capital letter, not a blank line.
    text = text.replace(/^\n+/, '').replace(/^[a-z]/, c => c.toUpperCase());
    const now = new Date().toISOString();
    const item = { id: newId(), createdAt: now, updatedAt: now, text, mode, seconds: Math.round(seconds) };
    await DB.put(item);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    toast('Saved');
    go('detail', item.id);
  }

  // ---------- Backup & restore ----------
  $('backup').onclick = async () => {
    const items = await DB.all();
    if (!items.length) { toast('Nothing to back up yet'); return; }
    const data = JSON.stringify({ app: 'voice-notes', appVersion: VERSION, exportedAt: new Date().toISOString(), transcripts: items }, null, 1);
    const name = `voice-notes-backup-${new Date().toISOString().slice(0, 10)}.txt`;
    // Saved as .txt because Android's share menu accepts text files (it refuses .json).
    const file = new File([data], name, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Voice Notes backup' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup file downloaded');
  };

  $('restore').onclick = () => $('restore-file').click();
  $('restore-file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'voice-notes' || !Array.isArray(data.transcripts)) throw new Error('not a Voice Notes backup');
      let added = 0, updated = 0, kept = 0;
      for (const t of data.transcripts) {
        if (!t || !t.id || typeof t.text !== 'string' || !t.createdAt) continue;
        const existing = await DB.get(t.id);
        if (!existing) { await DB.put(t); added++; }
        else if ((t.updatedAt || '') > (existing.updatedAt || '')) { await DB.put(t); updated++; }
        else kept++;
      }
      toast(`Restored: ${added} added, ${updated} updated, ${kept} already here`);
    } catch (err) {
      toast('Could not restore: ' + err.message);
    }
  };

  // ---------- Auto-update ----------
  // The service worker (sw.js) lets the app open offline and install to the home
  // screen. Whenever a new version is published, the phone fetches it, and the
  // page reloads itself (waiting until you're not recording).
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // On first install we still reload once, so the speed-up headers take effect.
      if (!hadController && self.crossOriginIsolated) return;
      if (state.busy) state.pendingReload = true;
      else location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      setInterval(check, 15 * 60 * 1000);
    }).catch(() => {});
  }

  // ---------- Start ----------
  for (const el of document.querySelectorAll('.app-version')) el.textContent = VERSION;
  // Tell the user when the app has just updated itself to a new version.
  const seen = read('seen-version', '');
  if (seen && seen !== VERSION) setTimeout(() => toast('Updated to v' + VERSION), 300);
  write('seen-version', VERSION);
  history.replaceState({ view: 'home' }, '');
  updateHome();
  renderList();
  // If the model was downloaded before, warm it up now so the first recording is quick.
  if ((settings.mode === 'private' || !hasFastMode) && settings.isDownloaded(settings.model)) preloadModel();

  // Exposed for testing only.
  window.VoiceNotes = { transcribeAndSave, decodeTo16k, state, placeRecorder, applyVoiceCommands };
})();
