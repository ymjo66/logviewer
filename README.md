# X DRONE GCS (XDroneGCS)

QGroundControl(QGC)을 기반으로 **비행 화면 UI와 브랜딩을 X DRONE 디자인으로 교체**한 커스텀 지상관제국(GCS) 앱입니다.

- 기반: `mavlink/qgroundcontrol` (master fork)
- 실행 파일명: `XDroneGCS.exe`
- 저장소 위치: `C:\Users\USER\qgroundcontrol`
- 배포 산출물: `XDroneGCS-win64.zip` (~88MB, Qt 미설치 PC에서도 독립 실행)

> 이 문서는 지금까지 진행한 커스터마이징 전체를 정리한 README입니다.
> 파일 단위 상세 변경 이력은 [XDRONE_CHANGES.md](XDRONE_CHANGES.md) 참고.

---

## 1. 화면 구성

```
┌──── 상단 바 : [X DRONE 로고] 연결상태 | 모드·시동·전압·스로틀·GPS·고도·비행시간 | ⚙ − ▢ ✕ ────┐
│  ┌────────────────────────┬────────────────────────────┐                                  │
│  │  영상 (실시간 스트리밍)     │  지도 (지도/위성 전환)           │  좌상 / 우상                       │
│  ├───────────────┬────────┤                            │                                  │
│  │  상태 메시지    │ 계기판  ├────────────────────────────┤                                  │
│  │  (STATUSTEXT)  │ (자세계)│  기체 정보 (3줄, roll/pitch/yaw)│  좌하 / 우하                       │
│  └───────────────┴────────┴────────────────────────────┘                                  │
│  각 섹션은 테두리(border)로 구분                                                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **상단 바**: 로고 + 연결상태 + 텔레메트리 칩(모드/시동/전압/스로틀/GPS/고도/비행시간) + 창 컨트롤
- **좌상단 — 영상**: 실제 QGC 영상 파이프라인(QtMultimedia/FFmpeg)에 연결된 실시간 스트리밍
- **좌하단(좌) — 상태 메시지**: 펌웨어가 보내는 실제 상태 텍스트(STATUSTEXT) + 연결 시 펌웨어 정보
- **좌하단(우) — 계기판**: 자세계(나침반 포함) + 속도/고도 다이얼
- **우상단 — 지도**: 지도(OSM)/위성(Esri) 전환, 마우스 휠 줌·드래그 이동
- **우하단 — 기체 정보**: Roll/Pitch/Yaw, 속도, 고도, 거리, HDOP, 위경도, 날짜/시간 (3줄×4열)

---

## 2. 빌드 환경 (Toolchain)

| 항목 | 내용 |
|------|------|
| Qt | **6.10.1 / MSVC 2022 64-bit** (`C:\Qt\6.10.1\msvc2022_64`) |
| 컴파일러 | Visual Studio 2022 Community (C++ 데스크톱 워크로드) |
| 빌드 시스템 | CMake + Ninja (Qt Tools 동봉) |
| 영상 백엔드 | QtMultimedia (FFmpeg 7.1.2) — GStreamer 미사용 |
| 추가 Qt 모듈 | Location, Positioning, Multimedia, Sensors, Speech, Graphs, HttpServer, Quick3D, Qt5Compat, SerialPort, SCXML, QuickControls2, WebSockets |

> Windows에서는 **MSVC 필수**(MinGW 미지원). Qt는 **6.10.1 전용**.

---

## 3. 빌드 / 실행 / 배포

빌드는 반드시 MSVC 환경이 필요해서 **배치 파일을 경유**합니다.

### 3-1. 구성(configure) + 빌드
```bat
build_qgc.bat        :: vcvars64 + qt-cmake 구성 + 컴파일 (한 번에)
```
빌드 옵션: `-DQGC_ENABLE_GST_VIDEOSTREAMING=OFF -DQGC_ENABLE_QT_VIDEOSTREAMING=ON -DQGC_ENABLE_WERROR=OFF -DQGC_BUILD_INSTALLER=OFF -DQGC_USE_CACHE=OFF`

> ⚠️ `build_qgc.bat`은 `qt-cmake.bat`을 반드시 **`call`**로 호출해야 configure 후 빌드 단계까지 실행됩니다. (`call` 없이 호출하면 configure만 하고 종료 — 과거 이 버그로 재빌드가 반영 안 된 적 있음)

### 3-2. 증분 빌드(컴파일만)
```bat
build_only.bat       :: cmake --build build --parallel
```
> **CMake 옵션이 바뀌는 변경**(예: APM 토글, 아이콘 교체)은 반드시 `build_qgc.bat`(재구성) 후 `build_only.bat`.

### 3-3. 실행
```bat
run_xdrone.bat       :: build\Release\XDroneGCS.exe 실행 (Qt DLL 경로 설정)
```

### 3-4. 배포 패키지 만들기
```bat
:: 1) 의존성 수집 (windeployqt 전체 경로로 호출)
"C:\Qt\6.10.1\msvc2022_64\bin\windeployqt.exe" --release --compiler-runtime ^
    --qmldir "C:\Users\USER\qgroundcontrol" dist-xdrone\XDroneGCS.exe
