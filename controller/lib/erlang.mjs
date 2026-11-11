export function erlangB(capacity, offeredLoad) {
  let b = 1;
  for (let k = 1; k <= capacity; k += 1) b = (offeredLoad * b) / (k + offeredLoad * b);
  return b;
}

export function invertErlangB(capacity, target) {
  if (!(capacity >= 1) || !(target > 0 && target < 1)) throw new Error('Invalid Erlang-B parameters');
  let lo = 0;
  let hi = Math.max(1, capacity);
  while (erlangB(capacity, hi) < target) hi *= 2;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (erlangB(capacity, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function truncatedMean(samples, deadlineSeconds) {
  if (!samples.length) return NaN;
  return samples.reduce((s, x) => s + Math.min(x, deadlineSeconds), 0) / samples.length;
}

export function weightedTruncatedMean(classSamples, classWeights, deadlineSeconds) {
  let total = 0;
  let weight = 0;
  for (const [name, samples] of Object.entries(classSamples)) {
    if (!samples?.length) continue;
    const w = classWeights[name] ?? 0;
    total += w * truncatedMean(samples, deadlineSeconds);
    weight += w;
  }
  return weight > 0 ? total / weight : NaN;
}

export function invertTruncatedMean(classSamples, classWeights, targetMean, minDeadline, maxDeadline) {
  if (targetMean <= 0) return minDeadline;
  const atMax = weightedTruncatedMean(classSamples, classWeights, maxDeadline);
  if (!Number.isFinite(atMax) || atMax <= targetMean) return maxDeadline;
  let lo = minDeadline;
  let hi = maxDeadline;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (weightedTruncatedMean(classSamples, classWeights, mid) <= targetMean) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
