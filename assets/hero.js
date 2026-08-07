(() => {
  "use strict";

  const stage = document.querySelector("[data-solar-map]");
  if (!stage) return;

  const canvas = stage.querySelector(".earth-canvas");
  const referenceTime = stage.querySelector("[data-reference-time]");
  const cityTimes = Array.from(stage.querySelectorAll("[data-city-time]"));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cycleMilliseconds = Number(stage.dataset.cycleSeconds || 42) * 1000;
  const baseInstant = Date.UTC(2026, 5, 21, 0, 0, 0);
  const fixedDeclination = 23.438 * Math.PI / 180;
  const frameInterval = 1000 / 15;
  const maskWidth = 384;
  const maskHeight = 192;
  const feather = 0.075;

  const displayContext = canvas.getContext("2d", { alpha: false });
  const nightCanvas = document.createElement("canvas");
  const nightContext = nightCanvas.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  maskCanvas.width = maskWidth;
  maskCanvas.height = maskHeight;

  const maskPixels = maskContext.createImageData(maskWidth, maskHeight);
  const sinLatitudes = new Float32Array(maskWidth * maskHeight);
  const cosLatitudes = new Float32Array(maskWidth * maskHeight);
  const longitudes = new Float32Array(maskWidth * maskHeight);

  for (let y = 0; y < maskHeight; y += 1) {
    const latitude = (Math.PI / 2) - ((y + 0.5) / maskHeight) * Math.PI;
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    for (let x = 0; x < maskWidth; x += 1) {
      const index = y * maskWidth + x;
      sinLatitudes[index] = sinLatitude;
      cosLatitudes[index] = cosLatitude;
      longitudes[index] = -Math.PI + ((x + 0.5) / maskWidth) * Math.PI * 2;
      const pixel = index * 4;
      maskPixels.data[pixel] = 255;
      maskPixels.data[pixel + 1] = 255;
      maskPixels.data[pixel + 2] = 255;
    }
  }

  const formatters = new Map();
  const referenceFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });

  function formatterFor(timeZone) {
    if (!formatters.has(timeZone)) {
      formatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }));
    }
    return formatters.get(timeZone);
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  function smootherStep(value) {
    const x = Math.min(1, Math.max(0, value));
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  let dayImage;
  let nightImage;
  let lastProgress = 0.63;
  let lastFrameTime = 0;
  let lastClockUpdate = 0;
  let startTime = performance.now();
  let animationFrame = 0;

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    nightCanvas.width = width;
    nightCanvas.height = height;
    if (dayImage && nightImage) render(lastProgress, true);
  }

  function updateMask(progress) {
    const subsolarLongitude = Math.PI - progress * Math.PI * 2;
    const sinDeclination = Math.sin(fixedDeclination);
    const cosDeclination = Math.cos(fixedDeclination);

    for (let index = 0; index < longitudes.length; index += 1) {
      const solarDot = sinLatitudes[index] * sinDeclination
        + cosLatitudes[index] * cosDeclination
        * Math.cos(longitudes[index] - subsolarLongitude);
      const nightAmount = smootherStep((-solarDot + feather) / (feather * 2));
      maskPixels.data[index * 4 + 3] = Math.round(nightAmount * 255);
    }
    maskContext.putImageData(maskPixels, 0, 0);
  }

  function updateClocks(progress) {
    const instant = new Date(baseInstant + progress * 24 * 60 * 60 * 1000);
    referenceTime.textContent = `${referenceFormatter.format(instant)} UTC`;
    referenceTime.dateTime = instant.toISOString();
    for (const timeElement of cityTimes) {
      const timeZone = timeElement.dataset.timeZone;
      timeElement.textContent = formatterFor(timeZone).format(instant);
      timeElement.dateTime = instant.toISOString();
    }
  }

  function render(progress, forceClock = false) {
    if (!dayImage || !nightImage || canvas.width === 0 || canvas.height === 0) return;
    lastProgress = progress;
    updateMask(progress);

    displayContext.globalCompositeOperation = "source-over";
    displayContext.drawImage(dayImage, 0, 0, canvas.width, canvas.height);

    nightContext.clearRect(0, 0, nightCanvas.width, nightCanvas.height);
    nightContext.globalCompositeOperation = "source-over";
    nightContext.drawImage(nightImage, 0, 0, nightCanvas.width, nightCanvas.height);
    nightContext.globalCompositeOperation = "destination-in";
    nightContext.imageSmoothingEnabled = true;
    nightContext.drawImage(maskCanvas, 0, 0, nightCanvas.width, nightCanvas.height);
    nightContext.globalCompositeOperation = "source-over";

    displayContext.drawImage(nightCanvas, 0, 0);
    if (forceClock || performance.now() - lastClockUpdate > 180) {
      updateClocks(progress);
      lastClockUpdate = performance.now();
    }
  }

  function animate(now) {
    if (reduceMotion.matches) {
      render(0.63, true);
      return;
    }
    if (!document.hidden && now - lastFrameTime >= frameInterval) {
      const progress = ((now - startTime) % cycleMilliseconds) / cycleMilliseconds;
      render(progress);
      lastFrameTime = now;
    }
    animationFrame = requestAnimationFrame(animate);
  }

  function restartAnimation() {
    cancelAnimationFrame(animationFrame);
    if (reduceMotion.matches) {
      render(0.63, true);
    } else {
      startTime = performance.now() - lastProgress * cycleMilliseconds;
      animationFrame = requestAnimationFrame(animate);
    }
  }

  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(canvas);
  reduceMotion.addEventListener("change", restartAnimation);

  Promise.all([
    loadImage(stage.dataset.dayImage),
    loadImage(stage.dataset.nightImage),
  ]).then(([loadedDay, loadedNight]) => {
    dayImage = loadedDay;
    nightImage = loadedNight;
    resizeCanvas();
    render(reduceMotion.matches ? 0.63 : 0, true);
    stage.classList.add("is-ready");
    restartAnimation();
  }).catch(() => {
    stage.classList.add("is-fallback");
  });
})();

