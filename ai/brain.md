# Nsaq AI Brain
Version: 1.0
Owner: Mohsen Al-Khabsh
Product: Nsaq
Type: AI-Powered AdTech SaaS Platform

---

## 1. Product Identity

### Product Name
Nsaq

### Product Category
AdTech SaaS Platform  
Marketing Technology (MarTech)  
AI-Powered Advertising Optimization System

### Core Positioning
Nsaq is a multi-tenant SaaS platform built to launch, monitor, and optimize advertising campaigns across multiple ad platforms with a strong focus on automation, performance improvement, and future AI-driven optimization.

### Primary Market
- Saudi Arabia first
- GCC and Arab world second
- Global expansion later

### Core Users
- Performance marketers
- Agencies
- E-commerce brands
- SMEs
- In-house marketing teams

---

## 2. Product Vision

Nsaq should become a smart advertising operating system that does not merely display metrics, but actively improves campaign performance with controlled automated interventions.

The system must evolve from:
1. Campaign management
2. Rule-based optimization
3. Dynamic control via admin configuration
4. AI-assisted recommendations
5. Fully adaptive optimization intelligence

---

## 3. Product Philosophy

Nsaq is not just an ads dashboard.

It is designed around these principles:

- Performance before decoration
- Clarity before complexity
- Automation with auditability
- Intelligence with human control
- Scalable architecture from day one
- Multi-tenant by default
- Platform-agnostic integration layer
- Arabic-first but globally ready

---

## 4. Current Product Scope (Phase 1)

Phase 1 focuses on:

### A. Core SaaS Foundation
- Authentication
- Organizations / workspaces
- User roles and permissions
- Billing-ready structure
- Multi-tenant isolation

### B. Ad Platform Connections
- Meta
- TikTok
- Google Ads
- Snapchat

### C. Campaign Management
- Connect ad accounts
- Create campaigns
- View campaign status
- View performance metrics
- Store historical metrics

### D. Smart Auto-Optimization (Phase 1)
The system must automatically intervene on:

1. Daily Budget
2. Bidding Strategy
3. Bid Limits (floor / ceiling)

### E. Admin Dynamic Control
The system must allow admin/system owner to:
- Enable / disable optimization rules
- Configure thresholds
- Adjust intervention deltas
- Set guardrails
- Control priority accounts
- Review optimizer logs

---

## 5. What Nsaq MUST NOT be

Nsaq must not become:
- Just a static reporting dashboard
- A simple ads launcher without intelligence
- A hardcoded one-platform tool
- A black box with unexplained decisions
- A fragile prototype without scalability

---

## 6. Optimization Philosophy

### Optimization Model
Nsaq optimization is based on:
- Structured decision rules
- KPI threshold comparison
- Recency-weighted evaluation
- Controlled intervention
- Cooldown windows
- Guardrails
- Logging + audit trail
- Admin configurability

### Phase 1 Optimization Dimensions
Only intervene on:
- Daily budget allocation
- Bidding strategy type
- Bid floor / ceiling limits

### Why these 3 first?
Because they are:
- high impact
- safer than audience manipulation
- easier to explain
- easier to audit
- more scalable across platforms

### NOT in Phase 1
Do not automate yet:
- Audience targeting changes
- Creative rotation
- Landing page changes
- Product/offer modifications

These are future phases.

---

## 7. Smart Optimization Rules (Phase 1)

### Rule Family 1: Budget Adjustment
Examples:
- Increase daily budget by +15% if ROAS >= target for 3 consecutive days
- Decrease daily budget by -10% if CPA exceeds target by 20% for 2 consecutive days
- Never exceed +30% budget increase in 24h
- Never decrease too aggressively if the campaign is still in learning phase

### Rule Family 2: Bidding Strategy Switching
Examples:
- Lowest Cost → Cost Cap if CPA is unstable/high
- Cost Cap → Lowest Cost if campaign underdelivers and spend pacing is weak
- Cost Cap → Bid Cap in high competition cases only if admin allows

