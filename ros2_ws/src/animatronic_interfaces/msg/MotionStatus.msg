uint8 IDLE=0
uint8 RUNNING=1
uint8 LOCKED=2
uint8 STOPPED=3
uint8 ERROR=4

builtin_interfaces/Time stamp
uint8 status
Mode mode
string current_pattern
float32 progress
bool pattern_locked
builtin_interfaces/Time lock_until
string message
