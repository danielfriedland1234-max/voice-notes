# Voice Notes

Quick voice notes and to-do lists that run in the browser.
Plain HTML/CSS/JavaScript, no server, no build step, hosted on GitHub Pages.

- **Notes** and **To-do** tabs, each with its own list and a New button.
- Speech is turned into text by the browser's built-in speech recognition
  (on Android Chrome this is Google, so it needs an internet connection).
- While recording a to-do list, tap **New line** to start the next item
  (saying "new line" works too).
- Notes and lists are stored in the browser (IndexedDB). Backup/Restore saves them to a file
  you can keep in Google Drive.

This repository holds only code. No recordings or notes are ever stored here.

## Files

| File | What it does |
|---|---|
| `index.html` | The screens |
| `style.css` | The look |
| `app.js` | Recording, lists, editing, sharing, backup |
| `db.js` | Saves notes in the browser |
| `sw.js` | Offline support, home-screen install, auto-update |
| `version.js` | **The version number: bump it on every change** |
| `mock/` | Design mock-ups and a tiny local server (`node mock/serve.js`) |

## Publishing a change

1. Edit the files.
2. Bump the number in `version.js` (e.g. `2.0` → `2.1`).
3. Commit and push. GitHub Pages updates within a minute or two, and the app on
   your phone reloads itself with the new version next time you open it.
