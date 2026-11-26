# Frown Watch

[![Demo: the mini window turns red when the brow stays tense](docs/demo.gif)](docs/demo.mp4)

A web app that watches your facial habits through the front camera while you watch videos. When your brow stays tense, an always-on-top mini window turns red to let you know.
All detection runs inside the browser, and **your video is never shared**.

**▶ Try it: https://taiki-jp.github.io/frown-watch/en/**

The app is available in English and Japanese ([日本語](https://taiki-jp.github.io/frown-watch/)).

## Features

- **Alerts in the moment** — Brow, forehead, eyes, mouth corners and open mouth. When tension lasts 2 seconds or more, the border of the always-on-top mini window flashes red. You can add a sound or a notification too, spaced out so they don't fire too often
- **See how your habits change** — Today's count, count per hour, and a 14-day trend. Once enough data builds up, a one-line comparison with last week appears
- **Your video is never shared** — The library and model ship with the page, and nothing is sent to any outside server. How to verify this is documented below

## How to use

1. Open https://taiki-jp.github.io/frown-watch/en/ in Chrome and press "Get started"
2. The first time, setup walks you through 5 steps
   1. Welcome — check that your environment is supported
   2. Camera — allow the front camera and check how you appear
   3. Baseline — keep a neutral face for 3 seconds; that face becomes "0"
   4. Alerts — choose sound and notifications
   5. Mini window — switch to the always-on-top mini window
3. Keep the mini window open and watch videos as usual. When your brow stays tense, the mini window turns red
4. From the second visit on, the regular screen opens. Press "Start watching" → "Open mini window" to get back to the same state

## Requirements

- Chrome 116 or later (other Chromium browsers such as Edge also work). The mini window is not available in Safari or Firefox
- A computer with a built-in camera, or an external camera
- Nothing to install. Use "Check requirements" in the app to see what's missing

## Privacy

- Front-camera video is processed only on your computer and is never shared
- The only things stored are habit counts and durations, time spent watching, and your neutral baseline. They stay in the browser's localStorage
- The detection library and model ship with the page. Nothing is loaded from outside servers

### How to verify your video isn't shared

1. Start watching with the Network tab of DevTools open. No requests happen after the initial load
2. Turn off Wi-Fi after you start watching. The app keeps working
3. The page's CSP (Content-Security-Policy) makes the browser itself block connections to anything but the page's own origin. See the meta tag at the top of `app.html` and `index.html`
4. There is no build step; the files in this repository are served as-is, so you can compare the deployed files with the repository

## Settings

- **Habits to watch** — Turn each of the 5 habits on or off
- **Sensitivity** — High, Normal or Low. If alerts fire too often, choose "Low"
- **Alerts** — Sound, notifications and the gap between them
- **Neutral baseline** — Capture it again at any time
- **Data** — Export as CSV, or delete just today's data
- **Advanced** — Adjust threshold, duration and cooldown per habit

## How it works

1. [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) estimates 478 face landmarks and 52 expression coefficients (blendshapes) on device
2. When the change from your neutral baseline stays above a threshold for the set duration, it counts as one occurrence
3. The mini window uses Chrome's Document Picture-in-Picture, so it stays on top of other apps

## For developers

### Run locally

```sh
git clone https://github.com/Taiki-jp/frown-watch.git
cd frown-watch
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://localhost:8765/ in Chrome. The camera only works over https or on localhost.

### Files

| File | Role |
|---|---|
| `index.html`, `top.js` | Top page (Japanese) and its CSS animation demo |
| `en/index.html`, `sitemap.xml` | English top page and sitemap, written by `scripts/build-pages.mjs`. Don't edit by hand |
| `docs/og-*.png` | Link preview images (Open Graph) |
| `app.html`, `app.js` | The app itself: all detection and UI |
| `i18n.js` | English and Japanese dictionaries and language switching |
| `frame-guard.js` | Stops the page when another site embeds it in an iframe (clickjacking guard) |
| `vendor/mediapipe/` | MediaPipe Tasks Vision (Apache-2.0); the version is in `vendor/NOTICE.md` |
| `vendor/models/face_landmarker.task` | Face landmark and blendshape model (Apache-2.0) |
| `vendor/NOTICE.md` | Sources and SHA-256 of bundled files |
| `test/` | Unit tests for detection logic and diagnostic values |
| `scripts/update-vendor.mjs` | Replaces `vendor/mediapipe/` with a version from npm |
| `scripts/build-pages.mjs` | Writes the top page per language, with title, description and link-preview tags from `i18n.js` |

### Tests

```sh
node test/logic.test.mjs
node test/diag.test.mjs
node test/pages.test.mjs   # fails if en/index.html or sitemap.xml is out of date
```

After editing `index.html` or the `meta.*` / top-page strings in `i18n.js`, run `node scripts/build-pages.mjs` and commit the output.

### Updating MediaPipe

A weekly GitHub Actions workflow (`.github/workflows/update-vendor.yml`) opens a PR when npm has a newer `@mediapipe/tasks-vision`, and opens an issue when a newer face model is published. Before merging, open the PR locally and check that detection still works; CI can't use a camera.

To update by hand:

```sh
node scripts/update-vendor.mjs          # latest
node scripts/update-vendor.mjs 1.2.3    # a given version
```

The script checks the tarball against npm's integrity hash before unpacking it, then rewrites `vendor/NOTICE.md`.

### URL parameters for development

Add these to `app.html`.

| Parameter | Effect |
|---|---|
| `?ob=3` | Open the 3rd setup step |
| `?open` | Expand all collapsible sections |
| `?env` | Run the requirements check |
| `?lang=en` | Open in the given language. On the top page it redirects to `/en/` |

### Raw values for detection

"Developer diagnostics" in the app lists values derived from blendshapes, landmark distance ratios, and pixels of the skin between the brows. The table is meant for exploring detection approaches.

## License

MIT License. The bundled MediaPipe and model are Apache-2.0. See `vendor/NOTICE.md` for details.
