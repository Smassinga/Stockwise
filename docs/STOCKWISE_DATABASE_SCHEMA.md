# Stockwise Database Schema

## Overview

This document describes the database schema and relationships used in Stockwise. The data model is designed to support multi-company inventory management with comprehensive tracking of items, movements, orders, and financial transactions.

## Entity Relationship Diagram

```
users ── company_members ── companies
  │                         │
  │                         ├── items
  │                         ├── warehouses ── bins
  │                         ├── customers
  │                         ├── suppliers
  │                         ├── orders ── order_lines
  │                         ├── stock_movements
  │                         ├── transactions
  │                         ├── banks ── bank_statements
  │                         ├── cash_transactions
  │                         ├── currencies ── fx_rates
  │                         └── uoms ── uom_conversions
  │
  └── notifications
```

## Core Entities

### Users

Represents a person who uses the system.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `email` (TEXT): Email address (unique)
- `encrypted_password` (TEXT): Hashed password
- `name` (TEXT): Full name
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Has many company_members
- Has many notifications

### Companies

Represents a business entity using the system.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `trade_name` (TEXT): Trading name
- `legal_name` (TEXT): Legal name
- `tax_id` (TEXT): Tax identification number
- `registration_no` (TEXT): Business registration number
- `phone` (TEXT): Contact phone
- `website` (TEXT): Website URL
- `print_footer` (TEXT): Footer text for printed documents
- `address1` (TEXT): Address line 1
- `address2` (TEXT): Address line 2
- `city` (TEXT): City
- `state` (TEXT): State/Province
- `postal` (TEXT): Postal code
- `country` (TEXT): Country code
- `logo_path` (TEXT): Path to company logo
- `base_currency` (TEXT): Base currency code
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Has many company_members
- Has many items
- Has many warehouses
- Has many customers
- Has many suppliers
- Has many orders
- Has many stock_movements
- Has many transactions
- Has many banks
- Has many cash_transactions
- Has many uoms
- Has many fx_rates

### Company Members

Links users to companies with role information.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `user_id` (UUID, FK): Reference to users.id
- `company_id` (UUID, FK): Reference to companies.id
- `role` (TEXT): Role within the company (OWNER, ADMIN, MANAGER, OPERATOR, VIEWER)
- `status` (TEXT): Membership status (invited, active, disabled)
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to user
- Belongs to company

## Inventory Management

### Items

Represents products or materials being tracked.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `name` (TEXT): Item name
- `sku` (TEXT): Stock Keeping Unit (unique per company)
- `barcode` (TEXT): Barcode/EAN/UPC
- `base_uom_id` (UUID, FK): Reference to uoms.id
- `min_stock` (NUMERIC): Minimum stock level alert threshold
- `notes` (TEXT): Additional notes
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company
- Belongs to base_uom
- Has many stock_movements
- Has many order_lines

### Warehouses

Represents storage locations.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `code` (TEXT): Warehouse code (unique per company)
- `name` (TEXT): Warehouse name
- `address` (TEXT): Physical address
- `notes` (TEXT): Additional notes
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company
- Has many bins
- Has many stock_movements

### Bins

Represents specific storage locations within warehouses.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `warehouse_id` (UUID, FK): Reference to warehouses.id
- `code` (TEXT): Bin code (unique per warehouse)
- `name` (TEXT): Bin name
- `notes` (TEXT): Additional notes
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to warehouse
- Has many stock_movements

## Stock Management

### Stock Movements

Represents changes in inventory levels.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `item_id` (UUID, FK): Reference to items.id
- `from_bin_id` (UUID, FK): Source bin (nullable)
- `to_bin_id` (UUID, FK): Destination bin (nullable)
- `qty` (NUMERIC): Quantity moved (negative for issues)
- `uom_id` (UUID, FK): Unit of measure used
- `unit_cost` (NUMERIC): Cost per unit in base currency
- `ref_type` (TEXT): Reference type (PO, SO, TRANSFER, ADJUST, etc.)
- `ref_id` (UUID): Reference ID (nullable)
- `ref_line_id` (UUID): Reference line ID (nullable)
- `notes` (TEXT): Movement notes
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Belongs to company
- Belongs to item
- Belongs to from_bin
- Belongs to to_bin
- Belongs to uom

