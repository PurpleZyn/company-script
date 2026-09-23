# Changelog

## 0.4.0 - 2026-09-23

Automatic eDVD dues scanner.

### Added
- Automatic scan of current-month Torn Item Receive logs (log type 4103).
- Erotic DVD detection using item ID 366.
- Keyword-gated payment recognition using configurable message keywords (default: CHAP, DUES).
- Employee validation so sends from non-employees do not count as company dues.
- Quantity aggregation across multiple qualifying sends from the same employee.
- Automatic paid status once the configured monthly eDVD requirement is reached.
- Detected eDVD progress column (for example 1 / 2 eDVD).
- Optional separate dues-scanner API key so the primary company key can remain Limited.
- Scanner status showing ACTIVE or NEEDS LOG KEY.
- Manual paid/unpaid overrides with a RETURN TO AUTO control.
- Manual Scan now button.

### Security
The recommended setup is a separate Custom Torn API key granting only User -> Log access restricted to Item receive (4103). API keys are excluded from exported backups.

### Current scope
Automatic recognition currently watches direct item sends. Trades and other possible transfer methods are not treated as dues unless their logs are added in a future update.

## 0.3.0 - 2026-09-23

Training rotation manager.

### Added
- Persistent employee training queue stored locally.
- Initial queue seeding based on oldest detected training time.
- Automatic queue advancement when Torn detects a new train for an employee.
- New employees are added to the queue automatically.
- Manual **NEXT**, **up**, **down**, and **SKIP** controls.
- "Reset from history" option to rebuild the queue if it ever gets out of sync.
- Rotation activity log showing automatic train detections, manual skips, and resets.
- Training summary showing queue size, available trains, last auto-advance, and rotation mode.
- Rotation data is included in JSON backup/export and import.

### Changed
- The Overview "Next in training rotation" card now uses the persistent queue rather than recalculating oldest-first on every render.
- Training news matching now prefers Torn profile IDs found in the news HTML before falling back to employee-name matching.

### Behavior
The first time v0.3.0 sees the company, it uses the existing Torn training history to create the starting order without pretending those old events just happened. From then on, newly detected trains move the trained employee to the back of the line automatically.

## 0.2.1 - 2026-09-23

Cash-reconciliation pass.

### Added
- Automatic parsing of company-fund deposits and withdrawals.
- Raw company-funds change since the day's first local capture.
- External-transfer totals for deposits and withdrawals.
- Adjusted cash change: raw vault change minus deposits plus withdrawals.
- A visual cash-reconciliation equation on the Finance tab.
- Deposit/withdrawal badges in the recent company fund activity table.
- Expanded history columns for raw funds delta, external transfers, and adjusted cash delta.

### Why this matters
Player deposits and withdrawals are now treated as outside transfers rather than company profit or loss. Operating profit and adjusted cash movement can therefore be compared without director funding activity distorting the result.

### Remaining limitation
Stock-order timing can still make adjusted cash movement differ from operating profit. That difference will become more useful as multiple days of snapshots accumulate.

## 0.2.0 - 2026-09-23

Finance system rebuild.

### Added
- Separate gross sales, estimated cost of goods sold, gross profit, operating overhead, and operating profit.
- Gross-margin and operating-margin calculations.
- Estimated break-even sales based on the current product-margin mix.
- Company funds change since the first local capture of the current TCT day.
- Profit bridge explaining how the operating-profit number is built.
- Expanded daily history with sales, COGS, ads/wages, operating profit, company funds, and funds delta.
- Company `funds` news feed on the Finance tab for future cash reconciliation.
- Cross-check between Torn company income and summed item sales.

### Changed
- The main Overview now labels the headline as estimated operating profit instead of generic net profit.
- Stock cost is treated as estimated cost of goods sold for profitability, separate from the timing of stock-order cash movement.
- Deposits/withdrawals and company-vault changes are no longer conceptually mixed into operating profit.

### Next
- Parse the live funds-news wording to classify deposits, withdrawals, stock-related cash movements, and other transfers automatically.

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
