// Capability descriptor reported by every IAdProvider. The optimizer (and the
// frontend, eventually) consult this BEFORE proposing or surfacing actions
// that the underlying platform cannot honor. Fail-fast at the boundary beats
// silent no-ops inside the adapter.
//
// Each capability answers a YES/NO that gates a specific optimizer action
// or ingestion behavior:
export interface ProviderCapabilities {
  // ─── Budget controls ─────────────────────────────────────────────────────
  supportsCbo:               boolean;   // campaign-level budget optimization (Meta CBO, Google "Performance Max" etc.)
  supportsLifetimeBudget:    boolean;   // lifetime budget vs. daily-only

  // ─── Bid controls ────────────────────────────────────────────────────────
  // Many platforms have asymmetric bid floor/ceiling support. Meta has no
  // ad-set bid floor; Google does. Optimizer must skip ADJUST_BID_FLOOR
  // actions when supportsBidFloor=false.
  supportsBidFloor:          boolean;
  supportsBidCeiling:        boolean;

  // ─── Goal-based bidding ──────────────────────────────────────────────────
  supportsRoasGoal:          boolean;   // TARGET_ROAS strategy
  supportsCpaGoal:           boolean;   // TARGET_CPA strategy

  // ─── Creation paths ──────────────────────────────────────────────────────
  // When false, createCampaign/AdSet/Ad must still satisfy IAdProvider but
  // the launcher can short-circuit and surface a clearer error.
  supportsCampaignCreation:  boolean;
  supportsCreativeUpload:    boolean;
}
