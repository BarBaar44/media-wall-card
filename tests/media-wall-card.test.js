// Tests for media-wall-card.js in a simulated browser. Run: npm test
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const src = fs.readFileSync(path.join(__dirname, "..", "media-wall-card.js"), "utf8");
w.eval(src);
w.eval(src); // loading twice as a classic script must not throw (no top-level name clashes)
const Card = w.customElements.get("media-wall-card");
const Editor = w.customElements.get("media-wall-card-editor");
assert(Card && Editor, "registered");

const S = 1000;
const MIN = 60 * S;
const NOW = Date.parse("2026-11-14T18:30:00Z");
const iso = (ms) => new Date(ms).toISOString();
const st = (state, attributes = {}, changed = NOW - 45 * MIN) => ({ state: String(state), attributes, last_changed: iso(changed), last_updated: iso(changed) });
const PLUG = { tv: "switch.tv_switch", amp: "switch.amplifier_switch", sub: "switch.subwoofer_switch", ps: "switch.playstation_switch" };
const POWER = { tv: "sensor.tv_power", amp: "sensor.amplifier_power", sub: "sensor.subwoofer_power", ps: "sensor.playstation_power" };
const ON = { TV: ["tv"], TVS: ["tv", "amp", "sub"], Movie: ["tv", "amp", "sub"], Games: ["tv", "amp", "sub", "ps"], Music: ["amp", "sub"], Off: [] };

/* Bb's entities: the mode, and the plugs as that mode sets them; o overrides parts. */
const states = (o = {}) => {
  const mode = o.mode ?? "TVS";
  const s = { "input_text.audio_state": st(mode, {}, o.changed ?? NOW - 45 * MIN) };
  for (const k of Object.keys(PLUG)) {
    const on = o[k] ?? ((ON[mode] || []).includes(k) ? "on" : "off");
    s[PLUG[k]] = st(on);
    s[POWER[k]] = st(o[`${k}W`] ?? (on === "on" ? { tv: 86, amp: 24, sub: 12, ps: 55 }[k] : 0), { unit_of_measurement: "W" });
  }
  return { ...s, ...(o.extra || {}) };
};
const hass = (s) => ({ states: s, language: "en", locale: { language: "en" }, config: { time_zone: "UTC" } });

let clock = NOW;
function render(s, config = {}) {
  const c = new Card();
  c._now = () => clock;
  w.document.body.appendChild(c);
  c.setConfig(config);
  c.hass = hass(s);
  return c;
}
function read(c) {
  const e = c._el;
  return {
    title: e.title.textContent,
    titleWarn: e.title.classList.contains("warn"),
    line: e.line.textContent,
    lineWarn: e.line.querySelector(".w") ? e.line.querySelector(".w").textContent : "",
    plugs: e.plugs.map((p) => `${p.el.className.replace("plug ", "")}:${p.val.textContent}`),
    active: e.btns.filter((b) => b.el.classList.contains("act")).map((b) => b.el.querySelector(".tx b span").textContent),
    busy: e.btns.filter((b) => b.el.classList.contains("busy")).map((b) => b.el.querySelector(".tx b span").textContent),
    names: e.btns.map((b) => b.el.querySelector(".tx b span").textContent),
    hints: e.btns.map((b) => b.hint.textContent),
  };
}
function actions(c) {
  const got = [];
  c.addEventListener("hass-action", (ev) => got.push(JSON.parse(JSON.stringify(ev.detail))));
  return got;
}
const same = (a, b) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("empty config works with the owner's entities; grid 12 x 4; four modes", () => {
  clock = NOW;
  const c = render(states());
  const r = read(c);
  assert.strictEqual(r.title, "TV with sound");
  assert.strictEqual(r.line, "since 17:45");
  same(r.names, ["TV", "TV + sound", "Games", "Music"]);
  same(r.active, ["TV + sound"]);
  same(r.hints, ["", "tap to turn off", "", ""]);
  same(r.plugs, ["on:86 W", "on:24 W", "on:12 W", "off:off"]);
  same(c.getGridOptions(), { columns: 12, rows: 4, min_columns: 6, min_rows: 3 });
});

test("all off; unknown value shown as it is; Movie mode label", () => {
  clock = NOW;
  let r = read(render(states({ mode: "Off" })));
  assert.strictEqual(r.title, "All off");
  same(r.active, []);
  r = read(render(states({ mode: "Party" })));
  assert.strictEqual(r.title, "Party");
  assert.strictEqual(r.lineWarn, "");
  r = read(render(states({ mode: "Movie" }), { movie: true }));
  assert.strictEqual(r.title, "Movie");
  same(r.names, ["TV", "TV + sound", "Games", "Music", "Movie"]);
  same(r.active, ["Movie"]);
});

