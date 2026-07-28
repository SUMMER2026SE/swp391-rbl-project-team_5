'use strict';

const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { getCatalogSummaryWithMeta } = require('./aiCatalogService');
const { generateItinerary } = require('./aiAssistantService');
const {
  ALGORITHM_VERSION,
  computePlanMetrics,
  scoreCandidates,
  selectConsensusCandidates,
  votingMemberIds,
} = require('./partyConsensusService');
const {
  createOpaqueToken,
  hashPartyToken,
  tokensMatch,
} = require('../utils/partyToken');
const { todayInVietnam } = require('../utils/refundService');
const { canonicalizeCity } = require('../utils/location');
const {
  disconnectPartyMemberSockets,
  emitPartyRoomUpdated,
} = require('../realtime/events');

const MAX_ROOMS_PER_HOST = 20;
const ROOM_HISTORY_LIMIT = 10;
const MAX_SAVED_ITINERARIES_PER_USER = 20;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const JOIN_TRANSACTION_ATTEMPTS = 5;
const ALLOWED_PACES = new Set(['relaxed', 'normal', 'packed']);
const ALLOWED_VOTES = new Set(['LIKE', 'LOVE', 'VETO']);
const ALLOWED_AVATARS = new Set([
  'teal',
  'blue',
  'violet',
  'rose',
  'amber',
  'emerald',
  'indigo',
  'coral',
]);
const PACE_ACTIVITY_TARGET = Object.freeze({
  relaxed: 1,
  normal: 2,
  packed: 3,
});

const PARTY_ROOM_INCLUDE = {
  host: { select: { id: true, fullName: true } },
  savedItinerary: {
    select: {
      id: true,
      planId: true,
      title: true,
      liveTrip: { select: { id: true, status: true } },
    },
  },
  members: {
    where: { removedAt: null },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    select: {
      id: true,
      userId: true,
      role: true,
      displayName: true,
      avatarKey: true,
      budgetCap: true,
      preferences: true,
      joinedAt: true,
      lastSeenAt: true,
      updatedAt: true,
    },
  },
  candidates: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      votes: {
        select: {
          id: true,
          memberId: true,
          candidateId: true,
          value: true,
          updatedAt: true,
        },
      },
    },
  },
  decisions: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      inputVersion: true,
      algorithmVersion: true,
      consensusScore: true,
      averageSatisfaction: true,
      minimumSatisfaction: true,
      snapshot: true,
      metrics: true,
      createdAt: true,
    },
  },
};

const PARTY_ROOM_LIST_INCLUDE = {
  _count: {
    select: {
      members: { where: { removedAt: null } },
      candidates: true,
      decisions: true,
    },
  },
  savedItinerary: {
    select: {
      id: true,
      planId: true,
      liveTrip: { select: { id: true, status: true } },
    },
  },
};

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function waitForJoinRetry(attempt) {
  const delayMs = (attempt * 20) + Math.floor(Math.random() * 40);
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
    ? date
    : null;
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

function isTripDatePast(value) {
  const key = dateKey(value);
  return Boolean(key && key < todayInVietnam());
}

function requiredVoterCount(memberCount) {
  const count = Math.max(0, Number(memberCount) || 0);
  return Math.max(2, Math.ceil(count * 0.6));
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeIdentity(value) {
  return normalizeDisplayName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function validateDisplayName(value) {
  const normalized = normalizeDisplayName(value);
  if (normalized.length < 2 || normalized.length > 40) {
    throw createHttpError(
      400,
      'PARTY_DISPLAY_NAME_INVALID',
      'Tên hiển thị phải có từ 2 đến 40 ký tự.',
    );
  }
  if (!/^[\p{L}\p{N}\s._-]+$/u.test(normalized)) {
    throw createHttpError(
      400,
      'PARTY_DISPLAY_NAME_INVALID',
      'Tên hiển thị chỉ được chứa chữ, số, khoảng trắng, dấu chấm, gạch ngang hoặc gạch dưới.',
    );
  }
  return normalized;
}

function normalizeAvatar(value) {
  const avatar = String(value || '').trim().toLowerCase();
  return ALLOWED_AVATARS.has(avatar) ? avatar : 'teal';
}

function normalizePreferences(value) {
  const categories = Array.isArray(value)
    ? value
    : Array.isArray(value?.categories)
      ? value.categories
      : [];
  return {
    categories: [...new Set(
      categories
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length >= 2 && item.length <= 80),
    )].slice(0, 5),
  };
}

function normalizeBudgetCap(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 50_000 || parsed > 100_000_000) {
    throw createHttpError(
      400,
      'PARTY_BUDGET_INVALID',
      'Ngân sách tham khảo mỗi người phải từ 50.000đ đến 100.000.000đ.',
    );
  }
  return parsed;
}

function validateCreateRoomInput(input = {}) {
  const title = String(input.title || '').trim().replace(/\s+/g, ' ');
  const city = canonicalizeCity(input.city);
  const startDate = parseDateOnly(input.startDate);
  const dayCount = Number(input.dayCount);
  const adults = Number(input.adults);
  const children = Number(input.children || 0);
  const totalBudget = Number(input.totalBudget);
  const pace = String(input.pace || 'normal').trim().toLowerCase();
  const maxMembers = Number(input.maxMembers || 10);
  const tomorrow = addDays(todayInVietnam(), 1);
  const latestDate = addDays(todayInVietnam(), 365);
  const startDateKey = dateKey(startDate);

  if (!city || city.length < 2 || city.length > 100) {
    throw createHttpError(400, 'PARTY_CITY_INVALID', 'Vui lòng nhập thành phố hợp lệ.');
  }
  if (title.length > 120) {
    throw createHttpError(
      400,
      'PARTY_TITLE_INVALID',
      'Tên chuyến đi không được vượt quá 120 ký tự.',
    );
  }
  if (!startDate || startDateKey < tomorrow || startDateKey > latestDate) {
    throw createHttpError(
      400,
      'PARTY_START_DATE_INVALID',
      'Ngày bắt đầu phải từ ngày mai và không quá 365 ngày tới.',
    );
  }
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 5) {
    throw createHttpError(400, 'PARTY_DAY_COUNT_INVALID', 'Số ngày phải từ 1 đến 5.');
  }
  if (
    !Number.isInteger(adults)
    || !Number.isInteger(children)
    || adults < 0
    || children < 0
    || adults + children < 1
    || adults + children > 20
  ) {
    throw createHttpError(
      400,
      'PARTY_SIZE_INVALID',
      'Nhóm phải có từ 1 đến 20 khách với số người lớn/trẻ em hợp lệ.',
    );
  }
  if (!Number.isSafeInteger(totalBudget) || totalBudget < 100_000 || totalBudget > 1_000_000_000) {
    throw createHttpError(
      400,
      'PARTY_TOTAL_BUDGET_INVALID',
      'Ngân sách vé của nhóm phải từ 100.000đ đến 1.000.000.000đ.',
    );
  }
  if (!ALLOWED_PACES.has(pace)) {
    throw createHttpError(400, 'PARTY_PACE_INVALID', 'Nhịp độ chuyến đi không hợp lệ.');
  }
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 10) {
    throw createHttpError(400, 'PARTY_MAX_MEMBERS_INVALID', 'Phòng chỉ hỗ trợ từ 2 đến 10 thành viên.');
  }

  return {
    title: title || `Cùng khám phá ${city}`,
    city,
    startDate,
    startDateKey,
    dayCount,
    adults,
    children,
    totalBudget,
    pace,
    maxMembers,
  };
}

