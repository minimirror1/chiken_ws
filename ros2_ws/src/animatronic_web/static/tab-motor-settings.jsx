/* ============================================================
   tab-motor-settings.jsx — 모터 설정
   ============================================================ */

const MOTOR_MODELS = ['XM430-W350-R', 'XM430-W210-T', 'XL320'];

function cloneMotorConfig(rows) {
  return rows.map(r => ({ ...r }));
}

function motorDirection(row) {
  return Number(row.raw_100_percent) >= Number(row.raw_0_percent) ? '정방향' : '역방향';
}

function countToPercent(row, raw) {
  const a = Number(row.raw_0_percent);
  const b = Number(row.raw_100_percent);
  if (a === b) return 0;
  return ((Number(raw) - a) / (b - a)) * 100;
}

function pctClamp(v) {
  return Math.max(0, Math.min(100, v));
}

function clampRawForRow(row, raw) {
  const lo = Math.min(Number(row.raw_0_percent), Number(row.raw_100_percent));
  const hi = Math.max(Number(row.raw_0_percent), Number(row.raw_100_percent));
  return Math.max(lo, Math.min(hi, Math.round(Number(raw) || 0)));
}

function rawToServoDeg(raw) {
  return pctClamp((Number(raw) / 4095) * 100) * 3.6;
}

function rawToDialDeg(raw) {
  return 180 - rawToServoDeg(raw);
}

