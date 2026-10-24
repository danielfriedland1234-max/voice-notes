// Runs the Whisper speech model inside the browser, in a background thread
// so the screen stays responsive. Audio never leaves the device: the only
// network traffic is the one-off download of the library and model files.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6';

env.allowLocalModels = false; // always fetch the model from Hugging Face (then cached on the phone)
// Use several processor cores when the browser allows it (see sw.js).
if (self.crossOriginIsolated) {
  env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
}

const MODELS = {
  base: 'Xenova/whisper-base.en',
  tiny: 'Xenova/whisper-tiny.en',
};

let current = null; // { key, promise }

function load(key) {
  if (current && current.key === key) return current.promise;
  const files = {};
  const promise = pipeline('automatic-speech-recognition', MODELS[key], {
    dtype: 'q8',      // smaller "quantized" model: much less to download, nearly the same accuracy
    device: 'wasm',   // runs on the CPU, works on every modern phone
    progress_callback: p => {
      if (p.status === 'progress' && p.total) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        let loaded = 0, total = 0;
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
        self.postMessage({ type: 'progress', loaded, total });
      }
    },
  });
  current = { key, promise };
  promise.catch(() => { if (current && current.promise === promise) current = null; });
  return promise;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data.model);
      self.postMessage({ type: 'ready', model: data.model });
    } else if (data.type === 'transcribe') {
      const transcriber = await load(data.model);
      self.postMessage({ type: 'ready', model: data.model });
      self.postMessage({ type: 'working' });
      const out = await transcriber(data.audio, { chunk_length_s: 30, stride_length_s: 5 });
      self.postMessage({ type: 'result', id: data.id, text: out.text || '' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: String(err && err.message || err) });
  }
};
