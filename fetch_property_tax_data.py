"""
fetch_property_tax_data.py - ZIP Code Property Tax Rate Mapper
==============================================================

Usage:
------
    python fetch_property_tax_data.py --hud-crosswalk <path> --summarized-output-path <path> [options]

Required Arguments:
-------------------
    -c, --hud-crosswalk PATH           Full path to the HUD USPS ZIP-County crosswalk file (XLSX or CSV).
    -s, --summarized-output-path PATH  Full path where the summarized JSON mapping ZIP codes to aggregate tax rates will be saved.

Options:
--------
    -f, --full-output-path PATH        Optional full path where the full detailed property tax rates JSON will be saved.
    -k, --api-key KEY                  U.S. Census Bureau API key (optional; public tier used if omitted).
    -y, --year YEAR                    Census ACS 5-Year survey year (default: 2023).
    --no-cache                         Bypass the system temporary directory cache and force a fresh download.
    -h, --help                         Show this help message and exit.

Examples:
---------
    # Generate summarized tax rates mapping (ZIP -> rate) with Census API key:
    python fetch_property_tax_data.py --hud-crosswalk ./hud_usps_crosswalk_ZIP-COUNTY_062026.xlsx --summarized-output-path ./tax_rates_by_zip.json --api-key YOUR_CENSUS_KEY

    # Generate both summarized and full detailed JSON outputs:
    python fetch_property_tax_data.py -c ./hud_usps_crosswalk_ZIP-COUNTY_062026.xlsx -s ./tax_rates_by_zip.json -f ./full_tax_details.json

    # Force fresh download ignoring temporary cache:
    python fetch_property_tax_data.py -c ./hud_usps_crosswalk_ZIP-COUNTY_062026.xlsx -s ./tax_rates_by_zip.json --no-cache

Description:
------------
This script calculates effective property tax rates at the 5-digit ZIP code level by 
fetching county-level housing data directly from the U.S. Census Bureau API (American 
Community Survey 5-Year Estimates) and spatially weighting it across ZIP code boundaries 
using the official HUD USPS ZIP-County Crosswalk dataset.

Outputs:
--------
1. Summarized Output (--summarized-output-path, required):
   A lightweight JSON mapping each 5-digit ZIP code directly to its aggregate effective property tax rate:
   {
     "90210": 0.8,
     "78701": 1.8163
   }

2. Full Output (--full-output-path, optional):
   A detailed JSON keyed by 5-digit ZIP code containing State, a list of constituent Counties,
   population-weighted housing value, median property tax paid, and aggregate tax rate:
   {
     "78701": {
       "State": "TX",
       "Counties": ["Travis County, TX", "Williamson County, TX"],
       "Aggregate (population-weighted) housing value": 490000.0,
       "Aggregate (population-weighted) median property tax paid": 8900.0,
       "Aggregate (population-weighted) tax rate": 1.8163
     }
   }

Downloaded Census datasets are automatically cached in a system-provided temporary 
directory (via `tempfile.gettempdir()`) so that repeated runs execute quickly without 
re-downloading data.

Data Sources:
-------------
1. U.S. Census Bureau ACS 5-Year Estimates:
   - Endpoint: https://api.census.gov/data/{YEAR}/acs/acs5
   - Variables Fetched:
     * B25077_001E: Median value of owner-occupied housing units
     * B25103_001E: Median real estate taxes paid
2. HUD USPS ZIP-County Crosswalk File (you need to manually download this from the HUD website):
   - Source: HUD User (https://www.huduser.gov/portal/datasets/usps_crosswalk.html)
   - Direction: ZIP to County (`ZIP_COUNTY`)
   - Key Field Used: `RES_RATIO` (Proportion of ZIP code's residential addresses in county)

Methodology:
------------
1. Query Census ACS API for county-level housing values and median taxes paid nationwide (or read from temp cache).
2. Join county data with the HUD ZIP-County crosswalk using 5-digit GEOID (State + County FIPS).
3. Compute weighted residential values per ZIP code using HUD's `RES_RATIO` (w_i):
   - Aggregate Housing Value = sum(w_i * County_Median_Home_Value)
   - Aggregate Property Tax Paid = sum(w_i * County_Median_Tax_Paid)
   - Effective Tax Rate (%) = (Aggregate Tax Paid / Aggregate Housing Value) * 100
4. Output results to JSON file(s).

Error Handling Policy:
----------------------
- If the HUD crosswalk file is absent from the specified path, a FileNotFoundError is raised. 
- Land area / ZCTA fallback methods are strictly disallowed to maintain residential address accuracy.
- Non-JSON responses from the Census API are caught and reported with exact API response text.
"""

