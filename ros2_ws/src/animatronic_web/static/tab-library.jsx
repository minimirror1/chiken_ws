/* ============================================================
   tab-library.jsx — 패턴 라이브러리
   ============================================================ */

function TabLibrary() {
  const s = useStore();
  const [selId, setSelId] = React.useState(s.patterns[0].id);
  const [showYaml, setShowYaml] = React.useState(false);
  const sel = Store.getPattern(selId) || s.patterns[0];
  const previewRef = React.useRef({ lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 });

  // loop preview of selected pattern in the small viewer (independent of live pose)
  React.useEffect(() => {
    let raf, start = performance.now();
    const dur = Store.patternDuration(sel) || 1;
    function step(now) {
      const tt = (now - start) % (dur + 700);
      previewRef.current = poseAtTime(sel, Math.min(tt, dur));
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selId, sel.tracks]);

  const runIt = (pid) => {
    const p = Store.getPattern(pid);
    Store.set({ mode: 'test', activePattern: pid, playing: true });
    Store.pushLog('cmd', 'library', `패턴 '${p.name}' 즉시 실행`);
    setTimeout(() => Store.set({ playing: false }), Store.patternDuration(p));
  };
  const dupIt = (pid) => {
    const p = Store.getPattern(pid);
    const id = p.id + '_copy';
    const tracks = Object.fromEntries(JOINT_IDS.map(jid => [jid, (p.tracks[jid] || []).map(k => ({ ...k, id: 'ak' + Math.random().toString(36).slice(2, 8) }))]));
    const np = { ...p, id: id + Math.random().toString(36).slice(2, 4), name: p.name + ' (복사본)', tracks };
    Store.set({ patterns: [...s.patterns, np] });
    Store.pushLog('ok', 'library', `'${p.name}' 복사됨`);
  };
  const delIt = (pid) => {
    if (s.patterns.length <= 1) return;
    Store.set({ patterns: s.patterns.filter(p => p.id !== pid) });
    if (selId === pid) setSelId(s.patterns.find(p => p.id !== pid).id);
    Store.pushLog('warn', 'library', `패턴 삭제됨: ${pid}`);
  };

  return (
    <div className="pad" style={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 12, gridTemplateRows: '100%' }}>

      {/* LEFT — table */}
      <Panel title="패턴 목록" accent="LIBRARY" ticked bodyClass="pad-0"
        right={<div className="btn-row"><Btn kind="ghost" size="sm" icon="upload">가져오기</Btn><Btn kind="ghost" size="sm" icon="download">내보내기</Btn></div>}>
        <div className="scroll-y" style={{ height: '100%' }}>
          <table className="tbl">
            <thead><tr><th>이름</th><th>설명</th><th className="num">길이</th><th className="num">축 키</th><th>Tangent</th><th className="num">수정</th><th></th></tr></thead>
            <tbody>
              {s.patterns.map(p => (
                <tr key={p.id} onClick={() => setSelId(p.id)} style={{ cursor: 'pointer', background: p.id === selId ? 'var(--cy-dim)' : null }}>
                  <td className="name" style={{ color: p.id === selId ? 'var(--cy)' : 'var(--tx-0)' }}>{p.name}</td>
                  <td style={{ fontFamily: 'var(--kr)', color: 'var(--tx-2)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.desc || '—'}</td>
                  <td className="num">{(Store.patternDuration(p) / 1000).toFixed(1)}s</td>
                  <td className="num">{Store.trackKeyCount(p)}</td>
                  <td style={{ fontSize: 10 }}>Curve</td>
                  <td className="num" style={{ fontSize: 10, color: 'var(--tx-3)' }}>방금</td>
                  <td><div className="row gap8">
                    <button className="btn solid sm" style={{ padding: '3px 8px' }} onClick={e => { e.stopPropagation(); runIt(p.id); }}><Icon name="bolt" /></button>
                    <button className="btn ghost sm" style={{ padding: '3px 6px' }} onClick={e => { e.stopPropagation(); dupIt(p.id); }}><Icon name="copy" /></button>
                    <button className="btn ghost sm" style={{ padding: '3px 6px' }} onClick={e => { e.stopPropagation(); delIt(p.id); }}><Icon name="trash" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* RIGHT — preview + detail */}
      <div className="col" style={{ minHeight: 0 }}>
        <Panel title="미리보기" accent="PREVIEW" ticked className="flex1" bodyClass="pad-0" sub={sel.name}>
          <ViewerFrame getJoints={() => previewRef.current} interactive={false} autoRotate warnLimits={false} label="LOOP ▶" />
        </Panel>
        <Panel title="상세" accent="DETAIL" bodyClass="col" style={{ gap: 8 }}>
          <div className="row between center">
            <Stat k="이름" v={sel.name} kind="cy" />
            <Badge>{sel.id}</Badge>
          </div>
          <div style={{ fontSize: 11, color: 'var(--tx-2)', fontFamily: 'var(--kr)' }}>{sel.desc || '설명 없음'}</div>
          <div className="hdiv"></div>
          <div className="row" style={{ gap: 18 }}>
            <Stat k="길이" v={(Store.patternDuration(sel) / 1000).toFixed(1)} unit="s" />
            <Stat k="축 키" v={Store.trackKeyCount(sel)} unit="개" />
            <Stat k="커브" v="Tangent" />
          </div>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <Btn kind="solid" icon="bolt" onClick={() => runIt(sel.id)}>바로 실행</Btn>
            <Btn kind="cy" icon="play" onClick={() => { Store.set({ editingPatternId: sel.id }); window.__goTab && window.__goTab('motion'); }}>스튜디오 편집</Btn>
          </div>
          <div className="row center between" style={{ cursor: 'pointer', marginTop: 4 }} onClick={() => setShowYaml(v => !v)}>
            <span className="mono up" style={{ fontSize: 10, color: 'var(--tx-3)' }}>▸ YAML {showYaml ? '접기' : '보기'}</span>
          </div>
          {showYaml && <pre className="yaml" style={{ maxHeight: 140, fontSize: 10 }}>{patternToYaml(sel)}</pre>}
        </Panel>
      </div>
    </div>
  );
}

window.TabLibrary = TabLibrary;
