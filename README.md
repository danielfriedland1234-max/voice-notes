# Voice Notes

A private voice transcription app that runs entirely in the browser.
Plain HTML/CSS/JavaScript, no server, no build step, hosted on GitHub Pages.

- **Private mode** (default): speech is turned into text on the device by
  [Whisper](https://github.com/openai/whisper) via
  [Transformers.js](https://github.com/huggingface/transformers.js). Audio never leaves the device.
- **Fast mode** (optional): uses the browser's built-in speech recognition (audio goes to Google).
- Transcripts are stored in the browser (IndexedDB). Backup/Restore saves them to a file
  you can keep in Google Drive.

This repository holds only code. No recordings or transcripts are ever stored here.

## Files

| File | What it does |
|---|---|
| `index.html` | The screens |
| `style.css` | The look |
| `app.js` | Recording, list, editing, sharing, backup |
| `db.js` | Saves transcripts in the browser |
| `whisper-worker.js` | Runs the Whisper speech model |
| `sw.js` | Offline support, home-screen install, auto-update |
| `version.js` | **The version number: bump it on every change** |

## Publishing a change

1. Edit the files.
2. Bump the number in `version.js` (e.g. `1.0` → `1.1`).
3. Commit and push. GitHub Pages updates within a minute or two, and the app on
   your phone reloads itself with the new version next time you open it.
