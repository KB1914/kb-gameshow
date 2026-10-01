// JQ client: connects to Streamer.bot's WebSocket server, keeps the latest game state,
// and lets pages send commands to the "JQ Engine" action.
(function () {
  const qs = new URLSearchParams(location.search);
  const WS_URL = qs.get('ws') || 'ws://127.0.0.1:8080/';
  const ACTION = qs.get('action') || 'JQ Engine';
  const listeners = [];
  let ws, state = null, offset = 0, retry = 0, reqId = 0, connected = false;

  function emit() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }
  function status(ok) {
    connected = ok;
    document.documentElement.dataset.ws = ok ? 'up' : 'down';
    listeners.forEach(fn => fn.status && fn.status(ok));
  }

  function connect() {
    try { ws = new WebSocket(WS_URL); } catch (e) { return later(); }
    ws.onopen = () => {
      retry = 0; status(true);
      ws.send(JSON.stringify({ request: 'Subscribe', id: 'jq-sub', events: { General: ['Custom'] } }));
      send('sync');
    };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      const d = (msg && msg.data) || msg || {};
      const note = msg.jqmsg || d.jqmsg;
      if (note) { listeners.forEach(fn => fn.note && fn.note(note)); return; }
      const jq = msg.jq || d.jq;
      if (!jq) return;
      if (jq.now) offset = jq.now - Date.now();
      state = jq; emit();
    };
    ws.onclose = () => { status(false); later(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function later() { setTimeout(connect, Math.min(5000, 500 * ++retry)); }

  function send(cmd, extra) { return sendAction(ACTION, Object.assign({ cmd }, extra || {})); }
  function sendAction(name, argsIn) {
    if (!ws || ws.readyState !== 1) return false;
    const args = Object.assign({}, argsIn || {});
    Object.keys(args).forEach(k => args[k] = String(args[k]));
    ws.send(JSON.stringify({ request: 'DoAction', id: 'jq-' + (++reqId), action: { name }, args }));
    return true;
  }

  window.JQ = {
    on(fn) { listeners.push(fn); if (state) fn(state); },
    onStatus(fn) { const w = () => {}; w.status = fn; listeners.push(w); fn(connected); },
    send, sendAction,
    onNote(fn) { const w = () => {}; w.note = fn; listeners.push(w); },
    now() { return Date.now() + offset; },
    get state() { return state; },
    // test hook: lets a page render a state without a server
    _inject(s) { if (s.now) offset = s.now - Date.now(); state = s; emit(); }
  };
  if (!qs.has('nows')) connect();
})();

// Shared helpers
window.fmt = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Which clock is running right now: the buzz-in window, the answer clock (someone rang in), or Final.
// Shared by the stream, sounds, host panel and phones so they never disagree.
window.activeTimer = function (s) {
  if (!s) return null;
  if (s.phase === 'final_clue' && s.final && s.final.endsAt) return { kind: 'final', endsAt: s.final.endsAt, seconds: s.final.seconds || 30, key: 'final' + s.final.endsAt };
  const c = s.clue;
  if (s.phase !== 'clue' || !c) return null;
  if (s.active >= 0 && c.answerEndsAt) return { kind: 'answer', endsAt: c.answerEndsAt, seconds: c.answerSeconds || 5, key: 'ans' + c.answerEndsAt };
  if (c.endsAt) return { kind: 'buzz', endsAt: c.endsAt, seconds: c.seconds || 8, key: 'buzz' + c.endsAt };
  return null;
};

// What a guest in seat i (0-based) should see on their buzzer. Shared by seat.html and tests.
window.seatStatus = function (s, i, now) {
  if (!s) return { state: 'offline', text: 'Connecting to the show...' };
  const p = s.players[i] || {}, c = s.clue, b = s.buzz || {};
  const base = { name: p.name, score: p.score, muted: !!p.muted };
  if (s.onBreak) return Object.assign(base, { state: 'waiting', text: 'On a break. Hang tight.' });
  const ph = s.phase || '';
  if (ph === 'final_cat') return Object.assign(base, { state: 'waiting', text: 'Final Jeopardy: lock in your wager' });
  if (ph === 'final_clue') return Object.assign(base, { state: 'waiting', text: 'Final Jeopardy: think it through' });
  if (ph === 'final_answer') return Object.assign(base, { state: 'waiting', text: 'Final Jeopardy: answers are in' });
  if (ph === 'scores') return Object.assign(base, { state: 'waiting', text: 'Scoreboard' });
  const ddName = c && c.ddPlayer >= 0 ? (s.players[c.ddPlayer] || {}).name : null;
  if (ph === 'dd_wager' && c) return Object.assign(base, c.ddPlayer === i
    ? { state: 'up', text: c.wager != null ? 'Wager locked in. Get ready!' : 'Your Daily Double! Enter your wager' }
    : { state: 'locked', text: ddName ? 'Daily Double: ' + ddName + ' is playing' : 'Daily Double' });
  if (ph === 'answer') return Object.assign(base, { state: 'waiting', text: 'Answer revealed. Next clue soon' });
  if (!c || ph !== 'clue') return Object.assign(base, { state: 'waiting', text: 'Board is up. Next clue coming' });
  if (c.dd) return Object.assign(base, c.ddPlayer === i ? { state: 'up', text: "Daily Double. You're up!" } : { state: 'locked', text: 'Daily Double: ' + (ddName || 'another player') + ' is playing' });
  if ((c.attempted || []).includes(i)) return Object.assign(base, { state: 'out', text: 'You already answered this one' });
  if (s.active === i) return Object.assign(base, { state: 'up', text: c.answerEndsAt && now > c.answerEndsAt ? "Time! Give your answer" : "YOU'RE UP! Answer now." });
  if (s.active >= 0) return Object.assign(base, { state: 'locked', text: (s.players[s.active] || {}).name + ' is answering' });
  const lock = (b.lockUntil || [])[i] || 0;
  if (b.armed && c.endsAt && now > c.endsAt) return Object.assign(base, { state: 'locked', text: "Time's up" });
  if (b.armed) return Object.assign(base, now < lock ? { state: 'early', text: 'Too early! Locked for a moment' } : { state: 'armed', text: 'BUZZ NOW!' });
  if (now < lock) return Object.assign(base, { state: 'early', text: 'Too early! Locked for a moment' });
  return Object.assign(base, { state: 'ready', text: 'Host is reading. Wait for the green button' });
};

// Everything a guest's buzzer page shows besides the buzz status. Never includes an answer
// before it's revealed. `left` = ms remaining on the running timer at send time.
window.playerView = function (s, i, now) {
  if (!s) return null;
  const ph = s.phase, c = s.clue, f = s.final || {};
  const v = {
    ph, me: i, onBreak: !!s.onBreak,
    scores: (s.players || []).map(p => [p.name, p.score]),
  };
  if (ph === 'board' && s.board) {
    v.board = { c: s.board.categories, v: s.board.values, used: s.used || [] };
  }
  if (c && (ph === 'clue' || ph === 'answer' || ph === 'dd_wager')) {
    v.clue = { cat: c.category, val: c.value, dd: !!c.dd, ddp: c.ddPlayer, ddn: c.ddPlayer >= 0 ? (s.players[c.ddPlayer] || {}).name : null, wager: c.wager };
    if (ph !== 'dd_wager') v.clue.q = c.q;
    const at = window.activeTimer(s);
    if (ph === 'clue' && at) { v.left = Math.max(0, at.endsAt - now); v.tk = at.kind; v.ts = at.seconds; }
    if (ph === 'dd_wager' && c.ddPlayer === i) {   // private wager box for the Daily Double player
      const me = (s.players || [])[i] || {}, vals = (s.board && s.board.values) || [0];
      v.ddw = { max: Math.max(me.score || 0, Math.max.apply(null, vals)), wager: c.wager };
    }
    if (ph === 'answer') v.clue.a = c.a;
  }
  if (ph && ph.indexOf('final') === 0) {
    const me = (s.players || [])[i] || {};
    v.final = { cat: f.category, wager: me.wager || 0, max: Math.max(me.score || 0, 0), res: me.final || null, mine: me.fans || '', shown: !!me.fshown };
    if (ph !== 'final_cat') v.final.q = f.q;
    if (ph === 'final_clue' && f.endsAt) { v.left = Math.max(0, f.endsAt - now); v.tk = 'final'; v.ts = f.seconds || 30; }
    v.final.open = ph === 'final_clue' && !(f.endsAt && now > f.endsAt + 2000);   // answer box open
    if (f.aShown) v.final.a = f.a;                                                 // correct answer only once revealed
  }
  return v;
};
