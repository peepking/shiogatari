import { PIRATE_CONFIG } from "./pirateConfig.js";

/**
 * 最大の連続した海域へ無法港を分散配置する。最初は左上、その後は既設港から最も遠い候補を優先する。
 * 新規世界生成だけで呼び、既設の無法港がある場合は何も変更しない。
 * @param {Array} grid 地図。 @param {Array} settlements 拠点。 @param {Map} homes 人物本拠地。
 * @param {Function} initialize 雇用・物資の初期化。 @returns {void}
 */
export function buildPirateHavens(grid, settlements, homes, initialize) {
  if (settlements.some(settlement => settlement.pirateHaven)) return;
  const seen = new Set(); let largest = [];
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const key = `${x},${y}`;
    if (seen.has(key) || !["sea", "shoal"].includes(grid[y][x].terrain)) continue;
    const region = [{x,y}]; seen.add(key);
    for (let i = 0; i < region.length; i++) {
      const p = region[i];
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = p.x + dx, ny = p.y + dy, nk = `${nx},${ny}`;
        if (!seen.has(nk) && ["sea","shoal"].includes(grid[ny]?.[nx]?.terrain)) {
          seen.add(nk); region.push({x:nx,y:ny});
        }
      }
    }
    if (region.length > largest.length) largest = region;
  }
  const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const candidates = largest.filter(p => (!grid[p.y][p.x].building || grid[p.y][p.x].building === "none") &&
    settlements.every(s => distance(p,s.coords) >= 4));
  const ports = [];
  while (ports.length < PIRATE_CONFIG.ports && candidates.length) {
    candidates.sort((a,b) => {
      const score = p => ports.length ? Math.min(...ports.map(s => distance(p,s.coords))) : -(p.x+p.y);
      return score(b)-score(a) || a.y-b.y || a.x-b.x;
    });
    const coords = candidates.shift();
    if (ports.some(s => distance(coords,s.coords)<6)) continue;
    const id = `haven-${ports.length+1}`;
    const names = ["黒帆の隠れ港","流れ者の泊地","霧裂き港","沈鐘の入り江","牙岩の泊地","赤帆の入江","夜潮の港","骸礁の泊地","荒波の港","無灯の入り江"];
    const port = {id,name:names[ports.length],kind:"town",pirateHaven:true,factionId:"pirates",
      nobleId:PIRATE_CONFIG.nobleId,controllerId:PIRATE_CONFIG.nobleId,coords,goods:[],specialty:null,
      support:{pirates:0},warState:{contested:false,frontline:false}};
    initialize(port); settlements.push(port); ports.push(port);
    Object.assign(grid[coords.y][coords.x],{building:"town",settlement:port,factionId:"pirates"});
  }
  if (ports.length) homes.set(PIRATE_CONFIG.nobleId,ports[0].id);
}
