import { exponential, mulberry32 } from '../controller/lib/stats.mjs';

export function generateArrivalScheduleDetailed({ type, durationSeconds, meanRate, seed = 1, batchSize = 4 }) {
  const random = mulberry32(seed);
  const times = [];
  const metadata = { type, transitions: 0, lowStateSeconds: null, highStateSeconds: null, visitedLow: null, visitedHigh: null };
  if (type === 'periodic') {
    const interval = 1 / meanRate;
    for (let t = interval; t < durationSeconds; t += interval) times.push(t);
  } else if (type === 'synchronized') {
    const interval = batchSize / meanRate;
    for (let t = interval; t < durationSeconds; t += interval) {
      for (let j = 0; j < batchSize; j += 1) times.push(t + j * 0.001);
    }
  } else if (type === 'rate-step') {
    const half = durationSeconds / 2;
    let t = 0;
    while (t < half) {
      t += exponential(random, meanRate * 0.5);
      if (t < half) times.push(t);
    }
    t = half;
    while (t < durationSeconds) {
      t += exponential(random, meanRate * 1.5);
      if (t < durationSeconds) times.push(t);
    }
  } else if (type === 'mmpp') {
    const lowRate = meanRate * 0.25;
    const highRate = meanRate * 3;
    const highStationaryProbability = (meanRate - lowRate) / (highRate - lowRate);
    const highToLow = 0.5;
    const lowToHigh = highStationaryProbability * highToLow / (1 - highStationaryProbability);
    let high = random() < highStationaryProbability;
    metadata.visitedLow = !high;
    metadata.visitedHigh = high;
    let lowStateSeconds = 0;
    let highStateSeconds = 0;
    let t = 0;
    while (t < durationSeconds) {
      const arrivalWait = exponential(random, high ? highRate : lowRate);
      const switchWait = exponential(random, high ? highToLow : lowToHigh);
      if (arrivalWait < switchWait) {
        const elapsed = Math.min(arrivalWait, durationSeconds - t);
        if (high) highStateSeconds += elapsed; else lowStateSeconds += elapsed;
        t += arrivalWait;
        if (t < durationSeconds) times.push(t);
      } else {
        const elapsed = Math.min(switchWait, durationSeconds - t);
        if (high) highStateSeconds += elapsed; else lowStateSeconds += elapsed;
        t += switchWait;
        if (t < durationSeconds) {
          high = !high;
          metadata.transitions += 1;
          metadata.visitedLow ||= !high;
          metadata.visitedHigh ||= high;
        }
      }
    }
    metadata.lowStateSeconds = lowStateSeconds;
    metadata.highStateSeconds = highStateSeconds;
  } else {
    let t = 0;
    while (t < durationSeconds) {
      t += exponential(random, meanRate);
      if (t < durationSeconds) times.push(t);
    }
  }
  return { arrivals: times.sort((a, b) => a - b), metadata };
}

export function generateArrivalSchedule(options) {
  return generateArrivalScheduleDetailed(options).arrivals;
}

export function countDispersion(arrivalSeconds, durationSeconds, binSeconds = 1) {
  const bins = Array(Math.ceil(durationSeconds / binSeconds)).fill(0);
  for (const t of arrivalSeconds) {
    const i = Math.min(bins.length - 1, Math.floor(t / binSeconds));
    bins[i] += 1;
  }
  if (bins.length < 2) return { mean: bins[0] ?? 0, variance: 0, index: 0 };
  const m = bins.reduce((s, x) => s + x, 0) / bins.length;
  const variance = bins.reduce((s, x) => s + (x - m) ** 2, 0) / (bins.length - 1);
  return { mean: m, variance, index: m > 0 ? variance / m : 0 };
}
