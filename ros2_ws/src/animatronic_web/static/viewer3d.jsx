/* ============================================================
   viewer3d.jsx — three.js 닭 골격 3D 뷰어 (4관절 실시간)
   robot skeleton · mechanical joint axes · cyan HUD
   ============================================================ */

const V_CY = 0x3fc7d4;
const V_ERR = 0xe65f50;

function buildRig() {
  const THREE = window.THREE;
  const root = new THREE.Group();

  const matBody = new THREE.MeshStandardMaterial({ color: 0x2b333b, metalness: 0.75, roughness: 0.45 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x1a1f24, metalness: 0.6, roughness: 0.6 });
  const matJoint = new THREE.MeshStandardMaterial({ color: 0x39434c, metalness: 0.85, roughness: 0.3 });
  const matAxis = new THREE.MeshStandardMaterial({ color: V_CY, emissive: V_CY, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0x46505a, metalness: 0.7, roughness: 0.4 });

  // ---- base pedestal ----
  const base = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.18, 32), matDark);
  plate.position.y = 0.09; plate.castShadow = true; plate.receiveShadow = true;
  base.add(plate);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.6, 24), matBody);
  column.position.y = 0.48; column.castShadow = true;
  base.add(column);
  root.add(base);

  // helper: motor disc (visualizes a rotary actuator)
  function motorDisc(axis, r = 0.34, h = 0.26) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), matJoint);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.96, 0.025, 8, 28), matAxis);
    // align torus to the housing's circular face
    if (axis === 'y') { housing.rotation.x = 0; ring.rotation.x = Math.PI / 2; }
    else { housing.rotation.z = Math.PI / 2; ring.rotation.y = Math.PI / 2; }
    housing.castShadow = true;
    g.add(housing); g.add(ring);
    return g;
  }
  function link(len, w = 0.26) {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, len, w * 0.8), matBody);
    bar.position.y = len / 2; bar.castShadow = true;
    g.add(bar);
    // rib detail
    for (let i = 1; i <= 2; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 1.18, 0.04, w * 0.95), matAccent);
      rib.position.y = (len / 3) * i; g.add(rib);
    }
    return g;
  }

  // ---- lower yaw (vertical axis turntable) ----
  const lowerYaw = new THREE.Group();
  lowerYaw.position.y = 0.78;
  const lyDisc = motorDisc('y'); lowerYaw.add(lyDisc);
  base.add(lowerYaw);

  // ---- lower pitch (tilt) ----
  const lowerPitch = new THREE.Group();
  lowerPitch.position.y = 0.16;
  const lpDisc = motorDisc('x', 0.3, 0.42); lowerPitch.add(lpDisc);
  lowerYaw.add(lowerPitch);

  // lower link
  const L1 = 1.15;
  const lLink = link(L1); lowerPitch.add(lLink);

  // ---- upper yaw ----
  const upperYaw = new THREE.Group();
  upperYaw.position.y = L1;
  const uyDisc = motorDisc('y', 0.27); upperYaw.add(uyDisc);
  lowerPitch.add(upperYaw);

  // ---- upper pitch ----
  const upperPitch = new THREE.Group();
  upperPitch.position.y = 0.13;
  const upDisc = motorDisc('x', 0.24, 0.34); upperPitch.add(upDisc);
  upperYaw.add(upperPitch);

  // upper link
  const L2 = 0.7;
  const uLink = link(L2, 0.22); upperPitch.add(uLink);

  // ---- head assembly (mechanical chicken skull) ----
  const head = new THREE.Group();
  head.position.y = L2 + 0.02;
  // skull box
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.46), matBody);
  skull.position.z = 0.06; skull.position.y = 0.12; skull.castShadow = true;
  head.add(skull);
  // beak (forward +Z)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 6), matAccent);
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.06, 0.42);
  head.add(beak);
  const beakLo = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 6), matDark);
  beakLo.rotation.x = Math.PI / 2; beakLo.position.set(0, -0.02, 0.36);
  head.add(beakLo);
  // eyes (cyan sensor lenses)
  const eyeMat = new THREE.MeshStandardMaterial({ color: V_CY, emissive: V_CY, emissiveIntensity: 1.1 });
  [-1, 1].forEach(s => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), eyeMat);
    eye.position.set(s * 0.16, 0.16, 0.2); head.add(eye);
  });
  // comb (3 fins on top)
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1 - i * 0.012, 0.1), matAccent);
    fin.position.set(0, 0.3, 0.04 - i * 0.11); head.add(fin);
  }
  // wattle
  const wattle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.05), matAccent);
  wattle.position.set(0, -0.08, 0.34); head.add(wattle);
  upperPitch.add(head);

  return { root, lowerYaw, lowerPitch, upperYaw, upperPitch, head,
    parts: [matAxis], discs: { lower_yaw: lyDisc, lower_pitch: lpDisc, upper_yaw: uyDisc, upper_pitch: upDisc } };
}

