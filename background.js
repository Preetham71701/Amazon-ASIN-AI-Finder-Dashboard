chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html")
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_AMAZON_WORKFLOW") {
    startAmazonWorkflow(message.keyword, message.aiApiKey, message.brandsToAvoid)
      .then(result => {
        sendResponse({
          ok: true,
          result
        });
      })
      .catch(error => {
        console.error(error);

        sendResponse({
          ok: false,
          error: error.message || "Failed to start Amazon workflow."
        });
      });

    return true;
  }
});

async function startAmazonWorkflow(keyword, aiApiKey, brandsToAvoidText) {
  const cleanKeyword = String(keyword || "").trim();
  const cleanApiKey = String(aiApiKey || "").trim();
  const brandsToAvoid = parseBrandsToAvoid(brandsToAvoidText);

  if (!cleanKeyword) {
    throw new Error("Keyword is required.");
  }

  if (!cleanApiKey) {
    throw new Error("AI API key is required.");
  }

  const workflows = [
    {
      bucket: "Premium",
      key: "premium",
      searchKeyword: cleanKeyword,
      sort: ""
    },
    {
      bucket: "Best Sellers",
      key: "bestSellers",
      searchKeyword: cleanKeyword,
      sort: "exact-aware-popularity-rank"
    },
    {
      bucket: "Budget Smart Picks",
      key: "budget",
      searchKeyword: cleanKeyword,
      sort: "price-asc-rank"
    },
    {
      bucket: "Unique",
      key: "unique",
      searchKeyword: `${cleanKeyword} unique`,
      sort: ""
    }
  ];

  const tabTasks = workflows.map(workflow => {
    return processWorkflowTab({
      workflow,
      keyword: cleanKeyword,
      aiApiKey: cleanApiKey,
      brandsToAvoid
    });
  });

  const tabResults = await Promise.all(tabTasks);

  return {
    keyword: cleanKeyword,
    tabs: tabResults
  };
}

async function processWorkflowTab({ workflow, keyword, aiApiKey, brandsToAvoid }) {
  const baseSearchUrl = buildAmazonSearchUrl(workflow.searchKeyword, workflow.sort);

  const tab = await createTab(baseSearchUrl);

  const tabResult = {
    bucket: workflow.bucket,
    key: workflow.key,
    tabId: tab.id,
    url: baseSearchUrl,
    getItByTomorrowClicked: false,
    message: "",
    brandCount: 0,
    filteredBrandCount: 0,
    avoidedBrands: [],
    selectedPremiumBrands: [],
    aiSelectedBrandsOriginal: [],
    aiSelectedNumbers: [],
    aiBrandMessage: "",
    brandExtractionMessage: "",
    premiumBrandResults: [],
    premiumSelectedProducts: []
  };

  await waitForTabComplete(tab.id);
  await wait(2500);

  const firstTomorrowClick = await clickGetItByTomorrow(tab.id);

  tabResult.getItByTomorrowClicked = firstTomorrowClick.clicked;
  tabResult.message = firstTomorrowClick.message;

  await waitForPossibleNavigation(tab.id, 9000);
  await wait(3500);

  if (workflow.key === "premium") {
    const brandResult = await extractBrandsFromPremiumTab(tab.id);

    const brands = brandResult.brands || [];
    tabResult.brandCount = brands.length;
    tabResult.brandExtractionMessage = brandResult.message || "";

    const filteredResult = filterAvoidedBrands(brands, brandsToAvoid);

    const filteredBrands = filteredResult.filteredBrands;
    tabResult.filteredBrandCount = filteredBrands.length;
    tabResult.avoidedBrands = filteredResult.removedBrands;

    if (filteredBrands.length < 6) {
      throw new Error(
        `Only ${filteredBrands.length} brands are available after removing Brands to Avoid. At least 6 brands are required.`
      );
    }

    const aiResult = await getPremiumBrandsFromTogetherAI({
      apiKey: aiApiKey,
      keyword,
      brands: filteredBrands
    });

    const aiSelectedBrands = aiResult.selectedBrands || [];

    tabResult.aiSelectedBrandsOriginal = aiSelectedBrands;
    tabResult.aiSelectedNumbers = aiResult.selectedNumbers || [];
    tabResult.selectedPremiumBrands = aiSelectedBrands;

    tabResult.aiBrandMessage = aiSelectedBrands.length === 6
      ? "AI returned exactly 6 premium brands."
      : `AI returned ${aiSelectedBrands.length} brands instead of 6.`;

    tabResult.rawAiResponse = aiResult.rawText || "";

    if (tabResult.selectedPremiumBrands.length !== 6) {
      throw new Error(
        `AI must return exactly 6 premium brands, but returned ${tabResult.selectedPremiumBrands.length}.`
      );
    }

    const selectedBrandsForProcessing = tabResult.selectedPremiumBrands.slice(0, 6);

    for (let i = 0; i < selectedBrandsForProcessing.length; i++) {
      const brandName = selectedBrandsForProcessing[i];

      const brandProcessResult = await processSinglePremiumBrand({
        premiumTabId: tab.id,
        baseSearchUrl,
        brandName,
        brandIndex: i
      });

      tabResult.premiumBrandResults.push(brandProcessResult);

      if (brandProcessResult.selectedProduct && brandProcessResult.selectedProduct.asin) {
        tabResult.premiumSelectedProducts.push({
          brand: brandName,
          bucketIndex: i,
          ...brandProcessResult.selectedProduct
        });
      } else {
        tabResult.premiumSelectedProducts.push({
          brand: brandName,
          bucketIndex: i,
          asin: "",
          title: "",
          bestBsr: null,
          bestBsrCategory: "",
          message: brandProcessResult.message || "No product selected for this brand."
        });
      }

      await wait(1500);
    }
  }

  return tabResult;
}

