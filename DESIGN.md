# Mortgage Calculator — Design Document

## 1. Overview

A fully static, single-page mortgage calculator web application with no backend or database dependencies. All computation runs client-side in the browser using vanilla HTML, CSS, and JavaScript.

The calculator targets the same use-case as the Bankrate mortgage/amortization calculator, but adds:

- **PITI** (Principal + Interest + Taxes + Insurance) breakdown, including PMI when applicable.
- A full amortization schedule with a novel **Balance Interest Rate** column.
- A live **current average mortgage rate** widget backed by the Freddie Mac PMMS Excel dataset (no API key required), with a configurable historical rate chart.

---

## 2. Project Structure

```
mortgage-calculator/
├── index.html          # Main (and only) HTML page
├── css/
│   └── styles.css      # All styling — dark-mode, glassmorphism, animations
├── js/
│   ├── calculator.js   # Core mortgage math (amortization, PITI, PMI, extra payments)
│   ├── rateData.js     # Freddie Mac PMMS parser & rate access (with offline fallback)
│   ├── chart.js        # Historical rate chart & interactive click-to-apply rate
│   ├── app.js          # UI bindings, state management, breakdown donut, CSV export
│   ├── pmms_rates.js   # Pre-parsed baseline Freddie Mac PMMS rates (loaded via <script> for file:// support)
│   └── pmms_rates.json # JSON format of baseline PMMS rates
└── DESIGN.md           # This file
```

---

## 3. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| HTML/CSS/JS | Vanilla JS (standard `<script>` tags) | Zero build step; fully static; served via a local HTTP server (e.g. Python's built-in `http.server`) |
| Charting | Chart.js v4 via CDN | Lightweight, no bundler required |
| Rate data | Pre-bundled `pmms_rates.js` + Freddie Mac PMMS XLSX live sync | Baseline rate data ready immediately; fetches latest weekly updates when online |
| XLSX parsing | Python (built-in zipfile/xml) | Pre-processed offline via `generate_pmms_rates.py` into `js/pmms_rates.js` |
| Icons | Lucide Icons via CDN | Lightweight SVG icon set |
| Fonts | Google Fonts — Inter | Modern, highly readable |

