# X Drone Log Viewer

ArduPilot `.bin` / `.log` 로그를 분석하는 **단일 HTML 파일**입니다. Windows와 Ubuntu에서 브라우저로 실행하며, EXE·Node.js·Python·설치·로컬 서버가 필요 없습니다.

## 실행

1. 저장소의 `index.html`을 내려받습니다. GitHub 파일 화면의 **Download raw file**을 누르거나 **Code → Download ZIP**으로 받으세요.
2. `index.html`을 더블클릭하거나 Chrome / Edge / Chromium / Firefox에서 엽니다.
3. **로그 열기**로 로그를 선택하거나 화면에 끌어다 놓습니다.

회사 PC에는 `index.html` 하나만 복사하면 됩니다. 그래프 라이브러리·폰트·로고·예시 로그가 HTML에 포함되어 있습니다. 분석과 CSV 생성은 브라우저에서 처리하며 로그를 외부 서버로 전송하지 않습니다. 매뉴얼 링크를 누를 때만 외부 사이트로 이동합니다.

## 기능

- 여러 로그와 소티별 비행 시간 분석
- 고도·스로틀·자세·진동·배터리·모터·GPS 차트 및 축 범위 설정
- 오른쪽 공통 비행 경로, 마우스 확대/이동, 재생과 자세 HUD
- 정상 / 주의 / 경고 상태, 진단·이벤트·파라미터 확인
- 로그와 데이터 열을 선택해 CSV 저장
- 셀별 전압 기록 우선 감지 및 배터리 셀 수 수동 설정
- **예시 로그** 버튼으로 합성 비행·비행 미감지·12S 배터리 로그 3개 열기

비행 미감지는 지상 상태라는 의미가 아닙니다. 총전압만으로 셀 수를 구분할 수 없으면 셀 수 미확정으로 표시합니다. 배터리 차트에는 측정 전압과 전류만 표시합니다.

## 코드 수정

`index.html`을 VS Code 같은 편집기로 열어 수정하고 저장한 뒤 브라우저를 새로고침합니다. 파일 내부에서 아래 블록 이름을 검색하세요.

| 블록 | 내용 |
| --- | --- |
| workbench-theme | 화면 스타일 |
| analyzeParsedLog | 로그 분석 |
| renderTelemetryCharts | 그래프 |
| battery-core | 셀 수 감지 |
| csv-export-core | CSV 항목 선택·저장 |
| workbench-core | 화면 배치·경로 조작 |
| standalone-examples | 내장 예시 로그 |

`tailwind-runtime`, `chart-runtime`, `embedded-fonts`는 내장 라이브러리와 폰트입니다. 일반 UI 수정에서는 변경할 필요가 없습니다.

새로고침하면 첨부 로그가 초기화됩니다. 수정한 파일은 다른 PC에도 다시 복사해야 합니다. CSV 저장 위치는 브라우저 다운로드 설정을 따릅니다. 브라우저 로컬 파일 정책에 따라 클립보드나 설정 저장 동작이 다를 수 있습니다.

## 개발 검증 (선택)

실행에는 Node.js가 필요 없습니다. 개발자가 회귀 테스트를 실행할 때만 사용합니다.

```sh
node tests/standalone.cjs
node tests/export-battery.cjs
```

합성 로그 기반 분석·셀 수 감지·CSV 검사와 로컬 HTTP 화면 검증을 수행했습니다. 자동 브라우저 도구의 file:// 제한으로 실제 더블클릭 경로는 자동 검증하지 못했습니다. 대상 Windows/Ubuntu 브라우저에서 실제 로그로 최종 확인하세요.

기존 Python 데스크톱 래퍼, EXE 빌드·업데이트 코드, 배포 워크플로 및 분리된 웹 자산은 이 버전에서 제거했습니다. 이전 코드는 Git 이력에서 확인할 수 있습니다.