async function processSinglePremiumBrand({ premiumTabId, baseSearchUrl, brandName, brandIndex }) {
  const result = {
    brand: brandName,
    brandIndex,
    getItByTomorrowClicked: false,
    getItByTomorrowMessage: "",
    brandFilterClicked: false,
    brandFilterMessage: "",
    fourStarClicked: false,
    fourStarMessage: "",
    productExtractionMessage: "",
    topProducts: [],
    productsWithBsr: [],
    selectedProduct: null,
    message: ""
  };

  try {
    await updateTabUrl(premiumTabId, baseSearchUrl);
    await waitForTabComplete(premiumTabId);
    await wait(3000);

    const tomorrowResult = await clickGetItByTomorrow(premiumTabId);

    result.getItByTomorrowClicked = tomorrowResult.clicked;
    result.getItByTomorrowMessage = tomorrowResult.message || "";

    await waitForPossibleNavigation(premiumTabId, 9000);
    await wait(3500);

    const brandClickResult = await clickBrandFilter(premiumTabId, brandName);

    result.brandFilterClicked = brandClickResult.clicked;
    result.brandFilterMessage = brandClickResult.message || "";

    await waitForPossibleNavigation(premiumTabId, 9000);
    await wait(3500);

    const fourStarResult = await clickFourStarsAndUpFilter(premiumTabId);

    result.fourStarClicked = fourStarResult.clicked;
    result.fourStarMessage = fourStarResult.message || "";

    await waitForPossibleNavigation(premiumTabId, 9000);
    await wait(4000);

    const productResult = await extractPremiumProductsFromCurrentPage(premiumTabId);

    const products = productResult.products || [];

    result.productExtractionMessage = productResult.message || "";
    result.topProducts = getTopProductsByRatingWeight(products, 5);

    if (result.topProducts.length === 0) {
      result.message = "No top products found after applying filters.";
      return result;
    }

    result.productsWithBsr = await openProductsAndExtractBsr(result.topProducts);

    result.selectedProduct = pickLowestBsrProduct(result.productsWithBsr);

    if (!result.selectedProduct) {
      result.message = "No product selected because BSR was not found for this brand.";
      return result;
    }

    result.message = `Selected ${result.selectedProduct.asin} for ${brandName}.`;

    return result;
  } catch (error) {
    result.message = `Premium brand processing failed for ${brandName}: ${error.message || error}`;
    return result;
  }
}

function parseBrandsToAvoid(value) {
  return String(value || "")
    .split(",")
    .map(brand => brand.trim())
    .filter(Boolean);
}

