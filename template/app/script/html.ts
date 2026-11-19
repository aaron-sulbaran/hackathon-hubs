// The pitch dry run script page (GET /script). Plain HTML and one inline script, kept as two strings
// so the route can wrap them in a document. The lines are not here: the route reads them from
// kb/pitch-script.md plus saved edits and passes them in a script#script-data element.
export const SCRIPT_HEAD = String.raw`<title>Pitch Dry Run Script</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap">
<style>
  /* Layout: one reading column, a sticky clock bar on top, each part a run-sheet block of numbered cues. */
  :root {
    --bg: #F3EEE9; --surface: #FFFCF8; --ink: #26345B; --muted: #565E80; --rule: #E4DAD0;
    --accent: #334169; --accent-soft: #E5EEFB;
    --quiet-bg: #F7F1EA; --quiet-ink: #565E80;
    --good: #2F6B55; --warn: #8A5A1F; --bad: #9C4A59; --cut-bg: #FBEBD9;
    --sp-1: #3E5BA0; --sp-2: #9C4A59; --sp-3: #8A5A1F; --sp-4: #2F6B55; --sp-5: #7A5B0E; --sp-6: #5B4B8A; --sp-open: #565E80;
    --font-display: "Lexend", "Avenir Next", "Segoe UI", system-ui, sans-serif;
    --font-body: "Lexend", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, "SF Mono", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #121829; --surface: #1A2238; --ink: #F3EEE9; --muted: #B3BAD3; --rule: #323C5C;
      --accent: #A8C4F0; --accent-soft: #26355C;
      --quiet-bg: #232C47; --quiet-ink: #B3BAD3;
      --good: #9BD3B4; --warn: #F2C89D; --bad: #E9A6B1; --cut-bg: #3A2F2A;
      --sp-1: #A8C4F0; --sp-2: #E9A6B1; --sp-3: #F2C89D; --sp-4: #9BD3B4; --sp-5: #F3DA97; --sp-6: #D5C8EE; --sp-open: #B3BAD3;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #121829; --surface: #1A2238; --ink: #F3EEE9; --muted: #B3BAD3; --rule: #323C5C;
    --accent: #A8C4F0; --accent-soft: #26355C;
    --quiet-bg: #232C47; --quiet-ink: #B3BAD3;
    --good: #9BD3B4; --warn: #F2C89D; --bad: #E9A6B1; --cut-bg: #3A2F2A;
    --sp-1: #A8C4F0; --sp-2: #E9A6B1; --sp-3: #F2C89D; --sp-4: #9BD3B4; --sp-5: #F3DA97; --sp-6: #D5C8EE; --sp-open: #B3BAD3;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.5; }
  body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--surface); }
  .wrap { max-width: 880px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:focus-visible, .cue:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

  /* Clock bar */
  .clock { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 9; background: var(--surface); border-bottom: 1px solid var(--rule); }
  .clock .wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding-block: 10px; }
  .time { font-family: var(--font-mono); font-weight: 700; font-size: 34px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1; min-width: 4.2ch; }
  .time.over { color: var(--bad); }
  .of { font-family: var(--font-mono); font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .now { flex: 1 1 200px; min-width: 0; }
  .now b { display: block; font-family: var(--font-display); font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .now span { font-size: 12.5px; color: var(--muted); }
  .now .share { display: block; font-size: 12px; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { border: 1px solid var(--rule); background: var(--surface); border-radius: 9px; padding: 9px 14px; font-weight: 600; font-size: 14px; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #FFFFFF; }
  :root[data-theme="dark"] .btn.primary { color: #06101F; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .btn.primary { color: #06101F; } }
  .btn:disabled { opacity: 0.45; cursor: default; }

  header.top { padding-block: 26px 6px; }
  header.top h1 { font-family: var(--font-display); font-weight: 800; font-size: clamp(28px, 5vw, 40px); line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 8px; text-wrap: balance; }
  header.top p { margin: 0; color: var(--muted); max-width: 62ch; }

  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 18px 0 6px; font-size: 13px; color: var(--muted); align-items: center; }
  .legend > span { display: inline-flex; align-items: center; gap: 6px; }
  .who { display: inline-flex; align-items: center; gap: 7px; font-family: var(--font-display); font-weight: 700; font-size: 13px; color: var(--c); white-space: nowrap; }
  .who i { width: 22px; height: 22px; border-radius: 50%; background: var(--c); color: var(--surface); display: inline-grid; place-items: center; font-style: normal; font-size: 12px; }
  .tag { font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; border-radius: 5px; padding: 2px 6px; white-space: nowrap; }
  .tag.quiet { background: var(--quiet-bg); color: var(--quiet-ink); }
  .tag.tap { background: var(--accent-soft); color: var(--accent); }
  .tag.wait { border: 1px solid var(--rule); color: var(--muted); }
  .tag.cut { background: var(--cut-bg); color: var(--warn); }
  .tag.draft { border: 1px dashed var(--warn); color: var(--warn); }
  /* Cue tags carry whatever the kb page says (a long wait, a long tap), so they wrap on a phone. */
  .cue .meta .tag { white-space: normal; overflow-wrap: anywhere; }

  .note { margin: 14px 0 0; padding: 12px 14px; border-left: 4px solid var(--warn); background: var(--surface); border-radius: 0 8px 8px 0; font-size: 14.5px; }
  .note b { font-family: var(--font-display); }
  #sourceNote { border-left-color: var(--bad); }

  section.part { margin-top: 30px; }
  .part-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; padding-bottom: 10px; border-bottom: 2px solid var(--ink); }
  .part-head .num { font-family: var(--font-mono); font-weight: 700; font-size: 13px; color: var(--muted); }
  .part-head h2 { font-family: var(--font-display); font-weight: 800; font-size: clamp(20px, 3.4vw, 26px); letter-spacing: -0.01em; margin: 0; flex: 1 1 240px; min-width: 0; text-wrap: balance; }
  .part-head .target { font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
  .part-head .target b { color: var(--ink); }
  .part-head .actual { font-family: var(--font-mono); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .part-head .actual.good { color: var(--good); } .part-head .actual.bad { color: var(--bad); }
  .part.active .part-head { border-bottom-color: var(--accent); }
  .part.active .part-head h2 { color: var(--accent); }
  .sub { margin: 16px 0 2px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 13.5px; color: var(--muted); }

  .cue { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 0 12px; padding: 12px 0; border-bottom: 1px solid var(--rule); border-radius: 4px; }
  .cue .n { font-family: var(--font-mono); font-size: 12.5px; font-weight: 500; color: var(--muted); padding-top: 4px; font-variant-numeric: tabular-nums; }
  .cue .body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  .cue .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
  .cue .line { font-size: 19px; line-height: 1.38; font-weight: 500; margin: 0; max-width: 60ch; }
  .cue .dir { font-size: 14.5px; color: var(--muted); margin: 0; max-width: 64ch; }
  .cue.is-quiet .dir { font-style: italic; color: var(--quiet-ink); font-size: 16px; }
  .cue .cutbtn { margin-left: auto; border: 1px solid var(--rule); background: transparent; border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 600; color: var(--muted); }
  .cue.is-cut { opacity: 0.45; }
  .cue.is-cut .line, .cue.is-cut .dir { text-decoration: line-through; }
  .cue.is-cut .cutbtn { color: var(--warn); border-color: var(--warn); }

  table.times { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14.5px; }
  .times th, .times td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--rule); }
  .times th { font-family: var(--font-mono); font-size: 11.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .times td.t { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .times td.good { color: var(--good); font-weight: 700; } .times td.bad { color: var(--bad); font-weight: 700; }
  .times tr.total td { border-bottom: 0; font-weight: 700; border-top: 2px solid var(--ink); }
  .scroll { overflow-x: auto; }
  footer { padding-block: 28px 40px; color: var(--muted); font-size: 13px; }
  .cue .actions { margin-left: auto; display: inline-flex; gap: 6px; }
  .cue .actions .cutbtn { margin-left: 0; }
  .tag.edited { border: 1px dashed var(--accent); color: var(--accent); }
  .editbar { margin: 12px 0 0; font-size: 13.5px; color: var(--muted); display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
  .editbar a { color: var(--accent); font-weight: 600; }
  .editbar .btn { padding: 7px 14px; }
  .editbar .btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #FFFFFF; }
  :root[data-theme="dark"] .editbar .btn[aria-pressed="true"] { color: #06101F; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .editbar .btn[aria-pressed="true"] { color: #06101F; } }
  /* My lines only: other people's cues hide, except the one just before each of yours (dimmed, your cue to come in). */
  .mine-on .cue.not-mine:not(.is-leadin), .mine-on .sub.cue-sub { display: none; }
  .mine-on .cue.is-leadin { opacity: 0.5; }
  .mine-on .cue.is-leadin .actions { display: none; }
  .editor { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
  .editor .field { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
  .editor textarea { font: inherit; font-size: 16px; font-weight: 400; line-height: 1.4; color: var(--ink); background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; resize: vertical; min-height: 64px; width: 100%; }
  .editor textarea:focus { outline: 3px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .editor-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .editor-status { font-size: 13px; color: var(--muted); }
  .editor-status.bad { color: var(--bad); font-weight: 600; }
  @media (max-width: 520px) { .time { font-size: 28px; } .cue { grid-template-columns: 30px minmax(0, 1fr); } .cue .line { font-size: 18px; } }
  @media (prefers-reduced-motion: no-preference) { .cue, .part-head { transition: opacity .15s ease, border-color .15s ease; } }
</style>`;

