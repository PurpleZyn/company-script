# Changelog

## 0.9.1 - 2026-09-23

Completed-day analytics correction.

### Changed
- 7-day and 30-day rolling analytics now exclude the current in-progress TCT day.
- Today is shown separately as **live / provisional** performance.
- Daily history labels the current date as LIVE and prior dates as COMPLETE.
- Overview trend now uses completed days only.
- Analytics cards show a waiting state until at least one completed TCT day exists.
- Company-rating summary now distinguishes completed history from total captured days.

### Why
Using today's partial sales against a full daily advertising budget made early-day revenue-per-ad-dollar, margin, and rolling averages look more authoritative than they really were. This update keeps live numbers visible while preventing them from contaminating historical averages.

## 0.9.0 - 2026-09-23

Director Dashboard and Analytics.

### Added
- New **Analytics** tab.
- Stronger Overview with a live **Director Brief** covering finances, training, eDVD dues, employee penalties, stock risk, recruiting, staffing-plan alignment, and role-optimizer recommendations.
- 7-day and 30-day analytics based on locally recorded TCT-day snapshots.
- Average sales, operating profit, operating margin, advertising spend, revenue per advertising dollar, advertising burden, and adjusted cash movement.
- Daily performance-history table.
- Company star-history tracking.
- Daily storage of efficiency, environment, popularity, available trains, employee count, and application count.
- Historical average employee-effectiveness display when matching employee snapshots are available.
- Overview shortcut into the Analytics tab.
- Recorded-trend summary on the Overview.

### Important history behavior
The script is still local-first. Each TCT day reflects the last snapshot captured on that day. If the script was not refreshed late in the day, that day's sales/profit can be partial. The interface states this explicitly rather than presenting incomplete local history as exact full-day accounting.

## 0.8.1 - 2026-09-23

Manager-aware role optimization.

### Fixed
- Corrected a modeling gap where the optimizer treated Store Manager like an ordinary production role.
- Store Manager selection now considers projected total effectiveness before the Management bonus, not only raw working-stat effectiveness.
- The remaining non-manager slots are still optimized by working-stat effectiveness under the saved staffing-plan constraints.
- The optimizer now labels “Raw Stat Best” explicitly so that value is not confused with the whole-company assignment recommendation.

### Added
- Recommended Manager callout.
- Projected Manager effectiveness before Torn's management bonus.
- Manager work-stat score shown separately.

### Why
Torn's Store Manager is a special Manager position whose effect scales with the employee's effectiveness. This matters when two people have similar role stats but very different merits, addiction, settled-in, or other effectiveness modifiers.

The displayed projected gain remains the working-stat component only; the script does not invent an exact hidden Management-bonus formula.

## 0.8.0 - 2026-09-23

Employee role optimizer and applicant role-fit engine.

### Added
- Adult Novelties role-requirement catalog for Sales Assistant, Sexpert, Store Manager, Marketing Manager, Receptionist, Human Resources, and Cleaner.
- Projected working-stat effectiveness calculator using Torn's documented/researched position-effectiveness behavior.
- Automatic calibration against Torn's current employee Working Stats effectiveness values when available.
- Constrained whole-company optimizer that maximizes projected working-stat effectiveness while preserving the director's saved staffing-plan counts.
- Current projected lineup score, optimized projected score, projected gain, number of suggested position changes, and calibration multiplier.
- Per-employee current role, current projected stat score, optimized role, optimized score, delta, and individual best planned role.
- Optimizer handles the entire lineup together so multiple employees cannot all be assigned to the same limited slot.
- All Adult Novelties roles are available in the staffing-plan editor, including roles currently set to zero.
- Applicant table now shows each applicant's best role among positions currently enabled in the staffing plan plus the projected working-stat score for that role.

### Design choice
The optimizer recommends position changes but does not automatically modify Torn positions. It optimizes the working-stat component and keeps other effectiveness modifiers (addiction, inactivity, settled-in, merits, management, etc.) separate rather than pretending they are raw work stats.

## 0.7.1 - 2026-09-23

Recruiting staffing-plan upgrade.

### Added
- Configurable target headcount for each current company position.
- Live current-vs-target comparison.
- SHORT / ON TARGET / OVER staffing indicators.
- Recruiting summary showing total positions short and over target.
- Staffing targets persist locally and are included in JSON backup/export and import.
- Save-plan control directly on the Recruiting tab.

### Behavior
The first time this version loads, each position target is initialized to the current headcount so nothing is falsely flagged. From there, the director can edit the desired staffing mix and the dashboard will track differences even when the company is already at full capacity.

## 0.7.0 - 2026-09-23

Recruiting and applicant dashboard.

### Added
- New Recruiting tab.
- Live company staffing count and capacity.
- Open-seat count.
- Current application-open/closed status.
- Current staffing mix by employee position.
- Live company applications from Torn API v2.
- Applicant level, manual labor, intelligence, endurance, and total work stats.
- Application status, expiration countdown, message, and direct player profile link.
- Expiring-within-24-hours warning.
- Applicants sorted by expiration first.
- Overview attention card for active applications.

### Design choice
Applicants are presented with raw role-relevant facts rather than a generic applicant score. A future update can add director-configured role targets for comparing applicants against the exact position being recruited.

## 0.6.0 - 2026-09-23

Stock forecasting and reorder guidance.

### Added
- Daily per-item stock history retained for up to 90 days.
- 7-day average daily sales forecast once completed TCT days are available.
- Temporary fallback to today's sold amount until historical daily data exists.
- Projected on-hand cover and total cover including stock already on order.
- Projected run-out date.
- Suggested reorder quantity to reach a configurable stock-cover target.
- LOW / WATCH / HEALTHY / NO SALES stock status badges.
- Stock summary cards for low-stock items, watch-list items, average projected cover, suggested reorder units, and history depth.
- Configurable stock target days and low-stock warning days in Settings.
- Overview low-stock warning now uses the forecasting system instead of a simple same-day ratio.
- Stock history included in JSON backup/export and import.

### Forecast behavior
Once at least one completed TCT day exists, the script uses up to the most recent seven completed daily snapshots to estimate average sales pace. Until then, it uses the current day's sold amount as a provisional pace. Suggested reorders account for both inventory on hand and stock already on order.

## 0.5.1 - 2026-09-23

eDVD dues reset control.

### Added
- **Reset month** button on the eDVD Dues tab.
- Confirmation prompt before clearing the current month's dues ledger.
- Reset baseline timestamp for the current month.
- Automatic scanner ignores qualifying eDVD sends received before the reset baseline.
- Reset baseline is included in JSON backup/export and import.

### Why
This makes testing and month re-initialization possible without old qualifying eDVD sends immediately repopulating the ledger after a manual reset.

## 0.5.0 - 2026-09-23

Employee management expansion.

### Added
- Employee summary cards for average effectiveness, clear employees, addiction penalties, and inactivity penalties.
- Issue-first sorting so employees with active penalties rise to the top.
- Filters for All, Issues, Addiction, and Inactivity.
- Expandable employee detail rows showing every effectiveness component returned by Torn.
- Daily employee-history snapshots retained for 90 days.
- Effectiveness trend delta compared with the most recent previous TCT day.
- Expanded trend detail for effectiveness, addiction, and inactivity changes.
- Employee-history data included in JSON backup/export and import.

### Changed
- The employee page is now a management dashboard instead of a static roster.
- Effectiveness details are generated dynamically from Torn's returned fields, avoiding hard-coded assumptions about which modifiers are available.

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
