# MVNT ComfyUI 팀 인수인계 브리핑

이 문서는 팀원에게 ComfyUI 창을 띄워놓고 설명하는 구두 브리핑용입니다. README는 설치와 빠른 시작용이고, 이 문서는 "왜 이렇게 바꿨고 다음 사람이 어디를 보면 되는지"를 설명합니다.

## 1. 한 문장 요약

이번 브랜치는 MVNT ComfyUI 노드를 `/v1` dogfood 흐름에 맞춰 다시 정리한 작업입니다. 핵심 목표는 오디오를 넣으면 MVNT가 춤 GLB와 MP4를 만들고, 필요하면 Tripo 캐릭터 GLB에 retarget해서 Comfy 안에서 바로 미리보는 것입니다.

## 2. 화면을 열고 이렇게 설명하면 됩니다

먼저 `workflows/mvnt_full_ms_review_flow.json`을 ComfyUI 캔버스에 드래그합니다. 이 파일은 실제 작업 그래프에서 키와 로컬 경로를 제거한 팀 리뷰용 cleaned workflow입니다.

보이는 큰 구조는 네 덩어리입니다.

- Main: 오디오를 자르고 MVNT dance generation을 실행하는 메인 경로입니다.
- Character: 캐릭터 이미지를 T-pose로 만들고 Tripo 모델/리깅으로 넘기는 경로입니다.
- Preview: 생성된 GLB를 Comfy 3D preview와 MVNT preview helper로 확인하는 경로입니다.
- Video: 서버 MP4 또는 Kling motion control로 넘기는 후속 경로입니다.

팀원에게는 이렇게 말하면 됩니다.

"이 그래프는 완제품 예제라기보다 현재 dogfood 기준의 작업 인수인계 그래프입니다. 키는 일부러 비워뒀고, 입력 파일명도 placeholder입니다. 실제로 돌리려면 각자 `ComfyUI/input/`에 오디오와 이미지를 넣고, MVNT 키와 Tripo 키를 환경변수나 노드 입력에 넣어야 합니다."

## 3. 우리가 처음 받은 상태와 바꾼 이유

기존 ComfyUI-MVNT는 BVH 중심의 오래된 예제와 helper 노드가 섞여 있었습니다. 팀원이 열면 어떤 노드가 제품용이고 어떤 노드가 과거 실험용인지 헷갈리기 쉬운 상태였습니다.

이번 정리에서 기준을 바꿨습니다.

- 기본 입력은 `AUDIO`입니다.
- 오디오 구간 선택은 `MVNT Audio Segment`가 담당합니다.
- 실제 생성은 `MVNT Generate Dance` 하나가 담당합니다.
- 생성 결과는 `dance_3d` GLB path와 `dance_video` MP4 path입니다.
- 3D 확인은 `MVNT Preview Dance 3D`와 Comfy native 3D preview를 씁니다.
- 이미지 캐릭터는 바로 MVNT가 처리하지 않고, 먼저 `MVNT Image to T-Pose`로 T-pose 이미지를 만들고 Tripo/리깅 도구를 거친 뒤 GLB로 연결합니다.

## 4. 실제 노드 설명

### MVNT Audio Segment

음악 전체를 그대로 보내지 않고, MVNT에 보낼 구간을 고릅니다. 현재 generation은 최대 40초로 제한합니다. JS 확장 `js/mvnt_audio_segment.js`가 Comfy 안에서 오디오 구간 UI를 보강합니다.

### MVNT Generate Dance

이 노드가 메인입니다. 잘린 오디오를 MVNT API로 보내고, job 완료를 polling한 뒤 output을 받습니다.

출력은 두 개입니다.

- `dance_3d`: preview 가능한 GLB path입니다.
- `dance_video`: 서버가 렌더한 MP4 local path입니다.

중요한 점은 `dance_video`가 Comfy native `VIDEO` 객체가 아니라 path string이라는 점입니다. 어떤 외부 video node가 native `VIDEO`를 요구하면, 해당 노드가 요구하는 loader/converter가 필요합니다.

### MVNT Image to T-Pose

