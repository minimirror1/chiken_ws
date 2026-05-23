from setuptools import find_packages, setup

package_name = "animatronic_logger"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml", "README.md"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="shs_ws_chiken maintainers",
    maintainer_email="maintainer@example.com",
    description="JSONL event logger for animatronic ROS2 systems.",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "logger_node = animatronic_logger.logger_node:main",
        ],
    },
)
