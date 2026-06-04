cmake_minimum_required(VERSION 3.10)
project(animatronic_interfaces)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(rosidl_default_generators REQUIRED)

set(msg_files
  "msg/DetectedPerson.msg"
  "msg/DetectedPersonArray.msg"
  "msg/EventLog.msg"
  "msg/JointTarget.msg"
  "msg/JointTargets.msg"
  "msg/Mode.msg"
  "msg/MotionStatus.msg"
  "msg/MotorCalibration.msg"
  "msg/MotorDiagnostic.msg"
  "msg/MotorDiagnosticsArray.msg"
  "msg/MotorStatus.msg"
  "msg/SensorStatus.msg"
)

set(srv_files
  "srv/MotorCommand.srv"
  "srv/SetMotorCalibration.srv"
  "srv/SetMode.srv"
  "srv/ValidatePattern.srv"
)

set(action_files
  "action/RunPattern.action"
)

rosidl_generate_interfaces(${PROJECT_NAME}
  ${msg_files}
  ${srv_files}
  ${action_files}
  DEPENDENCIES builtin_interfaces
)

ament_export_dependencies(rosidl_default_runtime)
ament_package()
