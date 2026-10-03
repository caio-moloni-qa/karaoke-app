// Shared by the processing panel (client) and the server-side clear/agent
// code, so "stuck" means the same thing everywhere.

export const ACTIVE_JOB_STATUSES = ["queued", "claimed", "downloading", "separating", "uploading"] as const;

// The worker only reports progress at stage boundaries, and stem separation
// alone takes several minutes — but an in-progress job silent for this long
// was almost certainly orphaned by the worker stopping mid-song. Nothing
// reclaims those, so they'd otherwise look alive forever.
export const STALE_JOB_AFTER_MS = 30 * 60 * 1000;
