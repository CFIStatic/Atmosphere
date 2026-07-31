// Shared behavior for the Atmosphere corporate site.
(function () {
  // Replay restarts the receipt animation — the audit trail's replay, embodied.
  var receipt = document.getElementById('receipt');
  var btn = document.getElementById('replay');
  if (receipt && btn) {
    btn.addEventListener('click', function () {
      var lines = receipt.querySelectorAll('.r-line, .r-divider, .r-status');
      lines.forEach(function (el) { el.style.animation = 'none'; });
      void receipt.offsetWidth;
      lines.forEach(function (el) { el.style.animation = ''; });
    });
  }
})();