No npm or build pipeline is required. The app is served using any local static web server (such as Python's built-in `python -m http.server`). Running via a local HTTP server is required because modern browsers restrict asynchronous `fetch()` calls (used to load property tax data) when opening `index.html` directly under the `file:///` protocol.

---

## 4. User Interface Design

### 4.1 Visual Theme

- **Dark-mode first** with a deep navy/charcoal background (`#0d1117`).
- **Glassmorphism** panels: semi-transparent cards with `backdrop-filter: blur()` and subtle border glow.
- **Accent palette**: vibrant teal-to-indigo gradient (`#00c6ff` → `#7b2ff7`).
- **Smooth animations**: input changes trigger animated counter transitions in the summary panel; the amortization table fades in on render.
- **Micro-interactions**: hovering a table row highlights it; the chart tooltip is custom-styled.

### 4.2 Page Layout (top-to-bottom)

```
┌─────────────────────────────────────────────┐
│  Header: Logo + "Mortgage Calculator" title  │
├──────────────────┬──────────────────────────┤
│  INPUT PANEL     │  SUMMARY PANEL           │
│  (left column)   │  (right column, sticky)  │
│                  │  - PITI breakdown         │
│  All user inputs │  - Key highlights        │
│  (see §5)        │  - Current rate widget   │
├──────────────────┴──────────────────────────┤
│  HISTORICAL RATE CHART                       │
│  (full-width, collapsible)                   │
├─────────────────────────────────────────────┤
│  AMORTIZATION SCHEDULE TABLE                 │
│  (full-width, expandable rows)               │
└─────────────────────────────────────────────┘
```

On mobile/narrow screens: single-column stacked layout, inputs → summary → chart → table.

---

## 5. Input Panel

All inputs are grouped into logical sections. Inputs update the summary and table in real-time (debounced 300 ms to avoid excessive recalculation).

### 5.1 Loan Details

| Field | Type | Default | Constraints |
|---|---|---|---|
| Home Price | Currency input | $400,000 | > 0 |
| Down Payment | Currency input OR % toggle | $80,000 / 20% | >= 0, < Home Price |
| Loan Term | Dropdown | 30 years | 10, 15, 20, 25, 30 years |
| Interest Rate | Percentage input (2 dp) | Auto-filled from Freddie Mac PMMS or 7.00% | 0.01–30% |
| Loan Start Date | Month/Year picker | Current month | Any future or past date |
| Extra Monthly Principal | Currency input | $0 | >= 0 (accelerates loan payoff and interest savings) |

The Down Payment field supports toggling between **dollar amount** and **percentage**; changing one auto-updates the other.

### 5.2 Taxes & Insurance (PITI Extras)

| Field | Type | Default | Notes |
|---|---|---|---|
| Annual Property Tax | Currency input | **1% of home price** (editable) | No ZIP lookup; user may override |
| Annual Homeowner's Insurance | Currency input | 0.65% of home price | Editable |
| Monthly HOA Fees | Currency input | **$0** | Homeowners Association dues; leave at 0 if not applicable |
| PMI Rate | Percentage input | 0.85% of loan amount/yr | Only shown when LTV > 80% |

When Home Price changes, the Annual Property Tax field auto-updates to `home_price × 0.01` **unless** the user has manually edited it (tracked via a dirty flag). A small "Reset to default" link appears next to the field when the user has overridden it.

PMI inputs and the PMI line item are hidden when the down payment is >= 20% of the home price (LTV <= 80%). PMI disappears from the amortization schedule once the principal balance drops to 80% of the original home price.

### 5.3 Personal Finance Context (Optional)

| Field | Type | Default | Notes |
|---|---|---|---|
| Annual Gross Household Income | Currency input | *(empty)* | Pre-tax combined household income; enables the income ratio insight (§10) |

- This field is **optional** and clearly labelled as such. If left blank, the income-based insight card in §10 is hidden rather than shown in an error state.
- The value is used only for display/insight purposes — it does not affect any amortization calculation.
- A subtle helper note below the field reads: *"Used only to calculate your housing cost ratio. We never store or transmit this value."*

### 5.4 UI Behavior

- **Inline validation**: red border + tooltip on invalid input; no calculation until all required fields are valid.
- **"Use current Freddie Mac rate" button**: one-click to populate the Interest Rate field with the most recent PMMS rate.
- **Reset button**: restores all inputs to defaults.

---

## 6. Calculations

### 6.1 Monthly Payment (P&I)

Standard amortization formula:

```
M = P × [r(1+r)^n] / [(1+r)^n − 1]

Where:
  P = principal (home price − down payment)
  r = monthly interest rate = annual_rate / 12
  n = total payments = loan_term_years × 12
```

### 6.2 PITI Monthly Total

```
PITI + HOA = P&I + (Annual Property Tax / 12) + (Annual Insurance / 12) + Monthly PMI + Monthly HOA

Monthly PMI = (PMI Rate × Original Loan Amount) / 12
            shown only while principal balance > 80% of original home price
```

> **Label note**: The combined monthly payment is displayed throughout the UI as **"Monthly PITI + HOA"** (or just **"Monthly Total"** in compact spaces) to acknowledge HOA without inventing a new acronym. When HOA is $0, the label shortens to **"Monthly PITI"**.

### 6.3 Property Tax (Default: 1% of Home Price)

- Default annual property tax = `home_price × 0.01`.
- No ZIP code lookup or external dataset is required.
- The field auto-updates when Home Price changes, unless the user has manually overridden the value.
- **Dirty flag**: Set when the user edits the field directly; cleared when they click the "Reset to default" link. While dirty, Home Price changes do **not** overwrite the user's value.
- There is no ZIP Code input field; it has been removed from the form entirely.

### 6.4 Amortization Schedule

For each monthly period `i` from 1 to `n`:

```
interest_payment[i]     = balance[i-1] × r
principal_payment[i]    = M − interest_payment[i]
balance[i]              = balance[i-1] − principal_payment[i]
cumulative_interest[i]  = cumulative_interest[i-1] + interest_payment[i]
interest_remaining[i]   = total_interest_paid_over_life − cumulative_interest[i]
principal_remaining[i]  = balance[i]  (same as outstanding balance)

balance_interest_rate[i] = interest_remaining[i] / principal_remaining[i]
                           (per annum; this is the simple interest rate you
                            would pay on the remaining principal over the
                            remaining loan duration)
```

**Boundary conditions**:
- `balance[0]` = original principal (P).
- `interest_remaining[0]` = total interest paid over the full life of the loan.
- `balance_interest_rate[0]` ≈ stated annual interest rate (good sanity check).
- Final period: `balance[n]` ≈ 0 (any rounding remainder applied to last payment).

PMI stops being charged once `balance[i] <= 0.80 × original_home_price`.

### 6.5 Key Summary Highlights

| Metric | Description |
|---|---|
| Monthly P&I | Standard principal + interest |
| Monthly PITI + HOA | Full monthly cost including taxes, insurance, PMI, and HOA fees |
| Monthly PITI + HOA (excl. PMI) | Post-PMI-removal estimate |
| Total Loan Amount | Home price − down payment |
| Total Interest Paid | Sum of all interest payments over the loan life |
| Total Cost of Loan | Principal + total interest |
| Total Cost w/ PITI + HOA | All P&I + all tax + all insurance + all PMI + all HOA over loan life |
| Loan-to-Value (LTV) | Loan amount / Home price |
| PMI Removal Date | Month when balance drops to 80% LTV |
| Effective Interest Rate | APR-style rate accounting for all PITI + HOA costs |

---

## 7. Current Mortgage Rate Widget

### 7.1 Data Source — Freddie Mac PMMS Spreadsheet & Pre-bundled Snapshot

- **Source**: Freddie Mac Primary Mortgage Market Survey (PMMS) historical weekly data spreadsheet.
- **URL**: `https://www.freddiemac.com/pmms/docs/historicalweeklydata.xlsx`
- **Pre-bundled Snapshot**: A baseline snapshot is provided in `js/pmms_rates.js` (defining `window.PMMS_INITIAL_RATES`). This ensures that opening the app in a browser renders the historical rate chart and rate widget instantly without network delay.
- **Online Refresh**: When network access is available, the app attempts to fetch the latest XLSX file in the background (directly or via `allorigins.win`), parsing the latest weeks via SheetJS and updating the chart/widget dynamically.
- **No API key required.**

### 7.2 CORS & Local File Handling

1. **Local Server Execution**: Immediately loads and renders the pre-bundled `window.PMMS_INITIAL_RATES` and enables `fetch()` for property tax lookups.
2. **Online Environment**: Attempts direct fetch from Freddie Mac; if blocked by CORS, silently falls back to `https://api.allorigins.win/get?url=<encoded_url>`.
3. If both online paths fail, the pre-bundled dataset remains active, so the user experience is never broken.

### 7.3 Widget Display

A compact card (in the Summary Panel) showing:
- Most recent 30-yr fixed rate (large, bold, gradient text)
- Change from 1 week ago (green down-arrow or red up-arrow with delta)
- Survey week date of the displayed rate
- "Use this rate" button → populates the Interest Rate input

---

## 8. Historical Mortgage Rate Chart

### 8.1 UI Controls

A button group above the chart selects the historical window:

```
[ 1Y ]  [ 5Y ]  [ 10Y ]  [ 20Y ]  [ 50Y ]
```

The selected button is highlighted with the accent gradient. Default: **10Y**.

### 8.2 Chart Specification

- **Library**: Chart.js v4 (line chart).
- **Data**: Filtered client-side from the rate array (1Y, 5Y, 10Y, 20Y, 50Y).
- **Interactive Click-to-Apply**: Clicking on any data point in the chart displays a quick tooltip action or populates the Interest Rate field directly with that historical week's rate, letting the user test any historical market rate with a single click.
- **Styling**:
  - Line color: teal-to-indigo gradient stroke (`createLinearGradient`).
  - Fill under the curve: semi-transparent gradient.
  - Grid lines: subtle, dark.
  - Tooltip: custom dark-themed tooltip showing survey week date, rate, and click-to-apply option.
- **Annotations** (or custom drawn plugin line):
  - Dashed horizontal line at the **current user-entered interest rate**.
  - Label: "Your Rate: X.XX%"
- **Axes**:
  - X: Date (auto-scaled, formatted as "MMM YYYY" or "YYYY")
  - Y: Rate (%) with min/max padding

### 8.3 Data Fetching & Caching

- The PMMS XLSX is fetched **once** on page load (or on first interaction with the rate widget).
- The full parsed dataset (all historical weeks) is stored in `sessionStorage` as a compact JSON array of `{ date, rate30yr }` objects.
- Time-window filtering for the chart is done purely in JS — no additional network requests when the user switches between 1Y/5Y/10Y/20Y/50Y views.

---

## 9. Amortization Schedule Table

### 9.1 Table Columns

| # | Column | Description |
|---|---|---|
| 1 | **Date** | Month + Year of the payment (e.g., "Oct 2026") |
| 2 | **Cumulative Interest Paid** | Total interest paid from month 1 through this period |
| 3 | **Interest Remaining** | Total remaining interest to be paid over the loan life |
| 4 | **Cumulative Principal Paid** | Total principal paid from month 1 through this period |
| 5 | **Principal Remaining** | Outstanding loan principal balance after this payment |
| 6 | **Total Balance Remaining** | Sum of **Principal Remaining** + **Interest Remaining** (total remaining obligations) |
| 7 | **Balance Interest Rate** | Annualized simple interest rate = `(Interest Remaining / (Principal Remaining × remaining_months / 12)) × 100%` |

**Monthly Granularity & Year Expand/Collapse**:
- Each month row calculates the exact remaining months `(n - i)`.
- Each annual summary row shows the cumulative interest and principal paid through that year-end, remaining principal, remaining interest, total balance remaining, and the annualized balance interest rate computed at that year-end timestamp.
- Expanding any year displays its 12 individual monthly payment rows with full monthly granularity.

### 9.2 Actions & Table Controls

- **"Expand All" / "Collapse All"** toggle above the table.
- **"Export to CSV" Button**: Exports the complete amortization schedule (all monthly payment rows with date, interest, principal, balances, and balance interest rate) to a clean `.csv` file.

### 9.3 Table Formatting

- Currency columns: formatted with `$` prefix, comma thousands separator, 2 decimal places.
- Balance Interest Rate: displayed as `X.XX%` (2 decimal places).
- **Color coding**:
  - Interest Paid column: warm orange tint.
  - Principal Paid column: cool teal tint.
  - Balance Interest Rate: gradient from red (high, early years) to green (low, late years).
- **PMI indicator**: Rows where PMI applies have a subtle badge or asterisk.
- **Sticky header** when scrolling.
- **Virtual scrolling** for large tables (360 rows for 30-year mortgage): render monthly sub-rows on demand using IntersectionObserver.

---

## 10. Insights Panel

The Insights Panel is a full-width section that appears between the Summary Panel and the Historical Rate Chart. It presents **4 scenario cards**, each answering a "what if?" question by re-running the amortization math with a single parameter changed and displaying the resulting delta against the user's current scenario.

### 10.1 Layout

A 2×2 responsive grid of cards (collapses to a 1-column stack on mobile). Each card contains:

- **Headline**: A one-sentence description of the hypothetical scenario.
- **Key metrics**: Monthly PITI and Total Interest Paid for the hypothetical.
- **Deltas**: Each metric shown as `$X,XXX/mo (−Y%)` or `$X,XXX/mo (+Y%)` — green for savings, red for cost increases, relative to the current scenario.
- **Subtle icon** and accent color per card to visually differentiate them.

Cards update in real-time whenever any input changes (same debounce as the main calculator).

### 10.2 Insight Definitions

#### Insight 1 — Larger Down Payment *(user-requested)*

> **"What if your down payment were 1.5× larger?"**

- **Hypothetical parameter**: `downPayment_hyp = currentDownPayment × 1.5`
  - Cap at `homePrice − 1` (can't exceed the home price).
  - If the current down payment is already ≥ 67% of home price, the card is hidden (the 1.5× scenario is not meaningfully different).
- **Displayed metrics**:
  - Monthly PITI (hypothetical) and delta vs. current.
  - Total Interest Paid (hypothetical) and delta vs. current.
  - LTV reduction shown as a secondary note (e.g., "LTV drops from 80% → 67%").
  - If the larger down payment eliminates PMI, flag this: "PMI removed immediately".

#### Insight 2 — Rate as of 5 Years Ago *(user-requested)*

> **"What if today's rate matched the market rate from 5 years ago?"**

- **Hypothetical parameter**: Look up the PMMS weekly rate for the week closest to `today − 5 years` from the cached rate dataset.
- **Display the reference rate** prominently in the card (e.g., "5-yr ago rate: 3.72%") so the user understands the basis.
- **Displayed metrics**:
  - Monthly PITI and delta vs. current.
  - Total Interest Paid and delta vs. current.
  - If the historical rate is higher than the current rate, the card shows a savings message in reverse ("You're already below the 5-yr-ago rate").
- **Data dependency**: Requires the PMMS dataset to be loaded. If not yet loaded, show a spinner inside the card.

#### Insight 3 — Shorter Loan Term *(suggested)*

> **"What if you chose a shorter loan term?"**

- **Hypothetical parameter**: `loanTerm_hyp` = the next standard term shorter than the current selection.
  - 30 yr → 20 yr; 25 yr → 15 yr; 20 yr → 15 yr; 15 yr → 10 yr; 10 yr → hidden (already shortest).
- **Displayed metrics**:
  - Monthly P&I and delta (will always be higher — shown in amber to indicate a trade-off, not purely good or bad).
  - Total Interest Paid and delta (will always be a saving — shown in green).
  - Secondary note: "You'd own your home X years sooner."
- **Rationale**: This is one of the most common questions borrowers have — "should I do a 15-year instead of a 30-year?" — and surfacing it automatically adds immediate decision-making value.

#### Insight 4 — Rate Sensitivity *(suggested)*

> **"How much does a 1% rate change affect you?"**

- This card shows **two sub-scenarios** side by side within the card:
  - **Rate − 1%**: what happens if your rate drops by 1 percentage point.
  - **Rate + 1%**: what happens if your rate rises by 1 percentage point.
- Clamp both at the allowed input bounds (0.01%–30%).
- **Displayed metrics per sub-scenario**:
  - Monthly PITI delta (e.g., "−$312/mo" in green, "+$318/mo" in red).
  - Total Interest delta.
- **Rationale**: In a volatile rate environment, borrowers frequently wonder about their rate lock risk or refinance opportunity. This card makes the dollar impact visceral and immediate.

#### Insight 5 — Housing Cost Ratio *(conditional on income input)*

> **"What share of your income does this mortgage consume?"**

- **Visibility**: This card is shown **only when** the user has entered a value in the Annual Gross Household Income field (§5.3). If the field is empty, the card slot is hidden entirely (no placeholder).
- **Calculation**:
  ```
  monthly_gross_income = annualGrossIncome / 12
  housing_cost_ratio   = (monthly_piti_plus_hoa / monthly_gross_income) × 100
  ```
- **Displayed metrics**:
  - The ratio as a large percentage (e.g., **"32.4% of monthly income"**).
  - A contextual benchmark bar showing where the user falls relative to standard lending guidelines:
    - **≤ 28%** — "Within the standard front-end ratio guideline" *(green)*
    - **28–36%** — "Above the recommended front-end limit" *(amber)*
    - **> 36%** — "Exceeds typical lender affordability thresholds" *(red)*
  - Secondary line: `"$X,XXX/mo PITI + HOA out of $X,XXX/mo gross income"`.
- **No delta column**: This card does not compare a hypothetical; it is a direct affordability gauge on the current scenario. It updates live as inputs change.
- **Rationale**: The front-end debt-to-income (DTI) ratio is one of the primary metrics lenders use to evaluate affordability. Surfacing it immediately — with a plain-language benchmark — gives users actionable context that is otherwise opaque.

### 10.3 Implementation Notes

- Each insight runs an isolated `computeAmortization(overrides)` call, where `overrides` is a shallow merge of `AppState` with the one changed parameter. The core amortization function must accept a plain parameter object (no global state side-effects).
- Percentage delta formula: `delta_pct = ((hyp_value - current_value) / current_value) × 100`. Round to one decimal place.
- Color convention: **green** = saves money (negative delta on cost metrics), **red** = costs more, **amber** = trade-off (higher monthly cost, lower total cost — Insight 3 P&I vs. interest).
- Cards should animate in with a subtle fade+slide when the panel first renders, and pulse briefly when values change due to input updates.
- For Insight 2, if the PMMS data is unavailable (fetch failed), replace the card body with "Historical rate data unavailable" and a "Enter rate manually" inline input.
- **Insight 5 grid layout**: The card grid is 2×2 for Insights 1–4. When Insight 5 is visible, expand to a 2×3 grid (or a 3-column row at the bottom) so the income card is always the last item. When hidden, the 2×2 layout is preserved.

---

## 11. Responsiveness & Accessibility

- **Responsive**: Flexbox/Grid layout that reflows gracefully at 768px and 480px breakpoints.
- **Keyboard navigation**: All inputs and interactive elements are tab-accessible.
- **ARIA labels**: All form inputs have associated `<label>` elements and `aria-describedby` for hints.
- **Screen reader**: Summary panel values use `aria-live="polite"` so they announce changes.
- **Color contrast**: All text meets WCAG AA (4.5:1 for normal text, 3:1 for large text).

---

## 12. State Management

All application state lives in a single plain JavaScript object (`AppState`) and is serialized to `localStorage` so the user's inputs persist across page refreshes:

```js
AppState = {
  homePrice: 400000,
  downPayment: 80000,
  downPaymentPct: 20,
  loanTermYears: 30,
  interestRate: 7.00,
  loanStartDate: "2026-10",
  extraMonthlyPrincipal: 0,        // optional extra principal payment
  annualPropertyTax: null,         // null = use default (homePrice × 0.01); set when user overrides
  propertyTaxDirty: false,         // true when user has manually edited the tax field
  annualInsurance: null,           // null = use default formula (homePrice × 0.0065)
  monthlyHoa: 0,                   // monthly HOA fees in dollars; 0 = no HOA
  annualGrossIncome: null,         // optional; null = income insight card hidden
  pmiRate: 0.85,
  historicalRateWindow: "10Y",
  amortizationExpandedYears: [],   // array of expanded year indices
}
```

---

## 13. Error Handling

| Scenario | Handling |
|---|---|
| Local file direct open without server | Property tax fetch requires local HTTP server; PMMS baseline loads from script tag |
| Freddie Mac XLSX fetch fails (direct) | Silently retry via allorigins.win CORS proxy |
| Freddie Mac XLSX fetch fails (both paths) | Keep pre-bundled dataset active; manual rate editing is always available |
| XLSX parse error (unexpected format) | Log warning; keep pre-bundled baseline; degrade gracefully |
| Invalid input | Inline field validation; calculation blocked until resolved |
| Extremely large down payment (>= home price) | Show error: "Down payment must be less than home price" |

---

## 14. SEO & Meta

```html
<title>Mortgage Calculator — PITI, Amortization & Rate History</title>
<meta name="description" content="Free mortgage calculator with full PITI breakdown, amortization schedule with balance interest rates, PMI, and live historical rate data from FRED.">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

---

## 15. Implementation Notes for the Coding Agent

1. **Static Server Execution**: The application is served via a local web server (e.g. `python -m http.server`) so that asynchronous `fetch()` requests for datasets (such as property tax data) execute smoothly without browser file origin restrictions.
2. **Chart.js**: Loaded from CDN via standard script tag (`https://cdn.jsdelivr.net/npm/chart.js`).
3. **Freddie Mac PMMS Dataset**: Load `js/pmms_rates.js` as the baseline. In browser environments where `fetch` is permitted, fetch `historicalweeklydata.xlsx` in the background to append any new survey weeks.
4. **Balance Interest Rate calculation**:
   For month `i` with `remaining_months = total_payments - i`:
   If `remaining_months > 0` and `principal_remaining > 0`:
   `balance_interest_rate = (interest_remaining / (principal_remaining * (remaining_months / 12))) * 100`.
   If `remaining_months == 0`, output `0.00%`.
5. **Total Balance Remaining**:
   `total_balance_remaining = principal_remaining + interest_remaining`.
6. **Property tax dirty flag**: In the Annual Property Tax input's `change` event handler, set `AppState.propertyTaxDirty = true`. In the Home Price input handler, only update `annualPropertyTax` if `!AppState.propertyTaxDirty`. Show a "↺ Reset to 1% default" link when dirty.
7. **CSV Export**: Generate client-side blob with headers: `Date, Cumulative Interest Paid, Interest Remaining, Cumulative Principal Paid, Principal Remaining, Total Balance Remaining, Balance Interest Rate (%)`.
8. **Interactive Chart Rate**: Support clicking or selecting any historical rate from the chart to immediately apply it to the Interest Rate input.
9. **Visual Payment Breakdown**: Render a donut chart and segmented bar showing P&I, Taxes, Insurance, HOA, and PMI components.
10. **Extra Monthly Payment**: Accelerates loan payoff, recalculates total interest paid, and displays payoff acceleration highlights.

---

## 16. Implemented Features & Enhancements

All user-requested improvements are part of the core application:
- **Annualized Balance Interest Rate** with full monthly granularity
- **Total Balance Remaining** computed as Principal + Interest Remaining
- **Dynamic Property Tax Lookup by ZIP Code** with Census ACS integration
- **Pre-bundled PMMS Snapshot** with live sync
- **Interactive Chart Click-to-Apply Rate**
- **Monthly Cost Breakdown Donut Chart**
- **Amortization CSV Export**
- **Extra Principal Payment Acceleration**
