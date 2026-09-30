// One OBS seat: shows the guest's VDO.Ninja video, passes their BUZZ presses to the engine,
// and sends them their live status (armed / you're up / locked...) back over the same connection.
const qs = new URLSearchParams(location.search);
const N = +(qs.get('n') || 1), I = N - 1;
const frame = document.getElementById('v'), dbg = document.getElementById('dbg');
if (qs.has('debug')) dbg.style.display = 'block';
let key = null, lastSent = '';
// Diagnostics: seat events show up in Streamer.bot's log as a request for "JQ Seat Ping" (no such action; harmless)
function ping(ev) { try { JQ.sendAction('JQ Seat Ping', { n: N, ev: String(ev).slice(0, 120) }); } catch (e) {} }
function load(k) {
  if (!k || k === key) return; key = k; ping('load view ' + k + 'p' + N);
  frame.src = `https://vdo.ninja/?view=${k}p${N}&cleanoutput&transparent&noaudioprocessing`;
}
function push(force) {
  const now = JQ.now(), st = seatStatus(JQ.state, I, now), view = playerView(JQ.state, I, now);
  const left = view ? view.left : undefined; if (view) delete view.left;
  const msg = JSON.stringify([st, view]);                        // timer countdown doesn't count as a change
  if (!force && msg === lastSent) return; lastSent = msg;
  const out = Object.assign({ jq: 'status', v: view }, st); if (left != null) out.left = left;
  // viewer -> publisher must use 'rpcs' ('pcs' only reaches our own viewers; verified live)
  try { frame.contentWindow.postMessage({ sendData: out, type: 'rpcs' }, '*'); } catch (e) {}
  dbg.textContent = `P${N}: ${st.state}`;
}
window.addEventListener('message', e => {
  if (e.source !== frame.contentWindow || !e.data) return;
  if (e.data.action && !/stats|mute-state|info|bitrate|resolution/.test(e.data.action)) ping('vdo ' + e.data.action + ' ' + JSON.stringify(e.data.value === undefined ? '' : e.data.value).slice(0, 60));
  const d = e.data.dataReceived;
  if (d && d.jq !== 'hello' && d.jq !== 'fanswer') ping('data ' + (d.jq || '?'));
  if (d && d.jq === 'buzz') { JQ.send('buzz', { n: N }); dbg.textContent = `P${N}: BUZZ received`; }
  if (d && d.jq === 'hello') push(true);
  // Daily Double / Final Jeopardy wager typed privately on the guest's page (engine checks 0..score)
  if (d && d.jq === 'wager' && JQ.state && (JQ.state.phase === 'final_cat' || JQ.state.phase === 'dd_wager')) { JQ.send('wager', { n: N, v: Math.max(0, parseInt(d.v, 10) || 0) }); setTimeout(() => push(true), 400); }
  // Final Jeopardy written answer (saved as they type; engine locks it when the clock runs out)
  if (d && d.jq === 'fanswer' && JQ.state && JQ.state.phase === 'final_clue') { JQ.send('finalanswer', { n: N, text: String(d.text || '').slice(0, 60) }); setTimeout(() => push(true), 300); }
  if (e.data.action === 'view-connection' || e.data.action === 'guest-connected') setTimeout(() => push(true), 500);
});
const SEAT_VER = '5';   // bump when seat code changes; shows in Streamer.bot's log
JQ.onStatus(ok => ok && ping('ws up v' + SEAT_VER + ', frame=' + (frame.src ? 'set' : 'empty')));
JQ.on(s => { load(s.settings && s.settings.vdoKey); push(false); });
setInterval(() => push(true), 2000);                           // heartbeat so a reconnecting guest catches up
setInterval(() => push(false), 150);                           // early-lockout expiry etc.