function filterAvoidedBrands(brands, brandsToAvoid) {
  if (!Array.isArray(brandsToAvoid) || brandsToAvoid.length === 0) {
    return {
      filteredBrands: brands,
      removedBrands: []
    };
  }

  const avoidSet = new Set(
    brandsToAvoid.map(brand => normalizeBrand(brand))
  );

  const filteredBrands = [];
  const removedBrands = [];

  brands.forEach(brand => {
    const normalizedBrand = normalizeBrand(brand);

    if (avoidSet.has(normalizedBrand)) {
      removedBrands.push(brand);
    } else {
      filteredBrands.push(brand);
    }
  });

  return {
    filteredBrands,
    removedBrands
  };
}

function buildAmazonSearchUrl(keyword, sort) {
  const url = new URL("https://www.amazon.com/s");

  url.searchParams.set("k", keyword);

  if (sort) {
    url.searchParams.set("s", sort);
  }

  return url.toString();
}

function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(
      {
        url,
        active: false
      },
      tab => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!tab || !tab.id) {
          reject(new Error("Unable to create Amazon tab."));
          return;
        }

        resolve(tab);
      }
    );
  });
}

function updateTabUrl(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(
      tabId,
      {
        url,
        active: false
      },
      tab => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(tab);
      }
    );
  });
}

function closeTab(tabId) {
  return new Promise(resolve => {
    chrome.tabs.remove(tabId, () => {
      resolve();
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    chrome.tabs.get(tabId, currentTab => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }

      if (currentTab && currentTab.status === "complete") {
        resolve();
        return;
      }

      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

function waitForPossibleNavigation(tabId, timeoutMs = 8000) {
  return new Promise(resolve => {
    let resolved = false;

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function clickGetItByTomorrow(tabId) {
  const results = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    func: clickGetItByTomorrowOnAmazonPage
  });

  if (!results || !results[0] || !results[0].result) {
    return {
      clicked: false,
      message: "No script result returned while clicking Tomorrow filter."
    };
  }

  return results[0].result;
}

function clickGetItByTomorrowOnAmazonPage() {
  const selectors = [
    "#p_90\\/8308921011 > span > a > div > label > i",
    "#p_90\\/8308921011 a",
    'li[id="p_90/8308921011"] a',
    'li[id="p_90/8308921011"]'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      element.click();

      return {
        clicked: true,
        selector,
        message: "Get it by Tomorrow filter clicked."
      };
    }
  }

  return {
    clicked: false,
    selector: null,
    message: "Get it by Tomorrow filter was not found on this page."
  };
}

async function extractBrandsFromPremiumTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId
      },
      func: extractBrandsFromAmazonPageWithRetry
    });

    if (!results || !results[0]) {
      return {
        brands: [],
        message: "No brand extraction execution result returned."
      };
    }

    if (!results[0].result) {
      return {
        brands: [],
        message: "Brand extraction script returned empty result."
      };
    }

    return results[0].result;
  } catch (error) {
    return {
      brands: [],
      message: `Brand extraction failed: ${error.message || error}`
    };
  }
}

