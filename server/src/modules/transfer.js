/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import {
  isTerminalTransferPhase,
  isTransferPhaseAdvance,
  toTransferEvent,
  TRANSFER_PHASES
} from '../../../packages/film-core/src/index.js';

export { TRANSFER_PHASES };

export function normalizeTransfer(input) { return toTransferEvent(input); }

export function terminalTransfer(phase) { return isTerminalTransferPhase(phase); }

function transitionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function nextTransferEvent(current, input = {}, { source = 'user' } = {}) {
  const currentEvent = normalizeTransfer(current);
  const requestedPhase = input.phase || currentEvent.phase;

  if (!TRANSFER_PHASES.includes(requestedPhase)) {
    throw transitionError('transfer_phase_invalid', 'transfer phase is invalid');
  }
  if (terminalTransfer(currentEvent.phase)) {
    if (requestedPhase === currentEvent.phase) return currentEvent;
    if (source === 'device' && currentEvent.phase === 'device_state_uncertain' && requestedPhase === 'succeeded') {
      return normalizeTransfer({ ...currentEvent, ...input, phase: requestedPhase });
    }
    throw transitionError('transfer_terminal', 'terminal transfer cannot be rewritten');
  }
  if (requestedPhase === 'succeeded' && source !== 'device') {
    throw transitionError('device_confirmation_required', 'only a verified device can confirm success');
  }
  if (requestedPhase === 'succeeded' && !['refreshing'].includes(currentEvent.phase)) {
    throw transitionError('transfer_transition_invalid', 'success requires a refresh phase');
  }
  if (requestedPhase === 'device_state_uncertain' && currentEvent.phase !== 'refreshing') {
    throw transitionError('transfer_transition_invalid', 'uncertain state requires a refresh phase');
  }
  if (requestedPhase !== 'failed' && requestedPhase !== currentEvent.phase && !isTransferPhaseAdvance(currentEvent.phase, requestedPhase)) {
    throw transitionError('transfer_transition_invalid', 'transfer phase cannot move backwards');
  }

  const eventInput = { ...currentEvent, ...input, phase: requestedPhase };
  if (!Object.prototype.hasOwnProperty.call(input, 'outcome')) delete eventInput.outcome;
  const next = normalizeTransfer(eventInput);
  next.completed_bytes = Math.max(currentEvent.completed_bytes, next.completed_bytes);
  next.total_bytes = Math.max(currentEvent.total_bytes, next.total_bytes);
  next.progress_hint = Math.max(currentEvent.progress_hint, next.progress_hint);
  return next;
}
