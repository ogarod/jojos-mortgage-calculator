# Visual & End-to-End Testing with Playwright

This test suite provides automated visual and behavioral testing for **Jojo's Mortgage Calculator**, featuring:
- **Full video recording** of every test interaction (`.webm` videos).
- **Visual snapshot capture** (screenshots of key states and schedules).
- **Dual access testing** (local ephemeral HTTP server and direct `file://` protocol).

> **Note**: The instructions and automated browser detection assume development on Windows.

---

## 1. Testing Architecture

Tests can execute against the application through two methods provided in `tests/conftest.py`:

### Strategy A: Ephemeral In-Process HTTP Server (Recommended default)
* The `app_server` fixture automatically starts a lightweight Python `http.server.SimpleHTTPRequestHandler` bound to `127.0.0.1:0` (a dynamic unused port) serving the project directory.
* **Benefits**:
  - Provides a standard Web origin (`http://127.0.0.1:<port>`).
  - Avoids browser file protocol restrictions, mixed-content warnings, and CORS barriers with external CDNs (Chart.js, Google Fonts).
  - Automatically shuts down cleanly on test session completion.

### Strategy B: Direct File Protocol (`file://`)
* The `local_file_url` fixture opens `index.html` directly via the `file://` protocol.
* Chromium is launched with `--allow-file-access-from-files`.
* **Note**: Validates baseline layout and core calculations when opened offline without a web server (note that full dynamic `fetch()` lookups like property tax rates require an HTTP server origin).

---

## 2. Browser Execution & Video Recording

* **Browser**: Connects to the system-installed Google Chrome or Microsoft Edge via Playwright's `channel="chrome"` / `channel="msedge"`.
* **FFmpeg**: Utilizes FFmpeg for video rendering.
* **Automatic Video Capture**: For every test function, Playwright records the complete session at `1280x960` resolution. When the test finishes, the `.webm` video is saved with the test's exact name into:
  `test-artifacts/videos/<test_name>.webm`

---

## 3. Running the Tests

You should first change directory to the local clone of the repository.

To run the entire test suite:
```powershell
python -m pytest
```

To run a specific test:
```powershell
python -m pytest tests/test_mortgage_visual.py -k test_input_recalculation_and_responsiveness
```

To run tests with detailed durations:
```powershell
python -m pytest -v --durations=0
```

---

## 4. Test Suite Coverage

| Test Function | What It Validates | Captured Artifacts |
| :--- | :--- | :--- |
| `test_initial_render_and_defaults` | Initial UI state, "Monthly Payment" title, absence of "Full Payment" badge, 30-year summary rows, no console errors. | `test_initial_render.png`<br>`test_initial_render_and_defaults.webm` |
| `test_input_recalculation_and_responsiveness` | Changing Home Price, Tax, and Insurance dynamically recalculates the Monthly Payment and breakdown donut. | `test_input_recalculation.png`<br>`test_input_recalculation_and_responsiveness.webm` |
| `test_amortization_expand_and_collapse` | Expanding Year 1 reveals 12 monthly rows; "Expand All" reveals 360 monthly rows; "Collapse All" restores collapsed state. | `test_amortization_schedule.png`<br>`test_amortization_expand_and_collapse.webm` |
| `test_historical_rate_chart_and_rate_selection` | Chart rendering, switching timeframes (1Y, 5Y, 50Y), user rate dashed line. | `test_rate_chart_50y.png`<br>`test_historical_rate_chart_and_rate_selection.webm` |
| `test_optional_income_ratio_insight` | Entering gross income dynamically displays Card 5 (Front-End Housing Cost Ratio guideline). | `test_income_ratio_insight.png`<br>`test_optional_income_ratio_insight.webm` |
| `test_direct_file_protocol_access` | Directly navigates to `index.html` via `file://` to ensure offline baseline compatibility. | `test_direct_file_protocol.png`<br>`test_direct_file_protocol_access.webm` |
| `test_zip_code_property_tax_lookup` | Verifies dynamic property tax lookup by ZIP code from `js/propertyTaxesByZipCode.json`, badge display, and automatic PITI updates. | `test_zip_tax_lookup.png`<br>`test_zip_code_property_tax_lookup.webm` |

---

## 5. Artifact Output Directory

* **Videos**: `test-artifacts/videos/*.webm` (playable in any browser or media player).
* **Screenshots**: `test-artifacts/screenshots/*.png`.
