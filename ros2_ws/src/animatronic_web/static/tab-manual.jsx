/* ============================================================
   tab-manual.jsx — 수동 제어 + 3D 미리보기
   ============================================================ */

function TabManual() {
  const s = useStore();
  const [pending, setPending] = React.useState(null); // staged pose before "apply"
  const live = s.joints;
  const actual = s.actualJoints || live;
  const view = pending || live;

  const setJ = (id, v) => {
    v = Math.max(-100, Math.min(100, v));
    setPending(p => ({ ...(p || live), [id]: v }));
  };
  const apply = () => { if (pending) { Store.setPose(pending, 'manual'); setPending(null); } };
  const revert = () => setPending(null);
  const captureToStudio = () => {
    const p = Store.getPattern(s.editingPatternId) || s.patterns[0];
    const t = Store.patternDuration(p) + 600;
    const tracks = Object.fromEntries(JOINT_IDS.map(id => [id, [...(p.tracks[id] || []), { id: 'ak' + Math.random().toString(36).slice(2, 8), time_ms: t, value: view[id], tangent: defaultTangent('auto') }].sort((a, b) => a.time_ms - b.time_ms)]));
    Store.updatePattern(p.id, { tracks });
    Store.pushLog('ok', 'manual', `현재 자세 → '${p.name}' 축 키 캡처 (t=${t}ms)`);
  };

  const overAny = JOINT_IDS.some(id => isOverSoft(id, view[id]));

  return (
    <div className="pad" style={{ height: '100%', display: 'grid', gridTemplateColumns: '360px 1fr 300px', gap: 12, gridTemplateRows: '100%' }}>

      {/* LEFT — joint sliders */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="관절 제어" accent="JOINTS" ticked right={pending ? <Badge kind="warn">미적용 변경</Badge> : <Badge kind="ok">동기화됨</Badge>}>
          <div className="col" style={{ gap: 2 }}>
            {JOINT_IDS.map(id => (
              <JointSlider key={id} jid={id} value={view[id]} onChange={setJ} />
            ))}
          </div>
          <div className="hdiv" style={{ margin: '12px 0 10px' }}></div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>이동 방식</label>
            <Seg value={s.moveSpeed} onChange={v => Store.set({ moveSpeed: v })}
              options={[{ v: 'instant', label: '즉시 이동' }, { v: 'slow', label: '천천히 이동' }]} />
          </div>
          <div className="btn-row">
            <Btn kind="solid" icon="check" onClick={apply} disabled={!pending}>목표 자세 적용</Btn>
            <Btn kind="ghost" onClick={revert} disabled={!pending}>되돌리기</Btn>
          </div>
        </Panel>

        <Panel title="빠른 동작" accent="QUICK" className="flex1" bodyClass="col gap8">
          <Btn kind="ghost" icon="home" block onClick={() => { Store.home(); setPending(null); }}>기준 자세 (HOME)</Btn>
          <Btn kind="cy" icon="capture" block onClick={captureToStudio}>현재 자세 캡처 → 스튜디오</Btn>
          <Btn kind="danger" icon="stop" block onClick={() => Store.setMode('stop')}>정지 (STOP)</Btn>
          <div className="hdiv" style={{ margin: '4px 0' }}></div>
          <div className="kv"><span className="k">토크</span><Toggle on={s.torque} onChange={() => Store.toggleTorque()} label={s.torque ? 'ON' : 'OFF'} /></div>
          <div className="kv"><span className="k">소프트 리밋 보호</span><Toggle on={s.settings.softLimitEnabled} onChange={v => Store.set({ settings: { ...s.settings, softLimitEnabled: v } })} label={s.settings.softLimitEnabled ? '활성' : '해제'} /></div>
          {overAny && (
            <div style={{ marginTop: 4, padding: '8px 10px', background: 'var(--err-dim)', border: '1px solid rgba(230,95,80,.4)', borderRadius: 4, fontSize: 11, color: 'var(--err)', display: 'flex', gap: 8 }}>
              <Icon name="warn" /> <span>일부 관절이 소프트 리밋을 초과했습니다. 적용 전 확인하세요.</span>
            </div>
          )}
        </Panel>
      </div>

      {/* CENTER — big 3D */}
      <Panel title="3D 관절 뷰어" accent="VIEWER" ticked bodyClass="pad-0" sub="drag 회전 · scroll 확대"
        right={<span className="mono" style={{ fontSize: 10, color: 'var(--tx-2)' }}>{pending ? 'PREVIEW (미적용)' : 'TARGET'}</span>}>
        <ViewerFrame getJoints={() => view} interactive warnLimits label={pending ? 'PREVIEW POSE' : 'TARGET POSE'} />
      </Panel>

      {/* RIGHT — readouts */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="현재 각도 / RAW" accent="READOUT" className="flex1">
          {JOINT_IDS.map(id => {
            const m = s.motors[id];
            const over = isOverSoft(id, view[id]);
            const targetDeg = valToDeg(id, view[id]);
            const actualValue = actual[id] !== undefined ? actual[id] : 0;
            const actualDeg = valToDeg(id, actualValue);
            const errValue = view[id] - actualValue;
            const errAbs = Math.abs(errValue);
            const errColor = errAbs >= 10 ? 'var(--err)' : (errAbs >= 3 ? 'var(--warn)' : 'var(--tx-3)');
            return (
              <div key={id} style={{ padding: '9px 0', borderBottom: '1px dashed var(--line-0)' }}>
                <div className="row between center" style={{ marginBottom: 5 }}>
                  <span className="mono" style={{ fontSize: 11, color: over ? 'var(--warn)' : 'var(--tx-0)' }}>{id}</span>
                  <span className="mono tnum" style={{ fontSize: 14, color: over ? 'var(--warn)' : 'var(--cy)' }}>{targetDeg.toFixed(1)}°</span>
                </div>
                <div className="row between" style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--tx-3)', marginBottom: 5 }}>
                  <span>raw {valToRaw(id, view[id])}</span>
                  <span>목표 {view[id]} / 실제 {actualValue}</span>
                </div>
                <div className="row between" style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: errColor, marginBottom: 5 }}>
                  <span>actual {actualDeg.toFixed(1)}°</span>
                  <span>err {errValue > 0 ? '+' : ''}{errValue.toFixed(0)}%</span>
                </div>
                <MBar value={Math.abs(view[id])} max={100} kind={over ? 'warn' : ''} />
                <div className="row between" style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--tx-3)', marginTop: 4 }}>
                  <span>온도 {m.temp.toFixed(0)}°C</span>
                  <span>부하 {m.load.toFixed(0)}%</span>
                  <span>{m.volt.toFixed(1)}V</span>
                </div>
              </div>
            );
          })}
        </Panel>
        <Panel title="자세 프리셋" accent="PRESET" bodyClass="col gap8">
          <Btn kind="ghost" size="sm" block onClick={() => { setPending({ lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 }); }}>중립 자세</Btn>
          <Btn kind="ghost" size="sm" block onClick={() => { setPending({ lower_yaw: 0, lower_pitch: 22, upper_yaw: 0, upper_pitch: 45 }); }}>전방 주시</Btn>
          <Btn kind="ghost" size="sm" block onClick={() => { setPending({ lower_yaw: -40, lower_pitch: -6, upper_yaw: -25, upper_pitch: -10 }); }}>좌측 경계</Btn>
        </Panel>
      </div>
    </div>
  );
}

window.TabManual = TabManual;
