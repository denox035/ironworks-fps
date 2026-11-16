// Input: keyboard state, mouse look via pointer lock, and the click-to-play
// flow. The game never reads keys directly — the sim polls this snapshot
// once per fixed step, so input is deterministic per tick.
export function makeInput() {
  const input = {
    f: false, b: false, l: false, r: false,
    crouch: false, jump: false, walk: false,
    fire: false, firePressed: false, // firePressed: edge, for semi-auto guns
    reload: false, reloadPressed: false,
    ads: false,
    grenade: false, grenadePressed: false,
    plant: false, // E held
    buyToggle: false, buyTogglePressed: false,
    slot: 0, // 1-5 pressed this frame
    lookDX: 0, lookDY: 0,
    locked: false,
    keys: new Set(),
  };
  const KEYMAP = {
    KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r',
    ControlLeft: 'crouch', KeyC: 'crouch',
    ShiftLeft: 'walk', ShiftRight: 'walk',
    KeyE: 'plant',
  };
  function onKey(e, down) {
    const mapped = KEYMAP[e.code];
    if (mapped) {
      input[mapped] = down;
      if (e.code === 'ControlLeft') e.preventDefault();
    }
    if (down && !e.repeat) {
      if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
      if (e.code === 'KeyR') input.reloadPressed = true;
      if (e.code === 'KeyG') input.grenadePressed = true;
      if (e.code === 'KeyB') input.buyTogglePressed = true;
      if (e.code === 'Digit1') input.slot = 1;
      if (e.code === 'Digit2') input.slot = 2;
      if (e.code === 'Digit3') input.slot = 3;
      if (e.code === 'Digit4') input.slot = 4;
      if (e.code === 'Digit5') input.slot = 5;
      if (e.code === 'KeyM') input.mutePressed = true;
    }
    if (down) input.keys.add(e.code); else input.keys.delete(e.code);
  }
  function onMouseMove(e) {
    if (!input.locked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  }
  function onMouseDown(e) {
    if (!input.locked) return;
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
    if (e.button === 2) input.ads = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.ads = false;
  }
  function onLockChange() {
    input.locked = document.pointerLockElement != null;
  }
  function onContextMenu(e) { e.preventDefault(); }
  return {
    state: input,
    attach(el) {
      window.addEventListener('keydown', (e) => onKey(e, true));
      window.addEventListener('keyup', (e) => onKey(e, false));
      document.addEventListener('mousemove', onMouseMove);
      el.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      document.addEventListener('pointerlockchange', onLockChange);
      el.addEventListener('contextmenu', onContextMenu);
    },
    requestLock(el) {
      el.requestPointerLock();
    },
    // Consume one frame's worth of look delta (called once per rendered frame).
    takeLook() {
      const dx = input.lookDX, dy = input.lookDY;
      input.lookDX = 0; input.lookDY = 0;
      return { dx, dy };
    },
    // Consume edge-triggered presses after the sim step has read them.
    endStep() {
      input.jump = false;
      input.firePressed = false;
      input.reloadPressed = false;
      input.grenadePressed = false;
      input.buyTogglePressed = false;
      input.mutePressed = false;
      input.slot = 0;
    },
  };
}