function candidateSnapshot(item) {
  const availableTickets = (item.tickets || []).map(
    (ticket) => Number(ticket.availability?.availableTickets || 0),
  );
  return {
    title: item.title,
    description: item.description,
    city: item.city,
    district: item.district || null,
    imageUrl: item.imageUrl || null,
    rating: Number(item.rating || 0),
    totalReviews: Number(item.totalReviews || 0),
    minPrice: item.minPrice == null ? null : Number(item.minPrice),
    categories: Array.isArray(item.categories) ? item.categories : [],
    environment: item.environment || 'MIXED',
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    availabilityDate: item.availabilityDate || null,
    maxAvailableTickets:
      availableTickets.length > 0 ? Math.max(...availableTickets) : null,
  };
}

function toMoney(value) {
  return value == null ? null : Number(value);
}

function serializeMember(member, isSelf = false) {
  if (!member) return null;
  return {
    id: member.id,
    role: member.role,
    displayName: member.displayName,
    avatarKey: member.avatarKey,
    budgetCap: toMoney(member.budgetCap),
    preferences: member.preferences,
    updatedAt: member.updatedAt,
    ...(isSelf ? { isHost: member.role === 'HOST' } : {}),
  };
}

function serializeRoom(room, actor = null) {
  const activeMemberIds = new Set((room.members || []).map((item) => item.id));
  const votes = (room.candidates || [])
    .flatMap((candidate) => candidate.votes || [])
    .filter((vote) => activeMemberIds.has(vote.memberId));
  const latestDecision = room.decisions?.[0] || null;
  const member = actor?.memberId
    ? room.members?.find((item) => item.id === actor.memberId)
    : null;

  return {
    id: room.id,
    title: room.title,
    city: room.city,
    startDate: dateKey(room.startDate),
    dayCount: room.dayCount,
    adults: room.adults,
    children: room.children,
    totalBudget: toMoney(room.totalBudget),
    pace: room.pace,
    maxMembers: room.maxMembers,
    votingPolicy: {
      quorumPercent: 60,
      requiredVoters: requiredVoterCount((room.members || []).length),
    },
    status: room.status,
    version: room.version,
    inviteExpiresAt: room.inviteExpiresAt,
    finalizedAt: room.finalizedAt,
    bookingStartedAt: room.bookingStartedAt,
    bookingVersion: room.bookingVersion,
    closedAt: room.closedAt,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    host: room.host ? { fullName: room.host.fullName } : null,
    savedItinerary: room.savedItinerary
      ? {
          id: room.savedItinerary.id,
          planId: room.savedItinerary.planId,
          title: room.savedItinerary.title,
          liveTrip: room.savedItinerary.liveTrip || null,
        }
      : null,
    me: serializeMember(member, true),
    members: (room.members || []).map((item) => serializeMember(item)),
    candidates: (room.candidates || []).map((candidate) => ({
      id: candidate.id,
      attractionId: candidate.attractionId,
      snapshot: candidate.snapshot,
      position: candidate.position,
      createdAt: candidate.createdAt,
    })),
    votes,
    latestDecision: latestDecision
      ? {
          ...latestDecision,
          consensusScore: toMoney(latestDecision.consensusScore),
          averageSatisfaction: toMoney(latestDecision.averageSatisfaction),
          minimumSatisfaction: toMoney(latestDecision.minimumSatisfaction),
        }
      : null,
  };
}

