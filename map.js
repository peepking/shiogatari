import { clamp } from "./util.js";
import { state } from "./state.js";
import { elements } from "./dom.js";
import { FACTIONS } from "./lore.js";
import {
  refreshSettlementDemand,
  refreshSettlementStock,
  SUPPLY_TYPES,
  randomSupplyIdByType,
} from "./supplies.js";
import { initSettlementRecruitment, refreshSettlementRecruitment } from "./troops.js";

/** @type {number} マップの一辺サイズ */
export const MAP_SIZE = 50;
/** @type {number} ズーム表示の一辺サイズ */
export const MAP_ZOOM = 9;
/** @type {number} セル1つのピクセル幅 */
export const MAP_CELL = 14;
/** @type {number} 描画パディング */
export const MAP_PAD = 4;

const terrainKinds = [
  { key: "sea", name: "海", color: "#0f4c81" },
  { key: "forest", name: "森", color: "#16603a" },
  { key: "plain", name: "平原", color: "#3a6b35" },
  { key: "mountain", name: "山岳", color: "#4b4b4b" },
  { key: "shoal", name: "浅瀬", color: "#227f91" },
];

const settlementNames = {
  prefix: ["北", "南", "東", "西", "潮", "波", "風", "岩", "砂", "霧", "蒼", "紅"],
  middle: [
    "落ち葉", "潮待ち", "弦月", "月影", "星降り", "潮騒", "朝凪", "夕凪", "朝霧", "夕霧",
    "潮風", "波間", "白波", "渚", "灯火", "寄せ波", "深緑", "藍", "群青", "茜",
    "翠", "灰雲", "霧雨", "霜降り", "雪解け", "小雨", "大潮", "満潮", "干潮", "霧笛",
    "霜月", "花霞", "若葉", "初穂", "渡り鳥", "浜辺", "山裾", "岬先", "沖目", "沖鳴り",
    "鯨骨", "帆影", "帆先", "水面", "水脈", "潮目", "潮路", "潮灯", "舟出", "避難",
  ],
};

const garrisonPool = ["海兵", "弓兵", "歩兵", "斥候", "騎兵"];
const goodsPool = ["食料", "木材", "石材", "鉄", "繊維", "塩", "織物", "酒", "武具", "香辛料", "なめし革"];

/** @type {Array} 生成済み拠点の一覧 */
export const settlements = [];
/** @type {Map<string,string>} 貴族ID -> 拠点ID */
export const nobleHome = new Map(); // 貴族ID -> 拠点ID

/**
 * 拠点名をランダム生成する。
 * @param {Set<string>} used
 * @param {"village"|"town"} [kind="village"]
 * @returns {string}
 */