function polarPoint(cx, cy, radius, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function dialArcPath(cx, cy, radius, startDeg, endDeg, reversed) {
  const span = reversed
    ? (startDeg - endDeg + 360) % 360
    : (endDeg - startDeg + 360) % 360;
  const large = span > 180 ? 1 : 0;
  const sweep = reversed ? 0 : 1;
  const start = polarPoint(cx, cy, radius, startDeg);
  const end = polarPoint(cx, cy, radius, endDeg);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function RobotisDial({ row, currentRaw }) {
  const currentPct = countToPercent(row, currentRaw);
  const homePct = countToPercent(row, row.raw_home);
  const raw0Deg = rawToServoDeg(row.raw_0_percent);
  const raw100Deg = rawToServoDeg(row.raw_100_percent);
  const raw0Dial = rawToDialDeg(row.raw_0_percent);
  const raw100Dial = rawToDialDeg(row.raw_100_percent);
  const currentAngle = rawToDialDeg(currentRaw);
  const homeAngle = rawToDialDeg(row.raw_home);
  const arm = polarPoint(90, 90, 47, currentAngle);
  const home = polarPoint(90, 90, 57, homeAngle);
  const current = polarPoint(90, 90, 65, currentAngle);
  const reversed = motorDirection(row) === '역방향';

  return (
    <div className="robotis-dial">
      <svg viewBox="0 0 180 180" aria-label="ROBOTIS style virtual dial">
        <circle className="dial-case" cx="90" cy="90" r="72" />
        <circle className="dial-face" cx="90" cy="90" r="57" />
        <path className={`dial-range ${reversed ? 'rev' : ''}`} d={dialArcPath(90, 90, 67, raw0Dial, raw100Dial, !reversed)} />
        {[0, 90, 180, 270, 360].map(deg => {
          const dialDeg = 180 - deg;
          const p1 = polarPoint(90, 90, 60, dialDeg);
          const p2 = polarPoint(90, 90, deg % 180 === 0 ? 70 : 66, dialDeg);
          return <line key={deg} className="dial-tick" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />;
        })}
        <text className="dial-label top" x="90" y="19">180°</text>
        <text className="dial-label right" x="151" y="94">90°</text>
        <text className="dial-label bottom" x="90" y="166">0/360°</text>
        <text className="dial-label left" x="24" y="94">270°</text>
        <line className="dial-home-line" x1="90" y1="90" x2={home.x} y2={home.y} />
        <line className="dial-arm" x1="90" y1="90" x2={arm.x} y2={arm.y} />
        <circle className="dial-hub" cx="90" cy="90" r="16" />
        <circle className="dial-bolt" cx="90" cy="90" r="4" />
        <circle className="dial-home-dot" cx={home.x} cy={home.y} r="4" />
        <circle className="dial-current-dot" cx={current.x} cy={current.y} r="5" />
      </svg>
      <div className="robotis-dial-readout">
        <span><b>{currentRaw}</b> cnt</span>
        <span>{rawToServoDeg(currentRaw).toFixed(1)}° raw</span>
        <span>{currentPct.toFixed(1)}%</span>
        <span>{raw0Deg.toFixed(1)}° → {raw100Deg.toFixed(1)}°</span>
        <span>{motorDirection(row)}</span>
      </div>
    </div>
  );
}

function validateMotorRows(rows) {
  const errors = [];
  const ids = new Set();
  const joints = new Set();
  rows.forEach(row => {
    const name = String(row.joint_name || '').trim();
    if (!name) errors.push('joint_name이 비어 있습니다.');
    if (joints.has(name)) errors.push(`${name}: joint_name 중복`);
    joints.add(name);
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) errors.push(`${name}: Motor ID가 올바르지 않습니다.`);
    if (ids.has(id)) errors.push(`${name}: Motor ID ${id} 중복`);
    ids.add(id);
    const raw0 = Number(row.raw_0_percent);
    const home = Number(row.raw_home);
    const raw100 = Number(row.raw_100_percent);
    if (raw0 === raw100) errors.push(`${name}: 0% cnt와 100% cnt는 달라야 합니다.`);
    if (home < Math.min(raw0, raw100) || home > Math.max(raw0, raw100)) {
      errors.push(`${name}: 정자세 cnt가 구동범위 밖입니다.`);
    }
  });
  return errors;
}

function MotorRangeBar({ row, currentRaw }) {
  const homePct = pctClamp(countToPercent(row, row.raw_home));
  const curPct = pctClamp(countToPercent(row, currentRaw));
  return (
    <div className="motor-range">
      <div className={`motor-range-track ${motorDirection(row) === '역방향' ? 'rev' : ''}`}>
        <span className="mark home" style={{ left: homePct + '%' }} title="정자세"></span>
        <span className="mark current" style={{ left: curPct + '%' }} title="현재 위치"></span>
      </div>
      <div className="motor-range-labels">
        <span>0% <b>{row.raw_0_percent}</b> / {rawToServoDeg(row.raw_0_percent).toFixed(1)}°</span>
        <span>정자세 <b>{row.raw_home}</b> / {rawToServoDeg(row.raw_home).toFixed(1)}° / {homePct.toFixed(1)}%</span>
        <span>100% <b>{row.raw_100_percent}</b> / {rawToServoDeg(row.raw_100_percent).toFixed(1)}°</span>
      </div>
    </div>
  );
}

function MotorRawControl({ row, currentRaw, commandRaw }) {
  const [input, setInput] = React.useState(String(currentRaw));
  const holdRef = React.useRef(null);
  const currentRef = React.useRef(currentRaw);

  React.useEffect(() => {
    const next = clampRawForRow(row, currentRaw);
    currentRef.current = next;
    setInput(String(next));
  }, [currentRaw, row && row.joint_name]);

  React.useEffect(() => () => {
    if (holdRef.current) clearInterval(holdRef.current);
  }, []);

  const step = (delta) => {
    const next = clampRawForRow(row, Number(currentRef.current) + delta);
    currentRef.current = next;
    setInput(String(next));
    commandRaw(next);
  };
  const startHold = (delta) => {
    currentRef.current = clampRawForRow(row, input);
    step(delta);
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = setInterval(() => step(delta), 90);
  };
  const stopHold = () => {
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = null;
  };
  const commit = () => {
    const next = clampRawForRow(row, input);
    currentRef.current = next;
    setInput(String(next));
    commandRaw(next);
  };

  return (
    <div className="motor-raw-control">
      <button
        type="button"
        className="raw-step"
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startHold(-1); }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
        title="-1 raw count"
      >←</button>
      <input
        className="ninput tnum raw-current"
        value={input}
        onChange={e => {
          setInput(e.target.value);
          currentRef.current = e.target.value;
        }}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        onBlur={commit}
      />
      <button
        type="button"
        className="raw-step"
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startHold(1); }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
        title="+1 raw count"
      >→</button>
    </div>
  );
}

