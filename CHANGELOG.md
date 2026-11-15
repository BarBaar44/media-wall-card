# Changelog

## v0.1.2

- The TV plays while it is on: a landscape with two rows of hills drifting by, a moving sun and a faint flicker; with sound on, the ambient glow behind it breathes.
- Games has its own picture on the TV: a little side scroller (bricks and coins scroll by, a figure hops).
- The controller on the cabinet is a size bigger and moved left so it reads at button size; its light bar glows while Games is active.
- All of it stands still under reduced motion.

## v0.1.1

- The subwoofer is now drawn as a black cube on the floor at the far left (it was a narrow strip at the edge).
- The drawing moves while the active mode plays sound: the towers sway from their foot, the centre speaker leans in and out, the sub hops and its driver pumps. The sound wave arcs are gone. Everything stands still under reduced motion.
- The drawing is a little lower on desktop (72 px instead of 78 px), so a label like "TV + sound" keeps its room next to the wider picture.

## v0.1.0

First release.

- One card for the living room audio / TV mode: TV, TV with sound, Games, Music, optional Movie; 2 × 2 buttons in a 12 × 4 card, the same space as the four Mushroom cards it replaces.
- Line drawing of the owner's media wall on every button: the mode's devices in full, the rest ghosted; lit (TV picture, receiver display, sound waves, sub, controller, music notes) when the mode is active.
- Mode buttons call the owner's script with the mode id; tapping the active mode turns everything off (the script's own behaviour). Optional power button.
- Status line: mode, since when, switching or no response, and the first mismatch between the mode and the plugs (`PS is off`, `TV is on`, `Amp offline`), after a 5 second grace.
- Plug indicators with power, standby and unavailable; tap for more-info.
- Busy state on the pressed button until the state or a plug follows, back after `busy_timeout`.
- Visual editor.
