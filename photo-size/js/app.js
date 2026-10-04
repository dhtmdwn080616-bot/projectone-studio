/*
 * 증명사진 규격 맞추기 - 화면 로직
 * 사진은 File -> ImageBitmap -> canvas -> Blob 으로만 다뤄지며 네트워크로 나가지 않는다.
 * (index.html의 CSP connect-src 'none'으로 브라우저 차원에서도 전송이 차단된다.)
 */
(function () {
  'use strict';
  var C = window.PhotoCore;
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    file: $('file'), drop: $('dropzone'), loadStatus: $('load-status'),
    stage: $('stage'), stageWrap: $('stage-wrap'), stageEmpty: $('stage-empty'),
    zoom: $('zoom'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), reset: $('reset'),
    preset: $('preset'), presetDesc: $('preset-desc'),
    w: $('out-w'), h: $('out-h'), kb: $('out-kb'), specStatus: $('spec-status'),
    img: $('result-img'), empty: $('result-empty'), stats: $('result-stats'),
    rPx: $('r-px'), rSize: $('r-size'), rTarget: $('r-target'), rQuality: $('r-quality'),
    resultStatus: $('result-status'), download: $('download'), orient: $('orient-note')
  };

  var MAX_ZOOM = 6;
  var state = {
    src: null, imgW: 0, imgH: 0, crop: null, aspect: 413 / 531,
    spec: null, presetId: 'passport',
    resultUrl: null, token: 0, timer: 0, loadToken: 0
  };

  // ---------- 프리셋 ----------
  C.PRESETS.forEach(function (p) {
    var o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    el.preset.appendChild(o);
  });

  function applyPreset(id) {
    var p = C.getPreset(id);
    state.presetId = id;
    el.preset.value = id;
    el.presetDesc.textContent = p.desc;
    if (id !== 'custom') {
      if (!p.keepAspect) { el.w.value = p.width; el.h.value = p.height; }
      el.kb.value = p.maxKB;
    }
    el.w.disabled = el.h.disabled = !!p.keepAspect;
    if (p.keepAspect) { el.w.value = ''; el.h.value = ''; el.w.placeholder = el.h.placeholder = '원본'; }
    else { el.w.placeholder = el.h.placeholder = ''; }
    readSpec(true);
  }

  function readSpec(resetCrop) {
    var p = C.getPreset(state.presetId);
    var v = C.validateSpec(el.w.value, el.h.value, el.kb.value, p.keepAspect);
    if (v.error) {
      el.specStatus.textContent = v.error;
      el.specStatus.className = 'status error';
      state.spec = null;
      clearTimeout(state.timer);
      state.token++;  // 진행 중이던 변환 결과가 뒤늦게 다운로드를 켜지 못하게 무효화
      setDownload(null);
      return;
    }
    el.specStatus.textContent = '';
    el.specStatus.className = 'status';
    var oldAspect = state.aspect;
    state.spec = v;
    state.aspect = v.keepAspect ? (state.imgW ? state.imgW / state.imgH : 1) : v.width / v.height;
    if (state.src && (resetCrop || Math.abs(oldAspect - state.aspect) > 1e-9 || !state.crop)) {
      state.crop = C.fitCrop(state.imgW, state.imgH, state.aspect);
    }
    render();
    schedule();
  }

  el.preset.addEventListener('change', function () { applyPreset(el.preset.value); });
  [el.w, el.h, el.kb].forEach(function (input) {
    input.addEventListener('input', function () {
      if (state.presetId !== 'custom') {
        var p = C.getPreset(state.presetId);
        if (p.keepAspect && input === el.kb) { readSpec(false); return; }
        state.presetId = 'custom';
        el.preset.value = 'custom';
        el.presetDesc.textContent = C.getPreset('custom').desc;
      }
      readSpec(false);
    });
  });

  // ---------- 사진 불러오기 ----------
  function setLoadStatus(msg, kind) {
    el.loadStatus.textContent = msg;
    el.loadStatus.className = 'status' + (kind ? ' ' + kind : '');
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return decodeWithImg(file);
      });
    }
    return decodeWithImg(file);
  }
  function decodeWithImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      im.src = url;
    });
  }

  // 파일 앞부분만 읽어 EXIF 방향을 확인한다(로컬 처리, 전송 없음).
  function readOrientation(file) {
    try {
      if (!file.slice || !file.slice(0, 1).arrayBuffer) return Promise.resolve(0);
      return file.slice(0, 131072).arrayBuffer().then(function (buf) {
        return C.parseExifOrientation(new Uint8Array(buf));
      }).catch(function () { return 0; });
    } catch (e) { return Promise.resolve(0); }
  }

  function loadFile(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) {
      setLoadStatus('이미지 파일이 아닙니다.', 'error');
      return;
    }
    setLoadStatus('사진을 여는 중...');
    el.orient.textContent = '';
    var myLoad = ++state.loadToken;
    readOrientation(file).then(function (o) {
      if (myLoad !== state.loadToken || !o || o < 2) return;
      el.orient.textContent = '이 사진에는 회전·뒤집기 정보(EXIF 방향 ' + o + ')가 들어 있습니다. 이 도구는 브라우저가 보여 주는 방향 그대로 저장하므로, 자르기 화면과 결과 미리보기의 위아래·좌우가 실제 사진과 같은지 꼭 확인하세요. 다르면 사진 앱에서 방향을 바로잡아 저장한 뒤 다시 불러오세요.';
    });
    decode(file).then(function (src) {
      if (myLoad !== state.loadToken) { if (src.close) src.close(); return; }  // 더 나중에 고른 사진이 있으면 버림
      var w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      if (!w || !h) throw new Error('size');
      if (state.src && state.src.close) state.src.close();
      state.src = src; state.imgW = w; state.imgH = h; state.crop = null;
      clearTimeout(state.timer); state.token++; setDownload(null);  // 이전 사진의 결과가 남아 저장되지 않게
      setLoadStatus('불러온 사진: ' + w + '×' + h + 'px (' + C.formatKB(file.size) + ')', 'ok');
      el.stage.hidden = false; el.stageEmpty.hidden = true;
      [el.zoom, el.zoomIn, el.zoomOut, el.reset].forEach(function (b) { b.disabled = false; });
      readSpec(true);
    }).catch(function () {
      if (myLoad !== state.loadToken) return;
      setLoadStatus('사진을 열 수 없습니다. 이 브라우저가 지원하지 않는 형식(예: HEIC)이거나 사진이 너무 클 수 있습니다. JPG나 PNG로 바꾸거나 더 작은 사진으로 다시 시도하세요.', 'error');
    });
  }

  el.file.addEventListener('change', function () { loadFile(el.file.files[0]); el.file.value = ''; });
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); el.drop.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); el.drop.classList.remove('dragover'); });
  });
  document.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(f);
  });

  // ---------- 자르기 화면 ----------
  var disp = { w: 0, h: 0 };

  function render() {
    if (!state.src || !state.crop) return;
    var avail = Math.max(120, el.stageWrap.clientWidth - 20);
    var maxH = Math.max(200, Math.min(window.innerHeight * 0.6, 560));
    var w = avail, h = w / state.aspect;
    if (h > maxH) { h = maxH; w = h * state.aspect; }
    disp.w = Math.round(w); disp.h = Math.round(h);
    var dpr = window.devicePixelRatio || 1;
    var cv = el.stage;
    cv.style.width = disp.w + 'px'; cv.style.height = disp.h + 'px';
    cv.width = Math.round(disp.w * dpr); cv.height = Math.round(disp.h * dpr);
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    var c = state.crop;
    ctx.drawImage(state.src, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
    // 참고선: 가운데 세로선, 가로 3등분선
    ctx.save();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    line(ctx, cv.width / 2, 0, cv.width / 2, cv.height);
    line(ctx, 0, cv.height / 3, cv.width, cv.height / 3);
    line(ctx, 0, cv.height * 2 / 3, cv.width, cv.height * 2 / 3);
    ctx.lineDashOffset = 6 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    line(ctx, cv.width / 2, 0, cv.width / 2, cv.height);
    line(ctx, 0, cv.height / 3, cv.width, cv.height / 3);
    line(ctx, 0, cv.height * 2 / 3, cv.width, cv.height * 2 / 3);
    ctx.restore();
    el.zoom.value = C.cropZoom(c, state.imgW, state.imgH, state.aspect).toFixed(2);
  }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function setZoom(z, anchor) {
    if (!state.crop) return;
    state.crop = C.zoomCropTo(state.crop, z, state.imgW, state.imgH, state.aspect, MAX_ZOOM, anchor);
    render(); schedule();
  }
  function currentZoom() { return C.cropZoom(state.crop, state.imgW, state.imgH, state.aspect); }
  function pan(dxImg, dyImg) {
    var c = state.crop;
    state.crop = C.clampCrop({ x: c.x + dxImg, y: c.y + dyImg, w: c.w, h: c.h }, state.imgW, state.imgH);
    render(); schedule();
  }
  // 화면 좌표(px, 캔버스 기준) -> 이미지 좌표
  function toImage(px, py) {
    var c = state.crop;
    return { x: c.x + (px / disp.w) * c.w, y: c.y + (py / disp.h) * c.h };
  }

  el.zoom.addEventListener('input', function () { setZoom(Number(el.zoom.value)); });
  el.zoomIn.addEventListener('click', function () { setZoom(currentZoom() * 1.15); });
  el.zoomOut.addEventListener('click', function () { setZoom(currentZoom() / 1.15); });
  el.reset.addEventListener('click', function () {
    if (!state.src) return;
    state.crop = C.fitCrop(state.imgW, state.imgH, state.aspect);
    render(); schedule();
  });

  var pointers = new Map();
  var pinch = null;
  function localPoint(e) {
    var r = el.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  el.stage.addEventListener('pointerdown', function (e) {
    if (!state.crop) return;
    el.stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, localPoint(e));
    el.stage.classList.add('dragging');
    if (pointers.size === 2) startPinch();
  });
  el.stage.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    var prev = pointers.get(e.pointerId), cur = localPoint(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      var c = state.crop;
      pan(-(cur.x - prev.x) * c.w / disp.w, -(cur.y - prev.y) * c.h / disp.h);
    } else if (pointers.size === 2 && pinch) {
      var pts = Array.from(pointers.values());
      var d = dist(pts[0], pts[1]);
      if (pinch.d > 0) setZoom(pinch.zoom * d / pinch.d, pinch.anchor);
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) el.stage.classList.remove('dragging');
  }
  el.stage.addEventListener('pointerup', endPointer);
  el.stage.addEventListener('pointercancel', endPointer);
  function startPinch() {
    var pts = Array.from(pointers.values());
    var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    pinch = { d: dist(pts[0], pts[1]), zoom: currentZoom(), anchor: toImage(mid.x, mid.y) };
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  el.stage.addEventListener('wheel', function (e) {
    if (!state.crop) return;
    e.preventDefault();
    var p = localPoint(e);
    setZoom(currentZoom() * Math.exp(-e.deltaY * 0.0015), toImage(p.x, p.y));
  }, { passive: false });

  el.stage.addEventListener('keydown', function (e) {
    if (!state.crop) return;
    var c = state.crop, f = e.shiftKey ? 0.1 : 0.02, handled = true;
    switch (e.key) {
      case 'ArrowLeft': pan(-c.w * f, 0); break;
      case 'ArrowRight': pan(c.w * f, 0); break;
      case 'ArrowUp': pan(0, -c.h * f); break;
      case 'ArrowDown': pan(0, c.h * f); break;
      case '+': case '=': setZoom(currentZoom() * 1.1); break;
      case '-': case '_': setZoom(currentZoom() / 1.1); break;
      case '0': el.reset.click(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 100);
  });

  // ---------- 변환·압축 ----------
  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(processNow, 250);
  }

  function makeCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  // 크롭 영역을 outW×outH로 그린다. 크게 줄일 때는 절반씩 단계적으로 줄인다.
  function renderOutput(outW, outH) {
    var c = state.crop;
    var steps = C.downscaleSteps(c.w, c.h, outW, outH);
    var prev = null;
    steps.forEach(function (s, i) {
      var cv = makeCanvas(s.w, s.h);
      var ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s.w, s.h);  // 투명 배경(PNG)은 흰색으로
      if (i === 0) ctx.drawImage(state.src, c.x, c.y, c.w, c.h, 0, 0, s.w, s.h);
      else ctx.drawImage(prev, 0, 0, s.w, s.h);
      if (prev) { prev.width = prev.height = 0; }
      prev = cv;
    });
    return prev;
  }

  function encoder(canvas) {
    return function (q) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode')); }, 'image/jpeg', q);
      });
    };
  }

  function processNow() {
    if (!state.src || !state.crop || !state.spec) return;
    var token = ++state.token;
    var spec = state.spec;
    var maxBytes = C.kbToMaxBytes(spec.maxKB);
    var outW, outH;
    if (spec.keepAspect) { outW = Math.max(1, Math.round(state.crop.w)); outH = Math.max(1, Math.round(state.crop.h)); }
    else { outW = spec.width; outH = spec.height; }
    var upscaled = !spec.keepAspect && (state.crop.w < outW - 0.5 || state.crop.h < outH - 0.5);

    el.resultStatus.textContent = '변환 중...';
    el.resultStatus.className = 'status';

    var shrinkLeft = spec.keepAspect ? 10 : 0;
    function attempt(w, h) {
      var canvas = renderOutput(w, h);
      return C.findQuality(encoder(canvas), maxBytes).then(function (r) {
        canvas.width = canvas.height = 0;
        if (!r.ok && shrinkLeft-- > 0 && w > 32 && h > 32) {
          return attempt(Math.round(w * 0.8), Math.round(h * 0.8));
        }
        r.w = w; r.h = h;
        return r;
      });
    }

    attempt(outW, outH).then(function (r) {
      if (token !== state.token) return;  // 더 최근 요청이 있으면 버림
      showResult(r, spec, maxBytes, upscaled, outW, outH);
    }).catch(function () {
      if (token !== state.token) return;
      el.resultStatus.textContent = '변환에 실패했습니다. 사진이 너무 크면 다른 사진으로 시도하세요.';
      el.resultStatus.className = 'status error';
      setDownload(null);
    });
  }

  function showResult(r, spec, maxBytes, upscaled, reqW, reqH) {
    var blob = r.result;
    el.rPx.textContent = r.w + ' × ' + r.h + ' px';
    el.rSize.textContent = C.formatKB(r.size) + ' (' + C.formatBytes(r.size) + ')';
    el.rTarget.textContent = spec.maxKB + 'KB 이하 (' + C.formatBytes(maxBytes) + ' 이하)';
    el.rQuality.textContent = Math.round(r.quality * 100) + '%';
    el.stats.hidden = false;
    var oldUrl = state.resultUrl;
    state.resultUrl = URL.createObjectURL(blob);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    el.img.src = state.resultUrl;
    el.img.hidden = false; el.empty.hidden = true;

    var msgs = [];
    if (r.ok) {
      msgs.push('목표 용량 이하로 만들었습니다.');
      if (r.w !== reqW || r.h !== reqH) msgs.push('용량을 맞추기 위해 픽셀 크기를 줄였습니다.');
      if (upscaled) msgs.push('자른 영역이 출력 크기보다 작아 확대되었습니다. 흐릿할 수 있으니 확인하세요.');
      el.resultStatus.className = 'status ok';
      setDownload(state.resultUrl, r.w, r.h);
    } else {
      msgs.push('품질을 최저로 낮춰도 목표 용량을 넘습니다. 최대 용량을 늘리거나 픽셀 크기를 줄이세요.');
      el.resultStatus.className = 'status error';
      setDownload(null);
    }
    el.resultStatus.textContent = msgs.join(' ');
  }

  function setDownload(url, w, h) {
    if (url) {
      el.download.href = url;
      el.download.setAttribute('download', 'photo_' + w + 'x' + h + '.jpg');
      el.download.setAttribute('aria-disabled', 'false');
      el.download.removeAttribute('tabindex');
    } else {
      el.download.removeAttribute('href');
      el.download.removeAttribute('download');
      el.download.setAttribute('aria-disabled', 'true');
      el.download.setAttribute('tabindex', '-1');
    }
  }

  applyPreset('passport');
})();
