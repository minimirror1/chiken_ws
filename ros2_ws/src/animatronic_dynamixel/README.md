# animatronic_dynamixel

ROS2 `rclpy` package for the `/animatronic` DYNAMIXEL motor node.

The motor node defaults to `mock_mode` when no parameter file is supplied. The
robot launch configuration is kept in `chicken_bringup/config/motors.yaml`, with
`chicken_bringup/config/motors.example.yaml` used as a fallback when the local
file does not exist.

## DYNAMIXEL backend connection point

`animatronic_dynamixel/motor_node.py` defines a small backend interface:
`connect`, `set_torque_enabled`, `write_joint_targets`, `read_diagnostics`,
`home`, `stop`, and `reboot`.

`MockDynamixelBackend` implements that interface for simulation. The real
DYNAMIXEL SDK integration should replace `RealDynamixelBackend` internals only,
using Sync Read inside `read_diagnostics()` and write commands inside
`write_joint_targets()`. Keep the ROS topic/service contract in `MotorNode`
unchanged.

## Run

```bash
cd /home/hifiberry/Desktop/shs_ws_chiken/ros2_ws
/home/hifiberry/.pixi/bin/pixi run colcon build --packages-select animatronic_dynamixel
/home/hifiberry/.pixi/bin/pixi run bash -lc 'source install/setup.bash && ros2 launch chicken_bringup control.launch.py'
```
