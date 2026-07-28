'use strict';

const {
  candidateSnapshot,
  closeRoom,
  isTripDatePast,
  normalizeDisplayName,
  normalizeIdentity,
  normalizePreferences,
  requiredVoterCount,
  reopenRoom,
  serializeRoom,
  validateDisplayName,
  validateCreateRoomInput,
} = require('../services/partyRoomService');
const { todayInVietnam } = require('../utils/refundService');

function shiftDate(dateKey, days) {
  const value = new Date(`${dateKey}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function validRoom(overrides = {}) {
  return {
    title: 'Nhóm bạn Đà Nẵng',
    city: 'Đà Nẵng',
    startDate: shiftDate(todayInVietnam(), 7),
    dayCount: 2,
    adults: 3,
    children: 0,
    totalBudget: 3_000_000,
    pace: 'normal',
    maxMembers: 6,
    ...overrides,
  };
}

describe('partyRoomService business validation', () => {
  test('normalizes valid room input into stable date and city values', () => {
    const result = validateCreateRoomInput(validRoom({ title: '  Đi cùng nhau  ' }));

    expect(result.title).toBe('Đi cùng nhau');
    expect(result.startDateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.startDate).toBeInstanceOf(Date);
    expect(result.dayCount).toBe(2);
    expect(result.maxMembers).toBe(6);
  });

  test.each([
    ['today', () => todayInVietnam()],
    ['past date', () => shiftDate(todayInVietnam(), -1)],
    ['more than one year away', () => shiftDate(todayInVietnam(), 366)],
    ['impossible date', () => '2026-02-31'],
  ])('rejects %s as a travel start date', (_label, dateFactory) => {
    expect(() => validateCreateRoomInput(validRoom({ startDate: dateFactory() })))
      .toThrow('Ngày bắt đầu phải từ ngày mai');
  });

  test('detects only dates before today as expired planning rooms', () => {
    expect(isTripDatePast(shiftDate(todayInVietnam(), -1))).toBe(true);
    expect(isTripDatePast(todayInVietnam())).toBe(false);
    expect(isTripDatePast(shiftDate(todayInVietnam(), 1))).toBe(false);
  });

  test('rejects unrealistic room capacity and group budget', () => {
    expect(() => validateCreateRoomInput(validRoom({ maxMembers: 11 })))
      .toThrow('Phòng chỉ hỗ trợ từ 2 đến 10 thành viên');
    expect(() => validateCreateRoomInput(validRoom({ totalBudget: 99_999 })))
      .toThrow('Ngân sách vé của nhóm');
  });

  test('rejects an overlong trip title instead of silently truncating it', () => {
    expect(() => validateCreateRoomInput(validRoom({ title: 'A'.repeat(121) })))
      .toThrow('Tên chuyến đi không được vượt quá 120 ký tự');
  });

  test('normalizes Vietnamese identities and limits preference noise', () => {
    expect(normalizeDisplayName('  Minh   Anh  ')).toBe('Minh Anh');
    expect(normalizeIdentity('  MINH ÁNH ')).toBe('minh anh');
    expect(normalizePreferences({
      categories: [' Thiên nhiên ', 'Thiên nhiên', '', 'Ẩm thực', 'Bảo tàng', 'Biển', 'Mạo hiểm'],
    })).toEqual({
      categories: ['Thiên nhiên', 'Ẩm thực', 'Bảo tàng', 'Biển', 'Mạo hiểm'],
    });
  });

  test('rejects an overlong display name instead of silently truncating identity', () => {
    expect(() => validateDisplayName('A'.repeat(41)))
      .toThrow('Tên hiển thị phải có từ 2 đến 40 ký tự');
  });

  test.each([
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 3],
    [6, 4],
    [10, 6],
  ])('requires a practical 60%% voting quorum for %i members', (members, expected) => {
    expect(requiredVoterCount(members)).toBe(expected);
  });

  test('snapshots date-specific sellable inventory for the voting room', () => {
    const snapshot = candidateSnapshot({
      title: 'Bảo tàng',
      tickets: [
        { availability: { availableTickets: 12 } },
        { availability: { availableTickets: 7 } },
      ],
      availabilityDate: '2026-08-01',
    });

    expect(snapshot.availabilityDate).toBe('2026-08-01');
    expect(snapshot.maxAvailableTickets).toBe(12);
  });

  test('does not expose stable account IDs in the guest-facing room payload', () => {
    const payload = serializeRoom({
      id: 'room-1',
      host: { id: 'user-host', fullName: 'Minh Anh' },
      members: [{
        id: 'member-1',
        userId: 'user-host',
        role: 'HOST',
        displayName: 'Minh Anh',
        avatarKey: 'teal',
        budgetCap: 500000,
        preferences: { categories: [] },
        updatedAt: new Date(),
      }],
      candidates: [{
        id: 'candidate-1',
        attractionId: 'attraction-1',
        snapshot: { title: 'Bảo tàng' },
        votes: [
          { id: 'vote-active', memberId: 'member-1', value: 'LOVE' },
          { id: 'vote-removed', memberId: 'member-removed', value: 'VETO' },
        ],
      }],
      decisions: [],
    }, { memberId: 'member-1' });

    expect(payload.host).toEqual({ fullName: 'Minh Anh' });
    expect(payload.me.userId).toBeUndefined();
    expect(payload.members[0].userId).toBeUndefined();
    expect(payload.votes.map((vote) => vote.id)).toEqual(['vote-active']);
    expect(payload.votingPolicy).toEqual({
      quorumPercent: 60,
      requiredVoters: 2,
    });
  });

  test('does not reopen a finalized plan after its first booking has started', async () => {
    const room = {
      id: 'room-booked',
      hostUserId: 'host-1',
      status: 'FINALIZED',
      version: 8,
      bookingStartedAt: new Date('2026-07-27T10:00:00.000Z'),
      savedItinerary: { liveTrip: null },
    };
    const prismaClient = {
      partyRoom: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(room),
      },
    };

    await expect(reopenRoom(room.id, 'host-1', { prismaClient }))
      .rejects.toMatchObject({ statusCode: 409, code: 'PARTY_BOOKING_ALREADY_STARTED' });
  });

  test('atomically refuses reopen when booking starts after the room was read', async () => {
    const room = {
      id: 'room-racing',
      hostUserId: 'host-1',
      status: 'FINALIZED',
      version: 8,
      bookingStartedAt: null,
      savedItinerary: { liveTrip: null },
    };
    const prismaClient = {
      partyRoom: {
        updateMany: jest.fn()
          .mockResolvedValueOnce({ count: 0 }) // stale-room sweep
          .mockResolvedValueOnce({ count: 0 }), // compare-and-set reopen loses the race
        findUnique: jest.fn().mockResolvedValue(room),
      },
    };

    await expect(reopenRoom(room.id, 'host-1', { prismaClient }))
      .rejects.toMatchObject({ statusCode: 409, code: 'PARTY_ROOM_VERSION_CHANGED' });
    expect(prismaClient.partyRoom.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: room.id,
          version: 8,
          bookingStartedAt: null,
        }),
      }),
      );
    });

    test('refuses to close a finalized room after itinerary booking has started', async () => {
      const room = {
        id: 'room-booking-in-progress',
        hostUserId: 'host-1',
        status: 'FINALIZED',
        version: 8,
        bookingStartedAt: new Date('2026-07-27T10:00:00.000Z'),
      };
      const prismaClient = {
        partyRoom: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique: jest.fn().mockResolvedValue(room),
          update: jest.fn(),
        },
      };

      await expect(closeRoom(room.id, 'host-1', { prismaClient }))
        .rejects.toMatchObject({ statusCode: 409, code: 'PARTY_BOOKING_ALREADY_STARTED' });
      expect(prismaClient.partyRoom.update).not.toHaveBeenCalled();
    });
  });
