/** 国力の対象国家。海賊と無所属プレイヤーは含めない。 */
export const NATIONAL_POWER_FACTIONS = Object.freeze(["north", "archipelago", "citadel"]);

const villageRecovery = 1;

/** 国力の調整値。precisionは保存形式に関わるため、変更時には移行処理が必要。 */
export const NATIONAL_POWER_CONFIG = Object.freeze({
  initial: 600,
  max: 1000,
  precision: 1000,
  recovery: Object.freeze({ village: villageRecovery, town: villageRecovery * 2 }),
  questGain: 1,
  warActionGain: 2,
  warActionLoss: 2,
  regularVictoryGain: 2,
  regularVictoryLoss: 2,
  dailyDefenseCost: 0.2,
  dailyAttackCost: 0.4,
  settlementLoss: Object.freeze({ village: 40, town: 80 }),
  donationFundsPerPoint: 1000,
  warBias: Object.freeze({ referenceDifference: 500, maxDaily: 0.2 }),
});
