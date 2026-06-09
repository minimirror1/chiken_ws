import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    namespace = LaunchConfiguration("namespace")
    mock_mode = LaunchConfiguration("mock_mode")
    config_dir = PathJoinSubstitution([FindPackageShare("chicken_bringup"), "config"])
    bringup_config_dir = os.path.join(
        get_package_share_directory("chicken_bringup"),
        "config",
    )
    motor_config = (
        os.path.join(bringup_config_dir, "motors.yaml")
        if os.path.exists(os.path.join(bringup_config_dir, "motors.yaml"))
        else os.path.join(bringup_config_dir, "motors.example.yaml")
    )

    return LaunchDescription(
        [
            DeclareLaunchArgument("namespace", default_value="animatronic"),
            DeclareLaunchArgument("mock_mode", default_value="true"),
            Node(
                package="animatronic_dynamixel",
                executable="motor_node",
                name="motor_node",
                namespace=namespace,
                parameters=[
                    motor_config,
                    {"namespace": namespace},
                ],
            ),
            Node(
                package="people_mmwave_sensor",
                executable="sensor_node",
                name="sensor_node",
                namespace=namespace,
                parameters=[
                    PathJoinSubstitution([config_dir, "sensor.yaml"]),
                    {"namespace": namespace},
                    {"mock_mode": ParameterValue(mock_mode, value_type=bool)},
                ],
            ),
            Node(
                package="animatronic_motion",
                executable="motion_node",
                name="motion_node",
                namespace=namespace,
                parameters=[
                    PathJoinSubstitution([config_dir, "motion.yaml"]),
                    {"namespace": namespace},
                    {"mock_mode": ParameterValue(mock_mode, value_type=bool)},
                ],
            ),
        ]
    )
