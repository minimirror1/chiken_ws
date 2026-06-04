/* ============================================================
   tab-motor-settings.jsx — 모터 설정
   ============================================================ */

const MOTOR_MODELS = ['XM430-W350-R', 'XM430-W210-T', 'XL320'];

function cloneMotorConfig(rows) {
  return rows.map(r => ({ ...r }));
}

function calibrationRows(rows) {
  return rows.map(r => ({
    joint_name: String(r.joint_name || '').trim(),
    id: parseInt(r.id || 0),
    model: r.model,
    raw_0_percent: parseInt(r.raw_0_percent || 0),
    raw_home: parseInt(r.raw_home || 0),
    raw_100_percent: parseInt(r.raw_100_percent || 0),
    min_angle_deg: rawToServoDeg(r.raw_0_percent),
    home_angle_deg: rawToServoDeg(r.raw_home),
    max_angle_deg: rawToServoDeg(r.raw_100_percent),
  }));
}

function duplicateFields(rows) {
  const jointCounts = {};
  const idCounts = {};
  rows.forEach(row => {
    const name = String(row.joint_name || '').trim();
    const id = String(parseInt(row.id || 0));
    if (name) jointCounts[name] = (jointCounts[name] || 0) + 1;
    if (id !== '0' && id !== 'NaN') idCounts[id] = (idCounts[id] || 0) + 1;
  });
  return rows.map(row => {
    const name = String(row.joint_name || '').trim();
    const id = String(parseInt(row.id || 0));
    return {
      joint: !!name && jointCounts[name] > 1,
      id: id !== '0' && id !== 'NaN' && idCounts[id] > 1,
    };
  });
}

