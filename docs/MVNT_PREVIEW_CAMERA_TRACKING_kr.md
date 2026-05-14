# MVNT Preview Dance 3D 카메라 트래킹 정리

## mS 원본 기준

mS 프론트의 카메라 트래킹은 `mvnt-mS/src/lib/components/ThreeScene.svelte` 안에 있다.

핵심 구성:

- `applyViewportCameraPose(camera, controls, tracking)`
  - tracking on/off에 따라 초기 카메라 위치와 target을 잡는다.
- `CAM_DIST`
  - 캐릭터와 카메라 사이 거리.
- `CAM_YAW_LERP`
  - 캐릭터가 바라보는 yaw를 카메라가 따라가는 속도.
- `CAM_POS_LERP`
  - Hips 위치를 카메라 target이 따라가는 속도.
- `TURN_IGNORE_RAD`, `SPIN_VEL_MAX`
  - 큰 회전/스핀은 카메라가 바로 따라가지 않게 하는 안전장치.
- 매 프레임 `requestAnimationFrame` 루프에서 `Hips` world position과 world quaternion을 읽는다.
- `smoothCamX`, `smoothCamZ`, `smoothCamYaw`를 보간해서 카메라와 controls target을 갱신한다.
- floor/grid도 `smoothCamX/Z`를 따라 이동한다.

## ComfyUI-MVNT 현재 구현

파일:

- `js/mvnt_preview_dance_3d.js`

현재 구현된 것:

- GLB 안에서 `Hips`, `Hip`, `mixamorigHips`, `Armature_Hips`, `Root` 순서로 tracking bone 탐색.
- tracking bone의 world position과 world quaternion을 읽음.
- mS와 같은 yaw/position smoothing 상수 계열 사용.
- 급격한 회전 무시 로직 적용.
- grid 위치를 캐릭터 X/Z에 맞춰 이동.
- `Tracking ON/OFF` 버튼 추가.
- 기존 250ms `setInterval` 제거, `requestAnimationFrame` 기반 sync loop로 변경.
- 마지막으로 실행된 `mvnt_preview` payload를 노드 properties에 저장. 다른 workflow로 갔다 돌아와도 GLB path가 남아 있으면 다시 mount한다.

mS와 다른 점:

- mS는 BVH `Hips`를 기준으로 추적하지만, Comfy는 이미 baked된 animated GLB의 bone을 기준으로 추적한다.
- mS의 floor mesh, toon outline, light rig follow camera는 아직 완전 이식하지 않았다.
- GLB마다 forward axis가 다르면 `getBoneFaceYaw()`의 기준 벡터 `(0, 0, 1)` 조정이 필요할 수 있다.

## 오디오 주의사항

Comfy의 `AUDIO` 입력은 프론트 JS에서 실행 전에는 실제 파일 URL로 접근할 수 없다. 따라서 `MVNT Preview Dance 3D` 노드를 실행하기 전에는 GLB만 widget 값으로 복원될 수 있고, 오디오 URL은 `onExecuted` payload가 와야 연결된다.

즉 “0.0s / 20.0s”가 보이는 것은 GLB animation duration이고, 오디오가 연결되었다는 뜻은 아니다. 오디오는 노드 실행 후 `UI.PreviewAudio(audio)` 결과가 `mvnt_preview.audio`로 내려와야 재생 가능하다.

## 서버 MP4 카메라와 다른 점

Comfy 3D preview는 사용자가 실시간으로 확인하는 viewer라서 GLB root motion과 Hips를 부드럽게 따라가는 쪽이 좋다.

반대로 `MVNT Render Dance Video`의 MP4는 Kling/reference video로도 쓰기 때문에 서버 Blender 쪽에서 더 넓게 찍는다. 현재 기준은 `670x400`, 전신 발/머리 보존, hips 100% 중앙 고정이 아니라 partial follow + smoothing이다. 이렇게 해야 옆이나 앞뒤로 이동하는 안무가 화면에서 제자리 슬라이딩처럼 죽지 않는다.