/*
 * 견적서·거래명세서 생성기 - 순수 로직 (DOM 없음, node 테스트 가능)
 * 이 파일은 네트워크 요청을 하지 않는다.
 *
 * 금액은 모두 BigInt(원 단위 정수)로 계산한다. 부동소수점을 쓰지 않는다.
 * 수량은 소수 3자리까지 허용하며 1000배한 정수(milli)로 다룬다.
 *
 * 반올림 규칙(화면 안내와 동일하게 유지할 것):
 *  1) 품목 금액 = 수량 × 단가, 원 미만 반올림(0.5원 이상 올림)
 *  2) 부가세 별도: 공급가액 = 품목 금액 합, 세액 = 공급가액 × 10%, 원 미만 반올림
 *  3) 부가세 포함: 합계 = 품목 금액 합, 공급가액 = 합계 ÷ 1.1, 원 미만 반올림, 세액 = 합계 − 공급가액
 *  4) 면세: 세액 0, 공급가액 = 합계 = 품목 금액 합
 */
(function (root) {
  'use strict';

  var LIMITS = {
    maxItems: 100,
    qtyIntDigits: 9,     // 수량 정수부 최대 자릿수
    qtyDecimals: 3,      // 수량 소수 자릿수
    priceDigits: 12,     // 단가 최대 자릿수. 최대 입력 100행의 합계(부가세 포함)가 한글 표기 한도(해 단위, 24자리) 안에 들도록 정함
    textMax: 200,        // 일반 입력 최대 글자 수
    noteMax: 2000        // 비고 최대 글자 수
  };
  var VAT_MODES = ['separate', 'included', 'exempt'];
  var DOC_TYPES = ['quote', 'statement'];
  var DOC_TITLES = { quote: '견적서', statement: '거래명세서' };

  function stripSpacesCommas(s) {
    return String(s == null ? '' : s).replace(/[\s,]/g, '');
  }

  // 수량: "", "3", "1.5", "0.125", "1,000" 허용. 음수·지수표기 불가.
  function parseQty(input) {
    var s = stripSpacesCommas(input);
    if (s === '') return { empty: true };
    var re = new RegExp('^(\\d{1,' + LIMITS.qtyIntDigits + '})(?:\\.(\\d{1,' + LIMITS.qtyDecimals + '}))?$');
    var m = re.exec(s);
    if (!m) {
      if (/^\d*\.\d+$|^\d+\.?$/.test(s)) {
        return { error: '수량은 정수 ' + LIMITS.qtyIntDigits + '자리, 소수 ' + LIMITS.qtyDecimals + '자리까지 입력할 수 있습니다.' };
      }
      return { error: '수량은 0 이상의 숫자로 입력하세요(예: 3, 1.5).' };
    }
    var frac = (m[2] || '');
    while (frac.length < LIMITS.qtyDecimals) frac += '0';
    var milli = BigInt(m[1]) * 1000n + BigInt(frac);
    return { milli: milli };
  }

  // 단가: 원 단위 0 이상 정수. 콤마 허용.
  function parsePrice(input) {
    var s = stripSpacesCommas(input);
    if (s === '') return { empty: true };
    if (!/^\d+$/.test(s)) return { error: '단가는 원 단위 0 이상의 정수로 입력하세요(소수·음수 불가).' };
    s = s.replace(/^0+(?=\d)/, '');
    if (s.length > LIMITS.priceDigits) return { error: '단가는 ' + LIMITS.priceDigits + '자리까지 입력할 수 있습니다.' };
    return { won: BigInt(s) };
  }

  // 0 이상 정수 n을 d로 나눈 몫을 반올림(0.5 이상 올림)한다.
  function roundDiv(n, d) {
    if (n < 0n || d <= 0n) throw new RangeError('roundDiv: n>=0, d>0만 지원');
    return (n * 2n + d) / (d * 2n);
  }

  function lineAmount(milli, won) {
    return roundDiv(milli * won, 1000n);
  }

  // rows: [{qty, price}] (문자열). 빈 행(수량·단가 모두 비었음)은 금액 0으로 본다.
  // 반환: { rows:[{amount|null, qtyError, priceError}], ok, supply, vat, total }
  function calculate(rows, vatMode) {
    if (VAT_MODES.indexOf(vatMode) < 0) throw new RangeError('알 수 없는 부가세 방식: ' + vatMode);
    var out = [];
    var sum = 0n;
    var ok = true;
    for (var i = 0; i < rows.length; i++) {
      var q = parseQty(rows[i].qty);
      var p = parsePrice(rows[i].price);
      var r = { amount: null, qtyError: q.error || null, priceError: p.error || null };
      if (q.error || p.error) {
        ok = false;
      } else if (q.empty && p.empty) {
        r.amount = null; // 완전히 빈 행
      } else if (q.empty || p.empty) {
        // 한쪽만 입력: 계산 보류(오류는 아님, 안내만)
        r.incomplete = true;
      } else {
        r.amount = lineAmount(q.milli, p.won);
        sum += r.amount;
      }
      out.push(r);
    }
    var t = splitTotals(sum, vatMode);
    return { rows: out, ok: ok, supply: t.supply, vat: t.vat, total: t.total };
  }

  function splitTotals(sum, vatMode) {
    var supply, vat, total;
    if (vatMode === 'separate') {
      supply = sum;
      vat = roundDiv(sum, 10n);
      total = supply + vat;
    } else if (vatMode === 'included') {
      total = sum;
      supply = roundDiv(sum * 10n, 11n);
      vat = total - supply;
    } else {
      supply = sum; vat = 0n; total = sum;
    }
    return { supply: supply, vat: vat, total: total };
  }

  function formatWon(n) {
    return BigInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatQty(milli) {
    var s = BigInt(milli).toString();
    while (s.length < 4) s = '0' + s;
    var ip = s.slice(0, -3), fp = s.slice(-3).replace(/0+$/, '');
    ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fp ? ip + '.' + fp : ip;
  }

  // 한글 금액. 1도 '일'을 붙여 쓴다(예: 110000 -> 일십일만). 위·변조 방지용 관행 표기.
  var DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  var SMALL = ['', '십', '백', '천'];
  var BIG = ['', '만', '억', '조', '경', '해'];
  function toHangulNumber(n) {
    n = BigInt(n);
    if (n < 0n) throw new RangeError('음수는 지원하지 않습니다.');
    if (n === 0n) return '영';
    var s = n.toString();
    if (s.length > BIG.length * 4) throw new RangeError('금액이 너무 큽니다.');
    var out = '';
    var groups = Math.ceil(s.length / 4);
    for (var g = groups - 1; g >= 0; g--) {
      var end = s.length - g * 4;
      var start = Math.max(0, end - 4);
      var chunk = s.slice(start, end);
      var part = '';
      for (var i = 0; i < chunk.length; i++) {
        var d = chunk.charCodeAt(i) - 48;
        if (d === 0) continue;
        part += DIGITS[d] + SMALL[chunk.length - 1 - i];
      }
      if (part) out += part + BIG[g];
    }
    return out;
  }
  function hangulWon(n) {
    return '일금 ' + toHangulNumber(n) + '원정';
  }

  // 사업자등록번호: 숫자 10자리 형식만 확인한다. 실제 등록 여부(진위)는 확인하지 않는다.
  function checkBizNo(input) {
    var raw = String(input == null ? '' : input).trim();
    if (raw === '') return { empty: true };
    var digits = raw.replace(/[\s-]/g, '');
    if (!/^\d{10}$/.test(digits)) {
      return { error: '사업자등록번호 형식은 숫자 10자리(000-00-00000)입니다.' };
    }
    return { formatted: digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5) };
  }

  function isValidDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (m < 1 || m > 12 || d < 1) return false;
    var dim = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return d <= dim[m - 1];
  }

  function formatDateKo(s) {
    if (!isValidDate(s)) return '';
    return s.slice(0, 4) + '년 ' + (+s.slice(5, 7)) + '월 ' + (+s.slice(8, 10)) + '일';
  }

  var PARTY_FIELDS = {
    supplier: ['bizNo', 'name', 'ceo', 'address', 'bizType', 'bizItem', 'phone'],
    client: ['bizNo', 'name', 'ceo', 'address', 'phone']
  };

  function emptyDoc(today) {
    var d = { app: 'quote-maker', version: 1, docType: 'quote', date: today || '', vatMode: 'separate', supplier: {}, client: {}, items: [{ name: '', spec: '', qty: '', price: '' }], note: '' };
    PARTY_FIELDS.supplier.forEach(function (k) { d.supplier[k] = ''; });
    PARTY_FIELDS.client.forEach(function (k) { d.client[k] = ''; });
    return d;
  }

  function str(v, max) {
    if (v == null) return '';
    if (typeof v !== 'string' && typeof v !== 'number') throw new TypeError('문자열이 아닌 값이 있습니다.');
    var s = String(v);
    if (s.length > max) s = s.slice(0, max);
    return s;
  }

  // 불러온 JSON을 검사해 안전한 문서 객체로 바꾼다. 실패하면 Error를 던진다.
  // 알 수 없는 필드는 버린다. 값은 문자열로만 다룬다(화면에는 textContent/value로만 넣는다).
  function normalizeDoc(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('파일 형식이 올바르지 않습니다.');
    if (obj.app !== 'quote-maker') throw new Error('이 도구에서 내려받은 파일이 아닙니다.');
    if (obj.version !== 1) throw new Error('지원하지 않는 파일 버전입니다.');
    var d = emptyDoc('');
    if (DOC_TYPES.indexOf(obj.docType) >= 0) d.docType = obj.docType;
    if (VAT_MODES.indexOf(obj.vatMode) >= 0) d.vatMode = obj.vatMode;
    if (typeof obj.date === 'string' && isValidDate(obj.date)) d.date = obj.date;
    ['supplier', 'client'].forEach(function (p) {
      var src = obj[p] && typeof obj[p] === 'object' ? obj[p] : {};
      PARTY_FIELDS[p].forEach(function (k) { d[p][k] = str(src[k], LIMITS.textMax); });
    });
    if (!Array.isArray(obj.items)) throw new Error('품목 목록이 없습니다.');
    if (obj.items.length > LIMITS.maxItems) throw new Error('품목은 최대 ' + LIMITS.maxItems + '개까지 불러올 수 있습니다.');
    d.items = obj.items.map(function (it) {
      if (!it || typeof it !== 'object') throw new Error('품목 형식이 올바르지 않습니다.');
      return { name: str(it.name, LIMITS.textMax), spec: str(it.spec, LIMITS.textMax), qty: str(it.qty, 40), price: str(it.price, 40) };
    });
    if (d.items.length === 0) d.items.push({ name: '', spec: '', qty: '', price: '' });
    d.note = str(obj.note, LIMITS.noteMax);
    return d;
  }

  // 파일 이름은 ASCII로 만든다(한글 download 이름은 일부 브라우저 환경에서 'download'로 바뀌는 것을 확인함).
  function fileName(doc) {
    var t = doc.docType === 'statement' ? 'statement' : 'quote';
    return t + '_' + (isValidDate(doc.date) ? doc.date : 'nodate') + '.json';
  }

  var api = {
    LIMITS: LIMITS, VAT_MODES: VAT_MODES, DOC_TYPES: DOC_TYPES, DOC_TITLES: DOC_TITLES, PARTY_FIELDS: PARTY_FIELDS,
    parseQty: parseQty, parsePrice: parsePrice, roundDiv: roundDiv, lineAmount: lineAmount,
    calculate: calculate, splitTotals: splitTotals, formatWon: formatWon, formatQty: formatQty,
    toHangulNumber: toHangulNumber, hangulWon: hangulWon, checkBizNo: checkBizNo,
    isValidDate: isValidDate, formatDateKo: formatDateKo, emptyDoc: emptyDoc, normalizeDoc: normalizeDoc, fileName: fileName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuoteCore = api;
})(typeof self !== 'undefined' ? self : this);
