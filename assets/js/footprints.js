(() => {
  const WORLD_DATA_URL = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_0_countries.geojson";
  const CHINA_DATA_URL = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json";

  const visitedCountries = [
    "BE",
    "BT",
    "CN",
    "DE",
    "FR",
    "IT",
    "JP",
    "KR",
    "NP",
    "VA",
    "VN"
  ];

  const visitedChinaProvinces = [
    "上海市",
    "云南省",
    "北京市",
    "吉林省",
    "四川省",
    "天津市",
    "安徽省",
    "山东省",
    "山西省",
    "广东省",
    "广西壮族自治区",
    "江苏省",
    "江西省",
    "河北省",
    "河南省",
    "浙江省",
    "海南省",
    "湖北省",
    "湖南省",
    "澳门特别行政区",
    "甘肃省",
    "西藏自治区",
    "贵州省",
    "辽宁省",
    "重庆市",
    "陕西省",
    "青海省",
    "香港特别行政区",
    "黑龙江省"
  ];

  const countryEnglishOverrides = {
    CN: "China",
    KP: "North Korea",
    KR: "South Korea",
    US: "United States",
    VA: "Vatican City"
  };

  const franceMainlandBounds = {
    minLon: -6.5,
    maxLon: 10.5,
    minLat: 41,
    maxLat: 52.5
  };

  const svg = document.querySelector("[data-footprint-map]");
  if (!svg) {
    return;
  }

  const mapShell = svg.closest(".footprint-map-shell");
  const graticuleLayer = svg.querySelector(".footprint-graticule-layer");
  const worldLayer = svg.querySelector(".footprint-world-layer");
  const chinaLayer = svg.querySelector(".footprint-china-layer");
  const tooltip = document.querySelector("[data-map-tooltip]");
  const controls = document.querySelectorAll("[data-map-control]");
  const view = { width: 1000, height: 520 };
  const mapExtent = [[0, 12], [view.width, view.height - 12]];
  const repeatOffsets = [-view.width, 0, view.width];
  const visitedCountrySet = new Set(visitedCountries.map(normalizeRegionName));
  const visitedProvinceSet = new Set(visitedChinaProvinces.map(normalizeRegionName));
  const regionNamesZh = createChineseRegionNames();
  const state = {
    scale: 1,
    x: 0,
    y: 0,
    minScale: 1,
    maxScale: 180
  };

  let projection = null;
  let pathGenerator = null;
  let dragStart = null;

  function createChineseRegionNames() {
    try {
      return new Intl.DisplayNames(["zh-CN"], { type: "region" });
    } catch {
      return null;
    }
  }

  function normalizeRegionName(name) {
    return String(name).trim().toLowerCase();
  }

  function round(value) {
    return Math.round(value * 1000) / 1000;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeHorizontalPan() {
    const period = view.width * state.scale;

    if (!Number.isFinite(period) || period <= 0) {
      state.x = 0;
      return;
    }

    state.x = ((state.x % period) + period) % period;

    if (state.x > 0) {
      state.x -= period;
    }
  }

  function clampPan() {
    normalizeHorizontalPan();

    if (state.scale <= 1) {
      state.y = 0;
      return;
    }

    state.y = clamp(state.y, view.height - view.height * state.scale, 0);
  }

  function getFeatureName(feature) {
    const properties = feature.properties || {};
    return properties.name || properties.NAME || properties.NAME_EN || properties.ADMIN || properties.fullname || "Unknown";
  }

  function getCountryCode(feature) {
    const properties = feature.properties || {};
    const fields = ["ISO_A2_EH", "ISO_A2", "WB_A2"];

    for (const field of fields) {
      const code = String(properties[field] || "").trim().toUpperCase();

      if (/^[A-Z]{2}$/.test(code)) {
        return code;
      }
    }

    return "";
  }

  function getCountryEnglishName(feature) {
    const properties = feature.properties || {};
    const code = getCountryCode(feature);
    return countryEnglishOverrides[code] || properties.NAME_EN || properties.NAME_LONG || properties.ADMIN || properties.NAME || getFeatureName(feature);
  }

  function getChineseCountryName(code) {
    if (!regionNamesZh || !/^[A-Z]{2}$/.test(code)) {
      return "";
    }

    try {
      return regionNamesZh.of(code) || "";
    } catch {
      return "";
    }
  }

  function getCountryLabel(feature) {
    const code = getCountryCode(feature);
    const englishName = getCountryEnglishName(feature);
    const chineseName = getChineseCountryName(code);

    if (chineseName && chineseName !== englishName) {
      return `${chineseName} ${englishName}`;
    }

    return englishName;
  }

  function isCountryVisited(feature) {
    const properties = feature.properties || {};
    const keys = [
      getCountryCode(feature),
      properties.ISO_A3,
      properties.ADM0_A3,
      properties.ADM0_A3_US,
      properties.SU_A3,
      getCountryEnglishName(feature),
      getFeatureName(feature)
    ];

    return keys.some((key) => key && visitedCountrySet.has(normalizeRegionName(key)));
  }

  function isAntarctica(feature) {
    return normalizeRegionName(getCountryEnglishName(feature)) === "antarctica";
  }

  function ringCenter(ring) {
    let lon = 0;
    let lat = 0;
    let count = 0;

    for (const coordinate of ring) {
      lon += Number(coordinate[0]);
      lat += Number(coordinate[1]);
      count += 1;
    }

    return count ? [lon / count, lat / count] : [0, 0];
  }

  function coordinateInBounds(coordinate, bounds) {
    const lon = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    return lon >= bounds.minLon && lon <= bounds.maxLon && lat >= bounds.minLat && lat <= bounds.maxLat;
  }

  function filterGeometryByBounds(geometry, bounds) {
    if (!geometry) {
      return null;
    }

    if (geometry.type === "Polygon") {
      return coordinateInBounds(ringCenter(geometry.coordinates[0] || []), bounds) ? geometry : null;
    }

    if (geometry.type === "MultiPolygon") {
      const coordinates = geometry.coordinates.filter((polygon) => coordinateInBounds(ringCenter(polygon[0] || []), bounds));
      return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
    }

    return geometry;
  }

  function reverseLinearRing(ring) {
    return [...ring].reverse();
  }

  function rewindGeometry(geometry) {
    if (!geometry) {
      return null;
    }

    if (geometry.type === "Polygon") {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map(reverseLinearRing)
      };
    }

    if (geometry.type === "MultiPolygon") {
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map(reverseLinearRing))
      };
    }

    return geometry;
  }

  function prepareWorldFeature(feature) {
    if (getCountryCode(feature) !== "FR") {
      return feature;
    }

    const geometry = filterGeometryByBounds(feature.geometry, franceMainlandBounds);

    if (!geometry) {
      return null;
    }

    return {
      ...feature,
      geometry
    };
  }

  function prepareChinaFeature(feature) {
    return {
      ...feature,
      geometry: rewindGeometry(feature.geometry)
    };
  }

  function getWorldLayerRank(feature) {
    return getCountryCode(feature) === "VA" ? 1 : 0;
  }

  function getChinaLayerRank(feature) {
    const name = normalizeRegionName(getFeatureName(feature));

    if (name === normalizeRegionName("香港特别行政区")) {
      return 1;
    }

    if (name === normalizeRegionName("澳门特别行政区")) {
      return 2;
    }

    return 0;
  }

  function createRepeatGroup(offset) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");

    if (offset) {
      group.setAttribute("transform", `translate(${offset} 0)`);
    }

    return group;
  }

  function createPathElement(feature, layer, className, settings) {
    const name = getFeatureName(feature);
    const countryCode = getCountryCode(feature);
    const label = settings.getLabel ? settings.getLabel(feature, name) : name;
    const isVisited = settings.isVisited ? settings.isVisited(feature, name) : false;

    if (!label || normalizeRegionName(label) === "unknown") {
      return;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathGenerator(feature) || "");
    path.setAttribute("aria-label", label);
    path.dataset.region = name;
    path.dataset.label = label;
    path.dataset.code = countryCode;
    path.classList.add("footprint-region", className);

    if (isVisited) {
      path.classList.add("is-visited");
    }

    if (countryCode === "CN") {
      path.classList.add("is-china-country");
    }

    if (countryCode === "VA") {
      path.classList.add("is-microstate");
    }

    if (settings.isClone) {
      path.setAttribute("aria-hidden", "true");
      path.setAttribute("tabindex", "-1");
    } else {
      path.setAttribute("role", "img");
      path.setAttribute("tabindex", "0");
    }

    path.addEventListener("mouseenter", (event) => showTooltip(path, event));
    path.addEventListener("mousemove", (event) => positionTooltip(event));
    path.addEventListener("mouseleave", hideTooltip);
    path.addEventListener("focus", () => showTooltip(path));
    path.addEventListener("blur", hideTooltip);
    layer.append(path);
  }

  function renderFeatures(collection, layer, className, options) {
    const settings = options || {};
    const fragment = document.createDocumentFragment();
    const groups = repeatOffsets.map(createRepeatGroup);
    const features = settings.sortFeatures
      ? [...(collection.features || [])].sort(settings.sortFeatures)
      : (collection.features || []);

    for (const feature of features) {
      if (settings.shouldSkip && settings.shouldSkip(feature)) {
        continue;
      }

      const preparedFeature = settings.prepareFeature ? settings.prepareFeature(feature) : feature;

      if (!preparedFeature || !preparedFeature.geometry) {
        continue;
      }

      groups.forEach((group, index) => {
        createPathElement(preparedFeature, group, className, {
          ...settings,
          isClone: repeatOffsets[index] !== 0
        });
      });
    }

    fragment.append(...groups);
    layer.replaceChildren(fragment);
  }

  function createGraticuleGeometry() {
    const coordinates = [];

    for (let longitude = -175; longitude <= 175; longitude += 5) {
      coordinates.push([[longitude, -85], [longitude, 85]]);
    }

    for (let latitude = -80; latitude <= 80; latitude += 5) {
      const parallel = [];

      for (let longitude = -180; longitude <= 180; longitude += 5) {
        parallel.push([longitude, latitude]);
      }

      coordinates.push(parallel);
    }

    return {
      type: "MultiLineString",
      coordinates
    };
  }

  function renderGraticule() {
    const fragment = document.createDocumentFragment();
    const graticule = createGraticuleGeometry();

    for (const offset of repeatOffsets) {
      const group = createRepeatGroup(offset);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathGenerator(graticule));
      path.setAttribute("aria-hidden", "true");
      path.classList.add("footprint-graticule");
      group.append(path);
      fragment.append(group);
    }

    graticuleLayer.replaceChildren(fragment);
  }

  function showTooltip(path, event) {
    if (!tooltip) {
      return;
    }

    const label = path.dataset.label || path.dataset.region;

    if (!label || normalizeRegionName(label) === "unknown") {
      hideTooltip();
      return;
    }

    tooltip.textContent = label;
    tooltip.hidden = false;

    if (event) {
      positionTooltip(event);
    } else {
      const rect = path.getBoundingClientRect();
      positionTooltip({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
    }
  }

  function positionTooltip(event) {
    if (!tooltip || tooltip.hidden || !mapShell) {
      return;
    }

    const rect = mapShell.getBoundingClientRect();
    const left = Math.min(rect.width - 12, Math.max(12, event.clientX - rect.left + 12));
    const top = Math.min(rect.height - 12, Math.max(12, event.clientY - rect.top + 12));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  function applyTransform() {
    clampPan();
    const value = `translate(${round(state.x)} ${round(state.y)}) scale(${round(state.scale)})`;
    graticuleLayer.setAttribute("transform", value);
    worldLayer.setAttribute("transform", value);
    chinaLayer.setAttribute("transform", value);
    svg.classList.toggle("is-china-detail", state.scale >= 3.2);
    svg.classList.toggle("is-detail-zoom", state.scale >= 10);
  }

  function getSvgPoint(event) {
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * view.width,
      y: ((event.clientY - rect.top) / rect.height) * view.height
    };
  }

  function zoomAt(point, nextScale) {
    const previousScale = state.scale;
    state.scale = clamp(nextScale, state.minScale, state.maxScale);

    if (state.scale === previousScale) {
      return;
    }

    const ratio = state.scale / previousScale;
    state.x = point.x - (point.x - state.x) * ratio;
    state.y = point.y - (point.y - state.y) * ratio;
    applyTransform();
  }

  function panByWheel(event) {
    const rect = svg.getBoundingClientRect();
    state.x -= (event.deltaX / rect.width) * view.width;
    applyTransform();
  }

  function resetMap() {
    state.scale = 1;
    state.x = 0;
    state.y = 0;
    applyTransform();
  }

  function initializeProjection() {
    projection = d3.geoEquirectangular()
      .precision(0.06)
      .fitExtent(mapExtent, { type: "Sphere" });
    pathGenerator = d3.geoPath(projection);
  }

  async function fetchJson(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}`);
    }

    return response.json();
  }

  async function loadMap() {
    try {
      if (!window.d3) {
        throw new Error("D3 is unavailable");
      }

      initializeProjection();
      const [worldData, chinaData] = await Promise.all([
        fetchJson(WORLD_DATA_URL),
        fetchJson(CHINA_DATA_URL)
      ]);

      renderGraticule();
      renderFeatures(worldData, worldLayer, "footprint-country", {
        getLabel: getCountryLabel,
        isVisited: isCountryVisited,
        prepareFeature: prepareWorldFeature,
        sortFeatures: (a, b) => getWorldLayerRank(a) - getWorldLayerRank(b),
        shouldSkip: isAntarctica
      });
      renderFeatures(chinaData, chinaLayer, "footprint-province", {
        getLabel: (_, name) => name,
        isVisited: (_, name) => visitedProvinceSet.has(normalizeRegionName(name)),
        prepareFeature: prepareChinaFeature,
        sortFeatures: (a, b) => getChinaLayerRank(a) - getChinaLayerRank(b),
        shouldSkip: (_, name) => normalizeRegionName(name) === "unknown"
      });
      applyTransform();
    } catch {
      svg.setAttribute("aria-label", "Map data unavailable");
    }
  }

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      panByWheel(event);
      return;
    }

    const point = getSvgPoint(event);
    const factor = Math.exp(-event.deltaY * 0.0016);
    zoomAt(point, state.scale * factor);
  }, { passive: false });

  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    dragStart = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: state.x,
      y: state.y
    };
    svg.classList.add("is-dragging");
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!dragStart) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    state.x = dragStart.x + ((event.clientX - dragStart.clientX) / rect.width) * view.width;
    state.y = dragStart.y + ((event.clientY - dragStart.clientY) / rect.height) * view.height;
    applyTransform();
  });

  function endDrag(event) {
    dragStart = null;
    svg.classList.remove("is-dragging");

    if (event && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  }

  for (const control of controls) {
    control.addEventListener("click", () => {
      const center = { x: view.width / 2, y: view.height / 2 };
      const action = control.dataset.mapControl;

      if (action === "zoom-in") {
        zoomAt(center, state.scale * 1.5);
      } else if (action === "zoom-out") {
        zoomAt(center, state.scale / 1.5);
      } else if (action === "reset") {
        resetMap();
      }
    });
  }

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("mouseleave", hideTooltip);

  loadMap();
})();
