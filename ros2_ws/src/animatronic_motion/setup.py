from glob import glob
from setuptools import find_packages, setup

package_name = "animatronic_motion"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        ("share/" + package_name + "/patterns", glob("patterns/*.yaml")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="hifiberry",
    maintainer_email="hifiberry@example.com",
    description="Pattern loading and motion target publishing for animatronic robots.",
    license="MIT",
    entry_points={
        "console_scripts": [
            "motion_node = animatronic_motion.motion_node:main",
        ],
    },
)