async function extractBrandsFromAmazonPageWithRetry() {
  function waitInsidePage(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isValidBrandText(text) {
    if (!text) {
      return false;
    }

    const lowerText = text.toLowerCase();

    const blockedExactTexts = [
      "brands",
      "brand",
      "see more",
      "see less",
      "clear",
      "clear all",
      "featured brands",
      "all discounts",
      "discount",
      "discounts",
      "customer reviews",
      "delivery day",
      "get it by tomorrow",
      "amazon prime",
      "prime",
      "eligible for free shipping",
      "free shipping by amazon",
      "department",
      "price",
      "seller",
      "availability"
    ];

    if (blockedExactTexts.includes(lowerText)) {
      return false;
    }

    if (lowerText.includes("see more")) {
      return false;
    }

    if (lowerText.includes("see less")) {
      return false;
    }

    if (lowerText.includes("clear")) {
      return false;
    }

    if (text.length > 70) {
      return false;
    }

    if (/stars?\s*&?\s*up/i.test(text)) {
      return false;
    }

    if (/\d+\s*results?/i.test(text)) {
      return false;
    }

    return true;
  }

  async function waitForBrandSection() {
    const maxAttempts = 12;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const section = document.querySelector("#brandsRefinements");

      if (section) {
        return section;
      }

      await waitInsidePage(750);
    }

    return null;
  }

  const brandSection = await waitForBrandSection();

  if (!brandSection) {
    return {
      brands: [],
      count: 0,
      message: "Brand filter section #brandsRefinements was not found after waiting.",
      debug: `Page title: ${document.title}`
    };
  }

  brandSection.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  await waitInsidePage(800);

  const brandSet = new Set();

  const anchorElements = brandSection.querySelectorAll("li a");

  anchorElements.forEach(anchor => {
    const text = cleanText(anchor.innerText || anchor.textContent);

    if (isValidBrandText(text)) {
      brandSet.add(text);
    }
  });

  const spanElements = brandSection.querySelectorAll(
    "li span.a-size-base.a-color-base, li span.a-list-item, li span"
  );

  spanElements.forEach(span => {
    const text = cleanText(span.innerText || span.textContent);

    if (isValidBrandText(text)) {
      brandSet.add(text);
    }
  });

  const listItems = brandSection.querySelectorAll("li");

  listItems.forEach(item => {
    let text = cleanText(item.innerText || item.textContent);

    text = text
      .replace(/^Sponsored\s*/i, "")
      .replace(/^Amazon's Choice\s*/i, "")
      .replace(/\(\d+\)$/g, "")
      .trim();

    if (isValidBrandText(text)) {
      brandSet.add(text);
    }
  });

  if (brandSet.size === 0) {
    const lines = String(brandSection.innerText || brandSection.textContent || "")
      .split("\n")
      .map(line => cleanText(line))
      .filter(line => isValidBrandText(line));

    lines.forEach(line => {
      brandSet.add(line);
    });
  }

  const brands = Array.from(brandSet);

  return {
    brands,
    count: brands.length,
    message: brands.length
      ? `${brands.length} visible brands found in Premium tab.`
      : "Brand section was found, but no valid brand names were extracted.",
    debug: `Brand section text length: ${cleanText(brandSection.innerText || brandSection.textContent).length}`
  };
}

async function getPremiumBrandsFromTogetherAI({ apiKey, keyword, brands }) {
  const maxRetries = 5;
  let lastRawText = "";
  let lastSelectedBrands = [];
  let lastSelectedNumbers = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const prompt = buildPremiumBrandPrompt(keyword, brands, attempt);

    const response = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-3n-E4B-it",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`Together AI request failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    const rawText = data?.choices?.[0]?.message?.content || "";
    const parsedResult = parseSixBrandsFromAiResponse(rawText, brands);

    lastRawText = rawText;
    lastSelectedBrands = parsedResult.selectedBrands;
    lastSelectedNumbers = parsedResult.selectedNumbers;

    if (parsedResult.selectedBrands.length === 6) {
      return {
        selectedBrands: parsedResult.selectedBrands,
        selectedNumbers: parsedResult.selectedNumbers,
        rawText,
        message: "Exactly 6 premium brands selected by AI."
      };
    }

    await wait(1000);
  }

  throw new Error(
    `AI did not return exactly 6 valid brand numbers after ${maxRetries} attempts. Last valid count: ${lastSelectedBrands.length}. Last numbers: ${JSON.stringify(lastSelectedNumbers)}. Raw response: ${lastRawText}`
  );
}

function buildPremiumBrandPrompt(keyword, brands, attemptNumber = 1) {
  const brandList = brands
    .map((brand, index) => `${index + 1}. ${brand}`)
    .join("\n");

  return `
You are selecting premium Amazon brands for product research automation.

Category keyword:
${keyword}

Allowed Amazon brand list:
${brandList}

Your task:
Select EXACTLY 6 premium and popular brands from the allowed Amazon brand list.

VERY IMPORTANT:
You must select by NUMBER only.
Do not return brand names.
Do not return brand names like Apple, Samsung, Garmin, etc.
Only return the numbers from the allowed list above.

Mandatory rules:
1. You MUST return exactly 6 numbers.
2. Every number MUST exist in the allowed Amazon brand list.
3. Do NOT return less than 6 numbers.
4. Do NOT return more than 6 numbers.
5. Do NOT repeat numbers.
6. Do NOT invent brands.
7. Do NOT add explanation.
8. Do NOT add markdown.
9. Return only valid JSON.

Correct JSON format:
{
  "selected_numbers": [1, 2, 3, 4, 5, 6]
}

Wrong format:
{
  "brands": ["Apple", "Samsung"]
}

This is attempt number ${attemptNumber}. Return exactly 6 valid numbers now.
`;
}

