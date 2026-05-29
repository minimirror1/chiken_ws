/* ============================================================
   tab-motion.jsx — 모션 제작 스튜디오 (타임라인+3D+캡처)
   ============================================================ */

// interpolate a pose at time t across keyframes
function fmtJointValue(v) {
  return Number(v).toFixed(1);
}

function poseAtTime(kfs, t) {
  if (!kfs.length) return { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 };
  if (t <= kfs[0].time_ms) return { ...kfs[0].joints };
  const last = kfs[kfs.length - 1];
  if (t >= last.time_ms) return { ...last.joints };
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].time_ms <= t) i++;
  const a = kfs[i], b = kfs[i + 1];
  const span = b.time_ms - a.time_ms || 1;
  const t01 = (t - a.time_ms) / span;
  const ease = (INTERP[a.interp] || INTERP.linear).ease;
  const e = ease(t01);
  const out = {};
  JOINT_IDS.forEach(id => { out[id] = a.joints[id] + (b.joints[id] - a.joints[id]) * e; });
  return out;
}

function verifyPattern(p) {
  const issues = [];
  const MAX_DEG_PER_S = 220;
  for (let i = 0; i < p.keyframes.length - 1; i++) {
    const a = p.keyframes[i], b = p.keyframes[i + 1];
    const dt = (b.time_ms - a.time_ms) / 1000;
    if (dt <= 0) { issues.push({ lv: 'err', msg: `키프레임 ${i + 1}→${i + 2}: 시간 역전 또는 0 (${a.time_ms}→${b.time_ms}ms)` }); continue; }
    JOINT_IDS.forEach(id => {
      const dDeg = Math.abs(valToDeg(id, b.joints[id]) - valToDeg(id, a.joints[id]));
      const speed = dDeg / dt;
      if (speed > MAX_DEG_PER_S) issues.push({ lv: 'warn', msg: `${id} ${i + 1}→${i + 2}: ${speed.toFixed(0)}°/s — 권장 ${MAX_DEG_PER_S}°/s 초과` });
    });
  }
  p.keyframes.forEach((k, i) => {
    JOINT_IDS.forEach(id => { if (isOverSoft(id, k.joints[id])) issues.push({ lv: 'warn', msg: `키프레임 ${i + 1}: ${id} 소프트 리밋 초과 (${valToDeg(id, k.joints[id]).toFixed(0)}°)` }); });
  });
  return issues;
}

function patternToYaml(p) {
  let y = `name: ${p.name}\n`;
  y += `id: ${p.id}\n`;
  y += `description: "${p.desc}"\n`;
  y += `default_interp: ${p.defaultInterp}\n`;
  y += `keyframes:\n`;
  p.keyframes.forEach(k => {
    y += `  - time_ms: ${k.time_ms}\n`;
    y += `    interp: ${k.interp}\n`;
    y += `    joints: { lower_yaw: ${k.joints.lower_yaw}, lower_pitch: ${k.joints.lower_pitch}, upper_yaw: ${k.joints.upper_yaw}, upper_pitch: ${k.joints.upper_pitch} }\n`;
  });
  return y;
}

