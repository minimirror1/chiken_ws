/* ============================================================
   tab-operations.jsx — 운영 대시보드
   ============================================================ */

function TabOperations() {
  const s = useStore();
  const pat = Store.getPattern(s.activePattern);
  const nearest = s.sensor.persons.find(p => p.id === s.sensor.nearestId);
  const modes = [
    { v: 'detect', kr: '감지', en: 'DETECT' },
    { v: 'random', kr: '랜덤', en: 'RANDOM' },
    { v: 'test', kr: '테스트', en: 'TEST' },
    { v: 'stop', kr: '정지', en: 'STOP' },
  ];
  const avgTemp = (JOINT_IDS.reduce((a, id) => a + s.motors[id].temp, 0) / 4).toFixed(0);
  return (
    <div className="pad" style={{ height: '100%', display: 'grid', gridTemplateColumns: '320px 1fr 360px', gap: 12, gridTemplateRows: '100%' }}>

      {/* ---- LEFT : control ---- */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="운영 모드" accent="MODE" ticked right={<Badge kind={s.estop ? 'err' : 'cy'}>{s.estop ? 'E-STOP' : ModeName(s.mode)}</Badge>}>
          <div className="mode-grid">
            {modes.map(m => (
              <div key={m.v} className={`mode-tile ${m.v === 'stop' ? 'stop' : ''} ${s.mode === m.v ? 'on' : ''}`}
                onClick={() => Store.setMode(m.v)}>
                <span className="ic"></span>
                <div className="nm">{m.kr}</div>
                <div className="en">{m.en}</div>
              </div>
            ))}
          </div>
          <div style={{ height: 12 }}></div>
          <div className="col gap8">
            <Btn kind={s.estop ? 'solid' : 'danger'} block icon="stop" onClick={() => Store.triggerEstop()}>
              {s.estop ? '긴급 정지 해제' : '긴급 정지 (E-STOP)'}
            </Btn>
            <div className="btn-row">
              <Btn kind="ghost" icon="home" onClick={() => Store.home()} block>기준 자세 복귀</Btn>
            </div>
            <div className="kv" style={{ paddingTop: 6 }}>
              <span className="k">토크 (전 관절)</span>
              <Toggle on={s.torque} onChange={() => Store.toggleTorque()} label={s.torque ? 'ON' : 'OFF'} />
            </div>
          </div>
        </Panel>

        <Panel title="현재 동작" accent="ACTIVE" className="flex1" bodyClass="col gap8">
          <div className="row between center">
            <Stat k="실행 중 패턴" v={pat ? pat.name : '—'} kind="cy" />
            {s.playing ? <Badge kind="cy"><Dot kind="cy" pulse />재생</Badge> : <Badge>대기</Badge>}
          </div>
          <div className="hdiv"></div>
          <KV k="마지막 동작" v={relTime(s.lastActionTime)} mono={false} />
          <KV k="패턴 ID" v={s.activePattern} />
          <KV k="축 키" v={pat ? Store.trackKeyCount(pat) + ' 개' : '—'} />
          <KV k="길이" v={pat ? (Store.patternDuration(pat) / 1000).toFixed(1) + ' s' : '—'} />
          <KV k="커브" v={pat ? 'Tangent' : '—'} />
        </Panel>
      </div>

      {/* ---- CENTER : mini viewer + motor summary ---- */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="현재 자세" accent="POSE" ticked className="flex1" bodyClass="pad-0" sub="drag · 회전 / scroll · 확대">
          <ViewerFrame getJoints={() => s.actualJoints || s.joints} interactive autoRotate label="CURRENT POSE" />
        </Panel>
        <Panel title="모터 상태 요약" accent="MOTORS" right={<span className="mono" style={{ fontSize: 10, color: 'var(--tx-2)' }}>4 / 4 ONLINE</span>}>
          <table className="tbl">
            <thead><tr><th>JOINT</th><th className="num">POS</th><th className="num">TEMP</th><th className="num">EFFORT</th><th className="num">VOLT</th><th>TQ</th></tr></thead>
            <tbody>
              {JOINT_IDS.map(id => {
                const m = s.motors[id];
                const hot = m.temp > 50, warm = m.temp > 45;
                const effort = motorEffortView(m);
                return (
                  <tr key={id}>
                    <td className="name" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{id}</td>
                    <td className="num">{m.pos.toFixed(1)}°</td>
                    <td className="num" style={{ color: hot ? 'var(--err)' : warm ? 'var(--warn)' : 'var(--tx-1)' }}>{m.temp.toFixed(0)}°C</td>
                    <td className="num" style={{ color: effort.color }}>{effort.text}</td>
                    <td className="num">{m.volt.toFixed(1)}V</td>
                    <td><Dot kind={m.torque ? 'ok' : 'off'} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* ---- RIGHT : sensor + logs ---- */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="센서 감지" accent="SENSOR" right={<Badge kind={s.sensor.connected ? 'ok' : 'err'}><Dot kind={s.sensor.connected ? 'ok' : 'err'} pulse={s.sensor.connected} />{s.sensor.connected ? 'LIVE' : 'OFFLINE'}</Badge>}>
          <div className="row" style={{ gap: 18 }}>
            <Stat k="감지 인원" v={s.sensor.persons.length} unit="명" kind="cy" />
            <div className="vdiv"></div>
            <Stat k="가장 가까운" v={nearest ? nearest.dist.toFixed(2) : '—'} unit="m" />
            <Stat k="방향" v={nearest ? (nearest.angle > 0 ? '+' : '') + nearest.angle.toFixed(0) + '°' : '—'} />
          </div>
          <div className="hdiv" style={{ margin: '10px 0' }}></div>
          <div className="slabel">감지된 사람 — mmWave</div>
          <table className="tbl">
            <thead><tr><th>ID</th><th className="num">거리</th><th className="num">각도</th><th className="num">X / Y</th></tr></thead>
            <tbody>
              {s.sensor.persons.map(p => (
                <tr key={p.id} style={p.id === s.sensor.nearestId ? { background: 'var(--cy-dim)' } : null}>
                  <td style={{ color: p.id === s.sensor.nearestId ? 'var(--cy)' : 'var(--tx-1)' }}>#{p.id}</td>
                  <td className="num">{p.dist.toFixed(2)}m</td>
                  <td className="num">{p.angle > 0 ? '+' : ''}{p.angle.toFixed(0)}°</td>
                  <td className="num" style={{ fontSize: 10, color: 'var(--tx-2)' }}>{p.x.toFixed(1)} / {p.y.toFixed(1)}</td>
                </tr>
              ))}
              {!s.sensor.persons.length && <tr><td colSpan="4" style={{ textAlign: 'center', color: 'var(--tx-3)' }}>감지된 대상 없음</td></tr>}
            </tbody>
          </table>
        </Panel>

        <Panel title="최근 로그" accent="LOG" className="flex1" bodyClass="pad-0" right={<span className="mono" style={{ fontSize: 10, color: 'var(--tx-3)' }}>tail · 8</span>}>
          <LogList logs={s.logs} limit={8} />
        </Panel>
      </div>
    </div>
  );
}

window.TabOperations = TabOperations;
