from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    namespace = LaunchConfiguration("namespace")
    mock_mode = LaunchConfiguration("mock_mode")
    web_host = LaunchConfiguration("web_host")
    web_port = LaunchConfiguration("web_port")
    config_dir = PathJoinSubstitution([FindPackageShare("chicken_bringup"), "config"])

    return LaunchDescription(
        [
            DeclareLaunchArgument("namespace", default_value="animatronic"),
            DeclareLaunchArgument("mock_mode", default_value="true"),
            DeclareLaunchArgument("web_host", default_value="0.0.0.0"),
            DeclareLaunchArgument("web_port", default_value="18080"),
            Node(
                package="animatronic_web",
                executable="web_server_node",
                name="web_server_node",
                namespace=namespace,
                parameters=[
                    PathJoinSubstitution([config_dir, "web.yaml"]),
                    {"namespace": namespace},
                    {"mock_mode": ParameterValue(mock_mode, value_type=bool)},
                    {"web.host": web_host},
                    {"web.port": web_port},
                ],
            ),
        ]
    )