function TabMotorSettings() {
  const s = useStore();
  const fallbackConfig = window.DEFAULT_MOTOR_CONFIG || [];
  const [rows, setRows] = React.useState(() => cloneMotorConfig(s.motorConfig || fallbackConfig));
  const [selected, setSelected] = React.useState(0);
  const [busy, setBusy] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [remoteErrors, setRemoteErrors] = React.useState([]);
  const [manualRaw, setManualRaw] = React.useState({});

  React.useEffect(() => {
    if (!window.RosBridge || !window.RosBridge.rosMode) return;
    window.RosBridge.api('/api/motor-config')
      .then(data => {
        if (Array.isArray(data.calibrations) && data.calibrations.length) {
          Store.set({ motorConfig: data.calibrations, motorConfigPath: data.path || '' });
          setRows(cloneMotorConfig(data.calibrations));
        }
      })
      .catch(() => {});
  }, [s.rosConnected]);

  const localErrors = validateMotorRows(rows);
  const errors = [...localErrors, ...remoteErrors];
  const dirty = JSON.stringify(rows) !== JSON.stringify(s.motorConfig || []);
  const reversed = rows.filter(r => motorDirection(r) === '역방향').length;
  const selectedRow = rows[selected] || rows[0];
  const selectedMotor = selectedRow ? (s.motors[selectedRow.joint_name] || {}) : {};
  const selectedTorque = selectedMotor.torque !== undefined ? selectedMotor.torque : s.torque;
  const selectedRaw = selectedRow
    ? (manualRaw[selectedRow.joint_name] !== undefined
      ? manualRaw[selectedRow.joint_name]
      : (selectedMotor.raw !== undefined ? selectedMotor.raw : selectedRow.raw_home))
    : 0;
  const syncReady = !s.rosConnected || s.motorSynced;

  const updateRow = (index, patch) => {
    setRows(rs => rs.map((r, i) => i === index ? { ...r, ...patch } : r));
    setRemoteErrors([]);
    setMessage('');
  };
  const numberPatch = (key, value) => ({ [key]: parseFloat(value || '0') });
  const document = () => ({ calibrations: rows.map(r => ({
    joint_name: String(r.joint_name || '').trim(),
    id: parseInt(r.id || 0),
    model: r.model,
    raw_0_percent: parseInt(r.raw_0_percent || 0),
    raw_home: parseInt(r.raw_home || 0),
    raw_100_percent: parseInt(r.raw_100_percent || 0),
    min_angle_deg: rawToServoDeg(r.raw_0_percent),
    home_angle_deg: rawToServoDeg(r.raw_home),
    max_angle_deg: rawToServoDeg(r.raw_100_percent),
  })) });

  const runApi = async (label, path, method = 'POST') => {
    const local = validateMotorRows(rows);
    setRemoteErrors([]);
    setMessage('');
    if (local.length) return;
    setBusy(label);
    try {
      const res = await window.RosBridge.api(path, { method, body: JSON.stringify(document()) });
      setRemoteErrors(res.errors || []);
      setMessage(res.message || (res.success ? '완료' : '실패'));
      if (res.success && label !== '검증') {
        Store.set({ motorConfig: cloneMotorConfig(rows) });
      }
    } catch (e) {
      const detail = e && e.detail ? e.detail : e;
      setRemoteErrors((detail && detail.errors) || []);
      setMessage((detail && detail.message) || '요청 실패');
    } finally {
      setBusy('');
    }
  };
  const commandSelectedRaw = (raw) => {
    if (!selectedRow || !syncReady) return;
    const nextRaw = clampRawForRow(selectedRow, raw);
    setManualRaw(m => ({ ...m, [selectedRow.joint_name]: nextRaw }));
    if (window.RosBridge && window.RosBridge.rosMode) {
      window.RosBridge.api(`/api/motor/${encodeURIComponent(selectedRow.joint_name)}/raw`, {
        method: 'POST',
        body: JSON.stringify({ raw: nextRaw }),
      }).catch(() => {});
    }
  };
  const commandTorque = (enabled) => {
    if (!selectedRow) return;
    const motors = { ...s.motors };
    motors[selectedRow.joint_name] = {
      ...motors[selectedRow.joint_name],
      torque: enabled,
    };
    const allTorque = JOINT_IDS.every(id => motors[id] && motors[id].torque);
    Store.set({ torque: allTorque, motors });
    Store.pushLog(
      enabled ? 'ok' : 'warn',
      'motor',
      `${selectedRow.joint_name} 토크 ${enabled ? 'ON' : 'OFF'}`,
    );
    if (window.RosBridge && window.RosBridge.rosMode) {
      window.RosBridge.api(`/api/motor/${selectedRow.id}/torque`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }).catch(() => {});
    }
  };

  return (
    <div className="pad motorcfg">
      <div className="motorcfg-left">
        <div className="motorcfg-top">
          <Panel title="작업" accent="ACTIONS" bodyClass="col gap8">
            <div className="btn-row">
              <Btn kind="ghost" size="sm" icon="refresh" disabled={!window.RosBridge || !window.RosBridge.rosMode || !!busy} onClick={() => window.RosBridge.api('/api/motor-config').then(data => {
                const next = data.calibrations || [];
                Store.set({ motorConfig: next, motorConfigPath: data.path || '' });
                setRows(cloneMotorConfig(next));
                setMessage('설정 다시 불러옴');
              })}>불러오기</Btn>
              <Btn kind="ghost" size="sm" icon="check" disabled={!!busy || localErrors.length > 0} onClick={() => runApi('검증', '/api/motor-config/validate')}>검증</Btn>
              <Btn kind="cy" size="sm" icon="bolt" disabled={!!busy || errors.length > 0} onClick={() => runApi('적용', '/api/motor-config/apply')}>ROS 즉시 적용</Btn>
              <Btn kind="solid" size="sm" icon="save" disabled={!!busy || errors.length > 0} onClick={() => runApi('저장', '/api/motor-config/save', 'PUT')}>YAML 저장</Btn>
              <Btn kind="ghost" size="sm" icon="refresh" disabled={!dirty || !!busy} onClick={() => setRows(cloneMotorConfig(s.motorConfig || fallbackConfig))}>되돌리기</Btn>
            </div>
            <KV k="상태" v={busy ? busy + ' 중' : (message || '대기')} mono={false} />
            <KV k="파일" v={s.motorConfigPath || 'chicken_bringup/config/motors.yaml'} />
          </Panel>

          <Panel title="검증 결과" accent="VALIDATION" bodyClass="col gap8">
            {errors.length ? errors.map((err, i) => <div className="motor-error" key={i}>{err}</div>) : <Badge kind="ok">설정 정상</Badge>}
            <span className="hint">토크 ON 상태에서는 즉시 적용 서비스가 거부됩니다.</span>
          </Panel>
        </div>

        <Panel
          title="모터 매핑"
          accent="MAP"
          bodyClass="pad-0"
          right={
            <span className="motor-map-summary">
              <Badge kind="cy">MOTORS {rows.length}</Badge>
              <Badge kind={reversed ? 'warn' : 'cy'}>REVERSED {reversed}</Badge>
              <Badge kind={errors.length ? 'err' : 'ok'}>ERRORS {errors.length}</Badge>
              <Badge kind={dirty ? 'warn' : 'ok'}>DIRTY {dirty ? 'YES' : 'NO'}</Badge>
            </span>
          }
        >
          <table className="tbl motor-map">
            <thead>
              <tr>
                <th>JOINT</th><th className="num">ID</th><th>MODEL</th>
                <th className="num">0% CNT</th><th className="num">정자세</th><th className="num">100% CNT</th>
                <th>방향</th><th className="num">현재</th><th className="num">%</th><th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const motor = s.motors[row.joint_name] || {};
                const currentRaw = motor.raw !== undefined ? motor.raw : row.raw_home;
                const pct = countToPercent(row, currentRaw);
                const rowErrors = validateMotorRows([row]);
                return (
                  <tr key={i} className={selected === i ? 'sel' : ''} onClick={() => setSelected(i)}>
                    <td><input className="ninput mono" value={row.joint_name} onChange={e => updateRow(i, { joint_name: e.target.value })} /></td>
                    <td className="num"><input className="ninput tnum smnum" type="number" value={row.id} onChange={e => updateRow(i, numberPatch('id', e.target.value))} /></td>
                    <td>
                      <select className="ninput" value={row.model} onChange={e => updateRow(i, { model: e.target.value })}>
                        {MOTOR_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
                      </select>
                    </td>
                    <td className="num"><input className="ninput tnum cnt" type="number" value={row.raw_0_percent} onChange={e => updateRow(i, numberPatch('raw_0_percent', e.target.value))} /></td>
                    <td className="num"><input className="ninput tnum cnt" type="number" value={row.raw_home} onChange={e => updateRow(i, numberPatch('raw_home', e.target.value))} /></td>
                    <td className="num"><input className="ninput tnum cnt" type="number" value={row.raw_100_percent} onChange={e => updateRow(i, numberPatch('raw_100_percent', e.target.value))} /></td>
                    <td><Badge kind={motorDirection(row) === '역방향' ? 'warn' : 'cy'}>{motorDirection(row)}</Badge></td>
                    <td className="num">{currentRaw}</td>
                    <td className="num" style={{ color: pct < 0 || pct > 100 ? 'var(--err)' : 'var(--cy)' }}>{pct.toFixed(1)}%</td>
                    <td><Badge kind={rowErrors.length ? 'err' : 'ok'}>{rowErrors.length ? 'ERROR' : 'OK'}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="선택 모터" accent="RANGE" bodyClass="col motorcfg-range">
        {selectedRow && (
          <>
            <KV k="Joint" v={selectedRow.joint_name} />
            <KV k="방향" v={motorDirection(selectedRow)} mono={false} />
            <button
              type="button"
              className={`motor-torque-btn ${selectedTorque ? 'on' : ''}`}
              onClick={() => commandTorque(!selectedTorque)}
            >
              TORQUE {selectedTorque ? 'ON' : 'OFF'}
            </button>
            {!syncReady && <Badge kind="warn">현재 위치 동기화 대기</Badge>}
            <RobotisDial row={selectedRow} currentRaw={selectedRaw} />
            <MotorRangeBar row={selectedRow} currentRaw={selectedRaw} />
            <div className="motor-jog-bottom">
              {syncReady
                ? <MotorRawControl row={selectedRow} currentRaw={selectedRaw} commandRaw={commandSelectedRaw} />
                : <button className="btn ghost block" disabled>동기화 대기</button>}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

window.TabMotorSettings = TabMotorSettings;
