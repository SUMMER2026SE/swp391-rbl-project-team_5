-- A gateway refund transaction number is immutable evidence.  The composite
-- key keeps numbers from different gateways independent while preventing a
-- VNPay number from being attached to two local refund transactions.
CREATE UNIQUE INDEX "RefundTransaction_gateway_gatewayTransactionId_key"
ON "RefundTransaction" ("gateway", "gatewayTransactionId");
