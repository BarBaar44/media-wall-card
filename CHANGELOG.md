# Changelog

## v0.1.0

First release.

- One card for the living room audio / TV mode: TV, TV with sound, Games, Music, optional Movie; 2 × 2 buttons in a 12 × 4 card, the same space as the four Mushroom cards it replaces.
- Line drawing of the owner's media wall on every button: the mode's devices in full, the rest ghosted; lit (TV picture, receiver display, sound waves, sub, controller, music notes) when the mode is active.
- Mode buttons call the owner's script with the mode id; tapping the active mode turns everything off (the script's own behaviour). Optional power button.
- Status line: mode, since when, switching or no response, and the first mismatch between the mode and the plugs (`PS is off`, `TV is on`, `Amp offline`), after a 5 second grace.
- Plug indicators with power, standby and unavailable; tap for more-info.
- Busy state on the pressed button until the state or a plug follows, back after `busy_timeout`.
- Visual editor.
