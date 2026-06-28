const BUCKET_CONFIG = {
  premium: {
    label: "Premium",
    count: 6,
    elementId: "premiumBucket"
  },
  bestSellers: {
    label: "Best Sellers",
    count: 12,
    elementId: "bestSellersBucket"
  },
  budget: {
    label: "Budget Smart Picks",
    count: 7,
    elementId: "budgetBucket"
  },
  unique: {
    label: "Unique",
    count: 5,
    elementId: "uniqueBucket"
  }
};

const bucketData = {
  premium: [],
  bestSellers: [],
  budget: [],
  unique: []
};

let isRunning = false;

const categoryKeywordInput = document.getElementById("categoryKeyword");
const brandsToAvoidInput = document.getElementById("brandsToAvoid");
const aiApiKeyInput = document.getElementById("aiApiKey");
const rememberApiKeyInput = document.getElementById("rememberApiKey");

const startBtn = document.getElementById("startBtn");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const toggleApiKeyBtn = document.getElementById("toggleApiKeyBtn");

const statusPill = document.getElementById("statusPill");
const messageBox = document.getElementById("messageBox");
const activityText = document.getElementById("activityText");

document.addEventListener("DOMContentLoaded", initializeDashboard);

startBtn.addEventListener("click", handleStart);
resetBtn.addEventListener("click", resetDashboard);
exportBtn.addEventListener("click", exportExcel);
toggleApiKeyBtn.addEventListener("click", toggleApiKeyVisibility);

rememberApiKeyInput.addEventListener("change", async () => {
  if (!rememberApiKeyInput.checked) {
    await chrome.storage.local.remove(["aiApiKey"]);
  } else {
    const aiApiKey = aiApiKeyInput.value.trim();

    if (aiApiKey) {
      await chrome.storage.local.set({
        aiApiKey
      });
    }
  }
});

aiApiKeyInput.addEventListener("input", async () => {
  if (rememberApiKeyInput.checked) {
    await chrome.storage.local.set({
      aiApiKey: aiApiKeyInput.value.trim()
    });
  }
});

async function initializeDashboard() {
  renderAllBuckets();

  const savedData = await chrome.storage.local.get(["aiApiKey"]);

  if (savedData.aiApiKey) {
    aiApiKeyInput.value = savedData.aiApiKey;
    rememberApiKeyInput.checked = true;
  }

  setStatus("idle", "Idle");
  setMessage("Waiting to start.");
  setActivity("No activity yet.");
}

function renderAllBuckets() {
  Object.keys(BUCKET_CONFIG).forEach(bucketKey => {
    renderBucket(bucketKey);
  });
}

function renderBucket(bucketKey) {
  const config = BUCKET_CONFIG[bucketKey];
  const bucketElement = document.getElementById(config.elementId);

  bucketElement.innerHTML = "";

  for (let i = 0; i < config.count; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.dataset.bucket = bucketKey;
    slot.dataset.index = String(i);

    const value = bucketData[bucketKey][i];

    if (value) {
      slot.textContent = value;
      slot.classList.add("filled");
    } else {
      slot.textContent = "Empty";
    }

    bucketElement.appendChild(slot);
  }
}

async function handleStart() {
  if (isRunning) {
    setMessage("Program is already running.", "error");
    return;
  }

  const categoryKeyword = categoryKeywordInput.value.trim();
  const brandsToAvoid = brandsToAvoidInput.value.trim();
  const aiApiKey = aiApiKeyInput.value.trim();

  if (!categoryKeyword) {
    setMessage("Please enter category keyword.", "error");
    categoryKeywordInput.focus();
    return;
  }

  if (!aiApiKey) {
    setMessage("Please enter AI API key to start.", "error");
    aiApiKeyInput.focus();
    return;
  }

  if (rememberApiKeyInput.checked) {
    await chrome.storage.local.set({
      aiApiKey
    });
  }

  resetBucketsOnly();

  isRunning = true;
  startBtn.disabled = true;
  exportBtn.disabled = true;

  setStatus("running", "Running");
  setMessage("Processing all Premium brands and reading BSR...");
  setActivity(`Opening 4 Amazon tabs for "${categoryKeyword}"...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_AMAZON_WORKFLOW",
      keyword: categoryKeyword,
      aiApiKey,
      brandsToAvoid
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Amazon workflow failed.");
    }

    const tabs = response.result.tabs || [];
    const premiumTab = tabs.find(tab => tab.key === "premium");

    if (premiumTab?.premiumSelectedProducts?.length > 0) {
      premiumTab.premiumSelectedProducts.forEach(item => {
        if (typeof item.bucketIndex === "number" && item.asin) {
          bucketData.premium[item.bucketIndex] = item.asin;
        }
      });

      renderBucket("premium");
    }

    const tabSummary = tabs
      .map(tab => {
        const filterStatus = tab.getItByTomorrowClicked
          ? "Tomorrow filter clicked"
          : "Tomorrow filter not found";

        return `${tab.bucket}: Tab opened, ${filterStatus}`;
      })
      .join("\n");

    let selectedBrandText = "AI Selected Premium Brands:\n";

    if (
      premiumTab &&
      premiumTab.selectedPremiumBrands &&
      premiumTab.selectedPremiumBrands.length > 0
    ) {
      selectedBrandText += premiumTab.selectedPremiumBrands
        .map((brand, index) => `${index + 1}. ${brand}`)
        .join("\n");
    } else {
      selectedBrandText += premiumTab?.aiBrandMessage || premiumTab?.brandExtractionMessage || "No premium brands selected.";
    }

    const avoidedBrandsText = premiumTab?.avoidedBrands?.length
      ? `\n\nBrands Avoided:\n${premiumTab.avoidedBrands.map((brand, index) => `${index + 1}. ${brand}`).join("\n")}`
      : "";

    let premiumResultsText = "\n\nPremium Brand Results:\n";

    if (premiumTab?.premiumBrandResults?.length > 0) {
      premiumResultsText += premiumTab.premiumBrandResults
        .map((brandResult, index) => {
          const selected = brandResult.selectedProduct;

          if (selected && selected.asin) {
            return `${index + 1}. ${brandResult.brand}: ${selected.asin} | BSR: #${selected.bestBsr} in ${selected.bestBsrCategory} | Rating: ${selected.rating} | Reviews: ${selected.reviewCount}\n   ${truncateText(selected.title, 110)}`;
          }

          return `${index + 1}. ${brandResult.brand}: Not selected - ${brandResult.message || "No valid BSR product found."}`;
        })
        .join("\n");
    } else {
      premiumResultsText += "No Premium brand results available.";
    }

    let bucketText = "\n\nPremium Bucket Filled:\n";

    for (let i = 0; i < BUCKET_CONFIG.premium.count; i++) {
      bucketText += `${i + 1}. ${bucketData.premium[i] || "Empty"}\n`;
    }

    const finalActivityText = `${tabSummary}\n\n${selectedBrandText}${avoidedBrandsText}${premiumResultsText}${bucketText}`;

    setStatus("completed", "Premium Bucket Filled");
    setMessage("All Premium brand checks completed. Product pages were closed after BSR extraction.", "success");
    setActivity(finalActivityText);
  } catch (error) {
    console.error(error);

    setStatus("error", "Error");
    setMessage(error.message || "Something went wrong.", "error");
    setActivity("Program stopped because of an error.");
  } finally {
    isRunning = false;
    startBtn.disabled = false;
  }
}

