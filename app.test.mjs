import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const source = await readFile(new URL('app.js', import.meta.url), 'utf8');

// Exercise the real event listeners against a small dependency-free DOM adapter.
class Element extends EventTarget {
  children = []; style = {}; checked = true; value = '0.010'; clientHeight = 400;
  classList = { toggle() {}, remove() {} };
  append(child) { this.children.push(...(child.fragment ? child.children : [child])); for (const e of this.children) e.parent = this; }
  prepend(child) { this.children.unshift(...(child.fragment ? child.children : [child])); for (const e of this.children) e.parent = this; }
  replaceChildren() { this.children = []; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  closest() { return this; }
  get lastElementChild() { return this.children.at(-1); }
}
function setup() {
  const elements = new Map();
  const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const frames = new Map(), timers = new Map(); let id = 0;
  vm.runInContext(source, vm.createContext({
    document: { getElementById: el, createElement: () => new Element(), createDocumentFragment: () => Object.assign(new Element(), { fragment: true }) },
    window: { GestureEvent: class {} }, Date,
    requestAnimationFrame: (f) => { frames.set(++id, f); return id; }, cancelAnimationFrame: (key) => frames.delete(key),
    setTimeout: (f) => { timers.set(++id, f); return id; }, clearTimeout: (key) => timers.delete(key),
  }));
  const send = (target, type, values, cancelable = true) => {
    const event = new Event(type, { cancelable }); Object.assign(event, values); el(target).dispatchEvent(event); return event;
  };
  const wheel = (deltaY, { mode = 0, ctrl = true, cancelable = true } = {}) => send('wheel-surface', 'wheel', { deltaY, deltaMode: mode, ctrlKey: ctrl }, cancelable);
  const flush = (queue) => { for (const [key, f] of [...queue]) { queue.delete(key); f(); } };
  return { el, send, wheel, frames, timers, flush };
}
test('Safari uses gesture-relative scale and accumulates independently of wheel', () => {
  const { el, send, wheel } = setup();
  const gesture = (type, scale, rotation) => send('surface', type, { scale, rotation });
  gesture('gesturestart', 1, 0); gesture('gesturechange', 1.5, 15); gesture('gesturechange', 2, 30); gesture('gestureend', 2, 30);
  assert.equal(el('object').style.transform, 'rotate(30deg) scale(2)');
  gesture('gesturestart', 1, 0); gesture('gestureend', 0.5, -10);
  assert.equal(el('object').style.transform, 'rotate(20deg) scale(1)');
  wheel(-20); assert.equal(el('object').style.transform, 'rotate(20deg) scale(1)');
  el('reset').dispatchEvent(new Event('click')); assert.equal(el('object').style.transform, 'rotate(0deg) scale(1)');
});
test('ordinary scroll is neither canceled nor applied to zoom', () => {
  const { el, wheel } = setup();
  assert.equal(wheel(100, { ctrl: false }).defaultPrevented, false);
  assert.equal(el('wheel-object').style.transform, undefined);
  assert.equal(el('wheel-ignored').textContent, '1');
  assert.equal(el('wheel-count').textContent, undefined);
});
test('wheel normalizes units, reverses zoom, and honors cancellation', () => {
  const { el, wheel } = setup();
  assert.equal(wheel(-10).defaultPrevented, true); assert.equal(el('wheel-object-scale').textContent, '1.11×');
  wheel(10); assert.equal(el('wheel-object-scale').textContent, '1.00×');
  wheel(-1, { mode: 1 }); assert.equal(el('wheel-pixels').textContent, 'Normalized delta: -16.000 px'); assert.equal(el('wheel-object-scale').textContent, '1.17×');
  el('wheel-reset').dispatchEvent(new Event('click'));
  wheel(-0.1, { mode: 2 }); assert.equal(el('wheel-pixels').textContent, 'Normalized delta: -40.000 px'); assert.equal(el('wheel-object-scale').textContent, '1.49×');
  el('wheel-prevent-default').checked = false; assert.equal(wheel(10).defaultPrevented, false);
  el('wheel-prevent-default').checked = true; assert.equal(wheel(10, { cancelable: false }).defaultPrevented, false);
  assert.equal(el('wheel-trusted').textContent, 'No (synthetic)');
});
test('sensitivity, scale limits, idle timeout, and reset are predictable', () => {
  const { el, wheel, timers, flush } = setup();
  el('wheel-sensitivity').value = '0.020'; el('wheel-sensitivity').dispatchEvent(new Event('input'));
  assert.equal(el('wheel-sensitivity-value').textContent, '0.020');
  wheel(-10); assert.equal(el('wheel-object-scale').textContent, '1.22×');
  wheel(-1e9); assert.equal(el('wheel-object-scale').textContent, '4.00×');
  wheel(1e9); assert.equal(el('wheel-object-scale').textContent, '0.20×');
  assert.equal(timers.size, 1); flush(timers); assert.equal(el('wheel-phase').textContent, 'Idle (160 ms timeout)');
  wheel(-10); el('wheel-reset').dispatchEvent(new Event('click')); assert.equal(timers.size, 0); assert.equal(el('wheel-object').style.transform, 'scale(1)');
});
test('mixed log is bounded, newest first, and clear cancels pending rows', () => {
  const { el, wheel, frames, flush } = setup();
  for (let i = 0; i < 100; i++) wheel(i);
  flush(frames); assert.equal(el('events').children.length, 60);
  assert.match(el('events').children[0].children[2].textContent, /deltaY 99.000/);
  wheel(1); el('clear').dispatchEvent(new Event('click')); flush(frames);
  assert.equal(el('events').children.length, 1); assert.equal(el('wheel-count').textContent, '0'); assert.equal(el('wheel-ignored').textContent, '0'); assert.equal(el('count').textContent, '0');
});
