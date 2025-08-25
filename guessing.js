console.log('guessing.js script loaded');
Qualtrics.SurveyEngine.addOnReady(function () {
    var q = question;
  
    // Load D3 v7
    function withD3(cb){
      if (window.d3 && +d3.version.split('.')[0] >= 7) return cb();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/d3@7';
      s.onload = cb;
      s.onerror = function(){ alert('Failed to load D3.'); };
      document.head.appendChild(s);
    }
  
    withD3(function () {
      // ----- Data / state -----
      var YEARS  = [2013, 2018, 2023, 2028, 2033];
      var FIXED_YEAR = 2023;
      var values = {};
      YEARS.forEach(function(y){ values[y] = 100000; });
  
      // active year for compact label display; locked flag to freeze UI
      var activeYear = FIXED_YEAR;
      var locked = false;
  
      // Embedded Data field map
      var ED = {
        values: { "2013":"pred2013", "2018":"pred2018", "2023":"pred2023", "2028":"pred2028", "2033":"pred2033" },
        pct: { "2013_2018":"pct_2013_2018", "2018_2023":"pct_2018_2023", "2023_2028":"pct_2023_2028", "2028_2033":"pct_2028_2033" },
        locked: "locked_answers"
      };
  
      // ----- Mount -----
      var cont = q.getQuestionContainer();
      var body = cont.querySelector('.QuestionBody') || cont;
  
      // Hide stray inputs if wrong question type was used
      Array.prototype.forEach.call(body.querySelectorAll('textarea,input'), function(el){ el.style.display = 'none'; });
  
      // Remove prior chart in this question
      Array.prototype.forEach.call(body.querySelectorAll('.draw-root'), function(n){ n.remove(); });
  
      var mount = document.createElement('div');
      mount.className = 'draw-root';
      mount.style.cssText = 'width:100%;max-width:900px;margin:8px auto 8px;overflow:visible;';
      mount.style.overscrollBehavior = 'contain';
      body.prepend(mount);
  
      // Controls container
      var controls = document.createElement('div');
      controls.style.cssText = 'width:100%;max-width:900px;margin:0 auto 8px;text-align:center;';
      body.appendChild(controls);
  
      var lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.textContent = 'Lock in my answers';
      lockBtn.style.cssText = 'padding:8px 14px;border:1px solid #d62728;border-radius:6px;background:#fff;color:#d62728;font-weight:600;cursor:pointer;';
      controls.appendChild(lockBtn);
  
      // Optional gating: require lock before Next
      q.disableNextButton();
  
      // CSS
      var H = 540; // tall enough for badge lane
      var style = document.createElement('style');
      style.textContent =
        '.draw-root svg{width:100% !important;height:' + H + 'px !important;display:block;}' +
        '.d3draw .tick text{fill:#444;font-size:12px;}' +
        '.d3draw .axis path,.d3draw .axis line{stroke:#999;shape-rendering:crispEdges;}' +
        '.d3draw .grid line{stroke:#eee;}' +
        '.d3draw .line{fill:none;stroke:#1f77b4;stroke-width:2.5px;vector-effect:non-scaling-stroke;}' +
        '.d3draw .handle{cursor:ns-resize;}' +
        '.d3draw .point-label{font-size:12px;fill:#222;pointer-events:none;}' +
        '.d3draw .fixed-note{font-size:12px;fill:#d62728;font-weight:600;pointer-events:none;}' +
        '.d3draw .seg-annot{font-size:12px;fill:#111;font-weight:600;pointer-events:none;}' +
        '.d3draw .seg-annot.compact{font-size:11px;}' +
        '.d3draw .seg-box{fill:#fff;stroke:#ddd;opacity:0.97;}';
      document.head.appendChild(style);
      // Ensure touch gestures are treated as drags on targets; disable text selection
      style.textContent +=
        '.d3draw .pt, .d3draw .handle, .d3draw .hit { touch-action: none; -ms-touch-action: none; }' +
        '.d3draw { -webkit-user-select: none; user-select: none; }';
  
      // ----- Scales & scaffolding -----
      var margin = { top:24, right:32, bottom:160, left:72 };
      var width, plotW, plotH, svg, g, x, y, linePath, pointsG, annG, drag;
  
      function layout(){
        width = Math.max(400, mount.clientWidth || 600);
        plotW = width - margin.left - margin.right;
        plotH = H - margin.top - margin.bottom;
      }
  
      function init(){
        console.log('Init function called');
        layout();
        d3.select(mount).selectAll('*').remove();
  
        svg = d3.select(mount).append('svg')
          .attr('class', 'd3draw')
          .attr('viewBox', '0 0 ' + width + ' ' + H)
          .attr('preserveAspectRatio', 'xMidYMid meet')
          .style('touch-action', 'none');
  
        g = svg.append('g')
          .attr('transform', 'translate(' + (margin.left + 20) + ',' + margin.top + ')');
  
        x = d3.scalePoint().domain(YEARS).range([0, plotW]).padding(0.5);
        y = d3.scaleLinear().domain([0, 200000]).range([plotH, 0]);

        // Persistent drag behavior (set up once)
        drag = d3.drag()
          .container(function(){ return g.node(); })
          .clickDistance(3)
          .filter(function(event, d){ return !locked && d.year !== FIXED_YEAR; })
          .on('start', function(event, d){
            console.log('start', event.sourceEvent && event.sourceEvent.type, event.pointerType);
            activeYear = d.year;
            // do not update value on start; wait for first drag move
            update();
          })
          .on('drag', function(event, d){
            setFromPointer(event, d);
          });
  
        // grid
        g.append('g').attr('class','grid')
          .call(d3.axisLeft(y).ticks(5).tickSize(-plotW).tickFormat(''))
          .selectAll('line').attr('stroke-opacity', 0.6);
  
        // axes
        g.append('g').attr('class','axis x')
          .attr('transform', 'translate(0,' + plotH + ')')
          .call(d3.axisBottom(x).tickFormat(d3.format('d')));
  
        g.append('g').attr('class','axis y')
          .call(d3.axisLeft(y).ticks(5).tickFormat(function(d){ return '$' + d3.format(',')(d); }));
  
        // labels
        var tickLabelHeight = g.select('.axis.x .tick text').node().getBBox().height;
        var xAxisLabelY = plotH + tickLabelHeight + 60;

        g.append('text')
          .attr('x', plotW/2).attr('y', xAxisLabelY)
          .attr('text-anchor','middle').attr('fill','#111').text('Year');
  
        var tickLabelWidth = g.select('.axis.y .tick text').node().getBBox().width;
        var yAxisLabelX = -margin.left - 8;

        g.append('text')
          .attr('transform','rotate(-90)')
          .attr('x', -plotH/2).attr('y', yAxisLabelX)
          .attr('text-anchor','middle').attr('fill','#111').text('Average wage (USD)');
  
        linePath = g.append('path').attr('class','line');
        pointsG  = g.append('g').attr('class','points');
        annG     = g.append('g').attr('class','annotations');
  
        update();
        console.log('Drag behavior setup complete');
      }

      function setFromPointer(event, d){
        var yPix;
        if (event && typeof event.y === 'number' && !isNaN(event.y)) {
          yPix = event.y;
        } else {
          var src = (event && event.sourceEvent) ? event.sourceEvent : event;
          var p = d3.pointer(src, g.node());
          if (!p || isNaN(p[1])) return;
          yPix = p[1];
        }
        yPix = Math.min(plotH, Math.max(0, yPix));
        var v = Math.round(y.invert(yPix) / 100) * 100;
        values[d.year] = Math.max(0, Math.min(200000, v));
        activeYear = d.year;
        update();
      }
  
      // ----- Percent helpers / saving -----
      function pctDecimal(a, b){
        if (a <= 0) return ''; // undefined; leave blank
        var p = (b - a) / a;
        return String(Math.round(p * 10000) / 10000); // 4 dp as string
      }
      function pctTop(a, b){
        if (a > 0) return d3.format('+.0%')((b - a) / a);
        if (a === 0 && b > 0) return '∞%';
        return '0%';
      }
      function saveToEmbeddedData(){
        q.setEmbeddedData(ED.values["2013"], values[2013]);
        q.setEmbeddedData(ED.values["2018"], values[2018]);
        q.setEmbeddedData(ED.values["2023"], values[2023]);
        q.setEmbeddedData(ED.values["2028"], values[2028]);
        q.setEmbeddedData(ED.values["2033"], values[2033]);
        q.setEmbeddedData(ED.pct["2013_2018"], pctDecimal(values[2013], values[2018]));
        q.setEmbeddedData(ED.pct["2018_2023"], pctDecimal(values[2018], values[2023]));
        q.setEmbeddedData(ED.pct["2023_2028"], pctDecimal(values[2023], values[2028]));
        q.setEmbeddedData(ED.pct["2028_2033"], pctDecimal(values[2028], values[2033]));
        q.setEmbeddedData(ED.locked, locked ? "1" : "0");
      }
  
      // ----- Label-placement rule -----
      function isLocalMinByRule(index){
        var year = YEARS[index];
        var v = values[year];
        var left = (index > 0) ? values[YEARS[index - 1]] : null;
        var right = (index < YEARS.length - 1) ? values[YEARS[index + 1]] : null;
        if (left === null && right !== null) return v < right;        // first point
        if (right === null && left !== null) return v < left;         // last point
        if (left === null && right === null) return false;
        return (v < left) && (v < right);                             // strict local min
      }
  
      // ----- Main render -----
      function update(){
        var data = YEARS.map(function(year){ return { year: year, value: values[year] }; });
  
        var line = d3.line()
          .x(function(d){ return x(d.year); })
          .y(function(d){ return y(d.value); })
          .curve(d3.curveLinear);
        linePath.datum(data).attr('d', line);
  
        // points
        var pts = pointsG.selectAll('g.pt').data(data, function(d){ return d.year; });
        var enter = pts.enter().append('g').attr('class','pt');

        // Larger invisible hit target for easier touch
        enter.append('circle')
          .attr('class','hit')
          .attr('r', 24)
          .attr('fill', 'transparent')
          .style('pointer-events', 'all');

        // Visible handle
        enter.append('circle')
          .attr('class','handle')
          .attr('r', 9)
          .attr('fill', '#fff')
          .attr('stroke', '#1f77b4')
          .attr('stroke-width', 3);
  
        enter.append('text')
          .attr('class','point-label')
          .attr('dx', 0)
          .attr('dy', 0);
  
        // fixed marker text for 2023
        enter.filter(function(d){ return d.year === FIXED_YEAR; })
          .append('text')
          .attr('class','fixed-note')
          .attr('text-anchor','middle')
          .attr('dy', -12)
          .text('True value (fixed)');
  
        var merged = enter.merge(pts);
  
        // position groups
        merged.attr('transform', function(d){ return 'translate(' + x(d.year) + ',' + y(d.value) + ')'; });
  
        // style points (lock turns everything red) - apply only to handle
        merged.select('circle.handle')
          .attr('fill', function(d){
            return (locked || d.year === FIXED_YEAR) ? '#d62728' : '#fff';
          })
          .attr('stroke', function(d){
            return (locked || d.year === FIXED_YEAR) ? '#d62728' : '#1f77b4';
          });
  
        // value label text
        merged.select('text.point-label')
          .text(function(d){ return '$' + d3.format(',')(Math.round(d.value)); });
  
        // placement logic
        var compact = (plotW < 420);
        merged.each(function(d, i){
          var sel = d3.select(this).select('text.point-label');
          var yPix = y(d.value);
  
          var above;
          if (!compact) {
            if (d.year === FIXED_YEAR) {
              above = false; // keep under the red note
            } else {
              var isMin = isLocalMinByRule(i);
              above = !isMin; // local min -> below; else above
            }
          } else {
            var preferAbove = true;
            if (d.year === FIXED_YEAR) preferAbove = false;
            if (yPix < 18) preferAbove = false;
            if ((plotH - yPix) < 26) preferAbove = true;
            above = preferAbove;
            if (d.year !== FIXED_YEAR && (i % 2 === 1)) above = !above;
          }
  
          var dy = above ? -12 : 18;
          var globalY = margin.top + yPix + dy;
          if (globalY > margin.top + plotH - 4) { dy = -12; }
          if (globalY < margin.top + 8)        { dy = 18;  }
  
          var dx = above ? (i % 2 === 0 ? 12 : -12) : (i % 2 === 0 ? -12 : 12);
  
          var show = true;
          if (compact && !locked) { show = (d.year === FIXED_YEAR || d.year === activeYear); }
  
          sel.attr('display', show ? null : 'none')
             .attr('dy', dy)
             .attr('dx', dx)
             .attr('text-anchor','middle');
        });
  
        // Attach persistent drag only to new nodes; listeners persist across updates
        enter.call(drag);
  
        pts.exit().remove();
  
        // ---- Percent-change badges ----
        var segs = [];
        for (var si = 0; si < YEARS.length - 1; si++) {
          var aY = YEARS[si], bY = YEARS[si+1];
          var midX = (x(aY) + x(bY)) / 2;
          segs.push({ key: aY + '-' + bY, x: midX, top: pctTop(values[aY], values[bY]), bottom: aY + '→' + bY });
        }
  
        var yAnnot = plotH + (compact ? 54 : 36);
  
        var ann = annG.selectAll('g.seg').data(segs, function(d){ return d.key; });
        var aEnter = ann.enter().append('g').attr('class','seg');
  
        aEnter.append('rect').attr('class','seg-box').attr('rx',4).attr('ry',4);
        aEnter.append('text').attr('class','seg-annot line1').attr('text-anchor','middle').attr('dy', 0);
        aEnter.append('text').attr('class','seg-annot line2').attr('text-anchor','middle').attr('dy', 14);
  
        var mergedAnn = ann.merge(aEnter);
        mergedAnn.attr('transform', function(d){ return 'translate(' + d.x + ',' + yAnnot + ')'; });
  
        mergedAnn.select('text.line1')
          .classed('compact', compact)
          .text(function(d){ return d.top; });
  
        mergedAnn.select('text.line2')
          .attr('display', compact ? 'none' : null)
          .text(function(d){ return d.bottom; });
  
        mergedAnn.each(function(){
          var gsel = d3.select(this);
          var t1 = gsel.select('text.line1').node();
          var t2node = gsel.select('text.line2');
          var t2 = t2node.attr('display') === 'none' ? null : t2node.node();
          var w1 = t1 ? t1.getBBox().width : 0;
          var w2 = t2 ? t2.getBBox().width : 0;
          var w  = Math.max(w1, w2) + 10;
          var h  = compact ? 16 : 24;
          gsel.select('rect.seg-box')
            .attr('x', -w/2)
            .attr('y', compact ? -10 : -12)
            .attr('width', w)
            .attr('height', h);
        });
  
        ann.exit().remove();
      }
  
      // ----- Lock workflow -----
      function lockAnswers(){
        if (locked) return;
        locked = true;
        saveToEmbeddedData();
        lockBtn.textContent = 'Answers locked';
        lockBtn.disabled = true;
        lockBtn.style.opacity = '0.75';
        q.enableNextButton();
        update();
      }
  
      lockBtn.addEventListener('click', lockAnswers);
  
      // Save on unload as a fallback (in case someone circumvents the button)
      Qualtrics.SurveyEngine.addOnUnload(function(){
        saveToEmbeddedData();
      });
  
      // Responsive width (height fixed)
      var raf;
      window.addEventListener('resize', function(){
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function(){ init(); if (locked) { saveToEmbeddedData(); } });
      });
  
      init();
    });
  });
  