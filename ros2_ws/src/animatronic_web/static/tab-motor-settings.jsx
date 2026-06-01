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
        <span>0% <b>{row.raw_0_percent}</b></span>
        <span>정자세 <b>{row.raw_home}</b> / {homePct.toFixed(1)}%</span>
        <span>100% <b>{row.raw_100_percent}</b></span>
      </div>
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
    min_angle_deg: parseFloat(r.min_angle_deg || 0),
    home_angle_deg: parseFloat(r.home_angle_deg || 0),
    max_angle_deg: parseFloat(r.max_angle_deg || 0),
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

  return (
    <div className="pad motorcfg">
      <div className="motorcfg-head">
        <Panel title="요약" accent="MOTOR SETUP" bodyClass="motorcfg-stats">
          <Stat k="MOTORS" v={rows.length} kind="cy" />
          <Stat k="REVERSED" v={reversed} kind={reversed ? 'warn' : ''} />
          <Stat k="ERRORS" v={errors.length} kind={errors.length ? 'err' : 'cy'} />
          <Stat k="DIRTY" v={dirty ? 'YES' : 'NO'} kind={dirty ? 'warn' : ''} />
        </Panel>

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
      </div>

      <div className="motorcfg-body">
        <Panel title="모터 매핑" accent="MAP" bodyClass="pad-0">
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

        <div className="motorcfg-side">
          <Panel title="선택 모터" accent="RANGE" bodyClass="col">
            {selectedRow && (
              <>
                <KV k="Joint" v={selectedRow.joint_name} />
                <KV k="방향" v={motorDirection(selectedRow)} mono={false} />
                <MotorRangeBar row={selectedRow} currentRaw={(s.motors[selectedRow.joint_name] || {}).raw || selectedRow.raw_home} />
                <div className="angle-grid">
                  <div className="field"><label>0% 각도</label><input className="ninput tnum" type="number" value={selectedRow.min_angle_deg} onChange={e => updateRow(selected, numberPatch('min_angle_deg', e.target.value))} /></div>
                  <div className="field"><label>정자세 각도</label><input className="ninput tnum" type="number" value={selectedRow.home_angle_deg} onChange={e => updateRow(selected, numberPatch('home_angle_deg', e.target.value))} /></div>
                  <div className="field"><label>100% 각도</label><input className="ninput tnum" type="number" value={selectedRow.max_angle_deg} onChange={e => updateRow(selected, numberPatch('max_angle_deg', e.target.value))} /></div>
                </div>
              </>
            )}
          </Panel>

          <Panel title="검증 결과" accent="VALIDATION" bodyClass="col gap8">
            {errors.length ? errors.map((err, i) => <div className="motor-error" key={i}>{err}</div>) : <Badge kind="ok">설정 정상</Badge>}
            <span className="hint">토크 ON 상태에서는 즉시 적용 서비스가 거부됩니다.</span>
          </Panel>
        </div>
      </div>
    </div>
  );
}

window.TabMotorSettings = TabMotorSettings;
