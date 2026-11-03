# OrderOps

OrderOps helps a retail operator reserve stock for orders and recover failed shipment creation.

## Language

**Order**:
A customer's request for specified quantities of inventory items. A confirmed order has its requested stock reserved.
_Avoid_: Purchase, payment, shipment

**Inventory item**:
A product identified by a unique SKU, with a quantity available for reservation.
_Avoid_: Order item, shipment item

**Order item**:
A requested SKU and quantity belonging to one order.
_Avoid_: Inventory item, product stock

**Stock reservation**:
Stock set aside for a confirmed order and unavailable to other orders.
_Avoid_: Sale, delivery

**Fulfillment**:
The work of requesting a shipment from a carrier for a confirmed order.
_Avoid_: Payment, delivery

**Shipment**:
A carrier's accepted shipment request. Shipment creation does not mean the parcel has been dispatched or delivered.
_Avoid_: Delivery, dispatch

**Operator**:
A user allowed to create orders and request recovery of failed fulfillment.
_Avoid_: Customer, administrator

**Viewer**:
A user allowed to inspect inventory and orders without changing them.
_Avoid_: Operator