test("Movie button spans the last row; grid has three rows", () => {
  const c = render(states(), { movie: true });
  assert(c._el.btns[4].el.classList.contains("wide"));
  assert(c.shadowRoot.querySelector(".grid").style.gridTemplateRows.includes("3"));
});

test("since: weekday when not today, date when older", () => {
  clock = NOW;
  { const r = read(render(states({ changed: NOW - 26 * 60 * MIN }))).line; assert.strictEqual(r, "since Fri 16:30", r); }
  assert.strictEqual(read(render(states({ changed: NOW - 10 * 24 * 60 * MIN }))).line, "since Nov 4");
});

test("standby: on but below standby_below", () => {
  clock = NOW;
  let r = read(render(states({ subW: 0.4 })));
  assert.strictEqual(r.plugs[2], "stby:standby");
  r = read(render(states({ subW: 0.4 }), { standby_below: 0 }));
  assert.strictEqual(r.plugs[2], "on:0.4 W");
});

test("mismatch: plug off by hand, plug on by hand, count", () => {
  clock = NOW;
  let r = read(render(states({ mode: "Games", ps: "off" })));
  assert.strictEqual(r.lineWarn, "PS is off");
  assert.strictEqual(r.line, "since 17:45 · PS is off");
  assert.strictEqual(r.plugs[3], "off warn:off");
  r = read(render(states({ mode: "Off", tv: "on", amp: "on" })));
  assert.strictEqual(r.lineWarn, "TV is on · +1");
});

test("mismatch waits a few seconds after a mode change (plugs follow the script)", () => {
  clock = NOW;
  const c = render(states({ mode: "Music", changed: NOW - 2 * S, tv: "on" }));
  assert.strictEqual(read(c).lineWarn, "");
  clock = NOW + 4 * S;
  c._update();
  assert.strictEqual(read(c).lineWarn, "TV is on");
  c.disconnectedCallback();
});

test("unavailable plug: n/a, badge, always flagged", () => {
  clock = NOW;
  const r = read(render(states({ mode: "Off", amp: "unavailable" })));
  assert.strictEqual(r.plugs[1], "na warn:n/a");
  assert.strictEqual(r.lineWarn, "Amp offline");
});

test("plug without power sensor shows on", () => {
  clock = NOW;
  const s = states();
  delete s["sensor.tv_power"];
  assert.strictEqual(read(render(s)).plugs[0], "on:on");
});

test("state entity unavailable", () => {
  clock = NOW;
  const r = read(render(states({ mode: "unavailable" })));
  assert.strictEqual(r.title, "Unavailable");
  assert(r.titleWarn);
  same(r.active, []);
});

test("mode button calls the script with the mode id; nothing else", () => {
  clock = NOW;
  const c = render(states({ mode: "TV" }));
  const got = actions(c);
  c._el.btns[3].el.click();
  same(got, [{ config: { entity: "input_text.audio_state", tap_action: { action: "perform-action", perform_action: "script.audio_management_lovelace", data: { actionid: "Music" } } }, action: "tap" }]);
  c.disconnectedCallback();
});

test("busy: dashed button and line until the state follows", () => {
  clock = NOW;
  const s = states({ mode: "TV" });
  const c = render(s);
  c._el.btns[3].el.click();
  let r = read(c);
  same(r.busy, ["Music"]);
  same(r.active, ["TV"]);
  assert.strictEqual(r.line, "since 17:45 · switching to Music");
  assert.strictEqual(r.hints[3], "switching…");
  c.hass = hass(states({ mode: "Music", changed: NOW }));
  r = read(c);
  same(r.busy, []);
  same(r.active, ["Music"]);
  assert.strictEqual(r.line, "since 18:30");
  c.disconnectedCallback();
});

test("tapping the active mode: turning off; plugs going off also counts as a response", () => {
  clock = NOW;
  const c = render(states({ mode: "TVS" }));
  c._el.btns[1].el.click();
  assert.strictEqual(read(c).line, "since 17:45 · turning off");
  assert.strictEqual(read(c).hints[1], "turning off…");
  c.hass = hass(states({ mode: "TVS", tv: "off" }));
  same(read(c).busy, []);
  c.disconnectedCallback();
});

test("busy times out: back to the real state, short no response note", async () => {
  clock = NOW;
  const c = render(states({ mode: "TV" }), { busy_timeout: 1 });
  c._el.btns[2].el.click();
  same(read(c).busy, ["Games"]);
  await new Promise((r) => setTimeout(r, 1100));
  const r = read(c);
  same(r.busy, []);
  same(r.active, ["TV"]);
  assert.strictEqual(r.lineWarn, "Games: no response");
  clock = NOW + 7 * S;
  c._update();
  assert.strictEqual(read(c).lineWarn, "");
  c.disconnectedCallback();
});

