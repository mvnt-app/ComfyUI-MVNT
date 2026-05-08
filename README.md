# ComfyUI-MVNT

**Music in, choreography out.** Generate dance motion from audio using [MVNT](https://mvnt.studio) inside ComfyUI.

> **Work in progress:** this custom node is being updated for MVNT's `/v1` API dogfood flow. The stable first target is `MVNT Generate Dance`: audio input, optional Tripo-style GLB/model input, motion output, and optional 3D/video preview outputs.

## Demo

### MVNT + Kling AI — Motion Transfer

https://github.com/user-attachments/assets/mvnt_kling_usecase.mp4

> Audio → AI dance choreography → photorealistic video via Kling motion transfer

https://github.com/mvnt-app/ComfyUI-MVNT/releases/download/v1.1.0/mvnt_kling_usecase.mp4

### MVNT Studio — AI Dance Generation

https://github.com/mvnt-app/ComfyUI-MVNT/releases/download/v1.1.0/mS-demo-comp_480.mov

> K-pop quality dance from any music track in ~15 seconds

## Current Nodes

| Node | Description |
|------|-------------|
| **MVNT Audio Segment** | Audio → MVNT-ready audio segment. Duration is capped at 40 seconds. |
| **MVNT Image to T-Pose** | Source character image → T-pose character image using Tripo's internal T-pose regeneration. |
| **MVNT Generate Dance** | Trimmed audio → previewable motion/animated GLB plus server-rendered MP4. A Tripo-style GLB can be connected as optional character input. |
| **MVNT Preview Dance 3D** | Animated GLB path + source audio → interactive 3D preview with synced playback. |

Not shown in Comfy for this pass:

- `MVNT Load Motion`
- `MVNT Preview BVH`
- `MVNT List Styles`
- `MVNT Estimate Cost`
- `MVNT Export Video`

Those helpers are still in the codebase for debugging/history, but the product-facing node list stays focused on image prep, audio prep, and dance generation.

## Example Workflows

Ready-to-use workflows are in the [`workflows/`](./workflows) folder. Drag any `.json` file into ComfyUI to load it.

| Workflow | Description |
|----------|-------------|
| [Audio to Dance](./workflows/mvnt_audio_to_dance.json) | Current simple workflow: load audio → generate MVNT dance outputs |
| [Image to T-Pose](./workflows/mvnt_image_to_tpose.json) | Load source character image → generate T-pose character image |

Other workflow files in this repo are legacy concept examples from the earlier multi-node version. Update them before relying on them in this simplified pass.

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
export MVNT_API_KEY=mvnt_live_xxxxxxxxxxxxx
```

Or pass the key directly to each node via the `api_key` input.

> API keys use the prefix `mvnt_live_` for production and `mvnt_test_` for sandbox testing. Legacy `mk_live_` and `mk_test_` keys remain accepted by the node while older test keys exist.

## Quick Start

### Simple: Audio → Dance

1. Set `MVNT_API_KEY` before launching ComfyUI.
2. Add **Load Audio** → **MVNT Audio Segment** → **MVNT Generate Dance**.
3. In `MVNT Audio Segment`, choose the segment length and position with the two horizontal bars. Duration is capped at 40 seconds.
4. Pick a style (`#K-Pop / All`, `#K-Pop / Boy`, `#K-Pop / Girl`, `#Challenge`, `#Poppin`, `#Hip-hop`, `#Krump`, or `#Jazz`).
5. Paste your API key into `api_key`, or leave it empty if `MVNT_API_KEY` is already set.
6. Queue. The node submits the trimmed audio to the MVNT API, polls for completion, and saves `.glb` and `.mp4` outputs under `ComfyUI/output/`.

`MVNT Generate Dance` intentionally does not expose start/end controls. Audio segment selection belongs before the MVNT node, using `MVNT Audio Segment`. This keeps the generation node compact and closer to Comfy's modular workflow style.

### Image Character → T-Pose Image

Use the [Image to T-Pose](./workflows/mvnt_image_to_tpose.json) workflow when the user starts from a normal character image and needs a front-facing T-pose image.

This workflow does not require local OpenPose, ControlNet, or checkpoint setup. The conversion is handled by **MVNT Image to T-Pose**, which internally calls Tripo's T-pose image regeneration.

1. Load the original character image with **Source Character Image**.
2. Connect it to **MVNT Image to T-Pose**.
3. Set `TRIPO_API_KEY` before launching ComfyUI, or paste the key into `tripo_api_key`.
4. Queue the workflow. The node returns a ComfyUI `IMAGE` output and saves the generated T-pose image under `ComfyUI/output/`.

### Optional 3D Character Input

If a compatible Tripo-style `GLB` or model file is connected, `MVNT Generate Dance` first generates the normal MVNT motion GLB, then asks the backend Tripo retargeter to apply that motion to the connected character. The `dance_3d` output becomes the retargeted Tripo animated GLB for Comfy's 3D preview. It does not silently return FBX/BVH in the `dance_3d` slot.

`video_profile` controls the server render look:

- `pretty`: main MVNT/Comfy video output. It keeps the character texture/color and uses the mvnt-mS toon studio look.
- `kling`: reference-video output. It uses a deterministic gray mannequin style with the same camera and light rig.

`MVNT Generate Dance` returns two outputs:

- `dance_3d`: local GLB file path for 3D preview/retarget workflows.
- `dance_video`: local MP4 file path saved under `ComfyUI/output/`.

Use `dance_3d` together with the source/trimmed audio in **MVNT Preview Dance 3D** for review. Use `dance_video` for nodes that accept a local MP4 path string. If a downstream video node requires Comfy's native `VIDEO` object, load or convert the MP4 with that node's expected video loader first.

The MP4 render is not intentionally capped at 90 frames by the Comfy node. The node requests the server-rendered MP4 for the generated job; the actual length comes from the generated/trimmed audio segment and the backend render endpoint. If you see a 90-frame video, that usually means the requested render duration was about 3 seconds at 30fps, not that Comfy clipped the output.

MVNT's dance node does not reshape a raw image by itself. For image-to-character flows, prepare a T-pose image first, generate or rig the character with your preferred character tool, then connect the resulting GLB/model file to `character_glb`.

```text
Load Image
  -> Image to T-Pose workflow
  -> character generation / rigging tool
      -> character_glb/model_file

Load Audio
  -> MVNT Audio Segment
  -> MVNT Generate Dance
      optional character_glb/model_file <- rigged character output from Tripo or another character tool
      api_key <- paste mvnt_test_/mvnt_live_ key, or legacy mk_test_/mk_live_ key during dogfood
      outputs:
        dance_3d
        dance_video

dance_3d + audio
  -> MVNT Preview Dance 3D
```

Meshy compatibility is not a target for this pass.

## Sharing Workflows And Presets

The workflow `.json` files in this repo are safe review templates only when they keep API keys empty and use placeholder input filenames such as `input/my_song.wav`.

Do not share a personal ComfyUI preset/workflow as-is if it contains:

- local absolute file paths from your machine
- private API keys
- paid third-party service keys
- user-specific image/audio/video filenames

For team review, export a cleaned workflow with empty key fields and replace local assets with placeholder names.

## API

The nodes wrap the [MVNT Motion API](https://mvnt.io/docs) — a REST API with webhook support and async job processing.

| Endpoint | Description |
|----------|-------------|
| `POST /v1/generations` | Submit audio, optional character file, and generation settings |
| `GET /v1/generations/:id` | Poll generation status |
| `GET /v1/generations/:id/output` | Download motion, 3D, or preview/video outputs |
| `GET /v1/styles` | List available dance styles |
| `POST /v1/estimate` | Estimate cost and generation time |

**Environments:**
- Production: `https://api.mvnt.world/v1`
- Sandbox: `https://api-sandbox.mvnt.world/v1`

You can override the API base with either:

- the `MVNT_API_BASE` environment variable
- an `api_base` input on helper/debug nodes that expose it

The current platform UI creates `mk_live_` and `mk_test_` keys. The node also accepts the planned `mvnt_live_` / `mvnt_test_` prefixes for compatibility with future API key naming.

## Credit Model

For the custom node dogfood flow, downloads are treated as included outputs of a generation. Credits should be charged for API generation work, not for repeatedly downloading an already-created artifact.

Recommended v1 behavior:

- `MVNT Generate Dance` consumes credits when it generates motion.
- Basic preview and downloads are included.
- Advanced retargeting, high-quality toon render, or longer video render may become add-on credit events later.

For integration support, reach out at hello@mvnt.world.

## Links

- [MVNT](https://mvnt.io) — Product & research
- [MVNT Studio](https://mvnt.studio) — Creative suite for AI dance
- [MVNT API Docs](https://mvnt.io/docs) — API reference
- [Unreal Dance Editor](https://www.fab.com/listings/fd957cfb-c5af-4b22-a195-334548feb80d) — Dance generation native in Unreal Engine

## License

MIT
