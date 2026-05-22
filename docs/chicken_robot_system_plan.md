# 로보티즈 모터와 라즈베리파이 5 기반 움직이는 닭 모형 시스템 구성 계획

## 1. 프로젝트 개요

- 목표: 주변에 사람이 감지되면 머리와 목을 움직이는 닭 모형 제작
- 주요 제어부: Raspberry Pi 5
- 주요 구동부: ROBOTIS 모터
- 동작 범위: 닭의 머리와 목 움직임에 한정
- 감지 조건: 센서를 통해 주변 사람 감지 시 동작

## 2. 확정된 요구사항

| 구분 | 내용 |
| --- | --- |
| 형태 | 실물 크기 닭 모형 |
| 구동 부위 | 머리, 목 |
| 제어 보드 | Raspberry Pi 5 |
| 액추에이터 | ROBOTIS DYNAMIXEL XM430, XL320 사용 예정 |
| 트리거 | 1~2m 이내 사람 근접 감지 |
| 설치 환경 | 전시장 내 나무 위, 관람객 통로 방향 고정 설치 |
| 전원 | 콘센트 사용 가능 |
| 소리 | 불필요 |

## 2.1 확정 정책

| 구분 | 확정 정책 |
| --- | --- |
| 운영 구조 | ROS2 적용 확정 |
| 운영 OS | Ubuntu Server 24.04 LTS arm64 |
| ROS2 배포판 | ROS2 Jazzy Jalisco |
| 웹 UI | ROS2 패키지 내부의 FastAPI 브라우저 앱으로 구현 |
| 3D UI | Three.js 기반, 모션용 단순화 STL 매핑 |
| 목 관절 | 하단 yaw/pitch + 상단 yaw/pitch 4축 |
| 모터 배치 | `lower_yaw`, `lower_pitch`는 XM430-W210-T / `upper_yaw`, `upper_pitch`는 XL320 |
| DYNAMIXEL 통신 | U2D2 TTL 버스 사용, XM430-W210-T와 XL320 데이터 라인 공유 |
| DYNAMIXEL 전원 | XM430-W210-T와 XL320 전원 분리, GND 공통 |
| 진단 읽기 | Sync Read 고정, 모델/주소별 그룹 분리 |
| 모션 데이터 | 추상값 `-100~100` |
| ROBOTIS raw position | 모델별 범위 사용: XM430-W210-T `0~4095`, XL320 `0~1023` |
| 패턴 파일 | YAML, 파일별 패턴 관리 |
| 보간 옵션 | `linear`, `ease_in_out`, `snap`, `hold` |
| 감지 센서 | IWR6843급 mmWave 센서 |
| 사람 선택 | 여러 명 감지 시 가장 가까운 사람 선택 |
| 바라보기 방식 | 감지 순간 1회, 설정 지연 후 1회 추가 바라보기 |
| 웹 인증 | 설정 파일 기반 간단한 비밀번호 |
| 안전 정지 | 웹 정지 버튼 |
| 자동 시작 | systemd 기반 부팅 자동 실행 |
| 문서 분리 | 시스템 설계서와 BOM/구매목록 분리 |

현재 장비 확인 결과는 Debian GNU/Linux 13 trixie arm64, Raspberry Pi 커널이다. ROS2 공식 바이너리 설치와 운영 안정성을 우선해 최종 운영 OS는 Ubuntu Server 24.04 LTS arm64로 정한다.

## 3. 남은 결정 사항

- 닭 모형의 실제 완성 무게
- 전원 어댑터 최종 용량
- 기구 구조와 안전 제한
- IWR6843급 mmWave 센서의 최종 제품 모델
- 설치 현장 배선 길이와 커넥터 규격
- 모션용 단순화 STL 파일 구조
- 실제 관절별 각도 제한값

## 4. 질의응답 기록

### 1차 질문

| 질문 | 답변 |
| --- | --- |
| 닭 모형 크기 | 실물 크기 |
| 머리와 목 움직임 | 고개 돌리기, 끄덕임, 머리 앞뒤 움직임 |
| 사람 감지 시 반응 | 사람을 바라보는 동작과 놀라서 움직이는 동작 모두 필요 |
| 사용할 ROBOTIS 모터 | XM430, XL320 사용 예정 |
| 설치 환경 | 전시장 나무 위 |

### 2차 질문

| 질문 | 답변 |
| --- | --- |
| 사람 감지 정확도 | 가까이 오면 반응하면 되며, 정확한 위치 추적은 불필요 |
| 감지 거리 | 1~2m |
| 전원 공급 | 콘센트 사용 가능 |
| 소리 필요 여부 | 필요 없음 |
| 설치 방향 | 관람객 통로 쪽으로 고정 |

### 3차 질문

| 질문 | 답변 |
| --- | --- |
| 머리/목 재질과 무게 | 최대한 가볍게 제작 예정 |
| 머리 앞뒤 움직임 | 머리 방향이 유지된 상태로 앞으로 쭉 나갔다 들어오는 동작. 짐벌처럼 방향 유지 필요. 콕콕 쪼는 모션도 필요 |
| 모터 수량 | 필요한 만큼 구매 가능 |
| 움직임 속도 | 빠른 움직임 필요 |
| 안전상 동작 과장 | 과장된 움직임 가능 |

### 4차 질문

| 질문 | 답변 |
| --- | --- |
| 센서 노출 여부 | 닭 안에 숨기거나 주변 구조물에 숨김 |
| 바라보기 정확도 | 연출이면 충분하지만, 좌우 어느 쪽에서 왔는지 알 수 있으면 좋음 |
| 동작 모드 | 랜덤 동작과 감지 기반 동작을 전환 |
| 관리자 UI | 웹페이지로 상태 확인 필요 |
| 운영 시간 | 매장 운영시간 동안 상시 켜둠 |

### 5차 질문

| 질문 | 답변 |
| --- | --- |
| Raspberry Pi와 DYNAMIXEL 연결 | U2D2 사용 |
| 웹페이지 접속 범위 | 같은 공유기 안에서 접속 |
| 움직임 패턴 수 | 많을수록 좋음 |
| 안전 정지 | 웹 정지로 충분 |
| 전원 재투입 시 기준 자세 | 자동 복귀 필요 |

### 6차 질문

| 질문 | 답변 |
| --- | --- |
| XM430 구체 모델 | XM430-W210-T |
| XL320 사용 이유 | 소형이고 빠른 모터가 필요해서 사용 예정 |
| 목 기구 제작 | 담당자가 따로 있으며, 현재는 제어 시스템 구성에 집중 |
| 전원 구성 | Raspberry Pi와 모터 전원 분리 |
| 정비 접근성 | 의자 사용 시 정비 가능 |