:: 2) VC++ 런타임 동봉 (System32 → dist-xdrone): vcruntime140*.dll, msvcp140*.dll
:: 3) Windows 표준 ZIP — 반드시 PowerShell Compress-Archive 사용 (탐색기 호환)
powershell -Command "Compress-Archive -Path dist-xdrone\* -DestinationPath XDroneGCS-win64.zip -Force"
```
- 결과: `XDroneGCS-win64.zip` (~88MB). FFmpeg 영상 플러그인·OSM/Esri 지도·VC 런타임 포함, **Qt 미설치 PC에서도 독립 실행**.
- ⚠️ `tar`(bsdtar)로 만든 zip은 탐색기가 거부하므로 반드시 `Compress-Archive` 사용.

---

## 4. 주요 기능 상세

### 4-1. 상단 바 (텔레메트리 칩 + 창 컨트롤)
- 로고(X 엠블럼) + 연결상태(연결됨/연결 끊김)
- 칩: **모드 / 시동 / 전압 / 스로틀 / GPS / 고도 / 비행시간** (구분선으로 분리)
- 우측: **⚙ 설정 / − 최소화 / ▢ 최대화 / ✕ 닫기** (프레임리스 창 컨트롤)

### 4-2. 실시간 영상 스트리밍
- 정적 이미지가 아니라 **QGC 실제 영상 위젯 `FlightDisplayViewVideo`**를 임베드 → `QGroundControl.videoManager`(QtMultimedia + FFmpeg)에 직접 바인딩.
- 소스가 설정되면 자동 디코딩·표시, 없으면 대기 화면.
- **실기체/카메라 테스트**: 우측 ⚙ 설정 → 영상 → 소스를 `RTSP` / `UDP h.264·h.265` / `TCP` / `MPEG-TS` 중 선택하고 드론 영상 URL(예: `rtsp://192.168.x.x:554/...`) 입력 → 자동 수신.

### 4-3. 지도 (지도/위성 전환 + 마우스 조작)
- 좌상단 **[지도] / [위성]** 토글:
  - **지도** = OpenStreetMap 거리 지도(전 줌레벨 상세, 워터마크 없음)
  - **위성** = Esri World Imagery 위성 영상 (**API 키 불필요**)
- 조작: **마우스 휠 줌**, **드래그 이동**, 핀치 줌, 우상단 **+ / − / ◎(기체로 재중심)** 버튼
- **기체 추종**: 기본 ON, 드래그하면 자동 해제 → ◎로 다시 켬
- 구현: 거리(osm 플러그인)와 위성(QGroundControl 플러그인)은 플러그인이 달라 **두 지도를 겹쳐 놓고 토글**하며, 전환 시 center/zoom을 서로 복사.

