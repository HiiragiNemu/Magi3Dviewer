# Main consolidation — 2026-10-03

Status: source integrated; deployment and cleanup verification in progress. This document is updated at the terminal release checkpoint.

Selected baseline: c5297e5 plus the currently used v5 cloth/normal/outline implementation and generic native-lining render fix. The relative-history jitter candidate was not admitted due to worsened peak corrections in some motions. No collision weakening was used.

637 website tests passed locally with no skips. Typecheck passed. The old clone-only README warning is being checked against a fresh tracked-source checkout, rather than assumed from a developer workspace.

Initial repository audit: 8 branches; 0 open PRs; 21 merged and 46 closed PRs. Historical PR records and runtime Release assets are retained. Branch history is retained without merging superseded implementations into the active tree.
