# animatronic_dynamixel

ROS2 `rclpy` package for the `/animatronic` DYNAMIXEL motor node.

The default configuration runs in `mock_mode`, so it can publish `/joint_states`,
`/animatronic/motor/status`, and fake diagnostics without motor hardware.

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
/home/hifiberry/.pixi/bin/pixi run bash -lc 'source install/setup.bash && ros2 run animatronic_dynamixel motor_node --ros-args --params-file src/animatronic_dynamixel/config/motor_node.yaml'
```
