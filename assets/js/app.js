/* ===========================================================
   Alem leaderboard — vanilla JS, JSON-driven
   =========================================================== */
(function () {
  "use strict";

  var SCALE = 25;            // % axis ceiling for CI bars (max datum ~22)
  // The board opens on the leading BOARD_ROWS models rather than all of them:
  // on Hard the full table is 30+ rows once MARL references and mixed teams are
  // counted, which buries the result the page is actually about. `expanded`
  // lifts the cap.
  var BOARD_ROWS = 10;
  var state = { diff: "hard", view: "all", sortKey: "total", sortDir: "desc", expanded: false, showMixed: false, openOnly: false, rlDiff: "hard", rlBudget: "1B" };
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

  // `single`: the score is one episode, so it is drawn as a hollow dot with no
  // CI bar and labelled as such -- a [m, m, m] triple must not read as a mean
  // with a zero-width interval.
  function barHTML(metricClass, score, single) {
    var mean = score[0], lo = score[1], hi = score[2];
    // Reference rows can run past the axis (privileged heuristic, Easy Coord.%
    // ~36%). Pin their marks to the end of the track and flag the overflow
    // rather than squash every other row onto a wider axis.
    function pos(v) { return (Math.min(Math.max(v, 0), SCALE) / SCALE) * 100; }
    var clipped = (single ? mean : hi) > SCALE;
    var ci = single ? "" :
      '<div class="bar-ci" style="left:' + pos(lo) + "%;width:" + Math.max(pos(hi) - pos(lo), 0.5) + '%"></div>';
    return (
      '<div class="num-cell ' + metricClass + (single ? " is-single" : "") + '">' +
      '<div class="num-val">' + num(mean) + "</div>" +
      '<div class="num-ci">' + (single ? "1 episode" : "[" + num(lo) + ", " + num(hi) + "]") + "</div>" +
      '<div class="bar-track' + (clipped ? " is-clipped" : "") + '">' + ci +
      '<div class="bar-dot" style="left:' + pos(mean) + '%"></div>' +
      "</div></div>"
    );
  }

  var TYPE_PILL = { "open-weight": "Open-weight", "proprietary": "Closed (API)", "mixed": "Mixed team", "marl": "MARL", "human": "Human", "heuristic": "Scripted" };
  function typePill(type) {
    return '<span class="type-pill type-' + type + '">' + (TYPE_PILL[type] || type) + "</span>";
  }

  // Non-LLM reference points (privileged heuristic, human pilot) sit unranked
  // with the MARL rows; they have no LLM run config to show.
  function isReference(m) { return m.type === "human" || m.type === "heuristic"; }
  function isSingle(m, diff) { return !!(m.episodes && m.episodes[diff] === 1); }

  function rowDate(m) {
    return (m.eval_dates && m.eval_dates[state.diff]) || m.eval_date || (DATA && DATA.meta && DATA.meta.evaluation_date) || "—";
  }

  function rowDateValue(m) {
    var value = Date.parse(rowDate(m));
    return isNaN(value) ? -Infinity : value;
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

  function alemVersion(m) {
    return m.alem_version || (DATA && DATA.meta && DATA.meta.alem_version) || "\u2014";
  }

  // Rendered only when an entry sets `episodes`, which it does when a difficulty
  // ran fewer seeds than meta.protocol advertises. Without the row a short cell
  // looks the same as a full one.
  function episodesLabel(m) {
    if (!m.episodes) return "";
    return Object.keys(m.episodes).map(function (k) { return k + " " + m.episodes[k]; }).join(" \u00b7 ");
  }

  function hasAlemColumn() {
    return !!document.querySelector("#board-table th.col-alem");
  }

  function alemCell(m) {
    if (!hasAlemColumn()) return "";
    // MARL rows train against the env rather than being scored through the LLM
    // harness, but they still run on a version, so they get the same treatment.
    var av = alemVersion(m);
    var content = /^\d+\.\d+\.\d+$/.test(av)
      ? '<a class="harness-link" href="https://github.com/alem-world/alem-env/releases/tag/v' + av + '" target="_blank" rel="noopener">' + av + '</a>'
      : '<span class="harness-link is-static">' + av + '</span>';
    return '<td class="col-alem" data-label="Alem">' + content + '</td>';
  }

  function typeRunCell(m) {
    return (
      '<td class="col-type" data-label="Type / date"><div class="type-run">' +
      typePill(m.type) +
      '<span class="run-meta"><span>' + rowDate(m) + '</span></span>' +
      '</div></td>'
    );
  }

  /* provider marks (family -> brand logo). Single-colour brands are drawn as
     CSS-masked spans (see .logo-* in style.css); multicolour official logos
     (Google) render as a real image via COLOR_LOGO. */
  var PROVIDER_LOGO = {
    "Gemini": "google", "GPT": "openai", "Gemma": "google",
    "Qwen": "qwen", "Llama": "meta", "MARL": "marl",
    "Nemotron": "nvidia", "MiniMax": "minimax", "GLM": "zai"
  };
  // Families with no mark of their own fall back to an initial, rather than the
  // blank slot that used to leave those rows visually unlabelled.
  var NO_LOGO = { "Mixed": 1 };
  var COLOR_LOGO = { "google": "google-color.svg" };
  function logoHTML(m) {
    var slug = m && PROVIDER_LOGO[m.family];
    if (!slug) {
      var fam = (m && m.family) || "";
      if (!fam || NO_LOGO[fam]) return '<span class="model-logo model-logo-none" aria-hidden="true"></span>';
      return '<span class="model-logo model-logo-mono" role="img" aria-label="' + esc(fam) + '">' +
             esc(fam.charAt(0).toUpperCase()) + '</span>';
    }
    if (COLOR_LOGO[slug]) {
      return '<img class="model-logo model-logo-img" src="assets/img/logos/' + COLOR_LOGO[slug] +
             '" alt="' + esc(m.family) + '" width="19" height="19" loading="lazy">';
    }
    return '<span class="model-logo logo-' + slug + '" role="img" aria-label="' + esc(m.family) + '"></span>';
  }

  function rowHTML(m, rank, isMarl) {
    var s = m.scores[state.diff];
    var isMixed = m.type === "mixed";
    var rankLabel = rank === null ? '<span style="color:var(--faint)">ref</span>' :
      rank === "mix" ? '<span style="color:var(--faint)">mix</span>' : rank;
    var isRef = isReference(m);
    var single = isSingle(m, state.diff);
    var rowCls = isRef ? "is-ref" : isMarl ? "is-marl" : isMixed ? "is-mixed" : "rank-" + rank;
    var cellTitle = isMixed ? "Click to see the team" : isRef ? "Click for details" : "Click to inspect the run config";
    function scoreCell(label, cls, score) {
      var click = isMixed ? "" : ' onclick="window.AlemOpenModelDetail && window.AlemOpenModelDetail(\'' + m.id + '\')"';
      var body = score ? barHTML(cls, score, single) :
        '<div class="num-cell ' + cls + '"><div class="num-val" style="color:var(--faint)">—</div><div class="num-ci">not split</div></div>';
      return '<td class="score-cell" data-label="' + label + '"' + click + ' title="' + cellTitle + '">' + body + "</td>";
    }
    return (
      '<tr class="' + rowCls + ' is-clickable" data-mid="' + m.id + '"' + (isMixed ? ' data-hetero="1"' : "") + ' data-marl="' + (isMarl ? 1 : 0) + '" tabindex="0">' +
      '<td class="col-rank" data-label="Rank">' + rankLabel + "</td>" +
      "<td data-label='Model'><div class='model-id'>" + logoHTML(m) +
      "<div class='model-cell'>" +
      "<span class='model-name'>" + m.name + "</span>" +
      "<span class='model-config'>" + (m.params && m.params !== "—" ? m.params + " · " : "") + m.config + "</span>" +
      "</div></div></td>" +
      typeRunCell(m) +
      harnessCell(m) +
      alemCell(m) +
      scoreCell("Base%", "m-base", s.base) +
      scoreCell("Coord.%", "m-coord", s.coord) +
      scoreCell("Total%", "m-total", s.total) +
      "</tr>"
    );
  }

  // members are listed in role order (warrior, forager, miner); roles matter
  // for these teams, so they are named wherever a team is shown.
  function teamRoles() {
    return (DATA.heterogeneous && DATA.heterogeneous.member_roles) || ["warrior", "forager", "miner"];
  }

  /* mixed-model teams join the main table on Hard (the only difficulty they
     were run on), unranked. */
  function heteroBoardRows() {
    if (!state.showMixed || state.diff !== "hard" || !DATA.heterogeneous) return [];
    var roles = teamRoles();
    return (DATA.heterogeneous.teams || []).map(function (t) {
      var ci = t.team_total_ci || [t.team_total, t.team_total];
      return {
        id: "hetero-" + t.id,
        name: t.name,
        config: t.members.map(function (name, i) { return name + " (" + (roles[i] || "") + ")"; }).join(" · "),
        type: "mixed",
        family: "Mixed",
        params: "—",
        eval_date: t.eval_date,
        scores: { hard: {
          base: t.team_base || null,
          coord: t.team_coord || null,
          total: t.team_total_full || [t.team_total, ci[0], ci[1]]
        } }
      };
    });
  }

  function avgRowHTML() {
    var a = DATA.averages[state.diff];
    function cell(v, cls, label) { return "<td data-label='" + label + "'><div class='num-cell " + cls + "'><div class='num-val'>" + num(v) + "</div></div></td>"; }
    var harnessPad = hasHarnessColumn() ? "<td data-label='Harness'></td>" : "";
    var alemPad = hasAlemColumn() ? "<td data-label='Alem'></td>" : "";
    return (
      "<tr style='background:var(--bg-2)'>" +
      "<td class='col-rank' data-label='Rank'></td>" +
      "<td data-label='Model'><div class='model-id'><span class='model-logo model-logo-none' aria-hidden='true'></span><span class='model-name' style='color:var(--muted);font-style:italic'>Across LLM agents</span></div></td>" +
      "<td data-label='Type / date'></td>" + harnessPad + alemPad + cell(a.base, "m-base", "Base%") + cell(a.coord, "m-coord", "Coord.%") + cell(a.total, "m-total", "Total%") +
      "</tr>"
    );
  }

  function boardColspan() {
    var head = document.querySelectorAll("#board-table thead th");
    return head.length || (hasHarnessColumn() ? 7 : 6);
  }

  function moreRowsHTML(count) {
    return '<tr class="more-results-row"><td colspan="' + boardColspan() + '"><button type="button" data-show-all-results><span aria-hidden="true">•••</span><strong>Show ' + count + ' more LLM result' + (count === 1 ? '' : 's') + '</strong></button></td></tr>';
  }

  function fewerRowsHTML() {
    return '<tr class="more-results-row"><td colspan="' + boardColspan() + '"><button type="button" data-show-fewer-results><span aria-hidden="true">•••</span><strong>Show top ' + BOARD_ROWS + ' only</strong></button></td></tr>';
  }

  function sortRows(rows) {
    var k = state.sortKey, dir = state.sortDir === "desc" ? -1 : 1;
    return rows.slice().sort(function (x, y) {
      if (k === "name") return dir * x.name.localeCompare(y.name);
      if (k === "date") {
        var dateOrder = rowDateValue(x) - rowDateValue(y);
        if (dateOrder) return dir * dateOrder;
        var typeOrder = x.type.localeCompare(y.type);
        return typeOrder || x.name.localeCompare(y.name);
      }
      if (k === "harness") return dir * harnessVersion(x).localeCompare(harnessVersion(y));
      if (k === "alem") return dir * alemVersion(x).localeCompare(alemVersion(y));
      var sx = x.scores[state.diff], sy = y.scores[state.diff];
      var vx = sx && sx[k] ? sx[k][0] : -1, vy = sy && sy[k] ? sy[k][0] : -1;
      return dir * (vx - vy);
    });
  }

  function renderBoard() {
    var tb = document.querySelector("#board-table tbody");
    var html = "";

    // Not every entry is evaluated on every difficulty -- a proprietary model may
    // be scored on Hard only. Such a row simply does not exist on the other tabs.
    function scoredHere(m) { return !!(m.scores && m.scores[state.diff]); }
    // The open-weight filter re-ranks within the filtered set, and takes the MARL
    // baselines and the mixed teams with it: a trained policy is not an open-weight
    // model, and a mixed team is only as open as its least-open member.
    var pool = DATA.homogeneous.filter(scoredHere);
    if (state.openOnly) pool = pool.filter(function (m) { return m.type === "open-weight"; });
    var llm = state.view === "marl" ? [] : sortRows(pool);
    // Reference rows: MARL baselines, plus (on "All" only) the privileged
    // heuristic and the human pilot. All unranked except in the MARL view.
    var marl = (state.view === "llm" || state.openOnly) ? [] : DATA.marl.filter(scoredHere);
    if (state.view === "all" && !state.openOnly) marl = marl.concat((DATA.references || []).filter(scoredHere));
    marl = sortRows(marl);

    // mixed teams slot in by the current sort but stay unranked, so the
    // homogeneous ranking (1..N) is unchanged by their presence.
    var mixed = (state.view === "marl" || state.openOnly) ? [] : heteroBoardRows();
    var rankOf = {};
    llm.forEach(function (m, i) { rankOf[m.id] = i + 1; });
    var llmAll = mixed.length ? sortRows(llm.concat(mixed)) : llm;

    // The cap applies to ranked LLM rows only; mixed teams are unranked and
    // come along whenever they are switched on.
    var cap = (state.view === "marl" || state.expanded) ? null : BOARD_ROWS;
    var shownLLM = cap === null ? llmAll : sortRows(llm.slice(0, cap).concat(mixed));
    shownLLM.forEach(function (m) { html += rowHTML(m, m.type === "mixed" ? "mix" : rankOf[m.id], false); });
    if (shownLLM.length < llmAll.length) html += moreRowsHTML(llmAll.length - shownLLM.length);
    else if (state.expanded && llmAll.length > BOARD_ROWS) html += fewerRowsHTML();
    html += prelimRowsHTML();
    if (llm.length && !state.openOnly) html += avgRowHTML();
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
      var n = llmAll.length + marl.length;
      var shown = shownLLM.length + marl.length;
      meta.textContent = (shown < n ? shown + " of " : "") + n + " systems · " + state.diff.charAt(0).toUpperCase() + state.diff.slice(1) + " · " + (DATA.meta.harness_version || "harness") + " · 95% CI";
    }
    var openButton = document.querySelector("[data-open-weight]");
    if (openButton) {
      var openAvailable = state.view !== "marl";
      openButton.disabled = !openAvailable;
      openButton.classList.toggle("is-active", state.openOnly && openAvailable);
      openButton.setAttribute("aria-pressed", state.openOnly && openAvailable ? "true" : "false");
    }
    var mixedButton = document.querySelector("[data-mixed-teams]");
    if (mixedButton) {
      var mixedAvailable = state.diff === "hard" && state.view !== "marl" && !state.openOnly;
      mixedButton.disabled = !mixedAvailable;
      mixedButton.classList.toggle("is-active", state.showMixed && mixedAvailable);
      mixedButton.setAttribute("aria-pressed", state.showMixed && mixedAvailable ? "true" : "false");
    }
  }

  /* ---------- preliminary runs (below the seed minimum: shown, never ranked) ----------
     A full-width strip straight after the ranked LLM rows: with the other LLMs,
     but outside the sort and without a rank. */
  function prelimRowsHTML() {
    var diff = state.diff;
    var items = state.view === "marl" ? [] : (DATA.preliminary || []).filter(function (p) {
      return p.scores && p.scores[diff] && (!state.openOnly || p.type === "open-weight");
    });
    return items.map(function (p) {
      var s = p.scores[diff];
      var n = (p.episodes && p.episodes[diff]) || 1;
      var diffName = diff.charAt(0).toUpperCase() + diff.slice(1);
      function stat(label, cls, t) {
        return '<div class="prelim-stat ' + cls + '"><span>' + label + "</span><strong>" + num(t[0]) + "</strong></div>";
      }
      return (
        '<tr class="prelim-row"><td colspan="' + boardColspan() + '"><div class="prelim-card">' +
        '<div class="prelim-head">' + logoHTML(p) +
        '<div><div class="prelim-tag">Not ranked · ' + diffName + "</div>" +
        "<h4>" + esc(p.name) + " <span>" + esc(p.config) + "</span></h4></div></div>" +
        "<p>" + (n === 1 ? "Single seed, so it isn't ranked." :
          n + " seeds, short of the " + p.seeds_required + " needed for a rank.") + "</p>" +
        '<div class="prelim-stats">' + stat("Base%", "m-base", s.base) + stat("Coord.%", "m-coord", s.coord) + stat("Total%", "m-total", s.total) + "</div>" +
        "</div></td></tr>"
      );
    }).join("");
  }

  /* ---------- model detail (click a row → full config) ---------- */
  function findModel(id) {
    var all = (DATA.homogeneous || []).concat(DATA.marl || [], DATA.references || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function fmtScore(t, single) {
    if (!t) return "—";
    return num(t[0]) + ' <span class="md-ci">' + (single ? "1 episode" : "[" + num(t[1]) + ", " + num(t[2]) + "]") + "</span>";
  }
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
  function rlAlgoSpec(id, budget) {
    // HyperMARL is the one algorithm whose hyperparameters were not held across
    // budgets: 100M ran LR=0.0003/tanh, 1B and 10B ran LR=0.0001/relu. The other
    // three are budget-invariant.
    var hyper = budget === "100M" ? "LR=0.0003 CLIP_EPS=0.2 UPDATE_EPOCHS=4 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=tanh GAE_LAMBDA=0.8"
                                  : "LR=0.0001 CLIP_EPS=0.2 UPDATE_EPOCHS=4 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=relu GAE_LAMBDA=0.8";
    return {
      "ippo-rnn": { script: "baselines/ippo_rnn.py", run: "IPPO", extra: "LR=0.0003 CLIP_EPS=0.2 UPDATE_EPOCHS=4 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=tanh GAE_LAMBDA=0.8" },
      "hypermarl-rnn": { script: "baselines/ippo_hypermarl_rnn.py", run: "IPPO-HyperMARL", extra: hyper },
      "mappo-rnn": { script: "baselines/mappo_rnn.py", run: "MAPPO", extra: "LR=0.0003 CLIP_EPS=0.2 UPDATE_EPOCHS=2 MAX_GRAD_NORM=1 NUM_MINIBATCHES=8 ACTIVATION=tanh GAE_LAMBDA=0.8" },
      "pqn-vdn-rnn": { script: "baselines/pqn_vdn_rnn.py", run: "PQN-VDN", extra: "TOTAL_TIMESTEPS_DECAY={steps}" }
    }[id] || { script: "baselines/ippo_rnn.py", run: id, extra: "NUM_COMM_CHANNELS=4" };
  }
  function rlCommand(algo, diff, budget) {
    var spec = rlAlgoSpec(algo.id, budget);
    var steps = { "100M": "1e8", "1B": "1e9", "10B": "1e10" }[budget] || "1e8";
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
    var isRef = isReference(m);
    var isLLM = !isMarl && !isRef;
    document.getElementById("md-name").textContent = m.name;
    document.getElementById("md-sub").textContent = typeLabel(m.type) + (m.params && m.params !== "—" ? " · " + m.params : "");
    var diffs = ["easy", "medium", "hard"];
    var rows = diffs.map(function (d) {
      var s = m.scores[d]; if (!s) return "";
      var one = isSingle(m, d);
      return "<tr><td>" + d.charAt(0).toUpperCase() + d.slice(1) + "</td>" +
        "<td>" + fmtScore(s.base, one) + "</td><td>" + fmtScore(s.coord, one) + "</td><td class='md-total'>" + fmtScore(s.total, one) + "</td></tr>";
    }).join("");
    var refBody = "";
    if (isRef) {
      var sessions = m.sessions ? diffs.filter(function (d) { return m.sessions[d]; }).map(function (d) {
        return "<li><strong>" + d.charAt(0).toUpperCase() + d.slice(1) + "</strong> " + esc(m.sessions[d]) + "</li>";
      }).join("") : "";
      refBody =
        (sessions ? '<ul class="md-sessions">' + sessions + "</ul>" : "") +
        (m.note ? '<p class="md-note">' + esc(m.note) + "</p>" : "") +
        (m.image ? '<figure class="md-figure"><img src="' + m.image.src + '" alt="' + esc(m.image.alt) + '" loading="lazy" /><figcaption>' + esc(m.image.caption) + "</figcaption></figure>" : "") +
        (m.harness_url ? '<p class="md-note"><a href="' + m.harness_url + '" target="_blank" rel="noopener">How to run it ↗</a></p>' : "");
    }
    function meta(label, val) { return val ? '<div class="md-meta"><span>' + label + "</span><strong>" + val + "</strong></div>" : ""; }
    var ed = m.eval_dates ? Object.keys(m.eval_dates).map(function (k) { return k + " " + m.eval_dates[k]; }).join(" · ") : (m.eval_date || "");
    function alemVersionLink(x) {
      var av = alemVersion(x);
      return /^\d+\.\d+\.\d+$/.test(av)
        ? '<a href="https://github.com/alem-world/alem-env/releases/tag/v' + av + '" target="_blank" rel="noopener">' + av + " \u2197</a>"
        : av;
    }
    var harnessHref = m.harness_url || (isLLM && m.harness_version ? "https://github.com/alem-world/alem-env/blob/main/baselines/llm/eval_utils/agents/robust_all.py" : "");
    var harnessLink = harnessHref ?
      '<a href="' + harnessHref + '" target="_blank" rel="noopener">' + m.harness_version + " ↗</a>" :
      (m.harness_version || "—");
    document.getElementById("md-body").innerHTML =
      '<div class="md-metas">' +
        meta("Type", typeLabel(m.type)) +
        meta(isMarl ? "Budget" : "Parameters", m.params) +
        meta("Family", m.family) +
        meta(isMarl ? "Algorithm" : "Harness", isMarl ? m.config : harnessLink) +
        meta("Alem version", alemVersionLink(m)) +
        (!isMarl ? meta("Config", m.config) : "") +
        meta("Eval date", ed) +
        meta("Episodes", episodesLabel(m)) +
        meta("Status", m.verified ? "✓ verified" : "self-reported") +
      "</div>" +
      '<h4 class="md-h">Scores by difficulty <span>· ' +
        (diffs.every(function (d) { return !m.scores[d] || isSingle(m, d); }) ? "one episode each, no CI" : "mean [95% CI]") +
        ", normalised per category</span></h4>" +
      '<div class="table-scroll"><table class="md-table"><thead><tr><th>Difficulty</th><th>Base%</th><th>Coord.%</th><th>Total%</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      (isLLM ? '<p class="md-note">This is the exact run config behind the selected leaderboard score. Reproduce with the standard protocol. See <a href="https://github.com/alem-world/alem-env/blob/main/SUBMISSION.md" target="_blank" rel="noopener">SUBMISSION.md</a>.</p><div id="md-config"></div>' :
        isRef ? refBody :
        '<p class="md-note">This row is a reference aggregate from the dedicated MARL comparison table below. Click rows in that MARL table for algorithm-specific run commands.</p>');
    modal.hidden = false; document.body.style.overflow = "hidden";
    if (isLLM) renderRunConfig(m.id, state.diff);
  }
  window.AlemOpenModelDetail = openModelDetail;
  var TYPE_LABEL = { "open-weight": "Open-weight", "proprietary": "Closed (API)", "marl": "MARL baseline", "human": "Human team", "heuristic": "Scripted reference" };
  function typeLabel(t) { return TYPE_LABEL[t] || t; }

  function gotoHeteroDetail() {
    var target = document.getElementById("hetero-teams") || document.getElementById("hetero-grid");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.location.href = "index.html#hetero-teams";
  }
  function activateRow(tr) {
    if (tr.hasAttribute("data-hetero")) gotoHeteroDetail();
    else openModelDetail(tr.getAttribute("data-mid"));
  }
  function bindModelDetail() {
    var tb = document.querySelector("#board-table tbody");
    if (!tb) return;
    tb.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a,button")) return;
      var tr = e.target.closest ? e.target.closest("tr[data-mid]") : null;
      if (tr) activateRow(tr);
    });
    tb.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var tr = e.target.closest ? e.target.closest("tr[data-mid]") : null;
      if (tr) activateRow(tr);
    });
    document.addEventListener("keydown", function (e) {
      var m = document.getElementById("model-modal");
      if (m && !m.hidden && e.key === "Escape") closeModelModal();
    });
  }

  /* ---------- heterogeneous teams ---------- */
  // A diverging table of each mixed team's change against the mean of its
  // members' homogeneous teams: the paper's Table 2, with the sign carried by
  // bar direction and the printed value as well as by colour.
  function renderHetero() {
    var wrap = document.getElementById("hetero-grid");
    if (!wrap || !DATA.heterogeneous) return;
    var H = DATA.heterogeneous, roles = teamRoles();
    var DMAX = 7;  // largest |delta| is 6.9 pp
    function signed(v) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + num(Math.abs(v)); }
    function dcell(v, label) {
      var w = Math.min(Math.abs(v), DMAX) / DMAX * 50;
      var cls = v > 0 ? "is-pos" : v < 0 ? "is-neg" : "";
      return '<td data-label="' + label + '"><div class="dcell ' + cls + '"><span class="dval">' + signed(v) + "</span>" +
        '<div class="dtrack"><i class="dzero"></i><i class="dbar" style="left:' + (v < 0 ? 50 - w : 50) + "%;width:" + w + '%"></i></div></div></td>';
    }
    function deltaCells(d) { return dcell(d.base, "Δ Base%") + dcell(d.coord, "Δ Coord.%") + dcell(d.total, "Δ Total%"); }
    var lastGroup = null;
    var body = H.teams.map(function (t) {
      var head = "";
      if ((t.group || null) !== lastGroup && t.group === "roles") {
        head = '<tr class="ht-group"><td colspan="4">Same three models, different roles</td></tr>';
      }
      lastGroup = t.group || null;
      var members = t.members.map(function (name, i) {
        var r = roles[i] || "";
        return '<li><span class="ht-role r-' + r + '">' + r + "</span>" + esc(name) + "</li>";
      }).join("");
      return head +
        '<tr><td data-label="Team"><ul class="ht-members">' + members + "</ul>" +
        '<div class="ht-meta">' + (t.seeds ? t.seeds + " seeds · " : "") + "team Coord.% " + num(t.team_coord[0]) + " · Total% " + num(t.team_total) + "</div></td>" +
        deltaCells(t.delta) + "</tr>";
    }).join("");
    var mean = H.mean_delta ? '<tr class="ht-mean"><td data-label="Team">Average</td>' + deltaCells(H.mean_delta) + "</tr>" : "";
    wrap.innerHTML =
      '<table class="hetero-table"><thead><tr><th>Team <span>role · model</span></th><th>Δ Base%</th><th>Δ Coord.%</th><th>Δ Total%</th></tr></thead>' +
      "<tbody>" + body + mean + "</tbody></table>";
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
    var mixedButton = document.querySelector("[data-mixed-teams]");
    if (mixedButton) {
      mixedButton.addEventListener("click", function () {
        state.showMixed = !state.showMixed;
        renderBoard();
      });
    }
    var openWeightButton = document.querySelector("[data-open-weight]");
    if (openWeightButton) {
      openWeightButton.addEventListener("click", function () {
        state.openOnly = !state.openOnly;
        renderBoard();
      });
    }
    var tbody = document.querySelector("#board-table tbody");
    if (tbody) {
      tbody.addEventListener("click", function (e) {
        if (!e.target.closest) return;
        if (e.target.closest("[data-show-all-results]")) {
          state.expanded = true;
          renderBoard();
        } else if (e.target.closest("[data-show-fewer-results]")) {
          state.expanded = false;
          renderBoard();
        }
      });
    }
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

  function bindGalleryExpand() {
    var button = document.querySelector("[data-gallery-expand]");
    var gallery = document.getElementById("model-gallery");
    if (!button || !gallery) return;
    button.addEventListener("click", function () {
      var expanded = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      gallery.classList.toggle("is-collapsed", !expanded);
      button.innerHTML = expanded
        ? '<span aria-hidden="true">−</span> Show fewer examples'
        : '<span aria-hidden="true">+</span> Show all 18 examples';
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
    // A budget need not cover every difficulty -- 10B is Hard only -- and an
    // empty tbody reads as a loading bug rather than "we did not run this".
    tb.innerHTML = html || '<tr class="is-empty"><td colspan="5">Not run at this budget.</td></tr>';
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
  var FULLLOG_BASE = "https://pub-74f4d738bad14571bd2d3355cb14acb7.r2.dev/traces_gz";
  var TRACE_META = {};  // key -> {file, mb, name, type}
  var TRACE = {};
  var tv = { data: null, list: [], pos: 0 };
  function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function tvEl(id) { return document.getElementById(id); }

  function tvBuildList() {
    var steps = tv.data.steps;
    tv.list = steps.map(function (_, i) { return i; });
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
             '<span class="trace-tag">👁 Observation: what the agent saw</span>' +
             '<span class="trace-obs-preview">' + prev + '…</span>' +
             '<span class="trace-obs-toggle"></span></summary>' +
             '<pre>' + esc(a.obs) + "</pre></details>";
      }
      if (a.th) f += '<div class="trace-field trace-think"><span class="trace-tag">Reasoning</span>' + esc(a.th) + "</div>";
      if (a.msg) f += '<div class="trace-field trace-msg"><span class="trace-tag">Broadcast → team</span>' + esc(a.msg) + "</div>";
      if (a.pad) f += '<div class="trace-field trace-pad"><span class="trace-tag">Scratchpad (private)</span>' + esc(a.pad) + "</div>";
      if (!a.th && !a.msg && !a.pad) f += '<div class="trace-empty">acting; no message or reasoning this step</div>';
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
      full.innerHTML = "Open full debug log ↗" + (meta && meta.mb ? ' <span class="trace-fulllog-size">' + meta.mb + " MB</span>" : "");
    }
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    function show(d) {
      tv.data = d; tv.pos = 0;
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
    document.addEventListener("keydown", function (e) {
      var modal = tvEl("trace-modal");
      if (!modal || modal.hidden) return;
      if (e.key === "Escape") closeTrace();
      else if (e.key === "ArrowLeft") tvStep(-1);
      else if (e.key === "ArrowRight") tvStep(1);
    });
  }

  /* ---------- linked figure details + lightbox ---------- */
  function bindLinkedFigureDetails() {
    document.querySelectorAll(".figures-row").forEach(function (row) {
      var cards = Array.prototype.slice.call(row.children).filter(function (child) {
        return child.matches && child.matches("details.fig-card");
      });
      if (cards.length < 2) return;
      cards.forEach(function (card) {
        var summary = card.querySelector("summary");
        if (!summary) return;
        summary.addEventListener("click", function (e) {
          e.preventDefault();
          var open = !card.open;
          cards.forEach(function (other) { other.open = open; });
        });
      });
    });
  }

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

  function bindSampleTrace() {
    var el = document.getElementById("trace-sample");
    if (!el) return;
    var src = el.getAttribute("data-sample-src");
    var frame = el.querySelector(".trace-sample-frame");
    var loaded = false;
    function load() {
      if (loaded) return;
      loaded = true;
      var ifr = document.createElement("iframe");
      ifr.className = "trace-sample-iframe";
      ifr.title = "Full interactive debug log";
      ifr.setAttribute("loading", "lazy");
      ifr.onload = function () { var l = frame.querySelector(".trace-sample-loading"); if (l) l.remove(); };
      ifr.src = src;
      frame.appendChild(ifr);
    }
    // Auto-load as it nears the viewport (keeps the initial page light).
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { io.disconnect(); load(); }
      }, { rootMargin: "400px" });
      io.observe(el);
    } else {
      load();
    }
  }

  /* ---------- motion: scroll reveals, bar draw-in, nav state ----------
     Progressive enhancement. html.js-anim gates every hidden state in CSS,
     and it is only set when IntersectionObserver exists and the user has
     not asked for reduced motion, so content is never hidden otherwise. */
  var MOTION_OK = false;

  function initMotion() {
    if (!("IntersectionObserver" in window)) return;
    var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq && mq.matches) return;
    MOTION_OK = true;
    document.documentElement.classList.add("js-anim");

    var SEL = [
      ".section-head", ".strip-item", ".leaderboard-summary article", ".board-shell",
      ".note", ".marl-head", ".rl-toggle", ".trace-cta-wrap", ".model-gallery",
      ".trace-lead", ".trace-sample", ".showcase-figure", ".diff-figure",
      ".block-title", ".feature-card", ".interface-card", ".coord-hero", ".coord-card",
      ".gallery-row figure", ".scoring", ".findings-headline", ".result-hint",
      ".finding-card", ".fig-card", ".ablation-legend", ".hetero-legend",
      ".cite-box", "#hetero-grid", ".cmp-table"
    ].join(",");
    var els = document.querySelectorAll(SEL);
    if (!els.length) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        // stagger within the newly visible batch by position among siblings
        var i = 0;
        if (el.parentElement) {
          var sibs = el.parentElement.children;
          for (var k = 0; k < sibs.length && sibs[k] !== el; k++) {
            if (sibs[k].classList && sibs[k].classList.contains("reveal")) i++;
          }
        }
        var d = Math.min(i, 5) * 70;
        el.style.transitionDelay = d + "ms";
        el.classList.add("in");
        // hand transitions back to the element's own rules once done
        setTimeout(function () {
          el.classList.remove("reveal", "in");
          el.style.transitionDelay = "";
        }, d + 1500);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });

    els.forEach(function (el) { el.classList.add("reveal"); io.observe(el); });
  }

  function initBarsDraw() {
    if (!MOTION_OK) return;
    document.querySelectorAll(".board-shell").forEach(function (shell) {
      if (shell.dataset.barsBound) return;
      shell.dataset.barsBound = "1";
      var bounds = shell.getBoundingClientRect();
      if (bounds.top < window.innerHeight && bounds.bottom > 0) {
        shell.classList.add("bars-live");
        return;
      }
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { io.disconnect(); shell.classList.add("bars-live"); }
      }, { threshold: 0.01 });
      io.observe(shell);
    });
  }

  function initNav() {
    var nav = document.querySelector(".site-nav");
    if (!nav) return;
    function onScroll() { nav.classList.toggle("is-scrolled", (window.scrollY || 0) > 4); }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (!("IntersectionObserver" in window)) return;
    var links = {};
    var ids = [];
    nav.querySelectorAll('nav a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      if (id && document.getElementById(id)) { links[id] = a; ids.push(id); }
    });
    if (!ids.length) return;
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].classList.remove("is-current"); });
        links[en.target.id].classList.add("is-current");
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    ids.forEach(function (id) { spy.observe(document.getElementById(id)); });
  }

  /* ---------- boot ---------- */
  initMotion();
  initNav();
  renderCmp();
  bindCopy();
  bindGalleryExpand();
  bindTraces();
  bindSampleTrace();
  bindLinkedFigureDetails();
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

  // Lazy-load below-the-fold videos: fetch only when scrolled near the
  // viewport, and pause looping clips again once they scroll well out of it.
  (function () {
    var vids = document.querySelectorAll("video[data-src]");
    if (!vids.length) return;
    function loadVid(v) {
      if (v.dataset.src) {
        v.src = v.dataset.src;
        v.removeAttribute("data-src");
        v.load();
      }
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
    if (!("IntersectionObserver" in window)) { Array.prototype.forEach.call(vids, loadVid); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) loadVid(e.target);
        else if (!e.target.dataset.src && !e.target.paused) e.target.pause();
      });
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
      initBarsDraw();
    })
    .catch(function (e) {
      var tb = document.querySelector("#board-table tbody");
      if (tb) tb.innerHTML = '<tr><td colspan="6" style="padding:32px;color:var(--muted)">Could not load leaderboard data. Serve this page over HTTP (e.g. <code>python -m http.server</code>) rather than opening the file directly.</td></tr>';
      console.error(e);
    });

  fetch("data/rl_results.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { RLDATA = d; bindRL(); renderRL(); initBarsDraw(); })
    .catch(function (e) { console.error(e); });
})();