test("pressing the busy button again sends nothing", () => {
  clock = NOW;
  const c = render(states({ mode: "TV" }));
  const got = actions(c);
  c._el.btns[3].el.click();
  c._el.btns[3].el.click();
  assert.strictEqual(got.length, 1);
  c.disconnectedCallback();
});

test("plug indicator and status text open more-info", () => {
  clock = NOW;
  const c = render(states());
  const got = actions(c);
  c._el.plugs[1].el.click();
  c._el.st.click();
  same(got.map((g) => [g.config.entity, g.config.tap_action.action]), [["switch.amplifier_switch", "more-info"], ["input_text.audio_state", "more-info"]]);
});

test("power button: optional, calls the script with Off, disabled when all is off", () => {
  clock = NOW;
  assert.strictEqual(render(states()).shadowRoot.querySelector(".pw"), null);
  let c = render(states(), { off_button: true });
  const got = actions(c);
  c._el.pw.click();
  same(got[0].config.tap_action.data, { actionid: "Off" });
  c.disconnectedCallback();
  c = render(states({ mode: "Off" }), { off_button: true });
  assert(c._el.pw.disabled);
  c = render(states({ mode: "Off", tv: "on" }), { off_button: true });
  assert(!c._el.pw.disabled);
});

test("drawing: the mode's devices in full, the rest ghosted; lit only when active", () => {
  clock = NOW;
  const c = render(states({ mode: "Music" }));
  const art = c._el.btns.map((b) => b.art.innerHTML);
  assert(art[3].includes('class="notes"'), "music notes when active");
  assert(!art[2].includes('class="notes"'));
  assert(art[1].includes("#1b1b1b"), "TV dark when not active");
  assert(art[0].includes('opacity="0.22"'), "TV mode ghosts the audio");
  assert(art[2].includes("M34 40"), "Games has the controller");
  assert(!art[1].includes("M34 40"));
  assert(!render(states(), { picture: false })._el.btns[0].art.innerHTML);
});

test("motion only where the active mode plays sound", () => {
  clock = NOW;
  let art = render(states({ mode: "TVS" }))._el.btns.map((b) => b.art.innerHTML);
  for (const c of ['class="sway l"', 'class="sway r"', 'class="pump"', 'class="jump"', 'class="cone"']) assert(art[1].includes(c), c);
  assert(!/sway|pump|jump|cone/.test(art[0] + art[2] + art[3]), "inactive modes stand still");
  assert(!art[1].includes("rip"), "no sound wave arcs");
  art = render(states({ mode: "TV" }))._el.btns.map((b) => b.art.innerHTML);
  assert(!/sway|pump|jump/.test(art[0]), "TV alone has no sound");
});

test("TV picture: landscape when on, game in Games, nothing when off", () => {
  clock = NOW;
  let art = render(states({ mode: "Games" }))._el.btns.map((b) => b.art.innerHTML);
  assert(art[2].includes('class="gscroll"') && art[2].includes('class="ghop"') && art[2].includes('class="padglow"'), "game on the TV");
  assert(!art[2].includes("tvpan"), "no landscape in Games");
  assert(!/tvpan|gscroll|padglow/.test(art[0] + art[1] + art[3]), "inactive TVs are dark");
  art = render(states({ mode: "TV" }))._el.btns.map((b) => b.art.innerHTML);
  assert(art[0].includes('class="tvpan far"') && art[0].includes('class="tvsun"'), "landscape when the TV is on");
});

test("drawing is not rebuilt when nothing in it changes", () => {
  clock = NOW;
  const c = render(states());
  const el = c._el.btns[0].art.firstElementChild;
  c.hass = hass(states({ tvW: 90 }));
  assert.strictEqual(c._el.btns[0].art.firstElementChild, el);
});

test("re-renders only for its own entities", () => {
  clock = NOW;
  const c = render(states());
  let n = 0;
  const orig = c._update.bind(c);
  c._update = () => { n++; orig(); };
  const s = states();
  c.hass = hass(s);
  n = 0;
  c.hass = hass({ ...s, "light.x": st("on") });
  assert.strictEqual(n, 0);
  c.hass = hass({ ...s, "sensor.tv_power": st(91) });
  assert.strictEqual(n, 1);
});