## Order Management

### Orders

Represents purchase orders (PO) and sales orders (SO).

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `type` (TEXT): Order type (PO or SO)
- `ref_no` (TEXT): Order reference number (unique per company/type)
- `supplier_id` (UUID, FK): Reference to suppliers.id (for PO)
- `customer_id` (UUID, FK): Reference to customers.id (for SO)
- `currency_code` (TEXT): Currency code
- `fx_rate` (NUMERIC): Exchange rate to base currency
- `expected_date` (DATE): Expected delivery/receipt date
- `notes` (TEXT): Order notes
- `status` (TEXT): Order status
- `total_amount` (NUMERIC): Total order amount
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company
- Belongs to supplier (PO)
- Belongs to customer (SO)
- Has many order_lines

### Order Lines

Represents individual items in an order.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `order_id` (UUID, FK): Reference to orders.id
- `item_id` (UUID, FK): Reference to items.id
- `uom_id` (UUID, FK): Unit of measure used
- `qty` (NUMERIC): Quantity ordered
- `unit_price` (NUMERIC): Unit price in order currency
- `discount_pct` (NUMERIC): Discount percentage
- `tax_pct` (NUMERIC): Tax percentage
- `line_total` (NUMERIC): Line total in order currency
- `notes` (TEXT): Line notes
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to order
- Belongs to item
- Belongs to uom

## Financial Management

### Customers

Represents customer entities.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `code` (TEXT): Customer code (unique per company)
- `name` (TEXT): Customer name
- `contact_name` (TEXT): Contact person name
- `email` (TEXT): Contact email
- `phone` (TEXT): Contact phone
- `tax_id` (TEXT): Tax identification number
- `currency_code` (TEXT): Default currency
- `payment_terms` (TEXT): Payment terms
- `billing_address` (TEXT): Billing address
- `shipping_address` (TEXT): Shipping address
- `notes` (TEXT): Additional notes
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company
- Has many orders

### Suppliers

Represents supplier entities.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `code` (TEXT): Supplier code (unique per company)
- `name` (TEXT): Supplier name
- `contact_name` (TEXT): Contact person name
- `email` (TEXT): Contact email
- `phone` (TEXT): Contact phone
- `tax_id` (TEXT): Tax identification number
- `currency_code` (TEXT): Default currency
- `payment_terms` (TEXT): Payment terms
- `address` (TEXT): Supplier address
- `notes` (TEXT): Additional notes
- `status` (TEXT): Supplier status (active/inactive)
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company
- Has many orders

### Transactions

Represents financial transactions.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `type` (TEXT): Transaction type
- `ref_type` (TEXT): Reference type (SO, PO, CASH, etc.)
- `ref_id` (UUID): Reference ID (nullable)
- `currency_code` (TEXT): Currency code
- `fx_rate` (NUMERIC): Exchange rate to base currency
- `amount` (NUMERIC): Transaction amount
- `notes` (TEXT): Transaction notes
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Belongs to company

### Banks

Represents bank accounts.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `nickname` (TEXT): Account nickname
- `bank_name` (TEXT): Bank name
- `account_number` (TEXT): Account number
- `currency_code` (TEXT): Account currency
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company
- Has many bank_statements

### Bank Statements

Represents bank statement records.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `bank_id` (UUID, FK): Reference to banks.id
- `statement_date` (DATE): Statement date
- `opening_balance` (NUMERIC): Opening balance
- `closing_balance` (NUMERIC): Closing balance
- `file_path` (TEXT): Path to statement file
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Belongs to bank

### Cash Transactions

Represents cash transactions.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `type` (TEXT): Transaction type (in/out/adjustment)
- `ref_type` (TEXT): Reference type (nullable)
- `ref_id` (UUID): Reference ID (nullable)
- `currency_code` (TEXT): Currency code
- `fx_rate` (NUMERIC): Exchange rate to base currency
- `amount` (NUMERIC): Transaction amount
- `memo` (TEXT): Transaction memo
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Belongs to company

## Configuration

