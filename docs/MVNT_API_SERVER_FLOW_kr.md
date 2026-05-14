# MVNT ComfyUI API / 서버 호출 흐름

이 문서는 ComfyUI-MVNT가 어느 API를 호출하는지 팀원이 빠르게 이어받기 위한 서버 흐름 메모입니다. 실서버 SSH/systemd/nginx 정리는 아직 별도 작업 전이므로, 여기서는 코드 기준 호출 흐름과 주의점만 정리합니다.

## 1. 기본 API base

`mvnt_client.py` 기준 기본값은 다음과 같습니다.

- 새 API 기본값: `https://api.mvnt.world/v1`
- 현재 legacy/live fallback 기본값: `https://api.mvnt.studio`
- retarget 기본값: `MVNT_RETARGET_API_BASE`가 없으면 legacy/live base를 사용
- Tripo 기본값: `TRIPO_API_BASE`가 없으면 Tripo API base 사용

운영 기준으로는 `api.mvnt.studio`가 현재 live backend입니다. `api.mvnt.world`는 `/v1` 공개 API shape 후보로 남아 있지만, Comfy dogfood에서는 legacy/live fallback을 실제로 자주 탑니다.

환경변수로 바꿀 수 있습니다.

```bash
MVNT_API_BASE=...
MVNT_LEGACY_API_BASE=...
MVNT_RETARGET_API_BASE=...
TRIPO_API_BASE=...
```

## 2. Generate Dance 호출 흐름

`MVNT Generate Dance`는 대략 이렇게 움직입니다.

```text
AUDIO
  -> _save_audio_to_temp()
  -> mvnt_client.create_generation()
      -> POST /v1/generations
      -> 아직 /v1이 없거나 legacy 응답이면 /generate-motion-lda fallback
  -> mvnt_client.poll_generation()
  -> _download_glb_output()
  -> optional retarget_tripo_glb()
  -> dance_3d path 반환
```

현재 generation 요청은 mS frontend와 맞추기 위해 다음 성격의 값을 보냅니다.

- `mode="standard"`
- `temperature=1.2`
- `save_hard_yaw_lock_variant=True`
- style label은 backend token으로 변환
- preview style은 mannequin 기준

`MVNT Generate Dance`는 MP4를 렌더하지 않습니다. MP4는 별도 `MVNT Render Dance Video` 노드를 연결했을 때만 요청합니다.

## 3. GLB / hard yaw output

중요한 부분은 GLB 다운로드입니다. legacy `/download-glb-lda`가 baseline BVH 기반 GLB를 만들 수 있어서, Comfy 쪽은 hard-yaw variant를 더 우선합니다.

현재 흐름은 다음과 같습니다.

```text
/download-bvh-lda/{job_id}?variant=hard_yaw_lock
  -> hard-yaw BVH 확보
/export-glb-bvh-lda
  -> hard-yaw BVH를 GLB로 export
```

이렇게 만든 GLB를 `dance_3d`로 사용합니다.

## 4. Optional MP4 render

`MVNT Render Dance Video`는 `dance_3d` 파일명에서 job id를 추론합니다.

```text
dance_3d = mvnt_<job_id>.motion.glb
  -> _job_id_from_generated_dance_path()
  -> _download_video_output()
  -> /render-mp4-lda or /v1 output fallback
  -> mvnt_<job_id>.dance.fetch.mp4
  -> InputImpl.VideoFromFile(...)
  -> dance_video
```

현재 Comfy 노드의 MP4 요청값은 `670x400 @ 30fps`입니다. width/height/fps는 사용자 위젯으로 노출하지 않습니다. 서버 Blender 렌더 쪽에서 카메라 거리, 발/머리 여유, hips partial follow smoothing을 조정해서 Kling/reference video에 필요한 전신과 이동감을 보존하는 방향입니다.

## 5. Retarget 호출 흐름

`character_glb`가 연결되면, 먼저 일반 MVNT motion GLB를 만들고 그 뒤 retarget을 호출합니다.

```text
motion_glb + character_glb
  -> POST /retarget-tripo-glb
  -> mvnt_<generation_id>.tripo_retargeted.glb
  -> dance_3d
```

이 endpoint는 Tripo-style GLB를 대상으로 합니다. 캐릭터 skeleton/forward axis가 다르면 preview camera나 retarget quality 검증이 필요합니다.

## 6. T-pose image 호출 흐름

`MVNT Image to T-Pose`는 MVNT generation 키가 아니라 Tripo 키를 사용합니다.

```text
source image
  -> Tripo upload
  -> Tripo generate_image / T-pose regeneration task
  -> poll task
  -> output image download
```

따라서 팀원이 이 노드를 실행하려면 `TRIPO_API_KEY`가 필요합니다.

## 7. 실서버 포트/레거시 정리 원칙

실서버에서 8005, 8001, 8004 같은 포트가 섞여 있다면 바로 삭제하지 않습니다. 먼저 서비스맵을 만들어야 합니다.

정리 순서 권장:

1. SSH 접속 경로, systemd service 이름, working directory 확인
2. nginx/proxy가 어떤 hostname/path를 어떤 포트로 보내는지 확인
3. 8001이 LDA inference, 8004가 render lane, 8005가 남아 있다면 public API facade인지 확정
4. mS frontend 호출 endpoint와 Comfy 호출 endpoint를 나란히 비교
5. 최근 로그에서 실제 사용 중인 endpoint 확인
6. 안 쓰는 legacy endpoint 후보를 표시
7. stage/dev에서 제거 검증 후 prod 반영

현재 단계에서는 레거시 삭제보다 문서화와 route map 확정이 먼저입니다.

## 8. 팀원에게 말할 핵심

"Comfy 노드는 새 `/v1/generations`를 우선하지만, 현재 실서버가 legacy LDA/render endpoint를 아직 쓰는 경우를 위해 fallback이 들어 있습니다. 빠른 검토는 GLB preview가 기준이고, MP4는 별도 Render Dance Video 노드를 연결했을 때만 서버 Blender 렌더를 요청합니다. hard-yaw GLB, retarget, MP4 render는 legacy/live endpoint 의존이 있으니, 서버 정리는 endpoint 사용 로그를 보고 단계적으로 해야 합니다."