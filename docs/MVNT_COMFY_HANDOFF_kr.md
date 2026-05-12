# MVNT ComfyUI 팀 인수인계 브리핑

이 문서는 팀원에게 ComfyUI 창을 띄워놓고 설명하는 구두 브리핑용입니다. README는 설치와 빠른 시작용이고, 이 문서는 "왜 이렇게 바꿨고 다음 사람이 어디를 보면 되는지"를 설명합니다.

## 1. 한 문장 요약

이번 작업은 ComfyUI 안에서 MVNT 춤 생성 흐름을 팀원이 이어받을 수 있게 정리한 작업입니다. 오디오를 넣으면 MVNT가 춤 GLB와 MP4를 만들고, 필요하면 Tripo 캐릭터 GLB에 retarget해서 Comfy 안에서 바로 미리보는 것이 핵심 목표입니다.

## 2. 작업 배경과 정리 기준

처음 전달받은 상태는 "오디오를 넣으면 춤이 나온다"는 큰 방향은 있었지만, 실제로는 예전 BVH 중심 노드, 실험용 workflow, Tripo 캐릭터 변환, 3D preview, 서버 endpoint가 조금씩 흩어져 있었습니다. 그래서 누가 봐도 "어떤 노드가 메인이고, 어떤 노드는 보조고, 서버는 어디를 타는지"가 바로 보이지 않는 상태였습니다.

이번에는 기준을 이렇게 잡았습니다.

첫 번째, ComfyUI 쪽에서는 `MVNT Generate Dance`를 메인 노드로 봅니다. 오디오를 넣고, 스타일을 고르고, 필요하면 캐릭터 GLB를 연결하면 이 노드가 MVNT 서버에 요청해서 춤 데이터를 만듭니다.

두 번째, 오디오 길이 조절은 `MVNT Audio Segment`가 담당합니다. 전체 음악을 다 보내는 게 아니라, 예를 들어 0초부터 20초까지 잘라서 MVNT에 보내는 식입니다.

세 번째, 3D 확인은 `MVNT Preview Dance 3D`로 정리했습니다. 이 노드는 생성된 GLB를 ComfyUI의 3D preview로 확인하고, 오디오 payload도 같이 넘겨서 춤과 음악을 같이 검토할 수 있게 하는 역할입니다.

## 3. 용어 설명

`GLB`는 3D 모델 파일 형식입니다. 여기서는 캐릭터, 뼈대, 애니메이션을 ComfyUI 3D preview에서 확인하기 위한 파일로 봅니다.

`BVH`는 모션 캡처에서 많이 쓰는 뼈대 애니메이션 파일입니다. GLB가 Comfy preview에 더 바로 맞기 때문에 이번 Comfy 흐름에서는 GLB output이 중요합니다.

`Tripo`는 이미지로 캐릭터 모델을 만들거나 리깅하는 외부 3D 서비스입니다. 여기서는 캐릭터 이미지를 T-pose 이미지로 만들고, Tripo 쪽 모델/리깅 노드를 거쳐서 GLB를 만든 다음 MVNT 춤에 연결하는 흐름으로 씁니다.

`T-pose`는 캐릭터가 양팔을 벌리고 서 있는 기본 자세입니다. 리깅이나 리타게팅할 때 기준 자세로 많이 씁니다.

`리깅`은 3D 캐릭터 안에 움직일 수 있는 뼈대 구조를 넣는 작업입니다. 캐릭터 겉모양만 있으면 춤을 출 수 없고, 모션을 받을 뼈대가 필요합니다.

`리타게팅`은 한 캐릭터의 모션을 다른 캐릭터 몸에 옮기는 작업입니다. 이번 작업에서는 MVNT가 만든 춤 GLB를 Tripo 캐릭터 GLB에 입히는 흐름입니다.

`API`는 프로그램끼리 요청을 주고받는 통로입니다. ComfyUI 노드가 직접 AI 모델을 돌리는 게 아니라 MVNT 백엔드 API에 요청합니다.

`inference proxy`는 추론 프록시입니다. 요청을 받아서 local GPU 서버로 보낼지, 외부 cloud 처리로 보낼지 판단하는 중간 관문입니다.

`local GPU`는 우리 서버 안에서 직접 AI 모델을 돌리는 방식입니다.

`Replicate`는 외부 클라우드에서 AI 모델을 실행해주는 서비스입니다.

`burst`는 local GPU 처리량이 부족할 때 일부 작업을 외부 cloud 처리로 넘기는 구조입니다.

## 4. 화면을 열고 설명하는 순서

먼저 `workflows/Full_mS_Flow_01.json` 또는 `workflows/mvnt_full_ms_review_flow.json`을 ComfyUI 캔버스에 드래그합니다. `Full_mS_Flow_01.json`은 사용자가 다시 export한 실제 full graph이고, `mvnt_full_ms_review_flow.json`은 키와 로컬 경로를 제거한 review용 cleaned copy입니다.

보이는 큰 구조는 네 덩어리입니다.

- Main: 오디오를 자르고 MVNT dance generation을 실행하는 메인 경로입니다.
- Character: 캐릭터 이미지를 T-pose로 만들고 Tripo 모델/리깅으로 넘기는 경로입니다.
- Preview: 생성된 GLB를 Comfy 3D preview와 MVNT preview helper로 확인하는 경로입니다.
- Video: 서버 MP4 또는 Kling motion control로 넘기는 후속 경로입니다.

## 5. 실제 노드 설명

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

Python 쪽에서는 Comfy 기본 `PreviewUI3D`와 `PreviewAudio`를 반환합니다. JS 쪽은 private hashed bundle을 직접 import하지 않고, 오디오 컨트롤과 payload 연결 보조만 담당합니다. Comfy 버전마다 내부 3D viewer asset이 달라질 수 있어서, 지금은 native preview를 우선합니다.

