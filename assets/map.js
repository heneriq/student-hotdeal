let googleMapsPromise;
let googleMapsAuthError;
let geocoderPromise;

function loadGoogleMaps(apiKey) {
  if (googleMapsAuthError) return Promise.reject(new Error(googleMapsAuthError));
  googleMapsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (message) => {
      clearTimeout(timeout);
      reject(new Error(message));
    };
    const unavailable = () => fail("Google 지도를 불러오지 못했습니다.");
    const timeout = setTimeout(unavailable, 12000);
    window.gm_authFailure = () => {
      googleMapsAuthError = "Google 지도 인증에 실패했습니다.";
      fail(googleMapsAuthError);
      window.dispatchEvent(new Event("hotdeal-map-auth-failed"));
    };
    window.studentHotdealMapReady = () => {
      clearTimeout(timeout);
      const maps = window.google?.maps;
      if (maps?.Map && maps.marker?.AdvancedMarkerElement) resolve(maps);
      else unavailable();
    };
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.search = new URLSearchParams({
      key: apiKey,
      callback: "studentHotdealMapReady",
      loading: "async",
      libraries: "marker",
      language: "ko",
      region: "KR",
    });
    script.src = url.href;
    script.async = true;
    script.addEventListener("error", unavailable, { once: true });
    document.head.append(script);
  });
  return googleMapsPromise;
}

async function geocodeGooglePlace(maps, request) {
  geocoderPromise ??= maps.importLibrary("geocoding").then(({ Geocoder }) => new Geocoder());
  const geocoder = await geocoderPromise;
  let timeout;
  try {
    const { results } = await Promise.race([
      geocoder.geocode(request),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Geocoding timed out")), 9000); }),
    ]);
    return results.find((result) => {
      if (result.partial_match) return false;
      const point = result.geometry.location;
      const lat = point.lat();
      const lng = point.lng();
      if (lat < 32.8 || lat > 39.5 || lng < 124 || lng > 132) return false;
      return ["ROOFTOP", "RANGE_INTERPOLATED"].includes(result.geometry.location_type) ||
        result.types.some((type) => ["street_address", "premise", "subpremise", "establishment", "point_of_interest"].includes(type));
    }) ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

class DealMap {
  constructor(element, { apiKey, mapId }, onSelect) {
    this.element = element;
    this.apiKey = apiKey;
    this.mapId = mapId;
    this.onSelect = onSelect;
    this.layout = element.parentElement;
    this.status = this.layout.querySelector("#map-status");
    this.markers = [];
    this.revision = 0;
    this.lookup = new Map();
  }

  show(deals, selected) {
    this.revision++;
    this.deals = deals;
    this.selected = selected;
    if (!deals.length) {
      this.setStatus("이 조건으로 등록된 지도 핀이 없습니다. 장소별 링크에서 위치를 확인할 수 있습니다.");
    } else if (this.failure) {
      this.setStatus(this.failure);
    } else if (this.sdk) {
      this.setStatus("");
      this.render();
    } else if (!this.requested) {
      this.load();
    } else {
      this.setStatus("Google 지도를 불러오는 중입니다.");
    }
  }

  setStatus(message) {
    const ready = !message;
    this.status.textContent = message;
    this.status.hidden = ready;
    this.element.hidden = !ready;
    this.layout.classList.toggle("map-ready", ready);
  }

  async load() {
    this.requested = true;
    if (!this.apiKey || !this.mapId) {
      this.failure = "사이트 지도를 준비 중입니다. 각 장소의 Google 지도 링크를 이용할 수 있습니다.";
      this.show(this.deals, this.selected);
      return;
    }

    this.setStatus("Google 지도를 불러오는 중입니다.");
    window.addEventListener("hotdeal-map-auth-failed", () => {
      this.failure = "Google 지도 인증에 실패했습니다. 장소별 링크를 이용해 주세요.";
      this.show(this.deals, this.selected);
    }, { once: true });
    try {
      this.sdk = await loadGoogleMaps(this.apiKey);
      this.show(this.deals, this.selected);
    } catch (error) {
      this.failure = `${error.message} 장소별 링크를 이용해 주세요.`;
      this.show(this.deals, this.selected);
    }
  }

  render() {
    if (!this.element.clientWidth) return;
    const maps = this.sdk;
    this.map ??= new maps.Map(this.element, {
      center: { lat: 36.3, lng: 127.9 },
      zoom: 7,
      mapId: this.mapId,
      zoomControl: true,
      gestureHandling: "cooperative",
      mapTypeControl: false,
      streetViewControl: false,
    });

    const deals = this.deals;
    const positions = deals.map((deal) => deal.coordinates ? { lat: deal.coordinates[0], lng: deal.coordinates[1] } : null);
    this.drawMarkers(deals, positions);
    if (deals.some((deal) => !deal.coordinates && deal.placeId)) {
      void this.drawResolvedPlaces(deals, positions, this.revision);
    }
  }

  async drawResolvedPlaces(deals, positions, revision) {
    const pending = deals.map((deal, index) => ({ deal, index })).filter(({ deal }) => !deal.coordinates && deal.placeId);
    for (let offset = 0; offset < pending.length; offset += 6) {
      if (revision !== this.revision || !this.element.clientWidth) return;
      await Promise.all(pending.slice(offset, offset + 6).map(async ({ deal, index }) => {
        if (!this.lookup.has(deal.placeId)) {
          const request = geocodeGooglePlace(this.sdk, { placeId: deal.placeId })
            .then((result) => result?.geometry.location.toJSON() ?? null)
            .catch(() => null);
          this.lookup.set(deal.placeId, request);
        }
        positions[index] = await this.lookup.get(deal.placeId);
        if (!positions[index]) this.lookup.delete(deal.placeId);
      }));
    }
    if (revision !== this.revision || !this.element.clientWidth) return;
    if (positions.some(Boolean)) this.drawMarkers(deals, positions);
    else this.setStatus("등록된 주소의 위치를 불러오지 못했습니다. 장소별 링크에서 위치를 확인할 수 있습니다.");
  }

  drawMarkers(deals, positions) {
    for (const { marker, listener } of this.markers) {
      marker.removeEventListener("gmp-click", listener);
      marker.map = null;
    }
    this.markers = deals.flatMap((deal, index) => {
      if (!positions[index]) return [];
      const marker = new this.sdk.marker.AdvancedMarkerElement({
        map: this.map,
        position: positions[index],
        title: deal.name,
        gmpClickable: true,
        zIndex: deal.id === this.selected?.id ? 10 : 1,
      });
      const listener = () => this.onSelect(deal);
      marker.addEventListener("gmp-click", listener);
      return [{ marker, listener }];
    });

    const selectedIndex = this.selected ? deals.findIndex((deal, index) => deal.id === this.selected.id && positions[index]) : -1;
    const visible = positions.filter(Boolean);
    if (selectedIndex >= 0 || visible.length === 1) {
      this.map.setOptions({ center: selectedIndex >= 0 ? positions[selectedIndex] : visible[0], zoom: 16 });
    } else if (visible.length > 1) {
      const bounds = new this.sdk.LatLngBounds();
      for (const position of visible) bounds.extend(position);
      this.map.fitBounds(bounds, 40);
    }
  }
}
