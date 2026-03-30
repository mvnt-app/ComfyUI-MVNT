# ComfyUI-MVNT

**Music in, choreography out.** Generate full-body dance sequences from audio using [MVNT AI](https://mvnt.io) — the world's first AI system purpose-built for dance — directly inside ComfyUI.

MVNT's diffusion-based model is trained alongside 100+ professional choreographers with studio-captured motion data. It outputs production-ready .BVH / .FBX / .JSON at 60 fps with music-synced, style-aware choreography and physics-aware refinement.

## Demo

### MVNT + Kling AI — Motion Transfer

https://github.com/user-attachments/assets/mvnt_kling_usecase.mp4

> Audio → AI dance choreography → photorealistic video via Kling motion transfer

https://github.com/mvnt-app/ComfyUI-MVNT/releases/download/v1.1.0/mvnt_kling_usecase.mp4

### MVNT Studio — AI Dance Generation

https://github.com/mvnt-app/ComfyUI-MVNT/releases/download/v1.1.0/mS-demo-comp_480.mov

> K-pop quality dance from any music track in ~15 seconds

## Nodes

| Node | Description |
|------|-------------|
| **MVNT Generate Dance** | Audio → full-body dance motion (BVH / FBX / JSON) |
| **MVNT Generate Character** | Image or text prompt → rigged 3D GLB character |
| **MVNT Export Video** | Character image + motion reference → photorealistic AI video |
| **MVNT Preview BVH** | Render stick-figure animation from BVH → IMAGE frames |
| **MVNT List Styles** | Fetch available dance styles |
| **MVNT Estimate Cost** | Estimate credits and generation time before running |
| **MVNT Load Motion** | Load a downloaded motion file for downstream nodes |

## Example Workflows

Ready-to-use workflows are in the [`workflows/`](./workflows) folder. Drag any `.json` file into ComfyUI to load it.

| Workflow | Description |
|----------|-------------|
| [Audio to Dance](./workflows/mvnt_audio_to_dance.json) | Basic: load audio → generate dance → view BVH data |
| [Dance with Preview](./workflows/mvnt_dance_with_preview.json) | Generate dance + render stick-figure preview as IMAGE frames |
| [Full Music Video](./workflows/mvnt_full_music_video.json) | End-to-end: audio → dance → 3D character → AI video export |
| [Compare Styles](./workflows/mvnt_compare_styles.json) | Side-by-side Male vs Female dance from the same audio |

## Installation

### Option A: ComfyUI Manager (recommended)

Search for **MVNT** in the ComfyUI Manager and click Install.

### Option B: Comfy Registry

```bash
comfy node registry-install comfyui-mvnt
```

### Option C: Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/mvnt-app/ComfyUI-MVNT.git
cd ComfyUI-MVNT
pip install -r requirements.txt
```

Restart ComfyUI.

## API Key Setup

1. Request API access at [hello@mvnt.world](mailto:hello@mvnt.world) or join the [Discord](https://discord.gg/fKFExR3yWy) — early access is available now
2. Set the environment variable before launching ComfyUI:

```bash
export MVNT_API_KEY=mk_live_xxxxxxxxxxxxx
```

Or pass the key directly to each node via the `api_key` input.

> API keys use the prefix `mk_live_` for production and `mk_test_` for sandbox testing.

## Quick Start

### Simple: Audio → Dance

1. Add **Load Audio** → **MVNT Generate Dance** → **MVNT Load Motion**
2. Pick a style (All / Male / Female)
3. Queue — the node submits audio to the MVNT API, polls for completion, and saves the motion file to `output/`

### With Preview

Chain **MVNT Load Motion** → **MVNT Preview BVH** → **PreviewImage** to see a stick-figure animation of the choreography directly in ComfyUI.

### Full Music Video Pipeline

1. **Load Audio** → **MVNT Generate Dance** (produces BVH motion)
2. **Load Image** → **MVNT Generate Character** (creates rigged 3D character from any photo)
3. **MVNT Export Video** (combines character + motion into a photorealistic AI video)

## API

The nodes wrap the [MVNT Motion API](https://mvnt.io/docs) — a REST API with webhook support and async job processing.

| Endpoint | Description |
|----------|-------------|
| `POST /v1/generations` | Submit audio for dance generation |
| `GET /v1/generations/:id` | Poll generation status |
| `GET /v1/generations/:id/output` | Download BVH / FBX / JSON output |
| `POST /v1/characters` | Generate rigged 3D character from image or text |
| `POST /v1/videos` | Motion-transfer video export |
| `GET /v1/styles` | List available dance styles |
| `POST /v1/estimate` | Estimate cost and generation time |

**Environments:**
- Production: `https://api.mvnt.world/v1`
- Sandbox: `https://api-sandbox.mvnt.world/v1`

For integration support, reach out at hello@mvnt.world.

## Links

- [MVNT](https://mvnt.io) — Product & research
- [MVNT Studio](https://mvnt.studio) — Creative suite for AI dance
- [MVNT API Docs](https://mvnt.io/docs) — API reference
- [Unreal Dance Editor](https://www.fab.com/listings/fd957cfb-c5af-4b22-a195-334548feb80d) — Dance generation native in Unreal Engine

## License

MIT
