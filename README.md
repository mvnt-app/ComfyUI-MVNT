# ComfyUI-MVNT

Generate AI dance choreography from music using the [MVNT Motion API](https://mvnt.world/docs) inside ComfyUI.

![MVNT](https://mvnt.world/icon.png)

## Nodes

| Node | Description |
|------|-------------|
| **MVNT Generate Dance** | Upload audio → get BVH / FBX / JSON dance motion |
| **MVNT List Styles** | Fetch available dance styles (All, Male, Female, …) |
| **MVNT Estimate Cost** | Estimate credits & generation time for a given duration |
| **MVNT Generate Character** | Image or text prompt → rigged 3D GLB character |
| **MVNT Export Video** | Character image + motion video → photorealistic AI video |
| **MVNT Load Motion** | Load a downloaded motion file for downstream nodes |

## Installation

### Option A: ComfyUI Manager (recommended)

Search for **MVNT** in the ComfyUI Manager and click Install.

### Option B: Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/nicejoonjung/ComfyUI-MVNT.git
cd ComfyUI-MVNT
pip install -r requirements.txt
```

Restart ComfyUI.

## API Key Setup

1. Get an API key at [mvnt.world/docs/console](https://mvnt.world/docs/console)
2. Set the environment variable before launching ComfyUI:

```bash
export MVNT_API_KEY=mk_live_xxxxxxxxxxxxx
```

Or pass the key directly to each node via the `api_key` input.

## Quick Start

1. Add **Load Audio** → **MVNT Generate Dance** → **MVNT Load Motion**
2. Pick a style (All / Male / Female)
3. Run the workflow — the node submits audio to the MVNT API, polls for completion, and saves the motion file to `output/`

See the `workflows/` folder for ready-to-use example workflows.

## Pricing

Generation costs depend on audio duration. Use the **MVNT Estimate Cost** node to check before running. See [mvnt.world/docs/pricing](https://mvnt.world/docs/pricing) for details.

## Links

- [MVNT API Docs](https://mvnt.world/docs)
- [MVNT Studio](https://mvnt.studio)
- [API Reference](https://mvnt.world/docs/api-reference)

## License

MIT