function nextName(used, kind = "village") {
  for (let i = 0; i < 200; i++) {
    const p =
      settlementNames.prefix[Math.floor(Math.random() * settlementNames.prefix.length)];
    const m =
      settlementNames.middle[Math.floor(Math.random() * settlementNames.middle.length)];
    const suffix = kind === "town" ? "街" : "村";
    const name = `${p}${m}${suffix}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = kind === "town" ? `街${used.size + 1}` : `村${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

/**
 * 地形・建物を含むマップを生成する。
 * @param {number} [seed=1]
 * @returns {Array}
 */
function generateMap(seed = 1) {
  const grid = [];
  let s = seed;
  /**
   * 乱数を生成する（簡易シード方式）。
   * @returns {number}
   */
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 0xffffffff;
    return s / 0xffffffff;
  };

  const bigIslands = [
    { x: Math.floor(MAP_SIZE * 0.22), y: Math.floor(MAP_SIZE * 0.22) },
    { x: Math.floor(MAP_SIZE * 0.78), y: Math.floor(MAP_SIZE * 0.22) },
    { x: Math.floor(MAP_SIZE * 0.5), y: Math.floor(MAP_SIZE * 0.7) },
  ].map((c, i) => {
    const base = (i === 0 ? 14 : i === 2 ? 12 : 10) + Math.floor(rnd() * 6);
    const rx = i === 2 ? Math.floor(base * 1.5) : base;
    const ry = i === 2 ? Math.floor(base * 0.9) : base;
    return { ...c, rx, ry };
  });

  const smallIsles = Array.from({ length: 2 }, () => ({
    x: Math.floor(rnd() * MAP_SIZE),
    y: Math.floor(rnd() * MAP_SIZE),
    r: 3 + Math.floor(rnd() * 4),
  }));

  const maxDist = Math.hypot(MAP_SIZE / 2, MAP_SIZE / 2);

  for (let y = 0; y < MAP_SIZE; y++) {
    const row = [];
    for (let x = 0; x < MAP_SIZE; x++) {
      const distCenter = Math.hypot(x - MAP_SIZE / 2, y - MAP_SIZE / 2);
      const falloff = 1 - distCenter / maxDist;

      let influenceBig = 0;
      bigIslands.forEach((c) => {
        const dx = (x - c.x) / c.rx;
        const dy = (y - c.y) / c.ry;
        const d = Math.hypot(dx, dy);
        influenceBig += Math.max(0, 1 - d);
      });
      let influenceSmall = 0;
      smallIsles.forEach((c) => {
        const d = Math.hypot(x - c.x, y - c.y);
        influenceSmall += Math.max(0, (c.r - d) / c.r);
      });

      const noise = rnd() * 0.5 - 0.25;
      const height =
        falloff * 0.4 + influenceBig * 0.8 + influenceSmall * 0.4 + noise - 0.2;

      let terrain = "sea";
      if (height > 0.8) terrain = "mountain";
      else if (height > 0.6) terrain = rnd() > 0.4 ? "forest" : "plain";
      else if (height > 0.48) terrain = "plain";
      else if (height > 0.34) terrain = "shoal";

      row.push({ terrain, building: "none" });
    }
    grid.push(row);
  }

  // 陸地から離れた浅瀬は海に戻す。
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const cell = grid[y][x];
      if (cell.terrain !== "shoal") continue;
      let nearLand = false;
      for (let dy = -2; dy <= 2 && !nearLand; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
          const t = grid[ny][nx].terrain;
          if (t !== "sea" && t !== "shoal") {
            nearLand = true;
            break;
          }
        }
      }
      if (!nearLand) cell.terrain = "sea";
    }
  }

  // 建物配置（陸のみ、海沿い優先、浅瀬は除外）。
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const cell = grid[y][x];
      if (cell.terrain === "sea" || cell.terrain === "shoal") continue;

      let coast = false;
      for (let dy = -2; dy <= 2 && !coast; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE) continue;
          if (grid[ny][nx].terrain === "sea") {
            coast = true;
            break;
          }
        }
      }

      const r = rnd();
      let building = "none";

      // 生成比は「街1 : 村2」くらいになるように閾値を調整。
      if (coast) {
        if (r > 0.995) building = "castle";
        else if (r > 0.9567) building = "town";
        else if (r > 0.88) building = "village";
      } else {
        if (r > 0.995) building = "castle";
        else if (r > 0.9833) building = "town";
        else if (r > 0.96) building = "village";
      }

      cell.building = building;
    }
  }

  return grid;
}

/** @type {Array} マップの地形/建物データ */
export const mapData = generateMap(2025);
let lastDemandSeason = { year: state.year, season: state.season };

/**
 * 拠点を貴族・勢力に割り当てる。
 */
