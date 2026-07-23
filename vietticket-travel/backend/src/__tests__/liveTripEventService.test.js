'use strict';

jest.mock('../config/prisma', () => ({}));

const { EVENT_TYPES, recordLiveTripEvent } = require('../services/liveTripEventService');

test('accepts every SmartQueue operations event declared by the database contract', async () => {
  const create = jest.fn().mockResolvedValue({ id: 'event-1' });
  const client = { liveTripEvent: { create } };

  for (const type of ['QUEUE_CALLED', 'QUEUE_NO_SHOW', 'QUEUE_PAUSED', 'QUEUE_RESUMED']) {
    expect(EVENT_TYPES.has(type)).toBe(true);
    await expect(recordLiveTripEvent({
      client,
      liveTripId: 'trip-1',
      liveTripItemId: 'item-1',
      userId: 'user-1',
      type,
      title: type,
      message: 'Operational event',
    })).resolves.toMatchObject({ id: 'event-1' });
  }

  expect(create).toHaveBeenCalledTimes(4);
});
