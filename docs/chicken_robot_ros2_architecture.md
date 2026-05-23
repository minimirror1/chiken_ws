# 움직이는 닭 모형 ROS2 패키지와 노드 구조 설계

## 1. 목적

이 문서는 움직이는 닭 모형 프로젝트의 ROS2 패키지와 노드 구조를 정의한다. 전체 시스템 정책은 `docs/chicken_robot_system_plan.md`, 구매목록은 `docs/chicken_robot_bom.md`를 기준으로 한다.

## 2. 확정 전제

| 구분 | 내용 |
| --- | --- |
| 운영 OS | Ubuntu Server 24.04 LTS arm64 |
| ROS2 배포판 | ROS2 Jazzy Jalisco |
| 제어 보드 | Raspberry Pi 5 |
| 모터 인터페이스 | ROBOTIS U2D2, TTL DYNAMIXEL bus |
| 모터 구성 | XM430-W210-T 2개, XL320 2개 |
| 관절 구성 | `lower_yaw`, `lower_pitch`, `upper_yaw`, `upper_pitch` |
| 센서 | IWR6843급 mmWave 사람 위치 감지 |
| 웹 UI | FastAPI + 브라우저 앱 + Three.js |
| 패턴 파일 | YAML |
| 모션값 | 추상값 `-100~100` |
| DYNAMIXEL raw position | `0~4095` |
| 진단 읽기 | Sync Read 고정 |

## 3. 워크스페이스 구조

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

패키지 분리 원칙:

- `chicken_bringup`, `chicken_description`은 닭 모형 전용으로 유지한다.
- 다른 동물이나 오브제에 재사용할 가능성이 높은 패키지는 `chicken` 이름을 제거한다.
- 하드웨어 직접 접근은 `animatronic_dynamixel`, `people_mmwave_sensor`에 둔다.
- 모션 패턴 실행은 `animatronic_motion`이 담당한다.
- 웹 UI는 `animatronic_web`에 두되, 화면 구현은 FastAPI/브라우저 앱으로 처리한다.
- 공통 메시지, 서비스, 액션은 `animatronic_interfaces`에 둔다.
- 전체 실행과 파라미터 로딩은 닭 프로젝트 전용 `chicken_bringup`에서 관리한다.
- ROS2 topic namespace는 기본값으로 `/animatronic`을 사용한다.
- 닭 프로젝트에서는 launch parameter로 namespace를 `/chicken`으로 바꿔 실행할 수 있게 한다.
- 다른 동물이나 오브제 프로젝트에서는 동일 패키지를 재사용하고 namespace만 `/dog`, `/tree`, `/object_name`처럼 변경한다.

## 4. 패키지 역할

| 패키지 | 역할 |
| --- | --- |
| `chicken_bringup` | 전체 launch, 파라미터 로딩, systemd 실행 진입점 |
| `chicken_description` | URDF/xacro, STL 모델, TF 관절 구조 |
| `animatronic_interfaces` | custom msg/srv/action 정의 |
| `animatronic_dynamixel` | DYNAMIXEL 제어, Sync Read 진단, 홈 복귀, 토크 제어 |
| `people_mmwave_sensor` | IWR6843급 mmWave 센서 파싱, 가까운 사람 선택 |
| `animatronic_motion` | 패턴 파일 로드/검증, 키프레임 보간, 모션 실행 |
| `animatronic_web` | FastAPI 서버, Three.js UI, 타임라인 편집기, ROS2 브리지 |
| `animatronic_logger` | 이벤트 로그 저장, 조회 API 보조 |

## 5. 노드 구성

### 5.1 전체 노드

| 노드 | 패키지 | 역할 |
| --- | --- | --- |
| `motor_node` | `animatronic_dynamixel` | DYNAMIXEL 명령/상태/진단 |
| `sensor_node` | `people_mmwave_sensor` | mmWave 사람 위치 감지 |
| `motion_node` | `animatronic_motion` | 패턴 실행과 모션 상태 관리 |
| `web_server_node` | `animatronic_web` | FastAPI 서버와 ROS2 브리지 |
| `logger_node` | `animatronic_logger` | 이벤트 로그 기록 |
| `robot_state_publisher` | ROS2 표준 | URDF 기반 TF publish |

### 5.2 `motor_node`

책임:

- U2D2 포트 연결
- DYNAMIXEL ID 검색
- 기준 자세 복귀
- 목표 관절값 수신
- 추상값/각도/raw position 매핑 후 모터 명령
- Sync Read 기반 위치, 전압, 온도, 부하 진단 publish
- 토크 ON/OFF
- 모터 오류 감지

Subscribe:

| Topic | Type | 설명 |
| --- | --- | --- |
| `/animatronic/target_joints` | `animatronic_interfaces/msg/JointTargets` | 목표 관절 추상값 |
| `/animatronic/motor/torque_enable` | `std_msgs/msg/Bool` | 모터 토크 ON/OFF |

