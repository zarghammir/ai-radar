/* AI Radar prototype \u2014 framework-free. Renders every screen from real data. */
(function () {
  "use strict";

  var S = window.RADAR_STORIES, SRC = window.RADAR_SOURCES, TOPICS = window.RADAR_TOPICS;

  var GRADE = {
    primary:      { bars: 4, word: "Primary source", def: "The company, lab or author published it themselves." },
    corroborated: { bars: 3, word: "Corroborated",   def: "Two or more independent outlets report the same thing." },
    emerging:     { bars: 2, word: "Emerging",       def: "One outlet so far. Probably true, not yet confirmed." },
    unverified:   { bars: 1, word: "Unverified",     def: "A rumour, a leak or an anonymous claim. Read it as such." }
  };

  var state = {
    screen: "today", mode: 10, story: "openai-valuation", filter: "all",
    saved: ["anthropic-ci", "atria-dawn-paper", "cohere-translate", "perplexity-local"],
    interests: ["agents", "open weights", "developer tools", "evaluation"],
    sources: SRC.map(function (s) { return s.on; }),
    notify: "brief", obStep: 1
  };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function byId(id) { for (var i = 0; i < S.length; i++) if (S[i].id === id) return S[i]; return S[0]; }
  function host(u) { return u.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, ""); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function meter(level) {
    var n = GRADE[level].bars, out = "";
    for (var i = 0; i < 4; i++) out += '<i class="' + (i < n ? "on" : "") + '"></i>';
    return '<span class="meter" aria-hidden="true">' + out + "</span>";
  }
  function verChip(level) {
    return '<span class="ver">' + meter(level) + "<span>" + esc(GRADE[level].word) + "</span></span>";
  }

  function spark(pickup, bare) {
    var W = 290, base = 34, top = 8, mx = Math.max.apply(null, pickup), n = pickup.length;
    var pts = pickup.map(function (v, i) {
      return { x: 6 + i * ((W - 12) / (n - 1)), y: base - (v / mx) * (base - top) };
    });
    var d = "M" + pts[0].x.toFixed(1) + "," + pts[0].y.toFixed(1);
    for (var i = 1; i < n; i++) {
      d += " L" + pts[i].x.toFixed(1) + "," + pts[i - 1].y.toFixed(1);
      d += " L" + pts[i].x.toFixed(1) + "," + pts[i].y.toFixed(1);
    }
    var last = pts[n - 1], hours = n - 1;
    var svg = '<svg viewBox="0 0 ' + W + ' 40" role="img" aria-label="Outlets reporting this story rose from ' +
      pickup[0] + " to " + mx + " over " + hours + ' hours."><title>Cumulative outlets reporting this story</title>' +
      '<path d="' + d + " L" + last.x.toFixed(1) + "," + base + " L6," + base + ' Z" fill="currentColor" opacity=".09"/>' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<line x1="6" y1="' + base + '" x2="' + (W - 6) + '" y2="' + base + '" stroke="currentColor" stroke-width="1" opacity=".22"/>' +
      '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3.5" fill="currentColor"/></svg>';
    if (bare) return '<div class="sparkbare">' + svg + "</div>";
    return '<div class="spark"><div class="spark-hd"><b>Pickup</b><span>' + mx +
      " outlet" + (mx === 1 ? "" : "s") + " \u00b7 " + hours + " hours</span></div>" + svg + "</div>";
  }

  function totalArrivals() {
    return window.RADAR_ARRIVALS.reduce(function (p, c) { return p + c; }, 0);
  }

  function arrivals(bare) {
    var a = window.RADAR_ARRIVALS, now = window.RADAR_CURRENT_HOUR;
    var mx = Math.max.apply(null, a), base = 46, span = 38, bars = "";
    a.forEach(function (c, i) {
      var x = i * 12 + 2, hgt = c ? (c / mx) * span : 1.5, y = base - hgt;
      var fill = i === now ? "var(--org)" : "currentColor";
      var op = c === 0 ? ".16" : (i === now ? "1" : ".82");
      bars += '<rect x="' + x + '" y="' + y.toFixed(1) + '" width="9" height="' + hgt.toFixed(1) +
        '" fill="' + fill + '" opacity="' + op + '"><title>' + (i < 10 ? "0" + i : i) +
        ":00 \u2014 " + c + " item" + (c === 1 ? "" : "s") + "</title></rect>";
    });
    var total = a.reduce(function (p, c) { return p + c; }, 0);
    var ticks = [["00", 2], ["06", 74], ["12", 146], ["18", 218]].map(function (t) {
      return '<text x="' + t[1] + '" y="57" font-family="JetBrains Mono, monospace" font-size="8" fill="#6E6A61">' + t[0] + "</text>";
    }).join("");
    var asvg = '<svg viewBox="0 0 292 60" role="img" aria-label="Items ingested per hour today, ' + total +
      " in total, peaking at " + mx + " in the " + now + ':00 hour."><title>Items per hour, 00:00 to 23:00</title>' +
      bars + '<line x1="2" y1="46" x2="290" y2="46" stroke="currentColor" stroke-width="1" opacity=".25"/>' +
      ticks + '<text x="290" y="57" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="8" fill="#6E6A61">23</text>' +
      "</svg>";
    var leg = '<p class="legend">' + total + " items today. The orange column is the hour you are in.</p>";
    if (bare) return '<div class="chartbare">' + asvg + leg + "</div>";
    return '<div class="chart"><p class="cap">Arrivals by hour</p>' + asvg + leg + "</div>";
  }

  function gradeKey(compact) {
    return '<div class="key">' + Object.keys(GRADE).map(function (k) {
      return '<div class="k">' + meter(k) + "<b>" + esc(GRADE[k].word) + "</b>" +
        (compact ? "" : '<span class="def">' + esc(GRADE[k].def) + "</span>") + "</div>";
    }).join("") + "</div>";
  }

  function rail(n) { return '<div class="rail"><b>' + (n < 10 ? "0" + n : n) + "</b></div>"; }

  /* ---------- the story card -------------------------------------------- */
  function card(st, n, opts) {
    opts = opts || {};
    var also = st.also.length ? '<span>\u00b7</span><span>+' + st.also.length + " others</span>" : "";
    var body = '<div class="card-top"><span class="type">' + esc(cap(st.type)) + "</span>" +
      verChip(st.verification) + "</div>" +
      '<h3 class="headline"><button class="open" data-story="' + st.id +
      '">' + esc(st.headline) + "</button></h3>" +
      '<p class="summary">' + esc(st.summary) + "</p>";
    if (opts.why) body += '<div class="why"><b>Why it matters</b><p>' + esc(st.why) + "</p></div>";
    body += '<div class="srcline"><b>' + esc(st.source.name) + "</b>" + also +
      "<span>\u00b7</span><span>" + esc(st.detected) + "</span>" +
      "<span>\u00b7</span><span>" + st.minutes + " min</span></div>";
    if (opts.spark) body += spark(st.pickup);
    body += '<a class="read" href="' + esc(st.source.url) + '" target="_blank" rel="noopener">' +
      "<u>Read at " + esc(st.source.name) + "</u><em>\u2197 " + esc(host(st.source.url)) + "</em></a>";
    return '<div class="row">' + rail(n) +
      '<article class="card' + (opts.lead ? " lead" : "") + '" data-story="' + st.id +
      '">' + body + "</article></div>";
  }

  /* ---------- screens ---------------------------------------------------- */
  function screenToday() {
    var counts = { 5: 4, 10: 8, all: S.length };
    var list = S.slice(0, counts[state.mode] || S.length);
    /* The brief's minutes are SKIM time for the cards shown, not the sum of the
       full articles. A story's own `minutes` is how long the original takes to
       read, and that figure belongs on the story page, not here. */
    var mins = Math.round(list.reduce(function (p, c, i) {
      return p + (i === 0 ? 1.8 : 1.1) + (i < (state.mode === 5 ? 1 : 3) ? 0.35 : 0);
    }, 0));
    var html = '<div class="head">' +
      '<div class="day">Wednesday 16 September</div>' +
      "<h1>Good morning</h1>" +
      '<p class="sub">' + list.length + " stories \u00b7 " + mins +
      " minutes \u00b7 2 unread from yesterday</p>" +
      '<div class="modes" role="group" aria-label="How long you have">' +
      [[5, "5 min"], [10, "10 min"], ["all", "Everything"]].map(function (m) {
        return '<button data-mode="' + m[0] + '" aria-pressed="' +
          (String(state.mode) === String(m[0])) + '">' + m[1] + "</button>";
      }).join("") + "</div></div>";

    list.forEach(function (st, i) {
      html += card(st, i + 1, { lead: i === 0, why: i < (state.mode === 5 ? 1 : 3), spark: i === 0 });
      if (i === 1) html += '<div class="flag">\u25b6 You stopped here \u00b7 ' +
        (list.length - 2) + " left</div>";
    });
    return html;
  }

  function screenRadar() {
    var kinds = ["all", "release", "paper", "model", "news", "discussion", "signal"];
    var list = S.filter(function (s) { return state.filter === "all" || s.type === state.filter; })
                .slice().sort(function (a, b) { return b.detected.localeCompare(a.detected); });
    var html = '<div class="head"><div class="day">Everything arriving</div><h1>Live Radar</h1>' +
      '<p class="sub">' + totalArrivals() + ' items today \u00b7 last checked 3 minutes ago</p></div>' +
      arrivals() + '<div class="railstrip"></div>' +
      '<div class="filters" role="group" aria-label="Filter by kind">' +
      kinds.map(function (k) {
        return '<button data-filter="' + k + '" aria-pressed="' + (state.filter === k) + '">' +
          (k === "all" ? "All" : cap(k)) + "</button>";
      }).join("") + "</div>";
    if (!list.length) {
      html += '<div class="empty">Nothing of this kind has arrived today. The worker checks ' +
        "every 30 minutes; the last sweep found nothing matching.</div>";
    }
    list.forEach(function (st) {
      html += '<button class="tick" data-story="' + st.id + '"><time>' + esc(st.detected) +
        "</time><span class=\"tbody\">" +
        '<span class="t">' + esc(st.headline) + "</span>" +
        '<span class="tmeta"><span class="k">' + esc(cap(st.type)) + "</span>" +
        '<span class="dot">\u00b7</span>' + meter(st.verification) +
        "<span class=\"g\">" + esc(GRADE[st.verification].word) + "</span>" +
        '<span class="dot">\u00b7</span><span class="o">' + esc(st.source.name) +
        "</span></span></span></button>";
    });
    return html;
  }

  function screenStory() {
    var st = byId(state.story);
    var tl = [{ t: st.detected, s: st.source.name + " publishes first." }].concat(
      st.also.map(function (a) { return { t: a.at, s: a.name + " follows" + (a.note ? ", and " + a.note : "") + "." }; }));
    var bars = st.ranking.map(function (r) {
      return '<div class="bar"><dt>' + esc(r.label) + '</dt><div class="track"><i class="' +
        (r.negative ? "neg" : "") + '" style="width:' + r.value + '%"></i></div><dd>' +
        esc(r.display) + "</dd></div>";
    }).join("");
    return '<div class="railstrip"></div><button class="back" data-back="1">\u2190 Today\u2019s brief</button>' +
      '<div class="sheet"><div class="card-top"><span class="type">' + esc(cap(st.type)) + "</span>" +
      verChip(st.verification) + "</div><h1>" + esc(st.headline) + "</h1>" +
      '<div class="srcline"><b>' + esc(st.source.name) + "</b><span>\u00b7</span><span>" +
      esc(st.day) + " " + esc(st.detected) + "</span><span>\u00b7</span><span>" + st.minutes +
      " min</span></div>" +
      '<div class="exec"><p>' + esc(st.summary) + "</p></div>" +
      '<p class="seclab">Why it matters</p><p class="prose" style="color:var(--ink)">' + esc(st.why) + "</p>" +
      '<p class="seclab">Key points</p><ul class="kp">' +
      st.keyPoints.map(function (k) { return "<li>" + esc(k) + "</li>"; }).join("") + "</ul>" +
      '<p class="seclab">Pickup over the day</p>' + spark(st.pickup, true) +
      '<p class="seclab">How this was graded</p><p class="prose">' + esc(st.grading) + "</p>" +
      '<p class="seclab">Timeline</p><ul class="tl">' +
      tl.map(function (e) { return "<li><time>" + esc(e.t) + "</time><span>" + esc(e.s) + "</span></li>"; }).join("") +
      "</ul>" +
      '<p class="seclab">Where to read it</p><div class="srcs">' +
      '<a href="' + esc(st.source.url) + '" target="_blank" rel="noopener"><b>' + esc(st.source.name) +
      "</b><span>" + esc(st.detected) + " \u00b7 first</span><u>\u2197</u></a>" +
      st.also.map(function (a) {
        return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener"><b>' + esc(a.name) +
          "</b><span>" + esc(a.at) + (a.note ? " \u00b7 " + esc(a.note) : "") + "</span><u>\u2197</u></a>";
      }).join("") + "</div>" +
      '<p class="seclab">Why this ranked ' + (st.rank === 1 ? "first" : "number " + st.rank) +
      '</p><dl class="bars">' + bars + "</dl></div>";
  }

  function screenSaved() {
    if (!state.saved.length) {
      return '<div class="head"><div class="day">The bin</div><h1>Saved</h1>' +
        '<p class="sub">Nothing on the pins yet</p></div>' +
        '<div class="empty">Nothing saved yet. Open a story and press Save, and it hangs here ' +
        "until you take it down. Saved stories keep their grade and their link to the original.</div>";
    }
    var groups = [
      { when: "Today", ids: state.saved.slice(0, 2) },
      { when: "Yesterday", ids: state.saved.slice(2, 3) },
      { when: "Earlier this week", ids: state.saved.slice(3) }
    ];
    var html = '<div class="railstrip"></div><div class="head"><div class="day">The bin</div><h1>Saved</h1>' +
      '<p class="sub">' + state.saved.length + " on the pins \u00b7 " +
      state.saved.reduce(function (p, id) { return p + byId(id).minutes; }, 0) + " minutes</p></div>";
    groups.forEach(function (g) {
      if (!g.ids.length) return;
      html += '<div class="bingroup"><span class="label">' + esc(g.when) + "</span></div>";
      g.ids.forEach(function (id) {
        var st = byId(id);
        html += '<button class="pin" data-story="' + st.id + '"><span class="hook"></span><span>' +
          "<h3>" + esc(st.headline) + "</h3>" +
          '<span class="meta"><b>' + esc(st.source.name) + "</b><span>\u00b7</span><span>" +
          esc(GRADE[st.verification].word) + "</span><span>\u00b7</span><span>" + st.minutes +
          " min</span></span></span></button>";
      });
    });
    return html;
  }

  function screenSettings() {
    var html = '<div class="railstrip"></div><div class="head"><div class="day">AI Radar</div><h1>Settings</h1>' +
      '<p class="sub">Self-hosted \u00b7 ingests every 30 minutes</p></div>';

    html += '<div class="group"><h2>What you care about</h2>' +
      '<p class="hint">Ranking leans toward these. It never hides anything \u2014 everything ' +
      'still arrives in Live Radar.</p><div class="chips">' +
      TOPICS.map(function (t) {
        return '<button data-topic="' + esc(t) + '" aria-pressed="' +
          (state.interests.indexOf(t) > -1) + '">' + esc(t) + "</button>";
      }).join("") + "</div></div>";

    html += '<div class="group"><h2>Your brief</h2>' +
      '<div class="field"><label for="bt">Ready by</label>' +
      '<input id="bt" type="time" value="07:00"></div>' +
      '<div class="field"><label for="tz">Time zone</label>' +
      '<select id="tz"><option>America/Toronto</option><option>UTC</option>' +
      "<option>Europe/London</option><option>Asia/Tehran</option></select></div>" +
      '<div class="field"><label for="dl">Default length</label>' +
      '<select id="dl"><option>5 minutes</option><option selected>10 minutes</option>' +
      "<option>Everything</option></select></div></div>";

    html += '<div class="group"><h2>How you hear about it</h2><div class="radios">' +
      [["brief", "One push when the brief is ready", "A single notification at your chosen time. Nothing else all day."],
       ["urgent", "That, plus anything major", "Adds a push for a primary-source release from a lab you follow."],
       ["none", "Nothing, I will open it myself", "No notifications. The brief is waiting when you arrive."]]
      .map(function (r) {
        return '<label><input type="radio" name="notify" value="' + r[0] + '"' +
          (state.notify === r[0] ? " checked" : "") + "><span>" + esc(r[1]) +
          "<small>" + esc(r[2]) + "</small></span></label>";
      }).join("") + "</div></div>";

    html += '<div class="group"><h2>Sources</h2>' +
      '<p class="hint">Ten feeds, no API keys needed. Everything here is free and public.</p>' +
      SRC.map(function (s, i) {
        return '<div class="srcrow"><span class="n"><a href="' + esc(s.url) +
          '" target="_blank" rel="noopener">' + esc(s.name) + "</a></span>" +
          '<span class="k">' + esc(s.kind) + "</span>" +
          '<button class="sw" data-src="' + i + '" aria-pressed="' + !!state.sources[i] +
          '" aria-label="' + (state.sources[i] ? "Turn off " : "Turn on ") + esc(s.name) + '"></button></div>';
      }).join("") + "</div>";

    html += '<div class="group"><h2>What the grades mean</h2>' +
      '<p class="hint">Every story carries one. It is kept separate from what kind of thing ' +
      "the story is, so a rumour about a model release is labelled as both.</p>" +
      gradeKey(false) + "</div>";

    html += '<div class="group"><h2>First run</h2>' +
      '<p class="hint">The three questions a new install asks before it shows anything.</p>' +
      '<button class="btn" data-goto="onboarding">See the first-run setup</button></div>';
    return html;
  }

  function screenOnboarding() {
    var steps = [
      { t: "What do you want to know about?",
        l: "Pick a few. This tilts the ranking; it never hides anything from Live Radar.",
        body: '<div class="chips">' + TOPICS.map(function (t) {
          return '<button data-topic="' + esc(t) + '" aria-pressed="' +
            (state.interests.indexOf(t) > -1) + '">' + esc(t) + "</button>"; }).join("") + "</div>" },
      { t: "When should the brief be ready?",
        l: "The worker gathers overnight so it is finished before you open it.",
        body: '<div class="field"><label for="obt">Ready by</label><input id="obt" type="time" value="07:00"></div>' +
              '<div class="field"><label for="obz">Time zone</label><select id="obz">' +
              "<option>America/Toronto</option><option>UTC</option><option>Europe/London</option>" +
              "<option>Asia/Tehran</option></select></div>" },
      { t: "How should it reach you?",
        l: "You can change any of this later in Settings.",
        body: '<div class="radios">' +
          [["brief", "One push when the brief is ready", "A single notification. Nothing else all day."],
           ["urgent", "That, plus anything major", "Adds a push for a primary-source release from a lab you follow."],
           ["none", "Nothing, I will open it myself", "No notifications at all."]]
          .map(function (r) {
            return '<label><input type="radio" name="obnotify" value="' + r[0] + '"' +
              (state.notify === r[0] ? " checked" : "") + "><span>" + esc(r[1]) +
              "<small>" + esc(r[2]) + "</small></span></label>"; }).join("") + "</div>" }
    ];
    var s = steps[state.obStep - 1];
    return '<div class="ob"><div class="step">Step ' + state.obStep + " of 3</div>" +
      "<h1>" + esc(s.t) + '</h1><p class="lede">' + esc(s.l) + "</p>" +
      '<div class="panel">' + s.body + "</div>" +
      '<div class="actions">' +
      (state.obStep > 1 ? '<button class="btn" data-ob="-1">Back</button>' : "") +
      '<button class="btn primary" data-ob="1">' +
      (state.obStep === 3 ? "Build my first brief" : "Continue") + "</button>" +
      '<span class="dots">' + [1, 2, 3].map(function (i) {
        return '<i class="' + (i === state.obStep ? "on" : "") + '"></i>'; }).join("") +
      "</span></div></div>";
  }

  /* ---------- shell ------------------------------------------------------ */
  var NAV = [["today", "Today"], ["radar", "Radar"], ["saved", "Saved"], ["settings", "Settings"]];

  function sidebar() {
    return '<aside class="side"><div class="brand"><span class="mark"></span><b>AI Radar</b></div>' +
      "<nav>" + NAV.map(function (n) {
        var count = n[0] === "today" ? 8 : n[0] === "radar" ? totalArrivals()
          : n[0] === "saved" ? state.saved.length : "";
        return '<button data-goto="' + n[0] + '"' +
          (state.screen === n[0] || (n[0] === "today" && state.screen === "story") ? ' aria-current="page"' : "") +
          ">" + n[1] + (count !== "" ? '<span class="n">' + count + "</span>" : "") + "</button>";
      }).join("") + "</nav>" +
      '<div class="keybox"><p class="cap">How sure are we</p>' + gradeKey(true) + "</div></aside>";
  }

  function aside() {
    if (state.screen === "today") {
      var counts = { 5: 4, 10: 8, all: S.length };
      var shown = S.slice(0, counts[state.mode] || S.length);
      var tally = { primary: 0, corroborated: 0, emerging: 0, unverified: 0 };
      shown.forEach(function (st) { tally[st.verification]++; });
      var rows = Object.keys(tally).map(function (k) {
        return '<div class="bar"><dt>' + esc(GRADE[k].word) + '</dt>' +
          '<div class="track"><i style="width:' + Math.round(tally[k] / shown.length * 100) +
          '%"></i></div><dd>' + tally[k] + "</dd></div>";
      }).join("");
      var confident = tally.primary + tally.corroborated;
      return '<div class="aside"><div class="group"><h2>How today grades out</h2>' +
        '<p class="hint">' + confident + " of " + shown.length +
        " stories in this brief are confirmed. The rest are labelled so you can weigh them." +
        '</p><dl class="bars">' + rows + "</dl></div>" +
        '<div class="group"><h2>Today\u2019s shape</h2>' +
        arrivals(true) + "</div></div>";
    }
    if (state.screen === "radar") {
      return '<div class="aside"><div class="group"><h2>Your topics</h2>' +
        '<p class="hint">Radar shows everything. These only tilt the brief.</p><div class="chips">' +
        state.interests.map(function (t) { return '<button aria-pressed="true">' + esc(t) + "</button>"; }).join("") +
        "</div></div></div>";
    }
    return "";
  }

  function render() {
    var el = document.getElementById("app");
    var body =
      state.screen === "today" ? screenToday() :
      state.screen === "radar" ? screenRadar() :
      state.screen === "story" ? screenStory() :
      state.screen === "saved" ? screenSaved() :
      state.screen === "onboarding" ? screenOnboarding() : screenSettings();

    var desktop = document.body.classList.contains("dev-desktop");
    var inner = desktop
      ? sidebar() + '<div class="main"><div class="screen"><div class="colwrap">' +
        '<div class="col">' + body + "</div>" + aside() + "</div></div></div>"
      : '<div class="screen">' + body + "</div>" +
        '<nav class="tabs">' + NAV.map(function (n) {
          return '<button data-goto="' + n[0] + '"' +
            (state.screen === n[0] || (n[0] === "today" && state.screen === "story") ? ' aria-current="page"' : "") +
            ">" + n[1] + "</button>"; }).join("") + "</nav>";

    el.className = "app";
    el.innerHTML = inner;
    el.querySelector(".screen").scrollTop = 0;
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("a")) return;   /* a real link wins over the card */
    var t = e.target.closest("[data-story],[data-goto],[data-mode],[data-filter],[data-back],[data-topic],[data-src],[data-ob]");
    if (!t || !document.getElementById("app").contains(t)) return;
    if (t.hasAttribute("data-story")) { state.story = t.getAttribute("data-story"); state.screen = "story"; }
    else if (t.hasAttribute("data-back")) { state.screen = "today"; }
    else if (t.hasAttribute("data-goto")) { state.screen = t.getAttribute("data-goto"); }
    else if (t.hasAttribute("data-mode")) { var m = t.getAttribute("data-mode"); state.mode = m === "all" ? "all" : +m; }
    else if (t.hasAttribute("data-filter")) { state.filter = t.getAttribute("data-filter"); }
    else if (t.hasAttribute("data-topic")) {
      var tp = t.getAttribute("data-topic"), i = state.interests.indexOf(tp);
      if (i > -1) state.interests.splice(i, 1); else state.interests.push(tp);
    } else if (t.hasAttribute("data-src")) {
      var k = +t.getAttribute("data-src"); state.sources[k] = !state.sources[k];
    } else if (t.hasAttribute("data-ob")) {
      state.obStep += +t.getAttribute("data-ob");
      if (state.obStep > 3) { state.obStep = 1; state.screen = "today"; }
      if (state.obStep < 1) state.obStep = 1;
    }
    render();
  });

  document.addEventListener("change", function (e) {
    if (e.target.name === "notify" || e.target.name === "obnotify") state.notify = e.target.value;
  });

  window.RadarApp = { render: render, state: state, gotoScreen: function (s) { state.screen = s; render(); } };
  document.addEventListener("DOMContentLoaded", render);
  if (document.readyState !== "loading") render();
})();
