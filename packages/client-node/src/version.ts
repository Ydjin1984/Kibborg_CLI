/**
 * Version the interactive surfaces print.
 *
 * Both the inline surface and the fullscreen one draw the same location row, so
 * they must not carry their own copy of the string: a release that bumps one and
 * not the other shows two versions of the same program.
 * @module @kibborg/client-node/version
 */

/** Surface version, tracking the package version. */
export const SURFACE_VERSION = 'v0.1.0'
