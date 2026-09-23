# Torn Company Command Center

A director-focused userscript for running a Torn company from one dashboard.

**Current version:** 0.2.0

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

## What v0.2.0 does

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

It also shows gross margin, operating margin, estimated break-even sales, company-fund changes, and the company's recent funds-news feed. The funds feed is intentionally shown separately because deposits, withdrawals, and stock-order timing can move the company vault without being profit or loss.

The dashboard stores a local daily snapshot whenever it refreshes, allowing a running history to build over time.

### Employees
- Employee name and position
- Total effectiveness
- Addiction penalty
- Inactivity penalty
- Wage
- Days in company
- Direct profile links

### Training rotation
The script reads the latest company news from Torn's **training** category and builds a rotation based on who was trained least recently.

Employees with no detected train in the available recent-news window rise to the top.

### eDVD dues
- Monthly employee ledger
- Configurable number of eDVDs owed per month
- Configurable due day
- Director can be excluded
- Paid/unpaid status with payment timestamp
- Stored locally between sessions

Automatic eDVD receipt detection is planned after the exact live item/trade log patterns are validated.

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
