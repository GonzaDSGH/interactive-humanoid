/**
 * Overlay state machine: activation -> status -> (artwork | error).
 *
 * There is deliberately no state in which the overlay spins forever: every
 * asynchronous step in sketch.js is wrapped in a timeout that lands here.
 */
(function (global) {
  'use strict';

  var els = {};
  var onRetry = null;

  function el(id) {
    return document.getElementById(id);
  }

  function hideAll() {
    els.activate.hidden = true;
    els.status.hidden = true;
    els.error.hidden = true;
  }

  var UI = {
    init: function (handlers) {
      els.overlay = el('overlay');
      els.activate = el('panel-activate');
      els.status = el('panel-status');
      els.statusText = el('status-text');
      els.error = el('panel-error');
      els.errorTitle = el('error-title');
      els.errorText = el('error-text');
      els.errorDetail = el('error-detail');
      els.startButton = el('start-button');
      els.retryButton = el('retry-button');

      onRetry = handlers.onStart;
      els.startButton.addEventListener('click', handlers.onStart);
      els.retryButton.addEventListener('click', function () {
        if (onRetry) onRetry();
      });
    },

    showActivation: function () {
      hideAll();
      els.overlay.hidden = false;
      els.activate.hidden = false;
    },

    showStatus: function (message) {
      hideAll();
      els.overlay.hidden = false;
      els.status.hidden = false;
      els.statusText.textContent = message;
    },

    /** Hide the overlay entirely — from here on, only the artwork is visible. */
    showArtwork: function () {
      hideAll();
      els.overlay.hidden = true;
    },

    showError: function (title, message, detail) {
      hideAll();
      els.overlay.hidden = false;
      els.error.hidden = false;
      els.errorTitle.textContent = title;
      els.errorText.textContent = message;
      if (detail) {
        els.errorDetail.textContent = String(detail);
        els.errorDetail.hidden = false;
      } else {
        els.errorDetail.hidden = true;
      }
      console.error('[CPB] ' + title + ': ' + message, detail || '');
    }
  };

  global.CPB = global.CPB || {};
  global.CPB.UI = UI;
})(window);