### 4-4. 계기판
- 자세계(인공 수평선 + 나침반) — `CustomAttitudeWidget`
- 속도/고도 원형 다이얼 게이지(`XDial`)

### 4-5. 상태 메시지 (좌하단)
- **펌웨어가 보내는 실제 상태 텍스트(STATUSTEXT)** 를 그대로 표시.
- 심각도별 색상: 오류(빨강) / 경고(노랑) / 일반(회색).
- 기체 연결 시 **펌웨어 종류·버전·시스템 ID·모드**를 자동 로그.

### 4-6. 기체 정보 (우하단)
- 3줄 × 4열로 패널을 꽉 채움:
  - Roll / Pitch / Yaw / 지상속도
  - 대기속도 / 해발고도 / 비행거리 / HDOP
  - 위도 / 경도 / 날짜 / 시간
- 값 글자는 크게, **긴 값(위경도·날짜)은 칸 폭에 맞춰 자동 축소**되어 잘리지 않음.

### 4-7. 프레임리스 창
- OS 타이틀바 제거(`Qt.FramelessWindowHint`).
- 상단 바 커스텀 컨트롤: 최소화 / 최대화·복원 / 닫기.
- 빈 상단 바 **드래그로 창 이동**, **더블클릭 최대화 토글**, 우하단 모서리 **리사이즈 그립**.
- 설정/계획 화면에는 창 컨트롤이 없지만, 로고 클릭 → 메뉴(비행/계획/설정/닫기)로 메인 복귀 가능.

### 4-8. 로고 / 앱 아이콘
- **메인 상단 바 로고**: "X DRONE" 워드마크 SVG(`custom/res/Images/xdrone_logo.svg`, 흰 배경·O 흰색 제거).
- **설정/계획 툴바 로고**: 정사각 **X 엠블럼**(`custom/res/Images/QGCLogoFull.svg` — 워드마크에서 "DRONE" 글자 path 제거하고 엠블럼만 남김). QGC의 "Q" 로고를 리소스 오버라이드로 교체.
- **앱 아이콘(태스크바/실행파일)**: X 엠블럼(`custom/res/icons/custom_qgroundcontrol.ico`, `custom/deploy/windows/WindowsQGC.ico`), 흰 배경 투명 처리.

### 4-9. 비행 모드 (ArduPilot 지원)
- ArduPilot 기체의 모드가 `Custom:0x5`로만 뜨던 문제 해결.
- 원인: 커스텀 빌드가 APM을 컴파일에서 제외(`QGC_DISABLE_APM_*`)했던 것 → **APM 활성화**로 `APMFirmwarePlugin`이 처리해 Loiter/Stabilize/AltHold/RTL/Auto/Guided 등 **모드명 정상 표시**.

### 4-10. 한국어화
- 기본 언어 한국어(`src/Settings/AppSettings.cc`), 설정 UI 주요 문자열 번역(`translations/qgc_source_ko_KR.ts` + `translate_ko.py`).

---

## 5. 수정 / 추가 파일

### 커스텀 오버레이 (`custom/`)
| 파일 | 목적 |
|------|------|
| `custom/src/FlyView.qml` | **X DRONE 메인 비행 화면 전체** (레이아웃·영상·지도·계기판·상태메시지·기체정보·창컨트롤) |
| `custom/cmake/CustomOverrides.cmake` | 앱 이름 `XDroneGCS`, **APM 활성화**, Windows 아이콘 경로 |
| `custom/custom.qrc` | FlyView 오버라이드 + 로고/이미지 리소스 등록 |
| `custom/res/Images/xdrone_logo.svg` | 상단 바 X DRONE 워드마크 로고 |
| `custom/res/Images/QGCLogoFull.svg` | 설정/계획 툴바용 X 엠블럼 (QGC "Q" 대체) |
| `custom/res/icons/custom_qgroundcontrol.{ico,png}`, `custom/deploy/windows/WindowsQGC.ico` | 앱 아이콘(X 엠블럼) |