(function assignSettlements() {
  const usedNames = new Set();
  const nobles = FACTIONS.flatMap((f) =>
    (f.nobles || []).map((n) => ({ ...n, factionId: f.id }))
  );
  if (!nobles.length) return;
  let idx = 0;
  const factionOrder = {};
  const noblesByFaction = nobles.reduce((acc, noble) => {
    if (!acc[noble.factionId]) acc[noble.factionId] = [];
    acc[noble.factionId].push(noble);
    return acc;
  }, {});
  /**
   * 勢力に属する貴族を順番に選ぶ。
   * @param {string} factionId
   * @returns {object|null}
   */
  const pickNobleByFaction = (factionId) => {
    const list = noblesByFaction[factionId] || [];
    if (!list.length) return null;
    const next = factionOrder[factionId] ?? 0;
    factionOrder[factionId] = next + 1;
    return list[next % list.length];
  };
  /**
   * 全体から貴族を順繰りで選ぶ。
   * @returns {object}
   */
  const pickFallbackNoble = () => {
    const owner = nobles[idx % nobles.length];
    idx += 1;
    return owner;
  };
  // 拠点の所属は島ごとの勢力偏りを持たせる（左上/右上/下の島）。
  /**
   * 座標ごとの優先勢力を返す。
   * @param {number} x
   * @param {number} y
   * @returns {string|null}
   */
  const preferredFactionForCell = (x, y) => {
    const xRatio = x / MAP_SIZE;
    const yRatio = y / MAP_SIZE;
    if (yRatio < 0.45) {
      if (xRatio < 0.45) return "north";
      if (xRatio > 0.55) return "archipelago";
    }
    if (yRatio > 0.55) return "citadel";
    return null;
  };

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const cell = mapData[y][x];
      // 砦は村として扱う。
      if (cell.building === "castle") cell.building = "village";
      if (cell.building !== "town" && cell.building !== "village") continue;

      const tooClose = settlements.some((s) => {
        if (s.kind !== "town" && s.kind !== "village") return false;
        const dx = Math.abs(s.coords.x - x);
        const dy = Math.abs(s.coords.y - y);
        // 周囲2マス以内には村/街を配置しない。
        return dx <= 2 && dy <= 2;
      });
      if (tooClose) {
        cell.building = "none";
        continue;
      }

      const preferred = preferredFactionForCell(x, y);
      // 地域の勢力偏りを75%で適用する。
      const usePreferred = preferred && Math.random() < 0.75;
      const owner =
        (usePreferred ? pickNobleByFaction(preferred) : null) || pickFallbackNoble();
      const id = `set-${settlements.length + 1}`;
      const garrison = [
        garrisonPool[Math.floor(Math.random() * garrisonPool.length)],
        garrisonPool[Math.floor(Math.random() * garrisonPool.length)],
      ];
      const goods = [
        goodsPool[Math.floor(Math.random() * goodsPool.length)],
        goodsPool[Math.floor(Math.random() * goodsPool.length)],
      ];
      const specialty =
        cell.building === "village"
          ? randomSupplyIdByType(SUPPLY_TYPES.raw)
          : cell.building === "town"
            ? randomSupplyIdByType(SUPPLY_TYPES.processed)
            : null;

      const settlement = {
        id,
        name: nextName(usedNames, cell.building),
        kind: cell.building,
        factionId: owner.factionId,
        nobleId: owner.id,
        garrison,
        goods,
        coords: { x, y },
        specialty,
      };
      initSettlementRecruitment(settlement);
      refreshSettlementDemand(settlement);
      refreshSettlementStock(settlement);
      settlements.push(settlement);
      cell.settlement = settlement;
      cell.factionId = settlement.factionId;
      if (!nobleHome.has(owner.id)) nobleHome.set(owner.id, id);
    }
  }
  lastDemandSeason = { year: state.year, season: state.season };
})();

/**
 * 指定の貴族が保有する拠点を返す。
 * @param {string} nobleId
 * @returns {Array}
 */
export function getSettlementsByNoble(nobleId) {
  return settlements.filter((s) => s.nobleId === nobleId);
}

/**
 * 勢力IDから名称を取得する。
 * @param {string} id
 * @returns {string}
 */
function factionName(id) {
  return FACTIONS.find((f) => f.id === id)?.name || id;
}

/**
 * マップ座標の表示用テキストを生成する。
 * @param {number} gx
 * @param {number} gy
 * @returns {string}
 */
function formatCellInfo(gx, gy) {
  const cell = mapData[gy]?.[gx];
  if (!cell) return "";
  const t = terrainKinds.find((t) => t.key === cell.terrain);
  const terr = t ? t.name : cell.terrain;
  const detail = cell.settlement
    ? ` / ${cell.settlement.name}（${factionName(cell.settlement.factionId)}）`
    : "";
  return `(${gx + 1}, ${gy + 1}) ${terr}${detail}`;
}

/**
 * 現在地の場所/勢力表示に使う情報を返す。
 * @returns {{place: string, faction: (string|null)}}
 */
