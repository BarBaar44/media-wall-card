/*
 * Media Wall Card
 * A Lovelace card for choosing the living room audio / TV mode: one button per
 * mode with a line drawing of the media wall (TV, receiver, speakers, sub) in
 * the style of the Gardenview House and Irrigation cards, a short status line,
 * and small indicators for the smart plugs that show what is really on.
 *
 * The card never switches the plugs itself. A mode button calls the owner's
 * script with the mode id (the script turns the mode off when it is already
 * active); a plug indicator opens more-info. Both go through Home Assistant's
 * own action handler (hass-action); nothing calls hass directly.
 *
 * https://github.com/BarBaar44/media-wall-card  (MIT)
 */

// Everything sits in one block so the top-level names cannot clash with the
// sister cards when the files are loaded as classic scripts.
{
const VERSION = "0.1.2";

const MW_GRACE_MS = 5000; // plugs may lag the mode this long before a mismatch shows
const MW_FAIL_MS = 6000; // "Music: no response" shows this long

const MW_PLUGS = [
  { id: "tv", name: "TV", switch: "switch.tv_switch", power: "sensor.tv_power", icon: "mdi:television" },
  { id: "amp", name: "Amp", switch: "switch.amplifier_switch", power: "sensor.amplifier_power", icon: "mdi:amplifier" },
  { id: "sub", name: "Sub", switch: "switch.subwoofer_switch", power: "sensor.subwoofer_power", icon: "mdi:speaker" },
  { id: "ps", name: "PS", switch: "switch.playstation_switch", power: "sensor.playstation_power", icon: "mdi:sony-playstation" },
];

const MW_MODES = [
  { id: "TV", name: "TV", label: "TV", icon: "mdi:television", on: ["tv"] },
  { id: "TVS", name: "TV + sound", label: "TV with sound", icon: "mdi:television-ambient-light", on: ["tv", "amp", "sub"] },
  { id: "Games", name: "Games", label: "Games", icon: "mdi:sony-playstation", on: ["tv", "amp", "sub", "ps"] },
  { id: "Music", name: "Music", label: "Music", icon: "mdi:music", on: ["amp", "sub"] },
];
const MW_MOVIE = { id: "Movie", name: "Movie", label: "Movie", icon: "mdi:movie-open", on: ["tv", "amp", "sub"] };

const MW_DEFAULTS = {
  name: "Living room",
  state_entity: "input_text.audio_state",
  script: "script.audio_management_lovelace",
  field: "actionid",
  off_id: "Off",
  movie: false, // adds the Movie mode to the default modes
  off_button: false, // a power button in the header; tapping the active mode turns off too
  picture: true, // the media wall drawing; false shows the mode icon instead
  standby_below: 3, // W: a plug that is on but draws less is shown as standby
  busy_timeout: 5, // s: the pressed button waits this long for the state to follow
};

/* colors key -> CSS variable and default. */
const MW_COLORS = {
  active: ["--mw-active", "var(--blue-color, #2196f3)"],
  warn: ["--mw-warn", "var(--warning-color, #ff9800)"],
  error: ["--mw-error", "var(--error-color, #db4437)"],
};

const MW_KNOWN = ["type", "name", "state_entity", "script", "field", "off_id", "modes", "plugs", "movie", "off_button",
  "picture", "standby_below", "busy_timeout", "colors", "grid_options", "layout_options", "view_layout", "visibility", "card_mod"];
const MW_BAD = ["unknown", "unavailable", "none", ""];
const MW_ENTITY = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const mwNum = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const mwKey = (v) => String(v == null ? "" : v).trim().toLowerCase();
const mwEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let mwUid = 0;

/* ------------------------------------------------------------------------ */
/* The drawing                                                              */
/* ------------------------------------------------------------------------ */

/*
 * The owner's media wall as SVG markup, 118 x 72: wall mounted TV, cream
 * cabinet with a grey top, panel doors and the receiver in the open shelf,
 * centre speaker on top, two white towers with grey grilles and plants, the
 * sub as a black cube on the floor at the far left. o = { tv, amp, sub, ps, lit, uid }: the devices this
 * mode uses are drawn in full, the others ghosted; lit = the mode is active
 * (or being switched to), so its devices light up in the active colour.
 */
/* A row of rounded hills from x0 to x1 with base line y, one hill every period units, amp high; closed at the bottom of the screen. Repeats seamlessly when moved by one period. */
function mwHills(x0, x1, y, period, amp) {
  let d = `M${x0} 31 L${x0} ${y}`;
  for (let x = x0; x < x1; x += period) d += ` q${period / 4} ${-amp * 2} ${period / 2} 0 t${period / 2} 0`;
  return `${d} L${x1 + (period - ((x1 - x0) % period)) % period} 31 Z`;
}

/* Games on the TV: a little side scroller (blocks and coins scroll by, the hero hops). Our own drawing, no console branding. */
function mwGame() {
  let world = "";
  for (let x = 34; x < 110; x += 6) world += `<rect x="${x}" y="25.5" width="6" height="5" fill="#c9702e" stroke="#6b3410" stroke-width=".5"/>`;
  for (let x = 40; x < 110; x += 18) world += `<circle cx="${x}" cy="15" r="1.6" fill="#ffd36b"/><rect x="${x + 7}" y="21.5" width="4" height="4" fill="#8e5a2a" stroke="#6b3410" stroke-width=".5"/>`;
  return `<rect x="34" y="2" width="50" height="29" fill="#20185a" opacity=".75"/>
      <circle cx="40" cy="7" r=".5" fill="#fff"/><circle cx="57" cy="5" r=".5" fill="#fff"/><circle cx="76" cy="8" r=".5" fill="#fff"/>
      <g class="gscroll">${world}</g>
      <g class="ghop"><rect x="45" y="20" width="4.5" height="5.5" rx="1" fill="#5be3f0" stroke="#0d3b47" stroke-width=".6"/>
      <rect x="47.6" y="21.5" width="1" height="1.2" fill="#0d3b47"/></g>`;
}

function mwScene(o) {
  const K = 'stroke="#141414" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"';
  const C = "var(--mw-c)";
  const lit = o.lit;
  const part = (on, body) => `<g opacity="${on ? 1 : 0.22}">${body}</g>`;
  /* A tower: the plinth stays on the floor, the body (with the plant) sways from its foot while it plays. */
  const tower = (x, pot, sway) => `<g ${K}><rect x="${x - 2}" y="64" width="18" height="3" fill="#f4f4f4"/></g>
    <g class="${sway}"><g ${K}>
    <rect x="${x}" y="17" width="14" height="47" fill="#f4f4f4"/>
    <rect x="${x + 2}" y="19" width="10" height="33" fill="#a3a3a8" stroke-width="1"/></g>
    <g ${K} stroke-width="1.2"><path d="M${x + 3} 17 l1 -5 h6 l1 5 z" fill="${pot}"/>
    <path d="M${x + 7} 12 q-7 -6 -8 -1 q4 2 8 1 z M${x + 7} 12 q6 -8 9 -3 q-4 3 -9 3 z M${x + 7} 12 q0 -8 2 -9 q1 5 -2 9 z" fill="#6f9a5a"/></g></g>`;
  const id = `mw${o.uid}`;
  const tvLit = lit && o.tv;
  const tv = `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3d7bff"/><stop offset=".55" stop-color="#7b4dff"/><stop offset="1" stop-color="#ff7a45"/></linearGradient>
      <filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>
    ${tvLit && o.amp ? `<rect class="glow" x="34" y="2" width="50" height="29" style="fill:${C}" opacity=".7" filter="url(#${id}f)"/>` : ""}
    <rect x="34" y="2" width="50" height="29" rx="1" fill="${tvLit ? `url(#${id}g)` : "#1b1b1b"}"/>
    ${tvLit ? `<clipPath id="${id}c"><rect x="35" y="3" width="48" height="27"/></clipPath>
    <g clip-path="url(#${id}c)">
      ${o.ps ? mwGame() : `<circle class="tvsun" cx="70" cy="11" r="3.2" fill="#ffd36b" opacity=".9"/>
      <path class="tvpan far" d="${mwHills(34, 150, 22, 25, 2.6)}" fill="#3a2a7a" opacity=".55"/>
      <path class="tvpan near" d="${mwHills(34, 150, 26, 50, 3.4)}" fill="#22184d" opacity=".8"/>`}
      <rect class="tvflick" x="34" y="2" width="50" height="29" fill="#fff" opacity="0"/>
    </g>` : `<path d="M62 4 l-10 25" stroke="#fff" stroke-opacity=".12" stroke-width="5"/>`}
    <g ${K}><rect x="34" y="2" width="50" height="29" rx="1" fill="none"/></g>`;
  const cabinet = `<g ${K}>
    <polygon points="29,43 91,43 93,40 31,40" fill="#9b8f84"/>
    <rect x="29" y="43" width="62" height="21" fill="#f1ece0"/>
    <path d="M27 64 h66 v3 h-66 z" fill="#f1ece0"/>
    <rect x="31" y="45" width="15" height="17" fill="#f1ece0" stroke-width="1.1"/><rect x="33.5" y="47.5" width="10" height="12" fill="none" stroke-width=".9"/>
    <rect x="74" y="45" width="15" height="17" fill="#f1ece0" stroke-width="1.1"/><rect x="76.5" y="47.5" width="10" height="12" fill="none" stroke-width=".9"/>
    <rect x="48" y="45" width="24" height="9" fill="#e4ddcc" stroke-width="1.1"/>
    <rect x="48" y="56" width="24" height="6" fill="#f1ece0" stroke-width="1.1"/></g>
    <rect x="57" y="58.3" width="6" height="1.6" rx=".5" fill="#141414"/>
    <path d="M46.5 53 l1 1 l-1 1 l-1 -1 z M73.5 53 l1 1 l-1 1 l-1 -1 z" fill="#141414"/>`;
  const ampLit = lit && o.amp;
  const avr = `<g ${K} stroke-width="1.1"><rect x="50" y="46.5" width="20" height="6.5" fill="#1d1d1d"/></g>
    <rect x="54" y="48.3" width="9" height="2.4" rx=".4" style="fill:${ampLit ? C : "#3a3a3a"}"/>
    <circle cx="66.5" cy="49.7" r="1.8" fill="#3a3a3a" style="stroke:${ampLit ? C : "#555"}" stroke-width=".8"/>`;
  const center = `<g class="${ampLit ? "pump" : ""}"><g ${K}><rect x="51" y="33" width="18" height="7" fill="#f4f4f4"/>
    <rect x="52.5" y="35" width="15" height="4" fill="#a3a3a8" stroke-width=".8"/></g></g>`;
  const towers = tower(12, "#8aa08a", ampLit ? "sway l" : "") + tower(94, "#d9b04a", ampLit ? "sway r" : "");
  const subLit = lit && o.sub;
  // The sub stands on the floor at the far left (outside the shifted scene), a black cube with a front driver.
  const sub = `<g class="${subLit ? "jump" : ""}"><g ${K}>
      <polygon points="1,51 17,51 20.5,47.5 4.5,47.5" fill="#3d3d3d"/>
      <polygon points="17,51 20.5,47.5 20.5,63.5 17,67" fill="#1e1e1e"/>
      <rect x="1" y="51" width="16" height="16" fill="#2a2a2a"/></g>
      <g class="${subLit ? "cone" : ""}"><circle cx="9" cy="59" r="5.6" fill="#161616" stroke="#4a4a4a" stroke-width=".9"/>
      <circle cx="9" cy="59" r="2" fill="#333" style="stroke:${subLit ? C : "#555"}" stroke-width=".8"/></g></g>`;
  // The controller on the cabinet top, drawn a size up so it reads at button size; its light bar glows while playing.
  const pad = o.ps ? `<g transform="translate(40.5 39) scale(1.4) translate(-42.5 -40.5)"><g ${K} stroke-width="1">
    <path d="M34 40 q1.5 -3.5 6 -3.5 h5 q4.5 0 6 3.5 l.6 2 q.6 2.5 -2 2.5 q-2 0 -3.5 -2 h-7 q-1.5 2 -3.5 2 q-2.6 0 -2 -2.5 z" fill="#f4f4f4"/></g>
    <circle cx="37.6" cy="40.2" r=".8" fill="#141414"/><circle cx="47.4" cy="40.2" r=".8" fill="#141414"/>
    <rect class="${lit ? "padglow" : ""}" x="40.5" y="37.4" width="4" height="1.2" rx=".6" style="fill:${lit ? C : "#9a9a9a"}"/></g>` : "";
  const notes = ampLit && !o.tv ? `<g class="notes" style="fill:${C};stroke:${C}" stroke-width="1.4" stroke-linecap="round">
    <ellipse cx="50" cy="18" rx="2.6" ry="2" stroke="none"/><path d="M52.6 18 V7 l5 1.8" fill="none"/>
    <ellipse cx="65" cy="14" rx="2.3" ry="1.8" stroke="none"/><path d="M67.3 14 V4" fill="none"/></g>` : "";
  return `<svg viewBox="0 0 134 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="67" cy="68" rx="66" ry="2.4" fill="#000" opacity=".3"/>
    ${part(o.sub, sub)}<g transform="translate(16 0)">${part(o.tv, tv)}${cabinet}${part(o.amp, avr)}${part(o.amp, center)}${part(o.amp, towers)}${pad}${notes}</g></svg>`;
}

/* ------------------------------------------------------------------------ */
/* The card                                                                 */
/* ------------------------------------------------------------------------ */

const MW_STYLE = `
  :host {
${Object.values(MW_COLORS).map(([v, d]) => `    ${v}: ${d};`).join("\n")}
  }
  ha-card {
    height: 100%; box-sizing: border-box; overflow: hidden; padding: 10px 12px 12px;
    display: flex; flex-direction: column; gap: 8px;
    user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  button { font: inherit; color: inherit; border: none; padding: 0; margin: 0; cursor: pointer; background: none; }
  button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }

  .hd { flex: none; height: 36px; display: flex; align-items: center; gap: 8px; }
  .st { flex: 1; min-width: 0; cursor: pointer; }
  .t { font-size: 14px; font-weight: 500; line-height: 20px; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t.warn { color: var(--mw-warn); }
  .l { font-size: 12px; line-height: 16px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  .l .w { color: var(--mw-warn); }
  .plugs { flex: none; display: flex; gap: 2px; }
  .plug { position: relative; width: 44px; height: 36px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
  .plug ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; display: flex; color: var(--primary-text-color); }
  .plug span { font-size: 10px; line-height: 12px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .plug.off ha-icon, .plug.na ha-icon { color: var(--disabled-color, #9e9e9e); opacity: .7; }
  .plug.stby ha-icon { color: var(--secondary-text-color); }
  .plug.warn { box-shadow: inset 0 0 0 1.5px var(--mw-warn); }
  .plug.warn span { color: var(--mw-warn); }
  .plug.na span { color: var(--mw-error); }
  .plug .badge { display: none; position: absolute; top: 1px; right: 5px; width: 12px; height: 12px; border-radius: 50%; background: var(--card-background-color, #fff); }
  .plug .badge ha-icon { --mdc-icon-size: 12px; width: 12px; height: 12px; color: var(--mw-error); opacity: 1; }
  .plug.na .badge { display: flex; }
  .pw { flex: none; width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--secondary-background-color, rgba(127,127,127,.15)); }
  .pw ha-icon { --mdc-icon-size: 20px; width: 20px; height: 20px; display: flex; }
  .pw:disabled { opacity: .3; cursor: default; }
  .pw.busy { color: var(--mw-active); animation: mw-pulse 1s ease-in-out infinite; }

  .grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .btn {
    --mw-c: var(--mw-active);
    position: relative; min-width: 0; min-height: 0; container-type: size;
    border-radius: 12px; border: 2px solid transparent; box-sizing: border-box;
    background: var(--secondary-background-color, rgba(127,127,127,.15)); color: var(--primary-text-color);
    display: flex; align-items: stretch; justify-content: space-between; text-align: left; overflow: hidden;
  }
  .btn.wide { grid-column: 1 / -1; }
  .btn.act { border-color: var(--mw-c); background: color-mix(in srgb, var(--mw-c) 14%, var(--secondary-background-color, rgba(127,127,127,.15))); }
  .btn.busy { border-color: color-mix(in srgb, var(--mw-c) 60%, transparent); border-style: dashed; }
  .btn.busy .tx small { color: var(--mw-c); animation: mw-pulse 1s ease-in-out infinite; }
  .tx { flex: 1; min-width: 0; padding: 0 4px 0 12px; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
  .tx b { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx b ha-icon { --mdc-icon-size: 28px; width: 28px; height: 28px; display: none; flex: none; color: var(--disabled-color, #9e9e9e); }
  .btn.act .tx b ha-icon, .btn.busy .tx b ha-icon { color: var(--mw-c); }
  .tx small { font-size: 11px; line-height: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tx small:empty { display: none; }
  .art { flex: none; align-self: center; height: min(100%, 72px); aspect-ratio: 134 / 72; padding-right: 4px; }
  .art svg { width: 100%; height: 100%; display: block; overflow: visible; }
  .btn:not(.act):not(.busy) .art { opacity: .85; }
  .nopic .art { display: none; }
  .nopic .tx b ha-icon { display: flex; }

  /* phone: label top left, drawing bottom right, no hint */
  @container (max-width: 199px) {
    .tx { position: absolute; left: 0; top: 6px; right: 0; padding-right: 12px; justify-content: flex-start; }
    .tx small { display: none; }
    .art { position: absolute; right: 0; bottom: 2px; height: min(58px, calc(100% - 26px)); }
    .nopic .tx { position: static; justify-content: center; }
  }
  @container (max-height: 63px) and (max-width: 199px) { .art { display: none; } .tx { position: static; justify-content: center; } }

  /* sound: the towers sway from their foot, the centre speaker leans in and out, the sub hops and its driver pumps, notes rise */
  .sway { transform-box: fill-box; transform-origin: 50% 100%; animation: 1.4s ease-in-out infinite alternate; }
  .sway.l { animation-name: mw-sway-l; }
  .sway.r { animation-name: mw-sway-r; }
  @keyframes mw-sway-l { from { transform: rotate(-2.2deg); } to { transform: rotate(2.2deg); } }
  @keyframes mw-sway-r { from { transform: rotate(2.2deg); } to { transform: rotate(-2.2deg); } }
  .pump { transform-box: fill-box; transform-origin: 50% 100%; animation: mw-pump .6s ease-in-out infinite alternate; }
  @keyframes mw-pump { to { transform: scale(1.09); } }
  /* TV on: two rows of hills drift by (parallax), the sun bobs, the picture flickers, the ambient glow breathes */
  .tvpan { animation: mw-pan-far 9s linear infinite; }
  .tvpan.near { animation: mw-pan-near 6s linear infinite; }
  @keyframes mw-pan-far { to { transform: translateX(-25px); } }
  @keyframes mw-pan-near { to { transform: translateX(-50px); } }
  .tvsun { animation: mw-sun 4s ease-in-out infinite alternate; }
  @keyframes mw-sun { to { transform: translate(-4px, 2px); } }
  .tvflick { animation: mw-flick 3.2s steps(1) infinite; }
  @keyframes mw-flick { 0%, 100% { opacity: 0; } 31% { opacity: .1; } 33% { opacity: 0; } 72% { opacity: .07; } 74% { opacity: 0; } }
  .glow { animation: mw-glow 3s ease-in-out infinite alternate; }
  @keyframes mw-glow { from { opacity: .5; } to { opacity: .85; } }
  .gscroll { animation: mw-scroll 2.4s linear infinite; }
  @keyframes mw-scroll { to { transform: translateX(-18px); } }
  .ghop { animation: mw-hop .8s infinite; }
  @keyframes mw-hop { 0%, 100% { transform: translateY(0); animation-timing-function: ease-out; } 45% { transform: translateY(-7px); animation-timing-function: ease-in; } 90% { transform: translateY(0); } }
  .padglow { animation: mw-padglow 1.2s ease-in-out infinite alternate; }
  @keyframes mw-padglow { from { opacity: .45; } to { opacity: 1; } }
  .jump { transform-box: fill-box; transform-origin: 50% 100%; animation: mw-jump .5s ease-out infinite; }
  @keyframes mw-jump { 0%, 45%, 100% { transform: translateY(0) scaleY(1); } 12% { transform: translateY(-1.3px) scaleY(1.02); } 28% { transform: translateY(0) scaleY(.97); } }
  .cone { transform-box: fill-box; transform-origin: 50% 50%; animation: mw-cone .25s ease-in-out infinite alternate; }
  @keyframes mw-cone { to { transform: scale(1.12); } }
  .notes { animation: mw-notes 2.4s ease-in-out infinite; }
  @keyframes mw-notes { 0% { transform: translateY(2px); opacity: .4; } 50% { opacity: 1; } 100% { transform: translateY(-2px); opacity: .4; } }
  @keyframes mw-pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) {
    .sway, .pump, .jump, .cone, .notes, .tvpan, .tvsun, .tvflick, .glow, .gscroll, .ghop, .padglow, .btn.busy .tx small, .pw.busy { animation: none !important; }
  }
`;

class MediaWallCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._seen = Object.create(null);
    this._ids = [];
    this._busy = null; // { id, from, timer }
    this._fail = null; // { id, until }
    this._timers = [];
  }

  static getConfigElement() {
    return document.createElement("media-wall-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, rows: 4, min_columns: 6, min_rows: 3 };
  }

  setConfig(config) {
    const c = config || {};
    for (const k of Object.keys(c)) {
      if (!MW_KNOWN.includes(k)) throw new Error(`Unknown option '${k}'. Known: ${MW_KNOWN.slice(1, 15).join(", ")}`);
    }
    const entity = (k, domains) => {
      const v = c[k] == null ? MW_DEFAULTS[k] : c[k];
      if (typeof v !== "string" || !MW_ENTITY.test(v)) throw new Error(`${k}: '${v}' is not an entity id`);
      if (domains && !domains.includes(v.split(".")[0])) throw new Error(`${k} must be a ${domains.join(" or ")} entity`);
      return v;
    };
    const text = (k) => {
      const v = c[k] == null ? MW_DEFAULTS[k] : c[k];
      if (typeof v !== "string" || !v.trim()) throw new Error(`${k} must be a text`);
      return v.trim();
    };
    const bool = (k) => {
      const v = c[k] == null ? MW_DEFAULTS[k] : c[k];
      if (typeof v !== "boolean") throw new Error(`${k} must be true or false`);
      return v;
    };
    const number = (k, min, max) => {
      const v = c[k] == null ? MW_DEFAULTS[k] : mwNum(c[k]);
      if (v === null || v < min || v > max) throw new Error(`${k} must be a number from ${min} to ${max}`);
      return v;
    };

    // plugs
    let plugs = MW_PLUGS;
    if (c.plugs != null) {
      if (!Array.isArray(c.plugs) || !c.plugs.length) throw new Error("plugs must be a list, e.g. - name: TV, switch: switch.tv");
      plugs = c.plugs.map((p, i) => {
        if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error(`plugs[${i}] must be a map with name and switch`);
        for (const k of Object.keys(p)) {
          if (!["id", "name", "switch", "power", "icon"].includes(k)) throw new Error(`plugs[${i}]: unknown option '${k}'. Known: id, name, switch, power, icon`);
        }
        const def = MW_PLUGS.find((d) => d.id === p.id) || MW_PLUGS[i] || {};
        const id = p.id == null ? def.id || `plug${i + 1}` : String(p.id);
        const sw = p.switch == null ? def.switch : p.switch;
        if (typeof sw !== "string" || !MW_ENTITY.test(sw)) throw new Error(`plugs[${i}].switch: '${sw}' is not an entity id`);
        const pw = p.power === undefined ? (p.switch == null ? def.power : null) || null : p.power;
        if (pw !== null && (typeof pw !== "string" || !MW_ENTITY.test(pw))) throw new Error(`plugs[${i}].power: '${pw}' is not an entity id (null: no power sensor)`);
        return { id, name: String(p.name == null ? def.name || id : p.name), switch: sw, power: pw, icon: String(p.icon || def.icon || "mdi:power-plug") };
      });
      const ids = plugs.map((p) => p.id);
      if (new Set(ids).size !== ids.length) throw new Error("plugs: every plug needs its own id");
    }
    const plugIds = plugs.map((p) => p.id);

    // modes
    let modes;
    if (c.modes != null) {
      if (!Array.isArray(c.modes) || !c.modes.length) throw new Error("modes must be a list, e.g. - id: TV, name: TV, on: [tv]");
      modes = c.modes.map((m, i) => {
        if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`modes[${i}] must be a map with id and name`);
        for (const k of Object.keys(m)) {
          if (!["id", "name", "label", "icon", "color", "on"].includes(k)) throw new Error(`modes[${i}]: unknown option '${k}'. Known: id, name, label, icon, color, on`);
        }
        if (m.id == null || String(m.id).trim() === "") throw new Error(`modes[${i}] needs an id (the value the script sets in the state entity)`);
        const def = [...MW_MODES, MW_MOVIE].find((d) => d.id === String(m.id)) || {};
        const on = m.on == null ? def.on || [] : m.on;
        if (!Array.isArray(on)) throw new Error(`modes[${i}].on must be a list of plug ids, e.g. [tv, amp]`);
        for (const p of on) if (!plugIds.includes(String(p))) throw new Error(`modes[${i}].on: unknown plug '${p}'. Plugs: ${plugIds.join(", ")}`);
        const name = String(m.name == null ? def.name || m.id : m.name);
        return {
          id: String(m.id), name, label: String(m.label == null ? (m.name == null ? def.label || name : name) : m.label),
          icon: String(m.icon || def.icon || "mdi:play-circle-outline"), color: m.color ? String(m.color) : null, on: on.map(String),
        };
      });
      const ids = modes.map((m) => m.id);
      if (new Set(ids).size !== ids.length) throw new Error("modes: every mode needs its own id");
    } else {
      modes = (bool("movie") ? [...MW_MODES, MW_MOVIE] : MW_MODES).map((m) => ({ ...m, color: null, on: m.on.filter((p) => plugIds.includes(p)) }));
    }
    if (c.colors != null && (typeof c.colors !== "object" || Array.isArray(c.colors))) {
      throw new Error("colors must be a map, e.g. active: dodgerblue");
    }

    this._config = {
      name: c.name == null ? MW_DEFAULTS.name : String(c.name),
      stateEntity: entity("state_entity", ["input_text", "input_select", "select", "sensor"]),
      script: entity("script", ["script"]),
      field: text("field"),
      offId: text("off_id"),
      offButton: bool("off_button"),
      picture: bool("picture"),
      movie: bool("movie"),
      standby: number("standby_below", 0, 1000),
      busyMs: number("busy_timeout", 1, 60) * 1000,
      plugs,
      modes,
      colors: c.colors || {},
    };
    this._applyColors(this._config.colors);
    this._ids = [this._config.stateEntity, ...plugs.flatMap((p) => [p.switch, p.power]).filter(Boolean)];
    this._seen = Object.create(null);
    this._clearBusy();
    this._fail = null;
    this._build();
    if (this._hass) this._update();
  }

  _applyColors(colors) {
    Object.keys(colors).forEach((k) => {
      if (!MW_COLORS[k]) console.warn(`media-wall-card: unknown colors key "${k}". Known: ${Object.keys(MW_COLORS).join(", ")}`);
    });
    Object.entries(MW_COLORS).forEach(([k, [v]]) => {
      const val = typeof colors[k] === "string" && colors[k].trim() ? colors[k].trim() : null;
      if (val) this.style.setProperty(v, val);
      else this.style.removeProperty(v);
    });
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    let changed = first;
    for (const id of this._ids) {
      const s = hass.states[id];
      if (s !== this._seen[id]) {
        this._seen[id] = s;
        changed = true;
      }
    }
    if (changed) this._update();
  }

  get hass() {
    return this._hass;
  }

  disconnectedCallback() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    this._grace = null;
    this._clearBusy();
  }

  _now() {
    return Date.now();
  }

  _later(ms, fn) {
    const t = setTimeout(() => { this._timers = this._timers.filter((x) => x !== t); fn(); }, ms);
    this._timers.push(t);
    return t;
  }

  /* ---- DOM, built once per config ---------------------------------------- */

  _build() {
    const cfg = this._config;
    const n = cfg.modes.length;
    const rows = Math.ceil(n / 2);
    this.shadowRoot.innerHTML = `
      <style>${MW_STYLE}</style>
      <ha-card class="${cfg.picture ? "" : "nopic"}">
        <div class="hd">
          <div class="st" role="button" tabindex="0"><div class="t"></div><div class="l"></div></div>
          <div class="plugs">${cfg.plugs.map((p, i) => `
            <button class="plug" data-i="${i}" title="${mwEsc(p.name)}"><ha-icon icon="${mwEsc(p.icon)}"></ha-icon><span></span><i class="badge"><ha-icon icon="mdi:alert-circle"></ha-icon></i></button>`).join("")}
          </div>
          ${cfg.offButton ? `<button class="pw" aria-label="All off" title="All off"><ha-icon icon="mdi:power"></ha-icon></button>` : ""}
        </div>
        <div class="grid" style="grid-template-rows: repeat(${rows}, 1fr)">${cfg.modes.map((m, i) => `
          <button class="btn${n % 2 && i === n - 1 && n > 1 ? " wide" : ""}" data-i="${i}" aria-pressed="false"${m.color ? ` style="--mw-c: ${mwEsc(m.color)}"` : ""}>
            <div class="tx"><b><ha-icon icon="${mwEsc(m.icon)}"></ha-icon><span>${mwEsc(m.name)}</span></b><small></small></div>
            <div class="art"></div>
          </button>`).join("")}
        </div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    const $$ = (s) => [...this.shadowRoot.querySelectorAll(s)];
    this._el = {
      card: $("ha-card"), st: $(".st"), title: $(".t"), line: $(".l"), pw: $(".pw"),
      plugs: $$(".plug").map((el) => ({ el, val: el.querySelector("span") })),
      btns: $$(".btn").map((el) => ({ el, hint: el.querySelector("small"), art: el.querySelector(".art"), key: null })),
    };
    const e = this._el;
    e.plugs.forEach((p, i) => p.el.addEventListener("click", () => this._moreInfo(cfg.plugs[i].switch)));
    e.btns.forEach((b, i) => b.el.addEventListener("click", () => this._press(cfg.modes[i].id)));
    if (e.pw) e.pw.addEventListener("click", () => { if (!e.pw.disabled) this._press(cfg.offId); });
    e.st.addEventListener("click", () => this._moreInfo(cfg.stateEntity));
    e.st.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      this._moreInfo(cfg.stateEntity);
    });
  }

  /* ---- actions ------------------------------------------------------------ */

  /* Hands an action to Home Assistant's own handler, like built-in cards do. */
  _run(conf, entity) {
    window.dispatchEvent(new CustomEvent("haptic", { detail: "light" }));
    this.dispatchEvent(new CustomEvent("hass-action", {
      bubbles: true, composed: true, detail: { config: { entity, tap_action: conf }, action: "tap" },
    }));
  }

  _moreInfo(entity) {
    this._run({ action: "more-info" }, entity);
  }

  /* A mode button (or the power button): the script sets the mode, or turns it off when it is already active. */
  _press(id) {
    const cfg = this._config;
    if (this._busy && this._busy.id === id) return;
    this._clearBusy();
    this._fail = null;
    const from = this._value();
    const plugs = this._plugKeys();
    this._busy = { id, from, plugs, timer: this._later(cfg.busyMs, () => this._timeout()) };
    this._run({ action: "perform-action", perform_action: cfg.script, data: { [cfg.field]: id } }, cfg.stateEntity);
    this._update();
  }

  _timeout() {
    if (!this._busy) return;
    const id = this._busy.id;
    this._busy = null;
    this._fail = { id, until: this._now() + MW_FAIL_MS };
    this._later(MW_FAIL_MS + 50, () => this._update());
    this._update();
  }

  _clearBusy() {
    if (this._busy) clearTimeout(this._busy.timer);
    this._busy = null;
  }

  /* ---- state -------------------------------------------------------------- */

  _s(id) {
    return id && this._hass ? this._hass.states[id] : undefined;
  }

  _value() {
    const s = this._s(this._config.stateEntity);
    return s && !MW_BAD.includes(mwKey(s.state)) ? String(s.state) : null;
  }

  _lang() {
    const h = this._hass;
    return (h && h.locale && h.locale.language) || (h && h.language) || "en";
  }

  _fmt(ms, opts) {
    const tz = this._hass && this._hass.config && this._hass.config.time_zone;
    const o = { hour12: false, ...opts };
    try {
      return new Intl.DateTimeFormat(this._lang(), tz ? { ...o, timeZone: tz } : o).format(new Date(ms));
    } catch (_) {
      return new Intl.DateTimeFormat("en-GB", o).format(new Date(ms));
    }
  }

  /* "17:45" today, "Tue 17:45" this week, "3 Nov" before that. */
  _since(ms, now) {
    const day = (t) => this._fmt(t, { year: "numeric", month: "2-digit", day: "2-digit" });
    if (day(ms) === day(now)) return this._fmt(ms, { hour: "2-digit", minute: "2-digit" });
    if (now - ms < 6 * 86400000) return this._fmt(ms, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return this._fmt(ms, { day: "numeric", month: "short" });
  }

  /* The plugs' switch states in one string, to see whether a press changed anything. */
  _plugKeys() {
    return this._config.plugs.map((p) => { const s = this._s(p.switch); return s ? s.state : ""; }).join("|");
  }

  _plugState(p) {
    const s = this._s(p.switch);
    if (!s || MW_BAD.includes(mwKey(s.state))) return { kind: "na", text: "n/a" };
    if (mwKey(s.state) !== "on") return { kind: "off", text: "off", on: false };
    const ps = this._s(p.power);
    const w = ps && !MW_BAD.includes(mwKey(ps.state)) ? mwNum(ps.state) : null;
    if (w === null) return { kind: "on", text: "on", on: true };
    if (w < this._config.standby) return { kind: "stby", text: "standby", on: true };
    return { kind: "on", text: `${w >= 10 ? Math.round(w) : Math.round(w * 10) / 10} W`.replace(".", this._dec()), on: true };
  }

  _dec() {
    try { return (1.5).toLocaleString(this._lang()).charAt(1); } catch (_) { return "."; }
  }

  /* Everything the card shows, worked out from the entities. */
  _state(now) {
    const cfg = this._config;
    const s = this._s(cfg.stateEntity);
    const value = this._value();
    const mode = value === null ? null : cfg.modes.find((m) => m.id === value) || null;
    const off = value !== null && value === cfg.offId;
    const changed = s ? Date.parse(s.last_changed) : NaN;
    const plugs = cfg.plugs.map((p) => ({ ...this._plugState(p), name: p.name, id: p.id }));

    // success: the state followed the pressed button
    if (this._busy && (value !== this._busy.from || this._plugKeys() !== this._busy.plugs)) this._clearBusy();
    if (this._fail && now >= this._fail.until) this._fail = null;

    // Reality against the mode: offline plugs always, on/off differences once the plugs had time to follow.
    const issues = [];
    const settled = !this._busy && (isNaN(changed) || now - changed >= MW_GRACE_MS);
    if (!settled && !isNaN(changed) && !this._busy && !this._grace) {
      this._grace = this._later(MW_GRACE_MS - (now - changed) + 50, () => { this._grace = null; this._update(); });
    }
    plugs.forEach((p) => {
      if (p.kind === "na") { issues.push(`${p.name} offline`); p.warn = true; return; }
      if (!settled || (!mode && !off)) return;
      const want = mode ? mode.on.includes(p.id) : false;
      if (want && !p.on) { issues.push(`${p.name} is off`); p.warn = true; }
      if (!want && p.on) { issues.push(`${p.name} is on`); p.warn = true; }
    });
    return { s, value, mode, off, changed, plugs, issues, unavailable: !s || value === null };
  }

  _update() {
    if (!this._hass || !this._el) return;
    const cfg = this._config;
    const e = this._el;
    const now = this._now();
    const st = this._state(now);

    // Header: mode and since, then what is going on, then what does not match.
    e.title.textContent = st.unavailable ? "Unavailable" : st.mode ? st.mode.label : st.off ? "All off" : st.value;
    e.title.classList.toggle("warn", st.unavailable);
    const parts = [];
    if (!st.unavailable && !isNaN(st.changed)) parts.push(mwEsc(`since ${this._since(st.changed, now)}`));
    if (st.unavailable) parts.push(mwEsc(cfg.stateEntity));
    const nameOf = (id) => { const m = cfg.modes.find((x) => x.id === id); return m ? m.name : id; };
    if (this._busy) {
      const offing = this._busy.id === cfg.offId || this._busy.id === st.value;
      parts.push(offing ? "turning off" : mwEsc(`switching to ${nameOf(this._busy.id)}`));
    } else if (this._fail) {
      parts.push(`<span class="w">${mwEsc(`${this._fail.id === cfg.offId ? "Off" : nameOf(this._fail.id)}: no response`)}</span>`);
    }
    if (st.issues.length) parts.push(`<span class="w">${mwEsc(st.issues[0])}${st.issues.length > 1 ? ` · +${st.issues.length - 1}` : ""}</span>`);
    const line = parts.join(" · ");
    if (e.line._html !== line) { e.line._html = line; e.line.innerHTML = line; }

    // Plugs
    st.plugs.forEach((p, i) => {
      const el = e.plugs[i];
      el.el.className = `plug ${p.kind}${p.warn ? " warn" : ""}`;
      el.val.textContent = p.text;
      el.el.setAttribute("aria-label", `${p.name}: ${p.text}`);
    });

    // Mode buttons
    cfg.modes.forEach((m, i) => {
      const b = e.btns[i];
      const act = !!st.mode && st.mode.id === m.id;
      const busy = !!this._busy && this._busy.id === m.id;
      b.el.classList.toggle("act", act && !busy);
      b.el.classList.toggle("busy", busy);
      b.el.setAttribute("aria-pressed", String(act));
      b.hint.textContent = busy ? (act ? "turning off…" : "switching…") : act ? "tap to turn off" : "";
      if (cfg.picture) {
        const lit = act || busy;
        const key = String(lit);
        if (b.key !== key) {
          b.key = key;
          b.art.innerHTML = mwScene({ tv: m.on.includes("tv"), amp: m.on.includes("amp"), sub: m.on.includes("sub"), ps: m.on.includes("ps"), lit, uid: mwUid++ });
        }
      }
    });
    if (e.pw) {
      const anyOn = st.plugs.some((p) => p.on);
      e.pw.disabled = st.unavailable || (st.off && !anyOn);
      e.pw.classList.toggle("busy", !!this._busy && this._busy.id === cfg.offId);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Visual editor                                                            */
/* ------------------------------------------------------------------------ */

/*
 * Built on HA's own <ha-form>. Every field shows the value in use, defaults
 * included; only values that differ from the defaults are written to the
 * YAML. The four plug slots edit the plugs list (switch and power sensor);
 * modes are edited in YAML and kept as they are, like every other option the
 * editor does not show (grid_options, ...).
 */

const MW_TEXT_FIELDS = ["name", "field", "off_id"];
const MW_BOOL_FIELDS = ["movie", "off_button", "picture"];
const MW_NUMBER_FIELDS = [
  ["standby_below", "Standby below", 0, 1000, "W"],
  ["busy_timeout", "Wait for the script", 1, 60, "s"],
];

const MW_EDITOR_SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "state_entity", selector: { entity: { filter: { domain: ["input_text", "input_select", "select", "sensor"] } } } },
  { name: "script", selector: { entity: { filter: { domain: "script" } } } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "field", selector: { text: {} } },
      { name: "off_id", selector: { text: {} } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: MW_BOOL_FIELDS.map((k) => ({ name: k, selector: { boolean: {} } })),
  },
  {
    type: "expandable",
    name: "plugs",
    title: "Plugs",
    icon: "mdi:power-socket-eu",
    schema: MW_PLUGS.flatMap((p, i) => [{
      type: "grid",
      name: "",
      schema: [
        { name: `switch_${i}`, selector: { entity: { filter: { domain: "switch" } } } },
        { name: `power_${i}`, selector: { entity: { filter: { domain: "sensor" } } } },
      ],
    }]),
  },
  {
    type: "expandable",
    name: "",
    title: "Timing",
    icon: "mdi:timer-outline",
    schema: [{
      type: "grid",
      name: "",
      schema: MW_NUMBER_FIELDS.map(([k, , min, max, unit]) => ({ name: k, selector: { number: { min, max, step: 1, mode: "box", unit_of_measurement: unit } } })),
    }],
  },
  {
    type: "expandable",
    name: "colors",
    title: "Colours",
    icon: "mdi:palette",
    schema: [{ type: "grid", name: "", schema: Object.keys(MW_COLORS).map((k) => ({ name: k, selector: { text: {} } })) }],
  },
];

const MW_EDITOR_LABELS = {
  name: "Name (for screen readers)",
  state_entity: "Mode state entity",
  script: "Script",
  field: "Script field for the mode id",
  off_id: "Mode id for all off",
  movie: "Movie button",
  off_button: "Power button",
  picture: "Drawing",
  active: "active mode",
  warn: "mismatch",
  error: "offline",
  ...Object.fromEntries(MW_NUMBER_FIELDS.map(([k, label]) => [k, label])),
  ...Object.fromEntries(MW_PLUGS.flatMap((p, i) => [[`switch_${i}`, `${p.name} switch`], [`power_${i}`, `${p.name} power`]])),
};

/* The plugs list from a config, defaults filled in, as the card reads it. */
const mwPlugs = (config) => {
  if (config.plugs == null) return MW_PLUGS.map((p) => ({ ...p }));
  return config.plugs.map((p, i) => {
    const def = MW_PLUGS.find((d) => d.id === p.id) || MW_PLUGS[i] || {};
    return { ...p, id: p.id == null ? def.id : p.id, switch: p.switch == null ? def.switch : p.switch,
      power: p.power === undefined ? (p.switch == null ? def.power : null) || null : p.power };
  });
};

class MediaWallCardEditor extends HTMLElement {
  /* config -> form data: defaults filled in, null shown as empty. */
  static toData(config) {
    const data = { colors: { ...(config.colors || {}) }, plugs: {} };
    for (const k of MW_TEXT_FIELDS) data[k] = config[k] == null ? MW_DEFAULTS[k] : config[k];
    for (const k of ["state_entity", "script"]) data[k] = config[k] == null ? MW_DEFAULTS[k] : config[k];
    for (const k of MW_BOOL_FIELDS) data[k] = typeof config[k] === "boolean" ? config[k] : MW_DEFAULTS[k];
    for (const [k] of MW_NUMBER_FIELDS) { const v = mwNum(config[k]); data[k] = v == null ? MW_DEFAULTS[k] : v; }
    const plugs = mwPlugs(config);
    MW_PLUGS.forEach((_, i) => {
      data.plugs[`switch_${i}`] = (plugs[i] && plugs[i].switch) || "";
      data.plugs[`power_${i}`] = (plugs[i] && plugs[i].power) || "";
    });
    return data;
  }

  /* form data -> config: only what differs from the defaults. */
  static toConfig(data, previous) {
    const prev = previous || {};
    const config = { type: "custom:media-wall-card" };
    const handled = ["type", "plugs", "colors", "state_entity", "script", ...MW_TEXT_FIELDS, ...MW_BOOL_FIELDS, ...MW_NUMBER_FIELDS.map(([k]) => k)];
    for (const [k, v] of Object.entries(prev)) if (!handled.includes(k)) config[k] = v;
    for (const k of [...MW_TEXT_FIELDS, "state_entity", "script"]) {
      const v = typeof data[k] === "string" ? data[k].trim() : "";
      if (v && v !== MW_DEFAULTS[k]) config[k] = v;
    }
    for (const k of MW_BOOL_FIELDS) if (typeof data[k] === "boolean" && data[k] !== MW_DEFAULTS[k]) config[k] = data[k];
    for (const [k] of MW_NUMBER_FIELDS) { const v = mwNum(data[k]); if (v != null && v !== MW_DEFAULTS[k]) config[k] = v; }

    // Plugs: the slots update the current list; written only when it is not the default list.
    const cur = mwPlugs(prev);
    const f = data.plugs || {};
    const out = [];
    cur.forEach((p, i) => {
      if (i >= MW_PLUGS.length) { out.push(p); return; } // plugs past the four slots stay as they are
      const sw = f[`switch_${i}`] || p.switch; // a cleared switch falls back (a plug needs one)
      const pw = f[`power_${i}`] || null;
      out.push({ ...p, switch: sw, power: pw });
    });
    const isDefault = out.length === MW_PLUGS.length && out.every((p, i) => {
      const d = MW_PLUGS[i];
      return p.id === d.id && p.switch === d.switch && p.power === d.power && (p.name == null || p.name === d.name) && (p.icon == null || p.icon === d.icon);
    });
    if (!isDefault) {
      config.plugs = out.map((p) => {
        const d = MW_PLUGS.find((x) => x.id === p.id) || {};
        const o = { id: p.id, name: p.name == null ? d.name || p.id : p.name, switch: p.switch, power: p.power || null };
        if (p.icon != null && p.icon !== d.icon) o.icon = p.icon;
        return o;
      });
    }
    const colors = {};
    for (const [k, v] of Object.entries(data.colors || {})) if (typeof v === "string" && v.trim()) colors[k] = v.trim();
    if (Object.keys(colors).length) config.colors = colors;
    return config;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    this._loadForm().then(() => this._render());
  }

  /* ha-form is lazy loaded by HA; load it through a built-in card's editor. */
  async _loadForm() {
    if (customElements.get("ha-form")) return;
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "entities", entities: [] });
      if (card.constructor.getConfigElement) await card.constructor.getConfigElement();
    } catch (_) {
      /* rendered as soon as HA has loaded it */
    }
    await customElements.whenDefined("ha-form");
  }

  _render() {
    if (!this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = MW_EDITOR_SCHEMA;
      this._form.computeLabel = (s) => MW_EDITOR_LABELS[s.name] || s.name.replace(/_/g, " ");
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        const config = MediaWallCardEditor.toConfig(e.detail.value, this._config);
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = MediaWallCardEditor.toData(this._config);
  }
}

if (!customElements.get("media-wall-card")) {
  customElements.define("media-wall-card", MediaWallCard);
}
if (!customElements.get("media-wall-card-editor")) {
  customElements.define("media-wall-card-editor", MediaWallCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "media-wall-card")) {
  window.customCards.push({
    type: "media-wall-card",
    name: "Media Wall Card",
    description: "Living room audio / TV mode: one button per mode with a drawing of the media wall, a status line and the real state of the smart plugs.",
    preview: true,
    documentationURL: "https://github.com/BarBaar44/media-wall-card",
  });
}

console.info(`%c MEDIA-WALL-CARD %c ${VERSION} `, "background:#1565c0;color:#fff", "");
}
