import pytest
import re

def test_initial_render_and_defaults(app_server, visual_page):
    """
    Test 1: Verifies initial UI state, section title 'Monthly Payment',
    absence of 'Full Payment' badge, and 30-year amortization rows.
    """
    page = visual_page
    page.goto(f"{app_server}/index.html", wait_until="networkidle")

    # Verify App Title
    assert "Jojo's Mortgage Calculator" in page.title()

    # Verify Section Title is 'Monthly Payment'
    hero_label = page.locator("#heroPitiLabel").text_content().strip()
    assert hero_label == "Monthly Payment"
    assert page.locator("#heroPitiLabel").inner_text().strip() == "MONTHLY PAYMENT"

    # Verify 'Full Payment' badge is absent
    full_payment_badges = page.locator(".badge-tag:has-text('Full Payment')")
    assert full_payment_badges.count() == 0

    # Verify Hero Amount is displayed
    hero_amount = page.locator("#heroPitiAmount").inner_text()
    assert "$" in hero_amount

    # Verify Amortization Schedule table renders 30 annual rows
    year_rows = page.locator("#amortTableBody tr.row-year")
    assert year_rows.count() == 30

    # Capture visual screenshot
    page.save_screenshot("test_initial_render.png")

    # Assert no page/console errors occurred
    severe_errors = [e for e in page.console_errors if "error" in e.lower() and "favicon" not in e.lower()]
    assert len(severe_errors) == 0, f"Unexpected errors during render: {severe_errors}"


def test_input_recalculation_and_responsiveness(app_server, visual_page):
    """
    Test 2: Verifies that changing inputs (Home Price, Tax, Insurance)
    immediately triggers recalculation of Monthly Payment and updates the breakdown.
    """
    page = visual_page
    page.goto(f"{app_server}/index.html", wait_until="networkidle")

    initial_payment = page.locator("#heroPitiAmount").inner_text()

    # Change Home Price to $500,000
    page.fill("#inputHomePrice", "500,000")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)

    # Change Monthly Property Tax to $450
    page.fill("#inputPropertyTax", "450")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)

    # Change Monthly Insurance to $250
    page.fill("#inputInsurance", "250")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)

    updated_payment = page.locator("#heroPitiAmount").inner_text()

    # Verify payment responded and changed
    assert updated_payment != initial_payment

    # Verify legend values updated
    assert "$450" in page.locator("#legendValTax").inner_text()
    assert "$250" in page.locator("#legendValIns").inner_text()

    page.save_screenshot("test_input_recalculation.png")


def test_amortization_expand_and_collapse(app_server, visual_page):
    """
    Test 3: Verifies that annual summary rows expand to show 12 monthly rows,
    and that Expand All and Collapse All buttons function correctly.
    """
    page = visual_page
    page.goto(f"{app_server}/index.html", wait_until="networkidle")

    # Click Year 1 to expand
    year_1_row = page.locator("#amortTableBody tr.row-year[data-year='1']")
    year_1_row.click()
    page.wait_for_timeout(300)

    # Verify 12 monthly rows appear
    month_rows = page.locator("#amortTableBody tr.row-month")
    assert month_rows.count() == 12

    # Click Expand All
    page.locator("#btnExpandAll").click()
    page.wait_for_timeout(400)

    # In a 30-year fixed schedule, 30 years x 12 months = 360 monthly rows
    all_months = page.locator("#amortTableBody tr.row-month")
    assert all_months.count() == 360

    # Click Collapse All
    page.locator("#btnCollapseAll").click()
    page.wait_for_timeout(300)

    # Verify months are collapsed
    collapsed_months = page.locator("#amortTableBody tr.row-month")
    assert collapsed_months.count() == 0

    page.save_screenshot("test_amortization_schedule.png")


def test_historical_rate_chart_and_rate_selection(app_server, visual_page):
    """
    Test 4: Verifies the Freddie Mac historical rate chart interacts with window buttons.
    """
    page = visual_page
    page.goto(f"{app_server}/index.html", wait_until="networkidle")

    # Verify chart canvas is present
    chart_canvas = page.locator("#rateChartCanvas")
    assert chart_canvas.is_visible()

    # Toggle 1Y window
    btn_1y = page.locator("button.window-btn[data-window='1Y']")
    btn_1y.click()
    page.wait_for_timeout(300)
    assert "active" in btn_1y.get_attribute("class")

    # Toggle 50Y window
    btn_50y = page.locator("button.window-btn[data-window='50Y']")
    btn_50y.click()
    page.wait_for_timeout(300)
    assert "active" in btn_50y.get_attribute("class")

    page.save_screenshot("test_rate_chart_50y.png")


