(function() {
  "use strict";

  const cards = Array.from(document.querySelectorAll("[data-restore-card]"));
  const restoreAllButton = document.getElementById("restoreAll");
  const status = document.getElementById("restoreStatus");

  function remainingCount() {
    return cards.filter(function(card) { return !card.classList.contains("is-restored"); }).length;
  }

  function updateSummary(lastName) {
    const remaining = remainingCount();
    status.textContent = lastName + " restored locally. " + (remaining ? remaining + " remaining." : "All demo images restored.");
    restoreAllButton.disabled = remaining === 0;
    if (remaining === 0) {
      restoreAllButton.textContent = "All restored";
    }
  }

  function restoreCard(card, delay) {
    if (card.classList.contains("is-restored") || card.classList.contains("is-restoring")) {
      return;
    }

    const button = card.querySelector(".restore-card__button");
    const imageName = card.dataset.imageName;
    card.classList.add("is-restoring");
    button.disabled = true;
    button.textContent = "Restoring…";
    status.textContent = "Restoring " + imageName + "…";

    window.setTimeout(function() {
      card.classList.remove("is-restoring");
      card.classList.add("is-restored");
      button.textContent = "Restored locally";
      updateSummary(imageName);
    }, typeof delay === "number" ? delay : 600);
  }

  cards.forEach(function(card) {
    card.querySelector(".restore-card__button").addEventListener("click", function() {
      restoreCard(card);
    });
  });

  restoreAllButton.addEventListener("click", function() {
    const pending = cards.filter(function(card) { return !card.classList.contains("is-restored"); });
    restoreAllButton.disabled = true;
    pending.forEach(function(card, index) {
      window.setTimeout(function() { restoreCard(card, 500); }, index * 240);
    });
  });
})();
