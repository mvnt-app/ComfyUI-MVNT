# ComfyUI-MVNT

**Music in. Choreography out.**

Generate 3D dance motion from any audio file using [MVNT Dance Intelligence](https://mvnt.studio) — directly inside ComfyUI.

[![Registry](https://img.shields.io/badge/Comfy%20Registry-comfyui--mvnt-blue)](https://registry.comfy.org/nodes/comfyui-mvnt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Demo

https://github.com/user-attachments/assets/2fcde3de-5bd5-4fe6-8931-72198dee9ace

---

## What It Does (compact v1, 2.0.0-compact)

ComfyUI-MVNT mirrors the public MVNT quickstart on `https://api.mvnt.studio/v1` only:
`GET /styles` -> `POST /generations` -> poll `GET /generations/{id}` -> `GET /generations/{id}/output?format=glb|mp4`.

No legacy fallback, Tripo/T-pose, Kling profiles, BVH or internal render routes on this branch
(`MVNT_COMPACT_V1=0` re-enables the old fallback in `mvnt_client.py` for local A/B only).

## Nodes

| Node | What it does |
|---|---|
| `MVNT Audio Segment` | Optional, **not in the default workflow**. Trim now lives in `MVNT Generate Dance` (`trim_start`/`trim_end`). |
| `MVNT List Styles` | `GET /v1/styles`; outputs JSON and one style name per line. |
| `MVNT Generate Dance` | Uploads audio (`trim_start`/`trim_end` in seconds, `trim_end` 0 = whole clip), polls, downloads the animated GLB. |
| `MVNT Preview Dance 3D` | Shows the GLB in ComfyUI's 3D preview with audio. |
| `MVNT Render Dance Video` | `format=mp4` with `preset` (`standard` 1920x1080 / `shorts` 1080x1920) and `camera_mode` (`tracking`/`dynamic`/`idol`). Synchronous, can take minutes. |

```text
Load Audio -> MVNT Generate Dance -> MVNT Preview Dance 3D
                                          -> MVNT Render Dance Video -> Save Video
```

Load [`workflows/compact_v1_api.json`](./workflows/compact_v1_api.json) for this graph (default trim 0-20 s on `MVNT Generate Dance`;
`MVNT Audio Segment` was removed from the default graph to avoid trimming twice).

---

## Installation

### ComfyUI Manager (recommended)

Search **MVNT** in ComfyUI Manager → Install.

### Comfy Registry

```bash
comfy node registry-install comfyui-mvnt
```

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/mvnt-app/ComfyUI-MVNT.git comfyui-mvnt
cd comfyui-mvnt
pip install -r requirements.txt
```

Restart ComfyUI after installation.

---

## API Key

Get your API key at [mvnt.studio](https://mvnt.studio).

Set it as an environment variable before launching ComfyUI:

```bash
export MVNT_API_KEY=mvnt_live_xxxxxxxxxxxxx
```

Or paste it into the `api_key` field of `MVNT Generate Dance` / `MVNT Render Dance Video`.

> **Never commit API keys in workflow JSON.** If a key is accidentally committed, revoke it immediately from your MVNT dashboard.

---

## Quick Start

1. Set `MVNT_API_KEY` (from the MVNT Platform) and optionally `MVNT_API_BASE=https://api.mvnt.studio/v1`, then start ComfyUI.
2. Load `workflows/compact_v1_api.json` and pick a WAV in `Load Audio`.
3. Queue. Outputs land in `ComfyUI/output/`:

```text
mvnt_<id>.motion.glb
mvnt_<id>.<preset>.<camera_mode>.mp4   # only when MVNT Render Dance Video is connected
```

Wrong key returns a plain 401 error; there is no silent fallback to another API.

---

## Troubleshooting

**`api.mvnt.world` connection timeout**
The live API is `https://api.mvnt.studio`. Unset `MVNT_API_BASE` if it still points at world, then restart ComfyUI.

**Old MVNT nodes showing up (`MVNT Dance Generate`, `MVNT Dance (All-in-One)`)**
Remove or rename the old custom node folder and restart ComfyUI.

**Missing Tripo or Kling nodes**
The core audio-to-dance flow has no dependency on Tripo or Kling.
Full character workflows may require those custom nodes separately.

**3D preview looks different across ComfyUI versions**
`MVNT Preview Dance 3D` uses ComfyUI's native 3D preview. The exact viewer UI
depends on your ComfyUI build version.

**`Could not resolve Load3d module ... Failed to fetch dynamically imported module .../assets/load3dService-*.js`**
The in-node viewer imports Comfy frontend's internal hashed `load3dService-<hash>.js` chunk, whose name changes every
frontend release (seen on Comfy Desktop v0.45.3). The extension now discovers the real name at runtime
(loaded resources, then the entry bundle, then the asset manifest) and no longer hard-codes hashes.
If it still fails, the node shows a download link for the GLB and an audio player instead of the 3D viewer.
The GLB is always saved as `ComfyUI/output/mvnt_<id>.motion.glb`, and `MVNT Render Dance Video` (MP4) does not depend on the viewer.
Workarounds: update the extension (`git pull`), hard-refresh the Comfy window (Ctrl+Shift+R) after a Comfy update,
or open the saved GLB in any glTF viewer / Comfy's own `Load3D` node.

---

## Links

- 🌐 [Platform](https://mvnt.studio/platform)
- 📖 [Docs](https://mvnt.studio/docs)
- 🎮 [Unreal Dance Editor on FAB](https://www.fab.com/listings/fd957cfb-c5af-4b22-a195-334548feb80d)
- 🗂 [Comfy Registry](https://registry.comfy.org/nodes/comfyui-mvnt)

---

## License

MIT