function newMotorRow(rows) {
  const usedJoints = new Set(rows.map(r => String(r.joint_name || '').trim()).filter(Boolean));
  const nextJoint = JOINT_IDS.find(id => !usedJoints.has(id)) || '';
  const maxId = rows.reduce((max, row) => {
    const id = Number(row.id);
    return Number.isFinite(id) ? Math.max(max, id) : max;
  }, 0);
  return {
    joint_name: nextJoint,
    id: maxId + 1,
    model: MOTOR_MODELS[0],
    raw_0_percent: 0,
    raw_home: 2048,
    raw_100_percent: 4095,
    min_angle_deg: 0,
    home_angle_deg: 180,
    max_angle_deg: 360,
  };
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

function dialDegToRaw(deg) {
  const servoDeg = (180 - deg + 360) % 360;
  return Math.round((servoDeg / 360) * 4095);
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

function RobotisDial({ row, currentRaw, targetRaw, onTargetRawChange }) {
  const currentPct = countToPercent(row, currentRaw);
  const targetPct = countToPercent(row, targetRaw);
  const raw0Deg = rawToServoDeg(row.raw_0_percent);
  const raw100Deg = rawToServoDeg(row.raw_100_percent);
  const raw0Dial = rawToDialDeg(row.raw_0_percent);
  const raw100Dial = rawToDialDeg(row.raw_100_percent);
  const currentAngle = rawToDialDeg(currentRaw);
  const targetAngle = rawToDialDeg(targetRaw);
  const homeAngle = rawToDialDeg(row.raw_home);
  const arm = polarPoint(90, 90, 47, currentAngle);
  const targetArm = polarPoint(90, 90, 47, targetAngle);
  const home = polarPoint(90, 90, 57, homeAngle);
  const current = polarPoint(90, 90, 65, currentAngle);
  const target = polarPoint(90, 90, 65, targetAngle);
  const reversed = motorDirection(row) === '역방향';
  const onDialClick = (e) => {
    if (!onTargetRawChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 180;
    const y = ((e.clientY - rect.top) / rect.height) * 180;
    const deg = (Math.atan2(y - 90, x - 90) * 180 / Math.PI + 90 + 360) % 360;
    onTargetRawChange(clampRawForRow(row, dialDegToRaw(deg)));
  };

  return (
    <div className="robotis-dial">
      <svg viewBox="0 0 180 180" aria-label="ROBOTIS style virtual dial" onClick={onDialClick}>
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
        <line className="dial-target-arm" x1="90" y1="90" x2={targetArm.x} y2={targetArm.y} />
        <line className="dial-arm" x1="90" y1="90" x2={arm.x} y2={arm.y} />
        <circle className="dial-hub" cx="90" cy="90" r="16" />
        <circle className="dial-bolt" cx="90" cy="90" r="4" />
        <circle className="dial-home-dot" cx={home.x} cy={home.y} r="4" />
        <circle className="dial-target-dot" cx={target.x} cy={target.y} r="5" />
        <circle className="dial-current-dot" cx={current.x} cy={current.y} r="5" />
      </svg>
      <div className="robotis-dial-readout">
        <span><b>{currentRaw}</b> cnt</span>
        <span>{rawToServoDeg(currentRaw).toFixed(1)}° raw</span>
        <span>{currentPct.toFixed(1)}%</span>
        <span>목표 <b>{targetRaw}</b> cnt</span>
        <span>목표 {targetPct.toFixed(1)}%</span>
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

function MotorRangeBar({ row, currentRaw, targetRaw, onTargetRawChange }) {
  const homePct = pctClamp(countToPercent(row, row.raw_home));
  const curPct = pctClamp(countToPercent(row, currentRaw));
  const targetPct = pctClamp(countToPercent(row, targetRaw));
  const fillLeft = Math.min(curPct, targetPct);
  const fillWidth = Math.abs(targetPct - curPct);
  const onTrackClick = (e) => {
    if (!onTargetRawChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = pctClamp(((e.clientX - rect.left) / rect.width) * 100);
    const raw = Number(row.raw_0_percent) + (pct / 100) * (Number(row.raw_100_percent) - Number(row.raw_0_percent));
    onTargetRawChange(clampRawForRow(row, raw));
  };
  return (
    <div className="motor-range">
      <div className={`motor-range-track ${motorDirection(row) === '역방향' ? 'rev' : ''}`} onClick={onTrackClick}>
        <span className="target-fill" style={{ left: fillLeft + '%', width: fillWidth + '%' }}></span>
        <span className="mark home" style={{ left: homePct + '%' }} title="정자세"></span>
        <span className="mark target" style={{ left: targetPct + '%' }} title="목표 위치"></span>
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

function MotorRawControl({ row, targetRaw, onTargetRawChange, sendRaw, disabled = false, sendDisabled = false }) {
  const [input, setInput] = React.useState(String(targetRaw));
  const holdRef = React.useRef(null);
  const targetRef = React.useRef(targetRaw);

  React.useEffect(() => {
    const next = clampRawForRow(row, targetRaw);
    targetRef.current = next;
    setInput(String(next));
  }, [targetRaw, row && row.joint_name]);

  React.useEffect(() => () => {
    if (holdRef.current) clearInterval(holdRef.current);
  }, []);

  const step = (delta) => {
    if (disabled) return;
    const next = clampRawForRow(row, Number(targetRef.current) + delta);
    targetRef.current = next;
    setInput(String(next));
    onTargetRawChange(next);
  };
  const startHold = (delta) => {
    if (disabled) return;
    targetRef.current = clampRawForRow(row, input);
    step(delta);
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = setInterval(() => step(delta), 90);
  };
  const stopHold = () => {
    if (holdRef.current) clearInterval(holdRef.current);
    holdRef.current = null;
  };
  const commit = () => {
    if (disabled) return;
    const next = clampRawForRow(row, input);
    targetRef.current = next;
    setInput(String(next));
    onTargetRawChange(next);
  };

  return (
    <div className="motor-raw-control">
      <button
        type="button"
        className="raw-step"
        disabled={disabled}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startHold(-1); }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
        title="-1 raw count"
      >←</button>
      <input
        className="ninput tnum raw-current"
        disabled={disabled}
        value={input}
        onChange={e => {
          setInput(e.target.value);
          targetRef.current = e.target.value;
        }}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        onBlur={commit}
      />
      <button
        type="button"
        className="raw-step"
        disabled={disabled}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); startHold(1); }}
        onPointerUp={stopHold}
        onPointerCancel={stopHold}
        onLostPointerCapture={stopHold}
        title="+1 raw count"
      >→</button>
      <button
        type="button"
        className="btn solid raw-send"
        disabled={sendDisabled}
        onClick={() => sendRaw(clampRawForRow(row, targetRef.current))}
      >위치 송신</button>
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
  const [previewRaw, setPreviewRaw] = React.useState({});
  const [previewDirty, setPreviewDirty] = React.useState({});
  const selectedJointRef = React.useRef('');

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
  const activeCalibration = calibrationRows(s.motorConfig || []);
  const editedCalibration = calibrationRows(rows);
  const duplicates = duplicateFields(rows);
  const dirty = JSON.stringify(editedCalibration) !== JSON.stringify(activeCalibration);
  const reversed = rows.filter(r => motorDirection(r) === '역방향').length;
  const selectedRow = rows[selected] || rows[0];
  const selectedJoint = selectedRow ? selectedRow.joint_name : '';
  const selectedMotor = selectedRow ? (s.motors[selectedRow.joint_name] || {}) : {};
  const torqueKnown = selectedMotor.torque !== undefined && s.motorSynced;
  const selectedTorque = torqueKnown ? selectedMotor.torque : false;
  const selectedRaw = selectedRow
    ? (selectedMotor.raw !== undefined ? selectedMotor.raw : selectedRow.raw_home)
    : 0;
  const selectedPreviewRaw = selectedRow
    ? (previewRaw[selectedRow.joint_name] !== undefined
      ? clampRawForRow(selectedRow, previewRaw[selectedRow.joint_name])
      : clampRawForRow(selectedRow, selectedRaw))
    : 0;
  const selectedPreviewDirty = selectedJoint ? !!previewDirty[selectedJoint] : false;
  const anyTorqueOn = rows.some(row => {
    const motor = s.motors[row.joint_name] || {};
    return motor.torque !== undefined ? motor.torque : s.torque;
  });
  const syncReady = !s.rosConnected || s.motorSynced;
  const sendDisabled = !!busy || !selectedRow || !syncReady || dirty || !selectedTorque;

  React.useEffect(() => {
    if (!selectedRow) return;
    const nextRaw = clampRawForRow(selectedRow, selectedRaw);
    if (selectedJointRef.current !== selectedJoint) {
      selectedJointRef.current = selectedJoint;
      setPreviewDirty(dirtyMap => ({ ...dirtyMap, [selectedJoint]: false }));
      setPreviewRaw(raws => ({ ...raws, [selectedJoint]: nextRaw }));
      return;
    }
    if (selectedPreviewDirty) return;
    setPreviewRaw(raws => ({
      ...raws,
      [selectedJoint]: nextRaw,
    }));
  }, [selectedJoint, selectedRaw, selectedPreviewDirty]);

  const updateRow = (index, patch) => {
    setRows(rs => rs.map((r, i) => i === index ? { ...r, ...patch } : r));
    setRemoteErrors([]);
    setMessage('');
  };
  const addRow = () => {
    const row = newMotorRow(rows);
    setRows(rs => [...rs, row]);
    setSelected(rows.length);
    setRemoteErrors([]);
    setMessage('모터 매핑 줄 추가됨');
  };
  const deleteRow = (index) => {
    const row = rows[index];
    if (rows.length <= 1) {
      setMessage('최소 1개 모터 매핑이 필요합니다.');
      return;
    }
    if (!window.confirm(`${row.joint_name || '새 모터'} 매핑 줄을 삭제할까요?`)) return;
    setRows(rs => rs.filter((_, i) => i !== index));
    setSelected(current => Math.min(current === index ? Math.max(0, index - 1) : current, rows.length - 2));
    setRemoteErrors([]);
    setMessage('모터 매핑 줄 삭제됨');
  };
  const numberPatch = (key, value) => ({ [key]: parseFloat(value || '0') });
  const document = () => ({ calibrations: editedCalibration });
  const updateSelectedPreviewRaw = (raw) => {
    if (!selectedRow) return;
    const nextRaw = clampRawForRow(selectedRow, raw);
    setPreviewRaw(raws => ({ ...raws, [selectedRow.joint_name]: nextRaw }));
    setPreviewDirty(dirtyMap => ({ ...dirtyMap, [selectedRow.joint_name]: true }));
  };

  const setAllTorque = async (enabled) => {
    const motors = { ...s.motors };
    rows.forEach(row => {
      motors[row.joint_name] = {
        ...motors[row.joint_name],
        torque: enabled,
      };
    });
    Store.set({ torque: enabled, motors });
    Store.pushLog(
      enabled ? 'ok' : 'warn',
      'motor',
      `토크 ${enabled ? 'ON' : 'OFF'} — 전체 매핑 모터 ${enabled ? '활성' : '해제'}`,
    );
    if (window.RosBridge && window.RosBridge.rosMode) {
      for (const row of rows) {
        await window.RosBridge.api(`/api/motor/${row.id}/torque`, {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        });
      }
    }
  };

  const runApi = async (label, path, method = 'POST') => {
    const local = validateMotorRows(rows);
    setRemoteErrors([]);
    setMessage('');
    if (local.length) return;
    setBusy(label);
    try {
      if (path === '/api/motor-config/save' && anyTorqueOn) {
        setBusy('전체 OFF 확인');
        const ok = window.confirm('저장+적용은 전체 토크 OFF 상태에서만 가능합니다.\n동의하면 전체 토크 OFF 후 저장+적용을 계속 진행합니다.');
        if (!ok) {
          setMessage('저장+적용 취소됨');
          return;
        }
        setMessage('전체 토크 OFF 진행 중');
        await setAllTorque(false);
      }
      setBusy(label);
      const res = await window.RosBridge.api(path, { method, body: JSON.stringify(document()) });
      setRemoteErrors(res.errors || []);
      setMessage(res.message || (res.success ? '완료' : '실패'));
      if (res.success && label !== '검증') {
        Store.set({ motorConfig: cloneMotorConfig(rows), motorConfigPath: res.path || s.motorConfigPath });
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
    if (dirty) {
      setMessage('모터 매핑을 ROS 즉시 적용 또는 저장+적용 후 위치 명령을 보낼 수 있습니다.');
      return;
    }
    if (!selectedTorque) {
      setMessage('선택 모터 토크 ON 상태에서만 위치 명령을 보낼 수 있습니다.');
      return;
    }
    const nextRaw = clampRawForRow(selectedRow, raw);
    if (window.RosBridge && window.RosBridge.rosMode) {
      window.RosBridge.api(`/api/motor/${encodeURIComponent(selectedRow.joint_name)}/raw`, {
        method: 'POST',
        body: JSON.stringify({ raw: nextRaw }),
      }).catch(() => {});
    }
  };
  const commandTorque = (enabled) => {
    if (!selectedRow) return;
    if (window.RosBridge && window.RosBridge.rosMode) {
      setBusy('토크 변경');
      window.RosBridge.api(`/api/motor/${selectedRow.id}/torque`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
        .then(res => {
          setMessage(res.message || `${selectedRow.joint_name} 토크 ${enabled ? 'ON' : 'OFF'} 요청 완료`);
        })
        .catch(e => {
          const detail = e && e.detail ? e.detail : e;
          setMessage((detail && detail.message) || '토크 변경 실패');
        })
        .finally(() => setBusy(''));
    } else {
      const motors = { ...s.motors };
      motors[selectedRow.joint_name] = {
        ...motors[selectedRow.joint_name],
        torque: enabled,
      };
      const allTorque = rows.every(row => motors[row.joint_name] && motors[row.joint_name].torque);
      Store.set({ torque: allTorque, motors });
      Store.pushLog(
        enabled ? 'ok' : 'warn',
        'motor',
        `${selectedRow.joint_name} 토크 ${enabled ? 'ON' : 'OFF'}`,
      );
    }
  };

  return (
    <div className="pad motorcfg">
      <div className="motorcfg-left">
        <div className="motorcfg-top">
          <Panel title="작업" accent="ACTIONS" bodyClass="col gap8">
            <div className="kv">
              <span className="k">전체 토크</span>
              <div className="btn-row">
                <Btn kind={anyTorqueOn ? 'solid' : 'ghost'} size="sm" icon="power" disabled={!!busy || anyTorqueOn} onClick={() => setAllTorque(true)}>전체 ON</Btn>
                <Btn kind={!anyTorqueOn ? 'danger' : 'ghost'} size="sm" icon="stop" disabled={!!busy || !anyTorqueOn} onClick={() => setAllTorque(false)}>전체 OFF</Btn>
              </div>
            </div>
            <div className="btn-row">
              <Btn kind="ghost" size="sm" icon="refresh" disabled={!window.RosBridge || !window.RosBridge.rosMode || !!busy} onClick={() => window.RosBridge.api('/api/motor-config').then(data => {
                const next = data.calibrations || [];
                Store.set({ motorConfig: next, motorConfigPath: data.path || '' });
                setRows(cloneMotorConfig(next));
                setMessage('설정 다시 불러옴');
              })}>불러오기</Btn>
              <Btn kind="ghost" size="sm" icon="check" disabled={!!busy || localErrors.length > 0} onClick={() => runApi('검증', '/api/motor-config/validate')}>검증</Btn>
              <Btn kind="cy" size="sm" icon="bolt" disabled={!!busy || errors.length > 0} onClick={() => runApi('적용', '/api/motor-config/apply')}>ROS 즉시 적용</Btn>
              <Btn kind="solid" size="sm" icon="save" disabled={!!busy || errors.length > 0} onClick={() => runApi('저장', '/api/motor-config/save', 'PUT')}>저장+적용</Btn>
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
              <Btn kind="ghost" size="sm" icon="plus" disabled={!!busy} onClick={addRow}>추가</Btn>
              <Badge kind="cy">MOTORS {rows.length}</Badge>
              <Badge kind={reversed ? 'warn' : 'cy'}>REVERSED {reversed}</Badge>
              <Badge kind={errors.length ? 'err' : 'ok'}>ERRORS {errors.length}</Badge>
              <Badge kind={dirty ? 'warn' : 'ok'}>DIRTY {dirty ? 'YES' : 'NO'}</Badge>
            </span>
          }
        >
          <table className="tbl motor-map">
            <colgroup>
              <col className="c-joint" />
              <col className="c-id" />
              <col className="c-model" />
              <col className="c-cnt" />
              <col className="c-cnt" />
              <col className="c-cnt" />
              <col className="c-dir" />
              <col className="c-current" />
              <col className="c-pct" />
              <col className="c-state" />
              <col className="c-action" />
            </colgroup>
            <thead>
              <tr>
                <th>JOINT</th><th className="num">ID</th><th>MODEL</th>
                <th className="num">0% CNT</th><th className="num">정자세</th><th className="num">100% CNT</th>
                <th>방향</th><th className="num">현재</th><th className="num">%</th><th>상태</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const motor = s.motors[row.joint_name] || {};
                const currentRaw = motor.raw !== undefined ? motor.raw : row.raw_home;
                const pct = countToPercent(row, currentRaw);
                const rowErrors = validateMotorRows([row]);
                const duplicate = duplicates[i] || {};
                const rowHasError = rowErrors.length || duplicate.joint || duplicate.id;
                const torqueKnownForRow = motor.torque !== undefined && s.motorSynced;
                const torqueOnForRow = torqueKnownForRow ? motor.torque : false;
                return (
                  <tr key={i} className={selected === i ? 'sel' : ''} onClick={() => setSelected(i)}>
                    <td>
                      <input
                        className={`ninput mono ${duplicate.joint ? 'dup' : ''}`}
                        list="motor-joint-options"
                        value={row.joint_name}
                        onChange={e => updateRow(i, { joint_name: e.target.value })}
                      />
                    </td>
                    <td className="num"><input className={`ninput tnum smnum ${duplicate.id ? 'dup' : ''}`} type="number" value={row.id} onChange={e => updateRow(i, numberPatch('id', e.target.value))} /></td>
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
                    <td>
                      <span className="motor-state-badges">
                        <Badge kind={rowHasError ? 'err' : 'ok'}>{rowHasError ? 'ERROR' : 'OK'}</Badge>
                        <Badge kind={!torqueKnownForRow ? 'warn' : torqueOnForRow ? 'ok' : 'warn'}>
                          TORQUE {torqueKnownForRow ? (torqueOnForRow ? 'ON' : 'OFF') : '--'}
                        </Badge>
                      </span>
                    </td>
                    <td className="motor-map-actions">
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="매핑 줄 삭제"
                        onClick={e => { e.stopPropagation(); deleteRow(i); }}
                      >
                        <Icon name="trash" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="motor-joint-options">
            {JOINT_IDS.map(id => <option key={id} value={id} />)}
          </datalist>
        </Panel>
      </div>

      <Panel title="선택 모터" accent="RANGE" bodyClass="col motorcfg-range">
        {selectedRow && (
          <>
            <KV k="Joint" v={selectedRow.joint_name} />
            <KV k="방향" v={motorDirection(selectedRow)} mono={false} />
            <div className="motor-torque-toggle">
              <span className="torque-label">TORQUE</span>
              <label className="torque-switch">
                <input
                  type="checkbox"
                  checked={!!selectedTorque}
                  disabled={!!busy || !torqueKnown}
                  onChange={e => commandTorque(e.target.checked)}
                />
                <span className="torque-track">
                  <span className="torque-thumb" />
                  <span className="torque-off-txt">OFF</span>
                  <span className="torque-on-txt">ON</span>
                </span>
              </label>
            </div>
            {!torqueKnown && <Badge kind="warn">토크 상태 동기화 대기</Badge>}
            {!syncReady && <Badge kind="warn">현재 위치 동기화 대기</Badge>}
            {dirty && <Badge kind="warn">매핑 적용 필요</Badge>}
            <RobotisDial
              row={selectedRow}
              currentRaw={selectedRaw}
              targetRaw={selectedPreviewRaw}
              onTargetRawChange={updateSelectedPreviewRaw}
            />
            <MotorRangeBar
              row={selectedRow}
              currentRaw={selectedRaw}
              targetRaw={selectedPreviewRaw}
              onTargetRawChange={updateSelectedPreviewRaw}
            />
            <div className="motor-jog-bottom">
              <MotorRawControl
                row={selectedRow}
                targetRaw={selectedPreviewRaw}
                onTargetRawChange={updateSelectedPreviewRaw}
                sendRaw={commandSelectedRaw}
                sendDisabled={sendDisabled}
              />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

window.TabMotorSettings = TabMotorSettings;
