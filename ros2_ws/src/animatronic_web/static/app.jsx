/* ============================================================
   app.jsx — 앱 셸 / 탭 네비 / 탑바 / 푸터
   ============================================================ */

const TABS = [
  { id: 'ops',     idx: '01', kr: '운영',      en: 'OPERATIONS', C: () => window.TabOperations },
  { id: 'manual',  idx: '02', kr: '수동 제어', en: 'MANUAL',     C: () => window.TabManual },
  { id: 'motion',  idx: '03', kr: '모션 제작', en: 'MOTION',     C: () => window.TabMotion },
  { id: 'library', idx: '04', kr: '라이브러리', en: 'LIBRARY',   C: () => window.TabLibrary },
  { id: 'sensor',  idx: '05', kr: '센서/반응', en: 'SENSOR',     C: () => window.TabSensor },
  { id: 'diag',    idx: '06', kr: '진단/로그', en: 'DIAGNOSTICS', C: () => window.TabDiagnostics },
  { id: 'settings',idx: '07', kr: '설정',      en: 'SETTINGS',   C: () => window.TabSettings },
  { id: 'motorcfg',idx: '08', kr: '모터 설정', en: 'MOTOR SETUP', C: () => window.TabMotorSettings },
];

function Clock() {
  const [now, setNow] = React.useState(new Date());
  React.useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  return <span className="tnum">{now.toTimeString().slice(0, 8)}</span>;
}

// 비밀번호 설정 모달 (백엔드 연결용)
function PasswordModal({ onClose }) {
  const [pw, setPw] = React.useState(window.RosBridge ? window.RosBridge.password : '');
  const apply = () => {
    if (window.RosBridge) window.RosBridge.password = pw;
    onClose();
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)', borderRadius: 6, padding: 24, width: 320 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--tx-2)', marginBottom: 14 }}>ROS 서버 비밀번호</div>
        <input
          className="ninput"
          type="password"
          placeholder="비밀번호 없으면 비워두세요"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && apply()}
          autoFocus
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost sm" onClick={onClose}>취소</button>
          <button className="btn solid sm" onClick={apply}>적용</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const s = useStore();
  const [tab, setTab] = React.useState('ops');
  const [showPwModal, setShowPwModal] = React.useState(false);
  React.useEffect(() => { window.__goTab = (t) => setTab(t === 'motion' ? 'motion' : t); }, []);
  const cur = TABS.find(t => t.id === tab);
  const Comp = cur.C();
  const pat = Store.getPattern(s.activePattern);
  const avgLat = s.ros.latency;

  return (
    <div className="app">
      {showPwModal && <PasswordModal onClose={() => setShowPwModal(false)} />}

      {/* TOP BAR */}
      <div className="topbar">
        <div className="brand" style={{ cursor: 'pointer' }} onClick={() => setShowPwModal(true)} title="ROS 서버 설정">
          <span className="glyph">
            <svg viewBox="0 0 20 20" fill="none" stroke="#3fc7d4" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17h6M10 17v-4M10 13a4 4 0 01-4-4V7a3 3 0 016 0M12 6.5l3-1.5M12 9l3 0" />
              <circle cx="9" cy="6" r="0.6" fill="#3fc7d4" stroke="none" />
            </svg>
          </span>
          <span className="txt"><b>닭 오브제 제어보드</b><span>COOP CONSOLE · {s.settings.deviceName}</span></span>
        </div>
        <div className="topbar-mode">
          <span className="mono up" style={{ fontSize: 9.5, color: 'var(--tx-3)' }}>MODE</span>
          <Badge kind={s.estop ? 'err' : s.mode === 'stop' ? 'err' : 'cy'}>
            <Dot kind={s.estop ? 'err' : s.mode === 'stop' ? 'err' : 'cy'} pulse={!s.estop && s.mode !== 'stop'} />
            {s.estop ? 'E-STOP' : ModeName(s.mode)}
          </Badge>
          <Badge kind={s.torque ? 'ok' : 'warn'}>TORQUE {s.torque ? 'ON' : 'OFF'}</Badge>
        </div>
        <div className="topbar-clock">
          <span className="ros-chip">
            <Dot kind={s.rosConnected ? 'ok' : 'warn'} pulse={s.rosConnected} />
            {s.rosConnected ? 'ROS LIVE' : 'DEMO'}
          </span>
          <span className="ros-chip"><Dot kind={s.ros.connected ? 'ok' : 'err'} pulse={s.ros.connected} />ROS2 {s.ros.hz}Hz · {avgLat.toFixed(0)}ms</span>
          <span className="ros-chip"><Dot kind={s.sensor.connected ? 'ok' : 'err'} pulse={s.sensor.connected} />mmWave {s.sensor.persons.length}p</span>
          <Clock />
        </div>
        <div className={`estop-top ${s.estop ? 'armed' : ''}`} onClick={() => Store.triggerEstop()}>
          <span className="dot"></span>{s.estop ? 'STOPPED' : 'E-STOP'}
        </div>
      </div>

      {/* TAB RAIL */}
      <div className="tabs">
        {TABS.map(t => (
          <div key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="idx">{t.idx}</span>{t.kr}
          </div>
        ))}
      </div>

      {/* MAIN */}
      <div className="main">
        <div className="tabpane" key={tab}><Comp /></div>
      </div>

      {/* FOOTER */}
      <div className="footer">
        <div className="seg"><span className="lab">MODE</span><b>{ModeName(s.mode)}</b></div>
        <div className="seg"><span className="lab">TORQUE</span><b style={{ color: s.torque ? 'var(--ok)' : 'var(--warn)' }}>{s.torque ? 'ON' : 'OFF'}</b></div>
        <div className="seg"><span className="lab">PATTERN</span><b>{pat ? pat.name : '—'}</b></div>
        <div className="seg"><span className="lab">LAST</span><b>{relTime(s.lastActionTime)}</b></div>
        <div className="seg"><span className="lab">SENSOR</span><b>{s.sensor.persons.length}p / {(s.sensor.persons.find(p => p.id === s.sensor.nearestId)?.dist || 0).toFixed(2)}m</b></div>
        <div className="seg"><span className="lab">ROS</span><b style={{ color: s.ros.connected ? 'var(--ok)' : 'var(--err)' }}>{s.ros.hz}Hz · {avgLat.toFixed(0)}ms</b></div>
        <div className="spacer"></div>
        <div className="seg">
          <span className="lab">BRIDGE</span>
          <b style={{ color: s.rosConnected ? 'var(--ok)' : 'var(--tx-3)' }}>{s.rosConnected ? 'LIVE' : 'DEMO'}</b>
        </div>
        <div className="seg"><span className="lab">UPTIME</span><b>{Math.floor((Date.now() - s.uptimeStart) / 60000)}m</b></div>
        <div className="seg"><span className="lab">NODE</span><b>{s.ros.node}</b></div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
