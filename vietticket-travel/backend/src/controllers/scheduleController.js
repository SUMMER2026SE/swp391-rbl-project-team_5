const prisma = require('../config/prisma');
const { toTimeSlot } = require('../utils/partnerMappers');
const { isValidTime, isValidDate } = require('../utils/partnerValidators');
const { findOwnedAttraction } = require('./attractionController');
const { assertPartnerCanEdit } = require('../services/attractionWorkflowService');
const { writeAuditLog } = require('../utils/auditLog');

// "1,1,1,1,1,0,0" -> [true,true,true,true,true,false,false]
function parseOpenDays(csv) {
  if (!csv) return [true, true, true, true, true, true, true];
  const parts = String(csv).split(',');
  const days = parts.map((p) => p.trim() === '1');
  while (days.length < 7) days.push(true);
  return days.slice(0, 7);
}

// [true,false,...] -> "1,0,..."
function serializeOpenDays(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, 7).map((v) => (v ? '1' : '0')).join(',');
}

function toDateKey(date) {
  // date là DateTime (cột @db.Date) -> "YYYY-MM-DD"
  return new Date(date).toISOString().slice(0, 10);
}

// GET /api/partners/attractions/:id/schedule
async function getSchedule(req, res, next) {
  try {
    const { hasPublishedVersion } = require('../services/attractionWorkflowService');

    const attraction = await findOwnedAttraction(req.params.id, req.partner.id, {
      timeSlots: {
        where: { ticketProductId: null, isActive: true },
        orderBy: { startTime: 'asc' },
      },
      specialDates: true,
    });
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    let schedule = null;
    if (hasPublishedVersion(attraction) && attraction.draftData && attraction.draftData.schedule) {
      schedule = attraction.draftData.schedule;
    } else {
      const specialDates = {};
      for (const sd of attraction.specialDates) {
        specialDates[toDateKey(sd.date)] = {
          closed: sd.closed,
          capacity: sd.capacity ?? undefined,
        };
      }
      schedule = {
        openDays: parseOpenDays(attraction.openDays),
        defaultCapacity: attraction.defaultCapacity,
        timeSlots: attraction.timeSlots.map(toTimeSlot),
        specialDates,
      };
    }

    return res.json({ schedule });
  } catch (error) {
    next(error);
  }
}

