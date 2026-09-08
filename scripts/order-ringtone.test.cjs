// Run with: node --test scripts/order-ringtone.test.cjs
// Execute the production TS with mocked native audio, storage and timers.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(require('node:timers').setImmediate);

function audioHarness() {
  const loads = [], sounds = [], warnings = [];
  let peakPlaying = 0;
  const Audio = { Sound: { createAsync(uri, status) {
    assert.equal(status.isLooping, true);
    assert.equal(status.shouldPlay, false);
    const gate = deferred();
    loads.push({ uri, finish() {
      const sound = {
        playing: false, unloaded: false, plays: 0, stops: 0, unloads: 0,
        async playAsync() {
          this.plays++;
          if (this.playGate) await this.playGate.promise;
          if (this.unloaded) return;
          this.playing = true;
          peakPlaying = Math.max(peakPlaying, sounds.filter(s => s.playing).length);
        },
        async stopAsync() { this.stops++; this.playing = false; },
        async unloadAsync() {
          this.unloads++;
          if (this.unloadGate) await this.unloadGate.promise;
          this.playing = false; this.unloaded = true;
        },
      };
      sounds.push(sound);
      gate.resolve({ sound });
      return sound;
    }, fail: gate.reject });
    return gate.promise;
  } } };
  const exports = {};
  vm.runInNewContext(compile(read('lib/orderRingtone.ts')), {
    exports, require: name => { assert.equal(name, 'expo-av'); return { Audio }; },
    console: { warn: (...args) => warnings.push(args) },
  });
  exports.selectOrderRingtoneRestaurant('demo');
  // Preserve the original simulations' numeric fixtures; production always uses
  // explicit scoped keys. V2 tests below exercise the raw controller directly.
  const api = { ...exports };
  for (const name of ['startOrderRingtone', 'stopOrderRingtone', 'suppressOrderRingtone', 'resolveOrderRingtone', 'markOrderRingtoneResolved', 'isOrderRingtoneSuppressed', 'isOrderRingtoneResolved', 'releaseOrderRingtoneSuppression']) {
    api[name] = (key, ...args) => exports[name](typeof key === 'number' ? exports.orderRingtoneKey('demo', key) : key, ...args);
  }
  return { api, controller: exports, loads, sounds, warnings, peak: () => peakPlaying };
}

function queueHarness(audio, { platform = 'android', safetyResponse = async () => ({ success: false }) } = {}) {
  const timers = new Map(), cleanups = [], state = [];
  let timerId = 0;
  const storage = new Map([['restaurant_code', 'demo'], ['notification_sound', 'default'], ['user_role', 'owner']]);
  const source = read('app/_layout.tsx');
  const snippet = source.slice(source.indexOf('  const [newOrderModal,'), source.indexOf('  const checkUserRole ='));
  const environment = {
    ...audio.api,
    useRef: current => ({ current }),
    useState: initial => { const cell = { value: initial }; state.push(cell); return [initial, value => { cell.value = value; }]; },
    useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    Platform: { OS: platform },
    AsyncStorage: { getItem: async key => storage.get(key) || null, setItem: async (key, value) => storage.set(key, value) },
    fetch: async () => ({ json: safetyResponse }),
    BACKEND_URL: 'https://example.invalid', AbortController,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    setInterval: () => ++timerId, clearInterval() {},
    clearTimeout: id => timers.delete(id), console: { log() {} },
  };
  const queue = vm.runInNewContext(compile(snippet) + `\n({ enqueueOrder, startOrderSound, closeOrder, dismissResolvedOrder, showNextInQueue, currentModalOrderIdRef, currentModalKeyRef, orderQueueRef, mountedRef, addPendingDecision, removePendingDecision, liveCursorRef, liveSyncRunningRef, liveRestaurantCodeRef, processedNewOrderIdsRef, debugLog, keyForOrder, beginRootDecision, refreshRingtoneRestaurant });`, environment);
  for (const name of ['startOrderSound', 'closeOrder', 'dismissResolvedOrder', 'removePendingDecision']) {
    const fn = queue[name];
    queue[name] = (key, ...args) => fn(typeof key === 'number' ? audio.api.orderRingtoneKey('demo', key) : key, ...args);
  }
  return { ...queue, timers, state, storage, environment,
    tick() { const batch = [...timers.values()]; timers.clear(); batch.forEach(callback => callback()); },
    unmount() { cleanups.forEach(cleanup => cleanup()); },
  };
}
const order = order_id => ({ order_id, status: 'processing', timestamp: Date.now() });

