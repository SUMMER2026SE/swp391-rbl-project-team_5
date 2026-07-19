"""
holidays.py
------------------------------------------------------------
Lịch ngày lễ Việt Nam dùng làm feature "is_holiday" / "days_to_holiday"
cho model dự báo doanh thu (doanh thu thường tăng vọt hoặc giảm mạnh
quanh các dịp lễ - đặc biệt Tết Nguyên Đán).

Ghi chú: Tết Nguyên Đán tính theo âm lịch nên phải khai báo cứng theo
từng năm. Danh sách dưới đây phủ 2023-2028 (đủ cho dữ liệu lịch sử +
horizon dự báo thực tế). Khi cần năm mới hơn, chỉ cần bổ sung thêm.
"""

from datetime import date, timedelta

# Các ngày lễ dương lịch cố định (áp dụng mọi năm)
FIXED_HOLIDAYS_MMDD = [
    (1, 1),  # Tết Dương lịch
    (4, 30),  # Giải phóng miền Nam
    (5, 1),  # Quốc tế Lao động
    (9, 2),  # Quốc khánh
]

# Ngày đầu năm Tết Nguyên Đán (mùng 1 Tết) theo từng năm dương lịch.
# Nghỉ Tết thực tế thường kéo dài 5-7 ngày quanh mốc này.
LUNAR_NEW_YEAR_DAY1 = {
    2023: date(2023, 1, 22),
    2024: date(2024, 2, 10),
    2025: date(2025, 1, 29),
    2026: date(2026, 2, 17),
    2027: date(2027, 2, 6),
    2028: date(2028, 1, 26),
}

# Giỗ Tổ Hùng Vương (mùng 10 tháng 3 âm lịch) - quy đổi dương lịch gần đúng
HUNG_KINGS_DAY = {
    2023: date(2023, 4, 29),
    2024: date(2024, 4, 18),
    2025: date(2025, 4, 7),
    2026: date(2026, 4, 26),
    2027: date(2027, 4, 15),
    2028: date(2028, 4, 4),
}

TET_WINDOW_BEFORE = 2  # số ngày nghỉ trước mùng 1 Tết
TET_WINDOW_AFTER = 4  # số ngày nghỉ sau mùng 1 Tết


def _holiday_set_for_year(year: int) -> set:
    days = set()
    for month, day in FIXED_HOLIDAYS_MMDD:
        try:
            days.add(date(year, month, day))
        except ValueError:
            continue

    tet_day1 = LUNAR_NEW_YEAR_DAY1.get(year)
    if tet_day1:
        for offset in range(-TET_WINDOW_BEFORE, TET_WINDOW_AFTER + 1):
            days.add(tet_day1 + timedelta(days=offset))

    hung = HUNG_KINGS_DAY.get(year)
    if hung:
        days.add(hung)

    return days


def is_holiday(d: date) -> bool:
    return d in _holiday_set_for_year(d.year)


def days_to_nearest_holiday(d: date, search_radius: int = 30) -> int:
    """Số ngày (tuyệt đối) tới ngày lễ gần nhất trong phạm vi tìm kiếm.
    Trả về search_radius nếu không tìm thấy ngày lễ nào trong phạm vi.
    """
    for offset in range(0, search_radius + 1):
        if is_holiday(d + timedelta(days=offset)) or is_holiday(d - timedelta(days=offset)):
            return offset
    return search_radius


def is_tet_peak(d: date) -> bool:
    """True nếu rơi vào đúng giai đoạn cao điểm Tết (thường kéo khách du lịch
    tăng vọt ở một số điểm tham quan hoặc giảm mạnh ở số khác - dùng làm
    feature riêng thay vì gộp chung is_holiday)."""
    tet_day1 = LUNAR_NEW_YEAR_DAY1.get(d.year)
    if not tet_day1:
        return False
    return tet_day1 - timedelta(days=TET_WINDOW_BEFORE) <= d <= tet_day1 + timedelta(days=TET_WINDOW_AFTER)
