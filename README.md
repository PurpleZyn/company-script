# Torn Company Command Center

A director-focused userscript for running a Torn company from one dashboard.

**Current version:** 0.5.0

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

## What v0.5.0 does

### Overview
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
- Optional separate Custom log-only API key
- Stored locally between sessions

### Stock
- In-stock amount
- Stock on order
- Current amount sold
- Sales value
- Estimated cost of goods sold
- Rough days-of-stock coverage warning

### Local backup
Settings (excluding the API key), financial snapshots, and eDVD records can be exported to JSON and imported later.

## Interface notes

The launcher currently appears across Torn so the dashboard remains accessible while traveling. A movable launcher and an option to limit it to company pages are planned after the core company-management features are validated.

## Current limitations

This is the foundation release, not the final accounting engine.

- Profit is currently an **operating estimate** rather than bank-account reconciliation.
- Cost of goods sold is estimated as current sold quantity multiplied by Torn's reported item cost.
- Historical snapshots are captured when the script is actually opened/refreshed.
- Training matching currently uses the latest 100 training-news entries.
- eDVD dues are manual in v0.1.0.

These are intentionally visible rather than hidden so the dashboard never presents an estimate as exact accounting.

## Planned work

Near-term additions include automatic eDVD payment detection, stronger daily transaction reconciliation, training-cycle controls and skips, historical charts, recruiting/applicant tools, stock forecasting, alerts, and same-company-type benchmarking.

## Data sources

The script currently uses Torn API v2:

- `/company/profile`
- `/company/employees`
- `/company/stock`
- `/company/news?cat=training`

No API key is hard-coded in this repository.
