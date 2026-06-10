# Projector — Project Brief

**One-liner:** A desktop app that connects to your GitHub account, clones any Expo / React Native app you're working on, runs it locally, and projects it into an interactive iPhone cutout on your PC or laptop — like Expo Go, but living on your desk instead of your phone.

---

## 1. Problem

Developers building Expo / React Native apps constantly want to *see and poke at* the current state of a branch — theirs or a teammate's — without the ritual of: pull the branch, install deps, start Metro, grab a phone, scan a QR code. On Windows and Linux there's no iOS Simulator at all, so "what does this look like on an iPhone?" means owning Apple hardware or pushing builds to a cloud service.

## 2. Solution

Projector is a cross-platform Electron desktop app that:

1. **Signs in to GitHub** (OAuth device flow — no secrets shipped in the app).
2. Lets you **pick a repo and branch** from your account or orgs.
3. **Clones and runs it automatically** — detects the package manager (npm / yarn / pnpm / bun), installs dependencies, and starts the Expo dev server with the web target (`expo start --web`, powered by react-native-web).
4. **Renders the running app inside a pixel-accurate iPhone frame** — bezel, Dynamic Island, status bar — with full touch emulation (correct viewport, devicePixelRatio, user agent, and touch events via the Chrome DevTools Protocol).
5. Gives you **developer controls** around the frame: branch switcher, pull-latest, reload, console log panel, and device model picker.

Mouse interactions on the cutout behave like fingers: click = tap, drag = swipe, scroll wheel = momentum scroll. Expo's Fast Refresh keeps the preview live while the dev server runs.

## 3. Target user

**Developers** (initially: us). This is a dev tool, not a client-preview tool — so branch switching, logs, and fast iteration take priority over polish-for-stakeholders. A simplified "preview mode" for non-developers is a possible later phase.

## 4. Core user flow

```
Launch Projector
  → Sign in with GitHub (one-time device-flow code)
  → Pick repo → pick branch
  → Projector clones, installs, starts Expo web
  → App appears inside the iPhone cutout
  → Interact, switch branches, pull new commits, read logs
```

Target: **under 90 seconds** from picking a repo to a live, touchable app (excluding first-time dependency install).

## 5. Architecture

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** (main + renderer) | Full access to git, Node, and child processes; cross-platform; mature ecosystem. |
| UI | **React + TypeScript + Vite** | Fast iteration; the team already lives in React. |
| GitHub auth | **OAuth device flow** | No client secret in the binary; works behind firewalls. |
| Git ops | `simple-git` (system git) | Clone, fetch, checkout, pull; battle-tested. |
| App runtime | **Expo web target** (react-native-web) via spawned `npx expo start --web` | Runs RN apps on any OS — no Mac, no simulator, no cloud cost. |
| Device frame | Electron `WebContentsView` + CDP emulation | `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled` give a faithful iPhone viewport with real touch events. |
| Logs | CDP `Runtime.consoleAPICalled` + dev-server stdout | Console panel without instrumenting the user's app. |

**Process model:** the Electron main process owns auth tokens, git operations, and the spawned Expo dev server (one per project, port-managed). The renderer is pure UI; it talks to main over typed IPC.

## 6. MVP scope (Phase 1)

- [ ] GitHub sign-in via device flow; token stored in the OS keychain
- [ ] Repo & branch picker (user repos + org repos, search)
- [ ] Clone → detect package manager → install → start `expo start --web`
- [ ] Readiness detection (wait for dev server, surface install/build errors clearly)
- [ ] iPhone cutout (one model, e.g. iPhone 15 Pro) with touch emulation
- [ ] Reload button, branch switcher, "pull latest" button
- [ ] Console log panel (app logs + dev-server output)
- [ ] Project list — remember previously opened repos, cached clones

## 7. Phase 2 candidates

- Multiple device models (SE, Pro Max, iPad) and rotation
- Commit timeline — preview any historical commit, not just branch tips
- Auto-refresh when new commits land on the watched branch (polling)
- Network request inspector
- Monorepo support (pick the app directory inside the repo)
- Side-by-side frames (compare two branches)
- Light/dark mode + locale/timezone overrides for the framed app
- Cloud simulator integration (e.g. Appetize) for full native fidelity

## 8. Known constraints & risks

1. **react-native-web fidelity.** Native-only modules (camera, Bluetooth, some gesture handlers) don't run on the web target. *Mitigation:* surface clear per-module warnings; Phase 2 cloud-simulator escape hatch for full fidelity.
2. **Non-Expo bare RN repos** may lack web support. *Mitigation:* detect on clone and explain exactly what's missing rather than failing silently.
3. **Install times** on first open. *Mitigation:* keep clones and `node_modules` cached per repo + lockfile hash; show real progress, not a spinner.
4. **Apple trade dress.** The frame should be an *evocative* generic smartphone cutout (notch/island, rounded bezel) rather than a literal trademarked iPhone rendering, especially if ever distributed.

## 9. Success criteria

- A developer on a Windows or Linux laptop with **no Apple hardware** can interact with an Expo app branch within 90 seconds of picking it.
- Switching branches takes one click and < 15 seconds on a warm cache.
- Zero manual terminal usage for the core flow.

## 10. Proposed stack summary

`Electron · React · TypeScript · Vite · simple-git · Expo CLI (spawned) · react-native-web (in target apps) · electron-builder`
