import { buildAiBookingUrl } from './aiBookingPrefill.js'

export const AI_BOOKING_QUEUE_KEY = 'vietticket_ai_booking_queue'

const MAX_QUEUE_ITEMS = 40

function getDefaultStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function makeQueueId(now = Date.now()) {
  return `ai-booking-${now}`
}

function normalizeQuantity(value) {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0) return 1
  return Math.floor(quantity)
}

function getSlotId(ticketLine) {
  return ticketLine?.suggestedTimeSlot?.timeSlotId || ticketLine?.timeSlotId || ''
}

function getSlotLabel(ticketLine) {
  const slot = ticketLine?.suggestedTimeSlot
  if (!slot) return ''
  if (slot.startTime && slot.endTime) return `${slot.startTime} - ${slot.endTime}`
  return slot.label || ''
}

function buildQueueItemId({ attractionId, ticketId, visitDate, slotId, index }) {
  return [attractionId, ticketId, visitDate || 'date', slotId || 'slot', index]
    .map((part) => String(part).replace(/[^A-Za-z0-9_-]+/g, '-'))
    .join('__')
}

export function extractBookableItineraryItems(plan, { fallbackStartDate = '' } = {}) {
  const days = Array.isArray(plan?.days) ? plan.days : []
  const items = []

  days.forEach((dayItem, dayIndex) => {
    const activities = Array.isArray(dayItem.activities)
      ? dayItem.activities
      : Array.isArray(dayItem.items)
        ? dayItem.items
        : []
    const dayLabel = dayItem.day ? `Ngày ${dayItem.day}` : `Ngày ${dayIndex + 1}`
    const dayVisitDate = dayItem.visitDate || plan?.startDate || fallbackStartDate

    activities.forEach((activity, activityIndex) => {
      const attractionId = activity.attractionId || activity.id
      const ticketLines = Array.isArray(activity.ticketItems) ? activity.ticketItems : []
      if (!attractionId || ticketLines.length === 0) return

      const visitDate = activity.visitDate || dayVisitDate
      const activityTitle =
        activity.title || activity.name || activity.destination || 'Điểm tham quan'

      ticketLines.forEach((ticketLine, ticketIndex) => {
        if (!ticketLine?.ticketId) return

        const ticketName =
          ticketLine.ticketName || ticketLine.name || ticketLine.title || 'Vé tham quan'
        const slotId = getSlotId(ticketLine)
        const index = items.length
        items.push({
          id: buildQueueItemId({
            attractionId,
            ticketId: ticketLine.ticketId,
            visitDate,
            slotId,
            index,
          }),
          attractionId,
          attractionTitle: activityTitle,
          dayIndex,
          dayLabel,
          sourceActivityIndex: activityIndex,
          sourceTicketIndex: ticketIndex,
          ticketId: ticketLine.ticketId,
          ticketName,
          quantity: normalizeQuantity(ticketLine.quantity),
          unitPrice: Number(ticketLine.unitPrice || ticketLine.price || 0),
          visitDate,
          timeSlotId: slotId,
          timeSlotLabel: getSlotLabel(ticketLine),
        })
      })
    })
  })

  return items.slice(0, MAX_QUEUE_ITEMS)
}

export function createItineraryBookingQueue(plan, options = {}) {
  const items = extractBookableItineraryItems(plan, options)
  if (items.length === 0) return null

  return {
    id: options.queueId || makeQueueId(options.now),
    createdAt: new Date(options.now || Date.now()).toISOString(),
    ownerId: options.ownerId || null,
    planId: plan?.clientPlanId || plan?.id || null,
    itineraryId: options.itineraryId || null,
    itineraryVersion: Number(options.itineraryVersion) || null,
    partyRoomId: options.partyRoomId || null,
    planTitle: plan?.title || 'Lịch trình AI',
    currentIndex: 0,
    items,
  }
}

export function saveItineraryBookingQueue(queue, storage = getDefaultStorage()) {
  if (!storage || !queue?.id || !Array.isArray(queue.items) || queue.items.length === 0) {
    return null
  }

  storage.setItem(AI_BOOKING_QUEUE_KEY, JSON.stringify(queue))
  return queue
}

