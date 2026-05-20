/**
 * UI feedback timing constants — all measured in milliseconds.
 *
 * Each component used to inline a raw `setTimeout(..., N)` literal with
 * the meaning left implicit in the surrounding code. Naming them here
 * keeps the values findable when tuning (e.g. "feedback flashes too
 * briefly on slow displays") and lets two components share a value when
 * the UX intent matches.
 */

/** How long a "Renamed!" / "Converted!" success badge stays visible on
 *  SelectedFilePanel before reverting. Long enough for the user to read,
 *  short enough to feel snappy. */
export const FILE_ACTION_FEEDBACK_MS = 2500;

/** Duration of the OutputPanel's "filename generated" pulse animation.
 *  Sized to match the CSS keyframes — bumping requires updating both. */
export const OUTPUT_PULSE_MS = 600;

/** How long TagsEditor flashes the title input red when Generate is
 *  pressed with an empty title. */
export const TITLE_VALIDATION_FLASH_MS = 1200;

/** Delay before revoking the `URL.createObjectURL` blob in
 *  LibrarySettingsSheet's JSON export. The download dialog has fully
 *  consumed the URL by then on every browser we support. */
export const OBJECT_URL_REVOKE_MS = 3000;
