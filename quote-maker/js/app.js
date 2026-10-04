/*
 * 견적서·거래명세서 생성기 - 화면 로직
 * 네트워크 요청 없음(CSP connect-src 'none'). 쿠키·localStorage·sessionStorage·IndexedDB 사용 안 함.
 * 사용자 입력은 textContent / value 로만 화면에 넣는다(innerHTML 사용 안 함).
 */
(function () {
  'use strict';
  var C = window.QuoteCore;
  var $ = function (id) { return document.getElementById(id); };

  var MODE_RULES = {
    separate: '부가세 별도: 단가에 부가세가 들어 있지 않습니다. 세액 = 공급가액 합계 × 10%, 원 미만 반올림. 합계 = 공급가액 + 세액.',
    included: '부가세 포함: 단가에 부가세가 들어 있습니다. 공급가액 = 합계 ÷ 1.1, 원 미만 반올림. 세액 = 합계 − 공급가액.',
    exempt: '면세: 세액을 0원으로 둡니다. 면세 대상인지는 이 도구가 판단하지 않습니다.'
  };
  var SUM_LABELS = { separate: '합계금액 (공급가액 + 세액)', included: '합계금액 (부가세 포함)', exempt: '합계금액 (면세)' };
  var AMOUNT_HEADS = { separate: '공급가액', included: '금액(부가세 포함)', exempt: '금액' };
  var LEADS = { quote: '아래와 같이 견적합니다.', statement: '아래와 같이 거래 내역을 알려 드립니다.' };

  var itemsList = $('items');
  var rowSeq = 0;
  var dirty = false;

  function todayLocal() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function setStatus(node, msg, kind) {
    node.textContent = msg || '';
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------- 품목 행 ----------
  function makeField(rowId, key, labelText, value, attrs) {
    var wrap = el('div', 'field f-' + key);
    var id = 'item-' + key + '-' + rowId;
    var label = el('label', null, labelText);
    label.htmlFor = id;
    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.dataset.field = key;
    input.value = value || '';
    input.autocomplete = 'off';
    for (var k in attrs) input.setAttribute(k, attrs[k]);
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function addRow(item, focus) {
    if (itemsList.children.length >= C.LIMITS.maxItems) {
      setStatus($('items-status'), '품목은 최대 ' + C.LIMITS.maxItems + '개까지 추가할 수 있습니다.', 'error');
      return null;
    }
    item = item || { name: '', spec: '', qty: '', price: '' };
    var rowId = ++rowSeq;
    var li = el('li', 'item-row');
    var fs = el('fieldset');
    var legend = el('legend', 'item-legend');
    fs.appendChild(legend);
    var grid = el('div', 'item-grid');
    var errId = 'item-err-' + rowId;
    grid.appendChild(makeField(rowId, 'name', '품명', item.name, { maxlength: C.LIMITS.textMax }));
    grid.appendChild(makeField(rowId, 'spec', '규격', item.spec, { maxlength: C.LIMITS.textMax }));
    grid.appendChild(makeField(rowId, 'qty', '수량', item.qty, { inputmode: 'decimal', maxlength: 40, 'aria-describedby': errId }));
    grid.appendChild(makeField(rowId, 'price', '단가(원)', item.price, { inputmode: 'numeric', maxlength: 40, 'aria-describedby': errId }));
    var amt = el('div', 'field f-amount');
    var amtLabel = el('span', 'label', '금액(원)');
    var out = el('output', 'item-amount', '0');
    amtLabel.id = 'item-amt-label-' + rowId;
    out.setAttribute('aria-labelledby', amtLabel.id);
    amt.appendChild(amtLabel);
    amt.appendChild(out);
    grid.appendChild(amt);
    var del = el('button', 'btn btn-del', '삭제');
    del.type = 'button';
    grid.appendChild(del);
    fs.appendChild(grid);
    var err = el('p', 'row-error');
    err.id = errId;
    fs.appendChild(err);
    li.appendChild(fs);
    itemsList.appendChild(li);
    relabelRows();
    if (focus) li.querySelector('input').focus();
    return li;
  }

  function relabelRows() {
    var rows = itemsList.children;
    for (var i = 0; i < rows.length; i++) {
      rows[i].querySelector('legend').textContent = '품목 ' + (i + 1);
      var del = rows[i].querySelector('.btn-del');
      del.setAttribute('aria-label', '품목 ' + (i + 1) + ' 삭제');
      del.disabled = rows.length === 1;
    }
    $('add-item').disabled = rows.length >= C.LIMITS.maxItems;
  }

  function deleteRow(li) {
    if (itemsList.children.length <= 1) return;
    var idx = Array.prototype.indexOf.call(itemsList.children, li);
    li.remove();
    relabelRows();
    var rows = itemsList.children;
    var next = rows[Math.min(idx, rows.length - 1)];
    (next.querySelector('.btn-del:not(:disabled)') || $('add-item')).focus();
    setStatus($('items-status'), (idx + 1) + '번째 품목을 삭제했습니다. 남은 품목 ' + rows.length + '개.');
    markDirty();
    update();
  }

  // ---------- 문서 읽기/쓰기 ----------
  function radioValue(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }
  function setRadio(name, value) {
    var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }

  function readDoc() {
    var d = C.emptyDoc('');
    d.docType = radioValue('docType');
    d.vatMode = radioValue('vatMode');
    d.date = $('doc-date').value;
    ['supplier', 'client'].forEach(function (p) {
      C.PARTY_FIELDS[p].forEach(function (k) { d[p][k] = $(p + '-' + k).value; });
    });
    d.items = Array.prototype.map.call(itemsList.children, function (li) {
      var o = {};
      li.querySelectorAll('input[data-field]').forEach(function (inp) { o[inp.dataset.field] = inp.value; });
      return o;
    });
    d.note = $('note').value;
    return d;
  }

  function writeDoc(d) {
    setRadio('docType', d.docType);
    setRadio('vatMode', d.vatMode);
    $('doc-date').value = d.date;
    ['supplier', 'client'].forEach(function (p) {
      C.PARTY_FIELDS[p].forEach(function (k) { $(p + '-' + k).value = d[p][k]; });
    });
    while (itemsList.firstChild) itemsList.removeChild(itemsList.firstChild);
    d.items.forEach(function (it) { addRow(it, false); });
    $('note').value = d.note;
    ['supplier', 'client'].forEach(function (p) { checkBiz(p, false); });
    setStatus($('items-status'), '');
    update();
  }

  // ---------- 검증 ----------
  function checkBiz(party, reformat) {
    var input = $(party + '-bizNo');
    var msg = $(party + '-bizNo-msg');
    var r = C.checkBizNo(input.value);
    if (r.error) {
      input.setAttribute('aria-invalid', 'true');
      msg.textContent = r.error;
      msg.className = 'field-msg error';
    } else {
      input.removeAttribute('aria-invalid');
      msg.textContent = r.formatted ? '형식(숫자 10자리)만 확인했습니다. 실제 등록 여부는 확인하지 않습니다.' : '';
      msg.className = 'field-msg';
      if (r.formatted && reformat) input.value = r.formatted;
    }
    return !r.error;
  }

  // ---------- 계산·미리보기 ----------
  var lastCalc = null;

  function update() {
    var d = readDoc();
    var res = C.calculate(d.items, d.vatMode);
    lastCalc = res;
    var rows = itemsList.children;
    var incomplete = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = res.rows[i];
      var qtyIn = rows[i].querySelector('input[data-field="qty"]');
      var priceIn = rows[i].querySelector('input[data-field="price"]');
      if (r.qtyError) qtyIn.setAttribute('aria-invalid', 'true'); else qtyIn.removeAttribute('aria-invalid');
      if (r.priceError) priceIn.setAttribute('aria-invalid', 'true'); else priceIn.removeAttribute('aria-invalid');
      var msgs = [];
      if (r.qtyError) msgs.push(r.qtyError);
      if (r.priceError) msgs.push(r.priceError);
      if (r.incomplete) { msgs.push('수량과 단가를 모두 입력하면 금액이 계산됩니다.'); incomplete++; }
      rows[i].querySelector('.row-error').textContent = msgs.join(' ');
      rows[i].querySelector('.row-error').className = 'row-error' + (r.qtyError || r.priceError ? ' error' : '');
      rows[i].querySelector('.item-amount').textContent = r.amount == null ? (r.qtyError || r.priceError ? '오류' : '0') : C.formatWon(r.amount);
    }
    $('mode-rule').textContent = MODE_RULES[d.vatMode];
    var sumNode = $('sum-status');
    if (!res.ok) {
      $('t-supply').textContent = '-';
      $('t-vat').textContent = '-';
      $('t-total').textContent = '-';
      $('t-hangul').textContent = '-';
      setStatus(sumNode, '빨간 표시가 있는 품목의 수량·단가를 고치면 합계가 계산됩니다.', 'error');
    } else {
      $('t-supply').textContent = C.formatWon(res.supply) + '원';
      $('t-vat').textContent = C.formatWon(res.vat) + '원';
      $('t-total').textContent = C.formatWon(res.total) + '원';
      $('t-hangul').textContent = C.hangulWon(res.total);
      setStatus(sumNode, incomplete ? '수량이나 단가가 비어 있는 품목은 합계에서 빠졌습니다.' : '', incomplete ? 'warn' : '');
    }
    renderPreview(d, res);
  }

  function partyLine(dl, label, value) {
    if (!value) return;
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', null, value));
  }

  function renderPreview(d, res) {
    var doc = $('doc');
    while (doc.firstChild) doc.removeChild(doc.firstChild);
    var title = C.DOC_TITLES[d.docType] || '견적서';
    var h = el('h2', 'doc-title', title.split('').join(' '));
    h.setAttribute('aria-label', title);
    doc.appendChild(h);

    var top = el('div', 'doc-top');
    var left = el('div', 'doc-client');
    left.appendChild(el('p', 'doc-date', '작성일: ' + (C.formatDateKo(d.date) || '\u00a0'.repeat(8) + '년' + '\u00a0'.repeat(6) + '월' + '\u00a0'.repeat(6) + '일')));
    left.appendChild(el('p', 'doc-client-name', (d.client.name || '\u00a0'.repeat(16)) + ' 귀하'));
    var cdl = el('dl', 'doc-kv');
    partyLine(cdl, '사업자등록번호', d.client.bizNo);
    partyLine(cdl, '대표자', d.client.ceo);
    partyLine(cdl, '주소', d.client.address);
    partyLine(cdl, '연락처', d.client.phone);
    if (cdl.children.length) left.appendChild(cdl);
    left.appendChild(el('p', 'doc-lead', LEADS[d.docType]));
    top.appendChild(left);

    var st = el('table', 'doc-supplier');
    var cap = el('caption', null, '공급자');
    st.appendChild(cap);
    var tb = el('tbody');
    var s = d.supplier;
    [['등록번호', s.bizNo], ['상호', s.name], ['대표자', s.ceo], ['주소', s.address], ['업태', s.bizType], ['종목', s.bizItem], ['연락처', s.phone]].forEach(function (pair) {
      var tr = el('tr');
      var th = el('th', null, pair[0]);
      th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(el('td', null, pair[1] || ''));
      tb.appendChild(tr);
    });
    st.appendChild(tb);
    top.appendChild(st);
    doc.appendChild(top);

    var sum = el('div', 'doc-sum');
    sum.appendChild(el('span', 'doc-sum-label', SUM_LABELS[d.vatMode]));
    if (res.ok) {
      sum.appendChild(el('strong', 'doc-sum-hangul', C.hangulWon(res.total)));
      sum.appendChild(el('span', 'doc-sum-num', '(₩' + C.formatWon(res.total) + ')'));
    } else {
      sum.appendChild(el('strong', 'doc-sum-hangul', '입력 확인 필요'));
    }
    doc.appendChild(sum);

    var it = el('table', 'doc-items');
    var thead = el('thead');
    var hr = el('tr');
    ['번호', '품명', '규격', '수량', '단가', AMOUNT_HEADS[d.vatMode]].forEach(function (t) {
      var th = el('th', null, t); th.scope = 'col'; hr.appendChild(th);
    });
    thead.appendChild(hr);
    it.appendChild(thead);
    var ib = el('tbody');
    var shown = 0;
    d.items.forEach(function (item, i) {
      var r = res.rows[i];
      if (!item.name && !item.spec && !item.qty && !item.price) return;
      shown++;
      var tr = el('tr');
      var q = C.parseQty(item.qty), p = C.parsePrice(item.price);
      tr.appendChild(el('td', 'c', String(shown)));
      tr.appendChild(el('td', null, item.name));
      tr.appendChild(el('td', null, item.spec));
      tr.appendChild(el('td', 'n', q.milli != null ? C.formatQty(q.milli) : item.qty));
      tr.appendChild(el('td', 'n', p.won != null ? C.formatWon(p.won) : item.price));
      tr.appendChild(el('td', 'n', r.amount != null ? C.formatWon(r.amount) : ''));
      ib.appendChild(tr);
    });
    // 인쇄 시 표가 너무 짧아 보이지 않도록 빈 줄을 채운다(최소 8줄)
    for (var k = shown; k < 8; k++) {
      var etr = el('tr', 'empty-row');
      for (var c = 0; c < 6; c++) etr.appendChild(el('td', null, ' '));
      ib.appendChild(etr);
    }
    it.appendChild(ib);
    doc.appendChild(it);

    var tt = el('table', 'doc-totals');
    var ttb = el('tbody');
    [['공급가액', res.supply], ['세액', res.vat], ['합계', res.total]].forEach(function (pair) {
      var tr = el('tr');
      var th = el('th', null, pair[0]); th.scope = 'row';
      tr.appendChild(th);
      tr.appendChild(el('td', 'n', res.ok ? C.formatWon(pair[1]) + '원' : '-'));
      ttb.appendChild(tr);
    });
    tt.appendChild(ttb);
    doc.appendChild(tt);

    var note = el('div', 'doc-note');
    note.appendChild(el('span', 'doc-note-label', '비고'));
    note.appendChild(el('p', null, d.note || ''));
    doc.appendChild(note);

    doc.appendChild(el('p', 'doc-foot', '세액 계산: ' + MODE_RULES[d.vatMode] + ' / 이 문서는 세금계산서가 아닙니다.'));
  }

  // ---------- 파일 저장·불러오기 ----------
  function downloadJson() {
    var d = readDoc();
    var text = JSON.stringify(d, null, 2);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = C.fileName(d);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    dirty = false;
    setStatus($('file-status'), '"' + a.download + '" 파일로 내려받았습니다. 이 파일은 내 기기에만 저장됩니다.', 'ok');
  }

  function loadJson(file) {
    var st = $('file-status');
    if (!file) return;
    if (file.size > 1000000) { setStatus(st, '파일이 너무 큽니다(1MB 이하만 불러올 수 있습니다).', 'error'); return; }
    if (dirty && !window.confirm('지금 입력한 내용이 불러온 파일 내용으로 바뀝니다. 계속할까요?')) return;
    var reader = new FileReader();
    reader.onload = function () {
      var d;
      try {
        d = C.normalizeDoc(JSON.parse(String(reader.result)));
      } catch (e) {
        setStatus(st, '불러오지 못했습니다: ' + (e instanceof SyntaxError ? 'JSON 형식이 아닙니다.' : e.message), 'error');
        return;
      }
      writeDoc(d);
      dirty = false;
      setStatus(st, '"' + file.name + '"을 불러왔습니다. 품목 ' + d.items.length + '개.', 'ok');
    };
    reader.onerror = function () { setStatus(st, '파일을 읽지 못했습니다.', 'error'); };
    reader.readAsText(file);
  }

  function markDirty() { dirty = true; }

  // ---------- 이벤트 ----------
  document.addEventListener('input', function (e) {
    if (e.target.closest('#editor')) { markDirty(); update(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'docType' || e.target.name === 'vatMode') { markDirty(); update(); }
  });
  itemsList.addEventListener('click', function (e) {
    var b = e.target.closest('.btn-del');
    if (b && !b.disabled) deleteRow(b.closest('.item-row'));
  });
  // 칸을 벗어나면 숫자에 천 단위 쉼표를 붙인다(값이 올바를 때만)
  itemsList.addEventListener('focusout', function (e) {
    var f = e.target.dataset && e.target.dataset.field;
    if (f === 'qty') {
      var q = C.parseQty(e.target.value);
      if (q.milli != null) e.target.value = C.formatQty(q.milli);
    } else if (f === 'price') {
      var p = C.parsePrice(e.target.value);
      if (p.won != null) e.target.value = C.formatWon(p.won);
    }
  });
  ['supplier', 'client'].forEach(function (p) {
    $(p + '-bizNo').addEventListener('blur', function () { checkBiz(p, true); update(); });
    $(p + '-bizNo').addEventListener('input', function () {
      // 입력 중에는 오류 표시만 지운다
      if (this.getAttribute('aria-invalid')) checkBiz(p, false);
    });
  });
  $('add-item').addEventListener('click', function () {
    if (addRow(null, true)) {
      setStatus($('items-status'), '품목을 추가했습니다. 모두 ' + itemsList.children.length + '개.');
      markDirty();
      update();
    }
  });
  $('print').addEventListener('click', function () {
    if (lastCalc && !lastCalc.ok && !window.confirm('수량·단가에 오류가 있어 합계가 비어 있습니다. 그래도 인쇄할까요?')) return;
    window.print();
  });
  $('save-json').addEventListener('click', downloadJson);
  $('load-json').addEventListener('change', function () {
    loadJson(this.files && this.files[0]);
    this.value = '';
  });
  $('reset-doc').addEventListener('click', function () {
    if (!window.confirm('입력한 내용을 모두 지우고 새로 작성할까요? 내려받지 않은 내용은 복구할 수 없습니다.')) return;
    writeDoc(C.emptyDoc(todayLocal()));
    dirty = false;
    setStatus($('file-status'), '새 문서를 시작했습니다.');
  });
  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  writeDoc(C.emptyDoc(todayLocal()));
})();