test("custom modes and plugs; per mode colour", () => {
  clock = NOW;
  const cfg = {
    plugs: [{ id: "tv", name: "TV", switch: "switch.tv_switch" }, { id: "amp", name: "Amp", switch: "switch.amplifier_switch", power: null }],
    modes: [{ id: "TV", name: "Watch", on: ["tv"] }, { id: "Music", name: "Listen", on: ["amp"], color: "orange" }],
  };
  const c = render(states({ mode: "Music" }), cfg);
  const r = read(c);
  same(r.names, ["Watch", "Listen"]);
  assert.strictEqual(r.title, "Listen");
  same(r.plugs, ["off:off", "on:on"]);
  assert(c._el.btns[1].el.getAttribute("style").includes("orange"));
});

test("config errors", () => {
  const bad = [
    [{ foo: 1 }, /Unknown option 'foo'/],
    [{ script: "light.x" }, /script must be a script/],
    [{ state_entity: "nope" }, /not an entity id/],
    [{ modes: [] }, /modes must be a list/],
    [{ modes: [{ name: "x" }] }, /needs an id/],
    [{ modes: [{ id: "A", on: ["tv", "xx"] }] }, /unknown plug 'xx'/],
    [{ modes: [{ id: "A" }, { id: "A" }] }, /its own id/],
    [{ modes: [{ id: "A", colour: "red" }] }, /unknown option 'colour'/],
    [{ plugs: [{ name: "x", switch: "bad" }] }, /not an entity id/],
    [{ plugs: [{ id: "a", switch: "switch.a" }, { id: "a", switch: "switch.b" }] }, /its own id/],
    [{ movie: "yes" }, /true or false/],
    [{ standby_below: -1 }, /standby_below/],
    [{ colors: "red" }, /colors must be a map/],
  ];
  for (const [cfg, re] of bad) assert.throws(() => new Card().setConfig(cfg), re, JSON.stringify(cfg));
});

test("editor: empty config shows the defaults and writes nothing back", () => {
  const d = Editor.toData({});
  assert.strictEqual(d.state_entity, "input_text.audio_state");
  assert.strictEqual(d.script, "script.audio_management_lovelace");
  assert.strictEqual(d.plugs.switch_2, "switch.subwoofer_switch");
  assert.strictEqual(d.plugs.power_3, "sensor.playstation_power");
  assert.strictEqual(d.movie, false);
  same(Editor.toConfig(d, {}), { type: "custom:media-wall-card" });
});

test("editor: changes written, unknown keys kept, plugs list only when changed", () => {
  const prev = { type: "custom:media-wall-card", grid_options: { columns: 12, rows: 4 }, modes: [{ id: "TV", name: "TV", on: ["tv"] }] };
  const d = Editor.toData(prev);
  d.movie = true;
  d.off_button = true;
  d.plugs.power_0 = "";
  d.plugs.switch_3 = "switch.ps5";
  d.colors.active = "teal";
  const out = Editor.toConfig(d, prev);
  same(out.grid_options, prev.grid_options);
  same(out.modes, prev.modes);
  assert.strictEqual(out.movie, true);
  assert.strictEqual(out.off_button, true);
  same(out.colors, { active: "teal" });
  same(out.plugs[0], { id: "tv", name: "TV", switch: "switch.tv_switch", power: null });
  same(out.plugs[3], { id: "ps", name: "PS", switch: "switch.ps5", power: "sensor.playstation_power" });
  new Card().setConfig(out);
  same(Editor.toConfig(Editor.toData(out), out), out);
});

test("editor: a cleared switch falls back; back to defaults removes plugs", () => {
  const d = Editor.toData({});
  d.plugs.switch_1 = "";
  assert.strictEqual(Editor.toConfig(d, {}).plugs, undefined);
});

test("editor round trip of a full config is accepted by the card", () => {
  const cfg = {
    type: "custom:media-wall-card", name: "Lounge", state_entity: "input_select.av", script: "script.av", field: "mode", off_id: "None",
    movie: true, off_button: true, picture: false, standby_below: 5, busy_timeout: 8, colors: { warn: "orange" },
    plugs: [{ id: "tv", name: "Telly", switch: "switch.t", power: null, icon: "mdi:monitor" }],
    modes: [{ id: "TV", name: "TV", on: ["tv"] }],
  };
  new Card().setConfig(cfg);
  same(Editor.toConfig(Editor.toData(cfg), cfg), cfg);
});

test("colours set CSS variables", () => {
  const c = render(states(), { colors: { active: "teal" } });
  assert.strictEqual(c.style.getPropertyValue("--mw-active"), "teal");
});

test("card picker entry once", () => {
  assert.strictEqual(w.customCards.filter((x) => x.type === "media-wall-card").length, 1);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e.stack.split("\n").slice(0, 3).join("\n     ")}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