async function loadRoom(roomId, { prismaClient = prisma } = {}) {
  await expireStaleRooms({ roomId }, { prismaClient });
  return prismaClient.partyRoom.findUnique({
    where: { id: String(roomId || '').trim() },
    include: PARTY_ROOM_INCLUDE,
  });
}

async function expireStaleRooms(
  { roomId, hostUserId } = {},
  { prismaClient = prisma } = {},
) {
  const today = new Date(`${todayInVietnam()}T00:00:00.000Z`);
  return prismaClient.partyRoom.updateMany({
    where: {
      ...(roomId ? { id: String(roomId).trim() } : {}),
      ...(hostUserId ? { hostUserId } : {}),
      status: { in: ['OPEN', 'FINALIZED'] },
      startDate: { lt: today },
    },
    data: {
      status: 'EXPIRED',
      closedAt: new Date(),
      inviteExpiresAt: new Date(),
      version: { increment: 1 },
    },
  });
}

function assertHost(room, userId) {
  if (!room || room.hostUserId !== userId) {
    throw createHttpError(404, 'PARTY_ROOM_NOT_FOUND', 'Không tìm thấy phòng chuyến đi.');
  }
}

function assertOpen(room) {
  if (room.status !== 'OPEN' || isTripDatePast(room.startDate)) {
    throw createHttpError(
      409,
      'PARTY_ROOM_NOT_OPEN',
      room.status === 'FINALIZED'
        ? 'Lịch trình đã được chốt. Host cần mở lại bình chọn trước khi thay đổi.'
        : room.status === 'EXPIRED' || isTripDatePast(room.startDate)
          ? 'Ngày khởi hành đã qua nên phòng chỉ còn được xem trong lịch sử.'
        : 'Phòng chuyến đi không còn nhận thay đổi.',
    );
  }
}

async function createRoom(userId, input, { prismaClient = prisma } = {}) {
  const values = validateCreateRoomInput(input);
  await expireStaleRooms({ hostUserId: userId }, { prismaClient });
  const roomCount = await prismaClient.partyRoom.count({
    where: {
      hostUserId: userId,
      status: { in: ['OPEN', 'FINALIZED'] },
    },
  });
  if (roomCount >= MAX_ROOMS_PER_HOST) {
    throw createHttpError(
      409,
      'PARTY_ROOM_LIMIT_REACHED',
      `Bạn chỉ có thể giữ tối đa ${MAX_ROOMS_PER_HOST} phòng đang hoạt động.`,
    );
  }

  const host = await prismaClient.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true },
  });
  if (!host) throw createHttpError(401, 'UNAUTHENTICATED', 'Yêu cầu đăng nhập.');

  const { catalog } = await getCatalogSummaryWithMeta({
    city: values.city,
    date: values.startDate,
    limit: 12,
  });
  if (catalog.length < 2) {
    throw createHttpError(
      422,
      'PARTY_CATALOG_INSUFFICIENT',
      'Khu vực này chưa có đủ điểm đang bán vé để mở bình chọn nhóm.',
    );
  }

  const inviteToken = createOpaqueToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const hostDisplayName = validateDisplayName(
    normalizeDisplayName(host.fullName || 'Chủ phòng').slice(0, 40),
  );
  const averageBudget = Math.max(
    50_000,
    Math.min(
      100_000_000,
      Math.round(values.totalBudget / (values.adults + values.children)),
    ),
  );

  const created = await prismaClient.partyRoom.create({
    data: {
      hostUserId: userId,
      title: values.title,
      city: values.city,
      startDate: values.startDate,
      dayCount: values.dayCount,
      adults: values.adults,
      children: values.children,
      totalBudget: values.totalBudget,
      pace: values.pace,
      maxMembers: values.maxMembers,
      inviteTokenHash: hashPartyToken(inviteToken),
      inviteExpiresAt,
      members: {
        create: {
          userId,
          role: 'HOST',
          displayName: hostDisplayName,
          displayNameNormalized: normalizeIdentity(hostDisplayName),
          avatarKey: 'teal',
          budgetCap: averageBudget,
          preferences: { categories: [] },
        },
      },
      candidates: {
        create: catalog.slice(0, 10).map((item, index) => ({
          attractionId: item.id,
          position: index,
          snapshot: candidateSnapshot(item),
        })),
      },
    },
    include: PARTY_ROOM_INCLUDE,
  });

  const hostMember = created.members.find((member) => member.role === 'HOST');
  return {
    inviteToken,
    room: serializeRoom(created, {
      memberId: hostMember?.id,
      isHost: true,
    }),
  };
}