### 7차 질문

| 질문 | 답변 |
| --- | --- |
| 프로그램 언어 | 상관없음 |
| 웹 UI 범위 | 버튼, 상태, 로그, 관절 3D 뷰어 필요 |
| 동작 패턴 관리 | 패턴은 파일별로 구분, 웹에서 목록 확인 및 편집 가능해야 함 |
| 센서 후보 | mmWave 선호 |
| 로그 | 전체 누적 로그를 파일로 저장하고 웹에서 조회 |

### 8차 질문

| 질문 | 답변 |
| --- | --- |
| 웹 패턴 편집 수준 | 타임라인 편집 + 3D 뷰어에서 자세를 잡고 저장 |
| 자세 저장 방식 | 3D 뷰어에서 자세를 잡은 뒤 타임라인 키 위치에 해당 자세를 캡처하고, 이를 반복해 전체 모션 흐름 완성 |
| 3D 뷰어 형태 | 모션용 단순화 STL 파일을 매핑해서 사용 예정 |
| mmWave 센서 | 아직 미정. 가격 무관, 성능 안정성 우선으로 추천 필요 |
| 패턴 중 새 감지 | 새 반응으로 전환하되, 계속 전환만 반복되지 않도록 전환 후 일정 시간 현재 패턴 유지 |
| 랜덤 모드 간격 | 기본 5~10초, 웹에서 조절 가능하게 구성 |

### 9차 질문

| 질문 | 답변 |
| --- | --- |
| 센서 방향 | IWR6843처럼 사람 위치를 알 수 있되, 더 모듈형인 제품 선호 |
| 웹 3D 뷰어 기술 | Three.js 기반 구현 가능 |
| 패턴 실행 전 미리보기 | 미리보기 후 실행할지 바로 실행할지 사용자가 선택 |
| 웹 접속 권한 | 간단한 비밀번호 필요 |
| 다음 단계 | 문서 구체화 계속 진행 |

### 10차 질문

| 질문 | 답변 |
| --- | --- |
| 모터 축 이름 | 초기안은 `neck_yaw`, `neck_pitch`, `neck_slide`, `head_peck`였으나, 이후 목 상단/하단 yaw-pitch 구조로 변경 |
| 웹 패턴 편집 관절값 단위 | 모션 데이터는 추상값으로 관리 |
| 실제 각도/모터 위치값 표시 | 다른 화면에서 확인 가능해야 함 |
| 사람 위치 추적 방식 | 가까운 사람을 선택 |
| 비밀번호 설정 | 설정 파일에서 관리 |
| 문서 최종 형태 | 개발자용 시스템 설계서. 구매목록은 별도 문서로 분리 |

### 11차 질문

| 질문 | 답변 |
| --- | --- |
| 추상값 범위 | `-100~100`으로 고정 |
| ROBOTIS raw position 범위 | 초기 기준은 `0~4095`였으나 실제 backend에서는 모델별 범위 사용. XM430-W210-T는 `0~4095`, XL320은 `0~1023` |
| 모션 보간 방식 | 캡처 포인트별 4가지 옵션 제공 |
| 사람 추적 반응 | 감지 순간 한 번 바라보고, 몇 초 후 한 번 더 바라보는 방식 |
| 진단값 표시 | Sync Read 방식으로 온도, 전압, 부하, 위치 표시 |
| 다음 문서 보강 | 소프트웨어 아키텍처 |

### 12차 질문

| 질문 | 답변 |
| --- | --- |
| 목 구동 위치 | 목 상단의 머리 연결부와 목 하단의 몸통 연결부 |
| 목 상단 자유도 | yaw, pitch |
| 목 하단 자유도 | yaw, pitch |
| 전체 목 구동 자유도 | 4축 |

### 13차 질문

| 질문 | 답변 |
| --- | --- |
| ROS2 적용 여부 | Raspberry Pi 5에서 적용 가능하며, 확장성과 구조화를 위해 고려 |
| 웹 UI 구현 방식 | ROS2 노드 자체가 아니라 FastAPI 브라우저 앱으로 구현 |
| 웹 앱 위치 | ROS2 패키지로 포함 가능하되, 내부 구현은 FastAPI + Three.js |

### 14차 질문

| 질문 | 답변 |
| --- | --- |
| ROS2 적용 | 확정 |
| 현재 OS 확인 결과 | Debian GNU/Linux 13 trixie, arm64, Raspberry Pi 커널 |
| 운영 OS 정책 | Ubuntu Server 24.04 LTS arm64 + ROS2 Jazzy Jalisco로 확정 |
| 모터 배치 | 예시안대로 하단 2축 XM430-W210-T, 상단 2축 XL320 |
| 센서 | IWR6843급 mmWave로 선정 |
| 통신/전원 정책 | 확정 정책으로 잠금 |
| 모션 데이터 정책 | 확정 정책으로 잠금 |
| 웹 UI 범위 | 확정 정책으로 잠금 |
| 안전/운영 정책 | 확정 정책으로 잠금 |
| BOM | 별도 구매목록 문서 작성 |

## 5. 현재 설계안

### 5.1 기본 동작 개념

사람이 감지되면 닭 모형이 주변 반응을 보이는 전시용 자동 모형으로 구성한다. 동작은 머리와 목에 한정하며, 기본 반응은 다음 두 가지 계열로 나눈다.

- 바라보기 동작: 감지된 사람 방향으로 고개를 돌리고, 약한 끄덕임 또는 주시 동작을 수행
- 놀람 동작: 빠른 고개 회전, 짧은 끄덕임, 머리 앞뒤 움직임을 조합한 반응

### 5.2 예비 자유도 구성

현재 요구 동작 기준으로 4자유도 구성이 적합하다. 목 상단의 머리 연결부에 yaw/pitch 2축, 목 하단의 몸통 연결부에 yaw/pitch 2축을 둔다. 머리 방향 유지 전후 이동과 콕콕 쪼는 동작은 별도 슬라이드 축이 아니라 상단/하단 yaw-pitch 조합으로 만든다.

| 자유도 | 동작 | 모터 |
| --- | --- | --- |
| 1축 | 하단 목 yaw: 몸통 기준 목 좌우 방향 | XM430-W210-T |
| 2축 | 하단 목 pitch: 몸통 기준 목 전후 기울기 | XM430-W210-T |
| 3축 | 상단 목 yaw: 목 끝/머리 좌우 보정 | XL320 |
| 4축 | 상단 목 pitch: 머리 끄덕임/쪼기 보정 | XL320 |