### Units of Measure (UoMs)

Represents measurement units.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id (nullable for global)
- `code` (TEXT): UoM code (unique per company/scope)
- `name` (TEXT): UoM name
- `family` (TEXT): UoM family (used for conversion validation)
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company (optional)
- Has many uom_conversions (as from_uom)
- Has many uom_conversions (as to_uom)

### UoM Conversions

Represents conversion factors between units.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id (nullable for global)
- `from_uom_id` (UUID, FK): Reference to uoms.id
- `to_uom_id` (UUID, FK): Reference to uoms.id
- `factor` (NUMERIC): Conversion factor (1 From = factor To)
- `created_at` (TIMESTAMP): Record creation timestamp
- `updated_at` (TIMESTAMP): Record update timestamp

**Relationships:**
- Belongs to company (optional)
- Belongs to from_uom
- Belongs to to_uom

### Currencies

Represents currency definitions.

**Fields:**
- `code` (TEXT, PK): Currency code (ISO 4217)
- `name` (TEXT): Currency name
- `symbol` (TEXT): Currency symbol
- `decimal_places` (INTEGER): Number of decimal places
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Has many companies (as base_currency)
- Has many fx_rates

### FX Rates

Represents foreign exchange rates.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `from_currency` (TEXT): From currency code
- `to_currency` (TEXT): To currency code
- `rate` (NUMERIC): Exchange rate (1 From = rate To)
- `date` (DATE): Rate date
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Belongs to company
- Belongs to from_currency
- Belongs to to_currency

## Notifications

Represents system notifications for users.

**Fields:**
- `id` (UUID, PK): Unique identifier
- `company_id` (UUID, FK): Reference to companies.id
- `user_id` (UUID, FK): Reference to users.id (nullable for company-wide)
- `title` (TEXT): Notification title
- `body` (TEXT): Notification body
- `action_url` (TEXT): URL for action (nullable)
- `read_at` (TIMESTAMP): When notification was read (nullable)
- `created_at` (TIMESTAMP): Record creation timestamp

**Relationships:**
- Belongs to company
- Belongs to user (optional)

## Row Level Security Policies

All tables implement Row Level Security (RLS) policies to ensure data isolation between companies:

```sql
-- Example policy for items table
CREATE POLICY "Users can only access their company's items"
ON items
FOR ALL
USING (company_id = current_setting('app.company_id')::uuid)
WITH CHECK (company_id = current_setting('app.company_id')::uuid);
```

## Indexes

Key indexes for performance optimization:

1. **Primary Keys**: Automatically created for all PK fields
2. **Foreign Keys**: Automatically created for all FK references
3. **Unique Constraints**: 
   - users.email
   - companies.base_currency
   - items.sku + company_id
   - warehouses.code + company_id
   - bins.code + warehouse_id
   - orders.ref_no + company_id + type
   - customers.code + company_id
   - suppliers.code + company_id
   - uoms.code + company_id
4. **Performance Indexes**:
   - stock_movements.created_at
   - orders.created_at
   - transactions.created_at

## Triggers

Key database triggers for data integrity:

1. **Timestamp Updates**: Automatically update `updated_at` fields
2. **Reference Validation**: Validate foreign key references
3. **Business Logic**: Enforce business rules at the database level
4. **Stock Level Updates**: Update stock levels based on movements
5. **Average Cost Calculation**: Calculate average cost for inventory items

## Views and Functions

### Stock Levels View

A computed view that aggregates stock movements to show current stock levels:

```sql
CREATE VIEW stock_levels AS
SELECT 
    company_id,
    item_id,
    warehouse_id,
    bin_id,
    SUM(qty) as qty,
    AVG(unit_cost) as avg_cost
FROM stock_movements
GROUP BY company_id, item_id, warehouse_id, bin_id;
```

### Utility Functions

1. **set_active_company**: Sets the active company for the current session
2. **invite_company_member**: Creates an invitation for a new company member
3. **accept_my_invite**: Accepts an invitation for the current user
4. **sync_invites_for_me**: Synchronizes pending invitations for the current user

This database schema provides a comprehensive foundation for inventory management while maintaining flexibility for future enhancements.