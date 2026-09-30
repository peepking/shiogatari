import { MODE_LABEL } from "../core/constants.js";

/** 所属変更は平時のみ。拠点の有無や入場制限には依存しない。 @param {object} state 状態。 @returns {boolean} 所属を変更できるか。 */
export function canManageIdentity(state) {
  return [MODE_LABEL.NORMAL, MODE_LABEL.IN_TOWN, MODE_LABEL.IN_VILLAGE, MODE_LABEL.AUDIENCE].includes(state.modeLabel)
    && !state.pendingEncounter?.active && !state.eventQueue?.length && !state.wanted?.detention;
}