export function loadItineraryBookingQueue(storage = getDefaultStorage()) {
  if (!storage) return null

  try {
    const parsed = JSON.parse(storage.getItem(AI_BOOKING_QUEUE_KEY) || 'null')
    if (!parsed?.id || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function updateItineraryBookingQueue(updater, storage = getDefaultStorage()) {
  if (typeof updater !== 'function') return null

  const currentQueue = loadItineraryBookingQueue(storage)
  if (!currentQueue) return null

  const nextQueue = updater(currentQueue)
  if (!nextQueue?.id || !Array.isArray(nextQueue.items) || nextQueue.items.length === 0) {
    return currentQueue
  }

  return saveItineraryBookingQueue(nextQueue, storage)
}

function makeUpdatedAt() {
  return new Date().toISOString()
}

export function markItineraryQueueItemReserved(
  { queueId, itemId, reservationId, bookingId },
  storage = getDefaultStorage(),
) {
  if (!queueId || !itemId) return null

  return updateItineraryBookingQueue((queue) => {
    if (queue.id !== queueId) return queue

    const itemIndex = queue.items.findIndex((item) => item.id === itemId)
    if (itemIndex === -1) return queue

    const updatedAt = makeUpdatedAt()
    const items = queue.items.map((item, index) => {
      if (index !== itemIndex) return item

      return {
        ...item,
        bookingId: bookingId || item.bookingId || null,
        reservationId: reservationId || item.reservationId || null,
        status: bookingId ? 'booking_created' : 'reserved',
        updatedAt,
      }
    })

    return {
      ...queue,
      currentIndex: Math.max(Number(queue.currentIndex) || 0, itemIndex),
      items,
      updatedAt,
    }
  }, storage)
}

export function completeItineraryQueueItemByBookingId(
  bookingId,
  storage = getDefaultStorage(),
) {
  const normalizedBookingId = String(bookingId || '')
  if (!normalizedBookingId) return null

  const currentQueue = loadItineraryBookingQueue(storage)
  const hasMatchingItem = currentQueue?.items?.some(
    (item) => String(item.bookingId || '') === normalizedBookingId,
  )
  if (!hasMatchingItem) return null

  return updateItineraryBookingQueue((queue) => {
    const completedIndex = queue.items.findIndex(
      (item) => String(item.bookingId || '') === normalizedBookingId,
    )
    if (completedIndex === -1) return queue

    const updatedAt = makeUpdatedAt()
    const items = queue.items.map((item, index) => {
      if (index !== completedIndex) return item

      return {
        ...item,
        completedAt: item.completedAt || updatedAt,
        status: 'completed',
        updatedAt,
      }
    })
    const nextIndex = items.findIndex(
      (item, index) => index > completedIndex && item.status !== 'completed',
    )

    return {
      ...queue,
      currentIndex: nextIndex === -1 ? items.length : nextIndex,
      items,
      updatedAt,
    }
  }, storage)
}

export function syncItineraryBookingQueueProgress(
  progressItems,
  storage = getDefaultStorage(),
) {
  const progressByItem = new Map(
    (Array.isArray(progressItems) ? progressItems : [])
      .filter((item) => item?.itemId)
      .map((item) => [String(item.itemId), item]),
  )
  if (progressByItem.size === 0) return loadItineraryBookingQueue(storage)

  return updateItineraryBookingQueue((queue) => {
    const updatedAt = makeUpdatedAt()
    const items = queue.items.map((item) => {
      const progress = progressByItem.get(String(item.id))
      if (!progress) return item
      const completed = progress.fulfilled === true || progress.lineState === 'COMPLETED'
      const status = completed
        ? 'completed'
        : progress.lineState === 'REFUND_PENDING'
          ? 'refund_pending'
          : progress.lineState === 'ACTION_REQUIRED'
            ? 'action_required'
            : ['CANCELLED', 'REFUNDED'].includes(progress.bookingStatus)
              ? 'action_required'
              : 'booking_created'
      return {
        ...item,
        bookingId: progress.bookingId || item.bookingId || null,
        reservationId: progress.reservationId || item.reservationId || null,
        bookingStatus: progress.bookingStatus || item.bookingStatus || null,
        paymentMethod: progress.paymentMethod || item.paymentMethod || null,
        paid: progress.paid === true,
        paidAmount: Number(progress.paidAmount) || 0,
        refund: progress.refund || null,
        refundRequired: progress.refundRequired === true,
        status,
        ...(completed ? { completedAt: progress.paidAt || updatedAt } : {}),
        updatedAt,
      }
    })
    const nextIndex = items.findIndex(
      (item) => !['completed', 'refund_pending'].includes(item.status),
    )
    return {
      ...queue,
      currentIndex: nextIndex === -1 ? items.length : nextIndex,
      items,
      updatedAt,
    }
  }, storage)
}

export function getNextItineraryQueueStep(queue) {
  const items = Array.isArray(queue?.items) ? queue.items : []
  if (items.length === 0) return null

  const startIndex = Math.min(
    Math.max(Number(queue.currentIndex) || 0, 0),
    items.length,
  )

  return items.find(
    (item, index) => (
      index >= startIndex
      && !['completed', 'refund_pending'].includes(item.status)
    ),
  ) || null
}

export function getItineraryQueueProgress(queue) {
  const items = Array.isArray(queue?.items) ? queue.items : []
  const completed = items.filter((item) => item.status === 'completed').length
  const actionRequired = items.filter((item) => item.status === 'action_required').length
  const paymentPending = items.filter(
    (item) => ['reserved', 'booking_created'].includes(item.status),
  ).length
  const refundPending = items.filter((item) => item.status === 'refund_pending').length
  const notStarted = items.filter((item) => !item.status).length
  const nextItem = getNextItineraryQueueStep(queue)
  const nextIndex = nextItem ? items.findIndex((item) => item.id === nextItem.id) : -1

  return {
    actionRequired,
    completed,
    isComplete: items.length > 0 && completed >= items.length,
    isBookingFlowClosed: items.length > 0
      && completed + refundPending >= items.length,
    nextIndex,
    notStarted,
    paymentPending,
    refundPending,
    remaining: Math.max(0, items.length - completed),
    total: items.length,
  }
}

function buildQueueContextSearchParams(queue, item) {
  const params = new URLSearchParams({
    aiQueueId: queue.id,
    aiQueueItemId: item.id,
  })
  if (queue.itineraryId) params.set('itineraryId', queue.itineraryId)
  if (queue.itineraryVersion) {
    params.set('itineraryVersion', String(queue.itineraryVersion))
  }
  return params
}

export function buildItineraryQueueActionUrl(queue, item) {
  if (!queue?.id || !item?.id) return ''

  if (
    ['reserved', 'booking_created'].includes(item.status)
    && item.reservationId
  ) {
    if (
      String(item.paymentMethod || '').toLowerCase() === 'bank_transfer'
      && item.bookingId
    ) {
      return `/bank-transfer/${encodeURIComponent(item.bookingId)}`
    }
    const params = buildQueueContextSearchParams(queue, item)
    return `/checkout/${encodeURIComponent(item.reservationId)}?${params.toString()}`
  }

  if (item.status === 'refund_pending') {
    return '/my-tickets'
  }

  return buildItineraryQueueBookingUrl(queue, item)
}

export function buildItineraryQueueBookingUrl(queue, item) {
  if (!queue?.id || !item?.attractionId || !item?.ticketId) return ''

  return buildAiBookingUrl({
    attractionId: item.attractionId,
    fallbackDate: item.visitDate,
    ticketLine: {
      ticketId: item.ticketId,
      quantity: item.quantity,
      suggestedTimeSlot: item.timeSlotId ? { timeSlotId: item.timeSlotId } : null,
    },
    extraParams: {
      aiQueueId: queue.id,
      aiQueueItemId: item.id,
      ...(queue.itineraryId ? { itineraryId: queue.itineraryId } : {}),
      ...(queue.itineraryVersion ? { itineraryVersion: queue.itineraryVersion } : {}),
    },
  })
}
