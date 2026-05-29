/* ============================================================
   store.jsx — 전역 상태 + 라이브 데이터 시뮬레이션
   + ROS 백엔드 브릿지 (WebSocket + REST)
   ============================================================ */

// ---- joint config ----
const JOINTS = [
  { id: 'lower_yaw',   kr: '하부 회전', axis: 'y', max: 90, soft: 80 },
  { id: 'lower_pitch', kr: '하부 끄덕', axis: 'x', max: 35, soft: 30 },
  { id: 'upper_yaw',   kr: '상부 회전', axis: 'y', max: 80, soft: 70 },
  { id: 'upper_pitch', kr: '상부 끄덕', axis: 'x', max: 48, soft: 42 },
];
const JOINT_IDS = JOINTS.map(j => j.id);

// value(-100..100) -> degrees
function valToDeg(jid, v) {
  const j = JOINTS.find(x => x.id === jid);
  return (v / 100) * j.max;
}
// value -> raw position (servo ticks, 4096/rev centered at 2048)
function valToRaw(jid, v) {
  return Math.round(2048 + valToDeg(jid, v) * (4096 / 360));
}
function isOverSoft(jid, v) {
  const j = JOINTS.find(x => x.id === jid);
  return Math.abs(valToDeg(jid, v)) > j.soft;
}

// ---- seed patterns ----
function defaultTangent(mode = 'auto') {
  return { in: { mode, dx: 120, dy: 0 }, out: { mode, dx: 120, dy: 0 }, broken: false };
}
function trackKey(t, value, tangentMode = 'auto') {
  return { id: 'ak' + Math.random().toString(36).slice(2, 8), time_ms: t, value, tangent: defaultTangent(tangentMode) };
}
function tracksFromFrames(frames) {
  const tracks = Object.fromEntries(JOINT_IDS.map(id => [id, []]));
  frames.forEach(f => {
    tracks.lower_yaw.push(trackKey(f[0], f[1]));
    tracks.lower_pitch.push(trackKey(f[0], f[2]));
    tracks.upper_yaw.push(trackKey(f[0], f[3]));
    tracks.upper_pitch.push(trackKey(f[0], f[4]));
  });
  JOINT_IDS.forEach(id => tracks[id].sort((a, b) => a.time_ms - b.time_ms));
  return tracks;
}
const SEED_PATTERNS = [
  { id: 'idle_breathe', name: '기본 호흡', desc: '대기 상태의 미세한 상하 움직임',
    tracks: tracksFromFrames([[0,0,0,0,0], [1400,0,6,0,-4], [2800,0,0,0,0], [4200,0,6,0,-4], [5600,0,0,0,0]]) },
  { id: 'curious_peck', name: '호기심 쪼기', desc: '앞으로 숙이며 두세 번 쪼는 동작',
    tracks: tracksFromFrames([[0,0,0,0,0], [500,10,18,0,40,'ease_in_out'], [900,10,30,0,55,'snap'], [1300,10,18,0,40], [1700,10,30,0,55,'snap'], [2200,0,0,0,0]]) },
  { id: 'alert_look', name: '경계 두리번', desc: '좌우로 빠르게 살피는 경계 자세',
    tracks: tracksFromFrames([[0,0,0,0,0], [600,-45,-8,-30,-12], [1100,-45,-8,-30,-12,'hold'], [1700,45,-8,30,-12], [2200,45,-8,30,-12,'hold'], [2900,0,0,0,0]]) },
  { id: 'greet_bob', name: '인사 까딱', desc: '사람을 향해 고개를 까딱이는 반응',
    tracks: tracksFromFrames([[0,0,0,0,0], [450,0,12,0,30], [800,0,-4,0,-18], [1200,0,12,0,30], [1600,0,0,0,0]]) },
  { id: 'shake_off', name: '털기', desc: '온몸을 좌우로 빠르게 터는 동작',
    tracks: tracksFromFrames([[0,0,0,0,0], [150,18,0,-22,6,'snap'], [300,-18,0,22,-6,'snap'], [450,16,0,-20,6,'snap'], [600,-16,0,20,-6,'snap'], [800,0,0,0,0]]) },
];

