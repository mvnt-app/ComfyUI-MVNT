# ComfyUI-MVNT

**Music in, choreography out.** Generate dance motion from audio using [MVNT](https://mvnt.studio) inside ComfyUI.

This branch is the current MVNT `/v1` dogfood flow for ComfyUI. The main path is:

```text
Load Audio -> MVNT Audio Segment -> MVNT Generate Dance -> MVNT Preview Dance 3D
```

Optional character flows can prepare a T-pose image and connect a compatible rigged GLB/model to `MVNT Generate Dance`.

## Demo

### MVNT + Kling AI - Motion Transfer

https://github.com/user-attachments/assets/mvnt_kling_usecase.mp4

Audio -> AI dance choreography -> photorealistic video via Kling motion transfer

https://github.com/mvnt-app/ComfyUI-MVNT/releases/download/v1.1.0/mvnt_kling_usecase.mp4

### MVNT Studio - AI Dance Generation

https://github.com/mvnt-app/ComfyUI-MVNT/releases/download/v1.1.0/mS-demo-comp_480.mov

K-pop quality dance from any music track in about 15 seconds.

## Nodes

### Primary Dogfood Nodes

| Node | What it does |
| --- | --- |
| `MVNT Audio Segment` | Selects the audio segment sent to MVNT. Duration is capped at 40 seconds. |
| `MVNT Image to T-Pose` | Converts a source character image into a front-facing T-pose image through Tripo. |
| `MVNT Generate Dance` | Sends trimmed audio to MVNT, polls the generation, downloads a previewable GLB and server-rendered MP4. |
| `MVNT Preview Dance 3D` | Shows the generated animated GLB with ComfyUI's native 3D preview output and companion audio controls. |

### Helper And Legacy-Compatible Nodes

These remain registered so older workflows do not load with missing nodes.

| Node | What it does |
| --- | --- |
| `MVNT List Styles` | Fetches style metadata from the MVNT API. |
| `MVNT Estimate Cost` | Estimates generation cost/time for a given audio duration. |
| `MVNT Generate Character` | Legacy/helper character generation wrapper. |
| `MVNT Export Video` | Legacy/helper video export wrapper. |
| `MVNT Load Motion` | Loads a local motion file for downstream nodes. |
| `MVNT Preview BVH` | Renders a simple stick-figure BVH preview as image frames. |

## Example Workflows

Ready-to-use workflow templates live in [`workflows/`](./workflows). Drag a `.json` file into ComfyUI to load it.

| Workflow | Description |
| --- | --- |
| [`mvnt_audio_to_dance.json`](./workflows/mvnt_audio_to_dance.json) | Smallest useful test: load audio, select a segment, generate MVNT dance outputs. |
| [`mvnt_image_to_tpose.json`](./workflows/mvnt_image_to_tpose.json) | Load a source character image and generate a T-pose image. |

Do not commit personal exported workflows. ComfyUI exports often include local filenames, absolute output paths, and pasted API keys.

## Installation

### ComfyUI Manager

Search for **MVNT** in ComfyUI Manager and install it.

### Comfy Registry

```bash
comfy node registry-install comfyui-mvnt
```

### Manual Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/mvnt-app/ComfyUI-MVNT.git comfyui-mvnt
cd comfyui-mvnt
python3 -m pip install -r requirements.txt
```

Restart ComfyUI after installation.

For local development, point ComfyUI at this checkout:

```bash
cd /path/to/ComfyUI/custom_nodes
ln -s /path/to/ComfyUI-MVNT comfyui-mvnt
```

## API Keys

Set your MVNT API key before launching ComfyUI:

```bash
export MVNT_API_KEY=mvnt_test_xxxxxxxxxxxxx
```

Or paste the key directly into the `api_key` field on nodes that expose it.

Accepted MVNT key prefixes:

- `mvnt_live_`
- `mvnt_test_`
- `mk_live_` legacy compatibility
- `mk_test_` legacy compatibility

`MVNT Image to T-Pose` also needs Tripo credentials:

```bash
export TRIPO_API_KEY=your_tripo_key_here
```

Never commit real keys in workflow JSON. If a key is accidentally committed, revoke it immediately.

## Quick Start

### Audio To Dance

1. Put an audio file in `ComfyUI/input/`.
2. Load [`workflows/mvnt_audio_to_dance.json`](./workflows/mvnt_audio_to_dance.json), or create this chain manually:

```text
Load Audio
  -> MVNT Audio Segment
  -> MVNT Generate Dance
  -> MVNT Preview Dance 3D
```

3. In `MVNT Audio Segment`, choose a start time and duration. MVNT generation is capped at 40 seconds.
4. In `MVNT Generate Dance`, choose a style and optional `video_profile`.
5. Queue the workflow.

Expected outputs under `ComfyUI/output/`:

```text
mvnt_<generation_id>.motion.glb
mvnt_<generation_id>.dance.mp4
```

`MVNT Generate Dance` intentionally does not expose start/end controls. Segment selection belongs in `MVNT Audio Segment`.

### Image To T-Pose

1. Put a character image in `ComfyUI/input/`.
2. Load [`workflows/mvnt_image_to_tpose.json`](./workflows/mvnt_image_to_tpose.json).
3. Set `TRIPO_API_KEY`, or paste the key into `tripo_api_key`.
4. Queue the workflow.

The node returns a ComfyUI `IMAGE`, saves the generated T-pose image, and returns the Tripo task id.

### Optional Character GLB

If you already have a compatible rigged character GLB/model, connect it to `character_glb` on `MVNT Generate Dance`.

When `character_glb` is connected:

1. MVNT first generates the normal motion GLB.
2. The node asks the backend retargeter to apply that motion to the character.
3. The `dance_3d` output becomes the retargeted animated GLB.

This flow targets Tripo-style GLB assets. Meshy compatibility is not a target for this pass.

## Video Profiles

`MVNT Generate Dance` exposes `video_profile`:

- `pretty`: main MVNT/Comfy video output with the mvnt-mS toon studio look.
- `kling`: reference-video output using a deterministic mannequin style for motion transfer.

The MP4 length comes from the generated/trimmed audio segment and the backend render endpoint. The Comfy node does not intentionally clip video to 90 frames.

## Full mS / Kling Workflows

Some internal handoff workflows combine MVNT, Tripo, Kling, and Comfy video nodes:

```text
audio + character image
  -> T-pose image
  -> Tripo model + rig
  -> MVNT dance generation
  -> 3D preview / server MP4
  -> Kling motion control video
```

Those are demo blueprints, not clean package examples. Before loading or sharing one:

- remove all API keys
- replace local filenames with files under your own `ComfyUI/input/`
- remove absolute paths such as `C:/Users/...`
- expect missing nodes unless Tripo/Kling custom nodes are installed

## API

The nodes wrap the MVNT Motion API.

| Endpoint | Description |
| --- | --- |
| `POST /v1/generations` | Submit audio, optional character file, and generation settings. |
| `GET /v1/generations/:id` | Poll generation status. |
| `GET /v1/generations/:id/output` | Download motion, 3D, or preview/video outputs. |
| `GET /v1/styles` | List available dance styles. |
| `POST /v1/estimate` | Estimate cost and generation time. |

Default environments:

- Production: `https://api.mvnt.world/v1`
- Sandbox: `https://api-sandbox.mvnt.world/v1`

Override the API base with:

```bash
export MVNT_API_BASE=https://api-sandbox.mvnt.world/v1
```

Some helper/debug nodes also expose an `api_base` field.

## Credit Model

For the ComfyUI dogfood flow, downloads are treated as included outputs of a generation. Credits should be charged for generation work, not for repeatedly downloading an already-created artifact.

Recommended v1 behavior:

- `MVNT Generate Dance` consumes credits when it generates motion.
- Basic preview and downloads are included.
- Advanced retargeting, high-quality toon render, or longer video render may become add-on credit events later.

## Troubleshooting

### Old MVNT Nodes Still Show Up

If you see nodes such as `MVNT Dance Generate`, `MVNT Dance Poll`, or `MVNT Dance (All-in-One)`, ComfyUI is loading an older MVNT custom node package.

Remove or rename the old custom node folder/symlink, then restart ComfyUI.

### Missing Tripo Or Kling Nodes

The core MVNT audio-to-dance workflow does not require Tripo or Kling.

Full demo workflows may require additional custom nodes such as `TripoImageToModelNode`, `TripoRigNode`, `KlingMotionControl`, and `SaveVideo`.

### Preview 3D Looks Different Across ComfyUI Versions

`MVNT Preview Dance 3D` uses ComfyUI's native preview output instead of importing private hashed frontend bundles. This avoids version-specific breakage, but the exact 3D viewer UI is controlled by your ComfyUI build.

## Links

- [MVNT](https://mvnt.io)
- [MVNT Studio](https://mvnt.studio)
- [MVNT API Docs](https://mvnt.io/docs)
- [Unreal Dance Editor](https://www.fab.com/listings/fd957cfb-c5af-4b22-a195-334548feb80d)

## License

MIT
