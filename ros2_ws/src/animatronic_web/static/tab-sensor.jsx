/* ============================================================
   tab-sensor.jsx — 센서/반응 설정
   ============================================================ */

function Radar({ persons, nearestId, cfg }) {
  // top-down fan, sensor at bottom-center, looking +Y (up)
  const W = 320, H = 280, cx = W / 2, cy = H - 24;
  const maxR = H - 50;
  const scale = maxR / cfg.rangeMax;
  const half = cfg.fovDeg / 2;
  const fovPt = (a, r) => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
  const rings = [1, 2, 3, 4].filter(r => r <= cfg.rangeMax);
  const [lx, ly] = fovPt(-half, maxR);
  const [rx, ry] = fovPt(half, maxR);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* FOV wedge */}
      <path d={`M ${cx} ${cy} L ${lx} ${ly} A ${maxR} ${maxR} 0 0 1 ${rx} ${ry} Z`} fill="rgba(63,199,212,0.05)" stroke="rgba(63,199,212,0.25)" strokeWidth="1" />
      {/* range rings */}
      {rings.map(r => {
        const rr = r * scale;
        const [ax, ay] = fovPt(-half, rr), [bx, by] = fovPt(half, rr);
        return (
          <g key={r}>
            <path d={`M ${ax} ${ay} A ${rr} ${rr} 0 0 1 ${bx} ${by}`} fill="none" stroke="var(--line-1)" strokeWidth="1" />
            <text x={cx + 4} y={cy - rr + 11} fill="var(--tx-3)" fontSize="9" fontFamily="var(--mono)">{r}m</text>
          </g>
        );
      })}
      {/* min range */}
      <path d={`M ${cx} ${cy} m ${-cfg.rangeMin * scale} 0 a ${cfg.rangeMin * scale} ${cfg.rangeMin * scale} 0 0 1 ${cfg.rangeMin * scale * 2} 0`} fill="rgba(230,95,80,0.08)" stroke="rgba(230,95,80,0.3)" strokeDasharray="2 2" />
      {/* center axis */}
      <line x1={cx} y1={cy} x2={cx} y2={cy - maxR} stroke="var(--line-0)" strokeDasharray="3 4" />
      {/* sensor */}
      <rect x={cx - 9} y={cy - 3} width="18" height="8" rx="2" fill="var(--cy)" />
      <text x={cx} y={cy + 16} fill="var(--tx-2)" fontSize="9" fontFamily="var(--mono)" textAnchor="middle">mmWave</text>
      {/* persons */}
      {persons.map(p => {
        const r = Math.min(p.dist, cfg.rangeMax) * scale;
        const [px, py] = fovPt(p.angle, r);
        const inRange = p.dist >= cfg.rangeMin && p.dist <= cfg.rangeMax && Math.abs(p.angle) <= half;
        const isN = p.id === nearestId;
        return (
          <g key={p.id}>
            {isN && <circle cx={px} cy={py} r="11" fill="none" stroke="var(--cy)" strokeWidth="1" opacity="0.6"><animate attributeName="r" values="7;13;7" dur="2s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" /></circle>}
            <circle cx={px} cy={py} r="5" fill={isN ? 'var(--cy)' : inRange ? 'var(--ok)' : 'var(--tx-3)'} />
            <text x={px + 8} y={py + 3} fill={isN ? 'var(--cy)' : 'var(--tx-2)'} fontSize="9" fontFamily="var(--mono)">#{p.id}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CfgSlider({ label, en, value, min, max, step, unit, onChange, fmt }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px dashed var(--line-0)' }}>
      <div className="row between center" style={{ marginBottom: 6 }}>
        <div><span style={{ fontSize: 12 }}>{label}</span> <span className="mono" style={{ fontSize: 9.5, color: 'var(--tx-3)' }}>{en}</span></div>
        <span className="mono tnum" style={{ fontSize: 13, color: 'var(--cy)' }}>{fmt ? fmt(value) : value}{unit}</span>
      </div>
      <input className="jrange" type="range" min={min} max={max} step={step} value={value}
        style={{ backgroundSize: ((value - min) / (max - min)) * 100 + '% 100%' }}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function TabSensor() {
  const s = useStore();
  const cfg = s.sensorConfig;
  const setCfg = (patch) => Store.set({ sensorConfig: { ...cfg, ...patch } });
  const nearest = s.sensor.persons.find(p => p.id === s.sensor.nearestId);
  const toggleTrig = (pid) => {
    const has = cfg.triggerGroup.includes(pid);
    setCfg({ triggerGroup: has ? cfg.triggerGroup.filter(x => x !== pid) : [...cfg.triggerGroup, pid] });
  };

  return (
    <div className="pad" style={{ height: '100%', display: 'grid', gridTemplateColumns: '380px 1fr 1fr', gap: 12, gridTemplateRows: '100%' }}>

      {/* LEFT — radar + status */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="감지 영역" accent="RADAR" ticked bodyClass="pad-0"
          right={<Badge kind={s.sensor.connected ? 'ok' : 'err'}><Dot kind={s.sensor.connected ? 'ok' : 'err'} pulse />{s.sensor.connected ? 'CONNECTED' : 'OFF'}</Badge>}>
          <div style={{ padding: 12 }}><Radar persons={s.sensor.persons} nearestId={s.sensor.nearestId} cfg={cfg} /></div>
        </Panel>
        <Panel title="mmWave 상태" accent="LIDAR" bodyClass="col" style={{ gap: 0 }}>
          <KV k="모듈" v="Seeed R60ABD1" />
          <KV k="포트" v="/dev/ttyUSB0 · 115200" />
          <KV k="감지 인원" v={s.sensor.persons.length + ' 명'} />
          <KV k="가장 가까운" v={nearest ? `#${nearest.id} · ${nearest.dist.toFixed(2)}m` : '—'} />
          <KV k="방향" v={nearest ? (nearest.angle > 0 ? '+' : '') + nearest.angle.toFixed(1) + '°' : '—'} />
          <KV k="좌표 (x,y)" v={nearest ? `${nearest.x.toFixed(2)}, ${nearest.y.toFixed(2)}` : '—'} />
        </Panel>
      </div>

      {/* CENTER — detection params */}
      <Panel title="감지 파라미터" accent="DETECTION" bodyClass="scroll-y">
        <div className="slabel">감지 거리 범위</div>
        <CfgSlider label="최소 거리" en="range_min" value={cfg.rangeMin} min={0.2} max={2} step={0.1} unit="m" onChange={v => setCfg({ rangeMin: v })} fmt={v => v.toFixed(1)} />
        <CfgSlider label="최대 거리" en="range_max" value={cfg.rangeMax} min={2} max={8} step={0.1} unit="m" onChange={v => setCfg({ rangeMax: v })} fmt={v => v.toFixed(1)} />
        <CfgSlider label="감지 화각" en="fov_deg" value={cfg.fovDeg} min={40} max={160} step={5} unit="°" onChange={v => setCfg({ fovDeg: v })} />
        <div className="slabel" style={{ marginTop: 14 }}>타이밍</div>
        <CfgSlider label="감지 유지 시간" en="hold_ms" value={cfg.holdMs} min={500} max={8000} step={100} unit="s" onChange={v => setCfg({ holdMs: v })} fmt={v => (v / 1000).toFixed(1)} />
        <CfgSlider label="쿨다운" en="cooldown_ms" value={cfg.cooldownMs} min={1000} max={20000} step={500} unit="s" onChange={v => setCfg({ cooldownMs: v })} fmt={v => (v / 1000).toFixed(1)} />
        <CfgSlider label="패턴 락" en="pattern_lock_ms" value={cfg.patternLockMs} min={0} max={10000} step={250} unit="s" onChange={v => setCfg({ patternLockMs: v })} fmt={v => (v / 1000).toFixed(1)} />
        <CfgSlider label="랜덤 모드 간격" en="random_interval_ms" value={cfg.randomIntervalMs} min={5000} max={120000} step={1000} unit="s" onChange={v => setCfg({ randomIntervalMs: v })} fmt={v => (v / 1000).toFixed(0)} />
      </Panel>

      {/* RIGHT — trigger group + policy */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="감지 시 실행할 패턴 그룹" accent="TRIGGER" className="flex1" bodyClass="scroll-y">
          <span className="hint" style={{ fontSize: 10.5, color: 'var(--tx-3)', display: 'block', marginBottom: 8 }}>감지 발생 시 이 그룹에서 무작위로 하나가 실행됩니다.</span>
          <div className="col gap8">
            {s.patterns.map(p => {
              const on = cfg.triggerGroup.includes(p.id);
              return (
                <div key={p.id} className={`kf-item ${on ? 'sel' : ''}`} style={{ gridTemplateColumns: '1fr auto' }} onClick={() => toggleTrig(p.id)}>
                  <div className="info">
                    <div className="tm" style={{ fontFamily: 'var(--kr)', fontSize: 12.5 }}>{p.name}</div>
                    <div className="jv">{(Store.patternDuration(p) / 1000).toFixed(1)}s · {p.keyframes.length} KF · {INTERP[p.defaultInterp].kr}</div>
                  </div>
                  <Dot kind={on ? 'cy' : 'off'} />
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="반응 정책" accent="POLICY" bodyClass="col gap8">
          <div className="kv"><span className="k">감지 기반 반응</span><Toggle on={s.mode === 'detect'} onChange={v => Store.setMode(v ? 'detect' : 'stop')} label={s.mode === 'detect' ? '활성' : '비활성'} /></div>
          <div className="kv"><span className="k">랜덤 모드 자동 전환</span><Toggle on={s.mode === 'random'} onChange={v => Store.setMode(v ? 'random' : 'detect')} label={s.mode === 'random' ? 'ON' : 'OFF'} /></div>
          <span className="hint" style={{ fontSize: 10, color: 'var(--tx-3)' }}>센서 튜닝은 운영 파라미터입니다. 모션 콘텐츠 제작은 「모션 제작」 탭에서 진행하세요.</span>
        </Panel>
      </div>
    </div>
  );
}

window.TabSensor = TabSensor;
window.CfgSlider = CfgSlider;
