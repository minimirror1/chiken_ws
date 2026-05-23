# 움직이는 닭 모형 프로젝트 BOM / 구매목록

## 1. 문서 목적

이 문서는 로보티즈 모터와 Raspberry Pi 5 기반 움직이는 닭 모형의 구매목록을 정리한다. 시스템 설계 정책은 `docs/chicken_robot_system_plan.md`를 기준으로 한다.

## 2. 확정 구매 항목

| 분류 | 품목 | 수량 | 용도 | 상태 | 비고 |
| --- | --- | ---: | --- | --- | --- |
| 제어 보드 | Raspberry Pi 5 | 1 | ROS2 노드, FastAPI 웹 앱 실행 | 확정 | RAM 용량은 8GB 이상 권장 |
| 저장장치 | microSD 또는 NVMe SSD | 1 | OS, ROS2 워크스페이스, 로그 저장 | 확정 | 상시 운영이므로 NVMe SSD 권장 |
| OS | Ubuntu Server 24.04 LTS arm64 | 1 | ROS2 Jazzy 운영 OS | 확정 | 현재 Debian 13 대신 운영 이미지로 사용 |
| ROS2 | ROS2 Jazzy Jalisco | 1 | 로봇 제어 미들웨어 | 확정 | Ubuntu 24.04 arm64 기준 |
| DYNAMIXEL 인터페이스 | ROBOTIS U2D2 | 1 | Raspberry Pi 5와 DYNAMIXEL TTL 버스 연결 | 확정 | U2D2는 모터 전원을 공급하지 않음 |
| 주축 모터 | ROBOTIS DYNAMIXEL XM430-W210-T | 2 | `lower_yaw`, `lower_pitch` | 확정 | TTL 모델 |
| 보조축 모터 | ROBOTIS DYNAMIXEL XL320 | 2 | `upper_yaw`, `upper_pitch` | 확정 | TTL, XL320 전용 전원/케이블 주의 |
| mmWave 센서 | IWR6843급 위치 감지 mmWave 모듈 | 1 | 사람 위치/거리 감지 | 계열 확정 | 최종 제품 모델은 추가 확인 필요 |

## 3. 전원 계통

| 분류 | 품목 | 수량 | 용도 | 상태 | 비고 |
| --- | --- | ---: | --- | --- | --- |
| Raspberry Pi 전원 | Raspberry Pi 5용 USB-C 전원 어댑터 | 1 | Pi 5 전원 | 확정 | Pi 5 권장 사양 제품 사용 |
| XM430 전원 | 12V DC 전원 어댑터 | 1 | XM430-W210-T 2개 전원 | 사양 확정 필요 | 여유 전류 확보 필요 |
| XL320 전원 | XL320 허용 전압 DC 전원 | 1 | XL320 2개 전원 | 사양 확정 필요 | XM430 12V와 직접 공용 금지 |
| 전원 분배 | DYNAMIXEL 전원 분배 보드/허브 | 1~2 | 모터 전원 분배 | 선정 필요 | XM430/XL320 전원 분리 필요 |
| 전원 스위치 | DC 라인 스위치 또는 차단 스위치 | 2 | 모터 전원 정비/차단 | 권장 | XM430, XL320 각각 분리 |
| 보호 부품 | 퓨즈 또는 폴리퓨즈 | 2 | 모터 전원 라인 보호 | 권장 | 전원 라인별 적용 |

전원 정책:

- Raspberry Pi 5 전원과 모터 전원은 분리한다.
- XM430-W210-T와 XL320 전원은 분리한다.
- DYNAMIXEL TTL 데이터 라인은 공유할 수 있다.
- 모든 통신 기준 GND는 공통으로 연결한다.

## 4. 통신/케이블

| 분류 | 품목 | 수량 | 용도 | 상태 | 비고 |
| --- | --- | ---: | --- | --- | --- |
| USB 케이블 | Raspberry Pi 5 - U2D2 연결 케이블 | 1 | USB 직렬 통신 | 확정 | U2D2 구매 구성품 확인 |
| DYNAMIXEL TTL 케이블 | X-series용 JST 3P TTL 케이블 | 필요 길이별 | XM430 연결 | 필요 | 길이는 실제 배치 후 산정 |
| XL320 케이블 | XL320 전용 3P 케이블 | 필요 길이별 | XL320 연결 | 필요 | 일반 AX/X 케이블과 호환 주의 |
| 변환 케이블 | U2D2/XM/XL320 연결 변환 케이블 | 필요 시 | 커넥터 규격 변환 | 확인 필요 | U2D2 구성품과 실제 배선 확인 |
| 센서 케이블 | mmWave UART/USB 연결 케이블 | 1 | 센서 데이터 수신 | 센서 모델 후 확정 | 전원/신호 규격 확인 필요 |

## 5. 센서 후보

