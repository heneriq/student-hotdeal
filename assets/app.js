const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const dateParts = (date) => date.split("-").map(Number);
const shortDate = (date) => dateParts(date).slice(1).join(".");
const fullDate = (date) => dateParts(date).join(".");
const formatPeriod = (deal, full = false) => {
  const { starts, ends } = deal;
  const format = full || (starts && ends && starts.slice(0, 4) !== ends.slice(0, 4)) ? fullDate : shortDate;
  if (!starts) return ends ? `${format(ends)}까지` : "기간 미정";
  return ends ? `${format(starts)} ~ ${format(ends)}` : `${format(starts)}부터`;
};
const koreanDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
const todayInKorea = () => koreanDate.format(new Date());
const isDealVisible = (deal, today = todayInKorea()) => !deal.ends || deal.ends >= today;
const normalize = (value) => value.normalize("NFC").toLocaleLowerCase("ko").replace(/\s+/g, "");
const googleMapsLink = (deal) => {
  const url = new URL("https://www.google.com/maps/search/");
  const query = deal.coordinates && !deal.address ? deal.coordinates.join(",") : `${deal.name} ${deal.address || deal.region}`;
  url.search = new URLSearchParams({ api: "1", query });
  if (deal.placeId) url.searchParams.set("query_place_id", deal.placeId);
  return url.href;
};

const search = $("#search-input");
const region = $("#region-filter");
const categoryFilters = $("#category-filters");
const table = $("#deal-table");
const rows = $("#deal-rows");
const mapLayout = $("#map-layout");
const mapResults = $("#map-results");
const dialog = $("#dialog");
const dialogContent = $("#dialog-content");
const themeButton = $("#theme-button");
const moonIcon = $("#theme-moon");
const sunIcon = $("#theme-sun");
const preferredTheme = matchMedia("(prefers-color-scheme: dark)");
const viewButtons = [...document.querySelectorAll("[data-view]")];
const dealById = new Map(deals.map((deal) => [deal.id, deal]));
const publicSiteSettings = typeof siteConfig === "undefined" ? {} : siteConfig;
const googleMapsSettings = {
  apiKey: publicSiteSettings.googleMapsApiKey?.trim() ?? "",
  mapId: publicSiteSettings.googleMapsMapId?.trim() ?? "",
};
let view = "list";
let selectedCategory = "";
let map;
let opener;
let displayedDeal;
let renderedDate;
let midnightRefresh;

$("#season-label").textContent = campaign.season;

function currentTheme() {
  return document.documentElement.dataset.theme ?? (preferredTheme.matches ? "dark" : "light");
}

function updateThemeButton() {
  const dark = currentTheme() === "dark";
  const label = dark ? "라이트 모드로 전환" : "다크 모드로 전환";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
  moonIcon.toggleAttribute("hidden", dark);
  sunIcon.toggleAttribute("hidden", !dark);
  $("#theme-color").content = dark ? "#191a1c" : "#ffffff";
}

themeButton.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("student-hotdeal-theme", next);
  } catch {}
  updateThemeButton();
});
preferredTheme.addEventListener("change", updateThemeButton);
updateThemeButton();

function updateRegionOptions(today = todayInKorea()) {
  const selected = region.value;
  const regions = [...new Set(deals.filter((deal) => isDealVisible(deal, today)).map((deal) => deal.region))];
  region.options.length = 1;
  for (const name of regions.sort((a, b) => a.localeCompare(b, "ko"))) {
    region.add(new Option(name, name));
  }
  region.value = regions.includes(selected) ? selected : "";
}
categoryFilters.innerHTML = [["", "전체"], ...Object.entries(categories)].map(([key, label]) =>
  `<button class="pure-button" type="button" data-category="${escapeHtml(key)}" aria-pressed="${key === ""}">${escapeHtml(label)}</button>`
).join("");
const categoryButtons = categoryFilters.querySelectorAll("[data-category]");

function getMatchingDeals(today) {
  const tokens = search.value.trim().split(/\s+/).filter(Boolean).map(normalize);
  return deals.filter((deal) => {
    if (!isDealVisible(deal, today)) return false;
    if (selectedCategory && !dealCategories(deal).includes(selectedCategory)) return false;
    if (region.value && deal.region !== region.value) return false;
    const searchable = normalize([deal.name, deal.benefit, deal.region, deal.address, dealCategoryLabels(deal), deal.verification].join(" "));
    return tokens.every((token) => searchable.includes(token));
  });
}

