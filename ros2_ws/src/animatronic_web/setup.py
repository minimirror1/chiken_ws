from glob import glob
from setuptools import find_packages, setup

package_name = "animatronic_web"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml", "README.md"]),
        (f"share/{package_name}/static", glob("static/*")),
        (f"share/{package_name}/patterns", glob("patterns/*")),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="hifiberry",
    maintainer_email="hifiberry@example.com",
    description="FastAPI dashboard and ROS2 bridge for the animatronic robot.",
    license="Proprietary",
    entry_points={
        "console_scripts": [
            "web_server_node = animatronic_web.web_server_node:main",
        ],
    },
)