Publish:

| Topic | Type | 설명 |
| --- | --- | --- |
| `/joint_states` | `sensor_msgs/msg/JointState` | 현재 관절 상태 |
| `/animatronic/motor/diagnostics` | `animatronic_interfaces/msg/MotorDiagnosticsArray` | 모터 진단값 |
| `/animatronic/motor/status` | `animatronic_interfaces/msg/MotorStatus` | 연결/오류 상태 |

Service:

| Service | Type | 설명 |
| --- | --- | --- |
| `/animatronic/motor/home` | `std_srvs/srv/Trigger` | 기준 자세 복귀 |
| `/animatronic/motor/stop` | `std_srvs/srv/Trigger` | 현재 명령 중단 |
| `/animatronic/motor/reboot` | `animatronic_interfaces/srv/MotorCommand` | 특정 모터 reboot |

### 5.3 `sensor_node`

책임:

- IWR6843급 mmWave 센서 연결
- 센서 데이터 프레임 파싱
- 사람 후보 목록 생성
- 가장 가까운 사람 선택
- 감지 유지 시간/오검출 필터 적용

Publish:

| Topic | Type | 설명 |
| --- | --- | --- |
| `/animatronic/people` | `animatronic_interfaces/msg/DetectedPersonArray` | 감지된 사람 목록 |
| `/animatronic/nearest_person` | `animatronic_interfaces/msg/DetectedPerson` | 가장 가까운 사람 |
| `/animatronic/sensor/status` | `animatronic_interfaces/msg/SensorStatus` | 센서 연결/오류 상태 |

### 5.4 `motion_node`

책임:

- 운영 모드 관리: 감지, 랜덤, 테스트, 정지
- YAML 패턴 로드/검증
- 키프레임 보간
- `linear`, `ease_in_out`, `snap`, `hold` 처리
- 감지 이벤트 기반 패턴 선택
- 감지 순간 1회 + 지연 후 1회 바라보기
- `pattern_lock_ms` 적용
- 정지 명령 우선 처리

Subscribe:

| Topic | Type | 설명 |
| --- | --- | --- |
| `/animatronic/nearest_person` | `animatronic_interfaces/msg/DetectedPerson` | 반응 대상 |
| `/animatronic/mode` | `animatronic_interfaces/msg/Mode` | 운영 모드 변경 |
| `/animatronic/motor/status` | `animatronic_interfaces/msg/MotorStatus` | 모터 오류 감시 |

Publish:

| Topic | Type | 설명 |
| --- | --- | --- |
| `/animatronic/target_joints` | `animatronic_interfaces/msg/JointTargets` | motor_node로 보낼 목표 관절값 |
| `/animatronic/motion/status` | `animatronic_interfaces/msg/MotionStatus` | 현재 패턴, 진행률, 잠금 상태 |
| `/animatronic/events` | `animatronic_interfaces/msg/EventLog` | 패턴 실행/전환 이벤트 |

Action:

| Action | Type | 설명 |
| --- | --- | --- |
| `/animatronic/run_pattern` | `animatronic_interfaces/action/RunPattern` | 패턴 실행 |

Service:

| Service | Type | 설명 |
| --- | --- | --- |
| `/animatronic/motion/stop` | `std_srvs/srv/Trigger` | 모션 즉시 중단 |
| `/animatronic/motion/validate_pattern` | `animatronic_interfaces/srv/ValidatePattern` | 패턴 검증 |

### 5.5 `web_server_node`

책임:

- FastAPI 서버 실행
- 브라우저 앱 정적 파일 제공
- 비밀번호 인증
- REST API 제공
- WebSocket 상태 스트림 제공
- ROS2 topic/service/action bridge
- 패턴 파일 목록/저장/편집
- 로그 조회
- Three.js 3D 뷰어 데이터 제공

웹 기능은 ROS2 callback 내부에 직접 구현하지 않는다. `web_server_node`는 FastAPI 앱과 ROS2를 연결하는 브리지 역할을 한다.

ROS2 연결:

| 연결 | 내용 |
| --- | --- |
| Subscribe | `/joint_states`, `/animatronic/motor/diagnostics`, `/animatronic/motion/status`, `/animatronic/nearest_person`, `/animatronic/events` |
| Publish | `/animatronic/mode`, `/animatronic/motor/torque_enable` |
| Service Client | `/animatronic/motor/home`, `/animatronic/motor/stop`, `/animatronic/motion/stop` |
| Action Client | `/animatronic/run_pattern` |

### 5.6 `logger_node`

책임:

- `/animatronic/events` 구독
- 날짜별 로그 파일 저장
- 프로그램 시작/종료, 모드 변경, 센서 감지, 패턴 실행, 오류 기록

