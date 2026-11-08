/*
 * Loads the real widget from the widget Edge Script and points the home page
 * chart at the API. Both are no-ops until config.js has been filled in.
 */
(function () {
  'use strict';

  var config = window.SMILES || {};
  var chart = document.getElementById('chart');

  if (!config.widget || !config.api) {
    document.querySelectorAll('[data-smiles]').forEach(function (node) {
      node.innerHTML =
        '<p style="margin:0;color:#b5b5b5;font-size:15px">' +
        'Not connected yet. Run <code>scripts/setup.sh</code> to deploy the API and widget.</p>';
    });
    return;
  }

  var params = new URLSearchParams({ tab: '1', label: 'Feedback', q: 'How is this looking?' });
  var tag = document.createElement('script');
  tag.src = config.widget + '/' + config.site + '.js?' + params;
  tag.async = true;
  tag.onload = start;
  document.head.appendChild(tag);

  function start() {
    if (!chart) return;
    window.Smiles.onVote(function () { setTimeout(refresh, 400); });
    refresh();
  }

  function refresh() {
    fetch(config.api + '/v1/stats/' + config.site)
      .then(function (res) { return res.json(); })
      .then(paint)
      .catch(function () { /* the page is still a page without numbers */ });
  }

  function paint(stats) {
    ['great', 'ok', 'bad'].forEach(function (key) {
      var pct = stats.total ? Math.round((stats[key] / stats.total) * 100) : 0;
      chart.querySelector('[data-bar="' + key + '"]').style.width = pct + '%';
      chart.querySelector('[data-count="' + key + '"]').textContent = stats[key];
    });
    chart.querySelector('[data-score]').textContent = stats.score === null ? 'n/a' : stats.score + '%';
    chart.querySelector('[data-total]').textContent = stats.total;
    chart.querySelector('[data-plural]').textContent = stats.total === 1 ? 'answer' : 'answers';
  }

  var refreshLink = chart && chart.querySelector('[data-refresh]');
  if (refreshLink) {
    refreshLink.addEventListener('click', function (e) { e.preventDefault(); refresh(); });
  }
}());
