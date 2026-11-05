# 배포 라이선스 점검 — 2026-11-05 / v1.0.1

## 범위와 결론

현재 개발 소스, 내장 라이브러리·폰트, Windows 앱의 SDK 재배포 파일과 빌드 구성을 점검했습니다. 소유자가 GPL v3 공개를 선택했습니다. 자체 코드는 GPL v3이며 Microsoft 플랫폼 통합에 대한 제7절 추가 허용은 COPYING.md에 명시했습니다. 배포 HTML 안에도 라이선스 원문과 소스 링크가 포함되며 EXE는 그 HTML을 내장합니다. 릴리즈에는 버전별 개발 소스와 빌드 스크립트, Chart.js 및 color의 수정 가능한 upstream 소스 압축본을 함께 제공합니다.

현재 트리에서 UAVLogViewer 또는 JsDataflashParser의 소스 파일을 직접 포함·가져오는 의존성은 확인되지 않았습니다. 비교용 원본 저장소는 무시되는 artifacts 디렉터리에만 존재하며 배포하지 않습니다. 기능·화면·DataFlash 형식이 유사하다는 사실만으로 코드 복제를 판정하지 않았습니다. 과거 Gemini/Claude 생성 과정의 모든 입력 및 회사·로고의 권리 관계는 확인 범위 밖입니다. 따라서 법적 무결성을 보증하는 법률 의견은 아닙니다.

## 포함 구성요소

| 구성요소 | 버전 | 조건 / 보존 위치 |
| --- | --- | --- |
| Chart.js | 4.4.1 | MIT, licenses/Chart.js-MIT.txt |
| @kurkle/color (Chart.js 번들) | 0.3.2 | MIT, licenses/kurkle-color-MIT.txt |
| Tailwind CSS 생성 스타일 | 3.4.17 | MIT, licenses/Tailwind-MIT.txt; CDN JavaScript 런타임은 제거 |
| Inter | 내장 WOFF2 | SIL OFL 1.1, licenses/Inter-OFL.txt; 폰트 데이터 수정 없음 |
| JetBrains Mono | 내장 WOFF2 | SIL OFL 1.1, licenses/JetBrainsMono-OFL.txt; 폰트 데이터 수정 없음 |
| Microsoft.Web.WebView2 SDK의 Core/WinForms/Loader | 1.0.4314.35 | BSD 3-Clause, SDK LICENSE 및 NOTICE 원문 포함 |

WebView2 브라우저 Runtime 자체는 EXE에 묶어 배포하지 않습니다. Windows에 별도 설치된 Microsoft Runtime을 사용하며 그 제품의 라이선스는 Microsoft 조건을 따릅니다. .NET Framework와 OS도 별도 시스템 구성요소입니다. SDK의 라이선스가 브라우저 Runtime의 라이선스를 대신하지 않습니다.

## 수행 조치

- LICENSE에 GPL v3 전문, COPYING.md에 자체 코드 적용 범위·수정일·무보증·제3자 예외를 명시했습니다.
- 배포에 포함되는 구성요소 원문을 licenses/에 보존하고 HTML의 '라이선스 · 소스코드' 창에서도 제공합니다.
- 불투명한 Tailwind CDN 실행 번들을 정적 CSS로 교체했습니다. 빌드 의존성은 package-lock.json으로 고정합니다.
- 개발용 원본·빌드 스크립트·테스트·잠금 파일을 소스 배포에 포함합니다. 다운로드한 비교 프로젝트, 개발 캐시, 실제 사용자 로그는 제외합니다.
- 향후 GPL 코드를 가져오면 출처·저작권·수정 사항을 파일 단위로 추가해야 합니다. 단순한 자체 GPL 선언이 원저작자 고지 누락을 해결하지는 않습니다.

## 공식 근거

- UAVLogViewer GPL v3: https://github.com/ArduPilot/UAVLogViewer/blob/master/LICENSE
- GPL v3 배포 및 대응 소스 조건: https://www.gnu.org/licenses/gpl-3.0.html (특히 4~6절)
- Chart.js: https://github.com/chartjs/Chart.js/blob/v4.4.1/LICENSE.md
- color: https://github.com/kurkle/color/blob/v0.3.2/LICENSE.md
- Tailwind: https://github.com/tailwindlabs/tailwindcss/blob/v3.4.17/LICENSE
- Inter: https://github.com/rsms/inter/blob/master/LICENSE.txt
- JetBrains Mono: https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt
- WebView2 SDK: 공식 NuGet 패키지 Microsoft.Web.WebView2 1.0.4314.35의 LICENSE.txt 및 NOTICE.txt

## 다음 배포 시

버전별 대응 소스를 실제 바이너리와 함께 보관하고 수정·빌드에 필요한 파일을 빼지 마세요. 의존성 업데이트 시 원문과 버전 표를 갱신하고 로그 및 개인 정보가 릴리즈에 섞이지 않는지 확인하세요. 사내 정책상 배포 권한과 회사 자산의 권리는 별도로 확인해야 합니다.