function notificationHandler(q, tap = false) {
  const source = ts.createSourceFile('layout.tsx', read('app/_layout.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const method = tap ? 'addNotificationResponseReceivedListener' : 'addNotificationReceivedListener';
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === `Notifications.${method}`) {
      callback = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  return vm.runInNewContext(compile(`const handler = ${callback}; handler;`), {
    ...q.environment, ...q, isRegisteredOrderDevice: async () => true,
    formatDate: value => value, wcDateToMs: value => new Date(value).getTime(),
    safeParseItems: value => Array.isArray(value) ? value : [],
  });
}

test('late load after acceptance/close is unloaded without ever playing', async () => {
  const h = audioHarness();
  const start = h.api.startOrderRingtone(123, 'sound');
  await flush();
  const stop = h.api.suppressOrderRingtone(123);
  const close = h.api.stopOrderRingtone(123);
  const sound = h.loads[0].finish();
  await Promise.all([start, stop, close]);
  assert.equal(sound.plays, 0);
  assert.equal(sound.unloaded, true);
  await h.api.startOrderRingtone(123, 'sound');
  assert.equal(h.loads.length, 1);
});

test('duplicate starts while loading and playing create exactly one sound', async () => {
  const h = audioHarness();
  const first = h.api.startOrderRingtone(123, 'sound');
  const second = h.api.startOrderRingtone(123, 'sound');
  await flush();
  assert.equal(h.loads.length, 1);
  h.loads[0].finish();
  await Promise.all([first, second]);
  await h.api.startOrderRingtone(123, 'sound');
  assert.equal(h.loads.length, 1);
  assert.equal(h.peak(), 1);
  await h.api.stopAllOrderRingtone();
});

test('replacement waits for stale load disposal; old callbacks cannot stop the new order', async () => {
  const h = audioHarness();
  const first = h.api.startOrderRingtone(123, 'old');
  await flush();
  const second = h.api.startOrderRingtone(124, 'new');
  const old = h.loads[0].finish();
  old.unloadGate = deferred();
  await flush();
  assert.equal(h.loads.length, 1);
  assert.equal(old.plays, 0);
  old.unloadGate.resolve();
  await flush();
  const current = h.loads[1].finish();
  await Promise.all([first, second]);
  await h.api.suppressOrderRingtone(123);
  h.api.resolveOrderRingtone(123);
  assert.equal(current.playing, true);
  await h.api.stopAllOrderRingtone();
  assert.equal(current.playing, false);
});

test('repeated stops while idle, playing and unloading share cleanup', async () => {
  const h = audioHarness();
  await Promise.all([h.api.stopAllOrderRingtone(), h.api.stopAllOrderRingtone()]);
  const start = h.api.startOrderRingtone(123, 'sound');
  await flush();
  const sound = h.loads[0].finish();
  await start;
  sound.unloadGate = deferred();
  const first = h.api.stopOrderRingtone(123);
  await flush();
  const second = h.api.stopAllOrderRingtone();
  sound.unloadGate.resolve();
  await Promise.all([first, second, h.api.stopOrderRingtone(123)]);
  assert.equal(sound.stops, 1);
  assert.equal(sound.unloads, 1);
  assert.equal(sound.playing, false);
});

test('stop during playAsync completion disposes before a replacement can play', async () => {
  const h = audioHarness();
  const start = h.api.startOrderRingtone(123, 'sound');
  await flush();
  const sound = h.loads[0].finish();
  sound.playGate = deferred();
  await flush();
  const stop = h.api.suppressOrderRingtone(123);
  const next = h.api.startOrderRingtone(124, 'next');
  sound.playGate.resolve();
  await flush();
  h.loads[1].finish();
  await Promise.all([start, stop, next]);
  assert.equal(sound.unloaded, true);
  assert.equal(h.peak(), 1);
  await h.api.stopAllOrderRingtone();
});

test('failed create releases ownership and allows a retry', async () => {
  const h = audioHarness();
  const first = h.api.startOrderRingtone(123, 'sound');
  await flush();
  h.loads[0].fail(new Error('network failure'));
  await first;
  const retry = h.api.startOrderRingtone(123, 'sound');
  await flush();
  h.loads[1].finish();
  await retry;
  assert.equal(h.warnings.length, 1);
  await h.api.stopAllOrderRingtone();
});

test('notification and live-sync race admits one modal and one ringtone', async () => {
  const h = audioHarness(), check = deferred();
  const q = queueHarness(h, { safetyResponse: () => check.promise });
  const notification = q.enqueueOrder(order(123), true, true);
  await flush();
  assert.equal(await q.enqueueOrder(order(123), true, false), true);
  const start = q.startOrderSound(123);
  await flush();
  check.resolve({ success: false });
  assert.equal(await notification, false);
  assert.equal(q.orderQueueRef.current.length, 0);
  assert.equal(q.currentModalOrderIdRef.current, 123);
  h.loads[0].finish();
  await start;
  q.unmount();
  await h.api.stopAllOrderRingtone();
});

test('queued arrival stays silent; acceptance promotes next without overlap', async () => {
  const h = audioHarness(), q = queueHarness(h);
  await q.enqueueOrder(order(123), true);
  const start = q.startOrderSound(123);
  await flush();
  const first = h.loads[0].finish();
  await start;
  await q.enqueueOrder(order(124), true);
  await q.startOrderSound(124);
  assert.equal(h.loads.length, 1);
  await h.api.suppressOrderRingtone(123);
  assert.equal(first.playing, false);
  h.api.resolveOrderRingtone(123);
  assert.equal(q.currentModalOrderIdRef.current, 124);
  q.closeOrder(123); // delayed onClose from the previous modal
  q.tick();
  await flush();
  h.loads[1].finish();
  await flush();
  assert.equal(q.state[0].value.order_id, 124);
  assert.equal(h.peak(), 1);
  q.unmount();
  await h.api.stopAllOrderRingtone();
});

test('resolution during 400ms transition cancels opening and playback', async () => {
  const h = audioHarness(), q = queueHarness(h);
  await q.enqueueOrder(order(123), true);
  await q.enqueueOrder(order(124), true);
  q.closeOrder(123);
  assert.equal(q.timers.size, 1);
  h.api.resolveOrderRingtone(124);
  q.tick();
  await flush();
  assert.equal(q.state[1].value, false);
  assert.equal(q.currentModalOrderIdRef.current, null);
  assert.equal(h.loads.length, 0);
  assert.equal(await q.enqueueOrder(order(124), true), false);
  q.unmount();
});

test('Review decision suppresses root sound immediately but preserves unresolved pending state', async () => {
  const h = audioHarness(), q = queueHarness(h);
  await q.enqueueOrder(order(123), true);
  q.storage.set('pending_decision', '[123]');
  const start = q.startOrderSound(123);
  await flush();
  const sound = h.loads[0].finish();
  await start;
  await h.api.suppressOrderRingtone(123);
  assert.equal(sound.playing, false);
  assert.equal(q.storage.get('pending_decision'), '[123]');
  assert.equal(q.state[1].value, true);
  // Only the existing successful-decision callback resolves the root modal.
  h.api.resolveOrderRingtone(123);
  assert.equal(q.state[1].value, false);
  q.unmount();
});

test('unmount cancels queue timer and rejects a late audio load', async () => {
  const h = audioHarness(), q = queueHarness(h);
  await q.enqueueOrder(order(123), true);
  const start = q.startOrderSound(123);
  await flush();
  await q.enqueueOrder(order(124), true);
  q.closeOrder(123);
  q.unmount();
  q.tick();
  const sound = h.loads[0].finish();
  await start;
  await h.api.stopAllOrderRingtone();
  assert.equal(sound.plays, 0);
  assert.equal(q.timers.size, 0);
  assert.equal(h.loads.length, 1);
});

test('iOS does not create incoming-order audio', async () => {
  const h = audioHarness(), q = queueHarness(h, { platform: 'ios' });
  await q.enqueueOrder(order(123), true);
  await q.startOrderSound(123);
  assert.equal(h.loads.length, 0);
  q.unmount();
});

for (const handler of ['handleConfirmAcceptWithTime', 'handleConfirmAccept', 'handleConfirmRejectWithReason', 'handleConfirmReject']) {
  test(`${handler} suppresses before network completion without resolving a failed decision`, async () => {
    const h = audioHarness(), profile = deferred();
    const start = h.api.startOrderRingtone(123, 'sound');
    await flush();
    const sound = h.loads[0].finish();
    await start;
    const source = read('components/AcceptRejectModal.tsx');
    const snippet = source.slice(source.indexOf('  const handleConfirmAcceptWithTime ='), source.indexOf('\n  return (\n    <Modal'));
    let resolutions = 0, prints = 0;
    const handlers = vm.runInNewContext(compile(snippet) + `\n({ handleConfirmAcceptWithTime, handleConfirmAccept, handleConfirmRejectWithReason, handleConfirmReject });`, {
      order: order(123), selectedTime: 30, selectedReason: 'Busy', customReason: '', isScheduled: false,
      t: { other: 'Other', minutes: 'Minutes' },
      setLoading() {}, setCountdown() {}, onClose() {},
      onDecisionFailed() {},
      onDecisionStart: h.api.suppressOrderRingtone,
      AsyncStorage: { getItem: async () => 'demo' },
      BACKEND_URL: 'https://example.invalid',
      fetch: async url => url.includes('/restaurant-profile/') ? profile.promise : {},
      removePendingDecision: async () => { resolutions++; },
      printDecisionOnce: async () => { prints++; },
    });
    const decision = handlers[handler]('30 Minutes');
    assert.equal(h.api.isOrderRingtoneSuppressed(123), true);
    await flush();
    assert.equal(sound.playing, false);
    assert.equal(resolutions, 0);
    // Existing missing-profile failure behavior: no confirmed decision or print.
    profile.resolve({ json: async () => ({}) });
    await decision;
    assert.equal(resolutions, 0);
    assert.equal(prints, 0);
  });
}

for (const event of ['order_accepted_update', 'auto_accepted', 'status_update']) {
  test(`${event} notification resolves audio and pending state`, async () => {
    const h = audioHarness(), q = queueHarness(h);
    await q.enqueueOrder(order(123), true);
    q.storage.set('pending_decision', '[123]');
    const start = q.startOrderSound(123);
    await flush();
    const sound = h.loads[0].finish();
    await start;
    await notificationHandler(q)({ request: { content: { data: {
      event_type: event, restaurant_code: 'demo', order_id: '123', status: 'cancelled',
    } } } });
    await flush();
    assert.equal(sound.playing, false);
    assert.equal(q.state[1].value, false);
    assert.equal(q.storage.get('pending_decision'), '[]');
    if (event === 'auto_accepted') assert.ok(q.storage.has('auto_print_123'));
    q.unmount();
  });
}

test('foreground notification and tap share the current order without duplicate playback', async () => {
  const h = audioHarness(), q = queueHarness(h);
  const notification = { request: { content: { data: {
    event_type: 'new_order', restaurant_code: 'demo', order_id: '123',
  } } } };
  const received = notificationHandler(q)(notification);
  const tapped = notificationHandler(q, true)({ notification });
  await flush();
  assert.equal(h.loads.length, 1);
  h.loads[0].finish();
  await Promise.all([received, tapped]);
  assert.equal(q.currentModalOrderIdRef.current, 123);
  assert.equal(q.orderQueueRef.current.length, 0);
  assert.equal(h.peak(), 1);
  q.unmount();
  await h.api.stopAllOrderRingtone();
});

test('foreground live-sync recovers pickup/delivery orders and resolves auto-actions', async () => {
  const h = audioHarness(), q = queueHarness(h);
  const source = read('app/_layout.tsx');
  const snippet = source.slice(source.indexOf('    const normalizeBackendOrder ='), source.indexOf('    void syncLiveOrders();'));
  const appState = { currentState: 'background' };
  let response = {
    success: true, cursor: 124, device_state_included: true,
    orders: [
      { ...order(123), fulfillment_type: 'delivery', received_at: new Date().toISOString() },
      { ...order(124), fulfillment_type: 'pickup', received_at: new Date().toISOString() },
    ], states: {},
  };
  const sync = vm.runInNewContext(compile(snippet) + '\nsyncLiveOrders;', {
    ...q.environment, ...q, stopped: false, AppState: appState,
    fetch: async () => ({ ok: true, json: async () => response }),
    writeOrderDeviceAuthCache: async () => true,
    readCachedOrderDeviceAuth: async () => true, DEVICE_AUTH_STALE_FALLBACK_MS: 1,
    formatDate: value => value, wcDateToMs: value => new Date(value).getTime(),
    safeParseItems: () => [],
  });
  await sync();
  assert.equal(h.loads.length, 0);
  appState.currentState = 'active';
  const recover = sync();
  await flush();
  h.loads[0].finish();
  await recover;
  assert.equal(q.currentModalOrderIdRef.current, 123);
  assert.equal(q.orderQueueRef.current[0].order.fulfillment_type, 'pickup');
  response = {
    success: true, cursor: 124, orders: [],
    states: { '123': { accepted: { accepted_time: '30 Minutes' }, auto_accepted: true } },
    state_orders: [order(123)],
  };
  await sync();
  assert.ok(q.storage.has('auto_print_123'));
  assert.equal(q.currentModalOrderIdRef.current, 124);
  q.tick();
  await flush();
  h.loads[1].finish();
  await flush();
  response = { success: true, cursor: 124, orders: [], states: { '124': { auto_actioned: true } }, state_orders: [{ ...order(124), status: 'cancelled' }] };
  await sync();
  await flush();
  assert.equal(q.state[1].value, false);
  assert.equal(h.sounds.some(sound => sound.playing), false);
  assert.equal(h.peak(), 1);
  q.unmount();
});

// V2 production-review regressions. Use explicit restaurant/order identities.
for (const state of ['suppressOrderRingtone', 'markOrderRingtoneResolved']) {
  test(`V2 A: ${state} in A does not exclude the same numeric ID in B`, async () => {
    const h = audioHarness(), q = queueHarness(h), c = h.controller;
    const a = c.orderRingtoneKey(' A ', 124), b = c.orderRingtoneKey(' B ', 124);
    c.selectOrderRingtoneRestaurant('a');
    await c[state](a);
    q.storage.set('restaurant_code', 'b');
    await q.refreshRingtoneRestaurant();
    await q.addPendingDecision(124, 'b');
    assert.equal(await q.enqueueOrder({ ...order(124), restaurant_code: 'b' }, true), true);
    const start = q.startOrderSound(b);
    await flush();
    const sound = h.loads[0].finish();
    await start;
    assert.equal(sound.playing, true);
    assert.equal(q.storage.get('pending_decision'), '[124]');
    q.unmount();
    await c.stopAllOrderRingtone();
  });
}

test('V2 B: delayed old-restaurant start/stop/resolution cannot affect B/124', async () => {
  const h = audioHarness(), q = queueHarness(h), c = h.controller;
  const a = c.orderRingtoneKey('a', 124), b = c.orderRingtoneKey('b', 124);
  q.storage.set('restaurant_code', 'a');
  await q.refreshRingtoneRestaurant();
  const old = c.startOrderRingtone(a, 'old');
  await flush();
  q.storage.set('restaurant_code', 'b');
  await q.refreshRingtoneRestaurant();
  await q.enqueueOrder({ ...order(124), restaurant_code: 'b' }, true);
  const next = q.startOrderSound(b);
  const stale = h.loads[0].finish();
  await flush();
  const sound = h.loads[1].finish();
  await Promise.all([old, next]);
  await c.suppressOrderRingtone(a);
  c.resolveOrderRingtone(a);
  await c.startOrderRingtone(a, 'late');
  q.closeOrder(a);
  assert.equal(stale.plays, 0);
  assert.equal(sound.playing, true);
  assert.equal(q.currentModalKeyRef.current.restaurantCode, 'b');
  assert.equal(q.state[1].value, true);
  assert.equal(h.loads.length, 2);
  q.unmount();
  await c.stopAllOrderRingtone();
});

test('V2 C: native stop is invoked before pending playAsync settles', async () => {
  const h = audioHarness(), c = h.controller, key = c.orderRingtoneKey('demo', 123);
  const gate = deferred();
  const start = c.startOrderRingtone(key, 'sound');
  await flush();
  const sound = h.loads[0].finish();
  sound.playAsync = async function () { this.playing = true; await gate.promise; };
  await start;
  const stop = c.suppressOrderRingtone(key);
  assert.ok(sound.stops > 0, 'native stop must be called synchronously');
  assert.equal(sound.playing, false);
  await stop; // stopping must also complete without the play promise
  gate.resolve();
  await flush();
  assert.equal(sound.playing, false);
});

test('V2 D: both cleanup failures block replacement, then a successful retry permits it', async () => {
  const h = audioHarness(), c = h.controller;
  const a = c.orderRingtoneKey('demo', 123), b = c.orderRingtoneKey('demo', 124);
  const first = c.startOrderRingtone(a, 'old');
  await flush();
  const sound = h.loads[0].finish();
  await first;
  const stop = sound.stopAsync, unload = sound.unloadAsync;
  sound.stopAsync = async () => { throw Error('stop failed'); };
  sound.unloadAsync = async () => { throw Error('unload failed'); };
  await c.suppressOrderRingtone(a);
  await c.startOrderRingtone(b, 'new');
  assert.equal(h.loads.length, 1);
  assert.equal(sound.playing, true);
  assert.equal(h.peak(), 1);
  sound.stopAsync = stop;
  sound.unloadAsync = unload;
  const retry = c.startOrderRingtone(b, 'new');
  await flush();
  h.loads[1].finish();
  await retry;
  assert.equal(sound.playing, false);
  assert.equal(h.peak(), 1);
  await c.stopAllOrderRingtone();
});

for (const failingMethod of ['stopAsync', 'unloadAsync']) {
  test(`V2 D: ${failingMethod} alone failing still allows safe replacement`, async () => {
    const h = audioHarness(), c = h.controller;
    const first = c.startOrderRingtone(c.orderRingtoneKey('demo', 123), 'old');
    await flush();
    const sound = h.loads[0].finish();
    await first;
    sound[failingMethod] = async () => { throw Error('one cleanup failure'); };
    const next = c.startOrderRingtone(c.orderRingtoneKey('demo', 124), 'next');
    await flush();
    h.loads[1].finish();
    await next;
    assert.equal(sound.playing, false);
    assert.equal(h.peak(), 1);
    await c.stopAllOrderRingtone();
  });
}

test('V2 E: failed Review decision for a queued order preserves normal promotion', async () => {
  const h = audioHarness(), q = queueHarness(h), c = h.controller;
  await q.enqueueOrder(order(123), true);
  await q.enqueueOrder(order(124), true);
  q.storage.set('pending_decision', '[123,124]');
  const key = c.orderRingtoneKey('demo', 124);
  await c.suppressOrderRingtone(key);
  assert.equal(q.orderQueueRef.current.length, 1);
  c.releaseOrderRingtoneSuppression(key);
  q.closeOrder(123);
  q.tick();
  await flush();
  const sound = h.loads[0].finish();
  await flush();
  assert.equal(q.state[0].value.order_id, 124);
  assert.equal(sound.playing, true);
  assert.equal(q.storage.get('pending_decision'), '[123,124]');
  q.unmount();
  await c.stopAllOrderRingtone();
});

function rootDecisionCallbacks(h, q, currentOrder) {
  const source = ts.createSourceFile('layout.tsx', read('app/_layout.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = {};
  function visit(node) {
    if (ts.isJsxAttribute(node) && ['onDecisionStart', 'onDecisionMade', 'onDecisionFailed', 'onClose'].includes(node.name.text)) {
      callbacks[node.name.text] = vm.runInNewContext(compile(`const fn = ${node.initializer.expression.getText(source)}; fn;`), {
        ...q.environment, ...q, ...h.controller, newOrderModal: currentOrder,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return callbacks;
}

test('V2 F/G: local rejection marks resolved but next modal waits for printing and onClose', async () => {
  const h = audioHarness(), q = queueHarness(h), c = h.controller, print = deferred();
  const current = { ...order(123), restaurant_code: 'demo' };
  await q.enqueueOrder(current, true);
  await q.enqueueOrder(order(124), true);
  q.storage.set('pending_decision', '[123,124]');
  const events = [], callbacks = rootDecisionCallbacks(h, q, current);
  const source = read('components/AcceptRejectModal.tsx');
  const helper = source.slice(source.indexOf('  const removePendingDecision ='), source.indexOf('  if (!order) return null;'));
  const handlers = source.slice(source.indexOf('  const handleConfirmAcceptWithTime ='), source.indexOf('\n  return (\n    <Modal'));
  const reject = vm.runInNewContext(compile(helper + handlers) + '\nhandleConfirmReject;', {
    ...q.environment, ...callbacks, order: current, selectedReason: 'Busy', customReason: '', t: { other: 'Other' },
    setLoading() {}, setCountdown() {}, postWordPressDecision: async () => {}, postDecisionAction: async () => ({ success: true }),
    fetch: async () => ({ json: async () => ({ profile: { website: 'https://example.invalid' } }) }),
    onDecisionMade: id => { events.push('remove pending'); callbacks.onDecisionMade(id); },
    printDecisionOnce: async (_action, _order, job) => job(),
    printOrder: async () => { events.push('print starts'); await print.promise; events.push('print completes'); },
    onClose: () => { events.push('modal closes'); callbacks.onClose(); },
  });
  const decision = reject();
  await flush();
  assert.deepEqual(events, ['remove pending', 'print starts']);
  assert.equal(c.isOrderRingtoneResolved(c.orderRingtoneKey('demo', 123)), true);
  assert.equal(q.currentModalOrderIdRef.current, 123);
  c.resolveOrderRingtone(c.orderRingtoneKey('demo', 123)); // own backend echo during print
  q.tick();
  assert.equal(q.currentModalOrderIdRef.current, 123);
  print.resolve();
  await decision;
  assert.deepEqual(events, ['remove pending', 'print starts', 'print completes', 'modal closes']);
  assert.equal(q.currentModalOrderIdRef.current, 124);
  q.tick();
  assert.equal(q.state[0].value.order_id, 124);
  q.unmount();
  await c.stopAllOrderRingtone();
});

test('V2 H: external resolution dismisses only the exact restaurant and order', async () => {
  const h = audioHarness(), q = queueHarness(h), c = h.controller;
  await q.enqueueOrder(order(124), true);
  c.resolveOrderRingtone(c.orderRingtoneKey('other', 124));
  c.resolveOrderRingtone(c.orderRingtoneKey('demo', 123));
  assert.equal(q.state[1].value, true);
  c.resolveOrderRingtone(c.orderRingtoneKey('demo', 124));
  assert.equal(q.state[1].value, false);
  q.unmount();
});

test('V2 failure callback releases suppression and permits retry after the existing close', async () => {
  const h = audioHarness(), q = queueHarness(h), c = h.controller;
  const current = { ...order(123), restaurant_code: 'demo' };
  await q.enqueueOrder(current, true);
  q.storage.set('pending_decision', '[123]');
  const callbacks = rootDecisionCallbacks(h, q, current);
  await callbacks.onDecisionStart(123);
  callbacks.onDecisionFailed(123);
  callbacks.onClose();
  q.tick();
  await flush();
  const sound = h.loads[0].finish();
  await flush();
  assert.equal(c.isOrderRingtoneSuppressed(c.orderRingtoneKey('demo', 123)), false);
  assert.equal(c.isOrderRingtoneResolved(c.orderRingtoneKey('demo', 123)), false);
  assert.equal(q.state[0].value.order_id, 123);
  assert.equal(sound.playing, true);
  assert.equal(q.storage.get('pending_decision'), '[123]');
  q.unmount();
  await c.stopAllOrderRingtone();
});

test('V2 late restaurant-storage read cannot switch the controller back to A', async () => {
  const h = audioHarness(), q = queueHarness(h), c = h.controller, oldRead = deferred();
  await flush();
  const originalGet = q.environment.AsyncStorage.getItem;
  q.environment.AsyncStorage.getItem = key => key === 'restaurant_code' ? oldRead.promise : originalGet(key);
  const stale = q.refreshRingtoneRestaurant();
  q.environment.AsyncStorage.getItem = originalGet;
  q.storage.set('restaurant_code', 'b');
  await q.refreshRingtoneRestaurant();
  await q.enqueueOrder({ ...order(124), restaurant_code: 'b' }, true);
  const start = q.startOrderSound(c.orderRingtoneKey('b', 124));
  await flush();
  const sound = h.loads[0].finish();
  await start;
  oldRead.resolve('a');
  assert.equal(await stale, 'b');
  assert.equal(sound.playing, true);
  q.unmount();
  await c.stopAllOrderRingtone();
});

test('V2 concurrent scope polling does not discard a valid ringtone start', async () => {
  const h = audioHarness(), q = queueHarness(h), gate = deferred();
  await q.enqueueOrder(order(123), true);
  const originalGet = q.environment.AsyncStorage.getItem;
  q.environment.AsyncStorage.getItem = key => key === 'restaurant_code' ? gate.promise : originalGet(key);
  const start = q.startOrderSound(123);
  q.environment.AsyncStorage.getItem = originalGet;
  await q.refreshRingtoneRestaurant();
  gate.resolve('demo');
  await flush();
  const sound = h.loads[0].finish();
  await start;
  assert.equal(sound.playing, true);
  q.unmount();
  await h.api.stopAllOrderRingtone();
});
