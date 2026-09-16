const ROTATION_ORDER = ["crossbow", "halberd", "seaArcher", "shield", "archer", "marine", "scout", "medic", "pirate_spear", "pirate_assault", "pirate_shield", "pirate_archer", "pirate_axe", "raider_cavalry"];

/**
 * 評価の降順で候補を並べ、同評価内は指定の兵種順で1部隊ずつ巡回する。
 * 指定外の兵種は元の登場順で末尾に加え、候補切れの兵種は飛ばす。
 * 同兵種・同評価では人数の多い候補を先にし、同人数は元の順を保つ。
 * 巡回は評価ごと・呼出しごとに先頭から開始し、入力配列を変更しない。
 * @param {{type:string,size:number,weight:number}[]} chunks 編成候補。
 * @returns {object[]} 選出優先順の候補。
 */
export function orderRosterCandidates(chunks) {
  const groups = new Map();
  for (const chunk of [...chunks].sort((a, b) => b.weight - a.weight || b.size - a.size)) {
    if (!groups.has(chunk.weight)) groups.set(chunk.weight, new Map());
    const types = groups.get(chunk.weight);
    if (!types.has(chunk.type)) types.set(chunk.type, []);
    types.get(chunk.type).push(chunk);
  }
  const result = [];
  for (const types of groups.values()) {
    const order = [...ROTATION_ORDER.filter(type => types.has(type)),
      ...[...types.keys()].filter(type => !ROTATION_ORDER.includes(type))];
    const rounds = Math.max(...[...types.values()].map(queue => queue.length));
    for (let round = 0; round < rounds; round++) {
      for (const type of order) {
        const chunk = types.get(type)[round];
        if (chunk) result.push(chunk);
      }
    }
  }
  return result;
}
