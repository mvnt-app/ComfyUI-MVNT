# ComfyUI-MVNT

**Music in. Choreography out.**

Generate 3D dance motion from any audio file using [MVNT Dance Intelligence](https://mvnt.studio) — directly inside ComfyUI.

[![Registry](https://img.shields.io/badge/Comfy%20Registry-comfyui--mvnt-blue)](https://registry.comfy.org/nodes/comfyui-mvnt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Demo

https://github.com/user-attachments/assets/2fcde3de-5bd5-4fe6-8931-72198dee9ace

---

## What It Does

ComfyUI-MVNT connects ComfyUI to the [MVNT Motion API](https://mvnt.studio/docs),
which generates music-conditioned choreography from audio input.

Drop in a track → choose a style → get an animated GLB and reference MP4 out.
Works standalone or as part of larger character pipelines (Tripo, Kling, etc.).

---

## Nodes

| Node | What it does |
|---|---|
| `MVNT Audio Segment` | Selects the audio segment to send. Duration capped at 40 seconds. |
| `MVNT Generate Dance` | Sends audio to MVNT, polls generation, returns an animated GLB. Optionally retargets motion to a connected character GLB. |
| `MVNT Preview Dance 3D` | Shows the animated GLB in ComfyUI's native 3D preview with companion audio controls. |
| `MVNT Image to T-Pose` | Converts a character image into a front-facing T-pose via MVNT preprocessing — for use as a retargeting reference. |
| `MVNT Render Dance Video` | Downloads a server-rendered MP4 from the generated dance. Two profiles: `pretty` (toon studio look) and `kling` (mannequin reference for motion transfer). |

---

## Main Flow

```text
Load Audio
  → MVNT Audio Segment
  → MVNT Generate Dance
  → MVNT Preview Dance 3D          ← fast 3D review
  → MVNT Render Dance Video        ← optional MP4
```

Optional character flow:

```text
character image → MVNT Image to T-Pose
character GLB   → MVNT Generate Dance (retargeted output)
```

---

## Example Workflows

Drag any `.json` from [`workflows/`](./workflows) into ComfyUI to load it.

| Workflow | Description |
|---|---|
| [`MVNT4.2 - music_to_3d_dance.json`](./workflows/MVNT4.2%20-%20music_to_3d_dance.json) | Core flow: audio → animated GLB → 3D preview + optional MP4. |
| [`mvnt_audio_to_dance.json`](./workflows/mvnt_audio_to_dance.json) | Minimal test: audio → dance output. |
| [`mvnt_image_to_tpose.json`](./workflows/mvnt_image_to_tpose.json) | Character image → T-pose image. |

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

Or paste it directly into the `api_key` field on any node that exposes it.

> **Never commit API keys in workflow JSON.** If a key is accidentally committed, revoke it immediately from your MVNT dashboard.

---

## Quick Start

1. Add an audio file to `ComfyUI/input/`
2. Load `workflows/MVNT4.2 - music_to_3d_dance.json`
3. In `MVNT Audio Segment`, set start time and duration (max 40s)
4. In `MVNT Generate Dance`, choose a dance style
5. Queue — outputs land in `ComfyUI/output/`:

```text
mvnt_<id>.motion.glb
mvnt_<id>.dance.fetch.mp4   # only when MVNT Render Dance Video is connected
```

---

## Character Retargeting

Connect a rigged GLB to `character_glb` on `MVNT Generate Dance`.
MVNT generates the base motion, then retargets it to your character automatically.
The `dance_3d` output becomes the retargeted animated GLB.

Works with Tripo-style GLB assets.

---

## Advanced: Kling Motion Transfer

For AI video workflows, use `video_profile: kling` in `MVNT Render Dance Video`
to get a deterministic mannequin-style MP4 suitable as a motion reference for Kling.

```text
audio + character image
  → MVNT T-pose + Tripo model
  → MVNT Generate Dance
  → MVNT Render Dance Video (kling profile)
  → Kling motion control video
```

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

---

## Links

- 🌐 [Platform](https://mvnt.studio/platform)
- 📖 [Docs](https://mvnt.studio/docs)
- 🎮 [Unreal Dance Editor on FAB](https://www.fab.com/listings/fd957cfb-c5af-4b22-a195-334548feb80d)
- 🗂 [Comfy Registry](https://registry.comfy.org/nodes/comfyui-mvnt)

---

## License

MIT
