/* ============================================================
   tab-settings.jsx — 설정
   ============================================================ */

function TabSettings() {
  const s = useStore();
  const st = s.settings;
  const set = (patch) => Store.set({ settings: { ...st, ...patch } });

  return (
    <div className="pad" style={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignContent: 'start', gridAutoRows: 'min-content' }}>

      <Panel title="장치" accent="DEVICE" bodyClass="col" style={{ gap: 12 }}>
        <div className="field"><label>장치 이름</label><input className="ninput" value={st.deviceName} onChange={e => set({ deviceName: e.target.value })} /></div>
        <div className="field"><label>ROS_DOMAIN_ID</label><input className="ninput tnum" type="number" value={st.rosDomain} onChange={e => set({ rosDomain: parseInt(e.target.value || '0') })} /></div>
        <KV k="펌웨어" v="coop-fw 2.4.1" />
        <KV k="컨트롤러" v="Raspberry Pi 5" />
        <KV k="모터 버스" v="RS-485 · 1 Mbps" />
      </Panel>

      <Panel title="안전 한계" accent="SAFETY" bodyClass="col" style={{ gap: 4 }}>
        <CfgSlider label="최대 속도" en="max_speed" value={st.maxSpeed} min={10} max={100} step={5} unit="%" onChange={v => set({ maxSpeed: v })} />
        <CfgSlider label="가속 제한" en="accel_limit" value={st.accelLimit} min={10} max={100} step={5} unit="%" onChange={v => set({ accelLimit: v })} />
        <div className="kv" style={{ paddingTop: 8 }}><span className="k">소프트 리밋 보호</span><Toggle on={st.softLimitEnabled} onChange={v => set({ softLimitEnabled: v })} label={st.softLimitEnabled ? '활성' : '해제'} /></div>
        <span className="hint" style={{ fontSize: 10, color: 'var(--tx-3)' }}>관절별 소프트 리밋: {JOINTS.map(j => j.soft + '°').join(' / ')}</span>
      </Panel>

      <Panel title="운영" accent="OPERATION" bodyClass="col" style={{ gap: 4 }}>
        <div className="kv"><span className="k">시작 시 기준 자세 복귀</span><Toggle on={st.autoHome} onChange={v => set({ autoHome: v })} label={st.autoHome ? 'ON' : 'OFF'} /></div>
        <CfgSlider label="유휴 타임아웃" en="idle_timeout" value={st.idleTimeoutMin} min={1} max={30} step={1} unit="분" onChange={v => set({ idleTimeoutMin: v })} />
        <CfgSlider label="로그 보관" en="log_retain" value={st.logRetain} min={500} max={5000} step={500} unit="줄" onChange={v => set({ logRetain: v })} />
      </Panel>

      <Panel title="관절 한계 정의" accent="LIMITS" className="" style={{ gridColumn: 'span 2' }} bodyClass="pad-0">
        <table className="tbl">
          <thead><tr><th>JOINT</th><th>축</th><th className="num">물리 최대</th><th className="num">소프트 리밋</th><th className="num">RAW 중심</th><th className="num">RAW 범위</th></tr></thead>
          <tbody>
            {JOINTS.map(j => (
              <tr key={j.id}>
                <td className="name" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{j.id}</td>
                <td>{j.axis.toUpperCase()} ({j.kr})</td>
                <td className="num">±{j.max}°</td>
                <td className="num" style={{ color: 'var(--warn)' }}>±{j.soft}°</td>
                <td className="num">2048</td>
                <td className="num" style={{ color: 'var(--tx-3)' }}>{valToRaw(j.id, -100)} – {valToRaw(j.id, 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="정보" accent="ABOUT" bodyClass="col" style={{ gap: 6 }}>
        <KV k="콘솔" v="COOP Console v1.0" />
        <KV k="가동 시간" v={Math.floor((Date.now() - s.uptimeStart) / 60000) + ' 분'} />
        <KV k="모드" v={ModeName(s.mode)} />
        <div className="btn-row" style={{ marginTop: 6 }}>
          <Btn kind="ghost" size="sm" icon="refresh">재연결</Btn>
          <Btn kind="danger" size="sm" icon="power">시스템 종료</Btn>
        </div>
      </Panel>
    </div>
  );
}

window.TabSettings = TabSettings;