Subscribe:

| Topic | Type | 설명 |
| --- | --- | --- |
| `/animatronic/events` | `animatronic_interfaces/msg/EventLog` | 시스템 이벤트 |
| `/animatronic/motor/status` | `animatronic_interfaces/msg/MotorStatus` | 모터 상태 변화 |
| `/animatronic/sensor/status` | `animatronic_interfaces/msg/SensorStatus` | 센서 상태 변화 |

## 6. Custom Interfaces

### 6.1 Messages

```text
animatronic_interfaces/msg/
  JointTarget.msg
  JointTargets.msg
  MotorDiagnostic.msg
  MotorDiagnosticsArray.msg
  MotorStatus.msg
  DetectedPerson.msg
  DetectedPersonArray.msg
  SensorStatus.msg
  MotionStatus.msg
  Mode.msg
  EventLog.msg
```

예시 필드:

```text
# JointTarget.msg
string name
float32 normalized_value
float32 angle_deg
int32 raw_position
```

```text
# DetectedPerson.msg
string id
float32 x_m
float32 y_m
float32 z_m
float32 distance_m
float32 angle_deg
float32 confidence
builtin_interfaces/Time stamp
```

```text
# MotorDiagnostic.msg
uint8 id
string joint_name
string model
int32 raw_position
float32 angle_deg
float32 voltage_v
float32 temperature_c
float32 load
bool torque_enabled
uint8 error_code
```

### 6.2 Services

```text
animatronic_interfaces/srv/
  MotorCommand.srv
  ValidatePattern.srv
  SetMode.srv
```

### 6.3 Actions

```text
animatronic_interfaces/action/
  RunPattern.action
```

`RunPattern.action` 개념:

```text
# Goal
string pattern_name
bool preview_only
bool allow_interrupt
---
# Result
bool success
string message
---
# Feedback
float32 progress
string current_keyframe
```

## 7. Topic / Service / Action 요약

### 7.1 Topics

| Topic | Publisher | Subscriber | Type |
| --- | --- | --- | --- |
| `/joint_states` | `motor_node` | `robot_state_publisher`, `web_server_node` | `sensor_msgs/msg/JointState` |
| `/animatronic/target_joints` | `motion_node` | `motor_node` | `JointTargets` |
| `/animatronic/motor/diagnostics` | `motor_node` | `web_server_node` | `MotorDiagnosticsArray` |
| `/animatronic/motor/status` | `motor_node` | `motion_node`, `logger_node`, `web_server_node` | `MotorStatus` |
| `/animatronic/people` | `sensor_node` | - | `DetectedPersonArray` |
| `/animatronic/nearest_person` | `sensor_node` | `motion_node`, `web_server_node` | `DetectedPerson` |
| `/animatronic/sensor/status` | `sensor_node` | `logger_node`, `web_server_node` | `SensorStatus` |
| `/animatronic/mode` | `web_server_node` | `motion_node` | `Mode` |
| `/animatronic/motion/status` | `motion_node` | `web_server_node` | `MotionStatus` |
| `/animatronic/events` | all nodes | `logger_node`, `web_server_node` | `EventLog` |

### 7.2 Services

| Service | Server | Client | Type |
| --- | --- | --- | --- |
| `/animatronic/motor/home` | `motor_node` | `web_server_node` | `std_srvs/srv/Trigger` |
| `/animatronic/motor/stop` | `motor_node` | `web_server_node` | `std_srvs/srv/Trigger` |
| `/animatronic/motor/reboot` | `motor_node` | - | `MotorCommand` |
| `/animatronic/motion/stop` | `motion_node` | `web_server_node` | `std_srvs/srv/Trigger` |
| `/animatronic/motion/validate_pattern` | `motion_node` | - | `ValidatePattern` |

### 7.3 Actions

| Action | Server | Client | Type |
| --- | --- | --- | --- |
| `/animatronic/run_pattern` | `motion_node` | `web_server_node` | `RunPattern` |

## 8. 파라미터 구조

```text
config/
  motors.yaml
  joints.yaml
  sensor.yaml
  motion.yaml
  web.yaml
```

### 8.1 `motors.yaml`

```yaml
/**:
  ros__parameters:
    mock_mode: true
    port: /dev/ttyUSB0
    baudrate: 1000000
    joints:
      lower_yaw:
        id: 1
        model: XM430-W210-T
        min_angle_deg: -90.0
        max_angle_deg: 90.0
      lower_pitch:
        id: 2
        model: XM430-W210-T
        min_angle_deg: -45.0
        max_angle_deg: 45.0
      upper_yaw:
        id: 3
        model: XL320
        min_angle_deg: -90.0
        max_angle_deg: 90.0
      upper_pitch:
        id: 4
        model: XL320
        min_angle_deg: -45.0
        max_angle_deg: 45.0
```

