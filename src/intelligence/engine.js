/**
 * Portable Nostr Intelligence Engine.
 * Thin barrel re-exporting focused preparation, preference, identity, and coverage bricks.
 */
export { reconstructPreferences, analyzeNsiteIdentity } from './analysis/identity-preferences.js';
export { detectAndPrepareContent } from './analysis/content-preparation.js';
export { auditCoverage, recordCorrection, summarizeObservedActivity } from './analysis/coverage.js';