function parseSixBrandsFromAiResponse(rawText, availableBrands) {
  let selectedNumbers = [];

  try {
    const cleanRawText = String(rawText || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const jsonMatch = cleanRawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      if (Array.isArray(parsed.selected_numbers)) {
        selectedNumbers = parsed.selected_numbers;
      }

      if (selectedNumbers.length === 0 && Array.isArray(parsed.brands)) {
        const fallbackBrands = parseBrandsArrayFallback(parsed.brands, availableBrands);

        return {
          selectedBrands: fallbackBrands,
          selectedNumbers: []
        };
      }
    }
  } catch (error) {
    selectedNumbers = [];
  }

  const cleanedBrands = [];
  const cleanedNumbers = [];
  const usedNumbers = new Set();

  selectedNumbers.forEach(numberValue => {
    const number = Number(numberValue);

    if (!Number.isInteger(number)) {
      return;
    }

    if (number < 1 || number > availableBrands.length) {
      return;
    }

    if (usedNumbers.has(number)) {
      return;
    }

    const brand = availableBrands[number - 1];

    if (brand) {
      cleanedBrands.push(brand);
      cleanedNumbers.push(number);
      usedNumbers.add(number);
    }
  });

  return {
    selectedBrands: cleanedBrands.slice(0, 6),
    selectedNumbers: cleanedNumbers.slice(0, 6)
  };
}

function parseBrandsArrayFallback(aiBrands, availableBrands) {
  const availableMap = new Map();

  availableBrands.forEach(brand => {
    availableMap.set(normalizeBrand(brand), brand);
  });

  const cleaned = [];
  const used = new Set();

  aiBrands.forEach(brand => {
    const normalized = normalizeBrand(brand);

    if (availableMap.has(normalized) && !used.has(normalized)) {
      cleaned.push(availableMap.get(normalized));
      used.add(normalized);
    }
  });

  return cleaned.slice(0, 6);
}

async function clickBrandFilter(tabId, brandName) {
  const results = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    func: clickBrandFilterOnAmazonPage,
    args: [brandName]
  });

  if (!results || !results[0] || !results[0].result) {
    return {
      clicked: false,
      message: "No script result returned while clicking brand filter."
    };
  }

  return results[0].result;
}

function clickBrandFilterOnAmazonPage(brandName) {
  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeBrand(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }

  const targetBrand = normalizeBrand(brandName);
  const brandSection = document.querySelector("#brandsRefinements");

  if (!brandSection) {
    return {
      clicked: false,
      message: "Brand section #brandsRefinements not found while selecting brand."
    };
  }

  const links = Array.from(brandSection.querySelectorAll("li a"));

  for (const link of links) {
    const text = cleanText(link.innerText || link.textContent);
    const normalizedText = normalizeBrand(text);

    if (normalizedText === targetBrand) {
      link.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      link.click();

      return {
        clicked: true,
        brand: text,
        message: `Selected brand filter: ${text}`
      };
    }
  }

  const listItems = Array.from(brandSection.querySelectorAll("li"));

  for (const item of listItems) {
    const text = cleanText(item.innerText || item.textContent);
    const normalizedText = normalizeBrand(text);

    if (normalizedText === targetBrand) {
      const clickable = item.querySelector("a, label, input, i") || item;

      clickable.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      clickable.click();

      return {
        clicked: true,
        brand: text,
        message: `Selected brand filter: ${text}`
      };
    }
  }

  return {
    clicked: false,
    brand: brandName,
    message: `Brand filter not found for: ${brandName}`
  };
}

async function clickFourStarsAndUpFilter(tabId) {
  const results = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    func: clickFourStarsAndUpOnAmazonPage
  });

  if (!results || !results[0] || !results[0].result) {
    return {
      clicked: false,
      message: "No script result returned while clicking 4 Stars & Up filter."
    };
  }

  return results[0].result;
}