export function getLocationStatus() {
  const { x, y } = state.position;
  const cell = mapData[y]?.[x];
  let place = "フィールド";
  if (cell?.building === "town") place = "街";
  else if (cell?.building === "village") place = "村";

  let faction = null;
  const near = settlements.find(
    (s) => Math.abs(s.coords.x - x) <= 1 && Math.abs(s.coords.y - y) <= 1
  );
  if (near) {
    faction = factionName(near.factionId);
  }

  return { place, faction };
}

/**
 * 季節の切り替わりに拠点データを更新する。
 */
function refreshSettlementDemandIfNeeded() {
  if (state.day !== 1) return;
  if (lastDemandSeason.year === state.year && lastDemandSeason.season === state.season) return;
  // 需要・在庫・雇用枠は季節の1日にまとめて更新する。
  settlements.forEach((s) => {
    refreshSettlementDemand(s);
    refreshSettlementStock(s);
    refreshSettlementRecruitment(s);
  });
  lastDemandSeason = { year: state.year, season: state.season };
}

/**
 * 現在のマップ表示を描画する。
 */
export function renderMap() {
  refreshSettlementDemandIfNeeded();
  const { mapCanvas, mapPosLabel } = elements;
  if (!mapCanvas) return;
  const isZoom = state.mapMode === "zoom";
  const cells = isZoom ? MAP_ZOOM : MAP_SIZE;
  const cellSize = MAP_CELL;
  const pad = MAP_PAD;
  mapCanvas.width = cells * cellSize + pad * 2;
  mapCanvas.height = cells * cellSize + pad * 2;
  mapCanvas.style.width = "100%";
  mapCanvas.style.height = "auto";
  const ctx = mapCanvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  const startX = isZoom
    ? clamp(state.position.x - Math.floor(MAP_ZOOM / 2), 0, MAP_SIZE - MAP_ZOOM)
    : 0;
  const startY = isZoom
    ? clamp(state.position.y - Math.floor(MAP_ZOOM / 2), 0, MAP_SIZE - MAP_ZOOM)
    : 0;

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const gx = startX + x;
      const gy = startY + y;
      const cell = mapData[gy][gx];
      const t = terrainKinds.find((t) => t.key === cell.terrain) || terrainKinds[0];
      ctx.fillStyle = t.color;
      ctx.fillRect(pad + x * cellSize, pad + y * cellSize, cellSize - 1, cellSize - 1);

      if (cell.building !== "none") {
        const cx = pad + x * cellSize + cellSize / 2;
        const cy = pad + y * cellSize + cellSize / 2;
        const size = Math.max(4, cellSize * 0.32);
        ctx.save();
        ctx.lineWidth = 1.4;
        const factionId = cell.settlement?.factionId || cell.factionId;
        const factionColor =
          factionId && (FACTIONS.find((f) => f.id === factionId)?.color || null);
        const defaultColor =
          cell.building === "town" ? "#7aa7ff" : cell.building === "village" ? "#8fd67a" : "#ffd27a";
        const fill = factionColor || defaultColor;
        if (cell.building === "village") {
          ctx.fillStyle = fill;
          ctx.strokeStyle = "#ffffffaa";
          ctx.beginPath();
          ctx.arc(cx, cy, size * 0.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (cell.building === "town") {
          ctx.fillStyle = fill;
          ctx.strokeStyle = "#ffffffaa";
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
          ctx.strokeRect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6);
        } else {
          ctx.fillStyle = fill;
          ctx.strokeStyle = "#ffffffaa";
          ctx.fillRect(pad + x * cellSize + 3, pad + y * cellSize + 3, cellSize - 7, cellSize - 7);
          ctx.strokeRect(pad + x * cellSize + 3, pad + y * cellSize + 3, cellSize - 7, cellSize - 7);
        }
        ctx.restore();
      }
    }
  }

  // 移動可能範囲の強調表示（上下左右）。
  const reachables = [];
  for (let i = 1; i <= 1; i++) {
    reachables.push({ x: state.position.x + i, y: state.position.y });
    reachables.push({ x: state.position.x - i, y: state.position.y });
    reachables.push({ x: state.position.x, y: state.position.y + i });
    reachables.push({ x: state.position.x, y: state.position.y - i });
  }
  ctx.strokeStyle = "rgba(255, 122, 122, 0.8)";
  ctx.lineWidth = 3;
  reachables.forEach((pos) => {
    if (
      pos.x < startX ||
      pos.x >= startX + cells ||
      pos.y < startY ||
      pos.y >= startY + cells
    )
      return;
    // 先に描画し、現在位置と重なる場合は後で上書きする。
    ctx.strokeRect(
      pad + (pos.x - startX) * cellSize,
      pad + (pos.y - startY) * cellSize,
      cellSize - 1,
      cellSize - 1
    );
  });

  // 選択マスの強調表示
  if (state.selectedPosition) {
    const sel = state.selectedPosition;
    if (
      sel.x >= startX &&
      sel.x < startX + cells &&
      sel.y >= startY &&
      sel.y < startY + cells
    ) {
      ctx.strokeStyle = "#ffd27a";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        pad + (sel.x - startX) * cellSize + 1,
        pad + (sel.y - startY) * cellSize + 1,
        cellSize - 3,
        cellSize - 3
      );
    }
  }

  // 現在位置
  ctx.strokeStyle = "#e8efff";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    pad + (state.position.x - startX) * cellSize,
    pad + (state.position.y - startY) * cellSize,
    cellSize - 1,
    cellSize - 1
  );

  if (mapPosLabel) {
    mapPosLabel.textContent = `(${state.position.x + 1}, ${state.position.y + 1})`;
  }
}

