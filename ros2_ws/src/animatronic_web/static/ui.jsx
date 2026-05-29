/* ============================================================
   ui.jsx — 공용 UI 프리미티브
   ============================================================ */

// ---- icons (stroke, 16x16) ----
const ICONS = {
  stop: 'M5 5h10v10H5z',
  home: 'M3 9l7-6 7 6M5 8v8h10V8',
  play: 'M6 4l10 6-10 6z',
  pause: 'M6 4h3v12H6zM11 4h3v12h-3z',
  capture: 'M4 6h3l1-2h4l1 2h3v9H4zM10 13a3 3 0 100-6 3 3 0 000 6z',
  power: 'M10 3v7M5.5 6a6 6 0 109 0',
  save: 'M4 4h9l3 3v9H4zM7 4v4h6M7 16v-5h6v5',
  plus: 'M10 4v12M4 10h12',
  copy: 'M7 7h8v8H7zM5 12V4h8',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10',
  check: 'M4 10l4 4 8-9',
  warn: 'M10 3l8 14H2zM10 8v4M10 14.5v.5',
  refresh: 'M16 6a7 7 0 10.9 6M16 3v3h-3',
  download: 'M10 3v9m-4-4l4 4 4-4M4 16h12',
  upload: 'M10 13V4m-4 4l4-4 4 4M4 16h12',
  arrowR: 'M5 10h10m-4-4l4 4-4 4',
  bolt: 'M11 3L5 11h4l-1 6 6-8h-4z',
  eye: 'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z M10 12a2 2 0 100-4 2 2 0 000 4z',
};
function Icon({ name, className }) {
  const d = ICONS[name];
  return (
    <svg className={'ic ' + (className || '')} viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Dot({ kind = '', pulse }) {
  return <span className={`dot ${kind} ${pulse ? 'pulse' : ''}`}></span>;
}

function Badge({ kind = '', children }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

function Panel({ title, accent, sub, right, ticked, children, bodyClass = '', className = '', style }) {
  return (
    <div className={`panel ${ticked ? 'ticked' : ''} ${className}`} style={style}>
      {title && (
        <div className="panel-h">
          <span className="ti">{accent ? <em>{accent}</em> : null}{accent ? ' ' : ''}{title}</span>
          {sub && <span className="sub">{sub}</span>}
          {right && <span className="right">{right}</span>}
        </div>
      )}
      <div className={`panel-b ${bodyClass}`}>{children}</div>
    </div>
  );
}

function Btn({ kind = '', size = '', icon, iconR, onClick, disabled, block, children, title }) {
  return (
    <button className={`btn ${kind} ${size} ${block ? 'block' : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} />}
      {children}
      {iconR && <Icon name={iconR} />}
    </button>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <div className={`tgl ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="sw"></span>
      {label && <span className="lab">{label}</span>}
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div className="seg-ctrl">
      {options.map(o => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function Stat({ k, v, unit, kind = '', sub }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className={`v ${kind}`}>{v}{unit && <small>{unit}</small>}</span>
      {sub && <span className="k" style={{ color: 'var(--tx-2)', textTransform: 'none', letterSpacing: 0 }}>{sub}</span>}
    </div>
  );
}

function KV({ k, v, mono = true }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v" style={mono ? null : { fontFamily: 'var(--kr)' }}>{v}</span>
    </div>
  );
}

function MBar({ value, max = 100, kind }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = kind || (pct > 85 ? 'err' : pct > 65 ? 'warn' : '');
  return <div className={`mbar ${auto}`}><i style={{ width: pct + '%' }}></i></div>;
}

// ---- joint slider (shared control) ----
function JointSlider({ jid, value, onChange, compact }) {
  const j = JOINTS.find(x => x.id === jid);
  const deg = valToDeg(jid, value);
  const raw = valToRaw(jid, value);
  const over = isOverSoft(jid, value);
  const pct = (value + 100) / 2; // 0..100 for gradient
  return (
    <div className={`jslider ${over ? 'warnlimit' : ''}`} style={compact ? { gridTemplateColumns: '78px 1fr 62px', padding: '6px 2px' } : null}>
      <div className="lab">
        <span className="nm">{jid}</span>
        <span className="kr">{j.kr}</span>
      </div>
      <div className="track-wrap">
        <input className="jrange" type="range" min="-100" max="100" value={value}
          style={{ backgroundSize: pct + '% 100%' }}
          onChange={e => onChange(jid, parseInt(e.target.value))} />
        <span className="center-tick"></span>
      </div>
      <div className="val">
        <input className="tnum" type="number" min="-100" max="100" value={value}
          onChange={e => onChange(jid, parseInt(e.target.value || '0'))} />
        <span className="raw">{deg.toFixed(1)}° · raw {raw}</span>
      </div>
    </div>
  );
}

// ---- viewer frame with HUD overlay ----
function ViewerFrame({ getJoints, interactive = true, autoRotate = false, warnLimits = true, label = 'LIVE POSE', children }) {
  const s = useStore();
  const j = getJoints ? getJoints() : s.joints;
  const over = JOINT_IDS.some(id => isOverSoft(id, j[id]));
  return (
    <div className="viewer">
      <Chicken3DViewer getJoints={getJoints} interactive={interactive} autoRotate={autoRotate} warnLimits={warnLimits} />
      <div className="v-overlay">
        <span className="v-corner tl"></span><span className="v-corner tr"></span>
        <span className="v-corner bl"></span><span className="v-corner br"></span>
        <div className="v-hud tl">
          <div className="hl">{label}</div>
          <div style={{ color: 'var(--tx-3)' }}>{s.mode.toUpperCase()} · TORQUE {s.torque ? 'ON' : 'OFF'}</div>
        </div>
        <div className="v-hud tr">
          {JOINT_IDS.map(id => (
            <div key={id}>{id.replace('_', '·')} <span className="hl">{valToDeg(id, j[id]).toFixed(0)}°</span></div>
          ))}
        </div>
        {over && <div className="v-warn">⚠ SOFT LIMIT 초과 — 기구 간섭 위험</div>}
        {children}
      </div>
    </div>
  );
}

function ModeName(m) {
  return { detect: '감지', random: '랜덤', test: '테스트', stop: '정지' }[m] || m;
}
function LevelName(lv) {
  return { ok: 'OK', info: 'INFO', cmd: 'CMD', warn: 'WARN', err: 'ERR' }[lv] || lv;
}

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return '방금';
  if (s < 60) return s + '초 전';
  const m = Math.floor(s / 60);
  if (m < 60) return m + '분 전';
  return Math.floor(m / 60) + '시간 전';
}

// ---- log list ----
function LogList({ logs, limit }) {
  const rows = limit ? logs.slice(-limit).reverse() : [...logs].reverse();
  return (
    <div className="logwrap">
      {rows.map(l => (
        <div key={l.id} className={`logline ${l.lv}`}>
          <span className="t">{l.t}</span>
          <span className="lv">{LevelName(l.lv)}</span>
          <span className="src">{l.src}</span>
          <span className="msg">{l.msg}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, {
  Icon, Dot, Badge, Panel, Btn, Toggle, Seg, Stat, KV, MBar,
  JointSlider, ViewerFrame, ModeName, LevelName, relTime, LogList,
});