function TabMotion() {
  const s = useStore();
  const p = Store.getPattern(s.editingPatternId) || s.patterns[0];
  const dur = Store.patternDuration(p);
  const [selId, setSelId] = React.useState(p.keyframes[0]?.id);
  const [t, setT] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [showYaml, setShowYaml] = React.useState(false);
  const [verifyRes, setVerifyRes] = React.useState(null);
  const [draggingKfId, setDraggingKfId] = React.useState(null);
  const [poseClipboard, setPoseClipboard] = React.useState(null);
  const [timelineHover, setTimelineHover] = React.useState(false);
  const rafRef = React.useRef();
  const playRef = React.useRef();
  const trackRef = React.useRef();
  const dragRef = React.useRef();
  const suppressClickRef = React.useRef(false);

  const sel = p.keyframes.find(k => k.id === selId) || p.keyframes[0];

  // playback loop
  React.useEffect(() => {
    if (!playing) return;
    let start = performance.now() - t;
    function step(now) {
      let cur = now - start;
      if (cur >= dur) { cur = dur; setPlaying(false); Store.set({ playing: false }); }
      setT(cur);
      Store.state.joints = poseAtTime(p.keyframes, cur);
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

  const scrub = (nt) => {
    setT(nt); setPlaying(false);
    Store.state.joints = poseAtTime(p.keyframes, nt); Store.emit();
  };
  const selectKf = (k) => {
    setSelId(k.id); scrub(k.time_ms);
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
  const stop = () => { setPlaying(false); Store.set({ playing: false, mode: 'stop' }); };

  const updateSel = (patch) => {
    const kfs = p.keyframes.map(k => k.id === sel.id ? { ...k, ...patch } : k).sort((a, b) => a.time_ms - b.time_ms);
    Store.updatePattern(p.id, { keyframes: kfs });
  };
  const updateKfTime = (id, time_ms) => {
    const kfs = p.keyframes.map(k => k.id === id ? { ...k, time_ms } : k).sort((a, b) => a.time_ms - b.time_ms);
    Store.updatePattern(p.id, { keyframes: kfs });
  };
  const resolveTimeSlot = (id, rawTime, span) => {
    const step = 50;
    const minGap = 30;
    const max = Math.max(0, Math.round(span));
    const base = Math.max(0, Math.min(max, Math.round(rawTime / step) * step));
    const used = p.keyframes.filter(k => k.id !== id).map(k => k.time_ms);
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
  const dragTimeFromPointer = (e) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || !track) return 0;
    const r = track.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    return resolveTimeSlot(drag.id, (x / Math.max(1, r.width)) * drag.duration, drag.duration);
  };
  const timeFromTrackClick = (e, span) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    return resolveTimeSlot(null, (x / Math.max(1, r.width)) * span, span);
  };
  const copyPose = (e, k, i) => {
    e.stopPropagation();
    setPoseClipboard({ sourceIndex: i + 1, sourceTime: k.time_ms, joints: { ...k.joints } });
    Store.pushLog('cmd', 'studio', `KF ${i + 1} 자세 복사 — 붙여넣을 타임라인 위치 선택`);
  };
  const pastePoseAt = (time_ms) => {
    if (!poseClipboard) return;
    const k = { id: 'k' + Math.random().toString(36).slice(2, 8), time_ms, joints: { ...poseClipboard.joints }, interp: p.defaultInterp };
    const kfs = [...p.keyframes, k].sort((a, b) => a.time_ms - b.time_ms);
    Store.updatePattern(p.id, { keyframes: kfs });
    setSelId(k.id);
    setT(k.time_ms);
    Store.state.joints = { ...k.joints }; Store.emit();
    Store.pushLog('ok', 'studio', `복사 자세 키프레임 생성 @ ${k.time_ms}ms`);
    setPoseClipboard(null);
  };
  const handleTimelineClick = (e) => {
    const nt = timeFromTrackClick(e, viewDur);
    if (poseClipboard) { pastePoseAt(nt); return; }
    scrub(nt);
  };
  const startKfDrag = (e, k) => {
    e.stopPropagation();
    if (playing) { setPlaying(false); Store.set({ playing: false }); }
    if (poseClipboard) setPoseClipboard(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: k.id, pointerId: e.pointerId, duration: Math.max(dur, k.time_ms, 1) };
    suppressClickRef.current = false;
    setDraggingKfId(k.id);
    setSelId(k.id);
    setT(k.time_ms);
    Store.state.joints = { ...k.joints }; Store.emit();
  };
  const moveKfDrag = (e, k) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== k.id || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    const nt = dragTimeFromPointer(e);
    if (nt === k.time_ms) return;
    suppressClickRef.current = true;
    updateKfTime(k.id, nt);
    setSelId(k.id);
    setT(nt);
    Store.state.joints = { ...k.joints }; Store.emit();
  };
  const endKfDrag = (e, k) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== k.id || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDraggingKfId(null);
  };
  const setSelJoint = (jid, v) => {
    v = Math.max(-100, Math.min(100, v));
    const joints = { ...sel.joints, [jid]: v };
    updateSel({ joints });
    Store.state.joints = joints; Store.emit();
  };
  const captureHere = () => {
    const k = { id: 'k' + Math.random().toString(36).slice(2, 8), time_ms: Math.round(t), joints: { ...Store.state.joints }, interp: p.defaultInterp };
    const kfs = [...p.keyframes.filter(x => Math.abs(x.time_ms - k.time_ms) > 30), k].sort((a, b) => a.time_ms - b.time_ms);
    Store.updatePattern(p.id, { keyframes: kfs });
    setSelId(k.id);
    Store.pushLog('ok', 'studio', `키프레임 캡처 @ ${k.time_ms}ms`);
  };
  const delKf = (k) => {
    if (p.keyframes.length <= 2) return;
    Store.updatePattern(p.id, { keyframes: p.keyframes.filter(x => x.id !== k.id) });
    if (selId === k.id) setSelId(p.keyframes[0].id);
  };
  const addPattern = () => {
    const id = 'pat_' + Math.random().toString(36).slice(2, 6);
    const np = { id, name: '새 패턴', desc: '', defaultInterp: 'ease_in_out',
      keyframes: [{ id: 'k0', time_ms: 0, joints: { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 }, interp: 'ease_in_out' },
                  { id: 'k1', time_ms: 1500, joints: { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 }, interp: 'ease_in_out' }] };
    Store.set({ patterns: [...s.patterns, np], editingPatternId: id });
    setSelId('k0'); setT(0);
  };

  const viewDur = Math.max(dur, draggingKfId && dragRef.current ? dragRef.current.duration : 0, 1);
  const ticks = [];
  const tickStep = viewDur > 4000 ? 1000 : 500;
  for (let tm = 0; tm <= viewDur; tm += tickStep) ticks.push(tm);
  const snapTicks = [];
  for (let tm = 0; tm <= viewDur; tm += 50) snapTicks.push(tm);
  const showSnapGrid = timelineHover || poseClipboard || draggingKfId;

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: 0 }}>

      {/* TOP TOOLBAR */}
      <div className="row center" style={{ gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--line-1)', background: 'var(--bg-1)', flexWrap: 'wrap' }}>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <label style={{ margin: 0 }}>패턴</label>
          <select className="ninput" style={{ width: 200 }} value={p.id} onChange={e => { Store.set({ editingPatternId: e.target.value }); const np = Store.getPattern(e.target.value); setSelId(np.keyframes[0]?.id); setT(0); setPoseClipboard(null); }}>
            {s.patterns.map(pp => <option key={pp.id} value={pp.id}>{pp.name}</option>)}
          </select>
        </div>
        <Btn kind="ghost" size="sm" icon="plus" onClick={addPattern}>새 패턴</Btn>
        <div className="vdiv"></div>
        <Btn kind="cy" size="sm" icon={playing ? 'pause' : 'play'} onClick={playPreview}>{playing ? '일시정지' : '미리보기'}</Btn>
        <Btn kind="solid" size="sm" icon="bolt" onClick={runReal}>실제 실행</Btn>
        <Btn kind="danger" size="sm" icon="stop" onClick={stop}>정지</Btn>
        <div className="vdiv"></div>
        <Btn size="sm" icon="check" onClick={() => setVerifyRes(verifyPattern(p))}>검증</Btn>
        <Btn kind="cy" size="sm" icon="save" onClick={() => Store.pushLog('ok', 'studio', `패턴 '${p.name}' 저장됨`)}>저장</Btn>
        <div className="row center" style={{ marginLeft: 'auto', gap: 14, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--tx-2)' }}>
          <span>t <b style={{ color: 'var(--cy)' }}>{(t / 1000).toFixed(2)}s</b> / {(dur / 1000).toFixed(2)}s</span>
          <span>{p.keyframes.length} keyframes</span>
        </div>
      </div>

      {/* BODY GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 290px', gap: 12, padding: 12, minHeight: 0 }}>

        {/* LEFT — timeline + keyframe list */}
        <div className="col" style={{ minHeight: 0 }}>
          <Panel title="키프레임" accent="KEYFRAMES" className="flex1" bodyClass="pad-0">
            <div className="scroll-y" style={{ height: '100%' }}>
              <div className="col gap8" style={{ padding: 10 }}>
                {p.keyframes.map((k, i) => (
                  <div key={k.id} className={`kf-item ${k.id === selId ? 'sel' : ''}`} onClick={() => selectKf(k)}>
                    <span className="ix">{String(i + 1).padStart(2, '0')}</span>
                    <div className="info">
                      <div className="tm">{k.time_ms} <span style={{ fontSize: 10, color: 'var(--tx-3)' }}>ms</span></div>
                      <div className="jv">{JOINT_IDS.map(id => fmtJointValue(k.joints[id])).join(' · ')} · {INTERP[k.interp].kr}</div>
                    </div>
                    <div className="row center" style={{ gap: 4 }}>
                      <button className="btn ghost sm" style={{ padding: '3px 6px' }} onClick={e => copyPose(e, k, i)} title="자세 복사"><Icon name="copy" /></button>
                      <button className="btn ghost sm" style={{ padding: '3px 6px' }} onClick={e => { e.stopPropagation(); delKf(k); }} title="삭제"><Icon name="trash" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* CENTER — 3D + sliders + timeline ruler */}
        <div className="col" style={{ minHeight: 0 }}>
          <Panel title="3D 뷰어" accent="STUDIO" ticked className="flex1" bodyClass="pad-0" sub="선택 키프레임 자세 표시">
            <ViewerFrame interactive warnLimits label={playing ? 'PREVIEW ▶' : `KF ${p.keyframes.indexOf(sel) + 1}`} />
          </Panel>

          {/* timeline */}
          <div className={`timeline ${poseClipboard ? 'paste-mode' : ''} ${showSnapGrid ? 'show-snap' : ''}`}
            onPointerEnter={() => setTimelineHover(true)}
            onPointerLeave={() => setTimelineHover(false)}>
            {poseClipboard && (
              <div className="tl-paste-overlay">
                <span>붙여넣을 시간 위치를 클릭하세요</span>
                <em>KF {String(poseClipboard.sourceIndex).padStart(2, '0')} @ {poseClipboard.sourceTime}ms · ESC 취소</em>
              </div>
            )}
            <div className="tl-ruler" onClick={handleTimelineClick}>
              {ticks.map(tm => (
                <div key={tm} className="tl-tick" style={{ left: (tm / viewDur) * 100 + '%' }}><span>{(tm / 1000).toFixed(tm % 1000 ? 1 : 0)}s</span></div>
              ))}
            </div>
            <div className="tl-track" ref={trackRef} onClick={handleTimelineClick}>
              <div className="tl-snap-grid">
                {snapTicks.map(tm => (
                  <span key={tm} className={`tl-snap ${tm % 500 === 0 ? 'major' : ''}`} style={{ left: (tm / viewDur) * 100 + '%' }}></span>
                ))}
              </div>
              {p.keyframes.map(k => (
                <div key={k.id} className={`tl-key ${k.id === selId ? 'sel' : ''} ${k.id === draggingKfId ? 'dragging' : ''}`} style={{ left: (k.time_ms / viewDur) * 100 + '%' }}
                  onPointerDown={e => startKfDrag(e, k)}
                  onPointerMove={e => moveKfDrag(e, k)}
                  onPointerUp={e => endKfDrag(e, k)}
                  onPointerCancel={e => endKfDrag(e, k)}
                  onClick={e => { e.stopPropagation(); if (suppressClickRef.current) { suppressClickRef.current = false; return; } selectKf(k); }} title={k.time_ms + 'ms'}></div>
              ))}
              <div className="tl-playhead" style={{ left: (t / viewDur) * 100 + '%' }}></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: 12 }}>
            <Panel title="캡처" accent="CAPTURE" bodyClass="col gap8">
              <button className="btn cy capture-btn" onClick={captureHere}>
                <Icon name="capture" />
                <span>현재 자세</span>
                <b>캡처</b>
                <em>{(t / 1000).toFixed(2)}s</em>
              </button>
              <span className="hint" style={{ fontSize: 10, color: 'var(--tx-3)' }}>3D에서 자세를 잡고 캡처하면 현재 재생 위치에 키프레임이 추가됩니다.</span>
            </Panel>

            {/* joint sliders for selected kf */}
            <Panel title={`키프레임 ${p.keyframes.indexOf(sel) + 1} 관절값`} accent="EDIT" bodyClass="col" style={{ gap: 0 }}>
              <div className="col" style={{ gap: 0 }}>
                {JOINT_IDS.map(id => <JointSlider key={id} jid={id} value={sel.joints[id]} onChange={setSelJoint} compact />)}
              </div>
            </Panel>
          </div>
        </div>

        {/* RIGHT — selected kf props + verify */}
        <div className="col" style={{ minHeight: 0 }}>
          <Panel title="선택 키프레임" accent="PROPS" bodyClass="col" style={{ gap: 12 }}>
            <div className="field">
              <label>시간 TIME_MS</label>
              <input className="ninput tnum" type="number" min="0" step="50" value={sel.time_ms} onChange={e => updateSel({ time_ms: parseInt(e.target.value || '0') })} />
            </div>
            <div className="field">
              <label>보간 방식 INTERP</label>
              <select className="ninput" value={sel.interp} onChange={e => updateSel({ interp: e.target.value })}>
                {Object.keys(INTERP).map(k => <option key={k} value={k}>{k} — {INTERP[k].kr}</option>)}
              </select>
              <span className="hint">이 키프레임에서 다음 키프레임으로 전환하는 방식</span>
            </div>
            <div className="hdiv"></div>
            {JOINT_IDS.map(id => <KV key={id} k={id} v={`${sel.joints[id]} · ${valToDeg(id, sel.joints[id]).toFixed(0)}°`} />)}
          </Panel>

          <Panel title="패턴 속성" accent="META" bodyClass="col" style={{ gap: 10 }}>
            <div className="field"><label>이름</label><input className="ninput" style={{ fontFamily: 'var(--kr)' }} value={p.name} onChange={e => Store.updatePattern(p.id, { name: e.target.value })} /></div>
            <div className="field"><label>설명</label><input className="ninput" style={{ fontFamily: 'var(--kr)' }} value={p.desc} placeholder="설명 입력…" onChange={e => Store.updatePattern(p.id, { desc: e.target.value })} /></div>
            <div className="field"><label>기본 보간</label>
              <select className="ninput" value={p.defaultInterp} onChange={e => Store.updatePattern(p.id, { defaultInterp: e.target.value })}>
                {Object.keys(INTERP).map(k => <option key={k} value={k}>{k} — {INTERP[k].kr}</option>)}
              </select>
            </div>
          </Panel>

          <Panel title="검증 결과" accent="VERIFY" className="flex1" bodyClass="scroll-y">
            {!verifyRes && <div style={{ color: 'var(--tx-3)', fontSize: 11, textAlign: 'center', padding: '14px 0' }}>「검증」을 눌러 속도·각도 안전성을 확인하세요.</div>}
            {verifyRes && verifyRes.length === 0 && <div className="row center" style={{ gap: 8, color: 'var(--ok)', fontSize: 12 }}><Icon name="check" />문제 없음 — 안전 범위 내</div>}
            {verifyRes && verifyRes.map((iss, i) => (
              <div key={i} className={`logline ${iss.lv}`} style={{ borderRadius: 3, marginBottom: 4 }}>
                <span className="lv">{LevelName(iss.lv)}</span><span className="msg">{iss.msg}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {/* YAML drawer */}
      <div style={{ borderTop: '1px solid var(--line-1)', background: 'var(--bg-1)' }}>
        <div className="row center between" style={{ padding: '7px 14px', cursor: 'pointer' }} onClick={() => setShowYaml(v => !v)}>
          <span className="mono up" style={{ fontSize: 10, color: 'var(--tx-2)' }}>▸ YAML 원문 {showYaml ? '접기' : '보기'}</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--tx-3)' }}>고급 편집용</span>
        </div>
        {showYaml && <div style={{ maxHeight: 180, overflow: 'auto', padding: '0 14px 12px' }}><pre className="yaml">{patternToYaml(p)}</pre></div>}
      </div>
    </div>
  );
}

window.TabMotion = TabMotion;
window.poseAtTime = poseAtTime;
window.patternToYaml = patternToYaml;
window.verifyPattern = verifyPattern;