/**
 * 指定座標にある拠点を返す。
 * @param {number} x
 * @param {number} y
 * @returns {object|null}
 */
export function getSettlementAtPosition(x, y) {
  const cell = mapData[y]?.[x];
  return cell?.settlement || null;
}

/**
 * 指定座標の地形キーを返す。
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function getTerrainAt(x, y) {
  return mapData[y]?.[x]?.terrain || "plain";
}

/**
 * 現在のマップ/拠点情報をスナップショットとして返す。
 * @returns {{cells:Array,settlements:Array,nobleHome:Array}}
 */
export function snapshotWorld() {
  const cells = mapData.map((row) =>
    row.map((cell) => ({
      terrain: cell.terrain,
      building: cell.building,
      factionId: cell.factionId ?? null,
      settlementId: cell.settlement?.id || null,
    }))
  );
  const settlementsSnap = settlements.map((s) => ({ ...s, coords: { ...s.coords } }));
  const nobleHomeSnap = Array.from(nobleHome.entries());
  return { cells, settlements: settlementsSnap, nobleHome: nobleHomeSnap };
}

/**
 * スナップショットからマップ/拠点を復元する。
 * @param {{cells:Array,settlements:Array,nobleHome:Array}|null} snapshot
 * @returns {boolean} 復元成功時 true
 */
export function restoreWorld(snapshot) {
  try {
    if (!snapshot?.cells || !snapshot?.settlements) return false;
    if (
      !Array.isArray(snapshot.cells) ||
      snapshot.cells.length !== MAP_SIZE ||
      snapshot.cells[0]?.length !== MAP_SIZE
    )
      return false;
    // mapDataはconstなので中身を上書きする
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const src = snapshot.cells[y][x];
        const cell = mapData[y][x];
        cell.terrain = src.terrain;
        cell.building = src.building;
        cell.factionId = src.factionId ?? null;
        cell.settlement = null;
      }
    }
    // 拠点を再構築
    settlements.length = 0;
    snapshot.settlements.forEach((s) => settlements.push({ ...s }));
    // nobleHomeを再構築
    nobleHome.clear();
    (snapshot.nobleHome || []).forEach(([k, v]) => nobleHome.set(k, v));
    const settlementById = new Map(settlements.map((s) => [s.id, s]));
    // mapDataにsettlement参照を差し戻す
    snapshot.cells.forEach((row, y) => {
      row.forEach((src, x) => {
        if (src.settlementId) {
          const s = settlementById.get(src.settlementId);
          if (s) {
            mapData[y][x].settlement = s;
            mapData[y][x].building = s.kind;
            mapData[y][x].factionId = s.factionId;
          }
        }
      });
    });
    return true;
  } catch (e) {
    console.error("restoreWorld failed", e);
    return false;
  }
}