import argparse
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import pandas as pd
import requests

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

# State FIPS code to 2-letter Postal Abbreviation lookup
STATE_FIPS_TO_ABBR = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
    "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
    "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
    "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
    "54": "WV", "55": "WI", "56": "WY", "72": "PR",
}


def get_cache_dir() -> Path:
    """Returns the system-provided temporary directory for caching downloaded files."""
    cache_dir = Path(tempfile.gettempdir()) / "census_property_tax_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def verify_hud_crosswalk_exists(path: Path) -> None:
    """Verifies that the HUD crosswalk file exists at the specified path. Raises FileNotFoundError if missing."""
    if not path.is_file():
        raise FileNotFoundError(
            f"Required HUD ZIP-County crosswalk file was not found at:\n  '{path}'\n\n"
            f"Please download the 'ZIP_COUNTY' crosswalk file (CSV or XLSX format) from HUD User "
            f"(https://www.huduser.gov/portal/datasets/usps_crosswalk.html) and pass its full path to this script."
        )


def fetch_census_acs_county_data(api_key: str, year: str, use_cache: bool = True) -> pd.DataFrame:
    """
    Fetches county-level home values and property tax data from U.S. Census Bureau API.
    Caches the downloaded JSON to a system-provided temporary directory so it can be
    re-used across script executions.
    """
    cache_file = get_cache_dir() / f"census_acs5_{year}_county_data.json"
    data = None

    if use_cache and cache_file.is_file():
        try:
            logging.info("Loading cached Census ACS data from: %s", cache_file)
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as cache_err:
            logging.warning("Failed to read cache file (%s), will re-download: %s", cache_file, cache_err)
            data = None

    if data is None:
        logging.info("Querying U.S. Census Bureau ACS 5-Year API for county tax data (survey year: %s)...", year)
        url = f"https://api.census.gov/data/{year}/acs/acs5"
        
        # B25077_001E: Median Home Value
        # B25103_001E: Median Real Estate Taxes Paid
        params = {
            "get": "NAME,B25077_001E,B25103_001E",
            "for": "county:*",
        }
        
        clean_key = api_key.strip() if api_key else ""
        if clean_key:
            params["key"] = clean_key

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Python/PropertyTaxMapper"
        }

        try:
            response = requests.get(url, params=params, headers=headers, timeout=30)
            
            # Check HTTP status code first
            if response.status_code != 200:
                raise RuntimeError(
                    f"Census API returned HTTP {response.status_code}:\n{response.text}"
                )

            data = response.json()

        except json.decoder.JSONDecodeError as json_err:
            raise RuntimeError(
                f"Census API returned a non-JSON response (HTTP {response.status_code}).\n"
                f"Raw API Response Content:\n'{response.text}'\n\n"
                f"Possible causes:\n"
                f"1. The API key supplied is invalid or throttled.\n"
                f"2. Requested ACS Year ({year}) or variables are temporarily unavailable."
            ) from json_err
        except requests.RequestException as req_err:
            raise RuntimeError(f"Failed to connect to Census API: {req_err}") from req_err

        # Save to system-provided temporary cache
        if use_cache and data:
            try:
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(data, f)
                logging.info("Cached Census ACS data to temporary directory: %s", cache_file)
            except Exception as save_err:
                logging.warning("Failed to save Census ACS data to cache: %s", save_err)

    if not data or len(data) < 2:
        raise ValueError("Empty or invalid data structure returned from Census API.")

    # Dynamically map headers from first row
    header_row = [str(col).lower() for col in data[0]]
    df = pd.DataFrame(data[1:], columns=header_row)

    # Convert geographic state/county FIPS into 5-digit GEOID string
    df["state_fips"] = df["state"].astype(str).str.zfill(2)
    df["county_fips"] = df["county"].astype(str).str.zfill(3)
    df["geoid"] = df["state_fips"] + df["county_fips"]

    # Coerce numeric Census variables
    df["median_home_value"] = pd.to_numeric(df["b25077_001e"], errors="coerce")
    df["median_tax_paid"] = pd.to_numeric(df["b25103_001e"], errors="coerce")

    # Filter out invalid or missing values
    df = df[(df["median_home_value"] > 0) & (df["median_tax_paid"] > 0)].copy()

    # Map State Abbreviation
    df["state_abbr"] = df["state_fips"].map(STATE_FIPS_TO_ABBR).fillna(df["state_fips"])

    # Clean County Name
    df["county_clean_name"] = df["name"].str.split(",").str[0].str.strip()

    logging.info("Successfully loaded Census data for %d counties.", len(df))
    return df[["geoid", "state_abbr", "county_clean_name", "median_home_value", "median_tax_paid"]]


