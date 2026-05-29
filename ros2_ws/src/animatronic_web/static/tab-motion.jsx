/* ============================================================
   tab-motion.jsx - 모션 제작 스튜디오 (축별 트랙 키프레임)
   ============================================================ */

function fmtJointValue(v) {
  return Number(v).toFixed(1);
}

function fmtTimelineTime(ms) {
  const safe = Math.max(0, Math.round(ms || 0));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
}

function newAxisKey(time_ms, value, tangentMode = 'auto') {
  return { id: 'ak' + Math.random().toString(36).slice(2, 8), time_ms: Math.round(time_ms), value, tangent: defaultTangent(tangentMode) };
}

function emptyTracks() {
  return Object.fromEntries(JOINT_IDS.map(id => [id, []]));
}

function sortedTrack(track) {
  return [...(track || [])].sort((a, b) => a.time_ms - b.time_ms);
}

function cloneTracks(tracks) {
  return Object.fromEntries(JOINT_IDS.map(id => [id, sortedTrack(tracks[id]).map(k => ({
    ...k,
    tangent: { in: { ...k.tangent.in }, out: { ...k.tangent.out }, broken: !!k.tangent.broken },
  }))]));
}

function trackKeyCount(p) {
  return JOINT_IDS.reduce((sum, id) => sum + sortedTrack(p.tracks[id]).length, 0);
}

function slotKey(time_ms) {
  return `slot-${Math.round(time_ms)}`;
}

function buildSlots(p) {
  const map = new Map();
  JOINT_IDS.forEach(jid => {
    sortedTrack(p.tracks[jid]).forEach(k => {
      if (!map.has(k.time_ms)) map.set(k.time_ms, { id: slotKey(k.time_ms), time_ms: k.time_ms, keys: {} });
      map.get(k.time_ms).keys[jid] = k;
    });
  });
  return [...map.values()].sort((a, b) => a.time_ms - b.time_ms);
}

function tangentMode(k, side) {
  return k.tangent?.[side]?.mode || 'auto';
}

function linearSlope(a, b) {
  return (b.value - a.value) / Math.max(1, b.time_ms - a.time_ms);
}

function autoSlope(keys, i) {
  const prev = keys[Math.max(0, i - 1)];
  const next = keys[Math.min(keys.length - 1, i + 1)];
  if (prev === next) return 0;
  return (next.value - prev.value) / Math.max(1, next.time_ms - prev.time_ms);
}

function slopeFor(keys, i, side) {
  const k = keys[i];
  const mode = tangentMode(k, side);
  if (mode === 'flat' || mode === 'step') return 0;
  if (mode === 'linear') {
    if (side === 'out' && keys[i + 1]) return linearSlope(k, keys[i + 1]);
    if (side === 'in' && keys[i - 1]) return linearSlope(keys[i - 1], k);
    return 0;
  }
  if (mode === 'manual') {
    const h = k.tangent[side];
    const dx = Math.max(1, h.dx || 120);
    return side === 'in' ? -(h.dy || 0) / dx : (h.dy || 0) / dx;
  }
  return autoSlope(keys, i);
}

function hermite(a, b, m0, m1, t01) {
  const dt = Math.max(1, b.time_ms - a.time_ms);
  const t2 = t01 * t01, t3 = t2 * t01;
  return (2 * t3 - 3 * t2 + 1) * a.value
    + (t3 - 2 * t2 + t01) * dt * m0
    + (-2 * t3 + 3 * t2) * b.value
    + (t3 - t2) * dt * m1;
}

function poseAtTime(p, t) {
  const out = {};
  JOINT_IDS.forEach(jid => {
    const keys = sortedTrack(p.tracks[jid]);
    if (!keys.length) { out[jid] = 0; return; }
    if (t <= keys[0].time_ms) { out[jid] = keys[0].value; return; }
    const last = keys[keys.length - 1];
    if (t >= last.time_ms) { out[jid] = last.value; return; }
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].time_ms <= t) i++;
    const a = keys[i], b = keys[i + 1];
    const span = b.time_ms - a.time_ms || 1;
    const t01 = (t - a.time_ms) / span;
    if (tangentMode(a, 'out') === 'step') { out[jid] = a.value; return; }
    out[jid] = Math.max(-100, Math.min(100, hermite(a, b, slopeFor(keys, i, 'out'), slopeFor(keys, i + 1, 'in'), t01)));
  });
  return out;
}

function verifyPattern(p) {
  const issues = [];
  const MAX_DEG_PER_S = 220;
  JOINT_IDS.forEach(jid => {
    const keys = sortedTrack(p.tracks[jid]);
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      const dt = (b.time_ms - a.time_ms) / 1000;
      if (dt <= 0) { issues.push({ lv: 'err', msg: `${jid} ${i + 1}->${i + 2}: 시간 역전 또는 0` }); continue; }
      const speed = Math.abs(valToDeg(jid, b.value) - valToDeg(jid, a.value)) / dt;
      if (speed > MAX_DEG_PER_S) issues.push({ lv: 'warn', msg: `${jid} ${i + 1}->${i + 2}: ${speed.toFixed(0)}deg/s - 권장 ${MAX_DEG_PER_S}deg/s 초과` });
    }
    keys.forEach((k, i) => {
      if (isOverSoft(jid, k.value)) issues.push({ lv: 'warn', msg: `${jid} 키 ${i + 1}: 소프트 리밋 초과 (${valToDeg(jid, k.value).toFixed(0)}deg)` });
    });
  });
  return issues;
}

