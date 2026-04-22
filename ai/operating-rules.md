# Nsaq Agent Operating Rules

## General Rule
Every AI agent working on this project must read:
- ai/brain.md
- ai/decisions.md
- ai/tasks.md

before making major changes.

---

## Coding Rules
- Prefer modular, production-grade structure
- Avoid shortcuts that break scalability
- Keep optimizer isolated from provider-specific logic
- Use strong typing
- Ensure every business decision is traceable
- Never remove logging from optimization flow
- Avoid duplicate logic across modules

---

## Product Rules
- Phase 1 = budget + bidding strategy + bid limits only
- Audience automation is out of scope
- Dynamic control is required
- Multi-tenant safety is mandatory
- Bilingual support is required

---

## Review Rules
When reviewing code, check:
1. Is architecture preserved?
2. Is multi-tenancy respected?
3. Is optimizer logic explainable?
4. Are actions logged?
5. Is the feature within current phase scope?
6. Is provider abstraction preserved?

---

## Anti-Patterns
Do not:
- hardcode Meta/TikTok logic inside optimizer core
- add hidden optimizer behaviors without logging
- directly mutate values without guardrails
- build advanced AI features before stable rule engine
- ignore Arabic/RTL requirements