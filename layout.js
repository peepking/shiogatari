/**
 * 既存の操作要素を移動し、探索と戦闘で共通の画面枠を組み立てる。
 * IDと要素自体を維持することで、既存の操作・詳細表示を引き継ぐ。
 * @returns {void}
 */
export function initWorkspaceLayout() {
  const grid = document.querySelector("main .grid");
  const toolbar = document.getElementById("gameToolbar");
  const navigator = document.querySelector('[aria-label="navigator"]');
  const assets = navigator.querySelector(".asset-grid");
  toolbar.prepend(document.getElementById("gameTime"), assets);
  assets.classList.remove("mb-12");
  document.getElementById("gameMenu").append(
    document.getElementById("manualModalBtn"), document.getElementById("unlockCodexBtn"), document.getElementById("resetBtn")
  );
  navigator.querySelector(".hd").remove();
  for (const asset of assets.children) {
    asset.setAttribute("role", "button");
    asset.querySelector("img").alt = "";
    asset.tabIndex = 0;
    asset.addEventListener("keydown", activateAsset);
  }

  const mapCard = document.getElementById("mapBlock").closest(".card");
  const modeCard = document.querySelector('[aria-label="mode"]');
  const roster = document.getElementById("rosterCard");
  const strategy = document.getElementById("strategyCard");
  mapCard.classList.add("workspace-map");
  modeCard.classList.add("workspace-actions");
  const battleSide = document.createElement("div");
  battleSide.className = "battle-side";
  battleSide.append(strategy, document.getElementById("battleInfoCard"));

  const heading = document.createElement("div");
  heading.className = "battle-heading";
  heading.innerHTML = '<b id="battleHeading">戦闘準備</b><ol class="battle-steps"><li id="battleStepRoster">1 編成</li><li id="battleStepFormation">2 配置・作戦</li><li id="battleStepStart">3 出撃</li></ol>';
  const footer = document.createElement("section");
  footer.className = "battle-command";
  footer.setAttribute("aria-label", "戦闘の操作");
  footer.innerHTML = '<p id="battleGuide" role="status"></p><div class="battle-command-actions" id="battleCommandActions"></div>';
  const commands = footer.querySelector("#battleCommandActions");
  commands.append(document.getElementById("battleStartBtn"), document.getElementById("battlePauseBtn"), document.getElementById("battleBackBtn"));
  commands.querySelector("#battleStartBtn").textContent = "この編成で戦闘開始";
  document.getElementById("rosterAuto").textContent = "おまかせ編成";
  document.getElementById("rosterApply").textContent = "編成を反映";
  document.getElementById("battleFormationApply").textContent = "配置を反映";
  document.querySelector(".battle-header .tiny").textContent = "配置プレビュー / 部隊を選択して詳細を確認";
  const formation = document.querySelector(".battle-formation");
  const strategyBody = strategy.querySelector(".bd");
  strategyBody.prepend(formation);
  const strategyTitle = document.createElement("h2");
  strategyTitle.className = "workspace-title";
  strategyTitle.textContent = "配置・作戦";
  strategyBody.prepend(strategyTitle);
  const advanced = document.createElement("details");
  advanced.className = "strategy-details";
  advanced.innerHTML = '<summary>詳細設定</summary>';
  const strategyGrid = strategy.querySelector(".strategy-grid");
  const settings = [...strategyGrid.children];
  advanced.append(...settings.slice(1));
  strategyGrid.after(advanced);
  strategy.querySelector(".strategy-speed").remove();
  const panel = document.querySelector(".battle-panel");
  panel.firstElementChild.remove();
  panel.classList.add("battle-playback");

  const drawers = document.createElement("div");
  drawers.className = "workspace-drawers";
  drawers.append(
    createDrawer("航海ログ", navigator),
    createDrawer("勢力・貴族", document.querySelector('[aria-label="factions"]')),
    createDrawer("ガイド・ヘルプ", document.querySelector('[aria-label="guides"]'))
  );
  const quest = document.getElementById("questCard");
  grid.replaceChildren(heading, modeCard, roster, mapCard, quest, battleSide, footer);
  grid.after(drawers);
}

/**
 * キーボードから資産詳細を開く。
 * @param {KeyboardEvent} event
 * @returns {void}
 */
function activateAsset(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

/**
 * 補助情報を必要なときだけ展開する領域へ移す。
 * @param {string} label
 * @param {HTMLElement} content
 * @returns {HTMLDetailsElement}
 */
function createDrawer(label, content) {
  const details = document.createElement("details");
  details.className = "workspace-drawer";
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary, content);
  return details;
}

/**
 * 戦闘画面の配置と案内を、編成反映・配置編集・戦闘進行に合わせて更新する。
 * 案内は戦闘結果、進行中、編成不足、未反映、配置編集中の順で優先する。
 * @param {object} status
 * @returns {void}
 */
export function updateBattleLayout({ active, count, applied, editing, running, started, result }) {
  document.body.classList.toggle("battle-view", active);
  document.body.classList.toggle("battle-in-progress", active && started);
  const guide = document.getElementById("battleGuide");
  if (!guide) return;
  document.getElementById("battleHeading").textContent = result ? `戦闘終了：${result}` : started ? "戦闘中" : "戦闘準備";
  guide.textContent = result ? "戦果を確認して地図に戻れます。"
    : running ? "戦闘中です。速度変更・一時停止ができます。"
    : started ? "一時停止中です。再開ボタンで戦闘を続けます。"
    : !count ? "① おまかせ編成、または待機中の兵を出撃させてください。"
    : !applied ? "① 編成が変更されています。「編成を反映」を押してください。"
    : editing ? "② 配置を調整し、右の「保存」で確定してください。"
    : `出撃 ${count}部隊：配置・作戦を確認して戦闘を開始できます。`;
  document.getElementById("battleStepRoster").classList.toggle("complete", !!count && applied);
  document.getElementById("battleStepFormation").classList.toggle("current", !!count && applied && !started);
  document.getElementById("battleStepStart").classList.toggle("current", !!started);
  document.getElementById("battleStartBtn").textContent = result ? "戦闘終了" : running ? "戦闘中" : started ? "戦闘を再開" : "この編成で戦闘開始";
}