def test_optional_income_ratio_insight(app_server, visual_page):
    """
    Test 5: Verifies that entering optional gross income reveals the
    Housing Cost Ratio insight card and computes the front-end guideline.
    """
    page = visual_page
    page.goto(f"{app_server}/index.html", wait_until="networkidle")

    # Initially hidden
    card_ratio = page.locator("#cardInsightIncomeRatio")
    assert not card_ratio.is_visible()

    # Enter $120,000 gross annual income
    page.fill("#inputAnnualIncome", "120,000")
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)

    # Should become visible
    assert card_ratio.is_visible()
    ratio_text = page.locator("#ins5Ratio").inner_text()
    assert "% of gross income" in ratio_text

    page.save_screenshot("test_income_ratio_insight.png")


def test_direct_file_protocol_access(local_file_url, visual_page):
    """
    Test 6: Tests loading directly via local file URL (file://...)
    without any local web server, ensuring offline compatibility.
    """
    page = visual_page
    page.goto(local_file_url, wait_until="networkidle")

    # Verify core calculations and rendering work under file:// protocol
    hero_label = page.locator("#heroPitiLabel").text_content().strip()
    assert hero_label == "Monthly Payment"
    assert page.locator("#heroPitiLabel").inner_text().strip() == "MONTHLY PAYMENT"

    year_rows = page.locator("#amortTableBody tr.row-year")
    assert year_rows.count() == 30

    page.save_screenshot("test_direct_file_protocol.png")

def test_zip_code_property_tax_lookup(app_server, visual_page):
    """
    Test 7: Verifies entering a ZIP code fetches js/propertyTaxesByZipCode.json,
    displays the tax rate badge, dynamically computes monthly property tax,
    and handles ZIP clearing and unknown ZIP codes.
    """
    page = visual_page
    page.goto(f"{app_server}/index.html", wait_until="networkidle")

    zip_input = page.locator("#inputZipCode")
    tax_input = page.locator("#inputPropertyTax")
    rate_badge = page.locator("#zipTaxRateBadge")
    status_text = page.locator("#zipStatusText")
    legend_tax = page.locator("#legendValTax")
    hero_amount = page.locator("#heroPitiAmount")

    # 1. Initial State: empty ZIP, default 1% tax on $400k ($333/mo)
    assert zip_input.input_value() == ""
    assert not rate_badge.is_visible()
    assert tax_input.input_value() == "333"
    initial_hero = hero_amount.inner_text()

    # 2. Enter Beverly Hills ZIP 90210 (rate 0.6942%)
    zip_input.fill("90210")
    page.wait_for_timeout(400)

    # Wait for rate badge to appear
    rate_badge.wait_for(state="visible", timeout=3000)
    assert "0.69%" in rate_badge.inner_text()
    assert "0.694%" in status_text.inner_text()

    # Tax on $400,000 at 0.6942% = $231.40/mo -> 231
    assert tax_input.input_value() == "231"
    assert "$231" in legend_tax.inner_text()
    assert hero_amount.inner_text() != initial_hero

    # 3. Enter Addison, TX ZIP 75001 (rate 1.6797%)
    zip_input.fill("75001")
    page.wait_for_timeout(400)

    rate_badge.wait_for(state="visible", timeout=3000)
    assert "1.68%" in rate_badge.inner_text()
    assert "1.680%" in status_text.inner_text()

    # Tax on $400,000 at 1.6797% = $559.90/mo -> 560
    assert tax_input.input_value() == "560"
    assert "$560" in legend_tax.inner_text()

    # 4. Verify home price adjustment maintains active ZIP tax rate
    page.fill("#inputHomePrice", "500,000")
    page.keyboard.press("Tab")
    page.wait_for_timeout(350)
    # Tax on $500,000 at 1.6797% = $699.88/mo -> 700
    assert tax_input.input_value() == "700"

    # 5. Clear ZIP code reverts back to default 1% tax
    zip_input.fill("")
    page.wait_for_timeout(350)
    assert not rate_badge.is_visible()
    # 1% on $500,000 = $416.67/mo -> 417
    assert tax_input.input_value() == "417"

    # 6. Enter unknown ZIP code
    zip_input.fill("99999")
    page.wait_for_timeout(400)
    assert not rate_badge.is_visible()
    assert "not found" in status_text.inner_text()

    page.save_screenshot("test_zip_tax_lookup.png")

    # Assert no page/console errors occurred
    severe_errors = [e for e in page.console_errors if "error" in e.lower() and "favicon" not in e.lower()]
    assert len(severe_errors) == 0, f"Unexpected errors during zip lookup: {severe_errors}"

