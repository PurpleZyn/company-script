# Torn Company Command Center

A director-focused userscript for running a Torn company from one dashboard.

**Current version:** 1.0.1

## Install

### Tampermonkey / Violentmonkey

Open the raw userscript URL:

https://raw.githubusercontent.com/PurpleZyn/company-script/main/company-command-center.user.js

Your userscript manager should offer to install it. After installation, open Torn and look for the **COMPANY CC** button near the lower-right corner.

### Torn PDA

Add the same raw userscript URL through Torn PDA's userscript feature. The script includes a normal browser-fetch fallback for environments where Tampermonkey's request function is not available.

## First-time setup

1. Open Torn.
2. Click **COMPANY CC**.
3. Open **Settings**.
4. Paste a Torn API key.
5. Click **Save & Refresh**.

A **Limited** key or a suitably scoped **Custom** key is recommended. Director-level employee details such as wages and effectiveness require the appropriate access level.

**Never place your API key in this GitHub repository.** The script stores the key locally through the userscript manager where supported and sends it only to Torn's API.

## What v1.0.0 does

### Overview
- Director Brief combining finances, training, dues, employee issues, stock risk, recruiting, staffing, and role optimization
- At-a-glance company rating, operating profit, sales, funds, and recorded trends

### Launcher & alerts
- Draggable COMPANY CC launcher with remembered position
- Optional company-area-only launcher visibility
- Attention badge for active management categories
- Fresh/stale data indicator
- Optional in-app alerts for training advances, eDVD payments, applications, low stock, and optimizer changes
- Alerts establish a baseline on first run so existing events are not replayed as new

### Automatic refresh
- Refreshes company data automatically while Torn is open (30 minutes by default)
- Configurable 15–120 minute interval
- Refreshes after returning to Torn following an idle period
- Captures a near-end-of-day snapshot around 23:55 TCT when possible
- Detects TCT day rollover and starts the new day's snapshot automatically
- Manual refresh remains available

### Analytics
- Live current-day performance shown separately from completed-day history
- 7-day and 30-day rolling summaries use completed TCT days only
- Average sales, operating profit, operating margin, advertising burden, and revenue per advertising dollar
- Adjusted cash-movement history
- Daily company-health history
- Star-rating history
- Average employee-effectiveness history where data is available

- Current Torn-reported daily company revenue
- Estimated tracked expenses
- Estimated net profit/loss
- Company funds
- Efficiency, environment, popularity, and available trains
- At-a-glance alerts for training, unpaid eDVDs, employee effectiveness, and low stock

### Finances
The finance page now separates profitability into:

**Gross sales - estimated cost of goods sold = gross profit**

**Gross profit - advertising - wages - manual daily costs = estimated operating profit**

It also shows gross margin, operating margin, estimated break-even sales, raw company-fund changes, and an adjusted cash-change figure. Deposits into the company are subtracted from raw fund movement and withdrawals are added back, so director/player transfers do not get mistaken for company profit or loss. Stock-order timing can still cause adjusted cash change to differ from operating profit.

The dashboard stores a local daily snapshot whenever it refreshes, allowing a running history to build over time.

### Employees
- Employee name, position, wage, and company tenure
- Total effectiveness plus every effectiveness modifier returned by Torn
- Addiction and inactivity penalties highlighted
- Issue-first sorting and filters for All / Issues / Addiction / Inactivity
- Expandable employee detail rows
- Daily employee-history snapshots retained for 90 days
- Day-over-day effectiveness trend tracking
- Direct profile links

### Training rotation
The script now maintains a persistent queue rather than recalculating the order from scratch.

On first setup, employees are seeded oldest-trained first using Torn's **training** company news. After that, when a new train is detected for an employee, that employee is automatically moved to the back of the queue.

The director can also use **NEXT**, **up**, **down**, and **SKIP** controls to override the queue. A rotation activity log records automatic advances and manual skips, and "Reset from history" can rebuild the order if needed.

### eDVD dues
- Monthly employee ledger
- Configurable number of eDVDs owed per month
- Configurable due day
- Configurable dues-message keywords (default: CHAP, DUES)
- Director can be excluded
- Automatic scanning of direct Item Receive logs for Erotic DVD #366
- Only current employees + matching keywords count toward dues
- Multiple qualifying sends are accumulated toward the monthly requirement
- Manual paid/unpaid overrides remain available
- Reset-month control clears the current ledger and ignores earlier qualifying sends
- Optional separate Custom log-only API key
- Stored locally between sessions

### Recruiting
- Live hired/capacity and open-seat count
- Current staffing mix by position
- Configurable ideal headcount by position with short/on-target/over comparisons
- Whole-company role optimizer that preserves those target slot counts
- Manager-aware Store Manager selection using projected total effectiveness modifiers
- Per-employee optimized role and projected working-stat effectiveness
- Applicant best-planned-role and projected role-fit score
- Company application-open/closed status
- Applicant level and all three working stats
- Total work-stat display
- Application message, status, expiration countdown, and profile link
- Expiring-soon warning

### Stock
- In-stock amount and stock already on order
- Current daily units sold and sales value
- Daily per-item history retained for up to 90 days
- Average daily sales pace using up to seven completed TCT days
- Projected on-hand and total stock coverage
- Projected run-out date
- LOW / WATCH / HEALTHY / NO SALES status
- Configurable stock target and warning thresholds
- Configurable maximum warehouse capacity (500,000 by default)
- Capacity-aware reorder planning across the full catalog
- Current stock + existing orders reserve warehouse space before new recommendations
- Balanced achievable coverage when the ideal target cannot fit
- Combined suggested reorders stay within remaining capacity

### Local backup
Settings (excluding the API key), financial snapshots, and eDVD records can be exported to JSON and imported later.

## Current limitations

v1.0 is intentionally local-first.

- Profit remains an **operating estimate**, not formal accounting.
- Cost of goods sold is estimated from Torn's reported sold quantities and item costs.
- A completed historical day reflects the last snapshot captured on that TCT date. Auto-refresh and the 23:55 TCT capture greatly improve this, but the script cannot run while Torn/the browser is completely closed.
- Training rotation detection uses the recent company training-news window.
- Automatic eDVD dues detection currently watches direct Item Receive logs with the configured keyword rule.
- Role optimization models Torn working-stat effectiveness and treats Store Manager specially, but it does not invent an exact hidden management-bonus formula.
- The role catalog is currently tailored to Adult Novelties.

These limitations are surfaced in the interface rather than hidden behind false precision.

## v2 possibility

If long-term usage shows that missing end-of-day captures or cross-device history are meaningful problems, a future v2 can add an optional hosted/always-on collector and central history sync. v1.0 does not require any server or hosting.

## Data sources

The script currently uses Torn API v2 data including:

- `/company/profile`
- `/company/employees`
- `/company/stock`
- `/company/applications`
- `/company/news?cat=training`
- `/company/news?cat=funds`
- `/user/log` for optional eDVD Item Receive scanning

No API key is hard-coded in this repository. API keys are excluded from exported backups.
