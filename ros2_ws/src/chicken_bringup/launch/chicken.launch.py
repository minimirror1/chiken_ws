from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
import os

from ament_index_python.packages import get_package_share_directory
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    namespace = LaunchConfiguration("namespace")
    mock_mode = LaunchConfiguration("mock_mode")
    web_host = LaunchConfiguration("web_host")
    web_port = LaunchConfiguration("web_port")
    bringup_share = FindPackageShare("chicken_bringup")
    description_share_path = get_package_share_directory("chicken_description")
    config_dir = PathJoinSubstitution([bringup_share, "config"])
    urdf_path = os.path.join(
        description_share_path,
        "urdf",
        "chicken_neck.urdf.xacro",
    )
    with open(urdf_path, "r", encoding="utf-8") as urdf_file:
        robot_description = urdf_file.read()

    return LaunchDescription(
        [
            DeclareLaunchArgument("namespace", default_value="animatronic"),
            DeclareLaunchArgument("mock_mode", default_value="true"),
            DeclareLaunchArgument("web_host", default_value="0.0.0.0"),
            DeclareLaunchArgument("web_port", default_value="18080"),
            Node(
                package="robot_state_publisher",
                executable="robot_state_publisher",
                name="robot_state_publisher",
                namespace=namespace,
                parameters=[
                    PathJoinSubstitution([config_dir, "joints.yaml"]),
                    {"robot_description": robot_description},
                ],
                remappings=[
                    ("joint_states", "/joint_states"),
                ],
            ),
            Node(
                package="animatronic_logger",
                executable="logger_node",
                name="logger_node",
                namespace=namespace,
                parameters=[
                    {
                        "namespace": namespace,
                        "log_dir": PathJoinSubstitution([bringup_share, "logs"]),
                        "mirror_to_stdout": False,
                    }
                ],
            ),
            IncludeLaunchDescription(
                PythonLaunchDescriptionSource(
                    PathJoinSubstitution([bringup_share, "launch", "control.launch.py"])
                ),
                launch_arguments={
                    "namespace": namespace,
                    "mock_mode": mock_mode,
                }.items(),
            ),
            IncludeLaunchDescription(
                PythonLaunchDescriptionSource(
                    PathJoinSubstitution([bringup_share, "launch", "web.launch.py"])
                ),
                launch_arguments={
                    "namespace": namespace,
                    "mock_mode": mock_mode,
                    "web_host": web_host,
                    "web_port": web_port,
                }.items(),
            ),
        ]
    )