실물 크기 닭 모형이고 전시장 나무 위에 설치되므로, 무게 중심과 낙하 방지 구조를 고려해 XL320은 가벼운 상단 보조축에 사용하고, 큰 토크가 필요한 하단 주축은 XM430-W210-T가 담당한다.

빠른 움직임과 과장된 반응이 필요하므로, 기구부에는 다음 제한을 둔다.

- 각 축에 기계적 스토퍼를 둬 과회전을 방지
- 빠른 놀람 동작은 짧은 시간만 수행하고 기본 대기 자세로 복귀
- 모터 토크 여유를 확보하기 위해 머리와 목 외피는 최대한 경량화
- 전시장 나무 위 설치이므로 모터 브래킷, 닭 본체, 나무 고정부를 별도 안전 와이어로 보강

### 5.3 전후 이동 모션 구현

머리 방향이 유지된 채 앞으로 나갔다 들어오는 움직임은 상단/하단 pitch를 반대로 보정하는 방식으로 만든다. 하단 pitch가 목 전체를 앞으로 보내고, 상단 pitch가 머리 방향을 되돌려 주면 짐벌처럼 머리 방향을 유지하는 연출이 가능하다.

| 방식 | 장점 | 단점 | 현재 적합도 |
| --- | --- | --- | --- |
| 하단 pitch + 상단 pitch 보정 | 별도 슬라이더 없이 전후 이동 느낌 구현 가능 | 실제 직선 이동은 아니므로 기구 치수와 보정 필요 | 높음 |
| 하단 yaw + 상단 yaw 보정 | 목은 좌우로 움직이되 머리 방향 유지 가능 | 과하면 부자연스러울 수 있음 | 높음 |
| 상단 pitch 단독 | 콕콕 쪼는 모션 구현 쉬움 | 목 전체 전후 이동 느낌은 약함 | 높음 |
| 별도 슬라이더 추가 | 실제 전후 이동이 명확함 | 모터/기구 복잡도 증가 | 낮음 |

현재 요구에는 별도 슬라이더를 두기보다 4축 yaw-pitch 조합으로 모션을 만드는 방향이 우선이다. 기구 담당자가 상단/하단 관절 거리와 회전 범위를 확정하면, 제어 시스템에서는 추상 모션값을 각 관절 목표값으로 매핑한다.

권장 축 이름:

| 축 이름 | 의미 |
| --- | --- |
| `lower_yaw` | 목 하단, 몸통 연결부 yaw |
| `lower_pitch` | 목 하단, 몸통 연결부 pitch |
| `upper_yaw` | 목 상단, 머리 연결부 yaw |
| `upper_pitch` | 목 상단, 머리 연결부 pitch |

### 5.4 센서 방향

사람의 정확한 위치 추적은 필수는 아니지만, 좌우 어느 쪽에서 접근했는지 알 수 있으면 바라보기 연출 품질이 좋아진다. 센서는 닭 내부 또는 주변 구조물에 숨겨 설치한다.

| 후보 센서 | 적합성 | 비고 |
| --- | --- | --- |
| PIR 인체감지 센서 | 보통 | 사람 움직임 감지는 쉽지만 정지한 사람에는 약함 |
| ToF 거리 센서 | 높음 | 1~2m 거리 변화 감지에 적합 |
| 초음파 센서 | 보통 | 저렴하지만 전시장 구조물, 각도, 소음 반사 영향 가능 |
| mmWave 인체감지 센서 | 높음 | 정지한 사람도 감지 가능하며 이번 프로젝트의 우선 후보 |

현재 조건에서는 통로 방향으로 ToF 거리 센서 또는 mmWave 인체감지 센서를 배치하는 구성이 유리하다. 좌우 접근 방향을 연출에 반영하려면 센서를 2개 이상 사용한다.

권장 센서 구성은 다음 중 하나다.

| 구성 | 설명 | 장점 | 단점 |
| --- | --- | --- | --- |
| 단일 ToF/mmWave | 통로 중앙 감지 | 단순하고 안정적 | 좌우 방향 판별 불가 |
| 좌/우 2개 ToF | 좌측/우측 감지 영역 분리 | 간단한 방향 연출 가능 | 설치 각도 조정 필요 |
| mmWave 1개 | 인체 존재 감지 | 정지한 사람도 감지 가능 | 모델에 따라 방향 판별이 제한적 |
| 카메라 기반 | 사람 위치 추정 가능 | 연출 품질 높음 | 구현 복잡도와 개인정보 고려 증가 |

현재 프로젝트에는 mmWave 센서를 우선 적용한다. 좌우 접근 방향 연출까지 고려하면 좌/우 감지 영역을 분리할 수 있는 mmWave 센서 모델을 선택하거나, mmWave 센서를 2개 배치하는 방식을 검토한다.

mmWave 적용 방향:

- 닭 내부 또는 주변 구조물에 숨겨 설치
- 감지 거리 기준은 1~2m
- 사람 존재 여부를 감지해 감지 모드 트리거로 사용
- 여러 사람이 감지되면 가장 가까운 사람을 반응 대상으로 선택
- 가까운 사람의 위치를 바탕으로 바라보기 방향을 계산
- 센서 오검출을 줄이기 위해 감지 유지 시간과 쿨다운 시간을 소프트웨어에서 설정

mmWave 센서 추천:

| 우선순위 | 후보 | 추천 이유 | 비고 |
| --- | --- | --- | --- |
| 1 | Murata Type1VN 계열 | TI IWR6843 칩셋 기반 모듈이며, 위치/속도 감지와 UART 인터페이스를 제공하는 모듈형 제품 | 실제 구매 가능성, SDK/프로토콜 문서 확인 필요 |
| 2 | Mistral 60GHz AoPCB RADAR Module | IWR6843 기반 모듈형 레이더. UART 기반 호스트 파서/펌웨어 업데이트 등 상용 적용 기능을 제공 | B2B 성격이 강해 납기와 최소 주문 수량 확인 필요 |
| 3 | TI IWR6843ISK 또는 IWR6843AOPEVM | 사람 감지/추적 성능과 레퍼런스가 강함. 가격보다 안정성과 방향 추정 가능성을 우선할 때 적합 | 평가보드 조합이라 모듈형 제품보다는 설치/제품화가 번거로움 |
| 4 | Seeed Studio MR60BHA2 Kit | 60GHz mmWave 기반 사람 존재 감지, Wi-Fi/ESPHome 기반 통합 편의성이 좋음 | 정밀 위치 추적보다는 존재 감지 중심 |

현재 프로젝트 추천안:

