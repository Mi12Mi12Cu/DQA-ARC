export const STANDARD_ADMISSION_POLICIES = new Set([
  'occupancy-threshold',
  'static-reservation',
  'threshold-reservation',
  'fifo'
]);

export function normalizeAdmissionParameters({ capacity, occupancyThreshold, reservedCpuSlots }) {
  const n = Math.max(1, Math.floor(Number(capacity)));
  const threshold = Math.max(1, Math.min(n, Math.floor(Number(occupancyThreshold))));
  const reserved = Math.max(0, Math.min(n - 1, Math.floor(Number(reservedCpuSlots))));
  return { capacity: n, occupancyThreshold: threshold, reservedCpuSlots: reserved };
}

export function admissionLimit({ policy, preferredHardware, capacity, occupancyThreshold, reservedCpuSlots }) {
  const parameters = normalizeAdmissionParameters({ capacity, occupancyThreshold, reservedCpuSlots });
  const priorityClass = preferredHardware === 'cpu';
  if (policy === 'occupancy-threshold') return parameters.occupancyThreshold;
  if (policy === 'static-reservation') {
    return priorityClass ? parameters.capacity : Math.max(1, parameters.capacity - parameters.reservedCpuSlots);
  }
  if (policy === 'threshold-reservation') {
    return priorityClass ? parameters.occupancyThreshold : Math.max(1, parameters.occupancyThreshold - parameters.reservedCpuSlots);
  }
  return parameters.capacity;
}

export function admissionDecision(options) {
  const limit = admissionLimit(options);
  const occupancy = Math.max(0, Math.floor(Number(options.occupancy)));
  return {
    accepted: occupancy < limit,
    occupancy,
    limit,
    reason: occupancy < limit ? 'admitted' : options.policy
  };
}
