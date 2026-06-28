# Amazon ASIN AI Finder Dashboard

## Overview

Amazon ASIN AI Finder Dashboard is a Chrome Extension that automates Amazon product research using AI.

Instead of manually searching through hundreds of products, the extension opens Amazon search pages, applies filters, extracts product information, analyzes Best Seller Rank (BSR), and organizes the best ASINs into predefined product buckets.

The extension also integrates with Together AI to intelligently identify premium brands before product selection.

---

## Features

* AI-powered Premium Brand Selection
* Automated Amazon product research
* Opens multiple Amazon search tabs automatically
* Applies **Get It by Tomorrow** filter
* Applies **4 Stars & Up** filter
* Extracts available brands
* Removes unwanted brands
* Uses Together AI to choose the best premium brands
* Opens product pages automatically
* Extracts Best Seller Rank (BSR)
* Selects the product with the lowest BSR
* Organizes ASINs into product buckets
* Exports results to Excel
* Saves API key securely using Chrome Storage

---

## Product Buckets

The extension categorizes products into four buckets:

| Bucket             | Target Count |
| ------------------ | -----------: |
| Premium            |            6 |
| Best Sellers       |           12 |
| Budget Smart Picks |            7 |
| Unique             |            5 |

---

## Workflow

1. Enter a product category.
2. Optionally specify brands to avoid.
3. Enter your Together AI API Key.
4. Click **Start**.
5. The extension:

   * Opens Amazon search pages
   * Applies required filters
   * Extracts brands
   * Uses AI to select premium brands
   * Opens product pages
   * Extracts Best Seller Rank (BSR)
   * Selects the strongest ASINs
   * Displays the results in dashboard buckets
6. Export the ASIN list to Excel.

---

## Technologies Used

* JavaScript (ES6)
* HTML
* CSS
* Chrome Extension Manifest V3
* Chrome Tabs API
* Chrome Scripting API
* Chrome Storage API
* Together AI API

---

## Permissions

The extension requires the following permissions:

* storage
* tabs
* scripting

Host Permissions:

```
https://www.amazon.com/*
https://amazon.com/*
```

---

## Excel Export

The extension exports the selected ASINs into an Excel file containing:

* Premium
* Best Sellers
* Budget Smart Picks
* Unique

---

## Installation

1. Clone this repository.

```
git clone https://github.com/yourusername/amazon-asin-ai-finder-dashboard.git
```

2. Open Chrome.

3. Navigate to:

```
chrome://extensions
```

4. Enable **Developer Mode**.

5. Click **Load unpacked**.

6. Select the project folder.

7. The extension is ready to use.

---

## Requirements

* Google Chrome
* Together AI API Key
* Internet connection
* Amazon.com access

---

## Project Structure

```
Amazon-ASIN-AI-Finder-Dashboard/

├── manifest.json
├── background.js
├── dashboard.html
├── dashboard.js
├── dashboard.css
├── icon.jpg
└── README.md
```

---

## Future Improvements

* Best Sellers automation
* Budget Smart Picks automation
* Unique product automation
* Multi-page product extraction
* AI-based product scoring
* Product price analysis
* Sales estimation
* CSV export
* Duplicate ASIN detection
* Product history tracking

---

## Disclaimer

This project is intended for educational and research purposes. Users are responsible for complying with Amazon's Terms of Service and the usage policies of any third-party APIs.

---

## Author

**Subhash Preetham**

GitHub: https://github.com/preetham-subhash