const dealCategories = (deal) => deal.categories?.length ? deal.categories : [deal.category];
const dealCategoryLabels = (deal) => dealCategories(deal).map((key) => categories[key]).filter(Boolean).join(", ");
const hasMapPosition = (deal) => Boolean(deal.coordinates || deal.placeId);

function statusLabel(deal, today) {
  if (deal.starts && deal.starts > today) return "예정";
  return deal.starts ? "진행 중" : "";
}

function dealLocation(deal) {
  return [deal.region, deal.district].filter(Boolean).join(" ");
}

function dealRow(deal, today) {
  const status = statusLabel(deal, today);
  const registered = deal.createdAt ? ` · 등록 ${shortDate(koreanDate.format(new Date(deal.createdAt)))}` : "";
  return `<tr role="row">
    <td class="venue-cell" role="cell">
      <button class="text-button deal-name" type="button" data-deal-id="${escapeHtml(deal.id)}">${escapeHtml(deal.name)}</button>
      <small>${escapeHtml(dealLocation(deal))} · ${escapeHtml(dealCategoryLabels(deal))}${registered}</small>
    </td>
    <td class="benefit-cell" role="cell">${escapeHtml(deal.benefit)}</td>
    <td class="period-cell" role="cell">${formatPeriod(deal)}${status ? `<small>${status}</small>` : ""}</td>
    <td class="proof-cell" role="cell">${escapeHtml(deal.verification)}</td>
  </tr>`;
}

function mapResult(deal) {
  return `<li>
    <div>
      <button class="text-button deal-name" type="button" data-deal-id="${escapeHtml(deal.id)}">${escapeHtml(deal.name)}</button>
      <small>${escapeHtml(dealLocation(deal))} · ${escapeHtml(deal.benefit)}</small>
    </div>
    <a href="${escapeHtml(googleMapsLink(deal))}" target="_blank" rel="noopener" aria-label="${escapeHtml(deal.name)} Google 지도에서 검색">Google 지도 ↗</a>
  </li>`;
}

function renderResults(selectedDeal) {
  const today = todayInKorea();
  if (renderedDate !== today) {
    renderedDate = today;
    updateRegionOptions(today);
    if (dialog.open && displayedDeal && !isDealVisible(displayedDeal, today)) dialog.close();
  }
  const filteredDeals = getMatchingDeals(today).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  $("#result-count").textContent = `할인 혜택 ${filteredDeals.length}곳`;
  $("#empty-state").hidden = filteredDeals.length > 0;
  table.hidden = view !== "list" || !filteredDeals.length;
  mapLayout.hidden = view !== "map" || !filteredDeals.length;

  for (const button of viewButtons) button.setAttribute("aria-pressed", button.dataset.view === view);
  for (const button of categoryButtons) button.setAttribute("aria-pressed", button.dataset.category === selectedCategory);

  if (!table.hidden) rows.innerHTML = filteredDeals.map((deal) => dealRow(deal, today)).join("");
  if (!mapLayout.hidden) {
    mapResults.innerHTML = filteredDeals.map(mapResult).join("");
    mapResults.scrollTop = 0;
    map ??= new DealMap($("#deal-map"), googleMapsSettings, (deal) => {
      const row = [...mapResults.querySelectorAll("[data-deal-id]")].find((button) => button.dataset.dealId === deal.id);
      showDeal(deal, row);
    });
    const mapDeals = filteredDeals.filter(hasMapPosition);
    map.show(mapDeals, mapDeals.includes(selectedDeal) ? selectedDeal : undefined);
  }
}

function addBoardDeals(posts, showNewPost = false) {
  let changed = false;
  for (const post of posts) {
    if (dealById.has(post.id)) continue;
    deals.push(post);
    dealById.set(post.id, post);
    changed = true;
  }
  if (!changed && !showNewPost) return;
  if (showNewPost) {
    search.value = "";
    region.value = "";
    selectedCategory = "";
    view = "list";
  }
  updateRegionOptions();
  renderResults();
}