일반 캐릭터 이미지를 Tripo의 T-pose image regeneration으로 front-facing T-pose 이미지에 가깝게 만듭니다. 이 경로는 MVNT 키가 아니라 Tripo 키가 필요합니다.

### MVNT Preview Dance 3D

Python 쪽에서는 Comfy 기본 `PreviewUI3D`와 `PreviewAudio`를 반환합니다. JS 쪽은 private hashed bundle을 직접 import하지 않고, 오디오 컨트롤과 payload 연결 보조만 담당합니다. 예전에 Load3D 내부 asset을 직접 건드리려 했던 방식은 Comfy 버전마다 깨질 수 있어서, 지금은 native preview를 우선합니다.

## 5. 키와 비용

키는 두 종류입니다.

- MVNT generation: `MVNT_API_KEY` 또는 `api_key` 입력입니다. 현재 `mvnt_*`와 legacy `mk_*` prefix를 받습니다.
- Tripo T-pose/model/rig: `TRIPO_API_KEY` 또는 Tripo 노드의 key 입력입니다.

키는 workflow JSON에 커밋하면 안 됩니다. `Full_mS_Flow_01.json` 원본에는 실제 작업 중 키와 로컬 경로가 들어갈 수 있으니, repo에는 cleaned copy만 올립니다.

Tripo credit 계산은 Tripo 가격표를 기준으로 확인해야 하지만, 단순 계산으로 1달러가 100 credits라면 1 credit은 0.01달러이고 5 credits는 0.05달러입니다.

## 6. 현재 되는 것

- 오디오 구간 선택
- MVNT dance generation 요청
- generation polling
- hard-yaw lock GLB 우선 다운로드 및 fallback export
- 서버 MP4 다운로드
- Tripo T-pose image 요청
- character GLB가 연결된 경우 retarget endpoint 호출
- Comfy native 3D preview와 audio payload 연결
- 팀 리뷰용 cleaned full workflow 제공

## 7. 아직 조심할 것

- full mS/Kling graph는 외부 custom node가 있어야 그대로 열립니다. 없으면 missing node가 뜹니다.
- `dance_video`는 path string입니다. Kling/Video 노드가 native `VIDEO`를 요구하면 중간 변환이 필요합니다.
- Tripo 캐릭터별 forward axis, skeleton 이름, root motion 차이는 계속 검증이 필요합니다.
- 실서버 API 배포/포트/레거시 endpoint 정리는 아직 별도 문서화 단계입니다. 바로 삭제하지 않습니다.
- 개인 workflow export에는 로컬 파일명, output path, API key가 들어갈 수 있습니다. 공유 전 반드시 cleaned copy를 만듭니다.

## 8. 파일별 담당 구역

- `nodes.py`: Comfy 노드 입력/출력과 실행 로직입니다.
- `mvnt_client.py`: MVNT API, legacy API fallback, output download, retarget, Tripo 호출 래퍼입니다.
- `__init__.py`: Comfy가 노드를 등록하는入口입니다.
- `js/mvnt_audio_segment.js`: 오디오 구간 선택 UI입니다.
- `js/mvnt_preview_dance_3d.js`: preview helper UI와 audio payload 연결입니다.
- `workflows/mvnt_audio_to_dance.json`: 최소 audio-to-dance 테스트 workflow입니다.
- `workflows/mvnt_image_to_tpose.json`: image-to-T-pose 테스트 workflow입니다.
- `workflows/mvnt_full_ms_review_flow.json`: 팀 리뷰용 full graph cleaned workflow입니다.
- `docs/MVNT_API_SERVER_FLOW_kr.md`: API/서버 호출 흐름 문서입니다.

## 9. 팀원에게 마지막으로 부탁할 것

"이 브랜치는 바로 마케팅용 최종 패키지가 아니라, 현재 dogfood 기능을 이어받아 작업할 수 있게 만든 handoff입니다. 먼저 최소 workflow 두 개로 MVNT 노드가 뜨는지 확인하고, 그 다음 full review workflow를 열어서 외부 Tripo/Kling 노드 의존성을 확인해 주세요. 실서버 endpoint 정리는 아직 삭제보다 문서화와 서비스맵 확정이 우선입니다."