function clickFourStarsAndUpOnAmazonPage() {
  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const exactSelectors = [
    "#reviewsRefinements li a[aria-label*='4 Stars']",
    "#reviewsRefinements li a[aria-label*='4 stars']",
    "#reviewsRefinements li a",
    'section[aria-labelledby="reviewsRefinements"] a'
  ];

  for (const selector of exactSelectors) {
    const elements = Array.from(document.querySelectorAll(selector));

    for (const element of elements) {
      const text = cleanText(
        element.getAttribute("aria-label") ||
        element.innerText ||
        element.textContent
      );

      if (/4\s*stars?\s*&?\s*up/i.test(text) || /4\.0\s*out\s*of\s*5/i.test(text)) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });

        element.click();

        return {
          clicked: true,
          selector,
          text,
          message: "4 Stars & Up filter clicked."
        };
      }
    }
  }

  const reviewSection = document.querySelector("#reviewsRefinements");

  if (!reviewSection) {
    return {
      clicked: false,
      message: "Review filter section #reviewsRefinements was not found."
    };
  }

  const links = Array.from(reviewSection.querySelectorAll("a, li, span"));

  for (const element of links) {
    const text = cleanText(
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.textContent
    );

    if (/4\s*stars?\s*&?\s*up/i.test(text) || /4\.0\s*out\s*of\s*5/i.test(text)) {
      const clickable = element.closest("a") || element;

      clickable.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      clickable.click();

      return {
        clicked: true,
        text,
        message: "4 Stars & Up filter clicked."
      };
    }
  }

  return {
    clicked: false,
    message: "4 Stars & Up filter was not found."
  };
}

async function extractPremiumProductsFromCurrentPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId
      },
      func: extractProductsFromAmazonSearchPage
    });

    if (!results || !results[0]) {
      return {
        products: [],
        message: "No product extraction execution result returned."
      };
    }

    if (!results[0].result) {
      return {
        products: [],
        message: "Product extraction script returned empty result."
      };
    }

    return results[0].result;
  } catch (error) {
    return {
      products: [],
      message: `Product extraction failed: ${error.message || error}`
    };
  }
}

function extractProductsFromAmazonSearchPage() {
  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseRating(text) {
    const match = String(text || "").match(/([0-5](?:\.\d)?)\s*out\s*of\s*5/i);

    if (match) {
      return Number(match[1]);
    }

    const numberMatch = String(text || "").match(/([0-5](?:\.\d)?)/);

    return numberMatch ? Number(numberMatch[1]) : 0;
  }

  function parseReviewCount(text) {
    const cleaned = String(text || "")
      .replace(/,/g, "")
      .trim();

    const match = cleaned.match(/\d+/);

    return match ? Number(match[0]) : 0;
  }

  function getAsinFromElement(card) {
    const asinFromData = card.getAttribute("data-asin");

    if (asinFromData) {
      return asinFromData;
    }

    const link = card.querySelector("a[href*='/dp/'], a[href*='/gp/product/']");

    if (!link) {
      return "";
    }

    const href = link.getAttribute("href") || "";

    const match = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);

    return match ? match[1] : "";
  }

  function getProductUrl(card) {
    const link = card.querySelector("a[href*='/dp/'], a[href*='/gp/product/']");

    if (!link) {
      return "";
    }

    return new URL(link.getAttribute("href"), window.location.origin).toString();
  }

  function getTitle(card) {
    const titleElement =
      card.querySelector("h2 span") ||
      card.querySelector("h2 a span") ||
      card.querySelector("[data-cy='title-recipe-title'] span") ||
      card.querySelector(".a-size-medium.a-color-base.a-text-normal") ||
      card.querySelector(".a-size-base-plus.a-color-base.a-text-normal");

    return cleanText(titleElement ? titleElement.textContent : "");
  }

  function getRating(card) {
    const ratingElement =
      card.querySelector("span.a-icon-alt") ||
      card.querySelector("[aria-label*='out of 5 stars']");

    const text = ratingElement
      ? ratingElement.getAttribute("aria-label") || ratingElement.textContent
      : "";

    return parseRating(text);
  }

  function getReviewCount(card) {
    const reviewElement =
      card.querySelector("a[href*='customerReviews'] span.a-size-base") ||
      card.querySelector("span[aria-label][class*='a-size-base']") ||
      card.querySelector("a[href*='customerReviews']");

    const text = reviewElement
      ? reviewElement.getAttribute("aria-label") || reviewElement.textContent
      : "";

    return parseReviewCount(text);
  }

  const cards = Array.from(
    document.querySelectorAll("div.s-result-item[data-asin]")
  );

  const productMap = new Map();

  cards.forEach(card => {
    const asin = getAsinFromElement(card);
    const title = getTitle(card);
    const rating = getRating(card);
    const reviewCount = getReviewCount(card);
    const productUrl = getProductUrl(card);

    if (!asin || !title) {
      return;
    }

    if (!rating || !reviewCount) {
      return;
    }

    if (!productMap.has(asin)) {
      productMap.set(asin, {
        asin,
        title,
        rating,
        reviewCount,
        productUrl
      });
    }
  });

  const products = Array.from(productMap.values());

  return {
    products,
    count: products.length,
    message: products.length
      ? `${products.length} products extracted from first page.`
      : "No valid products with rating and review count found on first page."
  };
}