### Rule Family 3: Bid Limits Control
Examples:
- Reduce bid ceiling by -10% if CPC is too high without CTR improvement
- Slightly increase bid ceiling if delivery is weak and target efficiency still acceptable
- Keep floor/ceiling bounded by platform-safe ranges

---

## 8. Optimization Guardrails

These are mandatory.

- Cooldown per entity after intervention = 24h minimum
- No more than one major budget action per cycle
- No abrupt bid swings
- No full pause of campaign/ad set in Phase 1 unless explicitly allowed by admin
- All actions must be logged with before/after state
- Every rule must be explainable
- If sample size is insufficient, no intervention should happen

---

## 9. Metrics Logic

### Core KPIs
- Spend
- Impressions
- Clicks
- CTR
- CPC
- Conversions
- CPA
- Revenue
- ROAS
- Reach
- Frequency
- Spend pacing

### Evaluation Window
Primary decision window:
- last 24h
- last 48h
- last 72h

### Weighting
Recent data should have more influence than older data.

Default recency logic:
- 24h window = strongest weight
- 48h = medium
- 72h = supportive

---

## 10. Dynamic Control Philosophy

The optimizer is automated, but not ungoverned.

The system owner/admin must be able to:
- configure rules
- change targets
- prioritize accounts
- relax or tighten thresholds
- disable risky interventions
- inspect optimizer decisions

This is not necessarily real-time editing, but it must be configurable through the control panel without engineering changes.

---

## 11. Multi-Tenant Principles

Nsaq must be multi-tenant from the start.

### Isolation rules
- Each organization has isolated data
- Users belong to orgs via memberships
- No cross-org leakage
- Optimization rules may be global defaults + org-level overrides
- Settings are stored at org level unless explicitly global

---

## 12. Architecture Principles

### Backend principles
- Modular design
- Clear domain separation
- Provider abstraction layer
- Rules engine isolated from providers
- Database-first consistency
- Event and action logging mandatory

### Frontend principles
- Bilingual (ar/en)
- RTL support for Arabic
- Simple, premium, data-first UI
- Minimal clutter
- Dashboard clarity > fancy visuals

### Provider principles
Never hardcode platform-specific logic directly into core business logic.

Use adapters/providers:
- MetaProvider
- TikTokProvider
- GoogleAdsProvider
- SnapProvider

The core optimization engine should call provider-agnostic interfaces.

---

## 13. Security Principles

- Secure authentication
- Role-based authorization
- Secrets never hardcoded
- Audit logs for optimizer actions
- Safe handling of third-party tokens
- Multi-tenant isolation enforced at backend + database level

---

## 14. Data Principles

Nsaq should collect structured data that is useful later for AI.

### Data to persist
- campaign metadata
- ad set metadata
- bid strategy values
- budget values
- intervention logs
- pre/post intervention metrics
- rules triggered
- alerts raised

### AI readiness
Phase 1 does not require model training, but data collection must be future-ready.

---

## 15. UX/Product Principles

The user should always feel:
- the system is smart
- the system is under control
- the system is transparent
- the system is helping, not acting randomly

### Therefore:
- show why action happened
- show what changed
- show before/after values
- show whether automation is active
- allow admin override where appropriate

---

## 16. Agent Working Expectations

Any AI agent working on Nsaq must obey:

1. Do not break multi-tenant architecture
2. Do not hardcode platform logic into the core optimizer
3. Do not make optimization rules opaque
4. Do not skip logging
5. Do not add features outside current phase unless explicitly requested
6. Prefer production-ready structure over quick hacks
7. Keep code modular and auditable
8. Always align implementation with this document

---

## 17. Future Scope (Do not build unless requested)

- Audience optimization
- Creative rotation
- Creative scoring
- AI recommendations
- Predictive budget planning
- Cross-platform redistribution
- Advanced anomaly detection
- Enterprise billing and invoicing
- WhatsApp premium reporting
- Reinforcement learning

---

## 18. Source of Truth

If any design, code, or implementation conflicts with this document, this document takes priority unless the product owner explicitly overrides it.

Nsaq must always remain:
- performance-led
- automation-ready
- explainable
- scalable
- premium