### 수정한 QGC 원본 파일
| 파일 | 목적 |
|------|------|
| `src/MainWindow/MainWindow.qml` | 데스크톱 창을 **프레임리스**로 |
| `src/MainWindow/MainWindowSavedState.qml` | 기본 창 크기 확대 |
| `src/Settings/AppSettings.cc` | 기본 언어 한국어 |
| `translations/qgc_source_ko_KR.ts` | 설정 UI 한국어 번역 |

### 빌드/보조 스크립트 (루트)
| 파일 | 목적 |
|------|------|
| `build_qgc.bat` | 구성 + 빌드 (`call` + `--parallel` 적용) |
| `build_only.bat` | 증분 빌드 |
| `run_xdrone.bat` | 실행 |
| `translate_ko.py` | ko.ts 미번역 문자열 채우기 |

---

## 6. 트러블슈팅 / 함정 (개발 메모)

- **재빌드 전 실행 중인 exe 종료**: `taskkill /F /IM XDroneGCS.exe` (안 하면 링크 LNK 실패).
- **`build_qgc.bat`의 `call`**: `qt-cmake.bat`을 `call` 없이 호출하면 configure만 하고 빌드가 안 됨.
- **앱 아이콘 반영**: `.ico` 파일만 바꾸고 `build_only`하면 임베드가 갱신 안 될 수 있음 → `build/CMakeFiles/XDroneGCS.dir/XDroneGCS_resource.rc.res` 삭제 후 빌드.
- **툴바 로고 렌더**: `QGCVectorImage`는 viewBox가 아니라 **SVG 실제 내용 범위**로 크기를 잡음 → 엠블럼만 쓰려면 viewBox 크롭이 아니라 **글자 path 자체를 제거**해야 함.
- **지도 위성**: QGC 플러그인의 `Esri World Satellite`는 토큰 없이 동작. 거리 지도는 OSM(custom.host)이 전 줌레벨 타일이 있어 확대 시 빈 화면 없음.
- **배포 zip**: 반드시 PowerShell `Compress-Archive`(bsdtar zip은 탐색기가 거부).
- **화면 캡처 검증**: 커스텀 exe는 Start 메뉴 미등록이라 화면 캡처 도구에서 프로세스명 `xdronegcs.exe`로 허가해야 보임.

---

## 7. 알려진 제한 / 남은 작업

- **지도 항공구역 오버레이(예정)**: 비행금지·비행제한구역·관제권을 메인 지도 + 미션(계획) 지도에 표시.
  - 데이터 소스: 공공데이터포털(data.go.kr) 또는 vWorld(vworld.kr).
  - **API 키 필요** — data.go.kr는 「활용신청」 후 인증키 발급(데스크톱 앱은 도메인 제한 없어 유리), vWorld는 URL/도메인 등록 필요.
  - 미션 지도는 `src/PlanView/PlanView.qml`의 공유 `FlightMap`, 메인 지도는 커스텀 OSM/Esri Map. WFS/REST로 폴리곤(GeoJSON)을 받아 `MapPolygon` 오버레이로 구현 예정.
- **실기체 영상 종단 검증**: 개발 환경에 실카메라가 없어 실기체 소스 URL 입력 후 수신 확인 필요.
- **기타**: 앱 로고/스플래시 추가 다듬기, 설정 메뉴 잔여 영어 번역 확장.

---

## 8. 로컬 테스트 (개발용)

- 시뮬레이터: `C:\Users\USER\QGCFlightDisplay\sim\sim.py` (pymavlink) — ArduCopter LOITER 텔레메트리를 UDP 14550으로 송신.
  ```
  python C:\Users\USER\QGCFlightDisplay\sim\sim.py 14550
  ```
- 앱이 UDP 14550 자동 연결 → 상태메시지·계기·지도·기체정보 실시간 확인.
- 테스트 후 시뮬 종료: `taskkill /F /IM python.exe` (배포본에는 미포함).
