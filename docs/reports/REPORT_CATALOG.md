# Authoritative report catalogue

Reports use `get_operational_report`, are company scoped, and load only the report selected by the `report` query parameter. The deprecated configurable raw-table path is not used for authoritative totals.

Catalogue:

- Performance: Operational performance; Product profitability.
- Inventory: Inventory valuation; Stock movement ledger; Inventory ageing and slow-moving stock.
- Customers and suppliers: Customer performance and receivables; Supplier spend and payables.
- Operations: Service Job profitability; Order fulfilment.

Recognition follows the Owner Performance cockpit: goods on shipment/completion evidence, services on `actual_completion`, service COGS only after final actual costing, POS commercial activity counted once, and reversals netted. Missing cost is not zero. Equivalent company, period, and warehouse filters reconcile to the dashboard without client-side replacement totals.

Customer location comes from maintained customer address/city/province fields. Operational location comes from governed warehouse/bin evidence; absent governed Service Job location is “No location” / “Sem local”. Cash/walk-in activity remains separate from named-customer rankings.
