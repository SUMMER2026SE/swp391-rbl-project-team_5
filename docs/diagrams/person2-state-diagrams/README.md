# Person 2 - State Diagrams

This folder contains the state diagrams assigned to Person 2:

1. Reservation
2. Booking
3. Payment
4. Ticket Instance
5. Saved Itinerary
6. Voucher
7. Refund Request

The Review diagram is retained as a shared/transfer diagram for the member
responsible for Partner Management.

## Folder structure

- `source/`: editable PlantUML source files.
- `png/`: rendered PNG images.
- `svg/`: rendered SVG images.

The state names follow `backend/prisma/schema.prisma`. Each diagram uses a
minimal UML state-machine style: an initial pseudostate, rounded state nodes,
short guarded transitions, and a final pseudostate. Notes, legends, choice
diamonds, and implementation actions are intentionally omitted for readability.

Rendered with PlantUML 1.2026.6.

Notation references:

- https://plantuml.com/state-diagram
- https://www.omg.org/spec/PSSM/1.0/About-PSSM