def load_hud_crosswalk(path: Path) -> pd.DataFrame:
    """Loads and standardizes the HUD ZIP-County crosswalk file from the given path."""
    logging.info("Loading HUD Crosswalk file from: %s", path)
    
    if path.suffix.lower() in [".xlsx", ".xls"]:
        df = pd.read_excel(path, dtype=str)
    else:
        df = pd.read_csv(path, dtype=str)

    # Standardize column names to lowercase
    df.columns = df.columns.str.lower()

    # Locate required columns
    zip_col = "zip" if "zip" in df.columns else None
    geoid_col = "geoid" if "geoid" in df.columns else ("county" if "county" in df.columns else None)
    ratio_col = "res_ratio" if "res_ratio" in df.columns else ("tot_ratio" if "tot_ratio" in df.columns else None)

    if not (zip_col and geoid_col and ratio_col):
        raise KeyError(
            f"HUD Crosswalk file missing required columns. Found: {list(df.columns)}. "
            f"Expected columns containing 'zip', 'geoid'/'county', and 'res_ratio'."
        )

    # Clean & format keys
    df["zip_code"] = df[zip_col].astype(str).str.zfill(5)
    df["geoid"] = df[geoid_col].astype(str).str.zfill(5)
    df["res_ratio"] = pd.to_numeric(df[ratio_col], errors="coerce").fillna(0.0)

    # Filter out zero weights
    df = df[df["res_ratio"] > 0].copy()

    logging.info("Loaded %d valid ZIP-County mapping entries.", len(df))
    return df[["zip_code", "geoid", "res_ratio"]]


def compute_weighted_zip_tax_rates(census_df: pd.DataFrame, hud_df: pd.DataFrame) -> tuple[dict, dict]:
    """
    Merges Census county tax data with HUD ZIP crosswalk and computes population-weighted
    housing values, median tax amounts, and effective tax rates by ZIP code.

    Returns:
        tuple[dict, dict]:
          - full_tax_data: Dictionary keyed by 5-digit ZIP code with State, Counties list,
            housing value, median tax, and tax rate.
          - summarized_tax_data: Dictionary mapping 5-digit ZIP code directly to aggregate tax rate float.
    """
    logging.info("Merging Census data with HUD Crosswalk...")
    merged = pd.merge(hud_df, census_df, on="geoid", how="inner")

    if merged.empty:
        raise ValueError("Merge returned no records. Check that GEOIDs in HUD file match 5-digit FIPS codes.")

    # Re-normalize weights per ZIP code
    zip_weight_sums = merged.groupby("zip_code")["res_ratio"].transform("sum")
    merged["norm_weight"] = merged["res_ratio"] / zip_weight_sums

    # Weighted components
    merged["weighted_home_val"] = merged["median_home_value"] * merged["norm_weight"]
    merged["weighted_tax_paid"] = merged["median_tax_paid"] * merged["norm_weight"]

    # Pre-format concatenated County, State representation
    merged["county_state"] = merged["county_clean_name"] + ", " + merged["state_abbr"]

    logging.info("Aggregating population-weighted values by ZIP code...")

    # Perform aggregation (named aggregation passes a Series to the agg function)
    # The 'Counties' column is converted to a list of distinct county strings
    agg_df = merged.groupby("zip_code").agg(
        state=("state_abbr", "first"),
        counties=("county_state", lambda s: list(pd.unique(s))),
        weighted_housing_val=("weighted_home_val", "sum"),
        weighted_median_tax=("weighted_tax_paid", "sum"),
    ).reset_index()

    # Calculate effective property tax rate (%)
    agg_df["effective_tax_rate_pct"] = (
        agg_df["weighted_median_tax"] / agg_df["weighted_housing_val"]
    ) * 100.0

    # Build full detailed dictionary and summarized dictionary keyed by 5-digit ZIP code
    full_tax_data = {}
    summarized_tax_data = {}

    for row in agg_df.itertuples(index=False):
        zip_str = str(row.zip_code).zfill(5)
        tax_rate = round(float(row.effective_tax_rate_pct), 4)

        summarized_tax_data[zip_str] = tax_rate
        full_tax_data[zip_str] = {
            "State": row.state,
            "Counties": row.counties,
            "Aggregate (population-weighted) housing value": round(float(row.weighted_housing_val), 2),
            "Aggregate (population-weighted) median property tax paid": round(float(row.weighted_median_tax), 2),
            "Aggregate (population-weighted) tax rate": tax_rate,
        }

    return full_tax_data, summarized_tax_data