function patternToYaml(p) {
  let y = `name: ${p.name}\n`;
  y += `id: ${p.id}\n`;
  y += `description: "${p.desc}"\n`;
  y += `tracks:\n`;
  JOINT_IDS.forEach(jid => {
    y += `  ${jid}:\n`;
    sortedTrack(p.tracks[jid]).forEach(k => {
      y += `    - time_ms: ${k.time_ms}\n`;
      y += `      value: ${k.value}\n`;
      y += `      tangent:\n`;
      y += `        in: { mode: ${tangentMode(k, 'in')}, dx: ${k.tangent.in.dx}, dy: ${k.tangent.in.dy} }\n`;
      y += `        out: { mode: ${tangentMode(k, 'out')}, dx: ${k.tangent.out.dx}, dy: ${k.tangent.out.dy} }\n`;
      y += `        broken: ${!!k.tangent.broken}\n`;
    });
  });
  return y;
}

const GRAPH_COLORS = {
  lower_yaw: '#00d1ff',
  lower_pitch: '#8fd14f',
  upper_yaw: '#ffb347',
  upper_pitch: '#ff6b9a',
};

function MotionGraphEditor({ p, t, viewDur, ticks, snapTicks, selTime, showSnapGrid, resolveAxisTime, pickJoints, setPickJoints, onSelectTime, onEditKey, onEditTangent, onPreset }) {
  const [lockTime, setLockTime] = React.useState(false);
  const [lockValue, setLockValue] = React.useState(false);
  const [visibleJoints, setVisibleJoints] = React.useState(() => Object.fromEntries(JOINT_IDS.map(id => [id, true])));
  const [hover, setHover] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [graphSize, setGraphSize] = React.useState({ w: 1000, h: 150 });
  const graphRef = React.useRef();
  const dragRef = React.useRef();
  const W = graphSize.w, H = graphSize.h, PAD = 14;
  const innerH = Math.max(1, H - PAD * 2);
  const sampleCount = Math.max(24, Math.min(180, Math.ceil(viewDur / 40)));
  const pickActive = JOINT_IDS.some(id => pickJoints[id]);
  const graphJoints = JOINT_IDS.filter(id => visibleJoints[id]);
  const pointJoints = [
    ...graphJoints.filter(id => pickActive && !pickJoints[id]),
    ...graphJoints.filter(id => !pickActive || pickJoints[id]),
  ];

  React.useEffect(() => {
    const el = graphRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => {
      const w = Math.max(1, Math.round(el.clientWidth || 1000));
      const h = Math.max(1, Math.round(el.clientHeight || 150));
      setGraphSize(prev => prev.w === w && prev.h === h ? prev : { w, h });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xFromTime = tm => (tm / viewDur) * W;
  const yFromValue = v => PAD + ((100 - Math.max(-100, Math.min(100, v))) / 200) * innerH;
  const valueFromY = y => Math.max(-100, Math.min(100, 100 - ((y - PAD) / innerH) * 200));
  const pointFromEvent = e => {
    const r = graphRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, ((e.clientX - r.left) / Math.max(1, r.width)) * W)),
      y: Math.max(0, Math.min(H, ((e.clientY - r.top) / Math.max(1, r.height)) * H)),
    };
  };
  const curvePath = jid => {
    let d = '';
    for (let i = 0; i <= sampleCount; i++) {
      const tm = (viewDur * i) / sampleCount;
      const pose = poseAtTime(p, tm);
      d += `${i ? 'L' : 'M'}${xFromTime(tm).toFixed(2)} ${yFromValue(pose[jid] || 0).toFixed(2)} `;
    }
    return d;
  };
  const selectedAxisKeys = pointJoints.flatMap(jid => sortedTrack(p.tracks[jid])
    .filter(k => k.time_ms === selTime && (!pickActive || pickJoints[jid]))
    .map(k => ({ jid, k, keys: sortedTrack(p.tracks[jid]), index: sortedTrack(p.tracks[jid]).findIndex(x => x.id === k.id) })));
  const handleFor = (keys, index, side) => {
    const k = keys[index];
    if (side === 'in' && index <= 0) return null;
    if (side === 'out' && index >= keys.length - 1) return null;
    const mode = tangentMode(k, side);
    if (mode === 'step' && side === 'out') return null;
    const neighbor = side === 'in' ? keys[index - 1] : keys[index + 1];
    const maxDx = Math.max(20, Math.min(600, Math.abs(neighbor.time_ms - k.time_ms) * 0.45));
    const dx = mode === 'manual' ? Math.max(20, Math.min(maxDx, k.tangent[side].dx || 120)) : maxDx;
    const slope = slopeFor(keys, index, side);
    const dy = side === 'in' ? -slope * dx : slope * dx;
    return {
      x: xFromTime(side === 'in' ? k.time_ms - dx : k.time_ms + dx),
      y: yFromValue(k.value + dy),
      dx,
      dy,
    };
  };
  const startDrag = (e, jid, k) => {
    e.stopPropagation();
    if (pickActive && !pickJoints[jid]) return;
    onSelectTime(k.time_ms);
    if (lockTime && lockValue) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: 'key', jid, id: k.id, pointerId: e.pointerId, time_ms: k.time_ms, value: k.value, duration: Math.max(viewDur, k.time_ms, 1) };
    setDragging(true);
  };
  const startHandleDrag = (e, jid, k, side) => {
    e.stopPropagation();
    onSelectTime(k.time_ms);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { type: 'handle', jid, id: k.id, side, pointerId: e.pointerId, time_ms: k.time_ms, value: k.value };
    setDragging(true);
  };
  const moveDrag = e => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const pt = pointFromEvent(e);
    if (drag.type === 'handle') {
      const rawDx = Math.abs(((pt.x / W) * viewDur) - drag.time_ms);
      const dx = Math.max(20, Math.min(600, rawDx));
      const valueAtHandle = valueFromY(pt.y);
      const dy = valueAtHandle - drag.value;
      onEditTangent(drag.jid, drag.id, drag.side, dx, dy);
      return;
    }
    const rawTime = (pt.x / W) * drag.duration;
    const time_ms = lockTime ? drag.time_ms : resolveAxisTime(drag.jid, drag.id, rawTime, drag.duration);
    const value = lockValue ? drag.value : Math.round(valueFromY(pt.y) * 10) / 10;
    onEditKey(drag.jid, drag.id, time_ms, value);
  };
  const endDrag = e => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };
  const toolDefs = [
    { icon: 'lockTime', title: '시간축 잠금', active: lockTime, onClick: () => setLockTime(v => !v) },
    { icon: 'lockValue', title: '모션축 잠금', active: lockValue, onClick: () => setLockValue(v => !v) },
    { icon: 'tangent', title: 'Auto tangent', onClick: () => onPreset('auto') },
    { icon: 'flat', title: 'Flat tangent', onClick: () => onPreset('flat') },
    { icon: 'frame', title: 'Linear tangent', onClick: () => onPreset('linear') },
    { icon: 'step', title: 'Stepped tangent', onClick: () => onPreset('step') },
    { icon: 'key', title: 'Break tangent', onClick: () => onPreset('break') },
  ];

  return (
    <div className="graph-wrap">
      <div className="graph-tools">
        <div className="graph-legend">
          {JOINTS.map(j => (
            <div key={j.id} className={`graph-legend-row ${visibleJoints[j.id] ? '' : 'muted'} ${pickJoints[j.id] ? 'pick' : ''}`}>
              <button className={`graph-mini ${visibleJoints[j.id] ? 'on' : ''}`} title={`${j.kr} 그래프 표시`} onClick={() => setVisibleJoints(v => ({ ...v, [j.id]: !v[j.id] }))}>
                <Icon name={visibleJoints[j.id] ? 'eye' : 'eyeOff'} />
              </button>
              <button className={`graph-mini ${pickJoints[j.id] ? 'on pick' : ''}`} title={`${j.kr} 선택 고정`} onClick={() => setPickJoints(v => ({ ...v, [j.id]: !v[j.id] }))}>
                <Icon name="select" />
              </button>
              <span><i style={{ background: GRAPH_COLORS[j.id] }}></i>{j.kr}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="graph-main">
        <div className="graph-toolbar" aria-label="Animation toolset">
          {toolDefs.map(tool => (
            <button key={tool.icon} className={`graph-tool ${tool.active ? 'on' : ''}`} title={tool.title} onClick={tool.onClick} disabled={tool.disabled}>
              <Icon name={tool.icon} />
            </button>
          ))}
        </div>
        <div ref={graphRef} className={`motion-graph ${showSnapGrid || hover || dragging ? 'show-snap' : ''}`} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
          <svg viewBox={`0 0 ${W} ${H}`}>
            <rect className="graph-bg" x="0" y="0" width={W} height={H} />
            {snapTicks.map(tm => (
              <line key={tm} className={`graph-snap ${tm % 500 === 0 ? 'major' : ''}`} x1={xFromTime(tm)} x2={xFromTime(tm)} y1="0" y2={H} />
            ))}
            {ticks.map(tm => (
              <g key={tm}>
                <line className="graph-tick" x1={xFromTime(tm)} x2={xFromTime(tm)} y1="0" y2={H} />
                <text className="graph-time" x={xFromTime(tm) + 5} y="12">{(tm / 1000).toFixed(tm % 1000 ? 1 : 0)}s</text>
              </g>
            ))}
            <line className="graph-limit" x1="0" x2={W} y1={yFromValue(100)} y2={yFromValue(100)} />
            <line className="graph-zero" x1="0" x2={W} y1={yFromValue(0)} y2={yFromValue(0)} />
            <line className="graph-limit" x1="0" x2={W} y1={yFromValue(-100)} y2={yFromValue(-100)} />
            {graphJoints.map(jid => (
              <path key={jid} className="graph-curve" d={curvePath(jid)} style={{ stroke: GRAPH_COLORS[jid] }} />
            ))}
            {pointJoints.map(jid => sortedTrack(p.tracks[jid]).map(k => (
              <circle key={`${jid}-${k.id}`} className={`graph-point ${k.time_ms === selTime ? 'sel' : ''} ${pickActive && !pickJoints[jid] ? 'locked' : ''}`} cx={xFromTime(k.time_ms)} cy={yFromValue(k.value)} r={k.time_ms === selTime ? 5 : 4}
                style={{ fill: GRAPH_COLORS[jid] }}
                onPointerDown={e => startDrag(e, jid, k)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}>
                <title>{`${jid} · ${k.time_ms}ms · ${fmtJointValue(k.value)}`}</title>
              </circle>
            )))}
            {selectedAxisKeys.map(({ jid, k, keys, index }) => ['in', 'out'].map(side => {
              const h = handleFor(keys, index, side);
              if (!h) return null;
              const x = xFromTime(k.time_ms), y = yFromValue(k.value);
              return (
                <g key={`${jid}-${k.id}-${side}`} className="graph-handle">
                  <line className="graph-handle-line" x1={x} y1={y} x2={h.x} y2={h.y} style={{ stroke: GRAPH_COLORS[jid] }} />
                  <circle className="graph-handle-dot" cx={h.x} cy={h.y} r="4"
                    style={{ fill: GRAPH_COLORS[jid] }}
                    onPointerDown={e => startHandleDrag(e, jid, k, side)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}>
                    <title>{`${jid} ${side} tangent`}</title>
                  </circle>
                </g>
              );
            }))}
            <line className="graph-playhead" x1={xFromTime(t)} x2={xFromTime(t)} y1="0" y2={H} />
          </svg>
        </div>
      </div>
    </div>
  );
}

function TabMotion() {
  const s = useStore();
  const p = Store.getPattern(s.editingPatternId) || s.patterns[0];
  const dur = Store.patternDuration(p);
  const slots = buildSlots(p);
  const [selTime, setSelTime] = React.useState(slots[0]?.time_ms || 0);
  const [t, setT] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [showYaml, setShowYaml] = React.useState(false);
  const [verifyRes, setVerifyRes] = React.useState(null);
  const [draggingKey, setDraggingKey] = React.useState(null);
  const [poseClipboard, setPoseClipboard] = React.useState(null);
  const [timelineHover, setTimelineHover] = React.useState(false);
  const [pickJoints, setPickJoints] = React.useState(() => Object.fromEntries(JOINT_IDS.map(id => [id, false])));
  const rafRef = React.useRef();
  const playRef = React.useRef();
  const axisTrackRefs = React.useRef({});
  const dragRef = React.useRef();
  const suppressClickRef = React.useRef(false);

  const selSlot = slots.find(sl => sl.time_ms === selTime) || slots[0];
  const selectedPose = poseAtTime(p, selSlot ? selSlot.time_ms : t);
  const editAxes = JOINT_IDS.filter(id => pickJoints[id]);
  const targetAxes = editAxes.length ? editAxes : JOINT_IDS;

  React.useEffect(() => {
    if (!slots.length) return;
    if (!slots.some(sl => sl.time_ms === selTime)) setSelTime(slots[0].time_ms);
  }, [p.id, slots.length]);

  React.useEffect(() => {
    if (!playing) return;
    let start = performance.now() - t;
    function step(now) {
      let cur = now - start;
      if (cur >= dur) { cur = dur; setPlaying(false); Store.set({ playing: false }); }
      setT(cur);
      Store.state.joints = poseAtTime(p, cur);
      Store.emit();
      if (cur < dur) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  React.useEffect(() => {
    if (!poseClipboard) return;
    const cancelPaste = (e) => {
      if (e.key !== 'Escape') return;
      setPoseClipboard(null);
      Store.pushLog('info', 'studio', '자세 복사 배치 취소');
    };
    window.addEventListener('keydown', cancelPaste);
    return () => window.removeEventListener('keydown', cancelPaste);
  }, [poseClipboard]);

  const updateTracks = (tracks, nextTime) => {
    Store.updatePattern(p.id, { tracks });
    if (nextTime !== undefined) {
      setSelTime(nextTime);
      setT(nextTime);
      Store.state.joints = poseAtTime({ ...p, tracks }, nextTime);
      Store.emit();
    }
  };
  const scrub = (nt) => {
    setT(nt); setPlaying(false);
    Store.state.joints = poseAtTime(p, nt); Store.emit();
  };
  const selectTime = (time_ms) => {
    setSelTime(time_ms);
    scrub(time_ms);
  };
  const playPreview = () => {
    if (playing) { setPlaying(false); Store.set({ playing: false }); return; }
    if (t >= dur) setT(0);
    Store.set({ playing: true, activePattern: p.id }); setPlaying(true);
    Store.pushLog('cmd', 'studio', `미리보기 재생: '${p.name}'`);
  };
  const runReal = () => {
    Store.set({ mode: 'test', activePattern: p.id });
    Store.pushLog('cmd', 'studio', `실제 모터 실행: '${p.name}' (mode=TEST)`);
    if (t >= dur) setT(0);
    Store.set({ playing: true }); setPlaying(true);
  };
  const confirmRunReal = () => {
    if (!window.confirm('모터가 움직입니다. 정말 실행하시겠습니까?')) return;
    runReal();
  };
  const stop = () => { setPlaying(false); Store.set({ playing: false, mode: 'stop' }); };
  const upsertAxisKey = (tracks, jid, key) => {
    const rest = sortedTrack(tracks[jid]).filter(k => k.id !== key.id && k.time_ms !== key.time_ms);
    return { ...tracks, [jid]: [...rest, key].sort((a, b) => a.time_ms - b.time_ms) };
  };
  const resolveAxisTime = (jid, id, rawTime, span) => {
    const step = 50;
    const minGap = 30;
    const max = Math.max(0, Math.round(span));
    const base = Math.max(0, Math.min(max, Math.round(rawTime / step) * step));
    const used = sortedTrack(p.tracks[jid]).filter(k => k.id !== id).map(k => k.time_ms);
    const ok = t0 => !used.some(t1 => Math.abs(t1 - t0) < minGap);
    if (ok(base)) return base;
    for (let offset = step; offset <= max + step; offset += step) {
      const left = base - offset;
      const right = base + offset;
      if (left >= 0 && ok(left)) return left;
      if (right <= max && ok(right)) return right;
    }
    return base;
  };
  const timeFromTrackClick = (e, span) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    return Math.max(0, Math.min(span, Math.round(((x / Math.max(1, r.width)) * span) / 50) * 50));
  };
  const copyPose = (e, sl, i) => {
    e.stopPropagation();
    setPoseClipboard({ sourceIndex: i + 1, sourceTime: sl.time_ms, joints: poseAtTime(p, sl.time_ms) });
    Store.pushLog('cmd', 'studio', `슬롯 ${i + 1} 자세 복사 - 붙여넣을 타임라인 위치 선택`);
  };
  const pastePoseAt = (time_ms) => {
    if (!poseClipboard) return;
    let tracks = cloneTracks(p.tracks);
    targetAxes.forEach(jid => {
      tracks = upsertAxisKey(tracks, jid, newAxisKey(time_ms, poseClipboard.joints[jid]));
    });
    updateTracks(tracks, time_ms);
    Store.pushLog('ok', 'studio', `복사 자세 ${targetAxes.length}축 키 생성 @ ${time_ms}ms`);
    setPoseClipboard(null);
  };
  const updateGraphKey = (jid, id, time_ms, value) => {
    if (playing) { setPlaying(false); Store.set({ playing: false }); }
    const tracks = cloneTracks(p.tracks);
    tracks[jid] = sortedTrack(tracks[jid]).map(k => k.id === id ? { ...k, time_ms, value } : k).sort((a, b) => a.time_ms - b.time_ms);
    updateTracks(tracks, time_ms);
  };
  const updateTangent = (jid, id, side, dx, dy) => {
    const tracks = cloneTracks(p.tracks);
    tracks[jid] = sortedTrack(tracks[jid]).map(k => {
      if (k.id !== id) return k;
      const tangent = { in: { ...k.tangent.in }, out: { ...k.tangent.out }, broken: !!k.tangent.broken };
      tangent[side] = { mode: 'manual', dx, dy };
      if (!tangent.broken) {
        const other = side === 'in' ? 'out' : 'in';
        tangent[other] = { mode: 'manual', dx, dy: -dy };
      }
      return { ...k, tangent };
    });
    updateTracks(tracks, selTime);
  };
  const applyTangentPreset = (mode) => {
    if (!selSlot) return;
    const axes = editAxes.length ? editAxes.filter(id => selSlot.keys[id]) : JOINT_IDS.filter(id => selSlot.keys[id]);
    if (!axes.length) return;
    const tracks = cloneTracks(p.tracks);
    axes.forEach(jid => {
      tracks[jid] = sortedTrack(tracks[jid]).map(k => {
        if (k.time_ms !== selSlot.time_ms) return k;
        if (mode === 'break') return { ...k, tangent: { in: { ...k.tangent.in }, out: { ...k.tangent.out }, broken: !k.tangent.broken } };
        return { ...k, tangent: defaultTangent(mode) };
      });
    });
    updateTracks(tracks, selSlot.time_ms);
    Store.pushLog('cmd', 'studio', `${axes.length}축 tangent ${mode} 적용 @ ${selSlot.time_ms}ms`);
  };
  const updateSlotTime = (fromTime, toTime) => {
    const tracks = cloneTracks(p.tracks);
    JOINT_IDS.forEach(jid => {
      tracks[jid] = sortedTrack(tracks[jid]).map(k => k.time_ms === fromTime ? { ...k, time_ms: resolveAxisTime(jid, k.id, toTime, Math.max(dur, toTime, 1)) } : k).sort((a, b) => a.time_ms - b.time_ms);
    });
    updateTracks(tracks, toTime);
  };
  const setSelJoint = (jid, v) => {
    v = Math.max(-100, Math.min(100, v));
    if (!selSlot || !selSlot.keys[jid]) return;
    const tracks = cloneTracks(p.tracks);
    tracks[jid] = sortedTrack(tracks[jid]).map(k => k.id === selSlot.keys[jid].id ? { ...k, value: v } : k);
    updateTracks(tracks, selSlot.time_ms);
  };
  const addAxisToSlot = (jid) => {
    if (!selSlot) return;
    let tracks = cloneTracks(p.tracks);
    tracks = upsertAxisKey(tracks, jid, newAxisKey(selSlot.time_ms, selectedPose[jid]));
    updateTracks(tracks, selSlot.time_ms);
  };
  const removeAxisFromSlot = (time_ms, jid) => {
    const slot = slots.find(sl => sl.time_ms === time_ms);
    if (!slot || Object.keys(slot.keys).length <= 1) return;
    const tracks = cloneTracks(p.tracks);
    tracks[jid] = sortedTrack(tracks[jid]).filter(k => k.id !== slot.keys[jid]?.id);
    updateTracks(tracks, time_ms);
  };
  const captureHere = () => {
    let tracks = cloneTracks(p.tracks);
    targetAxes.forEach(jid => {
      tracks = upsertAxisKey(tracks, jid, newAxisKey(Math.round(t), Store.state.joints[jid]));
    });
    updateTracks(tracks, Math.round(t));
    Store.pushLog('ok', 'studio', `현재 자세 ${targetAxes.length}축 캡처 @ ${Math.round(t)}ms`);
  };
  const delSlot = (sl) => {
    if (slots.length <= 1) return;
    const tracks = cloneTracks(p.tracks);
    JOINT_IDS.forEach(jid => { tracks[jid] = sortedTrack(tracks[jid]).filter(k => k.time_ms !== sl.time_ms); });
    const next = slots.find(x => x.time_ms !== sl.time_ms)?.time_ms || 0;
    updateTracks(tracks, next);
  };
  const addPattern = () => {
    const id = 'pat_' + Math.random().toString(36).slice(2, 6);
    const tracks = emptyTracks();
    JOINT_IDS.forEach(jid => {
      tracks[jid] = [newAxisKey(0, 0), newAxisKey(1500, 0)];
    });
    Store.set({ patterns: [...s.patterns, { id, name: '새 패턴', desc: '', tracks }], editingPatternId: id });
    setSelTime(0); setT(0); setPoseClipboard(null);
  };
  const startAxisDrag = (e, jid, k) => {
    e.stopPropagation();
    if (playing) { setPlaying(false); Store.set({ playing: false }); }
    if (poseClipboard) setPoseClipboard(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { jid, id: k.id, pointerId: e.pointerId, duration: Math.max(dur, k.time_ms, 1) };
    suppressClickRef.current = false;
    setDraggingKey(k.id);
    setSelTime(k.time_ms);
    setT(k.time_ms);
    Store.state.joints = poseAtTime(p, k.time_ms); Store.emit();
  };
  const moveAxisDrag = (e, jid, k) => {
    const drag = dragRef.current;
    const track = axisTrackRefs.current[jid];
    if (!drag || drag.id !== k.id || drag.pointerId !== e.pointerId || !track) return;
    e.preventDefault();
    const r = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const nt = resolveAxisTime(jid, k.id, (x / Math.max(1, r.width)) * drag.duration, drag.duration);
    if (nt === k.time_ms) return;
    suppressClickRef.current = true;
    updateGraphKey(jid, k.id, nt, k.value);
  };
  const endAxisDrag = (e, k) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== k.id || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDraggingKey(null);
  };

  const viewDur = Math.max(dur, draggingKey && dragRef.current ? dragRef.current.duration : 0, 1);
  const ticks = [];
  const tickStep = viewDur > 4000 ? 1000 : 500;
  for (let tm = 0; tm <= viewDur; tm += tickStep) ticks.push(tm);
  const snapTicks = [];
  for (let tm = 0; tm <= viewDur; tm += 50) snapTicks.push(tm);
  const showSnapGrid = timelineHover || poseClipboard || draggingKey;

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: '1fr', minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 300px 1fr', gap: 12, padding: 12, minHeight: 0 }}>
        <div className="col" style={{ minHeight: 0 }}>
          <Panel title="모션 제어" accent="CONTROL" bodyClass="col motion-control" style={{ gap: 10 }}>
            <div className="field">
              <label>패턴</label>
              <select className="ninput" value={p.id} onChange={e => { Store.set({ editingPatternId: e.target.value }); const np = Store.getPattern(e.target.value); const ns = buildSlots(np); setSelTime(ns[0]?.time_ms || 0); setT(0); setPoseClipboard(null); }}>
                {s.patterns.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
              </select>
            </div>
            <Btn kind="ghost" size="sm" icon="plus" onClick={addPattern}>새 패턴</Btn>
            <div className="motion-control-grid">
              <Btn size="sm" icon="check" onClick={() => setVerifyRes(verifyPattern(p))}>검증</Btn>
              <Btn kind="cy" size="sm" icon="save" onClick={() => Store.pushLog('ok', 'studio', `패턴 '${p.name}' 저장됨`)}>저장</Btn>
            </div>
            <div className="motion-control-meta">
              <span>t <b>{(t / 1000).toFixed(2)}s</b> / {(dur / 1000).toFixed(2)}s</span>
              <span>{trackKeyCount(p)} axis keys</span>
            </div>
          </Panel>

          <Panel title="패턴 속성" accent="META" bodyClass="col" style={{ gap: 10 }}>
            <div className="field"><label>이름</label><input className="ninput" style={{ fontFamily: 'var(--kr)' }} value={p.name} onChange={e => Store.updatePattern(p.id, { name: e.target.value })} /></div>
            <div className="field"><label>설명</label><input className="ninput" style={{ fontFamily: 'var(--kr)' }} value={p.desc} placeholder="설명 입력..." onChange={e => Store.updatePattern(p.id, { desc: e.target.value })} /></div>
            <button className="yaml-toggle" onClick={() => setShowYaml(v => !v)}>YAML 원문 {showYaml ? '접기' : '보기'}</button>
            {showYaml && <pre className="yaml motion-yaml">{patternToYaml(p)}</pre>}
          </Panel>

          <Panel title="검증 결과" accent="VERIFY" className="flex1" bodyClass="scroll-y">
            {!verifyRes && <div style={{ color: 'var(--tx-3)', fontSize: 11, textAlign: 'center', padding: '14px 0' }}>「검증」을 눌러 속도·각도 안전성을 확인하세요.</div>}
            {verifyRes && verifyRes.length === 0 && <div className="row center" style={{ gap: 8, color: 'var(--ok)', fontSize: 12 }}><Icon name="check" />문제 없음 - 안전 범위 내</div>}
            {verifyRes && verifyRes.map((iss, i) => (
              <div key={i} className={`logline ${iss.lv}`} style={{ borderRadius: 3, marginBottom: 4 }}>
                <span className="lv">{LevelName(iss.lv)}</span><span className="msg">{iss.msg}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div className="col" style={{ minHeight: 0 }}>
          <Panel title="실행" accent="RUN" bodyClass="keyframe-run">
            <Btn kind="cy" size="sm" icon={playing ? 'pause' : 'play'} onClick={playPreview}>{playing ? '일시정지' : '미리보기'}</Btn>
            <Btn kind="danger" size="sm" icon="stop" onClick={stop}>정지</Btn>
            <Btn kind="solid" size="sm" icon="bolt" onClick={confirmRunReal}>실제 실행</Btn>
          </Panel>

          <Panel title="키프레임 슬롯" accent="KEYFRAMES" className="flex1" bodyClass="pad-0">
            <div className="scroll-y" style={{ height: '100%' }}>
              <div className="col gap8" style={{ padding: 10 }}>
                {slots.map((sl, i) => (
                  <div key={sl.id} className={`kf-item ${sl.time_ms === selTime ? 'sel' : ''}`} onClick={() => selectTime(sl.time_ms)}>
                    <span className="ix">{String(i + 1).padStart(2, '0')}</span>
                    <div className="info">
                      <div className="tm">{sl.time_ms} <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>ms</span></div>
                      <div className="axis-chip-row">
                        {JOINT_IDS.filter(id => sl.keys[id]).map(id => (
                          <button key={id} className="axis-chip" style={{ color: GRAPH_COLORS[id] }} onClick={e => { e.stopPropagation(); removeAxisFromSlot(sl.time_ms, id); }} disabled={Object.keys(sl.keys).length <= 1} title={`${id} 축 키 삭제`}>
                            <i style={{ background: GRAPH_COLORS[id] }}></i>{id.replace('_', '.')}<Icon name="trash" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="row center" style={{ gap: 4 }}>
                      <button className="btn ghost sm" style={{ padding: '3px 6px' }} onClick={e => copyPose(e, sl, i)} title="자세 복사"><Icon name="copy" /></button>
                      <button className="btn ghost sm" style={{ padding: '3px 6px' }} onClick={e => { e.stopPropagation(); delSlot(sl); }} title="슬롯 삭제"><Icon name="trash" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div style={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) minmax(250px, 1fr)', gap: 12, minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12, minHeight: 0 }}>
            <Panel title="3D 뷰어" accent="STUDIO" ticked className="flex1" bodyClass="pad-0" sub="선택 시간 자세 표시">
              <ViewerFrame interactive warnLimits label={playing ? 'PREVIEW' : `TIME ${fmtTimelineTime(selSlot?.time_ms || 0)}`} />
            </Panel>

            <div className="col" style={{ minHeight: 0 }}>
              <Panel title="선택 슬롯 관절값" accent="EDIT" className="flex1" bodyClass="col" style={{ gap: 0 }}>
                <div className="col" style={{ gap: 0 }}>
                  {JOINT_IDS.map(id => selSlot?.keys[id]
                    ? <JointSlider key={id} jid={id} value={selSlot.keys[id].value} onChange={setSelJoint} compact />
                    : <div key={id} className="missing-axis-key">
                        <div><b>{id}</b><span>{fmtJointValue(selectedPose[id])} · 보간값</span></div>
                        <button className="btn ghost sm" onClick={() => addAxisToSlot(id)}><Icon name="plus" />키</button>
                      </div>
                  )}
                </div>
              </Panel>

              <div style={{ display: 'grid', gridTemplateColumns: '3fr 7fr', gap: 12 }}>
                <Panel title="캡처" accent="CAPTURE" bodyClass="capture-body col gap8">
                  <button className="btn cy capture-btn" onClick={captureHere}>
                    <Icon name="capture" />
                    <span>현재 자세</span>
                    <b>캡처</b>
                    <em>{(t / 1000).toFixed(2)}s</em>
                  </button>
                  <div className="tl-timebox capture-timebox">
                    <span className="total">{fmtTimelineTime(dur)}</span>
                    <span className="selected">{fmtTimelineTime(t)}</span>
                  </div>
                </Panel>

                <Panel title="선택 키프레임" accent="PROPS" bodyClass="col" style={{ gap: 12 }}>
                  <div className="field">
                    <label>시간 TIME_MS</label>
                    <input className="ninput tnum" type="number" min="0" step="50" value={selSlot?.time_ms || 0} onChange={e => updateSlotTime(selSlot?.time_ms || 0, parseInt(e.target.value || '0'))} />
                  </div>
                  <div className="field">
                    <label>포함 축</label>
                    <div className="axis-chip-row static">
                      {JOINT_IDS.filter(id => selSlot?.keys[id]).map(id => <span key={id} className="axis-chip text" style={{ color: GRAPH_COLORS[id] }}><i style={{ background: GRAPH_COLORS[id] }}></i>{id.replace('_', '.')} · {tangentMode(selSlot.keys[id], 'out')}</span>)}
                    </div>
                  </div>
                </Panel>
              </div>
            </div>
          </div>

          <div className="motion-lower">
            <div className="timeline-wrap axis-mode">
              <div className={`timeline ${poseClipboard ? 'paste-mode' : ''} ${showSnapGrid ? 'show-snap' : ''}`}
                onPointerEnter={() => setTimelineHover(true)}
                onPointerLeave={() => setTimelineHover(false)}>
                {poseClipboard && (
                  <div className="tl-paste-overlay">
                    <span>붙여넣을 시간 위치를 클릭하세요</span>
                    <em>슬롯 {String(poseClipboard.sourceIndex).padStart(2, '0')} @ {poseClipboard.sourceTime}ms · ESC 취소</em>
                  </div>
                )}
                <div className="tl-ruler" onClick={e => { const nt = timeFromTrackClick(e, viewDur); if (poseClipboard) pastePoseAt(nt); else scrub(nt); }}>
                  {ticks.map(tm => (
                    <div key={tm} className="tl-tick" style={{ left: (tm / viewDur) * 100 + '%' }}><span>{(tm / 1000).toFixed(tm % 1000 ? 1 : 0)}s</span></div>
                  ))}
                </div>
                <div className="axis-timeline">
                  {JOINTS.map(j => (
                    <div key={j.id} className="axis-track-row">
                      <div className="axis-track-label" style={{ color: GRAPH_COLORS[j.id] }}>{j.kr}</div>
                      <div className="axis-track" ref={el => { axisTrackRefs.current[j.id] = el; }} onClick={e => { const nt = timeFromTrackClick(e, viewDur); if (poseClipboard) pastePoseAt(nt); else scrub(nt); }}>
                        <div className="tl-snap-grid">
                          {snapTicks.map(tm => (
                            <span key={tm} className={`tl-snap ${tm % 500 === 0 ? 'major' : ''}`} style={{ left: (tm / viewDur) * 100 + '%' }}></span>
                          ))}
                        </div>
                        {sortedTrack(p.tracks[j.id]).map(k => (
                          <div key={k.id} className={`tl-key axis-key ${k.time_ms === selTime ? 'sel' : ''} ${k.id === draggingKey ? 'dragging' : ''}`} style={{ left: (k.time_ms / viewDur) * 100 + '%', borderColor: GRAPH_COLORS[j.id] }}
                            onPointerDown={e => startAxisDrag(e, j.id, k)}
                            onPointerMove={e => moveAxisDrag(e, j.id, k)}
                            onPointerUp={e => endAxisDrag(e, k)}
                            onPointerCancel={e => endAxisDrag(e, k)}
                            onClick={e => { e.stopPropagation(); if (suppressClickRef.current) { suppressClickRef.current = false; return; } selectTime(k.time_ms); }} title={`${j.id} ${k.time_ms}ms`}></div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="tl-playhead" style={{ left: `calc(114px + (100% - 114px) * ${t / viewDur})` }}></div>
                </div>
              </div>
            </div>
            <MotionGraphEditor p={p} t={t} viewDur={viewDur} ticks={ticks} snapTicks={snapTicks} selTime={selTime} showSnapGrid={showSnapGrid}
              resolveAxisTime={resolveAxisTime} pickJoints={pickJoints} setPickJoints={setPickJoints} onSelectTime={selectTime} onEditKey={updateGraphKey}
              onEditTangent={updateTangent} onPreset={applyTangentPreset} />
          </div>
        </div>
      </div>
    </div>
  );
}

window.TabMotion = TabMotion;
window.poseAtTime = poseAtTime;
window.patternToYaml = patternToYaml;
window.verifyPattern = verifyPattern;
