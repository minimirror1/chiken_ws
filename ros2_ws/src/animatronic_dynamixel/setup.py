from glob import glob
from setuptools import find_packages, setup


package_name = "animatronic_dynamixel"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml", "README.md"]),
        (f"share/{package_name}/config", glob("config/*.yaml")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="shs_ws_chiken maintainers",
    maintainer_email="maintainer@example.com",
    description="DYNAMIXEL motor control node for reusable animatronic robots.",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "motor_node = animatronic_dynamixel.motor_node:main",
        ],
    },
)
