# Nsaq Architectural Decisions

## Decision Log

### D-001
**Decision:** Nsaq is a multi-tenant SaaS platform from day one.  
**Reason:** Future agency and enterprise support requires strict data isolation.  
**Status:** Approved

### D-002
**Decision:** Phase 1 optimization only covers budget, bidding strategy, and bid limits.  
**Reason:** These are high-impact and safer than automating audience/creative interventions early.  
**Status:** Approved

### D-003
**Decision:** Optimization must be rule-based first, AI-ready later.  
**Reason:** Rule-based systems are auditable, easier to launch, and easier to validate commercially.  
**Status:** Approved

### D-004
**Decision:** Dynamic control must be available through admin settings.  
**Reason:** The product must not behave like a black box and must remain configurable.  
**Status:** Approved

### D-005
**Decision:** The provider layer must be abstracted and platform-agnostic.  
**Reason:** Avoid tightly coupling platform APIs to core optimization logic.  
**Status:** Approved

### D-006
**Decision:** All optimizer actions must be logged with before/after state.  
**Reason:** Transparency, trust, debugging, and future AI training depend on action history.  
**Status:** Approved

### D-007
**Decision:** Arabic and English support are mandatory in UI architecture.  
**Reason:** The product is Saudi-first and must be RTL-ready from the start.  
**Status:** Approved