export const SCRIPT_BODY = String.raw`<div class="clock">
  <div class="wrap">
    <div>
      <div class="time" id="clock" aria-live="off">0:00</div>
      <div class="of" id="ofTotal">of 5:00</div>
    </div>
    <div class="now"><b id="nowTitle">Not started</b><span id="nowHint">Press Start as the first slide comes up.</span><span class="share" id="clockShare"></span></div>
    <div class="controls">
      <button class="btn primary" id="startBtn" type="button">Start</button>
      <button class="btn" id="nextBtn" type="button" disabled>End of part</button>
      <button class="btn" id="resetBtn" type="button">Reset</button>
    </div>
  </div>
</div>

<div class="wrap">
  <header class="top">
    <h1>Pitch dry run script</h1>
    <p>Every line and tap in order, as the demo runs. Read it aloud with the clock running. Press <b>End of part</b> each time a part finishes and the table at the bottom fills in.</p>
    <div class="legend" id="legend"></div>
    <p class="editbar" id="editBar"></p>
    <p class="note" id="sourceNote" hidden></p>
    <p class="note" id="beforeNote"></p>
  </header>

  <main id="parts"></main>

  <section class="part" aria-labelledby="timesH">
    <div class="part-head"><span class="num">TIMES</span><h2 id="timesH">Target against this run</h2></div>
    <div class="scroll">
      <table class="times">
        <thead><tr><th>Part</th><th>Target</th><th>This run</th><th>Over or under</th></tr></thead>
        <tbody id="timesBody"></tbody>
      </table>
    </div>
    <p class="note" id="measuredNote"></p>
  </section>

  <footer id="footer"></footer>
</div>

<script>
(function () {
  // The script: kb/pitch-script.md with saved edits applied, from the route. A cue's kind is
  // say (they speak), quiet (screen leads) or both (let it land, then speak); cut marks a cut candidate.
  var CONFIG = JSON.parse(document.getElementById("script-data").textContent);
  // Presenters come from team.json, in its order; each takes the speaker color at their place, the same order as the board's people colors (lib/web/people.ts).
  var PEOPLE = { open: { name: "Presenter not set", color: "var(--sp-open)" } };
  var TEAM = (CONFIG.people || []).map(function (p) { return p.id; });
  (CONFIG.people || []).forEach(function (p, i) { PEOPLE[p.id] = { name: p.name, color: "var(--sp-" + ((i % 6) + 1) + ")" }; });
  var DATA = CONFIG.script;
  var PARTS = DATA.parts;
  var TOTAL_TARGET = DATA.totalTarget;
  // A part with a 0:00 target is an extra (an appendix, only if asked): its cues stay on the page,
  // but the clock, the times table and the total leave it out, and the pitch ends before it.
  var TIMED = PARTS.filter(function (p) { return p.target > 0; });
  if (!TIMED.length) TIMED = PARTS;
  function partNumber(p) { return PARTS.indexOf(p) + 1; }
  // Who is holding this device: the board's own picker (same origin, same storage).
  var WHO = null;
  try { WHO = localStorage.getItem("hub-who"); } catch (e) { WHO = null; }
  if (!WHO || WHO === "open" || !PEOPLE[WHO]) WHO = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmt(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function whoChip(key) { var p = PEOPLE[key] || { name: key, color: "var(--sp-open)" }; var w = el("span", "who"); w.style.setProperty("--c", p.color); var i = el("i", null, key === "open" ? "?" : p.name[0]); w.appendChild(i); w.appendChild(document.createTextNode(p.name)); return w; }

  var cuts = {};
  try { cuts = JSON.parse(localStorage.getItem("dryrun-cuts") || "{}") || {}; } catch (e) { cuts = {}; }
  function saveCuts() { try { localStorage.setItem("dryrun-cuts", JSON.stringify(cuts)); } catch (e) {} }

  // Legend
  var legend = document.getElementById("legend");
  TEAM.forEach(function (k) { var s = el("span"); s.appendChild(whoChip(k)); legend.appendChild(s); });
  [["quiet", "Quiet", "the screen leads, nobody speaks"], ["tap", "Tap", "someone acts on the demo device, or it is handed over"], ["wait", "Wait", "a pause while the demo responds"], ["cut", "Cut?", "first to go if you are over"]].forEach(function (t) {
    var s = el("span"); s.appendChild(el("span", "tag " + t[0], t[1])); s.appendChild(document.createTextNode(t[2])); legend.appendChild(s);
  });

  // Notes: **bold** and new lines, built as nodes (never as HTML).
  function rich(node, text) {
    String(text || "").split("\n").forEach(function (lineText, li) {
      if (li > 0) node.appendChild(document.createElement("br"));
      lineText.split(/\*\*(.+?)\*\*/).forEach(function (piece, pi) {
        if (piece) node.appendChild(pi % 2 ? el("b", null, piece) : document.createTextNode(piece));
      });
    });
  }
  function note(id, heading, text) {
    var node = document.getElementById(id);
    if (heading) { node.appendChild(el("b", null, heading)); node.appendChild(document.createTextNode(" ")); }
    rich(node, text);
  }
  note("beforeNote", "Before you start.", DATA.beforeYouStart);
  note("measuredNote", "What the rehearsal measured.", DATA.measured);
  note("footer", null, DATA.footer);
  document.getElementById("ofTotal").textContent = "of " + fmt(TOTAL_TARGET);
  if (CONFIG.problem) {
    var sourceNote = document.getElementById("sourceNote");
    note("sourceNote", "Showing the built-in copy of the script.", CONFIG.problem + " Fix kb/pitch-script.md and reload; edits saved here still apply.");
    sourceNote.hidden = false;
  }
  if (CONFIG.writesOff) {
    var offNote = document.getElementById("sourceNote");
    if (CONFIG.problem) offNote.appendChild(document.createElement("br"));
    note("sourceNote", "Saving is off.", CONFIG.writesOff + " Line edits and the shared clock stay on this phone until then.");
    offNote.hidden = false;
  }

  // Who may edit: your own lines, and any line with no presenter yet.
  var editBar = document.getElementById("editBar");
  var MINE_KEY = "hub-script-mine";
  var mineOn = false;
  try { mineOn = !!WHO && localStorage.getItem(MINE_KEY) === "1"; } catch (e) { mineOn = false; }
  var mineBtn = null;
  if (WHO) {
    mineBtn = el("button", "btn", "My lines only"); mineBtn.type = "button"; mineBtn.setAttribute("aria-pressed", "false");
    mineBtn.addEventListener("click", function () {
      mineOn = !mineOn;
      try { localStorage.setItem(MINE_KEY, mineOn ? "1" : "0"); } catch (e) {}
      applyFilter();
    });
    editBar.appendChild(mineBtn);
    editBar.appendChild(document.createTextNode("Editing as"));
    editBar.appendChild(whoChip(WHO));
    editBar.appendChild(document.createTextNode("Tap Edit on your own lines to change them for everyone. Others see a save within about 30 seconds."));
  } else {
    var ask = el("span"); ask.appendChild(document.createTextNode("To edit your own lines, "));
    var pick = el("a", null, "pick who you are on the board"); pick.href = CONFIG.homeUrl; ask.appendChild(pick);
    ask.appendChild(document.createTextNode(", then come back.")); editBar.appendChild(ask);
  }
  function canEdit(c) { return !!WHO && (c.who === WHO || c.who === "open"); }
  function nameOf(id) { return PEOPLE[id] ? PEOPLE[id].name : id; }

  // A half typed edit survives a reload of this tab.
  function readDraft(key) { try { var v = sessionStorage.getItem("script-draft:" + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeDraft(key, value) { try { sessionStorage.setItem("script-draft:" + key, JSON.stringify(value)); } catch (e) {} }
  function clearDraft(key) { try { sessionStorage.removeItem("script-draft:" + key); } catch (e) {} }

  // A save shows here at once; the hub copy can take a few seconds to catch up, so a reload
  // in the next three minutes keeps this tab's newer copy of the cue.
  var PENDING_MS = 3 * 60 * 1000;
  var pending = {};
  try { pending = JSON.parse(sessionStorage.getItem("script-pending") || "{}") || {}; } catch (e) { pending = {}; }
  function savePending() { try { sessionStorage.setItem("script-pending", JSON.stringify(pending)); } catch (e) {} }
  function remember(key, c) { pending[key] = { savedMs: Date.now(), cue: { line: c.line, dir: c.dir, base: c.base, edited: c.edited } }; savePending(); }
  PARTS.forEach(function (part) {
    part.cues.forEach(function (c) {
      if (c.sub) return;
      var key = part.id + ":" + c.n, p = pending[key];
      if (!p) return;
      if (Date.now() - p.savedMs > PENDING_MS || (c.edited && p.cue.edited && c.edited.at >= p.cue.edited.at)) { delete pending[key]; return; }
      ["line", "dir", "base", "edited"].forEach(function (f) { if (p.cue[f] == null) delete c[f]; else c[f] = p.cue[f]; });
    });
  });
  savePending();

  // Parts
  var host = document.getElementById("parts");
  PARTS.forEach(function (part, pi) {
    var sec = el("section", "part"); sec.id = part.id;
    var head = el("div", "part-head");
    head.appendChild(el("span", "num", "PART " + (pi + 1)));
    head.appendChild(el("h2", null, part.title));
    var target = el("span", "target");
    if (TIMED.indexOf(part) >= 0) { target.appendChild(document.createTextNode("target ")); target.appendChild(el("b", null, fmt(part.target))); }
    else target.textContent = "not timed";
    head.appendChild(target);
    var actual = el("span", "actual"); actual.id = part.id + "-actual"; head.appendChild(actual);
    sec.appendChild(head);
    sec.appendChild(el("div", "sub", part.by));
    part.cues.forEach(function (c) {
      if (c.sub) { sec.appendChild(el("div", "sub cue-sub", c.sub)); return; }
      sec.appendChild(renderCue(part, c));
    });
    host.appendChild(sec);
  });
  applyFilter();

  // Who is on each cue decides the filter: your cues and "open" ones (said by everyone). The clock
  // and the times table do not look at cues, so they keep counting the whole pitch.
  function isMine(who) { return who === WHO || who === "open"; }
  function applyFilter() {
    var on = !!(mineOn && WHO);
    document.body.classList.toggle("mine-on", on);
    Array.prototype.forEach.call(host.querySelectorAll("section.part"), function (sec) {
      var prev = null, prevMine = false, any = false;
      Array.prototype.forEach.call(sec.querySelectorAll(".cue"), function (row) {
        var mine = isMine(row.getAttribute("data-who"));
        row.classList.toggle("not-mine", !mine);
        row.classList.remove("is-leadin");
        if (mine && prev && !prevMine) prev.classList.add("is-leadin");
        if (mine) any = true;
        prev = row; prevMine = mine;
      });
      var none = sec.querySelector(".none-mine");
      if (none) sec.removeChild(none);
      if (on && !any) sec.appendChild(el("div", "sub none-mine", "No lines for you in this part."));
    });
    if (mineBtn) { mineBtn.setAttribute("aria-pressed", on ? "true" : "false"); mineBtn.textContent = on ? "Showing my lines" : "My lines only"; }
  }

  function renderCue(part, c) {
    var key = part.id + ":" + c.n;
    var row = el("div", "cue" + (c.kind === "quiet" ? " is-quiet" : ""));
    row.id = "cue-" + part.id + "-" + c.n;
    row.setAttribute("data-who", c.who);
    row.appendChild(el("div", "n", c.n));
    var body = el("div", "body");
    var meta = el("div", "meta");
    meta.appendChild(whoChip(c.who));
    if (c.kind === "quiet") meta.appendChild(el("span", "tag quiet", "Quiet"));
    if (c.kind === "both") meta.appendChild(el("span", "tag quiet", "Let it land, then speak"));
    if (c.tap) meta.appendChild(el("span", "tag tap", "Tap: " + c.tap));
    if (c.wait) meta.appendChild(el("span", "tag wait", "Wait " + c.wait));
    if (c.draft) meta.appendChild(el("span", "tag draft", "Draft"));
    if (c.cut) meta.appendChild(el("span", "tag cut", "Cut?"));
    if (c.edited) meta.appendChild(el("span", "tag edited", "Edited by " + nameOf(c.edited.by)));
    var actions = el("span", "actions");
    if (canEdit(c)) {
      var eb = el("button", "cutbtn", "Edit"); eb.type = "button";
      eb.addEventListener("click", function () { openEditor(part, c, row, null); });
      actions.appendChild(eb);
    }
    var cb = el("button", "cutbtn", "Cut"); cb.type = "button"; cb.setAttribute("aria-pressed", "false");
    cb.addEventListener("click", function () { cuts[key] = !cuts[key]; apply(); saveCuts(); });
    actions.appendChild(cb);
    meta.appendChild(actions);
    body.appendChild(meta);
    if (c.dir) body.appendChild(el("p", "dir", c.dir));
    if (c.line) body.appendChild(el("p", "line", "“" + c.line + "”"));
    if (c.noline && !c.line) body.appendChild(el("p", "dir", "No scripted line. Say what you are doing."));
    row.appendChild(body);
    function apply() { var on = !!cuts[key]; row.classList.toggle("is-cut", on); cb.textContent = on ? "Restore" : "Cut"; cb.setAttribute("aria-pressed", on ? "true" : "false"); }
    apply();
    var draft = readDraft(key);
    if (draft && canEdit(c)) openEditor(part, c, row, draft);
    return row;
  }

  function openEditor(part, c, row, draft) {
    var key = part.id + ":" + c.n;
    var body = row.querySelector(".body");
    if (body.querySelector(".editor")) return;
    Array.prototype.forEach.call(body.querySelectorAll("p"), function (p) { p.hidden = true; });
    var form = el("form", "editor");
    function field(label, value) {
      var wrap = el("label", "field"); wrap.appendChild(el("span", null, label));
      var box = el("textarea"); box.rows = 2; box.maxLength = 1000; box.value = value || "";
      wrap.appendChild(box); form.appendChild(wrap); return box;
    }
    var lineBox = field("What you say", draft ? draft.line : c.line);
    var dirBox = field("What happens, or what to do", draft ? draft.dir : c.dir);
    var bar = el("div", "editor-actions");
    var save = el("button", "btn primary", "Save"); save.type = "submit"; bar.appendChild(save);
    var cancel = el("button", "btn", "Cancel"); cancel.type = "button"; bar.appendChild(cancel);
    var revert = null;
    if (c.base) { revert = el("button", "btn", "Revert to the script"); revert.type = "button"; bar.appendChild(revert); }
    var status = el("span", "editor-status"); status.setAttribute("role", "status"); bar.appendChild(status);
    form.appendChild(bar);
    body.appendChild(form);
    if (!draft) lineBox.focus();

    function keep() { writeDraft(key, { line: lineBox.value, dir: dirBox.value }); }
    lineBox.addEventListener("input", keep); dirBox.addEventListener("input", keep);
    function redraw() { if (row.parentNode) row.parentNode.replaceChild(renderCue(part, c), row); applyFilter(); }
    function busy(on, text) { save.disabled = on; cancel.disabled = on; if (revert) revert.disabled = on; status.className = "editor-status"; status.textContent = text || ""; }
    function failed(message) { busy(false); status.className = "editor-status bad"; status.textContent = message; }

    cancel.addEventListener("click", function () { clearDraft(key); redraw(); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var changes = [];
      [["line", lineBox.value.trim()], ["dir", dirBox.value.trim()]].forEach(function (pair) {
        if (pair[1] !== (c[pair[0]] || "")) changes.push({ field: pair[0], text: pair[1], revert: false });
      });
      if (!changes.length) { clearDraft(key); redraw(); return; }
      busy(true, "Saving...");
      send(key, changes, function (error) {
        if (error) return failed(error);
        changes.forEach(function (change) {
          if (!c.base) c.base = {};
          if (!(change.field in c.base)) c.base[change.field] = c[change.field] == null ? null : c[change.field];
          if (change.text) c[change.field] = change.text; else delete c[change.field];
        });
        c.edited = { by: WHO, at: new Date().toISOString() };
        remember(key, c); clearDraft(key); redraw();
      });
    });
    if (revert) revert.addEventListener("click", function () {
      var fields = Object.keys(c.base);
      busy(true, "Reverting...");
      send(key, fields.map(function (f) { return { field: f, text: "", revert: true }; }), function (error) {
        if (error) return failed(error);
        fields.forEach(function (f) { var v = c.base[f]; if (v == null) delete c[f]; else c[f] = v; });
        delete c.base; delete c.edited;
        remember(key, c); clearDraft(key); redraw();
      });
    });
  }

  // One script.edit event per changed field, through the board's write endpoint.
  function send(key, changes, done) {
    if (CONFIG.writesOff) { done(CONFIG.writesOff); return; }
    var i = 0;
    (function next() {
      if (i >= changes.length) { done(null); return; }
      var change = changes[i++];
      var data = { cue: key, field: change.field, text: change.text };
      if (change.revert) data.revert = true;
      fetch(CONFIG.apiUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: WHO, type: "script.edit", title: "Script edit", data: data }) })
        .then(function (response) { return response.json().catch(function () { return null; }).then(function (answer) { return { ok: response.ok, status: response.status, answer: answer }; }); })
        .then(function (result) {
          if (result.ok && result.answer && result.answer.event) next();
          else done((result.answer && result.answer.error) || "The server said " + result.status + ".");
        })
        .catch(function () { done("No connection. Your text is kept here; try Save again."); });
    })();
  }

  // Times table
  var tbody = document.getElementById("timesBody");
  function drawTimes() {
    tbody.textContent = "";
    var sum = 0, any = false, targetSum = 0;
    TIMED.forEach(function (p, i) {
      targetSum += p.target;
      var tr = el("tr");
      tr.appendChild(el("td", null, partNumber(p) + ". " + p.title));
      tr.appendChild(el("td", "t", fmt(p.target)));
      var got = splits[i];
      tr.appendChild(el("td", "t", got == null ? "" : fmt(got)));
      var d = el("td", "t");
      if (got != null) { any = true; sum += got; var diff = Math.round(got - p.target); d.textContent = (diff > 0 ? "+" : diff < 0 ? "−" : "") + fmt(Math.abs(diff)); d.className = "t " + (diff > 0 ? "bad" : "good"); }
      tr.appendChild(d); tbody.appendChild(tr);
      var a = document.getElementById(p.id + "-actual");
      a.textContent = got == null ? "" : "ran " + fmt(got); a.className = "actual" + (got == null ? "" : got > p.target ? " bad" : " good");
    });
    var tot = el("tr", "total");
    tot.appendChild(el("td", null, "Whole pitch (limit " + fmt(TOTAL_TARGET) + ")"));
    tot.appendChild(el("td", "t", fmt(targetSum)));
    tot.appendChild(el("td", "t", any ? fmt(sum) : ""));
    var td = el("td", "t"); if (any && splits.length === TIMED.length) { var over = Math.round(sum - TOTAL_TARGET); td.textContent = over > 0 ? "+" + fmt(over) + " over " + fmt(TOTAL_TARGET) : fmt(-over) + " to spare"; td.className = "t " + (over > 0 ? "bad" : "good"); }
    tot.appendChild(td); tbody.appendChild(tot);
  }

  // Clock, shared by every phone on this page (lib/web/pitch-clock.ts). A press posts the whole
  // state stamped with the server's time; every phone polls and runs the same clock from it, so
  // all of them show the same time. The parts' order comes from TIMED, the same on every phone.
  var clock = document.getElementById("clock"), startBtn = document.getElementById("startBtn"), nextBtn = document.getElementById("nextBtn"), resetBtn = document.getElementById("resetBtn");
  var nowTitle = document.getElementById("nowTitle"), nowHint = document.getElementById("nowHint"), clockShare = document.getElementById("clockShare");
  var offset = CONFIG.serverNowMs - Date.now();
  function serverNow() { return Date.now() + offset; }
  var running = false, base = 0, baseAtMs = serverNow(), splits = [], partStart = 0, current = -1, timer = null;
  var appliedAtMs = 0, controller = null, shareProblem = null;
  function elapsed() { return base + (running ? Math.max(0, serverNow() - baseAtMs) / 1000 : 0); }
  function setTicking() { clearInterval(timer); timer = running ? setInterval(paint, 250) : null; }
  function shareText() {
    if (shareProblem) return shareProblem;
    if (!WHO) return controller ? "Following " + nameOf(controller) + "'s clock. Pick who you are on the board to run it." : "Pick who you are on the board to run the shared clock.";
    if (!controller || controller === WHO) return "Shared clock: every phone on this page shows this time.";
    return "Following " + nameOf(controller) + "'s clock.";
  }
  function paint() {
    var e = elapsed(); clock.textContent = fmt(e); clock.classList.toggle("over", e > TOTAL_TARGET);
    TIMED.forEach(function (p, i) { document.getElementById(p.id).classList.toggle("active", i === current && current < TIMED.length); });
    if (current < 0) { nowTitle.textContent = "Not started"; nowHint.textContent = "Press Start as the first slide comes up."; }
    else if (current >= TIMED.length) { nowTitle.textContent = "Done"; nowHint.textContent = "Whole pitch ran " + fmt(splits.reduce(function (a, b) { return a + b; }, 0)) + "."; }
    else { var p = TIMED[current]; nowTitle.textContent = "Part " + partNumber(p) + ": " + p.title; nowHint.textContent = fmt(e - partStart) + " of " + fmt(p.target) + " for this part"; }
    clockShare.textContent = shareText();
    startBtn.textContent = running ? "Pause" : (current < 0 ? "Start" : "Resume");
    startBtn.disabled = current >= TIMED.length; nextBtn.disabled = !(current >= 0 && current < TIMED.length);
    nextBtn.textContent = current === TIMED.length - 1 ? "End of pitch" : "End of part";
  }
  // A state from the server: the newest one wins.
  function adopt(shared) {
    if (!shared || !shared.state || shared.state.atMs <= appliedAtMs) return;
    var s = shared.state;
    appliedAtMs = s.atMs; controller = shared.by;
    running = s.running; base = s.base; baseAtMs = s.atMs; current = s.current; partStart = s.partStart; splits = s.splits.slice();
    setTicking(); drawTimes(); paint();
  }
  // Someone else is running the clock: a press here moves it for everyone, so ask first.
  function mayTakeOver() {
    if (!controller || controller === WHO || current < 0) return true;
    return window.confirm(nameOf(controller) + " is running the clock. Move it for everyone?");
  }
  function anchor() { base = elapsed(); baseAtMs = serverNow(); appliedAtMs = baseAtMs; }
  function share(action) {
    shareProblem = null;
    if (!WHO) { shareProblem = "Only on this phone: pick who you are on the board to share the clock."; paint(); return; }
    if (CONFIG.writesOff) { shareProblem = "Not shared: saving is off until the write token is set. This phone keeps its own time."; paint(); return; }
    controller = WHO;
    var state = { action: action, running: running, base: Math.round(base * 1000) / 1000, atMs: Math.round(baseAtMs), current: current, partStart: Math.round(partStart * 1000) / 1000, splits: splits.map(function (x) { return Math.round(x * 1000) / 1000; }) };
    fetch(CONFIG.clockUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: WHO, state: state }) })
      .then(function (response) { return response.json().catch(function () { return null; }).then(function (answer) { return { ok: response.ok, answer: answer }; }); })
      .then(function (result) { if (!result.ok) shareProblem = "Not shared: " + ((result.answer && result.answer.error) || "the server said no") + " This phone keeps its own time."; paint(); })
      .catch(function () { shareProblem = "Not shared: no connection. This phone keeps its own time."; paint(); });
    paint();
  }
  startBtn.addEventListener("click", function () {
    if (!mayTakeOver()) return;
    var action;
    if (running) { anchor(); running = false; action = "pause"; }
    else if (current < 0) { current = 0; partStart = 0; splits = []; base = 0; baseAtMs = serverNow(); appliedAtMs = baseAtMs; running = true; action = "start"; var first = document.getElementById(TIMED[0].id); if (first) first.scrollIntoView({ behavior: "smooth", block: "start" }); }
    else { anchor(); running = true; action = "resume"; }
    setTicking(); paint(); share(action);
  });
  nextBtn.addEventListener("click", function () {
    if (current < 0 || current >= TIMED.length) return;
    if (!mayTakeOver()) return;
    anchor(); splits[current] = base - partStart; partStart = base; current += 1;
    if (current >= TIMED.length) running = false;
    else { var nx = document.getElementById(TIMED[current].id); if (nx) nx.scrollIntoView({ behavior: "smooth", block: "start" }); }
    setTicking(); drawTimes(); paint(); share("next");
  });
  resetBtn.addEventListener("click", function () {
    if (current >= 0 && !window.confirm("Reset the clock on every phone?")) return;
    running = false; base = 0; baseAtMs = serverNow(); appliedAtMs = baseAtMs; splits = []; partStart = 0; current = -1;
    setTicking(); drawTimes(); paint(); share("reset");
  });
  // Follow the shared clock: poll while the page is in view, and correct this phone's clock offset.
  function poll() {
    if (document.hidden) return;
    var sentAt = Date.now();
    fetch(CONFIG.clockUrl, { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (answer) {
        if (!answer) return;
        var roundTrip = Date.now() - sentAt;
        if (typeof answer.serverNowMs === "number" && roundTrip < 1500) offset = answer.serverNowMs + roundTrip / 2 - Date.now();
        adopt(answer.clock);
      })
      .catch(function () {});
  }
  adopt(CONFIG.clock);
  drawTimes(); paint();
  setInterval(poll, 1500);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
})();
</script>`;
