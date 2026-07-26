# Person 2 - Swimlane Diagrams

This folder contains the complete PlantUML swimlane activity-diagram set for
Person 2, covering Module 3 (Booking & Payment) and Module 4 (AI Travel
Assistant) in the code-aligned SRS.

Every diagram uses English labels and contains exactly one initial node and one
activity final node. Alternative and exception outcomes merge before the final
node.

## Coverage

| No. | Module | Use case |
|---:|---|---|
| 01 | Module 3 | UC-03-01 - Reserve / Hold Ticket |
| 02 | Module 3 | UC-03-02 - Apply Voucher |
| 03 | Module 3 | UC-03-03 - Create Booking |
| 04 | Module 3 | UC-03-04 - Online Payment via VNPay |
| 05 | Module 3 | UC-03-05 - Process Payment Result |
| 06 | Module 3 | UC-03-06 - Payment Method Validation |
| 07 | Module 3 | UC-03-07 - View My Bookings & Booking Detail |
| 08 | Module 3 | UC-03-08 - Approve Booking |
| 09 | Module 3 | UC-03-09 - Reject Booking |
| 10 | Module 3 | UC-03-10 - Request Refund |
| 11 | Module 3 | UC-03-11 - Process Refund Request |
| 12 | Module 3 | UC-03-12 - Ticket Check-in by QR |
| 13 | Module 3 | UC-03-13 - Reissue E-Ticket |
| 14 | Module 3 | UC-03-14 - Admin Booking Management & Statistics |
| 15 | Module 3 | UC-03-15 - Auto-Expire Hold Reservation |
| 16 | Module 4 | UC-M4.01 - Generate AI Itinerary |
| 17 | Module 4 | UC-M4.02 - Get AI Attraction Recommendations |
| 18 | Module 4 | UC-M4.03 - Chat with AI Travel Assistant |
| 19 | Module 4 | UC-M4.04 - Save and Manage AI Itinerary |

## Folder structure

- `source/`: editable PlantUML source files.
- `png/`: rendered PNG images.
- `svg/`: rendered SVG images.
- `person2-swimlane-overview.png`: contact sheet for reviewing all 19 diagrams.

The parent `outputs/` folder also contains `person2-swimlane-diagrams.zip` for
submission or sharing.