function getTopProductsByRatingWeight(products, limit) {
  return products
    .map(product => {
      const rating = Number(product.rating || 0);
      const reviewCount = Number(product.reviewCount || 0);
      const ratingWeight = rating * Math.log10(reviewCount + 1);

      return {
        ...product,
        ratingWeight: Number(ratingWeight.toFixed(4))
      };
    })
    .sort((a, b) => {
      if (b.ratingWeight !== a.ratingWeight) {
        return b.ratingWeight - a.ratingWeight;
      }

      if (b.rating !== a.rating) {
        return b.rating - a.rating;
      }

      return b.reviewCount - a.reviewCount;
    })
    .slice(0, limit);
}

async function openProductsAndExtractBsr(products) {
  const results = [];

  for (const product of products) {
    let productTab = null;

    try {
      productTab = await createTab(product.productUrl);

      await waitForTabComplete(productTab.id);
      await wait(4500);

      const bsrResult = await extractBsrFromProductPage(productTab.id);

      results.push({
        ...product,
        productTabId: productTab.id,
        bsrRanks: bsrResult.ranks || [],
        bestBsr: bsrResult.bestBsr || null,
        bestBsrCategory: bsrResult.bestBsrCategory || "",
        bsrRawText: bsrResult.rawText || "",
        bsrMessage: bsrResult.message || ""
      });
    } catch (error) {
      results.push({
        ...product,
        productTabId: productTab ? productTab.id : null,
        bsrRanks: [],
        bestBsr: null,
        bestBsrCategory: "",
        bsrRawText: "",
        bsrMessage: `BSR check failed: ${error.message || error}`
      });
    } finally {
      if (productTab && productTab.id) {
        await closeTab(productTab.id);
      }
    }

    await wait(1000);
  }

  return results;
}

async function extractBsrFromProductPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: {
        tabId
      },
      func: extractBsrFromAmazonProductPage
    });

    if (!results || !results[0] || !results[0].result) {
      return {
        ranks: [],
        bestBsr: null,
        bestBsrCategory: "",
        rawText: "",
        message: "No BSR extraction result returned."
      };
    }

    return results[0].result;
  } catch (error) {
    return {
      ranks: [],
      bestBsr: null,
      bestBsrCategory: "",
      rawText: "",
      message: `BSR extraction failed: ${error.message || error}`
    };
  }
}

