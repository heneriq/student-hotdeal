const regions = new Set([
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
  "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
]);
const categories = new Set(["park", "cinema", "culture", "food", "other"]);
const verificationLabels = new Map([
  ["exam-slip", "수능 수험표"],
  ["identification", "신분증"],
  ["student-id", "학생증·청소년증"],
  ["application", "수능 접수증·수시 합격증"],
  ["online", "온라인 인증·쿠폰"],
  ["other", "기타 증빙 (출처 확인)"],
]);
const formatVerification = (methods) => methods.map((method) => verificationLabels.get(method)).filter(Boolean).join(", ");
const fields = "id, name, region, category, benefit, verification, address, ends, source, latitude, longitude, created_at, categories, verification_methods, place_id";

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json" || !request.body) {
    throw new RequestError(415, "등록 정보를 읽을 수 없습니다.");
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 8192) {
      await reader.cancel();
      throw new RequestError(413, "등록 내용이 너무 깁니다.");
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    const data = JSON.parse(text + decoder.decode());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new RequestError(400, "등록 정보를 읽을 수 없습니다.");
  }
}

function validate(data) {
  const field = (key, label, length, required = false) => {
    const raw = data[key] ?? "";
    if (typeof raw !== "string" || raw.length > length) {
      throw new RequestError(400, `${label}은(는) ${length}자 이내로 입력해 주세요.`);
    }
    const value = raw.trim().replace(/\s+/g, " ");
    if (required && !value) throw new RequestError(400, `${label}을(를) 입력해 주세요.`);
    return value || null;
  };
  const name = field("name", "장소명", 80, true);
  const region = field("region", "지역", 8, true);
  const selection = (key, options, label) => {
    const values = data[key];
    if (!Array.isArray(values) || !values.length || values.length > options.size || !values.every((value) => options.has(value))) {
      throw new RequestError(400, `${label}을(를) 하나 이상 선택해 주세요.`);
    }
    return [...options.keys()].filter((value) => values.includes(value));
  };
  const chosenCategories = selection("categories", categories, "카테고리");
  const methods = selection("verificationMethods", verificationLabels, "수험생 인증 방법");
  const verification = formatVerification(methods);
  const benefit = field("benefit", "할인 혜택", 160, true);
  const address = field("address", "주소", 180);
  const ends = field("ends", "종료일", 10);
  let source = field("source", "출처 링크", 800, true);
  const placeId = field("placeId", "장소 ID", 512);
  if (!regions.has(region)) throw new RequestError(400, "지역을 다시 선택해 주세요.");
  if (placeId && (!address || data.coordinates != null || !/^[A-Za-z0-9_-]+$/.test(placeId))) {
    throw new RequestError(400, "주소를 다시 검색하거나 지도에서 위치를 선택해 주세요.");
  }
  if (address && !placeId && data.coordinates == null) {
    throw new RequestError(400, "주소의 위치를 확인하거나 지도에서 직접 선택해 주세요.");
  }
  if (ends) {
    const date = new Date(ends);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ends) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== ends) {
      throw new RequestError(400, "종료일을 확인해 주세요.");
    }
  }
  try {
    const url = new URL(source);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    source = url.href;
  } catch {
    throw new RequestError(400, "출처에는 http 또는 https 링크를 입력해 주세요.");
  }
  let latitude = null;
  let longitude = null;
  if (data.coordinates != null) {
    if (!Array.isArray(data.coordinates) || data.coordinates.length !== 2 ||
        !data.coordinates.every(Number.isFinite) ||
        data.coordinates[0] < 32.8 || data.coordinates[0] > 39.5 ||
        data.coordinates[1] < 124 || data.coordinates[1] > 132) {
      throw new RequestError(400, "지도에서 국내 위치를 선택해 주세요.");
    }
    [latitude, longitude] = data.coordinates.map((value) => Math.round(value * 1000000) / 1000000);
  }
  return [
    name, region, chosenCategories[0], benefit, verification, address, ends, source, latitude, longitude,
    JSON.stringify(chosenCategories), JSON.stringify(methods), placeId,
  ];
}

function publicDeal(row) {
  const methods = row.verification_methods ? JSON.parse(row.verification_methods) : [];
  const verification = formatVerification(methods) || row.verification;
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    category: row.category,
    categories: row.categories ? JSON.parse(row.categories) : [row.category],
    benefit: row.benefit,
    verification,
    proof: verification,
    verificationMethods: methods,
    address: row.address,
    ends: row.ends,
    source: row.source,
    coordinates: row.latitude == null ? null : [row.latitude, row.longitude],
    placeId: row.place_id,
    createdAt: row.created_at,
  };
}

async function addDeal(request, env) {
  const { success } = await env.POST_LIMIT.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" });
  if (!success) throw new RequestError(429, "등록 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
  const data = await readJson(request);
  const values = validate(data);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(values)));
  const id = "post-" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const inserted = await env.DB.prepare(`
    INSERT INTO deals (id, name, region, category, benefit, verification, address, ends, source, latitude, longitude,
      categories, verification_methods, place_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING ${fields}
  `).bind(id, ...values).first();
  if (inserted) return { deal: publicDeal(inserted), status: 201 };
  const existing = await env.DB.prepare(`SELECT ${fields} FROM deals WHERE id = ? AND hidden = 0`).bind(id).first();
  if (!existing) throw new RequestError(409, "이 할인 정보는 이미 등록된 적이 있습니다.");
  return { deal: publicDeal(existing), status: 200 };
}

export default {
  async fetch(request, env) {
    const method = request.method;
    const origin = request.headers.get("Origin");
    const allowed = origin && env.ALLOWED_ORIGINS.split(",").some((value) => value.trim() === origin);
    const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (method === "GET") headers.set("Access-Control-Allow-Origin", "*");
    else {
      headers.set("Vary", "Origin");
      if (allowed) headers.set("Access-Control-Allow-Origin", origin);
    }
    const json = (data, status = 200) => Response.json(data, { status, headers });
    if (new URL(request.url).pathname !== "/deals") return json({ error: "페이지를 찾을 수 없습니다." }, 404);

    if (method === "OPTIONS" && allowed) {
      headers.set("Access-Control-Allow-Methods", "GET, POST");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Max-Age", "600");
      return new Response(null, { status: 204, headers });
    }
    try {
      if (method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT ${fields} FROM deals
          WHERE hidden = 0 AND (ends IS NULL OR ends >= date('now', '+9 hours'))
          ORDER BY created_at DESC, id DESC
        `).all();
        return json({ deals: results.map(publicDeal) });
      }
      if (method === "POST") {
        if (!allowed) throw new RequestError(403, "이 사이트에서는 등록할 수 없습니다.");
        const { deal, status } = await addDeal(request, env);
        return json({ deal }, status);
      }
      return json({ error: "지원하지 않는 요청입니다." }, 405);
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status);
      return json({ error: "게시판에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, 503);
    }
  },
};
