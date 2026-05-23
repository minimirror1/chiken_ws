# ROS2 Jazzy Pixi 설치 기록

## 1. 목적

이 문서는 현재 Raspberry Pi 5 환경에서 ROS2 Jazzy를 설치한 방법과 검증 결과를 기록한다.

## 2. 현재 시스템

확인 명령:

```bash
cat /etc/os-release
uname -m
```

확인 결과:

```text
Debian GNU/Linux 13 (trixie)
aarch64
```

현재 시스템은 Debian 13 기반이다. ROS2 Jazzy의 공식 바이너리 설치 대상은 Ubuntu 24.04 arm64이므로, 이 장비에는 apt 기반 공식 설치 대신 사용자 권한의 Pixi/RoboStack 환경을 구성했다.

## 3. 설치 방식

사용한 방식:

- Pixi
- RoboStack Jazzy
- Conda-forge
- 시스템 apt 저장소 변경 없음
- sudo 설치 없음

Pixi 설치 명령:

```bash
curl -fsSL https://pixi.sh/install.sh | bash
```

Pixi 설치 위치:

```text
/home/hifiberry/.pixi/bin/pixi
```

## 4. ROS2 워크스페이스 환경 파일

환경 파일:

```text
ros2_ws/pixi.toml
```

주요 내용:

```toml
[workspace]
name = "chicken-robot-ros2-ws"
channels = [
  "https://prefix.dev/robostack-jazzy",
  "https://prefix.dev/conda-forge",
]
platforms = ["linux-aarch64"]

[dependencies]
python = "3.12.*"
colcon-common-extensions = "*"
ros-jazzy-ros-base = "*"
ros-jazzy-ament-cmake = "*"
ros-jazzy-builtin-interfaces = "*"
ros-jazzy-rosidl-default-generators = "*"
ros-jazzy-rosidl-default-runtime = "*"
ros-jazzy-sensor-msgs = "*"
ros-jazzy-std-msgs = "*"
ros-jazzy-std-srvs = "*"
```

설치 명령:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi install
```

설치 후 생성된 주요 파일:

```text
ros2_ws/pixi.toml
ros2_ws/pixi.lock
ros2_ws/.pixi/
```

## 5. 사용 방법

방법 1: Pixi shell 진입

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi shell
```

방법 2: Pixi run으로 직접 실행

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run ros2 --help
/home/hifiberry/.pixi/bin/pixi run colcon --help
```

전체 워크스페이스 빌드/테스트:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run colcon build
/home/hifiberry/.pixi/bin/pixi run colcon test
```

mock mode 전체 launch:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run bash -lc 'source install/setup.bash && ros2 launch chicken_bringup chicken.launch.py mock_mode:=true'
```

웹 기본 포트 `8080`이 이미 사용 중이면 다른 포트를 지정한다:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run bash -lc 'source install/setup.bash && ros2 launch chicken_bringup chicken.launch.py mock_mode:=true web_port:=18080'
```

## 6. 검증 결과

ROS2 CLI 확인:

```bash
/home/hifiberry/.pixi/bin/pixi run ros2 --help
```

결과:

```text
ros2 is an extensible command-line tool for ROS 2.
```

colcon 확인:

```bash
/home/hifiberry/.pixi/bin/pixi run colcon --help
```

결과:

```text
colcon verbs:
  build
  test
  list
  ...
```

## 7. animatronic_interfaces 빌드 검증

빌드 명령:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run build-interfaces
```

결과:

```text
Finished <<< animatronic_interfaces
Summary: 1 package finished
```

인터페이스 확인:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run bash -lc 'source install/setup.bash && ros2 interface show animatronic_interfaces/msg/JointTarget'
```

결과:

```text
string name
float32 normalized_value
float32 angle_deg
int32 raw_position
```

테스트 명령:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run test-interfaces
```

결과:

```text
Summary: 1 package finished
Summary: 0 tests, 0 errors, 0 failures, 0 skipped
```

## 8. ROS2 Doctor 확인

명령:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run ros2 doctor --report
```

주요 확인 결과:

```text
distribution name      : jazzy
distribution type      : ros2
distribution status    : active
middleware name        : rmw_fastrtps_cpp
```

## 9. 주의사항

- 현재 설치는 시스템 전역 ROS2 설치가 아니다.
- ROS2 명령은 Pixi 환경 안에서 실행해야 한다.
- `sudo apt install ros-jazzy-*` 방식은 현재 Debian 13 환경에서는 사용하지 않는다.
- 최종 운영 OS를 Ubuntu Server 24.04 LTS arm64로 재설치하면 공식 ROS2 apt 설치 방식으로 전환할 수 있다.
- Pixi 설치 중 post-link script 경고가 있었으나, ROS2 CLI와 `animatronic_interfaces` 빌드/테스트는 정상 동작했다.

## 10. 참고 자료

- ROS2 Jazzy 공식 설치 문서: https://docs.ros.org/en/jazzy/Installation.html
- RoboStack Jazzy: https://robostack.github.io/jazzy.html
- Pixi: https://pixi.sh/
