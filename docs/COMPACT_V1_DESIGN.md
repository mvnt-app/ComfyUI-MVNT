# ComfyUI-MVNT — compact v1 (design)

**Branch:** `feature/compact-v1`  
**SSOT:** [mvnt-mS `API_COMPACT_CONTRACT.md`](../../mvnt-mS/docs/api/compact-v1-2026-11-10/API_COMPACT_CONTRACT.md)  
**API base:** `https://api.mvnt.studio/v1` only (no legacy fallback on compact builds)

## Goal

One thin Comfy pack that mirrors the public Quickstart:

`GET /styles` → `POST /generations` → poll → `GET …/output?format=glb|mp4` (+ `preset`, `camera_mode` for MP4).

No Tripo, T-pose image, analyze-audio, Kling profiles, internal `render-scene`, or `generate-motion-lda`.

## Nodes (ship in `__init__.py`)

| # | Node | Role | Keep / change |
| --- | --- | --- | --- |
| — | Comfy **Load Audio** | WAV in | unchanged (not our node) |
| 1 | **MVNT Audio Segment** | trim window | keep; pass `trim_start`/`trim_end` to API (seconds on **original** file or document segment-only upload) |
| 2 | **MVNT List Styles** (new) or Generate dropdown | `GET /styles` | **add** — cache names in UI |
| 3 | **MVNT Generate Dance** | create + poll + cache GLB path | **slim** — v1 only, wire trim/style/temperature |
| 4 | **MVNT Preview Dance 3D** | in-Comfy GLB view | keep |
| 5 | **MVNT Render Dance Video** | MP4 via v1 output | **rewrite** — `preset` standard\|shorts, `camera_mode` tracking\|dynamic\|idol, Bearer key required |
| — | Comfy **Save Video** / **Save GLB** | disk | unchanged |

**Remove from exports (leave code in repo until delete PR or move to `legacy/`):**

- `MVNT Image to T-Pose`
- Unregistered: Estimate, Character, Kling export, List Styles (if merged into Generate)

## `mvnt_client.py` changes

| Area | Today | compact v1 |
| --- | --- | --- |
| Base URL | v1 + `MVNT_LEGACY_API_BASE` | **`MVNT_API_BASE` only** (default `https://api.mvnt.studio/v1`) |
| Create | v1 → 401/403/404 → `create_legacy_generation` | **`create_generation` v1 only**; fail with clear error body |
| Poll | v1 / `job-lda` map | **`GET /generations/{id}` only** |
| GLB | v1 + BVH/lda paths | **`GET /generations/{id}/output?format=glb` only** |
| MP4 | internal render-scene, `render-mp4-lda`, 670×400 | **`GET …/output?format=mp4&preset=&camera_mode=`**; client timeout ≥ 900s |
| Styles | `list_styles()` exists | used by List Styles or Generate refresh |
| Dead API | `/v1/characters`, `/v1/videos`, estimate optional | **not called** from compact nodes |

Optional env:

- `MVNT_API_BASE=https://api.mvnt.studio/v1`
- `MVNT_API_KEY=mvnt_live_…` (required for Render if not passed on node)

## Node field contract (Generate)

| Field | API |
| --- | --- |
| audio bytes | `audio` multipart |
| style | from `GET /styles` name |
| trim | `trim_start`, `trim_end` (0–60s billable segment) |
| temperature | default 1.0 |
| api_key | Bearer (or env) |

Drop from compact UI (server may ignore): `model_version`, `output_format`, `preview_style`, `character_glb`, `save_hard_yaw_lock_variant`, Kling `video_profile`.

## Node field contract (Render)

| Field | Query |
| --- | --- |
| preset | `standard` (1920×1080) or `shorts` (1080×1920) |
| camera_mode | `tracking` \| `dynamic` \| `idol` (or `1`–`3`) |
| api_key | **required** (same as Generate) |

## Implementation order

1. `feature/compact-v1`: `__init__.py` — export 4 nodes (no Image T-Pose).
2. `mvnt_client.py` — flag or branch: `COMPACT_V1=1` disables legacy paths (easier local A/B).
3. Generate — trim + styles + no fallback.
4. Render — v1 MP4 only + api_key.
5. `workflows/compact_v1_api.json` — minimal graph for Manager/users.
6. README + version `2.0.0-compact` (breaking vs 1.1.x).

## Local Comfy test checklist (you)

1. Checkout branch in `ComfyUI/custom_nodes/comfyui-mvnt` (or symlink this repo).
2. `pip install -r requirements.txt` in that folder if needed.
3. Set before starting ComfyUI:

   ```bash
   set MVNT_API_KEY=mvnt_live_xxxxxxxx
   set MVNT_API_BASE=https://api.mvnt.studio/v1
   ```

4. Restart ComfyUI; confirm only **4–5 MVNT** nodes in menu (no Image T-Pose).
5. Load `workflows/compact_v1_api.json` (once added).
6. **Happy path:** short WAV → segment ≤20s → style from list → Generate → Preview 3D → Render `preset=standard`, `camera_mode=tracking` → Save MP4.
7. **GLB:** same job; optional Save GLB from generation output path.
8. **Shorts:** Render with `preset=shorts`; ffprobe **1080×1920**.
9. **Failure checks:** wrong key → clear 401 (no silent legacy job); MP4 before `completed` → error.

## Out of scope (explicit)

- Tripo retarget, image T-pose, analyze-audio, `/v1/characters`, `/v1/videos`
- Legacy MP4 (Blender 670×400), `render-mp4-lda`, `internal/comfy/render-scene`
- BVH public download

## Mintlify

When this branch is green locally: restore `integrations/comfyui.mdx` from `comfyui.archive-2026-11-12.mdx` **trimmed** to this workflow only.