- 사람 위치를 알고 싶고 모듈형 제품을 선호하므로 `Murata Type1VN` 또는 `Mistral IWR6843 기반 60GHz AoPCB RADAR Module`을 우선 검토한다.
- 라즈베리파이 연동 관점에서는 UART로 추적 결과를 받을 수 있는지, 좌표/거리/각도 데이터 포맷이 공개되어 있는지를 구매 전 확인한다.
- TI IWR6843ISK 계열은 성능 검증과 알고리즘 참고용으로 좋지만, 최종 설치용으로는 모듈형 제품보다 부피와 배선이 불리할 수 있다.
- Seeed MR60BHA2는 존재 감지 프로토타입에는 좋지만, 사람 위치 기반 연출을 목표로 하면 1순위에서는 제외한다.

참고한 공식 자료:

- [TI TIDEP-01000 People Counting and Tracking Reference Design](https://www.ti.com/tool/TIDEP-01000): IWR6843 기반 사람 카운팅/추적 레퍼런스.
- [TI IWR6843 제품 자료](https://www.ti.com/product/IWR6843): 60~64GHz FMCW 레이더 센서.
- [Murata Type1VN](https://www.murata.com/en-eu/products/connectivitymodule/mmwave-radar/industrial/overview/lineup/type1vn): TI IWR6843 칩셋 기반 소형 mmWave 레이더 모듈.
- [Mistral 60GHz AoPCB RADAR Module](https://www.mistralsolutions.com/product-engineering-services/products/som-modules/60ghz-industrial-mmwave-radar-module/): IWR6843 기반 60GHz 모듈형 레이더.
- [Seeed Studio MR60BHA2 제품 자료](https://www.seeedstudio.com/MR60BHA2-60GHz-mmWave-Sensor-Breathing-and-Heartbeat-Module-p-5945.html): 60GHz mmWave 기반 사람 존재 감지 키트.

### 5.5 전원 방향

콘센트 사용이 가능하므로 배터리 중심 설계는 제외한다. Raspberry Pi 5와 DYNAMIXEL 모터 전원은 분리해서 구성하는 것이 안정적이다.

- Raspberry Pi 5: 전용 USB-C 전원 어댑터 사용
- DYNAMIXEL 모터: 별도 DC 전원 어댑터 사용
- Raspberry Pi와 모터 전원은 GND 기준을 공유
- 전시장 설치물이므로 배선 고정, 케이블 장력 완화, 낙하 방지 필요

XM430-W210-T와 XL320을 같이 사용할 경우 전압 조건이 다르므로 모터 전원을 하나로 단순 통합하지 않는다.

| 장치 | 권장 전원 방향 |
| --- | --- |
| Raspberry Pi 5 | Raspberry Pi 5용 USB-C 전원 어댑터 |
| XM430-W210-T | 별도 DYNAMIXEL 전원 라인 |
| XL320 | XL320 허용 전압에 맞춘 별도 전원 라인 |

전원 분리 원칙:

- Raspberry Pi 전원과 모터 전원은 분리
- XM430 전원과 XL320 전원은 분리
- 통신 기준을 위해 GND는 공통 기준으로 연결
- 모터 전원 라인에는 스위치 또는 분리 가능한 커넥터를 둬 정비성을 확보

### 5.6 소프트웨어 운영 모드

Raspberry Pi 5에서 제어 프로그램과 웹 상태 페이지를 함께 운영한다.

| 모드 | 동작 |
| --- | --- |
| 감지 모드 | 센서가 사람을 감지하면 바라보기 또는 놀람 동작 실행 |
| 랜덤 모드 | 사람 감지와 관계없이 일정 간격 또는 랜덤 간격으로 동작 실행 |
| 테스트 모드 | 웹페이지에서 각 모터와 동작 패턴을 수동 실행 |
| 정지 모드 | 모터 토크 해제 또는 안전 자세 유지 |

웹페이지에서 확인/제어할 항목은 다음과 같다.

- 현재 운영 모드
- 센서 감지 상태
- 좌/우 감지 상태
- 마지막 동작 시간
- 현재 실행 중인 동작 패턴
- 모터 연결 상태
- 감지 모드/랜덤 모드/정지 모드 전환
- 테스트 동작 실행
- 패턴 목록 조회
- 패턴 파일 편집
- 누적 로그 조회
- 관절 상태 3D 뷰어

매장 운영시간 동안 상시 켜두는 조건이므로, 프로그램은 부팅 시 자동 실행되도록 구성한다. 오류가 발생하면 모터를 안전 자세로 보내고 웹페이지에 상태를 표시한다.

권장 소프트웨어 구성은 Python 기반이다. DYNAMIXEL SDK와 Raspberry Pi 센서 연동이 쉽고, FastAPI 같은 경량 웹 프레임워크로 운영 콘솔을 만들기 적합하다.

```text
control_app/
  main.py                 # 프로그램 진입점
  motor_controller.py     # DYNAMIXEL 제어
  sensor_mmwave.py        # mmWave 센서 입력
  pattern_runner.py       # 패턴 실행 엔진
  state_manager.py        # 현재 상태/운영 모드 관리
  logger.py               # 누적 로그 저장
  web_server.py           # 웹 UI/API
  patterns/               # 동작 패턴 파일
  logs/                   # 누적 로그 파일
```

### 5.7 웹 운영 콘솔

웹페이지는 같은 공유기 안에서 접속하는 내부 관리용으로 구성한다.

필수 화면:

| 화면 | 기능 |
| --- | --- |
| 대시보드 | 현재 모드, 센서 상태, 모터 상태, 마지막 동작, 정지 버튼 |
| 패턴 목록 | 저장된 동작 패턴 파일 목록, 실행, 복사, 삭제 |
| 패턴 편집 | 타임라인 키프레임 편집, 3D 자세 캡처, 관절값 숫자 편집 |
| 로그 | 전체 누적 로그 파일 조회, 날짜/이벤트 필터 |
| 3D 관절 뷰어 | 모션용 단순화 STL 파일을 매핑해 현재/목표 자세 표시 |

웹 기술 방향:

- 3D 뷰어는 Three.js 기반으로 구현한다.
- STLLoader를 사용해 모션용 단순화 STL 파일을 불러온다.
- 각 STL 파트는 관절 계층 구조에 매핑한다.
- 웹 UI는 같은 공유기 내부에서 접속하되, 간단한 비밀번호 로그인을 둔다.
- 처음에는 단일 관리자 계정 방식으로 충분하며, 사용자별 권한 분리는 후순위로 둔다.
- 비밀번호는 설정 파일에서 관리한다.

웹 UI 제어 버튼:

- 감지 모드
- 랜덤 모드
- 정지
- 기준 자세 복귀
- 선택 패턴 실행
- 모터 토크 ON/OFF

3D 관절 뷰어는 모션 제작용 단순화 STL 파일을 매핑해 사용한다. 실제 외형 전체를 정밀하게 재현하기보다, 머리/목 관절의 자세와 키프레임 확인에 필요한 수준으로 단순화한다.

모션 편집 방식:

1. 패턴 파일 선택 또는 새 패턴 생성
2. 타임라인에서 키 위치 선택
3. 3D 뷰어에서 머리/목 자세 조정
4. 현재 자세를 해당 키프레임에 캡처
5. 다음 키 위치에서 다른 자세를 캡처
6. 키프레임 사이를 보간해 전체 모션 흐름 생성
7. 미리보기 실행
8. 실제 모터 테스트 실행
9. 패턴 파일 저장

타임라인 편집기 필수 기능:

- 키프레임 추가/삭제/복사
- 키프레임 시간 이동
- 현재 3D 자세를 키프레임에 캡처
- 키프레임별 관절값 숫자 편집
- 패턴 미리보기
- 실제 모터로 테스트 실행
- 저장 전 관절 제한/속도 제한 검증

패턴 실행 방식:

- 사용자는 패턴별로 `미리보기 후 실행` 또는 `바로 실행`을 선택할 수 있다.
- 새로 편집한 패턴은 기본적으로 미리보기를 권장한다.
- 바로 실행 버튼은 웹 UI에서 명확히 구분해 실수로 누르지 않게 한다.
- 정지 버튼은 어떤 화면에서도 항상 접근 가능하게 배치한다.

캡처 포인트별 보간 옵션:

| 옵션 | 용도 |
| --- | --- |
| `linear` | 일정한 속도로 자연스럽게 이동 |
| `ease_in_out` | 시작과 끝을 부드럽게 처리 |
| `snap` | 놀람 동작처럼 빠르게 튀는 이동 |
| `hold` | 다음 키프레임까지 자세 유지 |

보간 옵션은 패턴 전체 기본값을 둘 수 있고, 각 캡처 포인트에서 개별 오버라이드할 수 있게 한다.

관절값 표시 방식:

- 패턴 파일에는 추상 모션값을 저장한다.
- 추상값은 기본적으로 `-100~100` 범위로 둔다.
- ROBOTIS DYNAMIXEL raw position은 모델별 범위를 사용한다. XM430-W210-T는 `0~4095`, XL320은 `0~1023`을 기준으로 한다.
- 실제 각도와 DYNAMIXEL raw position은 별도 매핑 테이블을 통해 계산한다.
- 웹 진단 화면에서는 추상값, 실제 각도, 모터 raw position을 함께 확인할 수 있게 한다.
- 패턴 편집자는 하드웨어 보정값을 직접 다루지 않고, 모션 느낌 중심으로 편집한다.

### 5.8 동작 패턴 파일 구조

동작 패턴은 파일별로 분리하고, 웹에서 목록 확인과 편집이 가능하게 한다. 사람이 직접 수정하기 쉬운 YAML 또는 JSON 형식을 사용한다. 주석과 가독성을 고려하면 YAML이 유리하다.

예시:

```yaml
name: startled_peck
description: 놀라서 뒤로 빠진 뒤 콕콕 쪼는 동작
value_unit: normalized
value_range: [-100, 100]
steps:
  - duration_ms: 250
    joints:
      lower_yaw: 0
      lower_pitch: -30
      upper_yaw: 10
      upper_pitch: 25
  - duration_ms: 180
    joints:
      lower_yaw: -20
      lower_pitch: 35
      upper_yaw: 15
      upper_pitch: -35
  - duration_ms: 120
    joints:
      upper_pitch: 20
  - duration_ms: 250
    joints:
      lower_yaw: 0
      lower_pitch: 0
      upper_yaw: 0
      upper_pitch: 0
```

패턴 편집 시 검증해야 할 항목:

- 관절별 최소/최대 각도 또는 이동 범위 초과 여부
- 너무 빠른 이동 명령 여부
- 누락된 관절값 처리 방식
- 기준 자세로 복귀하는 마지막 단계 포함 여부
- XL320에 과부하가 걸릴 수 있는 동작 여부

키프레임 기반 패턴 파일 예시:

```yaml
name: curious_peck
description: 호기심 있게 앞으로 보고 콕콕 쪼는 동작
mode: keyframes
value_unit: normalized
value_range: [-100, 100]
default_interpolation: ease_in_out
keyframes:
  - time_ms: 0
    interpolation: ease_in_out
    joints:
      lower_yaw: 0
      lower_pitch: 0
      upper_yaw: 0
      upper_pitch: 0
  - time_ms: 350
    interpolation: linear
    joints:
      lower_yaw: 10
      lower_pitch: 30
      upper_yaw: -5
      upper_pitch: -25
  - time_ms: 520
    interpolation: snap
    joints:
      upper_pitch: 30
  - time_ms: 680
    interpolation: hold
    joints:
      upper_pitch: -20
  - time_ms: 1000
    interpolation: ease_in_out
    joints:
      lower_yaw: 0
      lower_pitch: 0
      upper_yaw: 0
      upper_pitch: 0
```

추상값 매핑 예시:

```yaml
joints:
  lower_yaw:
    normalized_min: -100
    normalized_max: 100
    angle_min_deg: -45
    angle_max_deg: 45
    motor_id: 1
  lower_pitch:
    normalized_min: -100
    normalized_max: 100
    angle_min_deg: -40
    angle_max_deg: 40
    motor_id: 2
  upper_yaw:
    normalized_min: -100
    normalized_max: 100
    angle_min_deg: -35
    angle_max_deg: 35
    motor_id: 3
  upper_pitch:
    normalized_min: -100
    normalized_max: 100
    angle_min_deg: -35
    angle_max_deg: 35
    motor_id: 4
```

이 매핑 파일은 패턴 파일과 분리한다. 기구 보정, 모터 교체, 링크비 변경이 생겨도 기존 모션 패턴 파일을 최대한 유지하기 위한 구조다.

### 5.9 로그 저장

로그는 전체 누적 파일로 저장하고 웹에서 조회한다.

기록 대상:

- 프로그램 시작/종료
- 운영 모드 변경
- 센서 감지 이벤트
- 실행된 패턴명
- 모터 연결/오류 상태
- 기준 자세 복귀 결과
- 웹 UI에서 누른 제어 버튼
- 정지 명령
- 예외 및 오류 메시지

로그 파일은 날짜별 파일 분리를 권장한다.

```text
logs/
  2026-05-23.log
  2026-05-24.log
```

웹에서는 날짜 선택, 키워드 검색, 이벤트 종류 필터를 제공한다.

### 5.10 제어 통신 구성

Raspberry Pi 5와 ROBOTIS DYNAMIXEL 모터는 U2D2를 통해 연결한다.

기본 연결 구조:

```text
Raspberry Pi 5
  USB
  |
U2D2
  |
DYNAMIXEL TTL/RS-485 BUS
  |
XM430 / XL320 모터
```

주의할 점:

- XM430-W210-T는 TTL 통신 모델로 계획한다.
- XL320도 TTL 계열이므로 통신 방식 관점에서는 함께 구성하기 쉽다.
- 다만 XM430-W210-T와 XL320은 전원 허용 범위가 다르므로 전원 라인을 주의해서 분리한다.
- XL320은 소형/빠른 보조 동작에 사용하고, 큰 부하가 걸리는 축은 XM430-W210-T를 우선 사용한다.

권장 버스 구성:

```text
Raspberry Pi 5
  USB
  |
U2D2
  |
TTL DYNAMIXEL BUS
  |---------------- XM430-W210-T: lower_yaw, lower_pitch
  |---------------- XL320: upper_yaw, upper_pitch
```

실제 배선에서는 전원 전압 차이 때문에 단순 데이지체인 전원 연결을 피한다. 데이터 라인은 TTL 버스로 공유하되, 각 모터 계열의 전원 공급 조건을 분리해서 설계한다.

진단값 읽기 전략:

- 진단값 읽기는 Sync Read 방식으로 고정한다.
- 같은 모델/같은 Control Table 주소를 공유하는 모터끼리 Sync Read 그룹을 나눈다.
- XM430-W210-T와 XL320은 진단 항목 주소가 다르므로 동일 Sync Read 그룹에 섞지 않는다.
- XM430-W210-T 그룹과 XL320 그룹을 별도로 읽고, 웹 진단 화면에서는 하나의 상태 테이블로 합쳐 표시한다.
- 위치처럼 실시간성이 높은 항목은 더 짧은 주기로 읽고, 온도/전압처럼 느리게 변하는 항목은 더 긴 주기로 읽는다.

웹 진단 화면 표시 항목:

| 항목 | XM430-W210-T | XL320 | 비고 |
| --- | --- | --- | --- |
| 위치 | Present Position | Present Position | 웹에는 raw position과 매핑 후 실제값 모두 표시 |
| 전압 | Present Input Voltage | Present Voltage | 단위 변환 후 V로 표시 |
| 온도 | Present Temperature | Present Temperature | 섭씨로 표시 |
| 부하 | Present Current 또는 Present PWM 기준 추정 | Present Load | 모델별 의미가 다르므로 같은 단위로 단순 비교하지 않음 |

참고한 공식 자료:

- [DYNAMIXEL Protocol 2.0 Sync Read](https://emanual.robotis.com/docs/en/dxl/protocol2/): 여러 DYNAMIXEL에서 같은 주소와 길이의 데이터를 동시에 읽는 방식.
- [XM430-W210-T/R Control Table](https://emanual.robotis.com/docs/en/dxl/x/xm430-w210/): Present Position, Present Input Voltage, Present Temperature, Present Current/PWM 항목 확인.
- [XL320 Control Table](https://emanual.robotis.com/docs/en/dxl/x/xl320/): Present Position, Present Load, Present Voltage, Present Temperature 항목 확인.

### 5.11 자동 기준 자세 복귀

전원 투입 또는 프로그램 재시작 시 닭은 자동으로 기준 자세를 잡아야 한다.

부팅 절차:

1. Raspberry Pi 5 부팅
2. 제어 프로그램 자동 실행
3. U2D2 포트 확인
4. 각 DYNAMIXEL ID 검색
5. 모터 현재 위치 읽기
6. 급격한 이동 없이 저속으로 기준 자세 복귀
7. 센서 상태 확인
8. 웹페이지 상태를 `대기`로 표시
9. 선택된 운영 모드에 따라 동작 시작

기준 자세:

- 머리 정면
- 목 중립 위치
- 하단 yaw/pitch 중립 각도
- 상단 yaw/pitch 중립 각도

자동 복귀는 안전을 위해 빠르게 움직이지 않고 저속으로 수행한다. 기준 자세 복귀 중에는 센서 감지 동작을 실행하지 않는다.

### 5.12 움직임 패턴 방향

움직임 패턴은 많을수록 좋으므로, 기본 동작을 조합해 여러 반응을 만든다.

기본 동작 단위:

- 좌로 보기
- 우로 보기
- 정면 보기
- 짧게 끄덕임
- 빠르게 끄덕임
- 머리 앞으로 내밀기
- 머리 뒤로 빼기
- 콕콕 쪼기
- 놀람 후 뒤로 빼기
- 천천히 주변 살피기

패턴 예시:

| 패턴 | 설명 |
| --- | --- |
| 관심 | 감지 방향으로 고개를 돌리고 짧게 끄덕임 |
| 놀람 | 빠르게 뒤로 빠진 뒤 좌우로 고개를 흔듦 |
| 쪼기 | 머리를 앞으로 내밀고 콕콕 쪼는 동작 |
| 경계 | 좌우를 번갈아 보고 정면으로 복귀 |
| 호기심 | 천천히 앞으로 다가가고 고개를 갸웃거림 |
| 랜덤 대기 | 사람이 없어도 가끔 작은 고개 움직임 |

패턴 전환 규칙:

- 감지 모드에서 새 사람이 감지되면 현재 패턴을 새 반응 패턴으로 전환할 수 있다.
- 단, 전환 직후에는 `pattern_lock_ms` 동안 추가 전환을 금지한다.
- `pattern_lock_ms` 기본값은 3000~5000ms로 시작하고 웹에서 조절 가능하게 한다.
- 사람 위치가 감지되면 감지 순간 한 번 바라보고, 설정된 지연 시간 후 한 번 더 바라보는 방식으로 반응한다.
- 닭 머리가 사람을 계속 따라다니는 연속 추적은 기본 동작에서 제외한다.
- 정지 명령은 패턴 잠금과 무관하게 항상 즉시 적용한다.
- 모터 오류, 통신 오류, 과부하 감지 시 현재 패턴을 중단하고 안전 자세로 복귀한다.

랜덤 모드 규칙:

- 기본 동작 간격은 5~10초 범위의 랜덤 값으로 설정한다.
- 최소 간격, 최대 간격은 웹에서 조절 가능하게 한다.
- 감지 모드와 랜덤 모드는 웹에서 전환 가능하게 한다.

### 5.13 정비성과 설치 운영

전시장 나무 위에 설치하지만 의자를 사용하면 정비 가능하므로, 현장 운영 기준은 다음과 같이 둔다.

- U2D2, Raspberry Pi, 전원 어댑터는 접근 가능한 위치에 배치
- 모터 전원 커넥터는 분리 가능하게 구성
- 웹 정지 기능으로 즉시 동작 중단 가능
- 정비 시 웹에서 정지 모드 전환 후 모터 전원 차단
- 닭 본체와 나무 고정부는 별도 안전 와이어 또는 브래킷으로 보강

## 6. 문서 분리 계획

이 문서는 개발자용 시스템 설계서로 유지한다. 구매목록은 별도 문서로 분리한다.

문서 구성:

- `docs/chicken_robot_system_plan.md`: 시스템 구성, 제어 구조, 소프트웨어 설계, 운영 방식
- `docs/chicken_robot_bom.md`: 모터, 센서, 전원, 케이블, 브래킷 등 구매목록
- `docs/chicken_robot_ros2_architecture.md`: ROS2 패키지, 노드, topic/service/action, launch 구조
- `docs/ros2_pixi_installation.md`: 현재 Debian 13 환경의 Pixi/RoboStack 기반 ROS2 Jazzy 설치 기록

구매목록 문서에는 최종 센서 선정 후 모델명, 수량, 용도, 구매 링크, 대체 후보를 정리한다.

## 7. 소프트웨어 아키텍처

### 7.1 전체 구조

소프트웨어는 ROS2 적용안으로 확정한다. 비ROS 기본안은 초기 검토안으로만 남긴다.

1. 초기 비ROS 검토안: Raspberry Pi 5에서 하나의 FastAPI 백엔드 프로세스를 중심으로 실행
2. ROS2 적용안: 하드웨어/상태/모션 실행은 ROS2 노드로 분리하고, 웹 UI는 FastAPI 브라우저 앱으로 제공

ROS2를 적용해 모터, 센서, 모션, 웹 브리지의 책임을 명확히 나눈다. Three.js 웹 UI, 타임라인 패턴 편집기, 로그 조회는 ROS2 노드 내부에 억지로 넣지 않고 FastAPI 브라우저 앱으로 구현한다.

초기 검토안:

```text
Browser
  |
  | HTTP / WebSocket
  v
FastAPI Web Server
  |
  |-- Auth / Config
  |-- State Manager
  |-- Pattern Manager
  |-- Pattern Runner
  |-- Motion Mapper
  |-- Motor Controller
  |-- Sensor Manager
  |-- Logger
```

ROS2 적용안:

```text
Browser
  |
  | HTTP / WebSocket
  v
FastAPI Browser App
  |
  | ROS2 Python Client / Service / Topic Bridge
  v
ROS2 Graph
  |-- motor_node
  |-- sensor_node
  |-- motion_node
  |-- chicken_state_node
  |-- logger_node
```

확정 방향은 ROS2 패키지 안에 웹 앱을 포함하되, 웹 기능 자체는 FastAPI와 브라우저 프론트엔드로 구현하는 방식이다.

### 7.2 주요 모듈

초기 비ROS 검토안의 내부 모듈:

| 모듈 | 역할 |
| --- | --- |
| `web_server` | 웹 UI 제공, REST API, WebSocket 상태 스트림 |
| `auth_manager` | 설정 파일 기반 간단한 비밀번호 인증 |
| `config_manager` | 포트, 모터 ID, 관절 매핑, 랜덤 간격, 패턴 잠금 시간 로드 |
| `state_manager` | 현재 모드, 센서 상태, 실행 중 패턴, 오류 상태 관리 |
| `sensor_manager` | mmWave 센서 데이터 수신, 가까운 사람 선택, 감지 이벤트 생성 |
| `pattern_manager` | 패턴 파일 목록, 로드, 저장, 검증 |
| `pattern_runner` | 키프레임 보간, 패턴 실행, 전환 잠금 처리 |
| `motion_mapper` | 추상값 `-100~100`을 실제 각도/거리/raw position으로 변환 |
| `motor_controller` | DYNAMIXEL SDK/U2D2 통신, 위치 명령, 토크 제어, 진단값 읽기 |
| `diagnostics` | 온도, 전압, 부하, 위치 등 상태 수집 |
| `logger` | 날짜별 로그 파일 기록 및 조회 |

ROS2 적용 시 패키지 구조:

```text
ros2_ws/
  src/
    chicken_bringup/
    chicken_description/
    animatronic_interfaces/
    animatronic_dynamixel/
    people_mmwave_sensor/
    animatronic_motion/
    animatronic_web/
    animatronic_logger/
```

ROS2 패키지 역할:

| 패키지 | 역할 |
| --- | --- |
| `chicken_bringup` | 전체 launch 파일, 파라미터 로드, systemd 연동 |
| `chicken_description` | 관절 구조, STL/URDF/xacro, TF 구조 |
| `animatronic_interfaces` | 재사용 가능한 custom msg/srv/action 정의 |
| `animatronic_dynamixel` | U2D2/DYNAMIXEL 제어, Sync Read 진단, 토크 제어 |
| `people_mmwave_sensor` | mmWave 센서 파싱, 가까운 사람 선택, 사람 위치 publish |
| `animatronic_motion` | 패턴 로드, 키프레임 보간, 모션 실행, 패턴 잠금 |
| `animatronic_web` | FastAPI 서버, Three.js UI, 타임라인 편집기, 로그 조회 |
| `animatronic_logger` | 이벤트 로그 저장, 조회 API 보조 |

ROS2 노드 역할:

| 노드 | 역할 |
| --- | --- |
| `motor_node` | 현재 관절 상태 publish, 목표 관절 명령 subscribe, 진단 publish |
| `sensor_node` | mmWave 사람 위치 publish |
| `motion_node` | 패턴 실행, 감지 이벤트 기반 반응 생성 |
| `state_node` | 운영 모드, 오류 상태, 정지 상태 관리 |
| `web_server_node` | FastAPI 앱 실행 및 ROS2 topic/service bridge |

`web_server_node`는 ROS2 노드이지만 웹 화면을 ROS2 callback 안에 직접 구현하지 않는다. FastAPI 서버를 실행하고, 필요한 ROS2 topic/service/action과 연결하는 브리지 역할을 한다.

권장 ROS2 인터페이스:

| 인터페이스 | 방향 | 내용 |
| --- | --- | --- |
| `/joint_states` | publish | 현재 관절 상태 |
| `/target_joint_states` | subscribe | 목표 관절 상태 |
| `/animatronic/diagnostics` | publish | 온도, 전압, 부하, 위치 |
| `/animatronic/detected_person` | publish | 가장 가까운 사람 위치 |
| `/animatronic/mode` | publish/subscribe | 감지/랜덤/테스트/정지 모드 |
| `/animatronic/run_pattern` | service/action | 선택 패턴 실행 |
| `/animatronic/stop` | service | 즉시 정지 |
| `/animatronic/home` | service | 기준 자세 복귀 |

### 7.3 런타임 태스크

백엔드는 비동기 태스크를 분리해 실행한다.

| 태스크 | 주기/트리거 | 역할 |
| --- | --- | --- |
| 센서 읽기 | 센서 데이터 수신 시 또는 짧은 주기 | 사람 존재/위치 업데이트 |
| 모터 명령 | 패턴 실행 중 주기적 | 목표 위치를 DYNAMIXEL에 전송 |
| 진단 읽기 | 0.5~2초 주기 | 위치, 전압, 온도, 부하 업데이트 |
| 패턴 실행 | 이벤트 기반 | 키프레임 보간과 동작 전환 |
| 랜덤 모드 스케줄러 | 5~10초 기본 범위 | 랜덤 패턴 실행 |
| 로그 기록 | 이벤트 기반 | 감지, 모드 변경, 오류, 패턴 실행 기록 |
| WebSocket 브로드캐스트 | 5~10Hz | 웹 UI에 상태 전달 |

### 7.4 상태 흐름

운영 모드는 명확한 상태 머신으로 관리한다.

```text
BOOTING
  -> HOMING
  -> IDLE
  -> DETECTION_MODE
  -> RANDOM_MODE
  -> TEST_MODE
  -> STOPPED
  -> ERROR
```

상태 설명:

| 상태 | 설명 |
| --- | --- |
| `BOOTING` | 프로그램 시작, 설정 파일 로드 |
| `HOMING` | 모터 검색 후 기준 자세로 저속 복귀 |
| `IDLE` | 동작 대기 |
| `DETECTION_MODE` | 센서 감지 기반 반응 |
| `RANDOM_MODE` | 랜덤 간격으로 패턴 실행 |
| `TEST_MODE` | 웹에서 선택한 패턴 또는 관절 테스트 |
| `STOPPED` | 웹 정지 상태. 패턴 실행 중단 |
| `ERROR` | 통신 오류, 모터 오류, 센서 오류 등 |

### 7.5 감지 이벤트 처리

mmWave 센서에서 여러 사람이 감지되면 가장 가까운 사람을 선택한다. 선택된 사람의 좌표 또는 각도를 이용해 바라보기 패턴의 방향 파라미터를 만든다.

감지 모드 흐름:

1. 센서 데이터 수신
2. 감지 대상 목록 필터링
3. 가장 가까운 사람 선택
4. 현재 패턴 잠금 여부 확인
5. 잠금 중이 아니면 바라보기 또는 놀람 패턴 선택
6. 감지 순간 1차 바라보기 실행
7. 설정된 지연 시간 후 2차 바라보기 실행
8. `pattern_lock_ms` 동안 추가 전환 제한

### 7.6 패턴 실행 흐름

패턴 실행은 추상 모션값을 기준으로 한다.

```text
Pattern YAML
  -> Pattern Validator
  -> Keyframe Interpolator
  -> Motion Mapper
  -> Motor Command Queue
  -> DYNAMIXEL Bus
```

실행 규칙:

- 패턴 파일은 `patterns/` 폴더에 저장한다.
- 각 키프레임은 `time_ms`, `interpolation`, `joints`를 가진다.
- 보간 옵션은 `linear`, `ease_in_out`, `snap`, `hold` 네 가지를 제공한다.
- 모터 명령 전 관절 제한, 속도 제한, raw position 범위를 검증한다.
- 정지 명령은 패턴 실행보다 우선한다.

### 7.7 설정 파일

설정 파일은 하드웨어 의존값과 운영값을 분리한다.

```text
config/
  app.yaml          # 웹 비밀번호, 운영 모드 기본값, 로그 설정
  joints.yaml       # 관절 이름, 추상값-실제값 매핑, 모터 ID
  motors.yaml       # 포트, baudrate, 모터 모델, 진단 읽기 방식
  sensor.yaml       # mmWave 포트, 감지 거리, 가까운 사람 선택 기준
```

ROS2 적용 시에는 위 설정을 ROS2 parameter YAML로 옮기거나, FastAPI 앱과 ROS2 노드가 같은 설정 파일을 읽게 한다. 설정 출처가 둘로 갈라지면 운영 중 값 불일치가 생기므로, 최종 구현에서는 단일 설정 원본을 유지한다.

설정 파일 예시:

```yaml
web:
  password: change-me
runtime:
  default_mode: stopped
  random_interval_min_sec: 5
  random_interval_max_sec: 10
  pattern_lock_ms: 4000
tracking:
  second_look_delay_ms: 2500
  continuous_tracking: false
```

### 7.8 오류 처리

오류 발생 시 우선순위는 안전 정지, 상태 표시, 로그 기록이다.

| 오류 | 처리 |
| --- | --- |
| U2D2 포트 없음 | `ERROR` 상태, 웹에 포트 오류 표시 |
| 일부 모터 미응답 | 해당 모터 ID 표시, 패턴 실행 금지 |
| 모터 온도 과다 | 현재 패턴 중단, 안전 자세 또는 토크 OFF |
| 전압 이상 | 웹 경고, 로그 기록, 필요 시 정지 |
| 센서 미응답 | 감지 모드 비활성화, 랜덤/테스트는 선택적으로 허용 |
| 패턴 검증 실패 | 저장 또는 실행 차단, 오류 위치 표시 |

### 7.9 구현 우선순위

ROS2 적용안 기준 구현 우선순위:

1. `animatronic_dynamixel`: DYNAMIXEL 연결, Sync Read 진단, 기준 자세 복귀
2. `animatronic_motion`: 추상값 매핑, 패턴 파일 로드/검증/실행
3. `animatronic_web`: FastAPI 대시보드, 정지 버튼, 수동 관절 제어
4. `animatronic_logger`: 날짜별 로그 저장/조회
5. `people_mmwave_sensor`: mmWave 센서 연동, 가까운 사람 선택
6. `animatronic_motion`: 감지 모드와 랜덤 모드
7. `chicken_description`: STL/URDF 기반 관절 구조 정리
8. `animatronic_web`: Three.js 3D 뷰어
9. `animatronic_web`: 타임라인 패턴 편집기
10. `chicken_bringup`: 전체 launch/systemd 자동 실행
