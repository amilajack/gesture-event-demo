const $ = (id) => document.getElementById(id);
const surface = $('surface');
const object = $('object');
const support = $('support');
const supported = 'GestureEvent' in window || 'ongesturestart' in window;
support.textContent = supported ? '● GestureEvent detected' : 'GestureEvent not detected';
support.classList.toggle('unsupported', !supported);

let scale = 1;
let rotation = 0;
let baseScale = 1;
let baseRotation = 0;
let active = false;
let count = 0;
let frame = 0;
let pendingRows = [];

function render() {
  object.style.transform = `rotate(${rotation}deg) scale(${scale})`;
  $('object-scale').textContent = `${scale.toFixed(2)}×`;
  $('object-rotation').textContent = `${rotation.toFixed(1)}°`;
}

function flushLog() {
  frame = 0;
  if (!pendingRows.length) return;
  $('empty')?.remove();
  const fragment = document.createDocumentFragment();
  for (const values of pendingRows.reverse()) {
    const row = document.createElement('tr');
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    fragment.append(row);
  }
  pendingRows = [];
  $('events').prepend(fragment);
  while ($('events').children.length > 60) $('events').lastElementChild.remove();
}

function logEvent(event, label, input, objectZoom) {
  const now = new Date();
  pendingRows.push([
    now.toLocaleTimeString([], { hour12: false }) + `.${String(now.getMilliseconds()).padStart(3, '0')}`,
    label, input, `${objectZoom.toFixed(3)}×`, String(event.cancelable), String(event.defaultPrevented),
  ]);
  if (pendingRows.length > 60) pendingRows.shift();
  if (!frame) frame = requestAnimationFrame(flushLog);
}

function handleGesture(event) {
  // Safari requires non-passive listeners for preventDefault() to cancel zoom.
  if ($('prevent-default').checked && event.cancelable) event.preventDefault();
  support.textContent = '● Gesture events received';
  support.classList.remove('unsupported');

  const eventScale = Number.isFinite(event.scale) && event.scale > 0 ? event.scale : 1;
  const eventRotation = Number.isFinite(event.rotation) ? event.rotation : 0;
  if (event.type === 'gesturestart') {
    baseScale = scale;
    baseRotation = rotation;
    active = true;
  }
  if (active) {
    // Each event is relative to gesturestart, not to the previous change event.
    scale = Math.min(4, Math.max(0.2, baseScale * eventScale));
    rotation = baseRotation + eventRotation;
    render();
  }
  if (event.type === 'gestureend') active = false;

  surface.closest('.playground').classList.toggle('active', active);
  $('phase').textContent = active ? 'Gesture in progress' : 'Gesture ended';
  $('scale').textContent = `${eventScale.toFixed(3)}×`;
  $('rotation').textContent = `${eventRotation.toFixed(1)}°`;
  $('count').textContent = String(++count);
  $('trusted').textContent = event.isTrusted ? 'Yes' : 'No (synthetic)';
  $('cancellation').textContent = `cancelable: ${event.cancelable} · defaultPrevented: ${event.defaultPrevented}`;
  logEvent(event, `Safari / ${event.type}`, `scale ${eventScale.toFixed(3)} · ${eventRotation.toFixed(1)}°`, scale);
}

for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  surface.addEventListener(type, handleGesture, { passive: false });
}

$('reset').addEventListener('click', () => {
  scale = baseScale = 1;
  rotation = baseRotation = 0;
  active = false;
  surface.closest('.playground').classList.remove('active');
  $('phase').textContent = 'Waiting for a gesture';
  $('scale').textContent = '1.000×';
  $('rotation').textContent = '0.0°';
  render();
});

$('clear').addEventListener('click', () => {
  cancelAnimationFrame(frame);
  frame = 0;
  pendingRows = [];
  $('events').replaceChildren();
  const row = document.createElement('tr');
  row.id = 'empty';
  const cell = document.createElement('td');
  cell.colSpan = 6;
  cell.textContent = 'Your gestures will appear here.';
  row.append(cell);
  $('events').append(row);
  count = 0;
  $('count').textContent = '0';
  wheelCount = ignoredCount = 0;
  $('wheel-count').textContent = '0';
  $('wheel-ignored').textContent = '0';
});

const wheelSurface = $('wheel-surface');
let wheelScale = 1;
let wheelCount = 0;
let ignoredCount = 0;
let wheelIdleTimer;

function renderWheel() {
  $('wheel-object').style.transform = `scale(${wheelScale})`;
  $('wheel-object-scale').textContent = `${wheelScale.toFixed(2)}×`;
}

wheelSurface.addEventListener('wheel', (event) => {
  // Read deltaMode before deltaY: wheel delta units are not always pixels.
  const mode = event.deltaMode;
  const delta = event.deltaY;
  $('wheel-delta').textContent = delta.toFixed(3);
  $('wheel-mode').textContent = `deltaMode: ${mode} (${['pixels', 'lines', 'pages'][mode] || 'unknown'})`;
  $('wheel-ctrl').textContent = String(event.ctrlKey);
  $('wheel-trusted').textContent = event.isTrusted ? 'Yes' : 'No (synthetic)';

  if (!event.ctrlKey) {
    $('wheel-ignored').textContent = String(++ignoredCount);
    $('wheel-cancellation').textContent = 'Ordinary wheel ignored; default behavior allowed.';
    logEvent(event, 'Wheel / scroll ignored', `deltaY ${delta.toFixed(3)} · mode ${mode}`, wheelScale);
    return;
  }

  if ($('wheel-prevent-default').checked && event.cancelable) event.preventDefault();
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? wheelSurface.clientHeight : 1);
  const sensitivity = Number($('wheel-sensitivity').value);
  // Clamp the exponent to avoid overflow from unusually large wheel deltas.
  const step = Math.exp(Math.max(-20, Math.min(20, -pixels * sensitivity)));
  if (Number.isFinite(step)) wheelScale = Math.min(4, Math.max(0.2, wheelScale * step));
  renderWheel();
  $('wheel-step').textContent = `${step.toFixed(3)}×`;
  $('wheel-pixels').textContent = `Normalized delta: ${pixels.toFixed(3)} px`;
  $('wheel-count').textContent = String(++wheelCount);
  $('wheel-cancellation').textContent = `cancelable: ${event.cancelable} · defaultPrevented: ${event.defaultPrevented}`;
  $('wheel-phase').textContent = 'Pinch / Ctrl+wheel active';
  wheelSurface.closest('.playground').classList.toggle('active', true);
  clearTimeout(wheelIdleTimer);
  wheelIdleTimer = setTimeout(() => {
    $('wheel-phase').textContent = 'Idle (160 ms timeout)';
    wheelSurface.closest('.playground').classList.remove('active');
  }, 160);
  logEvent(event, 'Wheel / pinch or Ctrl+wheel', `deltaY ${delta.toFixed(3)} · mode ${mode}`, wheelScale);
}, { passive: false });

$('wheel-sensitivity').addEventListener('input', () => {
  $('wheel-sensitivity-value').textContent = Number($('wheel-sensitivity').value).toFixed(3);
});

$('wheel-reset').addEventListener('click', () => {
  clearTimeout(wheelIdleTimer);
  wheelScale = 1;
  renderWheel();
  $('wheel-step').textContent = '1.000×';
  $('wheel-phase').textContent = 'Waiting for a pinch';
  wheelSurface.closest('.playground').classList.remove('active');
});