function showDialog(content, trigger, deal) {
  dialogContent.innerHTML = content;
  opener = trigger;
  displayedDeal = deal;
  dialog.showModal();
}

function showDeal(deal, trigger) {
  const today = todayInKorea();
  if (!isDealVisible(deal, today)) {
    renderResults();
    return;
  }
  const status = statusLabel(deal, today);
  const source = URL.canParse(deal.source) ? new URL(deal.source) : null;
  const sourceLink = source && ["http:", "https:"].includes(source.protocol)
    ? `<a class="pure-button" href="${escapeHtml(source.href)}" target="_blank" rel="noopener noreferrer ugc nofollow">${escapeHtml(deal.sourceName || source.hostname)} ↗</a>`
    : "";
  showDialog(`
    <h2 id="dialog-title">${escapeHtml(deal.name)}</h2>
    <p class="dialog-benefit">${escapeHtml(deal.benefit)}</p>
    <dl class="detail-list">
      <div><dt>할인 기간</dt><dd>${formatPeriod(deal, true)}${status ? ` · ${status}` : ""}</dd></div>
      <div><dt>장소</dt><dd>${escapeHtml(deal.address || dealLocation(deal))}</dd></div>
      <div><dt>인증 방법</dt><dd>${escapeHtml(deal.verification)}</dd></div>
    </dl>
    ${deal.details ? `<p class="deal-details">${escapeHtml(deal.details)}</p>` : ""}
    <div class="dialog-actions">
      ${sourceLink}
      <a class="pure-button" href="${escapeHtml(googleMapsLink(deal))}" target="_blank" rel="noopener">Google 지도 ↗</a>
      ${hasMapPosition(deal) && googleMapsSettings.apiKey && googleMapsSettings.mapId && view === "list" ? '<button class="pure-button" id="show-deal-map" type="button">지도에서 보기</button>' : ""}
    </div>
  `, trigger, deal);
  $("#show-deal-map")?.addEventListener("click", () => {
    dialog.close();
    opener = null;
    view = "map";
    renderResults(deal);
    viewButtons.find((button) => button.dataset.view === view)?.focus();
  });
}

$("#guide-button").addEventListener("click", (event) => {
  showDialog(`
    <h2 id="dialog-title">수험생 인증 안내</h2>
    <dl class="detail-list">
      <div><dt>현장 확인</dt><dd>수능 수험표 원본을 준비하세요. 신분증을 함께 요구하는 곳도 있습니다.</dd></div>
      <div><dt>대체 서류</dt><dd>일부 행사는 수시 합격증, 수능 원서 접수증 또는 학생증을 인정합니다.</dd></div>
      <div><dt>사전 예약</dt><dd>온라인 쿠폰이나 사전 예약이 필요한 혜택은 방문 전에 신청하세요.</dd></div>
    </dl>
  `, event.currentTarget);
});

dialog.addEventListener("close", () => {
  displayedDeal = null;
  opener?.focus();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

for (const container of [rows, mapResults]) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-deal-id]");
    if (button) showDeal(dealById.get(button.dataset.dealId), button);
  });
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    if (view === button.dataset.view) return;
    view = button.dataset.view;
    renderResults();
  });
}
search.addEventListener("input", () => renderResults());
region.addEventListener("change", () => renderResults());
for (const button of categoryButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.category === selectedCategory) return;
    selectedCategory = button.dataset.category;
    renderResults();
  });
}
$("#reset-filters").addEventListener("click", () => {
  search.value = "";
  region.value = "";
  selectedCategory = "";
  renderResults();
  search.focus();
});
renderResults();

function scheduleMidnightRefresh() {
  clearTimeout(midnightRefresh);
  const nextMidnight = Date.parse(`${todayInKorea()}T00:00:00+09:00`) + 24 * 60 * 60 * 1000;
  midnightRefresh = setTimeout(() => {
    renderResults();
    scheduleMidnightRefresh();
  }, Math.max(1000, nextMidnight - Date.now()));
}

scheduleMidnightRefresh();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && renderedDate !== todayInKorea()) {
    renderResults();
    scheduleMidnightRefresh();
  }
});
