/* ===========================================================
   Alem leaderboard — vanilla JS, JSON-driven
   =========================================================== */
(function () {
  "use strict";

  var SCALE = 25;            // % axis ceiling for CI bars (max datum ~22)
  var state = { diff: "hard", view: "all", sortKey: "total", sortDir: "desc", rlDiff: "hard", rlBudget: "1B" };
  var DATA = null;
  var RLDATA = null;
  var RUN_CONFIGS = null;
  var RUN_CONFIGS_PROMISE = null;

  /* ---------- environment comparison (from paper Tbl. of related envs) ---------- */
  var CMP = [
    { name: "SMAC / SMACv2 / SMAX", c: ["n", "n", "p", "n"] },
    { name: "Overcooked / Overcooked2", c: ["n", "n", "p", "n"] },
    { name: "Hanabi", c: ["n", "n", "p", "n"] },
    { name: "Melting Pot", c: ["p", "n", "p", "n"] },
    { name: "Concordia", c: ["n", "n", "p", "n"] },
    { name: "HECOGrid", c: ["n", "n", "y", "y"] },
    { name: "GPUDrive", c: ["n", "n", "n", "n"] },
    { name: "Neural MMO", c: ["y", "y", "p", "n"] },
    { name: "Multi-Agent Craftax v1", c: ["y", "y", "p", "n"] },
    { name: "Craftax-Coop", c: ["y", "y", "p", "n"] },
    { name: "Alem", c: ["y", "y", "y", "y"], alem: true }
  ];

  function markCell(v) {
    if (v === "y") return '<span class="mark-yes">✓</span>';
    if (v === "p") return '<span class="mark-partial">~</span>';
    return '<span class="mark-no">✗</span>';
  }

  function renderCmp() {
    var tb = document.querySelector(".cmp-table tbody");
    if (!tb) return;
    tb.innerHTML = CMP.map(function (r) {
      return (
        '<tr class="' + (r.alem ? "is-alem" : "") + '"><td>' + r.name + "</td>" +
        r.c.map(function (v) { return "<td>" + markCell(v) + "</td>"; }).join("") +
        "</tr>"
      );
    }).join("");
  }

  /* ---------- leaderboard ---------- */
  function num(v) { return v.toFixed(1); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>\"]/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]; }); }

  function barHTML(metricClass, score) {
    var mean = score[0], lo = score[1], hi = score[2];
    var left = (lo / SCALE) * 100;
    var width = Math.max(((hi - lo) / SCALE) * 100, 0.5);
    var dot = (mean / SCALE) * 100;
    return (
      '<div class="num-cell ' + metricClass + '">' +
      '<div class="num-val">' + num(mean) + "</div>" +
      '<div class="num-ci">[' + num(lo) + ", " + num(hi) + "]</div>" +
      '<div class="bar-track">' +
      '<div class="bar-ci" style="left:' + left + "%;width:" + width + '%"></div>' +
      '<div class="bar-dot" style="left:' + dot + '%"></div>' +
      "</div></div>"
    );
  }

  function typePill(type) {
    var label = type === "open-weight" ? "Open-weight" : type === "proprietary" ? "Closed (API)" : "MARL";
    return '<span class="type-pill type-' + type + '">' + label + "</span>";
  }

  function rowDate(m) {
    return (m.eval_dates && m.eval_dates[state.diff]) || m.eval_date || (DATA && DATA.meta && DATA.meta.evaluation_date) || "—";
  }

  function harnessVersion(m) {
    return m.harness_version || (DATA && DATA.meta && (DATA.meta.harness_version || DATA.meta.harness)) || "—";
  }

  function hasHarnessColumn() {
    return !!document.querySelector("#board-table th.col-harness");
  }

  function harnessCell(m) {
    if (!hasHarnessColumn()) return "";
    var hv = harnessVersion(m);
    var href = m.harness_url || (hv.indexOf("robust_all") === 0 ? "https://github.com/alem-world/alem-env/blob/main/baselines/llm/eval_utils/agents/robust_all.py" : "");
    var content = href
      ? '<a class="harness-link" href="' + href + '" target="_blank" rel="noopener">' + hv + '</a>'
      : '<span class="harness-link is-static">' + hv + '</span>';
    return '<td class="col-harness" data-label="Harness">' + content + '</td>';
  }

  function typeRunCell(m) {
    return (
      '<td class="col-type" data-label="Type / date"><div class="type-run">' +
      typePill(m.type) +
      '<span class="run-meta"><span>' + rowDate(m) + '</span></span>' +
      '</div></td>'
    );
  }

  function rowHTML(m, rank, isMarl) {
    var s = m.scores[state.diff];
    var rankLabel = rank === null ? '<span style="color:var(--faint)">ref</span>' : rank;
    return (
      '<tr class="' + (isMarl ? "is-marl" : "rank-" + rank) + ' is-clickable" data-mid="' + m.id + '" data-marl="' + (isMarl ? 1 : 0) + '" tabindex="0">' +
      '<td class="col-rank" data-label="Rank">' + rankLabel + "</td>" +
      "<td data-label='Model'><div class='model-cell'>" +
      "<span class='model-name'>" + m.name + "</span>" +
      "<span class='model-config'>" + (m.params && m.params !== "—" ? m.params + " · " : "") + m.config + "</span>" +
      "</div></td>" +
      typeRunCell(m) +
      harnessCell(m) +
      '<td class="score-cell" data-label="Base%" onclick="window.AlemOpenModelDetail && window.AlemOpenModelDetail(\'' + m.id + '\')" title="Click to inspect the run config">' + barHTML("m-base", s.base) + "</td>" +
      '<td class="score-cell" data-label="Coord.%" onclick="window.AlemOpenModelDetail && window.AlemOpenModelDetail(\'' + m.id + '\')" title="Click to inspect the run config">' + barHTML("m-coord", s.coord) + "</td>" +
      '<td class="score-cell" data-label="Total%" onclick="window.AlemOpenModelDetail && window.AlemOpenModelDetail(\'' + m.id + '\')" title="Click to inspect the run config">' + barHTML("m-total", s.total) + "</td>" +
      "</tr>"
    );
  }

  function avgRowHTML() {
    var a = DATA.averages[state.diff];
    function cell(v, cls, label) { return "<td data-label='" + label + "'><div class='num-cell " + cls + "'><div class='num-val'>" + num(v) + "</div></div></td>"; }
    var harnessPad = hasHarnessColumn() ? "<td data-label='Harness'></td>" : "";
    return (
      "<tr style='background:var(--bg-2)'>" +
      "<td class='col-rank' data-label='Rank'></td>" +
      "<td data-label='Model'><span class='model-name' style='color:var(--muted);font-style:italic'>Across LLM agents</span></td>" +
      "<td data-label='Type / date'></td>" + harnessPad + cell(a.base, "m-base", "Base%") + cell(a.coord, "m-coord", "Coord.%") + cell(a.total, "m-total", "Total%") +
      "</tr>"
    );
  }

  function sortRows(rows) {
    var k = state.sortKey, dir = state.sortDir === "desc" ? -1 : 1;
    return rows.slice().sort(function (x, y) {
      if (k === "name") return dir * x.name.localeCompare(y.name);
      if (k === "type") return dir * x.type.localeCompare(y.type);
      if (k === "harness") return dir * harnessVersion(x).localeCompare(harnessVersion(y));
      return dir * (x.scores[state.diff][k][0] - y.scores[state.diff][k][0]);
    });
  }

  function renderBoard() {
    var tb = document.querySelector("#board-table tbody");
    var html = "";

    var llm = state.view === "marl" ? [] : sortRows(DATA.homogeneous);
    var marl = state.view === "llm" ? [] : sortRows(DATA.marl);

    llm.forEach(function (m, i) { html += rowHTML(m, i + 1, false); });
    if (llm.length) html += avgRowHTML();
    marl.forEach(function (m, i) {
      html += rowHTML(m, state.view === "marl" ? i + 1 : null, true);
    });
    tb.innerHTML = html;

    // header sort indicators
    document.querySelectorAll("#board-table th.sortable").forEach(function (th) {
      th.classList.toggle("is-sorted", th.dataset.sort === state.sortKey);
      th.classList.toggle("asc", th.dataset.sort === state.sortKey && state.sortDir === "asc");
    });

    var meta = document.getElementById("board-meta");
    if (meta) {
      var n = llm.length + marl.length;
      meta.textContent = n + " systems · " + state.diff.charAt(0).toUpperCase() + state.diff.slice(1) + " · " + (DATA.meta.harness_version || "harness") + " · 95% CI";
    }
  }

  /* ---------- model detail (click a row → full config) ---------- */
  function findModel(id) {
    var all = (DATA.homogeneous || []).concat(DATA.marl || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function fmtScore(t) { return t ? num(t[0]) + ' <span class="md-ci">[' + num(t[1]) + ", " + num(t[2]) + "]</span>" : "—"; }
  function loadRunConfigs() {
    if (RUN_CONFIGS) return Promise.resolve(RUN_CONFIGS);
    if (!RUN_CONFIGS_PROMISE) {
      RUN_CONFIGS_PROMISE = fetch("data/llm-run-configs.json")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { RUN_CONFIGS = j; return j; });
    }
    return RUN_CONFIGS_PROMISE;
  }
  function hydraOverrides(config) {
    if (!config) return "";
    var parts = [];
    ["ALG_NAME", "ENV_NAME", "COORDINATION_DIFFICULTY", "NUM_AGENTS", "MAX_TIMESTEPS", "EVAL_SEED", "SOFT_SPECIALIZATION", "SHARED_REWARD"].forEach(function (k) {
      if (config[k] !== undefined) parts.push(k + "=" + JSON.stringify(config[k]));
    });
    if (config.agent) {
      ["type", "reasoning", "use_communication", "use_scratchpad", "max_text_history", "max_communication_history", "prompt_mode"].forEach(function (k) {
        if (config.agent[k] !== undefined) parts.push("agent." + k + "=" + JSON.stringify(config.agent[k]));
      });
    }
    if (config.clients && config.clients[0]) {
      var c = config.clients[0];
      ["client_name", "model_id", "timeout"].forEach(function (k) { if (c[k] !== undefined) parts.push("clients.0." + k + "=" + JSON.stringify(c[k])); });
      if (c.generate_kwargs) Object.keys(c.generate_kwargs).forEach(function (k) { parts.push("clients.0.generate_kwargs." + k + "=" + JSON.stringify(c.generate_kwargs[k])); });
    }
    if (config.eval) {
      ["num_workers", "max_steps_per_episode", "run_name", "debug"].forEach(function (k) { if (config.eval[k] !== undefined) parts.push("eval." + k + "=" + JSON.stringify(config.eval[k])); });
    }
    return parts.map(function (p) { return "  " + p; }).join(" \\\n");
  }
  function runCommand(entry) {
    var cfg = entry.config || {};
    var moduleName = "baselines.llm.eval";
    return "python -m " + moduleName + " \\\n" + hydraOverrides(cfg);
  }
  function rlAlgoSpec(id) {
    return {
      "ippo-rnn": { script: "baselines/ippo_rnn.py", run: "IPPO", extra: "LR=0.0003 CLIP_EPS=0.2 UPDATE_EPOCHS=4 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=tanh GAE_LAMBDA=0.8" },
      "hypermarl-rnn": { script: "baselines/ippo_hypermarl_rnn.py", run: "IPPO-HyperMARL", extra: "LR=0.0003 CLIP_EPS=0.2 UPDATE_EPOCHS=4 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=relu GAE_LAMBDA=0.8" },
      "mappo-rnn": { script: "baselines/mappo_rnn.py", run: "MAPPO", extra: "LR=0.0003 CLIP_EPS=0.2 UPDATE_EPOCHS=2 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=tanh GAE_LAMBDA=0.8" },
      "pqn-vdn-rnn": { script: "baselines/pqn_vdn_rnn.py", run: "PQN-VDN", extra: "TOTAL_TIMESTEPS_DECAY={steps}" }
    }[id] || { script: "baselines/ippo_rnn.py", run: id, extra: "NUM_COMM_CHANNELS=4" };
  }
  function rlCommand(algo, diff, budget) {
    var spec = rlAlgoSpec(algo.id);
    var steps = budget === "1B" ? "1e9" : "1e8";
    var diffTitle = diff.charAt(0).toUpperCase() + diff.slice(1);
    var extra = spec.extra.replace("{steps}", steps);
    return "# Local single-seed run. Change SEED to repeat across seeds.\n" +
      "python " + spec.script + " -m \\\n" +
      "  WANDB_MODE=offline ENTITY=alem-world PROJECT=alem \\\n" +
      "  ENV_NAME=\"Alem-Coop-Symbolic\" \\\n" +
      "  SEED=0 \\\n" +
      "  RUN_NAME=\"" + spec.run + "-Overfit-" + diffTitle + "-" + budget + "-seed0\" \\\n" +
      "  SHARED_REWARD=false \\\n" +
      "  SOFT_SPECIALIZATION=True \\\n" +
      "  RUN_TAGS=[\"final\",\"legal\",\"overfit\"] \\\n" +
      "  TRAINING_COORDINATION_DIFFICULTY=" + diff + " \\\n" +
      "  EVAL_DIFFICULTIES=[" + diff + "] \\\n" +
      "  SCALE_BASE_DIFFICULTY=True \\\n" +
      "  ACTION_MASKING=true \\\n" +
      "  " + extra + " TOTAL_TIMESTEPS=" + steps + " NUM_COMM_CHANNELS=4";
  }
  function renderRunConfig(mid, diff) {
    var box = document.getElementById("md-config");
    if (!box) return;
    box.innerHTML = '<div class="md-config-loading">Loading run config…</div>';
    loadRunConfigs().then(function (cfgs) {
      var entry = cfgs && cfgs.models && cfgs.models[mid] && cfgs.models[mid][diff];
      if (!entry) {
        box.innerHTML = '<p class="md-note">No LLM config found for this score.</p>';
        return;
      }
      var configOnly = { alg_name: entry.alg_name, config: entry.config };
      var pretty = JSON.stringify(configOnly, null, 2);
      box.innerHTML =
        '<details class="md-json" open><summary>How to run <span>' + esc(diff) + '</span></summary>' +
        '<pre><code>' + esc(runCommand(entry)) + '</code></pre></details>' +
        '<details class="md-json" open><summary>Config JSON <span>alg_name + config only</span></summary>' +
        '<pre><code>' + esc(pretty) + '</code></pre></details>';
    }).catch(function (err) {
      box.innerHTML = '<p class="md-note">Could not load run config: ' + esc(err.message || err) + '</p>';
    });
  }
  function ensureModelModal() {
    var m = document.getElementById("model-modal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "model-modal"; m.className = "trace-modal"; m.hidden = true;
    m.innerHTML =
      '<div class="trace-backdrop" data-md-close></div>' +
      '<div class="trace-dialog md-dialog" role="dialog" aria-modal="true" aria-label="Model details">' +
      '<div class="trace-head"><div><span class="trace-model" id="md-name"></span>' +
      '<span class="trace-sub" id="md-sub"></span></div>' +
      '<button class="trace-close" data-md-close aria-label="Close">✕</button></div>' +
      '<div class="md-body" id="md-body"></div></div>';
    document.body.appendChild(m);
    m.querySelectorAll("[data-md-close]").forEach(function (b) { b.addEventListener("click", closeModelModal); });
    return m;
  }
  function closeModelModal() { var m = document.getElementById("model-modal"); if (m) { m.hidden = true; document.body.style.overflow = ""; } }
  function openModelDetail(id) {
    var m = findModel(id); if (!m) return;
    var modal = ensureModelModal();
    var isMarl = m.type === "marl";
    document.getElementById("md-name").textContent = m.name;
    document.getElementById("md-sub").textContent = typeLabel(m.type) + (m.params && m.params !== "—" ? " · " + m.params : "");
    var diffs = ["easy", "medium", "hard"];
    var rows = diffs.map(function (d) {
      var s = m.scores[d]; if (!s) return "";
      return "<tr><td>" + d.charAt(0).toUpperCase() + d.slice(1) + "</td>" +
        "<td>" + fmtScore(s.base) + "</td><td>" + fmtScore(s.coord) + "</td><td class='md-total'>" + fmtScore(s.total) + "</td></tr>";
    }).join("");
    function meta(label, val) { return val ? '<div class="md-meta"><span>' + label + "</span><strong>" + val + "</strong></div>" : ""; }
    var ed = m.eval_dates ? Object.keys(m.eval_dates).map(function (k) { return k + " " + m.eval_dates[k]; }).join(" · ") : (m.eval_date || "");
    var harnessLink = !isMarl && m.harness_version ?
      '<a href="https://github.com/alem-world/alem-env/blob/main/baselines/llm/eval_utils/agents/robust_all.py" target="_blank" rel="noopener">' + m.harness_version + " ↗</a>" :
      (m.harness_version || "—");
    document.getElementById("md-body").innerHTML =
      '<div class="md-metas">' +
        meta("Type", typeLabel(m.type)) +
        meta(isMarl ? "Budget" : "Parameters", m.params) +
        meta("Family", m.family) +
        meta(isMarl ? "Algorithm" : "Harness", isMarl ? m.config : harnessLink) +
        (!isMarl ? meta("Config", m.config) : "") +
        meta("Eval date", ed) +
        meta("Status", m.verified ? "✓ verified" : "self-reported") +
      "</div>" +
      '<h4 class="md-h">Scores by difficulty <span>· mean [95% CI], normalised per category</span></h4>' +
      '<div class="table-scroll"><table class="md-table"><thead><tr><th>Difficulty</th><th>Base%</th><th>Coord.%</th><th>Total%</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (!isMarl ? '<p class="md-note">This is the exact run config behind the selected leaderboard score. Reproduce with the standard protocol — see <a href="https://github.com/alem-world/alem-env/blob/main/SUBMISSION.md" target="_blank" rel="noopener">SUBMISSION.md</a>.</p><div id="md-config"></div>' : '<p class="md-note">This row is a reference aggregate from the dedicated MARL comparison table below. Click rows in that MARL table for algorithm-specific run commands.</p>');
    modal.hidden = false; document.body.style.overflow = "hidden";
    if (!isMarl) renderRunConfig(m.id, state.diff);
  }
  window.AlemOpenModelDetail = openModelDetail;
  function typeLabel(t) { return t === "open-weight" ? "Open-weight" : t === "proprietary" ? "Closed (API)" : "MARL baseline"; }

  function bindModelDetail() {
    var tb = document.querySelector("#board-table tbody");
    if (!tb) return;
    tb.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a,button")) return;
      var tr = e.target.closest ? e.target.closest("tr[data-mid]") : null;
      if (tr) openModelDetail(tr.getAttribute("data-mid"));
    });
    tb.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var tr = e.target.closest ? e.target.closest("tr[data-mid]") : null;
      if (tr) openModelDetail(tr.getAttribute("data-mid"));
    });
    document.addEventListener("keydown", function (e) {
      var m = document.getElementById("model-modal");
      if (m && !m.hidden && e.key === "Escape") closeModelModal();
    });
  }

  /* ---------- heterogeneous teams ---------- */
  function renderHetero() {
    var wrap = document.getElementById("hetero-grid");
    if (!wrap || !DATA.heterogeneous) return;
    var MAX = 18;
    wrap.innerHTML = DATA.heterogeneous.teams.map(function (t) {
      var members = Object.keys(t.member_totals).map(function (name) {
        var v = t.member_totals[name];
        return (
          '<div class="hbar"><div class="hbar-top"><span>' + name + '</span><span class="hbar-val">' + num(v) + '%</span></div>' +
          '<div class="hbar-track"><div class="hbar-fill" style="width:' + (v / MAX * 100) + '%"></div></div></div>'
        );
      }).join("");
      var teamBar =
        '<div class="hbar is-team"><div class="hbar-top"><span><b>' + t.name + '</b></span><span class="hbar-val">' + num(t.team_total) + '%</span></div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + (t.team_total / MAX * 100) + '%"></div></div></div>';
      var dcls = t.delta >= 0 ? "delta-pos" : "delta-neg";
      var dsign = t.delta >= 0 ? "+" : "";
      return (
        '<div class="hetero-card">' +
        "<h4>" + t.name + "</h4>" +
        '<div class="hetero-kind">' + t.kind.replace("-", " ") + " team</div>" +
        members +
        '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">' +
        teamBar +
        '<div class="hetero-delta ' + dcls + '">' + dsign + num(t.delta) + " vs homogeneous average (" + num(t.homog_avg) + "%)</div>" +
        "</div>"
      );
    }).join("");
  }

  /* ---------- events ---------- */
  function bindControls() {
    document.querySelectorAll(".seg-btn[data-diff]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.diff === state.diff);
      b.addEventListener("click", function () {
        state.diff = b.dataset.diff;
        document.querySelectorAll(".seg-btn[data-diff]").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        renderBoard();
      });
    });
    document.querySelectorAll(".seg-btn[data-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.view = b.dataset.view;
        document.querySelectorAll(".seg-btn[data-view]").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        renderBoard();
      });
    });
    document.querySelectorAll("#board-table th.sortable").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.sort;
        if (state.sortKey === k) {
          state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
        } else {
          state.sortKey = k;
          state.sortDir = k === "name" ? "asc" : "desc";
        }
        renderBoard();
      });
    });
  }

  function bindCopy() {
    var btn = document.getElementById("copy-bib");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var txt = document.getElementById("bibtex").textContent;
      navigator.clipboard.writeText(txt).then(function () {
        btn.textContent = "Copied ✓";
        btn.classList.add("copied");
        setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1800);
      });
    });
  }

  /* ---------- secondary RL leaderboard ---------- */
  function openRLDetail(algoId) {
    if (!RLDATA) return;
    var algo = (RLDATA.algos || []).find(function (a) { return a.id === algoId; });
    if (!algo) return;
    var budget = (RLDATA.data || {})[state.rlBudget] || {};
    var scores = (budget[algo.id] || {})[state.rlDiff];
    var modal = ensureModelModal();
    document.getElementById("md-name").textContent = algo.name;
    document.getElementById("md-sub").textContent = "MARL algorithm · " + state.rlBudget + " · " + state.rlDiff;
    var scoreRows = scores ? '<div class="table-scroll"><table class="md-table"><thead><tr><th>Metric</th><th>Mean [95% CI]</th></tr></thead><tbody>' +
      '<tr><td>Base%</td><td>' + fmtScore(scores.base) + '</td></tr>' +
      '<tr><td>Coord.%</td><td>' + fmtScore(scores.coord) + '</td></tr>' +
      '<tr><td>Total%</td><td class="md-total">' + fmtScore(scores.total) + '</td></tr>' +
      '</tbody></table></div>' : "";
    document.getElementById("md-body").innerHTML =
      '<div class="md-metas">' +
        '<div class="md-meta"><span>Algorithm</span><strong>' + esc(algo.name) + '</strong></div>' +
        '<div class="md-meta"><span>Budget</span><strong>' + esc(state.rlBudget) + ' steps</strong></div>' +
        '<div class="md-meta"><span>Difficulty</span><strong>' + esc(state.rlDiff) + '</strong></div>' +
        '<div class="md-meta"><span>Seeds</span><strong>5</strong></div>' +
      '</div>' +
      scoreRows +
      '<p class="md-note">This command is shown only for the dedicated MARL comparison table, where each row is a concrete algorithm.</p>' +
      '<details class="md-json" open><summary>How to run <span>' + esc(algo.name) + '</span></summary>' +
      '<pre><code>' + esc(rlCommand(algo, state.rlDiff, state.rlBudget)) + '</code></pre></details>';
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function renderRL() {
    if (!RLDATA) return;
    var tb = document.querySelector("#rl-table tbody");
    if (!tb) return;
    var budget = (RLDATA.data || {})[state.rlBudget] || {};
    var algos = RLDATA.algos.slice().sort(function (a, b) {
      var x = (budget[a.id] && budget[a.id][state.rlDiff]) ? budget[a.id][state.rlDiff].total[0] : -1;
      var y = (budget[b.id] && budget[b.id][state.rlDiff]) ? budget[b.id][state.rlDiff].total[0] : -1;
      return y - x;
    });
    var html = "", rank = 0;
    algos.forEach(function (a) {
      var cell = (budget[a.id] || {})[state.rlDiff];
      if (!cell) return;
      rank++;
      html += '<tr class="rank-' + rank + ' is-clickable" data-rl-algo="' + a.id + '" tabindex="0">' +
        '<td class="col-rank" data-label="Rank">' + rank + "</td>" +
        "<td data-label='Algorithm'><div class='model-cell'><span class='model-name'>" + a.name + "</span><span class='model-config'>Click for run command</span></div></td>" +
        "<td data-label='Base%'>" + barHTML("m-base", cell.base) + "</td>" +
        "<td data-label='Coord.%'>" + barHTML("m-coord", cell.coord) + "</td>" +
        "<td data-label='Total%'>" + barHTML("m-total", cell.total) + "</td>" +
        "</tr>";
    });
    tb.innerHTML = html;
    var meta = document.getElementById("rl-board-meta");
    if (meta) meta.textContent = rank + " baselines · " + state.rlBudget + " · " + state.rlDiff.charAt(0).toUpperCase() + state.rlDiff.slice(1);
  }

  function bindRL() {
    document.querySelectorAll(".seg-btn[data-rl-diff]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.rlDiff = b.dataset.rlDiff;
        document.querySelectorAll(".seg-btn[data-rl-diff]").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        renderRL();
      });
    });
    document.querySelectorAll(".seg-btn[data-rl-budget]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.rlBudget = b.dataset.rlBudget;
        document.querySelectorAll(".seg-btn[data-rl-budget]").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        renderRL();
      });
    });
    var tb = document.querySelector("#rl-table tbody");
    if (tb) {
      tb.addEventListener("click", function (e) {
        var tr = e.target.closest ? e.target.closest("tr[data-rl-algo]") : null;
        if (tr) openRLDetail(tr.getAttribute("data-rl-algo"));
      });
      tb.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var tr = e.target.closest ? e.target.closest("tr[data-rl-algo]") : null;
        if (tr) openRLDetail(tr.getAttribute("data-rl-algo"));
      });
    }
  }

  /* ---------- trajectory viewer (text step-through) ---------- */
  // Full interactive debug viewers (~1 GB total) are hosted off-site.
  // To switch host (HF dataset → Cloudflare R2 custom domain), change ONLY this line.
  var FULLLOG_BASE = "https://pub-74f4d738bad14571bd2d3355cb14acb7.r2.dev/traces/v1";
  var TRACE_META = {};  // key -> {file, mb, name, type}
  var TRACE = {};
  var tv = { data: null, list: [], pos: 0, onlyMsg: true };
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function tvEl(id) { return document.getElementById(id); }

  function tvBuildList() {
    var steps = tv.data.steps;
    if (tv.onlyMsg) {
      tv.list = [];
      steps.forEach(function (st, i) { if (st.ag.some(function (a) { return a.msg; })) tv.list.push(i); });
      if (!tv.list.length) tv.list = steps.map(function (_, i) { return i; });
    } else {
      tv.list = steps.map(function (_, i) { return i; });
    }
    if (tv.pos >= tv.list.length) tv.pos = tv.list.length - 1;
    if (tv.pos < 0) tv.pos = 0;
    var sl = tvEl("trace-slider");
    if (sl) { sl.min = 0; sl.max = Math.max(0, tv.list.length - 1); sl.value = tv.pos; }
  }

  function tvRender() {
    if (!tv.list.length) return;
    var st = tv.data.steps[tv.list[tv.pos]];
    tvEl("trace-step").textContent = "step " + st.s + " · " + (tv.pos + 1) + " / " + tv.list.length;
    tvEl("trace-agents").innerHTML = st.ag.map(function (a) {
      var f = "";
      if (a.obs) {
        var prev = esc(a.obs.split("\n").map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 2).join("  ·  ")).slice(0, 110);
        f += '<details class="trace-field trace-obs"><summary class="trace-obs-sum">' +
             '<span class="trace-tag">👁 Observation — what the agent saw</span>' +
             '<span class="trace-obs-preview">' + prev + '…</span>' +
             '<span class="trace-obs-toggle"></span></summary>' +
             '<pre>' + esc(a.obs) + "</pre></details>";
      }
      if (a.th) f += '<div class="trace-field trace-think"><span class="trace-tag">Reasoning</span>' + esc(a.th) + "</div>";
      if (a.msg) f += '<div class="trace-field trace-msg"><span class="trace-tag">Broadcast → team</span>' + esc(a.msg) + "</div>";
      if (a.pad) f += '<div class="trace-field trace-pad"><span class="trace-tag">Scratchpad (private)</span>' + esc(a.pad) + "</div>";
      if (!a.th && !a.msg && !a.pad) f += '<div class="trace-empty">— acting; no message or reasoning this step —</div>';
      return '<div class="trace-agent"><div class="trace-agent-head"><span>Agent ' + a.i + (a.r ? " · " + a.r : "") +
        '</span><span class="trace-act">' + esc(a.act || "—") + "</span></div>" + f + "</div>";
    }).join("");
  }

  function tvStep(d) {
    var n = tv.pos + d;
    if (n < 0 || n >= tv.list.length) return;
    tv.pos = n;
    var sl = tvEl("trace-slider"); if (sl) sl.value = tv.pos;
    tvRender();
  }

  function openTrace(key, name) {
    var modal = tvEl("trace-modal");
    tvEl("trace-model").textContent = name;
    tvEl("trace-agents").innerHTML = '<div class="trace-empty">Loading trace…</div>';
    var full = tvEl("trace-fulllog");
    if (full) {
      var meta = TRACE_META[key];
      var file = (meta && meta.file) || key;
      full.href = FULLLOG_BASE + "/" + file + ".html";
      full.innerHTML = "Full debug log ↗" + (meta && meta.mb ? ' <span class="trace-fulllog-size">' + meta.mb + " MB</span>" : "");
    }
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    function show(d) {
      tv.data = d; tv.pos = 0; tv.onlyMsg = tvEl("trace-onlymsg").checked;
      tvBuildList(); tvRender();
    }
    if (TRACE[key]) { show(TRACE[key]); return; }
    fetch("data/traces/" + key + ".json")
      .then(function (r) { return r.json(); })
      .then(function (d) { TRACE[key] = d; show(d); })
      .catch(function () { tvEl("trace-agents").innerHTML = '<div class="trace-empty">Could not load this trace.</div>'; });
  }
  function closeTrace() { tvEl("trace-modal").hidden = true; document.body.style.overflow = ""; }

  function bindTraces() {
    document.querySelectorAll(".model-card").forEach(function (card) {
      var v = card.querySelector("video"); if (!v) return;
      var m = (v.getAttribute("src") || v.getAttribute("data-src") || "").match(/play\/([^./]+)\.mp4/); if (!m) return;
      var key = m[1];
      var nameEl = card.querySelector(".model-card-name");
      var name = nameEl ? nameEl.textContent : key;
      card.addEventListener("click", function () { openTrace(key, name); });
    });
    document.querySelectorAll("[data-trace-open]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); openTrace(b.dataset.traceOpen, b.dataset.traceName || b.dataset.traceOpen); });
    });
    document.querySelectorAll("[data-trace-close]").forEach(function (b) { b.addEventListener("click", closeTrace); });
    var pv = tvEl("trace-prev"), nx = tvEl("trace-next");
    if (pv) pv.addEventListener("click", function () { tvStep(-1); });
    if (nx) nx.addEventListener("click", function () { tvStep(1); });
    var sl = tvEl("trace-slider");
    if (sl) sl.addEventListener("input", function () { tv.pos = parseInt(sl.value, 10) || 0; tvRender(); });
    var om = tvEl("trace-onlymsg");
    if (om) om.addEventListener("change", function () {
      if (!tv.data) return;
      var cur = tv.list[tv.pos];
      tv.onlyMsg = om.checked;
      tvBuildList();
      var ni = tv.list.indexOf(cur);
      if (ni < 0) { for (var j = 0; j < tv.list.length; j++) { if (tv.list[j] >= cur) { ni = j; break; } } }
      tv.pos = ni >= 0 ? ni : 0;
      var s2 = tvEl("trace-slider"); if (s2) s2.value = tv.pos;
      tvRender();
    });
    document.addEventListener("keydown", function (e) {
      var modal = tvEl("trace-modal");
      if (!modal || modal.hidden) return;
      if (e.key === "Escape") closeTrace();
      else if (e.key === "ArrowLeft") tvStep(-1);
      else if (e.key === "ArrowRight") tvStep(1);
    });
  }

  /* ---------- figure lightbox ---------- */
  function bindLightbox() {
    var lb = document.getElementById("img-lightbox");
    if (!lb) return;
    var lbImg = document.getElementById("lightbox-img");
    function close() { lb.hidden = true; document.body.style.overflow = ""; }
    document.querySelectorAll(".fig-card summary img, .paper-fig img").forEach(function (img) {
      img.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        lbImg.src = img.getAttribute("src");
        lb.hidden = false;
        document.body.style.overflow = "hidden";
      });
    });
    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.hasAttribute("data-lightbox-close")) close();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !lb.hidden) close(); });
  }

  /* ---------- boot ---------- */
  renderCmp();
  bindCopy();
  bindTraces();
  bindLightbox();

  fetch("data/trace_sizes.json")
    .then(function (r) { return r.json(); })
    .then(function (rows) { rows.forEach(function (o) { TRACE_META[o.key] = o; }); })
    .catch(function () {});

  var promptEl = document.getElementById("full-prompt");
  if (promptEl) {
    fetch("assets/system_prompt.txt")
      .then(function (r) { return r.text(); })
      .then(function (t) { promptEl.textContent = t; })
      .catch(function () { promptEl.textContent = "See the system prompt in the repository."; });
  }

  // Lazy-load below-the-fold videos: fetch only when scrolled near the viewport.
  (function () {
    var vids = document.querySelectorAll("video[data-src]");
    if (!vids.length) return;
    function loadVid(v) {
      if (!v.dataset.src) return;
      v.src = v.dataset.src;
      v.removeAttribute("data-src");
      v.load();
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (!("IntersectionObserver" in window)) { Array.prototype.forEach.call(vids, loadVid); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { loadVid(e.target); io.unobserve(e.target); } });
    }, { rootMargin: "300px 0px" });
    Array.prototype.forEach.call(vids, function (v) { io.observe(v); });
  })();

  fetch("data/leaderboard.json")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      DATA = d;
      bindControls();
      renderBoard();
      renderHetero();
      bindModelDetail();
    })
    .catch(function (e) {
      var tb = document.querySelector("#board-table tbody");
      if (tb) tb.innerHTML = '<tr><td colspan="6" style="padding:32px;color:var(--muted)">Could not load leaderboard data. Serve this page over HTTP (e.g. <code>python -m http.server</code>) rather than opening the file directly.</td></tr>';
      console.error(e);
    });

  fetch("data/rl_results.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { RLDATA = d; bindRL(); renderRL(); })
    .catch(function (e) { console.error(e); });
})();