// ---- log seed ----
function nowHMS(d = new Date()) {
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 2);
}
const SEED_LOGS = [
  { lv: 'ok',   src: 'bringup',  msg: 'ros2 control_node 시작 — 4 motors enumerated' },
  { lv: 'info', src: 'sensor',   msg: 'mmWave R60ABD1 연결됨 @ /dev/ttyUSB0 (115200)' },
  { lv: 'cmd',  src: 'operator', msg: '모드 전환 → DETECT' },
  { lv: 'ok',   src: 'motion',   msg: "패턴 'idle_breathe' 로드 완료 (axis tracks)" },
  { lv: 'info', src: 'sensor',   msg: '감지 영역 진입: person#3 @ 2.4m / +18°' },
  { lv: 'cmd',  src: 'motion',   msg: "패턴 'greet_bob' 실행 (trigger: proximity)" },
  { lv: 'warn', src: 'motor',    msg: 'upper_pitch 부하 일시 상승 41% — 정상 범위 복귀' },
  { lv: 'ok',   src: 'motion',   msg: "패턴 'greet_bob' 완료 — 기준 자세 복귀" },
];

// ---- initial state ----
function initMotors() {
  const m = {};
  JOINT_IDS.forEach((id, i) => {
    m[id] = {
      volt: 24.0, temp: 38 + i * 1.5, load: 8 + i * 2, pos: 0, raw: 2048,
      torque: true, error: 'OK', model: 'XM430-W350',
    };
  });
  return m;
}

const Store = {
  state: {
    mode: 'detect',                    // detect | random | test | stop
    torque: true,
    joints: { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 },
    actualJoints: { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 },
    target: null,                      // commanded target pose (for slow-move readout)
    moveSpeed: 'instant',              // instant | slow
    activePattern: 'idle_breathe',
    playing: false,                    // motion preview running globally
    lastActionTime: Date.now() - 4200,
    sensor: {
      connected: true,
      persons: [
        { id: 3, dist: 2.41, angle: 18, x: 0.74, y: 2.29 },
        { id: 7, dist: 3.88, angle: -34, x: -2.17, y: 3.22 },
      ],
      nearestId: 3,
    },
    motors: initMotors(),
    ros: { connected: true, node: 'chicken_controller', services: true, actions: true, hz: 50, latency: 6 },
    logs: SEED_LOGS.map((l, i) => ({ ...l, id: 'l' + i, t: nowHMS(new Date(Date.now() - (SEED_LOGS.length - i) * 3400)) })),
    patterns: SEED_PATTERNS,
    editingPatternId: 'curious_peck',
    sensorConfig: {
      rangeMin: 0.4, rangeMax: 4.5, fovDeg: 100,
      holdMs: 2500, cooldownMs: 6000, patternLockMs: 3000, randomIntervalMs: 45000,
      triggerGroup: ['greet_bob', 'curious_peck', 'alert_look'],
    },
    settings: {
      maxSpeed: 60, accelLimit: 70, softLimitEnabled: true,
      autoHome: true, idleTimeoutMin: 5, theme: 'dark',
      logRetain: 2000, rosDomain: 42, deviceName: 'COOP-01',
    },
    uptimeStart: Date.now() - 1000 * 60 * 73,
    estop: false,
    rosConnected: false,
  },

  listeners: new Set(),
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach(fn => fn()); },
  set(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); this.emit(); },

  setJoint(id, v) {
    v = Math.max(-100, Math.min(100, Math.round(v)));
    this.state.joints = { ...this.state.joints, [id]: v };
    this.state.lastActionTime = Date.now();
    this.emit();
  },
  setPose(pose, source = 'operator') {
    this.state.joints = { ...this.state.joints, ...pose };
    this.state.lastActionTime = Date.now();
    this.log('cmd', source, '목표 자세 적용 ' + JOINT_IDS.map(id => this.state.joints[id]).join(' / '));
    this.emit();
  },
  setMode(m) {
    if (this.state.mode === m) return;
    this.state.mode = m;
    if (m === 'stop') { this.state.playing = false; }
    this.log('cmd', 'operator', '모드 전환 → ' + m.toUpperCase());
    this.emit();
  },
  toggleTorque() {
    this.state.torque = !this.state.torque;
    JOINT_IDS.forEach(id => { this.state.motors[id].torque = this.state.torque; });
    this.log(this.state.torque ? 'ok' : 'warn', 'motor', '토크 ' + (this.state.torque ? 'ON — 전 관절 활성' : 'OFF — 전 관절 해제'));
    this.emit();
  },
  home() {
    this.state.joints = { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 };
    this.state.lastActionTime = Date.now();
    this.log('cmd', 'operator', '기준 자세(home) 복귀');
    this.emit();
  },
  triggerEstop() {
    this.state.estop = !this.state.estop;
    if (this.state.estop) {
      this.state.mode = 'stop'; this.state.playing = false; this.state.torque = false;
      JOINT_IDS.forEach(id => { this.state.motors[id].torque = false; });
      this.log('err', 'safety', '⚠ 긴급 정지 — 전 모터 토크 차단');
    } else {
      this.log('ok', 'safety', '긴급 정지 해제 — 재가동 대기');
    }
    this.emit();
  },
  log(lv, src, msg) {
    this.state.logs = [...this.state.logs.slice(-(this.state.settings.logRetain - 1)),
      { id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5), t: nowHMS(), lv, src, msg }];
  },
  pushLog(lv, src, msg) { this.log(lv, src, msg); this.emit(); },

  getPattern(id) { return this.state.patterns.find(p => p.id === id); },
  trackKeyCount(p) {
    return p && p.tracks ? JOINT_IDS.reduce((sum, id) => sum + (p.tracks[id] || []).length, 0) : 0;
  },
  patternDuration(p) {
    if (!p || !p.tracks) return 0;
    return Math.max(0, ...JOINT_IDS.flatMap(id => (p.tracks[id] || []).map(k => k.time_ms)));
  },
  updatePattern(id, patch) {
    this.state.patterns = this.state.patterns.map(p => p.id === id ? { ...p, ...patch } : p);
    this.emit();
  },
};

