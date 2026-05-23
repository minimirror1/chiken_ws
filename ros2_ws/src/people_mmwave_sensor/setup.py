from setuptools import find_packages, setup

package_name = "people_mmwave_sensor"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="shs_ws_chiken maintainers",
    maintainer_email="maintainer@example.com",
    description="IWR6843-class mmWave people detection node for animatronic robots.",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "sensor_node = people_mmwave_sensor.sensor_node:main",
        ],
    },
)
