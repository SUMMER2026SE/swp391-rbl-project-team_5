'use strict';

function optionalRestrictionNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildTicketRestrictions(ticket = {}) {
  return {
    minAgeYears: optionalRestrictionNumber(ticket.minAgeYears),
    maxAgeYears: optionalRestrictionNumber(ticket.maxAgeYears),
    minHeightCm: optionalRestrictionNumber(ticket.minHeightCm),
    maxHeightCm: optionalRestrictionNumber(ticket.maxHeightCm),
    requiresAdult: ticket.requiresAdult === true,
  };
}

function hasTicketRestrictions(restrictions = {}) {
  return restrictions.requiresAdult === true
    || restrictions.minAgeYears != null
    || restrictions.maxAgeYears != null
    || restrictions.minHeightCm != null
    || restrictions.maxHeightCm != null;
}

module.exports = {
  buildTicketRestrictions,
  hasTicketRestrictions,
  optionalRestrictionNumber,
};
