# animatronic_web

FastAPI based ROS2 web bridge for the animatronic robot.

## Build

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run colcon build --packages-select animatronic_web
```

## Run

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run bash -lc 'source install/setup.bash && ros2 run animatronic_web web_server_node'
```

Open `http://localhost:8080`.

Optional parameters:

```bash
ros2 run animatronic_web web_server_node --ros-args \
  -p password:=change-me \
  -p web.host:=0.0.0.0 \
  -p web.port:=8080 \
  -p namespace:=/animatronic
```

If `password` is set, REST calls require `X-Animatronic-Password` or `?password=...`.
The status WebSocket accepts `?password=...`.

## API

- `GET /api/status`
- `POST /api/mode`
- `POST /api/home`
- `POST /api/stop`
- `POST /api/torque`
- `GET /api/patterns`
- `GET /api/patterns/{name}`
- `PUT /api/patterns/{name}`
- `GET /api/logs`
- `WebSocket /ws/status`

The node can start without motor, motion, sensor, or logger nodes. Unavailable services return a JSON failure instead of preventing server startup.