function Chicken3DViewer({ getJoints, interactive = true, autoRotate = false, warnLimits = false, dim = false }) {
  const mountRef = React.useRef(null);
  const stateRef = React.useRef({});
  const getJointsRef = React.useRef(getJoints);
  getJointsRef.current = getJoints;

  React.useEffect(() => {
    const THREE = window.THREE;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0c0f12, 6, 14);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // lights
    scene.add(new THREE.AmbientLight(0x3a4650, 0.7));
    const key = new THREE.DirectionalLight(0xddeef5, 1.15);
    key.position.set(3, 5, 4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.near = 1; key.shadow.camera.far = 20;
    key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(V_CY, 0.5);
    rim.position.set(-4, 2, -3); scene.add(rim);
    const fill = new THREE.PointLight(0x4a90a0, 0.4, 12); fill.position.set(0, 3, -4); scene.add(fill);

    // ground grid
    const grid = new THREE.GridHelper(10, 30, 0x2b343d, 0x1a2026);
    grid.position.y = 0; grid.material.opacity = 0.55; grid.material.transparent = true;
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5, 48),
      new THREE.MeshStandardMaterial({ color: 0x10141a, metalness: 0.2, roughness: 0.9, transparent: true, opacity: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.001; floor.receiveShadow = true; scene.add(floor);

    const rig = buildRig();
    scene.add(rig.root);

    // orbit state
    let az = 0.6, pol = 1.15, dist = 5.4;
    const target = new THREE.Vector3(0, 1.55, 0);
    function applyCam() {
      pol = Math.max(0.25, Math.min(1.62, pol));
      dist = Math.max(3, Math.min(9, dist));
      camera.position.set(
        target.x + dist * Math.sin(pol) * Math.sin(az),
        target.y + dist * Math.cos(pol),
        target.z + dist * Math.sin(pol) * Math.cos(az));
      camera.lookAt(target);
    }
    applyCam();

    // interaction
    let dragging = false, px = 0, py = 0, lastInteract = 0;
    const dom = renderer.domElement;
    function onDown(e) { dragging = true; px = e.clientX; py = e.clientY; lastInteract = Date.now(); dom.style.cursor = 'grabbing'; }
    function onMove(e) {
      if (!dragging) return;
      az -= (e.clientX - px) * 0.008; pol -= (e.clientY - py) * 0.008;
      px = e.clientX; py = e.clientY; lastInteract = Date.now(); applyCam();
    }
    function onUp() { dragging = false; dom.style.cursor = interactive ? 'grab' : 'default'; }
    function onWheel(e) { e.preventDefault(); dist += e.deltaY * 0.004; lastInteract = Date.now(); applyCam(); }
    if (interactive) {
      dom.style.cursor = 'grab';
      dom.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      dom.addEventListener('wheel', onWheel, { passive: false });
    }

    // resize
    function resize() {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(mount); resize();

    // animation
    const disp = { lower_yaw: 0, lower_pitch: 0, upper_yaw: 0, upper_pitch: 0 };
    let raf;
    function frame() {
      raf = requestAnimationFrame(frame);
      const j = (getJointsRef.current ? getJointsRef.current() : Store.state.joints) || disp;
      const k = (Store.state.moveSpeed === 'slow' ? 0.05 : 0.28);
      JOINT_IDS.forEach(id => { disp[id] += ((j[id] || 0) - disp[id]) * k; });
      rig.lowerYaw.rotation.y = valToDeg('lower_yaw', disp.lower_yaw) * Math.PI / 180;
      rig.lowerPitch.rotation.x = valToDeg('lower_pitch', disp.lower_pitch) * Math.PI / 180;
      rig.upperYaw.rotation.y = valToDeg('upper_yaw', disp.upper_yaw) * Math.PI / 180;
      rig.upperPitch.rotation.x = valToDeg('upper_pitch', disp.upper_pitch) * Math.PI / 180;

      // warn highlight
      if (warnLimits) {
        let over = false;
        JOINT_IDS.forEach(id => { if (isOverSoft(id, j[id] || 0)) over = true; });
        const c = over ? V_ERR : V_CY;
        rig.parts[0].color.setHex(c); rig.parts[0].emissive.setHex(c);
      }

      if (autoRotate && Date.now() - lastInteract > 2500) { az += 0.0035; applyCam(); }
      renderer.render(scene, camera);
    }
    frame();

    stateRef.current = { renderer, scene };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      if (interactive) {
        dom.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        dom.removeEventListener('wheel', onWheel);
      }
      renderer.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  return React.createElement('div', { ref: mountRef, style: { position: 'absolute', inset: 0, opacity: dim ? 0.85 : 1 } });
}

window.Chicken3DViewer = Chicken3DViewer;
