(() => {
  const regions = {
    서울: [37.57, 126.98], 부산: [35.18, 129.08], 대구: [35.87, 128.60],
    인천: [37.46, 126.70], 광주: [35.16, 126.85], 대전: [36.35, 127.38],
    울산: [35.54, 129.31], 세종: [36.48, 127.29], 경기: [37.37, 127.15],
    강원: [37.74, 128.28], 충북: [36.83, 127.70], 충남: [36.51, 126.80],
    전북: [35.72, 127.14], 전남: [34.89, 126.92], 경북: [36.44, 128.74],
    경남: [35.31, 128.28], 제주: [33.39, 126.54],
  };
  const verificationOptions = {
    "exam-slip": "수능 수험표",
    identification: "신분증",
    "student-id": "학생증·청소년증",
    application: "수능 접수증·수시 합격증",
    online: "온라인 인증·쿠폰",
    other: "기타 증빙",
  };

  const registration = $("#register-dialog");
  const form = $("#register-form");
  const submit = $("#register-submit");
  const close = $("#register-close");
  const status = $("#registration-status");
  const notice = $("#board-notice");
  const regionSelect = $("#register-region");
  const address = $("#register-address");
  const findAddress = $("#find-address");
  const addressSearch = $("#address-search");
  const positionMap = $("#register-map");
  const positionHint = $("#location-hint");
  const pickPosition = $("#pick-location");
  const clearPosition = $("#clear-location");
  const boardUrl = publicSiteSettings.boardApiUrl;
  const baseUrl = URL.canParse(boardUrl) ? new URL(boardUrl) : null;
  const localBoard = baseUrl?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  const endpoint = baseUrl && !baseUrl.username && !baseUrl.password && (baseUrl.protocol === "https:" || localBoard)
    ? new URL("/deals", baseUrl) : null;
  let coordinates = null;
  let placeId = null;
  let addressLookup;
  let postcodePromise;
  let addressSearchRevision = 0;
  let locationMap;
  let locationMarker;
  let submitting = false;
  let mapAuthFailed = false;

  for (const region of Object.keys(regions)) regionSelect.add(new Option(region, region));
  function setChoices(selector, name, options) {
    $(selector).innerHTML = Object.entries(options).map(([key, label]) =>
      `<label><input type="checkbox" name="${name}" value="${escapeHtml(key)}"> ${escapeHtml(label)}</label>`).join("");
  }
  setChoices("#register-verification-methods", "verificationMethods", verificationOptions);
  setChoices("#register-categories", "categories", categories);

  async function request(options) {
    const response = await fetch(endpoint, { ...options, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "게시판에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    return data;
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = false;
  }

  if (endpoint) {
    request()
      .then(({ deals }) => addBoardDeals(deals))
      .catch(() => showNotice("외부에서 등록된 할인 정보를 불러오지 못했습니다."));
  }

  $("#register-button").addEventListener("click", () => {
    status.textContent = endpoint ? "" : "할인 등록 기능을 준비 중입니다.";
    submit.disabled = !endpoint;
    registration.showModal();
  });
  close.addEventListener("click", () => registration.close());
  registration.addEventListener("close", () => {
    closeAddressSearch();
    if (!coordinates && !placeId) addressLookup = null;
  });
  registration.addEventListener("cancel", (event) => {
    if (submitting) event.preventDefault();
  });
  form.addEventListener("invalid", (event) => {
    const extra = event.target.closest("details");
    if (extra) extra.open = true;
  }, true);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!endpoint || submitting) return;
    const formData = new FormData(form);
    const fields = Object.fromEntries(formData);
    const verificationMethods = formData.getAll("verificationMethods");
    const chosenCategories = formData.getAll("categories");
    if (!verificationMethods.length || !chosenCategories.length) {
      const missing = !verificationMethods.length ? "verificationMethods" : "categories";
      status.textContent = !verificationMethods.length ? "인증 방법을 하나 이상 선택해 주세요." : "카테고리를 하나 이상 선택해 주세요.";
      form.querySelector(`[name="${missing}"]`).focus();
      return;
    }
    submitting = submit.disabled = close.disabled = true;
    try {
      if (fields.address.trim() && !coordinates && !placeId) {
        status.textContent = "주소 위치를 확인하는 중입니다.";
        await locateAddress();
        if (fields.address.trim() !== address.value.trim() || (!coordinates && !placeId)) {
          throw new Error("주소 위치를 확인하지 못했습니다. 주소를 다시 검색하거나 지도에서 직접 선택해 주세요.");
        }
      }
      if (!regionSelect.value) {
        regionSelect.focus();
        throw new Error("지역을 선택해 주세요.");
      }
      status.textContent = "등록 중입니다.";
      const { deal } = await request({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fields, region: regionSelect.value, categories: chosenCategories, verificationMethods, coordinates, placeId,
        }),
      });
      addBoardDeals([deal], true);
      form.reset();
      form.querySelector("details").open = false;
      positionMap.hidden = true;
      resetPosition();
      registration.close();
      showNotice(isDealVisible(deal) ? "할인 정보를 등록했습니다." : "종료일이 지난 할인으로 저장했습니다.");
      $("#results").focus();
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === "TimeoutError"
        ? "게시판에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요."
        : error.message;
    } finally {
      submitting = submit.disabled = close.disabled = false;
    }
  });

  function resetPosition() {
    coordinates = null;
    placeId = null;
    addressLookup = null;
    if (locationMarker) locationMarker.map = null;
    clearPosition.hidden = true;
    positionHint.textContent = positionMap.hidden ? "주소를 선택하면 지도 핀이 자동으로 표시됩니다." : "지도에서 장소를 눌러 주세요.";
  }

  function regionFromAddress(value) {
    const province = value.trim().split(/\s+/)[0].replace(/(?:특별자치[시도]|특별시|광역시|도)$/, "");
    const key = province.replace(/^(충청|경상|전라)([남북])$/, (_, full, suffix) => full[0] + suffix);
    return Object.hasOwn(regions, key) ? key : "";
  }

  function closeAddressSearch() {
    addressSearchRevision++;
    addressSearch.replaceChildren();
    addressSearch.hidden = true;
    findAddress.setAttribute("aria-expanded", "false");
    findAddress.textContent = "주소 검색";
  }

  function loadPostcode() {
    postcodePromise ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error("Address search failed"));
      };
      const timeout = setTimeout(fail, 10000);
      script.src = "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      script.addEventListener("error", fail, { once: true });
      script.addEventListener("load", () => {
        clearTimeout(timeout);
        if (window.kakao?.Postcode) resolve(window.kakao.Postcode);
        else fail();
      }, { once: true });
      document.head.append(script);
    }).catch((error) => {
      postcodePromise = null;
      throw error;
    });
    return postcodePromise;
  }

  findAddress.addEventListener("click", async () => {
    if (!addressSearch.hidden) return closeAddressSearch();
    const revision = ++addressSearchRevision;
    addressSearch.hidden = false;
    addressSearch.textContent = "주소 검색을 불러오는 중입니다.";
    findAddress.setAttribute("aria-expanded", "true");
    findAddress.textContent = "검색 닫기";
    try {
      const Postcode = await loadPostcode();
      if (revision !== addressSearchRevision || !registration.open) return;
      addressSearch.replaceChildren();
      new Postcode({
        width: "100%", height: "360px",
        oncomplete(data) {
          if (revision !== addressSearchRevision || !registration.open) return;
          closeAddressSearch();
          address.value = data.roadAddress || data.address;
          const selectedRegion = regionFromAddress(data.sido || address.value);
          if (selectedRegion) regionSelect.value = selectedRegion;
          resetPosition();
          address.focus();
          void locateAddress();
        },
      }).embed(addressSearch, { q: address.value.trim() });
    } catch {
      if (revision !== addressSearchRevision) return;
      addressSearch.textContent = "주소 검색을 불러오지 못했습니다. 주소를 직접 입력해 주세요.";
    }
  });

  function openPositionMap(maps, center, zoom) {
    positionMap.hidden = false;
    if (locationMap) {
      locationMap.setOptions({ center, zoom });
      return;
    }
    locationMap = new maps.Map(positionMap, {
      center, zoom, mapId: googleMapsSettings.mapId,
      gestureHandling: "cooperative", mapTypeControl: false, streetViewControl: false,
    });
    locationMarker = new maps.marker.AdvancedMarkerElement();
    locationMap.addListener("click", ({ latLng }) => {
      if (!latLng) return;
      const latitude = latLng.lat();
      const longitude = latLng.lng();
      if (latitude < 32.8 || latitude > 39.5 || longitude < 124 || longitude > 132) {
        positionHint.textContent = "지도에서 국내 위치를 선택해 주세요.";
        return;
      }
      addressLookup = null;
      placeId = null;
      coordinates = [latitude, longitude];
      setPreviewMarker(latLng);
    });
  }

  function setPreviewMarker(position) {
    locationMarker.position = position;
    locationMarker.map = locationMap;
    clearPosition.hidden = false;
    positionHint.textContent = "선택한 위치에 핀이 표시됩니다.";
  }

  function locateAddress() {
    const value = address.value.trim();
    if (!value || coordinates || placeId || !googleMapsSettings.apiKey || !googleMapsSettings.mapId || mapAuthFailed) return;
    if (addressLookup?.value === value) return addressLookup.promise;
    const lookup = { value };
    addressLookup = lookup;
    positionHint.textContent = "주소의 위치를 확인하는 중입니다.";
    lookup.promise = (async () => {
      try {
        const maps = await loadGoogleMaps(googleMapsSettings.apiKey);
        const result = await geocodeGooglePlace(maps, { address: value, componentRestrictions: { country: "KR" } });
        if (addressLookup !== lookup || !registration.open || mapAuthFailed) return;
        if (!result?.place_id) throw new Error("Address not found");
        const province = result.address_components.find(({ types }) => types.includes("administrative_area_level_1"));
        const foundRegion = regionFromAddress(province?.short_name || value) || regionFromAddress(province?.long_name || value);
        if (foundRegion) regionSelect.value = foundRegion;
        openPositionMap(maps, result.geometry.location, 17);
        setPreviewMarker(result.geometry.location);
        placeId = result.place_id;
      } catch {
        if (addressLookup !== lookup) return;
        addressLookup = null;
        positionHint.textContent = "이 주소의 위치를 확인하지 못했습니다. 지도에서 직접 선택해 주세요.";
      }
    })();
    return lookup.promise;
  }

  address.addEventListener("input", resetPosition);
  address.addEventListener("change", () => {
    if (address.value.trim()) void locateAddress();
  });
  clearPosition.addEventListener("click", resetPosition);
  regionSelect.addEventListener("change", () => {
    resetPosition();
    const center = regions[regionSelect.value];
    if (center && locationMap) locationMap.setOptions({ center: { lat: center[0], lng: center[1] }, zoom: 11 });
  });
  $("#register-location").hidden = !endpoint || !googleMapsSettings.apiKey || !googleMapsSettings.mapId;
  resetPosition();
  window.addEventListener("hotdeal-map-auth-failed", () => {
    mapAuthFailed = true;
    positionMap.hidden = true;
    resetPosition();
    positionHint.textContent = "지도에 연결하지 못했습니다. 핀 없이 등록할 수 있습니다.";
  });

  pickPosition.addEventListener("click", async () => {
    if (mapAuthFailed) return;
    if (!regions[regionSelect.value]) {
      positionHint.textContent = "지도에서 위치를 선택하려면 먼저 지역을 선택해 주세요.";
      regionSelect.focus();
      return;
    }
    pickPosition.disabled = true;
    positionHint.textContent = "지도를 불러오는 중입니다.";
    try {
      const maps = await loadGoogleMaps(googleMapsSettings.apiKey);
      const center = regions[regionSelect.value];
      if (!center || !registration.open || mapAuthFailed) return;
      const [lat, lng] = center;
      const currentPin = coordinates || placeId ? locationMarker.position : null;
      openPositionMap(maps, currentPin || { lat, lng }, currentPin ? 17 : 11);
      positionHint.textContent = "지도에서 장소를 눌러 주세요.";
    } catch {
      positionMap.hidden = true;
      positionHint.textContent = "지도에 연결하지 못했습니다. 핀 없이 등록할 수 있습니다.";
    } finally {
      pickPosition.disabled = false;
    }
  });
})();
