# Screen Flow Diagram (chia theo khu vuc)

Screen Flow Diagram cua VietTicket duoc tach tu 1 hinh tong (`../screen_flow_diagram.puml`)
thanh **6 diagram nho** cho de nhin. Nguon dieu huong: `vietticket-travel/src/routes/AppRoutes.jsx`
+ dieu huong thuc te (`navigate` / `<Link>`).

## Danh sach file

| File | Noi dung | Mau khu vuc |
|------|----------|-------------|
| `00_overview.puml` | Ban do tong the 5 khu vuc + cach di chuyen giua cac khu vuc | (tat ca) |
| `01_guest.puml` | Khu vuc 1 - Khach (Public / Guest, chua dang nhap) | `#E3F2FD` |
| `02_customer.puml` | Khu vuc 2 - Khach hang (Customer, da dang nhap) | `#E8F5E9` |
| `03_partner.puml` | Khu vuc 3 - Doi tac (Partner) | `#FFF3E0` |
| `04_staff.puml` | Khu vuc 4 - Nhan vien (Staff) | `#F3E5F5` |
| `05_admin.puml` | Khu vuc 5 - Quan tri vien (Admin) | `#FFEBEE` |

Moi file `.puml` co file `.png` tuong ung da render san.

## Quy uoc doc

- **Hop mau** = man hinh thuoc khu vuc dang xem (mau theo bang tren).
- **Hop mau xam `<<ext>>`** (`#ECEFF1`) = man hinh o khu vuc khac, chi ve de thay **diem vao / diem ra**
  cua luong; chi tiet man hinh do xem o file khu vuc tuong ung (nhan `[Guest]`, `[Customer]`... ghi ro noi den).
- **Mui ten co nhan** = hanh dong / dieu kien chuyen man hinh.
- Trong moi khu vuc, cac trang con dieu huong qua lai bang sidebar / menu co dinh
  (khong ve het mui ten cho de nhin). Nut "Dang xuat" luon quay ve trang Dang nhap.

## Render lai PNG

Tu thu muc `docs/diagrams/`:

```bash
java -DPLANTUML_LIMIT_SIZE=16384 -jar plantuml.jar -tpng screen_flow/*.puml
```

Ten file PNG lay theo ten sau `@startuml` (vi du `@startuml 01_guest` -> `01_guest.png`).
