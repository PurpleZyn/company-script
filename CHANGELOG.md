# Changelog

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