// PUT /api/partners/attractions/:id/schedule — thay thế toàn bộ cấu hình lịch
async function saveSchedule(req, res, next) {
  try {
    const {
      hasPublishedVersion,
      buildAttractionSnapshot,
    } = require('../services/attractionWorkflowService');
    const { randomUUID } = require('crypto');

    const attraction = await findOwnedAttraction(req.params.id, req.partner.id, {
      timeSlots: {
        where: { ticketProductId: null, isActive: true },
        orderBy: { startTime: 'asc' },
      },
      specialDates: true,
    });
    if (!attraction) {
      return res.status(404).json({ message: 'Không tìm thấy điểm tham quan.' });
    }

    assertPartnerCanEdit(attraction);

    const { openDays, defaultCapacity } = req.body;
    const hasTimeSlots = Object.prototype.hasOwnProperty.call(req.body, 'timeSlots');
    const hasSpecialDates = Object.prototype.hasOwnProperty.call(req.body, 'specialDates');
    const timeSlots = hasTimeSlots ? req.body.timeSlots : [];
    const specialDates = hasSpecialDates ? req.body.specialDates : {};

    if (hasTimeSlots && !Array.isArray(timeSlots)) {
      return res.status(400).json({ message: 'timeSlots phải là một mảng.' });
    }

    if (
      hasSpecialDates
      && (!specialDates || typeof specialDates !== 'object' || Array.isArray(specialDates))
    ) {
      return res.status(400).json({ message: 'specialDates phải là một object.' });
    }

    // --- Xác thực khung giờ ---
    for (const slot of timeSlots) {
      if (!isValidTime(slot.start) || !isValidTime(slot.end)) {
        return res.status(400).json({ message: 'Khung giờ có định dạng thời gian không hợp lệ.' });
      }
      if (slot.start >= slot.end) {
        return res.status(400).json({ message: `Khung giờ ${slot.start}–${slot.end} không hợp lệ (giờ bắt đầu phải trước giờ kết thúc).` });
      }
      const cap = Number(slot.capacity);
      if (!Number.isFinite(cap) || cap < 0) {
        return res.status(400).json({ message: 'Sức chứa khung giờ không hợp lệ.' });
      }
    }

    // --- Xác thực ngày đặc biệt ---
    for (const dateKey of Object.keys(specialDates)) {
      if (!isValidDate(dateKey)) {
        return res.status(400).json({ message: `Ngày đặc biệt không hợp lệ: ${dateKey}.` });
      }

      const value = specialDates[dateKey];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return res.status(400).json({ message: `Cấu hình ngày ${dateKey} không hợp lệ.` });
      }

      if (value.capacity !== undefined && value.capacity !== null && value.capacity !== '') {
        const capacity = Number(value.capacity);
        if (!Number.isFinite(capacity) || capacity < 0) {
          return res.status(400).json({
            message: `Sức chứa cho ngày ${dateKey} không hợp lệ.`,
          });
        }
      }
    }

    if (hasPublishedVersion(attraction)) {
      const draft = attraction.draftData || buildAttractionSnapshot(attraction);
      draft.schedule = draft.schedule || {};

      if (openDays !== undefined) {
        draft.schedule.openDays = openDays;
      }
      if (defaultCapacity !== undefined) {
        const cap = Number(defaultCapacity);
        if (!Number.isFinite(cap) || cap < 0) {
          return res.status(400).json({ message: 'Sức chứa mặc định không hợp lệ.' });
        }
        draft.schedule.defaultCapacity = cap;
      }
      if (hasTimeSlots) {
        draft.schedule.timeSlots = timeSlots.map((slot) => ({
          id: slot.id || `draft-${randomUUID()}`,
          start: slot.start,
          end: slot.end,
          capacity: Number(slot.capacity),
          isActive: slot.isActive !== false,
        }));
      }
      if (hasSpecialDates) {
        const draftSpecialDates = {};
        for (const [dateKey, value] of Object.entries(specialDates)) {
          draftSpecialDates[dateKey] = {
            closed: Boolean(value.closed),
            capacity:
              value.capacity === undefined || value.capacity === null || value.capacity === ''
                ? undefined
                : Number(value.capacity),
          };
        }
        draft.schedule.specialDates = draftSpecialDates;
      }

      await prisma.attraction.update({
        where: { id: attraction.id },
        data: {
          draftData: draft,
          status: 'DRAFT',
          rejectionReason: null,
        },
      });

      await writeAuditLog({
        req,
        action: 'ATTRACTION_SCHEDULE_UPDATED',
        entityType: 'ATTRACTION',
        entityId: attraction.id,
        metadata: { isDraft: true },
      });
    } else {
      const attractionData = {};
      if (openDays !== undefined) attractionData.openDays = serializeOpenDays(openDays);
      if (defaultCapacity !== undefined) {
        const cap = Number(defaultCapacity);
        if (!Number.isFinite(cap) || cap < 0) {
          return res.status(400).json({ message: 'Sức chứa mặc định không hợp lệ.' });
        }
        attractionData.defaultCapacity = cap;
      }

      if (
        Object.keys(attractionData).length === 0
        && !hasTimeSlots
        && !hasSpecialDates
      ) {
        return res.json({ message: 'Không có thay đổi lịch để lưu.' });
      }

      await prisma.$transaction(async (tx) => {
        // Cập nhật openDays + defaultCapacity
        if (Object.keys(attractionData).length > 0) {
          await tx.attraction.update({ where: { id: attraction.id }, data: attractionData });
        }

        // Thay thế toàn bộ khung giờ cấp điểm tham quan
        if (hasTimeSlots) {
          await tx.timeSlot.updateMany({
            where: {
              attractionId: attraction.id,
              ticketProductId: null,
              isActive: true,
            },
            data: { isActive: false },
          });
          if (timeSlots.length > 0) {
            await tx.timeSlot.createMany({
              data: timeSlots.map((slot) => ({
                attractionId: attraction.id,
                startTime: slot.start,
                endTime: slot.end,
                maxCapacity: Number(slot.capacity),
                isActive: slot.isActive !== false,
              })),
            });
          }
        }

        // Thay thế toàn bộ ngày đặc biệt
        if (hasSpecialDates) {
          await tx.specialDate.deleteMany({ where: { attractionId: attraction.id } });
          const sdEntries = Object.entries(specialDates);
          if (sdEntries.length > 0) {
            await tx.specialDate.createMany({
              data: sdEntries.map(([dateKey, value]) => ({
                attractionId: attraction.id,
                date: new Date(dateKey),
                closed: Boolean(value.closed),
                capacity:
                  value.capacity === undefined || value.capacity === null || value.capacity === ''
                    ? null
                    : Number(value.capacity),
              })),
            });
          }
        }

        await writeAuditLog({
          client: tx,
          req,
          action: 'ATTRACTION_SCHEDULE_UPDATED',
          entityType: 'ATTRACTION',
          entityId: attraction.id,
        });
      });
    }

    return res.json({ message: 'Lưu cấu hình lịch thành công.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSchedule,
  saveSchedule,
};