// ---- live data simulation (runs in demo mode only) ----
let simTick = 0;
function liveSim() {
  if (Store.state.rosConnected) return; // 실제 ROS 데이터가 있으면 시뮬레이션 건너뜀
  simTick++;
  const s = Store.state;
  JOINT_IDS.forEach(id => {
    const m = s.motors[id];
    const targetTemp = 36 + Math.abs(s.joints[id]) * 0.06 + (m.torque ? 4 : 0);
    m.temp += (targetTemp - m.temp) * 0.05 + (Math.random() - 0.5) * 0.18;
    const targetLoad = m.torque ? (6 + Math.abs(s.joints[id]) * 0.18 + (s.playing ? 14 : 0)) : 0;
    m.load += (targetLoad - m.load) * 0.18 + (Math.random() - 0.5) * 1.2;
    m.load = Math.max(0, m.load);
    m.volt += ((m.torque ? 23.8 : 24.1) - m.volt) * 0.1 + (Math.random() - 0.5) * 0.05;
    m.pos = Math.round(valToDeg(id, s.joints[id]) * 10) / 10;
    m.raw = valToRaw(id, s.joints[id]);
  });
  s.actualJoints = { ...s.joints };
  if (s.sensor.connected) {
    s.sensor.persons.forEach(p => {
      p.dist = Math.max(0.5, p.dist + (Math.random() - 0.5) * 0.06);
      p.angle += (Math.random() - 0.5) * 1.4;
      p.x = Math.round(p.dist * Math.sin(p.angle * Math.PI / 180) * 100) / 100;
      p.y = Math.round(p.dist * Math.cos(p.angle * Math.PI / 180) * 100) / 100;
      p.dist = Math.round(p.dist * 100) / 100;
      p.angle = Math.round(p.angle * 10) / 10;
    });
    if (simTick % 40 === 0 && Math.random() < 0.5) {
      if (s.sensor.persons.length > 1 && Math.random() < 0.5) {
        const gone = s.sensor.persons.pop();
        Store.log('info', 'sensor', `감지 이탈: person#${gone.id}`);
      } else if (s.sensor.persons.length < 4) {
        const id = Math.floor(Math.random() * 90) + 10;
        const dist = Math.round((1 + Math.random() * 3) * 100) / 100;
        const angle = Math.round((Math.random() * 80 - 40) * 10) / 10;
        s.sensor.persons.push({ id, dist, angle, x: 0, y: 0 });
        Store.log('info', 'sensor', `감지 진입: person#${id} @ ${dist}m / ${angle > 0 ? '+' : ''}${angle}°`);
      }
    }
    if (s.sensor.persons.length) {
      const n = s.sensor.persons.reduce((a, b) => a.dist < b.dist ? a : b);
      s.sensor.nearestId = n.id;
    }
  }
  s.ros.latency = Math.max(2, Math.round((s.ros.latency * 0.7 + (4 + Math.random() * 6) * 0.3) * 10) / 10);
  if (simTick % 55 === 0 && (s.mode === 'detect' || s.mode === 'random') && !s.estop) {
    const pats = s.sensorConfig.triggerGroup;
    const pid = pats[Math.floor(Math.random() * pats.length)];
    const p = Store.getPattern(pid);
    if (p) {
      s.activePattern = pid;
      s.lastActionTime = Date.now();
      Store.log('cmd', 'motion', `패턴 '${p.name}' 실행 (${s.mode === 'detect' ? 'trigger: proximity' : 'random'})`);
    }
  }
  Store.emit();
}
setInterval(liveSim, 280);

