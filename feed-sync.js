/* Drop-in sync for the existing React dashboard (index.html).
 *
 * Add this one line just above the React script tags:
 *     <script src="feed-sync.js"></script>
 *
 * It pulls data/jobs.json into the same localStorage key the dashboard already
 * uses, keeping any status you have already set. Nothing in index.html needs to
 * change, and if the feed is missing the dashboard behaves exactly as before.
 */
(function () {
  const JOB_KEY = "careerpilot_bd_v2_jobs";
  const DECISION_KEY = "careerpilot_bd_v2_decisions";
  const RELOAD_FLAG = "careerpilot_feed_synced";
  const FEED_URL = "data/jobs.json";
  // Mirrors backend/store.py's ACTIVE_STATUSES. A job you have acted on is
  // kept even after it drops out of the feed; one you never touched is
  // dropped, so removing a source (like the old sample fixtures) actually
  // cleans itself out of a browser that already synced it.
  const ACTIVE_STATUSES = new Set(["Saved", "Awaiting Approval", "Applied", "Interview", "Offer"]);

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || fallback); } catch { return JSON.parse(fallback); }
  };

  fetch(FEED_URL + "?t=" + Date.now(), { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((data) => {
      const stored = read(JOB_KEY, "[]");
      const decisions = read(DECISION_KEY, "{}");
      const known = new Map();
      const loose = [];
      for (const j of stored) {
        if (j.fingerprint) known.set(j.fingerprint, j); else loose.push(j);
      }

      let added = 0;
      const merged = (data.jobs || []).map((incoming) => {
        const existing = known.get(incoming.fingerprint);
        const decided = decisions[incoming.fingerprint];
        if (!existing) added++;
        known.delete(incoming.fingerprint);
        return {
          ...incoming,
          id: (existing && existing.id) || incoming.id,
          status: (decided && decided.status) || (existing && existing.status) || incoming.status,
          selectedStrategy: existing && existing.selectedStrategy,
        };
      }).concat([...known.values()].filter((j) => ACTIVE_STATUSES.has(j.status)), loose);

      localStorage.setItem(JOB_KEY, JSON.stringify(merged));

      // React read localStorage before this fetch finished, so a single
      // reload is the honest way to show the new rows. Guarded so it can
      // only ever happen once per tab.
      if (added > 0 && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        location.reload();
      }
    })
    .catch(() => { /* No feed yet. The dashboard works offline regardless. */ });
})();
