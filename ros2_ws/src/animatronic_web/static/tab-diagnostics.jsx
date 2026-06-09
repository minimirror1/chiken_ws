/* ============================================================
   tab-diagnostics.jsx — 진단 + 로그
   ============================================================ */

function MotorCard({ id, m }) {
  const hot = m.temp > 50, warm = m.temp > 45;
  const effort = motorEffortView(m);
  return (
    <div className="panel" style={{ background: 'var(--bg-2)' }}>
      <div className="panel-h" style={{ padding: '7px 11px' }}>
        <span className="ti" style={{ fontSize: 10 }}>{id}</span>
        <span className="right"><Dot kind={m.torque ? 'ok' : 'off'} /><span className="mono" style={{ fontSize: 9, color: m.error === 'OK' ? 'var(--tx-3)' : 'var(--err)' }}>{m.error}</span></span>
      </div>
      <div className="panel-b" style={{ padding: 11 }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <Stat k="POS" v={m.pos.toFixed(1)} unit="°" />
          <Stat k="RAW" v={m.raw} kind="cy" />
        </div>
        <div style={{ marginBottom: 7 }}>
          <div className="row between" style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--tx-3)', marginBottom: 3 }}><span>TEMP</span><span style={{ color: hot ? 'var(--err)' : warm ? 'var(--warn)' : 'var(--tx-1)' }}>{m.temp.toFixed(0)}°C</span></div>
          <MBar value={m.temp} max={70} kind={hot ? 'err' : warm ? 'warn' : 'ok'} />
        </div>
        <div style={{ marginBottom: 7 }}>
          <div className="row between" style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--tx-3)', marginBottom: 3 }}><span>{effort.label}</span><span style={{ color: effort.color }}>{effort.text}</span></div>
          {effort.signed ? <SignedMBar value={effort.value} max={effort.max} kind={effort.kind} /> : <MBar value={effort.value} max={effort.max} kind={effort.kind} />}
        </div>
        <div className="row between" style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--tx-3)' }}>
          <span>VOLT {m.volt.toFixed(1)}V</span><span>{m.model}</span>
        </div>
      </div>
    </div>
  );
}

function TabDiagnostics() {
  const s = useStore();
  const [lvFilter, setLvFilter] = React.useState('all');
  const [srcFilter, setSrcFilter] = React.useState('all');
  const [q, setQ] = React.useState('');
  const sources = ['all', ...Array.from(new Set(s.logs.map(l => l.src)))];
  const filtered = s.logs.filter(l =>
    (lvFilter === 'all' || l.lv === lvFilter) &&
    (srcFilter === 'all' || l.src === srcFilter) &&
    (!q || l.msg.toLowerCase().includes(q.toLowerCase())));
  const errCount = s.logs.filter(l => l.lv === 'err').length;
  const warnCount = s.logs.filter(l => l.lv === 'warn').length;

  return (
    <div className="pad" style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', gap: 12, minHeight: 0 }}>

      {/* TOP — motors + system */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 300px', gap: 12 }}>
        {JOINT_IDS.map(id => <MotorCard key={id} id={id} m={s.motors[id]} />)}
        <Panel title="시스템 상태" accent="SYSTEM" bodyClass="col" style={{ gap: 0 }}>
          <div className="kv"><span className="k">ROS 2 노드</span><span className="v" style={{ color: s.ros.connected ? 'var(--ok)' : 'var(--err)' }}><Dot kind={s.ros.connected ? 'ok' : 'err'} pulse /> {s.ros.node}</span></div>
          <KV k="제어 주기" v={s.ros.hz + ' Hz'} />
          <KV k="지연" v={s.ros.latency.toFixed(1) + ' ms'} />
          <div className="kv"><span className="k">Services</span><span className="v" style={{ color: s.ros.services ? 'var(--ok)' : 'var(--warn)' }}>{s.ros.services ? 'READY' : 'WAIT'}</span></div>
          <div className="kv"><span className="k">Actions</span><span className="v" style={{ color: s.ros.actions ? 'var(--ok)' : 'var(--warn)' }}>{s.ros.actions ? 'READY' : 'WAIT'}</span></div>
          <div className="kv"><span className="k">센서</span><span className="v" style={{ color: s.sensor.connected ? 'var(--ok)' : 'var(--err)' }}>{s.sensor.connected ? 'LIVE' : 'OFF'}</span></div>
        </Panel>
      </div>

      {/* BOTTOM — logs */}
      <Panel title="이벤트 / 오류 로그" accent="LOG" ticked bodyClass="pad-0" className="flex1"
        right={<div className="row gap8 center">
          <Badge kind="err">{errCount} ERR</Badge><Badge kind="warn">{warnCount} WARN</Badge>
          <span className="mono" style={{ fontSize: 10, color: 'var(--tx-3)' }}>{s.logs.length} total</span>
        </div>}>
        {/* filter bar */}
        <div className="row center" style={{ gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line-1)', flexWrap: 'wrap' }}>
          <Seg value={lvFilter} onChange={setLvFilter} options={[
            { v: 'all', label: '전체' }, { v: 'cmd', label: 'CMD' }, { v: 'ok', label: 'OK' }, { v: 'warn', label: 'WARN' }, { v: 'err', label: 'ERR' }]} />
          <select className="ninput" style={{ width: 130 }} value={srcFilter} onChange={e => setSrcFilter(e.target.value)}>
            {sources.map(src => <option key={src} value={src}>{src === 'all' ? '모든 소스' : src}</option>)}
          </select>
          <input className="ninput" style={{ flex: 1, minWidth: 140, fontFamily: 'var(--mono)' }} placeholder="메시지 검색…" value={q} onChange={e => setQ(e.target.value)} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--tx-3)' }}>{filtered.length} matched</span>
          <Btn kind="ghost" size="sm" icon="download">내보내기</Btn>
        </div>
        <div className="scroll-y" style={{ height: 'calc(100% - 45px)' }}>
          <LogList logs={filtered} />
        </div>
      </Panel>
    </div>
  );
}

window.TabDiagnostics = TabDiagnostics;
