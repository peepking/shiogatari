import { INTENSITY_KEY, MODE_LABEL } from "./constants.js";
import {
  COMPANION_FATE,
  DIRECTIONS,
  INTENSITIES,
  MERC_MORPH
} from "./lore.js";
import { pending, state } from "./state.js";
import { setTroopsManual, totalTroops } from "./troops.js";

/**
 * 表示用の操作サマリを整形する。
 * @param {{result?:string,doList?:string[],dontList?:string[],note?:string}} param0
 * @returns {string}
 */
export function fmtOps({ result, doList, dontList, note }) {
  const lines = [];
  if (result) lines.push(`◆結果\n${result}`);
  if (doList?.length) lines.push(`◆やること\n- ${doList.join("\n- ")}`);
  if (dontList?.length) lines.push(`◆禁止/注意\n- ${dontList.join("\n- ")}`);
  if (note) lines.push(`◆メモ\n${note}`);
  return lines.join("\n\n");
}

/**
 * 方向テーブルの参照。
 * @param {number} d
 * @returns {object}
 */
const directionPack = (d) => DIRECTIONS[d];
/**
 * 強度テーブルの参照。
 * @param {number} r
 * @returns {object}
 */
const intensityPack = (r) => INTENSITIES[r];



/**
 * 保留中の行動決定を解決する。
 * @param {number} r
 * @returns {object|null}
 */
export function resolvePending(r) {
  if (pending.kind === "intensity") {
    const dir = directionPack(pending.forceDirection ?? pending.direction);
    const inten = intensityPack(r);
    if (r === 2) state.silence += 1;

    pending.kind = null;
    pending.direction = null;
    pending.forceDirection = null;
    state.modeLabel = MODE_LABEL.DECIDING;

    const doList = [...(dir?.do || [])];
    const dontList = [...(dir?.dont || [])];
    if (inten?.dontExtra?.length) dontList.push(...inten.dontExtra);

    const text = fmtOps({
      result: `方向: ${dir?.key ?? "-"}\n強度: ${inten?.key ?? "-"}`,
      doList,
      dontList,
      note: inten?.note || "",
    });
    const title = "行動プラン決定";
    return {
      title,
      text,
      tags: [
        { text: `方向=${dir?.key ?? "-"}`, kind: "" },
        {
          text: `強度=${inten?.key ?? "-"}`,
      kind: inten?.key === INTENSITY_KEY.SILENCE ? "warn" : inten?.key === INTENSITY_KEY.FULL ? "good" : "",
        },
      ],
      omenDirection: dir?.key,
      omenIntensity: inten?.key,
    };
  }

  if (pending.kind === "companionFate") {
    const m = COMPANION_FATE[r];
    if (r === 1 || r === 2) {
      const total = Math.max(0, totalTroops() - 1);
      setTroopsManual(total);
    }

    pending.kind = null;
    state.modeLabel = MODE_LABEL.SAILING;

    const title = "仲間の運命を決定";
    const text = fmtOps({
      result: `結果: ${m.t}`,
      doList: m.do,
      dontList: [],
      note: m.note,
    });

    return {
      title,
      text,
      tags: [
        { text: "仲間の運命", kind: "warn" },
        { text: m.t, kind: m.kind },
      ],
      omenIntensity: m.t,
    };
  }

  if (pending.kind === "mercMorph") {
    const m = MERC_MORPH[r];
    pending.kind = null;
    state.modeLabel = MODE_LABEL.SAILING;

    const title = "傭兵契約の転化結果";
    const text = fmtOps({
      result: `結果: ${m.t}`,
      doList: m.do,
      dontList: [],
      note: m.note,
    });

    return {
      title,
      text,
      tags: [
        { text: "契約の行方", kind: "warn" },
        { text: m.t, kind: m.kind },
      ],
      omenIntensity: m.t,
    };
  }

  return null;
}