## 6. 서버 연결 설명

ComfyUI 노드가 직접 AI 모델을 돌리는 게 아니라, MVNT 백엔드 API에 요청합니다.

예전에는 `8001` 추론 서버가 바로 대부분을 받는 구조였는데, 지금은 `8005` inference proxy가 중간 관문 역할을 합니다. 현재 `8005`가 받는 중요한 경로는 아래와 같습니다.

- `/generate-motion-lda`: 춤 생성 요청
- `/job-lda`: 생성 상태 확인
- `/download-bvh-lda`: BVH 다운로드
- `/download-glb-lda`: GLB 다운로드
- `/retarget-tripo-glb`: Tripo 캐릭터에 춤 입히기
- `/v1/`: 새 API 형태로 가는 공개 경로 후보

관련 백엔드 문서는 `docs/MVNT_API_SERVER_FLOW_kr.md`와 백엔드 repo의 `docs/INFERENCE_PROXY_8005.md`를 보면 됩니다.

## 7. 파일별 담당 구역

### ComfyUI-MVNT repo

- `nodes.py`: Comfy 노드 입력/출력과 실행 로직입니다. `MVNT Audio Segment`, `MVNT Image to T-Pose`, `MVNT Generate Dance`, `MVNT Preview Dance 3D`가 여기서 정의됩니다.
- `mvnt_client.py`: MVNT API, legacy API fallback, output download, retarget, Tripo 호출 래퍼입니다.
- `__init__.py`: ComfyUI가 MVNT 노드를 등록하는 입구입니다.
- `js/mvnt_audio_segment.js`: 오디오 구간 선택 UI입니다.
- `js/mvnt_preview_dance_3d.js`: preview helper UI와 audio payload 연결입니다.
- `workflows/mvnt_audio_to_dance.json`: 최소 audio-to-dance 테스트 workflow입니다.
- `workflows/mvnt_image_to_tpose.json`: image-to-T-pose 테스트 workflow입니다.
- `workflows/Full_mS_Flow_01.json`: 팀원이 전체 흐름을 열어볼 수 있는 full graph export입니다.
- `workflows/mvnt_full_ms_review_flow.json`: 키와 로컬 경로를 제거한 review용 full graph입니다.
- `docs/MVNT_API_SERVER_FLOW_kr.md`: API/서버 호출 흐름 문서입니다.
- `docs/MVNT_COMFY_HANDOFF_kr.md`: 지금 이 구두 브리핑 문서입니다.

### Backend repo

- `inference_proxy/inference_proxy.py`: `8005` inference proxy 코드입니다. generation lifecycle, GLB download, Tripo retarget pass-through를 담당합니다.
- `docs/INFERENCE_PROXY_8005.md`: `8005`의 역할, route, 운영 주의사항을 설명합니다.
- `deploy/systemd/mvnt-inference-proxy.service.example`: 실제 token 없는 systemd 예시입니다.
- `deploy/nginx/api.mvnt.studio.inference-proxy.example.conf`: 실제 인증서와 secret 없는 nginx route 예시입니다.

## 8. 키와 비용

키는 두 종류입니다.

- MVNT generation: `MVNT_API_KEY` 또는 `api_key` 입력입니다. 현재 `mvnt_*`와 legacy `mk_*` prefix를 받습니다.
- Tripo T-pose/model/rig: `TRIPO_API_KEY` 또는 Tripo 노드의 key 입력입니다.
이 두 키는 슬랙에서 따로 공유드리겠습니다.

키는 workflow JSON에 커밋하면 안 됩니다. private repo라도 clone, 로그, CI, 퇴사자 접근, 토큰 재사용 문제가 생길 수 있습니다. 팀원 실습용이면 각자 `.env`, 환경변수, 또는 노드 입력칸에 넣게 합니다.

Tripo credit 계산은 Tripo 가격표를 기준으로 확인해야 하지만, 단순 계산으로 1달러가 100 credits라면 1 credit은 0.01달러이고 5 credits는 0.05달러입니다.

## 9. 현재 되는 것

- 오디오 구간 선택
- MVNT dance generation 요청
- generation polling
- hard-yaw lock GLB 우선 다운로드 및 fallback export
- 서버 MP4 다운로드
- Tripo T-pose image 요청
- character GLB가 연결된 경우 retarget endpoint 호출
- Comfy native 3D preview와 audio payload 연결
- 팀 리뷰용 cleaned full workflow 제공

## 10. 아직 조심할 것

- full mS/Kling graph는 외부 custom node가 있어야 그대로 열립니다. 없으면 missing node가 뜹니다.
- `dance_video`는 path string입니다. Kling/Video 노드가 native `VIDEO`를 요구하면 중간 변환이 필요합니다.
- Tripo 캐릭터별 forward axis, skeleton 이름, root motion 차이는 계속 검증이 필요합니다.
- 실서버 API 배포/포트/레거시 endpoint 정리는 바로 삭제하지 않고 서비스맵 확정이 먼저입니다.
- 개인 workflow export에는 로컬 파일명, output path, API key가 들어갈 수 있습니다. 공유 전 반드시 cleaned copy를 만듭니다.

## 11. 인수인계 기준

이 브랜치는 바로 마케팅용 최종 패키지가 아니라, 현재 dogfood 기능을 이어받아 작업할 수 있게 만든 handoff입니다. 먼저 최소 workflow 두 개로 MVNT 노드가 뜨는지 확인하고, 그 다음 full review workflow에서 외부 Tripo/Kling 노드 의존성을 확인합니다. 실서버 endpoint 정리는 삭제보다 문서화와 서비스맵 확정이 우선입니다.