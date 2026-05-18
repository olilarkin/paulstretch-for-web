# Paul's Extreme Sound Stretch (Web)

A browser port of [Paulstretch](https://www.paulnasca.com/algorithms-created-by-me) — the extreme time-stretch effect Nasca Octavian Paul originally wrote for offline use. This version runs entirely in the browser, streams the stretched output in real time through an `AudioWorklet`, and exposes the full processing chain (spectral filter, harmonics, octave mixer, pitch/frequency shift, tonal–noise separation, compressor, spread, free-form EQ curve, binaural beats).

Live build: <https://olilarkin.github.io/paulstretch2026/>

![screenshot placeholder](public/screenshot.png)

## Features

- **Real-time streaming** — stretched audio is generated in a worker, written into a `SharedArrayBuffer` ring, and consumed by an `AudioWorklet`. No pre-render step; sliders respond within ~100 ms.
- **Stretch / HyperStretch / Shorten** modes with adjustable FFT window size and type.
- **Process tab** — harmonics, pitch & frequency shift, octave mixer, band filter with high-frequency damping, tonal/noise emphasis, spectral compressor, spread, and an arbitrary-curve EQ. A live spectrum analyzer (log-spaced bargraph with peak-hold) sits behind the EQ curve.
- **Stretch envelope** — draw a per-position multiplier on the base stretch factor.
- **Binaural beats** — modulate left/right channels with a drawn frequency curve.
- **Offline render** — write the full stretched output to a WAV file via a separate render worker.
- **Drag-and-drop** WAV / FLAC / OGG / MP3 loading.

## Running locally

```bash
npm ci
npm run dev
```

Open <http://localhost:5173>. Vite's dev server sets the COOP/COEP headers automatically.

To produce a production build:

```bash
npm run build
npm run preview
```

### `@olilarkin/paulstretch-wasm`

The DSP runs in a WebAssembly module published to GitHub Packages. `.npmrc` points `@olilarkin/*` at `npm.pkg.github.com`; `npm ci` needs a `GITHUB_TOKEN` (or `NODE_AUTH_TOKEN`) with `read:packages` scope in your environment to authenticate.

## Cross-origin isolation

Paulstretch's streaming engine uses `SharedArrayBuffer`, which requires the page to be cross-origin isolated. That means the host must send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite's `server` and `preview` blocks in `vite.config.ts` set these for local dev. GitHub Pages can't, so `public/coi-serviceworker.js` re-serves responses with the right headers on first reload of the deployed site.

## Deployment

`.github/workflows/deploy.yml` builds the project on push to `main` and publishes `dist/` to the `gh-pages` branch via `peaceiris/actions-gh-pages`. The workflow needs a `GH_PACKAGES_TOKEN` secret with `read:packages` scope to pull the WASM dependency.

## Project layout

```
src/
  audio/
    streaming/        # engine + worker + worklet + SAB ring buffer
    render/           # offline WAV render worker
    loadFile.ts       # decode WAV/FLAC/OGG/MP3 via WebAudio
  components/         # React UI (tabs, parameter panels, BPF editor)
  state/store.ts      # Zustand store
  styles.css
```

## Tech stack

- React + TypeScript + Vite
- Zustand for state
- [`@olilarkin/paulstretch-wasm`](https://github.com/olilarkin/paulstretch-wasm) — the C++ Paulstretch core compiled to WebAssembly with SIMD
- AudioWorklet + SharedArrayBuffer for glitch-free streaming

## Tests

```bash
npm test
```

Vitest covers the ring buffer, sync glue, envelope interpolation, and file loader.

## Credits

- **Nasca Octavian Paul** — original Paulstretch algorithm.
- **Oli Larkin** — web port and UI.

## License

GPL-2.0. See [`LICENSE`](LICENSE).