function extractBsrFromAmazonProductPage() {
  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseBsrNumber(value) {
    const match = String(value || "").match(/#\s*([\d,]+)/);

    if (!match) {
      return null;
    }

    return Number(match[1].replace(/,/g, ""));
  }

  function parseCategory(value) {
    const text = cleanText(value);

    const match = text.match(/#\s*[\d,]+\s+in\s+([^#(]+)/i);

    if (!match) {
      return "";
    }

    return cleanText(match[1]);
  }

  function extractRankFromValue(value) {
    const text = cleanText(value);

    const rank = parseBsrNumber(text);

    if (!rank) {
      return null;
    }

    const category = parseCategory(text);

    return {
      rank,
      category,
      rawText: text
    };
  }

  function extractFromProdDetailsTable() {
    const prodDetails = document.querySelector("#prodDetails");

    if (!prodDetails) {
      return [];
    }

    const rows = Array.from(prodDetails.querySelectorAll("tr"));
    const ranks = [];

    rows.forEach(row => {
      const th = row.querySelector("th");
      const td = row.querySelector("td");

      const thText = cleanText(th ? th.innerText || th.textContent : "");
      const tdText = cleanText(td ? td.innerText || td.textContent : "");

      if (!thText || !tdText) {
        return;
      }

      if (/best\s*sellers\s*rank/i.test(thText)) {
        const firstRank = extractRankFromValue(tdText);

        if (firstRank) {
          ranks.push(firstRank);
        }

        const allMatches = tdText.match(/#\s*[\d,]+\s+in\s+[^#]+/gi) || [];

        allMatches.forEach(matchText => {
          const rankItem = extractRankFromValue(matchText);

          if (rankItem) {
            ranks.push(rankItem);
          }
        });
      }
    });

    return ranks;
  }

  function extractFromKnownSelector() {
    const knownTd = document.querySelector(
      "#productDetails_expanderTables_depthRightSections > div > div > div > table > tbody > tr:nth-child(9) > td"
    );

    if (!knownTd) {
      return [];
    }

    const text = cleanText(knownTd.innerText || knownTd.textContent);
    const rankItem = extractRankFromValue(text);

    return rankItem ? [rankItem] : [];
  }

  function extractFromAnyTableRow() {
    const rows = Array.from(document.querySelectorAll("tr"));
    const ranks = [];

    rows.forEach(row => {
      const th = row.querySelector("th");
      const td = row.querySelector("td");

      const thText = cleanText(th ? th.innerText || th.textContent : "");
      const tdText = cleanText(td ? td.innerText || td.textContent : "");

      if (/best\s*sellers\s*rank/i.test(thText) && tdText) {
        const rankItem = extractRankFromValue(tdText);

        if (rankItem) {
          ranks.push(rankItem);
        }
      }
    });

    return ranks;
  }

  function extractFromBodyFallback() {
    const bodyText = cleanText(document.body.innerText || document.body.textContent || "");
    const ranks = [];

    const bsrIndex = bodyText.toLowerCase().indexOf("best sellers rank");

    if (bsrIndex === -1) {
      return ranks;
    }

    const nearbyText = bodyText.slice(bsrIndex, bsrIndex + 1200);

    const matches = nearbyText.match(/#\s*[\d,]+\s+in\s+[^#]+/gi) || [];

    matches.forEach(matchText => {
      const rankItem = extractRankFromValue(matchText);

      if (rankItem) {
        ranks.push(rankItem);
      }
    });

    return ranks;
  }

  const allRanks = [
    ...extractFromProdDetailsTable(),
    ...extractFromKnownSelector(),
    ...extractFromAnyTableRow(),
    ...extractFromBodyFallback()
  ];

  const rankMap = new Map();

  allRanks.forEach(item => {
    if (!item || !item.rank) {
      return;
    }

    const key = `${item.rank}-${String(item.category || "").toLowerCase()}`;

    if (!rankMap.has(key)) {
      rankMap.set(key, item);
    }
  });

  const ranks = Array.from(rankMap.values())
    .sort((a, b) => a.rank - b.rank);

  const bestRank = ranks[0] || null;

  return {
    ranks,
    bestBsr: bestRank ? bestRank.rank : null,
    bestBsrCategory: bestRank ? bestRank.category : "",
    rawText: bestRank ? bestRank.rawText : "",
    message: bestRank
      ? `Lowest BSR found: #${bestRank.rank} in ${bestRank.category}`
      : "No Best Sellers Rank found inside #prodDetails or product details table."
  };
}

function pickLowestBsrProduct(products) {
  const validProducts = products
    .filter(product => product.bestBsr && Number(product.bestBsr) > 0)
    .sort((a, b) => {
      if (a.bestBsr !== b.bestBsr) {
        return a.bestBsr - b.bestBsr;
      }

      if (b.ratingWeight !== a.ratingWeight) {
        return b.ratingWeight - a.ratingWeight;
      }

      return b.reviewCount - a.reviewCount;
    });

  return validProducts[0] || null;
}

function normalizeBrand(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}