/**
 * IDから拠点を取得する。
 * @param {string} id
 * @returns {object|null}
 */
export function getSettlementById(id) {
  return settlements.find((s) => s.id === id) || null;
}

/**
 * マップ情報表示を更新する。
 * @param {string} hoverText
 */
function updateMapInfo(hoverText) {
  const { mapInfo } = elements;
  if (!mapInfo) return;
  const sel = state.selectedPosition
    ? `選択中: ${formatCellInfo(state.selectedPosition.x, state.selectedPosition.y)}`
    : "選択中: なし";
  const left = hoverText || "";
  mapInfo.innerHTML = `<span>${left}</span><span>${sel}</span>`;
}

/**
 * マップのホバー表示を設定する。
 */
export function wireMapHover() {
  const { mapCanvas } = elements;
  if (!mapCanvas) return;
  mapCanvas.addEventListener("mousemove", (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const cells = state.mapMode === "zoom" ? MAP_ZOOM : MAP_SIZE;
    const scaleX = rect.width / mapCanvas.width;
    const pad = MAP_PAD * scaleX;
    const cell = (rect.width - pad * 2) / cells;
    const localX = Math.floor((e.clientX - rect.left - pad) / cell);
    const localY = Math.floor((e.clientY - rect.top - pad) / cell);
    if (localX < 0 || localY < 0 || localX >= cells || localY >= cells) {
      updateMapInfo("");
      return;
    }
    const startX =
      state.mapMode === "zoom"
        ? clamp(state.position.x - Math.floor(MAP_ZOOM / 2), 0, MAP_SIZE - MAP_ZOOM)
        : 0;
    const startY =
      state.mapMode === "zoom"
        ? clamp(state.position.y - Math.floor(MAP_ZOOM / 2), 0, MAP_SIZE - MAP_ZOOM)
        : 0;
    const gx = startX + localX;
    const gy = startY + localY;
    updateMapInfo(formatCellInfo(gx, gy));
  });

  mapCanvas.addEventListener("mouseleave", () => {
    updateMapInfo("");
  });

  mapCanvas.addEventListener("click", (e) => {
    const rect = mapCanvas.getBoundingClientRect();
    const cells = state.mapMode === "zoom" ? MAP_ZOOM : MAP_SIZE;
    const scaleX = rect.width / mapCanvas.width;
    const pad = MAP_PAD * scaleX;
    const cell = (rect.width - pad * 2) / cells;
    const localX = Math.floor((e.clientX - rect.left - pad) / cell);
    const localY = Math.floor((e.clientY - rect.top - pad) / cell);
    if (localX < 0 || localY < 0 || localX >= cells || localY >= cells) return;
    const startX =
      state.mapMode === "zoom"
        ? clamp(state.position.x - Math.floor(MAP_ZOOM / 2), 0, MAP_SIZE - MAP_ZOOM)
        : 0;
    const startY =
      state.mapMode === "zoom"
        ? clamp(state.position.y - Math.floor(MAP_ZOOM / 2), 0, MAP_SIZE - MAP_ZOOM)
        : 0;
    const gx = startX + localX;
    const gy = startY + localY;
    const sameSelection =
      state.selectedPosition &&
      state.selectedPosition.x === gx &&
      state.selectedPosition.y === gy;
    const isCurrent = state.position.x === gx && state.position.y === gy;
    state.selectedPosition = { x: gx, y: gy };
    renderMap();
    updateMapInfo(formatCellInfo(gx, gy));
    if (sameSelection) {
      if (isCurrent) {
        document.dispatchEvent(new CustomEvent("map-wait-request"));
      } else {
        const dx = Math.abs(state.position.x - gx);
        const dy = Math.abs(state.position.y - gy);
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
          document.dispatchEvent(new CustomEvent("map-move-request"));
        } else {
          document.dispatchEvent(
            new CustomEvent("map-move-invalid", {
              detail: { reason: "range" },
            })
          );
        }
      }
    }
  });
}
