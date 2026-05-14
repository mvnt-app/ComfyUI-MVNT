# ComfyUI-MVNT

**Music in, choreography out.** Generate dance motion from audio using [MVNT](https://mvnt.studio) inside ComfyUI.

This branch is the current MVNT `/v1` dogfood flow for ComfyUI. The main path is:

```text
Load Audio -> MVNT Audio Segment -> MVNT Generate Dance -> MVNT Preview Dance 3D
                                                        -> MVNT Render Dance Video (optional)
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
| `MVNT Generate Dance` | Sends trimmed audio to MVNT, polls the generation, and returns a previewable animated GLB path. If a compatible character GLB is connected, the preview GLB is retargeted to that character. |
| `MVNT Render Dance Video` | Optional second step that takes `dance_3d`, infers the MVNT job id, and downloads a server-rendered MP4 as a ComfyUI `VIDEO` output. |
| `MVNT Preview Dance 3D` | Shows the generated animated GLB with ComfyUI's native 3D preview output and companion audio controls. |

### Internal Legacy Code

Older helper nodes still exist in `nodes.py` for reference, but they are not registered in ComfyUI. The menu intentionally exposes only the four primary dogfood nodes above.

## Example Workflows

Ready-to-use workflow templates live in [`workflows/`](./workflows). Drag a `.json` file into ComfyUI to load it.

| Workflow | Description |
| --- | --- |
| [`mvnt_4_2_music_to_3d_dance.json`](./workflows/mvnt_4_2_music_to_3d_dance.json) | `MVNT4.2: music_to_3d_dance` featured workflow: music -> animated 3D dance GLB, Comfy 3D preview, and optional 670x400 MP4 reference video. |
| [`mvnt_audio_to_dance.json`](./workflows/mvnt_audio_to_dance.json) | Smallest useful test: load audio, select a segment, generate MVNT dance outputs. |
| [`mvnt_image_to_tpose.json`](./workflows/mvnt_image_to_tpose.json) | Load a source character image and generate a T-pose image. |
| [`mvnt_full_ms_review_flow.json`](./workflows/mvnt_full_ms_review_flow.json) | Cleaned team-review graph for the full mS handoff: audio, T-pose, Tripo, MVNT dance, preview, and Kling handoff. |

Do not commit personal exported workflows. ComfyUI exports often include local filenames, absolute output paths, and pasted API keys. Shared workflows should leave `LoadImage`, `LoadAudio`, and API key widget values blank unless the referenced file is intentionally part of the repo.

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
2. Load [`workflows/mvnt_4_2_music_to_3d_dance.json`](./workflows/mvnt_4_2_music_to_3d_dance.json), or create this chain manually:

```text
Load Audio
  -> MVNT Audio Segment
  -> MVNT Generate Dance
  -> MVNT Preview Dance 3D
  -> MVNT Render Dance Video (optional MP4)
```

3. In `MVNT Audio Segment`, choose a start time and duration. MVNT generation is capped at 40 seconds.
4. In `MVNT Generate Dance`, choose a style.
5. Connect `dance_3d` to `MVNT Preview Dance 3D` for fast 3D review.
6. Only connect `dance_3d` to `MVNT Render Dance Video` when you need the slower server MP4.
7. Queue the workflow.

Expected outputs under `ComfyUI/output/`:

```text
mvnt_<generation_id>.motion.glb
mvnt_<generation_id>.dance.fetch.mp4  # only when MVNT Render Dance Video runs
```

`MVNT Generate Dance` intentionally does not expose start/end controls. Segment selection belongs in `MVNT Audio Segment`.
It also intentionally does not return `VIDEO`; MP4 rendering is separated so fast GLB preview does not wait on Blender rendering.

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

`MVNT Render Dance Video` exposes `video_profile`:

- `pretty`: main MVNT/Comfy video output with the mvnt-mS toon studio look.
- `kling`: reference-video output using a deterministic mannequin style for motion transfer.

The node requests `670x400 @ 30fps` MP4 output from the backend. The server-side Blender camera is tuned for full-body reference framing: feet should stay visible, the camera is wider than the 3D preview, and root travel is partially preserved instead of pinning hips exactly to the center.

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

Use [`workflows/mvnt_full_ms_review_flow.json`](./workflows/mvnt_full_ms_review_flow.json) for team review. It is a cleaned copy of the current full graph: API keys are blank, local paths are removed, and input filenames are placeholders.

For a spoken handoff, read [`docs/MVNT_COMFY_HANDOFF_kr.md`](./docs/MVNT_COMFY_HANDOFF_kr.md). For the API/server call map, read [`docs/MVNT_API_SERVER_FLOW_kr.md`](./docs/MVNT_API_SERVER_FLOW_kr.md).

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
- Live legacy/render fallback: `https://api.mvnt.studio`
- Sandbox candidate: `https://api-sandbox.mvnt.world/v1`

Override the API base with:

```bash
export MVNT_API_BASE=https://api-sandbox.mvnt.world/v1
```

Some helper/debug nodes also expose an `api_base` field.

Operational note: current Comfy dogfood calls try the `/v1` API shape first, but generation, GLB download, retarget, and MP4 render still rely on the live `api.mvnt.studio` legacy/render paths when `/v1` output is unavailable.

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