// ---- React hook ----
function useStore() {
  const [, force] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => Store.subscribe(force), []);
  return Store.state;
}

window.Store = Store;
window.useStore = useStore;
window.JOINTS = JOINTS;
window.JOINT_IDS = JOINT_IDS;
window.defaultTangent = defaultTangent;
window.valToDeg = valToDeg;
window.valToRaw = valToRaw;
window.isOverSoft = isOverSoft;
window.nowHMS = nowHMS;

// ============================================================
// ROS 백엔드 브릿지 (실제 ROS 노드와 통신)
// ============================================================
window.RosBridge = (function() {
  const DEG_TO_VAL = (jid, deg) => {
    const j = JOINTS.find(x => x.id === jid);
    return j ? Math.max(-100, Math.min(100, Math.round(deg / j.max * 100))) : 0;
  };

  let ws = null;
  const bridge = {
    password: '',
    rosMode: false,

    connect() {
      const q = this.password ? '?password=' + encodeURIComponent(this.password) : '';
      ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws/status' + q);
      ws.onopen = () => {
        bridge.rosMode = true;
        Store.set({ rosConnected: true });
        Store.pushLog('ok', 'bridge', 'ROS 백엔드 WebSocket 연결됨');
      };
      ws.onclose = () => {
        bridge.rosMode = false;
        Store.set({ rosConnected: false });
        setTimeout(() => bridge.connect(), 3000);
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        try { bridge.sync(JSON.parse(e.data)); } catch(err) {}
      };
    },

    sync(data) {
      const patch = {};

      // Joint states → -100..100 scale
      if (data.joint_states && Array.isArray(data.joint_states.name)) {
        const actualJoints = { ...Store.state.actualJoints };
        data.joint_states.name.forEach((name, i) => {
          const pos = data.joint_states.position && data.joint_states.position[i];
          if (pos !== undefined) {
            const deg = pos * 180 / Math.PI;
            actualJoints[name] = DEG_TO_VAL(name, deg);
          }
        });
        patch.actualJoints = actualJoints;
      }

      // Motor diagnostics
      const diagnostics = data.motor_diagnostics && (data.motor_diagnostics.diagnostics || data.motor_diagnostics.motors);
      if (Array.isArray(diagnostics)) {
        const motors = {};
        JOINT_IDS.forEach(id => { motors[id] = { ...Store.state.motors[id] }; });
        diagnostics.forEach(m => {
          const id = m.joint_name;
          if (id && motors[id]) {
            motors[id] = {
              volt: m.voltage_v !== undefined ? m.voltage_v : (m.voltage !== undefined ? m.voltage : motors[id].volt),
              temp: m.temperature_c !== undefined ? m.temperature_c : (m.temperature !== undefined ? m.temperature : motors[id].temp),
              load: m.load !== undefined ? m.load * 100 : motors[id].load,
              pos: m.angle_deg !== undefined ? m.angle_deg : (m.present_position !== undefined ? ((m.present_position - 2048) * 360 / 4096) : motors[id].pos),
              raw: m.raw_position !== undefined ? m.raw_position : (m.present_position !== undefined ? m.present_position : motors[id].raw),
              torque: m.torque_enabled !== undefined ? m.torque_enabled : motors[id].torque,
              error: (m.error_code === 0 || m.error_code === undefined) ? 'OK' : 'E' + m.error_code,
              model: m.model || m.model_name || motors[id].model,
            };
          }
        });
        patch.motors = motors;
      }

      // Motion status
      if (data.motion_status) {
        if (data.motion_status.pattern_id) patch.activePattern = data.motion_status.pattern_id;
        if (data.motion_status.playing !== undefined) patch.playing = !!data.motion_status.playing;
      }

      // Nearest person / sensor
      if (data.nearest_person) {
        const p = data.nearest_person;
        const persons = (p.distance && p.distance > 0) ? [{
          id: p.id || 0,
          dist: p.distance,
          angle: p.angle || 0,
          x: p.x || Math.round(p.distance * Math.sin((p.angle || 0) * Math.PI / 180) * 100) / 100,
          y: p.y || Math.round(p.distance * Math.cos((p.angle || 0) * Math.PI / 180) * 100) / 100,
        }] : [];
        patch.sensor = { ...Store.state.sensor, connected: true, persons, nearestId: persons[0] ? persons[0].id : null };
      }

      // ROS connectivity
      if (data.ros) {
        const svcReady = data.ros.services ? Object.values(data.ros.services).some(Boolean) : false;
        const actReady = data.ros.actions ? Object.values(data.ros.actions).some(Boolean) : false;
        patch.ros = {
          ...Store.state.ros,
          connected: true,
          node: data.ros.namespace || Store.state.ros.node,
          services: svcReady,
          actions: actReady,
        };
      }

      // Event logs from ROS
      if (Array.isArray(data.events) && data.events.length) {
        const rosLogs = data.events.slice(0, 50).map((e, i) => ({
          id: 'ros' + i + (e.message || '').slice(0, 8),
          t: nowHMS(),
          lv: e.event_type === 'err' || e.event_type === 'error' ? 'err'
            : e.event_type === 'warn' ? 'warn'
            : e.event_type === 'cmd' ? 'cmd'
            : e.event_type === 'ok' ? 'ok' : 'info',
          src: e.source || 'ros',
          msg: e.message || '',
        }));
        if (rosLogs.length) patch.logs = rosLogs;
      }

      Store.set(patch);
    },

    async api(path, options = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      if (this.password) headers['X-Animatronic-Password'] = this.password;
      try {
        const r = await fetch(path, Object.assign({}, options, { headers }));
        return await r.json();
      } catch(e) { return null; }
    },

    // 관절 위치 명령 (degrees)
    sendJoints(joints) {
      const positions = {};
      JOINT_IDS.forEach(id => { positions[id] = valToDeg(id, joints[id] || 0); });
      return this.api('/api/joints', { method: 'POST', body: JSON.stringify({ positions }) });
    },
  };

  Store.sendJointsToRos = function() {
    return bridge.sendJoints(Store.state.joints);
  };

  // Store 메서드 오버라이드 → API 연동
  const _setMode = Store.setMode.bind(Store);
  Store.setMode = function(m) {
    _setMode(m);
    if (bridge.rosMode) {
      const map = { detect: 'detection', random: 'random', test: 'test', stop: 'stopped' };
      bridge.api('/api/mode', { method: 'POST', body: JSON.stringify({ mode: map[m] || m }) });
    }
  };

  const _toggleTorque = Store.toggleTorque.bind(Store);
  Store.toggleTorque = function() {
    _toggleTorque();
    if (bridge.rosMode) {
      bridge.api('/api/torque', { method: 'POST', body: JSON.stringify({ enabled: Store.state.torque }) });
    }
  };

  const _home = Store.home.bind(Store);
  Store.home = function() {
    _home();
    if (bridge.rosMode) bridge.api('/api/home', { method: 'POST' });
  };

  const _estop = Store.triggerEstop.bind(Store);
  Store.triggerEstop = function() {
    _estop();
    if (bridge.rosMode) bridge.api('/api/stop', { method: 'POST' });
  };

  const _setJoint = Store.setJoint.bind(Store);
  Store.setJoint = function(id, v) {
    _setJoint(id, v);
    if (bridge.rosMode) bridge.sendJoints(Store.state.joints);
  };

  const _setPose = Store.setPose.bind(Store);
  Store.setPose = function(pose, source) {
    _setPose(pose, source);
    if (bridge.rosMode) bridge.sendJoints(Store.state.joints);
  };

  // 페이지 로드 후 실제 서버인지 확인 후 연결
  setTimeout(() => {
    fetch('/api/status').then(r => {
      if (r.ok) {
        Store.pushLog('info', 'bridge', 'ROS 서버 감지됨 — WebSocket 연결 시도');
        bridge.connect();
      }
    }).catch(() => {
      Store.pushLog('info', 'bridge', '데모 모드 — ROS 서버 없음, 시뮬레이션 실행 중');
    });
  }, 500);

  return bridge;
})();
