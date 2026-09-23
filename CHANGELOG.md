# Changelog

## 0.1.2 - 2026-09-23

Small visual fix.

### Fixed
- Negative table values now stay red even with the stronger readability styling.
- Positive table values keep their green highlight.
- This specifically restores red addiction penalties and negative financial values.

## 0.1.1 - 2026-09-23

Readability and layout polish after first live-company test.

### Changed
- Separated the "TORN COMPANY COMMAND CENTER" eyebrow from the company name with an explicit title block.
- Increased header spacing and set fixed line-height/title styling so Torn's page CSS cannot collapse the two lines together.
- Increased secondary-text contrast throughout cards, notes, health metrics, and settings.
- Explicitly styled table text colors to prevent Torn's global styles from making rows difficult to read.
- Increased table body size, row padding, header contrast, zebra striping, and hover highlighting.
- Improved panel/card borders and contrast.
- Improved navigation, buttons, inputs, and mobile sizing.
- Added stronger CSS isolation for common Torn style collisions.

### Deferred
- Movable COMPANY CC launcher.
- Option to show the launcher only on Torn company pages.

## 0.1.0 - 2026-09-23

Initial Company Command Center foundation.

### Added
- Floating COMPANY CC launcher across Torn
- Responsive director dashboard
- Torn API v2 connection and local API-key storage
- Company overview with revenue, expenses, net estimate, funds, and company-health metrics
- Expense calculation using wages, advertising, estimated stock COGS, and optional manual daily costs
- Local daily financial snapshots with 180-day retention
- Employee roster with effectiveness, addiction, inactivity, wage, tenure, and profile links
- Training rotation generated from the latest 100 company training-news entries
- Monthly eDVD paid/unpaid ledger with timestamps
- Configurable monthly eDVD quantity and due day
- Optional director exemption from eDVD dues
- Stock table with sales, estimated COGS, and rough stock-cover warnings
- JSON backup/export and import for local management data
- Tampermonkey/Violentmonkey request support plus browser-fetch fallback for broader userscript compatibility
- GitHub update and download URLs in userscript metadata

### Known limitations
- Profit is an operating estimate, not yet full transaction-level reconciliation.
- Daily history depends on the script being opened/refreshed.
- eDVD payment detection is manual in this release.
- Training detection is limited to the latest 100 training-news entries.
