"""
generate_pmms_rates.py — Freddie Mac PMMS Rate Generator

Detailed Description of Logic:
-------------------------------
This script downloads and parses the official Freddie Mac Primary Mortgage Market
Survey (PMMS) historical weekly dataset spreadsheet and generates two synchronized
output files in the target directory:
  1. `pmms_rates.js`   — Baseline JavaScript file defining `window.PMMS_INITIAL_RATES`
                         for baseline browser execution.
  2. `pmms_rates.json` — Raw JSON dataset array of all historical survey weeks.

Processing Pipeline:
1. Argument Parsing:
   - Accepts a single command-line argument specifying the destination directory.
   - The output filenames are hard-coded as 'pmms_rates.js' and 'pmms_rates.json'.

2. Source Data Retrieval:
   - Downloads the live Excel workbook directly from Freddie Mac:
     https://www.freddiemac.com/pmms/docs/historicalweeklydata.xlsx
   - Uses a standard browser User-Agent header to prevent HTTP 403 Forbidden errors.
   - If the download fails or times out, the script raises an exception immediately;
     no local fallback file is used.

3. Standalone XLSX Parsing (Zero External Dependencies):
   - Rather than requiring external packages like `openpyxl` or `pandas`, this script
     leverages Python's built-in `zipfile` and `xml.etree.ElementTree` modules to parse
     the OpenXML spreadsheet format.
   - Extracts and indexes the shared strings table from `xl/sharedStrings.xml`.
   - Parses cell references, types, and values from `xl/worksheets/sheet1.xml`.

4. Column & Date Extraction:
   - Identifies the survey data rows by locating column 'A' (date serial) and column 'B'
     (30-year fixed rate average), and column 'D' (15-year fixed rate average).
   - Converts Excel serial date integers (base date 1899-12-30) into ISO format 'YYYY-MM-DD'.
   - Validates that rates are valid floating-point numbers within realistic mortgage bounds.

5. Output Serialization:
   - Generates `pmms_rates.json` by directly dumping the sorted JSON records.
   - Generates `pmms_rates.js` by wrapping the JSON array with the global assignment:
     `// Baseline Freddie Mac PMMS historical rates`
     `window.PMMS_INITIAL_RATES = [...];`
   - Writes both files to the specified target directory.

Usage:
------
    python generate_pmms_rates.py <output_directory>

Example:
    python generate_pmms_rates.py ./js
"""

import sys
import os
import io
import json
import datetime
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

FREDDIE_MAC_URL = "https://www.freddiemac.com/pmms/docs/historicalweeklydata.xlsx"
OUTPUT_JS_FILENAME = "pmms_rates.js"
OUTPUT_JSON_FILENAME = "pmms_rates.json"


def fetch_xlsx_bytes() -> bytes:
    """
    Fetch the historical weekly data XLSX from Freddie Mac.
    Raises an exception immediately if the download fails.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    }
    print(f"Fetching PMMS spreadsheet from: {FREDDIE_MAC_URL}...")
    try:
        req = urllib.request.Request(FREDDIE_MAC_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            print(f"Successfully downloaded {len(data):,} bytes from Freddie Mac.")
            return data
    except Exception as exc:
        raise RuntimeError(f"Failed to download PMMS dataset from {FREDDIE_MAC_URL}: {exc}") from exc


def parse_pmms_xlsx(xlsx_bytes: bytes) -> list:
    """
    Parse the XLSX archive using zipfile and xml.etree.ElementTree.
    Returns a sorted list of dicts: [{'date': 'YYYY-MM-DD', 'rate30yr': float, 'rate15yr': float | None}, ...]
    """
    zf = zipfile.ZipFile(io.BytesIO(xlsx_bytes))

    # 1. Parse shared strings table if present
    shared_strings = []
    if "xl/sharedStrings.xml" in zf.namelist():
        sst_xml = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        ns = {"ns": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        for si in sst_xml.findall("ns:si", ns):
            text = "".join([t.text or "" for t in si.findall(".//ns:t", ns)])
            shared_strings.append(text)

    # 2. Parse sheet1.xml
    sheet_xml = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
    ns = {"ns": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows = sheet_xml.findall(".//ns:row", ns)

    excel_epoch = datetime.date(1899, 12, 30)
    parsed_rates = []

    for row in rows:
        col_map = {}
        for c in row.findall("ns:c", ns):
            v = c.find("ns:v", ns)
            val = v.text if v is not None else ""
            t = c.get("t")
            if t == "s" and val != "":
                try:
                    val = shared_strings[int(val)]
                except (IndexError, ValueError):
                    pass
            ref = c.get("r", "")
            col_letter = "".join([ch for ch in ref if ch.isalpha()])
            col_map[col_letter] = val.strip()

        # Check for numeric week serial in column A
        week_raw = col_map.get("A", "")
        rate30_raw = col_map.get("B", "")
        rate15_raw = col_map.get("D", "")

        try:
            serial_days = float(week_raw)
            rate30 = float(rate30_raw)
            if serial_days < 20000 or serial_days > 70000:
                continue
            if rate30 <= 0 or rate30 > 30:
                continue

            dt = excel_epoch + datetime.timedelta(days=int(serial_days))
            date_str = dt.strftime("%Y-%m-%d")

            rate15 = None
            if rate15_raw:
                try:
                    r15 = float(rate15_raw)
                    if 0 < r15 < 30:
                        rate15 = r15
                except ValueError:
                    pass

            parsed_rates.append({
                "date": date_str,
                "rate30yr": rate30,
                "rate15yr": rate15
            })
        except (ValueError, TypeError):
            continue

    parsed_rates.sort(key=lambda x: x["date"])
    print(f"Extracted {len(parsed_rates):,} weekly rate records.")
    return parsed_rates


def generate_pmms_files(output_dir: str) -> tuple:
    """
    Generate both pmms_rates.js and pmms_rates.json in the specified directory.
    Returns (js_path, json_path).
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    xlsx_bytes = fetch_xlsx_bytes()
    rates = parse_pmms_xlsx(xlsx_bytes)

    # 1. Write pmms_rates.json
    json_path = os.path.join(output_dir, OUTPUT_JSON_FILENAME)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(rates, f)
    print(f"Successfully generated: {json_path} ({os.path.getsize(json_path):,} bytes)")

    # 2. Write pmms_rates.js
    js_path = os.path.join(output_dir, OUTPUT_JS_FILENAME)
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("// Baseline Freddie Mac PMMS historical rates\n")
        f.write("window.PMMS_INITIAL_RATES = " + json.dumps(rates) + ";\n")
    print(f"Successfully generated: {js_path} ({os.path.getsize(js_path):,} bytes)")

    return js_path, json_path


def main():
    if len(sys.argv) < 2:
        print("Error: Missing output directory argument.")
        print(f"Usage: python {os.path.basename(__file__)} <output_directory>")
        sys.exit(1)

    output_directory = sys.argv[1]
    generate_pmms_files(output_directory)


if __name__ == "__main__":
    main()
