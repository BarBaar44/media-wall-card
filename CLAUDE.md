# Media Wall Card: notes for working on this repo

Marketplace (formerly HACS) dashboard card (Lovelace) for the living room audio / TV mode. Owner: BarBaar44 (Bb). It replaced the last four Mushroom template cards on the Home view (section 2), so Mushroom and card_mod can be removed as resources. Sister repos with the same conventions: [gardenview-house](https://github.com/BarBaar44/gardenview-house) and [irrigation-card](https://github.com/BarBaar44/irrigation-card) (same drawing style), [appliance-card](https://github.com/BarBaar44/appliance-card) (the reference), [espresso-card](https://github.com/BarBaar44/espresso-card), [tesla-model3-card](https://github.com/BarBaar44/tesla-model3-card), [vacuum-card](https://github.com/BarBaar44/vacuum-card), [room-card](https://github.com/BarBaar44/room-card), [climate-card](https://github.com/BarBaar44/climate-card).

## Files

| File | Purpose |
|---|---|
| `media-wall-card.js` | The whole card: plain custom element, no build step, no dependencies. `MW_DEFAULTS`, `MW_PLUGS`, `MW_MODES` hold the owner's setup, `MW_COLORS` the colours, `mwScene` the drawing, `_state` the logic. |
| `tests/media-wall-card.test.js` | jsdom tests: texts, mismatches, grace, busy and timeout, actions, drawing, config errors, editor round trips. `npm test`. |
| `hacs.json` | Manifest for the Home Assistant Marketplace. |
| `README.md` | User docs, also the Marketplace info page. Keep the option, plug and mode tables in sync with the code. |
| `CHANGELOG.md` | One `## vX.Y.Z` section per release; the Release workflow uses it as the release notes. |
| `shot.png` | README image, linked by absolute raw URL. |
| `media-wall-card.yaml` | Minimal and full example configs. |

## The setup

* Four Shelly plugs: `switch.tv_switch`, `switch.amplifier_switch` (Denon receiver, 5.1), `switch.subwoofer_switch`, `switch.playstation_switch`, each with a `sensor.*_power` (W).
* `script.audio_management_lovelace` with `actionid`: TV, TVS, Games, Music, Movie (same as TVS), Off. If the mode is already active it switches everything off. It sets `input_text.audio_state`, also when automations switch everything off ("Go to bed", "Shutdown when away"). **Do not change the script from here.**
* The media wall (from Bb's photo): wall mounted TV, cream cabinet with a grey top, two panel doors with diamond escutcheons, the Denon in the open middle shelf with a drawer below, white centre speaker on top, two white B&W towers with grey grilles (green pot left, gold pot right), black sub at the far left (drawn as a cube on the floor, outside the shifted scene). Where the PlayStation stands is unknown; Games draws a controller on the cabinet (1.4× size, light bar glows while active). No Sony / PlayStation logo in the drawing (trademark); Games shows an own side scroller on the TV instead.

## Rules to keep

* The card only calls the script (`perform-action`, data `{ [field]: mode id }`) and opens more-info, both through `hass-action`. Never a switch call, never `hass.callService`.
* Tapping the active mode sends that mode again (the script turns it off). No confirmation dialogs.
* Busy: the pressed button shows dashed until the state value changes or any plug switch changes; after `busy_timeout` it goes back and the line shows `<mode>: no response` for 6 s. Pressing the busy button again sends nothing.
* Mismatches compare the plugs with the mode's `on` list, only 5 s after the state last changed and not while busy; unavailable plugs always count. First one plus `· +n` in the status line, in amber.
* Layout: 12 × 4, 248 px, always two columns of buttons (a fifth mode spans the third row). Button container query: below 200 px width the label goes top left, the hint is hidden and the drawing sits bottom right at 58 px; below 64 px height the narrow drawing is hidden. On desktop the drawing is at most 72 px high (134 × 72 viewBox), so labels like "TV + sound" fit next to it on a 244 px button. Measure in a real browser (Playwright) at 360 and 520 px after any layout change; a stub `ha-card` must not set `display` inline.
* Drawing: line art (light surfaces, `#141414` outlines), ghosted parts at 0.22 opacity, lit parts in `--mw-c` (the mode's colour or `active`) via `style`, because SVG presentation attributes do not take `var()`. Rebuilt only when a button's lit state changes.
* Visual editor (`MediaWallCardEditor`, on `ha-form`): fields show the defaults; only non-defaults are written; the four plug slots edit the plugs list, written only when it differs from the defaults; `modes` and unknown keys are kept. 
* Motion only in the active (or busy) mode with sound: towers sway ±2.2° from their foot (plinth stays put), centre speaker scales 9 % from its base, sub hops about 1.3 px and its driver pulses, notes float. TV on: landscape (two hill rows from `mwHills`, seamless by one period) drifts, sun bobs, faint flicker, ambient glow breathes; with `ps` in the mode the TV shows `mwGame` (bricks and coins scroll by one 18 unit period, hero hops). No sound wave arcs (Bb dropped them). Busy pulse too. All stop under reduced motion.
* The whole file sits in one block scope; `const VERSION` stays on its own line for the Release workflow.

## Releasing

1. Changes go through a pull request; Bb merges.
2. Bump `VERSION`, add the CHANGELOG section in the PR that is meant to become a release.
3. The owner pushes the `vX.Y.Z` tag, after the release PR is merged. **Never tag or release without the owner's explicit go.** Claude sessions here cannot push tags or create releases anyway.
4. The repo needs a description and the topics `hacs`, `hacs-dashboard`, `home-assistant`, `lovelace` under About, or HACS validation fails. Bb sets these.