async function listRooms(userId, { prismaClient = prisma } = {}) {
  await expireStaleRooms({ hostUserId: userId }, { prismaClient });
  const [activeRooms, archivedRooms] = await Promise.all([
    prismaClient.partyRoom.findMany({
      where: {
        hostUserId: userId,
        status: { in: ['OPEN', 'FINALIZED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_ROOMS_PER_HOST,
      include: PARTY_ROOM_LIST_INCLUDE,
    }),
    prismaClient.partyRoom.findMany({
      where: {
        hostUserId: userId,
        status: { in: ['CLOSED', 'EXPIRED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: ROOM_HISTORY_LIMIT,
      include: PARTY_ROOM_LIST_INCLUDE,
    }),
  ]);
  const rooms = [...activeRooms, ...archivedRooms]
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  return rooms.map((room) => ({
    id: room.id,
    title: room.title,
    city: room.city,
    startDate: dateKey(room.startDate),
    dayCount: room.dayCount,
    adults: room.adults,
    children: room.children,
    totalBudget: toMoney(room.totalBudget),
    maxMembers: room.maxMembers,
    status: room.status,
    version: room.version,
    memberCount: room._count.members,
    candidateCount: room._count.candidates,
    decisionCount: room._count.decisions,
    savedItinerary: room.savedItinerary,
    updatedAt: room.updatedAt,
  }));
}

async function findActor({ roomId, userId, partyToken }, { prismaClient = prisma } = {}) {
  const normalizedRoomId = String(roomId || '').trim();
  if (userId) {
    const userMember = await prismaClient.partyMember.findFirst({
      where: {
        roomId: normalizedRoomId,
        userId,
        removedAt: null,
      },
      select: { id: true, roomId: true, userId: true, role: true },
    });
    if (userMember) {
      return {
        memberId: userMember.id,
        roomId: userMember.roomId,
        userId: userMember.userId,
        role: userMember.role,
        isHost: userMember.role === 'HOST',
        kind: 'user',
      };
    }
  }

  const token = String(partyToken || '').trim();
  if (!token) return null;
  const member = await prismaClient.partyMember.findFirst({
    where: {
      roomId: normalizedRoomId,
      sessionTokenHash: hashPartyToken(token),
      removedAt: null,
      sessionExpiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      roomId: true,
      userId: true,
      role: true,
      lastSeenAt: true,
    },
  });
  if (!member) return null;

  if (Date.now() - new Date(member.lastSeenAt).getTime() > 5 * 60 * 1000) {
    await prismaClient.partyMember.updateMany({
      where: { id: member.id, removedAt: null },
      data: { lastSeenAt: new Date() },
    });
  }
  return {
    memberId: member.id,
    roomId: member.roomId,
    userId: member.userId,
    role: member.role,
    isHost: member.role === 'HOST',
    kind: 'guest',
  };
}

async function getRoom(roomId, actor, { prismaClient = prisma } = {}) {
  const room = await loadRoom(roomId, { prismaClient });
  if (!room || !actor || actor.roomId !== room.id) {
    throw createHttpError(404, 'PARTY_ROOM_NOT_FOUND', 'Không tìm thấy phòng chuyến đi.');
  }
  return serializeRoom(room, actor);
}

async function previewInvite(
  roomId,
  inviteToken,
  { prismaClient = prisma } = {},
) {
  await expireStaleRooms({ roomId }, { prismaClient });
  const token = String(inviteToken || '').trim();
  if (!token) {
    throw createHttpError(400, 'PARTY_INVITE_REQUIRED', 'Link mời không hợp lệ.');
  }
  const room = await prismaClient.partyRoom.findUnique({
    where: { id: String(roomId || '').trim() },
    select: {
      id: true,
      title: true,
      city: true,
      startDate: true,
      dayCount: true,
      adults: true,
      children: true,
      maxMembers: true,
      status: true,
      inviteTokenHash: true,
      inviteExpiresAt: true,
      host: { select: { fullName: true } },
      _count: {
        select: {
          members: { where: { removedAt: null } },
        },
      },
    },
  });
  if (!room || !tokensMatch(token, room.inviteTokenHash)) {
    throw createHttpError(
      404,
      'PARTY_INVITE_INVALID',
      'Link mời không hợp lệ hoặc đã được thay thế.',
    );
  }
  assertOpen(room);
  if (new Date(room.inviteExpiresAt) <= new Date()) {
    throw createHttpError(
      410,
      'PARTY_INVITE_EXPIRED',
      'Link mời đã hết hạn. Hãy nhờ Host tạo link mới.',
    );
  }
  return {
    id: room.id,
    title: room.title,
    city: room.city,
    startDate: dateKey(room.startDate),
    dayCount: room.dayCount,
    travelers: room.adults + room.children,
    memberCount: room._count.members,
    maxMembers: room.maxMembers,
    host: { fullName: room.host.fullName },
    inviteExpiresAt: room.inviteExpiresAt,
  };
}

async function joinRoom(roomId, input = {}, { prismaClient = prisma } = {}) {
  await expireStaleRooms({ roomId }, { prismaClient });
  const displayName = validateDisplayName(input.displayName);
  const inviteToken = String(input.inviteToken || '').trim();
  const avatarKey = normalizeAvatar(input.avatarKey);
  if (!inviteToken) {
    throw createHttpError(400, 'PARTY_INVITE_REQUIRED', 'Link mời không hợp lệ.');
  }

  const partyToken = createOpaqueToken();
  let createdMember;
  for (let attempt = 1; attempt <= JOIN_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      createdMember = await prismaClient.$transaction(async (tx) => {
        const room = await tx.partyRoom.findUnique({
          where: { id: String(roomId || '').trim() },
          select: {
            id: true,
            status: true,
            startDate: true,
            maxMembers: true,
            inviteTokenHash: true,
            inviteExpiresAt: true,
          },
        });
        if (!room || !tokensMatch(inviteToken, room.inviteTokenHash)) {
          throw createHttpError(404, 'PARTY_INVITE_INVALID', 'Link mời không hợp lệ hoặc đã được thay thế.');
        }
        assertOpen(room);
        if (new Date(room.inviteExpiresAt) <= new Date()) {
          throw createHttpError(410, 'PARTY_INVITE_EXPIRED', 'Link mời đã hết hạn. Hãy nhờ Host tạo link mới.');
        }

        const memberCount = await tx.partyMember.count({
          where: { roomId: room.id, removedAt: null },
        });
        if (memberCount >= room.maxMembers) {
          throw createHttpError(409, 'PARTY_ROOM_FULL', 'Phòng đã đủ thành viên.');
        }

        const member = await tx.partyMember.create({
          data: {
            roomId: room.id,
            role: 'GUEST',
            displayName,
            displayNameNormalized: normalizeIdentity(displayName),
            avatarKey,
            budgetCap: normalizeBudgetCap(input.budgetCap),
            preferences: normalizePreferences(input.preferences),
            sessionTokenHash: hashPartyToken(partyToken),
            sessionExpiresAt: new Date(Date.now() + GUEST_SESSION_TTL_MS),
          },
          select: { id: true, roomId: true, role: true },
        });
        await tx.partyRoom.update({
          where: { id: room.id },
          data: { version: { increment: 1 } },
        });
        return member;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (error?.code === 'P2034' && attempt < JOIN_TRANSACTION_ATTEMPTS) {
        await waitForJoinRetry(attempt);
        continue;
      }
      if (error?.code === 'P2034') {
        throw createHttpError(
          503,
          'PARTY_JOIN_BUSY',
          'Nhiều thành viên đang tham gia cùng lúc. Vui lòng thử lại sau vài giây.',
        );
      }
      if (error?.code === 'P2002') {
        throw createHttpError(
          409,
          'PARTY_DISPLAY_NAME_TAKEN',
          'Tên này đã có trong phòng. Vui lòng chọn tên khác.',
        );
      }
      throw error;
    }
  }

  const room = await loadRoom(roomId, { prismaClient });
  emitPartyRoomUpdated({
    roomId: room.id,
    eventName: 'PARTY_MEMBER_JOINED',
    reason: 'member_joined',
    version: room.version,
    memberId: createdMember.id,
  });
  return {
    partyToken,
    expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_MS),
    room: serializeRoom(room, {
      memberId: createdMember.id,
      roomId: room.id,
      role: 'GUEST',
      kind: 'guest',
    }),
  };
}

async function updateMember(
  roomId,
  actor,
  input = {},
  { prismaClient = prisma } = {},
) {
  const member = await prismaClient.partyMember.findFirst({
    where: { id: actor.memberId, roomId, removedAt: null },
    include: { room: { select: { status: true, startDate: true } } },
  });
  if (!member) throw createHttpError(404, 'PARTY_MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');
  assertOpen(member.room);

  const data = {};
  if (Object.prototype.hasOwnProperty.call(input, 'displayName')) {
    const displayName = validateDisplayName(input.displayName);
    data.displayName = displayName;
    data.displayNameNormalized = normalizeIdentity(displayName);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'avatarKey')) {
    data.avatarKey = normalizeAvatar(input.avatarKey);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'budgetCap')) {
    data.budgetCap = normalizeBudgetCap(input.budgetCap);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'preferences')) {
    data.preferences = normalizePreferences(input.preferences);
  }
  if (Object.keys(data).length === 0) {
    throw createHttpError(400, 'PARTY_MEMBER_UPDATE_EMPTY', 'Không có thông tin cần cập nhật.');
  }

  try {
    await prismaClient.$transaction(async (tx) => {
      await tx.partyMember.update({ where: { id: member.id }, data });
      await tx.partyRoom.update({
        where: { id: roomId },
        data: { version: { increment: 1 } },
      });
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw createHttpError(
        409,
        'PARTY_DISPLAY_NAME_TAKEN',
        'Tên này đã có trong phòng. Vui lòng chọn tên khác.',
      );
    }
    throw error;
  }

  const room = await loadRoom(roomId, { prismaClient });
  emitPartyRoomUpdated({
    roomId,
    eventName: 'PARTY_MEMBER_UPDATED',
    reason: 'member_updated',
    version: room.version,
    memberId: member.id,
  });
  return serializeRoom(room, actor);
}

async function castVote(
  roomId,
  candidateId,
  actor,
  value,
  { prismaClient = prisma } = {},
) {
  const normalizedValue = String(value || '').trim().toUpperCase();
  if (!ALLOWED_VOTES.has(normalizedValue)) {
    throw createHttpError(400, 'PARTY_VOTE_INVALID', 'Bình chọn không hợp lệ.');
  }

  const candidate = await prismaClient.partyCandidate.findFirst({
    where: { id: String(candidateId || '').trim(), roomId },
    include: { room: { select: { status: true, startDate: true } } },
  });
  if (!candidate) {
    throw createHttpError(404, 'PARTY_CANDIDATE_NOT_FOUND', 'Không tìm thấy địa điểm trong phòng.');
  }
  assertOpen(candidate.room);

  const member = await prismaClient.partyMember.findFirst({
    where: { id: actor.memberId, roomId, removedAt: null },
    select: { id: true },
  });
  if (!member) throw createHttpError(404, 'PARTY_MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');

  const existing = await prismaClient.partyVote.findUnique({
    where: { memberId_candidateId: { memberId: member.id, candidateId: candidate.id } },
  });
  if (existing?.value === normalizedValue) {
    const unchangedRoom = await loadRoom(roomId, { prismaClient });
    return serializeRoom(unchangedRoom, actor);
  }

  await prismaClient.$transaction(async (tx) => {
    await tx.partyVote.upsert({
      where: { memberId_candidateId: { memberId: member.id, candidateId: candidate.id } },
      create: {
        memberId: member.id,
        candidateId: candidate.id,
        value: normalizedValue,
      },
      update: { value: normalizedValue },
    });
    await tx.partyRoom.update({
      where: { id: roomId },
      data: { version: { increment: 1 } },
    });
  });

  const room = await loadRoom(roomId, { prismaClient });
  emitPartyRoomUpdated({
    roomId,
    eventName: 'PARTY_VOTE_UPDATED',
    reason: 'vote_updated',
    version: room.version,
    memberId: member.id,
    candidateId: candidate.id,
  });
  return serializeRoom(room, actor);
}

async function clearVote(
  roomId,
  candidateId,
  actor,
  { prismaClient = prisma } = {},
) {
  const candidate = await prismaClient.partyCandidate.findFirst({
    where: { id: String(candidateId || '').trim(), roomId },
    include: { room: { select: { status: true, startDate: true } } },
  });
  if (!candidate) {
    throw createHttpError(404, 'PARTY_CANDIDATE_NOT_FOUND', 'Không tìm thấy địa điểm trong phòng.');
  }
  assertOpen(candidate.room);
  const member = await prismaClient.partyMember.findFirst({
    where: { id: actor.memberId, roomId, removedAt: null },
    select: { id: true },
  });
  if (!member) throw createHttpError(404, 'PARTY_MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');

  await prismaClient.$transaction(async (tx) => {
    const deleted = await tx.partyVote.deleteMany({
      where: { memberId: member.id, candidateId: candidate.id },
    });
    if (deleted.count > 0) {
      await tx.partyRoom.update({
        where: { id: roomId },
        data: { version: { increment: 1 } },
      });
    }
  });
  const room = await loadRoom(roomId, { prismaClient });
  emitPartyRoomUpdated({
    roomId,
    eventName: 'PARTY_VOTE_UPDATED',
    reason: 'vote_cleared',
    version: room.version,
    memberId: member.id,
    candidateId: candidate.id,
  });
  return serializeRoom(room, actor);
}

async function finalizeRoom(roomId, userId, { prismaClient = prisma } = {}) {
  const room = await loadRoom(roomId, { prismaClient });
  assertHost(room, userId);
  assertOpen(room);
  const activeMembers = room.members || [];
  const votes = room.candidates.flatMap((candidate) => candidate.votes || []);
  const votingMembers = votingMemberIds(votes, activeMembers.map((member) => member.id));
  const requiredVoters = requiredVoterCount(activeMembers.length);
  if (activeMembers.length < 2 || votingMembers.length < requiredVoters) {
    throw createHttpError(
      409,
      'PARTY_NOT_ENOUGH_VOTERS',
      `Cần ít nhất ${requiredVoters} trên ${activeMembers.length} thành viên đã bình chọn (ngưỡng 60%) trước khi chốt.`,
    );
  }

  const scoredCandidates = scoreCandidates({
    candidates: room.candidates,
    members: activeMembers,
    votes,
  });
  const paceTarget = PACE_ACTIVITY_TARGET[room.pace] || PACE_ACTIVITY_TARGET.normal;
  const targetCount = room.dayCount * paceTarget;
  const selection = selectConsensusCandidates(
    scoredCandidates,
    Math.min(room.candidates.length, targetCount),
  );
  if (selection.selected.length === 0) {
    throw createHttpError(
      409,
      'PARTY_NO_ENDORSED_CANDIDATES',
      'Chưa có địa điểm nào được chọn “Phù hợp” hoặc “Rất muốn đi” mà không bị phủ quyết.',
    );
  }

  const planResult = await generateItinerary({
    city: room.city,
    days: room.dayCount,
    budget: Number(room.totalBudget),
    adults: room.adults,
    children: room.children,
    pace: room.pace,
    priority: 'balanced',
    companion: 'friends',
    startDate: dateKey(room.startDate),
    userId,
    allowedAttractionIds: selection.selected.map((candidate) => candidate.attractionId),
    skipLlmCopy: true,
  });
  const plan = planResult?.data || {};
  const activityCount = (plan.days || []).reduce(
    (sum, day) => sum + (day.activities?.length || 0),
    0,
  );
  if (activityCount === 0) {
    throw createHttpError(
      409,
      'PARTY_NO_BOOKABLE_PLAN',
      'Các lựa chọn được bình chọn hiện không còn tạo được lịch trình đủ vé và đúng ngân sách.',
    );
  }

  const metrics = computePlanMetrics({
    plan,
    scoredCandidates,
    members: activeMembers,
  });
  const selectedSet = new Set(metrics.selectedAttractionIds);
  const inputVersion = room.version;
  const catalogCheckedAt = new Date().toISOString();
  const finalPlan = {
    ...plan,
    title: room.title,
    clientPlanId: `party-${room.id}`,
    partySync: {
      roomId: room.id,
      algorithmVersion: ALGORITHM_VERSION,
      inputVersion,
      consensusScore: metrics.consensusScore,
      averageSatisfaction: metrics.averageSatisfaction,
      minimumSatisfaction: metrics.minimumSatisfaction,
      memberCount: activeMembers.length,
      votingMemberCount: votingMembers.length,
      requiredVoterCount: requiredVoters,
      catalogCheckedAt,
      vetoedAttractionIds: selection.vetoed.map((candidate) => candidate.attractionId),
      selectedAttractionIds: metrics.selectedAttractionIds,
      notScheduledAttractionIds: selection.selected
        .filter((candidate) => !selectedSet.has(candidate.attractionId))
        .map((candidate) => candidate.attractionId),
    },
  };
  const criteria = {
    source: 'party_sync',
    city: room.city,
    days: room.dayCount,
    startDate: dateKey(room.startDate),
    adults: room.adults,
    children: room.children,
    budget: Number(room.totalBudget),
    pace: room.pace,
  };
  const planId = `party-${room.id}`;

  await prismaClient.$transaction(async (tx) => {
    const existingSavedCount = await tx.savedItinerary.count({
      where: {
        userId,
        NOT: { planId },
      },
    });
    if (existingSavedCount >= MAX_SAVED_ITINERARIES_PER_USER) {
      throw createHttpError(
        409,
        'SAVED_ITINERARY_LIMIT_REACHED',
        `Bạn đã lưu tối đa ${MAX_SAVED_ITINERARIES_PER_USER} lịch trình. Hãy xóa bớt trước khi chốt.`,
      );
    }

    const locked = await tx.partyRoom.updateMany({
      where: { id: room.id, status: 'OPEN', version: inputVersion },
      data: {
        status: 'FINALIZED',
        finalizedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (locked.count !== 1) {
      throw createHttpError(
        409,
        'PARTY_ROOM_VERSION_CHANGED',
        'Bình chọn vừa thay đổi trong lúc chốt lịch. Hãy xem kết quả mới và thử lại.',
      );
    }

    const saved = await tx.savedItinerary.upsert({
      where: { userId_planId: { userId, planId } },
      create: {
        userId,
        planId,
        title: room.title,
        data: finalPlan,
        criteria,
      },
      update: {
        title: room.title,
        data: finalPlan,
        criteria,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.partyDecision.create({
      data: {
        roomId: room.id,
        inputVersion,
        algorithmVersion: ALGORITHM_VERSION,
        consensusScore: metrics.consensusScore,
        averageSatisfaction: metrics.averageSatisfaction,
        minimumSatisfaction: metrics.minimumSatisfaction,
        snapshot: finalPlan,
        metrics: {
          ...metrics,
          catalogCheckedAt,
          votingMemberCount: votingMembers.length,
          requiredVoterCount: requiredVoters,
          candidateScores: scoredCandidates.map((candidate) => ({
            attractionId: candidate.attractionId,
            title: candidate.title,
            score: Math.round(candidate.score * 100),
            averageSatisfaction: Math.round(candidate.averageSatisfaction * 100),
            minimumSatisfaction: Math.round(candidate.minimumSatisfaction * 100),
            voteCount: candidate.voteCount,
            positiveVoteCount: candidate.positiveVoteCount,
            vetoCount: candidate.vetoMemberIds.length,
          })),
        },
      },
    });
    await tx.partyRoom.update({
      where: { id: room.id },
      data: { savedItineraryId: saved.id },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const finalizedRoom = await loadRoom(room.id, { prismaClient });
  emitPartyRoomUpdated({
    roomId: room.id,
    eventName: 'PARTY_PLAN_FINALIZED',
    reason: 'plan_finalized',
    version: finalizedRoom.version,
  });
  return serializeRoom(
    finalizedRoom,
    finalizedRoom.members.find((member) => member.userId === userId)
      ? {
          memberId: finalizedRoom.members.find((member) => member.userId === userId).id,
          roomId: finalizedRoom.id,
          isHost: true,
          role: 'HOST',
        }
      : null,
  );
}

async function reopenRoom(roomId, userId, { prismaClient = prisma } = {}) {
  const room = await loadRoom(roomId, { prismaClient });
  assertHost(room, userId);
  if (room.status !== 'FINALIZED') {
    throw createHttpError(409, 'PARTY_ROOM_NOT_FINALIZED', 'Phòng chưa ở trạng thái đã chốt.');
  }
  if (room.savedItinerary?.liveTrip) {
    throw createHttpError(
      409,
      'PARTY_LIVE_TRIP_ALREADY_ACTIVE',
      'Lịch trình đã kích hoạt Live Trip nên không thể mở lại bình chọn.',
    );
  }
  if (room.bookingStartedAt) {
    throw createHttpError(
      409,
      'PARTY_BOOKING_ALREADY_STARTED',
      'Lịch trình đã bắt đầu phát sinh đơn đặt vé nên không thể mở lại bình chọn. Hãy tạo một phòng mới nếu nhóm muốn đổi kế hoạch.',
    );
  }
  const reopened = await prismaClient.partyRoom.updateMany({
    where: {
      id: room.id,
      status: 'FINALIZED',
      version: room.version,
      bookingStartedAt: null,
    },
    data: {
      status: 'OPEN',
      finalizedAt: null,
      version: { increment: 1 },
    },
  });
  if (reopened.count !== 1) {
    throw createHttpError(
      409,
      'PARTY_ROOM_VERSION_CHANGED',
      'Lịch trình vừa thay đổi hoặc đã bắt đầu phát sinh đơn đặt vé. Vui lòng tải lại phòng.',
    );
  }
  const reopenedRoom = await loadRoom(room.id, { prismaClient });
  emitPartyRoomUpdated({
    roomId: room.id,
    eventName: 'PARTY_ROOM_UPDATED',
    reason: 'room_reopened',
    version: reopenedRoom.version,
  });
  return serializeRoom(
    reopenedRoom,
    {
      memberId: reopenedRoom.members.find((member) => member.userId === userId)?.id,
      roomId: reopenedRoom.id,
      isHost: true,
      role: 'HOST',
    },
  );
}

async function rotateInvite(roomId, userId, { prismaClient = prisma } = {}) {
  await expireStaleRooms({ roomId }, { prismaClient });
  const room = await prismaClient.partyRoom.findUnique({
    where: { id: String(roomId || '').trim() },
  });
  assertHost(room, userId);
  assertOpen(room);
  const inviteToken = createOpaqueToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const updated = await prismaClient.partyRoom.update({
    where: { id: room.id },
    data: {
      inviteTokenHash: hashPartyToken(inviteToken),
      inviteExpiresAt,
      version: { increment: 1 },
    },
  });
  emitPartyRoomUpdated({
    roomId: room.id,
    eventName: 'PARTY_ROOM_UPDATED',
    reason: 'invite_rotated',
    version: updated.version,
  });
  return { inviteToken, inviteExpiresAt };
}

async function removeMember(roomId, memberId, userId, { prismaClient = prisma } = {}) {
  await expireStaleRooms({ roomId }, { prismaClient });
  const room = await prismaClient.partyRoom.findUnique({
    where: { id: String(roomId || '').trim() },
  });
  assertHost(room, userId);
  assertOpen(room);
  const member = await prismaClient.partyMember.findFirst({
    where: { id: String(memberId || '').trim(), roomId: room.id, removedAt: null },
  });
  if (!member) throw createHttpError(404, 'PARTY_MEMBER_NOT_FOUND', 'Không tìm thấy thành viên.');
  if (member.role === 'HOST') {
    throw createHttpError(409, 'PARTY_HOST_REMOVE_FORBIDDEN', 'Không thể xóa Host khỏi phòng.');
  }
  await prismaClient.$transaction([
    prismaClient.partyMember.update({
      where: { id: member.id },
      data: {
        removedAt: new Date(),
        sessionExpiresAt: new Date(),
        // Preserve the member/vote audit trail while releasing the active
        // display-name key so an accidentally removed guest can join again.
        displayNameNormalized: `${member.displayNameNormalized}#removed#${member.id}`,
      },
    }),
    prismaClient.partyRoom.update({
      where: { id: room.id },
      data: { version: { increment: 1 } },
    }),
  ]);
  const updated = await loadRoom(room.id, { prismaClient });
  emitPartyRoomUpdated({
    roomId: room.id,
    eventName: 'PARTY_ACCESS_REVOKED',
    reason: 'member_removed',
    version: updated.version,
    memberId: member.id,
  });
  disconnectPartyMemberSockets(member.id);
  return serializeRoom(
    updated,
    {
      memberId: updated.members.find((item) => item.userId === userId)?.id,
      roomId: updated.id,
      isHost: true,
      role: 'HOST',
    },
  );
}

async function closeRoom(roomId, userId, { prismaClient = prisma } = {}) {
  await expireStaleRooms({ roomId }, { prismaClient });
  const room = await prismaClient.partyRoom.findUnique({
    where: { id: String(roomId || '').trim() },
  });
  assertHost(room, userId);
    if (room.status === 'CLOSED' || room.status === 'EXPIRED') {
      throw createHttpError(409, 'PARTY_ROOM_ALREADY_CLOSED', 'Phòng đã đóng.');
    }
    if (room.bookingStartedAt) {
      throw createHttpError(
        409,
        'PARTY_BOOKING_ALREADY_STARTED',
        'Không thể đóng phòng khi lịch trình đang có đơn đặt vé. Hãy hoàn tất hoặc xử lý các dòng vé còn lại trong lịch trình.',
      );
    }
    const updated = await prismaClient.partyRoom.update({
    where: { id: room.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      inviteExpiresAt: new Date(),
      version: { increment: 1 },
    },
  });
  emitPartyRoomUpdated({
    roomId: room.id,
    eventName: 'PARTY_ROOM_UPDATED',
    reason: 'room_closed',
    version: updated.version,
  });
  return { id: updated.id, status: updated.status, version: updated.version };
}

module.exports = {
  ALLOWED_AVATARS,
  ALLOWED_VOTES,
  PARTY_ROOM_INCLUDE,
  candidateSnapshot,
  castVote,
  clearVote,
  closeRoom,
  createRoom,
  dateKey,
  expireStaleRooms,
  finalizeRoom,
  findActor,
  getRoom,
  joinRoom,
  listRooms,
  normalizeDisplayName,
  normalizeIdentity,
  normalizePreferences,
  previewInvite,
  requiredVoterCount,
  isTripDatePast,
  removeMember,
  reopenRoom,
  rotateInvite,
  serializeRoom,
  updateMember,
  validateDisplayName,
  validateCreateRoomInput,
};
