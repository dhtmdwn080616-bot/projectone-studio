/*
 * 증명사진 규격 맞추기 - 순수 로직 (DOM 없음, node 테스트 가능)
 * 이 파일은 네트워크 요청을 하지 않는다.
 */
(function (root) {
  'use strict';

  // 규격 숫자는 2차 출처(웹 검색 요약) 기반 참고값이다. 제출 기관 안내가 우선한다.
  var PRESETS = [
    {
      id: 'passport',
      label: '여권 사진 참고값 (3.5×4.5cm, 413×531px, 500KB 이하)',
      width: 413, height: 531, maxKB: 500, keepAspect: false,
      desc: '3.5×4.5cm를 300dpi로 환산한 413×531px, JPG 500KB 이하로 알려진 값입니다(2차 출처). 온라인 여권 신청은 허용 범위가 따로 안내될 수 있으니 외교부·접수처 안내를 확인하세요.'
    },
    {
      id: 'id3x4',
      label: '증명·이력서 사진 참고값 (3×4cm, 354×472px)',
      width: 354, height: 472, maxKB: 500, keepAspect: false,
      desc: '3×4cm를 300dpi로 환산한 354×472px입니다. 용량 500KB는 임의 기본값이므로 제출처가 요구하는 용량으로 바꾸세요.'
    },
    {
      id: 'id35x45',
      label: '증명사진 참고값 (3.5×4.5cm, 413×531px)',
      width: 413, height: 531, maxKB: 500, keepAspect: false,
      desc: '3.5×4.5cm를 300dpi로 환산한 413×531px입니다. 용량 500KB는 임의 기본값입니다.'
    },
    {
      id: 'size500',
      label: '용량만 줄이기 (원본 비율, 500KB 이하)',
      width: 0, height: 0, maxKB: 500, keepAspect: true,
      desc: '자르기 비율은 원본 그대로 두고 JPG 용량만 목표 이하로 줄입니다. 품질을 최저로 낮춰도 목표를 넘으면 픽셀 크기를 단계적으로 줄입니다.'
    },
    {
      id: 'custom',
      label: '직접 입력',
      width: 0, height: 0, maxKB: 0, keepAspect: false,
      desc: '가로·세로 px와 최대 용량(KB)을 제출처 안내대로 입력하세요.'
    }
  ];

  var LIMITS = { minPx: 16, maxPx: 6000, minKB: 5, maxKB: 20000 };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function getPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }

  // 입력값 검증: 정수 px, 목표 KB. 잘못되면 error 문자열을 돌려준다.
  function validateSpec(width, height, maxKB, keepAspect) {
    var w = Number(width), h = Number(height), kb = Number(maxKB);
    if (!keepAspect) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || Math.round(w) !== w || Math.round(h) !== h) {
        return { error: '가로·세로는 정수 px로 입력하세요.' };
      }
      if (w < LIMITS.minPx || h < LIMITS.minPx || w > LIMITS.maxPx || h > LIMITS.maxPx) {
        return { error: '가로·세로는 ' + LIMITS.minPx + '~' + LIMITS.maxPx + 'px 사이로 입력하세요.' };
      }
    }
    if (!Number.isFinite(kb) || kb < LIMITS.minKB || kb > LIMITS.maxKB) {
      return { error: '최대 용량은 ' + LIMITS.minKB + '~' + LIMITS.maxKB + 'KB 사이로 입력하세요.' };
    }
    return { width: keepAspect ? 0 : w, height: keepAspect ? 0 : h, maxKB: kb, keepAspect: !!keepAspect };
  }

  // 목표 바이트: 기관마다 1KB를 1000 또는 1024바이트로 볼 수 있어 더 엄격한 1000을 쓴다.
  function kbToMaxBytes(kb) { return Math.floor(kb * 1000); }

  // 이미지 안에 들어가는 가장 큰 aspect(가로/세로) 비율 크롭, 가운데 정렬.
  function fitCrop(imgW, imgH, aspect) {
    var w = imgW, h = imgW / aspect;
    if (h > imgH) { h = imgH; w = imgH * aspect; }
    return { x: (imgW - w) / 2, y: (imgH - h) / 2, w: w, h: h };
  }

  // 크롭 영역을 이미지 밖으로 나가지 않게 보정.
  function clampCrop(crop, imgW, imgH) {
    var w = Math.min(crop.w, imgW), h = Math.min(crop.h, imgH);
    return {
      x: clamp(crop.x, 0, imgW - w),
      y: clamp(crop.y, 0, imgH - h),
      w: w, h: h
    };
  }

  // zoom = maxCrop.w / crop.w (1 = 최대로 넓게). 앵커(이미지 좌표)를 화면상 같은 위치에 유지.
  function zoomCropTo(crop, zoom, imgW, imgH, aspect, maxZoom, anchor) {
    var max = fitCrop(imgW, imgH, aspect);
    var z = clamp(zoom, 1, maxZoom || 8);
    var w = max.w / z, h = max.h / z;
    var ax = anchor ? anchor.x : crop.x + crop.w / 2;
    var ay = anchor ? anchor.y : crop.y + crop.h / 2;
    var rx = (ax - crop.x) / crop.w, ry = (ay - crop.y) / crop.h;
    return clampCrop({ x: ax - rx * w, y: ay - ry * h, w: w, h: h }, imgW, imgH);
  }

  function cropZoom(crop, imgW, imgH, aspect) {
    return fitCrop(imgW, imgH, aspect).w / crop.w;
  }

  // 축소 단계 계산: 한 번에 절반 넘게 줄이면 계단 현상이 생겨 절반씩 단계적으로 줄인다.
  function downscaleSteps(srcW, srcH, dstW, dstH) {
    var steps = [];
    var w = srcW, h = srcH;
    while (w / 2 > dstW && h / 2 > dstH) {
      w = Math.round(w / 2); h = Math.round(h / 2);
      steps.push({ w: w, h: h });
    }
    steps.push({ w: dstW, h: dstH });
    return steps;
  }

  /*
   * 목표 바이트 이하가 되는 가장 높은 JPEG 품질을 이분 탐색으로 찾는다.
   * encode(q) -> Promise<{size:number, ...}>  (브라우저에서는 Blob)
   * 반환: { ok, quality, result, size, tries }  ok=false면 최저 품질로도 목표 초과.
   * 결과는 항상 실제 측정한 size로 판정하므로, 품질-용량 관계가 완전히 단조롭지 않아도
   * ok=true인 결과는 반드시 목표 이하이다.
   */
  function findQuality(encode, maxBytes, opts) {
    opts = opts || {};
    var qMin = opts.qMin != null ? opts.qMin : 0.05;
    var qMax = opts.qMax != null ? opts.qMax : 0.95;
    var iterations = opts.iterations != null ? opts.iterations : 7;
    var tries = [];
    var best = null;

    function run(q) {
      return Promise.resolve(encode(q)).then(function (r) {
        tries.push({ quality: q, size: r.size });
        if (r.size <= maxBytes && (!best || q > best.quality)) best = { quality: q, result: r, size: r.size };
        return r;
      });
    }

    return run(qMax).then(function (top) {
      if (top.size <= maxBytes) return done();
      return run(qMin).then(function (bottom) {
        if (bottom.size > maxBytes) {
          return { ok: false, quality: qMin, result: bottom, size: bottom.size, tries: tries };
        }
        var lo = qMin, hi = qMax, i = 0;
        function step() {
          if (i++ >= iterations) return Promise.resolve(done());
          var mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
          return run(mid).then(function (r) {
            if (r.size <= maxBytes) lo = mid; else hi = mid;
            return step();
          });
        }
        return step();
      });
    });

    function done() {
      return { ok: true, quality: best.quality, result: best.result, size: best.size, tries: tries };
    }
  }

  // 목표 용량 계산(1KB=1000바이트)과 같은 기준으로 표시해야 '500KB 이하'와 어긋나 보이지 않는다.
  function formatKB(bytes) {
    return (bytes / 1000).toFixed(1) + 'KB';
  }

  // JPEG 앞부분(바이트)에서 EXIF 방향값(1~8)을 읽는다. 없거나 JPEG가 아니면 0.
  function parseExifOrientation(b) {
    if (!b || b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8) return 0;
    var i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return 0;
      var m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m === 0xda || m === 0xd9) return 0;
      var len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xe1 && i + 4 + 14 <= b.length &&
          b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
        var t = i + 10;
        var le = b[t] === 0x49 && b[t + 1] === 0x49;
        if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 0;
        var u16 = function (o) { return le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]); };
        var u32 = function (o) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
                                           : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; };
        if (t + 8 > b.length) return 0;
        var ifd = t + u32(t + 4);
        if (ifd + 2 > b.length) return 0;
        var n = u16(ifd);
        for (var k = 0; k < n; k++) {
          var e = ifd + 2 + k * 12;
          if (e + 12 > b.length) return 0;
          if (u16(e) === 0x0112) { var v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
        }
        return 0;
      }
      i += 2 + len;
    }
    return 0;
  }
  function formatBytes(bytes) {
    return String(bytes).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '바이트';
  }

  var api = {
    PRESETS: PRESETS, LIMITS: LIMITS, clamp: clamp, getPreset: getPreset,
    validateSpec: validateSpec, kbToMaxBytes: kbToMaxBytes,
    fitCrop: fitCrop, clampCrop: clampCrop, zoomCropTo: zoomCropTo, cropZoom: cropZoom,
    downscaleSteps: downscaleSteps, findQuality: findQuality,
    formatKB: formatKB, parseExifOrientation: parseExifOrientation, formatBytes: formatBytes
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhotoCore = api;
})(typeof self !== 'undefined' ? self : this);