function resetDashboard() {
  if (isRunning) {
    setMessage("Cannot reset while program is running.", "error");
    return;
  }

  categoryKeywordInput.value = "";
  brandsToAvoidInput.value = "";

  if (!rememberApiKeyInput.checked) {
    aiApiKeyInput.value = "";
  }

  resetBucketsOnly();

  setStatus("idle", "Idle");
  setMessage("Dashboard reset.");
  setActivity("No activity yet.");

  exportBtn.disabled = true;
}

function resetBucketsOnly() {
  Object.keys(bucketData).forEach(bucketKey => {
    bucketData[bucketKey] = [];
  });

  renderAllBuckets();
}

function exportExcel() {
  const rows = buildColumnBasedExportRows();

  const htmlTable = buildExcelHtml(rows);

  const blob = new Blob([htmlTable], {
    type: "application/vnd.ms-excel"
  });

  const categoryKeyword = categoryKeywordInput.value.trim() || "category";
  const safeKeyword = categoryKeyword.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  const fileName = `asin_buckets_${safeKeyword}_${getDateStamp()}.xls`;

  const downloadUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(downloadUrl);

  setMessage("Excel file exported successfully.", "success");
}

function buildColumnBasedExportRows() {
  const maxRows = Math.max(
    BUCKET_CONFIG.premium.count,
    BUCKET_CONFIG.bestSellers.count,
    BUCKET_CONFIG.budget.count,
    BUCKET_CONFIG.unique.count
  );

  const rows = [];

  for (let i = 0; i < maxRows; i++) {
    rows.push([
      bucketData.premium[i] || "",
      bucketData.bestSellers[i] || "",
      bucketData.budget[i] || "",
      bucketData.unique[i] || ""
    ]);
  }

  return rows;
}

function buildExcelHtml(rows) {
  const headers = [
    "Premium",
    "Best Sellers",
    "Budget Smart Picks",
    "Unique"
  ];

  const headerHtml = headers
    .map(header => `<th>${escapeHtml(header)}</th>`)
    .join("");

  const rowsHtml = rows
    .map(row => {
      const cells = row
        .map(cell => `<td>${escapeHtml(cell)}</td>`)
        .join("");

      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          table {
            border-collapse: collapse;
            font-family: Arial, sans-serif;
          }

          th, td {
            border: 1px solid #999;
            padding: 8px 12px;
            text-align: left;
            min-width: 160px;
          }

          th {
            background: #f2f2f2;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>${headerHtml}</tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function toggleApiKeyVisibility() {
  const isPassword = aiApiKeyInput.type === "password";

  aiApiKeyInput.type = isPassword ? "text" : "password";
  toggleApiKeyBtn.textContent = isPassword ? "Hide" : "Show";
}

function setStatus(type, text) {
  statusPill.className = "status-pill";

  if (type === "idle") {
    statusPill.classList.add("status-idle");
  }

  if (type === "running") {
    statusPill.classList.add("status-running");
  }

  if (type === "completed") {
    statusPill.classList.add("status-completed");
  }

  if (type === "error") {
    statusPill.classList.add("status-error");
  }

  statusPill.textContent = `Status: ${text}`;
}

function setMessage(message, type = "") {
  messageBox.className = "message";

  if (type === "error") {
    messageBox.classList.add("message-error");
  }

  if (type === "success") {
    messageBox.classList.add("message-success");
  }

  messageBox.textContent = message;
}

function setActivity(message) {
  activityText.textContent = message;
}

function truncateText(text, maxLength) {
  const value = String(text || "");

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function getDateStamp() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}