### 8.2 `joints.yaml`

```yaml
motor_node:
  ros__parameters:
    joints:
      lower_yaw:
        normalized_min: -100
        normalized_max: 100
        angle_min_deg: -45
        angle_max_deg: 45
        raw_min: 1024
        raw_max: 3072
      lower_pitch:
        normalized_min: -100
        normalized_max: 100
        angle_min_deg: -40
        angle_max_deg: 40
        raw_min: 1200
        raw_max: 2900
      upper_yaw:
        normalized_min: -100
        normalized_max: 100
        angle_min_deg: -35
        angle_max_deg: 35
        raw_min: 1250
        raw_max: 2850
      upper_pitch:
        normalized_min: -100
        normalized_max: 100
        angle_min_deg: -35
        angle_max_deg: 35
        raw_min: 1250
        raw_max: 2850
```

### 8.3 `motion.yaml`

```yaml
/**:
  ros__parameters:
    mock_mode: true
    pattern_dir: patterns
    default_mode: idle
    pattern_lock_ms: 1500
    update_rate_hz: 30.0
```

## 9. Launch 구조

```text
chicken_bringup/
  launch/
    chicken.launch.py
    control.launch.py
    web.launch.py
  config/
    motors.yaml
    joints.yaml
    sensor.yaml
    motion.yaml
    web.yaml
```

`chicken.launch.py` 실행 대상:

1. `robot_state_publisher`
2. `motor_node`
3. `sensor_node`
4. `motion_node`
5. `logger_node`
6. `web_server_node`

현재 launch 인자:

| Argument | 기본값 | 설명 |
| --- | --- | --- |
| `namespace` | `animatronic` | topic/service/action namespace. 노드 내부에서는 `/animatronic` 형태로 정규화한다. |
| `mock_mode` | `true` | `true`일 때 하드웨어 없이 mock backend로 `motor_node`, `sensor_node`, `motion_node`, `web_server_node`를 모두 실행한다. |
| `web_host` | `0.0.0.0` | FastAPI listen host |
| `web_port` | `8080` | FastAPI listen port. 이미 사용 중이면 launch 시 다른 포트로 넘긴다. |

## 10. 실행 흐름

### 10.1 부팅

1. systemd가 ROS2 launch 실행
2. `motor_node`가 U2D2 포트 연결
3. DYNAMIXEL ID 확인
4. Sync Read 그룹 구성
5. 저속 기준 자세 복귀
6. `sensor_node`가 mmWave 연결
7. `web_server_node`가 FastAPI 서버 시작
8. 웹 대시보드에서 상태 확인

### 10.2 감지 모드

1. `sensor_node`가 사람 목록 publish
2. 가장 가까운 사람을 `/animatronic/nearest_person`으로 publish
3. `motion_node`가 패턴 잠금 상태 확인
4. 바라보기/놀람 패턴 선택
5. `/animatronic/target_joints` publish
6. `motor_node`가 DYNAMIXEL 위치 명령 수행
7. `logger_node`가 이벤트 저장

### 10.3 웹 패턴 실행

1. 사용자가 웹에서 패턴 선택
2. 미리보기 또는 바로 실행 선택
3. `web_server_node`가 `/animatronic/run_pattern` action 호출
4. `motion_node`가 패턴 검증 후 실행
5. feedback을 웹 UI에 표시
6. 완료 또는 중단 결과 표시

## 11. 구현 우선순위

1. `animatronic_interfaces` 메시지/서비스/액션 정의
2. `animatronic_dynamixel`의 `motor_node` 최소 구현
3. `chicken_bringup` 기본 launch
4. `animatronic_web` FastAPI 대시보드와 정지/홈 버튼
5. `animatronic_motion` 패턴 로드/검증/실행
6. `animatronic_logger` 이벤트 로그 저장
7. `people_mmwave_sensor` mmWave 파서
8. `chicken_description` URDF/STL 구조
9. `animatronic_web` Three.js 3D 뷰어
10. `animatronic_web` 타임라인 패턴 편집기

## 12. 설계 원칙

- 모터 제어 명령은 항상 관절 제한과 raw position 제한을 통과해야 한다.
- 웹 정지 명령은 모든 패턴 실행보다 우선한다.
- ROS2 노드는 하드웨어와 상태 흐름을 담당하고, 웹 UX는 FastAPI 브라우저 앱이 담당한다.
- 패턴 파일은 하드웨어 raw값을 직접 저장하지 않고 추상값만 저장한다.
- 하드웨어 보정은 `joints.yaml`에 둔다.
- Sync Read는 모델/주소별 그룹으로 나눠 수행한다.
- 로그는 날짜별 파일로 누적 저장한다.