def parse_arguments(cli_args=None) -> argparse.Namespace:
    """Parses command-line arguments using argparse."""
    parser = argparse.ArgumentParser(
        description="Calculate 5-digit ZIP code effective property tax rates using Census ACS API and HUD crosswalk."
    )
    parser.add_argument(
        "-c", "--hud-crosswalk", "--crosswalk",
        required=True,
        dest="hud_crosswalk",
        help="Full path to the HUD USPS ZIP-County crosswalk file (XLSX or CSV format)."
    )
    parser.add_argument(
        "-s", "--summarized-output-path", "--summarized-output",
        required=True,
        dest="summarized_output_path",
        help="Full path for the summarized JSON output mapping ZIP codes to aggregate tax rates."
    )
    parser.add_argument(
        "-f", "--full-output-path", "--output-json", "--full-output",
        required=False,
        default=None,
        dest="full_output_path",
        help="Optional full path for the full detailed JSON output file."
    )
    parser.add_argument(
        "-k", "--api-key",
        default="",
        dest="api_key",
        help="U.S. Census Bureau API key (optional; public tier used if omitted)."
    )
    parser.add_argument(
        "-y", "--year",
        default="2023",
        dest="year",
        help="Census ACS 5-Year survey year (default: 2023)."
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        dest="no_cache",
        help="Force re-download of Census data, bypassing the temporary directory cache."
    )

    parsed = parser.parse_args(cli_args)
    parsed.crosswalk_path = Path(parsed.hud_crosswalk).resolve()
    parsed.summarized_path = Path(parsed.summarized_output_path).resolve()
    parsed.full_path = Path(parsed.full_output_path).resolve() if parsed.full_output_path else None
    return parsed


def main():
    """Main execution flow."""
    args = parse_arguments()

    try:
        # Step 1: Enforce HUD crosswalk presence at user-specified path
        verify_hud_crosswalk_exists(args.crosswalk_path)

        # Step 2: Fetch Census ACS County Data (with temp dir caching)
        use_cache = not args.no_cache
        census_df = fetch_census_acs_county_data(args.api_key, args.year, use_cache=use_cache)

        # Step 3: Load HUD Crosswalk
        hud_df = load_hud_crosswalk(args.crosswalk_path)

        # Step 4: Compute Weighted ZIP Tax Rates
        full_dict, summarized_dict = compute_weighted_zip_tax_rates(census_df, hud_df)

        # Step 5: Export summarized JSON (required)
        args.summarized_path.parent.mkdir(parents=True, exist_ok=True)
        with open(args.summarized_path, "w", encoding="utf-8") as f:
            json.dump(summarized_dict, f, indent=2)

        logging.info("Successfully exported summarized tax rates for %d ZIP codes to:", len(summarized_dict))
        logging.info("  %s", args.summarized_path)

        # Step 6: Export full detailed JSON (optional)
        if args.full_path:
            args.full_path.parent.mkdir(parents=True, exist_ok=True)
            with open(args.full_path, "w", encoding="utf-8") as f:
                json.dump(full_dict, f, indent=2)

            logging.info("Successfully exported full property tax data for %d ZIP codes to:", len(full_dict))
            logging.info("  %s", args.full_path)

    except FileNotFoundError as fnf_err:
        logging.error("FILE MISSING ERROR:\n%s", fnf_err)
        sys.exit(1)


if __name__ == "__main__":
    main()
