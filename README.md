# ComfyUI-MVNT

**Music in, choreography out.** Generate full-body dance sequences from audio using [MVNT AI](https://mvnt.io) — the world's first AI system purpose-built for dance — directly inside ComfyUI.

MVNT's diffusion-based model is trained alongside 100+ professional choreographers with studio-captured motion data. It outputs production-ready .BVH / .FBX / .JSON at 60 fps with music-synced, style-aware choreography and physics-aware refinement.

## Nodes

| Node | Description |
|------|-------------|
| **MVNT Generate Dance** | Audio → full-body dance motion (BVH / FBX / JSON) |
| **MVNT Generate Character** | Image or text prompt → rigged 3D GLB character |
| **MVNT Export Video** | Character image + motion reference → photorealistic AI video |
| **MVNT List Styles** | Fetch available dance styles |
| **MVNT Estimate Cost** | Estimate credits and generation time before running |
| **MVNT Load Motion** | Load a downloaded motion file for downstream nodes |

## Installation

### Option A: ComfyUI Manager (recommended)

Search for **MVNT** in the ComfyUI Manager and click Install.

### Option B: Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/mvnt-app/ComfyUI-MVNT.git
cd ComfyUI-MVNT
pip install -r requirements.txt
```

Restart ComfyUI.

## API Key Setup

1. Get API access at [mvnt.studio](https://mvnt.studio)
2. Set the environment variable before launching ComfyUI:

```bash
export MVNT_API_KEY=mk_live_xxxxxxxxxxxxx
```

Or pass the key directly to each node via the `api_key` input.

## Quick Start

1. Add **Load Audio** → **MVNT Generate Dance** → **MVNT Load Motion**
2. Pick a style
3. Queue the workflow — the node submits audio to the MVNT API, polls for completion, and saves the motion file to `output/`

See the [`workflows/`](./workflows) folder for ready-to-use example workflows.

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
