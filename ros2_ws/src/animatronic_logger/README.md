# animatronic_logger

`logger_node` subscribes to ROS2 system events and status topics, then writes one JSON object per line to a date-based file.

## Topics

- `/animatronic/events`: `animatronic_interfaces/msg/EventLog`
- `/animatronic/motor/status`: `animatronic_interfaces/msg/MotorStatus`
- `/animatronic/sensor/status`: `animatronic_interfaces/msg/SensorStatus`

## Parameters

- `log_dir`: directory for JSONL files. Default: `logs`
- `mirror_to_stdout`: also print each JSON record to stdout. Default: `false`

## Output

Files are written as:

```text
logs/YYYY-MM-DD.jsonl
```

Records include:

- `timestamp`
- `severity`
- `source`
- `event_type`
- `message`
- `detail`

## Manual Test

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run colcon build --packages-select animatronic_logger
source install/setup.bash
ros2 run animatronic_logger logger_node --ros-args -p log_dir:=/tmp/animatronic_logs -p mirror_to_stdout:=true
```

In another terminal:

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
source install/setup.bash
ros2 topic pub --once /animatronic/events animatronic_interfaces/msg/EventLog "{severity: 1, source: manual_test, event_type: test_event, message: logger test, detail: '{}'}"
cat /tmp/animatronic_logs/$(date -u +%F).jsonl
```
