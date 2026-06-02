(function () {
  "use strict";

  const STORAGE_KEY = "miniminic-save-v1";
  const MAX_CHARGES = 60;
  const CHARGE_INTERVAL_MS = 10000;
  const SLOT_COUNT = 10;

  const items = window.MINIMINIC_ITEMS || [];
  const rarities = window.MINIMINIC_RARITIES || [];
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const rarityMap = new Map(rarities.map((rarity) => [rarity.id, rarity]));

  const dropTable = [
    { rarity: "common", weight: 74.99 },
    { rarity: "uncommon", weight: 23 },
    { rarity: "rare", weight: 1.7 },
    { rarity: "legendary", weight: 0.3 },
    { rarity: "mythic", weight: 0.01 }
  ];

  const craftTable = {
    common: [
      { rarity: "common", weight: 80 },
      { rarity: "uncommon", weight: 20 }
    ],
    uncommon: [
      { rarity: "uncommon", weight: 75 },
      { rarity: "rare", weight: 25 }
    ],
    rare: [
      { rarity: "rare", weight: 70 },
      { rarity: "legendary", weight: 30 }
    ],
    legendary: [
      { rarity: "legendary", weight: 99 },
      { rarity: "mythic", weight: 1 }
    ]
  };

  const state = {
    charges: MAX_CHARGES,
    rechargeStartAt: Date.now(),
    inventory: {},
    collection: [],
    recentItemId: "",
    stats: {
      totalClicks: 0,
      totalCrafts: 0,
      bestRarity: ""
    }
  };

  const selection = [];
  let activeTab = "inventory";
  let messageTimer = 0;

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    bindElements();
    loadGame();
    normalizeRecharge();
    bindEvents();
    renderAll();
    setInterval(tick, 250);
  }

  function bindElements() {
    els.chargeText = document.getElementById("chargeText");
    els.rechargeText = document.getElementById("rechargeText");
    els.chestButton = document.getElementById("chestButton");
    els.recentItem = document.getElementById("recentItem");
    els.message = document.getElementById("message");
    els.tabButtons = Array.from(document.querySelectorAll(".tab-button"));
    els.panels = Array.from(document.querySelectorAll("[data-panel]"));
    els.craftSlots = document.getElementById("craftSlots");
    els.craftRule = document.getElementById("craftRule");
    els.craftButton = document.getElementById("craftButton");
    els.clearSlotsButton = document.getElementById("clearSlotsButton");
    els.inventoryList = document.getElementById("inventoryList");
    els.collectionList = document.getElementById("collectionList");
    els.statsGrid = document.getElementById("statsGrid");
    els.resetButton = document.getElementById("resetButton");
  }

  function bindEvents() {
    els.chestButton.addEventListener("click", openChest);
    els.craftButton.addEventListener("click", craftSelectedItems);
    els.clearSlotsButton.addEventListener("click", clearSelection);
    els.resetButton.addEventListener("click", resetGame);

    els.tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        activeTab = button.dataset.tab;
        renderTabs();
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space") {
        return;
      }

      const activeElement = document.activeElement;
      const tag = activeElement ? activeElement.tagName : "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (tag === "BUTTON" && activeElement !== els.chestButton)
      ) {
        return;
      }

      event.preventDefault();
      openChest();
    });
  }

  function createDefaultState() {
    return {
      charges: MAX_CHARGES,
      rechargeStartAt: Date.now(),
      inventory: {},
      collection: [],
      recentItemId: "",
      stats: {
        totalClicks: 0,
        totalCrafts: 0,
        bestRarity: ""
      }
    };
  }

  function loadGame() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      const fallback = createDefaultState();
      state.charges = clampNumber(parsed.charges, 0, MAX_CHARGES, fallback.charges);
      state.rechargeStartAt = Number.isFinite(parsed.rechargeStartAt)
        ? parsed.rechargeStartAt
        : fallback.rechargeStartAt;
      state.inventory = sanitizeInventory(parsed.inventory);
      state.collection = sanitizeCollection(parsed.collection);
      state.recentItemId = itemMap.has(parsed.recentItemId) ? parsed.recentItemId : "";
      state.stats = {
        totalClicks: Math.max(0, Number(parsed.stats && parsed.stats.totalClicks) || 0),
        totalCrafts: Math.max(0, Number(parsed.stats && parsed.stats.totalCrafts) || 0),
        bestRarity: rarityMap.has(parsed.stats && parsed.stats.bestRarity)
          ? parsed.stats.bestRarity
          : ""
      };
    } catch (error) {
      showMessage("저장 데이터를 불러오지 못했습니다. 새 게임으로 시작합니다.");
    }
  }

  function saveGame() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetGame() {
    const ok = window.confirm("저장된 Miniminic 데이터를 초기화할까요?");
    if (!ok) {
      return;
    }

    Object.assign(state, createDefaultState());
    selection.length = 0;
    localStorage.removeItem(STORAGE_KEY);
    saveGame();
    showMessage("게임 데이터가 초기화되었습니다.");
    renderAll();
  }

  function sanitizeInventory(rawInventory) {
    const clean = {};
    if (!rawInventory || typeof rawInventory !== "object") {
      return clean;
    }

    Object.entries(rawInventory).forEach(([id, count]) => {
      if (itemMap.has(id)) {
        const safeCount = Math.max(0, Math.floor(Number(count) || 0));
        if (safeCount > 0) {
          clean[id] = safeCount;
        }
      }
    });

    return clean;
  }

  function sanitizeCollection(rawCollection) {
    if (!Array.isArray(rawCollection)) {
      return [];
    }

    return Array.from(new Set(rawCollection.filter((id) => itemMap.has(id))));
  }

  function tick() {
    normalizeRecharge();
    renderTopbar();
  }

  // 방치 중 지난 시간을 계산해 클릭 가능 횟수를 충전한다.
  function normalizeRecharge() {
    const now = Date.now();

    if (state.charges >= MAX_CHARGES) {
      state.charges = MAX_CHARGES;
      state.rechargeStartAt = now;
      return;
    }

    const elapsed = now - state.rechargeStartAt;
    if (elapsed < CHARGE_INTERVAL_MS) {
      return;
    }

    const gained = Math.floor(elapsed / CHARGE_INTERVAL_MS);
    state.charges = Math.min(MAX_CHARGES, state.charges + gained);

    if (state.charges >= MAX_CHARGES) {
      state.rechargeStartAt = now;
    } else {
      state.rechargeStartAt += gained * CHARGE_INTERVAL_MS;
    }

    saveGame();
  }

  function openChest() {
    normalizeRecharge();

    if (state.charges < 1) {
      showMessage("클릭 가능 횟수가 부족합니다. 잠시 후 다시 열어보세요.");
      renderTopbar();
      return;
    }

    if (state.charges === MAX_CHARGES) {
      state.rechargeStartAt = Date.now();
    }

    state.charges -= 1;
    state.stats.totalClicks += 1;

    const item = rollDropItem();
    gainItem(item);
    state.recentItemId = item.id;

    saveGame();
    animateChest();
    renderAll();
    animateRecentItem();
    showMessage(`${getRarityLabel(item.rarity)} 아이템을 획득했습니다.`);
  }

  function rollDropItem() {
    const rarity = rollWeightedRarity(dropTable);
    return rollItemByRarity(rarity);
  }

  function rollItemByRarity(rarity) {
    const candidates = items.filter((item) => item.rarity === rarity);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function rollWeightedRarity(table) {
    const total = table.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;

    for (const entry of table) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.rarity;
      }
    }

    return table[table.length - 1].rarity;
  }

  function gainItem(item) {
    state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;

    if (!state.collection.includes(item.id)) {
      state.collection.push(item.id);
    }

    updateBestRarity(item.rarity);
  }

  function updateBestRarity(rarity) {
    const currentOrder = state.stats.bestRarity ? getRarityOrder(state.stats.bestRarity) : -1;
    const nextOrder = getRarityOrder(rarity);
    if (nextOrder > currentOrder) {
      state.stats.bestRarity = rarity;
    }
  }

  function addToSelection(itemId) {
    const item = itemMap.get(itemId);
    if (!item) {
      return;
    }

    if (selection.length >= SLOT_COUNT) {
      showMessage("합성 슬롯이 모두 찼습니다.");
      return;
    }

    const baseRarity = getSelectionRarity();
    if (baseRarity && baseRarity !== item.rarity) {
      showMessage(`합성 기준은 ${getRarityLabel(baseRarity)}입니다. 같은 레어도만 넣을 수 있습니다.`);
      return;
    }

    if (getAvailableCount(itemId) <= 0) {
      showMessage("선택 가능한 보유 수량이 없습니다.");
      return;
    }

    selection.push(itemId);
    renderInventoryPanel();
  }

  function removeFromSelection(index) {
    selection.splice(index, 1);
    renderInventoryPanel();
  }

  function clearSelection() {
    if (selection.length === 0) {
      showMessage("비울 합성 슬롯이 없습니다.");
      return;
    }

    selection.length = 0;
    showMessage("합성 선택을 초기화했습니다.");
    renderInventoryPanel();
  }

  function craftSelectedItems() {
    if (selection.length < SLOT_COUNT) {
      showMessage("합성 슬롯 10칸을 모두 채워야 합니다.");
      return;
    }

    const baseRarity = getSelectionRarity();
    if (baseRarity === "mythic") {
      showMessage("신화 등급은 최종 등급이라 합성할 수 없습니다.");
      return;
    }

    if (!craftTable[baseRarity]) {
      showMessage("합성할 수 없는 레어도입니다.");
      return;
    }

    const counts = countIds(selection);
    const hasEnough = Object.entries(counts).every(([id, amount]) => (state.inventory[id] || 0) >= amount);
    if (!hasEnough) {
      showMessage("인벤토리 수량이 부족합니다.");
      selection.length = 0;
      renderInventoryPanel();
      return;
    }

    // 선택한 10개를 실제 인벤토리에서 차감한 뒤 결과 아이템을 지급한다.
    Object.entries(counts).forEach(([id, amount]) => {
      state.inventory[id] -= amount;
      if (state.inventory[id] <= 0) {
        delete state.inventory[id];
      }
    });

    const resultRarity = rollWeightedRarity(craftTable[baseRarity]);
    const resultItem = rollItemByRarity(resultRarity);
    gainItem(resultItem);
    state.recentItemId = resultItem.id;
    state.stats.totalCrafts += 1;
    selection.length = 0;

    saveGame();
    renderAll();
    animateRecentItem();
    showMessage(`합성 성공! ${getRarityLabel(resultItem.rarity)} ${resultItem.name} 획득`);
  }

  function countIds(ids) {
    return ids.reduce((counts, id) => {
      counts[id] = (counts[id] || 0) + 1;
      return counts;
    }, {});
  }

  function getSelectionRarity() {
    if (selection.length === 0) {
      return "";
    }

    const firstItem = itemMap.get(selection[0]);
    return firstItem ? firstItem.rarity : "";
  }

  function getSelectedCount(itemId) {
    return selection.filter((id) => id === itemId).length;
  }

  function getAvailableCount(itemId) {
    return (state.inventory[itemId] || 0) - getSelectedCount(itemId);
  }

  function renderAll() {
    renderTopbar();
    renderRecentItem();
    renderTabs();
    renderInventoryPanel();
    renderCollection();
    renderStats();
  }

  function renderTopbar() {
    els.chargeText.textContent = `${state.charges} / ${MAX_CHARGES}`;

    if (state.charges >= MAX_CHARGES) {
      els.rechargeText.textContent = "최대";
      return;
    }

    const elapsed = Date.now() - state.rechargeStartAt;
    const remaining = Math.max(0, CHARGE_INTERVAL_MS - (elapsed % CHARGE_INTERVAL_MS));
    els.rechargeText.textContent = formatTime(remaining);
  }

  function renderRecentItem() {
    const item = itemMap.get(state.recentItemId);
    if (!item) {
      els.recentItem.innerHTML = `
        <span class="recent-label">최근 획득</span>
        <strong>아직 획득한 아이템이 없습니다.</strong>
      `;
      return;
    }

    els.recentItem.innerHTML = `
      <span class="recent-label">최근 획득</span>
      <strong class="rarity-${item.rarity}">${getRarityLabel(item.rarity)} · ${item.name}</strong>
    `;
  }

  function renderTabs() {
    els.tabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === activeTab);
    });

    els.panels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === activeTab);
    });
  }

  function renderInventoryPanel() {
    renderCraftSlots();
    renderInventory();
    renderCraftRule();
  }

  function renderCraftSlots() {
    els.craftSlots.innerHTML = "";

    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const item = itemMap.get(selection[index]);
      const button = document.createElement("button");
      button.type = "button";
      button.className = item ? `slot filled rarity-border-${item.rarity}` : "slot";
      button.setAttribute("aria-label", item ? `${item.name} 선택 해제` : `빈 합성 슬롯 ${index + 1}`);

      if (item) {
        button.innerHTML = `
          <span>${getRarityLabel(item.rarity)}</span>
          <strong>${item.name}</strong>
        `;
        button.addEventListener("click", () => removeFromSelection(index));
      } else {
        button.innerHTML = `<span>${index + 1}</span>`;
      }

      els.craftSlots.appendChild(button);
    }
  }

  function renderCraftRule() {
    const rarity = getSelectionRarity();
    if (!rarity) {
      els.craftRule.textContent = "첫 아이템의 레어도가 합성 기준이 됩니다.";
      return;
    }

    if (rarity === "mythic") {
      els.craftRule.textContent = "신화 등급은 최종 등급이라 합성할 수 없습니다.";
      return;
    }

    const rule = craftTable[rarity]
      .map((entry) => `${getRarityLabel(entry.rarity)} ${entry.weight}%`)
      .join(", ");
    els.craftRule.textContent = `${getRarityLabel(rarity)} 10개 → ${rule}`;
  }

  function renderInventory() {
    els.inventoryList.innerHTML = "";

    rarities.forEach((rarity) => {
      const ownedItems = items.filter((item) => item.rarity === rarity.id && state.inventory[item.id] > 0);
      const group = document.createElement("section");
      group.className = "rarity-group";

      const title = document.createElement("h3");
      title.className = `rarity-${rarity.id}`;
      title.textContent = rarity.label;
      group.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "item-grid";

      if (ownedItems.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-text";
        empty.textContent = "보유 아이템 없음";
        grid.appendChild(empty);
      } else {
        ownedItems.forEach((item) => {
          const available = getAvailableCount(item.id);
          const button = document.createElement("button");
          button.type = "button";
          button.className = `item-button rarity-border-${item.rarity}`;
          button.disabled = available <= 0;
          button.innerHTML = `
            <strong>${item.name}</strong>
            <span>보유 ${state.inventory[item.id]} · 선택 가능 ${Math.max(0, available)}</span>
          `;
          button.addEventListener("click", () => addToSelection(item.id));
          grid.appendChild(button);
        });
      }

      group.appendChild(grid);
      els.inventoryList.appendChild(group);
    });
  }

  function renderCollection() {
    els.collectionList.innerHTML = "";

    rarities.forEach((rarity) => {
      const group = document.createElement("section");
      group.className = "rarity-group";

      const title = document.createElement("h3");
      title.className = `rarity-${rarity.id}`;
      title.textContent = rarity.label;
      group.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "collection-grid";

      items
        .filter((item) => item.rarity === rarity.id)
        .forEach((item) => {
          const found = state.collection.includes(item.id);
          const cell = document.createElement("div");
          cell.className = found ? `collection-item rarity-border-${item.rarity}` : "collection-item locked";
          cell.innerHTML = found
            ? `<span>${getRarityLabel(item.rarity)}</span><strong>${item.name}</strong>`
            : `<span>${getRarityLabel(item.rarity)}</span><strong>???</strong>`;
          grid.appendChild(cell);
        });

      group.appendChild(grid);
      els.collectionList.appendChild(group);
    });
  }

  function renderStats() {
    const foundCount = state.collection.length;
    const rate = items.length === 0 ? 0 : Math.round((foundCount / items.length) * 1000) / 10;
    const best = state.stats.bestRarity ? getRarityLabel(state.stats.bestRarity) : "없음";

    const stats = [
      { label: "총 클릭 수", value: state.stats.totalClicks.toLocaleString("ko-KR") },
      { label: "총 합성 수", value: state.stats.totalCrafts.toLocaleString("ko-KR") },
      { label: "최고 획득 레어도", value: best },
      { label: "도감 달성률", value: `${foundCount} / ${items.length} (${rate}%)` }
    ];

    els.statsGrid.innerHTML = stats
      .map((entry) => `
        <div class="stat-box">
          <span>${entry.label}</span>
          <strong>${entry.value}</strong>
        </div>
      `)
      .join("");
  }

  function showMessage(text) {
    window.clearTimeout(messageTimer);
    els.message.textContent = text;
    els.message.classList.add("visible");
    messageTimer = window.setTimeout(() => {
      els.message.classList.remove("visible");
    }, 2400);
  }

  function animateChest() {
    const chest = els.chestButton.querySelector(".treasure-chest");
    if (window.gsap) {
      window.gsap
        .timeline()
        .to(chest, { scaleY: 0.9, scaleX: 1.05, y: 8, duration: 0.08, ease: "power1.out" })
        .to(chest, { scaleY: 1.05, scaleX: 0.96, y: -8, duration: 0.14, ease: "back.out(2)" })
        .to(chest, { scaleY: 1, scaleX: 1, y: 0, duration: 0.12, ease: "power1.out" });
      return;
    }

    chest.classList.remove("css-pop");
    void chest.offsetWidth;
    chest.classList.add("css-pop");
  }

  function animateRecentItem() {
    if (window.gsap) {
      window.gsap.fromTo(
        els.recentItem,
        { y: 12, opacity: 0.25 },
        { y: 0, opacity: 1, duration: 0.28, ease: "power2.out" }
      );
      return;
    }

    els.recentItem.classList.remove("css-appear");
    void els.recentItem.offsetWidth;
    els.recentItem.classList.add("css-appear");
  }

  function getRarityLabel(rarityId) {
    return rarityMap.get(rarityId) ? rarityMap.get(rarityId).label : rarityId;
  }

  function getRarityOrder(rarityId) {
    return rarityMap.get(rarityId) ? rarityMap.get(rarityId).order : -1;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  window.resetGame = resetGame;
})();
