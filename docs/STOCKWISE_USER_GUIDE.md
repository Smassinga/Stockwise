# Stockwise User Guide

## Table of Contents
1. [Getting Started](#getting-started)
2. [Dashboard Overview](#dashboard-overview)
3. [Inventory Management](#inventory-management)
   - [Items](#items)
   - [Warehouses & Bins](#warehouses--bins)
   - [Stock Movements](#stock-movements)
4. [Order Management](#order-management)
   - [Purchase Orders](#purchase-orders)
   - [Sales Orders](#sales-orders)
5. [Financial Management](#financial-management)
   - [Transactions](#transactions)
   - [Cash Management](#cash-management)
   - [Banking](#banking)
6. [Reporting](#reporting)
7. [Master Data](#master-data)
   - [Customers](#customers)
   - [Suppliers](#suppliers)
8. [Settings & Administration](#settings--administration)
   - [Company Profile](#company-profile)
   - [Users](#users)
   - [Units of Measure](#units-of-measure)
   - [Currency](#currency)

## Getting Started

### Account Creation
1. Navigate to the Stockwise login page
2. Click "Sign Up" to create a new account
3. Enter your name, email address, and password
4. Check your email for a verification link
5. Click the verification link to complete registration
6. Create your first company or join an existing one

### Company Setup
1. After verification, you'll be prompted to create a company
2. Enter your company name and other details
3. Set your base currency
4. Configure your first warehouse

### Navigation
Stockwise features a sidebar navigation system:
- **Dashboard**: Overview of key metrics
- **Items**: Item master data management
- **Movements**: Inventory movement operations
- **Orders**: Purchase and sales orders
- **Reports**: Business analytics and reporting
- **Stock Levels**: Current inventory status
- **Warehouses**: Warehouse and bin management
- **Transactions**: Financial transaction tracking
- **Cash**: Cash transaction management
- **Banks**: Bank account management
- **Customers**: Customer master data
- **Suppliers**: Supplier master data
- **Currency**: Currency and FX rate management
- **UoM**: Unit of measure configuration
- **Settings**: System configuration
- **Users**: User management

## Dashboard Overview

The dashboard provides a comprehensive overview of your business performance:

### Key Performance Indicators (KPIs)
1. **Inventory Value**: Total value of inventory across all warehouses
2. **Revenue**: Revenue generated in the selected time period
3. **COGS**: Cost of Goods Sold in the selected time period
4. **Gross Margin**: Profitability metric (Revenue - COGS)

### Low Stock Alerts
Displays items that have fallen below their minimum stock levels.

### Top Products by Gross Margin
Shows your best-performing products based on gross margin.

### Recent Movements
Lists the most recent inventory movements.

### Daily Revenue & COGS
Provides a detailed view of daily revenue and COGS for the selected period.

## Inventory Management

### Items

#### Creating Items
1. Navigate to the "Items" section
2. Click "Create Item"
3. Enter the item name and SKU
4. Select the base unit of measure
5. Set minimum stock level (optional)
6. Click "Save"

#### Managing Items
- **Search**: Use the search bar to find items by name or SKU
- **Edit**: Click the edit button to modify item details
- **Delete**: Remove items that are no longer needed (note: items with stock cannot be deleted)

### Warehouses & Bins

#### Creating Warehouses
1. Navigate to the "Warehouses" section
2. Click "Add Warehouse"
3. Enter warehouse code and name
4. Add address information (optional)
5. Click "Save"

#### Creating Bins
1. Select a warehouse from the list
2. Click "Add Bin"
3. Enter bin code and name
4. Click "Save"

### Stock Movements

Stock movements are how you record changes to your inventory levels.

#### Movement Types
1. **Receive**: Add inventory to a warehouse/bin
2. **Issue**: Remove inventory from a warehouse/bin
3. **Transfer**: Move inventory between bins/warehouses
4. **Adjust**: Adjust inventory levels (increase or decrease)

#### Recording a Receive Movement
1. Navigate to "Movements"
2. Select "Receive" as the movement type
3. Select the destination warehouse and bin
4. Select the item
5. Enter the quantity and unit of measure
6. Enter the unit cost
7. Add notes (optional)
8. Click "Receive"

#### Recording an Issue Movement
1. Navigate to "Movements"
2. Select "Issue" as the movement type
3. Select the source warehouse and bin
4. Select the item
5. Enter the quantity and unit of measure
6. Add notes (optional)
7. Click "Issue"

#### Recording a Transfer Movement
1. Navigate to "Movements"
2. Select "Transfer" as the movement type
3. Select the source warehouse and bin
4. Select the destination warehouse and bin
5. Select the item
6. Enter the quantity and unit of measure
7. Add notes (optional)
8. Click "Transfer"

#### Recording an Adjust Movement
1. Navigate to "Movements"
2. Select "Adjust" as the movement type
3. Select the warehouse and bin
4. Select the item
5. Enter the new quantity
6. If increasing stock, enter the unit cost
7. Add notes (optional)
8. Click "Adjust"

## Order Management

### Purchase Orders

#### Creating a Purchase Order
1. Navigate to "Orders" and select the "Purchase" tab
2. Click "New PO"
3. Select a supplier
4. Enter the expected date
5. Select the currency
6. Add line items:
   - Select the item
   - Enter quantity and unit of measure
   - Enter unit price
   - Add discount (optional)
7. Add notes (optional)
8. Click "Create PO"

#### Receiving a Purchase Order
1. Find the PO in the list and click "View"
2. Review the line items
3. Select the destination bin for each item
4. Enter the quantity to receive (can be partial)
5. Click "Receive"

### Sales Orders

#### Creating a Sales Order
1. Navigate to "Orders" and select the "Sales" tab
2. Click "New SO"
3. Select a customer
4. Enter the expected ship date
5. Select the currency
6. Add line items:
   - Select the item
   - Enter quantity and unit of measure
   - Enter unit price
   - Add discount (optional)
7. Add notes (optional)
8. Click "Create SO"

#### Shipping a Sales Order
1. Find the SO in the list and click "View"
2. Review the line items
3. Select the source bin for each item
4. Enter the quantity to ship (can be partial)
5. Click "Ship"

#### Processing Cash Sales
1. Navigate to "Movements"
2. Select "Issue" as the movement type
3. Select "SO" as the reference type
4. Select the source warehouse and bin
5. Select the item
6. Enter the quantity and unit of measure
7. Enter the sell price and currency information
8. Click "Issue" to create both the sales order and COGS movement

## Financial Management

### Transactions

#### Viewing Transactions
1. Navigate to "Transactions"
2. Use filters to narrow down the results:
   - Date range
   - Reference type
   - Reference ID
3. Click on any transaction to view details

### Cash Management

#### Recording Cash Transactions
1. Navigate to "Cash"
2. Click "Add transaction"
3. Select the transaction type (in/out/adjustment)
4. Enter the amount and currency
5. Add a memo/description
6. Click "Save"

#### Approving Cash Transactions
1. Managers and above can approve pending cash transactions
2. Navigate to "Cash"
3. Find transactions with "Awaiting" status
4. Click "Approve" to finalize the transaction

### Banking

#### Managing Bank Accounts
1. Navigate to "Banks"
2. Click "New Bank" to add an account
3. Enter account details:
   - Nickname
   - Bank name
   - Account number
   - Currency
4. Click "Save"

#### Uploading Bank Statements
1. Select a bank account
2. Click "Upload Statement"
3. Select the statement file (PDF/CSV/Image)
4. Enter the statement date and opening balance
5. Click "Save"

#### Reconciling Transactions
1. View bank transactions
2. Match them with your bank statement
3. Mark transactions as reconciled

## Reporting

Stockwise provides comprehensive reporting capabilities:

### Summary Report
Provides an overview of key business metrics:
- Days in period
- Units sold (net)
- Average inventory (units)
- Turns (units)
- Average days to sell
- COGS (period)
- Valuation total

### Valuation Report
Shows inventory valuation by warehouse:
- Current snapshot or as of end date
- Value by warehouse
- Total valuation

### Turnover Report
Analyzes inventory turnover:
- Fastest moving items
- Slowest moving items
- Items with zero sales

### Aging Report
Shows inventory aging analysis:
- Items by age buckets
- Value of aged inventory

### Revenue Report
Tracks revenue by product:
- Revenue by item
- Gross margin analysis

### Supplier Report
Provides supplier performance metrics:
- Transaction history
- Outstanding balances

### Customer Report
Provides customer performance metrics:
- Transaction history
- Outstanding balances

### Report Filters
All reports support these filters:
- Date range
- Costing method (Weighted Average or FIFO)
- Currency selection
- Automatic or manual FX rates

### Exporting Reports
All reports can be exported to CSV format for further analysis.

## Master Data

### Customers

#### Creating Customers
1. Navigate to "Customers"
2. Click "Create Customer"
3. Enter customer code and name
4. Add contact information
5. Enter billing and shipping addresses
6. Set payment terms and currency
7. Add notes (optional)
8. Click "Save"

#### Managing Customers
- **Search**: Use the search bar to find customers
- **Edit**: Click the edit button to modify customer details
- **Delete**: Remove customers that are no longer needed

### Suppliers

#### Creating Suppliers
1. Navigate to "Suppliers"
2. Click "Create Supplier"
3. Enter supplier code and name
4. Add contact information
5. Enter address
6. Set payment terms and currency
7. Add notes (optional)
8. Click "Save"

#### Managing Suppliers
- **Search**: Use the search bar to find suppliers
- **Edit**: Click the edit button to modify supplier details
- **Delete**: Remove suppliers that are no longer needed
- **Activate/Deactivate**: Control supplier status

## Settings & Administration

### Company Profile

#### Updating Company Information
1. Navigate to "Settings"
2. Click on "Company Profile"
3. Update any of the following:
   - Trade name
   - Legal name
   - Tax ID
   - Registration number
   - Phone and website
   - Address information
   - Logo
   - Print footer note
4. Click "Save"

### Users

#### Managing Users
1. Navigate to "Users"
2. View the list of current members

#### Inviting Users
1. Enter the user's email address
2. Select an appropriate role
3. Click "Invite and Email"

#### Changing User Roles
1. Find the user in the list
2. Select a new role from the dropdown
3. The change takes effect immediately

#### Removing Users
1. Find the user in the list
2. Click "Remove"
3. Confirm the removal

### Units of Measure

#### Managing Units of Measure
1. Navigate to "UoM" in the settings section
2. View existing units of measure

#### Creating New Units
1. Click "Add Unit"
2. Enter the code and name
3. Select the family (mass, volume, etc.)
4. Click "Save"

#### Setting Up Conversions
1. Click "Add Conversion"
2. Select the "From" and "To" units
3. Enter the conversion factor
4. Click "Save Conversion"

Example: To convert from BOX to EACH with a factor of 24 (1 BOX = 24 EACH)

### Currency

#### Managing Currencies
1. Navigate to "Currency"
2. View allowed currencies for your company
3. Set your base currency

#### Adding FX Rates
1. Click "Add / Update FX Rate"
2. Select the "From" and "To" currencies
3. Enter the rate (1 From = ? To)
4. Enter the date
5. Click "Save Rate"

This user guide provides comprehensive instructions for using all major features of the Stockwise inventory management system. For additional help, please refer to the specific documentation for each section or contact your system administrator.