IWR6843급 위치 감지 기능을 기준으로 한다.

| 우선순위 | 후보 | 수량 | 장점 | 확인 필요 |
| --- | --- | ---: | --- | --- |
| 1 | Murata Type1VN 계열 | 1 | IWR6843 기반 모듈형 제품, 위치/속도 감지 방향에 적합 | 구매 가능성, UART 데이터 포맷, SDK |
| 2 | Mistral 60GHz AoPCB RADAR Module | 1 | IWR6843 기반 상용 모듈 | 납기, 최소 주문 수량, 문서 접근성 |
| 3 | TI IWR6843ISK 또는 IWR6843AOPEVM | 1 | 레퍼런스와 성능 검증에 유리 | 평가보드 성격, 설치 부피 |

센서 구매 전 확인 항목:

- Raspberry Pi 5에서 받을 수 있는 인터페이스: UART 또는 USB
- 사람별 거리/각도/좌표 데이터 제공 여부
- 여러 사람 감지 시 대상 목록 제공 여부
- 실내 1~2m 거리에서 안정 동작 여부
- SDK 또는 프로토콜 문서 접근 가능 여부
- 센서 전원 전압과 소비전류
- 설치 방향, FOV, 케이스 고정 방식

## 6. 기구/설치 보조 부품

기구 담당자가 별도 제작하므로, 이 문서에서는 제어 시스템에 필요한 설치 보조 부품만 정리한다.

| 분류 | 품목 | 수량 | 용도 | 상태 |
| --- | --- | ---: | --- | --- |
| 안전 와이어 | 낙하 방지 와이어 | 1식 | 닭 본체/나무 고정부 보강 | 필요 |
| 브래킷 | Raspberry Pi/U2D2/전원 고정 브래킷 | 1식 | 정비 가능한 위치에 고정 | 필요 |
| 케이블 타이/클립 | 배선 고정재 | 1식 | 전시장 상시 운영 배선 정리 | 필요 |
| 케이블 라벨 | 라벨/마킹 튜브 | 1식 | 모터 ID, 전원 라인 식별 | 권장 |
| 케이스 | Raspberry Pi 보호 케이스 | 1 | 먼지/접촉 보호 | 권장 |
| 냉각 | Pi 5 방열판/팬 | 1 | 상시 운영 안정성 | 권장 |

## 7. 소프트웨어 항목

| 분류 | 품목 | 용도 | 상태 |
| --- | --- | --- | --- |
| ROS2 | Jazzy Jalisco | ROS2 노드 실행 | 확정 |
| Python | Ubuntu 24.04 기본 Python | ROS2 Python 노드, FastAPI | 확정 |
| FastAPI | 웹 API/서버 | 브라우저 앱 백엔드 | 확정 |
| Three.js | 3D 뷰어 | STL 기반 관절 뷰어 | 확정 |
| DYNAMIXEL SDK | 모터 제어 | U2D2 통신 | 확정 |
| systemd | 자동 실행 | 부팅 시 ROS2/FastAPI 실행 | 확정 |

## 8. 구매 전 체크리스트

- XM430-W210-T 2개와 XL320 2개의 통신 ID를 중복 없이 설정할 수 있는지 확인
- XM430-W210-T와 XL320의 전원 라인을 물리적으로 분리할 수 있는지 확인
- U2D2 구성품에 필요한 케이블이 포함되는지 확인
- XL320 케이블이 X-series 케이블과 다른 점을 확인
- IWR6843급 센서가 UART/USB로 사람 위치 데이터를 제공하는지 확인
- 전시장 나무 위 설치 위치에서 전원 어댑터와 Raspberry Pi에 의자만으로 접근 가능한지 확인
- 상시 운영을 위해 Raspberry Pi 냉각과 로그 저장장치 내구성을 확인

## 9. 참고 링크

- ROBOTIS U2D2: https://robotis.us/u2d2/
- ROBOTIS U2D2 e-Manual: https://emanual.robotis.com/docs/en/parts/interface/u2d2/
- ROBOTIS XM430-W210-T: https://www.robotis.us/dynamixel-xm430-w210-t/
- ROBOTIS XM430-W210-T e-Manual: https://emanual.robotis.com/docs/en/dxl/x/xm430-w210/
- ROBOTIS XL320: https://www.robotis.us/dynamixel-xl-320/
- Murata Type1VN: https://www.murata.com/en-eu/products/connectivitymodule/mmwave-radar/industrial/overview/lineup/type1vn
- Mistral 60GHz AoPCB RADAR Module: https://www.mistralsolutions.com/product-engineering-services/products/som-modules/60ghz-industrial-mmwave-radar-module/
- TI IWR6843: https://www.ti.com/product/IWR6843
- ROS2 Jazzy installation: https://docs.ros.org/en/jazzy/Installation.html
